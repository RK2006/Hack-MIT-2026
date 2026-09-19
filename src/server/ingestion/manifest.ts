import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { GraphError, graphError } from '../context/errors';
import {
  authorizeCreateNode,
  authorizeEdge,
  parseCreateEdge,
  parseCreateNode,
  parseProjectInput,
  parseSourceInput,
} from '../context/validation';
import {
  EDGE_TYPES,
  type ContextNode,
  type EdgeType,
  type NodeType,
  type SourceKind,
} from '../context/types';
import * as duplicateAwareJson from 'json-dup-key-validator';

const key = z.string().regex(/^[a-z][a-z0-9._-]{0,79}$/);
const preservedText = (min: number, max: number) =>
  z
    .string()
    .refine((value) => !value.includes('\0'))
    .refine((value) => Array.from(value).length >= min && Array.from(value).length <= max);
const trimmedText = (min: number, max: number) =>
  z
    .string()
    .refine((value) => !value.includes('\0'))
    .transform((value) => value.trim())
    .refine((value) => Array.from(value).length >= min && Array.from(value).length <= max);
const commonNode = {
  key,
  title: trimmedText(1, 200),
  content: preservedText(1, 20_000),
  summary: preservedText(0, 1_000),
  importance: z.number().int().min(1).max(5),
  confidence: z.number().finite().min(0).max(1),
  sourceKey: key,
};
const nonContainsEdges = EDGE_TYPES.filter((type) => type !== 'CONTAINS') as [
  Exclude<EdgeType, 'CONTAINS'>,
  ...Exclude<EdgeType, 'CONTAINS'>[],
];

export const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    project: z.object({ id: z.string().uuid(), name: trimmedText(1, 120) }).strict(),
    sources: z
      .array(
        z
          .object({
            key,
            kind: z.enum(['repository', 'manual', 'agent']),
            uri: trimmedText(1, 2048),
            label: trimmedText(1, 200),
            excerpt: preservedText(1, 20_000),
            actorLabel: trimmedText(1, 120),
          })
          .strict(),
      )
      .min(1)
      .max(1_000),
    components: z.array(z.object({ ...commonNode, parentKey: key.optional() }).strict()),
    files: z.array(
      z.object({ ...commonNode, path: preservedText(1, 500), componentKey: key }).strict(),
    ),
    claims: z.array(
      z
        .object({
          ...commonNode,
          type: z.enum(['decision', 'constraint', 'assumption', 'discovery', 'bug']),
          changeReason: trimmedText(1, 500),
        })
        .strict(),
    ),
    edges: z.array(
      z
        .object({ fromKey: key, toKey: key, type: z.enum(nonContainsEdges), sourceKey: key })
        .strict(),
    ),
  })
  .strict();

export type PreparedProjectManifest = z.infer<typeof manifestSchema>;
export type PreparedSource = PreparedProjectManifest['sources'][number];
export type PreparedNode =
  | (PreparedProjectManifest['components'][number] & { category: 'component' })
  | (PreparedProjectManifest['files'][number] & { category: 'file' })
  | (PreparedProjectManifest['claims'][number] & { category: 'claim' });

export function parseManifestBytes(rawBytes: Uint8Array): PreparedProjectManifest {
  if (rawBytes.byteLength === 0 || rawBytes.byteLength > 1_048_576) {
    throw graphError('VALIDATION_ERROR', 'Manifest must be between 1 byte and 1 MiB', {
      path: '$',
    });
  }
  const textDecoder = new TextDecoder('utf-8', { fatal: true });
  let raw: string;
  try {
    raw = textDecoder.decode(rawBytes);
  } catch {
    throw graphError('VALIDATION_ERROR', 'Manifest must be valid UTF-8', { path: '$' });
  }
  if (raw.charCodeAt(0) === 0xfeff)
    throw graphError('VALIDATION_ERROR', 'Manifest must not contain a BOM', { path: '$' });
  let parsed: unknown;
  try {
    parsed = duplicateAwareJson.parse(raw, false);
  } catch {
    throw graphError(
      'VALIDATION_ERROR',
      'Manifest must be valid JSON without duplicate object keys',
      { path: '$' },
    );
  }
  const result = manifestSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw graphError('VALIDATION_ERROR', 'Manifest validation failed', {
      path: issue ? `$.${issue.path.join('.')}` : '$',
      reason: issue?.message ?? 'invalid manifest',
    });
  }
  validateReferences(result.data);
  return result.data;
}

function validateReferences(manifest: PreparedProjectManifest): void {
  const sourceKeys = new Set<string>();
  for (const source of manifest.sources) {
    if (sourceKeys.has(source.key))
      throw graphError('VALIDATION_ERROR', 'Duplicate source key', {
        path: `sources.${source.key}`,
      });
    sourceKeys.add(source.key);
    if (!source.excerpt.includes('synthetic prepared example')) {
      throw graphError(
        'VALIDATION_ERROR',
        'Every source must label the synthetic prepared example',
        { path: `sources.${source.key}.excerpt` },
      );
    }
  }
  const nodes: PreparedNode[] = [
    ...manifest.components.map((node) => ({ ...node, category: 'component' as const })),
    ...manifest.files.map((node) => ({ ...node, category: 'file' as const })),
    ...manifest.claims.map((node) => ({ ...node, category: 'claim' as const })),
  ];
  if (nodes.length < 1 || nodes.length > 1_000)
    throw graphError('VALIDATION_ERROR', 'Manifest node count is outside 1..1000', {
      path: 'nodes',
    });
  const nodeByKey = new Map<string, PreparedNode>();
  const paths = new Set<string>();
  for (const node of nodes) {
    if (nodeByKey.has(node.key))
      throw graphError('VALIDATION_ERROR', 'Duplicate node key', { path: `nodes.${node.key}` });
    nodeByKey.set(node.key, node);
    const source = manifest.sources.find((item) => item.key === node.sourceKey);
    if (!source)
      throw graphError('VALIDATION_ERROR', 'Dangling source reference', {
        path: `nodes.${node.key}.sourceKey`,
      });
    if (node.category !== 'claim' && source.kind !== 'repository')
      throw graphError('VALIDATION_ERROR', 'Structure requires repository evidence', {
        path: `nodes.${node.key}.sourceKey`,
      });
    if (node.category === 'claim' && source.kind === 'repository')
      throw graphError('VALIDATION_ERROR', 'Claims require manual or agent evidence', {
        path: `nodes.${node.key}.sourceKey`,
      });
    if (node.category === 'file') {
      if (paths.has(node.path))
        throw graphError('VALIDATION_ERROR', 'Duplicate file path', {
          path: `files.${node.key}.path`,
        });
      paths.add(node.path);
    }
  }
  let derivedEdges = 0;
  for (const component of manifest.components) {
    if (component.parentKey) {
      const parent = nodeByKey.get(component.parentKey);
      if (!parent || parent.category !== 'component')
        throw graphError('VALIDATION_ERROR', 'Component parent must reference a component', {
          path: `components.${component.key}.parentKey`,
        });
      derivedEdges += 1;
    }
  }
  for (const file of manifest.files) {
    const owner = nodeByKey.get(file.componentKey);
    if (!owner || owner.category !== 'component')
      throw graphError('VALIDATION_ERROR', 'File owner must reference a component', {
        path: `files.${file.key}.componentKey`,
      });
    derivedEdges += 1;
  }
  const edgeKeys = new Set<string>();
  for (const edge of manifest.edges) {
    if (!nodeByKey.has(edge.fromKey) || !nodeByKey.has(edge.toKey))
      throw graphError('VALIDATION_ERROR', 'Edge has a dangling node reference', {
        path: `edges.${edge.fromKey}.${edge.toKey}`,
      });
    if (edge.fromKey === edge.toKey)
      throw graphError('VALIDATION_ERROR', 'Self edges are forbidden', {
        path: `edges.${edge.fromKey}`,
      });
    const source = manifest.sources.find((item) => item.key === edge.sourceKey);
    if (!source || source.kind === 'repository')
      throw graphError('VALIDATION_ERROR', 'Explicit edges require manual or agent evidence', {
        path: `edges.${edge.sourceKey}`,
      });
    const identity = `${edge.fromKey}\0${edge.toKey}\0${edge.type}`;
    if (edgeKeys.has(identity))
      throw graphError('VALIDATION_ERROR', 'Duplicate directed typed edge', {
        path: `edges.${edge.fromKey}.${edge.toKey}`,
      });
    edgeKeys.add(identity);
  }
  const edgeCount = derivedEdges + manifest.edges.length;
  if (edgeCount < 1 || edgeCount > 5_000)
    throw graphError('VALIDATION_ERROR', 'Manifest edge count is outside 1..5000', {
      path: 'edges',
    });
  preflightFoundation(manifest, nodes);
}

function preflightFoundation(manifest: PreparedProjectManifest, nodes: PreparedNode[]): void {
  const at = <T>(path: string, work: () => T): T => {
    try {
      return work();
    } catch (error) {
      if (error instanceof GraphError) {
        throw graphError(error.code, error.message, { ...error.details, path });
      }
      throw error;
    }
  };
  at('$.project', () => parseProjectInput(manifest.project));
  const sourceIds = new Map<string, string>();
  for (const source of manifest.sources) {
    sourceIds.set(source.key, randomUUID());
    at(`$.sources[${source.key}]`, () => {
      parseSourceInput({
        kind: source.kind,
        uri: source.uri,
        label: source.label,
        excerpt: source.excerpt,
        revisionRef: source.kind === 'repository' ? `sha256:${'0'.repeat(64)}` : null,
      });
    });
  }
  const fakeNodes = new Map<string, ContextNode>();
  for (const prepared of nodes) {
    const source = manifest.sources.find((item) => item.key === prepared.sourceKey)!;
    const path = `$.${prepared.category === 'component' ? 'components' : prepared.category === 'file' ? 'files' : 'claims'}[${prepared.key}]`;
    const input = at(path, () => {
      const parsed = parseCreateNode({
        type: nodeType(prepared),
        externalKey: prepared.key,
        path: prepared.category === 'file' ? prepared.path : null,
        title: prepared.title,
        content: prepared.content,
        summary: prepared.summary,
        authority: authorityFor(source.kind),
        importance: prepared.importance,
        confidence: prepared.confidence,
        sourceId: sourceIds.get(source.key)!,
        actor: actorFor(source),
        changeReason:
          prepared.category === 'claim' ? prepared.changeReason : 'Imported declared structure',
      });
      authorizeCreateNode(parsed, source.kind);
      return parsed;
    });
    const id = randomUUID();
    fakeNodes.set(prepared.key, {
      id,
      projectId: manifest.project.id,
      type: input.type,
      externalKey: input.externalKey,
      path: input.path,
      createdAt: new Date(0).toISOString(),
      current: {
        projectId: manifest.project.id,
        nodeId: id,
        version: 1,
        title: input.title,
        content: input.content,
        summary: input.summary,
        authority: input.authority,
        importance: input.importance,
        confidence: input.confidence,
        archived: false,
        sourceId: input.sourceId,
        actor: input.actor,
        changeReason: input.changeReason,
        createdAt: new Date(0).toISOString(),
      },
    });
  }
  const structural = [
    ...manifest.components
      .filter((item) => item.parentKey)
      .map((item) => ({
        from: item.parentKey!,
        to: item.key,
        sourceKey: item.sourceKey,
      })),
    ...manifest.files.map((item) => ({
      from: item.componentKey,
      to: item.key,
      sourceKey: item.sourceKey,
    })),
  ];
  const validateEdge = (fromKey: string, toKey: string, type: EdgeType, sourceKey: string) => {
    const source = manifest.sources.find((item) => item.key === sourceKey)!;
    const from = fakeNodes.get(fromKey)!;
    const to = fakeNodes.get(toKey)!;
    at(`$.edges[${fromKey}->${toKey}:${type}]`, () => {
      const input = parseCreateEdge({
        fromNodeId: from.id,
        toNodeId: to.id,
        type,
        authority: authorityFor(source.kind),
        sourceId: sourceIds.get(source.key)!,
        actor: actorFor(source),
      });
      authorizeEdge(input, source.kind, from, to);
    });
  };
  for (const edge of structural) validateEdge(edge.from, edge.to, 'CONTAINS', edge.sourceKey);
  for (const edge of manifest.edges)
    validateEdge(edge.fromKey, edge.toKey, edge.type, edge.sourceKey);
}

export function authorityFor(kind: SourceKind) {
  return kind === 'agent' ? ('inferred' as const) : ('canonical' as const);
}
export function actorFor(source: PreparedSource) {
  return {
    kind:
      source.kind === 'repository'
        ? ('importer' as const)
        : source.kind === 'manual'
          ? ('human' as const)
          : ('agent' as const),
    label: source.actorLabel,
  };
}
export function nodeType(node: PreparedNode): NodeType {
  return node.category === 'claim' ? node.type : node.category;
}

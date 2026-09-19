import { createHash } from 'node:crypto';
import type { GraphStore } from '../context/types.js';
import {
  actorFor,
  authorityFor,
  nodeType,
  parseManifestBytes,
  type PreparedNode,
} from './manifest.js';

export type ImportResult = {
  schemaVersion: 1;
  projectId: string;
  sources: number;
  nodes: number;
  edges: number;
  digest: string;
};

export async function importPreparedProject(
  rawBytes: Uint8Array,
  store: GraphStore,
): Promise<ImportResult> {
  const manifest = parseManifestBytes(rawBytes);
  const digest = `sha256:${createHash('sha256').update(rawBytes).digest('hex')}`;
  return store.transaction(async (tx) => {
    const project = await tx.createProject({
      id: manifest.project.id,
      name: manifest.project.name,
    });
    const sourceIds = new Map<string, string>();
    for (const prepared of manifest.sources) {
      const source = await tx.createSource(project.id, {
        kind: prepared.kind,
        uri: prepared.uri,
        label: prepared.label,
        excerpt: prepared.excerpt,
        revisionRef: prepared.kind === 'repository' ? digest : null,
      });
      sourceIds.set(prepared.key, source.id);
    }
    const preparedNodes: PreparedNode[] = [
      ...manifest.components.map((node) => ({ ...node, category: 'component' as const })),
      ...manifest.files.map((node) => ({ ...node, category: 'file' as const })),
      ...manifest.claims.map((node) => ({ ...node, category: 'claim' as const })),
    ];
    const nodeIds = new Map<string, string>();
    for (const prepared of preparedNodes) {
      const source = manifest.sources.find((item) => item.key === prepared.sourceKey)!;
      const node = await tx.createNode(project.id, {
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
      nodeIds.set(prepared.key, node.id);
    }
    let edgeCount = 0;
    const structural = [
      ...manifest.components
        .filter((item) => item.parentKey)
        .map((item) => ({ from: item.parentKey!, to: item.key, sourceKey: item.sourceKey })),
      ...manifest.files.map((item) => ({
        from: item.componentKey,
        to: item.key,
        sourceKey: item.sourceKey,
      })),
    ];
    for (const edge of structural) {
      const source = manifest.sources.find((item) => item.key === edge.sourceKey)!;
      await tx.createEdge(project.id, {
        fromNodeId: nodeIds.get(edge.from)!,
        toNodeId: nodeIds.get(edge.to)!,
        type: 'CONTAINS',
        authority: 'canonical',
        sourceId: sourceIds.get(source.key)!,
        actor: actorFor(source),
      });
      edgeCount += 1;
    }
    for (const edge of manifest.edges) {
      const source = manifest.sources.find((item) => item.key === edge.sourceKey)!;
      await tx.createEdge(project.id, {
        fromNodeId: nodeIds.get(edge.fromKey)!,
        toNodeId: nodeIds.get(edge.toKey)!,
        type: edge.type,
        authority: authorityFor(source.kind),
        sourceId: sourceIds.get(source.key)!,
        actor: actorFor(source),
      });
      edgeCount += 1;
    }
    return {
      schemaVersion: 1,
      projectId: project.id,
      sources: manifest.sources.length,
      nodes: preparedNodes.length,
      edges: edgeCount,
      digest,
    };
  });
}

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { graphError } from '../context/errors';
import {
  AUTHORITIES,
  EDGE_TYPES,
  NODE_TYPES,
  type Actor,
  type ContextEdge,
  type ContextNode,
  type CreateNodeInput,
  type GraphStore,
} from '../context/types';

export const DEFAULT_OPERATOR_LABEL = 'local-operator';

/**
 * Every workbench/CLI write is attributed to the human operator running the process; payloads
 * cannot choose it. On a shared database, OPERATOR_LABEL distinguishes teammates. The label is
 * attribution, not authentication.
 */
export function operatorActor(env: Record<string, string | undefined> = process.env): Actor {
  const label = env.OPERATOR_LABEL?.trim().slice(0, 120);
  return { kind: 'human', label: label || DEFAULT_OPERATOR_LABEL };
}

const operatorEvidence = {
  evidenceNote: z.string().min(1).max(20_000),
  changeReason: z.string().min(1).max(500),
};

export const createNodeRequestSchema = z
  .object({
    ...operatorEvidence,
    node: z
      .object({
        type: z.enum(NODE_TYPES),
        title: z.string(),
        content: z.string(),
        summary: z.string().optional(),
        authority: z.enum(AUTHORITIES),
        importance: z.number().optional(),
        confidence: z.number().optional(),
        externalKey: z.string().nullable().optional(),
        path: z.string().nullable().optional(),
      })
      .strict(),
    edge: z
      .object({
        otherNodeId: z.string().uuid(),
        type: z.enum(EDGE_TYPES),
        direction: z.enum(['outgoing', 'incoming']),
        authority: z.enum(AUTHORITIES),
      })
      .strict()
      .optional(),
  })
  .strict();

export const reviseNodeRequestSchema = z
  .object({
    ...operatorEvidence,
    expectedVersion: z.number().int().min(1),
    snapshot: z
      .object({
        title: z.string(),
        content: z.string(),
        summary: z.string(),
        authority: z.enum(AUTHORITIES),
        importance: z.number(),
        confidence: z.number(),
        archived: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type CreateNodeRequest = z.infer<typeof createNodeRequestSchema>;
export type ReviseNodeRequest = z.infer<typeof reviseNodeRequestSchema>;

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw graphError('VALIDATION_ERROR', 'Input validation failed', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

export const parseCreateNodeRequest = (input: unknown): CreateNodeRequest =>
  parse(createNodeRequestSchema, input);
export const parseReviseNodeRequest = (input: unknown): ReviseNodeRequest =>
  parse(reviseNodeRequestSchema, input);

const manualSource = (evidenceNote: string) => ({
  kind: 'manual' as const,
  uri: `manual://workbench/${randomUUID()}`,
  label: 'Workbench operator note',
  excerpt: evidenceNote,
  revisionRef: null,
});

/** One transaction: fresh manual source, node, and (optionally) a single edge to an existing node. */
export async function createOperatorNode(
  store: GraphStore,
  projectId: string,
  raw: unknown,
): Promise<{ node: ContextNode; edge: ContextEdge | null }> {
  const req = parseCreateNodeRequest(raw);
  return store.transaction(async (tx) => {
    const source = await tx.createSource(projectId, manualSource(req.evidenceNote));
    // Drop undefined optionals so the store's strict schema sees only provided keys.
    const provided = Object.fromEntries(
      Object.entries(req.node).filter(([, value]) => value !== undefined),
    ) as CreateNodeRequest['node'];
    const node = await tx.createNode(projectId, {
      ...(provided as CreateNodeInput),
      sourceId: source.id,
      actor: operatorActor(),
      changeReason: req.changeReason,
    });
    let edge: ContextEdge | null = null;
    if (req.edge) {
      const outgoing = req.edge.direction === 'outgoing';
      edge = await tx.createEdge(projectId, {
        fromNodeId: outgoing ? node.id : req.edge.otherNodeId,
        toNodeId: outgoing ? req.edge.otherNodeId : node.id,
        type: req.edge.type,
        authority: req.edge.authority,
        sourceId: source.id,
        actor: operatorActor(),
      });
    }
    return { node, edge };
  });
}

/** One transaction: fresh manual source, then a new revision pointing at it. */
export async function reviseOperatorNode(
  store: GraphStore,
  projectId: string,
  nodeId: string,
  raw: unknown,
): Promise<{ node: ContextNode; changed: boolean }> {
  const req = parseReviseNodeRequest(raw);
  return store.transaction(async (tx) => {
    const source = await tx.createSource(projectId, manualSource(req.evidenceNote));
    return tx.reviseNode(projectId, nodeId, {
      expectedVersion: req.expectedVersion,
      snapshot: { ...req.snapshot, sourceId: source.id },
      actor: operatorActor(),
      changeReason: req.changeReason,
    });
  });
}

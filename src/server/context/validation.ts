import { z } from 'zod';
import { graphError, GraphError } from './errors';
import {
  ACTOR_KINDS,
  AUTHORITIES,
  EDGE_TYPES,
  NODE_TYPES,
  SOURCE_KINDS,
  type ContextNode,
  type CreateEdgeInput,
  type CreateNodeInput,
  type ReviseNodeInput,
  type SourceInput,
} from './types';

const cpLength = (value: string) => Array.from(value).length;
const noNul = (value: string) => !value.includes('\0');
const trimmed = (max: number) =>
  z
    .string()
    .refine(noNul, 'must not contain NUL')
    .transform((value) => value.trim())
    .refine((value) => cpLength(value) >= 1, 'must not be blank')
    .refine((value) => cpLength(value) <= max, `must be at most ${max} characters`);
const preserved = (max: number, nonblank = false) =>
  z
    .string()
    .refine(noNul, 'must not contain NUL')
    .refine((value) => cpLength(value) <= max, `must be at most ${max} characters`)
    .refine((value) => !nonblank || value.trim().length > 0, 'must not be blank');

const actorSchema = z
  .object({
    kind: z.enum(ACTOR_KINDS),
    label: trimmed(120),
  })
  .strict();

const uriSchema = trimmed(2048).superRefine((value, ctx) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'must be a valid URI' });
    return;
  }
  if (!['https:', 'repo:', 'manual:', 'agent:'].includes(url.protocol)) {
    ctx.addIssue({ code: 'custom', message: 'unsupported URI scheme' });
  }
  if (url.username || url.password)
    ctx.addIssue({ code: 'custom', message: 'credentials are forbidden' });
});

export const sourceInputSchema = z
  .object({
    kind: z.enum(SOURCE_KINDS),
    uri: uriSchema,
    label: trimmed(200),
    excerpt: preserved(20_000),
    revisionRef: z.union([trimmed(200), z.null()]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === 'repository' && value.revisionRef === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['revisionRef'],
        message: 'repository evidence requires revisionRef',
      });
    }
    if (value.kind !== 'repository' && value.revisionRef !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['revisionRef'],
        message: 'only repository evidence has revisionRef',
      });
    }
    if (value.kind !== 'repository' && value.excerpt.trim().length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['excerpt'],
        message: 'manual/agent excerpt must not be blank',
      });
    }
  });

const pathSchema = preserved(500, true).superRefine((value, ctx) => {
  const segments = value.split('/');
  if (
    value !== value.trim() ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('\\') ||
    /^[A-Za-z]:/.test(value) ||
    segments.some((part) => part === '' || part === '.' || part === '..')
  ) {
    ctx.addIssue({ code: 'custom', message: 'must be a relative normalized POSIX path' });
  }
});

export const nodeSnapshotSchema = z
  .object({
    title: trimmed(200),
    content: preserved(20_000, true),
    summary: preserved(1_000),
    authority: z.enum(AUTHORITIES),
    importance: z.number().int().min(1).max(5),
    confidence: z.number().finite().min(0).max(1),
    archived: z.boolean(),
    sourceId: z.string().uuid(),
  })
  .strict();

export const createNodeSchema = z
  .object({
    type: z.enum(NODE_TYPES),
    externalKey: z
      .union([trimmed(200), z.null()])
      .optional()
      .default(null),
    path: z.union([pathSchema, z.null()]).optional().default(null),
    title: trimmed(200),
    content: preserved(20_000, true),
    summary: preserved(1_000).optional().default(''),
    authority: z.enum(AUTHORITIES),
    importance: z.number().int().min(1).max(5).optional().default(3),
    confidence: z.number().finite().min(0).max(1).optional(),
    sourceId: z.string().uuid(),
    actor: actorSchema,
    changeReason: trimmed(500),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.type === 'file' && value.path === null) {
      ctx.addIssue({ code: 'custom', path: ['path'], message: 'file requires path' });
    }
    if (value.type !== 'file' && value.path !== null) {
      ctx.addIssue({ code: 'custom', path: ['path'], message: 'only file may have path' });
    }
  });

export const reviseNodeSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    snapshot: nodeSnapshotSchema,
    actor: actorSchema,
    changeReason: trimmed(500),
  })
  .strict();

export const createEdgeSchema = z
  .object({
    fromNodeId: z.string().uuid(),
    toNodeId: z.string().uuid(),
    type: z.enum(EDGE_TYPES),
    authority: z.enum(AUTHORITIES),
    sourceId: z.string().uuid(),
    actor: actorSchema,
  })
  .strict()
  .refine((value) => value.fromNodeId !== value.toNodeId, {
    message: 'self edges are forbidden',
    path: ['toNodeId'],
  });

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

export const parseProjectInput = (input: unknown) =>
  parse(
    z
      .object({
        id: z.string().uuid().optional(),
        name: trimmed(120),
      })
      .strict(),
    input,
  );
export const parseSourceInput = (input: unknown): SourceInput => parse(sourceInputSchema, input);
export const parseCreateNode = (input: unknown): Required<CreateNodeInput> => {
  const value = parse(createNodeSchema, input);
  return { ...value, confidence: value.confidence ?? (value.authority === 'canonical' ? 1 : 0.5) };
};
export const parseRevision = (input: unknown): ReviseNodeInput => parse(reviseNodeSchema, input);
export const parseCreateEdge = (input: unknown): CreateEdgeInput => parse(createEdgeSchema, input);
export const parseUuid = (value: unknown, field = 'id'): string => {
  const result = z.string().uuid().safeParse(value);
  if (!result.success) throw graphError('VALIDATION_ERROR', `${field} must be a UUID`, { field });
  return result.data;
};
export const parseVersion = (value: unknown): number => parse(z.number().int().min(1), value);

export function authorizeCreateNode(input: Required<CreateNodeInput>, sourceKind: string): void {
  const { actor, authority, type } = input;
  const ok =
    actor.kind === 'human'
      ? sourceKind === 'manual'
      : actor.kind === 'agent'
        ? authority === 'inferred' && sourceKind === 'agent'
        : authority === 'canonical' &&
          sourceKind === 'repository' &&
          ['file', 'component'].includes(type);
  if (!ok)
    throw graphError(
      'AUTHORITY_VIOLATION',
      'Actor, authority, node type, and evidence do not permit this write',
    );
}

export function authorizeRevision(
  current: ContextNode,
  input: ReviseNodeInput,
  sourceKind: string,
): void {
  const next = input.snapshot;
  let ok = input.actor.kind === 'human' && sourceKind === 'manual';
  if (input.actor.kind === 'agent') {
    ok =
      current.current.authority === 'inferred' &&
      next.authority === 'inferred' &&
      sourceKind === 'agent' &&
      next.archived === current.current.archived;
  }
  if (input.actor.kind === 'importer') {
    ok =
      ['file', 'component'].includes(current.type) &&
      current.current.authority === 'canonical' &&
      next.authority === 'canonical' &&
      sourceKind === 'repository' &&
      next.archived === current.current.archived;
  }
  if (!ok) throw graphError('AUTHORITY_VIOLATION', 'Actor cannot make this revision');
}

export function authorizeEdge(
  input: CreateEdgeInput,
  sourceKind: string,
  from: ContextNode,
  to: ContextNode,
): void {
  let ok = input.actor.kind === 'human' && sourceKind === 'manual';
  if (input.actor.kind === 'agent') ok = input.authority === 'inferred' && sourceKind === 'agent';
  if (input.actor.kind === 'importer') {
    ok =
      input.authority === 'canonical' &&
      sourceKind === 'repository' &&
      input.type === 'CONTAINS' &&
      from.type === 'component' &&
      ['component', 'file'].includes(to.type);
  }
  if (!ok) throw graphError('AUTHORITY_VIOLATION', 'Actor cannot create this edge');
}

export const isGraphError = (error: unknown): error is GraphError => error instanceof GraphError;

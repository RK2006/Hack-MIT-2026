import { z } from 'zod';
import { graphError } from '../context/errors';
import type { GraphSnapshot } from '../context/types';
import type { ProposalPrompt } from './model';

export const PROPOSAL_LIMITS = {
  textMax: 20_000,
  maxNodes: 8,
  maxEdges: 12,
  maxConfidence: 0.7,
  excerptMax: 2_000,
} as const;

export const PROPOSAL_NODE_TYPES = [
  'decision',
  'constraint',
  'assumption',
  'discovery',
  'bug',
] as const;
export const PROPOSAL_EDGE_TYPES = [
  'DEPENDS_ON',
  'IMPLEMENTS',
  'REQUIRES',
  'CONSTRAINS',
  'AFFECTS',
  'CAUSED_BY',
  'RELATED_TO',
] as const;

const slug = z.string().regex(/^[a-z][a-z0-9-]{2,40}$/);

/** Models often emit `Snake_Case` or dotted keys; normalize to the slug form instead of rejecting. */
export function normalizeKey(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 41);
  return /^[a-z]/.test(cleaned) ? cleaned : `k-${cleaned}`.slice(0, 41);
}

/** Edge endpoints may be proposed keys (normalized) or existing external keys (kept verbatim). */
function normalizeRef(raw: string): string {
  const trimmed = raw.trim();
  return /^[a-z][a-z0-9._-]*$/.test(trimmed) && trimmed.includes('.')
    ? trimmed
    : normalizeKey(trimmed);
}

export const modelProposalSchema = z
  .object({
    nodes: z
      .array(
        z
          .object({
            key: z.string().transform(normalizeKey).pipe(slug),
            type: z.enum(PROPOSAL_NODE_TYPES),
            title: z.string().trim().min(1).max(200),
            content: z.string().trim().min(1).max(4000),
            summary: z.string().trim().max(300).default(''),
            importance: z.number().int().min(1).max(5),
            confidence: z.number().min(0).max(1),
          })
          .strict(),
      )
      .max(PROPOSAL_LIMITS.maxNodes),
    edges: z
      .array(
        z
          .object({
            fromKey: z.string().transform(normalizeRef),
            toKey: z.string().transform(normalizeRef),
            type: z.enum(PROPOSAL_EDGE_TYPES),
          })
          .strict(),
      )
      .max(PROPOSAL_LIMITS.maxEdges),
  })
  .strict();

export type ModelProposal = z.infer<typeof modelProposalSchema>;

export function buildProposalPrompt(
  graph: GraphSnapshot,
  request: { text: string; taskHint?: string },
): ProposalPrompt {
  const existing = graph.nodes
    .map((node) => `${node.externalKey ?? node.id} | ${node.type} | ${node.current.title}`)
    .join('\n');
  const system = [
    'You extract durable engineering knowledge from notes about completed software work.',
    'Return ONLY a JSON object, no prose, matching exactly:',
    '{"nodes":[{"key":"short-slug","type":"decision|constraint|assumption|discovery|bug","title":"...","content":"...","summary":"...","importance":1-5,"confidence":0-1}],"edges":[{"fromKey":"...","toKey":"...","type":"DEPENDS_ON|IMPLEMENTS|REQUIRES|CONSTRAINS|AFFECTS|CAUSED_BY|RELATED_TO"}]}',
    `Rules: at most ${PROPOSAL_LIMITS.maxNodes} nodes and ${PROPOSAL_LIMITS.maxEdges} edges; every claim must be supported by the input text;`,
    'do not restate code line by line; prefer decisions, constraints, discovered facts, and bugs;',
    'keys are lowercase slugs unique in your response; edge endpoints are your keys or existing node keys from the list;',
    'edge direction follows the type: A DEPENDS_ON B, A REQUIRES B, A CONSTRAINS B (A limits B), A IMPLEMENTS B, A AFFECTS B, A CAUSED_BY B (B causes A).',
    'If nothing durable is present, return {"nodes":[],"edges":[]}.',
  ].join('\n');
  const user = [
    request.taskHint ? `Task that produced these notes: ${request.taskHint}\n` : '',
    'Existing project nodes (key | type | title):',
    existing || '(none)',
    '',
    'Input text:',
    request.text,
  ].join('\n');
  return { system, user };
}

/** Strict parse of model output; tolerates a surrounding ```json fence only. */
export function parseModelProposal(raw: string): ModelProposal {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const body = fenced ? fenced[1]! : trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw graphError('VALIDATION_ERROR', 'Proposal model did not return JSON', { path: '$' });
  }
  const result = modelProposalSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw graphError('VALIDATION_ERROR', 'Proposal model output failed validation', {
      path: `$.${issue?.path.join('.') ?? ''}`,
      reason: issue?.message ?? 'invalid',
    });
  }
  const keys = new Set<string>();
  for (const node of result.data.nodes) {
    if (keys.has(node.key))
      throw graphError('VALIDATION_ERROR', 'Duplicate proposed node key', {
        path: `$.nodes.${node.key}`,
      });
    keys.add(node.key);
  }
  return result.data;
}

import { graphError } from '../server/context/errors';
import type { ContextNode } from '../server/context/types';

export const SHORT_ID_LENGTH = 8;
const HEX_PREFIX = /^[0-9a-f]{8,}$/i;

export const shortId = (id: string) => id.slice(0, SHORT_ID_LENGTH);

/**
 * Resolves a user-typed reference to exactly one node. Accepted forms, in order:
 * a UUID prefix of at least eight hex characters (dashes ignored), an exact externalKey,
 * or an exact path. Ambiguity lists the candidates instead of guessing.
 */
export function resolveNodeRef(ref: string, nodes: ContextNode[]): ContextNode {
  const trimmed = ref.trim();
  if (!trimmed) throw graphError('VALIDATION_ERROR', 'Node reference must not be empty');

  const exact = nodes.filter((node) => node.externalKey === trimmed || node.path === trimmed);
  if (exact.length === 1) return exact[0]!;

  const compact = trimmed.replaceAll('-', '');
  const byPrefix = HEX_PREFIX.test(compact)
    ? nodes.filter((node) => node.id.replaceAll('-', '').startsWith(compact.toLowerCase()))
    : [];
  const matches = exact.length > 0 ? exact : byPrefix;

  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) {
    throw graphError('NOT_FOUND', `No node matches "${trimmed}"`, {
      ref: trimmed,
      hint: 'Use a UUID prefix of at least 8 hex characters, an external key, or a path',
    });
  }
  throw graphError('VALIDATION_ERROR', `"${trimmed}" matches ${matches.length} nodes`, {
    ref: trimmed,
    candidates: matches.map((node) => ({
      id: node.id,
      title: node.current.title,
      externalKey: node.externalKey,
      path: node.path,
    })),
  });
}

export const resolveNodeRefs = (refs: string[], nodes: ContextNode[]) =>
  refs.map((ref) => resolveNodeRef(ref, nodes));

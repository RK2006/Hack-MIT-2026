import type { ContextNode } from '@/server/context/types';

/**
 * A node is pending review when its current revision is inferred and was written by an agent:
 * no human has touched it yet. A human revision (even one that keeps it inferred) removes it
 * from the queue because the actor becomes `human`.
 */
export function isPendingReview(node: ContextNode): boolean {
  return (
    !node.current.archived &&
    node.current.authority === 'inferred' &&
    node.current.actor.kind === 'agent'
  );
}

/** Newest proposals first; ties broken by node id for a stable order. */
export function pendingReview(nodes: ContextNode[]): ContextNode[] {
  return nodes
    .filter(isPendingReview)
    .sort(
      (a, b) => b.current.createdAt.localeCompare(a.current.createdAt) || (a.id < b.id ? -1 : 1),
    );
}

export const ACCEPT_DEFAULTS = {
  changeReason: 'Accepted agent proposal as stated',
  evidenceNote:
    'Operator reviewed the agent proposal and its evidence and accepted it as canonical.',
} as const;

export const REJECT_DEFAULTS = {
  changeReason: 'Rejected agent proposal',
  evidenceNote:
    'Operator reviewed the agent proposal and archived it as not durable or not accurate.',
} as const;

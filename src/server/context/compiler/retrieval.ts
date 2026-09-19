import type {
  Authority,
  ContextEdge,
  ContextNode,
  EdgeType,
  GraphSnapshot,
  NodeType,
} from '../types';
import type { Omission, PathStep, SelectionReason } from './types';

export const MAX_SEMANTIC_SEEDS = 5;
export const MAX_CANDIDATES = 40;
export const ELIGIBILITY_FLOOR = 0.25;
export const HUB_CONTAINS_FANOUT = 5;
export const SEMANTIC_BONUS = 0.15;
export const AUTHORITY_FACTOR: Record<Authority, number> = { canonical: 1, inferred: 0.8 };
export const TYPE_FACTOR: Record<NodeType, number> = {
  constraint: 1.1,
  decision: 1.05,
  bug: 1,
  component: 1,
  discovery: 0.95,
  file: 0.95,
  assumption: 0.9,
};
export const EDGE_WEIGHTS: Record<EdgeType, { forward: number; reverse: number }> = {
  REQUIRES: { forward: 1, reverse: 0.6 },
  CONSTRAINS: { forward: 0.6, reverse: 1 },
  DEPENDS_ON: { forward: 0.9, reverse: 0.5 },
  IMPLEMENTS: { forward: 0.9, reverse: 0.9 },
  AFFECTS: { forward: 0.6, reverse: 0.8 },
  CAUSED_BY: { forward: 0.8, reverse: 0.5 },
  RELATED_TO: { forward: 0.5, reverse: 0.5 },
  CONTAINS: { forward: 0.3, reverse: 0.4 },
};

export type SimilarityMode = 'semantic' | 'lexical';

export type RetrievalInput = {
  graph: GraphSnapshot;
  task: string;
  /** Raw similarity per node id, clamped to [0, 1]. */
  similarity: Map<string, number>;
  minSeedSimilarity: number;
  mode: SimilarityMode;
  startNodeIds: string[];
  maxDepth: number;
};

export type Candidate = {
  node: ContextNode;
  relevance: number;
  score: number;
  similarity: number;
  semanticNorm: number;
  reasons: SelectionReason[];
  essential: boolean;
};

export type RetrievalResult = {
  seeds: string[];
  candidates: Candidate[];
  omissions: Omission[];
};

type Seed = { nodeId: string; relevance: number; reasons: SelectionReason[] };

function explicitSeeds(
  input: RetrievalInput,
  similarityOf: (id: string) => number,
): Map<string, SelectionReason[]> {
  const task = input.task.toLowerCase();
  const reasons = new Map<string, SelectionReason[]>();
  const add = (node: ContextNode, description: string) => {
    const list = reasons.get(node.id) ?? [];
    list.push({
      kind: 'explicit_reference',
      description,
      seedNodeId: node.id,
      similarity: similarityOf(node.id),
      path: [],
    });
    reasons.set(node.id, list);
  };
  const starts = new Set(input.startNodeIds);
  for (const node of input.graph.nodes) {
    if (starts.has(node.id)) add(node, 'requested as a starting node');
    if (node.path && mentions(task, node.path, 1)) add(node, `task mentions path ${node.path}`);
    if (node.externalKey && mentions(task, node.externalKey, EXPLICIT_MENTION_MIN_LENGTH))
      add(node, `task mentions key ${node.externalKey}`);
    if (mentions(task, node.current.title, EXPLICIT_MENTION_MIN_LENGTH))
      add(node, `task mentions "${node.current.title}"`);
  }
  return reasons;
}

export const EXPLICIT_MENTION_MIN_LENGTH = 8;
const isWordChar = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}_]/u.test(char);

/** Whole-token, case-insensitive mention: the needle must not be embedded inside a longer word. */
export function mentions(lowerTask: string, needle: string, minLength: number): boolean {
  const lowered = needle.toLowerCase();
  if (Array.from(lowered).length < minLength) return false;
  let index = lowerTask.indexOf(lowered);
  while (index !== -1) {
    const before = lowerTask[index - 1];
    const after = lowerTask[index + lowered.length];
    const startsWord = isWordChar(lowered[0]);
    const endsWord = isWordChar(lowered[lowered.length - 1]);
    if ((!startsWord || !isWordChar(before)) && (!endsWord || !isWordChar(after))) return true;
    index = lowerTask.indexOf(lowered, index + 1);
  }
  return false;
}

function describePath(path: PathStep[], seedTitle: string, byId: Map<string, ContextNode>): string {
  const hops =
    path.length === 1 ? 'one hop' : path.length === 2 ? 'two hops' : `${path.length} hops`;
  const steps = path
    .map((step) => {
      const target = byId.get(step.traversed === 'forward' ? step.toNodeId : step.fromNodeId);
      const arrow = step.traversed === 'forward' ? `→ ${step.type} →` : `← ${step.type} ←`;
      return `${arrow} "${target?.current.title ?? step.toNodeId}" (${step.authority})`;
    })
    .join(' ');
  return `${hops} from "${seedTitle}" ${steps}`;
}

export function retrieve(input: RetrievalInput): RetrievalResult {
  const { graph, maxDepth } = input;
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const similarityOf = (id: string) => input.similarity.get(id) ?? 0;
  const sMax = Math.max(0, ...graph.nodes.map((node) => similarityOf(node.id)));
  const semanticNorm = (id: string) => (sMax > 0 ? similarityOf(id) / sMax : 0);
  const matchKind = input.mode === 'semantic' ? 'semantic_match' : 'lexical_match';

  const seeds = new Map<string, Seed>();
  const explicit = explicitSeeds(input, similarityOf);
  for (const [nodeId, reasons] of explicit) seeds.set(nodeId, { nodeId, relevance: 1, reasons });
  const semantic = graph.nodes
    .filter((node) => similarityOf(node.id) >= input.minSeedSimilarity)
    .sort((a, b) => similarityOf(b.id) - similarityOf(a.id) || (a.id < b.id ? -1 : 1))
    .slice(0, MAX_SEMANTIC_SEEDS);
  for (const node of semantic) {
    const reason: SelectionReason = {
      kind: matchKind,
      description: `${input.mode} match to the task (similarity ${similarityOf(node.id).toFixed(2)})`,
      seedNodeId: node.id,
      similarity: similarityOf(node.id),
      path: [],
    };
    const existing = seeds.get(node.id);
    if (existing) existing.reasons.push(reason);
    else
      seeds.set(node.id, { nodeId: node.id, relevance: semanticNorm(node.id), reasons: [reason] });
  }

  // Adjacency with actual stored direction retained on every step.
  const adjacency = new Map<
    string,
    Array<{ edge: ContextEdge; neighbor: string; traversed: 'forward' | 'reverse' }>
  >();
  const containsFanout = new Map<string, number>();
  for (const edge of graph.edges) {
    adjacency.set(edge.fromNodeId, [
      ...(adjacency.get(edge.fromNodeId) ?? []),
      { edge, neighbor: edge.toNodeId, traversed: 'forward' },
    ]);
    adjacency.set(edge.toNodeId, [
      ...(adjacency.get(edge.toNodeId) ?? []),
      { edge, neighbor: edge.fromNodeId, traversed: 'reverse' },
    ]);
    if (edge.type === 'CONTAINS')
      containsFanout.set(edge.fromNodeId, (containsFanout.get(edge.fromNodeId) ?? 0) + 1);
  }

  type Reached = { relevance: number; seedId: string; path: PathStep[]; depth: number };
  const reached = new Map<string, Reached>();
  for (const seed of seeds.values())
    reached.set(seed.nodeId, {
      relevance: seed.relevance,
      seedId: seed.nodeId,
      path: [],
      depth: 0,
    });

  const visited = new Set<string>();
  let frontier = [...seeds.values()].map((seed) => seed.nodeId);
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    frontier.sort(
      (a, b) => reached.get(b)!.relevance - reached.get(a)!.relevance || (a < b ? -1 : 1),
    );
    const next: string[] = [];
    for (const nodeId of frontier) {
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      const current = reached.get(nodeId)!;
      if (current.relevance < ELIGIBILITY_FLOOR) continue;
      // A seed re-parented onto a longer path must not propagate paths beyond maxDepth.
      if (current.path.length + 1 > maxDepth) continue;
      for (const { edge, neighbor, traversed } of adjacency.get(nodeId) ?? []) {
        if (
          edge.type === 'CONTAINS' &&
          traversed === 'forward' &&
          (containsFanout.get(nodeId) ?? 0) > HUB_CONTAINS_FANOUT
        )
          continue;
        if (!byId.has(neighbor)) continue;
        const relevance = current.relevance * EDGE_WEIGHTS[edge.type][traversed];
        const step: PathStep = {
          edgeId: edge.id,
          fromNodeId: edge.fromNodeId,
          toNodeId: edge.toNodeId,
          traversed,
          type: edge.type,
          authority: edge.authority,
        };
        const previous = reached.get(neighbor);
        if (!previous || relevance > previous.relevance + 1e-12) {
          reached.set(neighbor, {
            relevance,
            seedId: current.seedId,
            path: [...current.path, step],
            depth: depth + 1,
          });
        }
        if (!visited.has(neighbor) && !next.includes(neighbor)) next.push(neighbor);
      }
    }
    frontier = next;
  }

  const candidates: Candidate[] = [];
  for (const [nodeId, info] of reached) {
    const node = byId.get(nodeId);
    if (!node || info.relevance < ELIGIBILITY_FLOOR) continue;
    const reasons: SelectionReason[] = [...(seeds.get(nodeId)?.reasons ?? [])];
    if (info.path.length > 0) {
      const seedNode = byId.get(info.seedId)!;
      reasons.push({
        kind: 'graph_neighbor',
        description: describePath(info.path, seedNode.current.title, byId),
        seedNodeId: info.seedId,
        similarity: null,
        path: info.path,
      });
    }
    if (
      similarityOf(nodeId) >= input.minSeedSimilarity &&
      !reasons.some((r) => r.kind === matchKind)
    ) {
      reasons.push({
        kind: matchKind,
        description: `${input.mode} match to the task (similarity ${similarityOf(nodeId).toFixed(2)})`,
        seedNodeId: nodeId,
        similarity: similarityOf(nodeId),
        path: [],
      });
    }
    const { authority, importance, confidence } = node.current;
    const score =
      info.relevance *
        AUTHORITY_FACTOR[authority] *
        (0.7 + 0.06 * importance) *
        (0.7 + 0.3 * confidence) *
        TYPE_FACTOR[node.type] +
      SEMANTIC_BONUS * semanticNorm(nodeId);
    candidates.push({
      node,
      relevance: info.relevance,
      score,
      similarity: similarityOf(nodeId),
      semanticNorm: semanticNorm(nodeId),
      reasons,
      essential: node.type === 'constraint' && importance >= 4 && info.relevance >= 0.5,
    });
  }
  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      (a.node.current.authority === b.node.current.authority
        ? 0
        : a.node.current.authority === 'canonical'
          ? -1
          : 1) ||
      b.node.current.importance - a.node.current.importance ||
      (a.node.id < b.node.id ? -1 : 1),
  );
  const kept = candidates.slice(0, MAX_CANDIDATES);
  const omissions: Omission[] = candidates.slice(MAX_CANDIDATES).map((candidate) => ({
    nodeId: candidate.node.id,
    version: candidate.node.current.version,
    title: candidate.node.current.title,
    reason: 'candidate_limit',
    critical: candidate.essential,
  }));
  return { seeds: [...seeds.keys()].sort(), candidates: kept, omissions };
}

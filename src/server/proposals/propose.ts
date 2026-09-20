import { randomUUID } from 'node:crypto';
import { GraphError, graphError } from '../context/errors';
import type { EdgeType, GraphStore, NodeType } from '../context/types';
import type { ProposalModel } from './model';
import {
  buildProposalPrompt,
  normalizeKey,
  parseModelProposal,
  PROPOSAL_LIMITS,
  quoteAppearsIn,
} from './prompt';

export type { ProposalModel } from './model';

export type ProposalRequest = {
  text: string;
  taskHint?: string | undefined;
  /** Where the text came from (e.g. a pull request); the source kind stays `agent` because an LLM extracted the claims. */
  source?: { uri: string; label: string } | undefined;
};

export type ProposalResult = {
  projectId: string;
  model: string;
  sourceId: string | null;
  created: {
    nodes: Array<{
      nodeId: string;
      externalKey: string;
      type: NodeType;
      title: string;
      /** The verbatim input quote recorded as this node's evidence. */
      evidence: string;
    }>;
    edges: Array<{ edgeId: string; from: string; to: string; type: EdgeType }>;
  };
  dropped: Array<{ kind: 'node' | 'edge'; reason: string; ref: string }>;
};

export type ProposalDeps = {
  store: GraphStore;
  model: ProposalModel;
  log?: (event: {
    operation: 'proposeContext';
    model: string;
    durationMs: number;
    created: number;
    dropped: number;
  }) => void;
};

const codePoints = (text: string) => Array.from(text).length;

/**
 * One model call → validated proposal → one transaction writing inferred nodes/edges with an
 * agent source. Nothing here can create or modify canonical knowledge (enforced by the store).
 */
export async function proposeContext(
  deps: ProposalDeps,
  projectId: string,
  request: ProposalRequest,
): Promise<ProposalResult> {
  const started = Date.now();
  const text = request.text ?? '';
  if (
    typeof text !== 'string' ||
    codePoints(text.trim()) < 1 ||
    codePoints(text) > PROPOSAL_LIMITS.textMax
  ) {
    throw graphError('VALIDATION_ERROR', `text must be 1..${PROPOSAL_LIMITS.textMax} characters`, {
      field: 'text',
    });
  }
  if (request.taskHint !== undefined && codePoints(request.taskHint) > 500) {
    throw graphError('VALIDATION_ERROR', 'taskHint must be at most 500 characters', {
      field: 'taskHint',
    });
  }
  const graph = await deps.store.getGraph(projectId);
  const completion = await deps.model.complete(
    buildProposalPrompt(graph, {
      text,
      ...(request.taskHint !== undefined && { taskHint: request.taskHint }),
    }),
  );
  // Provenance names the model that actually answered, not merely the configured one.
  const modelId = completion.model;
  const proposal = parseModelProposal(completion.text);
  const dropped: ProposalResult['dropped'] = [];
  const empty: ProposalResult = {
    projectId,
    model: modelId,
    sourceId: null,
    created: { nodes: [], edges: [] },
    dropped,
  };
  if (proposal.nodes.length === 0) {
    for (const edge of proposal.edges)
      dropped.push({
        kind: 'edge',
        reason: 'no proposed nodes',
        ref: `${edge.fromKey}->${edge.toKey}`,
      });
    deps.log?.({
      operation: 'proposeContext',
      model: modelId,
      durationMs: Date.now() - started,
      created: 0,
      dropped: dropped.length,
    });
    return empty;
  }

  const existingByKey = new Map(
    graph.nodes.filter((node) => node.externalKey).map((node) => [node.externalKey!, node.id]),
  );
  // Proposed keys arrive slug-normalized, so compare against normalized existing keys.
  const existingNormalized = new Map(
    [...existingByKey.keys()].map((key) => [normalizeKey(key), key] as const),
  );
  const actor = { kind: 'agent' as const, label: modelId.slice(0, 120) };
  const excerpt = `[${modelId}] ${Array.from(text).slice(0, PROPOSAL_LIMITS.excerptMax).join('')}`;

  const result = await deps.store.transaction(async (tx) => {
    const source = await tx.createSource(projectId, {
      kind: 'agent',
      uri: request.source?.uri ?? `agent://proposals/${randomUUID()}`,
      label: (request.source?.label ?? `Agent proposal (${modelId})`).slice(0, 200),
      excerpt,
      revisionRef: null,
    });
    const created: ProposalResult['created'] = { nodes: [], edges: [] };
    const proposedIds = new Map<string, string>();
    for (const node of proposal.nodes) {
      // Re-proposing an existing node (repeat runs on the same notes) is a no-op, not a duplicate.
      const existingKey = existingNormalized.get(node.key);
      if (existingKey) {
        dropped.push({ kind: 'node', reason: 'already exists', ref: existingKey });
        continue;
      }
      // Grounding: a claim whose supporting quote is not in the input is discarded, not stored.
      if (!quoteAppearsIn(node.evidence, text)) {
        dropped.push({ kind: 'node', reason: 'evidence quote not found in input', ref: node.key });
        continue;
      }
      // One source per claim carrying the exact supporting quote; the batch source keeps the full input.
      const nodeSource = await tx.createSource(projectId, {
        kind: 'agent',
        uri: source.uri,
        label: `${source.label} — supporting quote`.slice(0, 200),
        excerpt: `[${modelId}] Supporting quote: "${node.evidence}"\n\nFull input recorded in source ${source.id}.`,
        revisionRef: null,
      });
      const externalKey = `agent.${node.key}-${randomUUID().slice(0, 8)}`;
      const createdNode = await tx.createNode(projectId, {
        type: node.type,
        externalKey,
        title: node.title,
        content: node.content,
        summary: node.summary,
        authority: 'inferred',
        importance: node.importance,
        confidence: Math.min(node.confidence, PROPOSAL_LIMITS.maxConfidence),
        sourceId: nodeSource.id,
        actor,
        changeReason: request.taskHint
          ? `Proposed by agent after: ${request.taskHint}`.slice(0, 500)
          : 'Proposed by agent from supplied notes',
      });
      proposedIds.set(node.key, createdNode.id);
      created.nodes.push({
        nodeId: createdNode.id,
        externalKey,
        type: node.type,
        title: node.title,
        evidence: node.evidence,
      });
    }
    const seen = new Set<string>();
    for (const edge of proposal.edges) {
      const ref = `${edge.fromKey} ${edge.type} ${edge.toKey}`;
      // Models sometimes cite their own node as `type.slug`; fall back to the normalized slug.
      const resolve = (key: string) =>
        proposedIds.get(key) ??
        existingByKey.get(key) ??
        proposedIds.get(normalizeKey(key)) ??
        proposedIds.get(normalizeKey(key.replace(/^[a-z]+\./, '')));
      const from = resolve(edge.fromKey);
      const to = resolve(edge.toKey);
      if (!from || !to) {
        dropped.push({ kind: 'edge', reason: 'unresolved endpoint key', ref });
        continue;
      }
      if (from === to) {
        dropped.push({ kind: 'edge', reason: 'self edge', ref });
        continue;
      }
      const proposedValues = new Set(proposedIds.values());
      if (!proposedValues.has(from) && !proposedValues.has(to)) {
        dropped.push({ kind: 'edge', reason: 'edge must touch a proposed node', ref });
        continue;
      }
      const identity = `${from}\0${to}\0${edge.type}`;
      if (seen.has(identity)) {
        dropped.push({ kind: 'edge', reason: 'duplicate edge', ref });
        continue;
      }
      seen.add(identity);
      try {
        // Edge validation happens through the store; a rejected edge is reported, not fatal.
        // The store's transaction marks itself failed on any error, so validate up front instead.
        if (
          graph.edges.some(
            (e) => e.fromNodeId === from && e.toNodeId === to && e.type === edge.type,
          )
        ) {
          dropped.push({ kind: 'edge', reason: 'edge already exists', ref });
          continue;
        }
        const createdEdge = await tx.createEdge(projectId, {
          fromNodeId: from,
          toNodeId: to,
          type: edge.type,
          authority: 'inferred',
          sourceId: source.id,
          actor,
        });
        created.edges.push({
          edgeId: createdEdge.id,
          from: edge.fromKey,
          to: edge.toKey,
          type: edge.type,
        });
      } catch (error) {
        if (error instanceof GraphError) throw error;
        throw graphError('STORAGE_ERROR', 'Proposal write failed');
      }
    }
    return { sourceId: source.id, created };
  });

  deps.log?.({
    operation: 'proposeContext',
    model: modelId,
    durationMs: Date.now() - started,
    created: result.created.nodes.length + result.created.edges.length,
    dropped: dropped.length,
  });
  return {
    projectId,
    model: modelId,
    sourceId: result.sourceId,
    created: result.created,
    dropped,
  };
}

import { describe, expect, it } from 'vitest';
import {
  ELIGIBILITY_FLOOR,
  MAX_CANDIDATES,
  retrieve,
  type RetrievalInput,
} from '../../src/server/context/compiler/retrieval';
import { makeEdge, makeGraph, makeNode, sims } from './fixture';

const base = (
  graph: RetrievalInput['graph'],
  similarity: Map<string, number>,
  extra: Partial<RetrievalInput> = {},
) =>
  retrieve({
    graph,
    task: 'Fix duplicate provider webhook processing',
    similarity,
    minSeedSimilarity: 0.25,
    mode: 'semantic',
    startNodeIds: [],
    maxDepth: 2,
    ...extra,
  });

describe('retrieval', () => {
  const webhooks = makeNode('component.webhooks', 'component', { title: 'Provider webhooks' });
  const store = makeNode('component.store', 'component', { title: 'Receipt store' });
  const constraint = makeNode('constraint.once', 'constraint', {
    title: 'Side effects once',
    importance: 5,
  });
  const decision = makeNode('decision.record', 'decision', { title: 'Record before side effects' });
  const bug = makeNode('bug.dup', 'bug', {
    title: 'Repeated delivery bug',
    authority: 'inferred',
    confidence: 0.6,
  });
  const assumption = makeNode('assumption.memory', 'assumption', {
    title: 'Memory dedupe',
    authority: 'inferred',
  });
  const catalog = makeNode('decision.catalog', 'decision', { title: 'Reindex catalog nightly' });
  const backend = makeNode('component.backend', 'component', { title: 'Backend' });
  const payments = makeNode('component.payments', 'component', { title: 'Payments' });
  const file = makeNode('file.handler', 'file', {
    title: 'Webhook handler',
    path: 'src/payments/webhook.ts',
  });
  const edges = [
    makeEdge(webhooks, constraint, 'REQUIRES'),
    makeEdge(webhooks, store, 'DEPENDS_ON'),
    makeEdge(decision, constraint, 'IMPLEMENTS'),
    makeEdge(bug, webhooks, 'AFFECTS', 'inferred'),
    makeEdge(bug, assumption, 'CAUSED_BY', 'inferred'),
    makeEdge(file, webhooks, 'IMPLEMENTS'),
    makeEdge(backend, payments, 'CONTAINS'),
    makeEdge(payments, webhooks, 'CONTAINS'),
    makeEdge(payments, store, 'CONTAINS'),
    makeEdge(backend, catalog, 'AFFECTS'),
  ];
  const graph = makeGraph(
    [webhooks, store, constraint, decision, bug, assumption, catalog, backend, payments, file],
    edges,
  );
  const similarity = sims([
    [webhooks, 0.6],
    [bug, 0.45],
    [catalog, 0.05],
  ]);

  it('selects semantic seeds, useful graph neighbors without keywords, and excludes distractors', () => {
    const result = base(graph, similarity);
    const keys = result.candidates.map((c) => c.node.externalKey);
    expect(result.seeds).toEqual([webhooks.id, bug.id].sort());
    expect(keys).toEqual(
      expect.arrayContaining([
        'component.webhooks',
        'bug.dup',
        'constraint.once',
        'component.store',
        'decision.record',
        'file.handler',
        'assumption.memory',
      ]),
    );
    expect(keys).not.toContain('decision.catalog');
    expect(keys).not.toContain('component.backend');
    const storeCandidate = result.candidates.find((c) => c.node.id === store.id)!;
    expect(storeCandidate.relevance).toBeCloseTo(0.9);
    expect(storeCandidate.reasons.map((r) => r.kind)).toEqual(['graph_neighbor']);
  });

  it('records real edges with actual direction and authority on paths', () => {
    const result = base(graph, similarity);
    const decisionCandidate = result.candidates.find((c) => c.node.id === decision.id)!;
    const path = decisionCandidate.reasons.find((r) => r.kind === 'graph_neighbor')!.path;
    expect(path).toHaveLength(2);
    expect(path[0]).toMatchObject({
      fromNodeId: webhooks.id,
      toNodeId: constraint.id,
      type: 'REQUIRES',
      traversed: 'forward',
    });
    expect(path[1]).toMatchObject({
      fromNodeId: decision.id,
      toNodeId: constraint.id,
      type: 'IMPLEMENTS',
      traversed: 'reverse',
    });
    for (const step of path) expect(edges.some((e) => e.id === step.edgeId)).toBe(true);
    const assumptionCandidate = result.candidates.find((c) => c.node.id === assumption.id)!;
    const inferredPath = assumptionCandidate.reasons.find((r) => r.kind === 'graph_neighbor')!;
    expect(inferredPath.path[0]?.authority).toBe('inferred');
    expect(inferredPath.description).toContain('(inferred)');
  });

  it('ranks canonical before inferred at equal relevance and keeps inferred labeled', () => {
    const a = makeNode('a', 'decision', { title: 'Canonical claim' });
    const b = makeNode('b', 'decision', { title: 'Inferred claim', authority: 'inferred' });
    const seed = makeNode('seed', 'component', { title: 'Seed component' });
    const g = makeGraph(
      [a, b, seed],
      [makeEdge(seed, a, 'REQUIRES'), makeEdge(seed, b, 'REQUIRES', 'inferred')],
    );
    const result = base(g, sims([[seed, 0.9]]));
    expect(result.candidates.map((c) => c.node.externalKey)).toEqual(['seed', 'a', 'b']);
    expect(result.candidates[2]!.node.current.authority).toBe('inferred');
  });

  it('does not let an unrelated canonical node in through authority alone', () => {
    const unrelated = makeNode('unrelated', 'constraint', { importance: 5 });
    const seed = makeNode('seed', 'component');
    const result = base(makeGraph([unrelated, seed], []), sims([[seed, 0.9]]));
    expect(result.candidates.map((c) => c.node.id)).toEqual([seed.id]);
  });

  it('uses explicit references from start ids and paths', () => {
    const result = base(graph, new Map(), {
      task: 'Change src/payments/webhook.ts',
      startNodeIds: [store.id],
    });
    // "payments" is a whole token inside the path, so the "Payments" title is also an explicit mention.
    expect(result.seeds).toEqual([file.id, store.id, payments.id].sort());
    const fileCandidate = result.candidates.find((c) => c.node.id === file.id)!;
    expect(fileCandidate.relevance).toBe(1);
    expect(fileCandidate.reasons[0]).toMatchObject({ kind: 'explicit_reference' });
  });

  it('never records paths longer than maxDepth even when a seed is re-parented', () => {
    // decision is a weak semantic seed but gets a stronger 2-hop path; its neighbor file must not get 3 hops.
    const receiptFile = makeNode('file.receipts', 'file', {
      path: 'src/payments/event-receipts.ts',
    });
    const g = makeGraph(
      [...graph.nodes, receiptFile],
      [...edges, makeEdge(receiptFile, decision, 'IMPLEMENTS')],
    );
    const result = base(
      g,
      sims([
        [webhooks, 0.6],
        [decision, 0.3],
      ]),
    );
    for (const candidate of result.candidates)
      for (const reason of candidate.reasons) expect(reason.path.length).toBeLessThanOrEqual(2);
  });

  it('respects depth 0 and the eligibility floor', () => {
    const result = base(graph, similarity, { maxDepth: 0 });
    expect(result.candidates.map((c) => c.node.id).sort()).toEqual([webhooks.id, bug.id].sort());
    const depth3 = base(graph, similarity, { maxDepth: 3 });
    expect(depth3.candidates.every((c) => c.relevance >= ELIGIBILITY_FLOOR)).toBe(true);
    expect(depth3.candidates.map((c) => c.node.id)).not.toContain(catalog.id);
  });

  it('skips forward CONTAINS from hubs but still climbs to parents', () => {
    const hub = makeNode('hub', 'component', { title: 'Hub' });
    const children = Array.from({ length: 7 }, (_, i) => makeNode(`child${i}`, 'component'));
    const g = makeGraph(
      [hub, ...children],
      children.map((c) => makeEdge(hub, c, 'CONTAINS')),
    );
    const fromHub = base(g, sims([[hub, 0.9]]));
    expect(fromHub.candidates.map((c) => c.node.id)).toEqual([hub.id]);
    const fromChild = base(g, sims([[children[0]!, 0.9]]));
    expect(fromChild.candidates.map((c) => c.node.externalKey).sort()).toEqual(['child0', 'hub']);
  });

  it('terminates on cycles deterministically', () => {
    const a = makeNode('a', 'component');
    const b = makeNode('b', 'component');
    const c = makeNode('c', 'component');
    const g = makeGraph(
      [a, b, c],
      [makeEdge(a, b, 'DEPENDS_ON'), makeEdge(b, c, 'DEPENDS_ON'), makeEdge(c, a, 'DEPENDS_ON')],
    );
    const first = base(g, sims([[a, 0.9]]), { maxDepth: 3 });
    const second = base(g, sims([[a, 0.9]]), { maxDepth: 3 });
    expect(first).toEqual(second);
    expect(first.candidates.map((x) => x.node.externalKey)).toEqual(['a', 'b', 'c']);
  });

  it('caps candidates and reports candidate_limit omissions', () => {
    const seed = makeNode('seed', 'component');
    const many = Array.from({ length: MAX_CANDIDATES + 5 }, (_, i) =>
      makeNode(`n${i}`, 'decision'),
    );
    const g = makeGraph(
      [seed, ...many],
      many.map((n) => makeEdge(seed, n, 'REQUIRES')),
    );
    const result = base(g, sims([[seed, 0.9]]));
    expect(result.candidates).toHaveLength(MAX_CANDIDATES);
    expect(result.omissions).toHaveLength(6);
    expect(result.omissions.every((o) => o.reason === 'candidate_limit')).toBe(true);
  });

  it('returns nothing when no seed qualifies', () => {
    const result = base(graph, sims([[catalog, 0.1]]));
    expect(result.seeds).toEqual([]);
    expect(result.candidates).toEqual([]);
  });

  it('labels lexical mode reasons distinctly', () => {
    const result = base(graph, similarity, { mode: 'lexical', minSeedSimilarity: 0.08 });
    const seed = result.candidates.find((c) => c.node.id === webhooks.id)!;
    expect(seed.reasons.some((r) => r.kind === 'lexical_match')).toBe(true);
    expect(result.candidates.some((c) => c.reasons.some((r) => r.kind === 'semantic_match'))).toBe(
      false,
    );
  });
});

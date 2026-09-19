import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEmbeddingCache } from '../../src/server/context/compiler/cache';
import { compileContext, type CompilerDeps } from '../../src/server/context/compiler/compile';
import type { EmbeddingProvider } from '../../src/server/context/compiler/embedding';
import { handleCompileContext } from '../../src/server/context/compiler/handler';
import type { ContextBundle } from '../../src/server/context/compiler/types';
import { GraphError } from '../../src/server/context/errors';
import { createGraphStore } from '../../src/server/context/store';
import { snapshotOf } from '../../src/server/context/types';
import { route } from '../../src/server/http';
import type { GraphStore } from '../../src/server/context/types';
import { DEMO_PROJECT_ID, DEMO_TASK } from '../../src/server/ingestion/demo-expectations';
import { importPreparedProject } from '../../src/server/ingestion/import';
import { isolatedDatabase } from '../helpers/postgres';

const KEYWORDS = [
  'webhook',
  'stripe',
  'duplicate',
  'event',
  'receipt',
  'catalog',
  'email',
  'tax',
  'analytics',
  'admin',
  'search',
  'payment',
];

/** Deterministic keyword-projection provider: real cosine geometry without a model. */
function keywordProvider(): EmbeddingProvider & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    id: 'fixed:keywords',
    dimensions: KEYWORDS.length,
    minSeedSimilarity: 0.25,
    calls,
    async embed(texts) {
      calls.push(texts);
      return texts.map((text) => {
        const lower = text.toLowerCase();
        return KEYWORDS.map((word) => (lower.split(word).length - 1) * 1.0);
      });
    },
  };
}

describe('compileContext against PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof isolatedDatabase>>;
  let store: GraphStore;
  let deps: CompilerDeps & { provider: ReturnType<typeof keywordProvider> };
  const keyOf = (bundle: ContextBundle, nodeId: string) =>
    bundle.selected.find((s) => s.nodeId === nodeId);

  beforeAll(async () => {
    db = await isolatedDatabase();
    store = createGraphStore(db.pool);
    await importPreparedProject(
      await readFile(new URL('../../fixtures/demo-payments.json', import.meta.url)),
      store,
    );
    deps = { store, provider: keywordProvider(), cache: createEmbeddingCache(db.pool) };
  });
  afterAll(async () => {
    await db.cleanup();
  });

  it('returns a bounded, explainable bundle with real node versions and sources (A1/A4)', async () => {
    const bundle = await compileContext(deps, DEMO_PROJECT_ID, {
      task: DEMO_TASK,
      tokenBudget: 4096,
    });
    expect(bundle.status).toBe('ok');
    expect(bundle.tokenCount).toBeLessThanOrEqual(4096);
    expect(bundle.metrics.projectContextTokens).toBeGreaterThan(bundle.tokenCount);
    expect(bundle.selected.length).toBeGreaterThan(3);
    const graph = await store.getGraph(DEMO_PROJECT_ID);
    const byKey = new Map(graph.nodes.map((n) => [n.externalKey, n]));
    const selectedKeys = bundle.selected.map(
      (s) => byKey.get(graph.nodes.find((n) => n.id === s.nodeId)!.externalKey)!.externalKey,
    );
    expect(selectedKeys).toEqual(
      expect.arrayContaining([
        'component.stripe-webhooks',
        'constraint.provider-event-id-unique',
        'component.event-receipt-store',
        'file.webhook-handler',
      ]),
    );
    expect(selectedKeys).not.toContain('constraint.email-brand-colors');
    expect(selectedKeys).not.toContain('decision.tax-rates-daily');
    for (const item of bundle.selected) {
      const node = await store.getNode(DEMO_PROJECT_ID, item.nodeId);
      expect(node.current.version).toBe(item.version);
      expect((await store.getSource(DEMO_PROJECT_ID, item.sourceId)).uri).toBe(item.sourceUri);
      expect(item.reasons.length).toBeGreaterThan(0);
      for (const reason of item.reasons) {
        for (const step of reason.path) {
          const edge = graph.edges.find((e) => e.id === step.edgeId)!;
          expect(edge).toMatchObject({
            fromNodeId: step.fromNodeId,
            toNodeId: step.toNodeId,
            type: step.type,
            authority: step.authority,
          });
        }
      }
    }
    const receiptStore = keyOf(bundle, byKey.get('component.event-receipt-store')!.id)!;
    expect(receiptStore.reasons.some((r) => r.kind === 'graph_neighbor')).toBe(true);
    expect(bundle.contextText).toContain('[inferred]');
  });

  it('caches vectors by (node, version, model) and follows edits to the current revision (A6)', async () => {
    const graph = await store.getGraph(DEMO_PROJECT_ID);
    const assumption = graph.nodes.find(
      (n) => n.externalKey === 'assumption.process-memory-dedupe',
    )!;
    const before = await compileContext(deps, DEMO_PROJECT_ID, {
      task: DEMO_TASK,
      tokenBudget: 4096,
    });
    expect(keyOf(before, assumption.id)?.version).toBe(1);
    const callsBefore = deps.provider.calls.length;
    await compileContext(deps, DEMO_PROJECT_ID, { task: DEMO_TASK, tokenBudget: 4096 });
    // Second compile embeds only the task; all node vectors come from the cache.
    expect(deps.provider.calls.slice(callsBefore).flat()).toEqual([DEMO_TASK]);

    await store.transaction(async (tx) => {
      const source = await tx.createSource(DEMO_PROJECT_ID, {
        kind: 'manual',
        uri: 'manual://test/review',
        label: 'Review',
        excerpt: 'Reviewed: a shared receipt table is required; in-memory dedupe is insufficient.',
        revisionRef: null,
      });
      await tx.reviseNode(DEMO_PROJECT_ID, assumption.id, {
        expectedVersion: 1,
        snapshot: {
          ...snapshotOf(assumption),
          content:
            'Reviewed: in-memory dedupe is insufficient because Stripe webhook delivery spans processes.',
          authority: 'canonical',
          sourceId: source.id,
        },
        actor: { kind: 'human', label: 'local-operator' },
        changeReason: 'Reviewed after incident',
      });
    });
    const after = await compileContext(deps, DEMO_PROJECT_ID, {
      task: DEMO_TASK,
      tokenBudget: 4096,
    });
    const revised = keyOf(after, assumption.id)!;
    expect(revised.version).toBe(2);
    expect(revised.authority).toBe('canonical');
    const rows = await db.pool.query(
      'SELECT version FROM context_embeddings WHERE node_id=$1 ORDER BY version',
      [assumption.id],
    );
    expect(rows.rows.map((r) => r.version)).toEqual([1, 2]);
    expect((await store.getRevision(DEMO_PROJECT_ID, assumption.id, 1)).authority).toBe('inferred');
  });

  it('rejects archived or foreign start nodes and unknown projects', async () => {
    await expect(
      compileContext(deps, '00000000-0000-4000-8000-000000000000', { task: 'x', tokenBudget: 512 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      compileContext(deps, DEMO_PROJECT_ID, {
        task: 'x',
        tokenBudget: 512,
        startNodeIds: ['00000000-0000-4000-8000-000000000000'],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('fails explicitly when the provider is unavailable, or degrades when allowed (A5)', async () => {
    const failing: EmbeddingProvider = {
      id: 'fixed:broken',
      dimensions: 3,
      minSeedSimilarity: 0.25,
      async embed() {
        throw new GraphError('EMBEDDING_UNAVAILABLE', 'down');
      },
    };
    const broken = { ...deps, provider: failing };
    await expect(
      compileContext(broken, DEMO_PROJECT_ID, { task: DEMO_TASK, tokenBudget: 1024 }),
    ).rejects.toMatchObject({ code: 'EMBEDDING_UNAVAILABLE' });
    const degraded = await compileContext(broken, DEMO_PROJECT_ID, {
      task: DEMO_TASK,
      tokenBudget: 1024,
      allowDegraded: true,
    });
    expect(degraded.status).toBe('degraded');
    expect(degraded.embeddingModel).toBe('lexical-fallback');
    expect(degraded.contextText).toContain('lexical matching only');
    expect(degraded.tokenCount).toBeLessThanOrEqual(1024);
    expect(
      degraded.selected.every((s) => s.reasons.every((r) => r.kind !== 'semantic_match')),
    ).toBe(true);
  });

  it('small budgets stay bounded and report omissions', async () => {
    const bundle = await compileContext(deps, DEMO_PROJECT_ID, {
      task: DEMO_TASK,
      tokenBudget: 256,
    });
    expect(bundle.tokenCount).toBeLessThanOrEqual(256);
    expect(
      bundle.omissions.length + bundle.selected.filter((s) => s.representation !== 'full').length,
    ).toBeGreaterThan(0);
  });

  it('serves the JSON route contract and error envelope (A7)', async () => {
    const url = `http://127.0.0.1:3000/api/projects/${DEMO_PROJECT_ID}/context`;
    const handler = route<{ projectId: string }>((request, params) =>
      handleCompileContext(deps, request, params),
    );
    const call = (request: Request) =>
      handler(request, { params: Promise.resolve({ projectId: DEMO_PROJECT_ID }) });
    const ok = await call(
      new Request(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          host: '127.0.0.1:3000',
          origin: 'http://127.0.0.1:3000',
        },
        body: JSON.stringify({ task: DEMO_TASK, tokenBudget: 2048 }),
      }),
    );
    expect(ok.status).toBe(200);
    const bundle = (await ok.json()) as ContextBundle;
    expect(bundle).toMatchObject({
      projectId: DEMO_PROJECT_ID,
      tokenizer: 'cl100k_base',
      tokenBudget: 2048,
    });
    const bad = await call(
      new Request(url, { method: 'POST', body: JSON.stringify({ task: '', tokenBudget: 10 }) }),
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    const foreign = await call(
      new Request(url, {
        method: 'POST',
        headers: { origin: 'http://evil.example', host: '127.0.0.1:3000' },
        body: '{}',
      }),
    );
    expect(foreign.status).toBe(403);
  });
});

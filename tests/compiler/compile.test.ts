import { describe, expect, it } from 'vitest';
import { memoryEmbeddingCache, type EmbeddingCache } from '../../src/server/context/compiler/cache';
import { compileContext, type CompilerDeps } from '../../src/server/context/compiler/compile';
import {
  embeddingInput,
  type EmbeddingProvider,
} from '../../src/server/context/compiler/embedding';
import { graphError } from '../../src/server/context/errors';
import type { GraphSnapshot, GraphStore } from '../../src/server/context/types';
import { makeEdge, makeGraph, makeNode, PROJECT_ID } from './fixture';

/** Minimal read-only store: compileContext only needs getGraph and getSource. */
function fakeStore(graph: GraphSnapshot): GraphStore {
  const unsupported = () => Promise.reject(new Error('not used'));
  return {
    listProjects: unsupported,
    getProject: unsupported,
    getGraph: async () => graph,
    getNode: unsupported,
    listArchivedNodes: unsupported,
    getSource: async (_projectId, sourceId) => ({
      id: sourceId,
      projectId: PROJECT_ID,
      kind: 'manual',
      uri: 'manual://test',
      label: 'Test',
      excerpt: 'synthetic prepared example',
      revisionRef: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
    listRevisions: unsupported,
    getRevision: unsupported,
    transaction: unsupported,
    close: async () => undefined,
  };
}

const seed = makeNode('component.webhooks', 'component', { title: 'Provider webhooks' });
const neighbor = makeNode('constraint.once', 'constraint', { title: 'Side effects once' });
const graph = makeGraph([seed, neighbor], [makeEdge(seed, neighbor, 'REQUIRES')]);
const TASK = 'Fix duplicate webhook processing';

/** Vectors: task and seed point the same way; neighbor is orthogonal. */
function provider(overrides: Partial<EmbeddingProvider> = {}): EmbeddingProvider {
  const vectors = new Map<string, number[]>([
    [TASK, [1, 0]],
    [embeddingInput(seed), [1, 0]],
    [embeddingInput(neighbor), [0, 1]],
  ]);
  return {
    id: 'fixed:unit',
    dimensions: 2,
    minSeedSimilarity: 0.25,
    async embed(texts) {
      return texts.map((text) => vectors.get(text)!);
    },
    ...overrides,
  };
}

const request = { task: TASK, tokenBudget: 1024 };

describe('compileContext resilience', () => {
  it('keeps usable vectors when the cache write fails', async () => {
    const cache: EmbeddingCache = {
      get: async () => [],
      put: async () => {
        throw graphError('STORAGE_ERROR', 'cache down');
      },
    };
    const events: string[] = [];
    const deps: CompilerDeps = {
      store: fakeStore(graph),
      provider: provider(),
      cache,
      log: (event) => events.push(event.stage),
    };
    const bundle = await compileContext(deps, PROJECT_ID, request);
    expect(bundle.status).toBe('ok');
    expect(bundle.selected.map((s) => s.nodeId)).toEqual([seed.id, neighbor.id]);
    expect(events).toContain('cache_put');
  });

  it('treats malformed cached vectors as misses and re-embeds them', async () => {
    const cache = memoryEmbeddingCache();
    await cache.put(PROJECT_ID, 'fixed:unit', [
      { nodeId: seed.id, version: 1, vector: [Number.NaN, 1] },
      { nodeId: neighbor.id, version: 1, vector: [1] },
    ]);
    const calls: string[][] = [];
    const deps: CompilerDeps = {
      store: fakeStore(graph),
      provider: provider({
        embed: async (texts) => {
          calls.push(texts);
          return provider().embed(texts);
        },
      }),
      cache,
    };
    const bundle = await compileContext(deps, PROJECT_ID, request);
    expect(calls.flat().sort()).toEqual(
      [TASK, embeddingInput(neighbor), embeddingInput(seed)].sort(),
    );
    expect(bundle.selected[0]?.reasons[0]?.similarity).toBeCloseTo(1);
  });

  it('fails with EMBEDDING_UNAVAILABLE when a provider returns the wrong vector count', async () => {
    const deps: CompilerDeps = {
      store: fakeStore(graph),
      provider: provider({ embed: async () => [[1, 0]] }),
      cache: memoryEmbeddingCache(),
    };
    await expect(compileContext(deps, PROJECT_ID, request)).rejects.toMatchObject({
      code: 'EMBEDDING_UNAVAILABLE',
    });
  });

  it('reports partial embedding failure when degrading', async () => {
    const many = Array.from({ length: 40 }, (_, i) => makeNode(`decision.n${i}`, 'decision'));
    const big = makeGraph(
      [seed, ...many],
      many.map((n) => makeEdge(seed, n, 'REQUIRES')),
    );
    let batches = 0;
    const deps: CompilerDeps = {
      store: fakeStore(big),
      provider: provider({
        embed: async (texts) => {
          batches += 1;
          if (batches === 2) throw graphError('EMBEDDING_UNAVAILABLE', 'second batch failed');
          return texts.map(() => [1, 0]);
        },
      }),
      cache: memoryEmbeddingCache(),
    };
    const bundle = await compileContext(deps, PROJECT_ID, { ...request, allowDegraded: true });
    expect(bundle.status).toBe('degraded');
    expect(bundle.warnings.some((w) => /9 of 41 nodes could not be embedded/.test(w))).toBe(true);
    expect(bundle.contextText).toContain('could not be embedded');
  });

  it('gives explicit seeds above the similarity threshold a semantic reason too', async () => {
    const deps: CompilerDeps = {
      store: fakeStore(graph),
      provider: provider(),
      cache: memoryEmbeddingCache(),
    };
    const bundle = await compileContext(deps, PROJECT_ID, { ...request, startNodeIds: [seed.id] });
    const kinds = bundle.selected.find((s) => s.nodeId === seed.id)!.reasons.map((r) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(['explicit_reference', 'semantic_match']));
  });
});

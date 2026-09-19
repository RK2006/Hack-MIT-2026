import { GraphError, graphError } from '../errors';
import type { ContextNode, GraphSnapshot, GraphStore, Source } from '../types';
import type { EmbeddingCache } from './cache';
import {
  cosine,
  EMBEDDING_BATCH_SIZE,
  embeddingInput,
  validateVectors,
  type EmbeddingProvider,
} from './embedding';
import { LEXICAL_MIN_SEED_SIMILARITY, lexicalSimilarity } from './lexical';
import { pack } from './pack';
import { DEGRADED_WARNING, renderContext } from './render';
import { retrieve, type SimilarityMode } from './retrieval';
import { parseContextRequest } from './request';
import { countTokens, TOKENIZER_ID } from './tokenizer';
import type { ContextBundle, Omission } from './types';

export type CompilerDeps = {
  store: GraphStore;
  provider: EmbeddingProvider;
  cache: EmbeddingCache;
  log?: (event: { stage: string; durationMs: number; count?: number; category?: string }) => void;
};

export const LEXICAL_MODEL_ID = 'lexical-fallback';

type Similarity = {
  mode: SimilarityMode;
  values: Map<string, number>;
  minSeedSimilarity: number;
  embeddingModel: string;
  warnings: string[];
  omissions: Omission[];
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

async function nodeVectors(
  deps: CompilerDeps,
  graph: GraphSnapshot,
): Promise<{ vectors: Map<string, number[]>; failed: ContextNode[]; error?: GraphError }> {
  const { provider, cache } = deps;
  const projectId = graph.project.id;
  const keys = graph.nodes.map((node) => ({ nodeId: node.id, version: node.current.version }));
  const cached = await cache.get(projectId, provider.id, keys);
  const vectors = new Map<string, number[]>();
  for (const row of cached) {
    const node = graph.nodes.find((n) => n.id === row.nodeId && n.current.version === row.version);
    // A malformed cached row (wrong length, NaN/Infinity) is a cache miss, never trusted.
    if (node && row.vector.length === provider.dimensions && row.vector.every(Number.isFinite))
      vectors.set(node.id, row.vector);
  }
  const missing = graph.nodes.filter((node) => !vectors.has(node.id));
  const failed: ContextNode[] = [];
  let error: GraphError | undefined;
  for (let offset = 0; offset < missing.length; offset += EMBEDDING_BATCH_SIZE) {
    const batch = missing.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    if (error) {
      failed.push(...batch);
      continue;
    }
    try {
      const embedded = validateVectors(
        await provider.embed(batch.map(embeddingInput)),
        batch.length,
        provider.dimensions,
      );
      const rows = batch.map((node, index) => ({
        nodeId: node.id,
        version: node.current.version,
        vector: embedded[index]!,
      }));
      for (const row of rows) vectors.set(row.nodeId, row.vector);
      // The cache is best-effort derived data; a write failure must not discard usable vectors.
      await cache.put(projectId, provider.id, rows).catch((caught: unknown) => {
        deps.log?.({
          stage: 'cache_put',
          durationMs: 0,
          category: caught instanceof GraphError ? caught.code : 'unknown',
        });
      });
    } catch (caught) {
      error =
        caught instanceof GraphError
          ? caught
          : graphError('EMBEDDING_UNAVAILABLE', 'Embedding failed');
      failed.push(...batch);
    }
  }
  return error ? { vectors, failed, error } : { vectors, failed };
}

async function similarities(
  deps: CompilerDeps,
  graph: GraphSnapshot,
  task: string,
  allowDegraded: boolean,
): Promise<Similarity> {
  const started = Date.now();
  const { vectors, failed, error } = await nodeVectors(deps, graph);
  let taskVector: number[] | undefined;
  let taskError: GraphError | undefined;
  if (!error) {
    try {
      taskVector = validateVectors(
        await deps.provider.embed([task]),
        1,
        deps.provider.dimensions,
      )[0];
    } catch (caught) {
      taskError =
        caught instanceof GraphError
          ? caught
          : graphError('EMBEDDING_UNAVAILABLE', 'Task embedding failed');
    }
  }
  const failure = error ?? taskError;
  deps.log?.({
    stage: 'similarity',
    durationMs: Date.now() - started,
    count: vectors.size,
    ...(failure && { category: String(failure.details?.category ?? failure.code) }),
  });
  if (failure && !allowDegraded) throw failure;

  const values = new Map<string, number>();
  if (!failure && taskVector) {
    for (const node of graph.nodes)
      values.set(node.id, clamp01(cosine(taskVector, vectors.get(node.id)!)));
    return {
      mode: 'semantic',
      values,
      minSeedSimilarity: deps.provider.minSeedSimilarity,
      embeddingModel: deps.provider.id,
      warnings: [],
      omissions: [],
    };
  }
  for (const node of graph.nodes)
    values.set(node.id, lexicalSimilarity(task, embeddingInput(node)));
  const warnings = [DEGRADED_WARNING];
  if (failed.length > 0 && failed.length < graph.nodes.length) {
    warnings.push(
      `${failed.length} of ${graph.nodes.length} nodes could not be embedded; lexical matching was used for all.`,
    );
  }
  return {
    mode: 'lexical',
    values,
    minSeedSimilarity: LEXICAL_MIN_SEED_SIMILARITY,
    embeddingModel: LEXICAL_MODEL_ID,
    warnings,
    omissions: [],
  };
}

async function loadSources(store: GraphStore, projectId: string, nodes: ContextNode[]) {
  // Sources are immutable, so reading them after the graph snapshot cannot observe a different version.
  const ids = [...new Set(nodes.map((node) => node.current.sourceId))];
  const loaded = await Promise.all(ids.map((id) => store.getSource(projectId, id)));
  return new Map<string, Pick<Source, 'id' | 'kind' | 'uri'>>(
    loaded.map((source) => [source.id, { id: source.id, kind: source.kind, uri: source.uri }]),
  );
}

export async function compileContext(
  deps: CompilerDeps,
  projectId: string,
  rawRequest: unknown,
): Promise<ContextBundle> {
  const request = parseContextRequest(rawRequest);
  const graph = await deps.store.getGraph(projectId);
  const active = new Set(graph.nodes.map((node) => node.id));
  for (const id of request.startNodeIds) {
    if (!active.has(id))
      throw graphError(
        'VALIDATION_ERROR',
        'startNodeIds must reference active nodes of the project',
        {
          field: 'startNodeIds',
          nodeId: id,
        },
      );
  }

  const similarity = await similarities(deps, graph, request.task, request.allowDegraded);
  const status = similarity.mode === 'semantic' ? 'ok' : 'degraded';

  const started = Date.now();
  const retrieval = retrieve({
    graph,
    task: request.task,
    similarity: similarity.values,
    minSeedSimilarity: similarity.minSeedSimilarity,
    mode: similarity.mode,
    startNodeIds: request.startNodeIds,
    maxDepth: request.maxDepth,
  });
  deps.log?.({
    stage: 'retrieval',
    durationMs: Date.now() - started,
    count: retrieval.candidates.length,
  });

  const sources = await loadSources(deps.store, projectId, graph.nodes);
  const packed = pack({
    project: graph.project,
    status,
    embeddingModel: similarity.embeddingModel,
    tokenBudget: request.tokenBudget,
    candidates: retrieval.candidates,
    sources,
    omissions: [...similarity.omissions, ...retrieval.omissions],
    warnings: similarity.warnings,
  });

  const projectContextTokens = countTokens(
    renderContext({
      project: graph.project,
      status,
      embeddingModel: similarity.embeddingModel,
      items: graph.nodes.map((node) => ({
        node,
        representation: 'full',
        reasons: [],
        source: sources.get(node.current.sourceId) ?? {
          id: node.current.sourceId,
          kind: 'manual',
          uri: 'unknown',
        },
      })),
      omissions: [],
      warnings: [],
    }),
  );

  return {
    projectId,
    task: request.task,
    status,
    tokenBudget: request.tokenBudget,
    tokenCount: packed.tokenCount,
    tokenizer: TOKENIZER_ID,
    embeddingModel: similarity.embeddingModel,
    contextText: packed.contextText,
    selected: packed.items.map((item) => ({
      nodeId: item.node.id,
      version: item.node.current.version,
      type: item.node.type,
      title: item.node.current.title,
      authority: item.node.current.authority,
      representation: item.representation,
      score: Number(item.candidate.score.toFixed(4)),
      relevance: Number(item.candidate.relevance.toFixed(4)),
      sourceId: item.source.id,
      sourceUri: item.source.uri,
      reasons: item.reasons,
    })),
    omissions: packed.omissions,
    warnings: packed.warnings,
    metrics: {
      activeNodes: graph.nodes.length,
      activeEdges: graph.edges.length,
      seeds: retrieval.seeds.length,
      candidates: retrieval.candidates.length,
      projectContextTokens,
    },
  };
}

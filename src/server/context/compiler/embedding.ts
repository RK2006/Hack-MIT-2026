import { graphError } from '../errors';
import type { ContextNode } from '../types';

export type EmbeddingProvider = {
  /** Stable model identifier stored in the cache key, e.g. `local:Xenova/all-MiniLM-L6-v2`. */
  id: string;
  dimensions: number;
  /** Minimum cosine similarity for a node to qualify as a semantic seed. */
  minSeedSimilarity: number;
  embed(texts: string[]): Promise<number[][]>;
};

export const EMBEDDING_BATCH_SIZE = 32;
export const EMBEDDING_INPUT_MAX_CODEPOINTS = 1500;
export const PROVIDER_TIMEOUT_MS = 30_000;

/** Deterministic serialization of a node's current revision for embedding. */
export function embeddingInput(node: ContextNode): string {
  const { title, summary, content } = node.current;
  const text = `${node.type}: ${title}\n${summary}\n${content}${node.path ? `\npath: ${node.path}` : ''}`;
  const points = Array.from(text);
  return points.length > EMBEDDING_INPUT_MAX_CODEPOINTS
    ? points.slice(0, EMBEDDING_INPUT_MAX_CODEPOINTS).join('')
    : text;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

export function validateVectors(vectors: unknown, count: number, dimensions: number): number[][] {
  if (!Array.isArray(vectors) || vectors.length !== count) {
    throw graphError('EMBEDDING_UNAVAILABLE', 'Embedding provider returned the wrong vector count');
  }
  return vectors.map((vector) => {
    if (
      !Array.isArray(vector) ||
      vector.length !== dimensions ||
      !vector.every((value) => typeof value === 'number' && Number.isFinite(value))
    ) {
      throw graphError('EMBEDDING_UNAVAILABLE', 'Embedding provider returned a malformed vector');
    }
    return vector as number[];
  });
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(graphError('EMBEDDING_UNAVAILABLE', 'Embedding provider timed out')),
      ms,
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Test-only provider: vectors are supplied by the caller and looked up by input text. */
export function fixedEmbeddingProvider(
  vectors: Map<string, number[]>,
  options: { dimensions: number; minSeedSimilarity?: number; id?: string; fallback?: number[] },
): EmbeddingProvider {
  return {
    id: options.id ?? 'fixed:test',
    dimensions: options.dimensions,
    minSeedSimilarity: options.minSeedSimilarity ?? 0.25,
    async embed(texts) {
      return texts.map((text) => {
        const vector = vectors.get(text) ?? options.fallback;
        if (!vector) throw graphError('EMBEDDING_UNAVAILABLE', 'No fixed vector for input');
        return vector;
      });
    },
  };
}

export const LOCAL_MODEL = 'Xenova/all-MiniLM-L6-v2';

/** In-process sentence-transformer via @xenova/transformers (ONNX runtime); no network after first model download. */
export function localEmbeddingProvider(): EmbeddingProvider {
  const dimensions = 384;
  let extractor: Promise<(texts: string[]) => Promise<number[][]>> | undefined;
  const load = async () => {
    const { pipeline } = await import('@xenova/transformers');
    const pipe = await pipeline('feature-extraction', LOCAL_MODEL, { quantized: true });
    return async (texts: string[]) => {
      const output = await pipe(texts, { pooling: 'mean', normalize: true });
      return output.tolist() as number[][];
    };
  };
  return {
    id: `local:${LOCAL_MODEL}`,
    dimensions,
    minSeedSimilarity: 0.25,
    async embed(texts) {
      try {
        extractor ??= load();
        const run = await withTimeout(extractor, PROVIDER_TIMEOUT_MS);
        const vectors = await withTimeout(run(texts), PROVIDER_TIMEOUT_MS);
        return validateVectors(vectors, texts.length, dimensions);
      } catch (error) {
        extractor = undefined;
        if (error instanceof Error && error.name === 'GraphError') throw error;
        throw graphError('EMBEDDING_UNAVAILABLE', 'Local embedding model failed', {
          category: 'local_model',
        });
      }
    },
  };
}

export const OPENAI_DEFAULT_MODEL = 'text-embedding-3-small';

/** Hosted OpenAI embeddings through fetch; only prepared public/synthetic context is sent. */
export function openAiEmbeddingProvider(options: {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): EmbeddingProvider {
  const model = options.model ?? OPENAI_DEFAULT_MODEL;
  const dimensions = model === 'text-embedding-3-large' ? 3072 : 1536;
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${options.baseUrl ?? 'https://api.openai.com/v1'}/embeddings`;
  const request = async (texts: string[]) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
      return await fetchImpl(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model, input: texts }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    id: `openai:${model}`,
    dimensions,
    minSeedSimilarity: 0.3,
    async embed(texts) {
      let response: Response | undefined;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          response = await request(texts);
          if (response.ok) break;
          if (response.status !== 429 && response.status < 500) break;
        } catch {
          response = undefined;
        }
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!response || !response.ok) {
        throw graphError('EMBEDDING_UNAVAILABLE', 'Hosted embedding request failed', {
          category: response ? `http_${response.status}` : 'network',
        });
      }
      const body = (await response.json()) as {
        data?: Array<{ index: number; embedding: unknown }>;
      };
      const ordered = [...(body.data ?? [])].sort((a, b) => a.index - b.index);
      return validateVectors(
        ordered.map((item) => item.embedding),
        texts.length,
        dimensions,
      );
    },
  };
}

/** Exactly one backend is configured by EMBEDDING_PROVIDER (`local` default, `openai`). */
export function embeddingProviderFromEnv(env: NodeJS.ProcessEnv = process.env): EmbeddingProvider {
  const choice = env.EMBEDDING_PROVIDER ?? 'local';
  if (choice === 'local') return localEmbeddingProvider();
  if (choice === 'openai') {
    if (!env.OPENAI_API_KEY) {
      throw graphError(
        'EMBEDDING_UNAVAILABLE',
        'OPENAI_API_KEY is required for EMBEDDING_PROVIDER=openai',
      );
    }
    return openAiEmbeddingProvider({
      apiKey: env.OPENAI_API_KEY,
      ...(env.OPENAI_EMBEDDING_MODEL && { model: env.OPENAI_EMBEDDING_MODEL }),
    });
  }
  throw graphError('EMBEDDING_UNAVAILABLE', 'Unknown EMBEDDING_PROVIDER', { provider: choice });
}

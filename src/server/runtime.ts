import type { Pool } from 'pg';
import { createGraphStore } from './context/store';
import type { GraphStore } from './context/types';
import { createPool } from './db/pool';
import { migrate } from './db/migrate';
import { createEmbeddingCache } from './context/compiler/cache';
import { embeddingProviderFromEnv, type EmbeddingProvider } from './context/compiler/embedding';
import type { CompilerDeps } from './context/compiler/compile';

type Runtime = {
  pool: Pool;
  store: Promise<GraphStore>;
  provider?: EmbeddingProvider;
};
const globalRuntime = globalThis as typeof globalThis & { __contextGraphRuntime?: Runtime };

function runtime(): Runtime {
  if (!globalRuntime.__contextGraphRuntime) {
    const pool = createPool();
    const store = migrate(pool).then(() => createGraphStore(pool));
    // A failed initialization must not be cached; the next request retries from scratch.
    store.catch(() => {
      delete globalRuntime.__contextGraphRuntime;
      void pool.end().catch(() => undefined);
    });
    globalRuntime.__contextGraphRuntime = { pool, store };
  }
  return globalRuntime.__contextGraphRuntime;
}

/** One store per server process; survives Next.js dev-mode module reloads. */
export function getStore(): Promise<GraphStore> {
  return runtime().store;
}

/** Compiler dependencies sharing the process pool; the provider is created lazily from the environment. */
export async function getCompilerDeps(): Promise<CompilerDeps> {
  const current = runtime();
  current.provider ??= embeddingProviderFromEnv();
  return {
    store: await current.store,
    provider: current.provider,
    cache: createEmbeddingCache(current.pool),
    log: (event) => console.info({ operation: 'compileContext', ...event }),
  };
}

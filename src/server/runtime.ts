import { createGraphStore } from './context/store.js';
import type { GraphStore } from './context/types.js';
import { createPool } from './db/pool.js';
import { migrate } from './db/migrate.js';

type Runtime = { store: Promise<GraphStore> };
const globalRuntime = globalThis as typeof globalThis & { __contextGraphRuntime?: Runtime };

/** One store per server process; survives Next.js dev-mode module reloads. */
export function getStore(): Promise<GraphStore> {
  if (!globalRuntime.__contextGraphRuntime) {
    const pool = createPool();
    globalRuntime.__contextGraphRuntime = {
      store: migrate(pool).then(() => createGraphStore(pool)),
    };
  }
  return globalRuntime.__contextGraphRuntime.store;
}

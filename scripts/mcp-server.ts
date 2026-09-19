import 'dotenv/config';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createEmbeddingCache } from '../src/server/context/compiler/cache';
import { embeddingProviderFromEnv } from '../src/server/context/compiler/embedding';
import { createGraphStore } from '../src/server/context/store';
import { migrate } from '../src/server/db/migrate';
import { createPool } from '../src/server/db/pool';
import { createContextGraphMcpServer } from '../src/server/mcp/server';
import { proposalModelFromEnv } from '../src/server/proposals/model';

// stdout is the MCP protocol channel; every diagnostic goes to stderr.
const log = (message: unknown) => console.error(message);

let pool;
try {
  pool = createPool();
  await migrate(pool);
} catch {
  log('context-graph MCP: cannot reach the database; check DATABASE_URL');
  process.exit(1);
}
const store = createGraphStore(pool);
const provider = embeddingProviderFromEnv();
const proposalModel = proposalModelFromEnv();
const server = createContextGraphMcpServer({
  store,
  provider,
  cache: createEmbeddingCache(pool),
  ...(proposalModel && { proposalModel }),
  log,
});
log({
  server: 'context-graph',
  embeddingModel: provider.id,
  proposals:
    proposalModel?.id ?? 'disabled (set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY)',
});

const transport = new StdioServerTransport();
const shutdown = async () => {
  await server.close().catch(() => undefined);
  await store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
transport.onclose = () => void shutdown();
await server.connect(transport);

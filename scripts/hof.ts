import { config as loadEnv } from 'dotenv';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { Pool } from 'pg';
import { EXIT, run, type Services } from '../src/cli/hof';
import { createEmbeddingCache } from '../src/server/context/compiler/cache';
import type { CompilerDeps } from '../src/server/context/compiler/compile';
import { embeddingProviderFromEnv } from '../src/server/context/compiler/embedding';
import { createGraphStore } from '../src/server/context/store';
import type { GraphStore } from '../src/server/context/types';
import { migrate } from '../src/server/db/migrate';
import { createPool } from '../src/server/db/pool';
import { createContextGraphMcpServer } from '../src/server/mcp/server';
import { proposalModelFromEnv } from '../src/server/proposals/model';

// `hof` runs from any directory, so read .env from the repository root rather than cwd.
loadEnv({ path: new URL('../.env', import.meta.url), quiet: true });

const argv = process.argv.slice(2);
const needsDatabase = argv.length > 0 && !['--help', '-h', 'help'].includes(argv[0]!);

let pool: Pool | undefined;
let store: GraphStore | undefined;
if (needsDatabase) {
  try {
    pool = createPool();
    await migrate(pool);
    store = createGraphStore(pool);
  } catch (error) {
    console.error(
      `Cannot reach the database (${error instanceof Error ? error.message : String(error)}); check DATABASE_URL in .env`,
    );
    process.exit(EXIT.environment);
  }
}

let compiler: CompilerDeps | undefined;
const services: Services = {
  store: store!,
  compiler: async () => {
    compiler ??= {
      store: store!,
      provider: embeddingProviderFromEnv(),
      cache: createEmbeddingCache(pool!),
      log: (event) => {
        if (process.env.HOF_DEBUG) console.error(event);
      },
    };
    return compiler;
  },
  proposalModel: () => proposalModelFromEnv() ?? null,
  serve: async () => {
    const provider = embeddingProviderFromEnv();
    const proposalModel = proposalModelFromEnv();
    const server = createContextGraphMcpServer({
      store: store!,
      provider,
      cache: createEmbeddingCache(pool!),
      ...(proposalModel && { proposalModel }),
      log: (message) => console.error(message),
    });
    const transport = new StdioServerTransport();
    await new Promise<void>((resolve) => {
      const stop = () => {
        void server
          .close()
          .catch(() => undefined)
          .finally(resolve);
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      transport.onclose = stop;
      void server.connect(transport);
    });
  },
};

const io = {
  stdout: (text: string) => process.stdout.write(text),
  stderr: (text: string) => process.stderr.write(text),
  cwd: process.cwd(),
  env: process.env,
  readStdin: () =>
    new Promise<string>((resolve) => {
      let buffer = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => (buffer += chunk));
      process.stdin.on('end', () => resolve(buffer));
    }),
};

let code = EXIT.domain as number;
try {
  code = await run(argv, io, services);
} catch (error) {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
} finally {
  await store?.close();
}
process.exit(code);

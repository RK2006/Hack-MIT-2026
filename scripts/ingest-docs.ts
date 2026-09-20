import 'dotenv/config';
import { createGraphStore } from '../src/server/context/store';
import { migrate } from '../src/server/db/migrate';
import { createPool } from '../src/server/db/pool';
import { ingestDocumentation } from '../src/server/ingestion/docs';
import { proposalModelFromEnv } from '../src/server/proposals/model';

// Usage: npm run ingest:docs -- <projectId> <repo-path> [file ...]
const [projectId, path, ...files] = process.argv.slice(2);
if (!projectId || !path) {
  console.error('Usage: npm run ingest:docs -- <projectId> <repo-path> [relative/doc.md ...]');
  process.exit(2);
}
const model = proposalModelFromEnv();
if (!model) {
  console.error(
    'A proposal model key is required: set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY in .env',
  );
  process.exit(2);
}
const pool = createPool();
await migrate(pool);
const store = createGraphStore(pool);
try {
  const result = await ingestDocumentation({ store, model }, projectId, path, {
    files: files.length > 0 ? files : undefined,
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await store.close();
}

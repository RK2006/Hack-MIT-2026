import 'dotenv/config';
import { createGraphStore } from '../src/server/context/store';
import { migrate } from '../src/server/db/migrate';
import { createPool } from '../src/server/db/pool';
import { ingestPullRequest } from '../src/server/ingestion/github-pr';
import { proposalModelFromEnv } from '../src/server/proposals/model';

// Usage: npm run ingest:pr -- <projectId> <pr-url | owner/repo#n | n> [--repo owner/name]
const args = process.argv.slice(2);
const repoIndex = args.indexOf('--repo');
const repo = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
const positional = args.filter(
  (arg, index) => arg !== '--repo' && (repoIndex < 0 || index !== repoIndex + 1),
);
const [projectId, ref] = positional;
if (!projectId || !ref) {
  console.error(
    'Usage: npm run ingest:pr -- <projectId> <pr-url | owner/repo#n | n> [--repo owner/name]',
  );
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
  const result = await ingestPullRequest({ store, model }, projectId, ref, { repo });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await store.close();
}

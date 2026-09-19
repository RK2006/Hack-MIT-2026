import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createGraphStore } from '../src/server/context/store';
import { migrate } from '../src/server/db/migrate';
import { createPool } from '../src/server/db/pool';
import { proposalModelFromEnv } from '../src/server/proposals/model';
import { proposeContext } from '../src/server/proposals/propose';

// Usage: npm run propose -- <projectId> [notes-file] [--task "hint"]   (reads stdin without a file)
const args = process.argv.slice(2);
const taskIndex = args.indexOf('--task');
const taskHint = taskIndex >= 0 ? args[taskIndex + 1] : undefined;
const positional = args.filter((arg, index) => arg !== '--task' && index !== taskIndex + 1);
const [projectId, file] = positional;
if (!projectId) {
  console.error('Usage: npm run propose -- <projectId> [notes-file] [--task "hint"]');
  process.exit(2);
}
const model = proposalModelFromEnv();
if (!model) {
  console.error('ANTHROPIC_API_KEY is required for proposals');
  process.exit(2);
}
const text = file
  ? await readFile(file, 'utf8')
  : await new Promise<string>((resolve) => {
      let buffer = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => (buffer += chunk));
      process.stdin.on('end', () => resolve(buffer));
    });

const pool = createPool();
await migrate(pool);
const store = createGraphStore(pool);
try {
  const result = await proposeContext(
    { store, model, log: (event) => console.error(event) },
    projectId,
    { text, ...(taskHint !== undefined && { taskHint }) },
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await store.close();
}

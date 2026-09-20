import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createGraphStore } from '../src/server/context/store';
import { createPool } from '../src/server/db/pool';
import { migrate } from '../src/server/db/migrate';
import { importPreparedProject } from '../src/server/ingestion/import';
import { GraphError } from '../src/server/context/errors';

// Usage: npm run import:manifest -- <path-to-manifest.json>
const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run import:manifest -- <path-to-manifest.json>');
  process.exit(2);
}
const bytes = await readFile(file);
const pool = createPool();
await migrate(pool);
const store = createGraphStore(pool);
try {
  console.log(JSON.stringify(await importPreparedProject(bytes, store)));
} catch (error) {
  if (error instanceof GraphError && error.code === 'CONFLICT') {
    console.error('That project already exists; open it instead of re-importing.');
    process.exitCode = 1;
  } else if (error instanceof GraphError) {
    console.error(`${error.code}: ${error.message} ${JSON.stringify(error.details ?? {})}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await store.close();
}

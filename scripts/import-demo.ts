import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createGraphStore } from '../src/server/context/store.js';
import { createPool } from '../src/server/db/pool.js';
import { migrate } from '../src/server/db/migrate.js';
import { importPreparedProject } from '../src/server/ingestion/import.js';
import { GraphError } from '../src/server/context/errors.js';
import { DEMO_PROJECT_ID } from '../src/server/ingestion/demo-expectations.js';

const bytes = await readFile(new URL('../fixtures/demo-payments.json', import.meta.url));
const pool = createPool();
await migrate(pool);
const store = createGraphStore(pool);
try {
  const result = await importPreparedProject(bytes, store);
  console.log(JSON.stringify({ ...result, label: 'synthetic prepared example' }));
} catch (error) {
  if (error instanceof GraphError && error.code === 'CONFLICT') {
    console.error(
      `Demo project ${DEMO_PROJECT_ID} already exists; open it instead of re-importing.`,
    );
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await store.close();
}

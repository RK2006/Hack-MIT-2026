import 'dotenv/config';
import { createPool } from './pool.js';
import { migrate } from './migrate.js';

const pool = createPool();
try {
  const applied = await migrate(pool);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
} finally {
  await pool.end();
}

import 'dotenv/config';
import { createPool } from './pool';
import { migrate } from './migrate';

const pool = createPool();
try {
  const applied = await migrate(pool);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
} finally {
  await pool.end();
}

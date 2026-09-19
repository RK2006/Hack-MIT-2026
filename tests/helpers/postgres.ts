import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrate } from '../../src/server/db/migrate.js';

export async function isolatedDatabase() {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString)
    throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests');
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
  await migrate(pool);
  return {
    pool,
    schema,
    connectionString,
    cleanup: async () => {
      await pool.end().catch(() => undefined);
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    },
  };
}

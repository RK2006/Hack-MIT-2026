import type { Pool } from 'pg';

export type Migration = { version: string; sql: string };

export async function productionMigrations(): Promise<Migration[]> {
  const { MIGRATIONS } = await import('./migrations');
  return MIGRATIONS;
}

export async function migrate(pool: Pool, migrations?: Migration[]): Promise<string[]> {
  const orderedMigrations = migrations ?? (await productionMigrations());
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    for (const migration of orderedMigrations) {
      const exists = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [
        migration.version,
      ]);
      if (exists.rowCount) continue;
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [migration.version]);
      applied.push(migration.version);
    }
    await client.query('COMMIT');
    return applied;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

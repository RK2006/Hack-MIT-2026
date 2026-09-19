import type { Pool } from 'pg';
import { graphError } from '../errors';

export type EmbeddingKey = { nodeId: string; version: number };
export type CachedEmbedding = EmbeddingKey & { vector: number[] };

export type EmbeddingCache = {
  get(projectId: string, providerModel: string, keys: EmbeddingKey[]): Promise<CachedEmbedding[]>;
  put(projectId: string, providerModel: string, rows: CachedEmbedding[]): Promise<void>;
};

/** Derived-vector cache keyed by (node, version, model); rows are never canonical knowledge. */
export function createEmbeddingCache(pool: Pool): EmbeddingCache {
  return {
    async get(projectId, providerModel, keys) {
      if (keys.length === 0) return [];
      try {
        const result = await pool.query(
          `SELECT node_id, version, vector FROM context_embeddings
           WHERE project_id=$1 AND provider_model=$2
             AND (node_id, version) IN (SELECT unnest($3::uuid[]), unnest($4::int[]))`,
          [projectId, providerModel, keys.map((k) => k.nodeId), keys.map((k) => k.version)],
        );
        return result.rows.map((row) => ({
          nodeId: row.node_id as string,
          version: row.version as number,
          vector: (row.vector as number[]).map(Number),
        }));
      } catch {
        throw graphError('STORAGE_ERROR', 'Embedding cache read failed');
      }
    },
    async put(projectId, providerModel, rows) {
      if (rows.length === 0) return;
      try {
        for (let offset = 0; offset < rows.length; offset += 100) {
          const batch = rows.slice(offset, offset + 100);
          const values: unknown[] = [projectId, providerModel];
          const tuples = batch.map((row) => {
            values.push(row.nodeId, row.version, row.vector.length, row.vector);
            const base = values.length - 4;
            return `($1, $${base + 1}::uuid, $${base + 2}::int, $2, $${base + 3}::int, $${base + 4}::float8[])`;
          });
          await pool.query(
            `INSERT INTO context_embeddings(project_id, node_id, version, provider_model, dimensions, vector)
             VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING`,
            values,
          );
        }
      } catch {
        throw graphError('STORAGE_ERROR', 'Embedding cache write failed');
      }
    },
  };
}

export function memoryEmbeddingCache(): EmbeddingCache {
  const rows = new Map<string, number[]>();
  const keyOf = (p: string, m: string, k: EmbeddingKey) => `${p}\0${m}\0${k.nodeId}\0${k.version}`;
  return {
    async get(projectId, providerModel, keys) {
      return keys.flatMap((k) => {
        const vector = rows.get(keyOf(projectId, providerModel, k));
        return vector ? [{ ...k, vector }] : [];
      });
    },
    async put(projectId, providerModel, entries) {
      for (const entry of entries) {
        const key = keyOf(projectId, providerModel, entry);
        if (!rows.has(key)) rows.set(key, entry.vector);
      }
    },
  };
}

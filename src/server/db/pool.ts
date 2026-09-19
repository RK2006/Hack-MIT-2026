import { Pool, type PoolConfig } from 'pg';
import { graphError } from '../context/errors.js';

export function createPool(
  connectionString = process.env.DATABASE_URL,
  config: PoolConfig = {},
): Pool {
  if (!connectionString) throw graphError('STORAGE_ERROR', 'DATABASE_URL is not configured');
  return new Pool({ connectionString, max: 10, ...config });
}

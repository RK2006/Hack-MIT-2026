import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGraphStore } from '../../src/server/context/store';
import type { GraphStore } from '../../src/server/context/types';
import { importPreparedProject } from '../../src/server/ingestion/import';
import { scanRepository } from '../../src/server/ingestion/scan';
import { isolatedDatabase } from '../helpers/postgres';

describe('scanning this repository into PostgreSQL (A3)', () => {
  let db: Awaited<ReturnType<typeof isolatedDatabase>>;
  let store: GraphStore;

  beforeAll(async () => {
    db = await isolatedDatabase();
    store = createGraphStore(db.pool);
  });
  afterAll(async () => {
    await db.cleanup();
  });

  it('imports the scan and conflicts on repeat', async () => {
    const { manifest, stats } = await scanRepository(new URL('../..', import.meta.url).pathname, {
      include: ['src', 'docs'],
    });
    const bytes = Buffer.from(JSON.stringify(manifest));
    const result = await importPreparedProject(bytes, store);
    expect(result.nodes).toBe(stats.files + stats.components);
    expect(result.edges).toBe(stats.files + stats.components - 1);
    const graph = await store.getGraph(result.projectId);
    expect(graph.nodes.every((n) => n.current.authority === 'canonical')).toBe(true);
    expect(graph.nodes.every((n) => n.current.actor.kind === 'importer')).toBe(true);
    const compile = graph.nodes.find((n) => n.path === 'src/server/context/compiler/compile.ts');
    expect(compile?.type).toBe('file');
    const parent = graph.edges.find((e) => e.toNodeId === compile!.id && e.type === 'CONTAINS');
    expect(graph.nodes.find((n) => n.id === parent!.fromNodeId)?.externalKey).toBe(
      'component.src-server',
    );
    await expect(importPreparedProject(bytes, store)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

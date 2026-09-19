import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { describe, expect, it, afterEach } from 'vitest';
import { createGraphStore } from '../../src/server/context/store';
import { snapshotOf, type GraphStore } from '../../src/server/context/types';
import { importPreparedProject } from '../../src/server/ingestion/import';
import { DEMO_PROJECT_ID } from '../../src/server/ingestion/demo-expectations';
import { isolatedDatabase } from '../helpers/postgres';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});
const fixture = () => readFile(new URL('../../fixtures/demo-payments.json', import.meta.url));

describe('prepared project import on PostgreSQL', () => {
  it('atomically persists the deterministic fixture with provenance and authority', async () => {
    const db = await isolatedDatabase();
    cleanups.push(db.cleanup);
    const store = createGraphStore(db.pool);
    const result = await importPreparedProject(await fixture(), store);
    expect(result).toMatchObject({
      schemaVersion: 1,
      projectId: DEMO_PROJECT_ID,
      sources: 3,
      nodes: 29,
      edges: 34,
    });
    expect(result.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    const graph = await store.getGraph(DEMO_PROJECT_ID);
    expect(graph.nodes).toHaveLength(29);
    expect(graph.edges).toHaveLength(34);
    const bug = graph.nodes.find(
      (node) => node.externalKey === 'bug.repeated-delivery-side-effects',
    )!;
    const decision = graph.nodes.find(
      (node) => node.externalKey === 'decision.record-before-side-effects',
    )!;
    expect(bug.current).toMatchObject({
      authority: 'inferred',
      version: 1,
      actor: { kind: 'agent' },
    });
    expect(decision.current).toMatchObject({
      authority: 'canonical',
      version: 1,
      actor: { kind: 'human' },
    });
    const repositorySource = await store.getSource(
      DEMO_PROJECT_ID,
      graph.nodes.find((node) => node.type === 'file')!.current.sourceId,
    );
    expect(repositorySource).toMatchObject({ kind: 'repository', revisionRef: result.digest });
    await store.close();
    const reopened = createGraphStore(
      new Pool({
        connectionString: db.connectionString,
        options: `-c search_path=${db.schema}`,
      }),
    );
    const persisted = await reopened.getGraph(DEMO_PROJECT_ID);
    expect(persisted.nodes).toHaveLength(29);
    expect(persisted.edges.map((edge) => edge.type)).toEqual(
      expect.arrayContaining(['CONTAINS', 'DEPENDS_ON', 'REQUIRES', 'IMPLEMENTS']),
    );
    expect(await reopened.listRevisions(DEMO_PROJECT_ID, bug.id)).toHaveLength(1);
    await reopened.close();
  });

  it('conflicts on repeat import after a human edit without changing rows', async () => {
    const db = await isolatedDatabase();
    cleanups.push(db.cleanup);
    const store = createGraphStore(db.pool);
    const bytes = await fixture();
    await importPreparedProject(bytes, store);
    const bug = (await store.getGraph(DEMO_PROJECT_ID)).nodes.find(
      (node) => node.externalKey === 'bug.repeated-delivery-side-effects',
    )!;
    await store.transaction(async (tx) => {
      const source = await tx.createSource(DEMO_PROJECT_ID, {
        kind: 'manual',
        uri: 'manual://demo/review',
        label: 'Review',
        excerpt: 'Reviewed synthetic prepared example',
        revisionRef: null,
      });
      await tx.reviseNode(DEMO_PROJECT_ID, bug.id, {
        expectedVersion: 1,
        snapshot: { ...snapshotOf(bug), authority: 'canonical', sourceId: source.id },
        actor: { kind: 'human', label: 'reviewer' },
        changeReason: 'reviewed',
      });
    });
    const countSql = `SELECT (SELECT count(*)::int FROM projects) projects,
      (SELECT count(*)::int FROM context_sources) sources,
      (SELECT count(*)::int FROM context_nodes) nodes,
      (SELECT count(*)::int FROM context_revisions) revisions,
      (SELECT count(*)::int FROM context_edges) edges`;
    const before = await db.pool.query(countSql);
    await expect(importPreparedProject(bytes, store)).rejects.toMatchObject({ code: 'CONFLICT' });
    const after = await db.pool.query(countSql);
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect((await store.getNode(DEMO_PROJECT_ID, bug.id)).current.version).toBe(2);
  });

  it('rolls back an injected mid-import failure', async () => {
    const db = await isolatedDatabase();
    cleanups.push(db.cleanup);
    const real = createGraphStore(db.pool);
    let created = 0;
    const failing: GraphStore = {
      ...real,
      transaction: (work) =>
        real.transaction((tx) =>
          work(
            new Proxy(tx, {
              get(target, property, receiver) {
                if (property !== 'createNode') return Reflect.get(target, property, receiver);
                return async (...args: Parameters<typeof tx.createNode>) => {
                  created += 1;
                  if (created === 3) throw new Error('injected import failure');
                  return tx.createNode(...args);
                };
              },
            }),
          ),
        ),
    };
    await expect(importPreparedProject(await fixture(), failing)).rejects.toMatchObject({
      code: 'STORAGE_ERROR',
    });
    expect(
      (
        await db.pool.query('SELECT count(*)::int count FROM projects WHERE id=$1', [
          DEMO_PROJECT_ID,
        ])
      ).rows[0].count,
    ).toBe(0);
  });

  it('allows exactly one of two concurrent imports', async () => {
    const db = await isolatedDatabase();
    cleanups.push(db.cleanup);
    const store = createGraphStore(db.pool);
    const bytes = await fixture();
    const results = await Promise.allSettled([
      importPreparedProject(bytes, store),
      importPreparedProject(bytes, store),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'CONFLICT' });
    expect((await store.getGraph(DEMO_PROJECT_ID)).nodes).toHaveLength(29);
  });
});

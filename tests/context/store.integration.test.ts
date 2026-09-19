import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { createGraphStore } from '../../src/server/context/store';
import { snapshotOf } from '../../src/server/context/types';
import { migrate } from '../../src/server/db/migrate';
import { isolatedDatabase } from '../helpers/postgres';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function setup() {
  const db = await isolatedDatabase();
  cleanups.push(db.cleanup);
  const store = createGraphStore(db.pool);
  const created = await store.transaction(async (tx) => {
    const project = await tx.createProject({ name: 'Payments demo' });
    const manual = await tx.createSource(project.id, {
      kind: 'manual',
      uri: 'manual://operator/seed',
      label: 'Seed note',
      excerpt: 'Synthetic note',
      revisionRef: null,
    });
    const first = await tx.createNode(project.id, {
      type: 'component',
      externalKey: 'payments',
      title: 'Payments',
      content: 'Payments component',
      authority: 'canonical',
      sourceId: manual.id,
      actor: { kind: 'human', label: 'operator' },
      changeReason: 'create',
    });
    const second = await tx.createNode(project.id, {
      type: 'constraint',
      externalKey: 'unique-event',
      title: 'Unique events',
      content: 'Event IDs are unique',
      authority: 'canonical',
      sourceId: manual.id,
      actor: { kind: 'human', label: 'operator' },
      changeReason: 'create',
    });
    const edge = await tx.createEdge(project.id, {
      fromNodeId: first.id,
      toNodeId: second.id,
      type: 'REQUIRES',
      authority: 'canonical',
      sourceId: manual.id,
      actor: { kind: 'human', label: 'operator' },
    });
    return { project, manual, first, second, edge };
  });
  return { ...db, store, ...created };
}

describe('PostgreSQL graph store', () => {
  it('migrates repeatably and persists a directed graph with evidence', async () => {
    const data = await setup();
    expect(await migrate(data.pool)).toEqual([]);
    const graph = await data.store.getGraph(data.project.id);
    expect(graph.nodes.map((node) => node.id).sort()).toEqual(
      [data.first.id, data.second.id].sort(),
    );
    expect(graph.edges[0]).toMatchObject({
      fromNodeId: data.first.id,
      toNodeId: data.second.id,
      type: 'REQUIRES',
    });
    expect(await data.store.getSource(data.project.id, data.manual.id)).toMatchObject({
      excerpt: 'Synthetic note',
    });
    await data.store.close();
    const reopened = createGraphStore(
      new Pool({
        connectionString: data.connectionString,
        options: `-c search_path=${data.schema}`,
      }),
    );
    expect(await reopened.getGraph(data.project.id)).toMatchObject({
      project: { id: data.project.id },
      nodes: expect.arrayContaining([expect.objectContaining({ id: data.first.id })]),
      edges: [expect.objectContaining({ id: data.edge.id })],
    });
    await reopened.close();
  });

  it('preserves immutable history through archive and restore', async () => {
    const data = await setup();
    const archiveSource = await data.store.transaction((tx) =>
      tx.createSource(data.project.id, {
        kind: 'manual',
        uri: 'manual://operator/archive',
        label: 'Archive',
        excerpt: 'No longer active',
        revisionRef: null,
      }),
    );
    await data.store.transaction((tx) =>
      tx.reviseNode(data.project.id, data.second.id, {
        expectedVersion: 1,
        actor: { kind: 'human', label: 'operator' },
        changeReason: 'archive',
        snapshot: { ...snapshotOf(data.second), archived: true, sourceId: archiveSource.id },
      }),
    );
    expect((await data.store.getGraph(data.project.id)).nodes).toHaveLength(1);
    expect((await data.store.getGraph(data.project.id)).edges).toHaveLength(0);
    const history = await data.store.listRevisions(data.project.id, data.second.id);
    expect(history.map((revision) => revision.version)).toEqual([1, 2]);
    expect(history[0]?.content).toBe('Event IDs are unique');
  });

  it('rejects stale concurrent revisions and keeps one successor', async () => {
    const data = await setup();
    const [sourceA, sourceB] = await data.store.transaction(async (tx) => {
      const a = await tx.createSource(data.project.id, {
        kind: 'manual',
        uri: 'manual://operator/a',
        label: 'A',
        excerpt: 'A',
        revisionRef: null,
      });
      const b = await tx.createSource(data.project.id, {
        kind: 'manual',
        uri: 'manual://operator/b',
        label: 'B',
        excerpt: 'B',
        revisionRef: null,
      });
      return [a, b];
    });
    const revise = (sourceId: string, content: string) =>
      data.store.transaction((tx) =>
        tx.reviseNode(data.project.id, data.first.id, {
          expectedVersion: 1,
          actor: { kind: 'human', label: 'operator' },
          changeReason: content,
          snapshot: { ...snapshotOf(data.first), content, sourceId },
        }),
      );
    const results = await Promise.allSettled([
      revise(sourceA.id, 'one'),
      revise(sourceB.id, 'two'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await data.store.listRevisions(data.project.id, data.first.id)).toHaveLength(2);
  });

  it('rolls back a caught operation failure and maps duplicates', async () => {
    const data = await setup();
    const id = randomUUID();
    await expect(
      data.store.transaction(async (tx) => {
        try {
          await tx.getProject(id);
        } catch {
          /* deliberately caught */
        }
        await tx.createSource(data.project.id, {
          kind: 'manual',
          uri: 'manual://operator/rolled-back',
          label: 'Rollback',
          excerpt: 'rollback',
          revisionRef: null,
        });
      }),
    ).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    await expect(
      data.store.transaction((tx) =>
        tx.createEdge(data.project.id, {
          fromNodeId: data.first.id,
          toNodeId: data.second.id,
          type: 'REQUIRES',
          authority: 'canonical',
          sourceId: data.manual.id,
          actor: { kind: 'human', label: 'operator' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('preserves no-op versions and rejects stale no-ops', async () => {
    const data = await setup();
    const noOp = await data.store.transaction((tx) =>
      tx.reviseNode(data.project.id, data.first.id, {
        expectedVersion: 1,
        snapshot: snapshotOf(data.first),
        actor: { kind: 'human', label: 'operator' },
        changeReason: 'same values',
      }),
    );
    expect(noOp).toMatchObject({ changed: false, node: { current: { version: 1 } } });
    const source = await data.store.transaction((tx) =>
      tx.createSource(data.project.id, {
        kind: 'manual',
        uri: 'manual://operator/change',
        label: 'Change',
        excerpt: 'change',
        revisionRef: null,
      }),
    );
    await data.store.transaction((tx) =>
      tx.reviseNode(data.project.id, data.first.id, {
        expectedVersion: 1,
        snapshot: { ...snapshotOf(data.first), content: 'changed', sourceId: source.id },
        actor: { kind: 'human', label: 'operator' },
        changeReason: 'change',
      }),
    );
    await expect(
      data.store.transaction((tx) =>
        tx.reviseNode(data.project.id, data.first.id, {
          expectedVersion: 1,
          snapshot: snapshotOf(data.first),
          actor: { kind: 'human', label: 'operator' },
          changeReason: 'stale no-op',
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('authorizes before reporting a stale version', async () => {
    const data = await setup();
    const source = await data.store.transaction((tx) =>
      tx.createSource(data.project.id, {
        kind: 'agent',
        uri: 'agent://reviewer/suggestion',
        label: 'Suggestion',
        excerpt: 'suggestion',
        revisionRef: null,
      }),
    );
    await expect(
      data.store.transaction((tx) =>
        tx.reviseNode(data.project.id, data.first.id, {
          expectedVersion: 999,
          snapshot: { ...snapshotOf(data.first), authority: 'inferred', sourceId: source.id },
          actor: { kind: 'agent', label: 'reviewer' },
          changeReason: 'suggest',
        }),
      ),
    ).rejects.toMatchObject({ code: 'AUTHORITY_VIOLATION' });
  });

  it('rejects nested transactions without waiting on a project lock', async () => {
    const data = await setup();
    await expect(
      data.store.transaction(async () => data.store.transaction(async () => undefined)),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rolls back when a nested-transaction error is caught', async () => {
    const data = await setup();
    await expect(
      data.store.transaction(async (tx) => {
        try {
          await data.store.transaction(async () => undefined);
        } catch {
          /* deliberately caught */
        }
        await tx.createSource(data.project.id, {
          kind: 'manual',
          uri: 'manual://operator/caught-nested',
          label: 'Caught nested',
          excerpt: 'must roll back',
          revisionRef: null,
        });
      }),
    ).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    const count = await data.pool.query(
      "SELECT count(*)::int count FROM context_sources WHERE uri='manual://operator/caught-nested'",
    );
    expect(count.rows[0].count).toBe(0);
  });

  it('restores incident edges after unarchive and rejects edges while archived', async () => {
    const data = await setup();
    const source = await data.store.transaction((tx) =>
      tx.createSource(data.project.id, {
        kind: 'manual',
        uri: 'manual://operator/archive-cycle',
        label: 'Archive cycle',
        excerpt: 'cycle',
        revisionRef: null,
      }),
    );
    const archived = await data.store.transaction((tx) =>
      tx.reviseNode(data.project.id, data.second.id, {
        expectedVersion: 1,
        snapshot: { ...snapshotOf(data.second), archived: true, sourceId: source.id },
        actor: { kind: 'human', label: 'operator' },
        changeReason: 'archive',
      }),
    );
    await expect(
      data.store.transaction((tx) =>
        tx.createEdge(data.project.id, {
          fromNodeId: data.second.id,
          toNodeId: data.first.id,
          type: 'AFFECTS',
          authority: 'canonical',
          sourceId: source.id,
          actor: { kind: 'human', label: 'operator' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await data.store.transaction((tx) =>
      tx.reviseNode(data.project.id, data.second.id, {
        expectedVersion: 2,
        snapshot: { ...snapshotOf(archived.node), archived: false },
        actor: { kind: 'human', label: 'operator' },
        changeReason: 'restore',
      }),
    );
    expect((await data.store.getGraph(data.project.id)).edges).toHaveLength(1);
  });

  it('rejects cross-project evidence', async () => {
    const data = await setup();
    const other = await data.store.transaction(async (tx) => {
      const project = await tx.createProject({ name: 'Other' });
      const source = await tx.createSource(project.id, {
        kind: 'manual',
        uri: 'manual://other/source',
        label: 'Other',
        excerpt: 'other',
        revisionRef: null,
      });
      return { project, source };
    });
    await expect(
      data.store.transaction((tx) =>
        tx.createNode(data.project.id, {
          type: 'bug',
          title: 'Foreign',
          content: 'foreign',
          authority: 'canonical',
          sourceId: other.source.id,
          actor: { kind: 'human', label: 'operator' },
          changeReason: 'invalid',
        }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects duplicate identities, wrong-project reads, and direct composite-FK violations', async () => {
    const data = await setup();
    await expect(
      data.store.transaction((tx) =>
        tx.createNode(data.project.id, {
          type: 'component',
          externalKey: 'payments',
          title: 'Duplicate',
          content: 'duplicate',
          authority: 'canonical',
          sourceId: data.manual.id,
          actor: { kind: 'human', label: 'operator' },
          changeReason: 'duplicate',
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { key: 'externalKey' } });
    const other = await data.store.transaction((tx) => tx.createProject({ name: 'Isolation' }));
    await expect(data.store.getNode(other.id, data.first.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      data.pool.query(
        `INSERT INTO context_edges(id,project_id,from_node_id,to_node_id,type,authority,source_id,actor)
       VALUES($1,$2,$3,$4,'AFFECTS','canonical',$5,'{"kind":"human","label":"probe"}'::jsonb)`,
        [randomUUID(), other.id, data.first.id, data.second.id, data.manual.id],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('preserves every mutable snapshot field and provenance', async () => {
    const data = await setup();
    const source = await data.store.transaction((tx) =>
      tx.createSource(data.project.id, {
        kind: 'manual',
        uri: 'manual://operator/all-fields',
        label: 'All fields',
        excerpt: 'all fields',
        revisionRef: null,
      }),
    );
    await data.store.transaction((tx) =>
      tx.reviseNode(data.project.id, data.first.id, {
        expectedVersion: 1,
        actor: { kind: 'human', label: 'reviewer' },
        changeReason: 'change all fields',
        snapshot: {
          title: 'New title',
          content: 'New content',
          summary: 'New summary',
          authority: 'inferred',
          importance: 5,
          confidence: 0.25,
          archived: true,
          sourceId: source.id,
        },
      }),
    );
    const history = await data.store.listRevisions(data.project.id, data.first.id);
    expect(history[0]).toMatchObject({
      title: 'Payments',
      content: 'Payments component',
      authority: 'canonical',
      sourceId: data.manual.id,
    });
    expect(history[1]).toMatchObject({
      title: 'New title',
      content: 'New content',
      summary: 'New summary',
      authority: 'inferred',
      importance: 5,
      confidence: 0.25,
      archived: true,
      sourceId: source.id,
      actor: { kind: 'human', label: 'reviewer' },
      changeReason: 'change all fields',
    });
  });

  it('supports empty graphs and cycles with deterministic transaction reads', async () => {
    const data = await setup();
    const empty = await data.store.transaction((tx) => tx.createProject({ name: 'Empty graph' }));
    expect(await data.store.getGraph(empty.id)).toMatchObject({ nodes: [], edges: [] });
    await expect(
      data.store.transaction((tx) =>
        tx.createEdge(data.project.id, {
          fromNodeId: data.first.id,
          toNodeId: data.first.id,
          type: 'RELATED_TO',
          authority: 'canonical',
          sourceId: data.manual.id,
          actor: { kind: 'human', label: 'operator' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await data.store.transaction((tx) =>
      tx.createEdge(data.project.id, {
        fromNodeId: data.second.id,
        toNodeId: data.first.id,
        type: 'RELATED_TO',
        authority: 'canonical',
        sourceId: data.manual.id,
        actor: { kind: 'human', label: 'operator' },
      }),
    );
    const graph = await data.store.transaction((tx) => tx.getGraph(data.project.id));
    expect(graph.nodes.map((node) => node.id)).toEqual(
      [...graph.nodes.map((node) => node.id)].sort(),
    );
    expect(graph.edges.map((edge) => edge.id)).toEqual(
      [...graph.edges.map((edge) => edge.id)].sort(),
    );
    expect(graph.edges).toHaveLength(2);
  });

  it('counts archived identities toward the atomic node limit', async () => {
    const data = await setup();
    const seeded = await data.store.transaction(async (tx) => {
      const project = await tx.createProject({ name: 'At node limit' });
      const source = await tx.createSource(project.id, {
        kind: 'manual',
        uri: 'manual://limit/source',
        label: 'Limit',
        excerpt: 'limit',
        revisionRef: null,
      });
      return { project, source };
    });
    const ids = Array.from({ length: 999 }, () => randomUUID());
    await data.pool.query(
      `INSERT INTO context_nodes(id,project_id,type) SELECT value,$1,'component' FROM unnest($2::uuid[]) value`,
      [seeded.project.id, ids],
    );
    await data.pool.query(
      `INSERT INTO context_revisions(project_id,node_id,version,title,content,summary,authority,
        importance,confidence,archived,source_id,actor,change_reason)
       SELECT $1,value,1,'Seed','seed','','canonical',1,1,(ordinality=1),$2,
        '{"kind":"human","label":"limit-test"}'::jsonb,'limit seed'
       FROM unnest($3::uuid[]) WITH ORDINALITY AS values(value,ordinality)`,
      [seeded.project.id, seeded.source.id, ids],
    );
    await data.store.transaction((tx) =>
      tx.createNode(seeded.project.id, {
        type: 'component',
        title: 'Last node',
        content: 'last',
        authority: 'canonical',
        sourceId: seeded.source.id,
        actor: { kind: 'human', label: 'operator' },
        changeReason: 'last slot',
      }),
    );
    await expect(
      data.store.transaction((tx) =>
        tx.createNode(seeded.project.id, {
          type: 'component',
          title: 'Too many',
          content: 'overflow',
          authority: 'canonical',
          sourceId: seeded.source.id,
          actor: { kind: 'human', label: 'operator' },
          changeReason: 'overflow',
        }),
      ),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('serializes competing writers for the last edge slot', async () => {
    const data = await setup();
    const seeded = await data.store.transaction(async (tx) => {
      const project = await tx.createProject({ name: 'At edge limit' });
      const source = await tx.createSource(project.id, {
        kind: 'manual',
        uri: 'manual://edge-limit/source',
        label: 'Edge limit',
        excerpt: 'edge limit',
        revisionRef: null,
      });
      const nodes = [];
      for (let index = 0; index < 27; index += 1) {
        nodes.push(
          await tx.createNode(project.id, {
            type: 'component',
            externalKey: `limit-${index}`,
            title: `Node ${index}`,
            content: 'limit node',
            authority: 'canonical',
            sourceId: source.id,
            actor: { kind: 'human', label: 'operator' },
            changeReason: 'seed',
          }),
        );
      }
      return { project, source, nodes };
    });
    const types = [
      'CONTAINS',
      'DEPENDS_ON',
      'IMPLEMENTS',
      'REQUIRES',
      'CONSTRAINS',
      'AFFECTS',
      'CAUSED_BY',
      'RELATED_TO',
    ] as const;
    const combinations: Array<{ from: string; to: string; type: (typeof types)[number] }> = [];
    for (const from of seeded.nodes)
      for (const to of seeded.nodes)
        if (from.id !== to.id)
          for (const type of types) combinations.push({ from: from.id, to: to.id, type });
    const initial = combinations.slice(0, 4_999);
    await data.pool.query(
      `INSERT INTO context_edges(id,project_id,from_node_id,to_node_id,type,authority,source_id,actor)
       SELECT ids,$1,from_ids,to_ids,types,'canonical',$2,'{"kind":"human","label":"limit-test"}'::jsonb
       FROM unnest($3::uuid[],$4::uuid[],$5::uuid[],$6::text[]) values(ids,from_ids,to_ids,types)`,
      [
        seeded.project.id,
        seeded.source.id,
        initial.map(() => randomUUID()),
        initial.map((item) => item.from),
        initial.map((item) => item.to),
        initial.map((item) => item.type),
      ],
    );
    const create = (item: (typeof combinations)[number]) =>
      data.store.transaction((tx) =>
        tx.createEdge(seeded.project.id, {
          fromNodeId: item.from,
          toNodeId: item.to,
          type: item.type,
          authority: 'canonical',
          sourceId: seeded.source.id,
          actor: { kind: 'human', label: 'operator' },
        }),
      );
    const results = await Promise.allSettled([
      create(combinations[4_999]!),
      create(combinations[5_000]!),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(
      (
        await data.pool.query('SELECT count(*)::int count FROM context_edges WHERE project_id=$1', [
          seeded.project.id,
        ])
      ).rows[0].count,
    ).toBe(5_000);
  });

  it('rolls back a newly created project after a later failure', async () => {
    const data = await setup();
    const projectId = randomUUID();
    await expect(
      data.store.transaction(async (tx) => {
        await tx.createProject({ id: projectId, name: 'Must roll back' });
        await tx.createSource(projectId, {
          kind: 'manual',
          uri: 'manual://rollback/new-project',
          label: 'Rollback',
          excerpt: 'rollback',
          revisionRef: null,
        });
        throw new Error('injected failure');
      }),
    ).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    await expect(data.store.getProject(projectId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rolls back a failed migration and its marker', async () => {
    const db = await isolatedDatabase();
    cleanups.push(db.cleanup);
    await expect(
      migrate(db.pool, [
        { version: 'broken', sql: 'CREATE TABLE transient(id int); SELECT nope FROM missing' },
      ]),
    ).rejects.toBeTruthy();
    const tables = await db.pool.query("SELECT to_regclass('transient') value");
    expect(tables.rows[0].value).toBeNull();
    expect(
      (await db.pool.query("SELECT * FROM schema_migrations WHERE version='broken'")).rowCount,
    ).toBe(0);
  });
});

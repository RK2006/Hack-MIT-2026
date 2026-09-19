import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGraphStore } from '../../src/server/context/store';
import type { ContextEdge, ContextNode, GraphSnapshot } from '../../src/server/context/types';
import { DEMO_PROJECT_ID } from '../../src/server/ingestion/demo-expectations';
import { importPreparedProject } from '../../src/server/ingestion/import';
import { errorResponse } from '../../src/server/http';
import {
  handleCreateNode,
  handleGetGraph,
  handleGetNode,
  handleGetSource,
  handleListNodes,
  handleListProjects,
  handleListRevisions,
  handleReviseNode,
} from '../../src/server/workbench/handlers';
import { isolatedDatabase } from '../helpers/postgres';

const ORIGIN = 'http://127.0.0.1:3000';
const base = `${ORIGIN}/api/projects/${DEMO_PROJECT_ID}`;

/** Mirrors the `route()` wrapper: typed errors become the JSON envelope instead of throwing. */
const call = async (work: () => Promise<Response>) => {
  try {
    return await work();
  } catch (error) {
    return errorResponse(error);
  }
};
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });

let db: Awaited<ReturnType<typeof isolatedDatabase>>;
let store: ReturnType<typeof createGraphStore>;
let graph: GraphSnapshot;

beforeAll(async () => {
  db = await isolatedDatabase();
  store = createGraphStore(db.pool);
  await importPreparedProject(
    await readFile(new URL('../../fixtures/demo-payments.json', import.meta.url)),
    store,
  );
  graph = (await handleGetGraph(store, { projectId: DEMO_PROJECT_ID }).then((r) =>
    r.json(),
  )) as GraphSnapshot;
});
afterAll(async () => {
  await db.cleanup();
});

const byKey = (key: string) => graph.nodes.find((node) => node.externalKey === key)!;

describe('workbench read routes', () => {
  it('lists projects', async () => {
    const response = await handleListProjects(store);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.projects).toEqual([expect.objectContaining({ id: DEMO_PROJECT_ID })]);
  });

  it('returns the active graph snapshot with directed edges', async () => {
    expect(graph.project.id).toBe(DEMO_PROJECT_ID);
    expect(graph.nodes).toHaveLength(29);
    expect(graph.edges).toHaveLength(34);
    const requires = graph.edges.find((edge) => edge.type === 'REQUIRES')!;
    expect(graph.nodes.map((node) => node.id)).toContain(requires.fromNodeId);
    expect(graph.nodes.map((node) => node.id)).toContain(requires.toNodeId);
  });

  it('returns a node, its revisions, and its source', async () => {
    const bug = byKey('bug.repeated-delivery-side-effects');
    const node = (await handleGetNode(store, { projectId: DEMO_PROJECT_ID, nodeId: bug.id }).then(
      (r) => r.json(),
    )) as ContextNode;
    expect(node.current).toMatchObject({ authority: 'inferred', version: 1 });
    const revisions = await handleListRevisions(store, {
      projectId: DEMO_PROJECT_ID,
      nodeId: bug.id,
    }).then((r) => r.json());
    expect(revisions.revisions).toHaveLength(1);
    const source = await handleGetSource(store, {
      projectId: DEMO_PROJECT_ID,
      sourceId: node.current.sourceId,
    }).then((r) => r.json());
    expect(source).toMatchObject({ id: node.current.sourceId, kind: 'agent' });
  });

  it('maps unknown nodes and projects to 404', async () => {
    const response = await call(() =>
      handleGetNode(store, {
        projectId: DEMO_PROJECT_ID,
        nodeId: '00000000-0000-4000-8000-000000000000',
      }),
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_FOUND');
  });

  it('rejects the nodes list without archived=true', async () => {
    const response = await call(() =>
      handleListNodes(store, new Request(`${base}/nodes`), { projectId: DEMO_PROJECT_ID }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('workbench mutation routes', () => {
  it('creates a node with an incoming edge stored as other → new and fresh manual evidence', async () => {
    const other = byKey('bug.repeated-delivery-side-effects');
    const response = await call(() =>
      handleCreateNode(
        store,
        post(`${base}/nodes`, {
          evidenceNote: 'Operator observed this during review.',
          changeReason: 'Record operator decision',
          node: {
            type: 'decision',
            title: 'Persist receipts before side effects',
            content: 'Receipts are written before any side effect runs.',
            authority: 'canonical',
          },
          edge: {
            otherNodeId: other.id,
            type: 'AFFECTS',
            direction: 'incoming',
            authority: 'canonical',
          },
        }),
        { projectId: DEMO_PROJECT_ID },
      ),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { node: ContextNode; edge: ContextEdge };
    expect(body.node.current).toMatchObject({
      version: 1,
      authority: 'canonical',
      actor: { kind: 'human', label: 'local-operator' },
      changeReason: 'Record operator decision',
    });
    expect(body.edge).toMatchObject({
      fromNodeId: other.id,
      toNodeId: body.node.id,
      type: 'AFFECTS',
      sourceId: body.node.current.sourceId,
    });
    const source = await store.getSource(DEMO_PROJECT_ID, body.node.current.sourceId);
    expect(source).toMatchObject({
      kind: 'manual',
      label: 'Workbench operator note',
      excerpt: 'Operator observed this during review.',
      revisionRef: null,
    });
    expect(source.uri).toMatch(/^manual:\/\/workbench\/[0-9a-f-]{36}$/);

    const outgoing = await call(() =>
      handleCreateNode(
        store,
        post(`${base}/nodes`, {
          evidenceNote: 'n',
          changeReason: 'r',
          node: { type: 'assumption', title: 'Outgoing', content: 'c', authority: 'inferred' },
          edge: {
            otherNodeId: other.id,
            type: 'RELATED_TO',
            direction: 'outgoing',
            authority: 'inferred',
          },
        }),
        { projectId: DEMO_PROJECT_ID },
      ),
    );
    expect(outgoing.status).toBe(201);
    const out = (await outgoing.json()) as { node: ContextNode; edge: ContextEdge };
    expect(out.edge).toMatchObject({ fromNodeId: out.node.id, toNodeId: other.id });
  });

  it('reviews an inferred node to canonical as version 2 with a new manual source', async () => {
    const node = byKey('assumption.process-memory-dedupe');
    const response = await call(() =>
      handleReviseNode(
        store,
        post(`${base}/nodes/${node.id}/revisions`, {
          evidenceNote: 'Confirmed with the on-call engineer.',
          changeReason: 'Reviewed and corrected',
          expectedVersion: 1,
          snapshot: {
            title: node.current.title,
            content: 'A persistent receipt store is required; in-memory sets lose state.',
            summary: node.current.summary,
            authority: 'canonical',
            importance: node.current.importance,
            confidence: 1,
            archived: false,
          },
        }),
        { projectId: DEMO_PROJECT_ID, nodeId: node.id },
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { node: ContextNode; changed: boolean };
    expect(body.changed).toBe(true);
    expect(body.node.current).toMatchObject({
      version: 2,
      authority: 'canonical',
      actor: { kind: 'human', label: 'local-operator' },
    });
    expect(body.node.current.sourceId).not.toBe(node.current.sourceId);
    const source = await store.getSource(DEMO_PROJECT_ID, body.node.current.sourceId);
    expect(source).toMatchObject({
      kind: 'manual',
      excerpt: 'Confirmed with the on-call engineer.',
    });
    const revisions = await store.listRevisions(DEMO_PROJECT_ID, node.id);
    expect(revisions.map((rev) => [rev.version, rev.authority])).toEqual([
      [1, 'inferred'],
      [2, 'canonical'],
    ]);
  });

  it('returns 409 for a stale expectedVersion and records no revision', async () => {
    const node = byKey('assumption.process-memory-dedupe');
    const before = await store.listRevisions(DEMO_PROJECT_ID, node.id);
    const response = await call(() =>
      handleReviseNode(
        store,
        post(`${base}/nodes/${node.id}/revisions`, {
          evidenceNote: 'stale',
          changeReason: 'stale edit',
          expectedVersion: 1,
          snapshot: {
            title: 'Stale title',
            content: node.current.content,
            summary: node.current.summary,
            authority: 'canonical',
            importance: node.current.importance,
            confidence: 1,
            archived: false,
          },
        }),
        { projectId: DEMO_PROJECT_ID, nodeId: node.id },
      ),
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatchObject({
      code: 'CONFLICT',
      details: { expected: 1, actual: before.length },
    });
    const after = await store.listRevisions(DEMO_PROJECT_ID, node.id);
    expect(after).toHaveLength(before.length);
    expect((await store.getNode(DEMO_PROJECT_ID, node.id)).current.title).toBe(node.current.title);
  });

  it('archives a node: gone from the graph, listed under ?archived=true, history readable', async () => {
    const node = byKey('bug.repeated-delivery-side-effects');
    const response = await call(() =>
      handleReviseNode(
        store,
        post(`${base}/nodes/${node.id}/revisions`, {
          evidenceNote: 'Superseded by the reviewed decision.',
          changeReason: 'Archive distractor',
          expectedVersion: node.current.version,
          snapshot: {
            title: node.current.title,
            content: node.current.content,
            summary: node.current.summary,
            authority: node.current.authority,
            importance: node.current.importance,
            confidence: node.current.confidence,
            archived: true,
          },
        }),
        { projectId: DEMO_PROJECT_ID, nodeId: node.id },
      ),
    );
    expect(response.status).toBe(200);
    const snapshot = (await handleGetGraph(store, { projectId: DEMO_PROJECT_ID }).then((r) =>
      r.json(),
    )) as GraphSnapshot;
    expect(snapshot.nodes.map((n) => n.id)).not.toContain(node.id);
    const archived = await handleListNodes(store, new Request(`${base}/nodes?archived=true`), {
      projectId: DEMO_PROJECT_ID,
    }).then((r) => r.json());
    expect(archived.nodes.map((n: ContextNode) => n.id)).toEqual([node.id]);
    const detail = (await handleGetNode(store, {
      projectId: DEMO_PROJECT_ID,
      nodeId: node.id,
    }).then((r) => r.json())) as ContextNode;
    expect(detail.current).toMatchObject({ archived: true, version: 2 });
    const revisions = await handleListRevisions(store, {
      projectId: DEMO_PROJECT_ID,
      nodeId: node.id,
    }).then((r) => r.json());
    expect(revisions.revisions.map((rev: { archived: boolean }) => rev.archived)).toEqual([
      false,
      true,
    ]);
  });

  it('rejects cross-origin mutations with 403 FORBIDDEN_ORIGIN', async () => {
    const response = await call(() =>
      handleCreateNode(
        store,
        post(
          `${base}/nodes`,
          {
            evidenceNote: 'x',
            changeReason: 'x',
            node: { type: 'decision', title: 'Evil', content: 'c', authority: 'canonical' },
          },
          { origin: 'http://evil.example' },
        ),
        { projectId: DEMO_PROJECT_ID },
      ),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('FORBIDDEN_ORIGIN');
    expect(
      (await store.getGraph(DEMO_PROJECT_ID)).nodes.some((n) => n.current.title === 'Evil'),
    ).toBe(false);
  });

  it('rejects invalid payloads with 400 and issue details', async () => {
    const shapeError = await call(() =>
      handleCreateNode(
        store,
        post(`${base}/nodes`, { node: { type: 'decision' }, actor: { kind: 'agent' } }),
        { projectId: DEMO_PROJECT_ID },
      ),
    );
    expect(shapeError.status).toBe(400);
    const body = await shapeError.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.issues.length).toBeGreaterThan(0);

    // Foundation validation still applies (blank title reaches the store parser).
    const storeError = await call(() =>
      handleCreateNode(
        store,
        post(`${base}/nodes`, {
          evidenceNote: 'x',
          changeReason: 'x',
          node: { type: 'decision', title: '   ', content: 'c', authority: 'canonical' },
        }),
        { projectId: DEMO_PROJECT_ID },
      ),
    );
    expect(storeError.status).toBe(400);

    const badJson = await call(() =>
      handleCreateNode(
        store,
        new Request(`${base}/nodes`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: ORIGIN },
          body: '{not json',
        }),
        { projectId: DEMO_PROJECT_ID },
      ),
    );
    expect(badJson.status).toBe(400);
  });
});

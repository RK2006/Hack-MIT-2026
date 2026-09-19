import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool, QueryResult } from 'pg';
import { GraphError, graphError } from './errors';
import {
  authorizeCreateNode,
  authorizeEdge,
  authorizeRevision,
  parseCreateEdge,
  parseCreateNode,
  parseProjectInput,
  parseRevision,
  parseSourceInput,
  parseUuid,
  parseVersion,
} from './validation';
import type {
  Actor,
  ContextEdge,
  ContextNode,
  CreateEdgeInput,
  CreateNodeInput,
  GraphReader,
  GraphSnapshot,
  GraphStore,
  GraphTransaction,
  NodeRevision,
  Project,
  ReviseNodeInput,
  Source,
  SourceInput,
} from './types';
import { snapshotOf } from './types';

type Executor = { query(text: string, values?: unknown[]): Promise<QueryResult<any>> };
export type StoreLogger = {
  error(event: {
    operation: string;
    code: string;
    projectId?: string;
    nodeId?: string;
    durationMs: number;
  }): void;
};
const defaultLogger: StoreLogger = { error: (event) => console.error(event) };
const iso = (value: Date | string) => new Date(value).toISOString();

const mapProject = (row: any): Project => ({
  id: row.id,
  name: row.name,
  createdAt: iso(row.created_at),
});
const mapSource = (row: any): Source => ({
  id: row.id,
  projectId: row.project_id,
  kind: row.kind,
  uri: row.uri,
  label: row.label,
  excerpt: row.excerpt,
  revisionRef: row.revision_ref,
  createdAt: iso(row.created_at),
});
const mapRevision = (row: any): NodeRevision => ({
  projectId: row.project_id,
  nodeId: row.node_id,
  version: row.version,
  title: row.title,
  content: row.content,
  summary: row.summary,
  authority: row.authority,
  importance: row.importance,
  confidence: row.confidence,
  archived: row.archived,
  sourceId: row.source_id,
  actor: row.actor as Actor,
  changeReason: row.change_reason,
  createdAt: iso(row.revision_created_at ?? row.created_at),
});
const mapNode = (row: any): ContextNode => ({
  id: row.id,
  projectId: row.project_id,
  type: row.type,
  externalKey: row.external_key,
  path: row.path,
  createdAt: iso(row.node_created_at ?? row.created_at),
  current: mapRevision(row),
});
const mapEdge = (row: any): ContextEdge => ({
  id: row.id,
  projectId: row.project_id,
  fromNodeId: row.from_node_id,
  toNodeId: row.to_node_id,
  type: row.type,
  authority: row.authority,
  sourceId: row.source_id,
  actor: row.actor,
  createdAt: iso(row.created_at),
});

function mapDatabaseError(error: unknown): GraphError {
  if (error instanceof GraphError) return error;
  const pgError = error as { code?: string; constraint?: string };
  if (pgError.code === '23505')
    return graphError('CONFLICT', 'A record with that identity already exists', {
      key:
        (
          {
            projects_pkey: 'projectId',
            context_nodes_project_id_external_key_key: 'externalKey',
            context_nodes_project_id_path_key: 'path',
            context_edges_project_id_from_node_id_to_node_id_type_key: 'edge',
          } as Record<string, string>
        )[pgError.constraint ?? ''] ?? 'identity',
    });
  if (pgError.code === '23503' || pgError.code === '23514')
    return graphError('VALIDATION_ERROR', 'Database constraint rejected the operation');
  return graphError('STORAGE_ERROR', 'Storage operation failed');
}

async function getProject(executor: Executor, projectId: string): Promise<Project> {
  parseUuid(projectId, 'projectId');
  const result = await executor.query('SELECT id, name, created_at FROM projects WHERE id = $1', [
    projectId,
  ]);
  if (!result.rowCount) throw graphError('NOT_FOUND', 'Project not found');
  return mapProject(result.rows[0]);
}

const latestNodeSql = `SELECT n.id, n.project_id, n.type, n.external_key, n.path,
  n.created_at AS node_created_at, r.*, r.created_at AS revision_created_at
  FROM context_nodes n JOIN LATERAL (
    SELECT * FROM context_revisions WHERE node_id=n.id ORDER BY version DESC LIMIT 1
  ) r ON true WHERE n.project_id=$1 AND n.id=$2`;

async function getNode(
  executor: Executor,
  projectId: string,
  nodeId: string,
): Promise<ContextNode> {
  parseUuid(projectId, 'projectId');
  parseUuid(nodeId, 'nodeId');
  const result = await executor.query(latestNodeSql, [projectId, nodeId]);
  if (!result.rowCount) throw graphError('NOT_FOUND', 'Node not found');
  return mapNode(result.rows[0]);
}

async function listArchivedNodes(executor: Executor, projectId: string): Promise<ContextNode[]> {
  await getProject(executor, projectId);
  const result = await executor.query(
    `SELECT n.id, n.project_id, n.type, n.external_key, n.path,
      n.created_at AS node_created_at, r.*, r.created_at AS revision_created_at
    FROM context_nodes n JOIN LATERAL (
      SELECT * FROM context_revisions WHERE node_id=n.id ORDER BY version DESC LIMIT 1
    ) r ON true WHERE n.project_id=$1 AND r.archived ORDER BY n.id`,
    [projectId],
  );
  return result.rows.map(mapNode);
}

async function getSource(executor: Executor, projectId: string, sourceId: string): Promise<Source> {
  parseUuid(projectId, 'projectId');
  parseUuid(sourceId, 'sourceId');
  const result = await executor.query(
    'SELECT * FROM context_sources WHERE project_id=$1 AND id=$2',
    [projectId, sourceId],
  );
  if (!result.rowCount) throw graphError('NOT_FOUND', 'Source not found');
  return mapSource(result.rows[0]);
}

async function listRevisions(
  executor: Executor,
  projectId: string,
  nodeId: string,
): Promise<NodeRevision[]> {
  await getNode(executor, projectId, nodeId);
  const result = await executor.query(
    'SELECT *, created_at AS revision_created_at FROM context_revisions WHERE project_id=$1 AND node_id=$2 ORDER BY version',
    [projectId, nodeId],
  );
  return result.rows.map(mapRevision);
}

async function getRevision(
  executor: Executor,
  projectId: string,
  nodeId: string,
  version: number,
): Promise<NodeRevision> {
  parseUuid(projectId, 'projectId');
  parseUuid(nodeId, 'nodeId');
  parseVersion(version);
  const result = await executor.query(
    'SELECT *, created_at AS revision_created_at FROM context_revisions WHERE project_id=$1 AND node_id=$2 AND version=$3',
    [projectId, nodeId, version],
  );
  if (!result.rowCount) throw graphError('NOT_FOUND', 'Revision not found');
  return mapRevision(result.rows[0]);
}

async function graphQuery(executor: Executor, projectId: string): Promise<GraphSnapshot> {
  parseUuid(projectId, 'projectId');
  const result = await executor.query(
    `
    WITH latest AS (
      SELECT DISTINCT ON (r.node_id) r.* FROM context_revisions r
      WHERE r.project_id=$1 ORDER BY r.node_id, r.version DESC
    ), active AS (
      SELECT n.id, n.project_id, n.type, n.external_key, n.path,
        n.created_at AS node_created_at, l.*, l.created_at AS revision_created_at
      FROM context_nodes n JOIN latest l ON l.node_id=n.id WHERE NOT l.archived
    )
    SELECT 'project' kind, to_jsonb(p) payload, p.id::text sort_key FROM projects p WHERE p.id=$1
    UNION ALL SELECT 'node', to_jsonb(a), a.id::text FROM active a
    UNION ALL SELECT 'edge', to_jsonb(e), e.id::text FROM context_edges e
      WHERE e.project_id=$1 AND EXISTS(SELECT 1 FROM active a WHERE a.id=e.from_node_id)
        AND EXISTS(SELECT 1 FROM active a WHERE a.id=e.to_node_id)
    ORDER BY kind, sort_key`,
    [projectId],
  );
  const projectRow = result.rows.find((row) => row.kind === 'project');
  if (!projectRow) throw graphError('NOT_FOUND', 'Project not found');
  return {
    project: mapProject(projectRow.payload),
    nodes: result.rows.filter((row) => row.kind === 'node').map((row) => mapNode(row.payload)),
    edges: result.rows.filter((row) => row.kind === 'edge').map((row) => mapEdge(row.payload)),
  };
}

function reader(executor: Executor): GraphReader {
  return {
    async listProjects() {
      const result = await executor.query('SELECT id, name, created_at FROM projects ORDER BY id');
      return result.rows.map(mapProject);
    },
    getProject: (id) => getProject(executor, id),
    getGraph: (id) => graphQuery(executor, id),
    getNode: (projectId, nodeId) => getNode(executor, projectId, nodeId),
    listArchivedNodes: (projectId) => listArchivedNodes(executor, projectId),
    getSource: (projectId, sourceId) => getSource(executor, projectId, sourceId),
    listRevisions: (projectId, nodeId) => listRevisions(executor, projectId, nodeId),
    getRevision: (projectId, nodeId, version) => getRevision(executor, projectId, nodeId, version),
  };
}

export function createGraphStore(pool: Pool, options: { logger?: StoreLogger } = {}): GraphStore {
  const logger = options.logger ?? defaultLogger;
  const transactionContext = new AsyncLocalStorage<{ markFailed: () => void }>();
  let closed = false;
  const logged = async <T>(
    operation: string,
    fn: () => Promise<T>,
    ids: { projectId?: string; nodeId?: string } = {},
  ): Promise<T> => {
    const started = Date.now();
    try {
      return await fn();
    } catch (error) {
      const safe = mapDatabaseError(error);
      const safeIds = Object.fromEntries(
        Object.entries(ids).filter(
          ([, value]) => value && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value),
        ),
      );
      if (options.logger || safe.code === 'STORAGE_ERROR') {
        logger.error({ operation, code: safe.code, ...safeIds, durationMs: Date.now() - started });
      }
      throw safe;
    }
  };
  const base = reader(pool);
  return {
    listProjects: () => logged('listProjects', () => base.listProjects()),
    getProject: (projectId) =>
      logged('getProject', () => base.getProject(projectId), { projectId }),
    getNode: (projectId, nodeId) =>
      logged('getNode', () => base.getNode(projectId, nodeId), { projectId, nodeId }),
    listArchivedNodes: (projectId) =>
      logged('listArchivedNodes', () => base.listArchivedNodes(projectId), { projectId }),
    getSource: (projectId, sourceId) =>
      logged('getSource', () => base.getSource(projectId, sourceId), { projectId }),
    listRevisions: (projectId, nodeId) =>
      logged('listRevisions', () => base.listRevisions(projectId, nodeId), { projectId, nodeId }),
    getRevision: (projectId, nodeId, version) =>
      logged('getRevision', () => base.getRevision(projectId, nodeId, version), {
        projectId,
        nodeId,
      }),
    getGraph: (projectId) =>
      logged(
        'getGraph',
        async () => {
          const client = await pool.connect();
          try {
            await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
            const graph = await graphQuery(client, projectId);
            await client.query('COMMIT');
            return graph;
          } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw error;
          } finally {
            client.release();
          }
        },
        { projectId },
      ),
    async transaction<T>(work: (tx: GraphTransaction) => Promise<T>): Promise<T> {
      const parentTransaction = transactionContext.getStore();
      if (parentTransaction) {
        parentTransaction.markFailed();
        throw graphError('VALIDATION_ERROR', 'Nested transactions are not supported');
      }
      return logged('transaction', async () => {
        const client = await pool.connect();
        let failed = false;
        let mutationProject: string | undefined;
        let locked = false;
        const protect =
          <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
          async (...args: A): Promise<R> => {
            try {
              return await fn(...args);
            } catch (error) {
              failed = true;
              throw error;
            }
          };
        const claimProject = async (projectId: string, isNew = false) => {
          parseUuid(projectId, 'projectId');
          if (mutationProject && mutationProject !== projectId)
            throw graphError('VALIDATION_ERROR', 'One transaction may mutate only one project');
          mutationProject = projectId;
          if (!locked && !isNew) {
            const result = await client.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [
              projectId,
            ]);
            if (!result.rowCount) throw graphError('NOT_FOUND', 'Project not found');
            locked = true;
          } else if (isNew) locked = true;
        };
        const txReader = reader(client);
        const tx: GraphTransaction = {
          ...(Object.fromEntries(
            Object.entries(txReader).map(([key, value]) => [
              key,
              protect(value as (...args: unknown[]) => Promise<unknown>),
            ]),
          ) as unknown as GraphReader),
          createProject: protect(async (raw) => {
            const input = parseProjectInput(raw);
            const id = input.id ?? randomUUID();
            if (mutationProject)
              throw graphError('VALIDATION_ERROR', 'Transaction already owns a project');
            const result = await client.query(
              'INSERT INTO projects(id,name) VALUES($1,$2) RETURNING *',
              [id, input.name],
            );
            mutationProject = id;
            locked = true;
            return mapProject(result.rows[0]);
          }),
          createSource: protect(async (projectId, raw: SourceInput) => {
            await claimProject(projectId);
            const input = parseSourceInput(raw);
            const id = randomUUID();
            const result = await client.query(
              `INSERT INTO context_sources
              (id,project_id,kind,uri,label,excerpt,revision_ref) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
              [id, projectId, input.kind, input.uri, input.label, input.excerpt, input.revisionRef],
            );
            return mapSource(result.rows[0]);
          }),
          createNode: protect(async (projectId, raw: CreateNodeInput) => {
            await claimProject(projectId);
            const input = parseCreateNode(raw);
            const source = await getSource(client, projectId, input.sourceId);
            authorizeCreateNode(input, source.kind);
            const count = await client.query(
              'SELECT count(*)::int count FROM context_nodes WHERE project_id=$1',
              [projectId],
            );
            if (count.rows[0].count >= 1000)
              throw graphError('LIMIT_EXCEEDED', 'Project node limit reached');
            const id = randomUUID();
            await client.query(
              'INSERT INTO context_nodes(id,project_id,type,external_key,path) VALUES($1,$2,$3,$4,$5)',
              [id, projectId, input.type, input.externalKey, input.path],
            );
            await client.query(
              `INSERT INTO context_revisions
              (project_id,node_id,version,title,content,summary,authority,importance,confidence,archived,source_id,actor,change_reason)
              VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,false,$9,$10,$11)`,
              [
                projectId,
                id,
                input.title,
                input.content,
                input.summary,
                input.authority,
                input.importance,
                input.confidence,
                input.sourceId,
                input.actor,
                input.changeReason,
              ],
            );
            return getNode(client, projectId, id);
          }),
          reviseNode: protect(async (projectId, nodeId, raw: ReviseNodeInput) => {
            await claimProject(projectId);
            const input = parseRevision(raw);
            const current = await getNode(client, projectId, nodeId);
            const source = await getSource(client, projectId, input.snapshot.sourceId);
            authorizeRevision(current, input, source.kind);
            if (current.current.version !== input.expectedVersion)
              throw graphError('CONFLICT', 'Revision version conflict', {
                expected: input.expectedVersion,
                actual: current.current.version,
              });
            if (JSON.stringify(snapshotOf(current)) === JSON.stringify(input.snapshot))
              return { node: current, changed: false };
            const version = current.current.version + 1;
            await client.query(
              `INSERT INTO context_revisions
              (project_id,node_id,version,title,content,summary,authority,importance,confidence,archived,source_id,actor,change_reason)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
              [
                projectId,
                nodeId,
                version,
                input.snapshot.title,
                input.snapshot.content,
                input.snapshot.summary,
                input.snapshot.authority,
                input.snapshot.importance,
                input.snapshot.confidence,
                input.snapshot.archived,
                input.snapshot.sourceId,
                input.actor,
                input.changeReason,
              ],
            );
            return { node: await getNode(client, projectId, nodeId), changed: true };
          }),
          createEdge: protect(async (projectId, raw: CreateEdgeInput) => {
            await claimProject(projectId);
            const input = parseCreateEdge(raw);
            const source = await getSource(client, projectId, input.sourceId);
            const from = await getNode(client, projectId, input.fromNodeId);
            const to = await getNode(client, projectId, input.toNodeId);
            if (from.current.archived || to.current.archived)
              throw graphError('VALIDATION_ERROR', 'Cannot connect archived nodes');
            authorizeEdge(input, source.kind, from, to);
            const count = await client.query(
              'SELECT count(*)::int count FROM context_edges WHERE project_id=$1',
              [projectId],
            );
            if (count.rows[0].count >= 5000)
              throw graphError('LIMIT_EXCEEDED', 'Project edge limit reached');
            const result = await client.query(
              `INSERT INTO context_edges
              (id,project_id,from_node_id,to_node_id,type,authority,source_id,actor)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
              [
                randomUUID(),
                projectId,
                input.fromNodeId,
                input.toNodeId,
                input.type,
                input.authority,
                input.sourceId,
                input.actor,
              ],
            );
            return mapEdge(result.rows[0]);
          }),
        };
        try {
          await client.query('BEGIN');
          const result = await transactionContext.run(
            {
              markFailed: () => {
                failed = true;
              },
            },
            () => work(tx),
          );
          if (failed) throw graphError('STORAGE_ERROR', 'Transaction contains a failed operation');
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
      });
    },
    async close() {
      if (!closed) {
        closed = true;
        await pool.end();
      }
    },
  };
}

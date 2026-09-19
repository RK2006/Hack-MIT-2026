import { graphError } from '../context/errors';
import type { GraphStore } from '../context/types';
import { assertSameOrigin, json, readJson } from '../http';
import { createOperatorNode, reviseOperatorNode } from './mutations';

export type ProjectParams = { projectId: string };
export type NodeParams = ProjectParams & { nodeId: string };
export type SourceParams = ProjectParams & { sourceId: string };

export async function handleListProjects(store: GraphStore): Promise<Response> {
  return json({ projects: await store.listProjects() });
}

export async function handleGetGraph(store: GraphStore, params: ProjectParams): Promise<Response> {
  return json(await store.getGraph(params.projectId));
}

/** Only `?archived=true` is served here; active nodes come from the graph snapshot. */
export async function handleListNodes(
  store: GraphStore,
  request: Request,
  params: ProjectParams,
): Promise<Response> {
  const archived = new URL(request.url).searchParams.get('archived');
  if (archived !== 'true') {
    throw graphError('VALIDATION_ERROR', 'Use ?archived=true; active nodes come from /graph', {
      field: 'archived',
    });
  }
  return json({ nodes: await store.listArchivedNodes(params.projectId) });
}

export async function handleCreateNode(
  store: GraphStore,
  request: Request,
  params: ProjectParams,
): Promise<Response> {
  const forbidden = assertSameOrigin(request);
  if (forbidden) return forbidden;
  const body = await readJson(request);
  return json(await createOperatorNode(store, params.projectId, body), 201);
}

export async function handleGetNode(store: GraphStore, params: NodeParams): Promise<Response> {
  return json(await store.getNode(params.projectId, params.nodeId));
}

export async function handleListRevisions(
  store: GraphStore,
  params: NodeParams,
): Promise<Response> {
  return json({ revisions: await store.listRevisions(params.projectId, params.nodeId) });
}

export async function handleReviseNode(
  store: GraphStore,
  request: Request,
  params: NodeParams,
): Promise<Response> {
  const forbidden = assertSameOrigin(request);
  if (forbidden) return forbidden;
  const body = await readJson(request);
  return json(await reviseOperatorNode(store, params.projectId, params.nodeId, body));
}

export async function handleGetSource(store: GraphStore, params: SourceParams): Promise<Response> {
  return json(await store.getSource(params.projectId, params.sourceId));
}

import type {
  ContextEdge,
  ContextNode,
  GraphSnapshot,
  NodeRevision,
  Project,
  Source,
} from '@/server/context/types';
import type { CreateNodeRequest, ReviseNodeRequest } from '@/server/workbench/mutations';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: 'no-store' });
  } catch {
    throw new ApiError('NETWORK_ERROR', 'Could not reach the workbench server', 0);
  }
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError('BAD_RESPONSE', `Non-JSON response (${response.status})`, response.status);
    }
  }
  if (!response.ok) {
    const envelope = body as { error?: { code?: string; message?: string; details?: unknown } };
    const error = envelope?.error ?? {};
    throw new ApiError(
      error.code ?? 'HTTP_ERROR',
      error.message ?? `Request failed (${response.status})`,
      response.status,
      (error.details as Record<string, unknown> | undefined) ?? undefined,
    );
  }
  return body as T;
}

const post = <T>(url: string, payload: unknown) =>
  request<T>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`;

export const api = {
  listProjects: () => request<{ projects: Project[] }>('/api/projects'),
  getGraph: (projectId: string) => request<GraphSnapshot>(`${base(projectId)}/graph`),
  listArchivedNodes: (projectId: string) =>
    request<{ nodes: ContextNode[] }>(`${base(projectId)}/nodes?archived=true`),
  getNode: (projectId: string, nodeId: string) =>
    request<ContextNode>(`${base(projectId)}/nodes/${encodeURIComponent(nodeId)}`),
  listRevisions: (projectId: string, nodeId: string) =>
    request<{ revisions: NodeRevision[] }>(
      `${base(projectId)}/nodes/${encodeURIComponent(nodeId)}/revisions`,
    ),
  getSource: (projectId: string, sourceId: string) =>
    request<Source>(`${base(projectId)}/sources/${encodeURIComponent(sourceId)}`),
  createNode: (projectId: string, payload: CreateNodeRequest) =>
    post<{ node: ContextNode; edge: ContextEdge | null }>(`${base(projectId)}/nodes`, payload),
  reviseNode: (projectId: string, nodeId: string, payload: ReviseNodeRequest) =>
    post<{ node: ContextNode; changed: boolean }>(
      `${base(projectId)}/nodes/${encodeURIComponent(nodeId)}/revisions`,
      payload,
    ),
};

export const errorMessage = (error: unknown): string =>
  error instanceof ApiError
    ? `${error.code}: ${error.message}`
    : error instanceof Error
      ? error.message
      : 'Unknown error';

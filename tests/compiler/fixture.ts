import { randomUUID } from 'node:crypto';
import type {
  Authority,
  ContextEdge,
  ContextNode,
  EdgeType,
  GraphSnapshot,
  NodeType,
} from '../../src/server/context/types';

export const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
export const SOURCE_ID = '22222222-2222-4222-8222-222222222222';

export function makeNode(
  key: string,
  type: NodeType,
  overrides: Partial<ContextNode['current']> & { path?: string | null; id?: string } = {},
): ContextNode {
  const id = overrides.id ?? randomUUID();
  const { path, id: _id, ...revision } = overrides;
  void _id;
  return {
    id,
    projectId: PROJECT_ID,
    type,
    externalKey: key,
    path: path ?? null,
    createdAt: '2026-01-01T00:00:00.000Z',
    current: {
      projectId: PROJECT_ID,
      nodeId: id,
      version: 1,
      title: `Title ${key}`,
      content: `Content of ${key}.`,
      summary: '',
      authority: 'canonical',
      importance: 3,
      confidence: 1,
      archived: false,
      sourceId: SOURCE_ID,
      actor: { kind: 'human', label: 'test' },
      changeReason: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      ...revision,
    },
  };
}

export function makeEdge(
  from: ContextNode,
  to: ContextNode,
  type: EdgeType,
  authority: Authority = 'canonical',
): ContextEdge {
  return {
    id: randomUUID(),
    projectId: PROJECT_ID,
    fromNodeId: from.id,
    toNodeId: to.id,
    type,
    authority,
    sourceId: SOURCE_ID,
    actor: { kind: 'human', label: 'test' },
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

export function makeGraph(
  nodes: ContextNode[],
  edges: ContextEdge[],
  name = 'Test project',
): GraphSnapshot {
  return {
    project: { id: PROJECT_ID, name, createdAt: '2026-01-01T00:00:00.000Z' },
    nodes: [...nodes].sort((a, b) => (a.id < b.id ? -1 : 1)),
    edges: [...edges].sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}

/** Similarity map helper: unspecified nodes get 0. */
export function sims(entries: Array<[ContextNode, number]>): Map<string, number> {
  return new Map(entries.map(([node, value]) => [node.id, value]));
}

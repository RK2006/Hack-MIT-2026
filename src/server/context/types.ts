export const NODE_TYPES = [
  'component',
  'file',
  'decision',
  'constraint',
  'assumption',
  'discovery',
  'bug',
] as const;
export const EDGE_TYPES = [
  'CONTAINS',
  'DEPENDS_ON',
  'IMPLEMENTS',
  'REQUIRES',
  'CONSTRAINS',
  'AFFECTS',
  'CAUSED_BY',
  'RELATED_TO',
] as const;
export const AUTHORITIES = ['canonical', 'inferred'] as const;
export const SOURCE_KINDS = ['manual', 'repository', 'agent'] as const;
export const ACTOR_KINDS = ['human', 'importer', 'agent'] as const;

export type NodeType = (typeof NODE_TYPES)[number];
export type EdgeType = (typeof EDGE_TYPES)[number];
export type Authority = (typeof AUTHORITIES)[number];
export type SourceKind = (typeof SOURCE_KINDS)[number];
export type Actor = { kind: (typeof ACTOR_KINDS)[number]; label: string };
export type Project = { id: string; name: string; createdAt: string };
export type SourceInput = {
  kind: SourceKind;
  uri: string;
  label: string;
  excerpt: string;
  revisionRef: string | null;
};
export type Source = SourceInput & { id: string; projectId: string; createdAt: string };
export type NodeIdentity = {
  id: string;
  projectId: string;
  type: NodeType;
  externalKey: string | null;
  path: string | null;
  createdAt: string;
};
export type NodeSnapshot = {
  title: string;
  content: string;
  summary: string;
  authority: Authority;
  importance: number;
  confidence: number;
  archived: boolean;
  sourceId: string;
};
export type NodeRevision = NodeSnapshot & {
  projectId: string;
  nodeId: string;
  version: number;
  actor: Actor;
  changeReason: string;
  createdAt: string;
};
export type ContextNode = NodeIdentity & { current: NodeRevision };
export type ContextEdge = {
  id: string;
  projectId: string;
  fromNodeId: string;
  toNodeId: string;
  type: EdgeType;
  authority: Authority;
  sourceId: string;
  actor: Actor;
  createdAt: string;
};
export type GraphSnapshot = { project: Project; nodes: ContextNode[]; edges: ContextEdge[] };

export function snapshotOf(node: ContextNode): NodeSnapshot {
  const { title, content, summary, authority, importance, confidence, archived, sourceId } =
    node.current;
  return { title, content, summary, authority, importance, confidence, archived, sourceId };
}

export type CreateNodeInput = {
  type: NodeType;
  externalKey?: string | null;
  path?: string | null;
  title: string;
  content: string;
  summary?: string;
  authority: Authority;
  importance?: number;
  confidence?: number;
  sourceId: string;
  actor: Actor;
  changeReason: string;
};
export type ReviseNodeInput = {
  expectedVersion: number;
  snapshot: NodeSnapshot;
  actor: Actor;
  changeReason: string;
};
export type CreateEdgeInput = Pick<
  ContextEdge,
  'fromNodeId' | 'toNodeId' | 'type' | 'authority' | 'sourceId' | 'actor'
>;

export interface GraphReader {
  listProjects(): Promise<Project[]>;
  getProject(projectId: string): Promise<Project>;
  getGraph(projectId: string): Promise<GraphSnapshot>;
  getNode(projectId: string, nodeId: string): Promise<ContextNode>;
  listArchivedNodes(projectId: string): Promise<ContextNode[]>;
  getSource(projectId: string, sourceId: string): Promise<Source>;
  listRevisions(projectId: string, nodeId: string): Promise<NodeRevision[]>;
  getRevision(projectId: string, nodeId: string, version: number): Promise<NodeRevision>;
}
export interface GraphTransaction extends GraphReader {
  createProject(input: { id?: string; name: string }): Promise<Project>;
  createSource(projectId: string, input: SourceInput): Promise<Source>;
  createNode(projectId: string, input: CreateNodeInput): Promise<ContextNode>;
  reviseNode(
    projectId: string,
    nodeId: string,
    input: ReviseNodeInput,
  ): Promise<{ node: ContextNode; changed: boolean }>;
  createEdge(projectId: string, input: CreateEdgeInput): Promise<ContextEdge>;
}
export interface GraphStore extends GraphReader {
  transaction<T>(work: (tx: GraphTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

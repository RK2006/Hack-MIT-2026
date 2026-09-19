import type { Authority, EdgeType, NodeType } from '../types';

export type ContextRequest = {
  task: string;
  tokenBudget: number;
  startNodeIds?: string[];
  maxDepth?: number;
  allowDegraded?: boolean;
};

export type PathStep = {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  traversed: 'forward' | 'reverse';
  type: EdgeType;
  authority: Authority;
};

export type SelectionReasonKind =
  'semantic_match' | 'explicit_reference' | 'graph_neighbor' | 'lexical_match';

export type SelectionReason = {
  kind: SelectionReasonKind;
  description: string;
  seedNodeId: string;
  similarity: number | null;
  path: PathStep[];
};

export type Representation = 'full' | 'summary' | 'title';

export type SelectedItem = {
  nodeId: string;
  version: number;
  type: NodeType;
  title: string;
  authority: Authority;
  representation: Representation;
  score: number;
  relevance: number;
  sourceId: string;
  sourceUri: string;
  reasons: SelectionReason[];
};

export type OmissionReason = 'budget' | 'candidate_limit';

export type Omission = {
  nodeId: string;
  version: number;
  title: string;
  reason: OmissionReason;
  critical: boolean;
};

export type ContextBundle = {
  projectId: string;
  task: string;
  status: 'ok' | 'degraded';
  tokenBudget: number;
  tokenCount: number;
  tokenizer: 'cl100k_base';
  embeddingModel: string;
  contextText: string;
  selected: SelectedItem[];
  omissions: Omission[];
  warnings: string[];
  metrics: {
    activeNodes: number;
    activeEdges: number;
    seeds: number;
    candidates: number;
    projectContextTokens: number;
  };
};

export const REQUEST_LIMITS = {
  taskMax: 2000,
  budgetMin: 256,
  budgetMax: 8192,
  budgetDefault: 4096,
  startMax: 5,
  depthMax: 3,
  depthDefault: 2,
} as const;

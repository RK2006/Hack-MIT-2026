import { describe, expect, it } from 'vitest';
import {
  formatBundleExplanation,
  formatDiff,
  formatLog,
  formatNode,
  formatNodeTable,
  formatPending,
  formatSource,
  formatStatus,
  table,
} from '../../src/cli/format';
import { compareRevisions } from '../../src/lib/compare';
import type { ContextBundle } from '../../src/server/context/compiler/types';
import type { GraphSnapshot, Source } from '../../src/server/context/types';
import { makeEdge, makeNode, PROJECT_ID } from '../compiler/fixture';

const webhooks = makeNode('component.webhooks', 'component', {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  title: 'Stripe webhooks',
});
const idempotency = makeNode('constraint.idempotency', 'constraint', {
  id: 'bbbbbbbb-0000-4000-8000-000000000002',
  title: 'Idempotency',
  importance: 5,
});
const bug = makeNode('bug.dupes', 'bug', {
  id: 'cccccccc-0000-4000-8000-000000000003',
  title: 'Duplicate payments',
  authority: 'inferred',
  confidence: 0.6,
  actor: { kind: 'agent', label: 'gemini:flash' },
  createdAt: '2026-09-19T10:00:00.000Z',
});
const requires = makeEdge(webhooks, idempotency, 'REQUIRES');
const graph: GraphSnapshot = {
  project: { id: PROJECT_ID, name: 'Demo', createdAt: '2026-01-01T00:00:00.000Z' },
  nodes: [webhooks, idempotency, bug],
  edges: [requires],
};

describe('table', () => {
  it('pads every column except the last', () => {
    expect(
      table(
        [
          ['a', 'bbb', 'x'],
          ['cc', 'd', 'y'],
        ],
        ['H1', 'H2', 'H3'],
      ),
    ).toBe(['H1  H2   H3', 'a   bbb  x', 'cc  d    y'].join('\n'));
  });
});

describe('status and tables', () => {
  it('summarises the graph', () => {
    expect(formatStatus(graph, [])).toBe(
      [
        'Demo  11111111…',
        '  3 active nodes · 1 relationships · 2 canonical · 1 inferred · 1 pending review · 0 archived',
      ].join('\n'),
    );
  });

  it('lists nodes with short ids', () => {
    const text = formatNodeTable([webhooks]);
    expect(text).toContain('aaaaaaaa  component  canonical  v1  Stripe webhooks');
    expect(formatNodeTable([])).toBe('(no nodes)');
  });

  it('lists pending proposals', () => {
    expect(formatPending([bug])).toContain(
      'cccccccc  bug   gemini:flash  2026-09-19  0.6   Duplicate payments',
    );
    expect(formatPending([])).toBe('No proposals waiting for review.');
  });
});

describe('formatNode', () => {
  it('shows directed relationships from the node’s point of view', () => {
    expect(formatNode(webhooks, graph, null)).toContain(
      'this → REQUIRES → Idempotency [constraint.idempotency] (canonical)',
    );
    expect(formatNode(idempotency, graph, null)).toContain(
      'Stripe webhooks [component.webhooks] → REQUIRES → this (canonical)',
    );
  });

  it('appends the source with a structured excerpt and no model prefix', () => {
    const source: Source = {
      id: 'ssssssss-0000-4000-8000-000000000009',
      projectId: PROJECT_ID,
      kind: 'agent',
      uri: 'agent://proposals/x',
      label: 'Agent proposal (gemini:flash)',
      excerpt: '[gemini:flash] Found:\n\n- one\n- two',
      revisionRef: null,
      createdAt: '2026-09-19T10:00:00.000Z',
    };
    const text = formatSource(source);
    expect(text).not.toContain('[gemini:flash]');
    expect(text).toContain('    Found:\n    - one\n    - two');
  });
});

describe('log and diff', () => {
  const v1 = { ...bug.current };
  const v2 = {
    ...bug.current,
    version: 2,
    authority: 'canonical' as const,
    confidence: 1,
    actor: { kind: 'human' as const, label: 'local-operator' },
    changeReason: 'Accepted',
  };

  it('lists revisions newest first', () => {
    const text = formatLog([v1, v2]);
    expect(text.split('\n')[1]?.startsWith('v2  canonical')).toBe(true);
  });

  it('prints only changed fields as a before/after pair', () => {
    const text = formatDiff(compareRevisions(v1, v2), 1, 2);
    expect(text).toContain('authority:\n  - v1: inferred\n  + v2: canonical');
    expect(text).not.toContain('title:');
    expect(formatDiff(compareRevisions(v1, v1), 1, 1)).toBe('v1 and v1 are identical');
  });
});

describe('formatBundleExplanation', () => {
  const bundle: ContextBundle = {
    projectId: PROJECT_ID,
    task: 'Fix dupes',
    status: 'ok',
    tokenBudget: 512,
    tokenCount: 300,
    tokenizer: 'cl100k_base',
    embeddingModel: 'fixed',
    contextText: '# Task context\nSECRET-TEXT',
    selected: [
      {
        nodeId: idempotency.id,
        version: 1,
        type: 'constraint',
        title: 'Idempotency',
        authority: 'canonical',
        representation: 'full',
        score: 0.91,
        relevance: 0.8,
        sourceId: 's',
        sourceUri: 'repo://x',
        reasons: [
          {
            kind: 'graph_neighbor',
            description: 'one hop from "Stripe webhooks"',
            seedNodeId: webhooks.id,
            similarity: null,
            path: [
              {
                edgeId: requires.id,
                fromNodeId: webhooks.id,
                toNodeId: idempotency.id,
                traversed: 'forward',
                type: 'REQUIRES',
                authority: 'canonical',
              },
            ],
          },
        ],
      },
    ],
    omissions: [
      {
        nodeId: bug.id,
        version: 1,
        title: 'Duplicate payments',
        reason: 'budget',
        critical: false,
      },
    ],
    warnings: ['tight budget'],
    metrics: { activeNodes: 3, activeEdges: 1, seeds: 1, candidates: 2, projectContextTokens: 900 },
  };

  it('explains selection, paths, omissions and warnings without leaking the text', () => {
    const text = formatBundleExplanation(bundle);
    expect(text).toContain('status ok · 300 / 512 tokens (project total 900)');
    expect(text).toContain(' 1. Idempotency  [bbbbbbbb constraint canonical v1 full score 0.91]');
    expect(text).toContain('graph neighbor: one hop from "Stripe webhooks"');
    expect(text).toContain('aaaaaaaa → REQUIRES → Idempotency (canonical)');
    expect(text).toContain('- Duplicate payments v1 · budget');
    expect(text).toContain('! tight budget');
    expect(text).not.toContain('SECRET-TEXT');
  });
});

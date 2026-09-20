import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEmbeddingCache } from '../../src/server/context/compiler/cache';
import { compileContext } from '../../src/server/context/compiler/compile';
import type { EmbeddingProvider } from '../../src/server/context/compiler/embedding';
import type { ContextBundle } from '../../src/server/context/compiler/types';
import { graphError } from '../../src/server/context/errors';
import { createGraphStore } from '../../src/server/context/store';
import { snapshotOf, type GraphStore } from '../../src/server/context/types';
import { DEMO_PROJECT_ID, DEMO_TASK } from '../../src/server/ingestion/demo-expectations';
import { importPreparedProject } from '../../src/server/ingestion/import';
import { fixedProposalModel } from '../../src/server/proposals/model';
import { proposeContext } from '../../src/server/proposals/propose';
import { isolatedDatabase } from '../helpers/postgres';
import { connectMcp, textOf, type ToolCall } from '../mcp/helpers';

const KEYWORDS = [
  'webhook',
  'stripe',
  'duplicate',
  'event',
  'receipt',
  'retry',
  'catalog',
  'email',
];
const keywordProvider = (): EmbeddingProvider => ({
  id: 'fixed:keywords',
  dimensions: KEYWORDS.length,
  minSeedSimilarity: 0.25,
  async embed(texts) {
    return texts.map((text) => KEYWORDS.map((w) => text.toLowerCase().split(w).length - 1));
  },
});

const proposalJson = JSON.stringify({
  nodes: [
    {
      key: 'retry-storm-discovery',
      type: 'discovery',
      title: 'Stripe retries arrive within 200 ms of each other',
      content:
        'During the duplicate webhook incident, retries of the same event landed on two workers within 200 ms, before either wrote a receipt.',
      summary: 'Retries overlap in time across workers.',
      importance: 4,
      confidence: 0.95,
    },
    {
      key: 'claim-before-charge',
      type: 'decision',
      title: 'Claim the receipt row before calling Stripe charge APIs',
      content:
        'The fix moves the receipt insert ahead of any payment mutation and treats a unique-violation as "already processed".',
      summary: '',
      importance: 5,
      confidence: 0.8,
    },
  ],
  edges: [
    { fromKey: 'retry-storm-discovery', toKey: 'component.stripe-webhooks', type: 'AFFECTS' },
    {
      fromKey: 'claim-before-charge',
      toKey: 'constraint.provider-event-id-unique',
      type: 'IMPLEMENTS',
    },
    {
      fromKey: 'claim-before-charge',
      toKey: 'discovery.retry-storm-discovery',
      type: 'RELATED_TO',
    },
    { fromKey: 'claim-before-charge', toKey: 'no.such.key', type: 'RELATED_TO' },
    { fromKey: 'claim-before-charge', toKey: 'claim-before-charge', type: 'RELATED_TO' },
    { fromKey: 'component.payments', toKey: 'component.stripe-webhooks', type: 'RELATED_TO' },
    { fromKey: 'retry-storm-discovery', toKey: 'component.stripe-webhooks', type: 'AFFECTS' },
  ],
});

describe('agent context proposals against PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof isolatedDatabase>>;
  let store: GraphStore;
  const text =
    'Incident notes (synthetic prepared example): two workers processed evt_123 within 200 ms; fix claims the receipt first.';

  beforeAll(async () => {
    db = await isolatedDatabase();
    store = createGraphStore(db.pool);
    await importPreparedProject(
      await readFile(new URL('../../fixtures/demo-payments.json', import.meta.url)),
      store,
    );
  });
  afterAll(async () => {
    await db.cleanup();
  });

  it('writes inferred nodes/edges with one agent source and reports drops (A1/A2)', async () => {
    const result = await proposeContext(
      { store, model: fixedProposalModel(proposalJson, 'fixed:reviewer') },
      DEMO_PROJECT_ID,
      { text, taskHint: DEMO_TASK },
    );
    expect(result.created.nodes).toHaveLength(2);
    expect(result.created.edges.map((e) => `${e.from} ${e.type} ${e.to}`)).toEqual([
      'retry-storm-discovery AFFECTS component.stripe-webhooks',
      'claim-before-charge IMPLEMENTS constraint.provider-event-id-unique',
      'claim-before-charge RELATED_TO discovery.retry-storm-discovery',
    ]);
    expect(result.dropped.map((d) => d.reason).sort()).toEqual(
      [
        'duplicate edge',
        'edge must touch a proposed node',
        'self edge',
        'unresolved endpoint key',
      ].sort(),
    );
    const graph = await store.getGraph(DEMO_PROJECT_ID);
    for (const created of result.created.nodes) {
      const node = graph.nodes.find((n) => n.id === created.nodeId)!;
      expect(node.current.authority).toBe('inferred');
      expect(node.current.actor).toEqual({ kind: 'agent', label: 'fixed:reviewer' });
      expect(node.current.confidence).toBeLessThanOrEqual(0.7);
      expect(node.current.sourceId).toBe(result.sourceId);
      expect(node.externalKey).toMatch(/^agent\.[a-z-]+-[0-9a-f]{8}$/);
      expect(node.current.changeReason).toContain(DEMO_TASK);
    }
    const source = await store.getSource(DEMO_PROJECT_ID, result.sourceId!);
    expect(source.kind).toBe('agent');
    expect(source.excerpt).toContain('[fixed:reviewer]');
    expect(source.excerpt).toContain('evt_123');
    expect(
      graph.edges
        .filter((e) => e.sourceId === result.sourceId)
        .every((e) => e.authority === 'inferred'),
    ).toBe(true);
  });

  it('does not duplicate a node whose key already exists in the graph', async () => {
    const before = await store.getGraph(DEMO_PROJECT_ID);
    const again = await proposeContext(
      {
        store,
        model: fixedProposalModel(
          JSON.stringify({
            nodes: [
              {
                key: 'constraint.provider-event-id-unique',
                type: 'constraint',
                title: 'dup',
                content: 'dup',
                summary: '',
                importance: 3,
                confidence: 0.5,
              },
            ],
            edges: [],
          }),
        ),
      },
      DEMO_PROJECT_ID,
      { text },
    );
    expect(again.created.nodes).toEqual([]);
    expect(again.dropped).toEqual([
      { kind: 'node', reason: 'already exists', ref: 'constraint.provider-event-id-unique' },
    ]);
    expect((await store.getGraph(DEMO_PROJECT_ID)).nodes.length).toBe(before.nodes.length);
  });

  it('writes nothing for an empty proposal or invalid model output (A3)', async () => {
    const before = await store.getGraph(DEMO_PROJECT_ID);
    const empty = await proposeContext(
      {
        store,
        model: fixedProposalModel(
          '{"nodes":[],"edges":[{"fromKey":"a","toKey":"b","type":"AFFECTS"}]}',
        ),
      },
      DEMO_PROJECT_ID,
      { text },
    );
    expect(empty.sourceId).toBeNull();
    expect(empty.dropped).toHaveLength(1);
    await expect(
      proposeContext({ store, model: fixedProposalModel('not json') }, DEMO_PROJECT_ID, { text }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      proposeContext(
        {
          store,
          model: fixedProposalModel(
            JSON.stringify({
              nodes: [
                {
                  key: 'x-y-z',
                  type: 'component',
                  title: 't',
                  content: 'c',
                  summary: '',
                  importance: 3,
                  confidence: 0.5,
                },
              ],
              edges: [],
            }),
          ),
        },
        DEMO_PROJECT_ID,
        { text },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      proposeContext({ store, model: fixedProposalModel('{}') }, DEMO_PROJECT_ID, {
        text: 'x'.repeat(20_001),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      proposeContext(
        {
          store,
          model: {
            id: 'fixed:down',
            complete: async () => {
              throw graphError('MODEL_UNAVAILABLE', 'down');
            },
          },
        },
        DEMO_PROJECT_ID,
        { text },
      ),
    ).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
    const after = await store.getGraph(DEMO_PROJECT_ID);
    expect(after.nodes.length).toBe(before.nodes.length);
    expect(after.edges.length).toBe(before.edges.length);
  });

  it('lets a human review a proposal to canonical and the compiler then selects v2 (A4)', async () => {
    const graph = await store.getGraph(DEMO_PROJECT_ID);
    const proposed = graph.nodes.find((n) =>
      n.externalKey?.startsWith('agent.claim-before-charge'),
    )!;
    await store.transaction(async (tx) => {
      const source = await tx.createSource(DEMO_PROJECT_ID, {
        kind: 'manual',
        uri: 'manual://review',
        label: 'Review',
        excerpt: 'Confirmed by the on-call engineer.',
        revisionRef: null,
      });
      await tx.reviseNode(DEMO_PROJECT_ID, proposed.id, {
        expectedVersion: 1,
        snapshot: {
          ...snapshotOf(proposed),
          authority: 'canonical',
          confidence: 1,
          sourceId: source.id,
        },
        actor: { kind: 'human', label: 'local-operator' },
        changeReason: 'Reviewed proposal',
      });
    });
    const deps = { store, provider: keywordProvider(), cache: createEmbeddingCache(db.pool) };
    const bundle = await compileContext(deps, DEMO_PROJECT_ID, {
      task: DEMO_TASK,
      tokenBudget: 4096,
    });
    const item = bundle.selected.find((s) => s.nodeId === proposed.id);
    expect(item).toMatchObject({ version: 2, authority: 'canonical' });
    expect((await store.getRevision(DEMO_PROJECT_ID, proposed.id, 1)).authority).toBe('inferred');
  });

  it('serves compile_context and propose_context over MCP identically to direct calls (MCP A2)', async () => {
    const deps = { store, provider: keywordProvider(), cache: createEmbeddingCache(db.pool) };
    const mcp = await connectMcp({
      ...deps,
      proposalModel: fixedProposalModel('{"nodes":[],"edges":[]}', 'fixed:mcp'),
    });
    const direct = await compileContext(deps, DEMO_PROJECT_ID, {
      task: DEMO_TASK,
      tokenBudget: 2048,
    });
    const viaMcp = (await mcp.client.callTool({
      name: 'compile_context',
      arguments: { projectId: DEMO_PROJECT_ID, task: DEMO_TASK, tokenBudget: 2048 },
    })) as ToolCall;
    expect(viaMcp.structuredContent as ContextBundle).toEqual(direct);
    expect(textOf(viaMcp)).toBe(direct.contextText);
    const proposal = (await mcp.client.callTool({
      name: 'propose_context',
      arguments: { projectId: DEMO_PROJECT_ID, text },
    })) as ToolCall;
    expect(proposal.isError).toBeFalsy();
    expect(proposal.structuredContent).toMatchObject({
      projectId: DEMO_PROJECT_ID,
      model: 'fixed:mcp',
      sourceId: null,
    });
    const missing = (await mcp.client.callTool({
      name: 'compile_context',
      arguments: { projectId: '00000000-0000-4000-8000-000000000000', task: DEMO_TASK },
    })) as ToolCall;
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toMatch(/^NOT_FOUND/);
    await mcp.close();
  });
});

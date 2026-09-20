import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGraphStore } from '../../src/server/context/store';
import type { GraphStore } from '../../src/server/context/types';
import { ingestPullRequest, type GhRunner } from '../../src/server/ingestion/github-pr';
import { importPreparedProject } from '../../src/server/ingestion/import';
import { fixedProposalModel } from '../../src/server/proposals/model';
import { isolatedDatabase } from '../helpers/postgres';

const SELF_PROJECT_ID = '3c1d7a2e-5b8f-4c0a-9e6d-2f4b8a1c9d02';

const prJson = JSON.stringify({
  number: 2,
  title: 'feat: review queue for agent proposals',
  body: 'Add a Review tab listing inferred, agent-authored nodes with one-click accept/reject.',
  url: 'https://github.com/AnmolKaran/hackmit-2026/pull/2',
  state: 'MERGED',
  mergedAt: '2026-09-20T01:50:00Z',
  author: { login: 'AnmolKaran' },
  files: [{ path: 'src/lib/review.ts', additions: 35, deletions: 0 }],
  commits: [{ messageHeadline: 'feat: review queue for agent proposals' }],
});

const fakeGh: GhRunner = async (args) => {
  if (args[1] === 'view') return { stdout: prJson, stderr: '', code: 0 };
  if (args[1] === 'diff')
    return { stdout: '+export function isPendingReview() {}', stderr: '', code: 0 };
  return { stdout: '', stderr: 'unexpected', code: 1 };
};

const modelJson = JSON.stringify({
  nodes: [
    {
      key: 'review-queue-derived',
      type: 'decision',
      title: 'Pending review is a derived filter over current revisions',
      content:
        'The review queue lists inferred nodes whose current actor is an agent; no new table.',
      summary: '',
      importance: 3,
      confidence: 0.8,
    },
  ],
  edges: [{ fromKey: 'review-queue-derived', toKey: 'component.workbench', type: 'AFFECTS' }],
});

describe('GitHub PR ingestion against PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof isolatedDatabase>>;
  let store: GraphStore;

  beforeAll(async () => {
    db = await isolatedDatabase();
    store = createGraphStore(db.pool);
    const result = await importPreparedProject(
      await readFile(new URL('../../fixtures/context-graph-self.json', import.meta.url)),
      store,
    );
    expect(result.projectId).toBe(SELF_PROJECT_ID);
  });
  afterAll(async () => {
    await db.cleanup();
  });

  it('imports the self-describing manifest (A3)', async () => {
    const graph = await store.getGraph(SELF_PROJECT_ID);
    expect(graph.project.name).toBe('Context Graph (this repository)');
    expect(graph.nodes.length).toBe(25);
    expect(graph.nodes.every((n) => n.current.authority === 'canonical')).toBe(true);
  });

  it('writes inferred nodes citing the PR URL as evidence (A2)', async () => {
    const result = await ingestPullRequest(
      { store, model: fixedProposalModel(modelJson, 'fixed:pr'), run: fakeGh },
      SELF_PROJECT_ID,
      'AnmolKaran/hackmit-2026#2',
    );
    expect(result.pullRequest).toEqual({
      url: 'https://github.com/AnmolKaran/hackmit-2026/pull/2',
      number: 2,
      title: 'feat: review queue for agent proposals',
      state: 'MERGED',
    });
    expect(result.proposal.created.nodes).toHaveLength(1);
    expect(result.proposal.created.edges).toHaveLength(1);
    const source = await store.getSource(SELF_PROJECT_ID, result.proposal.sourceId!);
    expect(source.kind).toBe('agent');
    expect(source.uri).toBe('https://github.com/AnmolKaran/hackmit-2026/pull/2');
    expect(source.label).toBe('GitHub PR #2: feat: review queue for agent proposals');
    expect(source.excerpt).toContain('GitHub pull request #2');
    const node = await store.getNode(SELF_PROJECT_ID, result.proposal.created.nodes[0]!.nodeId);
    expect(node.current.authority).toBe('inferred');
    expect(node.current.changeReason).toContain('Pull request #2');
  });

  it('fails as SOURCE_UNAVAILABLE without writes when gh fails', async () => {
    const before = await store.getGraph(SELF_PROJECT_ID);
    const failing: GhRunner = async () => ({
      stdout: '',
      stderr: 'GraphQL: Could not resolve to a PullRequest with the number of 999.',
      code: 1,
    });
    await expect(
      ingestPullRequest(
        { store, model: fixedProposalModel(modelJson), run: failing },
        SELF_PROJECT_ID,
        'AnmolKaran/hackmit-2026#999',
      ),
    ).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE', details: { category: 'not_found' } });
    expect((await store.getGraph(SELF_PROJECT_ID)).nodes.length).toBe(before.nodes.length);
  });
});

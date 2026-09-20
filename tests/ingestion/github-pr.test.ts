import { describe, expect, it } from 'vitest';
import { GraphError } from '../../src/server/context/errors';
import {
  buildPullRequestText,
  parsePullRequestRef,
  type PullRequestData,
} from '../../src/server/ingestion/github-pr';
import { PROPOSAL_LIMITS } from '../../src/server/proposals/prompt';

const pr: PullRequestData = {
  number: 2,
  title: 'feat: review queue for agent proposals',
  body: 'Add a Review tab listing inferred, agent-authored nodes.',
  url: 'https://github.com/AnmolKaran/hackmit-2026/pull/2',
  state: 'MERGED',
  mergedAt: '2026-09-20T01:50:00Z',
  author: 'AnmolKaran',
  files: [{ path: 'src/lib/review.ts', additions: 35, deletions: 0 }],
  commits: [{ messageHeadline: 'feat: review queue for agent proposals' }],
  diff: 'diff --git a/src/lib/review.ts b/src/lib/review.ts\n+export function isPendingReview() {}',
};

describe('parsePullRequestRef', () => {
  it('accepts URLs, owner/repo#n, and bare numbers with a default repo', () => {
    const expected = { owner: 'AnmolKaran', repo: 'hackmit-2026', number: 2 };
    expect(parsePullRequestRef('https://github.com/AnmolKaran/hackmit-2026/pull/2')).toEqual(
      expected,
    );
    expect(
      parsePullRequestRef('https://github.com/AnmolKaran/hackmit-2026/pull/2/files?x=1'),
    ).toEqual(expected);
    expect(parsePullRequestRef('AnmolKaran/hackmit-2026#2')).toEqual(expected);
    expect(parsePullRequestRef(' 2 ', 'AnmolKaran/hackmit-2026')).toEqual(expected);
  });

  it.each([
    ['2', undefined],
    ['2', 'not a repo'],
    ['https://gitlab.com/a/b/-/merge_requests/1', undefined],
    ['https://github.com/a/b/issues/3', undefined],
    ['owner/repo', undefined],
    ['', undefined],
  ])('rejects %j with repo %j', (ref, repo) => {
    try {
      parsePullRequestRef(ref, repo);
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(GraphError);
      expect((error as GraphError).code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('buildPullRequestText', () => {
  it('includes metadata, commits, files, and the diff', () => {
    const text = buildPullRequestText(pr);
    expect(text).toContain('GitHub pull request #2: feat: review queue for agent proposals');
    expect(text).toContain('URL: https://github.com/AnmolKaran/hackmit-2026/pull/2');
    expect(text).toContain('State: MERGED (merged 2026-09-20T01:50:00Z) · Author: AnmolKaran');
    expect(text).toContain('- feat: review queue for agent proposals');
    expect(text).toContain('- src/lib/review.ts (+35/-0)');
    expect(text).toContain('+export function isPendingReview() {}');
    expect(text).not.toContain('truncated');
  });

  it('handles missing body, commits, files, and diff', () => {
    const text = buildPullRequestText({ ...pr, body: '  ', commits: [], files: [], diff: '' });
    expect(text).toContain('(no description)');
    expect(text).toContain('- (none listed)');
    expect(text).toContain('(diff unavailable)');
  });

  it('keeps the whole digest within the proposal text limit and marks truncation', () => {
    const huge = { ...pr, diff: 'x'.repeat(100_000), body: 'y'.repeat(5_000) };
    const text = buildPullRequestText(huge);
    expect(Array.from(text).length).toBeLessThanOrEqual(PROPOSAL_LIMITS.textMax);
    expect(text).toContain('[diff truncated]');
    expect(text).toContain('- src/lib/review.ts (+35/-0)');
  });
});

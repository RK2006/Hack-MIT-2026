import { execFile } from 'node:child_process';
import { graphError } from '../context/errors';
import type { GraphStore } from '../context/types';
import type { ProposalModel } from '../proposals/model';
import { PROPOSAL_LIMITS } from '../proposals/prompt';
import { proposeContext, type ProposalResult } from '../proposals/propose';

export type PullRequestRef = { owner: string; repo: string; number: number };

export type PullRequestData = {
  number: number;
  title: string;
  body: string;
  url: string;
  state: string;
  mergedAt: string | null;
  author: string;
  files: Array<{ path: string; additions: number; deletions: number }>;
  commits: Array<{ messageHeadline: string }>;
  diff: string;
};

export type GhRunner = (
  args: string[],
) => Promise<{ stdout: string; stderr: string; code: number }>;

export type IngestResult = {
  pullRequest: { url: string; number: number; title: string; state: string };
  proposal: ProposalResult;
};

const GH_TIMEOUT_MS = 60_000;
const DIFF_MAX_CODEPOINTS = 12_000;
const REPO_PATTERN = /^([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+)$/;

/** Accepts a GitHub PR URL, `owner/repo#123`, or a bare number when `defaultRepo` is supplied. */
export function parsePullRequestRef(ref: string, defaultRepo?: string): PullRequestRef {
  const trimmed = ref.trim();
  const url =
    /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+)\/pull\/(\d+)(?:[/?#].*)?$/.exec(
      trimmed,
    );
  if (url) return { owner: url[1]!, repo: url[2]!, number: Number(url[3])! };
  const short = /^([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+)#(\d+)$/.exec(trimmed);
  if (short) return { owner: short[1]!, repo: short[2]!, number: Number(short[3]) };
  if (/^\d+$/.test(trimmed)) {
    const repo = REPO_PATTERN.exec(defaultRepo?.trim() ?? '');
    if (!repo)
      throw graphError('VALIDATION_ERROR', 'A bare PR number requires --repo owner/name', {
        field: 'repo',
      });
    return { owner: repo[1]!, repo: repo[2]!, number: Number(trimmed) };
  }
  throw graphError(
    'VALIDATION_ERROR',
    'Pull request reference must be a GitHub PR URL, owner/repo#number, or a number with --repo',
    { field: 'ref' },
  );
}

/** Default runner: the operator's authenticated `gh` CLI, invoked without a shell. */
export const ghRunner: GhRunner = (args) =>
  new Promise((resolve) => {
    execFile(
      'gh',
      args,
      {
        timeout: GH_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GH_PAGER: 'cat' },
      },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: unknown }).code === 'number'
            ? ((error as { code: number }).code as number)
            : error
              ? 1
              : 0;
        resolve({ stdout: String(stdout), stderr: String(stderr ?? error?.message ?? ''), code });
      },
    );
  });

function categorize(stderr: string): string {
  const lower = stderr.toLowerCase();
  if (
    lower.includes('could not resolve') ||
    lower.includes('not found') ||
    lower.includes('no pull requests')
  )
    return 'not_found';
  if (
    lower.includes('auth') ||
    lower.includes('login') ||
    lower.includes('401') ||
    lower.includes('403')
  )
    return 'auth';
  if (
    lower.includes('enotfound') ||
    lower.includes('dial tcp') ||
    lower.includes('timeout') ||
    lower.includes('network')
  )
    return 'network';
  if (lower.includes('enoent') || lower.includes('spawn gh')) return 'gh_missing';
  return 'other';
}

async function gh(run: GhRunner, args: string[]): Promise<string> {
  const result = await run(args);
  if (result.code !== 0) {
    throw graphError('SOURCE_UNAVAILABLE', 'Could not fetch the pull request with gh', {
      category: categorize(result.stderr),
      command: `gh ${args.slice(0, 2).join(' ')}`,
    });
  }
  return result.stdout;
}

export async function fetchPullRequest(
  ref: PullRequestRef,
  run: GhRunner = ghRunner,
): Promise<PullRequestData> {
  const repo = `${ref.owner}/${ref.repo}`;
  const raw = await gh(run, [
    'pr',
    'view',
    String(ref.number),
    '--repo',
    repo,
    '--json',
    'number,title,body,url,state,mergedAt,author,files,commits',
  ]);
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw graphError('SOURCE_UNAVAILABLE', 'gh returned malformed pull request data', {
      category: 'other',
    });
  }
  const diff = await gh(run, ['pr', 'diff', String(ref.number), '--repo', repo]).catch(() => '');
  return {
    number: Number(parsed.number ?? ref.number),
    title: String(parsed.title ?? ''),
    body: String(parsed.body ?? ''),
    url: String(parsed.url ?? `https://github.com/${repo}/pull/${ref.number}`),
    state: String(parsed.state ?? 'UNKNOWN'),
    mergedAt: parsed.mergedAt ? String(parsed.mergedAt) : null,
    author: String(parsed.author?.login ?? parsed.author?.name ?? 'unknown'),
    files: Array.isArray(parsed.files)
      ? parsed.files.map((file: any) => ({
          path: String(file.path ?? ''),
          additions: Number(file.additions ?? 0),
          deletions: Number(file.deletions ?? 0),
        }))
      : [],
    commits: Array.isArray(parsed.commits)
      ? parsed.commits.map((commit: any) => ({
          messageHeadline: String(commit.messageHeadline ?? ''),
        }))
      : [],
    diff,
  };
}

const clip = (text: string, max: number, marker: string) => {
  const points = Array.from(text);
  return points.length <= max ? text : `${points.slice(0, max).join('')}\n${marker}`;
};

/** Bounded digest for the proposal model: metadata and file list in full, diff truncated last. */
export function buildPullRequestText(pr: PullRequestData): string {
  const header = [
    `GitHub pull request #${pr.number}: ${pr.title}`,
    `URL: ${pr.url}`,
    `State: ${pr.state}${pr.mergedAt ? ` (merged ${pr.mergedAt})` : ''} · Author: ${pr.author}`,
    '',
    'Description:',
    pr.body.trim() || '(no description)',
    '',
    'Commits:',
    ...(pr.commits.length ? pr.commits.map((c) => `- ${c.messageHeadline}`) : ['- (none listed)']),
    '',
    'Changed files:',
    ...(pr.files.length
      ? pr.files.map((f) => `- ${f.path} (+${f.additions}/-${f.deletions})`)
      : ['- (none listed)']),
    '',
    'Diff excerpt:',
  ].join('\n');
  const headerPoints = Array.from(header).length;
  const room = Math.max(
    0,
    Math.min(DIFF_MAX_CODEPOINTS, PROPOSAL_LIMITS.textMax - headerPoints - 80),
  );
  const diff = pr.diff.trim() ? clip(pr.diff, room, '[diff truncated]') : '(diff unavailable)';
  return clip(`${header}\n${diff}`, PROPOSAL_LIMITS.textMax, '[truncated]');
}

export async function ingestPullRequest(
  deps: { store: GraphStore; model: ProposalModel; run?: GhRunner },
  projectId: string,
  ref: string,
  options: { repo?: string | undefined } = {},
): Promise<IngestResult> {
  const parsed = parsePullRequestRef(ref, options.repo);
  const pr = await fetchPullRequest(parsed, deps.run ?? ghRunner);
  const proposal = await proposeContext({ store: deps.store, model: deps.model }, projectId, {
    text: buildPullRequestText(pr),
    taskHint: `Pull request #${pr.number}: ${pr.title}`.slice(0, 500),
    source: { uri: pr.url, label: `GitHub PR #${pr.number}: ${pr.title}`.slice(0, 200) },
  });
  return {
    pullRequest: { url: pr.url, number: pr.number, title: pr.title, state: pr.state },
    proposal,
  };
}

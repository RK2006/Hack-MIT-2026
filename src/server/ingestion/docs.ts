import { execFile } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { graphError } from '../context/errors';
import type { GraphStore } from '../context/types';
import type { ProposalModel } from '../proposals/model';
import { PROPOSAL_LIMITS } from '../proposals/prompt';
import { proposeContext, type ProposalResult } from '../proposals/propose';
import type { CommandRunner } from './scan';

export type DocsOptions = {
  /** Explicit relative paths; when omitted, the default documentation set is used. */
  files?: string[] | undefined;
  /** Upper bound on documents processed per call. Default 12. */
  maxDocs?: number | undefined;
  run?: CommandRunner | undefined;
};

export type DocResult = {
  path: string;
  status: 'proposed' | 'skipped' | 'failed';
  reason?: string;
  proposal?: ProposalResult;
};

export type DocsIngestResult = {
  projectId: string;
  commit: string | null;
  documents: DocResult[];
  created: { nodes: number; edges: number };
};

export const DOCS_DEFAULTS = { maxDocs: 12, maxDocBytes: 262_144 } as const;

const ROOT_DOC_PATTERN =
  /^(readme|agents|claude|contributing|changelog|architecture|design|security|adr|decisions)(\.[a-z0-9-]+)?\.md$/i;
const DOCS_DIR_PATTERN = /^(docs?|documentation|adr|adrs|rfcs?)\/.+\.md$/i;

const runCommand: CommandRunner = (command, args, cwd) =>
  new Promise((done) => {
    execFile(command, args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error
        ? typeof (error as { code?: unknown }).code === 'number'
          ? ((error as { code: number }).code as number)
          : 1
        : 0;
      done({ stdout: String(stdout), stderr: String(stderr ?? error?.message ?? ''), code });
    });
  });

/** Documentation files worth reading, in a stable order: root docs first, then docs/ trees. */
export function selectDocumentationFiles(tracked: string[]): string[] {
  const root = tracked.filter((p) => !p.includes('/') && ROOT_DOC_PATTERN.test(p)).sort();
  const nested = tracked.filter((p) => DOCS_DIR_PATTERN.test(p)).sort();
  return [...root, ...nested];
}

export function blobUrl(
  httpsRemote: string | null,
  commit: string | null,
  path: string,
): string | null {
  if (!httpsRemote || !commit) return null;
  return `${httpsRemote}/blob/${commit}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function digest(path: string, text: string, url: string | null): string {
  const header = `Documentation file ${path}${url ? ` (${url})` : ''}\n\n`;
  const room = PROPOSAL_LIMITS.textMax - Array.from(header).length - 40;
  const points = Array.from(text);
  const body = points.length > room ? `${points.slice(0, room).join('')}\n[truncated]` : text;
  return `${header}${body}`;
}

async function repoFacts(root: string, run: CommandRunner) {
  const top = await run('git', ['rev-parse', '--show-toplevel'], root);
  if (top.code !== 0 || (await realpath(top.stdout.trim()).catch(() => '')) !== root) {
    throw graphError('SOURCE_UNAVAILABLE', 'Path is not the root of a git work tree', {
      category: 'not_git',
    });
  }
  const listed = await run('git', ['ls-files', '-z'], root);
  if (listed.code !== 0)
    throw graphError('SOURCE_UNAVAILABLE', 'git ls-files failed', { category: 'other' });
  const commit = (await run('git', ['rev-parse', 'HEAD'], root)).stdout.trim() || null;
  const remote = (await run('git', ['remote', 'get-url', 'origin'], root)).stdout.trim();
  const ssh = /^git@github\.com:(.+?)(?:\.git)?$/.exec(remote)?.[1];
  const httpsRemote = /^https:\/\/\S+$/.test(remote)
    ? remote.replace(/\.git$/, '')
    : ssh
      ? `https://github.com/${ssh}`
      : null;
  return { tracked: listed.stdout.split('\0').filter(Boolean), commit, httpsRemote };
}

/**
 * Read a repository's documentation and turn each file into proposed (inferred) knowledge with the
 * file's GitHub URL as evidence. Structure stays canonical (scanner); interpretation stays inferred.
 * Per-document model failures are reported, not fatal.
 */
export async function ingestDocumentation(
  deps: { store: GraphStore; model: ProposalModel },
  projectId: string,
  rootPath: string,
  options: DocsOptions = {},
): Promise<DocsIngestResult> {
  const run = options.run ?? runCommand;
  const maxDocs = options.maxDocs ?? DOCS_DEFAULTS.maxDocs;
  if (!Number.isInteger(maxDocs) || maxDocs < 1 || maxDocs > 50)
    throw graphError('VALIDATION_ERROR', 'maxDocs must be 1..50', { field: 'maxDocs' });
  let root: string;
  try {
    root = await realpath(resolve(rootPath));
  } catch {
    throw graphError('SOURCE_UNAVAILABLE', 'Repository path does not exist', {
      category: 'not_found',
    });
  }
  const { tracked, commit, httpsRemote } = await repoFacts(root, run);
  const trackedSet = new Set(tracked);
  const requested = options.files?.map((p) => p.replace(/^\.?\//, ''));
  const candidates = requested ?? selectDocumentationFiles(tracked);
  const documents: DocResult[] = [];
  let nodes = 0;
  let edges = 0;
  for (const [index, path] of candidates.entries()) {
    if (index >= maxDocs) {
      documents.push({ path, status: 'skipped', reason: `beyond maxDocs (${maxDocs})` });
      continue;
    }
    if (!trackedSet.has(path)) {
      documents.push({ path, status: 'skipped', reason: 'not a tracked file' });
      continue;
    }
    const absolute = resolve(root, path);
    const info = await stat(absolute).catch(() => null);
    if (!info?.isFile() || info.size === 0 || info.size > DOCS_DEFAULTS.maxDocBytes) {
      documents.push({ path, status: 'skipped', reason: 'empty, missing, or over 256 KiB' });
      continue;
    }
    const text = await readFile(absolute, 'utf8');
    if (text.trim().length < 40) {
      documents.push({ path, status: 'skipped', reason: 'too short to contain knowledge' });
      continue;
    }
    const url = blobUrl(httpsRemote, commit, path);
    try {
      const proposal = await proposeContext(deps, projectId, {
        text: digest(path, text, url),
        taskHint: `Documentation: ${path}`.slice(0, 500),
        source: {
          uri: url ?? `repo://${path}`,
          label: `Documentation ${path}${commit ? ` @ ${commit.slice(0, 7)}` : ''}`.slice(0, 200),
        },
      });
      nodes += proposal.created.nodes.length;
      edges += proposal.created.edges.length;
      documents.push({ path, status: 'proposed', proposal });
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'ERROR';
      const detail = (error as { details?: { detail?: string } }).details?.detail;
      documents.push({ path, status: 'failed', reason: detail ? `${code}: ${detail}` : code });
    }
  }
  return { projectId, commit, documents, created: { nodes, edges } };
}

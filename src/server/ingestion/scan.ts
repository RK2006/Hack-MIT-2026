import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open, realpath, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { graphError } from '../context/errors';
import type { PreparedProjectManifest } from './manifest';

export type CommandRunner = (
  command: string,
  args: string[],
  cwd: string,
) => Promise<{ stdout: string; stderr: string; code: number }>;

export type ScanOptions = {
  name?: string | undefined;
  /** Directory depth that becomes components (root = 0). Default 2. */
  depth?: number | undefined;
  /** Maximum kept files. Default 600. */
  maxFiles?: number | undefined;
  /** Path prefixes to keep (repeatable); empty keeps everything. */
  include?: string[] | undefined;
  run?: CommandRunner | undefined;
};

export type ScanResult = {
  manifest: PreparedProjectManifest;
  stats: { files: number; components: number; skipped: number; commit: string | null };
};

export const SCAN_DEFAULTS = { depth: 2, maxFiles: 600, maxFileBytes: 1_048_576 } as const;
const MAX_NODES = 1000;

const LANGUAGES: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript (React)',
  js: 'JavaScript',
  jsx: 'JavaScript (React)',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  go: 'Go',
  rs: 'Rust',
  java: 'Java',
  kt: 'Kotlin',
  rb: 'Ruby',
  php: 'PHP',
  cs: 'C#',
  swift: 'Swift',
  c: 'C',
  h: 'C header',
  cpp: 'C++',
  hpp: 'C++ header',
  sql: 'SQL',
  sh: 'Shell',
  md: 'Markdown',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  css: 'CSS',
  scss: 'SCSS',
  html: 'HTML',
  prisma: 'Prisma schema',
  graphql: 'GraphQL',
  proto: 'Protocol Buffers',
  tf: 'Terraform',
  dockerfile: 'Dockerfile',
};
const SKIP_BASENAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Cargo.lock',
  'poetry.lock',
  'Gemfile.lock',
  'composer.lock',
  'go.sum',
  '.DS_Store',
]);
const SKIP_PATTERNS = [/\.min\.(js|css)$/, /\.(snap|map)$/];

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

export function slugOf(path: string): string {
  const slug = path
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (/^[a-z]/.test(slug) ? slug : `p-${slug}`).slice(0, 60);
}

/** RFC-4122-shaped, deterministic id from a stable repository identity. */
export function deterministicProjectId(identity: string): string {
  const hex = createHash('sha1').update(identity).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16]!, 16) % 4]!;
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function languageOf(path: string): string | null {
  const base = basename(path);
  if (base.toLowerCase() === 'dockerfile') return LANGUAGES.dockerfile!;
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toLowerCase() : '';
  return LANGUAGES[ext] ?? null;
}

function isKeepable(path: string): boolean {
  const base = basename(path);
  if (SKIP_BASENAMES.has(base) || SKIP_PATTERNS.some((p) => p.test(base))) return false;
  if (
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').some((s) => s === '' || s === '.' || s === '..')
  )
    return false;
  return languageOf(path) !== null;
}

async function firstCommentLine(absolute: string): Promise<string | null> {
  const handle = await open(absolute, 'r');
  try {
    const buffer = Buffer.alloc(512);
    const { bytesRead } = await handle.read(buffer, 0, 512, 0);
    const first = buffer.subarray(0, bytesRead).toString('utf8').split(/\r?\n/)[0]?.trim() ?? '';
    const comment = /^(\/\/|#(?!!)|\/\*+|\*|--|<!--|"""|''')\s*(.*?)\s*(\*\/|-->|"""|''')?$/.exec(
      first,
    );
    const text = comment?.[2]?.trim();
    return text && text.length >= 3 ? Array.from(text).slice(0, 200).join('') : null;
  } finally {
    await handle.close();
  }
}

async function countLines(absolute: string, size: number): Promise<number> {
  if (size === 0) return 0;
  const handle = await open(absolute, 'r');
  try {
    let lines = 0;
    let lastByte = 0;
    const buffer = Buffer.alloc(64 * 1024);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      for (let i = 0; i < bytesRead; i += 1) if (buffer[i] === 10) lines += 1;
      lastByte = buffer[bytesRead - 1]!;
    }
    return lastByte === 10 ? lines : lines + 1;
  } finally {
    await handle.close();
  }
}

/** Structural scan of a git work tree into a prepared manifest; deterministic for the same tree. */
export async function scanRepository(
  rootPath: string,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const run = options.run ?? runCommand;
  const depth = options.depth ?? SCAN_DEFAULTS.depth;
  const maxFiles = options.maxFiles ?? SCAN_DEFAULTS.maxFiles;
  const include = (options.include ?? [])
    .map((p) => p.replace(/^\.?\/+|\/+$/g, ''))
    .filter(Boolean);
  if (!Number.isInteger(depth) || depth < 0 || depth > 6)
    throw graphError('VALIDATION_ERROR', 'depth must be an integer 0..6', { field: 'depth' });
  if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > MAX_NODES)
    throw graphError('VALIDATION_ERROR', `maxFiles must be 1..${MAX_NODES}`, { field: 'maxFiles' });

  let root: string;
  try {
    root = await realpath(resolve(rootPath));
  } catch {
    throw graphError('SOURCE_UNAVAILABLE', 'Repository path does not exist', {
      category: 'not_found',
    });
  }
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
  const httpsRemote = /^https:\/\/[^\s]+$/.test(remote)
    ? remote.replace(/\.git$/, '')
    : /^git@github\.com:(.+?)(?:\.git)?$/.exec(remote)?.[1]
      ? `https://github.com/${/^git@github\.com:(.+?)(?:\.git)?$/.exec(remote)![1]}`
      : null;

  const all = listed.stdout.split('\0').filter(Boolean).sort();
  let skipped = 0;
  const kept: Array<{
    path: string;
    language: string;
    lines: number;
    bytes: number;
    comment: string | null;
  }> = [];
  for (const path of all) {
    if (
      include.length > 0 &&
      !include.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
    ) {
      skipped += 1;
      continue;
    }
    if (!isKeepable(path)) {
      skipped += 1;
      continue;
    }
    const absolute = resolve(root, path);
    const info = await stat(absolute).catch(() => null);
    if (!info || !info.isFile() || info.size > SCAN_DEFAULTS.maxFileBytes) {
      skipped += 1;
      continue;
    }
    kept.push({
      path,
      language: languageOf(path)!,
      lines: await countLines(absolute, info.size),
      bytes: info.size,
      comment: await firstCommentLine(absolute).catch(() => null),
    });
  }
  if (kept.length > maxFiles) {
    throw graphError('LIMIT_EXCEEDED', 'Too many source files for one project', {
      files: kept.length,
      maxFiles,
      hint: 'Use --include <prefix> to narrow the scan or raise --max-files (up to 1000 nodes total)',
    });
  }
  if (kept.length === 0)
    throw graphError('VALIDATION_ERROR', 'No source files found to import', { files: 0, skipped });

  // Components: root plus directories (up to `depth`) that contain kept files.
  const directories = new Map<string, { files: number; children: Set<string> }>();
  const ensure = (dir: string) => {
    if (!directories.has(dir)) directories.set(dir, { files: 0, children: new Set() });
    return directories.get(dir)!;
  };
  ensure('');
  for (const file of kept) {
    const parts = dirname(file.path) === '.' ? [] : dirname(file.path).split('/');
    let current = '';
    for (const part of parts.slice(0, depth)) {
      const next = current ? `${current}/${part}` : part;
      ensure(current).children.add(next);
      ensure(next);
      current = next;
    }
    ensure(current).files += 1;
  }
  const componentKey = (dir: string) =>
    dir === '' ? 'component.root' : `component.${slugOf(dir)}`;
  const name = (
    options.name ??
    (httpsRemote ? httpsRemote.split('/').slice(-1)[0] : basename(root)) ??
    'repository'
  ).slice(0, 120);
  const identity = httpsRemote ?? root;
  const sourceKey = 'source.repository';
  const sortedDirs = [...directories.keys()].sort();
  const usedKeys = new Set<string>();
  const uniqueKey = (key: string, path: string) => {
    if (!usedKeys.has(key)) {
      usedKeys.add(key);
      return key;
    }
    const suffixed = `${key.slice(0, 70)}-${createHash('sha1').update(path).digest('hex').slice(0, 6)}`;
    usedKeys.add(suffixed);
    return suffixed;
  };

  const components: PreparedProjectManifest['components'] = sortedDirs.map((dir) => {
    const info = directories.get(dir)!;
    const totalBelow = kept.filter((f) => dir === '' || f.path.startsWith(`${dir}/`)).length;
    const key = uniqueKey(componentKey(dir), dir);
    return {
      key,
      title: dir === '' ? name : basename(dir),
      content:
        dir === ''
          ? `Repository root of ${name}${httpsRemote ? ` (${httpsRemote})` : ''}: ${kept.length} tracked source files across ${directories.size - 1} scanned directories.`
          : `Directory ${dir}/ with ${info.files} source file(s) directly and ${totalBelow} in total; ${info.children.size} scanned subdirectory(ies).`,
      summary: dir === '' ? 'Repository root' : `${dir}/`,
      importance: dir === '' ? 3 : Math.min(5, 2 + Math.min(3, Math.floor(totalBelow / 5))),
      confidence: 1,
      sourceKey,
      ...(dir !== '' && {
        parentKey: componentKey(dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : ''),
      }),
    };
  });
  const componentKeys = new Map(
    sortedDirs.map((dir, index) => [dir, components[index]!.key] as const),
  );

  const files: PreparedProjectManifest['files'] = kept.map((file) => {
    const parts = dirname(file.path) === '.' ? [] : dirname(file.path).split('/');
    const owner = parts.slice(0, depth).join('/');
    const detail = `${file.language} file, ${file.lines} line(s), ${file.bytes} bytes.`;
    return {
      key: uniqueKey(`file.${slugOf(file.path)}`, file.path),
      path: file.path,
      title: basename(file.path),
      content: file.comment
        ? `${detail} ${file.language === 'Markdown' ? 'Heading' : 'Leading comment'}: ${file.comment}`
        : detail,
      summary: file.path,
      importance: 3,
      confidence: 1,
      sourceKey,
      componentKey: componentKeys.get(owner) ?? 'component.root',
    };
  });

  const nodeCount = components.length + files.length;
  if (nodeCount > MAX_NODES) {
    throw graphError('LIMIT_EXCEEDED', 'Scan exceeds the project node limit', {
      nodes: nodeCount,
      limit: MAX_NODES,
      hint: 'Use --include <prefix>, lower --depth, or lower --max-files',
    });
  }

  const manifest: PreparedProjectManifest = {
    schemaVersion: 1,
    project: { id: deterministicProjectId(identity), name },
    sources: [
      {
        key: sourceKey,
        kind: 'repository',
        uri: httpsRemote ?? `repo://${slugOf(name)}/`,
        label: `Structural scan of ${name}`,
        excerpt: `Deterministic structural scan of the git work tree${commit ? ` at commit ${commit}` : ''}: tracked source files (allow-listed extensions, ≤ 1 MiB) became File nodes and directories up to depth ${depth} became components. File content records language, line count, byte size, and any leading comment; no code was executed or analyzed. ${skipped} tracked path(s) were skipped as non-source or filtered.`,
        actorLabel: 'repository-scanner',
      },
    ],
    components,
    files,
    claims: [],
    edges: [],
  };
  return {
    manifest,
    stats: { files: files.length, components: components.length, skipped, commit },
  };
}

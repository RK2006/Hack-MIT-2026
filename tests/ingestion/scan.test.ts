import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GraphError } from '../../src/server/context/errors';
import { parseManifestBytes } from '../../src/server/ingestion/manifest';
import { deterministicProjectId, scanRepository, slugOf } from '../../src/server/ingestion/scan';

let root: string;
const git = (...args: string[]) =>
  execFileSync('git', args, {
    cwd: root,
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  });

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'scan-'));
  git('init', '-q');
  const files: Record<string, string> = {
    'README.md': '# Sample service\n\nDocs.\n',
    'package.json': '{"name":"sample"}\n',
    'package-lock.json': '{}\n',
    'src/payments/webhook.ts':
      '// Handles Stripe webhook deliveries.\nexport const a = 1;\nexport const b = 2;\n',
    'src/payments/deep/nested/util.ts': 'export const c = 3;',
    'src/catalog/index.ts': '/* Catalog entry point */\nexport {};\n',
    'assets/logo.png': 'binary-ish',
    'scripts/run.sh': '#!/bin/sh\necho hi\n',
    'ignored.log': 'nope\n',
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), content);
  }
  await writeFile(join(root, '.gitignore'), '*.log\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('scanRepository', () => {
  it('derives components, files, metadata, and skips non-source paths (A1)', async () => {
    const { manifest, stats } = await scanRepository(root, { name: 'Sample' });
    expect(manifest.project.name).toBe('Sample');
    expect(manifest.components.map((c) => c.key)).toEqual([
      'component.root',
      'component.scripts',
      'component.src',
      'component.src-catalog',
      'component.src-payments',
    ]);
    expect(manifest.components.find((c) => c.key === 'component.src-payments')?.parentKey).toBe(
      'component.src',
    );
    const paths = manifest.files.map((f) => f.path);
    expect(paths).toEqual([
      'README.md',
      'scripts/run.sh',
      'src/catalog/index.ts',
      'src/payments/deep/nested/util.ts',
      'src/payments/webhook.ts',
    ]);
    expect(paths).not.toContain('package.json');
    expect(paths).not.toContain('package-lock.json');
    expect(paths).not.toContain('assets/logo.png');
    expect(paths).not.toContain('ignored.log');
    const webhook = manifest.files.find((f) => f.path === 'src/payments/webhook.ts')!;
    expect(webhook.componentKey).toBe('component.src-payments');
    expect(webhook.content).toBe(
      'TypeScript file, 3 line(s), 78 bytes. Leading comment: Handles Stripe webhook deliveries.',
    );
    const nested = manifest.files.find((f) => f.path.startsWith('src/payments/deep'))!;
    expect(nested.componentKey).toBe('component.src-payments');
    expect(nested.content).toBe('TypeScript file, 1 line(s), 19 bytes.');
    const shell = manifest.files.find((f) => f.path === 'scripts/run.sh')!;
    expect(shell.content).not.toContain('Leading comment');
    expect(manifest.claims).toEqual([]);
    expect(manifest.edges).toEqual([]);
    expect(manifest.sources[0]?.kind).toBe('repository');
    expect(manifest.sources[0]?.excerpt).toContain(`commit ${stats.commit}`);
    expect(stats).toMatchObject({ files: 5, components: 5 });
    expect(stats.skipped).toBeGreaterThanOrEqual(3);
    expect(() => parseManifestBytes(Buffer.from(JSON.stringify(manifest)))).not.toThrow();
  });

  it('keeps repository plumbing only with files: all', async () => {
    const all = await scanRepository(root, { files: 'all' });
    expect(all.manifest.files.map((f) => f.path)).toContain('package.json');
    expect(all.manifest.files.map((f) => f.path)).not.toContain('package-lock.json');
    expect(all.manifest.sources[0]?.excerpt).toContain('all allow-listed files');
  });

  it('is deterministic and derives a stable project id from the repository identity', async () => {
    const first = await scanRepository(root);
    const second = await scanRepository(root);
    expect(JSON.stringify(first.manifest)).toBe(JSON.stringify(second.manifest));
    expect(first.manifest.project.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(deterministicProjectId('x')).toBe(deterministicProjectId('x'));
    expect(deterministicProjectId('x')).not.toBe(deterministicProjectId('y'));
  });

  it('honors depth and include filters (A2)', async () => {
    const shallow = await scanRepository(root, { depth: 1 });
    expect(shallow.manifest.components.map((c) => c.key)).toEqual([
      'component.root',
      'component.scripts',
      'component.src',
    ]);
    expect(
      shallow.manifest.files.find((f) => f.path === 'src/payments/webhook.ts')?.componentKey,
    ).toBe('component.src');
    const only = await scanRepository(root, { include: ['src/payments'] });
    expect(only.manifest.files.map((f) => f.path)).toEqual([
      'src/payments/deep/nested/util.ts',
      'src/payments/webhook.ts',
    ]);
    expect(only.manifest.components.map((c) => c.key)).toEqual([
      'component.root',
      'component.src',
      'component.src-payments',
    ]);
  });

  it('enforces bounds and rejects non-git paths (A2)', async () => {
    await expect(scanRepository(root, { maxFiles: 2 })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
      details: { maxFiles: 2 },
    });
    await expect(scanRepository(tmpdir())).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    await expect(scanRepository(join(root, 'does-not-exist'))).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
    });
    await expect(scanRepository(join(root, 'src'))).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
      details: { category: 'not_git' },
    });
    await expect(scanRepository(root, { include: ['nothing-here'] })).rejects.toBeInstanceOf(
      GraphError,
    );
    await expect(scanRepository(root, { depth: 9 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('slugifies paths into manifest keys', () => {
    expect(slugOf('src/Payments/Web hook.ts')).toBe('src-payments-web-hook-ts');
    expect(slugOf('123abc')).toBe('p-123abc');
  });
});

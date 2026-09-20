import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { graphError } from '../../src/server/context/errors';
import { createGraphStore } from '../../src/server/context/store';
import type { GraphStore } from '../../src/server/context/types';
import { ingestDocumentation } from '../../src/server/ingestion/docs';
import { importPreparedProject } from '../../src/server/ingestion/import';
import { scanRepository } from '../../src/server/ingestion/scan';
import { fixedProposalModel } from '../../src/server/proposals/model';
import { isolatedDatabase } from '../helpers/postgres';

describe('documentation ingestion on a scanned repository', () => {
  let db: Awaited<ReturnType<typeof isolatedDatabase>>;
  let store: GraphStore;
  let root: string;
  let projectId: string;

  beforeAll(async () => {
    db = await isolatedDatabase();
    store = createGraphStore(db.pool);
    root = await mkdtemp(join(tmpdir(), 'docs-'));
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
    git('init', '-q');
    git('remote', 'add', 'origin', 'https://github.com/example/sample.git');
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(
      join(root, 'README.md'),
      '# Sample\n\nAll handlers must be idempotent because the provider retries deliveries.\n',
    );
    await writeFile(join(root, 'CLAUDE.md'), '@AGENTS.md\n');
    await writeFile(join(root, 'src/index.ts'), 'export {};\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'init');
    const { manifest } = await scanRepository(root, { name: 'Sample' });
    projectId = (await importPreparedProject(Buffer.from(JSON.stringify(manifest)), store))
      .projectId;
  });
  afterAll(async () => {
    await db.cleanup();
    await rm(root, { recursive: true, force: true });
  });

  it('writes inferred claims per document with the file URL as evidence, skipping trivial files', async () => {
    const seenPrompts: string[] = [];
    const model = fixedProposalModel((prompt) => {
      seenPrompts.push(prompt.user);
      return JSON.stringify({
        nodes: [
          {
            key: 'idempotent-handlers',
            type: 'constraint',
            title: 'Handlers must be idempotent',
            content: 'Provider retries deliveries, so handlers must be idempotent.',
            summary: '',
            importance: 5,
            confidence: 0.9,
            evidence: 'All handlers must be idempotent',
          },
        ],
        edges: [{ fromKey: 'idempotent-handlers', toKey: 'file.src-index-ts', type: 'CONSTRAINS' }],
      });
    }, 'fixed:docs');
    const result = await ingestDocumentation({ store, model }, projectId, root);
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(result.documents.map((d) => [d.path, d.status])).toEqual([
      ['CLAUDE.md', 'skipped'],
      ['README.md', 'proposed'],
    ]);
    expect(result.created).toEqual({ nodes: 1, edges: 1 });
    expect(seenPrompts[0]).toContain('Documentation file README.md');
    expect(seenPrompts[0]).toContain('must be idempotent');
    const readme = result.documents.find((d) => d.path === 'README.md')!.proposal!;
    const source = await store.getSource(projectId, readme.sourceId!);
    expect(source.kind).toBe('agent');
    expect(source.uri).toBe(`https://github.com/example/sample/blob/${result.commit}/README.md`);
    const claimSource = await store.getSource(
      projectId,
      (await store.getNode(projectId, readme.created.nodes[0]!.nodeId)).current.sourceId,
    );
    expect(claimSource.uri).toBe(source.uri);
    expect(claimSource.excerpt).toContain('Supporting quote: "All handlers must be idempotent"');
    expect(source.label).toContain('Documentation README.md @');
    const node = await store.getNode(projectId, readme.created.nodes[0]!.nodeId);
    expect(node.current.authority).toBe('inferred');
    expect(node.type).toBe('constraint');
    const graph = await store.getGraph(projectId);
    const edge = graph.edges.find((e) => e.fromNodeId === node.id)!;
    expect(graph.nodes.find((n) => n.id === edge.toNodeId)?.path).toBe('src/index.ts');
  });

  it('reports a failing model per document instead of aborting, and honors explicit files', async () => {
    const failing = {
      id: 'fixed:down',
      complete: async () => {
        throw graphError('MODEL_UNAVAILABLE', 'down', { detail: 'quota' });
      },
    };
    const before = (await store.getGraph(projectId)).nodes.length;
    const result = await ingestDocumentation({ store, model: failing }, projectId, root, {
      files: ['README.md', 'missing.md'],
    });
    expect(result.documents).toEqual([
      { path: 'README.md', status: 'failed', reason: 'MODEL_UNAVAILABLE: quota' },
      { path: 'missing.md', status: 'skipped', reason: 'not a tracked file' },
    ]);
    expect((await store.getGraph(projectId)).nodes.length).toBe(before);
    await expect(
      ingestDocumentation({ store, model: failing }, projectId, tmpdir()),
    ).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
  });
});

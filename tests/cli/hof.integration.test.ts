import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXIT, run, type Io, type Services } from '../../src/cli/hof';
import { createEmbeddingCache } from '../../src/server/context/compiler/cache';
import { fixedEmbeddingProvider } from '../../src/server/context/compiler/embedding';
import type { ContextBundle } from '../../src/server/context/compiler/types';
import { createGraphStore } from '../../src/server/context/store';
import type { ContextNode } from '../../src/server/context/types';
import { DEMO_PROJECT_ID } from '../../src/server/ingestion/demo-expectations';
import { importPreparedProject } from '../../src/server/ingestion/import';
import { isolatedDatabase } from '../helpers/postgres';

let db: Awaited<ReturnType<typeof isolatedDatabase>>;
let services: Services;
let cwd: string;
let clipboard = '';

/** Every input embeds to the same vector, so similarity is 1 everywhere: deterministic and offline. */
const provider = fixedEmbeddingProvider(new Map(), { dimensions: 3, fallback: [1, 0, 0] });

type Result = { code: number; out: string; err: string; json: <T>() => T };
type Options = {
  env?: Record<string, string>;
  stdin?: string;
  /** Scripted answers for `review`; also marks the session interactive. */
  answers?: string[];
};

async function hof(args: string[], options: Options = {}): Promise<Result> {
  let out = '';
  let err = '';
  const answers = [...(options.answers ?? [])];
  const io: Io = {
    stdout: (text) => (out += text),
    stderr: (text) => (err += text),
    cwd,
    env: options.env ?? {},
    readStdin: async () => options.stdin ?? '',
    isTTY: options.answers !== undefined,
    prompt: async () => answers.shift() ?? 'q',
  };
  const code = await run(args, io, services);
  return { code, out, err, json: <T>() => JSON.parse(out) as T };
}

beforeAll(async () => {
  db = await isolatedDatabase();
  const store = createGraphStore(db.pool);
  await importPreparedProject(
    await readFile(new URL('../../fixtures/demo-payments.json', import.meta.url)),
    store,
  );
  services = {
    store,
    compiler: async () => ({ store, provider, cache: createEmbeddingCache(db.pool) }),
    proposalModel: () => null,
    editText: async (initial) => `${initial}\n\nEdited by the reviewer.`,
    copy: async (text) => {
      clipboard = text;
      return true;
    },
  };
  cwd = mkdtempSync(join(tmpdir(), 'hof-int-'));
});
afterAll(async () => {
  rmSync(cwd, { recursive: true, force: true });
  await db.cleanup();
});

describe('hof binding and read commands', () => {
  it('requires a binding, then binds by name substring', async () => {
    const before = await hof(['status']);
    expect(before.code).toBe(EXIT.domain);
    expect(before.err).toContain('hof use');

    const bound = await hof(['use', 'demo payments']);
    expect(bound.code).toBe(EXIT.ok);
    expect(bound.out).toContain(DEMO_PROJECT_ID);

    const projects = await hof(['projects']);
    expect(projects.out).toMatch(new RegExp(`^\\*\\s+${DEMO_PROJECT_ID}`, 'm'));
  });

  it('reports status, lists and filters nodes, and honours --json', async () => {
    const status = await hof(['status']);
    expect(status.out).toContain('active nodes');
    const json = await hof(['ls', '--type', 'constraint', '--json']);
    const { nodes } = json.json<{ nodes: ContextNode[] }>();
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.every((node) => node.type === 'constraint')).toBe(true);
    const grep = await hof(['ls', '--grep', 'idempot']);
    expect(grep.out.split('\n').length).toBeGreaterThan(1);
  });

  it('shows, logs, and diffs a node by external key and by prefix', async () => {
    const show = await hof(['show', 'component.stripe-webhooks']);
    expect(show.code).toBe(EXIT.ok);
    expect(show.out).toContain('→ REQUIRES →');
    expect(show.out).toContain('Source ');
    const { node } = (await hof(['show', 'component.stripe-webhooks', '--json'])).json<{
      node: ContextNode;
    }>();
    const log = await hof(['log', node.id.slice(0, 8)]);
    expect(log.out).toContain('v1  canonical');
    const diff = await hof(['diff', node.id.slice(0, 8)]);
    expect(diff.out).toContain('identical');
  });

  it('maps a missing node and a bad flag to the documented exit codes', async () => {
    expect((await hof(['show', 'nope.missing'])).code).toBe(EXIT.domain);
    expect((await hof(['ls', '--bogus'])).code).toBe(EXIT.usage);
    expect((await hof(['nonsense'])).code).toBe(EXIT.usage);
    expect((await hof(['show'])).code).toBe(EXIT.usage);
  });
});

describe('hof checkout', () => {
  it('writes only the context text to stdout and the explanation to stderr', async () => {
    const result = await hof(['checkout', 'Fix duplicate Stripe webhook processing', '-b', '1024']);
    expect(result.code).toBe(EXIT.ok);
    expect(result.out.startsWith('# Task context:')).toBe(true);
    expect(result.out).not.toContain('selected ');
    expect(result.err).toMatch(/^status ok · \d+ \/ 1024 tokens/);
    const bundle = (
      await hof(['checkout', 'Fix duplicate Stripe webhook processing', '-b', '1024', '--json'])
    ).json<ContextBundle>();
    expect(bundle.contextText).toBe(result.out);
    expect(bundle.tokenCount).toBeLessThanOrEqual(1024);
  });

  it('accepts --start refs and --explain', async () => {
    const result = await hof([
      'checkout',
      'anything',
      '--start',
      'component.stripe-webhooks',
      '--explain',
    ]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.out).toContain('explicit reference: requested as a starting node');
  });
});

describe('hof review loop', () => {
  it('lists pending proposals, accepts one, rejects another, and records provenance', async () => {
    const pending = (await hof(['pending', '--json'])).json<{ nodes: ContextNode[] }>().nodes;
    expect(pending.length).toBeGreaterThanOrEqual(2);
    const [first, second] = pending;

    const accept = await hof([
      'accept',
      first!.id.slice(0, 8),
      '--note',
      'Checked against staging',
    ]);
    expect(accept.code).toBe(EXIT.ok);
    expect(accept.out).toContain('→ v2 canonical');

    const log = await hof(['log', first!.id, '--json']);
    const { revisions } = log.json<{ revisions: ContextNode['current'][] }>();
    expect(revisions).toHaveLength(2);
    expect(revisions[1]).toMatchObject({
      authority: 'canonical',
      confidence: 1,
      actor: { kind: 'human', label: 'local-operator' },
    });
    const source = await hof(['source', revisions[1]!.sourceId]);
    expect(source.out).toContain('Note: Checked against staging');

    const reject = await hof(['reject', second!.externalKey!]);
    expect(reject.code).toBe(EXIT.ok);
    expect((await hof(['ls', '--archived'])).out).toContain(second!.current.title);
    expect((await hof(['pending', '--json'])).json<{ nodes: ContextNode[] }>().nodes).toHaveLength(
      pending.length - 2,
    );
  });

  it('continues past a bad ref and exits 1', async () => {
    const result = await hof(['accept', 'nope.missing']);
    expect(result.code).toBe(EXIT.domain);
    expect(result.out).toContain('✗ NOT_FOUND');
  });

  it('refuses LLM commands without a model, with exit 3', async () => {
    const result = await hof(['propose', '-']);
    expect(result.code).toBe(EXIT.environment);
    expect(result.err).toContain('ANTHROPIC_API_KEY');
  });
});

describe('hof authoring', () => {
  const evidence = ['-m', 'Recorded during the demo', '--evidence', 'Observed in staging logs'];

  it('creates a canonical node linked to an existing one, reading content from stdin', async () => {
    const created = await hof(
      [
        'note',
        'decision',
        'Retry webhook delivery asynchronously',
        '--content',
        '-',
        '--summary',
        'Retries move to a queue',
        '--key',
        'decision.async-retries',
        '--link',
        'component.stripe-webhooks',
        '--edge',
        'AFFECTS',
        ...evidence,
      ],
      { stdin: 'Retries run from a queue so the webhook path stays fast.\n' },
    );
    expect(created.code).toBe(EXIT.ok);
    expect(created.out).toMatch(
      /^Created [0-9a-f]{8} decision "Retry webhook delivery asynchronously" \(canonical v1\) · edge this → AFFECTS → /,
    );
    const shown = (await hof(['show', 'decision.async-retries', '--json'])).json<{
      node: ContextNode;
    }>().node;
    expect(shown.current.content).toContain('Retries run from a queue');
    expect(shown.current.actor).toEqual({ kind: 'human', label: 'local-operator' });
    expect((await hof(['show', 'decision.async-retries'])).out).toContain('this → AFFECTS →');
  });

  it('requires -m and --evidence, a content flag, and a valid type', async () => {
    expect((await hof(['note', 'decision', 'X', '--content', 'y'])).code).toBe(EXIT.usage);
    expect((await hof(['note', 'decision', 'X', ...evidence])).code).toBe(EXIT.usage);
    expect((await hof(['note', 'widget', 'X', '--content', 'y', ...evidence])).code).toBe(
      EXIT.usage,
    );
    expect((await hof(['note', 'file', 'X', '--content', 'y', ...evidence])).code).toBe(
      EXIT.domain,
    ); // files need --path: store validation
  });

  it('edits fields as a new revision and reports a no-op', async () => {
    const edited = await hof([
      'edit',
      'decision.async-retries',
      '--summary',
      'Retries are queued',
      '--importance',
      '4',
      ...evidence,
    ]);
    expect(edited.code).toBe(EXIT.ok);
    expect(edited.out).toContain('→ v2 (canonical)');
    const diff = await hof(['diff', 'decision.async-retries', '1', '2']);
    expect(diff.out).toContain(
      'summary:\n  - v1: Retries move to a queue\n  + v2: Retries are queued',
    );
    expect(diff.out).toContain('importance:');
    const noop = await hof(['edit', 'decision.async-retries', '--importance', '4', ...evidence]);
    expect(noop.out).toContain('nothing changed');
    expect((await hof(['edit', 'decision.async-retries', ...evidence])).code).toBe(EXIT.usage);
  });

  it('archives and restores, keeping history', async () => {
    const archived = await hof(['archive', 'decision.async-retries', ...evidence]);
    expect(archived.code).toBe(EXIT.ok);
    expect(archived.out).toContain('→ v3 archived');
    expect((await hof(['ls', '--archived'])).out).toContain(
      'Retry webhook delivery asynchronously',
    );
    const restored = await hof(['restore', 'decision.async-retries', ...evidence]);
    expect(restored.out).toContain('→ v4 restored');
    expect(
      (await hof(['log', 'decision.async-retries', '--json'])).json<{ revisions: unknown[] }>()
        .revisions,
    ).toHaveLength(4);
  });
});

describe('hof scan', () => {
  const repo = new URL('../..', import.meta.url).pathname;

  it('writes a manifest with --out without importing or binding', async () => {
    const out = join(cwd, 'scan.json');
    const before = (await hof(['projects', '--json'])).json<{ projects: unknown[] }>().projects;
    const result = await hof([
      'scan',
      repo,
      '--out',
      out,
      '--include',
      'src/cli',
      '--files',
      'all',
    ]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.out).toContain(`Wrote ${out}`);
    expect(JSON.parse(readFileSync(out, 'utf8')).files.length).toBeGreaterThan(3);
    expect(
      (await hof(['projects', '--json'])).json<{ projects: unknown[] }>().projects,
    ).toHaveLength(before.length);
  });

  it('imports the scan, binds the directory, and conflicts on a repeat', async () => {
    const result = await hof([
      'scan',
      repo,
      '--name',
      'Scanned self',
      '--include',
      'src/cli',
      '--files',
      'all',
      '--docs', // no model configured → warning only
    ]);
    try {
      expect(result.code).toBe(EXIT.ok);
      expect(result.out).toMatch(
        /^Imported "Scanned self" \([0-9a-f-]{36}\): \d+ components, \d+ files/,
      );
      expect(result.err).toContain('--docs skipped');
      expect((await hof(['status'])).out).toContain('Scanned self');
      // File nodes are addressable by their repository path.
      const shown = await hof(['show', 'src/cli/hof.ts']);
      expect(shown.code).toBe(EXIT.ok);
      expect(shown.out).toContain('path: src/cli/hof.ts');
      const again = await hof(['scan', repo, '--name', 'Scanned self', '--include', 'src/cli']);
      expect(again.code).toBe(EXIT.domain);
      expect(again.err).toContain('CONFLICT');
    } finally {
      // Put the binding back for the remaining tests.
      await hof(['use', 'demo payments']);
    }
  });
});

describe('hof review and checkout --copy', () => {
  it('walks pending proposals with scripted answers: accept, edit, skip, quit', async () => {
    const before = (await hof(['pending', '--json'])).json<{ nodes: ContextNode[] }>().nodes;
    expect(before.length).toBeGreaterThanOrEqual(2);
    const result = await hof(['review', '--note', 'Batch review'], {
      answers: ['x', 'a', 'e', 's', 'q'],
    });
    expect(result.code).toBe(EXIT.ok);
    expect(result.out).toContain(`[1/${before.length}]`);
    expect(result.out).toContain('✓ edited and accepted');
    expect(result.out).toMatch(/accepted 1 · edited 1 · rejected 0 · skipped [01] · failed 0/);
    const edited = (await hof(['show', before[1]!.id, '--json'])).json<{ node: ContextNode }>()
      .node;
    expect(edited.current.authority).toBe('canonical');
    expect(edited.current.content).toContain('Edited by the reviewer.');
    expect(edited.current.changeReason).toBe('Edited and accepted agent proposal');
    const after = (await hof(['pending', '--json'])).json<{ nodes: ContextNode[] }>().nodes;
    expect(after).toHaveLength(before.length - 2);
  });

  it('falls back to the pending table without a TTY, exit 2', async () => {
    const result = await hof(['review']);
    expect(result.code).toBe(EXIT.usage);
    expect(result.err).toContain('interactive terminal');
  });

  it('copies the exact text with --copy and still prints it', async () => {
    clipboard = '';
    const result = await hof(['checkout', 'Fix duplicate Stripe webhook processing', '--copy']);
    expect(result.code).toBe(EXIT.ok);
    expect(clipboard).toBe(result.out);
    expect(result.err).toContain('copied');
  });
});

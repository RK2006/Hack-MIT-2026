import { mkdtempSync, rmSync } from 'node:fs';
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

/** Every input embeds to the same vector, so similarity is 1 everywhere: deterministic and offline. */
const provider = fixedEmbeddingProvider(new Map(), { dimensions: 3, fallback: [1, 0, 0] });

type Result = { code: number; out: string; err: string; json: <T>() => T };

async function hof(args: string[], env: Record<string, string> = {}): Promise<Result> {
  let out = '';
  let err = '';
  const io: Io = {
    stdout: (text) => (out += text),
    stderr: (text) => (err += text),
    cwd,
    env,
    readStdin: async () => '',
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

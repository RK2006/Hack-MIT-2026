import { readFile, rm } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEmbeddingCache } from '../../src/server/context/compiler/cache';
import { compileContext, type CompilerDeps } from '../../src/server/context/compiler/compile';
import { embeddingProviderFromEnv } from '../../src/server/context/compiler/embedding';
import type { ContextBundle } from '../../src/server/context/compiler/types';
import { createGraphStore } from '../../src/server/context/store';
import type { GraphStore } from '../../src/server/context/types';
import { importPreparedProject } from '../../src/server/ingestion/import';
import { mergeClaimsOverlay, parseClaimsOverlay } from '../../src/server/ingestion/overlay';
import { scanRepository } from '../../src/server/ingestion/scan';
import { isolatedDatabase } from '../helpers/postgres';
import {
  createLayoutCheckout,
  PRIMARY_EXCLUDED_PREFIXES,
  PRIMARY_EXPECTED_KEYS,
  TRIPLINE_BACKUP_TASK,
  TRIPLINE_PRIMARY_TASK,
} from './tripline-layout';

/**
 * Semantic gate for the Tripline demo (spec §14 A1–A4). Uses the real local embedding provider,
 * because the point is that the demo selection holds on stage. Set TRIPLINE_PATH to a real clone
 * to run against the actual repository; otherwise the spec's layout stands in for it.
 */
describe('Tripline demo pipeline against PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof isolatedDatabase>>;
  let store: GraphStore;
  let deps: CompilerDeps;
  let projectId: string;
  let tempCheckout: string | null = null;
  let keyOf: Map<string, string>;
  let stats: { components: number; files: number; claims: number };

  const selectedKeys = (bundle: ContextBundle) => bundle.selected.map((s) => keyOf.get(s.nodeId)!);

  beforeAll(async () => {
    const checkout = process.env.TRIPLINE_PATH ?? (tempCheckout = await createLayoutCheckout());
    db = await isolatedDatabase();
    store = createGraphStore(db.pool);
    const scanned = await scanRepository(checkout, { name: 'Tripline' });
    const overlay = parseClaimsOverlay(await readFile('fixtures/tripline-claims.json', 'utf8'));
    const merged = mergeClaimsOverlay(scanned.manifest, overlay);
    stats = {
      components: scanned.stats.components,
      files: scanned.stats.files,
      claims: merged.claims.length,
    };
    const imported = await importPreparedProject(Buffer.from(JSON.stringify(merged)), store);
    projectId = imported.projectId;
    const graph = await store.getGraph(projectId);
    keyOf = new Map(graph.nodes.map((node) => [node.id, node.externalKey ?? node.id]));
    deps = { store, provider: embeddingProviderFromEnv(), cache: createEmbeddingCache(db.pool) };
  }, 120_000);
  afterAll(async () => {
    await db.cleanup();
    if (tempCheckout) await rm(tempCheckout, { recursive: true, force: true });
  });

  it('imports with default scan options: canonical only, nothing pending (A1)', async () => {
    expect(stats.components).toBeGreaterThanOrEqual(8);
    expect(stats.files).toBeGreaterThanOrEqual(30);
    expect(stats.files).toBeLessThanOrEqual(70);
    expect(stats.claims).toBeGreaterThanOrEqual(12);
    const graph = await store.getGraph(projectId);
    expect(graph.nodes.every((n) => n.current.authority === 'canonical')).toBe(true);
  });

  it('selects the reminders file, its component, the zone rule, ADR-001, and the bug; excludes pricing/providers/auth (A2–A4)', async () => {
    const bundle = await compileContext(deps, projectId, {
      task: TRIPLINE_PRIMARY_TASK,
      tokenBudget: 2048,
    });
    const keys = selectedKeys(bundle);
    expect(bundle.status).toBe('ok');
    expect(bundle.tokenCount).toBeLessThanOrEqual(2048);
    expect(bundle.metrics.projectContextTokens).toBeGreaterThanOrEqual(3 * bundle.tokenCount);
    expect(bundle.selected.length * 4).toBeLessThanOrEqual(bundle.metrics.activeNodes);
    for (const expected of PRIMARY_EXPECTED_KEYS) expect(keys).toContain(expected);
    for (const key of keys)
      for (const prefix of PRIMARY_EXCLUDED_PREFIXES) expect(key.startsWith(prefix)).toBe(false);
    for (const item of bundle.selected) expect(item.reasons.length).toBeGreaterThan(0);
    const constraint = bundle.selected.find(
      (s) => keyOf.get(s.nodeId) === 'constraint.utc-storage-stop-zone-display',
    )!;
    expect(
      constraint.reasons.some(
        (r) => r.kind === 'semantic_match' || (r.kind === 'graph_neighbor' && r.path.length <= 2),
      ),
    ).toBe(true);
  }, 120_000);

  it('at a 1024 budget only the rules survive, with the rest reported as omissions', async () => {
    const bundle = await compileContext(deps, projectId, {
      task: TRIPLINE_PRIMARY_TASK,
      tokenBudget: 1024,
    });
    const keys = selectedKeys(bundle);
    expect(bundle.tokenCount).toBeLessThanOrEqual(1024);
    expect(keys).toContain('constraint.utc-storage-stop-zone-display');
    expect(keys).toContain('bug.reminders-home-zone');
    expect(bundle.omissions.some((o) => o.reason === 'budget')).toBe(true);
  }, 120_000);

  it('the backup task reaches the idempotency rule and the hotel adapter', async () => {
    const bundle = await compileContext(deps, projectId, {
      task: TRIPLINE_BACKUP_TASK,
      tokenBudget: 2048,
    });
    const keys = selectedKeys(bundle);
    expect(keys).toContain('constraint.booking-ref-idempotency');
    expect(keys).toContain('bug.hotel-retry-duplicate-reservation');
    expect(keys).toContain('file.src-providers-hotels-ts');
    expect(keys.some((k) => k.startsWith('component.src-notifications'))).toBe(false);
  }, 120_000);
});

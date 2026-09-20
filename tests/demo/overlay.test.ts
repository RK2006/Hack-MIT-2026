import { readFile, rm } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GraphError } from '../../src/server/context/errors';
import {
  parseManifestBytes,
  type PreparedProjectManifest,
} from '../../src/server/ingestion/manifest';
import {
  mergeClaimsOverlay,
  parseClaimsOverlay,
  type ClaimsOverlay,
} from '../../src/server/ingestion/overlay';
import { scanRepository } from '../../src/server/ingestion/scan';
import { createLayoutCheckout } from './tripline-layout';

let root: string;
let scanned: PreparedProjectManifest;
let overlay: ClaimsOverlay;

beforeAll(async () => {
  root = await createLayoutCheckout();
  scanned = (await scanRepository(root, { name: 'Tripline' })).manifest;
  overlay = parseClaimsOverlay(await readFile('fixtures/tripline-claims.json', 'utf8'));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('tripline claims overlay', () => {
  it('merges onto a scan of the specified layout into a valid manifest (D1, D2)', () => {
    const merged = mergeClaimsOverlay(scanned, overlay);
    const bytes = Buffer.from(JSON.stringify(merged));
    expect(() => parseManifestBytes(bytes)).not.toThrow();
    expect(merged.claims.length).toBeGreaterThanOrEqual(12);
    expect(merged.claims.length).toBeLessThanOrEqual(20);
    expect(merged.components.length).toBeGreaterThanOrEqual(8);
    const keys = new Set(merged.claims.map((c) => c.key));
    for (const required of [
      'constraint.utc-storage-stop-zone-display',
      'decision.adr-001-store-utc-render-stop-zone',
      'bug.reminders-home-zone',
      'bug.hotel-retry-duplicate-reservation',
    ])
      expect(keys.has(required)).toBe(true);
  });

  it('every overlay source is a manual GitHub URL under the tripline repository', () => {
    for (const source of overlay.sources) {
      expect(source.kind).toBe('manual');
      expect(source.uri).toMatch(/^https:\/\/github\.com\/AnmolKaran\/hackmit-demo-2026\//);
    }
    for (const claim of overlay.claims)
      expect(overlay.sources.some((s) => s.key === claim.sourceKey)).toBe(true);
  });

  it('lists every unresolved key at once instead of failing on the first', () => {
    const broken: ClaimsOverlay = {
      ...overlay,
      edges: [
        ...overlay.edges,
        {
          fromKey: 'file.src-notifications-remind-ts',
          toKey: 'component.src-alerts',
          type: 'IMPLEMENTS',
          sourceKey: 'source.pr-reminders',
        },
      ],
    };
    let caught: unknown;
    try {
      mergeClaimsOverlay(scanned, broken);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GraphError);
    const details = (caught as GraphError).details!;
    expect((caught as GraphError).code).toBe('VALIDATION_ERROR');
    expect(details.missing).toEqual(['component.src-alerts', 'file.src-notifications-remind-ts']);
  });

  it('rejects keys that collide with the scanned manifest', () => {
    const colliding: ClaimsOverlay = {
      ...overlay,
      sources: [...overlay.sources, { ...overlay.sources[0]!, key: 'source.repository' }],
    };
    expect(() => mergeClaimsOverlay(scanned, colliding)).toThrow(/repeats keys/);
  });

  it('rejects an overlay that carries structure', () => {
    expect(() =>
      parseClaimsOverlay(
        JSON.stringify({ schemaVersion: 1, sources: [], claims: [], edges: [], files: [] }),
      ),
    ).toThrow(GraphError);
  });
});

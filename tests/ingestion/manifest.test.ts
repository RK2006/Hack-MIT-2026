import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseManifestBytes } from '../../src/server/ingestion/manifest.js';
import { importPreparedProject } from '../../src/server/ingestion/import.js';
import type { GraphStore } from '../../src/server/context/types.js';
import {
  EXPECTED_DISTRACTOR_KEYS,
  EXPECTED_RELEVANT_KEYS,
} from '../../src/server/ingestion/demo-expectations.js';

const encode = (value: string) => new TextEncoder().encode(value);

describe('prepared manifest validation', () => {
  it('validates the exact synthetic fixture and retrieval anchors', async () => {
    const bytes = await readFile(new URL('../../fixtures/demo-payments.json', import.meta.url));
    const manifest = parseManifestBytes(bytes);
    const keys = new Set([
      ...manifest.components.map((item) => item.key),
      ...manifest.files.map((item) => item.key),
      ...manifest.claims.map((item) => item.key),
    ]);
    expect(manifest.project.id).toBe('7f63f0c8-9a4e-4e2a-8ebd-a8f2b3f8c101');
    expect(manifest.sources).toHaveLength(3);
    expect(manifest.components.length + manifest.files.length + manifest.claims.length).toBe(29);
    expect(
      manifest.edges.length +
        manifest.files.length +
        manifest.components.filter((item) => item.parentKey).length,
    ).toBe(34);
    for (const key of [...EXPECTED_RELEVANT_KEYS, ...EXPECTED_DISTRACTOR_KEYS])
      expect(keys.has(key)).toBe(true);
    expect(
      manifest.sources.every((source) => source.excerpt.includes('synthetic prepared example')),
    ).toBe(true);
    expect(
      manifest.claims.find((item) => item.key === 'bug.repeated-delivery-side-effects')?.sourceKey,
    ).toBe('source.agent');
    expect(
      manifest.claims.find((item) => item.key === 'assumption.process-memory-dedupe')?.sourceKey,
    ).toBe('source.agent');
    expect(
      manifest.claims.find((item) => item.key === 'constraint.webhook-audit-retention')?.content
        .length,
    ).toBeGreaterThan(500);
    expect(manifest.files.find((item) => item.key === 'file.webhook-handler')?.path).toBe(
      'src/payments/webhook.ts',
    );
    expect(manifest.files.find((item) => item.key === 'file.event-receipts')?.path).toBe(
      'src/payments/event-receipts.ts',
    );
    expect(manifest.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromKey: 'component.stripe-webhooks',
          toKey: 'component.event-receipt-store',
          type: 'DEPENDS_ON',
        }),
        expect.objectContaining({
          fromKey: 'component.stripe-webhooks',
          toKey: 'constraint.provider-event-id-unique',
          type: 'REQUIRES',
        }),
      ]),
    );
  });

  it.each([
    ['duplicate JSON member', '{"schemaVersion":1,"schemaVersion":1}'],
    ['BOM', '\ufeff{}'],
    ['malformed JSON', '{'],
  ])('rejects %s', (_label, raw) => {
    expect(() => parseManifestBytes(encode(raw))).toThrowError(/Manifest/);
  });

  it('rejects dangling references before persistence', async () => {
    const bytes = await readFile(new URL('../../fixtures/demo-payments.json', import.meta.url));
    const raw = JSON.parse(bytes.toString()) as Record<string, any>;
    raw.files[0].componentKey = 'component.missing';
    expect(() => parseManifestBytes(encode(JSON.stringify(raw)))).toThrowError(/File owner/);
  });

  it('rejects duplicate node keys and paths', async () => {
    const bytes = await readFile(new URL('../../fixtures/demo-payments.json', import.meta.url));
    const raw = JSON.parse(bytes.toString()) as Record<string, any>;
    raw.files[1].key = raw.files[0].key;
    expect(() => parseManifestBytes(encode(JSON.stringify(raw)))).toThrowError(
      /Duplicate node key/,
    );
    const pathRaw = JSON.parse(bytes.toString()) as Record<string, any>;
    pathRaw.files[1].path = pathRaw.files[0].path;
    expect(() => parseManifestBytes(encode(JSON.stringify(pathRaw)))).toThrowError(
      /Duplicate file path/,
    );
  });

  it('rejects manifests over one MiB', () => {
    expect(() => parseManifestBytes(new Uint8Array(1_048_577))).toThrowError(/1 MiB/);
  });

  it.each([
    [
      'invalid normalized path',
      (raw: any) => {
        raw.files[0].path = '../escape';
      },
      'file.webhook-handler',
    ],
    [
      'structural self edge',
      (raw: any) => {
        raw.components[0].parentKey = raw.components[0].key;
      },
      'component.backend',
    ],
    [
      'invalid evidence URI',
      (raw: any) => {
        raw.sources[0].uri = 'file:///private/data';
      },
      'source.repository',
    ],
    [
      'blank project name',
      (raw: any) => {
        raw.project.name = '   ';
      },
      'project.name',
    ],
  ])('rejects %s before opening a transaction', async (_label, mutate, expectedPath) => {
    const bytes = await readFile(new URL('../../fixtures/demo-payments.json', import.meta.url));
    const raw = JSON.parse(bytes.toString());
    mutate(raw);
    let transactionCalled = false;
    const fake = {
      transaction: async () => {
        transactionCalled = true;
        throw new Error('transaction must not run');
      },
    } as unknown as GraphStore;
    await expect(importPreparedProject(encode(JSON.stringify(raw)), fake)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { path: expect.stringContaining(expectedPath) },
    });
    expect(transactionCalled).toBe(false);
  });

  it('rejects an unused blank source actor label', async () => {
    const bytes = await readFile(new URL('../../fixtures/demo-payments.json', import.meta.url));
    const raw = JSON.parse(bytes.toString());
    raw.sources.push({
      key: 'source.unused',
      kind: 'agent',
      uri: 'agent://unused/source',
      label: 'Unused',
      excerpt: 'synthetic prepared example: unused evidence',
      actorLabel: '   ',
    });
    expect(() => parseManifestBytes(encode(JSON.stringify(raw)))).toThrowError(
      /Manifest validation/,
    );
  });
});

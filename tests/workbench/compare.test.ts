import { describe, expect, it } from 'vitest';
import { COMPARED_FIELDS, compareRevisions } from '../../src/lib/compare';
import type { NodeRevision } from '../../src/server/context/types';

const v1: NodeRevision = {
  projectId: 'p',
  nodeId: 'n',
  version: 1,
  title: 'In-memory seen-event set',
  content: 'An in-memory seen-event set might be sufficient.',
  summary: 'Maybe enough',
  authority: 'inferred',
  importance: 2,
  confidence: 0.4,
  archived: false,
  sourceId: 'source-1',
  actor: { kind: 'agent', label: 'explorer' },
  changeReason: 'inferred from code',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('compareRevisions', () => {
  it('reports every field unchanged when comparing a revision with itself', () => {
    const rows = compareRevisions(v1, v1);
    expect(rows.map((row) => row.field)).toEqual([...COMPARED_FIELDS]);
    expect(rows.every((row) => !row.changed)).toBe(true);
  });

  it('flags exactly the fields that differ, including nested actor objects', () => {
    const v2: NodeRevision = {
      ...v1,
      version: 2,
      content: 'Use a persistent receipt store; in-memory is insufficient across restarts.',
      authority: 'canonical',
      confidence: 1,
      sourceId: 'source-2',
      actor: { kind: 'human', label: 'local-operator' },
      changeReason: 'Reviewed and corrected',
      createdAt: '2026-01-02T00:00:00.000Z',
    };
    const rows = compareRevisions(v1, v2);
    const changed = rows.filter((row) => row.changed).map((row) => row.field);
    expect(changed).toEqual([
      'content',
      'authority',
      'confidence',
      'sourceId',
      'actor',
      'changeReason',
      'createdAt',
      'version',
    ]);
    const authority = rows.find((row) => row.field === 'authority')!;
    expect(authority).toEqual({
      field: 'authority',
      before: 'inferred',
      after: 'canonical',
      changed: true,
    });
    expect(rows.find((row) => row.field === 'title')!.changed).toBe(false);
  });

  it('treats structurally equal actors as unchanged and archived flips as changed', () => {
    const rows = compareRevisions(v1, {
      ...v1,
      archived: true,
      actor: { kind: 'agent', label: 'explorer' },
    });
    expect(rows.find((row) => row.field === 'actor')!.changed).toBe(false);
    expect(rows.find((row) => row.field === 'archived')!.changed).toBe(true);
  });

  it('is pure: inputs are not mutated', () => {
    const copy = structuredClone(v1);
    compareRevisions(v1, { ...v1, version: 2 });
    expect(v1).toEqual(copy);
  });
});

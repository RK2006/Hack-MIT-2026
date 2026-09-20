import { describe, expect, it } from 'vitest';
import { resolveNodeRef, shortId } from '../../src/cli/refs';
import { GraphError } from '../../src/server/context/errors';
import type { ContextNode } from '../../src/server/context/types';

const node = (id: string, extra: Partial<ContextNode> = {}): ContextNode => ({
  id,
  projectId: 'p',
  type: 'component',
  externalKey: null,
  path: null,
  createdAt: '2026-09-19T00:00:00.000Z',
  current: {
    projectId: 'p',
    nodeId: id,
    version: 1,
    title: `Node ${id.slice(0, 4)}`,
    content: 'c',
    summary: '',
    authority: 'canonical',
    importance: 3,
    confidence: 1,
    archived: false,
    sourceId: 's',
    actor: { kind: 'human', label: 'x' },
    changeReason: 'r',
    createdAt: '2026-09-19T00:00:00.000Z',
  },
  ...extra,
});

const webhooks = node('11111111-2222-4333-8444-555555555555', {
  externalKey: 'component.webhooks',
});
const handler = node('11111111-aaaa-4bbb-8ccc-dddddddddddd', {
  type: 'file',
  path: 'src/payments/webhook.ts',
});
const other = node('99999999-0000-4000-8000-000000000000', { externalKey: 'component.other' });
const nodes = [webhooks, handler, other];

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof GraphError ? error : undefined;
  }
  return undefined;
};

describe('resolveNodeRef', () => {
  it('matches an exact external key or path first', () => {
    expect(resolveNodeRef('component.webhooks', nodes)).toBe(webhooks);
    expect(resolveNodeRef('src/payments/webhook.ts', nodes)).toBe(handler);
  });

  it('matches a UUID prefix of at least eight hex characters, ignoring dashes and case', () => {
    expect(resolveNodeRef('99999999', nodes)).toBe(other);
    expect(resolveNodeRef('11111111-AAAA', nodes)).toBe(handler);
    expect(resolveNodeRef(other.id, nodes)).toBe(other);
  });

  it('reports ambiguity with candidates instead of guessing', () => {
    const error = code(() => resolveNodeRef('11111111', nodes));
    expect(error?.code).toBe('VALIDATION_ERROR');
    expect((error?.details?.candidates as unknown[]).length).toBe(2);
  });

  it('rejects short prefixes and unknown refs as NOT_FOUND', () => {
    expect(code(() => resolveNodeRef('1111111', nodes))?.code).toBe('NOT_FOUND');
    expect(code(() => resolveNodeRef('component.missing', nodes))?.code).toBe('NOT_FOUND');
    expect(code(() => resolveNodeRef('  ', nodes))?.code).toBe('VALIDATION_ERROR');
  });

  it('shortens ids to eight characters', () => {
    expect(shortId(other.id)).toBe('99999999');
  });
});

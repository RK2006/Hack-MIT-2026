import { describe, expect, it } from 'vitest';
import { GraphError } from '../../src/server/context/errors.js';
import { createGraphStore } from '../../src/server/context/store.js';
import type { Pool } from 'pg';
import {
  authorizeCreateNode,
  authorizeEdge,
  authorizeRevision,
  parseCreateNode,
  parseSourceInput,
} from '../../src/server/context/validation.js';
import type { ContextNode } from '../../src/server/context/types.js';

const uuid = '00000000-0000-4000-8000-000000000001';
const human = { kind: 'human' as const, label: ' operator ' };

describe('foundation validation', () => {
  it('redacts malformed identifiers from structured logs', async () => {
    const events: unknown[] = [];
    const fakePool = { end: async () => undefined } as unknown as Pool;
    const store = createGraphStore(fakePool, { logger: { error: (event) => events.push(event) } });
    await expect(store.getProject('secret-content')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(events).toEqual([expect.not.objectContaining({ projectId: expect.anything() })]);
  });

  it('does not leak storage errors or credentials through logs', async () => {
    const events: unknown[] = [];
    const fakePool = {
      query: async () => {
        throw new Error('postgresql://secret:credential@host/private-content');
      },
      end: async () => undefined,
    } as unknown as Pool;
    const store = createGraphStore(fakePool, { logger: { error: (event) => events.push(event) } });
    await expect(store.getProject(uuid)).rejects.toMatchObject({
      code: 'STORAGE_ERROR',
      message: 'Storage operation failed',
    });
    expect(JSON.stringify(events)).not.toMatch(/secret|credential|private-content/);
  });

  it('applies canonical and inferred defaults', () => {
    const canonical = parseCreateNode({
      type: 'component',
      title: ' Payments ',
      content: 'content',
      authority: 'canonical',
      sourceId: uuid,
      actor: human,
      changeReason: ' create ',
    });
    expect(canonical).toMatchObject({
      title: 'Payments',
      summary: '',
      importance: 3,
      confidence: 1,
      path: null,
    });
    expect(
      parseCreateNode({ ...canonical, authority: 'inferred', confidence: undefined }).confidence,
    ).toBe(0.5);
  });

  it.each(['../secret', '/absolute', 'a\\b', 'a//b', 'a/./b', 'C:/drive'])(
    'rejects invalid file path %s',
    (path) =>
      expect(() =>
        parseCreateNode({
          type: 'file',
          path,
          title: 'File',
          content: 'x',
          authority: 'canonical',
          sourceId: uuid,
          actor: { kind: 'importer', label: 'fixture' },
          changeReason: 'import',
        }),
      ).toThrow(GraphError),
  );

  it('rejects rather than normalizes surrounding file-path whitespace', () => {
    expect(() =>
      parseCreateNode({
        type: 'file',
        path: ' src/a.ts ',
        title: 'File',
        content: 'x',
        authority: 'canonical',
        sourceId: uuid,
        actor: { kind: 'importer', label: 'fixture' },
        changeReason: 'import',
      }),
    ).toThrow(GraphError);
  });

  it('enforces source semantics and URI credentials', () => {
    expect(() =>
      parseSourceInput({
        kind: 'repository',
        uri: 'repo://demo/file',
        label: 'file',
        excerpt: '',
        revisionRef: null,
      }),
    ).toThrow(GraphError);
    expect(() =>
      parseSourceInput({
        kind: 'manual',
        uri: 'https://user:pass@example.com',
        label: 'x',
        excerpt: 'note',
        revisionRef: null,
      }),
    ).toThrow(GraphError);
  });

  it('enforces creation authority', () => {
    const input = parseCreateNode({
      type: 'bug',
      title: 'Bug',
      content: 'x',
      authority: 'canonical',
      sourceId: uuid,
      actor: { kind: 'agent', label: 'bot' },
      changeReason: 'suggest',
    });
    expect(() => authorizeCreateNode(input, 'agent')).toThrowError(/permit/);
  });

  it.each([
    { field: 'type', value: 'unknown' },
    { field: 'importance', value: 1.5 },
    { field: 'importance', value: 6 },
    { field: 'confidence', value: Number.NaN },
    { field: 'content', value: '   ' },
    { field: 'title', value: `bad\0title` },
    { field: 'extra', value: true },
  ])('rejects malformed or boundary-invalid node field $field', ({ field, value }) => {
    const input: Record<string, unknown> = {
      type: 'component',
      title: 'Component',
      content: 'content',
      authority: 'canonical',
      sourceId: uuid,
      actor: { kind: 'human', label: 'operator' },
      changeReason: 'create',
    };
    input[field] = value;
    expect(() => parseCreateNode(input)).toThrow(GraphError);
  });

  it('enforces the creation actor/authority/evidence matrix', () => {
    const make = (
      actor: 'human' | 'importer' | 'agent',
      authority: 'canonical' | 'inferred',
      type: 'component' | 'bug' = 'component',
    ) =>
      parseCreateNode({
        type,
        title: 'Node',
        content: 'content',
        authority,
        sourceId: uuid,
        actor: { kind: actor, label: actor },
        changeReason: 'create',
      });
    expect(() => authorizeCreateNode(make('human', 'canonical'), 'manual')).not.toThrow();
    expect(() => authorizeCreateNode(make('human', 'inferred'), 'manual')).not.toThrow();
    expect(() => authorizeCreateNode(make('importer', 'canonical'), 'repository')).not.toThrow();
    expect(() => authorizeCreateNode(make('agent', 'inferred'), 'agent')).not.toThrow();
    expect(() => authorizeCreateNode(make('importer', 'inferred'), 'repository')).toThrow();
    expect(() => authorizeCreateNode(make('importer', 'canonical', 'bug'), 'repository')).toThrow();
    expect(() => authorizeCreateNode(make('agent', 'canonical'), 'agent')).toThrow();
    expect(() => authorizeCreateNode(make('human', 'canonical'), 'agent')).toThrow();
  });

  it('enforces the edge actor/authority/evidence matrix', () => {
    const node = (type: 'component' | 'file'): ContextNode => ({
      id: uuid,
      projectId: uuid,
      type,
      externalKey: null,
      path: type === 'file' ? 'a.ts' : null,
      createdAt: new Date().toISOString(),
      current: {
        projectId: uuid,
        nodeId: uuid,
        version: 1,
        title: 'Node',
        content: 'x',
        summary: '',
        authority: 'canonical',
        importance: 3,
        confidence: 1,
        archived: false,
        sourceId: uuid,
        actor: { kind: 'human', label: 'operator' },
        changeReason: 'create',
        createdAt: new Date().toISOString(),
      },
    });
    const edge = (
      kind: 'human' | 'importer' | 'agent',
      authority: 'canonical' | 'inferred',
      type: 'CONTAINS' | 'REQUIRES' = 'CONTAINS',
    ) => ({
      fromNodeId: uuid,
      toNodeId: '00000000-0000-4000-8000-000000000002',
      type,
      authority,
      sourceId: uuid,
      actor: { kind, label: kind },
    });
    expect(() =>
      authorizeEdge(edge('human', 'canonical'), 'manual', node('component'), node('file')),
    ).not.toThrow();
    expect(() =>
      authorizeEdge(
        edge('agent', 'inferred', 'REQUIRES'),
        'agent',
        node('component'),
        node('file'),
      ),
    ).not.toThrow();
    expect(() =>
      authorizeEdge(edge('importer', 'canonical'), 'repository', node('component'), node('file')),
    ).not.toThrow();
    expect(() =>
      authorizeEdge(
        edge('importer', 'canonical', 'REQUIRES'),
        'repository',
        node('component'),
        node('file'),
      ),
    ).toThrow();
    expect(() =>
      authorizeEdge(edge('agent', 'canonical'), 'agent', node('component'), node('file')),
    ).toThrow();
    expect(() =>
      authorizeEdge(edge('human', 'canonical'), 'repository', node('component'), node('file')),
    ).toThrow();
  });

  it('prevents non-human archive changes', () => {
    const current = {
      id: uuid,
      projectId: uuid,
      type: 'bug',
      externalKey: null,
      path: null,
      createdAt: new Date().toISOString(),
      current: {
        projectId: uuid,
        nodeId: uuid,
        version: 1,
        title: 'Bug',
        content: 'x',
        summary: '',
        authority: 'inferred',
        importance: 3,
        confidence: 0.5,
        archived: false,
        sourceId: uuid,
        actor: { kind: 'agent', label: 'bot' },
        changeReason: 'create',
        createdAt: new Date().toISOString(),
      },
    } satisfies ContextNode;
    expect(() =>
      authorizeRevision(
        current,
        {
          expectedVersion: 1,
          actor: { kind: 'agent', label: 'bot' },
          changeReason: 'hide',
          snapshot: { ...current.current, archived: true },
        },
        'agent',
      ),
    ).toThrowError(/cannot/);
  });
});

import { describe, expect, it } from 'vitest';
import { parseContextRequest } from '../../src/server/context/compiler/request';
import { GraphError } from '../../src/server/context/errors';
import {
  cosine,
  embeddingInput,
  validateVectors,
} from '../../src/server/context/compiler/embedding';
import { lexicalSimilarity } from '../../src/server/context/compiler/lexical';
import { makeNode } from './fixture';

const expectValidation = (raw: unknown) => {
  try {
    parseContextRequest(raw);
    throw new Error('expected failure');
  } catch (error) {
    expect(error).toBeInstanceOf(GraphError);
    expect((error as GraphError).code).toBe('VALIDATION_ERROR');
  }
};

describe('context request validation', () => {
  it('applies defaults', () => {
    expect(parseContextRequest({ task: '  Fix it  ', tokenBudget: 4096 })).toEqual({
      task: 'Fix it',
      tokenBudget: 4096,
      startNodeIds: [],
      maxDepth: 2,
      allowDegraded: false,
    });
  });

  it.each([
    [{ task: '', tokenBudget: 4096 }],
    [{ task: 'x'.repeat(2001), tokenBudget: 4096 }],
    [{ task: 'a\0b', tokenBudget: 4096 }],
    [{ task: 'ok', tokenBudget: 255 }],
    [{ task: 'ok', tokenBudget: 8193 }],
    [{ task: 'ok', tokenBudget: 1000.5 }],
    [{ task: 'ok', tokenBudget: 4096, maxDepth: 4 }],
    [{ task: 'ok', tokenBudget: 4096, startNodeIds: ['nope'] }],
    [
      {
        task: 'ok',
        tokenBudget: 4096,
        startNodeIds: Array(6).fill('11111111-1111-4111-8111-111111111111'),
      },
    ],
    [{ task: 'ok', tokenBudget: 4096, extra: true }],
    ['not an object'],
  ])('rejects %j', (raw) => expectValidation(raw));

  it('rejects duplicate start ids', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expectValidation({ task: 'ok', tokenBudget: 4096, startNodeIds: [id, id] });
  });
});

describe('embedding helpers', () => {
  it('serializes node input deterministically and truncates by code points', () => {
    const node = makeNode('file.a', 'file', {
      path: 'src/a.ts',
      content: '🚀'.repeat(2000),
      summary: 'S',
    });
    const input = embeddingInput(node);
    expect(input.startsWith('file: Title file.a\nS\n')).toBe(true);
    expect(Array.from(input)).toHaveLength(1500);
  });

  it('computes cosine similarity', () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });

  it('rejects malformed vectors', () => {
    expect(() => validateVectors([[1, 2]], 2, 2)).toThrow(GraphError);
    expect(() => validateVectors([[1, Number.NaN]], 1, 2)).toThrow(GraphError);
    expect(() => validateVectors([[1]], 1, 2)).toThrow(GraphError);
    expect(validateVectors([[1, 2]], 1, 2)).toEqual([[1, 2]]);
  });

  it('scores lexical overlap', () => {
    expect(
      lexicalSimilarity('duplicate webhook processing', 'webhook processing is duplicate'),
    ).toBe(1);
    expect(lexicalSimilarity('duplicate webhook', 'catalog index')).toBe(0);
  });
});

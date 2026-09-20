import { describe, expect, it } from 'vitest';
import { assertSameOrigin, errorResponse } from '../../src/server/http';
import { graphError } from '../../src/server/context/errors';

const post = (headers: Record<string, string>) =>
  new Request('http://localhost:3000/api/projects/x/nodes', { method: 'POST', headers });

describe('assertSameOrigin', () => {
  it('accepts browser same-origin and user-initiated requests', () => {
    expect(assertSameOrigin(post({ 'sec-fetch-site': 'same-origin' }))).toBeNull();
    expect(assertSameOrigin(post({ 'sec-fetch-site': 'none' }))).toBeNull();
  });

  it('accepts an Origin matching the Host header even when request.url differs', () => {
    expect(
      assertSameOrigin(post({ origin: 'http://127.0.0.1:3000', host: '127.0.0.1:3000' })),
    ).toBeNull();
  });

  it('accepts local tooling that sends neither header', () => {
    expect(assertSameOrigin(post({}))).toBeNull();
  });

  it('rejects cross-site and mismatched origins', async () => {
    for (const headers of [
      { 'sec-fetch-site': 'cross-site' },
      { 'sec-fetch-site': 'same-site' },
      { origin: 'http://evil.example', host: '127.0.0.1:3000' },
      { origin: 'not a url', host: '127.0.0.1:3000' },
    ]) {
      const response = assertSameOrigin(post(headers));
      expect(response?.status).toBe(403);
      expect(await response!.json()).toMatchObject({ error: { code: 'FORBIDDEN_ORIGIN' } });
    }
  });
});

describe('errorResponse', () => {
  it.each([
    ['VALIDATION_ERROR', 400],
    ['NOT_FOUND', 404],
    ['CONFLICT', 409],
    ['AUTHORITY_VIOLATION', 403],
    ['LIMIT_EXCEEDED', 422],
    ['EMBEDDING_UNAVAILABLE', 503],
    ['STORAGE_ERROR', 500],
  ] as const)('maps %s to %i', async (code, status) => {
    const response = errorResponse(graphError(code, 'msg', { field: 'x' }));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      error: { code, message: 'msg', details: { field: 'x' } },
    });
  });

  it('hides unexpected error details from clients', async () => {
    const response = errorResponse(new Error('secret connection string'));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
  });
});

describe('operatorActor', () => {
  it('defaults to local-operator and honors OPERATOR_LABEL', async () => {
    const { operatorActor } = await import('../../src/server/workbench/mutations');
    expect(operatorActor({})).toEqual({ kind: 'human', label: 'local-operator' });
    expect(operatorActor({ OPERATOR_LABEL: '  anmol ' })).toEqual({
      kind: 'human',
      label: 'anmol',
    });
    expect(operatorActor({ OPERATOR_LABEL: 'x'.repeat(121) }).label).toBe('local-operator');
  });
});

import { describe, expect, it } from 'vitest';
import { anthropicProposalModel, proposalModelFromEnv } from '../../src/server/proposals/model';

const prompt = { system: 'sys', user: 'usr' };
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('anthropicProposalModel', () => {
  it('sends the Messages API request shape and joins text blocks', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const model = anthropicProposalModel({
      apiKey: 'test-key',
      model: 'claude-test',
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init! });
        return jsonResponse(200, {
          content: [
            { type: 'text', text: '{"nodes":' },
            { type: 'tool_use', id: 'x' },
            { type: 'text', text: '[],"edges":[]}' },
          ],
        });
      },
    });
    expect(model.id).toBe('anthropic:claude-test');
    expect(await model.complete(prompt)).toBe('{"nodes":[],"edges":[]}');
    const [call] = calls;
    expect(call!.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = call!.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(JSON.parse(String(call!.init.body))).toMatchObject({
      model: 'claude-test',
      temperature: 0,
      system: 'sys',
      messages: [{ role: 'user', content: 'usr' }],
    });
  });

  it('retries once on 5xx/429 and then fails as MODEL_UNAVAILABLE without leaking the key', async () => {
    let attempts = 0;
    const model = anthropicProposalModel({
      apiKey: 'sk-secret',
      fetchImpl: async () => {
        attempts += 1;
        return jsonResponse(529, { error: 'overloaded' });
      },
    });
    await expect(model.complete(prompt)).rejects.toMatchObject({
      code: 'MODEL_UNAVAILABLE',
      details: { category: 'http_529' },
    });
    expect(attempts).toBe(2);
  }, 10_000);

  it('does not retry client errors and treats empty content as unavailable', async () => {
    let attempts = 0;
    const unauthorized = anthropicProposalModel({
      apiKey: 'bad',
      fetchImpl: async () => {
        attempts += 1;
        return jsonResponse(401, { error: { type: 'authentication_error' } });
      },
    });
    await expect(unauthorized.complete(prompt)).rejects.toMatchObject({
      code: 'MODEL_UNAVAILABLE',
      details: { category: 'http_401' },
    });
    expect(attempts).toBe(1);
    const empty = anthropicProposalModel({
      apiKey: 'k',
      fetchImpl: async () => jsonResponse(200, { content: [] }),
    });
    await expect(empty.complete(prompt)).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
  });

  it('is disabled without ANTHROPIC_API_KEY and honors ANTHROPIC_MODEL', () => {
    expect(proposalModelFromEnv({})).toBeUndefined();
    expect(proposalModelFromEnv({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-x' })?.id).toBe(
      'anthropic:claude-x',
    );
  });
});

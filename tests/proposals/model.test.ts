import { describe, expect, it } from 'vitest';
import {
  anthropicProposalModel,
  geminiProposalModel,
  openAiProposalModel,
  proposalModelFromEnv,
  MAX_ATTEMPTS,
} from '../../src/server/proposals/model';

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
    expect(await model.complete(prompt)).toEqual({
      text: '{"nodes":[],"edges":[]}',
      model: 'anthropic:claude-test',
    });
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

  it('retries with backoff on 5xx/429, then fails as MODEL_UNAVAILABLE without leaking the key', async () => {
    let attempts = 0;
    const sleeps: number[] = [];
    const model = anthropicProposalModel({
      apiKey: 'sk-secret',
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetchImpl: async () => {
        attempts += 1;
        return jsonResponse(529, { error: { message: 'overloaded' } });
      },
    });
    const error = await model.complete(prompt).catch((e) => e);
    expect(error).toMatchObject({
      code: 'MODEL_UNAVAILABLE',
      details: { category: 'http_529', detail: 'overloaded', model: 'claude-sonnet-4-5' },
    });
    expect(JSON.stringify(error.details)).not.toContain('sk-secret');
    expect(attempts).toBe(MAX_ATTEMPTS);
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it('falls back to the next model in a comma-separated list and records which one answered', async () => {
    const calls: string[] = [];
    const model = geminiProposalModel({
      apiKey: 'k',
      model: 'gemini-busy, gemini-spare',
      sleep: async () => {},
      fetchImpl: async (url) => {
        calls.push(String(url));
        return String(url).includes('gemini-busy')
          ? jsonResponse(503, { error: { message: 'high demand' } })
          : jsonResponse(200, { candidates: [{ content: { parts: [{ text: '{}' }] } }] });
      },
    });
    expect(model.id).toBe('gemini:gemini-busy');
    expect(await model.complete(prompt)).toEqual({ text: '{}', model: 'gemini:gemini-spare' });
    expect(calls.filter((u) => u.includes('gemini-busy'))).toHaveLength(MAX_ATTEMPTS);
    expect(calls.filter((u) => u.includes('gemini-spare'))).toHaveLength(1);
  });

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

  it('speaks the OpenAI chat and Gemini generateContent shapes', async () => {
    const seen: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
    const capture: typeof fetch = async (url, init) => {
      seen.push({
        url: String(url),
        body: JSON.parse(String(init?.body)),
        headers: init?.headers as Record<string, string>,
      });
      return seen.length === 1
        ? jsonResponse(200, { choices: [{ message: { content: '{"nodes":[],"edges":[]}' } }] })
        : jsonResponse(200, {
            candidates: [
              { content: { parts: [{ text: '{"nodes":' }, { text: '[],"edges":[]}' }] } },
            ],
          });
    };
    const openai = openAiProposalModel({ apiKey: 'oa', fetchImpl: capture });
    expect(openai.id).toBe('openai:gpt-4.1-mini');
    expect((await openai.complete(prompt)).text).toBe('{"nodes":[],"edges":[]}');
    expect(seen[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(seen[0]!.headers.authorization).toBe('Bearer oa');
    expect(seen[0]!.body).toMatchObject({
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'usr' },
      ],
    });
    const gemini = geminiProposalModel({ apiKey: 'gm', model: 'gemini-test', fetchImpl: capture });
    expect(gemini.id).toBe('gemini:gemini-test');
    expect(await gemini.complete(prompt)).toEqual({
      text: '{"nodes":[],"edges":[]}',
      model: 'gemini:gemini-test',
    });
    expect(seen[1]!.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent',
    );
    expect(seen[1]!.headers['x-goog-api-key']).toBe('gm');
    expect(seen[1]!.body).toMatchObject({
      systemInstruction: { parts: [{ text: 'sys' }] },
      generationConfig: { responseMimeType: 'application/json' },
    });
  });

  it('selects the backend from the environment', () => {
    expect(proposalModelFromEnv({})).toBeUndefined();
    expect(proposalModelFromEnv({ ANTHROPIC_API_KEY: 'k' })?.id).toBe(
      'anthropic:claude-sonnet-4-5',
    );
    expect(proposalModelFromEnv({ OPENAI_API_KEY: 'k' })?.id).toBe('openai:gpt-4.1-mini');
    expect(proposalModelFromEnv({ GEMINI_API_KEY: 'k' })?.id).toBe('gemini:gemini-flash-latest');
    expect(proposalModelFromEnv({ GEMINI_API_KEY: 'k', PROPOSAL_MODEL: 'gemini-x' })?.id).toBe(
      'gemini:gemini-x',
    );
    expect(
      proposalModelFromEnv({
        PROPOSAL_PROVIDER: 'openai',
        OPENAI_API_KEY: 'k',
        ANTHROPIC_API_KEY: 'k',
      })?.id,
    ).toBe('openai:gpt-4.1-mini');
    expect(() => proposalModelFromEnv({ PROPOSAL_PROVIDER: 'openai' })).toThrow(/OPENAI_API_KEY/);
    expect(() => proposalModelFromEnv({ PROPOSAL_PROVIDER: 'nope' })).toThrow(/PROPOSAL_PROVIDER/);
  });
});

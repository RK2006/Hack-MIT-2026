import { graphError } from '../context/errors';

export type ProposalPrompt = { system: string; user: string };

export type ProposalModel = {
  /** Stable id recorded as the agent actor label, e.g. `anthropic:claude-sonnet-4-5`. */
  id: string;
  complete(prompt: ProposalPrompt): Promise<string>;
};

export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-4-5';
const TIMEOUT_MS = 60_000;

/** Anthropic Messages API through fetch; only operator-supplied text and node titles/keys are sent. */
export function anthropicProposalModel(options: {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): ProposalModel {
  const model = options.model ?? ANTHROPIC_DEFAULT_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${options.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`;
  const request = async (prompt: ProposalPrompt) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetchImpl(url, {
        method: 'POST',
        headers: {
          'x-api-key': options.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 4000,
          temperature: 0,
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    id: `anthropic:${model}`,
    async complete(prompt) {
      let response: Response | undefined;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          response = await request(prompt);
          if (response.ok || (response.status !== 429 && response.status < 500)) break;
        } catch {
          response = undefined;
        }
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (!response || !response.ok) {
        throw graphError('MODEL_UNAVAILABLE', 'Proposal model request failed', {
          category: response ? `http_${response.status}` : 'network',
        });
      }
      const body = (await response.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const text = (body.content ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('');
      if (!text) throw graphError('MODEL_UNAVAILABLE', 'Proposal model returned no text');
      return text;
    },
  };
}

/** Test-only model returning a fixed (or computed) response. */
export function fixedProposalModel(
  respond: string | ((prompt: ProposalPrompt) => string | Promise<string>),
  id = 'fixed:test',
): ProposalModel {
  return {
    id,
    complete: async (prompt) => (typeof respond === 'string' ? respond : respond(prompt)),
  };
}

export function proposalModelFromEnv(
  env: Record<string, string | undefined> = process.env,
): ProposalModel | undefined {
  if (!env.ANTHROPIC_API_KEY) return undefined;
  return anthropicProposalModel({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(env.ANTHROPIC_MODEL && { model: env.ANTHROPIC_MODEL }),
  });
}

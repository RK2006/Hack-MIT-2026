import { graphError } from '../context/errors';

export type ProposalPrompt = { system: string; user: string };

export type ProposalModel = {
  /** Stable id recorded as the agent actor label, e.g. `anthropic:claude-sonnet-4-5`. */
  id: string;
  complete(prompt: ProposalPrompt): Promise<string>;
};

export const PROPOSAL_PROVIDERS = ['anthropic', 'openai', 'gemini'] as const;
export type ProposalProvider = (typeof PROPOSAL_PROVIDERS)[number];

export const DEFAULT_MODELS: Record<ProposalProvider, string> = {
  anthropic: 'claude-sonnet-4-5',
  openai: 'gpt-4.1-mini',
  gemini: 'gemini-flash-latest',
};
/** @deprecated kept for callers that imported the old constant */
export const ANTHROPIC_DEFAULT_MODEL = DEFAULT_MODELS.anthropic;

const TIMEOUT_MS = 60_000;
const MAX_OUTPUT_TOKENS = 4000;

type VendorOptions = { apiKey: string; model?: string; baseUrl?: string; fetchImpl?: typeof fetch };

type Vendor = {
  url: (baseUrl: string | undefined, model: string) => string;
  headers: (apiKey: string) => Record<string, string>;
  body: (model: string, prompt: ProposalPrompt) => unknown;
  extractText: (body: unknown) => string;
};

/** Shared transport: 60 s timeout, one retry on 429/5xx/network, MODEL_UNAVAILABLE on failure. */
function vendorModel(
  provider: ProposalProvider,
  vendor: Vendor,
  options: VendorOptions,
): ProposalModel {
  const model = options.model ?? DEFAULT_MODELS[provider];
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = vendor.url(options.baseUrl, model);
  const request = async (prompt: ProposalPrompt) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...vendor.headers(options.apiKey) },
        body: JSON.stringify(vendor.body(model, prompt)),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    id: `${provider}:${model}`,
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
        // Vendor error bodies name the model/quota problem; they never echo the API key.
        const detail = response ? await vendorErrorMessage(response) : undefined;
        throw graphError('MODEL_UNAVAILABLE', 'Proposal model request failed', {
          provider,
          model,
          category: response ? `http_${response.status}` : 'network',
          ...(detail && { detail }),
        });
      }
      const text = vendor.extractText(await response.json());
      if (!text)
        throw graphError('MODEL_UNAVAILABLE', 'Proposal model returned no text', { provider });
      return text;
    },
  };
}

async function vendorErrorMessage(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: { message?: string } | string };
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    return message ? Array.from(message).slice(0, 300).join('') : undefined;
  } catch {
    return undefined;
  }
}

/** Anthropic Messages API; only operator-supplied text and node titles/keys are sent. */
export function anthropicProposalModel(options: VendorOptions): ProposalModel {
  return vendorModel(
    'anthropic',
    {
      url: (baseUrl) => `${baseUrl ?? 'https://api.anthropic.com'}/v1/messages`,
      headers: (apiKey) => ({ 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }),
      body: (model, prompt) => ({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
      }),
      extractText: (body) =>
        ((body as { content?: Array<{ type: string; text?: string }> }).content ?? [])
          .filter((block) => block.type === 'text')
          .map((block) => block.text ?? '')
          .join(''),
    },
    options,
  );
}

/** OpenAI Chat Completions API (JSON mode). */
export function openAiProposalModel(options: VendorOptions): ProposalModel {
  return vendorModel(
    'openai',
    {
      url: (baseUrl) => `${baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`,
      headers: (apiKey) => ({ authorization: `Bearer ${apiKey}` }),
      body: (model, prompt) => ({
        model,
        temperature: 0,
        max_tokens: MAX_OUTPUT_TOKENS,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      }),
      extractText: (body) =>
        (body as { choices?: Array<{ message?: { content?: string | null } }> }).choices?.[0]
          ?.message?.content ?? '',
    },
    options,
  );
}

/** Google Gemini generateContent API (JSON response mime type). */
export function geminiProposalModel(options: VendorOptions): ProposalModel {
  return vendorModel(
    'gemini',
    {
      url: (baseUrl, model) =>
        `${baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta'}/models/${model}:generateContent`,
      headers: (apiKey) => ({ 'x-goog-api-key': apiKey }),
      body: (_model, prompt) => ({
        systemInstruction: { parts: [{ text: prompt.system }] },
        contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          responseMimeType: 'application/json',
        },
      }),
      extractText: (body) =>
        (
          (body as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
            .candidates?.[0]?.content?.parts ?? []
        )
          .map((part) => part.text ?? '')
          .join(''),
    },
    options,
  );
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

const KEY_VARS: Record<ProposalProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
};
const FACTORIES: Record<ProposalProvider, (options: VendorOptions) => ProposalModel> = {
  anthropic: anthropicProposalModel,
  openai: openAiProposalModel,
  gemini: geminiProposalModel,
};

/**
 * Exactly one proposal backend, chosen by PROPOSAL_PROVIDER (anthropic | openai | gemini).
 * Without PROPOSAL_PROVIDER, the first provider whose key is present is used, in that order.
 * Returns undefined (proposals disabled) when no key is configured.
 */
export function proposalModelFromEnv(
  env: Record<string, string | undefined> = process.env,
): ProposalModel | undefined {
  const explicit = env.PROPOSAL_PROVIDER;
  if (explicit !== undefined && !(PROPOSAL_PROVIDERS as readonly string[]).includes(explicit)) {
    throw graphError('MODEL_UNAVAILABLE', 'Unknown PROPOSAL_PROVIDER', { provider: explicit });
  }
  const provider =
    (explicit as ProposalProvider | undefined) ??
    PROPOSAL_PROVIDERS.find((candidate) => env[KEY_VARS[candidate]]);
  if (!provider) return undefined;
  const apiKey = env[KEY_VARS[provider]];
  if (!apiKey) {
    throw graphError(
      'MODEL_UNAVAILABLE',
      `${KEY_VARS[provider]} is required for PROPOSAL_PROVIDER=${provider}`,
      {
        provider,
      },
    );
  }
  const model = env.PROPOSAL_MODEL;
  return FACTORIES[provider]({ apiKey, ...(model && { model }) });
}

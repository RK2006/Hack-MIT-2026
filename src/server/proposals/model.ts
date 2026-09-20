import { graphError } from '../context/errors';

export type ProposalPrompt = { system: string; user: string };

export type ProposalCompletion = {
  text: string;
  /** Model that actually answered, e.g. `gemini:gemini-3.5-flash` (recorded as provenance). */
  model: string;
};

export type ProposalModel = {
  /** Configured id, e.g. `gemini:gemini-3.8-flash` (first of any fallback list). */
  id: string;
  complete(prompt: ProposalPrompt): Promise<ProposalCompletion>;
};

export const PROPOSAL_PROVIDERS = ['anthropic', 'openai', 'gemini'] as const;
export type ProposalProvider = (typeof PROPOSAL_PROVIDERS)[number];

export const DEFAULT_MODELS: Record<ProposalProvider, string> = {
  anthropic: 'claude-sonnet-4-5',
  openai: 'gpt-4.1-mini',
  gemini: 'gemini-flash-latest,gemini-flash-lite-latest',
};
/** @deprecated kept for callers that imported the old constant */
export const ANTHROPIC_DEFAULT_MODEL = DEFAULT_MODELS.anthropic;

const TIMEOUT_MS = 60_000;
/**
 * A cap, not spend. Gemini 3.x counts thinking tokens against maxOutputTokens and spends 3–4k
 * of them on a 5k-token prompt, so 4,000 truncated the JSON for large inputs.
 */
export const MAX_OUTPUT_TOKENS = 16_000;
/** Attempts per model on 429/5xx/network, with exponential backoff (1 s, 2 s, 4 s). */
export const MAX_ATTEMPTS = 4;
const BACKOFF_MS = 1000;

type VendorOptions = {
  apiKey: string;
  /** One model, or several separated by commas: later ones are fallbacks when the earlier are unavailable. */
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Test seam for the backoff sleep. */
  sleep?: (ms: number) => Promise<void>;
};

type Vendor = {
  url: (baseUrl: string | undefined, model: string) => string;
  headers: (apiKey: string) => Record<string, string>;
  body: (model: string, prompt: ProposalPrompt) => unknown;
  extractText: (body: unknown) => string;
  /** True when the vendor reports the answer was cut off at the output token limit. */
  truncated: (body: unknown) => boolean;
};

const isRetryable = (status: number) => status === 429 || status >= 500;

/**
 * Shared transport: 60 s timeout per call; up to MAX_ATTEMPTS per model with exponential backoff on
 * 429/5xx/network; then the next fallback model. MODEL_UNAVAILABLE when all are exhausted.
 */
function vendorModel(
  provider: ProposalProvider,
  vendor: Vendor,
  options: VendorOptions,
): ProposalModel {
  const models = (options.model ?? DEFAULT_MODELS[provider])
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const request = async (model: string, prompt: ProposalPrompt) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetchImpl(vendor.url(options.baseUrl, model), {
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
    id: `${provider}:${models[0]}`,
    async complete(prompt) {
      const failures: Array<{ model: string; category: string; detail?: string }> = [];
      for (const model of models) {
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
          if (attempt > 0) await sleep(BACKOFF_MS * 2 ** (attempt - 1));
          let response: Response | undefined;
          try {
            response = await request(model, prompt);
          } catch {
            response = undefined;
          }
          if (response?.ok) {
            const body = await response.json();
            // Truncated JSON would otherwise surface as "did not return JSON"; a fallback model
            // would hit the same ceiling, so fail here with an actionable message instead.
            if (vendor.truncated(body))
              throw graphError(
                'VALIDATION_ERROR',
                'Proposal model output was truncated at the output token limit; shorten or split the input text',
                { provider, model, path: '$' },
              );
            const text = vendor.extractText(body);
            if (!text)
              throw graphError('MODEL_UNAVAILABLE', 'Proposal model returned no text', {
                provider,
                model,
              });
            return { text, model: `${provider}:${model}` };
          }
          if (response && !isRetryable(response.status)) {
            // Vendor error bodies name the model/quota problem; they never echo the API key.
            const detail = await vendorErrorMessage(response);
            failures.push({
              model,
              category: `http_${response.status}`,
              ...(detail && { detail }),
            });
            break;
          }
          if (attempt === MAX_ATTEMPTS - 1) {
            const detail = response ? await vendorErrorMessage(response) : undefined;
            failures.push({
              model,
              category: response ? `http_${response.status}` : 'network',
              ...(detail && { detail }),
            });
          }
        }
      }
      const last = failures[failures.length - 1];
      throw graphError('MODEL_UNAVAILABLE', 'Proposal model request failed', {
        provider,
        model: last?.model,
        category: last?.category ?? 'network',
        ...(last?.detail && { detail: last.detail }),
        attempts: failures,
      });
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
      truncated: (body) => (body as { stop_reason?: string }).stop_reason === 'max_tokens',
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
      truncated: (body) =>
        (body as { choices?: Array<{ finish_reason?: string }> }).choices?.[0]?.finish_reason ===
        'length',
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
      truncated: (body) =>
        (body as { candidates?: Array<{ finishReason?: string }> }).candidates?.[0]
          ?.finishReason === 'MAX_TOKENS',
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
    complete: async (prompt) => ({
      text: typeof respond === 'string' ? respond : await respond(prompt),
      model: id,
    }),
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

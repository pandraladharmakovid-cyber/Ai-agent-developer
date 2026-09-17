'use strict';

/**
 * AI Developer Agent — Level 2
 * Provider Abstraction Layer
 *
 * Provider order:
 *   Gemini → Groq → OpenRouter
 *
 * Secrets are read only from environment variables.
 */

const REQUEST_TIMEOUT_MS = 45_000;
const MAX_OUTPUT_TOKENS = 8_192;

export type ProviderName =
  | 'gemini'
  | 'groq'
  | 'openrouter';

export interface GenerateOptions {
  system?: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface GenerateResult {
  provider: ProviderName;
  model: string;
  text: string;
  durationMs: number;
}

interface ProviderConfig {
  name: ProviderName;
  apiKey: string;
  model: string;
}

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || '';

const GROQ_API_KEY =
  process.env.GROQ_API_KEY || '';

const OPENROUTER_API_KEY =
  process.env.OPENROUTER_API_KEY || '';

const GEMINI_MODEL =
  process.env.GEMINI_MODEL ||
  'gemini-3.6-flash';

const GROQ_MODEL =
  process.env.GROQ_MODEL ||
  'qwen/qwen3.8-27b';

const OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL ||
  'openrouter/free';

/* -------------------------------------------------------------------------- */
/* Utilities                                                                   */
/* -------------------------------------------------------------------------- */

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.min(
    Math.max(value, min),
    max,
  );
}

function cleanText(
  value: unknown,
): string {
  return typeof value === 'string'
    ? value.trim()
    : '';
}

function createTimeout(): {
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
} {
  const controller =
    new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );

  return {
    controller,
    timer,
  };
}

function providerError(
  provider: ProviderName,
  responseStatus: number,
  body: string,
): Error {
  let message =
    `${provider} request failed (${responseStatus}).`;

  try {
    const parsed =
      JSON.parse(body);

    if (
      parsed?.error?.message
    ) {
      message =
        `${provider}: ${parsed.error.message}`;
    } else if (
      parsed?.error?.code
    ) {
      message =
        `${provider}: ${parsed.error.code}`;
    } else if (
      parsed?.message
    ) {
      message =
        `${provider}: ${parsed.message}`;
    }
  } catch {
    if (body.trim()) {
      message =
        `${provider}: ${body.slice(0, 500)}`;
    }
  }

  return new Error(message);
}

function ensurePrompt(
  options: GenerateOptions,
): void {
  if (
    typeof options.prompt !== 'string' ||
    !options.prompt.trim()
  ) {
    throw new Error(
      'AI prompt cannot be empty.',
    );
  }

  if (
    options.prompt.length >
    100_000
  ) {
    throw new Error(
      'AI prompt is too large.',
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Gemini                                                                      */
/* -------------------------------------------------------------------------- */

async function generateGemini(
  config: ProviderConfig,
  options: GenerateOptions,
): Promise<GenerateResult> {
  const startedAt = Date.now();

  const {
    controller,
    timer,
  } = createTimeout();

  try {
    const contents = [
      ...(options.system
        ? [
            {
              role: 'user',
              parts: [
                {
                  text:
                    `SYSTEM INSTRUCTIONS:\n${options.system}`,
                },
              ],
            },
          ]
        : []),

      {
        role: 'user',
        parts: [
          {
            text: options.prompt,
          },
        ],
      },
    ];

    const response =
      await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',
          },

          body: JSON.stringify({
            contents,

            generationConfig: {
              temperature:
                clamp(
                  options.temperature ??
                    0.2,
                  0,
                  1,
                ),

              maxOutputTokens:
                clamp(
                  options.maxTokens ??
                    MAX_OUTPUT_TOKENS,
                  256,
                  MAX_OUTPUT_TOKENS,
                ),

              ...(options.jsonMode
                ? { responseMimeType: 'application/json' }
                : {}),
            },
          }),

          signal:
            controller.signal,
        },
      );

    const text =
      await response.text();

    if (!response.ok) {
      throw providerError(
        'gemini',
        response.status,
        text,
      );
    }

    const data =
      JSON.parse(text);

    const output =
      data?.candidates?.[0]
        ?.content?.parts
        ?.map(
          (part: {
            text?: string;
          }) =>
            part.text || '',
        )
        .join('')
        .trim();

    if (!output) {
      throw new Error(
        'Gemini returned an empty response.',
      );
    }

    return {
      provider: 'gemini',
      model: config.model,
      text: output,
      durationMs:
        Date.now() - startedAt,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'AbortError'
    ) {
      throw new Error(
        'Gemini request timed out.',
      );
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* Groq                                                                        */
/* -------------------------------------------------------------------------- */

async function generateGroq(
  config: ProviderConfig,
  options: GenerateOptions,
): Promise<GenerateResult> {
  const startedAt = Date.now();

  const {
    controller,
    timer,
  } = createTimeout();

  try {
    const messages: Array<{
      role:
        | 'system'
        | 'user';
      content: string;
    }> = [];

    if (options.system) {
      messages.push({
        role: 'system',
        content: options.system,
      });
    }

    messages.push({
      role: 'user',
      content: options.prompt,
    });

    const response =
      await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',

          headers: {
            Authorization:
              `Bearer ${config.apiKey}`,

            'Content-Type':
              'application/json',
          },

          body: JSON.stringify({
            model: config.model,

            messages,

            temperature:
              clamp(
                options.temperature ??
                  0.2,
                0,
                1,
              ),

            max_tokens:
              clamp(
                options.maxTokens ??
                  MAX_OUTPUT_TOKENS,
                256,
                MAX_OUTPUT_TOKENS,
              ),

            ...(options.jsonMode
              ? { response_format: { type: 'json_object' } }
              : {}),

            stream: false,
          }),

          signal:
            controller.signal,
        },
      );

    const text =
      await response.text();

    if (!response.ok) {
      throw providerError(
        'groq',
        response.status,
        text,
      );
    }

    const data =
      JSON.parse(text);

    const output =
      cleanText(
        data?.choices?.[0]
          ?.message?.content,
      );

    if (!output) {
      throw new Error(
        'Groq returned an empty response.',
      );
    }

    return {
      provider: 'groq',
      model: config.model,
      text: output,
      durationMs:
        Date.now() - startedAt,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'AbortError'
    ) {
      throw new Error(
        'Groq request timed out.',
      );
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* OpenRouter                                                                  */
/* -------------------------------------------------------------------------- */

async function generateOpenRouter(
  config: ProviderConfig,
  options: GenerateOptions,
): Promise<GenerateResult> {
  const startedAt = Date.now();

  const {
    controller,
    timer,
  } = createTimeout();

  try {
    const messages: Array<{
      role:
        | 'system'
        | 'user';
      content: string;
    }> = [];

    if (options.system) {
      messages.push({
        role: 'system',
        content: options.system,
      });
    }

    messages.push({
      role: 'user',
      content: options.prompt,
    });

    const response =
      await fetch(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          method: 'POST',

          headers: {
            Authorization:
              `Bearer ${config.apiKey}`,

            'Content-Type':
              'application/json',

            'HTTP-Referer':
              process.env.APP_URL ||
              'http://localhost:3000',

            'X-Title':
              'AI Developer Agent',
          },

          body: JSON.stringify({
            model: config.model,

            messages,

            temperature:
              clamp(
                options.temperature ??
                  0.2,
                0,
                1,
              ),

            max_tokens:
              clamp(
                options.maxTokens ??
                  MAX_OUTPUT_TOKENS,
                256,
                MAX_OUTPUT_TOKENS,
              ),
            ...(options.jsonMode
              ? { response_format: { type: 'json_object' } }
              : {}),
          }),

          signal:
            controller.signal,
        },
      );

    const text =
      await response.text();

    if (!response.ok) {
      throw providerError(
        'openrouter',
        response.status,
        text,
      );
    }

    const data =
      JSON.parse(text);

    const output =
      cleanText(
        data?.choices?.[0]
          ?.message?.content,
      );

    if (!output) {
      throw new Error(
        'OpenRouter returned an empty response.',
      );
    }

    return {
      provider: 'openrouter',
      model: config.model,
      text: output,
      durationMs:
        Date.now() - startedAt,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'AbortError'
    ) {
      throw new Error(
        'OpenRouter request timed out.',
      );
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* Provider discovery                                                          */
/* -------------------------------------------------------------------------- */

export function getAvailableProviders(): ProviderName[] {
  const providers: ProviderName[] = [];

  if (GEMINI_API_KEY) {
    providers.push('gemini');
  }

  if (GROQ_API_KEY) {
    providers.push('groq');
  }

  if (OPENROUTER_API_KEY) {
    providers.push('openrouter');
  }

  return providers;
}

function getProviderConfigs(): ProviderConfig[] {
  const configs: ProviderConfig[] = [];

  /*
   * Gemini is the primary provider.
   */
  if (GEMINI_API_KEY) {
    configs.push({
      name: 'gemini',
      apiKey: GEMINI_API_KEY,
      model: GEMINI_MODEL,
    });
  }

  /*
   * Groq is the fast secondary provider.
   */
  if (GROQ_API_KEY) {
    configs.push({
      name: 'groq',
      apiKey: GROQ_API_KEY,
      model: GROQ_MODEL,
    });
  }

  /*
   * OpenRouter is the final fallback.
   */
  if (OPENROUTER_API_KEY) {
    configs.push({
      name: 'openrouter',
      apiKey: OPENROUTER_API_KEY,
      model: OPENROUTER_MODEL,
    });
  }

  return configs;
}

/* -------------------------------------------------------------------------- */
/* Single provider                                                             */
/* -------------------------------------------------------------------------- */

async function generateWithProvider(
  config: ProviderConfig,
  options: GenerateOptions,
): Promise<GenerateResult> {
  switch (config.name) {
    case 'gemini':
      return generateGemini(
        config,
        options,
      );

    case 'groq':
      return generateGroq(
        config,
        options,
      );

    case 'openrouter':
      return generateOpenRouter(
        config,
        options,
      );

    default:
      throw new Error(
        `Unsupported provider: ${config.name}`,
      );
  }
}

/* -------------------------------------------------------------------------- */
/* Main generation API                                                         */
/* -------------------------------------------------------------------------- */

export async function generateWithFallback(
  options: GenerateOptions,
): Promise<GenerateResult> {
  ensurePrompt(options);

  const providers =
    getProviderConfigs();

  if (!providers.length) {
    throw new Error(
      'No AI provider is configured. Set GEMINI_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY in .env.',
    );
  }

  const errors: string[] = [];

  for (const provider of providers) {
    try {
      return await generateWithProvider(
        provider,
        options,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown provider error.';

      /*
       * Never include API keys in errors.
       */
      errors.push(
        `${provider.name}: ${message}`,
      );

      console.error(
        `[PROVIDER] ${provider.name} failed: ${message}`,
      );
    }
  }

  throw new Error(
    `All configured AI providers failed. ${errors.join(' | ')}`,
  );
}

/* -------------------------------------------------------------------------- */
/* Explicit provider API                                                       */
/* -------------------------------------------------------------------------- */

export async function generateWith(
  providerName: ProviderName,
  options: GenerateOptions,
): Promise<GenerateResult> {
  ensurePrompt(options);

  const config =
    getProviderConfigs().find(
      (provider) =>
        provider.name === providerName,
    );

  if (!config) {
    throw new Error(
      `Provider "${providerName}" is not configured.`,
    );
  }

  return generateWithProvider(
    config,
    options,
  );
}

/* -------------------------------------------------------------------------- */
/* Provider health                                                             */
/* -------------------------------------------------------------------------- */

export async function providerHealthCheck(): Promise<
  Record<
    ProviderName,
    {
      configured: boolean;
      available: boolean;
      model?: string;
    }
  >
> {
  const configured =
    getProviderConfigs();

  const find =
    (name: ProviderName) =>
      configured.find(
        (provider) =>
          provider.name === name,
      );

  const gemini =
    find('gemini');

  const groq =
    find('groq');

  const openrouter =
    find('openrouter');

  return {
    gemini: {
      configured:
        Boolean(gemini),
      available:
        Boolean(gemini),
      model:
        gemini?.model,
    },

    groq: {
      configured:
        Boolean(groq),
      available:
        Boolean(groq),
      model:
        groq?.model,
    },

    openrouter: {
      configured:
        Boolean(openrouter),
      available:
        Boolean(openrouter),
      model:
        openrouter?.model,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Safe configuration summary                                                 */
/* -------------------------------------------------------------------------- */

export function getProviderConfig(): {
  primary: ProviderName | null;
  fallbackOrder: ProviderName[];
  models: Record<
    ProviderName,
    string
  >;
} {
  const providers =
    getProviderConfigs();

  return {
    primary:
      providers[0]?.name || null,

    fallbackOrder:
      providers.map(
        (provider) =>
          provider.name,
      ),

    models: {
      gemini: GEMINI_MODEL,
      groq: GROQ_MODEL,
      openrouter:
        OPENROUTER_MODEL,
    },
  };
}
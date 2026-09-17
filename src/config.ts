'use strict';

/**
 * AI Developer Agent — Level 2
 * Central Configuration
 *
 * All secrets come from environment variables.
 * Never hardcode API keys, passwords, or tokens here.
 *
 * Authentication is intentionally NOT included.
 */

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function env(
  name: string,
  fallback = '',
): string {
  return (
    process.env[name] ??
    fallback
  ).trim();
}

function numberEnv(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value =
    Number.parseInt(
      process.env[name] || '',
      10,
    );

  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(
    Math.max(value, min),
    max,
  );
}

function booleanEnv(
  name: string,
  fallback: boolean,
): boolean {
  const value =
    env(name).toLowerCase();

  if (
    value === 'true' ||
    value === '1' ||
    value === 'yes'
  ) {
    return true;
  }

  if (
    value === 'false' ||
    value === '0' ||
    value === 'no'
  ) {
    return false;
  }

  return fallback;
}

/* -------------------------------------------------------------------------- */
/* Server                                                                      */
/* -------------------------------------------------------------------------- */

export const serverConfig = {
  port: numberEnv(
    'PORT',
    3000,
    1,
    65_535,
  ),

  host:
    env(
      'HOST',
      '0.0.0.0',
    ),

  nodeEnv:
    env(
      'NODE_ENV',
      'development',
    ),

  appUrl:
    env(
      'APP_URL',
      'http://localhost:3000',
    ),
};

/* -------------------------------------------------------------------------- */
/* Workspace                                                                   */
/* -------------------------------------------------------------------------- */

export const workspaceConfig = {
  root:
    env(
      'AGENT_WORKSPACE',
      process.cwd(),
    ),

  maxFileSize:
    numberEnv(
      'MAX_FILE_SIZE',
      2_000_000,
      1_024,
      20_000_000,
    ),

  maxProjectSize:
    numberEnv(
      'MAX_PROJECT_SIZE',
      500_000_000,
      1_000_000,
      2_000_000_000,
    ),

  maxFiles:
    numberEnv(
      'MAX_FILES',
      2_000,
      10,
      10_000,
    ),

  maxCommandLength:
    numberEnv(
      'MAX_COMMAND_LENGTH',
      20_000,
      100,
      100_000,
    ),
};

/* -------------------------------------------------------------------------- */
/* AI Providers                                                                */
/* -------------------------------------------------------------------------- */

export const aiConfig = {
  gemini: {
    apiKey:
      env('GEMINI_API_KEY'),

    model:
      env(
        'GEMINI_MODEL',
        'gemini-3.6-flash',
      ),
  },

  groq: {
    apiKey:
      env('GROQ_API_KEY'),

    model:
      env(
        'GROQ_MODEL',
        'qwen/qwen3.8-27b',
      ),
  },

  openrouter: {
    apiKey:
      env('OPENROUTER_API_KEY'),

    model:
      env(
        'OPENROUTER_MODEL',
        'openrouter/free',
      ),
  },

  temperature:
    Number(
      process.env.AI_TEMPERATURE ??
        '0.2',
    ),

  maxTokens:
    numberEnv(
      'AI_MAX_TOKENS',
      8_192,
      256,
      32_768,
    ),

  timeoutMs:
    numberEnv(
      'AI_TIMEOUT_MS',
      45_000,
      5_000,
      180_000,
    ),
};

/* -------------------------------------------------------------------------- */
/* Research                                                                    */
/* -------------------------------------------------------------------------- */

export const researchConfig = {
  firecrawlApiKey:
    env('FIRECRAWL_API_KEY'),

  timeoutMs:
    numberEnv(
      'RESEARCH_TIMEOUT_MS',
      20_000,
      3_000,
      120_000,
    ),

  maxResults:
    numberEnv(
      'RESEARCH_MAX_RESULTS',
      10,
      1,
      30,
    ),
};

/* -------------------------------------------------------------------------- */
/* GitHub                                                                      */
/* -------------------------------------------------------------------------- */

export const githubConfig = {
  token:
    env('GITHUB_TOKEN') ||
    env('GITHUB_PAT'),

  apiUrl:
    env(
      'GITHUB_API_URL',
      'https://api.github.com',
    ),

  timeoutMs:
    numberEnv(
      'GITHUB_TIMEOUT_MS',
      20_000,
      3_000,
      120_000,
    ),
};

/* -------------------------------------------------------------------------- */
/* Database                                                                    */
/* -------------------------------------------------------------------------- */

export const databaseConfig = {
  url:
    env('DATABASE_URL') ||
    env('AIVEN_DATABASE_URL'),

  ssl:
    booleanEnv(
      'DATABASE_SSL',
      true,
    ),

  poolMin:
    numberEnv(
      'DATABASE_POOL_MIN',
      0,
      0,
      20,
    ),

  poolMax:
    numberEnv(
      'DATABASE_POOL_MAX',
      10,
      1,
      50,
    ),

  connectionTimeoutMs:
    numberEnv(
      'DATABASE_CONNECTION_TIMEOUT_MS',
      10_000,
      1_000,
      60_000,
    ),

  idleTimeoutMs:
    numberEnv(
      'DATABASE_IDLE_TIMEOUT_MS',
      30_000,
      1_000,
      300_000,
    ),
};

/* -------------------------------------------------------------------------- */
/* Execution / Sandbox                                                         */
/* -------------------------------------------------------------------------- */

export const sandboxConfig = {
  timeoutMs:
    numberEnv(
      'SANDBOX_TIMEOUT_MS',
      30_000,
      1_000,
      120_000,
    ),

  maxOutputBytes:
    numberEnv(
      'SANDBOX_MAX_OUTPUT_BYTES',
      2_000_000,
      100_000,
      10_000_000,
    ),

  maxConcurrentProcesses:
    numberEnv(
      'SANDBOX_MAX_CONCURRENT_PROCESSES',
      3,
      1,
      10,
    ),
};

/* -------------------------------------------------------------------------- */
/* Rate limiting                                                               */
/* -------------------------------------------------------------------------- */

export const rateLimitConfig = {
  enabled:
    booleanEnv(
      'RATE_LIMIT_ENABLED',
      true,
    ),

  windowMs:
    numberEnv(
      'RATE_LIMIT_WINDOW_MS',
      60_000,
      1_000,
      3_600_000,
    ),

  maxRequests:
    numberEnv(
      'RATE_LIMIT_MAX_REQUESTS',
      60,
      1,
      1_000,
    ),
};

/* -------------------------------------------------------------------------- */
/* Security                                                                    */
/* -------------------------------------------------------------------------- */

export const securityConfig = {
  allowExternalNetwork:
    booleanEnv(
      'ALLOW_EXTERNAL_NETWORK',
      true,
    ),

  allowGitHubWrites:
    booleanEnv(
      'ALLOW_GITHUB_WRITES',
      true,
    ),

  requireApprovalForExternalWrites:
    booleanEnv(
      'REQUIRE_APPROVAL_EXTERNAL_WRITES',
      true,
    ),

  maxAuditEntries:
    numberEnv(
      'MAX_AUDIT_ENTRIES',
      500,
      50,
      10_000,
    ),
};

/* -------------------------------------------------------------------------- */
/* Complete configuration                                                      */
/* -------------------------------------------------------------------------- */

export const config = {
  server: serverConfig,
  workspace: workspaceConfig,
  ai: aiConfig,
  research: researchConfig,
  github: githubConfig,
  database: databaseConfig,
  sandbox: sandboxConfig,
  rateLimit: rateLimitConfig,
  security: securityConfig,
};

/* -------------------------------------------------------------------------- */
/* Provider availability                                                       */
/* -------------------------------------------------------------------------- */

export function getConfiguredProviders(): string[] {
  const providers: string[] = [];

  if (aiConfig.gemini.apiKey) {
    providers.push('gemini');
  }

  if (aiConfig.groq.apiKey) {
    providers.push('groq');
  }

  if (aiConfig.openrouter.apiKey) {
    providers.push('openrouter');
  }

  return providers;
}

/* -------------------------------------------------------------------------- */
/* Configuration validation                                                    */
/* -------------------------------------------------------------------------- */

export function validateConfig(): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  if (
    getConfiguredProviders()
      .length === 0
  ) {
    warnings.push(
      'No AI provider API key is configured.',
    );
  }

  if (
    !githubConfig.token
  ) {
    warnings.push(
      'GitHub token is not configured.',
    );
  }

  if (
    !researchConfig.firecrawlApiKey
  ) {
    warnings.push(
      'Firecrawl API key is not configured. Web search will be unavailable.',
    );
  }

  if (
    !databaseConfig.url
  ) {
    warnings.push(
      'Database URL is not configured. Persistent database features will be unavailable.',
    );
  }

  return {
    valid:
      getConfiguredProviders()
        .length > 0,

    warnings,
  };
}

/* -------------------------------------------------------------------------- */
/* Safe public configuration                                                   */
/* -------------------------------------------------------------------------- */

export function getPublicConfig() {
  return {
    environment:
      serverConfig.nodeEnv,

    agentLevel: 2,

    providers:
      getConfiguredProviders(),

    githubConfigured:
      Boolean(
        githubConfig.token,
      ),

    researchConfigured:
      Boolean(
        researchConfig.firecrawlApiKey,
      ),

    databaseConfigured:
      Boolean(
        databaseConfig.url,
      ),

    sandbox: {
      timeoutMs:
        sandboxConfig.timeoutMs,

      maxOutputBytes:
        sandboxConfig.maxOutputBytes,

      maxConcurrentProcesses:
        sandboxConfig.maxConcurrentProcesses,
    },
  };
}
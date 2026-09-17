'use strict';

/**
 * AI Developer Agent — Level 2
 * Research Engine
 *
 * Provides controlled external research for the agent.
 *
 * Sources:
 * - Firecrawl
 * - Stack Overflow / Stack Exchange
 * - npm registry
 * - PyPI
 *
 * Secrets are read exclusively from environment variables.
 */

const FIRECRAWL_API_KEY =
  process.env.FIRECRAWL_API_KEY || '';

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 5_000_000;
const MAX_RESULTS = 10;
const MAX_TEXT_LENGTH = 50_000;

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export interface ResearchResult {
  title: string;
  url: string;
  snippet?: string;
  content?: string;
  source: string;
}

export interface ResearchResponse {
  query: string;
  results: ResearchResult[];
  source: string;
  durationMs: number;
}

export interface PackageSearchResult {
  name: string;
  version?: string;
  description?: string;
  url?: string;
}

export interface StackOverflowResult {
  questionId: number;
  title: string;
  url: string;
  score: number;
  answerCount: number;
  isAnswered: boolean;
  tags: string[];
  excerpt?: string;
}

/* -------------------------------------------------------------------------- */
/* Utility                                                                     */
/* -------------------------------------------------------------------------- */

function cleanQuery(
  query: string,
): string {
  const value =
    String(query || '').trim();

  if (!value) {
    throw new Error(
      'Research query cannot be empty.',
    );
  }

  if (value.length > 1_000) {
    throw new Error(
      'Research query is too long.',
    );
  }

  return value;
}

function limitResults(
  value: number | undefined,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value)
  ) {
    return MAX_RESULTS;
  }

  return Math.min(
    Math.max(Math.floor(value), 1),
    MAX_RESULTS,
  );
}

function truncate(
  value: string,
  max = MAX_TEXT_LENGTH,
): string {
  if (value.length <= max) {
    return value;
  }

  return (
    value.slice(0, max) +
    '\n\n[content truncated]'
  );
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

async function fetchText(
  url: string,
  options: RequestInit = {},
): Promise<{
  response: Response;
  text: string;
}> {
  const {
    controller,
    timer,
  } = createTimeout();

  try {
    const response =
      await fetch(url, {
        ...options,
        signal:
          controller.signal,
      });

    const contentLength =
      response.headers.get(
        'content-length',
      );

    if (
      contentLength &&
      Number(contentLength) >
        MAX_RESPONSE_BYTES
    ) {
      throw new Error(
        'Research response is too large.',
      );
    }

    const text =
      await response.text();

    if (
      Buffer.byteLength(
        text,
        'utf8',
      ) > MAX_RESPONSE_BYTES
    ) {
      throw new Error(
        'Research response is too large.',
      );
    }

    return {
      response,
      text,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'AbortError'
    ) {
      throw new Error(
        'Research request timed out.',
      );
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const {
    response,
    text,
  } = await fetchText(
    url,
    {
      ...options,
      headers: {
        Accept:
          'application/json',
        ...(options.headers || {}),
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Research request failed (${response.status}).`,
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      'Research service returned invalid JSON.',
    );
  }
}

/* -------------------------------------------------------------------------- */
/* URL validation                                                              */
/* -------------------------------------------------------------------------- */

function validateHttpUrl(
  input: string,
): URL {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    throw new Error(
      'Invalid URL.',
    );
  }

  if (
    url.protocol !== 'http:' &&
    url.protocol !== 'https:'
  ) {
    throw new Error(
      'Only HTTP and HTTPS URLs are supported.',
    );
  }

  return url;
}

/* -------------------------------------------------------------------------- */
/* Firecrawl                                                                   */
/* -------------------------------------------------------------------------- */

async function firecrawlSearch(
  query: string,
  limit: number,
): Promise<ResearchResult[]> {
  if (!FIRECRAWL_API_KEY) {
    throw new Error(
      'Firecrawl is not configured.',
    );
  }

  const {
    response,
    text,
  } = await fetchText(
    'https://api.firecrawl.dev/v2/search',
    {
      method: 'POST',

      headers: {
        Authorization:
          `Bearer ${FIRECRAWL_API_KEY}`,

        'Content-Type':
          'application/json',

        Accept:
          'application/json',
      },

      body: JSON.stringify({
        query,
        limit,
        scrapeOptions: {
          formats: ['markdown'],
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Firecrawl search failed (${response.status}).`,
    );
  }

  let data: {
    success?: boolean;
    data?: Array<{
      title?: string;
      url?: string;
      description?: string;
      markdown?: string;
    }>;
  };

  try {
    data =
      JSON.parse(text);
  } catch {
    throw new Error(
      'Firecrawl returned invalid JSON.',
    );
  }

  const items =
    Array.isArray(data.data)
      ? data.data
      : [];

  return items
    .filter(
      (item) =>
        typeof item.url ===
        'string',
    )
    .slice(0, limit)
    .map((item) => ({
      title:
        item.title ||
        'Untitled result',

      url:
        item.url || '',

      snippet:
        item.description
          ? truncate(
              item.description,
              2_000,
            )
          : undefined,

      content:
        item.markdown
          ? truncate(
              item.markdown,
            )
          : undefined,

      source:
        'firecrawl',
    }));
}

/* -------------------------------------------------------------------------- */
/* Public web search                                                           */
/* -------------------------------------------------------------------------- */

export async function webSearch(
  queryInput: string,
  limitInput?: number,
): Promise<ResearchResponse> {
  const query =
    cleanQuery(queryInput);

  const limit =
    limitResults(limitInput);

  const startedAt =
    Date.now();

  /*
   * Firecrawl is the primary research
   * source when configured.
   */
  if (FIRECRAWL_API_KEY) {
    try {
      const results =
        await firecrawlSearch(
          query,
          limit,
        );

      return {
        query,
        results,
        source:
          'firecrawl',
        durationMs:
          Date.now() - startedAt,
      };
    } catch (error) {
      console.error(
        '[RESEARCH] Firecrawl failed:',
        error instanceof Error
          ? error.message
          : error,
      );
    }
  }

  /*
   * Without a search provider, return a
   * clear failure instead of pretending
   * a search occurred.
   */
  throw new Error(
    'No web search provider is available. Configure FIRECRAWL_API_KEY.',
  );
}

/* -------------------------------------------------------------------------- */
/* Web page fetch                                                              */
/* -------------------------------------------------------------------------- */

export async function webFetch(
  urlInput: string,
): Promise<ResearchResult> {
  const url =
    validateHttpUrl(
      String(urlInput || '').trim(),
    );

  const startedAt =
    Date.now();

  /*
   * Firecrawl can turn a webpage into
   * clean markdown for the agent.
   */
  if (FIRECRAWL_API_KEY) {
    try {
      const {
        response,
        text,
      } = await fetchText(
        'https://api.firecrawl.dev/v2/scrape',
        {
          method: 'POST',

          headers: {
            Authorization:
              `Bearer ${FIRECRAWL_API_KEY}`,

            'Content-Type':
              'application/json',

            Accept:
              'application/json',
          },

          body: JSON.stringify({
            url: url.toString(),

            formats: [
              'markdown',
            ],
          }),
        },
      );

      if (response.ok) {
        const data =
          JSON.parse(text);

        const markdown =
          data?.data?.markdown ||
          data?.markdown ||
          '';

        return {
          title:
            data?.data?.metadata
              ?.title ||
            data?.metadata?.title ||
            url.hostname,

          url:
            url.toString(),

          content:
            truncate(
              String(markdown),
            ),

          source:
            'firecrawl',

        };
      }
    } catch (error) {
      console.error(
        '[RESEARCH] Firecrawl scrape failed:',
        error instanceof Error
          ? error.message
          : error,
      );
    }
  }

  /*
   * Safe fallback: fetch the page
   * directly.
   */
  const {
    response,
    text,
  } = await fetchText(
    url.toString(),
    {
      headers: {
        'User-Agent':
          'AI-Developer-Agent-Level-2/1.0',
        Accept:
          'text/html,text/plain;q=0.9,*/*;q=0.1',
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Web page returned HTTP ${response.status}.`,
    );
  }

  return {
    title:
      url.hostname,

    url:
      url.toString(),

    content:
      truncate(text),

    source:
      'direct-http',

  };
}

/* -------------------------------------------------------------------------- */
/* Stack Overflow                                                              */
/* -------------------------------------------------------------------------- */

export async function stackOverflowSearch(
  queryInput: string,
  limitInput?: number,
): Promise<StackOverflowResult[]> {
  const query =
    cleanQuery(queryInput);

  const limit =
    limitResults(limitInput);

  const params =
    new URLSearchParams();

  params.set(
    'order',
    'desc',
  );

  params.set(
    'sort',
    'relevance',
  );

  params.set(
    'intitle',
    query,
  );

  params.set(
    'site',
    'stackoverflow',
  );

  params.set(
    'pagesize',
    String(limit),
  );

  params.set(
    'filter',
    'withbody',
  );

  const data =
    await fetchJson<{
      items?: Array<{
        question_id: number;
        title: string;
        link: string;
        score: number;
        answer_count: number;
        is_answered: boolean;
        tags: string[];
        body?: string;
      }>;
    }>(
      `https://api.stackexchange.com/2.3/search?${params.toString()}`,
    );

  return (
    data.items || []
  )
    .slice(0, limit)
    .map((item) => ({
      questionId:
        item.question_id,

      title:
        item.title,

      url:
        item.link,

      score:
        item.score,

      answerCount:
        item.answer_count,

      isAnswered:
        item.is_answered,

      tags:
        item.tags || [],

      excerpt:
        item.body
          ? truncate(
              item.body
                .replace(
                  /<[^>]*>/g,
                  ' ',
                )
                .replace(
                  /\s+/g,
                  ' ',
                )
                .trim(),
              2_000,
            )
          : undefined,
    }));
}

/* -------------------------------------------------------------------------- */
/* npm                                                                         */
/* -------------------------------------------------------------------------- */

export async function npmSearch(
  queryInput: string,
  limitInput?: number,
): Promise<PackageSearchResult[]> {
  const query =
    cleanQuery(queryInput);

  const limit =
    limitResults(limitInput);

  const params =
    new URLSearchParams();

  params.set(
    'text',
    query,
  );

  params.set(
    'size',
    String(limit),
  );

  const data =
    await fetchJson<{
      objects?: Array<{
        package?: {
          name?: string;
          version?: string;
          description?: string;
          links?: {
            npm?: string;
            homepage?: string;
          };
        };
      }>;
    }>(
      `https://registry.npmjs.org/-/v1/search?${params.toString()}`,
    );

  return (
    data.objects || []
  )
    .slice(0, limit)
    .map((item) => {
      const pkg =
        item.package || {};

      return {
        name:
          pkg.name || '',

        version:
          pkg.version,

        description:
          pkg.description
            ? truncate(
                pkg.description,
                2_000,
              )
            : undefined,

        url:
          pkg.links?.npm ||
          pkg.links?.homepage,
      };
    })
    .filter(
      (item) =>
        Boolean(item.name),
    );
}

/* -------------------------------------------------------------------------- */
/* PyPI                                                                        */
/* -------------------------------------------------------------------------- */

export async function pypiSearch(
  queryInput: string,
  limitInput?: number,
): Promise<PackageSearchResult[]> {
  const query =
    cleanQuery(queryInput);

  const limit =
    limitResults(limitInput);

  /*
   * PyPI does not provide the same
   * search endpoint as npm.
   *
   * First try the exact package name.
   * This is intentionally conservative:
   * we do not pretend PyPI has a general
   * search API when it doesn't.
   */
  const candidates = [
    query,
    query.replace(
      /\s+/g,
      '-',
    ),
    query.replace(
      /\s+/g,
      '_',
    ),
  ];

  const unique =
    Array.from(
      new Set(candidates),
    );

  const results: PackageSearchResult[] = [];

  for (
    const packageName of unique
  ) {
    if (
      results.length >= limit
    ) {
      break;
    }

    const encoded =
      encodeURIComponent(
        packageName,
      );

    try {
      const response =
        await fetch(
          `https://pypi.org/pypi/${encoded}/json`,
          {
            headers: {
              Accept:
                'application/json',

              'User-Agent':
                'AI-Developer-Agent-Level-2/1.0',
            },

            signal:
              AbortSignal.timeout(
                REQUEST_TIMEOUT_MS,
              ),
          },
        );

      if (!response.ok) {
        continue;
      }

      const data =
        await response.json();

      results.push({
        name:
          data?.info?.name ||
          packageName,

        version:
          data?.info?.version,

        description:
          data?.info?.summary
            ? truncate(
                data.info.summary,
                2_000,
              )
            : undefined,

        url:
          data?.info?.project_url ||
          data?.info?.home_page ||
          `https://pypi.org/project/${encodeURIComponent(
            data?.info?.name ||
              packageName,
          )}/`,
      });
    } catch {
      /*
       * One missing package should not
       * fail the complete research call.
       */
      continue;
    }
  }

  return results;
}

/* -------------------------------------------------------------------------- */
/* Research aggregation                                                        */
/* -------------------------------------------------------------------------- */

export async function research(
  queryInput: string,
): Promise<ResearchResponse> {
  const query =
    cleanQuery(queryInput);

  return webSearch(
    query,
    MAX_RESULTS,
  );
}

/* -------------------------------------------------------------------------- */
/* Health                                                                      */
/* -------------------------------------------------------------------------- */

export function getResearchConfig(): {
  firecrawlConfigured: boolean;
  sources: string[];
} {
  return {
    firecrawlConfigured:
      Boolean(FIRECRAWL_API_KEY),

    sources: [
      ...(FIRECRAWL_API_KEY
        ? ['firecrawl']
        : []),

      'stackoverflow',
      'npm',
      'pypi',
    ],
  };
}

export async function researchHealthCheck(): Promise<{
  firecrawlConfigured: boolean;
  stackOverflow: boolean;
  npm: boolean;
  pypi: boolean;
}> {
  return {
    firecrawlConfigured:
      Boolean(FIRECRAWL_API_KEY),

    /*
     * These services are public APIs,
     * so availability is represented as
     * configured rather than authenticated.
     */
    stackOverflow: true,
    npm: true,
    pypi: true,
  };
}
'use strict';

/**
 * AI Developer Agent — Level 2
 * GitHub Integration
 *
 * Responsibilities:
 * - Authenticate with GitHub using a server-side token.
 * - Read repositories, files, issues and branches.
 * - Search GitHub repositories.
 * - Create branches, commits and pull requests.
 * - Never expose the GitHub token to the agent/model.
 */

import crypto from 'node:crypto';

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

const GITHUB_API = 'https://api.github.com';

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 5_000_000;
const MAX_FILE_BYTES = 2_000_000;

const GITHUB_TOKEN =
  process.env.GITHUB_TOKEN ||
  process.env.GITHUB_PAT ||
  '';

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  description: string | null;
  owner: {
    login: string;
  };
}

export interface GitHubFile {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: 'file' | 'dir';
  download_url: string | null;
  html_url: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  html_url: string;
  body: string | null;
  user: {
    login: string;
  } | null;
}

export interface GitHubBranch {
  name: string;
  sha: string;
  protected: boolean;
}

export interface GitHubCommitResult {
  sha: string;
  url: string;
  message: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  state: string;
  html_url: string;
  body: string | null;
}

export interface GitHubSearchResult<T> {
  total_count: number;
  incomplete_results: boolean;
  items: T[];
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

export class GitHubError extends Error {
  status: number;
  details?: unknown;

  constructor(
    message: string,
    status = 500,
    details?: unknown,
  ) {
    super(message);

    this.name = 'GitHubError';
    this.status = status;
    this.details = details;
  }
}

/* -------------------------------------------------------------------------- */
/* Utility functions                                                           */
/* -------------------------------------------------------------------------- */

function requireToken(): string {
  if (!GITHUB_TOKEN) {
    throw new GitHubError(
      'GitHub authentication is not configured. Set GITHUB_TOKEN in .env.',
      503,
    );
  }

  return GITHUB_TOKEN;
}

function cleanOwner(value: string): string {
  const owner = String(value || '').trim();

  if (!/^[A-Za-z0-9_.-]+$/.test(owner)) {
    throw new GitHubError(
      'Invalid GitHub owner.',
      400,
    );
  }

  return owner;
}

function cleanRepo(value: string): string {
  const repo = String(value || '').trim();

  if (!/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new GitHubError(
      'Invalid GitHub repository name.',
      400,
    );
  }

  return repo;
}

function cleanBranch(value: string): string {
  const branch = String(value || '').trim();

  if (
    !branch ||
    branch.length > 250 ||
    branch.startsWith('-') ||
    branch.includes('..') ||
    branch.includes('//') ||
    branch.includes('\\') ||
    branch.includes(' ')
  ) {
    throw new GitHubError(
      'Invalid Git branch name.',
      400,
    );
  }

  if (!/^[A-Za-z0-9._/@-]+$/.test(branch)) {
    throw new GitHubError(
      'Invalid Git branch name.',
      400,
    );
  }

  return branch;
}

function cleanPath(value: string): string {
  const filePath = String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');

  if (
    !filePath ||
    filePath.length > 1_000 ||
    filePath.includes('..') ||
    filePath.includes('\0')
  ) {
    throw new GitHubError(
      'Invalid repository file path.',
      400,
    );
  }

  return filePath;
}

function cleanCommitMessage(
  value: string,
): string {
  const message = String(value || '').trim();

  if (!message) {
    throw new GitHubError(
      'Commit message cannot be empty.',
      400,
    );
  }

  if (message.length > 500) {
    throw new GitHubError(
      'Commit message is too long.',
      400,
    );
  }

  return message;
}

function cleanTitle(
  value: string,
): string {
  const title = String(value || '').trim();

  if (!title) {
    throw new GitHubError(
      'Title cannot be empty.',
      400,
    );
  }

  if (title.length > 250) {
    throw new GitHubError(
      'Title is too long.',
      400,
    );
  }

  return title;
}

function cleanBody(
  value: string | undefined,
): string | undefined {
  if (
    typeof value === 'undefined' ||
    value === null
  ) {
    return undefined;
  }

  if (value.length > 50_000) {
    throw new GitHubError(
      'Body is too large.',
      400,
    );
  }

  return value;
}

/* -------------------------------------------------------------------------- */
/* Request helper                                                              */
/* -------------------------------------------------------------------------- */

async function githubRequest<T>(
  endpoint: string,
  options: {
    method?: string;
    body?: unknown;
    accept?: string;
  } = {},
): Promise<T> {
  const token = requireToken();

  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );

  try {
    const headers: Record<string, string> = {
      Accept:
        options.accept ||
        'application/vnd.github+json',

      Authorization:
        `Bearer ${token}`,

      'X-GitHub-Api-Version':
        '2022-11-28',

      'User-Agent':
        'AI-Developer-Agent-Level-2',

      'Content-Type':
        'application/json',
    };

    const response = await fetch(
      `${GITHUB_API}${endpoint}`,
      {
        method:
          options.method || 'GET',

        headers,

        body:
          typeof options.body === 'undefined'
            ? undefined
            : JSON.stringify(options.body),

        signal: controller.signal,
      },
    );

    const contentLength =
      response.headers.get(
        'content-length',
      );

    if (
      contentLength &&
      Number(contentLength) >
        MAX_RESPONSE_BYTES
    ) {
      throw new GitHubError(
        'GitHub response is too large.',
        502,
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
      throw new GitHubError(
        'GitHub response is too large.',
        502,
      );
    }

    let data: unknown = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      let message =
        `GitHub API request failed (${response.status}).`;

      if (
        typeof data === 'object' &&
        data !== null &&
        'message' in data
      ) {
        const githubMessage =
          (data as { message?: unknown })
            .message;

        if (
          typeof githubMessage ===
          'string'
        ) {
          message =
            `GitHub: ${githubMessage}`;
        }
      }

      throw new GitHubError(
        message,
        response.status,
        data,
      );
    }

    return data as T;
  } catch (error) {
    if (error instanceof GitHubError) {
      throw error;
    }

    if (
      error instanceof Error &&
      error.name === 'AbortError'
    ) {
      throw new GitHubError(
        'GitHub request timed out.',
        504,
      );
    }

    throw new GitHubError(
      error instanceof Error
        ? error.message
        : 'GitHub request failed.',
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}

/* -------------------------------------------------------------------------- */
/* Repository parsing                                                          */
/* -------------------------------------------------------------------------- */

export function parseRepositoryUrl(
  input: string,
): {
  owner: string;
  repo: string;
} {
  let value = String(input || '')
    .trim();

  if (!value) {
    throw new GitHubError(
      'GitHub repository URL is required.',
      400,
    );
  }

  if (
    !value.startsWith('http://') &&
    !value.startsWith('https://')
  ) {
    value =
      `https://github.com/${value}`;
  }

  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new GitHubError(
      'Invalid GitHub repository URL.',
      400,
    );
  }

  if (
    parsed.hostname !== 'github.com' &&
    parsed.hostname !== 'www.github.com'
  ) {
    throw new GitHubError(
      'Only github.com repositories are supported.',
      400,
    );
  }

  const parts =
    parsed.pathname
      .split('/')
      .filter(Boolean);

  if (parts.length < 2) {
    throw new GitHubError(
      'GitHub URL must contain owner and repository.',
      400,
    );
  }

  return {
    owner: cleanOwner(parts[0]),
    repo: cleanRepo(
      parts[1].replace(/\.git$/, ''),
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Repository                                                                  */
/* -------------------------------------------------------------------------- */

export async function getRepository(
  ownerInput: string,
  repoInput: string,
): Promise<GitHubRepository> {
  const owner =
    cleanOwner(ownerInput);

  const repo =
    cleanRepo(repoInput);

  return githubRequest<GitHubRepository>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
  );
}

/* -------------------------------------------------------------------------- */
/* Search repositories                                                         */
/* -------------------------------------------------------------------------- */

export async function searchRepositories(
  query: string,
  limit = 10,
): Promise<
  GitHubSearchResult<GitHubRepository>
> {
  const cleaned =
    String(query || '').trim();

  if (!cleaned) {
    throw new GitHubError(
      'Repository search query is required.',
      400,
    );
  }

  const safeLimit = Math.min(
    Math.max(
      Number.isFinite(limit)
        ? Math.floor(limit)
        : 10,
      1,
    ),
    30,
  );

  const params =
    new URLSearchParams();

  params.set(
    'q',
    cleaned.slice(0, 500),
  );

  params.set(
    'per_page',
    String(safeLimit),
  );

  params.set(
    'sort',
    'stars',
  );

  params.set(
    'order',
    'desc',
  );

  return githubRequest<
    GitHubSearchResult<GitHubRepository>
  >(
    `/search/repositories?${params.toString()}`,
  );
}

/* -------------------------------------------------------------------------- */
/* Repository files                                                            */
/* -------------------------------------------------------------------------- */

export async function getFile(
  ownerInput: string,
  repoInput: string,
  pathInput: string,
  branchInput?: string,
): Promise<{
  name: string;
  path: string;
  sha: string;
  size: number;
  content: string;
  encoding: string;
  html_url: string;
}> {
  const owner =
    cleanOwner(ownerInput);

  const repo =
    cleanRepo(repoInput);

  const filePath =
    cleanPath(pathInput);

  const params =
    new URLSearchParams();

  if (branchInput) {
    params.set(
      'ref',
      cleanBranch(branchInput),
    );
  }

  const suffix =
    params.toString()
      ? `?${params.toString()}`
      : '';

  const data =
    await githubRequest<{
      name: string;
      path: string;
      sha: string;
      size: number;
      content?: string;
      encoding?: string;
      html_url: string;
    }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath}${suffix}`,
    );

  if (
    data.size >
    MAX_FILE_BYTES
  ) {
    throw new GitHubError(
      'GitHub file exceeds the maximum supported size.',
      413,
    );
  }

  let content = '';

  if (
    data.content &&
    data.encoding === 'base64'
  ) {
    content = Buffer.from(
      data.content.replace(/\s/g, ''),
      'base64',
    ).toString('utf8');
  }

  return {
    name: data.name,
    path: data.path,
    sha: data.sha,
    size: data.size,
    content,
    encoding: 'utf-8',
    html_url: data.html_url,
  };
}

/* -------------------------------------------------------------------------- */
/* List repository files                                                       */
/* -------------------------------------------------------------------------- */

export async function listFiles(
  ownerInput: string,
  repoInput: string,
  pathInput = '',
  branchInput?: string,
): Promise<GitHubFile[]> {
  const owner =
    cleanOwner(ownerInput);

  const repo =
    cleanRepo(repoInput);

  const filePath =
    pathInput
      ? cleanPath(pathInput)
      : '';

  const params =
    new URLSearchParams();

  if (branchInput) {
    params.set(
      'ref',
      cleanBranch(branchInput),
    );
  }

  const suffix =
    params.toString()
      ? `?${params.toString()}`
      : '';

  return githubRequest<
    GitHubFile[]
  >(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath}${suffix}`,
  );
}

/* -------------------------------------------------------------------------- */
/* Issues                                                                      */
/* -------------------------------------------------------------------------- */

export async function searchIssues(
  ownerInput: string,
  repoInput: string,
  query = '',
): Promise<GitHubIssue[]> {
  const owner =
    cleanOwner(ownerInput);

  const repo =
    cleanRepo(repoInput);

  const extra =
    String(query || '').trim();

  const searchQuery =
    extra
      ? `${extra} repo:${owner}/${repo}`
      : `repo:${owner}/${repo}`;

  const params =
    new URLSearchParams();

  params.set(
    'q',
    searchQuery.slice(0, 500),
  );

  params.set(
    'per_page',
    '30',
  );

  const result =
    await githubRequest<{
      items: GitHubIssue[];
    }>(
      `/search/issues?${params.toString()}`,
    );

  return result.items;
}

export async function getIssue(
  ownerInput: string,
  repoInput: string,
  issueNumber: number,
): Promise<GitHubIssue> {
  const owner =
    cleanOwner(ownerInput);

  const repo =
    cleanRepo(repoInput);

  const number =
    Number(issueNumber);

  if (
    !Number.isInteger(number) ||
    number < 1
  ) {
    throw new GitHubError(
      'Invalid issue number.',
      400,
    );
  }

  return githubRequest<GitHubIssue>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}`,
  );
}

/* -------------------------------------------------------------------------- */
/* Branches                                                                    */
/* -------------------------------------------------------------------------- */

export async function listBranches(
  ownerInput: string,
  repoInput: string,
): Promise<GitHubBranch[]> {
  const owner =
    cleanOwner(ownerInput);

  const repo =
    cleanRepo(repoInput);

  return githubRequest<
    GitHubBranch[]
  >(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`,
  );
}

export async function createBranch(
  ownerInput: string,
  repoInput: string,
  branchInput: string,
  fromBranchInput?: string,
): Promise<GitHubBranch> {
  const owner =
    cleanOwner(ownerInput);

  const repo =
    cleanRepo(repoInput);

  const branch =
    cleanBranch(branchInput);

  const repository =
    await getRepository(
      owner,
      repo,
    );

  const sourceBranch =
    cleanBranch(
      fromBranchInput ||
      repository.default_branch,
    );

  const source =
    await githubRequest<{
      object: {
        sha: string;
      };
    }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(sourceBranch)}`,
    );

  await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`,
    {
      method: 'POST',
      body: {
        ref: `refs/heads/${branch}`,
        sha: source.object.sha,
      },
    },
  );

  return {
    name: branch,
    sha: source.object.sha,
    protected: false,
  };
}

/* -------------------------------------------------------------------------- */
/* Create or update file                                                       */
/* -------------------------------------------------------------------------- */

export async function createOrUpdateFile(
  ownerInput: string,
  repoInput: string,
  pathInput: string,
  content: string,
  messageInput: string,
  branchInput?: string,
  existingSha?: string,
): Promise<GitHubCommitResult> {
  const owner =
    cleanOwner(ownerInput);

  const repo =
    cleanRepo(repoInput);

  const filePath =
    cleanPath(pathInput);

  const message =
    cleanCommitMessage(
      messageInput,
    );

  const branch =
    branchInput
      ? cleanBranch(branchInput)
      : undefined;

  if (
    typeof content !== 'string'
  ) {
    throw new GitHubError(
      'File content must be a string.',
      400,
    );
  }

  if (
    Buffer.byteLength(
      content,
      'utf8',
    ) > MAX_FILE_BYTES
  ) {
    throw new GitHubError(
      'File content is too large.',
      413,
    );
  }

  const body: Record<
    string,
    unknown
  > = {
    message,
    content:
      Buffer.from(
        content,
        'utf8',
      ).toString('base64'),
  };

  if (branch) {
    body.branch = branch;
  }

  if (existingSha) {
    body.sha = existingSha;
  }

  const result =
    await githubRequest<{
      commit: {
        sha: string;
        html_url: string;
        message: string;
      };
    }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath}`,
      {
        method: 'PUT',
        body,
      },
    );

  return {
    sha: result.commit.sha,
    url: result.commit.html_url,
    message: result.commit.message,
  };
}

/* -------------------------------------------------------------------------- */
/* Pull requests                                                               */
/* -------------------------------------------------------------------------- */

export async function createPullRequest(
  ownerInput: string,
  repoInput: string,
  titleInput: string,
  headInput: string,
  baseInput: string,
  bodyInput?: string,
): Promise<GitHubPullRequest> {
  const owner =
    cleanOwner(ownerInput);

  const repo =
    cleanRepo(repoInput);

  const title =
    cleanTitle(titleInput);

  const head =
    cleanBranch(headInput);

  const base =
    cleanBranch(baseInput);

  const body =
    cleanBody(bodyInput);

  return githubRequest<GitHubPullRequest>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
    {
      method: 'POST',
      body: {
        title,
        head,
        base,
        ...(typeof body === 'undefined'
          ? {}
          : { body }),
      },
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Authentication information                                                 */
/* -------------------------------------------------------------------------- */

export async function getAuthenticatedUser(): Promise<{
  login: string;
  id: number;
  name: string | null;
  html_url: string;
}> {
  return githubRequest<{
    login: string;
    id: number;
    name: string | null;
    html_url: string;
  }>('/user');
}

/* -------------------------------------------------------------------------- */
/* Health check                                                                */
/* -------------------------------------------------------------------------- */

export async function githubHealthCheck(): Promise<{
  configured: boolean;
  authenticated: boolean;
  username?: string;
}> {
  if (!GITHUB_TOKEN) {
    return {
      configured: false,
      authenticated: false,
    };
  }

  try {
    const user =
      await getAuthenticatedUser();

    return {
      configured: true,
      authenticated: true,
      username: user.login,
    };
  } catch {
    return {
      configured: true,
      authenticated: false,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Safe public information                                                     */
/* -------------------------------------------------------------------------- */

export function getGitHubConfig(): {
  configured: boolean;
  api: string;
} {
  return {
    configured:
      Boolean(GITHUB_TOKEN),
    api: GITHUB_API,
  };
}

/* -------------------------------------------------------------------------- */
/* Request ID helper                                                           */
/* -------------------------------------------------------------------------- */

export function createGitHubRequestId(): string {
  return crypto.randomBytes(12).toString('hex');
}
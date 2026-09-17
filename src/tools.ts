/**
 * AI Developer Agent — Level 2
 * Tool Engine
 *
 * Responsibilities:
 * - Filesystem inspection and editing
 * - Safe terminal execution
 * - Git operations
 * - Tests / build / lint / typecheck
 * - GitHub API operations
 * - Web research through Firecrawl
 * - Stack Overflow search
 * - npm / PyPI package research
 *
 * Security:
 * - Secrets are read ONLY from process.env
 * - Filesystem access is restricted to the workspace
 * - Dangerous shell commands are rejected
 * - GitHub credentials are never returned to the model
 * - External HTTP requests have timeouts
 * - Tool output is bounded to protect agent context
 */

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const WORKSPACE_ROOT = path.resolve(
  process.env.AGENT_WORKSPACE || process.cwd(),
);

const MAX_FILE_SIZE = 2_000_000;
const MAX_OUTPUT_LENGTH = 30_000;
const MAX_SEARCH_RESULTS = 25;
const DEFAULT_TIMEOUT = 30_000;
const RESEARCH_TIMEOUT = 20_000;
const GITHUB_TIMEOUT = 20_000;

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type ToolName =
  | "read_file"
  | "write_file"
  | "list_files"
  | "search_files"
  | "execute_command"
  | "git_status"
  | "git_diff"
  | "git_log"
  | "git_branch"
  | "git_commit"
  | "run_tests"
  | "run_build"
  | "run_lint"
  | "run_typecheck"
  | "search_repositories"
  | "get_repository"
  | "get_file"
  | "search_issues"
  | "get_issue"
  | "create_branch"
  | "create_commit"
  | "create_pull_request"
  | "web_search"
  | "web_fetch"
  | "stackoverflow_search"
  | "npm_search"
  | "pypi_search";

export interface ToolDefinition {
  name: ToolName;
  description: string;
  category:
    | "files"
    | "terminal"
    | "git"
    | "testing"
    | "github"
    | "research";
  dangerous?: boolean;
  inputSchema: Record<string, unknown>;
}

export interface ToolRequest {
  name: ToolName;
  arguments?: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  tool: ToolName;
  data?: unknown;
  error?: string;
  durationMs: number;
}

export interface FileSearchResult {
  path: string;
  line: number;
  text: string;
}

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
}

export interface GitHubFile {
  name: string;
  path: string;
  sha: string;
  size: number;
  html_url?: string;
  download_url?: string | null;
  type: string;
  content?: string;
  encoding?: string;
}

export interface ResearchResult {
  title: string;
  url: string;
  description?: string;
  content?: string;
  source: string;
}

/* -------------------------------------------------------------------------- */
/* Tool registry                                                              */
/* -------------------------------------------------------------------------- */

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "read_file",
    category: "files",
    description: "Read a file from the current workspace.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        startLine: { type: "number" },
        endLine: { type: "number" },
      },
      required: ["path"],
    },
  },

  {
    name: "write_file",
    category: "files",
    description:
      "Create or overwrite a workspace file with exact text content.",
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },

  {
    name: "list_files",
    category: "files",
    description:
      "Recursively inspect workspace files while ignoring dependency and build directories.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        maxDepth: { type: "number" },
      },
    },
  },

  {
    name: "search_files",
    category: "files",
    description:
      "Search source files for a text or regular-expression pattern.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        regex: { type: "boolean" },
        maxResults: { type: "number" },
      },
      required: ["pattern"],
    },
  },

  {
    name: "execute_command",
    category: "terminal",
    description:
      "Execute a development command inside the project workspace.",
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeoutMs: { type: "number" },
      },
      required: ["command"],
    },
  },

  {
    name: "git_status",
    category: "git",
    description: "Show the current Git working-tree status.",
    inputSchema: { type: "object" },
  },

  {
    name: "git_diff",
    category: "git",
    description: "Inspect current Git changes.",
    inputSchema: {
      type: "object",
      properties: {
        staged: { type: "boolean" },
      },
    },
  },

  {
    name: "git_log",
    category: "git",
    description: "Inspect recent Git commits.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" },
      },
    },
  },

  {
    name: "git_branch",
    category: "git",
    description: "List or create local Git branches.",
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "create"],
        },
        name: { type: "string" },
      },
      required: ["action"],
    },
  },

  {
    name: "git_commit",
    category: "git",
    description: "Create a Git commit from staged changes.",
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string" },
      },
      required: ["message"],
    },
  },

  {
    name: "run_tests",
    category: "testing",
    description: "Run the project's test suite.",
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
      },
    },
  },

  {
    name: "run_build",
    category: "testing",
    description: "Run the project's build command.",
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
      },
    },
  },

  {
    name: "run_lint",
    category: "testing",
    description: "Run the project's lint command.",
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
      },
    },
  },

  {
    name: "run_typecheck",
    category: "testing",
    description: "Run the project's TypeScript type checker.",
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
      },
    },
  },

  {
    name: "search_repositories",
    category: "github",
    description: "Search public GitHub repositories.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },

  {
    name: "get_repository",
    category: "github",
    description: "Get GitHub repository metadata.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
      },
      required: ["owner", "repo"],
    },
  },

  {
    name: "get_file",
    category: "github",
    description: "Read a file from a GitHub repository.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        path: { type: "string" },
        ref: { type: "string" },
      },
      required: ["owner", "repo", "path"],
    },
  },

  {
    name: "search_issues",
    category: "github",
    description: "Search GitHub issues.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },

  {
    name: "get_issue",
    category: "github",
    description: "Get a GitHub issue.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        number: { type: "number" },
      },
      required: ["owner", "repo", "number"],
    },
  },

  {
    name: "create_branch",
    category: "github",
    description: "Create a branch on GitHub.",
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        branch: { type: "string" },
        fromBranch: { type: "string" },
      },
      required: ["owner", "repo", "branch"],
    },
  },

  {
    name: "create_commit",
    category: "github",
    description: "Create a GitHub commit using the Git Trees API.",
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        branch: { type: "string" },
        message: { type: "string" },
        files: {
          type: "array",
        },
      },
      required: ["owner", "repo", "branch", "message", "files"],
    },
  },

  {
    name: "create_pull_request",
    category: "github",
    description: "Create a GitHub pull request.",
    dangerous: true,
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        head: { type: "string" },
        base: { type: "string" },
      },
      required: ["owner", "repo", "title", "head", "base"],
    },
  },

  {
    name: "web_search",
    category: "research",
    description: "Search the web using Firecrawl.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },

  {
    name: "web_fetch",
    category: "research",
    description: "Fetch and extract readable content from a web page.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
      },
      required: ["url"],
    },
  },

  {
    name: "stackoverflow_search",
    category: "research",
    description: "Search Stack Overflow for developer questions and answers.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },

  {
    name: "npm_search",
    category: "research",
    description: "Search npm packages.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },

  {
    name: "pypi_search",
    category: "research",
    description: "Look up Python packages on PyPI.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
  },
];

/* -------------------------------------------------------------------------- */
/* General helpers                                                            */
/* -------------------------------------------------------------------------- */

function truncate(value: string, max = MAX_OUTPUT_LENGTH): string {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max)}\n...[output truncated]`;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeRelativePath(input: string): string {
  return input
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();
}

function resolveWorkspacePath(input: string): string {
  const relative = normalizeRelativePath(input);

  if (!relative) {
    return WORKSPACE_ROOT;
  }

  const resolved = path.resolve(WORKSPACE_ROOT, relative);

  if (
    resolved !== WORKSPACE_ROOT &&
    !resolved.startsWith(`${WORKSPACE_ROOT}${path.sep}`)
  ) {
    throw new Error("Path escapes the agent workspace.");
  }

  return resolved;
}

function displayPath(filePath: string): string {
  return path.relative(WORKSPACE_ROOT, filePath).replace(/\\/g, "/") || ".";
}

function validateNonEmpty(value: string, field: string): void {
  if (!value.trim()) {
    throw new Error(`${field} cannot be empty.`);
  }
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/* -------------------------------------------------------------------------- */
/* HTTP helper                                                                */
/* -------------------------------------------------------------------------- */

async function fetchJson(
  url: string,
  options: RequestInit = {},
  timeoutMs = RESEARCH_TIMEOUT,
): Promise<any> {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs,
  );

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    const text = await response.text();

    let body: unknown = text;

    try {
      body = JSON.parse(text);
    } catch {
      // Keep plain text.
    }

    if (!response.ok) {
      const message =
        typeof body === "object" &&
        body !== null &&
        "message" in body
          ? String((body as { message: unknown }).message)
          : `HTTP ${response.status}`;

      throw new Error(message);
    }

    return body;
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* Shell security                                                             */
/* -------------------------------------------------------------------------- */

const BLOCKED_COMMAND_PATTERNS: RegExp[] = [
  /rm\s+-rf\s+\/(?:\s|$)/i,
  /rm\s+-rf\s+\/\*/i,
  /mkfs(?:\.[a-z0-9]+)?\s+/i,
  /:\(\)\s*\{\s*:\|:\s*&\s*\};:/,
  /fork\s*bomb/i,
  />\s*\/dev\/sd[a-z]/i,
  /dd\s+if=.*of=\/dev\//i,
  /shutdown\s+/i,
  /reboot\s*/i,
  /poweroff\s*/i,
  /init\s+[06]\b/i,
  /curl[^|;&\n]*\|\s*(?:bash|sh|zsh)/i,
  /wget[^|;&\n]*\|\s*(?:bash|sh|zsh)/i,
  /\bdel\s+(?:\/s\s+)?(?:\/q\s+)?[a-z]:\\/i,
  /\brmdir\s+\/s\b/i,
  /\bformat\s+[a-z]:/i,
  /\bpowershell(?:\.exe)?\s+[^\n]*-(?:enc|encodedcommand)\b/i,
];

function assertCommandSafe(command: string): void {
  validateNonEmpty(command, "Command");

  for (const pattern of BLOCKED_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error(
        "Command rejected by the agent security policy.",
      );
    }
  }
}

async function runShell(
  command: string,
  timeoutMs = DEFAULT_TIMEOUT,
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  assertCommandSafe(command);

  const shell =
    process.platform === "win32"
      ? process.env.ComSpec || "cmd.exe"
      : "/bin/bash";

  const shellArguments =
    process.platform === "win32"
      ? ["/d", "/s", "/c", command]
      : ["-lc", command];

  try {
    const result = await execFileAsync(
      shell,
      shellArguments,
      {
        cwd: WORKSPACE_ROOT,
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env,
          PWD: WORKSPACE_ROOT,
        },
      },
    );

    return {
      exitCode: 0,
      stdout: truncate(result.stdout || ""),
      stderr: truncate(result.stderr || ""),
    };
  } catch (error: any) {
    return {
      exitCode:
        typeof error?.code === "number"
          ? error.code
          : 1,
      stdout: truncate(String(error?.stdout || "")),
      stderr: truncate(
        String(error?.stderr || error?.message || ""),
      ),
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Files                                                                      */
/* -------------------------------------------------------------------------- */

async function readFileTool(
  args: Record<string, unknown>,
): Promise<unknown> {
  const relativePath = asString(args.path);

  validateNonEmpty(relativePath, "path");

  const filePath = resolveWorkspacePath(relativePath);

  const stats = await fs.stat(filePath);

  if (!stats.isFile()) {
    throw new Error("The requested path is not a file.");
  }

  if (stats.size > MAX_FILE_SIZE) {
    throw new Error(
      `File is too large. Maximum supported size is ${MAX_FILE_SIZE} bytes.`,
    );
  }

  const content = await fs.readFile(filePath, "utf8");

  const startLine = Math.max(
    1,
    Math.floor(asNumber(args.startLine, 1)),
  );

  const endLine = Math.max(
    startLine,
    Math.floor(
      asNumber(
        args.endLine,
        Number.MAX_SAFE_INTEGER,
      ),
    ),
  );

  const lines = content.split(/\r?\n/);

  const selected = lines
    .slice(startLine - 1, endLine)
    .map(
      (line, index) =>
        `${startLine + index}: ${line}`,
    )
    .join("\n");

  return {
    path: displayPath(filePath),
    size: stats.size,
    lines: lines.length,
    content: truncate(
      selected,
      MAX_OUTPUT_LENGTH * 2,
    ),
  };
}

async function writeFileTool(
  args: Record<string, unknown>,
): Promise<unknown> {
  const relativePath = asString(args.path);
  const content = asString(args.content);

  validateNonEmpty(relativePath, "path");

  if (Buffer.byteLength(content, "utf8") > MAX_FILE_SIZE) {
    throw new Error(
      `File exceeds the ${MAX_FILE_SIZE}-byte safety limit.`,
    );
  }

  const filePath = resolveWorkspacePath(relativePath);

  await fs.mkdir(
    path.dirname(filePath),
    {
      recursive: true,
    },
  );

  await fs.writeFile(
    filePath,
    content,
    "utf8",
  );

  return {
    path: displayPath(filePath),
    bytes: Buffer.byteLength(content, "utf8"),
    lines: content.split(/\r?\n/).length,
    written: true,
  };
}

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".next",
  ".nuxt",
  ".cache",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".vite",
]);

async function listFilesTool(
  args: Record<string, unknown>,
): Promise<unknown> {
  const relativePath = asString(args.path, ".");
  const maxDepth = Math.min(
    12,
    Math.max(
      0,
      Math.floor(
        asNumber(args.maxDepth, 6),
      ),
    ),
  );

  const root = resolveWorkspacePath(relativePath);

  const results: Array<{
    path: string;
    type: "file" | "directory";
  }> = [];

  async function walk(
    current: string,
    depth: number,
  ): Promise<void> {
    if (depth > maxDepth) {
      return;
    }

    let entries;

    try {
      entries = await fs.readdir(
        current,
        {
          withFileTypes: true,
        },
      );
    } catch {
      return;
    }

    entries.sort((a, b) =>
      a.name.localeCompare(
        b.name,
        undefined,
        {
          numeric: true,
          sensitivity: "base",
        },
      ),
    );

    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        IGNORED_DIRECTORIES.has(entry.name)
      ) {
        continue;
      }

      const absolute = path.join(
        current,
        entry.name,
      );

      results.push({
        path: displayPath(absolute),
        type: entry.isDirectory()
          ? "directory"
          : "file",
      });

      if (
        entry.isDirectory() &&
        depth < maxDepth
      ) {
        await walk(
          absolute,
          depth + 1,
        );
      }

      if (
        results.length >=
        MAX_SEARCH_RESULTS * 20
      ) {
        return;
      }
    }
  }

  await walk(root, 0);

  return {
    root: displayPath(root),
    count: results.length,
    files: results,
  };
}

async function searchFilesTool(
  args: Record<string, unknown>,
): Promise<unknown> {
  const pattern = asString(args.pattern);
  const relativePath = asString(args.path, ".");
  const useRegex = asBoolean(args.regex, false);

  validateNonEmpty(pattern, "pattern");

  const maxResults = Math.min(
    MAX_SEARCH_RESULTS,
    Math.max(
      1,
      Math.floor(
        asNumber(
          args.maxResults,
          MAX_SEARCH_RESULTS,
        ),
      ),
    ),
  );

  const root = resolveWorkspacePath(relativePath);

  const results: FileSearchResult[] = [];

  let matcher: RegExp;

  if (useRegex) {
    try {
      matcher = new RegExp(
        pattern,
        "i",
      );
    } catch {
      throw new Error(
        "Invalid regular expression.",
      );
    }
  } else {
    matcher = new RegExp(
      pattern.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      ),
      "i",
    );
  }

  async function walk(
    current: string,
  ): Promise<void> {
    if (results.length >= maxResults) {
      return;
    }

    let entries;

    try {
      entries = await fs.readdir(
        current,
        {
          withFileTypes: true,
        },
      );
    } catch {
      return;
    }

    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        IGNORED_DIRECTORIES.has(entry.name)
      ) {
        continue;
      }

      const absolute = path.join(
        current,
        entry.name,
      );

      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }

      const extension = path.extname(
        entry.name,
      ).toLowerCase();

      const ignoredExtensions = new Set([
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".ico",
        ".pdf",
        ".zip",
        ".tar",
        ".gz",
        ".lockb",
      ]);

      if (ignoredExtensions.has(extension)) {
        continue;
      }

      let stats;

      try {
        stats = await fs.stat(absolute);
      } catch {
        continue;
      }

      if (stats.size > MAX_FILE_SIZE) {
        continue;
      }

      let content;

      try {
        content = await fs.readFile(
          absolute,
          "utf8",
        );
      } catch {
        continue;
      }

      const lines = content.split(/\r?\n/);

      for (
        let index = 0;
        index < lines.length;
        index += 1
      ) {
        if (matcher.test(lines[index])) {
          results.push({
            path: displayPath(absolute),
            line: index + 1,
            text: truncate(
              lines[index],
              500,
            ),
          });

          if (results.length >= maxResults) {
            return;
          }
        }
      }
    }
  }

  await walk(root);

  return {
    pattern,
    count: results.length,
    results,
  };
}

/* -------------------------------------------------------------------------- */
/* Terminal                                                                   */
/* -------------------------------------------------------------------------- */

async function executeCommandTool(
  args: Record<string, unknown>,
): Promise<unknown> {
  const command = asString(args.command);

  const timeoutMs = Math.min(
    120_000,
    Math.max(
      1_000,
      Math.floor(
        asNumber(
          args.timeoutMs,
          DEFAULT_TIMEOUT,
        ),
      ),
    ),
  );

  const result = await runShell(
    command,
    timeoutMs,
  );

  return {
    command,
    exitCode: result.exitCode,
    success: result.exitCode === 0,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/* -------------------------------------------------------------------------- */
/* Git                                                                        */
/* -------------------------------------------------------------------------- */

async function gitStatusTool(): Promise<unknown> {
  return runShell(
    "git status --short --branch",
  );
}

async function gitDiffTool(
  args: Record<string, unknown>,
): Promise<unknown> {
  const staged = asBoolean(
    args.staged,
    false,
  );

  const command = staged
    ? "git diff --cached --no-ext-diff"
    : "git diff --no-ext-diff";

  return runShell(command);
}

async function gitLogTool(
  args: Record<string, unknown>,
): Promise<unknown> {
  const limit = Math.min(
    50,
    Math.max(
      1,
      Math.floor(
        asNumber(args.limit, 10),
      ),
    ),
  );

  return runShell(
    `git log -${limit} --oneline --decorate`,
  );
}

async function gitBranchTool(
  args: Record<string, unknown>,
): Promise<unknown> {
  const action = asString(
    args.action,
    "list",
  );

  if (action === "list") {
    return runShell(
      "git branch --all --verbose --no-abbrev",
    );
  }

  if (action === "create") {
    const name = asString(args.name);

    validateNonEmpty(
      name,
      "Branch name",
    );

    if (
      !/^[A-Za-z0-9._/-]+$/.test(name) ||
      name.startsWith("-") ||
      name.includes("..")
    ) {
      throw new Error(
        "Invalid branch name.",
      );
    }

    return runShell(
      `git switch -c ${shellQuote(name)}`,
    );
  }

  throw new Error(
    "git_branch action must be list or create.",
  );
}

async function gitCommitTool(
  args: Record<string, unknown>,
): Promise<unknown> {
  const message = asString(
    args.message,
  );

  validateNonEmpty(
    message,
    "Commit message",
  );

  if (message.length > 200) {
    throw new Error(
      "Commit message is too long.",
    );
  }

  return runShell(
    `git commit -m ${shellQuote(message)}`,
  );
}

function shellQuote(value: string): string {
  return `'${value.replace(
    /'/g,
    "'\\''",
  )}'`;
}

/* -------------------------------------------------------------------------- */
/* Testing                                                                    */
/* -------------------------------------------------------------------------- */

function detectPackageManager(): string {
  if (
    process.env.AGENT_PACKAGE_MANAGER
  ) {
    return process.env.AGENT_PACKAGE_MANAGER;
  }

  return "npm";
}

async function runPackageScript(
  script: string,
  overrideCommand?: string,
): Promise<unknown> {
  const command =
    overrideCommand?.trim() ||
    `${detectPackageManager()} run ${script}`;

  return runShell(
    command,
    120_000,
  );
}

async function runTestsTool(
  args: Record<string, unknown>,
): Promise<unknown> {
  return runPackageScript(
    "test",
    asString(args.command) || undefined,
  );
}

async function runBuildTool(
  args: Record<string, unknown>,
): Promise<unknown> {
  return runPackageScript(
    "build",
    asString(args.command) || undefined,
  );
}

async function runLintTool(
  args: Record<string, unknown>,
): Promise<unknown> {
  return runPackageScript(
    "lint",
    asString(args.command) || undefined,
  );
}

async function runTypecheckTool(
  args: Record<string, unknown>,
): Promise<unknown> {
  const override = asString(
    args.command,
  );

  if (override) {
    return runShell(
      override,
      120_000,
    );
  }

  const packageManager =
    detectPackageManager();

  return runShell(
    `${packageManager} exec tsc --noEmit`,
    120_000,
  );
}

/* -------------------------------------------------------------------------- */
/* GitHub                                                                     */
/* -------------------------------------------------------------------------- */

function getGitHubToken(): string {
  const token =
    process.env.GITHUB_TOKEN ||
    process.env.GITHUB_PAT;

  if (!token) {
    throw new Error(
      "GitHub token is not configured. Add GITHUB_TOKEN to .env.",
    );
  }

  return token;
}

async function githubRequest(
  endpoint: string,
  options: RequestInit = {},
): Promise<any> {
  const token = getGitHubToken();

  const url =
    `https://api.github.com${endpoint}`;

  return fetchJson(
    url,
    {
      ...options,
      headers: {
        Accept:
          "application/vnd.github+json",
        Authorization:
          `Bearer ${token}`,
        "X-GitHub-Api-Version":
          "2022-11-28",
        "Content-Type":
          "application/json",
        ...(options.headers || {}),
      },
    },
    GITHUB_TIMEOUT,
  );
}

async function searchRepositoriesTool(
  args: Record<string, unknown>,
): Promise<unknown> {
  const query = asString(args.query);

  validateNonEmpty(
    query,
    "Repository query",
  );

  const limit = Math.min(
    20,
    Math.max(
      1,
      Math.floor(
        asNumber(args.limit, 10),
      ),
    ),
  );

  const data =
    await githubRequest(
      `/search/repositories?q=${encodeURIComponent(
        query,
      )}&per_page=${limit}`,
    );

  return {
    totalCount: data.total_count,
    repositories:
      (data.items || []).map(
        (repo: any) => ({
          id: repo.id,
          name: repo.name,
          full_name:
            repo.full_name,
          private:
            repo.private,
          html_url:
            repo.html_url,
          description:
            repo.description,
          default_branch:
            repo.default_branch,
          language:
            repo.language,
          stargazers_count:
            repo.stargazers_count,
          forks_count:
            repo.forks_count,
        }),
      ),
  };
}

async function getRepositoryTool(
  args: Record<string, unknown>,
): Promise<unknown> {
  const owner = asString(args.owner);
  const repo = asString(args.repo);

  validateNonEmpty(owner, "owner");
  validateNonEmpty(repo, "repo");

  return githubRequest(
    `/repos/${encodeURIComponent(
      owner,
    )}/${encodeURIComponent(repo)}`,
  );
}

async function getGitHubFileTool(
  args: Record<string, unknown>,
): Promise<unknown> {
  const owner = asString(args.owner);
  const repo = asString(args.repo);
  const filePath = asString(args.path);
  const ref = asString(args.ref);

  validateNonEmpty(owner, "owner");
  validateNonEmpty(repo, "repo");
  validateNonEmpty(filePath, "path");

  const query = ref
    ? `?ref=${encodeURIComponent(ref)}`
    : "";

  const data =
    await githubRequest(
      `/repos/${encodeURIComponent(
        owner,
      )}/${encodeURIComponent(
        repo,
      )}/contents/${filePath
        .split("/")
        .map(encodeURIComponent)
        .join("/")}${query}`,
    );

  if (
    data.type === "file" &&
    data.content
  ) {
    const decoded =
      Buffer.from(
        data.content.replace(
          /\n/g,
          "",
        ),
        "base64",
      ).toString("utf8");

    return {
      ...data,
      content: truncate(
        decoded,
        MAX_OUTPUT_LENGTH * 2,
      ),
    };
  }

  return data;
}

async function searchIssuesTool(
  args: Record<string, unknown>,
): Promise<unknown> {
  const query = asString(args.query);

  validateNonEmpty(
    query,
    "Issue query",
  );

  const limit = Math.min(
    20,
    Math.max(
      1,
      Math.floor(
        asNumber(args.limit, 10),
      ),
    ),
  );

  const data =
    await githubRequest(
      `/search/issues?q=${encodeURIComponent(
        query,
      )}&per_page=${limit}`,
    );

  return {
    totalCount:
      data.total_count,
    issues:
      (data.items || []).map(
        (issue: any) => ({
          id: issue.id,
          number:
            issue.number,
          title:
            issue.title,
          state:
            issue.state,
          html_url:
            issue.html_url,
          body:
            issue.body,
          user:
            issue.user?.login,
        }),
      ),
  };
}

async function getIssueTool(
  args: Record<string, unknown>,
): Promise<unknown> {
  const owner = asString(args.owner);
  const repo = asString(args.repo);
  const number = Math.floor(
    asNumber(args.number, 0),
  );

  validateNonEmpty(owner, "owner");
  validateNonEmpty(repo, "repo");

  if (number <= 0) {
    throw new Error(
      "Issue number must be positive.",
    );
  }

  return githubRequest(
    `/repos/${encodeURIComponent(
      owner,
    )}/${encodeURIComponent(
      repo,
    )}/issues/${number}`,
  );
}

async function createBranchTool(
  args: Record<string, unknown>,
): Promise<unknown> {
  const owner = asString(args.owner);
  const repo = asString(args.repo);
  const branch = asString(args.branch);
  const fromBranch = asString(
    args.fromBranch,
    "main",
  );

  validateNonEmpty(owner, "owner");
  validateNonEmpty(repo, "repo");
  validateNonEmpty(branch, "branch");

  const source =
    await githubRequest(
      `/repos/${encodeURIComponent(
        owner,
      )}/${encodeURIComponent(
        repo,
      )}/git/ref/heads/${encodeURIComponent(
        fromBranch,
      )}`,
    );

  return githubRequest(
    `/repos/${encodeURIComponent(
      owner,
    )}/${encodeURIComponent(
      repo,
    )}/git/refs`,
    {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha: source.object.sha,
      }),
    },
  );
}

async function createGitHubCommitTool(
  args: Record<string, unknown>,
): Promise<unknown> {
  const owner = asString(args.owner);
  const repo = asString(args.repo);
  const branch = asString(args.branch);
  const message = asString(
    args.message,
  );

  const files = Array.isArray(
    args.files,
  )
    ? args.files
    : [];

  validateNonEmpty(owner, "owner");
  validateNonEmpty(repo, "repo");
  validateNonEmpty(branch, "branch");
  validateNonEmpty(
    message,
    "message",
  );

  if (files.length === 0) {
    throw new Error(
      "At least one file is required.",
    );
  }

  if (files.length > 100) {
    throw new Error(
      "A single agent commit may contain at most 100 files.",
    );
  }

  const ref =
    await githubRequest(
      `/repos/${encodeURIComponent(
        owner,
      )}/${encodeURIComponent(
        repo,
      )}/git/ref/heads/${encodeURIComponent(
        branch,
      )}`,
    );

  const latestCommitSha =
    ref.object.sha;

  const latestCommit =
    await githubRequest(
      `/repos/${encodeURIComponent(
        owner,
      )}/${encodeURIComponent(
        repo,
      )}/git/commits/${latestCommitSha}`,
    );

  const baseTreeSha =
    latestCommit.tree.sha;

  const treeItems =
    files.map((item: any) => {
      const filePath =
        asString(item.path);

      const content =
        asString(item.content);

      validateNonEmpty(
        filePath,
        "Commit file path",
      );

      return {
        path: normalizeRelativePath(
          filePath,
        ),
        mode: "100644",
        type: "blob",
        content,
      };
    });

  const tree =
    await githubRequest(
      `/repos/${encodeURIComponent(
        owner,
      )}/${encodeURIComponent(
        repo,
      )}/git/trees`,
      {
        method: "POST",
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: treeItems,
        }),
      },
    );

  const commit =
    await githubRequest(
      `/repos/${encodeURIComponent(
        owner,
      )}/${encodeURIComponent(
        repo,
      )}/git/commits`,
      {
        method: "POST",
        body: JSON.stringify({
          message,
          tree: tree.sha,
          parents: [
            latestCommitSha,
          ],
        }),
      },
    );

  const updatedRef =
    await githubRequest(
      `/repos/${encodeURIComponent(
        owner,
      )}/${encodeURIComponent(
        repo,
      )}/git/refs/heads/${encodeURIComponent(
        branch,
      )}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          sha: commit.sha,
        }),
      },
    );

  return {
    commitSha:
      commit.sha,
    commitUrl:
      commit.html_url,
    branch:
      updatedRef.ref,
  };
}

async function createPullRequestTool(
  args: Record<string, unknown>,
): Promise<unknown> {
  const owner = asString(args.owner);
  const repo = asString(args.repo);
  const title = asString(args.title);
  const body = asString(args.body);
  const head = asString(args.head);
  const base = asString(
    args.base,
    "main",
  );

  validateNonEmpty(owner, "owner");
  validateNonEmpty(repo, "repo");
  validateNonEmpty(title, "title");
  validateNonEmpty(head, "head");
  validateNonEmpty(base, "base");

  return githubRequest(
    `/repos/${encodeURIComponent(
      owner,
    )}/${encodeURIComponent(
      repo,
    )}/pulls`,
    {
      method: "POST",
      body: JSON.stringify({
        title,
        body,
        head,
        base,
      }),
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Firecrawl research                                                         */
/* -------------------------------------------------------------------------- */

function getFirecrawlKey(): string {
  const key =
    process.env.FIRECRAWL_API_KEY;

  if (!key) {
    throw new Error(
      "Firecrawl API key is not configured. Add FIRECRAWL_API_KEY to .env.",
    );
  }

  return key;
}

async function firecrawlRequest(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<any> {
  const key =
    getFirecrawlKey();

  return fetchJson(
    `https://api.firecrawl.dev/v2${endpoint}`,
    {
      method: "POST",
      headers: {
        Authorization:
          `Bearer ${key}`,
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify(body),
    },
    RESEARCH_TIMEOUT,
  );
}

async function webSearchTool(
  args: Record<string, unknown>,
): Promise<unknown> {
  const query = asString(args.query);

  validateNonEmpty(
    query,
    "Search query",
  );

  const limit = Math.min(
    10,
    Math.max(
      1,
      Math.floor(
        asNumber(args.limit, 5),
      ),
    ),
  );

  const data =
    await firecrawlRequest(
      "/search",
      {
        query,
        limit,
      },
    );

  return {
    query,
    results:
      (data.data || data.results || [])
        .slice(0, limit)
        .map((item: any) => ({
          title:
            item.title ||
            item.metadata?.title ||
            "Untitled",
          url:
            item.url ||
            item.metadata?.url ||
            "",
          description:
            item.description ||
            item.metadata?.description ||
            "",
          source: "firecrawl",
        })),
  };
}

async function webFetchTool(
  args: Record<string, unknown>,
): Promise<unknown> {
  const url = asString(args.url);

  validateNonEmpty(url, "url");

  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      "Invalid URL.",
    );
  }

  if (
    parsed.protocol !== "http:" &&
    parsed.protocol !== "https:"
  ) {
    throw new Error(
      "Only HTTP and HTTPS URLs are allowed.",
    );
  }

  const data =
    await firecrawlRequest(
      "/scrape",
      {
        url,
        formats: [
          "markdown",
        ],
      },
    );

  const result =
    data.data || data;

  return {
    url,
    title:
      result.metadata?.title ||
      result.title ||
      "",
    description:
      result.metadata?.description ||
      "",
    content: truncate(
      result.markdown ||
        result.content ||
        "",
      MAX_OUTPUT_LENGTH * 3,
    ),
    source: "firecrawl",
  };
}

/* -------------------------------------------------------------------------- */
/* Stack Overflow                                                             */
/* -------------------------------------------------------------------------- */

async function stackOverflowSearchTool(
  args: Record<string, unknown>,
): Promise<unknown> {
  const query = asString(args.query);

  validateNonEmpty(
    query,
    "Stack Overflow query",
  );

  const limit = Math.min(
    20,
    Math.max(
      1,
      Math.floor(
        asNumber(args.limit, 5),
      ),
    ),
  );

  const url =
    "https://api.stackexchange.com/2.3/search/advanced" +
    `?order=desc` +
    `&sort=relevance` +
    `&q=${encodeURIComponent(query)}` +
    `&site=stackoverflow` +
    `&pagesize=${limit}` +
    `&filter=default`;

  const data =
    await fetchJson(
      url,
      {},
      RESEARCH_TIMEOUT,
    );

  return {
    query,
    results:
      (data.items || []).map(
        (item: any) => ({
          questionId:
            item.question_id,
          title:
            item.title,
          link:
            item.link,
          isAnswered:
            item.is_answered,
          score:
            item.score,
          answerCount:
            item.answer_count,
          tags:
            item.tags,
        }),
      ),
  };
}

/* -------------------------------------------------------------------------- */
/* npm                                                                        */
/* -------------------------------------------------------------------------- */

async function npmSearchTool(
  args: Record<string, unknown>,
): Promise<unknown> {
  const query = asString(args.query);

  validateNonEmpty(
    query,
    "npm query",
  );

  const limit = Math.min(
    20,
    Math.max(
      1,
      Math.floor(
        asNumber(args.limit, 10),
      ),
    ),
  );

  const url =
    "https://registry.npmjs.org/-/v1/search" +
    `?text=${encodeURIComponent(query)}` +
    `&size=${limit}`;

  const data =
    await fetchJson(
      url,
      {},
      RESEARCH_TIMEOUT,
    );

  return {
    query,
    results:
      (data.objects || []).map(
        (item: any) => ({
          package:
            item.package?.name,
          version:
            item.package?.version,
          description:
            item.package?.description,
          links:
            item.package?.links,
          publisher:
            item.package?.publisher,
          score:
            item.score,
        }),
      ),
  };
}

/* -------------------------------------------------------------------------- */
/* PyPI                                                                       */
/* -------------------------------------------------------------------------- */

async function pypiSearchTool(
  args: Record<string, unknown>,
): Promise<unknown> {
  const query = asString(args.query);

  validateNonEmpty(
    query,
    "PyPI package name",
  );

  const encoded =
    encodeURIComponent(query);

  const data =
    await fetchJson(
      `https://pypi.org/pypi/${encoded}/json`,
      {},
      RESEARCH_TIMEOUT,
    );

  return {
    name:
      data.info?.name,
    version:
      data.info?.version,
    summary:
      data.info?.summary,
    description:
      truncate(
        data.info?.description || "",
        MAX_OUTPUT_LENGTH,
      ),
    homePage:
      data.info?.home_page,
    projectUrl:
      data.info?.project_url,
    requiresPython:
      data.info?.requires_python,
    license:
      data.info?.license,
    keywords:
      data.info?.keywords,
  };
}

/* -------------------------------------------------------------------------- */
/* Tool execution                                                             */
/* -------------------------------------------------------------------------- */

export async function executeTool(
  request: ToolRequest,
): Promise<ToolResult> {
  const startedAt =
    Date.now();

  const name =
    String(request.name) ===
    "list_directory"
      ? "list_files"
      : request.name;

  const args =
    request.arguments || {};

  try {
    let data: unknown;

    switch (name) {
      /* Files */

      case "read_file":
        data =
          await readFileTool(args);
        break;

      case "write_file":
        data =
          await writeFileTool(args);
        break;

      case "list_files":
        data =
          await listFilesTool(args);
        break;

      case "search_files":
        data =
          await searchFilesTool(args);
        break;

      /* Terminal */

      case "execute_command":
        data =
          await executeCommandTool(args);
        break;

      /* Git */

      case "git_status":
        data =
          await gitStatusTool();
        break;

      case "git_diff":
        data =
          await gitDiffTool(args);
        break;

      case "git_log":
        data =
          await gitLogTool(args);
        break;

      case "git_branch":
        data =
          await gitBranchTool(args);
        break;

      case "git_commit":
        data =
          await gitCommitTool(args);
        break;

      /* Testing */

      case "run_tests":
        data =
          await runTestsTool(args);
        break;

      case "run_build":
        data =
          await runBuildTool(args);
        break;

      case "run_lint":
        data =
          await runLintTool(args);
        break;

      case "run_typecheck":
        data =
          await runTypecheckTool(args);
        break;

      /* GitHub */

      case "search_repositories":
        data =
          await searchRepositoriesTool(
            args,
          );
        break;

      case "get_repository":
        data =
          await getRepositoryTool(
            args,
          );
        break;

      case "get_file":
        data =
          await getGitHubFileTool(
            args,
          );
        break;

      case "search_issues":
        data =
          await searchIssuesTool(args);
        break;

      case "get_issue":
        data =
          await getIssueTool(args);
        break;

      case "create_branch":
        data =
          await createBranchTool(args);
        break;

      case "create_commit":
        data =
          await createGitHubCommitTool(
            args,
          );
        break;

      case "create_pull_request":
        data =
          await createPullRequestTool(
            args,
          );
        break;

      /* Research */

      case "web_search":
        data =
          await webSearchTool(args);
        break;

      case "web_fetch":
        data =
          await webFetchTool(args);
        break;

      case "stackoverflow_search":
        data =
          await stackOverflowSearchTool(
            args,
          );
        break;

      case "npm_search":
        data =
          await npmSearchTool(args);
        break;

      case "pypi_search":
        data =
          await pypiSearchTool(args);
        break;

      default: {
        const exhaustiveCheck: never =
          name;

        throw new Error(
          `Unknown tool: ${String(
            exhaustiveCheck,
          )}`,
        );
      }
    }

    return {
      ok: true,
      tool: name,
      data,
      durationMs:
        Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      tool: name,
      error:
        error instanceof Error
          ? error.message
          : String(error),
      durationMs:
        Date.now() - startedAt,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Public helpers                                                             */
/* -------------------------------------------------------------------------- */

export function getToolDefinitions(): ToolDefinition[] {
  return TOOL_DEFINITIONS.map(
    (tool) => ({
      ...tool,
      inputSchema: {
        ...tool.inputSchema,
      },
    }),
  );
}

export function getToolDefinition(
  name: ToolName,
): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find(
    (tool) =>
      tool.name === name,
  );
}

export function isToolName(
  value: unknown,
): value is ToolName {
  return (
    typeof value === "string" &&
    TOOL_DEFINITIONS.some(
      (tool) =>
        tool.name === value,
    )
  );
}

export function getToolsByCategory(
  category: ToolDefinition["category"],
): ToolDefinition[] {
  return TOOL_DEFINITIONS.filter(
    (tool) =>
      tool.category === category,
  );
}

export function getWorkspaceRoot(): string {
  return WORKSPACE_ROOT;
}

/* -------------------------------------------------------------------------- */
/* Agent-friendly execution wrapper                                          */
/* -------------------------------------------------------------------------- */

export async function runTool(
  name: ToolName,
  arguments_: Record<string, unknown> = {},
): Promise<ToolResult> {
  return executeTool({
    name,
    arguments: arguments_,
  });
}
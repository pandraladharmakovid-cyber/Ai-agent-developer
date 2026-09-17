/**
 * AI Developer Agent — Level 2
 * Secure Sandbox
 *
 * Responsibilities:
 * - Execute agent commands inside an isolated workspace.
 * - Enforce workspace boundaries.
 * - Enforce command and resource limits.
 * - Prevent dangerous host-level commands.
 * - Capture stdout/stderr/exit codes.
 * - Support timeouts and cancellation.
 *
 * Secrets are never hardcoded.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

const WORKSPACE_ROOT = path.resolve(
  process.env.AGENT_WORKSPACE || process.cwd(),
);

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

const MAX_CONCURRENT_PROCESSES = 3;

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export interface SandboxOptions {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface SandboxResult {
  ok: boolean;
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface SandboxStatus {
  workspace: string;
  activeProcesses: number;
  maxConcurrentProcesses: number;
  available: boolean;
}

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

let activeProcesses = 0;

/* -------------------------------------------------------------------------- */
/* Workspace security                                                          */
/* -------------------------------------------------------------------------- */

function normalizeRelativePath(input: string): string {
  return input
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();
}

export function resolveSandboxPath(input = "."): string {
  const relative = normalizeRelativePath(input);

  const resolved = path.resolve(
    WORKSPACE_ROOT,
    relative || ".",
  );

  if (
    resolved !== WORKSPACE_ROOT &&
    !resolved.startsWith(`${WORKSPACE_ROOT}${path.sep}`)
  ) {
    throw new Error(
      "Sandbox path escapes the agent workspace.",
    );
  }

  return resolved;
}

function displayPath(input: string): string {
  const relative = path.relative(
    WORKSPACE_ROOT,
    input,
  );

  return relative.replace(/\\/g, "/") || ".";
}

/* -------------------------------------------------------------------------- */
/* Command security                                                            */
/* -------------------------------------------------------------------------- */

const BLOCKED_COMMANDS: RegExp[] = [
  // Destructive filesystem operations.
  /rm\s+-rf\s+\/(?:\s|$)/i,
  /rm\s+-rf\s+\/\*/i,
  /rm\s+-fr\s+\/(?:\s|$)/i,
  /mkfs(?:\.[a-z0-9]+)?\s+/i,

  // Device destruction.
  />\s*\/dev\/sd[a-z]/i,
  /dd\s+if=.*of=\/dev\//i,

  // Fork bombs.
  /:\(\)\s*\{\s*:\|:\s*&\s*\};:/,
  /fork\s*bomb/i,

  // Host shutdown/reboot.
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bpoweroff\b/i,
  /\bhalt\b/i,
  /\binit\s+[06]\b/i,

  // Shell-pipe download execution.
  /curl[^|;&\n]*\|\s*(?:bash|sh|zsh)\b/i,
  /wget[^|;&\n]*\|\s*(?:bash|sh|zsh)\b/i,

  // Obvious privilege escalation.
  /\bsudo\s+/i,
  /\bsu\s+-\s*$/i,

  // Attempts to escape into common host locations.
  /\bchmod\s+777\s+\//i,
  /\bchown\s+.*\s+\//i,
];

function assertCommandSafe(command: string): void {
  const cleaned = command.trim();

  if (!cleaned) {
    throw new Error("Command cannot be empty.");
  }

  if (cleaned.length > 20_000) {
    throw new Error(
      "Command is too long. Maximum length is 20,000 characters.",
    );
  }

  for (const pattern of BLOCKED_COMMANDS) {
    if (pattern.test(cleaned)) {
      throw new Error(
        "Command rejected by sandbox security policy.",
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Output handling                                                             */
/* -------------------------------------------------------------------------- */

function truncateOutput(
  value: string,
  maxBytes = MAX_OUTPUT_BYTES,
): string {
  const buffer = Buffer.from(value || "", "utf8");

  if (buffer.byteLength <= maxBytes) {
    return value || "";
  }

  return `${buffer
    .subarray(0, maxBytes)
    .toString("utf8")}\n...[output truncated by sandbox]`;
}

/* -------------------------------------------------------------------------- */
/* Environment                                                                 */
/* -------------------------------------------------------------------------- */

function buildEnvironment(
  extra?: Record<string, string>,
): NodeJS.ProcessEnv {
  /*
   * Start with the current environment because tools such as
   * npm, node, git and Python may need PATH and other system values.
   *
   * Explicitly remove common secret-bearing variables from the
   * environment passed to agent commands.
   */
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...extra,
    PWD: WORKSPACE_ROOT,
  };

  delete env.GITHUB_TOKEN;
  delete env.GITHUB_PAT;
  delete env.FIRECRAWL_API_KEY;
  delete env.GEMINI_API_KEY;
  delete env.GROQ_API_KEY;
  delete env.OPENROUTER_API_KEY;
  delete env.DATABASE_URL;
  delete env.AIVEN_DATABASE_URL;
  delete env.PGPASSWORD;

  return env;
}

/* -------------------------------------------------------------------------- */
/* Process execution                                                           */
/* -------------------------------------------------------------------------- */

export async function executeSandbox(
  options: SandboxOptions,
): Promise<SandboxResult> {
  const startedAt = Date.now();

  const command = options.command.trim();

  assertCommandSafe(command);

  if (activeProcesses >= MAX_CONCURRENT_PROCESSES) {
    throw new Error(
      `Sandbox concurrency limit reached. Maximum ${MAX_CONCURRENT_PROCESSES} active processes.`,
    );
  }

  const cwd = resolveSandboxPath(
    options.cwd || ".",
  );

  const stats = await fs.stat(cwd).catch(() => null);

  if (!stats?.isDirectory()) {
    throw new Error(
      `Sandbox working directory does not exist: ${displayPath(cwd)}`,
    );
  }

  const timeoutMs = Math.min(
    MAX_TIMEOUT_MS,
    Math.max(
      1_000,
      Math.floor(
        Number.isFinite(options.timeoutMs)
          ? Number(options.timeoutMs)
          : DEFAULT_TIMEOUT_MS,
      ),
    ),
  );

  activeProcesses += 1;

  let timedOut = false;

  try {
    const result = await execFileAsync(
      "/bin/bash",
      ["-lc", command],
      {
        cwd,
        env: buildEnvironment(options.env),
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
      },
    );

    return {
      ok: true,
      command,
      cwd: displayPath(cwd),
      exitCode: 0,
      signal: null,
      stdout: truncateOutput(result.stdout || ""),
      stderr: truncateOutput(result.stderr || ""),
      timedOut,
      durationMs: Date.now() - startedAt,
    };
  } catch (error: any) {
    timedOut =
      error?.code === "ETIMEDOUT" ||
      error?.killed === true;

    const exitCode =
      typeof error?.code === "number"
        ? error.code
        : null;

    const signal =
      typeof error?.signal === "string"
        ? error.signal
        : null;

    return {
      ok: false,
      command,
      cwd: displayPath(cwd),
      exitCode,
      signal,
      stdout: truncateOutput(
        String(error?.stdout || ""),
      ),
      stderr: truncateOutput(
        String(
          error?.stderr ||
            error?.message ||
            "Sandbox command failed.",
        ),
      ),
      timedOut,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    activeProcesses -= 1;
  }
}

/* -------------------------------------------------------------------------- */
/* File helpers                                                                */
/* -------------------------------------------------------------------------- */

export async function sandboxFileExists(
  relativePath: string,
): Promise<boolean> {
  const filePath = resolveSandboxPath(relativePath);

  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureSandboxDirectory(
  relativePath = ".",
): Promise<string> {
  const directory = resolveSandboxPath(
    relativePath,
  );

  await fs.mkdir(directory, {
    recursive: true,
  });

  return directory;
}

export async function getSandboxWorkspace(): Promise<{
  path: string;
  exists: boolean;
}> {
  try {
    const stats = await fs.stat(
      WORKSPACE_ROOT,
    );

    return {
      path: WORKSPACE_ROOT,
      exists: stats.isDirectory(),
    };
  } catch {
    return {
      path: WORKSPACE_ROOT,
      exists: false,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

export function getSandboxStatus(): SandboxStatus {
  return {
    workspace: WORKSPACE_ROOT,
    activeProcesses,
    maxConcurrentProcesses:
      MAX_CONCURRENT_PROCESSES,
    available:
      activeProcesses <
      MAX_CONCURRENT_PROCESSES,
  };
}

/* -------------------------------------------------------------------------- */
/* Convenience API                                                             */
/* -------------------------------------------------------------------------- */

export async function runInSandbox(
  command: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<SandboxResult> {
  return executeSandbox({
    command,
    timeoutMs,
  });
}

export async function sandboxHealthCheck(): Promise<{
  ok: boolean;
  node: string;
  workspace: string;
}> {
  const result = await executeSandbox({
    command: "node --version",
    timeoutMs: 10_000,
  });

  return {
    ok: result.ok,
    node:
      result.stdout.trim() ||
      result.stderr.trim() ||
      "unknown",
    workspace: WORKSPACE_ROOT,
  };
}
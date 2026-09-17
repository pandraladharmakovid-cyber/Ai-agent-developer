/**
 * AI Developer Agent — Level 2
 * Security Policy Engine
 *
 * Responsibilities:
 * - Decide whether an agent tool action is allowed.
 * - Enforce least-privilege rules.
 * - Protect secrets.
 * - Restrict filesystem access to the workspace.
 * - Require approval for high-impact operations.
 * - Validate commands before execution.
 */

import path from "node:path";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type PolicyDecision =
  | "allow"
  | "deny"
  | "approval_required";

export type PolicyRisk =
  | "low"
  | "medium"
  | "high"
  | "critical";

export interface PolicyRequest {
  tool: string;
  arguments?: Record<string, unknown>;
}

export interface PolicyResult {
  decision: PolicyDecision;
  risk: PolicyRisk;
  reason: string;
  requiresApproval: boolean;
}

export interface PolicyAuditEntry {
  timestamp: string;
  tool: string;
  decision: PolicyDecision;
  risk: PolicyRisk;
  reason: string;
}

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

const WORKSPACE_ROOT = path.resolve(
  process.env.AGENT_WORKSPACE || process.cwd(),
);

const MAX_COMMAND_LENGTH = 20_000;
const MAX_PATH_LENGTH = 1_000;
const MAX_WRITE_SIZE = 2_000_000;

/*
 * Tools that can modify the project or external services.
 *
 * These are not automatically denied. They are classified as
 * higher-risk operations so the agent orchestration layer can
 * apply approval requirements.
 */
const HIGH_RISK_TOOLS = new Set([
  "write_file",
  "execute_command",
  "git_commit",
  "create_branch",
  "create_commit",
  "create_pull_request",
]);

/*
 * Operations that can change external GitHub state.
 */
const EXTERNAL_WRITE_TOOLS = new Set([
  "create_branch",
  "create_commit",
  "create_pull_request",
]);

/*
 * Operations that only inspect information.
 */
const READ_ONLY_TOOLS = new Set([
  "read_file",
  "list_files",
  "search_files",
  "git_status",
  "git_diff",
  "git_log",
  "search_repositories",
  "get_repository",
  "get_file",
  "search_issues",
  "get_issue",
  "web_search",
  "web_fetch",
  "stackoverflow_search",
  "npm_search",
  "pypi_search",
]);

/* -------------------------------------------------------------------------- */
/* Dangerous commands                                                          */
/* -------------------------------------------------------------------------- */

const BLOCKED_COMMANDS: RegExp[] = [
  /rm\s+-rf\s+\/(?:\s|$)/i,
  /rm\s+-rf\s+\/\*/i,
  /rm\s+-fr\s+\/(?:\s|$)/i,
  /mkfs(?:\.[a-z0-9]+)?\s+/i,
  /dd\s+if=.*of=\/dev\//i,
  />\s*\/dev\/sd[a-z]/i,

  /:\(\)\s*\{\s*:\|:\s*&\s*\};:/,
  /fork\s*bomb/i,

  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bpoweroff\b/i,
  /\bhalt\b/i,

  /\bsudo\s+/i,
  /\bsu\s+-\s*$/i,

  /curl[^|;&\n]*\|\s*(?:bash|sh|zsh)\b/i,
  /wget[^|;&\n]*\|\s*(?:bash|sh|zsh)\b/i,
];

/* -------------------------------------------------------------------------- */
/* Secret detection                                                            */
/* -------------------------------------------------------------------------- */

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{20,}/i,
  /gh[pousr]_[A-Za-z0-9_]{20,}/i,
  /github_pat_[A-Za-z0-9_]{20,}/i,
  /AIza[A-Za-z0-9_-]{20,}/i,
  /gsk_[A-Za-z0-9_-]{20,}/i,

  /(?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*["']?[A-Za-z0-9_\-./+=]{12,}/i,
];

const SECRET_ENV_NAMES = new Set([
  "GITHUB_TOKEN",
  "GITHUB_PAT",
  "FIRECRAWL_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "DATABASE_URL",
  "AIVEN_DATABASE_URL",
  "PGPASSWORD",
]);

/* -------------------------------------------------------------------------- */
/* Generic validation                                                          */
/* -------------------------------------------------------------------------- */

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function getString(
  value: unknown,
): string {
  return typeof value === "string"
    ? value
    : "";
}

function containsSecret(
  value: unknown,
): boolean {
  if (typeof value === "string") {
    return SECRET_PATTERNS.some(
      (pattern) => pattern.test(value),
    );
  }

  if (Array.isArray(value)) {
    return value.some(containsSecret);
  }

  if (isPlainObject(value)) {
    return Object.entries(value).some(
      ([key, child]) => {
        if (SECRET_ENV_NAMES.has(key)) {
          return true;
        }

        return containsSecret(child);
      },
    );
  }

  return false;
}

/* -------------------------------------------------------------------------- */
/* Path validation                                                             */
/* -------------------------------------------------------------------------- */

export function isWorkspacePath(
  input: string,
): boolean {
  if (!input || input.length > MAX_PATH_LENGTH) {
    return false;
  }

  const normalized = input
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();

  if (!normalized) {
    return true;
  }

  const resolved = path.resolve(
    WORKSPACE_ROOT,
    normalized,
  );

  return (
    resolved === WORKSPACE_ROOT ||
    resolved.startsWith(
      `${WORKSPACE_ROOT}${path.sep}`,
    )
  );
}

function validatePathArgument(
  args: Record<string, unknown>,
  field = "path",
): string | null {
  const value = getString(args[field]);

  if (!value) {
    return null;
  }

  if (!isWorkspacePath(value)) {
    return `Path "${field}" escapes the agent workspace.`;
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Command validation                                                          */
/* -------------------------------------------------------------------------- */

export function isCommandSafe(
  command: string,
): boolean {
  const cleaned = command.trim();

  if (!cleaned) {
    return false;
  }

  if (cleaned.length > MAX_COMMAND_LENGTH) {
    return false;
  }

  return !BLOCKED_COMMANDS.some(
    (pattern) => pattern.test(cleaned),
  );
}

/* -------------------------------------------------------------------------- */
/* Tool-specific policy                                                        */
/* -------------------------------------------------------------------------- */

function evaluateTool(
  request: PolicyRequest,
): PolicyResult {
  const tool = request.tool;
  const args = request.arguments || {};

  if (!tool || typeof tool !== "string") {
    return {
      decision: "deny",
      risk: "critical",
      reason: "Tool name is missing.",
      requiresApproval: false,
    };
  }

  /*
   * Unknown tools are denied by default.
   */
  const knownTools = new Set([
    "read_file",
    "write_file",
    "list_files",
    "search_files",
    "execute_command",

    "git_status",
    "git_diff",
    "git_log",
    "git_branch",
    "git_commit",

    "run_tests",
    "run_build",
    "run_lint",
    "run_typecheck",

    "search_repositories",
    "get_repository",
    "get_file",
    "search_issues",
    "get_issue",
    "create_branch",
    "create_commit",
    "create_pull_request",

    "web_search",
    "web_fetch",
    "stackoverflow_search",
    "npm_search",
    "pypi_search",
  ]);

  if (!knownTools.has(tool)) {
    return {
      decision: "deny",
      risk: "critical",
      reason: `Unknown tool "${tool}".`,
      requiresApproval: false,
    };
  }

  /*
   * Never allow secrets to be passed as tool arguments.
   */
  if (containsSecret(args)) {
    return {
      decision: "deny",
      risk: "critical",
      reason:
        "Tool arguments appear to contain a secret or credential.",
      requiresApproval: false,
    };
  }

  /*
   * Filesystem paths must remain inside the workspace.
   */
  const pathFields = [
    "path",
    "cwd",
    "filePath",
  ];

  for (const field of pathFields) {
    const error = validatePathArgument(
      args,
      field,
    );

    if (error) {
      return {
        decision: "deny",
        risk: "critical",
        reason: error,
        requiresApproval: false,
      };
    }
  }

  /*
   * Read-only operations are automatically allowed.
   */
  if (READ_ONLY_TOOLS.has(tool)) {
    return {
      decision: "allow",
      risk: "low",
      reason: "Read-only operation.",
      requiresApproval: false,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* File writes                                                            */
  /* ---------------------------------------------------------------------- */

  if (tool === "write_file") {
    const content = getString(args.content);

    if (Buffer.byteLength(content, "utf8") > MAX_WRITE_SIZE) {
      return {
        decision: "deny",
        risk: "high",
        reason:
          "File content exceeds the maximum write size.",
        requiresApproval: false,
      };
    }

    return {
      decision: "allow",
      risk: "medium",
      reason:
        "Workspace file modification is allowed.",
      requiresApproval: false,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Terminal                                                               */
  /* ---------------------------------------------------------------------- */

  if (tool === "execute_command") {
    const command = getString(args.command);

    if (!isCommandSafe(command)) {
      return {
        decision: "deny",
        risk: "critical",
        reason:
          "Command rejected by security policy.",
        requiresApproval: false,
      };
    }

    return {
      decision: "allow",
      risk: "medium",
      reason:
        "Development command allowed inside sandbox.",
      requiresApproval: false,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Tests / builds                                                          */
  /* ---------------------------------------------------------------------- */

  if (
    tool === "run_tests" ||
    tool === "run_build" ||
    tool === "run_lint" ||
    tool === "run_typecheck"
  ) {
    const command = getString(args.command);

    if (command && !isCommandSafe(command)) {
      return {
        decision: "deny",
        risk: "critical",
        reason:
          "Custom testing command rejected by security policy.",
        requiresApproval: false,
      };
    }

    return {
      decision: "allow",
      risk: "medium",
      reason:
        "Development verification command allowed.",
      requiresApproval: false,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Local Git                                                               */
  /* ---------------------------------------------------------------------- */

  if (tool === "git_branch") {
    const action = getString(
      args.action,
    );

    if (
      action !== "list" &&
      action !== "create"
    ) {
      return {
        decision: "deny",
        risk: "high",
        reason:
          "Invalid Git branch action.",
        requiresApproval: false,
      };
    }

    if (action === "list") {
      return {
        decision: "allow",
        risk: "low",
        reason:
          "Git branch inspection is read-only.",
        requiresApproval: false,
      };
    }

    return {
      decision: "allow",
      risk: "medium",
      reason:
        "Creating a local branch is allowed.",
      requiresApproval: false,
    };
  }

  if (tool === "git_commit") {
    const message = getString(
      args.message,
    );

    if (!message.trim()) {
      return {
        decision: "deny",
        risk: "high",
        reason:
          "Commit message cannot be empty.",
        requiresApproval: false,
      };
    }

    if (message.length > 200) {
      return {
        decision: "deny",
        risk: "high",
        reason:
          "Commit message is too long.",
        requiresApproval: false,
      };
    }

    return {
      decision: "allow",
      risk: "high",
      reason:
        "Local Git commit modifies repository history.",
      requiresApproval: false,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* External GitHub writes                                                  */
  /* ---------------------------------------------------------------------- */

  if (EXTERNAL_WRITE_TOOLS.has(tool)) {
    return {
      decision: "approval_required",
      risk: "high",
      reason:
        "This operation changes an external GitHub repository.",
      requiresApproval: true,
    };
  }

  /*
   * High-risk tools not matched above.
   */
  if (HIGH_RISK_TOOLS.has(tool)) {
    return {
      decision: "allow",
      risk: "high",
      reason:
        "High-impact development operation.",
      requiresApproval: false,
    };
  }

  /*
   * Fail closed.
   */
  return {
    decision: "deny",
    risk: "critical",
    reason:
      "No security policy exists for this operation.",
    requiresApproval: false,
  };
}

/* -------------------------------------------------------------------------- */
/* Public policy API                                                           */
/* -------------------------------------------------------------------------- */

export function evaluatePolicy(
  request: PolicyRequest,
): PolicyResult {
  return evaluateTool(request);
}

export function assertPolicy(
  request: PolicyRequest,
): PolicyResult {
  const result = evaluatePolicy(request);

  if (result.decision === "deny") {
    throw new Error(
      `Policy denied ${request.tool}: ${result.reason}`,
    );
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Audit                                                                      */
/* -------------------------------------------------------------------------- */

const auditLog: PolicyAuditEntry[] = [];

const MAX_AUDIT_ENTRIES = 500;

export function recordPolicyDecision(
  request: PolicyRequest,
  result: PolicyResult,
): PolicyAuditEntry {
  const entry: PolicyAuditEntry = {
    timestamp:
      new Date().toISOString(),
    tool: request.tool,
    decision: result.decision,
    risk: result.risk,
    reason: result.reason,
  };

  auditLog.push(entry);

  if (
    auditLog.length >
    MAX_AUDIT_ENTRIES
  ) {
    auditLog.splice(
      0,
      auditLog.length - MAX_AUDIT_ENTRIES,
    );
  }

  return entry;
}

export function getPolicyAuditLog(): PolicyAuditEntry[] {
  return auditLog.map(
    (entry) => ({ ...entry }),
  );
}

export function clearPolicyAuditLog(): void {
  auditLog.length = 0;
}

/* -------------------------------------------------------------------------- */
/* Policy information                                                          */
/* -------------------------------------------------------------------------- */

export function getPolicyInfo(): {
  workspace: string;
  protectedSecrets: string[];
  readOnlyTools: string[];
  externalWriteTools: string[];
} {
  return {
    workspace: WORKSPACE_ROOT,
    protectedSecrets: Array.from(
      SECRET_ENV_NAMES,
    ),
    readOnlyTools: Array.from(
      READ_ONLY_TOOLS,
    ),
    externalWriteTools: Array.from(
      EXTERNAL_WRITE_TOOLS,
    ),
  };
}
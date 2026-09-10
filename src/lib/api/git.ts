/** API domain: git */

import {
  invoke,
} from "./host";

/** One linked git worktree from `git worktree list --porcelain`. */
export interface GitWorktreeEntry {
  path: string;
  head?: string | null;
  branch?: string | null;
  detached: boolean;
  isMain: boolean;
  locked: boolean;
  prunable: boolean;
}

export interface GitWorktreesResult {
  available: boolean;
  worktrees: GitWorktreeEntry[];
  reason?: string | null;
  /** Absolute `~/.grok` for CLI-aligned worktree placement / badge detection. */
  cliGrokHome?: string | null;
}

/** List worktrees for a project folder. Soft-fails when git/repo missing. */
export async function gitWorktreesList(projectPath: string) {
  return invoke<GitWorktreesResult>("git_worktrees_list", { projectPath });
}

export type {
  GitBranchEntry,
  GitBranchesResult,
  GitSwitchBranchResult,
  GitSwitchKind,
} from "../gitBranches";

/** List local + remote-only branches. Soft-fails when git/repo missing. */
export async function gitBranchesList(projectPath: string) {
  return invoke<import("../gitBranches").GitBranchesResult>("git_branches_list", {
    projectPath,
  });
}

/**
 * In-place `git switch` in the project worktree.
 * `startPoint` set → create a local tracking branch from that remote ref.
 */
export async function gitSwitchBranch(
  projectPath: string,
  branch: string,
  startPoint?: string | null,
) {
  return invoke<import("../gitBranches").GitSwitchBranchResult>(
    "git_switch_branch",
    {
      projectPath,
      branch,
      startPoint: startPoint?.trim() || null,
    },
  );
}

// ── GitHub PR hub (`gh pr list|view|checks`) ────────────────────────────────

export type {
  GitPrHubEntry,
  GitPrHubListResult,
  GitPrHubViewResult,
  GitPrCheckEntry,
  GitPrChecksResult,
  GitPrCommentEntry,
  GitPrCommentsResult,
  PrChecksSummary,
  PrChecksOverall,
} from "../gitPrHub";

/** List PRs for a project folder via `gh pr list --json`. Soft-fails when gh/git missing. */
export async function gitPrList(
  projectPath: string,
  opts?: { limit?: number | null; state?: string | null },
) {
  return invoke<import("../gitPrHub").GitPrHubListResult>("git_pr_list", {
    projectPath,
    limit: opts?.limit ?? null,
    state: opts?.state?.trim() || null,
  });
}

/** View one PR via `gh pr view <n> --json`. Soft-fails when gh/git missing. */
export async function gitPrView(projectPath: string, number: number) {
  return invoke<import("../gitPrHub").GitPrHubViewResult>("git_pr_view", {
    projectPath,
    number,
  });
}

/** List CI checks for a PR via `gh pr checks <n> --json`. Soft-fails when gh/git missing. */
export async function gitPrChecks(projectPath: string, number: number) {
  return invoke<import("../gitPrHub").GitPrChecksResult>("git_pr_checks", {
    projectPath,
    number,
  });
}

/**
 * Recent conversation comments + reviews for a PR via
 * `gh pr view <n> --json comments,reviews,url,number`. Soft-fails when gh/git missing.
 */
export async function gitPrComments(projectPath: string, number: number) {
  return invoke<import("../gitPrHub").GitPrCommentsResult>("git_pr_comments", {
    projectPath,
    number,
  });
}

/** One CLI-tracked worktree from `grok worktree list` (JSON or text). */
export interface CliWorktreeEntry {
  id: string;
  name: string;
  path: string;
  branch?: string | null;
  status?: string | null;
  kind?: string | null;
  repoName?: string | null;
  sourceRepo?: string | null;
  /** True when path exists as a directory (safe to open as cwd). */
  pathOk?: boolean;
  head?: string | null;
}

export interface CliWorktreesResult {
  available: boolean;
  worktrees: CliWorktreeEntry[];
  reason?: string | null;
  cliFound: boolean;
  /** `json` | `text` | `none` */
  source?: string | null;
}

/**
 * List Grok Build CLI-tracked worktrees (`grok worktree list --json`).
 * Soft-fails when CLI is missing or the command is unsupported.
 */
export async function cliWorktreesList(opts?: {
  all?: boolean | null;
  repo?: string | null;
}) {
  return invoke<CliWorktreesResult>("cli_worktrees_list", {
    all: opts?.all ?? null,
    repo: opts?.repo?.trim() || null,
  });
}

/** Parsed fields from `grok worktree db stats` (text or JSON). */
export interface CliWorktreeDbStats {
  total?: number | null;
  alive?: number | null;
  dead?: number | null;
  dbSize?: string | null;
  dbSizeBytes?: number | null;
}

export interface CliWorktreeDbPathResult {
  available: boolean;
  path?: string | null;
  pathOk?: boolean;
  reason?: string | null;
  cliFound: boolean;
  unsupported?: boolean;
}

export interface CliWorktreeDbStatsResult {
  available: boolean;
  stats?: CliWorktreeDbStats | null;
  summary?: string | null;
  raw?: string | null;
  reason?: string | null;
  cliFound: boolean;
  unsupported?: boolean;
  /** `json` | `text` | `none` */
  source?: string | null;
}

export interface CliWorktreeDbRebuildResult {
  ok: boolean;
  available: boolean;
  message?: string | null;
  discovered?: number | null;
  registered?: number | null;
  alreadyTracked?: number | null;
  reason?: string | null;
  cliFound: boolean;
  unsupported?: boolean;
}

/**
 * CLI worktree DB path (`grok worktree db path`, Grok Build 0.2.117+).
 * Soft-fails when CLI is missing or too old.
 */
export async function cliWorktreeDbPath() {
  return invoke<CliWorktreeDbPathResult>("cli_worktree_db_path");
}

/**
 * CLI worktree DB stats (`grok worktree db stats`, Grok Build 0.2.117+).
 * Soft-fails when CLI is missing or too old.
 */
export async function cliWorktreeDbStats() {
  return invoke<CliWorktreeDbStatsResult>("cli_worktree_db_stats");
}

/**
 * Rebuild CLI worktree DB from a filesystem scan
 * (`grok worktree db rebuild`, Grok Build 0.2.117+). Soft-fails on old CLIs.
 */
export async function cliWorktreeDbRebuild() {
  return invoke<CliWorktreeDbRebuildResult>("cli_worktree_db_rebuild");
}

/** Result of creating a linked worktree (`git worktree add`). */
export interface GitWorktreeAddResult {
  path: string;
  name: string;
  startPoint?: string | null;
  branch?: string | null;
}

/**
 * Create a linked worktree for a project folder.
 *
 * Default layout `cli`: `~/.grok/worktrees/<repo>/<name>` (Grok Build 0.2.x).
 * Optional `sibling`: `<parent>/<main_basename>-<name>`.
 * See docs/llm-wiki/git-worktrees.md.
 * Throws when not a git repo / git missing / path exists / invalid name.
 */
export async function gitWorktreeAdd(
  projectPath: string,
  name: string,
  startPoint?: string | null,
  layout?: "cli" | "sibling" | null,
) {
  return invoke<GitWorktreeAddResult>("git_worktree_add", {
    projectPath,
    name,
    startPoint: startPoint?.trim() || null,
    layout: layout === "sibling" ? "sibling" : "cli",
  });
}

/** Native folder dialog → add project. Returns null if user cancels. */
export type GitWorktreeGcResult = {
  dryRun?: boolean;
  force?: boolean;
  pruned?: number;
  /** Alias used by some UI call sites. */
  prunedCount?: number;
  /** Preview list of prunable worktree paths (when dry-run). */
  prunable?: any;
  stdout?: string;
  stderr?: string;
  output?: string;
};

export async function gitWorktreeGc(
  projectPathOrOpts:
    | string
    | {
        projectPath: string;
        dryRun?: boolean;
        force?: boolean;
        expire?: string | null;
      },
  forceArg?: boolean,
  dryRunArg?: boolean,
): Promise<GitWorktreeGcResult> {
  const opts =
    typeof projectPathOrOpts === "string"
      ? {
          projectPath: projectPathOrOpts,
          force: forceArg ?? false,
          dryRun: dryRunArg ?? false,
          expire: null as string | null,
        }
      : projectPathOrOpts;
  return invoke<GitWorktreeGcResult>("git_worktree_gc", {
    projectPath: opts.projectPath,
    dryRun: opts.dryRun ?? false,
    force: opts.force ?? false,
    expire: opts.expire ?? null,
  });
}

export type GitWorktreeRemoveResult = {
  path: string;
  force: boolean;
};

export async function gitWorktreeRemove(opts: {
  projectPath: string;
  worktreePath: string;
  force?: boolean;
}): Promise<GitWorktreeRemoveResult> {
  return invoke<GitWorktreeRemoveResult>("git_worktree_remove", {
    projectPath: opts.projectPath,
    worktreePath: opts.worktreePath,
    force: opts.force ?? false,
  });
}

/** One row from host `git_worktree_compare` (`git diff --name-status`). */
export type GitWorktreeCompareEntry = {
  status: string;
  path: string;
  oldPath?: string | null;
};

/**
 * Soft-fail compare of two worktree paths / refs.
 * `available: false` with `reason` when same path, missing, not git, etc.
 */
export type GitWorktreeCompareResult = {
  available: boolean;
  entries: GitWorktreeCompareEntry[];
  /** Raw name-status stdout for client re-parse. */
  raw?: string | null;
  reason?: string | null;
  base: string;
  other: string;
  baseRef?: string | null;
  otherRef?: string | null;
  /** True when host truncated entries (cap honesty). */
  truncated?: boolean;
  total?: number;
};

/**
 * Compare two worktree paths via `git diff --name-status <base>...<other>`.
 * Soft-fails when paths missing / not git / different repos.
 * Does not merge or apply.
 */
export async function gitWorktreeCompare(opts: {
  basePath: string;
  otherPath: string;
  baseBranch?: string | null;
  otherBranch?: string | null;
}): Promise<GitWorktreeCompareResult> {
  return invoke<GitWorktreeCompareResult>("git_worktree_compare", {
    basePath: opts.basePath,
    otherPath: opts.otherPath,
    baseBranch: opts.baseBranch?.trim() || null,
    otherBranch: opts.otherBranch?.trim() || null,
  });
}

/** Soft-fail result of `git push -u origin HEAD` (worktree ship flow). */
export type GitPushBranchResult = {
  available: boolean;
  ok: boolean;
  branch?: string | null;
  remote?: string | null;
  stdout?: string | null;
  stderr?: string | null;
  reason?: string | null;
};

/**
 * Push the current HEAD branch to origin for a project path.
 * Soft-fails when git / origin / non-repo are missing (`available: false`).
 */
export async function gitPushBranch(
  projectPath: string,
): Promise<GitPushBranchResult> {
  return invoke<GitPushBranchResult>("git_push_branch", { projectPath });
}

/** Soft-fail result of `gh pr create` (worktree ship flow). */
export type GhPrCreateResult = {
  available: boolean;
  ok: boolean;
  url?: string | null;
  repo?: string | null;
  base?: string | null;
  head?: string | null;
  stdout?: string | null;
  stderr?: string | null;
  reason?: string | null;
};

/**
 * Create a GitHub PR via `gh pr create` (argv only). Soft-fails without `gh`.
 * Never reports success without a PR URL.
 */
export async function ghPrCreate(opts: {
  projectPath: string;
  title: string;
  body?: string | null;
  draft?: boolean;
  base?: string | null;
  head?: string | null;
  repo?: string | null;
}): Promise<GhPrCreateResult> {
  return invoke<GhPrCreateResult>("gh_pr_create", {
    projectPath: opts.projectPath,
    title: opts.title,
    body: opts.body ?? null,
    draft: opts.draft ?? false,
    base: opts.base ?? null,
    head: opts.head ?? null,
    repo: opts.repo ?? null,
  });
}

/** Persist last active chat without full settings_set side-effects. */

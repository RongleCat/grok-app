/**
 * Git branch list / in-place switch helpers.
 * Host runs `git for-each-ref` + `git switch` (argv only). Pure parse/sanitize
 * lives here so UI + tests do not depend on git.
 */

import { normalizeWorktreePath } from "./gitWorktree";

export type GitBranchEntry = {
  /** Local name (`main`) or remote-tracking short name (`origin/feat`). */
  name: string;
  sha?: string | null;
  current: boolean;
  /** True when this row is a remote-only ref (no local branch yet). */
  remote: boolean;
  upstream?: string | null;
  /** Worktree that currently has this branch checked out, if any. */
  worktreePath?: string | null;
};

export type GitBranchesResult = {
  available: boolean;
  branches: GitBranchEntry[];
  current?: string | null;
  reason?: string | null;
  truncated?: boolean;
  total?: number;
};

export type GitSwitchKind =
  | "ok"
  | "dirty"
  | "elsewhere"
  | "agent_busy"
  | "not_found"
  | "invalid"
  | "git_not_available"
  | "not_a_git_repo"
  | "failed";

export type GitSwitchBranchResult = {
  available: boolean;
  ok: boolean;
  branch?: string | null;
  previousBranch?: string | null;
  kind: GitSwitchKind;
  worktreePath?: string | null;
  reason?: string | null;
};

/** Host + UI list cap (after merge). */
export const GIT_BRANCH_LIST_CAP = 200;
/** Rows shown in the composer menu before an overflow hint. */
export const GIT_BRANCH_MENU_CAP = 80;

/**
 * Sanitize a branch / remote-tracking ref for a single git argv element.
 * Allows hierarchical names (`feat/login`) but refuses flags and git-magic.
 */
export function sanitizeGitBranchName(
  raw: string | null | undefined,
): string {
  const name = (raw ?? "").trim();
  if (!name) {
    throw new Error("branch name is required");
  }
  if (name.length > 256) {
    throw new Error("branch name too long");
  }
  if (name.startsWith("-")) {
    throw new Error("branch name must not start with '-'");
  }
  if (/[\0\n\r\t ]/.test(name)) {
    throw new Error("invalid branch name");
  }
  if (
    name.includes("..") ||
    name.includes("@{") ||
    name.includes("\\") ||
    name.includes("~") ||
    name.includes("^") ||
    name.includes(":") ||
    name.includes("?") ||
    name.includes("*") ||
    name.includes("[") ||
    name.endsWith(".") ||
    name.endsWith(".lock") ||
    name.startsWith("/") ||
    name.endsWith("/") ||
    name.includes("//")
  ) {
    throw new Error("invalid branch name");
  }
  return name;
}

/** `origin/feat/x` → `feat/x`. First path segment is the remote. */
export function localNameFromRemoteRef(name: string): string {
  const s = name.trim();
  const i = s.indexOf("/");
  if (i <= 0 || i === s.length - 1) return s;
  return s.slice(i + 1);
}

export function isRemoteHeadRef(name: string): boolean {
  const s = name.trim();
  return s === "HEAD" || /(^|\/)HEAD$/.test(s);
}

/**
 * Parse `git for-each-ref` rows.
 *
 * Local format: `%(HEAD)\\t%(refname:short)\\t%(objectname:short)\\t%(upstream:short)\\t%(worktreepath)`
 * Remote format: `%(refname:short)\\t%(objectname:short)`
 */
export function parseGitBranchForEachRef(
  raw: string,
  kind: "local" | "remote",
): GitBranchEntry[] {
  const text = (raw ?? "").replace(/\r\n/g, "\n");
  if (!text.trim()) return [];
  const out: GitBranchEntry[] = [];
  for (const line of text.split("\n")) {
    if (out.length >= GIT_BRANCH_LIST_CAP) break;
    const t = line.replace(/\r$/, "");
    if (!t.trim()) continue;
    const cols = t.split("\t");
    if (kind === "remote") {
      const name = (cols[0] ?? "").trim();
      if (!name || isRemoteHeadRef(name)) continue;
      try {
        sanitizeGitBranchName(name);
      } catch {
        continue;
      }
      const sha = (cols[1] ?? "").trim() || null;
      out.push({
        name,
        sha,
        current: false,
        remote: true,
        upstream: name,
        worktreePath: null,
      });
      continue;
    }
    // Local: HEAD may be empty, so split keeps a leading empty field.
    const head = (cols[0] ?? "").trim();
    const name = (cols[1] ?? "").trim();
    if (!name) continue;
    try {
      sanitizeGitBranchName(name);
    } catch {
      continue;
    }
    const sha = (cols[2] ?? "").trim() || null;
    const upstream = (cols[3] ?? "").trim() || null;
    const wt = normalizeWorktreePath((cols[4] ?? "").trim()) || null;
    out.push({
      name,
      sha,
      current: head === "*",
      remote: false,
      upstream,
      worktreePath: wt,
    });
  }
  return out;
}

/** Drop remote-only rows whose local name already exists. */
export function mergeGitBranchLists(
  local: GitBranchEntry[],
  remote: GitBranchEntry[],
): GitBranchEntry[] {
  const localNames = new Set(
    local.map((b) => b.name.toLowerCase()).filter(Boolean),
  );
  const extra: GitBranchEntry[] = [];
  for (const row of remote) {
    if (!row.remote) continue;
    if (isRemoteHeadRef(row.name)) continue;
    const localName = localNameFromRemoteRef(row.name);
    if (!localName || localNames.has(localName.toLowerCase())) continue;
    extra.push(row);
    localNames.add(localName.toLowerCase());
    if (local.length + extra.length >= GIT_BRANCH_LIST_CAP) break;
  }
  return [...local, ...extra].slice(0, GIT_BRANCH_LIST_CAP);
}

export function sortGitBranches(branches: GitBranchEntry[]): GitBranchEntry[] {
  return [...branches].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    if (a.remote !== b.remote) return a.remote ? 1 : -1;
    return 0;
  });
}

export function filterGitBranches(
  branches: GitBranchEntry[],
  query: string | null | undefined,
): GitBranchEntry[] {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return branches;
  return branches.filter((b) => {
    if (b.name.toLowerCase().includes(q)) return true;
    if ((b.upstream ?? "").toLowerCase().includes(q)) return true;
    return false;
  });
}

export function capGitBranchesForMenu(branches: GitBranchEntry[]): {
  rows: GitBranchEntry[];
  truncated: boolean;
  total: number;
} {
  const total = branches.length;
  if (total <= GIT_BRANCH_MENU_CAP) {
    return { rows: branches, truncated: false, total };
  }
  return {
    rows: branches.slice(0, GIT_BRANCH_MENU_CAP),
    truncated: true,
    total,
  };
}

/** True when this branch is checked out in a *different* worktree. */
export function branchCheckedOutElsewhere(
  branch: GitBranchEntry,
  activePath: string | null | undefined,
): boolean {
  if (branch.remote || branch.current) return false;
  const wt = normalizeWorktreePath(branch.worktreePath);
  if (!wt) return false;
  const active = normalizeWorktreePath(activePath);
  if (!active) return true;
  return wt.toLowerCase() !== active.toLowerCase();
}

export function classifyGitSwitchError(
  stderr: string | null | undefined,
  stdout?: string | null,
): { kind: GitSwitchKind; worktreePath: string | null } {
  const err = stderr ?? "";
  const out = stdout ?? "";
  const text = `${err}\n${out}`;
  const lower = text.toLowerCase();

  const elseMatch = text.match(
    /already (?:used by worktree at|checked out(?:['\s]+at)?)\s+'?([^\n']+?)'?\s*$/im,
  );
  if (elseMatch || lower.includes("already used by worktree")) {
    const path = elseMatch?.[1]?.trim() || null;
    return {
      kind: "elsewhere",
      worktreePath: path ? normalizeWorktreePath(path) || path : null,
    };
  }
  if (
    lower.includes("would be overwritten by checkout") ||
    lower.includes("please commit your changes or stash") ||
    lower.includes("your local changes to the following files")
  ) {
    return { kind: "dirty", worktreePath: null };
  }
  if (
    lower.includes("invalid reference") ||
    lower.includes("unknown revision") ||
    lower.includes("did not match any file(s) known to git") ||
    lower.includes("not a valid object name")
  ) {
    return { kind: "not_found", worktreePath: null };
  }
  if (
    lower.includes("not a valid branch name") ||
    lower.includes("invalid branch name") ||
    (lower.includes("fatal:") && lower.includes("isn't a valid"))
  ) {
    return { kind: "invalid", worktreePath: null };
  }
  if (
    lower.includes("not a git repository") ||
    lower.includes("not a git repo")
  ) {
    return { kind: "not_a_git_repo", worktreePath: null };
  }
  return { kind: "failed", worktreePath: null };
}

/**
 * Argv for in-place switch (no binary name). Mirrors host `git_switch_branch`.
 * `startPoint` set → `git switch --track <startPoint>` (remote-only row).
 */
export function buildGitSwitchArgs(
  projectPath: string,
  branch: string,
  startPoint?: string | null,
): string[] {
  const project = normalizeWorktreePath(projectPath);
  if (!project) throw new Error("empty path");
  if (project.startsWith("-")) throw new Error("invalid project path");
  const name = sanitizeGitBranchName(branch);
  const start = (startPoint ?? "").trim();
  if (start) {
    const ref = sanitizeGitBranchName(start);
    return ["-C", project, "switch", "--track", ref];
  }
  return ["-C", project, "switch", name];
}

export function gitSwitchFailMessage(
  tr: (
    key:
      | "composer.branchFail.dirty"
      | "composer.branchFail.elsewhere"
      | "composer.branchFail.agentBusy"
      | "composer.branchFail.notFound"
      | "composer.branchFail.invalid"
      | "composer.branchFail.gitMissing"
      | "composer.branchFail.notRepo",
    vars?: Record<string, string | number | null | undefined>,
  ) => string,
  kind: GitSwitchKind,
  reason?: string | null,
  path?: string | null,
): string {
  switch (kind) {
    case "dirty":
      return tr("composer.branchFail.dirty");
    case "elsewhere":
      return tr("composer.branchFail.elsewhere", {
        path: (path || "").trim() || "—",
      });
    case "agent_busy":
      return tr("composer.branchFail.agentBusy");
    case "not_found":
      return tr("composer.branchFail.notFound");
    case "invalid":
      return tr("composer.branchFail.invalid");
    case "git_not_available":
      return tr("composer.branchFail.gitMissing");
    case "not_a_git_repo":
      return tr("composer.branchFail.notRepo");
    default:
      return (reason || "").trim() || tr("composer.branchFail.notFound");
  }
}

export function gitSwitchKindFromHost(
  raw: string | null | undefined,
): GitSwitchKind {
  const k = (raw ?? "").trim();
  switch (k) {
    case "ok":
    case "dirty":
    case "elsewhere":
    case "agent_busy":
    case "not_found":
    case "invalid":
    case "git_not_available":
    case "not_a_git_repo":
    case "failed":
      return k;
    default:
      return "failed";
  }
}

/**
 * Pure helpers for chat fork + optional restore-code (git worktree bind).
 * Host `session_fork` stays journal-only; worktree + project bind run in UI.
 */

import { sanitizeWorktreeName } from "@/lib/gitWorktree";

/** Minimal git-status shape used for dirty / availability checks. */
export type ForkGitStatusSnapshot = {
  available?: boolean | null;
  files?: readonly unknown[] | null;
  reason?: string | null;
};

/**
 * True when porcelain lists any changed / untracked paths.
 * Unavailable status is not dirty (caller handles missing git separately).
 */
export function isGitWorkingTreeDirty(
  status: ForkGitStatusSnapshot | null | undefined,
): boolean {
  if (!status?.available) return false;
  return (status.files?.length ?? 0) > 0;
}

export type ForkRestoreCodeGate =
  | { ok: true }
  | { ok: false; reason: "no_project" | "unavailable" | "dirty" };

/**
 * Gate for optional restore-code on fork.
 * - no_project: source chat has no bound folder
 * - unavailable: not a git work tree / git missing
 * - dirty: uncommitted changes — never force checkout / destroy work
 */
export function canRestoreCodeOnFork(
  projectPath: string | null | undefined,
  status: ForkGitStatusSnapshot | null | undefined,
): ForkRestoreCodeGate {
  const path = (projectPath ?? "").trim();
  if (!path) return { ok: false, reason: "no_project" };
  if (!status?.available) return { ok: false, reason: "unavailable" };
  if (isGitWorkingTreeDirty(status)) return { ok: false, reason: "dirty" };
  return { ok: true };
}

/**
 * Sanitize a short fragment from a session id for worktree branch names.
 * Keeps letters, digits, `.` `_` `-` only; empty → `"chat"`.
 */
export function sanitizeForkNameFragment(
  raw: string | null | undefined,
  maxLen = 8,
): string {
  const cleaned = (raw ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, "")
    .replace(/^-+/, "");
  const slice = cleaned.slice(0, Math.max(1, maxLen));
  return slice || "chat";
}

/**
 * Unique-ish worktree / branch name for a fork restore:
 *   `fork-<sessionFrag>-<base36time>[-<attempt>]`
 *
 * Safe for `git worktree add -b` via {@link sanitizeWorktreeName}.
 */
export function buildForkWorktreeName(
  sourceSessionId: string | null | undefined,
  opts?: { attempt?: number; now?: number },
): string {
  const frag = sanitizeForkNameFragment(sourceSessionId, 8);
  const now = opts?.now ?? Date.now();
  const attempt = Math.max(0, opts?.attempt ?? 0);
  const time = Math.abs(now).toString(36);
  let candidate =
    attempt > 0 ? `fork-${frag}-${time}-${attempt}` : `fork-${frag}-${time}`;
  // hard cap before sanitize (64 max inside sanitizeWorktreeName)
  if (candidate.length > 64) {
    candidate = candidate.slice(0, 64).replace(/-+$/, "") || `fork-${time}`;
  }
  // Must not start with '-' after truncation edge cases
  if (candidate.startsWith("-")) {
    candidate = `fork${candidate}`;
  }
  return sanitizeWorktreeName(candidate);
}

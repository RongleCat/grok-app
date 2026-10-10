/**
 * PR monitor — pure logic for the branch-bound PR chip and the follow-up wake.
 *
 * Two halves, both side-effect free so they can be tested directly:
 * 1. binding a PR to the current git branch (git-native: PR head branch) and
 *    rendering it in the composer branch chip (truncated title);
 * 2. turning two host snapshots into the update list, and the update list into
 *    the follow-up prompt the session receives.
 *
 * The host (`src-tauri/src/pr_monitor.rs`) only polls and tells us *that* the
 * fingerprint moved; the semantic read of the change and the prompt text live
 * here so the wake can be localized and reuse the existing PR prompt builders.
 */

import type { createT } from "@/i18n";
import type { GitPrCheckEntry, GitPrHubEntry, PrChecksSummary } from "./gitPrHub";
import {
  buildFixCiPrompt,
  buildPrCommentPrompt,
  listFailedChecks,
  PR_REVIEW_PROMPT_TOTAL_CAP,
} from "./prReviewWorkbench";

type TFn = ReturnType<typeof createT>;

/** Longest PR title kept in the composer branch chip, in code points. */
export const PR_CHIP_TITLE_MAX = 36;
/** Longest PR title kept in a prompt / menu row (the menu is wider). */
export const PR_MENU_TITLE_MAX = 80;
/** Cap on failed-check rows carried into a follow-up prompt. */
export const PR_WAKE_CHECKS_CAP = 25;

// ── Snapshot shapes mirrored from the host payload ──────────────────────────

/** One conversation entry (issue comment or review) inside a snapshot. */
export type PrMonitorCommentBrief = {
  id: string;
  author: string;
  /** comment | review */
  kind: string;
  state?: string | null;
  createdAt?: string | null;
  excerpt: string;
};

export type PrMonitorSnapshot = {
  number: number;
  title: string;
  url: string;
  /** OPEN | MERGED | CLOSED ("" when unknown). */
  state: string;
  isDraft: boolean;
  mergeable: string;
  headRefName: string;
  baseRefName: string;
  updatedAt: string;
  checks: PrChecksSummary;
  /** Newest first, capped by the host. */
  comments: PrMonitorCommentBrief[];
};

/** `pr-monitor://update` payload. */
export type PrMonitorUpdateEvent = {
  watcherId: string;
  projectPath: string;
  branch: string;
  prNumber: number;
  sessionId?: string | null;
  url: string;
  title: string;
  prev: PrMonitorSnapshot;
  next: PrMonitorSnapshot;
  at: string;
};

/** Mounted watcher as reported by the host (source of truth for mounts). */
export type PrMonitorWatcherInfo = {
  watcherId: string;
  projectPath: string;
  branch: string;
  prNumber: number;
  sessionId?: string | null;
  intervalSecs: number;
  mountedAt: string;
  lastPollAt?: string | null;
  lastUpdateAt?: string | null;
  lastError?: string | null;
  polls: number;
  updates: number;
  /** True once the PR merged or closed. */
  terminal: boolean;
  snapshot?: PrMonitorSnapshot | null;
  /** Latest change the UI has not consumed yet. */
  pending?: PrMonitorUpdateEvent | null;
};

// ── One change inside an update ─────────────────────────────────────────────

export type PrUpdateComment = {
  kind: "comment" | "review";
  /** Content-derived key (comment id) — stable across polls. */
  key: string;
  commentId: string;
  author: string;
  excerpt: string;
  state?: string | null;
  createdAt?: string | null;
};

export type PrUpdateChecksFailed = {
  kind: "checks_failed";
  key: string;
  failedCount: number;
};

export type PrUpdateChecksPassed = {
  kind: "checks_passed";
  key: string;
  passed: number;
  total: number;
};

export type PrUpdateMeta = {
  kind: "state" | "mergeable" | "title";
  key: string;
  from: string;
  to: string;
};

export type PrUpdate =
  | PrUpdateComment
  | PrUpdateChecksFailed
  | PrUpdateChecksPassed
  | PrUpdateMeta;

// ── Branch binding ──────────────────────────────────────────────────────────

/** `refs/heads/x` / `heads/x` → `x`; anything else trimmed as-is. */
export function normalizeBranchRef(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (s.startsWith("refs/heads/")) return s.slice("refs/heads/".length);
  if (s.startsWith("heads/")) return s.slice("heads/".length);
  return s;
}

/**
 * The PR that belongs to `branch`, following git semantics: a PR is identified
 * by its head branch. Only open PRs count; the newest open one wins when a
 * branch somehow has more than one. No branch (detached HEAD) → `null`.
 *
 * Never invents a PR: no match means no PR is shown.
 */
export function bindPrToBranch(
  prs: readonly GitPrHubEntry[] | null | undefined,
  branch: string | null | undefined,
): GitPrHubEntry | null {
  const want = normalizeBranchRef(branch);
  if (!want) return null;
  const matches = (Array.isArray(prs) ? prs : []).filter((pr) => {
    if (!pr || !Number.isFinite(Number(pr.number))) return false;
    if (normalizeBranchRef(pr.headRefName) !== want) return false;
    const state = String(pr.state ?? "").trim().toUpperCase();
    return state === "" || state === "OPEN";
  });
  if (matches.length === 0) return null;
  return matches.reduce((best, pr) => (pr.number > best.number ? pr : best));
}

// ── Chip label ──────────────────────────────────────────────────────────────

/** Single-line clamp: whitespace collapsed (titles, chip labels). */
function clampSingleLine(raw: string | null | undefined, max: number): string {
  return clampMultiline(String(raw ?? "").replace(/\s+/g, " "), max);
}

/**
 * Multi-line clamp: keeps newlines so a composed prompt keeps its structure
 * (the shipped PR builders rely on blank lines and `##` headings).
 */
function clampMultiline(raw: string | null | undefined, max: number): string {
  const s = String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
  const limit = Math.max(1, Math.trunc(max));
  const chars = Array.from(s);
  if (chars.length <= limit) return s;
  if (limit === 1) return "…";
  return chars.slice(0, limit - 1).join("").replace(/\s+$/, "") + "…";
}

/** Whitespace-collapsed PR title, ellipsized past `max` code points. */
export function truncatePrTitle(
  title: string | null | undefined,
  max: number = PR_CHIP_TITLE_MAX,
): string {
  return clampSingleLine(title, max);
}

/** `#1316 Fix the thing…` — empty when the PR number is unusable. */
export function formatPrChipLabel(
  pr: { number?: number | null; title?: string | null } | null | undefined,
  max: number = PR_CHIP_TITLE_MAX,
): string {
  const n = Math.trunc(Number(pr?.number));
  if (!Number.isFinite(n) || n <= 0) return "";
  const title = truncatePrTitle(pr?.title, max);
  return title ? `#${n} ${title}` : `#${n}`;
}

// ── Snapshot diff ───────────────────────────────────────────────────────────

function timeMs(raw: string | null | undefined): number {
  const t = Date.parse(String(raw ?? ""));
  return Number.isFinite(t) ? t : 0;
}

function num(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function briefKey(brief: PrMonitorCommentBrief): string {
  const kind = brief.kind === "review" ? "review" : "comment";
  return `${kind}:${brief.id}`;
}

/**
 * What actually changed between two polls, newest-relevant first.
 *
 * Deliberately narrow: only changes worth waking a session for.
 * - comments / reviews that are new since `prev`;
 * - CI turning green, or newly failing (a partial improvement does not wake);
 * - PR state, mergeability or title moving.
 *
 * Anything else (draft toggle, an edit inside an already-seen comment, a
 * timestamp-only bump) yields no updates, so it cannot wake the session.
 */
export function diffPrSnapshots(
  prev: PrMonitorSnapshot | null | undefined,
  next: PrMonitorSnapshot | null | undefined,
): PrUpdate[] {
  if (!prev || !next) return [];
  const out: PrUpdate[] = [];

  const seen = new Set((prev.comments ?? []).map((c) => c.id));
  const added = (next.comments ?? [])
    .filter((c) => c && c.id && !seen.has(c.id))
    .slice()
    .sort((a, b) => timeMs(b.createdAt) - timeMs(a.createdAt));
  for (const brief of added) {
    const kind = brief.kind === "review" ? "review" : "comment";
    out.push({
      kind,
      key: briefKey(brief),
      commentId: brief.id,
      author: String(brief.author ?? "").trim() || "unknown",
      excerpt: String(brief.excerpt ?? "").trim(),
      state: brief.state ?? null,
      createdAt: brief.createdAt ?? null,
    });
  }

  const before = prev.checks ?? null;
  const after = next.checks ?? null;
  const prevFail = num(before?.fail);
  const nextFail = num(after?.fail);
  const wasGreen =
    prevFail === 0 && num(before?.pending) === 0 && num(before?.total) > 0;
  const isGreen =
    nextFail === 0 && num(after?.pending) === 0 && num(after?.total) > 0;
  if (nextFail > 0 && prevFail === 0) {
    out.push({
      kind: "checks_failed",
      key: `checks_failed:${nextFail}`,
      failedCount: nextFail,
    });
  } else if (isGreen && !wasGreen) {
    out.push({
      kind: "checks_passed",
      key: `checks_passed:${num(after?.pass)}/${num(after?.total)}`,
      passed: num(after?.pass),
      total: num(after?.total),
    });
  }

  const prevState = String(prev.state ?? "").trim();
  const nextState = String(next.state ?? "").trim();
  if (nextState && prevState && nextState !== prevState) {
    out.push({
      kind: "state",
      key: `state:${nextState}`,
      from: prevState,
      to: nextState,
    });
  }
  const prevMerge = String(prev.mergeable ?? "").trim();
  const nextMerge = String(next.mergeable ?? "").trim();
  if (nextMerge && prevMerge && nextMerge !== prevMerge) {
    out.push({
      kind: "mergeable",
      key: `mergeable:${nextMerge}`,
      from: prevMerge,
      to: nextMerge,
    });
  }
  const prevTitle = String(prev.title ?? "").trim();
  const nextTitle = String(next.title ?? "").trim();
  if (nextTitle && prevTitle && nextTitle !== prevTitle) {
    out.push({
      kind: "title",
      key: `title:${nextTitle}`,
      from: prevTitle,
      to: nextTitle,
    });
  }

  return out;
}

/**
 * Wake epoch for a host update: the PR revision plus the change set.
 *
 * Two polls of the same change produce the same key (so the session is woken
 * once); a later change bumps `updatedAt`, so it wakes again.
 */
export function prWakeKey(update: PrMonitorUpdateEvent | null | undefined): string {
  if (!update) return "";
  const updates = diffPrSnapshots(update.prev, update.next);
  const keys = updates.map((u) => u.key).sort();
  return [
    String(update.prNumber ?? ""),
    String(update.next?.updatedAt ?? update.at ?? ""),
    keys.join(","),
  ].join("|");
}

/** True once gh reports the PR merged or closed. */
export function isTerminalPrState(state: string | null | undefined): boolean {
  const s = String(state ?? "").trim().toUpperCase();
  return s === "MERGED" || s === "CLOSED";
}

/** A merged/closed PR should stop being watched after its last follow-up. */
export function shouldAutoUnwatch(
  next: PrMonitorSnapshot | null | undefined,
): boolean {
  return isTerminalPrState(next?.state);
}

/** True when a wake can be delivered right now. */
export function shouldFlushPending(
  sessionBusy: boolean,
  pendingCount: number,
): boolean {
  return !sessionBusy && pendingCount > 0;
}

/** Retry a failed wake once — a reconnect may have been mid-flight. */
export function shouldRetryWake(attempts: number): boolean {
  return attempts < 1;
}

/**
 * Localized checks rollup for a PR row (`3 pass · 1 fail`).
 * Empty when there is nothing to report — never invents a zero.
 */
export function formatChecksLine(
  summary: PrChecksSummary | null | undefined,
  tr: TFn,
): string {
  if (!summary || num(summary.total) <= 0) return "";
  const parts: string[] = [];
  if (num(summary.pass) > 0) {
    parts.push(tr("prMonitor.checks.pass", { count: num(summary.pass) }));
  }
  if (num(summary.fail) > 0) {
    parts.push(tr("prMonitor.checks.fail", { count: num(summary.fail) }));
  }
  if (num(summary.pending) > 0) {
    parts.push(tr("prMonitor.checks.pending", { count: num(summary.pending) }));
  }
  return parts.join(" · ");
}

// ── Update description (UI + prompt share this) ─────────────────────────────

/** One i18n'd line for a single change (used in the prompt and in the menu). */
export function describePrUpdate(update: PrUpdate, tr: TFn): string {
  switch (update.kind) {
    case "comment":
      return tr("prMonitor.update.comment", {
        author: update.author,
        excerpt: update.excerpt,
      });
    case "review":
      return update.state
        ? tr("prMonitor.update.reviewState", {
            author: update.author,
            state: update.state,
            excerpt: update.excerpt,
          })
        : tr("prMonitor.update.review", {
            author: update.author,
            excerpt: update.excerpt,
          });
    case "checks_failed":
      return tr("prMonitor.update.checksFailed", { count: update.failedCount });
    case "checks_passed":
      return tr("prMonitor.update.checksPassed", {
        passed: update.passed,
        total: update.total,
      });
    case "state":
      return tr("prMonitor.update.state", { from: update.from, to: update.to });
    case "mergeable":
      return tr("prMonitor.update.mergeable", {
        from: update.from,
        to: update.to,
      });
    case "title":
      return tr("prMonitor.update.title", { from: update.from, to: update.to });
  }
}

// ── Follow-up prompt ────────────────────────────────────────────────────────

export type PrWakeComment = {
  author: string;
  body: string;
  kind: string;
  state?: string | null;
  url?: string | null;
};

export type PrWakePromptInput = {
  prNumber: number;
  title: string;
  url?: string | null;
  headRef?: string | null;
  baseRef?: string | null;
  updates: readonly PrUpdate[];
  /** Full text of the newest new comment, when the caller could fetch it. */
  newestComment?: PrWakeComment | null;
  /** Failed check rows, when the caller could fetch them. */
  failedChecks?: readonly GitPrCheckEntry[] | null;
  tr: TFn;
};

/**
 * The turn handed to the session when a watched PR changes.
 *
 * Reuses the shipped PR builders for the actionable parts (a new comment, a CI
 * failure) and otherwise lists the change. Empty string when there is nothing
 * to follow up on.
 */
export function buildPrUpdatePrompt(input: PrWakePromptInput): string {
  const n = Math.trunc(Number(input.prNumber));
  if (!Number.isFinite(n) || n <= 0) return "";
  const updates = Array.isArray(input.updates) ? input.updates : [];
  if (updates.length === 0) return "";

  const tr = input.tr;
  const title = clampSingleLine(input.title, 200) || `#${n}`;
  const url = String(input.url ?? "").trim();

  // The URL only appears in the header when it is actually known.
  const header = url
    ? tr("prMonitor.promptHeaderUrl", { number: n, title, url })
    : tr("prMonitor.promptHeader", { number: n, title });
  const lines: string[] = [header, "", tr("prMonitor.promptUpdates")];
  for (const update of updates) {
    lines.push(`- ${describePrUpdate(update, tr)}`);
  }

  const failed = listFailedChecks(
    (input.failedChecks ?? null) as GitPrCheckEntry[] | null,
  ).slice(0, PR_WAKE_CHECKS_CAP);
  const hasCiFailure = updates.some((u) => u.kind === "checks_failed");
  const comment = input.newestComment;

  if (comment?.body?.trim()) {
    const block = buildPrCommentPrompt({
      prNumber: n,
      title,
      comment: {
        author: comment.author,
        body: comment.body,
        kind: comment.kind,
        state: comment.state ?? null,
        url: comment.url ?? null,
      },
    });
    if (block) lines.push("", block);
  }

  if (hasCiFailure) {
    const block = buildFixCiPrompt({
      prNumber: n,
      title,
      url,
      headRef: input.headRef ?? null,
      baseRef: input.baseRef ?? null,
      failedChecks: failed.map((c) => ({
        name: c.name,
        state: c.state,
        description: c.description ?? null,
      })),
    });
    if (block) lines.push("", block);
  }

  lines.push("", tr("prMonitor.promptTask"));
  return clampMultiline(lines.join("\n"), PR_REVIEW_PROMPT_TOTAL_CAP);
}

/** Cap on retained wake keys (dedup memory); oldest are dropped first. */
export const PR_WAKE_SEEN_CAP = 200;

/** Bounded, insertion-ordered dedup set of delivered wake keys. */
export function rememberWakeKey(
  seen: readonly string[],
  key: string,
): readonly string[] {
  if (!key) return seen;
  const next = seen.filter((k) => k !== key);
  next.push(key);
  return next.length > PR_WAKE_SEEN_CAP
    ? next.slice(next.length - PR_WAKE_SEEN_CAP)
    : next;
}

/** True when this update was already delivered to the session. */
export function isWakeKeySeen(
  seen: readonly string[],
  key: string,
): boolean {
  return !!key && seen.includes(key);
}

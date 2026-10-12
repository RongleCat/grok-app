/**
 * PR monitor — the client half: what a watch row shows, and what the host
 * pushed.
 *
 * The host owns the watches, the poll, the reading of a change and the
 * follow-up turn (`src-tauri/src/pr_monitor.rs`). It pushes the rows
 * (`pr-monitor://state`) and each wake's outcome (`pr-monitor://wake`), so
 * everything here is pure rendering logic that can be tested on its own.
 */

import type { createT } from "@/i18n";
import type { GitPrHubEntry, PrChecksSummary } from "./gitPrHub";

type TFn = ReturnType<typeof createT>;

/** Longest PR title kept in a menu row, in code points. */
export const PR_ROW_TITLE_MAX = 80;
/** Cap on row-summary characters (a change line from the host). */
const SUMMARY_CAP = 200;

// ── Host payloads mirrored from src-tauri/src/pr_monitor.rs ─────────────────

/** The PR as a watch row shows it; the conversation stays on the host. */
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
};

/** One PR a session watches. */
export type PrMonitorWatchInfo = {
  sessionId: string;
  projectPath: string;
  prNumber: number;
  intervalSecs: number;
  mountedAt: string;
  lastPollAt?: string | null;
  lastUpdateAt?: string | null;
  lastError?: string | null;
  polls: number;
  updates: number;
  /** The PR merged or closed; the host stops the watch after the last wake. */
  terminal: boolean;
  snapshot?: PrMonitorSnapshot | null;
  /** Localized summary of the last delivered change ("" until one lands). */
  lastChange?: string | null;
  /** A wake for this PR is waiting for its chat to go idle. */
  pending: boolean;
};

/** `pr-monitor://state` payload. */
export type PrMonitorStateEvent = {
  sessionId: string;
  watches: PrMonitorWatchInfo[];
};

/** queued = waiting for an idle chat, delivered = the chat took the turn,
 * settled = delivered and the PR is done, failed = the chat could not take it. */
export type PrWakeStatus = "queued" | "delivered" | "settled" | "failed";

/** `pr-monitor://wake` payload. */
export type PrMonitorWakeEvent = {
  sessionId: string;
  prNumber: number;
  status: PrWakeStatus;
  /** Localized one-line summary of what woke the chat. */
  summary: string;
  /** The PR state this wake was written against. */
  prState: string;
  reason?: string | null;
  pending: boolean;
  at: string;
};

// ── Rows ────────────────────────────────────────────────────────────────────

/** One row of the repo-wide PR list in the branch menu. */
export type PrListRow = {
  number: number;
  title: string;
  state: string | null;
  /** Localized checks rollup ("" when unknown). */
  checksLine: string | null;
  /** The PR's own head branch — read-only metadata, not a binding. */
  branch: string | null;
  /** This chat watches it. */
  watching: boolean;
  /** A watch/unwatch call for this row is in flight. */
  busy: boolean;
};

function clampSingleLine(raw: string | null | undefined, max: number): string {
  const s = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const limit = Math.max(1, Math.trunc(max));
  const chars = Array.from(s);
  if (chars.length <= limit) return s;
  if (limit === 1) return "…";
  return chars.slice(0, limit - 1).join("").replace(/\s+$/, "") + "…";
}

/** Whitespace-collapsed title, ellipsized past `max` code points. */
export function truncatePrTitle(
  title: string | null | undefined,
  max: number = PR_ROW_TITLE_MAX,
): string {
  return clampSingleLine(title, max);
}

/** `#1316 Fix the thing…` — empty when the PR number is unusable. */
export function formatPrRowLabel(
  pr: { number?: number | null; title?: string | null } | null | undefined,
  max: number = PR_ROW_TITLE_MAX,
): string {
  const n = Math.trunc(Number(pr?.number));
  if (!Number.isFinite(n) || n <= 0) return "";
  const title = truncatePrTitle(pr?.title, max);
  return title ? `#${n} ${title}` : `#${n}`;
}

/**
 * Localized checks rollup for a row (`3 pass · 1 fail`).
 * Empty when there is nothing to report — never invents a zero.
 */
export function formatChecksLine(
  summary: PrChecksSummary | null | undefined,
  tr: TFn,
): string {
  const n = (raw: unknown) => {
    const v = Number(raw);
    return Number.isFinite(v) ? v : 0;
  };
  if (!summary || n(summary.total) <= 0) return "";
  const parts: string[] = [];
  if (n(summary.pass) > 0) {
    parts.push(tr("prMonitor.checks.pass", { count: n(summary.pass) }));
  }
  if (n(summary.fail) > 0) {
    parts.push(tr("prMonitor.checks.fail", { count: n(summary.fail) }));
  }
  if (n(summary.pending) > 0) {
    parts.push(tr("prMonitor.checks.pending", { count: n(summary.pending) }));
  }
  return parts.join(" · ");
}

/**
 * The repo's open PRs, most recently updated first.
 *
 * The list is the repository's, not a branch's: every PR of the repo is offered
 * to the chat, and which branch its head sits on is just how the PR is built.
 */
export function sortPrsForList(
  prs: readonly GitPrHubEntry[] | null | undefined,
): GitPrHubEntry[] {
  return (Array.isArray(prs) ? prs : [])
    .filter((pr) => pr && Number.isFinite(Number(pr.number)))
    .slice()
    .sort((a, b) => {
      const at = Date.parse(String(a.updatedAt ?? "")) || 0;
      const bt = Date.parse(String(b.updatedAt ?? "")) || 0;
      if (at !== bt) return bt - at;
      return Number(b.number) - Number(a.number);
    });
}

/** The rows the branch menu renders: the repo's PRs, with this chat's watches. */
export function prListRows(
  prs: readonly GitPrHubEntry[] | null | undefined,
  watches: readonly PrMonitorWatchInfo[] | null | undefined,
  opts: { busy?: readonly number[]; tr: TFn },
): PrListRow[] {
  const busy = new Set((opts.busy ?? []).map((n) => Number(n)));
  const byNumber = new Map<number, PrMonitorWatchInfo>();
  for (const watch of Array.isArray(watches) ? watches : []) {
    if (watch && Number.isFinite(Number(watch.prNumber))) {
      byNumber.set(Number(watch.prNumber), watch);
    }
  }
  return sortPrsForList(prs).map((pr) => {
    const number = Number(pr.number);
    const watch = byNumber.get(number);
    return {
      number,
      title: String(pr.title ?? ""),
      state: String(pr.state ?? "").trim() || null,
      checksLine: formatChecksLine(pr.checks ?? null, opts.tr) || null,
      branch: String(pr.headRefName ?? "").trim() || null,
      watching: !!watch,
      busy: busy.has(number),
    };
  });
}

/** Wakes waiting for this chat to go idle. */
export function pendingWakeCount(
  watches: readonly PrMonitorWatchInfo[] | null | undefined,
): number {
  return (Array.isArray(watches) ? watches : []).filter((w) => w?.pending).length;
}

/** The most recent change a watch delivered, or `null`. */
export function lastChangeOf(
  watches: readonly PrMonitorWatchInfo[] | null | undefined,
): string | null {
  const rows = (Array.isArray(watches) ? watches : [])
    .filter((w) => !!w && !!String(w.lastChange ?? "").trim())
    .slice()
    .sort((a, b) => {
      const at = Date.parse(String(a.lastUpdateAt ?? "")) || 0;
      const bt = Date.parse(String(b.lastUpdateAt ?? "")) || 0;
      return bt - at;
    });
  const text = String(rows[0]?.lastChange ?? "").trim();
  return text ? clampSingleLine(text, SUMMARY_CAP) : null;
}

/** The first poll failure the host reported for this chat's watches, or `null`. */
export function watchErrorOf(
  watches: readonly PrMonitorWatchInfo[] | null | undefined,
): string | null {
  const hit = (Array.isArray(watches) ? watches : []).find(
    (w) => !!w && !!String(w.lastError ?? "").trim(),
  );
  const text = String(hit?.lastError ?? "").trim();
  return text ? clampSingleLine(text, SUMMARY_CAP) : null;
}

/** The toast one wake outcome deserves, or `null` when it needs no notice. */
export function describeWake(
  wake: PrMonitorWakeEvent | null | undefined,
  tr: TFn,
): { text: string; tone: "info" | "error" } | null {
  if (!wake) return null;
  const number = Number(wake.prNumber);
  switch (wake.status) {
    case "queued":
      return { text: tr("prMonitor.wakeQueuedToast", { number }), tone: "info" };
    case "delivered":
      return { text: tr("prMonitor.wokeToast", { number }), tone: "info" };
    case "settled":
      return {
        text: tr("prMonitor.terminal", { state: String(wake.prState ?? "") }),
        tone: "info",
      };
    case "failed":
      return {
        text: tr("prMonitor.wakeFailed", {
          reason: String(wake.reason ?? "").trim(),
        }),
        tone: "error",
      };
    default:
      return null;
  }
}

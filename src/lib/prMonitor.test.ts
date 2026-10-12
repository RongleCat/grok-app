/**
 * PR monitor pure-logic tests: row labels, the repo list, and the toast one
 * wake outcome deserves.
 *
 * These drive the shipped functions with payloads shaped like the host's
 * (`src-tauri/src/pr_monitor.rs`), so the rows are exercised the way the branch
 * menu renders them.
 */

import { describe, expect, it } from "vitest";
import { createT } from "@/i18n";
import type { GitPrHubEntry, PrChecksSummary } from "@/lib/gitPrHub";
import {
  PR_ROW_TITLE_MAX,
  describeWake,
  formatChecksLine,
  formatPrRowLabel,
  lastChangeOf,
  pendingWakeCount,
  prListRows,
  sortPrsForList,
  truncatePrTitle,
  watchErrorOf,
  type PrMonitorWakeEvent,
  type PrMonitorWatchInfo,
} from "@/lib/prMonitor";

const tr = createT("en");

function summary(partial: Partial<PrChecksSummary> = {}): PrChecksSummary {
  return {
    pass: 0,
    fail: 0,
    pending: 0,
    skipping: 0,
    cancel: 0,
    total: 0,
    overall: "none",
    ...partial,
  };
}

function prEntry(over: Partial<GitPrHubEntry> = {}): GitPrHubEntry {
  return {
    number: 1316,
    title: "feat(tasks): follow live subagent runs in the Tasks panel",
    url: "https://github.com/RongleCat/grok-app/pull/1316",
    author: "BoringLink",
    state: "OPEN",
    isDraft: false,
    headRefName: "feat/subagent-live-monitor",
    baseRefName: "main",
    updatedAt: "2026-10-11T09:00:00Z",
    checks: summary({ pass: 4, total: 4, overall: "pass" }),
    ...over,
  };
}

function watch(over: Partial<PrMonitorWatchInfo> = {}): PrMonitorWatchInfo {
  return {
    sessionId: "s1",
    projectPath: "/repo",
    prNumber: 1316,
    intervalSecs: 60,
    mountedAt: "2026-10-11T10:00:00Z",
    polls: 3,
    updates: 1,
    terminal: false,
    pending: false,
    ...over,
  };
}

// ── Labels ──────────────────────────────────────────────────────────────────

describe("truncatePrTitle / formatPrRowLabel", () => {
  it("keeps a short title and ellipsizes a long one", () => {
    expect(truncatePrTitle("Fix CI", 20)).toBe("Fix CI");
    const long = truncatePrTitle("a".repeat(40), 10);
    expect(Array.from(long)).toHaveLength(10);
    expect(long.endsWith("…")).toBe(true);
  });

  it("collapses whitespace so a row stays one line", () => {
    expect(truncatePrTitle("Fix\n  the   thing", 40)).toBe("Fix the thing");
  });

  it("counts code points, never splitting a surrogate pair", () => {
    const emoji = "🚀".repeat(5);
    expect(Array.from(truncatePrTitle(emoji, 3))).toHaveLength(3);
    expect(truncatePrTitle("🚀 tail", 40)).toBe("🚀 tail");
  });

  it("labels a row with its number, and never invents one", () => {
    expect(formatPrRowLabel({ number: 1316, title: "Fix CI" })).toBe("#1316 Fix CI");
    expect(formatPrRowLabel({ number: 1316, title: "" })).toBe("#1316");
    expect(formatPrRowLabel({ number: 0, title: "Fix CI" })).toBe("");
    expect(formatPrRowLabel(null)).toBe("");
  });

  it("uses the menu width for a row and the default elsewhere", () => {
    expect(PR_ROW_TITLE_MAX).toBe(80);
    const title = "x".repeat(200);
    // `#1316 ` rides in front of the clamped title.
    expect(Array.from(formatPrRowLabel({ number: 1, title }))).toHaveLength(83);
    expect(Array.from(formatPrRowLabel({ number: 1, title }, 10))).toHaveLength(13);
    expect(formatPrRowLabel({ number: 1, title }, 10).endsWith("…")).toBe(true);
  });
});

describe("formatChecksLine", () => {
  it("summarizes what the rollup knows and nothing more", () => {
    expect(formatChecksLine(summary({ pass: 4, fail: 1, pending: 2, total: 7 }), tr)).toBe(
      "4 pass · 1 fail · 2 pending",
    );
    expect(formatChecksLine(summary({ fail: 1, total: 1 }), tr)).toBe("1 fail");
    // No checks → no line, never an invented zero.
    expect(formatChecksLine(summary(), tr)).toBe("");
    expect(formatChecksLine(null, tr)).toBe("");
  });
});

// ── The repo list ───────────────────────────────────────────────────────────

describe("sortPrsForList", () => {
  it("orders the repository's PRs by the newest update", () => {
    const older = prEntry({ number: 2, updatedAt: "2026-10-10T09:00:00Z" });
    const newest = prEntry({ number: 7, updatedAt: "2026-10-12T09:00:00Z" });
    const middle = prEntry({ number: 5, updatedAt: "2026-10-11T09:00:00Z" });
    expect(sortPrsForList([older, newest, middle]).map((p) => p.number)).toEqual([
      7, 5, 2,
    ]);
  });

  it("falls back to the PR number when a date is missing", () => {
    const noDate = prEntry({ number: 2, updatedAt: null });
    const alsoNoDate = prEntry({ number: 9, updatedAt: null });
    expect(sortPrsForList([noDate, alsoNoDate]).map((p) => p.number)).toEqual([9, 2]);
  });

  it("survives an empty or absent list", () => {
    expect(sortPrsForList(null)).toEqual([]);
    expect(sortPrsForList([undefined as unknown as GitPrHubEntry])).toEqual([]);
  });
});

describe("prListRows", () => {
  it("lists every open PR of the repository, not just a branch's", () => {
    const rows = prListRows(
      [
        prEntry(),
        prEntry({
          number: 2,
          title: "Second fixture PR",
          headRefName: "test/pr-monitor-wake-2",
          checks: summary({ pass: 2, total: 2, overall: "pass" }),
        }),
      ],
      [],
      { tr },
    );
    expect(rows.map((r) => r.number)).toEqual([1316, 2]);
    // The head branch is metadata the PR carries, not a filter.
    expect(rows.map((r) => r.branch)).toEqual([
      "feat/subagent-live-monitor",
      "test/pr-monitor-wake-2",
    ]);
    expect(rows[0].checksLine).toBe("4 pass");
    expect(rows[0].watching).toBe(false);
    expect(rows[0].busy).toBe(false);
  });

  it("marks the PRs this chat watches and the toggles in flight", () => {
    const rows = prListRows([prEntry(), prEntry({ number: 2 })], [watch()], {
      busy: [2],
      tr,
    });
    const watched = rows.find((r) => r.number === 1316)!;
    const other = rows.find((r) => r.number === 2)!;
    expect(watched.watching).toBe(true);
    expect(watched.busy).toBe(false);
    expect(other.watching).toBe(false);
    expect(other.busy).toBe(true);
  });

  it("keeps the row when the host has not polled the PR yet", () => {
    const rows = prListRows([prEntry()], [watch({ snapshot: null })], { tr });
    expect(rows[0].watching).toBe(true);
    expect(rows[0].title).not.toBe("");
  });
});

// ── Chat-level hints ────────────────────────────────────────────────────────

describe("watch hints", () => {
  it("counts the wakes waiting for this chat", () => {
    expect(pendingWakeCount([watch(), watch({ prNumber: 2, pending: true })])).toBe(1);
    expect(pendingWakeCount([])).toBe(0);
    expect(pendingWakeCount(null)).toBe(0);
  });

  it("reports the most recent delivered change", () => {
    expect(
      lastChangeOf([
        watch({ lastChange: "CI is green (4/4 passed)", lastUpdateAt: "2026-10-11T09:00:00Z" }),
        watch({
          prNumber: 2,
          lastChange: "New comment from RongleCat: Please rebase.",
          lastUpdateAt: "2026-10-11T10:00:00Z",
        }),
      ]),
    ).toBe("New comment from RongleCat: Please rebase.");
    expect(lastChangeOf([watch()])).toBeNull();
    expect(lastChangeOf(null)).toBeNull();
  });

  it("reports a poll failure instead of looking healthy", () => {
    expect(
      watchErrorOf([watch(), watch({ prNumber: 2, lastError: "gh: not logged in" })]),
    ).toBe("gh: not logged in");
    expect(watchErrorOf([watch()])).toBeNull();
  });
});

// ── Wake notices ────────────────────────────────────────────────────────────

describe("describeWake", () => {
  function wake(over: Partial<PrMonitorWakeEvent> = {}): PrMonitorWakeEvent {
    return {
      sessionId: "s1",
      prNumber: 1316,
      status: "delivered",
      summary: "New comment from RongleCat: Please rebase.",
      prState: "OPEN",
      pending: false,
      at: "2026-10-11T10:00:00Z",
      ...over,
    };
  }

  it("names the change the chat is following up on", () => {
    expect(describeWake(wake(), tr)).toEqual({
      text: "PR #1316 changed — the agent is following up",
      tone: "info",
    });
  });

  it("says when the wake waits for an idle chat", () => {
    expect(describeWake(wake({ status: "queued", pending: true }), tr)).toEqual({
      text: "PR #1316 changed — will follow up when this chat is free",
      tone: "info",
    });
  });

  it("says when the PR is done and the watch stopped", () => {
    expect(
      describeWake(wake({ status: "settled", prState: "MERGED" }), tr),
    ).toEqual({ text: "PR MERGED — stopped watching", tone: "info" });
  });

  it("reports a failed wake as an error, with the reason", () => {
    expect(
      describeWake(wake({ status: "failed", reason: "chat has no live agent" }), tr),
    ).toEqual({
      text: "Could not wake this chat: chat has no live agent",
      tone: "error",
    });
  });

  it("says nothing for a missing payload", () => {
    expect(describeWake(null, tr)).toBeNull();
    expect(describeWake(undefined, tr)).toBeNull();
  });

  it("speaks the app language", () => {
    const zh = createT("zh");
    expect(describeWake(wake({ status: "settled", prState: "MERGED" }), zh)?.text).toBe(
      "PR MERGED — 已停止监视",
    );
    expect(describeWake(wake(), zh)?.text).toBe("PR #1316 有更新 — Agent 正在跟进");
  });
});

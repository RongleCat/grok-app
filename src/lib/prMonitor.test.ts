/**
 * PR monitor pure-logic tests.
 *
 * These drive the shipped functions with snapshots shaped like the real
 * `gh pr view --json` → host payload, so the diff, the wake key and the prompt
 * are exercised the way the app exercises them.
 */

import { describe, expect, it } from "vitest";
import { createT } from "@/i18n";
import type { GitPrHubEntry } from "@/lib/gitPrHub";
import {
  PR_CHIP_TITLE_MAX,
  bindPrToBranch,
  buildPrUpdatePrompt,
  describePrUpdate,
  diffPrSnapshots,
  formatChecksLine,
  formatPrChipLabel,
  isTerminalPrState,
  isWakeKeySeen,
  normalizeBranchRef,
  prWakeKey,
  rememberWakeKey,
  shouldAutoUnwatch,
  shouldFlushPending,
  shouldRetryWake,
  truncatePrTitle,
  type PrMonitorCommentBrief,
  type PrMonitorSnapshot,
  type PrMonitorUpdateEvent,
} from "@/lib/prMonitor";

const tr = createT("en");

// ── Fixtures ────────────────────────────────────────────────────────────────

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
    mergeable: "MERGEABLE",
    ...over,
  };
}

function brief(over: Partial<PrMonitorCommentBrief> = {}): PrMonitorCommentBrief {
  return {
    id: "c1",
    author: "RongleCat",
    kind: "comment",
    state: null,
    createdAt: "2026-10-10T08:00:00Z",
    excerpt: "Please rebase on main.",
    ...over,
  };
}

function snapshot(over: Partial<PrMonitorSnapshot> = {}): PrMonitorSnapshot {
  return {
    number: 1316,
    title: "feat(tasks): follow live subagent runs in the Tasks panel",
    url: "https://github.com/RongleCat/grok-app/pull/1316",
    state: "OPEN",
    isDraft: false,
    mergeable: "MERGEABLE",
    headRefName: "feat/subagent-live-monitor",
    baseRefName: "main",
    updatedAt: "2026-10-10T09:00:00Z",
    checks: {
      pass: 4,
      fail: 0,
      pending: 0,
      skipping: 0,
      cancel: 0,
      total: 4,
      overall: "pass",
    },
    comments: [brief()],
    ...over,
  };
}

function updateEvent(
  prev: PrMonitorSnapshot,
  next: PrMonitorSnapshot,
): PrMonitorUpdateEvent {
  return {
    watcherId: "/repo\u001ffeat/subagent-live-monitor",
    projectPath: "/repo",
    branch: "feat/subagent-live-monitor",
    prNumber: 1316,
    sessionId: "004a47dc-5443-448a-81fe-7c1cf3ea37ec",
    url: next.url,
    title: next.title,
    prev,
    next,
    at: "2026-10-10T09:30:00Z",
  };
}

// ── Branch binding ──────────────────────────────────────────────────────────

describe("bindPrToBranch", () => {
  it("binds the PR whose head branch is the current branch", () => {
    const other = prEntry({ number: 1200, headRefName: "feat/other" });
    const bound = bindPrToBranch([other, prEntry()], "feat/subagent-live-monitor");
    expect(bound?.number).toBe(1316);
  });

  it("accepts a refs/heads/ head ref", () => {
    const prs = [prEntry({ headRefName: "refs/heads/feat/x" })];
    expect(bindPrToBranch(prs, "feat/x")?.number).toBe(1316);
    expect(bindPrToBranch(prs, "refs/heads/feat/x")?.number).toBe(1316);
  });

  it("binds nothing without a branch (detached HEAD) or without a match", () => {
    expect(bindPrToBranch([prEntry()], null)).toBeNull();
    expect(bindPrToBranch([prEntry()], "")).toBeNull();
    expect(bindPrToBranch([prEntry()], "feat/nope")).toBeNull();
    expect(bindPrToBranch([], "feat/subagent-live-monitor")).toBeNull();
  });

  it("ignores merged and closed PRs so a stale binding cannot look live", () => {
    const prs = [
      prEntry({ number: 1200, state: "MERGED" }),
      prEntry({ number: 1100, state: "CLOSED" }),
    ];
    expect(bindPrToBranch(prs, "feat/subagent-live-monitor")).toBeNull();
  });

  it("keeps branch matching case-sensitive", () => {
    const prs = [prEntry({ headRefName: "Feat/X" })];
    expect(bindPrToBranch(prs, "feat/x")).toBeNull();
    expect(bindPrToBranch(prs, "Feat/X")?.number).toBe(1316);
  });

  it("picks the newest open PR when a branch has more than one", () => {
    const prs = [
      prEntry({ number: 1200 }),
      prEntry({ number: 1400 }),
      prEntry({ number: 1300 }),
    ];
    expect(bindPrToBranch(prs, "feat/subagent-live-monitor")?.number).toBe(1400);
  });

  it("normalizes branch refs the git way", () => {
    expect(normalizeBranchRef("refs/heads/main")).toBe("main");
    expect(normalizeBranchRef("  feature/x  ")).toBe("feature/x");
    expect(normalizeBranchRef(null)).toBe("");
  });
});

// ── Chip label ──────────────────────────────────────────────────────────────

describe("truncatePrTitle / formatPrChipLabel", () => {
  it("keeps short titles untouched and ellipsizes long ones to the cap", () => {
    expect(truncatePrTitle("Fix CI", 36)).toBe("Fix CI");

    const long = "feat(tasks): follow live subagent runs in the Tasks panel";
    const cut = truncatePrTitle(long, 20);
    expect(cut.endsWith("…")).toBe(true);
    expect(Array.from(cut).length).toBe(20);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
  });

  it("collapses whitespace so a chip cannot grow a second line", () => {
    expect(truncatePrTitle("  Fix\n  the   thing ", 40)).toBe("Fix the thing");
  });

  it("never splits a surrogate pair", () => {
    const emoji = "🎯🎯🎯🎯🎯";
    expect(Array.from(truncatePrTitle(emoji, 3)).length).toBe(3);
    expect(truncatePrTitle(emoji, 3)).toBe("🎯🎯…");
  });

  it("formats #number + truncated title, and refuses an unusable number", () => {
    expect(formatPrChipLabel({ number: 1316, title: "Fix CI" }, 36)).toBe(
      "#1316 Fix CI",
    );
    expect(formatPrChipLabel({ number: 1316, title: "" }, 36)).toBe("#1316");
    expect(formatPrChipLabel({ number: 0, title: "x" })).toBe("");
    expect(formatPrChipLabel(null)).toBe("");
    expect(PR_CHIP_TITLE_MAX).toBeGreaterThan(0);
  });
});

// ── Snapshot diff ───────────────────────────────────────────────────────────

describe("diffPrSnapshots", () => {
  it("reports a new comment exactly once", () => {
    const before = snapshot();
    const after = snapshot({
      comments: [brief({ id: "c2", excerpt: "CI is green now." }), brief()],
    });
    const updates = diffPrSnapshots(before, after);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      kind: "comment",
      key: "comment:c2",
      author: "RongleCat",
      excerpt: "CI is green now.",
    });
    // No new comment → nothing to wake for.
    expect(diffPrSnapshots(after, after)).toEqual([]);
  });

  it("reports a new review with its state", () => {
    const before = snapshot();
    const after = snapshot({
      comments: [
        brief({ id: "r1", kind: "review", state: "CHANGES_REQUESTED", excerpt: "Needs a test." }),
      ],
    });
    const updates = diffPrSnapshots(before, after);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ kind: "review", key: "review:r1", state: "CHANGES_REQUESTED" });
  });

  it("reports CI pending → fail and pending → success", () => {
    const pending = snapshot({
      checks: { pass: 1, fail: 0, pending: 2, skipping: 0, cancel: 0, total: 3, overall: "pending" },
    });
    const failed = snapshot({
      checks: { pass: 1, fail: 2, pending: 0, skipping: 0, cancel: 0, total: 3, overall: "fail" },
    });
    const passed = snapshot({
      checks: { pass: 3, fail: 0, pending: 0, skipping: 0, cancel: 0, total: 3, overall: "pass" },
    });

    expect(diffPrSnapshots(pending, failed)).toEqual([
      { kind: "checks_failed", key: "checks_failed:2", failedCount: 2 },
    ]);
    expect(diffPrSnapshots(pending, passed)).toEqual([
      { kind: "checks_passed", key: "checks_passed:3/3", passed: 3, total: 3 },
    ]);
  });

  it("does not wake for a partial CI recovery or an unchanged failure", () => {
    const failed = snapshot({
      checks: { pass: 1, fail: 3, pending: 0, skipping: 0, cancel: 0, total: 4, overall: "fail" },
    });
    const fewerFails = snapshot({
      checks: { pass: 3, fail: 1, pending: 0, skipping: 0, cancel: 0, total: 4, overall: "fail" },
    });
    const stillPending = snapshot({
      checks: { pass: 0, fail: 0, pending: 2, skipping: 0, cancel: 0, total: 2, overall: "pending" },
    });
    // Still failing after the improvement: the agent is already on it.
    expect(diffPrSnapshots(failed, fewerFails)).toEqual([]);
    expect(diffPrSnapshots(fewerFails, failed)).toEqual([]);
    // Still pending: nothing to report yet.
    expect(diffPrSnapshots(stillPending, stillPending)).toEqual([]);
    // Already green → a re-poll cannot re-announce green.
    const green = snapshot();
    expect(diffPrSnapshots(green, green)).toEqual([]);
  });

  it("reports a merge, a mergeability change and a retitle", () => {
    const before = snapshot();
    expect(diffPrSnapshots(before, snapshot({ state: "MERGED" }))).toEqual([
      { kind: "state", key: "state:MERGED", from: "OPEN", to: "MERGED" },
    ]);
    expect(
      diffPrSnapshots(before, snapshot({ mergeable: "CONFLICTING" })),
    ).toEqual([
      {
        kind: "mergeable",
        key: "mergeable:CONFLICTING",
        from: "MERGEABLE",
        to: "CONFLICTING",
      },
    ]);
    expect(diffPrSnapshots(before, snapshot({ title: "Renamed" }))).toEqual([
      { kind: "title", key: "title:Renamed", from: before.title, to: "Renamed" },
    ]);
  });

  it("reports nothing for a missing snapshot and for timestamp-only noise", () => {
    expect(diffPrSnapshots(null, snapshot())).toEqual([]);
    expect(diffPrSnapshots(snapshot(), null)).toEqual([]);
    const bumped = snapshot({ updatedAt: "2026-10-10T10:00:00Z" });
    expect(diffPrSnapshots(snapshot(), bumped)).toEqual([]);
  });

  it("is terminal only for merged or closed", () => {
    expect(isTerminalPrState("MERGED")).toBe(true);
    expect(isTerminalPrState("closed")).toBe(true);
    expect(isTerminalPrState("OPEN")).toBe(false);
    expect(shouldAutoUnwatch(snapshot({ state: "MERGED" }))).toBe(true);
    expect(shouldAutoUnwatch(snapshot())).toBe(false);
  });
});

// ── Wake key ────────────────────────────────────────────────────────────────

describe("prWakeKey (wake once per real change)", () => {
  const before = snapshot();
  const afterComment = snapshot({
    updatedAt: "2026-10-10T09:30:00Z",
    comments: [brief({ id: "c2" }), brief()],
  });

  it("is stable for the same change and differs for a later one", () => {
    const a = prWakeKey(updateEvent(before, afterComment));
    const b = prWakeKey(updateEvent(before, afterComment));
    expect(a).toBe(b);
    expect(a).not.toBe("");

    const later = snapshot({
      updatedAt: "2026-10-10T10:00:00Z",
      checks: { pass: 3, fail: 1, pending: 0, skipping: 0, cancel: 0, total: 4, overall: "fail" },
      comments: [brief({ id: "c2" }), brief()],
    });
    expect(prWakeKey(updateEvent(afterComment, later))).not.toBe(a);
  });

  it("keeps an empty change set for a null event or an unchanged pair", () => {
    expect(prWakeKey(null)).toBe("");
    const unchanged = prWakeKey(updateEvent(before, before));
    expect(unchanged.startsWith("1316|")).toBe(true);
    expect(unchanged.endsWith("|")).toBe(true);
    expect(diffPrSnapshots(before, before)).toEqual([]);
  });

  it("remembers a bounded set of delivered wakes", () => {
    let seen: readonly string[] = [];
    expect(isWakeKeySeen(seen, "k1")).toBe(false);
    seen = rememberWakeKey(seen, "k1");
    expect(isWakeKeySeen(seen, "k1")).toBe(true);
    seen = rememberWakeKey(seen, "k1");
    expect(seen.filter((k) => k === "k1")).toHaveLength(1);
  });
});

// ── Prompt ──────────────────────────────────────────────────────────────────

describe("buildPrUpdatePrompt", () => {
  const failedChecks = [
    {
      name: "frontend",
      state: "FAILURE",
      bucket: "fail",
      link: null,
      description: "vitest failed in src/lib/prMonitor.test.ts",
      workflow: "ci",
    },
  ];

  it("packs the PR identity, the change list and the comment into the turn", () => {
    const before = snapshot();
    const after = snapshot({
      updatedAt: "2026-10-10T09:30:00Z",
      comments: [brief({ id: "c2", excerpt: "Please rebase on main." }), brief()],
    });
    const prompt = buildPrUpdatePrompt({
      prNumber: 1316,
      title: after.title,
      url: after.url,
      headRef: after.headRefName,
      baseRef: after.baseRefName,
      updates: diffPrSnapshots(before, after),
      newestComment: {
        author: "RongleCat",
        body: "Please rebase on main.",
        kind: "comment",
        url: "https://github.com/RongleCat/grok-app/pull/1316#issuecomment-2",
      },
      tr,
    });

    expect(prompt).toContain("#1316");
    expect(prompt).toContain("Please rebase on main.");
    expect(prompt).toContain("RongleCat");
    expect(prompt).toContain("What changed:");
    expect(prompt).toContain("New comment from RongleCat");
    expect(prompt).toContain(after.url);
    // English is the key authority; the task instruction must be present too.
    expect(prompt).toContain("Follow up on this PR update now");
  });

  it("builds a fix-CI turn from the real failed-check rows", () => {
    const pending = snapshot({
      checks: { pass: 0, fail: 0, pending: 1, skipping: 0, cancel: 0, total: 1, overall: "pending" },
    });
    const failed = snapshot({
      updatedAt: "2026-10-10T10:00:00Z",
      checks: { pass: 0, fail: 1, pending: 0, skipping: 0, cancel: 0, total: 1, overall: "fail" },
    });
    const prompt = buildPrUpdatePrompt({
      prNumber: 1316,
      title: failed.title,
      url: failed.url,
      updates: diffPrSnapshots(pending, failed),
      failedChecks,
      tr,
    });

    expect(prompt).toContain("CI is failing (1 checks)");
    expect(prompt).toContain("fix the failing CI checks");
    expect(prompt).toContain("**frontend** — FAILURE");
    expect(prompt).toContain("vitest failed in src/lib/prMonitor.test.ts");
  });

  it("describes a merged PR without inventing a comment or a failure", () => {
    const before = snapshot();
    const after = snapshot({ state: "MERGED", updatedAt: "2026-10-10T11:00:00Z" });
    const prompt = buildPrUpdatePrompt({
      prNumber: 1316,
      title: after.title,
      url: after.url,
      updates: diffPrSnapshots(before, after),
      tr,
    });
    expect(prompt).toContain("PR state: OPEN → MERGED");
    expect(prompt).not.toContain("## Comment");
    expect(prompt).not.toContain("## Failed checks");
    // A wake with no comment / CI block still carries the PR URL.
    expect(prompt).toContain(after.url);
  });

  it("keeps the composed turn multi-line (headings stay on their own lines)", () => {
    const before = snapshot();
    const after = snapshot({
      updatedAt: "2026-10-10T09:30:00Z",
      comments: [brief({ id: "c2", excerpt: "Please rebase on main." }), brief()],
    });
    const prompt = buildPrUpdatePrompt({
      prNumber: 1316,
      title: after.title,
      url: after.url,
      updates: diffPrSnapshots(before, after),
      newestComment: {
        author: "RongleCat",
        body: "Please rebase on main.\n\nSecond paragraph.",
        kind: "comment",
      },
      tr,
    });
    const lines = prompt.split("\n");
    expect(lines[0]).toContain("[PR update] #1316");
    expect(lines).toContain("## Comment");
    expect(lines).toContain("### Body");
    expect(lines).toContain("- Author: RongleCat");
    expect(lines).toContain("Please rebase on main.");
    expect(lines).toContain("Second paragraph.");
    // The task instruction is its own section, not glued to the previous line.
    expect(lines.some((l) => l.startsWith("Follow up on this PR update now"))).toBe(
      true,
    );
    expect(prompt).toContain("\n\n");
  });

  it("omits the URL header suffix when the URL is unknown", () => {
    const before = snapshot();
    const after = snapshot({ mergeable: "CONFLICTING", updatedAt: "2026-10-10T12:00:00Z" });
    const prompt = buildPrUpdatePrompt({
      prNumber: 1316,
      title: after.title,
      url: "",
      updates: diffPrSnapshots(before, after),
      tr,
    });
    expect(prompt.split("\n")[0]).toBe(
      "[PR update] #1316 feat(tasks): follow live subagent runs in the Tasks panel",
    );
  });

  it("returns an empty string when there is nothing to follow up on", () => {
    expect(
      buildPrUpdatePrompt({ prNumber: 1316, title: "x", updates: [], tr }),
    ).toBe("");
    expect(
      buildPrUpdatePrompt({ prNumber: 0, title: "x", updates: [], tr }),
    ).toBe("");
  });

  it("localizes the wake turn (Chinese catalog drives the same path)", () => {
    const zh = createT("zh");
    const before = snapshot();
    const after = snapshot({
      comments: [brief({ id: "c9", excerpt: "请先 rebase。" }), brief()],
      updatedAt: "2026-10-10T12:00:00Z",
    });
    const updates = diffPrSnapshots(before, after);
    const prompt = buildPrUpdatePrompt({
      prNumber: 1316,
      title: after.title,
      updates,
      tr: zh,
    });
    expect(prompt).toContain("[PR 更新] #1316");
    expect(prompt).toContain("变更内容：");
    expect(prompt).toContain("请先 rebase。");
    expect(describePrUpdate(updates[0], zh)).toContain("的新评论");
  });

  it("renders a localized checks line and an empty one without checks", () => {
    const summary = snapshot().checks;
    expect(formatChecksLine(summary, tr)).toBe("4 pass");
    expect(
      formatChecksLine(
        { pass: 2, fail: 1, pending: 3, skipping: 0, cancel: 0, total: 6, overall: "mixed" },
        tr,
      ),
    ).toBe("2 pass · 1 fail · 3 pending");
    expect(formatChecksLine(null, tr)).toBe("");
    expect(formatChecksLine({ ...summary, total: 0 }, tr)).toBe("");
  });
});

describe("wake delivery policy", () => {
  it("flushes only when the session is idle and something is queued", () => {
    expect(shouldFlushPending(true, 2)).toBe(false);
    expect(shouldFlushPending(false, 0)).toBe(false);
    expect(shouldFlushPending(false, 1)).toBe(true);
  });

  it("retries a failed wake once, then gives up", () => {
    expect(shouldRetryWake(0)).toBe(true);
    expect(shouldRetryWake(1)).toBe(false);
    expect(shouldRetryWake(5)).toBe(false);
  });
});

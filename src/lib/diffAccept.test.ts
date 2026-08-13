import { describe, expect, it } from "vitest";
import {
  applyHunks,
  applySelectedHunks,
  applyUnifiedPatch,
  batchItemFromCheckoutFailure,
  batchSkipReasonMessageKey,
  batchSummaryVars,
  canAcceptWithContent,
  canFallbackToBeforeWrite,
  canRejectWithBefore,
  canRestoreAfter,
  classifyGitCheckoutFailure,
  describeBatchPlanHonesty,
  diffActionDisabledMessageKey,
  diffActionTip,
  gitCheckoutFailMessageKey,
  isAlreadyDecided,
  isConflictKind,
  needsUntrackedWipeConfirm,
  parseUnifiedDiff,
  planBatchAccept,
  planBatchFileAccept,
  planBatchFileReject,
  planBatchReject,
  planBatchRemainingHunks,
  planFileAccept,
  planFileActionGates,
  planFileReject,
  planFileRestore,
  planHunkActionGates,
  preferGitCheckoutReject,
  rebuildDiffViewAfterHunkAccept,
  rejectSelectedHunks,
  remainingHunkIndices,
  resolveDiffAfterSource,
  reverseHunks,
  splitPatchLines,
  summarizeBatchResults,
} from "./diffAccept";

const SAMPLE_DIFF = `--- a/hello.txt
+++ b/hello.txt
@@ -1,3 +1,3 @@
 line1
-line2
+line2-edited
 line3
`;

describe("splitPatchLines", () => {
  it("drops trailing empty from final newline", () => {
    expect(splitPatchLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitPatchLines("")).toEqual([]);
  });
});

describe("parseUnifiedDiff", () => {
  it("parses path and hunk body", () => {
    const p = parseUnifiedDiff(SAMPLE_DIFF);
    expect(p.filePath).toBe("hello.txt");
    expect(p.hunks).toHaveLength(1);
    expect(p.hunks[0]!.oldStart).toBe(1);
    expect(p.hunks[0]!.oldCount).toBe(3);
    expect(p.hunks[0]!.newStart).toBe(1);
    expect(p.hunks[0]!.newCount).toBe(3);
    expect(p.hunks[0]!.lines.some((l) => l.startsWith("-line2"))).toBe(true);
    expect(p.hunks[0]!.lines.some((l) => l.startsWith("+line2-edited"))).toBe(
      true,
    );
  });

  it("returns empty hunks for garbage", () => {
    expect(parseUnifiedDiff("not a diff").hunks).toEqual([]);
  });
});

describe("applyUnifiedPatch / applyHunks", () => {
  it("applies a simple substitution", () => {
    const original = "line1\nline2\nline3\n";
    const r = applyUnifiedPatch(original, SAMPLE_DIFF);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).toBe("line1\nline2-edited\nline3\n");
    }
  });

  it("fails on context mismatch", () => {
    const original = "line1\nOTHER\nline3\n";
    const r = applyUnifiedPatch(original, SAMPLE_DIFF);
    expect(r.ok).toBe(false);
  });

  it("applies pure addition hunk", () => {
    const diff = `--- a/f
+++ b/f
@@ -0,0 +1,2 @@
+alpha
+beta
`;
    const r = applyUnifiedPatch("", diff);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content).toBe("alpha\nbeta\n");
  });

  it("applies pure deletion hunk", () => {
    const diff = `--- a/f
+++ b/f
@@ -1,2 +0,0 @@
-alpha
-beta
`;
    const r = applyUnifiedPatch("alpha\nbeta\n", diff);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content).toBe("");
  });
});

describe("reverseHunks / rejectSelectedHunks", () => {
  it("reverses an applied patch", () => {
    const original = "line1\nline2\nline3\n";
    const applied = applyUnifiedPatch(original, SAMPLE_DIFF);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const hunks = parseUnifiedDiff(SAMPLE_DIFF).hunks;
    const back = reverseHunks(applied.content, hunks);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.content).toBe(original);
  });

  it("rejectSelectedHunks undoes only chosen indices", () => {
    const original = "a\nb\nc\nd\n";
    const diff = `--- a/f
+++ b/f
@@ -1,2 +1,2 @@
-a
+A
 b
@@ -3,2 +3,2 @@
-c
+C
 d
`;
    const hunks = parseUnifiedDiff(diff).hunks;
    expect(hunks).toHaveLength(2);
    const all = applyHunks(original, hunks);
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    // Reject only first hunk → A→a, keep C
    const partial = rejectSelectedHunks(all.content, hunks, [0]);
    expect(partial.ok).toBe(true);
    if (partial.ok) expect(partial.content).toBe("a\nb\nC\nd\n");
  });
});

describe("applySelectedHunks", () => {
  const TWO_HUNK_DIFF = `--- a/f
+++ b/f
@@ -1,2 +1,2 @@
-a
+A
 b
@@ -3,2 +3,2 @@
-c
+C
 d
`;

  it("applies only selected indices", () => {
    const original = "a\nb\nc\nd\n";
    const hunks = parseUnifiedDiff(TWO_HUNK_DIFF).hunks;
    const r = applySelectedHunks(original, hunks, [1]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content).toBe("a\nb\nC\nd\n");
  });

  it("sequential accept composes and restorable is the full after", () => {
    const original = "a\nb\nc\nd\n";
    const hunks = parseUnifiedDiff(TWO_HUNK_DIFF).hunks;
    const full = applyHunks(original, hunks);
    expect(full.ok).toBe(true);
    if (!full.ok) return;
    const first = applySelectedHunks(original, hunks, [0]);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applySelectedHunks(first.content, hunks, [1]);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const both = applySelectedHunks(original, hunks, [0, 1]);
    expect(both.ok).toBe(true);
    if (!both.ok) return;
    expect(second.content).toBe(both.content);
    expect(full.content).toBe(both.content);

    const cache: Record<string, string> = { "/proj/f": full.content };
    expect(
      resolveDiffAfterSource({
        key: "/proj/f",
        diffView: { path: "/proj/f", afterText: first.content },
        cache,
        preferCache: true,
      }),
    ).toBe(full.content);

    const rebuilt = rebuildDiffViewAfterHunkAccept({
      fileName: "f",
      written: first.content,
      fullAfter: full.content,
    });
    expect(rebuilt.beforeText).toBe(first.content);
    expect(rebuilt.afterText).toBe(full.content);
    const remaining = parseUnifiedDiff(rebuilt.unified).hunks;
    expect(remaining.length).toBeGreaterThan(0);
    const fromView = applySelectedHunks(rebuilt.beforeText, remaining, [0]);
    expect(fromView.ok).toBe(true);
    if (fromView.ok) expect(fromView.content).toBe(full.content);
  });

  it("does not invent a trailing newline when the source lacked one", () => {
    const original = "a\nb\nc";
    const hunks = parseUnifiedDiff(TWO_HUNK_DIFF).hunks;
    const r = applySelectedHunks(original, hunks, [0]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content.endsWith("\n")).toBe(false);
    expect(r.content).toBe("A\nb\nc");
    const rejected = rejectSelectedHunks("A\nb\nC\nd", hunks, [1]);
    expect(rejected.ok).toBe(true);
    if (rejected.ok) {
      expect(rejected.content.endsWith("\n")).toBe(false);
      expect(rejected.content).toBe("A\nb\nc\nd");
    }
  });
});

describe("resolveDiffAfterSource", () => {
  it("does not use another file's open after-text (accept B while viewing A)", () => {
    const after = resolveDiffAfterSource({
      key: "/proj/b.ts",
      diffView: { path: "/proj/a.ts", afterText: "CONTENT_OF_A" },
      cache: {},
    });
    expect(after).toBeNull();
    expect(planFileAccept({ after })).toEqual({ mode: "keep_current" });
  });

  it("uses override, then path-matched view, then cache", () => {
    expect(
      resolveDiffAfterSource({
        key: "/proj/a.ts",
        override: "OVERRIDE",
        diffView: { path: "/proj/a.ts", afterText: "VIEW" },
        cache: { "/proj/a.ts": "CACHE" },
      }),
    ).toBe("OVERRIDE");
    expect(
      resolveDiffAfterSource({
        key: "/proj/a.ts",
        diffView: { path: "/proj/a.ts", afterText: "VIEW" },
        cache: { "/proj/a.ts": "CACHE" },
      }),
    ).toBe("VIEW");
    expect(
      resolveDiffAfterSource({
        key: "/proj/b.ts",
        diffView: { path: "/proj/a.ts", afterText: "VIEW" },
        cache: { "/proj/b.ts": "CACHE_B" },
      }),
    ).toBe("CACHE_B");
  });

  it("cache is only for the matched path (never another file's body)", () => {
    const after = resolveDiffAfterSource({
      key: "/proj/b.ts",
      diffView: { path: "/proj/a.ts", afterText: "CONTENT_OF_A" },
      cache: { "/proj/a.ts": "CONTENT_OF_A" },
    });
    expect(after).toBeNull();
  });

  it("restore prefers cache over a path-matched view", () => {
    expect(
      resolveDiffAfterSource({
        key: "/proj/a.ts",
        diffView: { path: "/proj/a.ts", afterText: "VIEW" },
        cache: { "/proj/a.ts": "CACHED_FULL" },
        preferCache: true,
      }),
    ).toBe("CACHED_FULL");
  });

  describe("A3 regression: partial hunk accept does not corrupt other files' restorable cache", () => {
    it("accepting hunk on file B does not overwrite file A's restorable cache", () => {
      const cacheBefore = { "/proj/a.ts": "FULL_A_AFTER" };
      const bDiffView = {
        path: "/proj/b.ts",
        afterText: "PARTIAL_B_AFTER_HUNK0",
      };
      const bAfter = resolveDiffAfterSource({
        key: "/proj/b.ts",
        diffView: bDiffView,
        cache: cacheBefore,
      });
      expect(bAfter).toBe("PARTIAL_B_AFTER_HUNK0");
      const cacheAfter = {
        ...cacheBefore,
        "/proj/b.ts": "FULL_B_AFTER",
      };
      const aAfter = resolveDiffAfterSource({
        key: "/proj/a.ts",
        diffView: bDiffView,
        cache: cacheAfter,
        preferCache: true,
      });
      expect(aAfter).toBe("FULL_A_AFTER");
    });

    it("A3: rebuildDiffViewAfterHunkAccept keeps full after in rebuilt view", () => {
      const fullAfter = "A\nB\nC\nD\n";
      const written = "A\nb\nc\nd\n";
      const rebuilt = rebuildDiffViewAfterHunkAccept({
        fileName: "f.txt",
        written,
        fullAfter,
      });
      expect(rebuilt.beforeText).toBe(written);
      expect(rebuilt.afterText).toBe(fullAfter);
      const remaining = parseUnifiedDiff(rebuilt.unified).hunks;
      expect(remaining.length).toBe(3);
      const composed = applySelectedHunks(written, remaining, [0, 1, 2]);
      expect(composed.ok).toBe(true);
      if (composed.ok) expect(composed.content).toBe(fullAfter);
    });

    it("A3: partial accept on file A does not contaminate cache entry for file B", () => {
      const cacheBefore = { "/proj/b.ts": "FULL_B_AFTER" };
      const aPartialAfter = "A_part1\nb\nc\nd\n";
      const aAfter = resolveDiffAfterSource({
        key: "/proj/a.ts",
        diffView: { path: "/proj/a.ts", afterText: aPartialAfter },
        cache: cacheBefore,
      });
      expect(aAfter).toBe(aPartialAfter);
      const cacheAfter = { ...cacheBefore, "/proj/a.ts": aPartialAfter };
      const bAfter = resolveDiffAfterSource({
        key: "/proj/b.ts",
        diffView: { path: "/proj/a.ts", afterText: aPartialAfter },
        cache: cacheAfter,
        preferCache: true,
      });
      expect(bAfter).toBe("FULL_B_AFTER");
    });
  });
});

describe("safety / plans", () => {
  it("needsUntrackedWipeConfirm", () => {
    expect(needsUntrackedWipeConfirm("untracked")).toBe(true);
    expect(needsUntrackedWipeConfirm("added")).toBe(true);
    expect(needsUntrackedWipeConfirm("modified")).toBe(false);
    expect(needsUntrackedWipeConfirm(null)).toBe(false);
  });

  it("preferGitCheckoutReject", () => {
    expect(preferGitCheckoutReject(true, "modified")).toBe(true);
    expect(preferGitCheckoutReject(false, "modified")).toBe(false);
    expect(preferGitCheckoutReject(true, "ignored")).toBe(false);
  });

  it("content guards", () => {
    expect(canAcceptWithContent("x")).toBe(true);
    expect(canAcceptWithContent(null)).toBe(false);
    expect(canRejectWithBefore("")).toBe(true);
    expect(canRestoreAfter(undefined)).toBe(false);
  });

  it("planFileReject prefers git when available", () => {
    const p = planFileReject({
      hasGitRepo: true,
      kind: "modified",
      before: "old",
    });
    expect(p).toEqual({ mode: "git", confirmUntracked: false });
  });

  it("planFileReject requires confirm for untracked", () => {
    const p = planFileReject({
      hasGitRepo: true,
      kind: "untracked",
    });
    expect(p).toEqual({ mode: "git", confirmUntracked: true });
  });

  it("planFileReject falls back to before write without git", () => {
    const p = planFileReject({
      hasGitRepo: false,
      kind: "modified",
      before: "old\n",
    });
    expect(p).toEqual({ mode: "write_before", content: "old\n" });
  });

  it("planFileReject delete untracked without git", () => {
    const p = planFileReject({
      hasGitRepo: false,
      kind: "untracked",
      fileExists: true,
    });
    expect(p).toEqual({ mode: "delete", confirmUntracked: true });
  });

  it("planFileReject unavailable when no git and no before", () => {
    const p = planFileReject({ hasGitRepo: false, kind: "modified" });
    expect(p.mode).toBe("unavailable");
  });

  it("planFileAccept / restore", () => {
    expect(planFileAccept({ after: "new" })).toEqual({
      mode: "write_after",
      content: "new",
    });
    expect(planFileAccept({ alreadyApplied: true })).toEqual({
      mode: "keep_current",
    });
    expect(planFileAccept({})).toEqual({ mode: "keep_current" });
    expect(planFileRestore({ after: "x" }).mode).toBe("write_after");
    expect(planFileRestore({}).mode).toBe("unavailable");
  });
});

describe("batch plan", () => {
  it("isConflictKind / isAlreadyDecided", () => {
    expect(isConflictKind("conflict")).toBe(true);
    expect(isConflictKind("Conflict")).toBe(true);
    expect(isConflictKind("modified")).toBe(false);
    expect(isAlreadyDecided("accepted", "accept")).toBe(true);
    expect(isAlreadyDecided("accepted", "reject")).toBe(false);
    expect(isAlreadyDecided("rejected", "reject")).toBe(true);
    expect(isAlreadyDecided(null, "accept")).toBe(false);
  });

  it("planBatchFileAccept skips conflict and already decided", () => {
    expect(
      planBatchFileAccept({ path: "a.ts", kind: "conflict" }).outcome.kind,
    ).toBe("skip");
    expect(
      planBatchFileAccept({
        path: "a.ts",
        decision: "accepted",
        after: "x",
      }).outcome.kind,
    ).toBe("skip");
    const ok = planBatchFileAccept({ path: "a.ts", after: "new" });
    expect(ok.outcome.kind).toBe("run");
    if (ok.outcome.kind === "run") {
      expect(ok.outcome.run.action).toBe("accept");
      expect(ok.outcome.run.plan.mode).toBe("write_after");
    }
  });

  it("planBatchFileAccept keep_current without after still runs", () => {
    const p = planBatchFileAccept({ path: "a.ts", kind: "modified" });
    expect(p.outcome.kind).toBe("run");
    if (p.outcome.kind === "run") {
      expect(p.outcome.run.plan.mode).toBe("keep_current");
    }
  });

  it("planBatchFileReject flags untracked wipe confirm", () => {
    const p = planBatchFileReject(
      { path: "new.ts", kind: "untracked", name: "new.ts" },
      { hasGitRepo: true },
    );
    expect(p.outcome.kind).toBe("run");
    if (p.outcome.kind === "run" && p.outcome.run.action === "reject") {
      expect(p.outcome.run.needsUntrackedConfirm).toBe(true);
    }
  });

  it("planBatchFileReject skips conflict", () => {
    const p = planBatchFileReject(
      { path: "c.ts", kind: "conflict" },
      { hasGitRepo: true },
    );
    expect(p.outcome).toMatchObject({ kind: "skip", reason: "conflict" });
  });

  it("planBatchAccept aggregates session remaining", () => {
    const plan = planBatchAccept(
      [
        { path: "ok.ts", after: "a", kind: "modified" },
        { path: "done.ts", after: "b", decision: "accepted" },
        { path: "bad.ts", kind: "conflict" },
        { path: "", name: "empty" },
      ],
      { scope: "session" },
    );
    expect(plan.canRun).toBe(true);
    expect(plan.runCount).toBe(1);
    expect(plan.skipCount).toBe(3);
    expect(plan.run[0]!.path).toBe("ok.ts");
  });

  it("planBatchReject separates untracked confirm", () => {
    const plan = planBatchReject(
      [
        { path: "m.ts", kind: "modified", before: "old" },
        { path: "u.ts", kind: "untracked" },
        { path: "c.ts", kind: "conflict" },
      ],
      { hasGitRepo: true, scope: "session" },
    );
    expect(plan.runCount).toBe(2);
    expect(plan.untrackedConfirmCount).toBe(1);
    expect(plan.needsUntrackedConfirm[0]!.path).toBe("u.ts");
    expect(plan.skipped).toHaveLength(1);
  });

  it("remainingHunkIndices excludes resolved", () => {
    expect(remainingHunkIndices(3, [])).toEqual([0, 1, 2]);
    expect(remainingHunkIndices(3, [1])).toEqual([0, 2]);
    expect(remainingHunkIndices(3, [0, 1, 2])).toEqual([]);
    expect(remainingHunkIndices(0)).toEqual([]);
  });

  it("planBatchRemainingHunks accept applies selected", () => {
    const original = "a\nb\nc\nd\n";
    const diff = `--- a/f
+++ b/f
@@ -1,2 +1,2 @@
-a
+A
 b
@@ -3,2 +3,2 @@
-c
+C
 d
`;
    const hunks = parseUnifiedDiff(diff).hunks;
    const all = applyHunks(original, hunks);
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    const plan = planBatchRemainingHunks({
      action: "accept",
      hunks,
      before: original,
      resolvedIndices: [0], // only second remaining
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.indices).toEqual([1]);
      expect(plan.content).toBe("a\nb\nC\nd\n");
    }
    const rej = planBatchRemainingHunks({
      action: "reject",
      hunks,
      after: all.content,
      resolvedIndices: [],
    });
    expect(rej.ok).toBe(true);
    if (rej.ok) expect(rej.content).toBe(original);
  });

  it("planBatchRemainingHunks no remaining / missing snapshot", () => {
    expect(
      planBatchRemainingHunks({
        action: "accept",
        hunks: parseUnifiedDiff(SAMPLE_DIFF).hunks,
        resolvedIndices: [0],
        before: "x",
      }).ok,
    ).toBe(false);
    expect(
      planBatchRemainingHunks({
        action: "accept",
        hunks: parseUnifiedDiff(SAMPLE_DIFF).hunks,
        before: null,
      }),
    ).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("summarizeBatchResults + batchSummaryVars", () => {
    const s = summarizeBatchResults("accept", [
      { path: "a", name: "a", status: "ok" },
      { path: "b", name: "b", status: "soft_fail", reason: "write" },
      { path: "c", name: "c", status: "skipped", reason: "conflict" },
      { path: "d", name: "d", status: "error" },
    ]);
    expect(s).toMatchObject({
      ok: 1,
      softFail: 1,
      skipped: 1,
      error: 1,
      total: 4,
    });
    expect(batchSummaryVars(s)).toEqual({
      ok: "1",
      fail: "2",
      skipped: "1",
      total: "4",
    });
  });

  it("describeBatchPlanHonesty partial + empty", () => {
    const empty = describeBatchPlanHonesty(
      planBatchAccept([{ path: "a.ts", decision: "accepted" }], {
        scope: "session",
      }),
    );
    expect(empty.canRun).toBe(false);
    expect(empty.emptyReasonKey).toBe("changes.batchNothingRemaining");

    const partial = describeBatchPlanHonesty(
      planBatchAccept(
        [
          { path: "ok.ts", after: "x" },
          { path: "done.ts", decision: "accepted", after: "y" },
          { path: "c.ts", kind: "conflict" },
        ],
        { scope: "session" },
      ),
    );
    expect(partial.canRun).toBe(true);
    expect(partial.partial).toBe(true);
    expect(partial.runCount).toBe(1);
    expect(partial.skipCount).toBe(2);
    expect(partial.readyKey).toBe("changes.batchPartialReady");

    const wipe = describeBatchPlanHonesty(
      planBatchReject([{ path: "u.ts", kind: "untracked" }], {
        hasGitRepo: true,
      }),
    );
    expect(wipe.needsUntrackedConfirm).toBe(true);
    expect(wipe.untrackedConfirmCount).toBe(1);
  });

  it("batchSkipReasonMessageKey", () => {
    expect(batchSkipReasonMessageKey("conflict")).toBe(
      "changes.disabled.conflict",
    );
    expect(batchSkipReasonMessageKey("already_decided")).toBe(
      "changes.batchSkip.alreadyDecided",
    );
  });
});

describe("action gates honesty", () => {
  it("planFileActionGates need project / tauri / busy", () => {
    expect(
      planFileActionGates({ hasProject: false, isTauri: true }).restore
        .reason,
    ).toBe("need_project");
    expect(
      planFileActionGates({ hasProject: true, isTauri: false }).accept
        .reason,
    ).toBe("need_tauri");
    expect(
      planFileActionGates({
        hasProject: true,
        isTauri: true,
        busy: true,
      }).reject.reason,
    ).toBe("busy");
  });

  it("restore disabled without after; accept still enabled", () => {
    const g = planFileActionGates({
      hasProject: true,
      isTauri: true,
      hasGitRepo: true,
      after: null,
      before: "old",
    });
    expect(g.restore).toEqual({
      disabled: true,
      reason: "no_after_snapshot",
    });
    expect(g.accept.disabled).toBe(false);
    expect(g.reject.disabled).toBe(false);
  });

  it("reject disabled without git and without before", () => {
    const g = planFileActionGates({
      hasProject: true,
      isTauri: true,
      hasGitRepo: false,
      kind: "modified",
      before: null,
    });
    expect(g.reject).toEqual({
      disabled: true,
      reason: "no_reject_path",
    });
  });

  it("conflict and already decided", () => {
    const c = planFileActionGates({
      hasProject: true,
      isTauri: true,
      hasGitRepo: true,
      kind: "conflict",
      after: "x",
    });
    expect(c.accept.reason).toBe("conflict");
    expect(c.reject.reason).toBe("conflict");
    expect(c.restore.disabled).toBe(false);

    const a = planFileActionGates({
      hasProject: true,
      isTauri: true,
      hasGitRepo: true,
      decision: "accepted",
      after: "x",
    });
    expect(a.accept.reason).toBe("already_accepted");
  });

  it("planHunkActionGates needs before/after snapshots", () => {
    const noBefore = planHunkActionGates({
      hasProject: true,
      isTauri: true,
      hunkCount: 2,
      before: null,
      after: "new",
    });
    expect(noBefore.accept.reason).toBe("no_before_snapshot");
    expect(noBefore.reject.disabled).toBe(false);
    expect(noBefore.acceptAll.reason).toBe("no_before_snapshot");

    const noAfter = planHunkActionGates({
      hasProject: true,
      isTauri: true,
      hunkCount: 2,
      before: "old",
      after: null,
    });
    expect(noAfter.reject.reason).toBe("no_after_snapshot");

    const none = planHunkActionGates({
      hasProject: true,
      isTauri: true,
      hunkCount: 0,
    });
    expect(none.accept.reason).toBe("no_hunks");
  });

  it("diffActionDisabledMessageKey + tip", () => {
    expect(diffActionDisabledMessageKey("no_after_snapshot")).toBe(
      "changes.disabled.noAfterSnapshot",
    );
    expect(
      diffActionTip(
        { disabled: true, reason: "busy" },
        "changes.restoreTip",
      ),
    ).toEqual({ messageKey: "changes.actionBusy", disabled: true });
    expect(
      diffActionTip(
        { disabled: false, reason: null },
        "changes.acceptTip",
      ),
    ).toEqual({ messageKey: "changes.acceptTip", disabled: false });
  });
});

describe("git checkout soft-fail classification", () => {
  it("classifies host reasons", () => {
    expect(
      classifyGitCheckoutFailure({
        ok: false,
        needsUntrackedConfirm: true,
      }),
    ).toBe("needs_untracked_confirm");
    expect(
      classifyGitCheckoutFailure({
        ok: false,
        reason: "not a git repository",
      }),
    ).toBe("not_a_git_repo");
    expect(
      classifyGitCheckoutFailure({
        ok: false,
        reason: "git not available",
      }),
    ).toBe("git_not_available");
    expect(
      classifyGitCheckoutFailure({
        ok: false,
        reason: "path not allowed: ../x",
      }),
    ).toBe("path_denied");
    expect(
      classifyGitCheckoutFailure({
        ok: false,
        reason: "refusing to delete untracked directory",
      }),
    ).toBe("untracked_dir");
    expect(
      classifyGitCheckoutFailure({
        ok: false,
        reason: "git checkout failed",
      }),
    ).toBe("checkout_failed");
    expect(
      classifyGitCheckoutFailure({
        ok: false,
        reason: "delete untracked: EACCES",
      }),
    ).toBe("delete_failed");
    expect(classifyGitCheckoutFailure({ ok: true })).toBeNull();
  });

  it("canFallbackToBeforeWrite only for missing git", () => {
    expect(canFallbackToBeforeWrite("not_a_git_repo")).toBe(true);
    expect(canFallbackToBeforeWrite("git_not_available")).toBe(true);
    expect(canFallbackToBeforeWrite("checkout_failed")).toBe(false);
    expect(canFallbackToBeforeWrite(null)).toBe(false);
  });

  it("gitCheckoutFailMessageKey + batchItemFromCheckoutFailure", () => {
    expect(gitCheckoutFailMessageKey("not_a_git_repo")).toBe(
      "changes.gitFail.notAGitRepo",
    );
    const soft = batchItemFromCheckoutFailure("a.ts", "a.ts", {
      ok: false,
      reason: "not a git repository",
    });
    expect(soft.status).toBe("soft_fail");
    expect(soft.reason).toBe("not_a_git_repo");
    const skip = batchItemFromCheckoutFailure("u.ts", "u.ts", {
      ok: false,
      needsUntrackedConfirm: true,
    });
    expect(skip.status).toBe("skipped");
  });
});

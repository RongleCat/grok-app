import { describe, expect, it } from "vitest";
import type { HookActivityRecord } from "./hooksDebug";
import {
  buildHooksActivityExport,
  classifyHooksExportError,
  formatHooksActivityExportText,
  HOOKS_ACTIVITY_EXPORT_MAX,
  hooksActivityExportIsEmpty,
  hooksActivityExportJsonFilename,
  hooksActivityExportTextFilename,
  hooksExportOutcomeMessageKey,
  planHooksActivityExport,
  resolveHooksExportOutcome,
  serializeHooksActivityExport,
} from "./hooksActivityExport";

function rec(
  partial: Partial<HookActivityRecord> & Pick<HookActivityRecord, "id">,
): HookActivityRecord {
  return {
    type: "PreToolUse",
    outcome: "ok",
    atMs: 1_700_000_000_000,
    detail: "exit 0",
    source: "host",
    ...partial,
  };
}

describe("planHooksActivityExport", () => {
  it("builds redacted JSON/text and empty honesty", () => {
    const rows: HookActivityRecord[] = [
      rec({
        id: "ha-1",
        type: "TryRun",
        outcome: "fail",
        detail: "hook failed key=sk-abcdefghijklmnop token: supersecretvalue123",
        source: "try",
        hookName: "demo.sh",
      }),
      rec({
        id: "ha-2",
        outcome: "ok",
        detail: "loaded from user",
        source: "stderr",
      }),
    ];

    const plan = planHooksActivityExport(rows, {
      generatedAt: "2026-08-01T12:00:00.000Z",
      outcomeFilter: "all",
    });

    expect(plan.empty).toBe(false);
    expect(plan.count).toBe(2);
    expect(plan.truncated).toBe(false);
    expect(plan.snapshot.kind).toBe("hooks_activity");
    expect(plan.snapshot.summary).toEqual({
      ok: 1,
      fail: 1,
      skip: 0,
      info: 0,
      total: 2,
    });
    expect(plan.filenameJson).toBe(
      "grok-app-hooks-activity-2026-08-01-12-00-00.json",
    );
    expect(plan.filenameText).toBe(
      "grok-app-hooks-activity-2026-08-01-12-00-00.txt",
    );

    const row0 = plan.snapshot.rows[0]!;
    expect(row0.detail).toContain("[REDACTED]");
    expect(row0.detail).not.toContain("sk-abcdefghijklmnop");
    expect(row0.detail).not.toContain("supersecretvalue123");
    expect(row0.hookName).toBe("demo.sh");

    expect(plan.json).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
    expect(plan.json).not.toContain("supersecretvalue123");
    expect(plan.text).toContain("# Hooks activity export (redacted)");
    expect(plan.text).toContain("[FAIL]");
    expect(plan.text).toContain("summary: total=2");
    expect(plan.text).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
  });

  it("soft-fails empty export without inventing rows", () => {
    const plan = planHooksActivityExport([]);
    expect(plan.empty).toBe(true);
    expect(plan.count).toBe(0);
    expect(plan.snapshot.rows).toEqual([]);
    expect(plan.text).toBe("");
    expect(hooksActivityExportIsEmpty(plan)).toBe(true);
    expect(hooksActivityExportIsEmpty(plan.snapshot)).toBe(true);
    expect(hooksActivityExportIsEmpty(null)).toBe(true);

    const emptySnap = buildHooksActivityExport(null);
    expect(emptySnap.count).toBe(0);
    expect(formatHooksActivityExportText([])).toBe("");
  });

  it("honors soft max rows cap and marks truncated", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      rec({ id: `ha-${i}`, detail: `row ${i}` }),
    );
    const plan = planHooksActivityExport(many, { max: 5 });
    expect(plan.count).toBe(5);
    expect(plan.truncated).toBe(true);
    expect(plan.snapshot.rows).toHaveLength(5);
    expect(plan.snapshot.summary.total).toBe(5);
  });

  it("dedupes by id and echoes outcome filter", () => {
    const rows = [
      rec({ id: "same", outcome: "fail", detail: "a" }),
      rec({ id: "same", outcome: "fail", detail: "b" }),
      rec({ id: "other", outcome: "skip", detail: "c" }),
    ];
    const snap = buildHooksActivityExport(rows, {
      outcomeFilter: "fail",
    });
    expect(snap.count).toBe(2);
    expect(snap.filter.outcome).toBe("fail");
    expect(snap.rows.map((r) => r.id)).toEqual(["same", "other"]);
  });

  it("skips invalid records", () => {
    const junk = { id: "x", type: "Hook" } as unknown as HookActivityRecord;
    const plan = planHooksActivityExport([junk, rec({ id: "good" })]);
    expect(plan.count).toBe(1);
    expect(plan.snapshot.rows[0]!.id).toBe("good");
  });

  it("default max is soft-capped constant", () => {
    expect(HOOKS_ACTIVITY_EXPORT_MAX).toBeGreaterThanOrEqual(30);
    expect(HOOKS_ACTIVITY_EXPORT_MAX).toBeLessThanOrEqual(500);
  });
});

describe("formatHooksActivityExportText", () => {
  it("formats rows and accepts a snapshot", () => {
    const rows = [
      rec({
        id: "ha-1",
        type: "SessionStart",
        outcome: "ok",
        detail: "loaded",
        source: "host",
        toolName: "bash",
      }),
    ];
    const textFromRows = formatHooksActivityExportText(rows, {
      generatedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(textFromRows).toContain("generatedAt: 2026-08-01T00:00:00.000Z");
    expect(textFromRows).toContain("[OK] SessionStart");
    expect(textFromRows).toContain("tool: bash");

    const snap = buildHooksActivityExport(rows, {
      generatedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(formatHooksActivityExportText(snap)).toContain("### 1/1");
    expect(serializeHooksActivityExport(snap)).toContain('"kind": "hooks_activity"');
  });
});

describe("classifyHooksExportError / resolveHooksExportOutcome", () => {
  it("classifies empty | clipboard | download | other", () => {
    expect(classifyHooksExportError(new Error("nothing to export"))).toBe(
      "empty",
    );
    expect(classifyHooksExportError(new Error("clipboard blocked"))).toBe(
      "clipboard",
    );
    expect(classifyHooksExportError(new Error("download failed"))).toBe(
      "download",
    );
    expect(classifyHooksExportError({ code: "download_failed" })).toBe(
      "download",
    );
    expect(classifyHooksExportError({ code: "clipboard" })).toBe("clipboard");
    expect(classifyHooksExportError({ code: "empty" })).toBe("empty");
    expect(classifyHooksExportError(new Error("weird boom"))).toBe("other");
    expect(classifyHooksExportError(null)).toBe("other");
  });

  it("resolves outcomes honestly and maps i18n keys", () => {
    expect(
      resolveHooksExportOutcome({
        channel: "copy",
        empty: true,
        copyOk: true,
      }),
    ).toEqual({ ok: false, kind: "empty", channel: "copy" });

    expect(
      resolveHooksExportOutcome({
        channel: "copy",
        empty: false,
        copyOk: false,
      }),
    ).toEqual({ ok: false, kind: "clipboard", channel: "copy" });

    expect(
      resolveHooksExportOutcome({
        channel: "download",
        empty: false,
        error: new Error("blob failed"),
      }),
    ).toEqual({ ok: false, kind: "download", channel: "download" });

    expect(
      resolveHooksExportOutcome({
        channel: "download",
        empty: false,
      }),
    ).toEqual({ ok: true, channel: "download" });

    expect(
      hooksExportOutcomeMessageKey({ ok: true, channel: "copy" }),
    ).toBe("ext.hooks.activity.exportCopied");
    expect(
      hooksExportOutcomeMessageKey({ ok: true, channel: "download" }),
    ).toBe("ext.hooks.activity.exportDownloaded");
    expect(
      hooksExportOutcomeMessageKey({
        ok: false,
        kind: "empty",
        channel: "copy",
      }),
    ).toBe("ext.hooks.activity.exportEmpty");
    expect(
      hooksExportOutcomeMessageKey({
        ok: false,
        kind: "clipboard",
        channel: "copy",
      }),
    ).toBe("ext.hooks.activity.exportCopyFailed");
    expect(
      hooksExportOutcomeMessageKey({
        ok: false,
        kind: "download",
        channel: "download",
      }),
    ).toBe("ext.hooks.activity.exportDownloadFailed");
    expect(
      hooksExportOutcomeMessageKey({
        ok: false,
        kind: "other",
        channel: "download",
      }),
    ).toBe("ext.hooks.activity.exportFailed");
  });
});

describe("filenames", () => {
  it("builds safe download basenames", () => {
    expect(
      hooksActivityExportJsonFilename("2026-08-01T12:34:56.000Z"),
    ).toBe("grok-app-hooks-activity-2026-08-01-12-34-56.json");
    expect(
      hooksActivityExportTextFilename("2026-08-01T12:34:56.000Z"),
    ).toBe("grok-app-hooks-activity-2026-08-01-12-34-56.txt");
  });
});

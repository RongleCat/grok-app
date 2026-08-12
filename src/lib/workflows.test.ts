import { describe, expect, it } from "vitest";
import {
  WORKFLOWS_ENABLED_CONFIG_KEY,
  WORKFLOW_RUN_LOG_MAX_CHARS,
  appendWorkflowRunLiveLog,
  buildWorkflowRunPrompt,
  collectWorkflowDefs,
  formatDiscoveredWorkflowNames,
  formatWorkflowRunElapsed,
  formatWorkflowRunStatusLine,
  grokHomeFromUserHome,
  isValidWorkflowName,
  isWorkflowDefinitionFileName,
  isWorkflowRunOk,
  normalizeWorkflowRunMode,
  normalizeWorkflowsEnabled,
  prepareWorkflowRunLogForDisplay,
  redactWorkflowRunLog,
  resolveWorkflowDirs,
  resolveWorkflowRunCopyText,
  resolveWorkflowRunHonestyNote,
  resolveWorkflowRunLogDelivery,
  truncateWorkflowRunLog,
  workflowMetaLine,
  workflowNameFromFileName,
  workflowNamesFromFileList,
  workflowRunLogDeliveryMessageKey,
  workflowRunReasonKey,
  workflowsEnabledEqual,
} from "./workflows";

describe("normalizeWorkflowsEnabled", () => {
  it("defaults off", () => {
    expect(normalizeWorkflowsEnabled(undefined)).toBe(false);
    expect(normalizeWorkflowsEnabled(null)).toBe(false);
    expect(normalizeWorkflowsEnabled(false)).toBe(false);
    expect(normalizeWorkflowsEnabled(true)).toBe(true);
  });

  it("equality after normalize", () => {
    expect(workflowsEnabledEqual(null, false)).toBe(true);
    expect(workflowsEnabledEqual(true, true)).toBe(true);
    expect(workflowsEnabledEqual(true, false)).toBe(false);
  });
});

describe("file name filters", () => {
  it("accepts .rhai only", () => {
    expect(isWorkflowDefinitionFileName("review-changes.rhai")).toBe(true);
    expect(isWorkflowDefinitionFileName("Foo.RHAI")).toBe(true);
    expect(isWorkflowDefinitionFileName("notes.md")).toBe(false);
    expect(isWorkflowDefinitionFileName(".hidden.rhai")).toBe(false);
    expect(isWorkflowDefinitionFileName("README.rhai")).toBe(false);
    expect(isWorkflowDefinitionFileName("")).toBe(false);
    expect(isWorkflowDefinitionFileName(null)).toBe(false);
  });

  it("stems names", () => {
    expect(workflowNameFromFileName("review-changes.rhai")).toBe(
      "review-changes",
    );
    expect(workflowNameFromFileName("path/to/find-flaky.rhai")).toBe(
      "find-flaky",
    );
  });

  it("lists unique sorted names", () => {
    expect(
      workflowNamesFromFileList([
        "b.rhai",
        "a.rhai",
        "a.rhai",
        "skip.md",
        ".x.rhai",
      ]),
    ).toEqual(["a", "b"]);
  });
});

describe("paths", () => {
  it("resolves user + project dirs", () => {
    const d = resolveWorkflowDirs("/Users/me", "/repo/app");
    expect(d.user).toBe("/Users/me/.grok/workflows");
    expect(d.project).toBe("/repo/app/.grok/workflows");
    expect(d.skillDoc).toContain("create-workflow");
    expect(d.skillDoc.endsWith("SKILL.md")).toBe(true);
  });

  it("handles missing project", () => {
    expect(resolveWorkflowDirs("/home/u").project).toBeNull();
    expect(grokHomeFromUserHome("/home/u")).toBe("/home/u/.grok");
  });
});

describe("collectWorkflowDefs", () => {
  it("prefers project over user on name clash", () => {
    const rows = collectWorkflowDefs({
      projectFiles: ["review.rhai"],
      userFiles: ["review.rhai", "other.rhai"],
      projectDir: "/p/.grok/workflows",
      userDir: "/h/.grok/workflows",
    });
    expect(rows.map((r) => r.name)).toEqual(["review", "other"]);
    expect(rows[0].scope).toBe("project");
    expect(rows[0].path).toContain("/p/");
    expect(rows[1].scope).toBe("user");
  });
});

describe("display helpers", () => {
  it("meta line and summary", () => {
    expect(
      workflowMetaLine({ name: "review", scope: "project" }),
    ).toContain("project");
    expect(formatDiscoveredWorkflowNames([])).toBeNull();
    expect(
      formatDiscoveredWorkflowNames([{ name: "a" }, { name: "b" }]),
    ).toBe("a, b");
    const many = Array.from({ length: 14 }, (_, i) => ({ name: `w${i}` }));
    const s = formatDiscoveredWorkflowNames(many, 3);
    expect(s).toContain("+11");
  });

  it("exports config key constant", () => {
    expect(WORKFLOWS_ENABLED_CONFIG_KEY).toBe("workflows_enabled");
  });
});

describe("workflow run helpers", () => {
  it("validates names", () => {
    expect(isValidWorkflowName("review-changes")).toBe(true);
    expect(isValidWorkflowName("Foo_Bar1")).toBe(true);
    expect(isValidWorkflowName("")).toBe(false);
    expect(isValidWorkflowName("../evil")).toBe(false);
    expect(isValidWorkflowName("a/b")).toBe(false);
    expect(isValidWorkflowName("has space")).toBe(false);
    expect(isValidWorkflowName("a".repeat(100))).toBe(false);
  });

  it("normalizes run mode", () => {
    expect(normalizeWorkflowRunMode(undefined)).toBe("validate");
    expect(normalizeWorkflowRunMode("validate")).toBe("validate");
    expect(normalizeWorkflowRunMode("launch")).toBe("launch");
    expect(normalizeWorkflowRunMode("run")).toBe("launch");
    expect(normalizeWorkflowRunMode("weird")).toBe("validate");
  });

  it("builds validate vs launch prompts", () => {
    const v = buildWorkflowRunPrompt("review-changes", "validate");
    expect(v).toContain('name: "review-changes"');
    expect(v).toContain("validate_only: true");
    expect(v).toContain("workflow tool");
    expect(v).not.toContain("agent_budget: 8");

    const l = buildWorkflowRunPrompt("review-changes", "launch");
    expect(l).toContain('name: "review-changes"');
    expect(l).toContain("agent_budget: 8");
    expect(l).not.toContain("validate_only");
  });

  it("redacts and truncates logs", () => {
    const red = redactWorkflowRunLog("token Bearer abcdefghijklmnop and sk-abcdefghijklmnopqrstuv");
    expect(red).toContain("[REDACTED]");
    expect(red).not.toContain("sk-abcdefghijklmnopqrstuv");

    const long = "x".repeat(WORKFLOW_RUN_LOG_MAX_CHARS + 50);
    const t = truncateWorkflowRunLog(long, 20);
    expect(t.truncated).toBe(true);
    expect(t.text.endsWith("…")).toBe(true);
    expect(t.text.length).toBeLessThanOrEqual(20);

    const prep = prepareWorkflowRunLogForDisplay(
      `ok Bearer ${"z".repeat(40)}\n` + "y".repeat(10),
      80,
    );
    expect(prep.text).toContain("[REDACTED]");
  });

  it("status line and reason keys", () => {
    expect(workflowRunReasonKey("timeout")).toBe("timeout");
    expect(workflowRunReasonKey("nope")).toBe("soft_fail");
    expect(isWorkflowRunOk({ ok: true, reason: "ok" })).toBe(true);
    expect(isWorkflowRunOk({ ok: false, reason: "timeout" })).toBe(false);
    expect(
      formatWorkflowRunStatusLine(
        { ok: false, reason: "timeout", durationMs: 1500 },
        { softFail: "soft-fail", reason: "timeout" },
      ),
    ).toContain("soft-fail: timeout");
    expect(
      formatWorkflowRunStatusLine({ ok: true, reason: "ok", durationMs: 200 }),
    ).toMatch(/ok/);
  });

  it("appends live progress lines and formats elapsed", () => {
    let log = "";
    log = appendWorkflowRunLiveLog(log, {
      kind: "status",
      line: "starting",
    });
    log = appendWorkflowRunLiveLog(log, { kind: "stdout", line: "hello" });
    log = appendWorkflowRunLiveLog(log, {
      kind: "stderr",
      line: "warn",
    });
    expect(log).toContain("· starting");
    expect(log).toContain("hello");
    expect(log).toContain("[stderr] warn");
    expect(formatWorkflowRunElapsed(1500)).toBe("1s");
    expect(formatWorkflowRunElapsed(65_000)).toBe("1m 05s");
  });
});

describe("workflow run log delivery honesty", () => {
  it("never claims live without progress events", () => {
    expect(
      resolveWorkflowRunLogDelivery({
        busy: true,
        sawProgress: false,
      }),
    ).toBe("awaiting");
    expect(
      resolveWorkflowRunLogDelivery({
        busy: true,
        sawProgress: true,
        liveLog: "line",
      }),
    ).toBe("live");
    expect(
      resolveWorkflowRunLogDelivery({
        busy: false,
        sawProgress: false,
        finalLog: "only final blob",
      }),
    ).toBe("batch");
    expect(
      resolveWorkflowRunLogDelivery({
        busy: false,
        sawProgress: true,
        liveLog: "streamed",
        finalLog: "final",
      }),
    ).toBe("live");
    expect(
      resolveWorkflowRunLogDelivery({
        busy: false,
        sawProgress: false,
        finalLog: "",
      }),
    ).toBe("none");
  });

  it("maps delivery to i18n keys", () => {
    expect(workflowRunLogDeliveryMessageKey("awaiting")).toBe(
      "settings.workflows.run.logAwaiting",
    );
    expect(workflowRunLogDeliveryMessageKey("live")).toBe(
      "settings.workflows.run.liveLogHint",
    );
    expect(workflowRunLogDeliveryMessageKey("batch")).toBe(
      "settings.workflows.run.batchLogHint",
    );
    expect(workflowRunLogDeliveryMessageKey("none")).toBe(
      "settings.workflows.run.noLog",
    );
  });

  it("soft-fail honesty for empty log, CLI missing, shared rewrite", () => {
    expect(
      resolveWorkflowRunHonestyNote({
        busy: false,
        ok: false,
        reason: "cli_missing",
        hasLog: false,
      }).kind,
    ).toBe("cli_missing");
    expect(
      resolveWorkflowRunHonestyNote({
        busy: false,
        ok: false,
        reason: "empty",
        hasLog: false,
      }).messageKey,
    ).toBe("settings.workflows.run.honesty.emptyLog");
    expect(
      resolveWorkflowRunHonestyNote({
        busy: false,
        ok: false,
        reason: "timeout",
        hasLog: false,
      }).kind,
    ).toBe("empty_log");
    expect(
      resolveWorkflowRunHonestyNote({
        busy: false,
        ok: false,
        reason: "nonzero_exit",
        hasLog: true,
        sessionDataMode: "shared",
      }).kind,
    ).toBe("shared_mode_no_rewrite");
    expect(
      resolveWorkflowRunHonestyNote({
        busy: false,
        ok: true,
        reason: "ok",
        hasLog: true,
        sessionDataMode: "shared",
      }).kind,
    ).toBe("none");
    expect(
      resolveWorkflowRunHonestyNote({
        busy: true,
        ok: false,
        reason: "cli_missing",
      }).kind,
    ).toBe("none");
  });

  it("prefers progressive buffer for copy text when live", () => {
    const live = resolveWorkflowRunCopyText({
      sawProgress: true,
      liveLog: "streamed line",
      finalLog: "final blob",
    });
    expect(live).toContain("streamed line");
    const batch = resolveWorkflowRunCopyText({
      sawProgress: false,
      liveLog: "",
      finalLog: "Bearer zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
    });
    expect(batch).toContain("[REDACTED]");
    expect(
      resolveWorkflowRunCopyText({
        sawProgress: false,
        finalLog: null,
      }),
    ).toBe("");
  });
});

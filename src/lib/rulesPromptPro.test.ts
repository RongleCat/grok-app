import { describe, expect, it } from "vitest";
import {
  SESSION_TEXT_NEAR_CAP_RATIO,
  classifyRulesPromptError,
  clampSessionTextInput,
  filterProjectRulesList,
  presentProjectRulesSoftFail,
  presentSessionPromptSoftFail,
  projectRuleDisplayPath,
  projectRuleKindChipLetter,
  projectRuleKindLabelKey,
  projectRuleRowTitleSpec,
  rulesPromptErrorMessageKey,
  rulesPromptErrorSeverity,
  sessionFieldMaxChars,
  sessionPromptLogMeta,
  sessionPromptSaveOutcome,
  sessionTextBudget,
  shouldConfirmSessionTextDiscard,
  summarizeProjectRules,
  validateProjectRuleDraft,
  validateSessionTextField,
} from "./rulesPromptPro";
import { SESSION_EXTRA_RULES_MAX_CHARS } from "./sessionExtraRules";
import { SESSION_SYSTEM_PROMPT_MAX_CHARS } from "./sessionSystemPrompt";

describe("sessionFieldMaxChars", () => {
  it("matches field soft caps", () => {
    expect(sessionFieldMaxChars("system_prompt")).toBe(
      SESSION_SYSTEM_PROMPT_MAX_CHARS,
    );
    expect(sessionFieldMaxChars("extra_rules")).toBe(
      SESSION_EXTRA_RULES_MAX_CHARS,
    );
  });
});

describe("clampSessionTextInput", () => {
  it("strips NULs without clamping short text", () => {
    const r = clampSessionTextInput("a\0b\0c", 100);
    expect(r).toEqual({ value: "abc", clamped: false, nulStripped: true });
  });

  it("clamps to max and reports flags", () => {
    const r = clampSessionTextInput("hello world", 5);
    expect(r.value).toBe("hello");
    expect(r.clamped).toBe(true);
    expect(r.nulStripped).toBe(false);
  });

  it("preserves interior spaces (no trim on keystroke)", () => {
    expect(clampSessionTextInput("  hi  ", 100).value).toBe("  hi  ");
  });
});

describe("sessionTextBudget / validateSessionTextField", () => {
  it("marks empty drafts", () => {
    const v = validateSessionTextField({
      field: "system_prompt",
      draft: "   ",
      baseline: "",
    });
    expect(v.budget.empty).toBe(true);
    expect(v.status).toBe("empty");
    expect(v.sanitized).toBe("");
    expect(v.statusKey).toBe("session.promptStatus.empty");
  });

  it("marks will_clear when stored value is emptied", () => {
    const v = validateSessionTextField({
      field: "extra_rules",
      draft: "",
      baseline: "prefer tests",
      hadStored: true,
    });
    expect(v.status).toBe("will_clear");
    expect(v.dirty).toBe(true);
    expect(v.statusKey).toBe("session.promptStatus.willClear");
  });

  it("warns near and at cap", () => {
    const max = 100;
    const near = "x".repeat(Math.floor(max * SESSION_TEXT_NEAR_CAP_RATIO));
    const vNear = validateSessionTextField({
      field: "system_prompt",
      draft: near,
      maxLen: max,
    });
    expect(vNear.budget.nearCap).toBe(true);
    expect(vNear.status).toBe("near_cap");
    expect(vNear.severity).toBe("warn");

    const at = "y".repeat(max);
    const vAt = validateSessionTextField({
      field: "extra_rules",
      draft: at,
      maxLen: max,
    });
    expect(vAt.budget.atCap).toBe(true);
    expect(vAt.status).toBe("at_cap");
  });

  it("flags NUL strip as warn", () => {
    const v = validateSessionTextField({
      field: "system_prompt",
      draft: "be\0nice",
      maxLen: 64,
    });
    expect(v.budget.nulStripped).toBe(true);
    expect(v.sanitized).toBe("benice");
    expect(v.status).toBe("nul_stripped");
  });

  it("detects dirty vs baseline", () => {
    const clean = validateSessionTextField({
      field: "extra_rules",
      draft: "same",
      baseline: "same",
    });
    expect(clean.dirty).toBe(false);
    expect(shouldConfirmSessionTextDiscard(clean)).toBe(false);

    const dirty = validateSessionTextField({
      field: "extra_rules",
      draft: "changed",
      baseline: "same",
    });
    expect(dirty.dirty).toBe(true);
    expect(shouldConfirmSessionTextDiscard(dirty)).toBe(true);
  });

  it("budget remaining never goes negative", () => {
    const b = sessionTextBudget("system_prompt", "x".repeat(50), 10);
    expect(b.remaining).toBe(0);
    expect(b.rawLen).toBe(50);
  });
});

describe("sessionPromptSaveOutcome / logMeta", () => {
  it("returns cleared vs saved toast keys without body", () => {
    expect(sessionPromptSaveOutcome("system_prompt", null)).toEqual({
      kind: "cleared",
      logMeta: null,
      toastKey: "session.sysPromptCleared",
    });
    const saved = sessionPromptSaveOutcome("extra_rules", "  write tests  ");
    expect(saved.kind).toBe("saved");
    expect(saved.toastKey).toBe("session.rulesSaved");
    expect(saved.logMeta).toEqual({ field: "extra_rules", chars: 11 });
    expect(JSON.stringify(saved)).not.toContain("write tests");
  });

  it("sessionPromptLogMeta never includes body", () => {
    const meta = sessionPromptLogMeta("system_prompt", "sk-secret-value");
    expect(meta).toEqual({ field: "system_prompt", chars: 15 });
    expect(JSON.stringify(meta)).not.toContain("sk-");
    expect(sessionPromptLogMeta("extra_rules", "  ")).toBe(null);
  });
});

describe("classifyRulesPromptError", () => {
  it("classifies known soft-fail shapes", () => {
    expect(classifyRulesPromptError("x", { needTauri: true })).toBe(
      "need_tauri",
    );
    expect(classifyRulesPromptError("x", { needProject: true })).toBe(
      "need_project",
    );
    expect(classifyRulesPromptError("CONFLICT: mtime changed")).toBe(
      "conflict",
    );
    expect(classifyRulesPromptError("permission denied writing file")).toBe(
      "permission",
    );
    expect(classifyRulesPromptError("ENOENT: no such file")).toBe("not_found");
    expect(classifyRulesPromptError("file truncated for preview")).toBe(
      "truncated_readonly",
    );
    expect(classifyRulesPromptError("save failed: disk full")).toBe(
      "host_error",
    );
    expect(classifyRulesPromptError("weird")).toBe("other");
  });

  it("maps kinds to message keys and severity", () => {
    expect(rulesPromptErrorMessageKey("need_tauri", "project_rules")).toBe(
      "rules.needTauri",
    );
    expect(rulesPromptErrorMessageKey("need_tauri", "session_prompt")).toBe(
      "session.promptError.needTauri",
    );
    expect(rulesPromptErrorSeverity("conflict")).toBe("err");
    expect(rulesPromptErrorSeverity("truncated_readonly")).toBe("warn");
    expect(rulesPromptErrorSeverity("ok")).toBe("ok");
  });

  it("present helpers expose detail without inventing ok", () => {
    const p = presentProjectRulesSoftFail("permission denied");
    expect(p.kind).toBe("permission");
    expect(p.severity).toBe("err");
    expect(p.messageKey).toBe("rules.permissionDenied");
    expect(p.detail.toLowerCase()).toContain("permission");

    const s = presentSessionPromptSoftFail("invoke failed");
    expect(s.kind).toBe("host_error");
    expect(s.messageKey).toBe("session.promptError.host");
  });
});

describe("project rules list helpers", () => {
  const sample = [
    {
      name: "AGENTS.md",
      relativePath: "AGENTS.md",
      kind: "agents_md",
    },
    {
      name: "CLAUDE.md",
      relativePath: "CLAUDE.md",
      kind: "claude_md",
    },
    {
      name: "base.md",
      relativePath: ".grok/rules/base.md",
      kind: "grok_rules",
    },
    {
      name: "AGENTS.md",
      relativePath: ".grok/nested/AGENTS.md",
      kind: "nested_agents",
    },
  ];

  it("kind chip letters and label keys", () => {
    expect(projectRuleKindChipLetter("agents_md")).toBe("A");
    expect(projectRuleKindChipLetter("claude_md")).toBe("C");
    expect(projectRuleKindChipLetter("grok_rules")).toBe("G");
    expect(projectRuleKindChipLetter("nested_agents")).toBe("N");
    expect(projectRuleKindChipLetter("mystery")).toBe("R");
    expect(projectRuleKindLabelKey("agents_md")).toBe("rules.kind.agents_md");
    expect(projectRuleKindLabelKey("nope")).toBe("rules.title");
  });

  it("titles root files as this project and nested files by directory", () => {
    expect(
      projectRuleRowTitleSpec({
        name: "AGENTS.md",
        relativePath: "AGENTS.md",
        kind: "agents_md",
      }),
    ).toEqual({
      key: "rules.row.projectFile",
      params: { name: "AGENTS.md" },
    });
    expect(
      projectRuleRowTitleSpec({
        name: "AGENTS.md",
        relativePath: "/Users/me/.agents/AGENTS.md",
        absolutePath: "/Users/me/.agents/AGENTS.md",
        kind: "agents_md",
        scope: "user_agents",
      }),
    ).toEqual({
      key: "rules.row.userAgentsFile",
      params: { name: "AGENTS.md" },
    });
    expect(
      projectRuleRowTitleSpec({
        name: "AGENTS.md",
        relativePath: "/Users/me/.grok/AGENTS.md",
        absolutePath: "/Users/me/.grok/AGENTS.md",
        kind: "agents_md",
        scope: "grok_home",
      }),
    ).toEqual({
      key: "rules.row.cliHomeFile",
      params: { name: "AGENTS.md" },
    });
    expect(
      projectRuleRowTitleSpec({
        name: "AGENTS.md",
        relativePath: "/Users/me/Library/Application Support/com.grokapp.grok-app/agent-home/AGENTS.md",
        absolutePath:
          "/Users/me/Library/Application Support/com.grokapp.grok-app/agent-home/AGENTS.md",
        kind: "agents_md",
        scope: "grok_home",
      }),
    ).toEqual({
      key: "rules.row.appHomeFile",
      params: { name: "AGENTS.md" },
    });
    expect(
      projectRuleRowTitleSpec({
        name: "base.md",
        relativePath: ".grok/rules/base.md",
        kind: "grok_rules",
      }),
    ).toEqual({
      key: "rules.row.locatedFile",
      params: { dir: ".grok/rules", name: "base.md" },
    });
    expect(
      projectRuleRowTitleSpec({
        name: "AGENTS.md",
        relativePath: ".grok/nested/AGENTS.md",
        kind: "nested_agents",
      }),
    ).toEqual({
      key: "rules.row.locatedFile",
      params: { dir: ".grok/nested", name: "AGENTS.md" },
    });
  });

  it("prefers the absolute path for the row subtitle", () => {
    expect(
      projectRuleDisplayPath({
        name: "AGENTS.md",
        relativePath: "AGENTS.md",
        absolutePath: "/Users/me/Guessword.io/AGENTS.md",
        kind: "agents_md",
      }),
    ).toBe("/Users/me/Guessword.io/AGENTS.md");
    expect(
      projectRuleDisplayPath({
        name: "AGENTS.md",
        relativePath: "AGENTS.md",
        kind: "agents_md",
      }),
    ).toBe("AGENTS.md");
  });

  it("filters by name / path / kind", () => {
    expect(filterProjectRulesList(sample, "claude").map((r) => r.kind)).toEqual(
      ["claude_md"],
    );
    expect(
      filterProjectRulesList(sample, ".grok/rules").map((r) => r.relativePath),
    ).toEqual([".grok/rules/base.md"]);
    expect(filterProjectRulesList(sample, "nested_agents")).toHaveLength(1);
    expect(filterProjectRulesList(sample, "  ")).toHaveLength(4);
    expect(filterProjectRulesList(sample, "zzz")).toEqual([]);
  });

  it("summarizes by kind", () => {
    const sum = summarizeProjectRules(sample);
    expect(sum.total).toBe(4);
    expect(sum.missingCount).toBe(0);
    expect(sum.hasAgentsMd).toBe(true);
    expect(sum.hasClaudeMd).toBe(true);
    expect(sum.hasGrokRules).toBe(true);
    expect(sum.hasNestedAgents).toBe(true);
    expect(sum.byKind.agents_md).toBe(1);
    expect(sum.byKind.grok_rules).toBe(1);
  });

  it("counts placeholders separately and sorts existing first", () => {
    const withMissing = [
      {
        name: "AGENTS.md",
        relativePath: "/tmp/.agents/AGENTS.md",
        kind: "agents_md",
        scope: "user_agents",
        exists: false,
      },
      {
        name: "AGENTS.md",
        relativePath: "AGENTS.md",
        kind: "agents_md",
        scope: "project",
        exists: true,
      },
      {
        name: "AGENTS.md",
        relativePath: "/tmp/.grok/AGENTS.md",
        kind: "agents_md",
        scope: "grok_home",
        exists: false,
      },
    ];
    const sum = summarizeProjectRules(withMissing, true);
    expect(sum.total).toBe(1);
    expect(sum.missingCount).toBe(2);
    expect(
      filterProjectRulesList(withMissing, "").map((r) => r.scope),
    ).toEqual(["project", "grok_home", "user_agents"]);
  });

  it("respects hasAgentsMd hint over counts", () => {
    const sum = summarizeProjectRules(
      [{ name: "x", relativePath: "x", kind: "claude_md" }],
      true,
    );
    expect(sum.hasAgentsMd).toBe(true);
    expect(sum.hasClaudeMd).toBe(true);
  });
});

describe("validateProjectRuleDraft", () => {
  it("allows dirty non-empty save", () => {
    const v = validateProjectRuleDraft({
      draftText: "hello",
      baselineText: "",
    });
    expect(v.dirty).toBe(true);
    expect(v.canSave).toBe(true);
    expect(v.emptyWarn).toBe(false);
  });

  it("soft-warns empty dirty drafts without blocking", () => {
    const v = validateProjectRuleDraft({
      draftText: "   ",
      baselineText: "was here",
    });
    expect(v.empty).toBe(true);
    expect(v.emptyWarn).toBe(true);
    expect(v.canSave).toBe(true);
    expect(v.statusKey).toBe("rules.draftEmptyWarn");
    expect(v.severity).toBe("warn");
  });

  it("blocks save when truncated or busy", () => {
    expect(
      validateProjectRuleDraft({
        draftText: "x",
        baselineText: "y",
        truncated: true,
      }).canSave,
    ).toBe(false);
    expect(
      validateProjectRuleDraft({
        draftText: "x",
        baselineText: "y",
        saving: true,
      }).canSave,
    ).toBe(false);
    expect(
      validateProjectRuleDraft({
        draftText: "same",
        baselineText: "same",
      }).canSave,
    ).toBe(false);
  });
});

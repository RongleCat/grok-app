import { describe, expect, it } from "vitest";
import {
  DEMO_ASK_CHECKLIST,
  DEMO_ASK_DOCS_URL,
  buildDemoAskPrompt,
  buildSampleAskUserPayload,
  buildSampleAskUserQuestions,
  evaluateDemoAskChecklist,
  isDemoPathSettingsReady,
  isDemoYoloActive,
  planDemoPermissionPolicy,
  resolveDemoPathBlockers,
} from "./askUserDemoPath";

describe("planDemoPermissionPolicy", () => {
  it("recommends product Ask mode", () => {
    expect(planDemoPermissionPolicy()).toBe("ask");
  });
});

describe("buildDemoAskPrompt", () => {
  it("returns a short English clarification-oriented suggestion", () => {
    const prompt = buildDemoAskPrompt();
    expect(prompt.length).toBeGreaterThan(40);
    expect(prompt.length).toBeLessThan(500);
    expect(prompt.toLowerCase()).toMatch(/clarif|ask me|question/);
    // Never claims the agent will ask — suggestion only.
    expect(prompt.toLowerCase()).not.toMatch(/will ask you|guaranteed/);
  });
});

describe("isDemoYoloActive", () => {
  it("detects always_approve and yolo aliases", () => {
    expect(isDemoYoloActive({ policy: "always_approve" })).toBe(true);
    expect(isDemoYoloActive({ policy: "yolo" })).toBe(true);
    expect(isDemoYoloActive({ policy: "YOLO" })).toBe(true);
    expect(isDemoYoloActive({ policy: "ask" })).toBe(false);
    expect(isDemoYoloActive({ policy: "accept_edits" })).toBe(false);
  });

  it("honors explicit yolo flag", () => {
    expect(isDemoYoloActive({ policy: "ask", yolo: true })).toBe(true);
    // Explicit false still loses to always_approve policy.
    expect(isDemoYoloActive({ policy: "always_approve", yolo: false })).toBe(
      true,
    );
    expect(isDemoYoloActive({ policy: "ask", yolo: false })).toBe(false);
  });
});

describe("resolveDemoPathBlockers", () => {
  it("returns empty when path is ready", () => {
    expect(
      resolveDemoPathBlockers({
        policy: "ask",
        noAskUser: false,
        yolo: false,
      }),
    ).toEqual([]);
    expect(isDemoPathSettingsReady({ policy: "ask", noAskUser: false })).toBe(
      true,
    );
  });

  it("flags non-Ask policy", () => {
    const blockers = resolveDemoPathBlockers({
      policy: "accept_edits",
      noAskUser: false,
    });
    expect(blockers.map((b) => b.id)).toContain("policy_not_ask");
    expect(blockers.every((b) => b.messageKey.startsWith("settings.askDemo."))).toBe(
      true,
    );
  });

  it("flags YOLO / always_approve", () => {
    const blockers = resolveDemoPathBlockers({
      policy: "always_approve",
      noAskUser: false,
    });
    expect(blockers.map((b) => b.id)).toEqual(
      expect.arrayContaining(["policy_not_ask", "yolo_on"]),
    );
  });

  it("flags explicit yolo with Ask policy", () => {
    const blockers = resolveDemoPathBlockers({
      policy: "ask",
      yolo: true,
      noAskUser: false,
    });
    expect(blockers.map((b) => b.id)).toEqual(["yolo_on"]);
  });

  it("flags noAskUser", () => {
    const blockers = resolveDemoPathBlockers({
      policy: "ask",
      noAskUser: true,
    });
    expect(blockers.map((b) => b.id)).toEqual(["no_ask_user"]);
    expect(isDemoPathSettingsReady({ policy: "ask", noAskUser: true })).toBe(
      false,
    );
  });

  it("treats missing noAskUser as enabled (not a blocker)", () => {
    expect(
      resolveDemoPathBlockers({ policy: "ask", noAskUser: null }),
    ).toEqual([]);
    expect(resolveDemoPathBlockers({ policy: "ask" })).toEqual([]);
  });
});

describe("DEMO_ASK_CHECKLIST / evaluateDemoAskChecklist", () => {
  it("lists four ordered steps with i18n keys", () => {
    expect(DEMO_ASK_CHECKLIST.map((s) => s.id)).toEqual([
      "policy_ask",
      "not_yolo",
      "ask_user_enabled",
      "sample_prompt",
    ]);
    for (const step of DEMO_ASK_CHECKLIST) {
      expect(step.labelKey).toMatch(/^settings\.askDemo\./);
      expect(step.hintKey).toMatch(/^settings\.askDemo\./);
    }
  });

  it("marks all pass when ready", () => {
    const evals = evaluateDemoAskChecklist({
      policy: "ask",
      noAskUser: false,
      yolo: false,
    });
    expect(evals.every((e) => e.pass)).toBe(true);
  });

  it("fails settings gates under YOLO + noAskUser", () => {
    const evals = evaluateDemoAskChecklist({
      policy: "always_approve",
      noAskUser: true,
    });
    const byId = Object.fromEntries(evals.map((e) => [e.id, e.pass]));
    expect(byId.policy_ask).toBe(false);
    expect(byId.not_yolo).toBe(false);
    expect(byId.ask_user_enabled).toBe(false);
    expect(byId.sample_prompt).toBe(false);
  });

  it("sample_prompt ready only when settings gates pass", () => {
    const partial = evaluateDemoAskChecklist({
      policy: "ask",
      noAskUser: true,
    });
    expect(partial.find((e) => e.id === "policy_ask")?.pass).toBe(true);
    expect(partial.find((e) => e.id === "ask_user_enabled")?.pass).toBe(false);
    expect(partial.find((e) => e.id === "sample_prompt")?.pass).toBe(false);
  });
});

describe("buildSampleAskUserQuestions", () => {
  it("returns static multi-question demo payload shape", () => {
    const qs = buildSampleAskUserQuestions();
    expect(qs.length).toBeGreaterThanOrEqual(2);
    for (const q of qs) {
      expect(q.id).toBeTruthy();
      expect(q.question.toLowerCase()).toMatch(/demo/);
      expect(q.options.length).toBeGreaterThan(0);
      for (const opt of q.options) {
        expect(opt.id).toBeTruthy();
        expect(opt.label).toBeTruthy();
      }
    }
    expect(qs.some((q) => q.multiSelect)).toBe(true);
  });

  it("buildSampleAskUserPayload is preview-shaped (not a live rpc)", () => {
    const payload = buildSampleAskUserPayload();
    expect(payload.rpcId).toBe(-1);
    expect(payload.sessionId).toBe("demo-preview");
    expect(payload.questions).toEqual(buildSampleAskUserQuestions());
  });
});

describe("DEMO_ASK_DOCS_URL", () => {
  it("points at SPIKE-ACP ask_user docs", () => {
    expect(DEMO_ASK_DOCS_URL).toMatch(/SPIKE-ACP/);
    expect(DEMO_ASK_DOCS_URL).toMatch(/ask_user/);
  });
});

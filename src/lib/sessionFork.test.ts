import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildForkWorktreeName,
  canOfferForkAgentSession,
  canRestoreCodeOnFork,
  classifySessionForkError,
  defaultForkAgentChecked,
  FORK_SESSION_CLI_FLAG,
  forkRestoreGateMessageKey,
  forkSessionSpawnArgs,
  forkSuccessToastKey,
  isGitWorkingTreeDirty,
  isWorktreeNameCollisionError,
  keepForkDialogOpenOnSoftFail,
  planForkTrimmedFollowUp,
  resolveForkAgentCheckbox,
  resolveForkAgentSession,
  resolveForkCliOnConfirm,
  shouldOfferAssistantFork,
  shouldShowForkCliCheckbox,
  forkTrimmedToastKey,
  resolveSessionForkSoftFail,
  resumeRestoreGateMessageKey,
  resumeRestoreSuccessToastKey,
  sanitizeForkNameFragment,
  sessionForkSoftFailMessageKey,
  sessionForkSoftFailSilent,
  softFailKindFromRestoreGate,
} from "./sessionFork";

describe("forkSessionSpawnArgs / CLI --fork-session", () => {
  it("emits the top-level flag only when enabled", () => {
    expect(forkSessionSpawnArgs(false)).toEqual([]);
    expect(forkSessionSpawnArgs(true)).toEqual([FORK_SESSION_CLI_FLAG]);
    expect(FORK_SESSION_CLI_FLAG).toBe("--fork-session");
  });
});

describe("shouldOfferAssistantFork", () => {
  it("is idle completed assistant with a parent prompt", () => {
    expect(
      shouldOfferAssistantFork({
        streaming: false,
        turnLive: false,
        canRewindSession: true,
        parentPromptIndex: 0,
      }),
    ).toBe(true);
    expect(
      shouldOfferAssistantFork({
        streaming: true,
        turnLive: false,
        canRewindSession: true,
        parentPromptIndex: 0,
      }),
    ).toBe(false);
    expect(
      shouldOfferAssistantFork({
        streaming: false,
        turnLive: true,
        canRewindSession: true,
        parentPromptIndex: 0,
      }),
    ).toBe(false);
    expect(
      shouldOfferAssistantFork({
        streaming: false,
        turnLive: false,
        canRewindSession: false,
        parentPromptIndex: 0,
      }),
    ).toBe(false);
    expect(
      shouldOfferAssistantFork({
        streaming: false,
        turnLive: false,
        canRewindSession: true,
        parentPromptIndex: -1,
      }),
    ).toBe(false);
  });
});

describe("partial fork CLI checkbox / auto-arm", () => {
  it("hides CLI checkbox and auto-arms when an agent id exists", () => {
    expect(shouldShowForkCliCheckbox(0)).toBe(false);
    expect(shouldShowForkCliCheckbox(null)).toBe(true);
    expect(
      resolveForkCliOnConfirm({
        throughUserPromptIndex: 0,
        checkboxChecked: false,
        agentSessionId: "agent-1",
      }),
    ).toBe(true);
    expect(
      resolveForkCliOnConfirm({
        throughUserPromptIndex: 0,
        checkboxChecked: true,
        agentSessionId: null,
      }),
    ).toBe(false);
    expect(
      resolveForkCliOnConfirm({
        throughUserPromptIndex: null,
        checkboxChecked: true,
        agentSessionId: "agent-1",
      }),
    ).toBe(true);
    expect(
      resolveForkCliOnConfirm({
        throughUserPromptIndex: null,
        checkboxChecked: false,
        agentSessionId: "agent-1",
      }),
    ).toBe(false);
  });
});

describe("canOfferForkAgentSession", () => {
  it("requires a non-empty agent session id", () => {
    expect(canOfferForkAgentSession(null)).toBe(false);
    expect(canOfferForkAgentSession(undefined)).toBe(false);
    expect(canOfferForkAgentSession("")).toBe(false);
    expect(canOfferForkAgentSession("   ")).toBe(false);
    expect(canOfferForkAgentSession("abc-123")).toBe(true);
  });
});

describe("resolveForkAgentSession", () => {
  it("forks only when requested and source id present", () => {
    expect(
      resolveForkAgentSession({ wantFork: true, agentSessionId: "sid-1" }),
    ).toEqual({ fork: true, sourceAgentId: "sid-1" });
    expect(
      resolveForkAgentSession({ wantFork: false, agentSessionId: "sid-1" }),
    ).toEqual({ fork: false, sourceAgentId: "sid-1" });
    expect(
      resolveForkAgentSession({ wantFork: true, agentSessionId: "" }),
    ).toEqual({ fork: false, sourceAgentId: null });
    expect(
      resolveForkAgentSession({ wantFork: true, agentSessionId: "  " }),
    ).toEqual({ fork: false, sourceAgentId: null });
  });

  it("never returns fork:true without a source id (checkbox honesty)", () => {
    expect(
      resolveForkAgentSession({ wantFork: true, agentSessionId: null }),
    ).toEqual({ fork: false, sourceAgentId: null });
  });
});

describe("defaultForkAgentChecked / resolveForkAgentCheckbox", () => {
  it("defaults fork on and resume off when agent linked", () => {
    expect(defaultForkAgentChecked("sid", "fork")).toBe(true);
    expect(defaultForkAgentChecked("sid", "resume")).toBe(false);
  });

  it("defaults off when no agent session", () => {
    expect(defaultForkAgentChecked(null, "fork")).toBe(false);
    expect(defaultForkAgentChecked("", "resume")).toBe(false);
  });

  it("forces unavailable checkbox off + disabled with honest reason", () => {
    const state = resolveForkAgentCheckbox(null, "fork", true);
    expect(state.available).toBe(false);
    expect(state.checked).toBe(false);
    expect(state.disabled).toBe(true);
    expect(state.defaultChecked).toBe(false);
    expect(state.unavailableReasonKey).toBe("session.forkCliSessionNoAgent");
    expect(state.hintKey).toBe("session.forkCliSessionNoAgentHint");
  });

  it("respects live wantChecked only when available", () => {
    const on = resolveForkAgentCheckbox("sid", "fork", true);
    expect(on.available).toBe(true);
    expect(on.checked).toBe(true);
    expect(on.disabled).toBe(false);
    expect(on.hintKey).toBe("session.forkCliSessionHint");
    expect(on.unavailableReasonKey).toBeNull();

    const off = resolveForkAgentCheckbox("sid", "fork", false);
    expect(off.checked).toBe(false);

    const resume = resolveForkAgentCheckbox("sid", "resume");
    expect(resume.defaultChecked).toBe(false);
    expect(resume.checked).toBe(false);
    expect(resume.hintKey).toBe("session.resumeForkCliSessionHint");
  });
});

describe("isGitWorkingTreeDirty", () => {
  it("is false when unavailable or empty", () => {
    expect(isGitWorkingTreeDirty(null)).toBe(false);
    expect(isGitWorkingTreeDirty(undefined)).toBe(false);
    expect(isGitWorkingTreeDirty({ available: false, files: [{ path: "a" }] })).toBe(
      false,
    );
    expect(isGitWorkingTreeDirty({ available: true, files: [] })).toBe(false);
    expect(isGitWorkingTreeDirty({ available: true, files: null })).toBe(false);
  });

  it("is true when available and any files listed", () => {
    expect(
      isGitWorkingTreeDirty({
        available: true,
        files: [{ path: "src/a.ts" }],
      }),
    ).toBe(true);
    expect(
      isGitWorkingTreeDirty({
        available: true,
        files: [{}, {}],
      }),
    ).toBe(true);
  });
});

describe("canRestoreCodeOnFork", () => {
  it("requires a project path", () => {
    expect(canRestoreCodeOnFork("", { available: true, files: [] })).toEqual({
      ok: false,
      reason: "no_project",
    });
    expect(canRestoreCodeOnFork(null, { available: true, files: [] })).toEqual({
      ok: false,
      reason: "no_project",
    });
  });

  it("requires available git status", () => {
    expect(
      canRestoreCodeOnFork("/repo", { available: false, reason: "not a repo" }),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(canRestoreCodeOnFork("/repo", null)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("refuses dirty trees", () => {
    expect(
      canRestoreCodeOnFork("/repo", {
        available: true,
        files: [{ path: "x" }],
      }),
    ).toEqual({ ok: false, reason: "dirty" });
  });

  it("allows clean git project", () => {
    expect(
      canRestoreCodeOnFork("/repo", { available: true, files: [] }),
    ).toEqual({ ok: true });
  });
});

describe("sanitizeForkNameFragment", () => {
  it("strips unsafe chars and caps length", () => {
    expect(sanitizeForkNameFragment("abc-def-ghi", 8)).toBe("abc-def-");
    expect(sanitizeForkNameFragment("!!@@", 8)).toBe("chat");
    expect(sanitizeForkNameFragment("  ab_12  ", 4)).toBe("ab_1");
    expect(sanitizeForkNameFragment("---x", 8)).toBe("x");
  });
});

describe("buildForkWorktreeName", () => {
  it("builds a stable sanitize-safe name", () => {
    const name = buildForkWorktreeName("a1b2c3d4-eeee-ffff", {
      now: 1_700_000_000_000,
      attempt: 0,
    });
    expect(name).toMatch(/^fork-a1b2c3d4-[a-z0-9]+$/);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name.startsWith("-")).toBe(false);
  });

  it("includes attempt suffix when retrying", () => {
    const name = buildForkWorktreeName("session-id", {
      now: 42,
      attempt: 2,
    });
    expect(name).toContain("-2");
    expect(name.startsWith("fork-")).toBe(true);
  });

  it("falls back when session id is empty", () => {
    const name = buildForkWorktreeName("", { now: 99, attempt: 0 });
    expect(name.startsWith("fork-chat-")).toBe(true);
  });
});

describe("softFailKindFromRestoreGate / gate message keys", () => {
  it("maps gate reasons and ignores ok", () => {
    expect(softFailKindFromRestoreGate({ ok: true })).toBeNull();
    expect(
      softFailKindFromRestoreGate({ ok: false, reason: "dirty" }),
    ).toBe("dirty");
    expect(forkRestoreGateMessageKey("dirty")).toBe("session.forkRestoreDirty");
    expect(forkRestoreGateMessageKey("no_project")).toBe(
      "session.forkRestoreNoProject",
    );
    expect(resumeRestoreGateMessageKey("unavailable")).toBe(
      "session.resumeRestoreUnavailable",
    );
  });
});

describe("isWorktreeNameCollisionError", () => {
  it("detects collision phrases", () => {
    expect(isWorktreeNameCollisionError("fatal: already exists")).toBe(true);
    expect(
      isWorktreeNameCollisionError(new Error("branch already checked out")),
    ).toBe(true);
    expect(isWorktreeNameCollisionError("permission denied")).toBe(false);
    expect(isWorktreeNameCollisionError(null)).toBe(false);
  });
});

describe("classifySessionForkError / resolveSessionForkSoftFail", () => {
  it("prefers explicit code", () => {
    const err = Object.assign(new Error("x"), { code: "dirty" });
    expect(classifySessionForkError(err)).toBe("dirty");
    const r = resolveSessionForkSoftFail(err, { op: "fork" });
    expect(r.kind).toBe("dirty");
    expect(r.messageKey).toBe("session.forkRestoreDirty");
    expect(r.keepDialogOpen).toBe(true);
    expect(r.silent).toBe(false);
    expect(r.detail).toBe("");
  });

  it("classifies worktree collision and failed create", () => {
    expect(classifySessionForkError("already registered")).toBe(
      "worktree_collision",
    );
    expect(
      classifySessionForkError(new Error("could not create worktree path")),
    ).toBe("worktree_failed");
  });

  it("classifies bind / fork / cli-arm / need-tauri / busy", () => {
    expect(
      classifySessionForkError(new Error("could not bind project")),
    ).toBe("bind_failed");
    expect(classifySessionForkError(new Error("session fork failed"))).toBe(
      "fork_failed",
    );
    expect(
      classifySessionForkError(new Error("could not arm fork-session")),
    ).toBe("cli_arm_failed");
    expect(classifySessionForkError(new Error("need tauri host"))).toBe(
      "need_tauri",
    );
    expect(classifySessionForkError(new Error("session busy"))).toBe("busy");
  });

  it("honors preferredKind and op-specific keys", () => {
    const r = resolveSessionForkSoftFail("noise", {
      op: "resume_restore",
      preferredKind: "dirty",
    });
    expect(r.kind).toBe("dirty");
    expect(r.messageKey).toBe("session.resumeRestoreDirty");
    expect(r.keepDialogOpen).toBe(true);

    expect(sessionForkSoftFailMessageKey("worktree_failed", "resume_restore")).toBe(
      "session.resumeRestoreCreateFailed",
    );
    expect(sessionForkSoftFailMessageKey("bind_failed", "fork")).toBe(
      "session.forkRestoreBindFailed",
    );
  });

  it("stays silent on cancelled and keeps detail for other", () => {
    expect(sessionForkSoftFailSilent("cancelled")).toBe(true);
    expect(sessionForkSoftFailSilent("dirty")).toBe(false);
    const r = resolveSessionForkSoftFail(new Error("weird host blowup"));
    expect(r.kind).toBe("other");
    expect(r.messageKey).toBe("session.forkFailed");
    expect(r.detail).toMatch(/weird host blowup/i);
    expect(r.keepDialogOpen).toBe(false);
  });

  it("keepForkDialogOpenOnSoftFail covers gate + worktree kinds", () => {
    expect(keepForkDialogOpenOnSoftFail("dirty")).toBe(true);
    expect(keepForkDialogOpenOnSoftFail("worktree_failed")).toBe(true);
    expect(keepForkDialogOpenOnSoftFail("fork_failed")).toBe(false);
  });
});

describe("forkSuccessToastKey / resumeRestoreSuccessToastKey", () => {
  it("matches actual outcomes without inventing agent/worktree claims", () => {
    expect(forkSuccessToastKey({})).toBe("session.forkOk");
    expect(forkSuccessToastKey({ forkedAgent: true })).toBe("session.forkOkCli");
    expect(forkSuccessToastKey({ restoredWorktree: true })).toBe(
      "session.forkOkRestore",
    );
    expect(
      forkSuccessToastKey({ restoredWorktree: true, forkedAgent: true }),
    ).toBe("session.forkOkRestoreCli");
    expect(resumeRestoreSuccessToastKey({})).toBe("session.resumeRestoreOk");
    expect(resumeRestoreSuccessToastKey({ forkedAgent: true })).toBe(
      "session.resumeRestoreOkCli",
    );
  });

  it("forkTrimmedToastKey is silent on rewound and honest on bootstrap", () => {
    expect(forkTrimmedToastKey("rewound")).toBe(null);
    expect(forkTrimmedToastKey("bootstrap")).toBe("session.forkOkBootstrap");
    expect(forkTrimmedToastKey("nope")).toBe(null);
  });

  it("planForkTrimmedFollowUp reloads disk for both outcomes, toasts only bootstrap", () => {
    expect(planForkTrimmedFollowUp(null)).toEqual({
      sessionId: null,
      toastKey: null,
    });
    expect(planForkTrimmedFollowUp({ outcome: "bootstrap" })).toEqual({
      sessionId: null,
      toastKey: "session.forkOkBootstrap",
    });
    expect(
      planForkTrimmedFollowUp({ sessionId: "  ", outcome: "rewound" }),
    ).toEqual({ sessionId: null, toastKey: null });
    expect(
      planForkTrimmedFollowUp({
        sessionId: " child-1 ",
        outcome: "rewound",
      }),
    ).toEqual({ sessionId: "child-1", toastKey: null });
    expect(
      planForkTrimmedFollowUp({
        sessionId: "child-2",
        outcome: "bootstrap",
      }),
    ).toEqual({
      sessionId: "child-2",
      toastKey: "session.forkOkBootstrap",
    });
    expect(
      planForkTrimmedFollowUp({ sessionId: "child-3", outcome: "nope" }),
    ).toEqual({ sessionId: "child-3", toastKey: null });
  });
});

describe("session://fork_trimmed host listener", () => {
  it("reloads the cut journal from disk instead of only toasting", () => {
    const src = readFileSync(
      resolve(__dirname, "../hooks/useSessionHostEvents.ts"),
      "utf8",
    );
    const start = src.indexOf('"session://fork_trimmed"');
    expect(start).toBeGreaterThan(0);
    const block = src.slice(start, start + 1600);
    expect(block).toContain("planForkTrimmedFollowUp");
    expect(block).toContain("sessionMessages");
    expect(block).toContain("reconcile: false");
    expect(block).toContain("projectTrimmedJournalToChat");
    expect(block).toContain("patchSessionMessages");
    expect(block).not.toContain("forkTrimmedToastKey(");
    expect(block).not.toContain("scheduleJournalRehydrate");
  });
});

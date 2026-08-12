import { describe, expect, it } from "vitest";
import {
  canSendTranscriptAsPrompt,
  classifyLiveVoiceError,
  deriveVoiceDelegatePhase,
  formatTranscriptAsPrompt,
  hasDelegatedSessions,
  initialToolLoopState,
  isClassifiedSoftFailNotice,
  isConversationalRole,
  isFatalLiveVoiceError,
  isPermissionDenyDecision,
  isPermissionForDelegatedSession,
  isPermissionPending,
  isSoftMicFailure,
  isToolLoopBusy,
  liveVoiceErrorMessageKey,
  mergeTranscriptLine,
  nextAwaitingResponse,
  normalizeToolLoopStatus,
  parseToolLoopEvent,
  parseVoicePermissionPrompt,
  permissionPendingToolLoopState,
  recordableDelegatedSessionId,
  reduceToolLoopState,
  shouldCancelDelegatedAgentsOnVoiceStop,
  softFailFromPermissionBlocked,
  softFailFromToolCancelled,
  softFailReasonFromToolResult,
  toolEventName,
  toolLoopStatusMessageKey,
  transcriptEmptyKind,
  type VoiceTranscriptLine,
} from "./voiceOverlay";

describe("deriveVoiceDelegatePhase", () => {
  it("prefers connecting and ended over host flags", () => {
    expect(
      deriveVoiceDelegatePhase({
        connecting: true,
        state: { active: true, listening: true },
      }),
    ).toBe("connecting");
    expect(
      deriveVoiceDelegatePhase({
        ended: true,
        state: { active: true, speaking: true },
      }),
    ).toBe("ended");
  });

  it("surfaces fatal error from ui or host", () => {
    expect(
      deriveVoiceDelegatePhase({
        uiError: "auth failed",
        state: { active: true, listening: true },
      }),
    ).toBe("error");
    expect(
      deriveVoiceDelegatePhase({
        state: { active: true, error: "ws down", listening: true },
      }),
    ).toBe("error");
  });

  it("soft-fails mic: keeps listening while host is active", () => {
    expect(
      deriveVoiceDelegatePhase({
        softMicWarning: "mic_denied",
        state: { active: true, listening: true },
      }),
    ).toBe("listening");
    expect(
      deriveVoiceDelegatePhase({
        softMicWarning: "mic_missing",
        state: { active: true, thinking: true },
      }),
    ).toBe("thinking");
    // No host yet → still show error so the user sees the mic issue.
    expect(
      deriveVoiceDelegatePhase({
        softMicWarning: "mic_denied",
        state: { active: false },
      }),
    ).toBe("error");
  });

  it("is idle when host not active", () => {
    expect(deriveVoiceDelegatePhase({ state: null })).toBe("idle");
    expect(deriveVoiceDelegatePhase({ state: { active: false } })).toBe(
      "idle",
    );
  });

  it("honors explicit host phase", () => {
    expect(
      deriveVoiceDelegatePhase({
        state: { active: true, phase: "Thinking", speaking: true },
      }),
    ).toBe("thinking");
    expect(
      deriveVoiceDelegatePhase({
        state: { active: true, phase: "SPEAKING" },
      }),
    ).toBe("speaking");
  });

  it("orders speaking > thinking > listening", () => {
    expect(
      deriveVoiceDelegatePhase({
        state: {
          active: true,
          speaking: true,
          thinking: true,
          listening: true,
        },
      }),
    ).toBe("speaking");
    expect(
      deriveVoiceDelegatePhase({
        state: { active: true, thinking: true, listening: true },
      }),
    ).toBe("thinking");
    expect(
      deriveVoiceDelegatePhase({
        toolBusy: true,
        state: { active: true, listening: true },
      }),
    ).toBe("thinking");
    expect(
      deriveVoiceDelegatePhase({
        state: { active: true, activeTool: "create_agent_session", listening: true },
      }),
    ).toBe("thinking");
    expect(
      deriveVoiceDelegatePhase({
        awaitingResponse: true,
        state: { active: true, listening: true },
      }),
    ).toBe("thinking");
    expect(
      deriveVoiceDelegatePhase({
        state: { active: true, listening: true },
      }),
    ).toBe("listening");
  });

  it("treats active with no listen/speak flags as thinking", () => {
    expect(
      deriveVoiceDelegatePhase({
        state: { active: true, listening: false, speaking: false },
      }),
    ).toBe("thinking");
  });
});

describe("classifyLiveVoiceError / soft mic", () => {
  it("classifies cli_missing and auth", () => {
    expect(classifyLiveVoiceError("Grok Build CLI not found")).toBe(
      "cli_missing",
    );
    expect(classifyLiveVoiceError(null, "cli_missing")).toBe("cli_missing");
    expect(classifyLiveVoiceError("No xAI credentials found")).toBe("auth");
    expect(classifyLiveVoiceError("websocket connect failed")).toBe("network");
    expect(classifyLiveVoiceError("tool create_agent_session: boom")).toBe(
      "tool_failed",
    );
  });

  it("treats mic as soft, others as fatal", () => {
    expect(isSoftMicFailure("mic_denied")).toBe(true);
    expect(isSoftMicFailure("mic_missing")).toBe(true);
    expect(isSoftMicFailure("cli_missing")).toBe(false);
    expect(isFatalLiveVoiceError("mic_denied")).toBe(false);
    expect(isFatalLiveVoiceError("cli_missing")).toBe(true);
    expect(isFatalLiveVoiceError("auth")).toBe(true);
  });

  it("maps to i18n keys", () => {
    expect(liveVoiceErrorMessageKey("cli_missing")).toBe(
      "voice.err.cli_missing",
    );
    expect(liveVoiceErrorMessageKey("mic_denied")).toBe("voice.err.mic_denied");
  });
});

describe("voice → Build tool loop (VOX-BUILD-FULL)", () => {
  it("normalizes status aliases to tool_running / completed", () => {
    expect(normalizeToolLoopStatus("running")).toBe("tool_running");
    expect(normalizeToolLoopStatus("tool_running")).toBe("tool_running");
    expect(normalizeToolLoopStatus("ok")).toBe("completed");
    expect(normalizeToolLoopStatus("completed")).toBe("completed");
    expect(normalizeToolLoopStatus("permission_pending")).toBe(
      "permission_pending",
    );
    expect(normalizeToolLoopStatus("cancelled")).toBe("soft_fail");
    expect(normalizeToolLoopStatus("nope")).toBeNull();
  });

  it("parses tool_running / completed / soft_fail / error events", () => {
    expect(
      parseToolLoopEvent({ name: "create_agent_session", status: "running" }),
    ).toMatchObject({
      status: "tool_running",
      name: "create_agent_session",
      reason: null,
      sessionId: null,
    });
    expect(
      parseToolLoopEvent({
        name: "prompt_agent",
        status: "ok",
        result: { session_id: "abc", state: "streaming" },
      }),
    ).toMatchObject({
      status: "completed",
      name: "prompt_agent",
      reason: null,
      sessionId: "abc",
    });
    expect(
      parseToolLoopEvent({
        name: "create_agent_session",
        status: "soft_fail",
        reason: "cli_missing",
        result: { ok: false, reason: "cli_missing" },
      })?.status,
    ).toBe("soft_fail");
    expect(
      parseToolLoopEvent({
        name: "cancel_agent",
        status: "error",
        message: "unknown tool",
        errorClass: "tool_failed",
      })?.reason,
    ).toBe("tool_failed");
    expect(
      parseToolLoopEvent({
        name: "prompt_agent",
        status: "cancelled",
        reason: "cancelled",
      }),
    ).toMatchObject({ status: "soft_fail", reason: "cancelled" });
  });

  it("never invents a tool name", () => {
    expect(parseToolLoopEvent({ status: "running" })).toBeNull();
    expect(parseToolLoopEvent(null)).toBeNull();
  });

  it("treats legacy finish-with-result as completed (or soft_fail)", () => {
    expect(
      parseToolLoopEvent({
        name: "list_sessions",
        result: { sessions: [] },
      })?.status,
    ).toBe("completed");
    expect(
      parseToolLoopEvent({
        name: "create_agent_session",
        result: { ok: false, reason: "cli_missing" },
      }),
    ).toMatchObject({ status: "soft_fail", reason: "cli_missing" });
  });

  it("reduces busy state and status keys", () => {
    let loop = initialToolLoopState();
    expect(isToolLoopBusy(loop)).toBe(false);
    loop = reduceToolLoopState(
      loop,
      parseToolLoopEvent({ name: "prompt_agent", status: "running" }),
    );
    expect(isToolLoopBusy(loop)).toBe(true);
    expect(toolLoopStatusMessageKey(loop)).toBe("voice.toolRunning");
    loop = reduceToolLoopState(
      loop,
      parseToolLoopEvent({
        name: "prompt_agent",
        status: "ok",
        result: { session_id: "s1" },
      }),
    );
    expect(isToolLoopBusy(loop)).toBe(false);
    expect(toolLoopStatusMessageKey(loop)).toBe("voice.toolRan");
    expect(toolLoopStatusMessageKey(initialToolLoopState())).toBeNull();
  });

  it("tracks permission_pending status honestly", () => {
    const prompt = parseVoicePermissionPrompt({
      rpcId: 42,
      sessionId: "sess-a",
      toolName: "bash",
      title: "Run npm test",
      preview: "npm test",
      scopeKey: "bash",
      options: [],
    });
    expect(prompt).not.toBeNull();
    const pending = permissionPendingToolLoopState(prompt!);
    expect(pending.status).toBe("permission_pending");
    expect(isPermissionPending(pending)).toBe(true);
    expect(isToolLoopBusy(pending)).toBe(true);
    expect(toolLoopStatusMessageKey(pending)).toBe("voice.permissionPending");
    expect(pending.sessionId).toBe("sess-a");
    expect(pending.permissionTitle).toBe("Run npm test");
  });

  it("soft-fails permission denied and tool cancelled", () => {
    expect(
      softFailFromPermissionBlocked({
        toolName: "bash",
        sessionId: "s1",
      }),
    ).toMatchObject({
      status: "soft_fail",
      reason: "permission_denied",
      name: "bash",
    });
    expect(softFailFromToolCancelled({ toolName: "prompt_agent" })).toMatchObject({
      status: "soft_fail",
      reason: "cancelled",
    });
    expect(isPermissionDenyDecision("deny")).toBe(true);
    expect(isPermissionDenyDecision("allow_once")).toBe(false);
    expect(isPermissionDenyDecision("reject_once")).toBe(true);
  });

  it("only matches real delegated session ids for permissions", () => {
    expect(isPermissionForDelegatedSession("a", ["a", "b"])).toBe(true);
    expect(isPermissionForDelegatedSession("c", ["a", "b"])).toBe(false);
    expect(isPermissionForDelegatedSession("", ["a"])).toBe(false);
    expect(isPermissionForDelegatedSession("a", [])).toBe(false);
    expect(isPermissionForDelegatedSession(null, ["a"])).toBe(false);
  });

  it("never invents a permission prompt without rpc + session", () => {
    expect(parseVoicePermissionPrompt({ rpcId: 1 })).toBeNull();
    expect(parseVoicePermissionPrompt({ sessionId: "x" })).toBeNull();
    expect(parseVoicePermissionPrompt(null)).toBeNull();
  });

  it("cancels delegated agents only when keepAgentsOnEnd is false", () => {
    expect(shouldCancelDelegatedAgentsOnVoiceStop(true)).toBe(false);
    expect(shouldCancelDelegatedAgentsOnVoiceStop(undefined)).toBe(false);
    expect(shouldCancelDelegatedAgentsOnVoiceStop(false)).toBe(true);
  });

  it("classifies permission_denied and cancelled separately from mic", () => {
    expect(classifyLiveVoiceError("permission denied by user")).toBe(
      "permission_denied",
    );
    expect(classifyLiveVoiceError("tool cancelled on voice_stop")).toBe(
      "cancelled",
    );
    expect(classifyLiveVoiceError("NotAllowedError: Permission denied")).toBe(
      "mic_denied",
    );
    expect(liveVoiceErrorMessageKey("permission_denied")).toBe(
      "voice.err.permission_denied",
    );
    expect(liveVoiceErrorMessageKey("cancelled")).toBe("voice.err.cancelled");
  });

  it("reads soft-fail reason only when ok:false", () => {
    expect(softFailReasonFromToolResult({ ok: false, reason: "cli_missing" })).toBe(
      "cli_missing",
    );
    expect(softFailReasonFromToolResult({ session_id: "x" })).toBeNull();
    expect(softFailReasonFromToolResult(null)).toBeNull();
  });
});

describe("mergeTranscriptLine", () => {
  it("appends partial same-role deltas", () => {
    let lines: VoiceTranscriptLine[] = [];
    lines = mergeTranscriptLine(lines, "assistant", "Hel", false, () => "1");
    lines = mergeTranscriptLine(lines, "assistant", "lo", false, () => "2");
    expect(lines).toEqual([
      { id: "1", role: "assistant", text: "Hello", final: false },
    ]);
  });

  it("starts a new line on final or role change", () => {
    let lines: VoiceTranscriptLine[] = [];
    lines = mergeTranscriptLine(lines, "user", "Hi", true, () => "a");
    lines = mergeTranscriptLine(lines, "assistant", "Hey", false, () => "b");
    expect(lines.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("ignores empty text", () => {
    expect(mergeTranscriptLine([], "user", "", true)).toEqual([]);
  });
});

describe("formatTranscriptAsPrompt / canSend", () => {
  const sample: VoiceTranscriptLine[] = [
    { id: "1", role: "system", text: "Voice ready", final: true },
    { id: "2", role: "user", text: "  Fix the tests  ", final: true },
    { id: "3", role: "assistant", text: "On it.", final: true },
  ];

  it("formats only conversational host text", () => {
    expect(formatTranscriptAsPrompt(sample)).toBe(
      "User: Fix the tests\n\nAssistant: On it.",
    );
  });

  it("returns empty when no conversational content (no fake STT)", () => {
    expect(
      formatTranscriptAsPrompt([
        { id: "1", role: "system", text: "connected", final: true },
      ]),
    ).toBe("");
    expect(formatTranscriptAsPrompt([])).toBe("");
  });

  it("gates send on support + session + non-empty text", () => {
    const text = formatTranscriptAsPrompt(sample);
    expect(
      canSendTranscriptAsPrompt({
        supportsSend: true,
        hasActiveSession: true,
        transcriptText: text,
      }),
    ).toBe(true);
    expect(
      canSendTranscriptAsPrompt({
        supportsSend: false,
        hasActiveSession: true,
        transcriptText: text,
      }),
    ).toBe(false);
    expect(
      canSendTranscriptAsPrompt({
        supportsSend: true,
        hasActiveSession: false,
        transcriptText: text,
      }),
    ).toBe(false);
    expect(
      canSendTranscriptAsPrompt({
        supportsSend: true,
        hasActiveSession: true,
        transcriptText: "",
      }),
    ).toBe(false);
  });
});

describe("transcriptEmptyKind / delegated / tools", () => {
  it("classifies empty states honestly", () => {
    expect(transcriptEmptyKind([])).toBe("none");
    expect(
      transcriptEmptyKind([
        { id: "1", role: "system", text: "ready", final: true },
      ]),
    ).toBe("system_only");
    expect(
      transcriptEmptyKind([
        { id: "1", role: "user", text: "hi", final: true },
      ]),
    ).toBe("has_content");
  });

  it("detects delegated session ids", () => {
    expect(hasDelegatedSessions(null)).toBe(false);
    expect(hasDelegatedSessions({ delegatedSessionIds: [] })).toBe(false);
    expect(
      hasDelegatedSessions({ delegatedSessionIds: ["abc"] }),
    ).toBe(true);
  });

  it("normalizes tool event names", () => {
    expect(toolEventName({ name: "  prompt_agent " })).toBe("prompt_agent");
    expect(toolEventName({ name: "" })).toBeNull();
    expect(toolEventName(null)).toBeNull();
  });

  it("tracks awaiting response from host transcript roles", () => {
    expect(
      nextAwaitingResponse({ prev: false, role: "user", final: true }),
    ).toBe(true);
    expect(
      nextAwaitingResponse({ prev: true, role: "assistant", final: false }),
    ).toBe(false);
    expect(
      nextAwaitingResponse({ prev: true, role: "user", final: true, speaking: true }),
    ).toBe(false);
    expect(
      nextAwaitingResponse({ prev: true, role: "system", final: true }),
    ).toBe(true);
  });

  it("recognizes conversational roles", () => {
    expect(isConversationalRole("User")).toBe(true);
    expect(isConversationalRole("system")).toBe(false);
  });

  it("never invents delegated session ids", () => {
    expect(recordableDelegatedSessionId(null)).toBeNull();
    expect(recordableDelegatedSessionId("")).toBeNull();
    expect(recordableDelegatedSessionId("   ")).toBeNull();
    expect(recordableDelegatedSessionId("  sid-9  ")).toBe("sid-9");
  });

  it("marks mic/auth/network/cli as classified soft-fail notices", () => {
    expect(isClassifiedSoftFailNotice("mic_denied")).toBe(true);
    expect(isClassifiedSoftFailNotice("mic_missing")).toBe(true);
    expect(isClassifiedSoftFailNotice("auth")).toBe(true);
    expect(isClassifiedSoftFailNotice("network")).toBe(true);
    expect(isClassifiedSoftFailNotice("cli_missing")).toBe(true);
    expect(isClassifiedSoftFailNotice("not_available")).toBe(true);
    expect(isClassifiedSoftFailNotice("timeout")).toBe(false);
    expect(isClassifiedSoftFailNotice("unknown")).toBe(false);
  });
});

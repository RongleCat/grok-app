import { describe, expect, it } from "vitest";
import {
  classifyVoiceError,
  initialVoiceState,
  insertTranscriptIntoDraft,
  isVoiceToggleKey,
  planTranscriptInsert,
  reduceVoice,
  resolveDictationCommit,
  resolveDictationPartialPreview,
  resolveVoiceErrorClass,
  resolveVoiceMicChrome,
  voiceAvailabilityFromAuth,
  voiceIsActive,
  voiceMicLabelMessageKey,
  voiceResultStillCurrent,
  voiceSoftFailResetsIdle,
  voiceStealsEscape,
  VOICE_MAX_RECORD_MS,
  VOICE_NO_SPEECH_MS,
} from "./voiceDictation";

describe("voiceDictation FSM", () => {
  it("starts idle", () => {
    expect(initialVoiceState().phase).toBe("idle");
  });

  it("start → requesting → recording → stop → transcribing → ok → idle", () => {
    let s = initialVoiceState();
    s = reduceVoice(s, { type: "start" }, 1000);
    expect(s.phase).toBe("requesting_mic");
    s = reduceVoice(s, { type: "mic_granted" }, 1001);
    expect(s.phase).toBe("recording");
    expect(s.recordingStartedAt).toBe(1001);
    expect(voiceIsActive(s.phase)).toBe(true);
    expect(voiceStealsEscape(s.phase)).toBe(true);
    s = reduceVoice(s, { type: "stop" }, 2000);
    expect(s.phase).toBe("transcribing");
    s = reduceVoice(s, { type: "transcribe_ok" }, 2001);
    expect(s.phase).toBe("idle");
    expect(s.error).toBeNull();
  });

  it("mic denied lands in error", () => {
    let s = reduceVoice(initialVoiceState(), { type: "start" });
    s = reduceVoice(s, { type: "mic_denied" });
    expect(s.phase).toBe("error");
    expect(s.error).toBe("mic_denied");
  });

  it("cancel resets from recording", () => {
    let s = reduceVoice(initialVoiceState(), { type: "start" });
    s = reduceVoice(s, { type: "mic_granted" }, 10);
    s = reduceVoice(s, { type: "cancel" });
    expect(s).toEqual(initialVoiceState());
  });

  it("no_speech_timeout only while recording", () => {
    let s = reduceVoice(initialVoiceState(), { type: "start" });
    s = reduceVoice(s, { type: "no_speech_timeout" });
    expect(s.phase).toBe("requesting_mic");
    s = reduceVoice(s, { type: "mic_granted" }, 1);
    s = reduceVoice(s, { type: "no_speech_timeout" });
    expect(s.phase).toBe("error");
    expect(s.error).toBe("no_speech");
  });

  it("clear_error returns to idle", () => {
    let s = reduceVoice(initialVoiceState(), { type: "start" });
    s = reduceVoice(s, { type: "mic_denied" });
    s = reduceVoice(s, { type: "clear_error" });
    expect(s.phase).toBe("idle");
  });
});

describe("insertTranscriptIntoDraft", () => {
  it("appends to empty draft", () => {
    expect(insertTranscriptIntoDraft("", "hello")).toEqual({
      text: "hello",
      caret: 5,
    });
  });

  it("joins with space when left lacks trailing whitespace", () => {
    expect(insertTranscriptIntoDraft("hi", "there", 2)).toEqual({
      text: "hi there",
      caret: 8,
    });
  });

  it("does not double spaces", () => {
    expect(insertTranscriptIntoDraft("hi ", "there", 3).text).toBe("hi there");
  });

  it("inserts at caret in the middle", () => {
    const r = insertTranscriptIntoDraft("aa bb", "XX", 2);
    expect(r.text).toBe("aa XX bb");
  });

  it("ignores empty/whitespace transcript", () => {
    expect(insertTranscriptIntoDraft("keep", "  ").text).toBe("keep");
  });
});

describe("voiceAvailabilityFromAuth", () => {
  it("enables when signed in official", () => {
    expect(
      voiceAvailabilityFromAuth({
        signedInOfficial: true,
        hasOfficialApiKey: false,
        hasRelayOnly: false,
      }).available,
    ).toBe(true);
  });

  it("enables with official API key", () => {
    expect(
      voiceAvailabilityFromAuth({
        signedInOfficial: false,
        hasOfficialApiKey: true,
        hasRelayOnly: true,
      }).available,
    ).toBe(true);
  });

  it("disables relay-only", () => {
    const s = voiceAvailabilityFromAuth({
      signedInOfficial: false,
      hasOfficialApiKey: false,
      hasRelayOnly: true,
    });
    expect(s.available).toBe(false);
    expect(s.reason).toBe("not_available");
  });

  it("disables when active provider is custom even with official login", () => {
    const s = voiceAvailabilityFromAuth({
      signedInOfficial: true,
      hasOfficialApiKey: true,
      hasRelayOnly: false,
      activeProviderIsCustom: true,
    });
    expect(s.available).toBe(false);
    expect(s.reason).toBe("not_available");
  });
});

describe("classifyVoiceError", () => {
  it("maps http 401 to auth", () => {
    expect(classifyVoiceError("nope", 401)).toBe("auth");
  });

  it("trusts known Host errorClass token auth", () => {
    expect(classifyVoiceError("auth")).toBe("auth");
    expect(resolveVoiceErrorClass("auth", "whatever")).toBe("auth");
    expect(resolveVoiceErrorClass("no_speech", null)).toBe("no_speech");
  });

  it("maps empty transcript language", () => {
    expect(classifyVoiceError("empty transcript")).toBe("no_speech");
  });

  it("maps network strings", () => {
    expect(classifyVoiceError("connection refused")).toBe("network");
  });
});

describe("VOICE_NO_SPEECH_MS / max record policy", () => {
  it("documents CLI-aligned silence window without hard-killing audio", () => {
    expect(VOICE_NO_SPEECH_MS).toBe(10_000);
    // Max record must be longer than the silence constant so auto-stop+STT
    // can cover multi-sentence dictation; no_speech comes from empty STT.
    expect(VOICE_MAX_RECORD_MS).toBeGreaterThan(VOICE_NO_SPEECH_MS);
  });
});

describe("voiceResultStillCurrent", () => {
  it("rejects stale generation after cancel", () => {
    expect(voiceResultStillCurrent(1, 1)).toBe(true);
    expect(voiceResultStillCurrent(1, 2)).toBe(false);
  });
});

describe("isVoiceToggleKey", () => {
  it("matches Ctrl+Space only", () => {
    expect(
      isVoiceToggleKey({
        key: " ",
        code: "Space",
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe(true);
    expect(
      isVoiceToggleKey({
        key: " ",
        code: "Space",
        ctrlKey: false,
        metaKey: true,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe(false);
  });
});

describe("resolveDictationPartialPreview", () => {
  it("never invents partial text", () => {
    expect(resolveDictationPartialPreview(null)).toBeNull();
    expect(resolveDictationPartialPreview("")).toBeNull();
    expect(resolveDictationPartialPreview("   ")).toBeNull();
  });

  it("returns trimmed interim when present", () => {
    expect(resolveDictationPartialPreview("  hello  ")).toBe("hello");
  });
});

describe("planTranscriptInsert", () => {
  it("returns null for empty speech", () => {
    expect(planTranscriptInsert("keep", "  ")).toBeNull();
  });

  it("returns insert plan for real speech", () => {
    expect(planTranscriptInsert("", "hi")).toEqual({ text: "hi", caret: 2 });
  });
});

describe("resolveDictationCommit", () => {
  it("empty transcript is empty kind (soft-fail no_speech)", () => {
    expect(
      resolveDictationCommit({
        transcript: "  ",
        autoSend: true,
        canAutoSend: true,
      }).kind,
    ).toBe("empty");
  });

  it("default inserts only", () => {
    expect(
      resolveDictationCommit({
        transcript: "hello",
        autoSend: false,
        canAutoSend: true,
      }),
    ).toEqual({ kind: "insert", text: "hello" });
  });

  it("auto-send when free", () => {
    expect(
      resolveDictationCommit({
        transcript: "hello",
        autoSend: true,
        canAutoSend: true,
      }),
    ).toEqual({ kind: "send", text: "hello" });
  });

  it("auto-send blocked still inserts (honesty soft-fail)", () => {
    expect(
      resolveDictationCommit({
        transcript: "hello",
        autoSend: true,
        canAutoSend: false,
      }),
    ).toEqual({ kind: "send_blocked", text: "hello" });
  });
});

describe("voiceSoftFailResetsIdle", () => {
  it("treats empty speech and auth as non-sticky", () => {
    expect(voiceSoftFailResetsIdle("no_speech")).toBe(true);
    expect(voiceSoftFailResetsIdle("auth")).toBe(true);
    expect(voiceSoftFailResetsIdle("not_available")).toBe(true);
    expect(voiceSoftFailResetsIdle("network")).toBe(false);
    expect(voiceSoftFailResetsIdle("timeout")).toBe(false);
  });
});

describe("resolveVoiceMicChrome", () => {
  const base = {
    gateAvailable: true,
    autoSend: false,
    liveVoiceOpen: false,
    canType: true,
  };

  it("idle insert vs send honesty", () => {
    expect(resolveVoiceMicChrome({ ...base, phase: "idle" }).labelKind).toBe(
      "idle_insert",
    );
    expect(
      resolveVoiceMicChrome({ ...base, phase: "idle", autoSend: true })
        .labelKind,
    ).toBe("idle_send");
    expect(voiceMicLabelMessageKey("idle_insert")).toBe("composer.voiceInsert");
    expect(voiceMicLabelMessageKey("idle_send")).toBe("composer.voiceSend");
  });

  it("keeps cancel interactive mid-stream (transcribing / requesting)", () => {
    for (const phase of ["transcribing", "requesting_mic"] as const) {
      const c = resolveVoiceMicChrome({ ...base, phase });
      expect(c.interactive, phase).toBe(true);
      expect(c.busyClass, phase).toBe(true);
    }
    const t = resolveVoiceMicChrome({ ...base, phase: "transcribing" });
    expect(t.labelKind).toBe("transcribing_cancel");
    expect(voiceMicLabelMessageKey(t.labelKind)).toBe(
      "composer.voiceTranscribing",
    );
  });

  it("recording is stoppable live chrome", () => {
    const c = resolveVoiceMicChrome({ ...base, phase: "recording" });
    expect(c.labelKind).toBe("listening");
    expect(c.ariaPressed).toBe(true);
    expect(c.liveClass).toBe(true);
    expect(c.interactive).toBe(true);
  });

  it("auth-unavailable still shows mic for soft-fail click", () => {
    const c = resolveVoiceMicChrome({
      ...base,
      phase: "idle",
      gateAvailable: false,
    });
    expect(c.labelKind).toBe("unavailable");
    expect(c.unavailableClass).toBe(true);
    expect(c.interactive).toBe(true);
  });

  it("live voice overlay blocks start but not mid-dictation cancel", () => {
    const idle = resolveVoiceMicChrome({
      ...base,
      phase: "idle",
      liveVoiceOpen: true,
    });
    expect(idle.interactive).toBe(false);
    const rec = resolveVoiceMicChrome({
      ...base,
      phase: "recording",
      liveVoiceOpen: true,
    });
    expect(rec.interactive).toBe(true);
  });
});

/**
 * Pure helpers for Composer voice dictation (record → STT → draft insert).
 * Keep I/O and MediaRecorder out of this module so tests drive real logic.
 */

/** UI / host lifecycle for a dictation attempt. */
export type VoicePhase =
  | "idle"
  | "requesting_mic"
  | "recording"
  | "transcribing"
  | "error";

/** Stable error classes for UI copy (never leak tokens). */
export type VoiceErrorClass =
  | "mic_denied"
  | "mic_missing"
  | "no_speech"
  | "not_available"
  | "network"
  | "auth"
  | "timeout"
  | "stt_key"
  | "local_offline"
  | "unknown";

export type VoiceStatus = {
  available: boolean;
  reason: VoiceErrorClass | null;
  /** Human device label when known (optional). */
  deviceLabel?: string | null;
};

export type VoiceFsmState = {
  phase: VoicePhase;
  error: VoiceErrorClass | null;
  /** Epoch ms when recording started (for timeout UX). */
  recordingStartedAt: number | null;
};

/**
 * CLI documents ~10s without a transcript as silence stop. Phase-1 has no VAD;
 * we only surface `no_speech` after stop/STT yields empty (or a tiny blob).
 * Kept as the product constant for copy/tests — not a hard-kill recording timer.
 */
export const VOICE_NO_SPEECH_MS = 10_000;
/** Max recording length; auto-stop runs stop()+STT (never discard audio). */
export const VOICE_MAX_RECORD_MS = 60_000;

export function initialVoiceState(): VoiceFsmState {
  return { phase: "idle", error: null, recordingStartedAt: null };
}

/** Whether Esc should cancel dictation instead of other Esc handlers. */
export function voiceStealsEscape(phase: VoicePhase): boolean {
  return (
    phase === "requesting_mic" ||
    phase === "recording" ||
    phase === "transcribing"
  );
}

/** Whether Ctrl+Space / mic should act as stop rather than start. */
export function voiceIsActive(phase: VoicePhase): boolean {
  return voiceStealsEscape(phase);
}

/**
 * Apply a discrete event to the voice FSM.
 * Pure: no timers; callers enforce no-speech / max duration.
 */
export function reduceVoice(
  state: VoiceFsmState,
  event:
    | { type: "start" }
    | { type: "mic_granted" }
    | { type: "mic_denied" }
    | { type: "mic_missing" }
    | { type: "stop" }
    | { type: "cancel" }
    | { type: "transcribe_ok" }
    | { type: "transcribe_fail"; error: VoiceErrorClass }
    | { type: "no_speech_timeout" }
    | { type: "clear_error" },
  nowMs: number = Date.now(),
): VoiceFsmState {
  switch (event.type) {
    case "start":
      if (state.phase !== "idle" && state.phase !== "error") return state;
      return {
        phase: "requesting_mic",
        error: null,
        recordingStartedAt: null,
      };
    case "mic_granted":
      if (state.phase !== "requesting_mic") return state;
      return {
        phase: "recording",
        error: null,
        recordingStartedAt: nowMs,
      };
    case "mic_denied":
      return {
        phase: "error",
        error: "mic_denied",
        recordingStartedAt: null,
      };
    case "mic_missing":
      return {
        phase: "error",
        error: "mic_missing",
        recordingStartedAt: null,
      };
    case "stop":
      if (state.phase !== "recording") return state;
      return {
        phase: "transcribing",
        error: null,
        recordingStartedAt: state.recordingStartedAt,
      };
    case "cancel":
      return initialVoiceState();
    case "transcribe_ok":
      return initialVoiceState();
    case "transcribe_fail":
      return {
        phase: "error",
        error: event.error,
        recordingStartedAt: null,
      };
    case "no_speech_timeout":
      if (state.phase !== "recording") return state;
      return {
        phase: "error",
        error: "no_speech",
        recordingStartedAt: null,
      };
    case "clear_error":
      if (state.phase !== "error") return state;
      return initialVoiceState();
    default:
      return state;
  }
}

/**
 * Insert transcript into a plain-text draft at caret.
 * Joins with a single space when the left side does not end with whitespace.
 */
export function insertTranscriptIntoDraft(
  draft: string,
  transcript: string,
  caret: number = draft.length,
): { text: string; caret: number } {
  const t = transcript.trim();
  if (!t) {
    return { text: draft, caret };
  }
  const pos = Math.max(0, Math.min(caret, draft.length));
  const left = draft.slice(0, pos);
  const right = draft.slice(pos);
  const needSpaceBefore = left.length > 0 && !/\s$/.test(left);
  const needSpaceAfter = right.length > 0 && !/^\s/.test(right);
  const mid = `${needSpaceBefore ? " " : ""}${t}${needSpaceAfter ? " " : ""}`;
  const text = left + mid + right;
  return { text, caret: left.length + mid.length };
}

const KNOWN_VOICE_ERRORS: readonly VoiceErrorClass[] = [
  "mic_denied",
  "mic_missing",
  "no_speech",
  "not_available",
  "network",
  "auth",
  "timeout",
  "stt_key",
  "local_offline",
  "unknown",
] as const;

function isVoiceErrorClass(s: string): s is VoiceErrorClass {
  return (KNOWN_VOICE_ERRORS as readonly string[]).includes(s);
}

/** Map host/HTTP failures to UI error classes. Trust known Host errorClass tokens. */
export function classifyVoiceError(
  raw: string | null | undefined,
  httpStatus?: number | null,
): VoiceErrorClass {
  if (httpStatus === 401 || httpStatus === 403) return "auth";
  if (httpStatus === 408 || httpStatus === 504) return "timeout";
  const rawTrim = (raw ?? "").trim();
  // Host already returns a stable class (e.g. "auth", "no_speech").
  if (rawTrim && isVoiceErrorClass(rawTrim)) {
    return rawTrim;
  }
  const s = rawTrim.toLowerCase();
  if (!s) return "unknown";
  if (
    s.includes("not_available") ||
    s.includes("not available") ||
    s.includes("relay") ||
    s.includes("no speech auth")
  ) {
    return "not_available";
  }
  // Custom STT key invalid/missing (host returns `stt_key` for 401/403 on a
  // custom endpoint; free-form matches keep older host strings working).
  if (
    s.includes("stt_key") ||
    s.includes("custom stt api key") ||
    s.includes("自定义听写")
  ) {
    return "stt_key";
  }
  // Local (loopback) dictation service not running / unreachable.
  if (
    s.includes("local_offline") ||
    s.includes("local stt") ||
    s.includes("本地听写服务")
  ) {
    return "local_offline";
  }
  if (
    s.includes("permission") ||
    s.includes("denied") ||
    s.includes("notallowed")
  ) {
    return "mic_denied";
  }
  if (
    s.includes("notfound") ||
    s.includes("no device") ||
    s.includes("no microphone") ||
    s.includes("mic_missing")
  ) {
    return "mic_missing";
  }
  if (
    s.includes("no_speech") ||
    s.includes("no speech") ||
    s.includes("empty transcript")
  ) {
    return "no_speech";
  }
  if (
    s.includes("timeout") ||
    s.includes("timed out") ||
    s.includes("deadline")
  ) {
    return "timeout";
  }
  if (
    s.includes("network") ||
    s.includes("fetch") ||
    s.includes("connection") ||
    s.includes("dns") ||
    s.includes("econn")
  ) {
    return "network";
  }
  if (
    s === "auth" ||
    s.includes("401") ||
    s.includes("403") ||
    s.includes("unauthor")
  ) {
    return "auth";
  }
  return "unknown";
}

/**
 * Prefer Host `errorClass` when present; otherwise classify free-form error text.
 */
export function resolveVoiceErrorClass(
  errorClass: string | null | undefined,
  error: string | null | undefined,
  httpStatus?: number | null,
): VoiceErrorClass {
  if (errorClass && isVoiceErrorClass(errorClass.trim())) {
    return errorClass.trim() as VoiceErrorClass;
  }
  return classifyVoiceError(errorClass || error, httpStatus);
}

/**
 * Gate composer dictation (mic STT).
 * - Custom STT endpoint (Settings → Voice) is available on its own — no
 *   official account needed, and works under custom/third-party providers.
 * - Otherwise needs official Grok OAuth token or official xAI API key.
 * - Active custom / third-party provider route disables official dictation
 *   (relay keys are not enough).
 * - Live voice is gated separately (currently not exposed in the composer).
 */
export function voiceAvailabilityFromAuth(opts: {
  signedInOfficial: boolean;
  hasOfficialApiKey: boolean;
  hasRelayOnly: boolean;
  /** True when a custom OpenAI-compatible STT endpoint is configured. */
  sttCustomConfigured?: boolean;
  /** True when Settings → Providers is set to a custom relay. */
  activeProviderIsCustom?: boolean;
}): VoiceStatus {
  if (opts.sttCustomConfigured) {
    return { available: true, reason: null };
  }
  if (opts.activeProviderIsCustom) {
    return { available: false, reason: "not_available" };
  }
  if (opts.signedInOfficial || opts.hasOfficialApiKey) {
    return { available: true, reason: null };
  }
  if (opts.hasRelayOnly) {
    return { available: false, reason: "not_available" };
  }
  return { available: false, reason: "not_available" };
}

/** Detect Ctrl+Space (not Cmd+Space) toggle chord. */
export function isVoiceToggleKey(e: {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  if (e.metaKey || e.altKey || e.shiftKey) return false;
  if (!e.ctrlKey) return false;
  return e.code === "Space" || e.key === " " || e.key === "Spacebar";
}

/** In-flight STT must ignore results after cancel/start bumps the generation. */
export function voiceResultStillCurrent(
  attemptGen: number,
  activeGen: number,
): boolean {
  return attemptGen === activeGen;
}

/**
 * Honest interim/partial transcript for composer preview.
 * Never invents speech: empty/whitespace → null (show status phase only).
 * When streaming STT exists, pass real interim text; one-shot STT stays null.
 */
export function resolveDictationPartialPreview(
  partial: string | null | undefined,
): string | null {
  const t = (partial ?? "").trim();
  return t.length > 0 ? t : null;
}

/**
 * Merge a final (or interim) transcript into draft text at caret.
 * Returns null when there is nothing to insert (empty speech honesty).
 */
export function planTranscriptInsert(
  draft: string,
  transcript: string,
  caret: number = draft.length,
): { text: string; caret: number } | null {
  const t = transcript.trim();
  if (!t) return null;
  return insertTranscriptIntoDraft(draft, t, caret);
}

/** Post-STT disposition: insert only vs auto-send vs soft-fail. */
export type DictationCommitKind =
  | "empty"
  | "insert"
  | "send"
  | "send_blocked";

export type DictationCommit =
  | { kind: "empty" }
  | { kind: "insert"; text: string }
  | { kind: "send"; text: string }
  | { kind: "send_blocked"; text: string };

/**
 * Classify how a finished transcript should land.
 * - empty → soft-fail no_speech (caller toast); never send blank
 * - insert → draft only (default)
 * - send → insert then send when auto-send is on and send path is free
 * - send_blocked → insert + soft-fail toast (auto-send wanted but can't send)
 */
export function resolveDictationCommit(opts: {
  transcript: string;
  autoSend: boolean;
  /** False when session cannot accept a send (permission gate, etc.). */
  canAutoSend: boolean;
}): DictationCommit {
  const text = opts.transcript.trim();
  if (!text) return { kind: "empty" };
  if (!opts.autoSend) return { kind: "insert", text };
  if (!opts.canAutoSend) return { kind: "send_blocked", text };
  return { kind: "send", text };
}

/** Soft-fail classes: toast is enough; leave FSM idle (not sticky error chrome). */
export function voiceSoftFailResetsIdle(cls: VoiceErrorClass): boolean {
  return (
    cls === "no_speech" ||
    cls === "auth" ||
    cls === "stt_key" ||
    cls === "local_offline" ||
    cls === "not_available" ||
    cls === "mic_denied" ||
    cls === "mic_missing"
  );
}

/** Mic tip / aria label kind for insert·send·cancel honesty. */
export type VoiceMicLabelKind =
  | "idle_insert"
  | "idle_send"
  | "listening"
  | "transcribing_cancel"
  | "requesting"
  | "unavailable";

export type VoiceMicChrome = {
  labelKind: VoiceMicLabelKind;
  /** Click starts, stops, cancels, or soft-fails auth — never hard-disabled mid-stream. */
  interactive: boolean;
  ariaPressed: boolean;
  liveClass: boolean;
  busyClass: boolean;
  unavailableClass: boolean;
};

/**
 * Pure mic button chrome for composer dictation.
 * Cancel mid-stream (requesting / recording stop / transcribing cancel) stays interactive.
 * Auth-unavailable still shows the mic so soft-fail toast can explain why.
 */
export function resolveVoiceMicChrome(opts: {
  phase: VoicePhase;
  gateAvailable: boolean;
  autoSend: boolean;
  liveVoiceOpen: boolean;
  canType: boolean;
}): VoiceMicChrome {
  const active = voiceIsActive(opts.phase);
  if (opts.liveVoiceOpen && !active) {
    return {
      labelKind: opts.gateAvailable
        ? opts.autoSend
          ? "idle_send"
          : "idle_insert"
        : "unavailable",
      interactive: false,
      ariaPressed: false,
      liveClass: false,
      busyClass: false,
      unavailableClass: !opts.gateAvailable,
    };
  }
  if (opts.phase === "recording") {
    return {
      labelKind: "listening",
      interactive: true,
      ariaPressed: true,
      liveClass: true,
      busyClass: false,
      unavailableClass: false,
    };
  }
  if (opts.phase === "transcribing") {
    return {
      labelKind: "transcribing_cancel",
      interactive: true,
      ariaPressed: false,
      liveClass: false,
      busyClass: true,
      unavailableClass: false,
    };
  }
  if (opts.phase === "requesting_mic") {
    return {
      labelKind: "requesting",
      interactive: true,
      ariaPressed: false,
      liveClass: false,
      busyClass: true,
      unavailableClass: false,
    };
  }
  if (!opts.gateAvailable) {
    return {
      labelKind: "unavailable",
      interactive: opts.canType,
      ariaPressed: false,
      liveClass: false,
      busyClass: false,
      unavailableClass: true,
    };
  }
  return {
    labelKind: opts.autoSend ? "idle_send" : "idle_insert",
    interactive: opts.canType,
    ariaPressed: false,
    liveClass: false,
    busyClass: false,
    unavailableClass: false,
  };
}

/** Map mic label kind → i18n MessageKey (caller passes through `tr`). */
export function voiceMicLabelMessageKey(
  kind: VoiceMicLabelKind,
):
  | "composer.voiceInsert"
  | "composer.voiceSend"
  | "composer.voiceListening"
  | "composer.voiceTranscribing"
  | "composer.voiceRequesting"
  | "composer.voiceUnavailable" {
  switch (kind) {
    case "idle_insert":
      return "composer.voiceInsert";
    case "idle_send":
      return "composer.voiceSend";
    case "listening":
      return "composer.voiceListening";
    case "transcribing_cancel":
      return "composer.voiceTranscribing";
    case "requesting":
      return "composer.voiceRequesting";
    case "unavailable":
      return "composer.voiceUnavailable";
  }
}

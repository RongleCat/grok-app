/**
 * Pure helpers for Live Voice overlay — delegate phase, transcript merge,
 * Build tool/permission path (VOX-BUILD-FULL), and optional “send transcript
 * as prompt” gating.
 *
 * Sources: host `voice://state` / transcript / tool events + real
 * `session://permission` for delegated sessions only.
 * Never invent STT partials, fake tool results, or speech text.
 */

/** High-level UI phase for the Live Voice overlay status line. */
export type VoiceDelegatePhase =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error"
  | "ended";

/**
 * Stable error classes for Live Voice + Build tool loop (i18n keys).
 * Mic failures are soft when the host session is otherwise alive.
 */
export type VoiceLiveErrorClass =
  | "mic_denied"
  | "mic_missing"
  | "cli_missing"
  | "permission_denied"
  | "cancelled"
  | "auth"
  | "network"
  | "timeout"
  | "tool_failed"
  | "not_available"
  | "unknown";

/**
 * Host Build tool lifecycle for voice → agent delegation (VOX-BUILD-FULL).
 * Canonical tokens: tool_running / permission_pending / completed /
 * soft_fail / error. Legacy host events still use running / ok.
 */
export type VoiceToolLoopStatus =
  | "idle"
  | "tool_running"
  | "permission_pending"
  | "completed"
  | "soft_fail"
  | "error"
  /** @deprecated Prefer tool_running — accepted by parse for back-compat. */
  | "running"
  /** @deprecated Prefer completed — accepted by parse for back-compat. */
  | "ok";

/** Client-side tool-loop snapshot (from host events only). */
export type VoiceToolLoopState = {
  status: VoiceToolLoopStatus;
  /** Tool name when known; null when idle / absent. */
  name: string | null;
  /** Soft-fail / error reason token when present (e.g. cli_missing). */
  reason: string | null;
  /** Delegated session id from tool result when present. */
  sessionId: string | null;
  /** Permission tool title when status is permission_pending. */
  permissionTitle?: string | null;
};

/** Permission prompt for a voice-delegated Build session (real ACP only). */
export type VoicePermissionPrompt = {
  rpcId: number;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  title: string;
  preview: string;
  scopeKey: string;
  options: unknown;
};

/** Subset of host VoiceSessionState used for phase derivation. */
export type VoiceHostStateLike = {
  active?: boolean | null;
  mode?: string | null;
  phase?: string | null;
  listening?: boolean | null;
  speaking?: boolean | null;
  thinking?: boolean | null;
  error?: string | null;
  /** Host-reported in-flight tool name (optional). */
  activeTool?: string | null;
  delegatedSessionIds?: string[] | null;
  mock?: boolean | null;
};

/** One transcript row (user / assistant / system). */
export type VoiceTranscriptLine = {
  id: string;
  role: string;
  text: string;
  final?: boolean;
};

export type DeriveVoiceDelegatePhaseInput = {
  /** True while voiceStart has not resolved. */
  connecting?: boolean;
  /** Overlay closed after stop. */
  ended?: boolean;
  /**
   * Fatal UI/host error text. Soft mic warnings should not be passed here
   * when the host session is still active (use softMicWarning instead).
   */
  uiError?: string | null;
  /**
   * Soft mic failure class (denied / missing). Does not force error phase
   * while the host session remains active — voice can still play / tools run.
   */
  softMicWarning?: VoiceLiveErrorClass | null;
  /** Host snapshot from voice_state / voice://state. */
  state?: VoiceHostStateLike | null;
  /**
   * True while a host tool is in-flight (from events). Prefer host
   * `thinking` / `activeTool` when present; this is a client-side supplement.
   */
  toolBusy?: boolean;
  /**
   * True after a final user transcript until assistant audio/text starts.
   * Derived from host transcript events only — never synthetic STT.
   */
  awaitingResponse?: boolean;
};

const KNOWN_LIVE_ERRORS: readonly VoiceLiveErrorClass[] = [
  "mic_denied",
  "mic_missing",
  "cli_missing",
  "permission_denied",
  "cancelled",
  "auth",
  "network",
  "timeout",
  "tool_failed",
  "not_available",
  "unknown",
] as const;

function isLiveErrorClass(s: string): s is VoiceLiveErrorClass {
  return (KNOWN_LIVE_ERRORS as readonly string[]).includes(s);
}

/**
 * Map host/UI failure text (or stable errorClass token) to a Live Voice class.
 * Never invents success — unknown stays unknown.
 */
export function classifyLiveVoiceError(
  raw: string | null | undefined,
  errorClass?: string | null,
): VoiceLiveErrorClass {
  const token = (errorClass ?? "").trim().toLowerCase();
  if (token && isLiveErrorClass(token)) return token;

  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return "unknown";
  if (isLiveErrorClass(s)) return s;

  if (
    s.includes("cli not found") ||
    s.includes("cli_missing") ||
    s.includes("grok build not found") ||
    s.includes("grok build cli not found") ||
    s.includes("install grok build")
  ) {
    return "cli_missing";
  }
  if (
    s.includes("not_available") ||
    s.includes("not available") ||
    s.includes("no speech auth")
  ) {
    return "not_available";
  }
  // OS mic denial first (getUserMedia NotAllowedError often says "Permission denied").
  if (
    s.includes("notallowed") ||
    s.includes("mic_denied") ||
    (s.includes("microphone") && (s.includes("denied") || s.includes("permission"))) ||
    (s.includes("getusermedia") && s.includes("denied"))
  ) {
    return "mic_denied";
  }
  // Agent / tool permission blocked (not OS mic).
  if (
    s.includes("permission_denied") ||
    s.includes("permission denied") ||
    s.includes("permission_blocked") ||
    s.includes("user denied") ||
    s.includes("user_denied") ||
    s.includes("reject_once") ||
    s.includes("reject_always")
  ) {
    return "permission_denied";
  }
  if (
    s.includes("cancelled") ||
    s.includes("canceled") ||
    s.includes("voice_stop") ||
    s.includes("user_stop")
  ) {
    return "cancelled";
  }
  if (
    s.includes("notfound") ||
    s.includes("no device") ||
    s.includes("no microphone") ||
    s.includes("mic_missing") ||
    s.includes("device not found")
  ) {
    return "mic_missing";
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
    s.includes("websocket") ||
    s.includes("ws ") ||
    s.includes("dns") ||
    s.includes("econn")
  ) {
    return "network";
  }
  if (
    s.includes("401") ||
    s.includes("403") ||
    s.includes("unauthor") ||
    s.includes("auth") ||
    s.includes("bearer") ||
    s.includes("credential")
  ) {
    return "auth";
  }
  if (s.includes("tool ") || s.includes("tool_failed") || s.includes("unknown tool")) {
    return "tool_failed";
  }
  return "unknown";
}

/** Mic denied / missing — soft when host is otherwise alive. */
export function isSoftMicFailure(cls: VoiceLiveErrorClass | null | undefined): boolean {
  return cls === "mic_denied" || cls === "mic_missing";
}

/**
 * Whether a Live Voice error should force the overlay error phase.
 * Soft mic failures do not, so playback / tool loop can continue.
 */
export function isFatalLiveVoiceError(
  cls: VoiceLiveErrorClass | null | undefined,
): boolean {
  if (!cls) return false;
  if (isSoftMicFailure(cls)) return false;
  return true;
}

/** i18n MessageKey fragment for a classified Live Voice error. */
export function liveVoiceErrorMessageKey(
  cls: VoiceLiveErrorClass,
): `voice.err.${VoiceLiveErrorClass}` {
  return `voice.err.${cls}`;
}

export function initialToolLoopState(): VoiceToolLoopState {
  return {
    status: "idle",
    name: null,
    reason: null,
    sessionId: null,
    permissionTitle: null,
  };
}

/**
 * Normalize host status tokens to VOX-BUILD-FULL canonical set.
 * Accepts legacy `running` / `ok` and aliases `tool_running` / `completed`.
 */
export function normalizeToolLoopStatus(
  raw: string | null | undefined,
): VoiceToolLoopStatus | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "idle") return "idle";
  if (s === "running" || s === "tool_running" || s === "in_progress") {
    return "tool_running";
  }
  if (
    s === "permission_pending" ||
    s === "permission" ||
    s === "awaiting_permission"
  ) {
    return "permission_pending";
  }
  if (s === "ok" || s === "completed" || s === "success" || s === "done") {
    return "completed";
  }
  if (s === "soft_fail" || s === "softfail" || s === "cancelled" || s === "canceled") {
    // cancelled is a soft-fail class (voice stays open); status stays soft_fail.
    return "soft_fail";
  }
  if (s === "error" || s === "failed" || s === "err" || s === "failure") {
    return "error";
  }
  return null;
}

/**
 * Normalize a host `voice://tool` payload. Returns null when name is absent
 * (never invents a tool). Status defaults: result present → completed, else
 * tool_running when status omitted for backward compatibility.
 */
export function parseToolLoopEvent(payload: {
  name?: string | null;
  status?: string | null;
  reason?: string | null;
  message?: string | null;
  sessionId?: string | null;
  session_id?: string | null;
  result?: unknown;
  errorClass?: string | null;
  permissionTitle?: string | null;
  title?: string | null;
} | null | undefined): VoiceToolLoopState | null {
  const name = toolEventName(payload);
  if (!name) return null;

  const statusRaw = (payload?.status ?? "").trim().toLowerCase();
  let status: VoiceToolLoopStatus;
  const normalized = normalizeToolLoopStatus(statusRaw);
  if (normalized && normalized !== "idle") {
    status = normalized;
  } else if (payload?.result !== undefined && payload?.result !== null) {
    // Legacy finish event with result but no status.
    const soft = softFailReasonFromToolResult(payload.result);
    status = soft ? "soft_fail" : "completed";
  } else if (statusRaw === "idle") {
    status = "idle";
  } else {
    // Name-only without status: treat as in-flight (start event).
    status = "tool_running";
  }

  let reason =
    (payload?.reason ?? "").trim() ||
    softFailReasonFromToolResult(payload?.result) ||
    null;
  if (!reason && (status === "error" || status === "soft_fail")) {
    const cls = classifyLiveVoiceError(
      payload?.message,
      payload?.errorClass,
    );
    reason = cls === "unknown" ? null : cls;
  }
  // Cancelled status without explicit reason.
  if (!reason && statusRaw === "cancelled") {
    reason = "cancelled";
  }

  const sessionId =
    (payload?.sessionId ?? payload?.session_id ?? "").trim() ||
    sessionIdFromToolResult(payload?.result) ||
    null;

  const permissionTitle =
    (payload?.permissionTitle ?? payload?.title ?? "").trim() || null;

  return {
    status,
    name,
    reason,
    sessionId,
    permissionTitle,
  };
}

/** Reduce tool-loop state from a parsed event (host order only). */
export function reduceToolLoopState(
  prev: VoiceToolLoopState,
  next: VoiceToolLoopState | null,
): VoiceToolLoopState {
  if (!next) return prev;
  if (next.status === "idle") return initialToolLoopState();
  return {
    status: next.status,
    name: next.name ?? prev.name,
    reason: next.reason,
    sessionId: next.sessionId ?? prev.sessionId,
    permissionTitle:
      next.permissionTitle !== undefined
        ? next.permissionTitle
        : prev.permissionTitle,
  };
}

/** True while a Build tool is in-flight or waiting on permission. */
export function isToolLoopBusy(loop: VoiceToolLoopState | null | undefined): boolean {
  const s = loop?.status;
  return s === "tool_running" || s === "running" || s === "permission_pending";
}

/** True while a delegated agent is blocked on user allow/deny. */
export function isPermissionPending(
  loop: VoiceToolLoopState | null | undefined,
): boolean {
  return loop?.status === "permission_pending";
}

/**
 * Extract soft-fail reason from a host tool result object.
 * Only trusts explicit `ok: false` + `reason` — never invents failures.
 */
export function softFailReasonFromToolResult(
  result: unknown,
): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (r.ok === false) {
    const reason = typeof r.reason === "string" ? r.reason.trim() : "";
    return reason || "unknown";
  }
  return null;
}

function sessionIdFromToolResult(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const sid = r.session_id ?? r.sessionId;
  if (typeof sid === "string" && sid.trim()) return sid.trim();
  return null;
}

/**
 * i18n key for the tool-loop status line. Null when idle (no chrome).
 * Callers interpolate `{name}` / `{reason}` / `{title}` as needed.
 */
export function toolLoopStatusMessageKey(
  loop: VoiceToolLoopState | null | undefined,
):
  | "voice.toolRunning"
  | "voice.toolRan"
  | "voice.toolSoftFail"
  | "voice.toolFailed"
  | "voice.permissionPending"
  | null {
  if (!loop || loop.status === "idle") return null;
  // permission_pending may use tool name or a generic "permission" label.
  if (loop.status === "permission_pending") {
    return "voice.permissionPending";
  }
  if (!loop.name) return null;
  switch (loop.status) {
    case "tool_running":
    case "running":
      return "voice.toolRunning";
    case "completed":
    case "ok":
      return "voice.toolRan";
    case "soft_fail":
      return "voice.toolSoftFail";
    case "error":
      return "voice.toolFailed";
    default:
      return null;
  }
}

/**
 * Whether a `session://permission` session id belongs to a voice-delegated
 * Build session. Never invents membership — only exact id match.
 */
export function isPermissionForDelegatedSession(
  sessionId: string | null | undefined,
  delegatedIds: readonly string[] | null | undefined,
): boolean {
  const sid = (sessionId ?? "").trim();
  if (!sid) return false;
  if (!delegatedIds?.length) return false;
  return delegatedIds.some((id) => id === sid);
}

/**
 * Parse a real host permission payload into a voice prompt. Returns null when
 * rpcId / sessionId are missing (never invents a prompt).
 */
export function parseVoicePermissionPrompt(payload: {
  rpcId?: number | null;
  rpc_id?: number | null;
  sessionId?: string | null;
  session_id?: string | null;
  toolCallId?: string | null;
  tool_call_id?: string | null;
  toolName?: string | null;
  tool_name?: string | null;
  title?: string | null;
  preview?: string | null;
  scopeKey?: string | null;
  scope_key?: string | null;
  options?: unknown;
} | null | undefined): VoicePermissionPrompt | null {
  if (!payload) return null;
  const rpcId = Number(payload.rpcId ?? payload.rpc_id);
  if (!Number.isFinite(rpcId) || rpcId <= 0) return null;
  const sessionId = String(
    payload.sessionId ?? payload.session_id ?? "",
  ).trim();
  if (!sessionId) return null;
  const toolName = String(
    payload.toolName ?? payload.tool_name ?? "",
  ).trim();
  const title = String(payload.title ?? "").trim() || toolName;
  return {
    rpcId,
    sessionId,
    toolCallId: String(
      payload.toolCallId ?? payload.tool_call_id ?? "",
    ).trim(),
    toolName,
    title,
    preview: String(payload.preview ?? "").trim(),
    scopeKey: String(payload.scopeKey ?? payload.scope_key ?? "").trim(),
    options: payload.options ?? null,
  };
}

/**
 * Build tool-loop state for a permission wait (status permission_pending).
 * Uses real tool name / title only — never invents a tool.
 */
export function permissionPendingToolLoopState(
  prompt: VoicePermissionPrompt,
): VoiceToolLoopState {
  const name = prompt.toolName.trim() || "permission";
  return {
    status: "permission_pending",
    name,
    reason: null,
    sessionId: prompt.sessionId,
    permissionTitle: prompt.title || name,
  };
}

/**
 * Soft-fail when the user denies (or permission is otherwise blocked).
 * Voice stays open — agent work is blocked honestly, not silently.
 */
export function softFailFromPermissionBlocked(opts: {
  toolName?: string | null;
  sessionId?: string | null;
  reason?: string | null;
}): VoiceToolLoopState {
  return {
    status: "soft_fail",
    name: (opts.toolName ?? "").trim() || "permission",
    reason: (opts.reason ?? "").trim() || "permission_denied",
    sessionId: (opts.sessionId ?? "").trim() || null,
    permissionTitle: null,
  };
}

/**
 * Soft-fail when voice stop cancels an in-flight host tool.
 */
export function softFailFromToolCancelled(opts: {
  toolName?: string | null;
  sessionId?: string | null;
}): VoiceToolLoopState {
  return {
    status: "soft_fail",
    name: (opts.toolName ?? "").trim() || "tool",
    reason: "cancelled",
    sessionId: (opts.sessionId ?? "").trim() || null,
    permissionTitle: null,
  };
}

/**
 * Whether stopping Live Voice should cancel delegated Build agents.
 * Default product: keep agents (`keepAgentsOnEnd === true`).
 */
export function shouldCancelDelegatedAgentsOnVoiceStop(
  keepAgentsOnEnd: boolean | null | undefined,
): boolean {
  // Explicit false → cancel; undefined/true → keep.
  return keepAgentsOnEnd === false;
}

/**
 * Decision string → soft-fail (deny) vs clear pending (allow).
 * Only trusts explicit decision tokens — never invents allow.
 */
export function isPermissionDenyDecision(
  decision: string | null | undefined,
): boolean {
  const d = (decision ?? "").trim().toLowerCase();
  return (
    d === "deny" ||
    d === "reject" ||
    d === "reject_once" ||
    d === "reject_always" ||
    d === "cancelled" ||
    d === "canceled"
  );
}

/**
 * Derive overlay status: speaking > thinking > listening > connecting/idle.
 * Prefers explicit host `phase` / `thinking` when present.
 * Soft mic warnings do not force error while the host session is active.
 */
export function deriveVoiceDelegatePhase(
  input: DeriveVoiceDelegatePhaseInput,
): VoiceDelegatePhase {
  if (input.ended) return "ended";
  if (input.connecting) return "connecting";

  const hostErr = input.state?.error?.trim() || null;
  const uiErr = input.uiError?.trim() || null;
  if (hostErr || uiErr) return "error";

  const st = input.state;
  if (!st?.active) {
    // Soft mic only and no host yet → still surface error so the user sees it.
    if (input.softMicWarning && isSoftMicFailure(input.softMicWarning)) {
      return "error";
    }
    return "idle";
  }

  const phaseRaw = (st.phase ?? "").trim().toLowerCase();
  if (
    phaseRaw === "speaking" ||
    phaseRaw === "listening" ||
    phaseRaw === "thinking" ||
    phaseRaw === "connecting" ||
    phaseRaw === "error" ||
    phaseRaw === "idle"
  ) {
    return phaseRaw as VoiceDelegatePhase;
  }

  if (st.speaking) return "speaking";
  const hostToolBusy = Boolean(st.activeTool?.trim());
  if (st.thinking || input.toolBusy || hostToolBusy || input.awaitingResponse) {
    return "thinking";
  }
  if (st.listening) return "listening";
  // Active but neither listening nor speaking — model / tools mid-turn.
  return "thinking";
}

/** Roles that carry conversational content (not system chrome). */
export function isConversationalRole(role: string): boolean {
  const r = role.trim().toLowerCase();
  return r === "user" || r === "assistant";
}

/**
 * Merge a host transcript delta into the line list.
 * Partial (non-final) deltas append to the last same-role open line.
 */
export function mergeTranscriptLine(
  prev: VoiceTranscriptLine[],
  role: string,
  text: string,
  final?: boolean,
  idFactory: () => string = () =>
    `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
): VoiceTranscriptLine[] {
  if (!text) return prev;
  const last = prev.length ? prev[prev.length - 1] : null;
  if (!final && last && last.role === role && !last.final) {
    const next = prev.slice();
    next[next.length - 1] = { ...last, text: last.text + text };
    return next;
  }
  return [
    ...prev,
    {
      id: idFactory(),
      role,
      text,
      final,
    },
  ];
}

/**
 * Format host transcript lines as a single prompt for the active session.
 * Uses only real conversational text — skips empty / system-only rows.
 * Returns "" when there is nothing honest to send (no invented STT).
 */
export function formatTranscriptAsPrompt(
  lines: readonly VoiceTranscriptLine[],
): string {
  const chunks: string[] = [];
  for (const line of lines) {
    if (!isConversationalRole(line.role)) continue;
    const t = line.text.trim();
    if (!t) continue;
    const label = line.role.trim().toLowerCase() === "user" ? "User" : "Assistant";
    chunks.push(`${label}: ${t}`);
  }
  return chunks.join("\n\n").trim();
}

/**
 * Whether the “send transcript to active session” control should show.
 * Requires explicit host/app support (callback), an active chat session,
 * and non-empty conversational transcript from real host events.
 */
export function canSendTranscriptAsPrompt(opts: {
  /** App passed onSendTranscriptAsPrompt (host supports). */
  supportsSend: boolean;
  hasActiveSession: boolean;
  transcriptText: string;
}): boolean {
  return (
    opts.supportsSend &&
    opts.hasActiveSession &&
    opts.transcriptText.trim().length > 0
  );
}

/** Why the transcript pane is empty — for honest empty copy. */
export type TranscriptEmptyKind = "none" | "system_only" | "has_content";

export function transcriptEmptyKind(
  lines: readonly VoiceTranscriptLine[],
): TranscriptEmptyKind {
  for (const line of lines) {
    if (isConversationalRole(line.role) && line.text.trim()) {
      return "has_content";
    }
  }
  if (lines.length > 0) return "system_only";
  return "none";
}

/** True when delegated session chips have at least one id. */
export function hasDelegatedSessions(
  state: VoiceHostStateLike | null | undefined,
): boolean {
  return (state?.delegatedSessionIds?.length ?? 0) > 0;
}

/**
 * Non-empty session id for delegated tracking.
 * Never invents — empty / whitespace → null.
 */
export function recordableDelegatedSessionId(
  sessionId: string | null | undefined,
): string | null {
  const s = (sessionId ?? "").trim();
  return s || null;
}

/**
 * Soft-fail classes that surface as classified toasts/banners without
 * inventing tool success (mic / auth / network / CLI).
 */
export function isClassifiedSoftFailNotice(
  cls: VoiceLiveErrorClass | null | undefined,
): boolean {
  return (
    cls === "mic_denied" ||
    cls === "mic_missing" ||
    cls === "auth" ||
    cls === "network" ||
    cls === "cli_missing" ||
    cls === "not_available"
  );
}

/**
 * Normalize a host tool event name. Returns null when absent — never invents.
 */
export function toolEventName(payload: {
  name?: string | null;
} | null | undefined): string | null {
  const n = payload?.name?.trim();
  return n ? n : null;
}

/**
 * After a final user transcript (host event), we may await model response.
 * After assistant partial/final or speaking, clear awaiting.
 */
export function nextAwaitingResponse(opts: {
  prev: boolean;
  role: string;
  final?: boolean;
  speaking?: boolean;
}): boolean {
  if (opts.speaking) return false;
  const role = opts.role.trim().toLowerCase();
  if (role === "user" && opts.final) return true;
  if (role === "assistant") return false;
  return opts.prev;
}

/**
 * Live Voice command center — pure helpers for session chips, empty-state
 * honesty, tool/permission status labels, keep-agents banner, and end plan.
 *
 * No invented STT / tool results. UI maps returned kinds to i18n keys.
 */

// ── Session chips ────────────────────────────────────────────────────────────

/** Input row for a chip (from App session list + live status). */
export type VoiceSessionChipInput = {
  id: string;
  title?: string | null;
  /** Host/UI status token (streaming · idle · ready · awaiting_permission · …). */
  status?: string | null;
  /** True when started from Live Voice host tools. */
  isDelegated?: boolean;
};

/** Normalized chip for the overlay strip. */
export type VoiceSessionChip = {
  id: string;
  /** Display label — real title or short id fallback (never invents speech). */
  label: string;
  /** Normalized status token for CSS / a11y. */
  status: VoiceChipStatus;
  isDelegated: boolean;
  /** Visual tone bucket. */
  tone: VoiceChipTone;
};

export type VoiceChipStatus =
  | "running"
  | "permission"
  | "idle"
  | "done"
  | "error"
  | "unknown";

export type VoiceChipTone =
  | "running"
  | "permission"
  | "idle"
  | "done"
  | "error"
  | "unknown";

const SHORT_ID_LEN = 8;
const MAX_LABEL_LEN = 28;

/**
 * Normalize a free-form session status into a chip status.
 * Unknown tokens stay `unknown` — never invents "running".
 */
export function normalizeVoiceChipStatus(
  raw: string | null | undefined,
): VoiceChipStatus {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return "unknown";
  if (
    s === "streaming" ||
    s === "running" ||
    s === "busy" ||
    s === "connecting" ||
    s === "thinking" ||
    s === "tool_running" ||
    s === "in_progress"
  ) {
    return "running";
  }
  if (
    s === "awaiting_permission" ||
    s === "permission_pending" ||
    s === "permission"
  ) {
    return "permission";
  }
  if (
    s === "idle" ||
    s === "ready" ||
    s === "active" ||
    s === "listening" ||
    s === "disconnected"
  ) {
    return "idle";
  }
  if (
    s === "done" ||
    s === "completed" ||
    s === "complete" ||
    s === "finished" ||
    s === "ended"
  ) {
    return "done";
  }
  if (
    s === "error" ||
    s === "failed" ||
    s === "failure" ||
    s === "crashed"
  ) {
    return "error";
  }
  return "unknown";
}

/** Map chip status → tone (1:1 for CSS). */
export function voiceChipTone(status: VoiceChipStatus): VoiceChipTone {
  return status;
}

/**
 * Build a display label from a real title or short id.
 * Never invents STT / fake session names.
 */
export function formatVoiceSessionChipLabel(
  id: string,
  title?: string | null,
): string {
  const t = (title ?? "").trim();
  if (t) {
    if (t.length <= MAX_LABEL_LEN) return t;
    return `${t.slice(0, MAX_LABEL_LEN - 1)}…`;
  }
  const sid = (id ?? "").trim();
  if (!sid) return "session";
  return sid.length <= SHORT_ID_LEN ? sid : sid.slice(0, SHORT_ID_LEN);
}

/**
 * Build ordered session chips for the command-center strip.
 * - Prefers delegated sessions first, then other active/running rows.
 * - Drops empty ids; never invents sessions.
 * - When `preferDelegatedOnly` is true (default when any isDelegated), only
 *   delegated rows are shown (product: voice-started coding sessions).
 */
export function buildVoiceSessionChips(
  sessions: readonly VoiceSessionChipInput[] | null | undefined,
  opts?: { preferDelegatedOnly?: boolean },
): VoiceSessionChip[] {
  if (!sessions?.length) return [];

  const cleaned = sessions
    .map((s) => {
      const id = (s.id ?? "").trim();
      if (!id) return null;
      const status = normalizeVoiceChipStatus(s.status);
      return {
        id,
        label: formatVoiceSessionChipLabel(id, s.title),
        status,
        isDelegated: Boolean(s.isDelegated),
        tone: voiceChipTone(status),
      } satisfies VoiceSessionChip;
    })
    .filter((c): c is VoiceSessionChip => c !== null);

  if (!cleaned.length) return [];

  const hasAnyDelegated = cleaned.some((c) => c.isDelegated);
  const preferDelegatedOnly = opts?.preferDelegatedOnly ?? hasAnyDelegated;

  let list = cleaned;
  if (preferDelegatedOnly && hasAnyDelegated) {
    list = cleaned.filter((c) => c.isDelegated);
  }

  // Delegated first, then running/permission, stable by input order.
  return list.slice().sort((a, b) => {
    if (a.isDelegated !== b.isDelegated) return a.isDelegated ? -1 : 1;
    const rank = (s: VoiceChipStatus) =>
      s === "permission" ? 0 : s === "running" ? 1 : s === "error" ? 2 : 3;
    const d = rank(a.status) - rank(b.status);
    if (d !== 0) return d;
    return 0;
  });
}

/**
 * Map App session rows + liveMap states into chip inputs.
 * Only real session ids; status from liveMap when present (else idle).
 * Never invents sessions or streaming state.
 */
export function mapSessionsToVoiceChipInputs(opts: {
  sessions: readonly { id: string; title?: string | null }[] | null | undefined;
  /** sessionId → host live state token (streaming · idle · …). */
  liveStates?: Record<string, string | undefined | null> | null;
  untitledLabel: string;
}): VoiceSessionChipInput[] {
  const out: VoiceSessionChipInput[] = [];
  for (const s of opts.sessions ?? []) {
    const id = (s.id ?? "").trim();
    if (!id) continue;
    const title = (s.title ?? "").trim() || opts.untitledLabel;
    const status = (opts.liveStates?.[id] ?? "").trim() || "idle";
    out.push({ id, title, status });
  }
  return out;
}

/**
 * Merge host delegated ids with sidebar session summaries for chips.
 * Host ids without a title stay as short-id labels (honest).
 */
export function mergeVoiceSessionsForChips(opts: {
  delegatedIds?: readonly string[] | null;
  sessions?: readonly VoiceSessionChipInput[] | null;
}): VoiceSessionChipInput[] {
  const delegated = new Set(
    (opts.delegatedIds ?? []).map((id) => id.trim()).filter(Boolean),
  );
  const byId = new Map<string, VoiceSessionChipInput>();

  for (const s of opts.sessions ?? []) {
    const id = (s.id ?? "").trim();
    if (!id) continue;
    byId.set(id, {
      id,
      title: s.title,
      status: s.status,
      isDelegated: s.isDelegated || delegated.has(id),
    });
  }

  for (const id of delegated) {
    if (byId.has(id)) {
      const prev = byId.get(id)!;
      byId.set(id, { ...prev, isDelegated: true });
    } else {
      byId.set(id, { id, title: null, status: "unknown", isDelegated: true });
    }
  }

  return Array.from(byId.values());
}

// ── Empty-state honesty ──────────────────────────────────────────────────────

/**
 * Why the command center shows empty / soft-fail chrome.
 * Priority: auth → mic → transcript empty (with/without delegates) → null (has content).
 * Never invents STT text for the empty pane.
 */
export type VoiceCenterEmptyKind =
  | "no_auth"
  | "no_mic"
  | "transcript_empty"
  | "transcript_empty_with_delegates"
  | "ready_no_speech"
  | null;

/**
 * Resolve empty-state honesty kind for the Live Voice command center.
 * When `transcriptEmpty` is false, returns null (real host text is showing).
 * Soft mic/auth banners still surface separately in the overlay.
 */
export function resolveVoiceCenterEmptyState(opts: {
  hasMic: boolean;
  hasAuth: boolean;
  hasDelegates: boolean;
  transcriptEmpty: boolean;
}): VoiceCenterEmptyKind {
  // Real conversational content → no empty chrome.
  if (!opts.transcriptEmpty) return null;
  // Auth / mic honesty only when there is nothing to read yet.
  if (!opts.hasAuth) return "no_auth";
  if (!opts.hasMic) return "no_mic";
  if (opts.hasDelegates) return "transcript_empty_with_delegates";
  // Soft mic/auth ok, nothing spoken yet — honest waiting copy.
  return "transcript_empty";
}

/** i18n MessageKey fragment for empty kinds (null when no empty chrome). */
export function voiceCenterEmptyMessageKey(
  kind: VoiceCenterEmptyKind,
): string | null {
  switch (kind) {
    case "no_auth":
      return "voice.center.empty.noAuth";
    case "no_mic":
      return "voice.center.empty.noMic";
    case "transcript_empty":
      return "voice.transcriptEmpty";
    case "transcript_empty_with_delegates":
      return "voice.center.empty.transcriptWithDelegates";
    case "ready_no_speech":
      return "voice.transcriptEmpty";
    default:
      return null;
  }
}

// ── Tool status ──────────────────────────────────────────────────────────────

export type VoiceToolStatusInput = {
  name?: string | null;
  status?: string | null;
};

export type FormattedVoiceToolStatus = {
  /** Canonical status token (tool_running · permission_pending · …). */
  status: string;
  /** Real tool name or null when absent (never invents). */
  name: string | null;
  /** Compact status line without inventing names. */
  label: string;
  /** i18n key for status chrome (null when idle / absent). */
  messageKey: string | null;
  busy: boolean;
};

/**
 * Format a Build tool status for the command-center status region.
 * Name comes only from host events — empty name → no invented tool.
 */
export function formatVoiceToolStatus(
  tool: VoiceToolStatusInput | null | undefined,
): FormattedVoiceToolStatus {
  const name = (tool?.name ?? "").trim() || null;
  const raw = (tool?.status ?? "").trim().toLowerCase();

  let status = "idle";
  if (
    raw === "running" ||
    raw === "tool_running" ||
    raw === "in_progress"
  ) {
    status = "tool_running";
  } else if (
    raw === "permission_pending" ||
    raw === "permission" ||
    raw === "awaiting_permission"
  ) {
    status = "permission_pending";
  } else if (
    raw === "ok" ||
    raw === "completed" ||
    raw === "success" ||
    raw === "done"
  ) {
    status = "completed";
  } else if (
    raw === "soft_fail" ||
    raw === "softfail" ||
    raw === "cancelled" ||
    raw === "canceled"
  ) {
    status = "soft_fail";
  } else if (raw === "error" || raw === "failed" || raw === "failure") {
    status = "error";
  } else if (raw && raw !== "idle") {
    status = raw;
  } else if (name && !raw) {
    // Name-only without status: treat as in-flight (host start event).
    status = "tool_running";
  }

  if (!name && (status === "idle" || !raw)) {
    return {
      status: "idle",
      name: null,
      label: "",
      messageKey: null,
      busy: false,
    };
  }

  const busy =
    status === "tool_running" || status === "permission_pending";

  let messageKey: string | null = null;
  switch (status) {
    case "tool_running":
      messageKey = "voice.toolRunning";
      break;
    case "permission_pending":
      messageKey = "voice.permissionPending";
      break;
    case "completed":
      messageKey = "voice.toolRan";
      break;
    case "soft_fail":
      messageKey = "voice.toolSoftFail";
      break;
    case "error":
      messageKey = "voice.toolFailed";
      break;
    default:
      messageKey = name ? "voice.toolRunning" : null;
  }

  const displayName = name ?? "tool";
  const label =
    status === "permission_pending"
      ? `permission · ${displayName}`
      : `${status} · ${displayName}`;

  return {
    status,
    name,
    label,
    messageKey,
    busy,
  };
}

// ── Keep-agents banner ───────────────────────────────────────────────────────

export type KeepAgentsBanner = {
  /** Pref is on — ending voice keeps coding sessions. */
  keep: boolean;
  /** i18n key for footer honesty line. */
  messageKey: string;
};

/**
 * Footer honesty for “Keep coding sessions after Live Voice” setting.
 */
export function resolveKeepAgentsBanner(
  keepAgentsOnEnd: boolean | null | undefined,
): KeepAgentsBanner {
  // Product default: keep (undefined/true).
  const keep = keepAgentsOnEnd !== false;
  return {
    keep,
    messageKey: keep
      ? "voice.center.keepAgentsOn"
      : "voice.center.keepAgentsOff",
  };
}

// ── End-session plan ─────────────────────────────────────────────────────────

export type VoiceEndAction =
  | "stop_voice"
  | "cancel_in_flight_tools"
  | "keep_delegates"
  | "cancel_delegates";

export type VoiceEndPlan = {
  /** Ordered host/UI actions (for copy and host flags). */
  actions: VoiceEndAction[];
  /** Whether delegated agents will be cancelled. */
  willCancelDelegates: boolean;
  /** Whether any running delegates were observed. */
  hasRunningDelegates: boolean;
  /** i18n key for end-button / confirm note (no window.confirm — overlay copy). */
  noteMessageKey: string;
};

/**
 * Plan what ending Live Voice will do (honesty for footer / end control).
 * Does not invent running delegates — caller passes observed flag.
 */
export function planVoiceEnd(opts: {
  keepAgents: boolean | null | undefined;
  hasRunningDelegates: boolean;
}): VoiceEndPlan {
  const keep = opts.keepAgents !== false;
  const hasRunning = Boolean(opts.hasRunningDelegates);
  const willCancelDelegates = !keep && hasRunning;

  const actions: VoiceEndAction[] = [
    "stop_voice",
    "cancel_in_flight_tools",
  ];
  if (keep) {
    actions.push("keep_delegates");
  } else if (hasRunning) {
    actions.push("cancel_delegates");
  } else {
    actions.push("keep_delegates");
  }

  let noteMessageKey: string;
  if (willCancelDelegates) {
    noteMessageKey = "voice.center.endNote.cancelDelegates";
  } else if (hasRunning && keep) {
    noteMessageKey = "voice.center.endNote.keepRunning";
  } else if (keep) {
    noteMessageKey = "voice.center.endNote.keepAgents";
  } else {
    noteMessageKey = "voice.center.endNote.stopOnly";
  }

  return {
    actions,
    willCancelDelegates,
    hasRunningDelegates: hasRunning,
    noteMessageKey,
  };
}

/** True when any chip is running or waiting on permission. */
export function hasRunningVoiceDelegates(
  chips: readonly VoiceSessionChip[] | null | undefined,
): boolean {
  if (!chips?.length) return false;
  return chips.some(
    (c) =>
      c.isDelegated &&
      (c.status === "running" || c.status === "permission"),
  );
}

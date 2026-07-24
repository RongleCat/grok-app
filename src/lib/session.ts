import type { Locale } from "../i18n";

export type SessionState =
  | "idle"
  | "connecting"
  | "ready"
  | "streaming"
  | "awaiting_permission"
  | "disconnected";

export type AgentErrorCode =
  | "CLI_NOT_FOUND"
  | "AUTH_FAILED"
  | "NETWORK_PROVIDER"
  | "AGENT_CRASHED"
  | "QUOTA_EXCEEDED"
  | "CONNECT_FAILED"
  | "PROCESS_LIMIT";

export interface AgentError {
  code: AgentErrorCode;
  message: string;
}

export interface SessionSnapshot {
  sessionId: string | null;
  agentSessionId?: string | null;
  state: SessionState;
  lastError: AgentError | null;
  streamingMessageId: string | null;
  backend: string;
  modelId?: string | null;
  projectPath?: string | null;
  title?: string;
}

export interface MessageAttachment {
  path: string;
  name: string;
  isDir: boolean;
}

/** Ordered assistant turn pieces — thinking and body as they actually arrived. */
export type MessageSegment =
  | { kind: "thought"; text: string }
  | { kind: "content"; text: string };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  /** Joined thought text (legacy + journal). Prefer thoughtPhases for UI. */
  thought?: string;
  /**
   * Separate thinking segments for this assistant message.
   * Phase 0 = pre-tool reasoning; later phases = resumed thinking after tools.
   * Prefer `segments` for interleaved rendering.
   */
  thoughtPhases?: string[];
  /**
   * Timeline of thought / content chunks in stream order.
   * UI renders these interleaved (not all thinking stacked above the body).
   */
  segments?: MessageSegment[];
  streaming?: boolean;
  toolStatus?: string;
  /** Turn failed (retries exhausted / provider error) — show as chat error record. */
  isError?: boolean;
  /** Local file/folder refs shown as cards (also embedded as @path for agent). */
  attachments?: MessageAttachment[];
  /** ISO timestamp when the message was created (for hover footer). */
  createdAt?: string;
  /** System markers: context_compact, tool_step, turn_cancelled, etc. */
  marker?: "context_compact" | "tool_step" | "turn_cancelled" | string;
  /** Compact event details (UI). */
  compactMeta?: ContextCompactMeta;
  /** Live / persisted tool activity. */
  toolCallId?: string;
  toolKind?: string;
  toolDetail?: string;
  toolPath?: string;
}

export interface ToolEventPayload {
  sessionId?: string;
  toolCallId?: string;
  title?: string;
  kind?: string;
  status?: string;
  path?: string | null;
  detail?: string | null;
}

export interface TurnMarkerPayload {
  sessionId?: string;
  messageId?: string;
  marker?: string;
  reason?: string;
  content?: string;
}

export interface ContextCompactMeta {
  trigger: "auto" | "manual" | string;
  tokensBefore?: number;
  tokensAfter?: number;
  summaryPreview?: string;
  note?: string;
}

export interface ContextCompactPayload {
  sessionId?: string;
  messageId?: string;
  trigger?: string;
  tokensBefore?: number;
  tokensAfter?: number;
  summaryPreview?: string;
  note?: string;
  content?: string;
}

/** Append a context-compact marker row (dedupe by messageId). */
export function applyContextCompact(
  messages: ChatMessage[],
  payload: ContextCompactPayload,
): ChatMessage[] {
  const id = payload.messageId || `compact-${Date.now()}`;
  if (messages.some((m) => m.id === id)) return messages;
  const trigger = (payload.trigger || "auto").toLowerCase();
  const meta: ContextCompactMeta = {
    trigger: trigger === "manual" ? "manual" : trigger === "auto" ? "auto" : trigger,
    tokensBefore: payload.tokensBefore,
    tokensAfter: payload.tokensAfter,
    summaryPreview: payload.summaryPreview,
    note: payload.note,
  };
  return [
    ...messages,
    {
      id,
      role: "tool",
      content: payload.content || "context_compact",
      marker: "context_compact",
      compactMeta: meta,
      createdAt: new Date().toISOString(),
    },
  ];
}

/** True for placeholder labels we never want as live UI text. */
export function isGenericToolLabel(s: string | undefined | null): boolean {
  const t = (s || "").trim().toLowerCase();
  return (
    !t ||
    t === "tool" ||
    t === "tools" ||
    t === "工具" ||
    t === "unknown" ||
    t === "function"
  );
}

/** Prefer human call text: title → detail → path → prev → kind (never bare "tool"). */
export function resolveToolDisplayTitle(
  payload: {
    title?: string | null;
    kind?: string | null;
    detail?: string | null;
    path?: string | null;
  },
  prevContent?: string | null,
): string {
  const title = (payload.title || "").trim();
  if (title && !isGenericToolLabel(title)) return title;
  const detail = (payload.detail || "").trim();
  if (detail) return detail;
  const path = (payload.path || "").trim();
  if (path) return path;
  const prev = (prevContent || "").trim();
  if (prev && !isGenericToolLabel(prev) && !prev.startsWith("tool_step|")) {
    return prev;
  }
  const kind = (payload.kind || "").trim();
  if (kind && !isGenericToolLabel(kind)) {
    return kind.replace(/[_./]+/g, " ").trim();
  }
  // Empty → UI hides the line until a real title arrives (no "tool" flash).
  return "";
}

/** Upsert a tool activity row by toolCallId (Codex-style live activity). */
export function applyToolEvent(
  messages: ChatMessage[],
  payload: ToolEventPayload,
): ChatMessage[] {
  const tcid = (payload.toolCallId || "").trim();
  if (!tcid) return messages;
  const status = (payload.status || "in_progress").toLowerCase();
  const running =
    status === "in_progress" ||
    status === "pending" ||
    status === "running" ||
    status === "";
  const id = `tool-${tcid}`;
  const now = new Date().toISOString();
  const idx = messages.findIndex(
    (m) => m.id === id || m.toolCallId === tcid,
  );
  const prev = idx >= 0 ? messages[idx]! : null;
  const title = resolveToolDisplayTitle(payload, prev?.content);
  const nextRow: ChatMessage = {
    id,
    role: "tool",
    content: title,
    toolCallId: tcid,
    toolKind: payload.kind || undefined,
    toolStatus: status || "in_progress",
    toolDetail: payload.detail?.trim() || undefined,
    toolPath: payload.path?.trim() || undefined,
    streaming: running,
    marker: "tool_step",
    createdAt: now,
    isError: status === "failed" || status === "error",
  };
  if (idx < 0) return [...messages, nextRow];
  const copy = messages.slice();
  // Never downgrade a good title to empty / generic on later updates.
  const mergedTitle =
    title ||
    resolveToolDisplayTitle(
      {
        title: prev!.content,
        kind: prev!.toolKind,
        detail: prev!.toolDetail,
        path: prev!.toolPath,
      },
      prev!.content,
    );
  copy[idx] = {
    ...prev!,
    ...nextRow,
    createdAt: prev!.createdAt || now,
    content: mergedTitle,
    toolDetail: nextRow.toolDetail || prev!.toolDetail,
    toolPath: nextRow.toolPath || prev!.toolPath,
    toolKind: nextRow.toolKind || prev!.toolKind,
  };
  return copy;
}

export function applyTurnMarker(
  messages: ChatMessage[],
  payload: TurnMarkerPayload,
): ChatMessage[] {
  const id = payload.messageId || `marker-${Date.now()}`;
  if (messages.some((m) => m.id === id)) return messages;
  const marker = payload.marker || "turn_cancelled";
  return [
    ...messages.map((m) =>
      m.streaming ? { ...m, streaming: false } : m,
    ),
    {
      id,
      role: "tool",
      content: payload.content || marker,
      marker,
      toolStatus: payload.reason || "cancelled",
      createdAt: new Date().toISOString(),
      isError: marker === "turn_cancelled",
    },
  ];
}

/** True for journal / live tool_step activity rows. */
export function isToolStepMessage(m: ChatMessage): boolean {
  return (
    m.marker === "tool_step" ||
    (m.role === "tool" && !!m.content?.startsWith("tool_step|"))
  );
}

/**
 * Latest tool in the current turn (after last user message).
 * Prefer a still-running tool; else the most recent tool row.
 */
export function pickLatestTurnTool(
  messages: ChatMessage[],
): ChatMessage | null {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      lastUser = i;
      break;
    }
  }
  const from = lastUser + 1;
  let latest: ChatMessage | null = null;
  let latestRunning: ChatMessage | null = null;
  for (let i = from; i < messages.length; i++) {
    const m = messages[i]!;
    if (!isToolStepMessage(m)) continue;
    latest = m;
    if (m.streaming) latestRunning = m;
  }
  return latestRunning || latest;
}

/**
 * Only a still-running tool in the current turn, with a real display title.
 * Used for mid-stream one-line UI: show call text while running; hide when done
 * or while we only have a placeholder (no "tool" flash).
 */
export function pickRunningTurnTool(
  messages: ChatMessage[],
): ChatMessage | null {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      lastUser = i;
      break;
    }
  }
  let latestRunning: ChatMessage | null = null;
  for (let i = lastUser + 1; i < messages.length; i++) {
    const m = messages[i]!;
    if (!isToolStepMessage(m)) continue;
    if (m.streaming) latestRunning = m;
  }
  if (!latestRunning) return null;
  // Hide until we have real call text (avoids "tool" → content → blank flicker).
  if (!toolStepDisplayTitle(latestRunning)) return null;
  return latestRunning;
}

/** One-line title for live tool text — empty when only a placeholder. */
export function toolStepDisplayTitle(m: ChatMessage): string {
  const fromContent = m.content?.trim() || "";
  if (
    fromContent &&
    !fromContent.startsWith("tool_step|") &&
    !isGenericToolLabel(fromContent)
  ) {
    return fromContent;
  }
  const parsed = fromContent.startsWith("tool_step|")
    ? parseToolStepContent(fromContent)
    : null;
  return resolveToolDisplayTitle(
    {
      title: parsed?.title || fromContent,
      kind: m.toolKind || parsed?.kind,
      detail: m.toolDetail || parsed?.detail,
      path: m.toolPath || parsed?.path,
    },
    fromContent,
  );
}

/** Parse persisted tool_step journal lines. */
export function parseToolStepContent(content: string): {
  status: string;
  kind: string;
  title: string;
  detail?: string;
  path?: string;
} | null {
  if (!content.startsWith("tool_step|")) return null;
  const [header, ...rest] = content.split("\n");
  const parts = (header || "").split("|");
  // tool_step|status|kind|title
  const status = parts[1] || "completed";
  const kind = parts[2] || "";
  const title = parts.slice(3).join("|") || kind || "tool";
  const detailLine = rest[0]?.trim();
  const pathLine = rest[1]?.trim();
  return {
    status,
    kind,
    title,
    detail: detailLine || undefined,
    path: pathLine || undefined,
  };
}

/** Parse journal content written by Host for compact markers. */
export function parseCompactContent(
  content: string,
): ContextCompactMeta | null {
  if (!content.startsWith("context_compact|") && !content.startsWith("context_compact")) {
    return null;
  }
  const [header, ...rest] = content.split("\n");
  const parts = (header || "").split("|").slice(1);
  const meta: ContextCompactMeta = { trigger: "auto" };
  for (const p of parts) {
    if (p === "auto" || p === "manual") meta.trigger = p;
    else if (p.startsWith("tokens:")) {
      const m = /^tokens:(\d+)->(\d+)$/.exec(p);
      if (m) {
        meta.tokensBefore = Number(m[1]);
        meta.tokensAfter = Number(m[2]);
      }
    } else if (p.startsWith("tokens_before:")) {
      meta.tokensBefore = Number(p.slice("tokens_before:".length)) || undefined;
    } else if (p.startsWith("tokens_after:")) {
      meta.tokensAfter = Number(p.slice("tokens_after:".length)) || undefined;
    } else if (p.startsWith("note:")) {
      meta.note = p.slice(5);
    }
  }
  const summary = rest.join("\n").trim();
  if (summary) meta.summaryPreview = summary;
  return meta;
}

export interface TurnErrorPayload {
  sessionId?: string;
  messageId?: string;
  code?: string;
  message?: string;
  content?: string;
}

/**
 * Convert in-flight thinking bubble into a persistent error row in the thread.
 * If no streaming assistant exists, append a new error message.
 *
 * Stores a friendly, locale-aware body (not raw RPC/MCP dumps).
 */
export function applyTurnError(
  messages: ChatMessage[],
  payload: TurnErrorPayload,
  locale: Locale = "zh",
): ChatMessage[] {
  const content = formatTurnErrorBody(payload, locale);
  const mid = payload.messageId || "";

  let idx = mid ? messages.findIndex((m) => m.id === mid) : -1;
  if (idx < 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role === "assistant" && m.streaming) {
        idx = i;
        break;
      }
    }
  }
  if (idx < 0) {
    // Last empty assistant (host may have already cleared streaming)
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role === "assistant" && !m.content.trim() && !m.isError) {
        idx = i;
        break;
      }
    }
  }

  if (idx >= 0) {
    const next = messages.slice();
    const prev = next[idx]!;
    next[idx] = {
      ...prev,
      id: mid || prev.id,
      content,
      thought: undefined,
      streaming: false,
      isError: true,
    };
    // Clear any other lingering streaming flags
    return next.map((m, i) =>
      i !== idx && m.streaming ? { ...m, streaming: false } : m,
    );
  }

  return [
    ...messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
    {
      id: mid || `err-${Date.now()}`,
      role: "assistant",
      content,
      streaming: false,
      isError: true,
    },
  ];
}

export interface StreamPayload {
  sessionId: string;
  messageId: string;
  text: string;
  done: boolean;
  kind?: "assistant" | "thought";
  /** Host hint: open | new | continue | none — split multi-phase thinking. */
  thoughtPhase?: "open" | "new" | "continue" | "none" | string;
}

/** Split persisted thought on host phase markers. */
export function splitThoughtPhases(thought: string | undefined | null): string[] {
  if (!thought?.trim()) return [];
  return thought
    .split(/\n\n⟪phase⟫\n\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const THOUGHT_PHASE_JOIN = "\n\n⟪phase⟫\n\n";

/** Sync legacy thought / content / thoughtPhases fields from a segment timeline. */
export function deriveFieldsFromSegments(segments: MessageSegment[]): {
  content: string;
  thought: string | undefined;
  thoughtPhases: string[] | undefined;
} {
  const thoughts = segments
    .filter((s): s is { kind: "thought"; text: string } => s.kind === "thought")
    .map((s) => s.text)
    .filter((t) => t.trim());
  const content = segments
    .filter((s): s is { kind: "content"; text: string } => s.kind === "content")
    .map((s) => s.text)
    .join("");
  return {
    content,
    thought: thoughts.length ? thoughts.join(THOUGHT_PHASE_JOIN) : undefined,
    thoughtPhases: thoughts.length ? thoughts : undefined,
  };
}

/**
 * Build an interleaved timeline from journal fields.
 * Host stores one content blob + thought phases (pre-body, then post-body…).
 * Approximation: first thought phase(s) before body, remaining after body.
 * Live streaming uses applyStreamChunk which keeps true order in `segments`.
 */
export function buildSegmentsFromLegacy(
  content: string,
  thought?: string | null,
  thoughtPhases?: string[] | null,
): MessageSegment[] {
  const phases = (
    thoughtPhases?.length ? thoughtPhases : splitThoughtPhases(thought)
  )
    .map((p) => p.trim())
    .filter(Boolean);
  const body = content ?? "";
  if (!phases.length) {
    return body ? [{ kind: "content", text: body }] : [];
  }
  if (phases.length === 1) {
    const segs: MessageSegment[] = [{ kind: "thought", text: phases[0]! }];
    if (body) segs.push({ kind: "content", text: body });
    return segs;
  }
  // Multi-phase: first phase pre-body, rest after body (host convention).
  const segs: MessageSegment[] = [{ kind: "thought", text: phases[0]! }];
  if (body) segs.push({ kind: "content", text: body });
  for (let i = 1; i < phases.length; i++) {
    segs.push({ kind: "thought", text: phases[i]! });
  }
  return segs;
}

/** Prefer live segments; otherwise reconstruct from legacy fields. */
export function messageSegments(m: ChatMessage): MessageSegment[] {
  if (m.segments?.length) return m.segments;
  return buildSegmentsFromLegacy(m.content, m.thought, m.thoughtPhases);
}

function ensureSegments(prev: ChatMessage): MessageSegment[] {
  if (prev.segments?.length) return prev.segments.map((s) => ({ ...s }));
  return buildSegmentsFromLegacy(prev.content, prev.thought, prev.thoughtPhases);
}

function appendThoughtToSegments(
  segs: MessageSegment[],
  text: string,
  phaseHint: string,
): MessageSegment[] {
  if (!text) return segs;
  const last = segs[segs.length - 1];
  // New phase, or resume after body → open a new thought block.
  if (
    phaseHint === "new" ||
    !last ||
    last.kind !== "thought"
  ) {
    segs.push({ kind: "thought", text });
  } else {
    last.text += text;
  }
  return segs;
}

function appendContentToSegments(
  segs: MessageSegment[],
  text: string,
): MessageSegment[] {
  if (!text) return segs;
  const last = segs[segs.length - 1];
  if (last?.kind === "content") {
    last.text += text;
  } else {
    segs.push({ kind: "content", text });
  }
  return segs;
}

export interface PermissionPayload {
  rpcId: number;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  title: string;
  preview: string;
  scopeKey: string;
  options: unknown;
}

export interface AskUserOption {
  id: string;
  label: string;
  description?: string | null;
}

export interface AskUserQuestionItem {
  id: string;
  question: string;
  options: AskUserOption[];
  multiSelect?: boolean;
}

/** Payload for `session://ask_user` (`_x.ai/ask_user_question`). */
export interface AskUserPayload {
  rpcId: number;
  sessionId: string;
  toolCallId?: string | null;
  questions: AskUserQuestionItem[];
}

export const IDLE_SNAPSHOT: SessionSnapshot = {
  sessionId: null,
  agentSessionId: null,
  state: "idle",
  lastError: null,
  streamingMessageId: null,
  backend: "grok_agent_stdio",
  modelId: null,
  projectPath: null,
  title: "",
};

export function statusPresentation(state: SessionState): {
  label: string;
  dot: "success" | "warning" | "danger" | "info" | "idle";
} {
  switch (state) {
    case "idle":
      return { label: "Idle", dot: "idle" };
    case "connecting":
      return { label: "Connecting…", dot: "warning" };
    case "ready":
      return { label: "Ready", dot: "success" };
    case "streaming":
      return { label: "working…", dot: "info" };
    case "awaiting_permission":
      return { label: "Awaiting permission", dot: "warning" };
    case "disconnected":
      return { label: "Disconnected", dot: "danger" };
  }
}

/**
 * Allow drafting the next message even while the agent is streaming.
 * Users reported the composer felt "stuck" when output paused mid-turn —
 * keeping the input focusable lets them edit / queue text and still hit Stop.
 * Block only during permission prompts (modal decision in progress).
 */
export function canType(state: SessionState): boolean {
  return state !== "awaiting_permission";
}

/**
 * UI may enable Send before Host is ready; App ensures silent connect on submit.
 * Still block send while streaming / awaiting permission (one turn at a time).
 */
export function canSend(state: SessionState): boolean {
  return state !== "streaming" && state !== "awaiting_permission";
}

export function canStop(state: SessionState): boolean {
  return state === "streaming" || state === "awaiting_permission";
}

/** Host / UI “in progress” — sidebar spinner and cache preference. */
export function isSessionBusy(state: SessionState): boolean {
  return (
    state === "connecting" ||
    state === "streaming" ||
    state === "awaiting_permission"
  );
}

/**
 * Whether a live LLM turn is actually producing output right now.
 * Stricter than {@link isSessionBusy}: excludes `connecting`, so replayed or
 * stale stream chunks arriving mid-connect cannot re-type history.
 */
export function isSessionLiveStreaming(state: SessionState): boolean {
  return state === "streaming" || state === "awaiting_permission";
}

/**
 * Drop the last user message and everything after it (assistant reply, errors, tools).
 * Used by edit-resend so the prior turn is fully replaced, not stacked.
 */
export function truncateBeforeLastUser(messages: ChatMessage[]): ChatMessage[] {
  let cut = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      cut = i;
      break;
    }
  }
  return messages.slice(0, cut);
}

/** Number of user-role messages (0-based prompt index length). */
export function countUserPrompts(messages: ChatMessage[]): number {
  return messages.reduce((n, m) => (m.role === "user" ? n + 1 : n), 0);
}

/**
 * 0-based user prompt index for a message id, or `-1` when not a user message.
 */
export function userPromptIndexOf(
  messages: ChatMessage[],
  messageId: string,
): number {
  let idx = 0;
  for (const m of messages) {
    if (m.role !== "user") continue;
    if (m.id === messageId) return idx;
    idx += 1;
  }
  return -1;
}

/**
 * End index (exclusive) of the full turn for `userPromptIndex` (0-based).
 * A turn = that user message + following non-user rows until the next user.
 * Returns `-1` when the index is out of range.
 */
export function endIndexThroughUserPrompt(
  messages: ChatMessage[],
  userPromptIndex: number,
): number {
  if (userPromptIndex < 0 || !Number.isFinite(userPromptIndex)) return -1;
  let userI = 0;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role !== "user") continue;
    if (userI === userPromptIndex) {
      let j = i + 1;
      while (j < messages.length && messages[j]?.role !== "user") j += 1;
      return j;
    }
    userI += 1;
  }
  return -1;
}

/**
 * Keep messages through the end of the turn for `userPromptIndex` (0-based).
 * Matches ACP `/rewind` semantics: discard everything **after** the selected turn.
 * Returns a copy; empty when index is out of range.
 */
export function truncateThroughUserPrompt(
  messages: ChatMessage[],
  userPromptIndex: number,
): ChatMessage[] {
  const end = endIndexThroughUserPrompt(messages, userPromptIndex);
  if (end < 0) return [];
  return messages.slice(0, end);
}

/** True when journal has rows after the selected user turn (something to drop). */
export function canRewindToUserPrompt(
  messages: ChatMessage[],
  userPromptIndex: number,
): boolean {
  const end = endIndexThroughUserPrompt(messages, userPromptIndex);
  return end >= 0 && end < messages.length;
}

export interface LocalRewindPoint {
  promptIndex: number;
  messageId: string;
  preview: string;
}

/** Build rewind points from the local journal (one per user prompt). */
export function localRewindPoints(
  messages: ChatMessage[],
  opts?: { previewMax?: number },
): LocalRewindPoint[] {
  const max = opts?.previewMax ?? 80;
  const out: LocalRewindPoint[] = [];
  let idx = 0;
  for (const m of messages) {
    if (m.role !== "user") continue;
    const raw = (m.content || "").replace(/\s+/g, " ").trim();
    const preview =
      raw.length > max ? `${raw.slice(0, Math.max(1, max - 1))}…` : raw || "…";
    out.push({ promptIndex: idx, messageId: m.id, preview });
    idx += 1;
  }
  return out;
}

/**
 * Messages for a forked session: through optional user prompt (full turn), or full history.
 * Remaps ids by default so the fork is independent of the source journal.
 */
export function forkMessages(
  messages: ChatMessage[],
  options?: {
    throughUserPromptIndex?: number | null;
    remapIds?: boolean;
    idPrefix?: string;
  },
): ChatMessage[] {
  const through = options?.throughUserPromptIndex;
  const sliced =
    through == null || through === undefined
      ? messages.slice()
      : truncateThroughUserPrompt(messages, through);
  const remap = options?.remapIds !== false;
  if (!remap) {
    return sliced.map((m) => ({
      ...m,
      streaming: false,
      thoughtPhases: m.thoughtPhases ? [...m.thoughtPhases] : undefined,
      segments: m.segments ? m.segments.map((s) => ({ ...s })) : undefined,
      attachments: m.attachments
        ? m.attachments.map((a) => ({ ...a }))
        : undefined,
    }));
  }
  const prefix = options?.idPrefix ?? `fork-${Date.now().toString(36)}`;
  return sliced.map((m, i) => ({
    ...m,
    id: `${prefix}-${i}-${m.id}`,
    streaming: false,
    thoughtPhases: m.thoughtPhases ? [...m.thoughtPhases] : undefined,
    segments: m.segments ? m.segments.map((s) => ({ ...s })) : undefined,
    attachments: m.attachments
      ? m.attachments.map((a) => ({ ...a }))
      : undefined,
  }));
}

/** Default fork title from source title. */
export function forkSessionTitle(sourceTitle: string | undefined | null): string {
  const base = (sourceTitle || "").trim() || "chat";
  if (/^fork of\b/i.test(base)) return base;
  return `Fork of ${base}`;
}

/**
 * When reopening a session, prefer the in-memory cache over disk if the cache
 * is ahead (optimistic user bubble, partial stream, longer history).
 */
export function preferSessionMessages(
  cached: ChatMessage[] | undefined,
  stored: ChatMessage[],
): ChatMessage[] {
  if (!cached?.length) return stored;
  if (!stored.length) return cached;
  if (cached.some((m) => m.streaming)) return cached;
  if (cached.length > stored.length) return cached;
  const cacheChars = cached.reduce(
    (n, m) => n + m.content.length + (m.thought?.length ?? 0),
    0,
  );
  const storeChars = stored.reduce(
    (n, m) => n + m.content.length + (m.thought?.length ?? 0),
    0,
  );
  if (cacheChars > storeChars) return cached;
  return stored;
}

/**
 * Apply one stream chunk. Pure reducer — each chunk's text is appended once.
 * Prefer stable messageId from Host; fall back to last streaming assistant.
 */
export interface GeneratedImagePayload {
  sessionId?: string;
  messageId?: string;
  path: string;
  name?: string;
}

/**
 * Attach an image_gen / image_edit result to the current assistant bubble.
 * Prefer streaming assistant; fall back to last assistant; create one if needed.
 */
export function applyGeneratedImage(
  messages: ChatMessage[],
  payload: GeneratedImagePayload,
): ChatMessage[] {
  const path = (payload.path || "").trim();
  if (!path) return messages;
  const name =
    (payload.name || "").trim() ||
    path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ||
    path;
  const att: MessageAttachment = { path, name, isDir: false };

  let idx = payload.messageId
    ? messages.findIndex((m) => m.id === payload.messageId)
    : -1;
  if (idx < 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role === "assistant" && m.streaming) {
        idx = i;
        break;
      }
    }
  }
  if (idx < 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === "assistant") {
        idx = i;
        break;
      }
    }
  }

  if (idx < 0) {
    return [
      ...messages,
      {
        id: payload.messageId || `a-img-${Date.now()}`,
        role: "assistant",
        content: "",
        streaming: true,
        attachments: [att],
      },
    ];
  }

  const prev = messages[idx]!;
  const existing = prev.attachments ?? [];
  if (existing.some((a) => a.path === path)) return messages;
  const next = messages.slice();
  next[idx] = {
    ...prev,
    attachments: [...existing, att],
  };
  return next;
}

/**
 * Index of the last user message — stream chunks only bind to the current turn
 * (after this index). Prevents a late/orphan chunk from appending onto an older
 * assistant and looking like "history re-appeared after the new question".
 */
export function lastUserMessageIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return i;
  }
  return -1;
}

/**
 * Drop stuck streaming flags on assistants from previous turns (before last user).
 * Call when starting a new send so the next stream never binds to old bubbles.
 */
export function clearPriorTurnStreaming(messages: ChatMessage[]): ChatMessage[] {
  const lastUser = lastUserMessageIndex(messages);
  let changed = false;
  const next = messages.map((m, i) => {
    if (m.role !== "assistant" || !m.streaming) return m;
    // Keep streaming only on the active turn (after last user).
    if (i > lastUser) return m;
    changed = true;
    return { ...m, streaming: false };
  });
  return changed ? next : messages;
}

/**
 * Remove empty optimistic assistant placeholders left behind when a real stream
 * message was created separately (id mismatch). Keeps at most one streaming
 * assistant after the last user message.
 */
export function dedupeCurrentTurnAssistants(
  messages: ChatMessage[],
): ChatMessage[] {
  const lastUser = lastUserMessageIndex(messages);
  if (lastUser < 0) return messages;
  const turn = messages.slice(lastUser + 1);
  const assistants = turn
    .map((m, i) => ({ m, i: lastUser + 1 + i }))
    .filter(({ m }) => m.role === "assistant" && !m.isError);
  if (assistants.length <= 1) return messages;

  // Prefer the one with content/thought or host uuid; drop empty pending shells.
  const keep = [...assistants].sort((a, b) => {
    const score = (x: ChatMessage) =>
      (x.content?.trim() ? 4 : 0) +
      (x.thought?.trim() ? 2 : 0) +
      (x.streaming ? 1 : 0) +
      (!x.id.startsWith("a-pending-") && !x.id.startsWith("t-") ? 1 : 0);
    return score(b.m) - score(a.m);
  })[0]!;

  const dropIds = new Set(
    assistants.filter((a) => a.i !== keep.i).map((a) => a.m.id),
  );
  // Only drop empties that look like optimistic leftovers
  const dropEmpty = new Set(
    assistants
      .filter(
        (a) =>
          a.i !== keep.i &&
          !a.m.content?.trim() &&
          !a.m.thought?.trim() &&
          (a.m.id.startsWith("a-pending-") || a.m.id.startsWith("t-")),
      )
      .map((a) => a.m.id),
  );
  if (!dropEmpty.size) return messages;
  return messages.filter((m) => !dropEmpty.has(m.id) || dropIds.size === 0);
}

export function applyStreamChunk(
  messages: ChatMessage[],
  chunk: StreamPayload,
): ChatMessage[] {
  // done-only with empty text: clear all streaming flags so the next send is clean
  if (chunk.done && !chunk.text) {
    return messages.map((m) =>
      m.role === "assistant" && m.streaming ? { ...m, streaming: false } : m,
    );
  }

  if (chunk.kind === "thought") {
    if (!chunk.text) return messages;
    const idx = findCurrentTurnStreamingAssistant(messages, chunk.messageId);
    const phaseHint = chunk.thoughtPhase || "open";
    const appendThought = (prev: ChatMessage): ChatMessage => {
      const segs = appendThoughtToSegments(
        ensureSegments(prev),
        chunk.text,
        phaseHint,
      );
      const derived = deriveFieldsFromSegments(segs);
      return {
        ...prev,
        id:
          chunk.messageId &&
          (prev.id.startsWith("a-pending-") || prev.id.startsWith("t-"))
            ? chunk.messageId
            : prev.id,
        ...derived,
        segments: segs,
        streaming: true,
      };
    };
    if (idx != null) {
      const next = messages.slice();
      next[idx] = appendThought(next[idx]!);
      return next;
    }
    const segs: MessageSegment[] = [{ kind: "thought", text: chunk.text }];
    return [
      ...messages,
      {
        id: chunk.messageId || `t-${Date.now()}`,
        role: "assistant",
        content: "",
        thought: chunk.text,
        thoughtPhases: [chunk.text],
        segments: segs,
        streaming: true,
      },
    ];
  }

  // assistant (default)
  if (!chunk.text && !chunk.done) return messages;

  let idx = chunk.messageId
    ? messages.findIndex((m) => m.id === chunk.messageId)
    : -1;
  // Host id may not match optimistic pending — bind only within current turn.
  if (idx < 0) {
    const fallback = findCurrentTurnStreamingAssistant(messages, undefined);
    idx = fallback ?? -1;
  } else {
    // Refuse to append onto an assistant from a previous turn (stale id reuse).
    const lastUser = lastUserMessageIndex(messages);
    if (idx <= lastUser) {
      const fallback = findCurrentTurnStreamingAssistant(messages, undefined);
      idx = fallback ?? -1;
    }
  }

  if (idx < 0) {
    if (!chunk.text) return messages;
    const segs: MessageSegment[] = [{ kind: "content", text: chunk.text }];
    return [
      ...messages,
      {
        id: chunk.messageId || `a-${Date.now()}`,
        role: "assistant",
        content: chunk.text,
        segments: segs,
        streaming: !chunk.done,
      },
    ];
  }

  const next = messages.slice();
  const prev = next[idx]!;
  const segs = appendContentToSegments(ensureSegments(prev), chunk.text || "");
  const derived = deriveFieldsFromSegments(segs);
  next[idx] = {
    ...prev,
    // Prefer host messageId so journal reload dedupes cleanly
    id:
      chunk.messageId &&
      (prev.id.startsWith("a-pending-") || prev.id.startsWith("t-") || !prev.id)
        ? chunk.messageId
        : prev.id || chunk.messageId || prev.id,
    ...derived,
    segments: segs,
    streaming: !chunk.done,
  };
  return next;
}

/**
 * Find the streaming assistant for the *current* turn only (after last user).
 */
function findCurrentTurnStreamingAssistant(
  messages: ChatMessage[],
  messageId: string | undefined,
): number | undefined {
  const lastUser = lastUserMessageIndex(messages);
  if (messageId) {
    const byId = messages.findIndex((m) => m.id === messageId);
    if (byId > lastUser) return byId;
  }
  for (let i = messages.length - 1; i > lastUser; i--) {
    const m = messages[i]!;
    if (m.role === "assistant" && m.streaming) return i;
  }
  // No current-turn streaming bubble — do NOT fall back to older turns.
  return undefined;
}

const KNOWN_ERROR_CODES: AgentErrorCode[] = [
  "CLI_NOT_FOUND",
  "AUTH_FAILED",
  "NETWORK_PROVIDER",
  "AGENT_CRASHED",
  "QUOTA_EXCEEDED",
  "CONNECT_FAILED",
  "PROCESS_LIMIT",
];

export function isAgentErrorCode(code: string | undefined | null): code is AgentErrorCode {
  return !!code && (KNOWN_ERROR_CODES as string[]).includes(code);
}

export function errorCopy(code: AgentErrorCode, locale: Locale = "zh"): string {
  const zh: Record<AgentErrorCode, string> = {
    CLI_NOT_FOUND: "未找到 Grok Build CLI。请安装或在设置中指定路径。",
    AUTH_FAILED: "鉴权失败。请重新登录、更换 Key，或改用设置里的自定义中转。",
    NETWORK_PROVIDER:
      "网络或模型服务异常。请检查网络、额度，或切换模型/渠道后重试。",
    AGENT_CRASHED: "Agent 进程异常退出。可尝试重新连接。",
    QUOTA_EXCEEDED:
      "额度不足或订阅已限流。请到 Grok 账户查看用量，或切换模型/等待重置。",
    CONNECT_FAILED:
      "无法连接本会话的 Agent。请点重新连接；确认 CLI 已登录或中转配置正确。",
    PROCESS_LIMIT:
      "已达到 Agent 进程上限。请先停止或等待其他会话，或在设置 → 运行环境中提高并发上限。",
  };
  const en: Record<AgentErrorCode, string> = {
    CLI_NOT_FOUND: "Grok Build CLI not found. Install or set path in Settings.",
    AUTH_FAILED:
      "Authentication failed. Re-login, change key, or use a custom provider in Settings.",
    NETWORK_PROVIDER:
      "Network or model provider error. Check connection, quota, or switch model/provider, then retry.",
    AGENT_CRASHED: "Agent process crashed. Try reconnect.",
    QUOTA_EXCEEDED:
      "Quota exceeded or rate-limited. Check Grok usage, switch model, or wait for reset.",
    CONNECT_FAILED:
      "Could not connect the agent for this session. Reconnect; confirm CLI login or custom provider.",
    PROCESS_LIMIT:
      "Agent process limit reached. Stop or wait for another session, or raise the limit in Settings → Runtime.",
  };
  return (locale === "en" ? en : zh)[code];
}

/** Turn took too long (Host session/prompt timeout) — more specific than generic network. */
export function turnTimeoutCopy(locale: Locale = "zh"): string {
  return locale === "en"
    ? "This turn timed out and was stopped. You can retry — long tasks (e.g. image generation) may need more time."
    : "本轮执行超时已中止。可重试；生图等长任务可能需要更久。";
}

export function agentDisconnectedCopy(locale: Locale = "zh"): string {
  return locale === "en"
    ? "The agent connection was interrupted. Try reconnecting and send again."
    : "与 Agent 的连接已中断。请重新连接后再试。";
}

const AGENT_ERROR_CODE_RE =
  /^(CLI_NOT_FOUND|AUTH_FAILED|NETWORK_PROVIDER|AGENT_CRASHED|QUOTA_EXCEEDED|CONNECT_FAILED|PROCESS_LIMIT)(?::\s*|\s+)([\s\S]*)$/;

const MARKDOWN_CODE_RE =
  /^\*\*(CLI_NOT_FOUND|AUTH_FAILED|NETWORK_PROVIDER|AGENT_CRASHED|QUOTA_EXCEEDED|CONNECT_FAILED|PROCESS_LIMIT)\*\*(?:\s*[\r\n]+([\s\S]*))?$/;

/** Strip ANSI SGR sequences from CLI/MCP stderr dumps. */
export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "").replace(/\x1b\[[0-9;]*m/g, "");
}

/** Drop stderr tails and other bulky transport noise from error strings. */
export function stripErrorNoise(text: string): string {
  let s = stripAnsi(text).trim();
  const stderrIdx = s.search(/;?\s*stderr:/i);
  if (stderrIdx >= 0) s = s.slice(0, stderrIdx).trim();
  // Collapse multi-line dumps to first useful line for classification.
  return s;
}

/**
 * Parse a stored / live turn-error payload into a friendly chat body.
 * Prefer stable codes; never show raw MCP Connection refused walls of text.
 */
export function formatTurnErrorBody(
  payload: Pick<TurnErrorPayload, "code" | "message" | "content">,
  locale: Locale = "zh",
): string {
  const rawCombined = [payload.content, payload.message, payload.code]
    .filter(Boolean)
    .join("\n");
  const cleaned = stripErrorNoise(rawCombined);

  let code: AgentErrorCode | null = isAgentErrorCode(payload.code)
    ? payload.code
    : null;
  let rest = stripErrorNoise(payload.message || "");

  const md = (payload.content || "").trim().match(MARKDOWN_CODE_RE);
  if (md) {
    code = md[1] as AgentErrorCode;
    rest = stripErrorNoise(md[2] || rest);
  } else {
    const coded = cleaned.match(AGENT_ERROR_CODE_RE);
    if (coded) {
      code = coded[1] as AgentErrorCode;
      rest = stripErrorNoise(coded[2] || rest);
    }
  }

  const lower = `${rest}\n${cleaned}`.toLowerCase();
  if (
    rest === "turn_timeout" ||
    /rpc timeout.*session\/prompt|after\s*\d+s/.test(lower)
  ) {
    return turnTimeoutCopy(locale);
  }
  if (rest === "agent_disconnected" || /rpc channel closed|transport channel closed/i.test(lower)) {
    return agentDisconnectedCopy(locale);
  }

  // Infer codes from common agent/host phrases when payload lacks a code.
  if (!code) {
    if (
      /could not connect the agent|edit aborted|no active session|acp client missing|connect failed/i.test(
        lower,
      )
    ) {
      code = "CONNECT_FAILED";
    } else if (
      /quota|rate.?limit|429|insufficient.?credit|usage.?limit|out of credits/i.test(
        lower,
      )
    ) {
      code = "QUOTA_EXCEEDED";
    } else if (
      /not logged|unauthor|401|auth failed|access denied|failed to generate authentication/i.test(
        lower,
      )
    ) {
      code = "AUTH_FAILED";
    } else if (/cli not found|command not found|grok.*not found/i.test(lower)) {
      code = "CLI_NOT_FOUND";
    }
  }

  if (code) {
    // Known code → friendly copy only (no technical rest in the bubble).
    return errorCopy(code, locale);
  }

  // Unknown: keep a short, non-bulky line.
  const first =
    cleaned
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !/connection refused|worker quit|hyper_util|reqwest/i.test(l)) ||
    (locale === "en" ? "Request failed. Please retry." : "请求失败，请重试。");
  return first.length > 200 ? `${first.slice(0, 200)}…` : first;
}

/**
 * Compact banner copy: short user-facing summary by default;
 * technical detail only when short and non-noisy (no MCP stderr walls).
 */
export function presentErrorBanner(
  error: AgentError | null,
  localError: string | null,
  locale: Locale = "zh",
): {
  code: string | null;
  summary: string;
  detail: string | null;
  reconnectHint: boolean;
} | null {
  if (error) {
    const summary = formatTurnErrorBody(
      { code: error.code, message: error.message, content: undefined },
      locale,
    );
    return {
      code: error.code,
      summary,
      detail: null,
      reconnectHint: true,
    };
  }
  if (!localError?.trim()) return null;

  const cleaned = stripErrorNoise(localError);
  const coded = cleaned.match(AGENT_ERROR_CODE_RE);
  if (coded) {
    const code = coded[1] as AgentErrorCode;
    return {
      code,
      summary: formatTurnErrorBody(
        { code, message: coded[2] || "", content: undefined },
        locale,
      ),
      detail: null,
      reconnectHint: true,
    };
  }

  const summary = formatTurnErrorBody(
    { code: undefined, message: cleaned, content: undefined },
    locale,
  );
  const isTimeoutish = /timeout|超时|中断|disconnect/i.test(summary);
  return {
    code: null,
    summary,
    detail: null,
    reconnectHint: isTimeoutish || /AGENT_CRASHED|NETWORK_PROVIDER/i.test(cleaned),
  };
}

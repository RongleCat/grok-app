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
  | "PROCESS_LIMIT"
  | "CLI_TOO_OLD"
  | "SANDBOX_BLOCKED";

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

/** Tool step embedded in the assistant timeline (live stream order). */
export interface MessageToolSegment {
  kind: "tool";
  toolCallId: string;
  title: string;
  toolKind?: string;
  status: string;
  detail?: string;
  path?: string;
  /** Call argument recorded by the host (target file / command / query). */
  input?: string;
  /**
   * What the tool actually produced (stdout / file text) from ACP `content[]`.
   * Distinct from {@link detail}, which only echoes the *call argument*.
   * This is the expandable body — never part of the one-line primary label.
   */
  output?: string;
  /**
   * Typed presentation facts (DSH `tool/result.meta` seam). Explicit Host meta
   * wins; otherwise the UI derives via `resolveToolPresentation`. Optional so
   * old journals keep rendering via derivation + generic fallback.
   */
  meta?: import("../toolPresentation").ToolPresentationMeta;
  streaming?: boolean;
  isError?: boolean;
  /** ISO time when the tool row was created (history duration). */
  createdAt?: string;
}

/** Ordered assistant turn pieces — thinking, tools, and body as they arrived. */
export type MessageSegment =
  | { kind: "thought"; text: string }
  | { kind: "content"; text: string }
  | MessageToolSegment;

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
   * Timeline of thought / tool / content chunks in stream order.
   * UI renders these interleaved on the real assistant timeline.
   */
  segments?: MessageSegment[];
  /**
   * Historical turn folding: earlier status fragments of a merged assistant
   * turn (grok CLI writes one row per intermediate fragment; reconcile adds
   * them individually). Rendered as a collapsed strip — never as body text.
   */
  leadFragments?: string[];
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
  /** Call argument recorded by the host (target file / command / query). */
  toolInput?: string;
  /** Real tool output (ACP `content[]`) — expandable body, not a label. */
  toolOutput?: string;
  /**
   * Typed presentation facts (DSH `tool/result.meta` seam). Persisted so log
   * replay paints the same typed card as live; UI falls back to derivation.
   */
  toolMeta?: import("../toolPresentation").ToolPresentationMeta;
  /**
   * Parent tool call id when the host/ACP marks nested tools (e.g. subagent
   * children). Optional — Tasks panel may infer when missing.
   */
  toolParentId?: string;
}

export interface ToolEventPayload {
  sessionId?: string;
  toolCallId?: string;
  title?: string;
  kind?: string;
  status?: string;
  path?: string | null;
  detail?: string | null;
  /** Call argument (target file / command / query) from live session://tool. */
  input?: string | null;
  /** Real tool output (ACP `content[]`) from live session://tool. */
  output?: string | null;
  /** Typed presentation facts from the Host (validated, bounded JSON). */
  meta?: import("../toolPresentation").ToolPresentationMeta | null;
  /** Parent tool call id when the wire event includes nesting. */
  parentId?: string | null;
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

export interface TurnErrorPayload {
  sessionId?: string;
  messageId?: string;
  code?: string;
  message?: string;
  content?: string;
}
export interface StreamPayload {
  sessionId: string;
  /** Host segment id. Absent for legacy/global empty-done markers — runtime
   *  treats a missing id as “not scoped to any specific segment” (see
   *  applyStreamChunk), so callers may omit it. */
  messageId?: string;
  text: string;
  done: boolean;
  kind?: "assistant" | "thought";
  /** Host hint: open | new | continue | none — split multi-phase thinking. */
  thoughtPhase?: "open" | "new" | "continue" | "none" | string;
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

/**
 * Host refused a *targeted* `session_send` because that chat holds no live
 * agent process (idle-recycled, crashed, or focus moved mid-call).
 *
 * Host fails loudly instead of falling back to the live slot — that fallback
 * was how one chat's prompt ended up in another chat's journal. Callers should
 * cold-connect the target and retry the same turn once.
 */
export function isSessionNotLiveError(err: unknown): boolean {
  const text =
    typeof err === "string"
      ? err
      : err && typeof err === "object"
        ? String((err as { message?: unknown }).message ?? err)
        : String(err);
  if (!text.includes("CONNECT_FAILED")) return false;
  return (
    text.includes("no live agent process") ||
    text.includes("lost focus before send")
  );
}

/**
 * Host skipped `session/prompt` because Stop / stall cleared the turn during
 * Host vision / prepare. Not a send failure — the prompt was never dispatched.
 */
export function isTurnCancelledError(err: unknown): boolean {
  const text =
    typeof err === "string"
      ? err
      : err && typeof err === "object"
        ? String((err as { message?: unknown }).message ?? err)
        : String(err);
  return text.includes("TURN_CANCELLED");
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
/** A real prompt turn boundary. Mid-turn steering messages stay inside the active turn. */
export function isTurnPromptMessage(message: ChatMessage | undefined): boolean {
  return message?.role === "user" && message.marker !== "interjection";
}

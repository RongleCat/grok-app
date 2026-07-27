import type { Locale } from "../i18n";
import { buildErrorDeck, resolveErrorDeckCode } from "./errorDeck";
import type { ErrorDeckAction, ErrorDeckCard } from "./errorDeck";

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

/** Tool step embedded in the assistant timeline (live stream order). */
export interface MessageToolSegment {
  kind: "tool";
  toolCallId: string;
  title: string;
  toolKind?: string;
  status: string;
  detail?: string;
  path?: string;
  streaming?: boolean;
  isError?: boolean;
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

/** Index of the current-turn assistant to attach live tools into (prefer streaming). */
export function findCurrentTurnAssistantIndex(
  messages: ChatMessage[],
): number {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      lastUser = i;
      break;
    }
  }
  let lastAsst = -1;
  for (let i = lastUser + 1; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role !== "assistant" || m.isError) continue;
    if (m.streaming) return i;
    lastAsst = i;
  }
  return lastAsst;
}

/** Build a tool segment from a live/persisted tool row fields. */
export function toolSegmentFromFields(fields: {
  toolCallId: string;
  title: string;
  toolKind?: string;
  status: string;
  detail?: string;
  path?: string;
  streaming?: boolean;
  isError?: boolean;
}): MessageToolSegment {
  return {
    kind: "tool",
    toolCallId: fields.toolCallId,
    title: fields.title,
    toolKind: fields.toolKind,
    status: fields.status,
    detail: fields.detail,
    path: fields.path,
    streaming: !!fields.streaming,
    isError: !!fields.isError,
  };
}

/**
 * Insert or update a tool segment on an assistant segment timeline.
 * New tools append (true stream order); status updates mutate in place.
 */
export function upsertToolInSegments(
  segs: MessageSegment[],
  tool: MessageToolSegment,
): MessageSegment[] {
  const next = segs.map((s) =>
    s.kind === "tool" ? { ...s } : { ...s },
  ) as MessageSegment[];
  const si = next.findIndex(
    (s) => s.kind === "tool" && s.toolCallId === tool.toolCallId,
  );
  if (si >= 0) {
    const prev = next[si] as MessageToolSegment;
    // Never wipe a good title with empty/generic.
    const title =
      (tool.title && !isGenericToolLabel(tool.title) ? tool.title : "") ||
      prev.title;
    next[si] = {
      ...prev,
      ...tool,
      title,
      detail: tool.detail || prev.detail,
      path: tool.path || prev.path,
      toolKind: tool.toolKind || prev.toolKind,
    };
    return next;
  }
  next.push({ ...tool });
  return next;
}

/** True when any assistant in the list already inlines this toolCallId. */
export function isToolInlinedInAssistants(
  messages: ChatMessage[],
  toolCallId: string,
): boolean {
  const id = toolCallId.trim();
  if (!id) return false;
  for (const m of messages) {
    if (m.role !== "assistant" || !m.segments?.length) continue;
    for (const s of m.segments) {
      if (s.kind === "tool" && s.toolCallId === id) return true;
    }
  }
  return false;
}

/** Resolve stable toolCallId from a tool_step row. */
export function toolCallIdOf(m: ChatMessage): string {
  const fromField = (m.toolCallId || "").trim();
  if (fromField) return fromField;
  if (m.id.startsWith("tool-")) return m.id.slice(5);
  return m.id;
}

function toolSegmentFromMessageRow(row: ChatMessage): MessageToolSegment | null {
  if (!isToolStepMessage(row)) return null;
  const tcid = toolCallIdOf(row);
  if (!tcid) return null;
  const status = (row.toolStatus || "completed").toLowerCase();
  return toolSegmentFromFields({
    toolCallId: tcid,
    title: toolStepDisplayTitle(row) || row.content || tcid,
    toolKind: row.toolKind,
    status,
    detail: row.toolDetail,
    path: row.toolPath,
    streaming: false,
    isError: !!row.isError || status === "failed" || status === "error",
  });
}

/**
 * Place journal tools into a legacy [thought…, content…] timeline.
 * Host often finalizes the assistant row *before* appending tool_step rows, and
 * assistant.createdAt is often *after* tool timestamps — so tools must not sit
 * only after the answer. Prefer: thoughts → tools → content for history reload.
 * If segments already contain tools (live interleave), only fill missing ids.
 */
export function mergeToolsIntoAssistantSegments(
  segs: MessageSegment[],
  tools: MessageToolSegment[],
): MessageSegment[] {
  if (!tools.length) return compactMessageSegments(segs);
  const existingIds = new Set(
    segs
      .filter((s): s is MessageToolSegment => s.kind === "tool")
      .map((s) => s.toolCallId),
  );
  const missing = tools.filter((t) => !existingIds.has(t.toolCallId));
  if (!missing.length) {
    // Still apply status updates for known tools.
    let next = segs;
    for (const t of tools) next = upsertToolInSegments(next, t);
    return compactMessageSegments(next);
  }

  const alreadyHasTools = segs.some((s) => s.kind === "tool");
  if (alreadyHasTools) {
    let next = segs;
    for (const t of missing) next = upsertToolInSegments(next, t);
    return compactMessageSegments(next);
  }

  // Legacy journal reconstruction: tools between reasoning and answer.
  const thoughts = segs.filter(
    (s): s is { kind: "thought"; text: string } => s.kind === "thought",
  );
  const contents = segs.filter(
    (s): s is { kind: "content"; text: string } => s.kind === "content",
  );
  const rest = segs.filter((s) => s.kind !== "thought" && s.kind !== "content");
  return compactMessageSegments([
    ...thoughts,
    ...rest,
    ...missing,
    ...contents,
  ]);
}

/**
 * After journal reload, stitch turn tool_step rows into the turn assistant.
 *
 * Collects tools anywhere in the user-turn window (before or after the assistant
 * row — Host journal is often U → A → tools). Rebuilds display order as
 * thought → tools → content when segments have no live tool interleave yet.
 */
export function weaveToolsIntoAssistantSegments(
  messages: ChatMessage[],
): ChatMessage[] {
  if (!messages.length) return messages;
  const out = messages.map((m) =>
    m.segments
      ? { ...m, segments: m.segments.map((s) => ({ ...s })) as MessageSegment[] }
      : { ...m },
  );

  // Walk by user turns so tools before/after assistant all attach to that turn.
  let i = 0;
  while (i < out.length) {
    // Advance to a turn start (user) or orphan prefix.
    if (out[i]!.role !== "user" && i === 0) {
      // Orphan non-user prefix — handle as one synthetic turn below via window.
    }

    let turnStart = i;
    if (out[i]!.role === "user") {
      turnStart = i + 1;
    } else if (i > 0) {
      i += 1;
      continue;
    }

    let turnEnd = turnStart;
    while (turnEnd < out.length && out[turnEnd]!.role !== "user") {
      turnEnd += 1;
    }

    // Assistants in this turn (non-error).
    const asstPositions: number[] = [];
    for (let k = turnStart; k < turnEnd; k++) {
      const m = out[k]!;
      if (m.role === "assistant" && !m.isError) asstPositions.push(k);
    }

    // Tools in this turn, stable journal order (array order; not createdAt).
    const turnTools: MessageToolSegment[] = [];
    const seenTool = new Set<string>();
    for (let k = turnStart; k < turnEnd; k++) {
      const row = out[k]!;
      if (!isToolStepMessage(row)) continue;
      const seg = toolSegmentFromMessageRow(row);
      if (!seg || seenTool.has(seg.toolCallId)) continue;
      seenTool.add(seg.toolCallId);
      turnTools.push(seg);
    }

    if (asstPositions.length === 1 && turnTools.length) {
      const aIdx = asstPositions[0]!;
      const asst = out[aIdx]!;
      const segs = mergeToolsIntoAssistantSegments(
        ensureSegments(asst),
        turnTools,
      );
      const derived = deriveFieldsFromSegments(segs);
      out[aIdx] = { ...asst, ...derived, segments: segs };
    } else if (asstPositions.length > 1 && turnTools.length) {
      // Multi-assistant turn: assign tools after each assistant until next asst.
      for (let ai = 0; ai < asstPositions.length; ai++) {
        const aIdx = asstPositions[ai]!;
        const nextAsst =
          ai + 1 < asstPositions.length
            ? asstPositions[ai + 1]!
            : turnEnd;
        const sliceTools: MessageToolSegment[] = [];
        const seen = new Set<string>();
        for (let k = aIdx + 1; k < nextAsst; k++) {
          const row = out[k]!;
          if (!isToolStepMessage(row)) continue;
          const seg = toolSegmentFromMessageRow(row);
          if (!seg || seen.has(seg.toolCallId)) continue;
          seen.add(seg.toolCallId);
          sliceTools.push(seg);
        }
        // Also tools before the first assistant in the turn → first assistant.
        if (ai === 0) {
          for (let k = turnStart; k < aIdx; k++) {
            const row = out[k]!;
            if (!isToolStepMessage(row)) continue;
            const seg = toolSegmentFromMessageRow(row);
            if (!seg || seen.has(seg.toolCallId)) continue;
            seen.add(seg.toolCallId);
            sliceTools.unshift(seg);
          }
        }
        if (!sliceTools.length) continue;
        const asst = out[aIdx]!;
        const segs = mergeToolsIntoAssistantSegments(
          ensureSegments(asst),
          sliceTools,
        );
        const derived = deriveFieldsFromSegments(segs);
        out[aIdx] = { ...asst, ...derived, segments: segs };
      }
    }

    i = turnEnd > i ? turnEnd : i + 1;
  }
  return out;
}

/**
 * Pull current-turn tool_step rows into an assistant's segments when missing.
 * Tools that appear *before* the assistant message are prepended; later tools append.
 * Keeps live order when the agent runs tools before the first stream token.
 */
export function syncTurnToolsIntoAssistant(
  messages: ChatMessage[],
  aIdx: number,
): ChatMessage[] {
  if (aIdx < 0 || aIdx >= messages.length) return messages;
  const asst = messages[aIdx]!;
  if (asst.role !== "assistant" || asst.isError) return messages;

  let lastUser = -1;
  for (let i = aIdx - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      lastUser = i;
      break;
    }
  }

  let segs = ensureSegments(asst);
  const have = new Set(
    segs
      .filter((s): s is MessageToolSegment => s.kind === "tool")
      .map((s) => s.toolCallId),
  );
  const pre: MessageToolSegment[] = [];
  const post: MessageToolSegment[] = [];

  for (let i = lastUser + 1; i < messages.length; i++) {
    if (i === aIdx) continue;
    const m = messages[i]!;
    if (m.role === "user") break;
    if (m.role === "assistant" && i > aIdx) break;
    if (!isToolStepMessage(m)) continue;
    const tcid =
      (m.toolCallId || "").trim() ||
      (m.id.startsWith("tool-") ? m.id.slice(5) : m.id);
    if (!tcid || have.has(tcid)) continue;
    const status = (m.toolStatus || "completed").toLowerCase();
    const toolSeg = toolSegmentFromFields({
      toolCallId: tcid,
      title: toolStepDisplayTitle(m) || m.content || tcid,
      toolKind: m.toolKind,
      status,
      detail: m.toolDetail,
      path: m.toolPath,
      streaming: !!m.streaming,
      isError: !!m.isError || status === "failed" || status === "error",
    });
    have.add(tcid);
    if (i < aIdx) pre.push(toolSeg);
    else post.push(toolSeg);
  }

  if (!pre.length && !post.length) return messages;
  segs = compactMessageSegments([...pre, ...segs, ...post]);
  const derived = deriveFieldsFromSegments(segs);
  const copy = messages.slice();
  copy[aIdx] = { ...asst, ...derived, segments: segs };
  return copy;
}

/** Upsert a tool activity row by toolCallId; also pin into assistant timeline. */
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

  let copy: ChatMessage[];
  let mergedTitle = title;
  if (idx < 0) {
    copy = [...messages, nextRow];
  } else {
    copy = messages.slice();
    // Never downgrade a good title to empty / generic on later updates.
    mergedTitle =
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
  }

  // Embed into the current-turn assistant so the UI can render true timeline order.
  const aIdx = findCurrentTurnAssistantIndex(copy);
  if (aIdx < 0) return copy;
  const asst = copy[aIdx]!;
  const row = idx < 0 ? nextRow : copy[idx]!;
  const toolSeg = toolSegmentFromFields({
    toolCallId: tcid,
    title: mergedTitle || row.content || "",
    toolKind: row.toolKind,
    status: row.toolStatus || status,
    detail: row.toolDetail,
    path: row.toolPath,
    streaming: running,
    isError: !!row.isError,
  });
  const segs = compactMessageSegments(
    upsertToolInSegments(ensureSegments(asst), toolSeg),
  );
  const derived = deriveFieldsFromSegments(segs);
  copy = copy.slice();
  copy[aIdx] = {
    ...asst,
    ...derived,
    segments: segs,
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

/** Failed / rejected tool_step that must stay visible in the transcript. */
export function isFailedToolStepMessage(m: ChatMessage): boolean {
  if (!isToolStepMessage(m)) return false;
  if (m.isError) return true;
  const status = (m.toolStatus || "").toLowerCase().trim();
  if (
    status === "failed" ||
    status === "error" ||
    status === "rejected" ||
    status === "denied"
  ) {
    return true;
  }
  if (m.content?.startsWith("tool_step|")) {
    const p = parseToolStepContent(m.content);
    const s = (p?.status || "").toLowerCase();
    return s === "failed" || s === "error" || s === "rejected";
  }
  return false;
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
  locale: Locale = "en",
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
 * Compact a segment timeline for display / persistence hygiene:
 * - drop empty thought/content pieces
 * - merge adjacent same-kind text segments (spurious "new" thought phases after
 *   empty assistant ticks used to create back-to-back 思考 2 / 思考 3 rows)
 * - keep tool steps; coalesce duplicate toolCallId updates in place
 */
export function compactMessageSegments(
  segments: MessageSegment[],
): MessageSegment[] {
  const out: MessageSegment[] = [];
  for (const raw of segments) {
    if (raw.kind === "tool") {
      const existing = out.findIndex(
        (s) => s.kind === "tool" && s.toolCallId === raw.toolCallId,
      );
      if (existing >= 0) {
        const prev = out[existing] as MessageToolSegment;
        const title =
          (raw.title && !isGenericToolLabel(raw.title) ? raw.title : "") ||
          prev.title;
        out[existing] = {
          ...prev,
          ...raw,
          title,
          detail: raw.detail || prev.detail,
          path: raw.path || prev.path,
          toolKind: raw.toolKind || prev.toolKind,
        };
        continue;
      }
      out.push({ ...raw });
      continue;
    }
    if (!raw.text.trim()) continue;
    const last = out[out.length - 1];
    if (last && last.kind === raw.kind) {
      if (raw.kind === "thought" && last.kind === "thought") {
        // Preserve a readable break between formerly split phases.
        last.text = `${last.text.replace(/\s+$/, "")}\n\n${raw.text.replace(/^\s+/, "")}`;
      } else if (raw.kind === "content" && last.kind === "content") {
        last.text += raw.text;
      }
      continue;
    }
    out.push({ kind: raw.kind, text: raw.text });
  }
  return out;
}

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
  // Journal only stores joined thought + body — not true interleave order.
  // Stacking every phase *before* the body avoids the classic reload bug where
  // multi-phase markers rendered as "answer … then 思考 2 / 思考 3" at the end.
  // Live `segments` still interleave thought ↔ content while streaming.
  const segs: MessageSegment[] = [];
  if (phases.length === 1) {
    segs.push({ kind: "thought", text: phases[0]! });
  } else if (phases.length > 1) {
    // One collapsible block on reload (phases already separated by blank lines).
    segs.push({ kind: "thought", text: phases.join("\n\n") });
  }
  if (body) segs.push({ kind: "content", text: body });
  return segs;
}

/** Prefer live segments; otherwise reconstruct from legacy fields. */
export function messageSegments(m: ChatMessage): MessageSegment[] {
  if (m.segments?.length) return compactMessageSegments(m.segments);
  return buildSegmentsFromLegacy(m.content, m.thought, m.thoughtPhases);
}

function ensureSegments(prev: ChatMessage): MessageSegment[] {
  if (prev.segments?.length) return prev.segments.map((s) => ({ ...s }));
  return buildSegmentsFromLegacy(prev.content, prev.thought, prev.thoughtPhases);
}

function appendThoughtToSegments(
  segs: MessageSegment[],
  text: string,
  _phaseHint: string,
): MessageSegment[] {
  if (!text) return segs;
  const last = segs[segs.length - 1];
  // New thought block only after body (or at start). Never open a second
  // adjacent thought — host `thoughtPhase: "new"` after empty assistant ticks
  // used to produce trailing 思考 2 / 思考 3 rows under the answer.
  if (!last || last.kind !== "thought") {
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

export function truncateBeforeLastUser(messages: ChatMessage[]): ChatMessage[] {
  let cut = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isTurnPromptMessage(messages[i])) {
      cut = i;
      break;
    }
  }
  return messages.slice(0, cut);
}

/** Number of user-role messages (0-based prompt index length). */
export function countUserPrompts(messages: ChatMessage[]): number {
  return messages.reduce((n, m) => (isTurnPromptMessage(m) ? n + 1 : n), 0);
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
    if (!isTurnPromptMessage(m)) continue;
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
  let userI = 0;
  for (let i = 0; i < messages.length; i++) {
    if (!isTurnPromptMessage(messages[i])) continue;
    if (userI === userPromptIndex) {
      let j = i + 1;
      while (j < messages.length && !isTurnPromptMessage(messages[j])) j += 1;
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
    if (!isTurnPromptMessage(m)) continue;
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

/** Client-only ids from optimistic send UI (`u-171…`, `a-pending-…`, etc.). */
export function isClientOptimisticId(id: string): boolean {
  return (
    /^u-\d+$/.test(id) ||
    id.startsWith("a-pending-") ||
    /^a-\d+$/.test(id) ||
    /^t-\d+$/.test(id)
  );
}

/** Drop client optimistic shells (keep host UUIDs and tool-* journal rows). */
export function stripClientOptimistic(
  messages: ChatMessage[],
): ChatMessage[] {
  return messages.filter((m) => !isClientOptimisticId(m.id));
}

/**
 * Remove optimistic user/pending-assistant rows that host journal already
 * replaced under a different id (same body). Fixes: switch away after a turn
 * completes → switch back → first user bubble duplicated at the end.
 *
 * Optimistic users are **replaced in place** by the host row (not dropped then
 * left at the tail), so order stays U → A → … instead of A → … → U.
 */
export function reconcileOptimisticDuplicates(
  messages: ChatMessage[],
): ChatMessage[] {
  const realUsersByContent = new Map<string, ChatMessage>();
  for (const m of messages) {
    if (m.role === "user" && !isClientOptimisticId(m.id)) {
      const key = m.content.trim();
      if (key && !realUsersByContent.has(key)) {
        realUsersByContent.set(key, m);
      }
    }
  }
  const hasHostAssistant = messages.some(
    (m) =>
      m.role === "assistant" &&
      !isClientOptimisticId(m.id) &&
      !m.id.startsWith("a-pending-"),
  );
  const placedRealUserIds = new Set<string>();
  const out: ChatMessage[] = [];

  for (const m of messages) {
    if (m.role === "user" && isClientOptimisticId(m.id)) {
      const real = realUsersByContent.get(m.content.trim());
      if (real) {
        if (!placedRealUserIds.has(real.id)) {
          out.push(real);
          placedRealUserIds.add(real.id);
        }
        continue;
      }
      out.push(m);
      continue;
    }
    if (m.role === "user" && !isClientOptimisticId(m.id)) {
      if (placedRealUserIds.has(m.id)) continue;
      out.push(m);
      placedRealUserIds.add(m.id);
      continue;
    }
    if (m.id.startsWith("a-pending-")) {
      if (!m.streaming) continue;
      if (hasHostAssistant) continue;
      out.push(m);
      continue;
    }
    out.push(m);
  }
  return out;
}

/**
 * Snapshot the thread being navigated away from.
 *
 * Never replaces a populated cache with an empty view: the workbench can be
 * mid-clear (or was never painted, because the send belonged to a chat the user
 * had already left) while the cache still holds that turn's real bubbles.
 * Clobbering it there is how a user prompt went missing from the cache and had
 * to be recovered from disk on the next open.
 */
export function snapshotOutgoingMessages(
  cached: ChatMessage[] | undefined,
  viewed: ChatMessage[],
): ChatMessage[] {
  if (viewed.length) return viewed;
  return cached?.length ? cached : viewed;
}

/**
 * When reopening a session, prefer the in-memory cache over disk if the cache
 * is ahead (optimistic user bubble, partial stream). If disk has messages the
 * cache lacks (e.g. Remote IM appends), merge by id so IM turns are never lost.
 *
 * After a turn completes (nothing streaming), disk is the base of truth and
 * client optimistic ids must not reappear as trailing duplicates.
 */
export function preferSessionMessages(
  cached: ChatMessage[] | undefined,
  stored: ChatMessage[],
): ChatMessage[] {
  if (!cached?.length) return stored;
  if (!stored.length) return cached;

  if (cached.some((m) => m.streaming)) {
    // Keep streaming cache; fold disk-only rows (Remote IM); drop optimistic
    // duplicates already persisted under host UUIDs.
    return reconcileOptimisticDuplicates(
      mergeSessionMessagesById(cached, stored),
    );
  }

  // Completed: prefer cache when it has live-interleaved tool segments that
  // disk cannot represent yet; otherwise disk is authoritative.
  const cacheHasLiveToolSegs = cached.some(
    (m) =>
      m.role === "assistant" &&
      m.segments?.some((s) => s.kind === "tool"),
  );
  const storedHasLiveToolSegs = stored.some(
    (m) =>
      m.role === "assistant" &&
      m.segments?.some((s) => s.kind === "tool"),
  );

  if (cacheHasLiveToolSegs && !storedHasLiveToolSegs) {
    return reconcileOptimisticDuplicates(
      mergeSessionMessagesById(cached, stored),
    );
  }

  // Disk base + non-optimistic cache-only extras (never reattach u-${ts}).
  return reconcileOptimisticDuplicates(
    mergeSessionMessagesById(stored, stripClientOptimistic(cached)),
  );
}

/**
 * Union of two message lists by `id`. First list wins on conflict; extras from
 * second are appended. Order: **primary array order** (journal order), then
 * second-only rows in their order.
 *
 * Do **not** re-sort by `createdAt`: Host journal often finalizes the assistant
 * row with a later timestamp than tool_step rows (tools ran mid-turn). Sorting
 * by createdAt turns `U → A → tools` into `U → tools → A` and breaks the
 * transcript timeline on reload.
 */
export function mergeSessionMessagesById(
  primary: ChatMessage[],
  secondary: ChatMessage[],
): ChatMessage[] {
  const primaryIds = new Set(primary.map((m) => m.id));

  // Secondary-only rows are placed **before the next row both lists share**,
  // not appended at the tail. Appending reordered the thread whenever the
  // cache was missing an early row: a mid-turn switch could leave the cache
  // holding only the streaming assistant, and the journal's user prompt — the
  // first thing in the turn — then rendered *after* the whole answer.
  const beforeAnchor = new Map<string, ChatMessage[]>();
  const tail: ChatMessage[] = [];
  const takenIds = new Set<string>();
  let bucket: ChatMessage[] = [];
  for (const m of secondary) {
    if (!m.id) continue;
    if (primaryIds.has(m.id)) {
      if (bucket.length) {
        beforeAnchor.set(m.id, [...(beforeAnchor.get(m.id) ?? []), ...bucket]);
        bucket = [];
      }
      continue;
    }
    if (takenIds.has(m.id)) continue;
    takenIds.add(m.id);
    bucket.push(m);
  }
  tail.push(...bucket);

  // Primary is copied verbatim — including repeated ids, which journal
  // `tool_step` rows legitimately have.
  const out: ChatMessage[] = [];
  const anchored = new Set<string>();
  for (const m of primary) {
    const extras = beforeAnchor.get(m.id);
    if (extras && !anchored.has(m.id)) {
      anchored.add(m.id);
      out.push(...extras);
    }
    out.push(m);
  }
  out.push(...tail);
  return out;
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
    if (isTurnPromptMessage(messages[i])) return i;
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

/**
 * Insert a mid-turn user interjection and freeze the assistant segment above it.
 * Post-interjection stream chunks carry a fresh host message id and append a new row.
 */
export function applyInterjection(
  messages: ChatMessage[],
  interjection: ChatMessage,
): ChatMessage[] {
  const existingIndex = messages.findIndex(
    (message) => message.id === interjection.id,
  );
  const boundaryIndex = existingIndex < 0 ? messages.length : existingIndex;
  const frozenBefore = messages
    .slice(0, boundaryIndex)
    .filter((message) => {
      if (
        message.role !== "assistant" ||
        !message.streaming ||
        !message.id.startsWith("a-pending-")
      ) {
        return true;
      }
      const hasVisibleContent =
        !!message.content.trim() ||
        !!message.thought?.trim() ||
        !!message.segments?.some(
          (segment) => "text" in segment && !!segment.text?.trim(),
        ) ||
        !!message.attachments?.length;
      return hasVisibleContent;
    })
    .map((message) =>
      message.role === "assistant" && message.streaming
        ? { ...message, streaming: false }
        : message,
    );

  if (existingIndex < 0) return [...frozenBefore, interjection];
  return [
    ...frozenBefore,
    interjection,
    ...messages.slice(existingIndex + 1),
  ];
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
      const segs = compactMessageSegments(
        appendThoughtToSegments(
          ensureSegments(prev),
          chunk.text,
          phaseHint,
        ),
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
      return syncTurnToolsIntoAssistant(next, idx);
    }
    const segs: MessageSegment[] = [{ kind: "thought", text: chunk.text }];
    const withAsst: ChatMessage[] = [
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
    return syncTurnToolsIntoAssistant(withAsst, withAsst.length - 1);
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
    const withAsst: ChatMessage[] = [
      ...messages,
      {
        id: chunk.messageId || `a-${Date.now()}`,
        role: "assistant",
        content: chunk.text,
        segments: segs,
        streaming: !chunk.done,
      },
    ];
    return syncTurnToolsIntoAssistant(withAsst, withAsst.length - 1);
  }

  const next = messages.slice();
  const prev = next[idx]!;
  const segs = compactMessageSegments(
    appendContentToSegments(ensureSegments(prev), chunk.text || ""),
  );
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
  return syncTurnToolsIntoAssistant(next, idx);
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

export function errorCopy(code: AgentErrorCode, locale: Locale = "en"): string {
  const card = buildErrorDeck(code, locale);
  return `${card.problem} ${card.cause}`.trim();
}

/** Turn took too long (Host session/prompt timeout) — more specific than generic network. */
export function turnTimeoutCopy(locale: Locale = "en"): string {
  const card = buildErrorDeck("TURN_TIMEOUT", locale);
  return `${card.problem} ${card.cause}`.trim();
}

export function agentDisconnectedCopy(locale: Locale = "en"): string {
  const card = buildErrorDeck("AGENT_DISCONNECTED", locale);
  return `${card.problem} ${card.cause}`.trim();
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
  locale: Locale = "en",
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

export type ErrorBannerView = {
  code: string | null;
  /** Headline (deck problem). */
  summary: string;
  /** Supporting line (deck cause). */
  cause: string | null;
  detail: string | null;
  reconnectHint: boolean;
  primary: ErrorDeckAction | null;
  secondary: ErrorDeckAction | null;
  deck: ErrorDeckCard | null;
};

function bannerFromDeck(
  deck: ErrorDeckCard,
  code: string | null,
  detail: string | null,
): ErrorBannerView {
  return {
    code,
    summary: deck.problem,
    cause: deck.cause,
    detail,
    reconnectHint:
      deck.primary.id === "reconnect" || deck.secondary?.id === "reconnect",
    primary: deck.primary,
    secondary: deck.secondary,
    deck,
  };
}

/**
 * Compact banner: T04 deck (problem / cause / primary / secondary).
 * Technical detail only when short and non-noisy (no MCP stderr walls).
 */
export function presentErrorBanner(
  error: AgentError | null,
  localError: string | null,
  locale: Locale = "en",
): ErrorBannerView | null {
  if (error) {
    const body = formatTurnErrorBody(
      { code: error.code, message: error.message, content: undefined },
      locale,
    );
    const lower = `${error.message}\n${body}`.toLowerCase();
    const timeout =
      error.message === "turn_timeout" ||
      /timeout|超时/.test(lower);
    const disconnected =
      error.message === "agent_disconnected" ||
      /disconnect|中断|rpc channel closed/i.test(lower);
    const deckCode = resolveErrorDeckCode(error.code, error.message, { timeout, disconnected });
    const deck = buildErrorDeck(deckCode, locale);
    return bannerFromDeck(deck, error.code, null);
  }
  if (!localError?.trim()) return null;

  const cleaned = stripErrorNoise(localError);
  const coded = cleaned.match(AGENT_ERROR_CODE_RE);
  if (coded) {
    const code = coded[1] as AgentErrorCode;
    const rest = stripErrorNoise(coded[2] || "");
    const lower = rest.toLowerCase();
    const timeout = rest === "turn_timeout" || /timeout|超时/.test(lower);
    const disconnected =
      rest === "agent_disconnected" || /disconnect|中断/i.test(lower);
    const deck = buildErrorDeck(
      resolveErrorDeckCode(code, raw, { timeout, disconnected }),
      locale,
    );
    return bannerFromDeck(deck, code, null);
  }

  const summary = formatTurnErrorBody(
    { code: undefined, message: cleaned, content: undefined },
    locale,
  );
  const isTimeoutish = /timeout|超时|中断|disconnect/i.test(summary);
  if (isTimeoutish) {
    const deck = buildErrorDeck(
      /disconnect|中断/i.test(summary)
        ? "AGENT_DISCONNECTED"
        : "TURN_TIMEOUT",
      locale,
    );
    return bannerFromDeck(deck, null, null);
  }

  // Local UX strings (e.g. "select a project") — show as-is, soft dismiss.
  const deck = buildErrorDeck("GENERIC", locale);
  return {
    code: null,
    summary: cleaned.length > 200 ? `${cleaned.slice(0, 200)}…` : cleaned,
    cause: null,
    detail: null,
    reconnectHint: false,
    primary: { id: "dismiss", label: deck.primary.label },
    secondary: null,
    deck: null,
  };
}

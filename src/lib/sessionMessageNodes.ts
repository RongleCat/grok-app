/**
 * Per-message session nodes for transcript navigation (Grok-web-style rail).
 * Pure view-model derived from the linear journal — no disk schema change.
 */

import { estimateChatRowHeight } from "./chatVirtualList";
import { isEndOfTurnMarker } from "./endOfTurn";
import { isTurnPromptMessage, type ChatMessage } from "./session";

export type SessionMessageNodeRole = "user" | "assistant";

export type SessionMessageNodeStatus = "pending" | "done" | "error";

export type SessionMessageNode = {
  /** Same as ChatMessage.id */
  id: string;
  /** Index in the full messages[] array (for virtual scroll). */
  messageIndex: number;
  /** 0-based index among node candidates only. */
  nodeIndex: number;
  role: SessionMessageNodeRole;
  preview: string;
  status: SessionMessageNodeStatus;
  /** Set only for true user prompts (excludes interjection). */
  promptIndex: number | null;
};

const PREVIEW_MAX = 72;

/**
 * True when an assistant row is only the thinking process (or an empty
 * streaming placeholder) with no user-visible reply body yet.
 * Thinking lives as segments/thought on the same ChatMessage — it must not
 * become its own rail node.
 */
export function isThoughtOnlyAssistant(
  message: ChatMessage | undefined | null,
): boolean {
  if (!message || message.role !== "assistant") return false;
  if (message.isError) return false;
  const body = (message.content ?? "").trim();
  if (body) return false;
  // No reply text yet: thought-only, streaming "思考中…", or empty shell.
  return true;
}

/** Rows that become navigable message nodes (one bubble = one node). */
export function isMessageNodeCandidate(
  message: ChatMessage | undefined | null,
): boolean {
  if (!message) return false;
  if (message.role === "user") {
    // Interjections are steer noise — keep the rail on main dialogue.
    if (message.marker === "interjection") return false;
    return true;
  }
  if (message.role === "assistant") {
    if (isEndOfTurnMarker(message.marker)) return false;
    if (message.marker === "turn_cancelled") return false;
    if (message.marker === "context_compact") return false;
    // Do not treat Grok thinking / empty streaming shells as nodes.
    // A node appears only once there is reply body (or an error record).
    if (isThoughtOnlyAssistant(message)) return false;
    return true;
  }
  return false;
}

export function truncateNodePreview(
  content: string | undefined | null,
  max = PREVIEW_MAX,
): string {
  const raw = (content ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "…";
  if (raw.length <= max) return raw;
  return `${raw.slice(0, Math.max(1, max - 1))}…`;
}

function nodeStatus(m: ChatMessage): SessionMessageNodeStatus {
  if (m.isError) return "error";
  if (m.streaming) return "pending";
  return "done";
}

/**
 * Build ordered per-message nodes from the live journal.
 * user + assistant only; tools / markers excluded.
 */
export function buildSessionMessageNodes(
  messages: readonly ChatMessage[],
): SessionMessageNode[] {
  const out: SessionMessageNode[] = [];
  let nodeIndex = 0;
  let promptIndex = 0;
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const m = messages[messageIndex]!;
    if (!isMessageNodeCandidate(m)) continue;
    const role: SessionMessageNodeRole =
      m.role === "user" ? "user" : "assistant";
    const isPrompt = role === "user" && isTurnPromptMessage(m);
    out.push({
      id: m.id,
      messageIndex,
      nodeIndex: nodeIndex++,
      role,
      // Always preview the reply/user body — never thought/reasoning text.
      preview: truncateNodePreview(m.content),
      status: nodeStatus(m),
      promptIndex: isPrompt ? promptIndex++ : null,
    });
  }
  return out;
}

/** Cumulative content offset (px estimate) before messages[index]. */
export function estimateOffsetBeforeMessage(
  messages: readonly ChatMessage[],
  index: number,
): number {
  const n = Math.max(0, Math.min(index, messages.length));
  let top = 0;
  for (let i = 0; i < n; i++) {
    const m = messages[i]!;
    top += estimateChatRowHeight({
      contentLength: m.content?.length ?? 0,
      thoughtLength: m.thought?.length ?? 0,
      role: m.role,
    });
  }
  return top;
}

/** scrollTop that roughly centers messages[index] in the viewport. */
export function estimateCenteredScrollTop(
  messages: readonly ChatMessage[],
  index: number,
  viewportHeight: number,
): number {
  if (index < 0 || index >= messages.length) return 0;
  const top = estimateOffsetBeforeMessage(messages, index);
  const m = messages[index]!;
  const h = estimateChatRowHeight({
    contentLength: m.content?.length ?? 0,
    thoughtLength: m.thought?.length ?? 0,
    role: m.role,
  });
  const vh = Math.max(1, viewportHeight);
  return Math.max(0, top - vh / 2 + h / 2);
}

/**
 * scrollTop so messages[index] starts near the upper band of the viewport.
 * More reliable than center for next/prev when the previous bubble is very tall
 * (centering leaves the old message dominating the viewport).
 */
export function estimateStartScrollTop(
  messages: readonly ChatMessage[],
  index: number,
  viewportHeight: number,
  topFraction = 0.12,
): number {
  if (index < 0 || index >= messages.length) return 0;
  const top = estimateOffsetBeforeMessage(messages, index);
  const vh = Math.max(1, viewportHeight);
  const frac = Math.min(0.4, Math.max(0, topFraction));
  return Math.max(0, top - vh * frac);
}

export type NodeViewportRect = {
  id: string;
  top: number;
  bottom: number;
};

/**
 * Pick the active rail node from mounted row geometry.
 * Prefer the last node whose top edge is at or above the focus line (reading
 * position) — stable for tall messages. Fall back to nearest center.
 */
export function pickActiveNodeIdFromRects(
  rects: readonly NodeViewportRect[],
  focusY: number,
): string | null {
  if (rects.length === 0) return null;
  let reading: NodeViewportRect | null = null;
  for (const r of rects) {
    if (r.top <= focusY + 1) reading = r;
  }
  if (reading) return reading.id;

  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const r of rects) {
    const center = (r.top + r.bottom) / 2;
    const dist = Math.abs(center - focusY);
    if (dist < bestDist) {
      bestDist = dist;
      bestId = r.id;
    }
  }
  return bestId;
}

/**
 * Which messages[] index is nearest the given document Y (scroll space).
 */
export function estimateMessageIndexAtY(
  messages: readonly ChatMessage[],
  y: number,
): number {
  if (messages.length === 0) return -1;
  let acc = 0;
  const target = Math.max(0, y);
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    const h = estimateChatRowHeight({
      contentLength: m.content?.length ?? 0,
      thoughtLength: m.thought?.length ?? 0,
      role: m.role,
    });
    if (acc + h > target) return i;
    acc += h;
  }
  return messages.length - 1;
}

/** Nearest node at or before the given message index; else first node after. */
export function nearestNodeForMessageIndex(
  nodes: readonly SessionMessageNode[],
  messageIndex: number,
): SessionMessageNode | null {
  if (nodes.length === 0) return null;
  let best: SessionMessageNode | null = null;
  for (const n of nodes) {
    if (n.messageIndex <= messageIndex) best = n;
    else break;
  }
  if (best) return best;
  return nodes[0] ?? null;
}

export function nodeById(
  nodes: readonly SessionMessageNode[],
  id: string | null | undefined,
): SessionMessageNode | null {
  if (!id) return null;
  return nodes.find((n) => n.id === id) ?? null;
}

export function adjacentNode(
  nodes: readonly SessionMessageNode[],
  currentId: string | null | undefined,
  delta: -1 | 1,
): SessionMessageNode | null {
  if (nodes.length === 0) return null;
  const cur = currentId ? nodes.findIndex((n) => n.id === currentId) : -1;
  if (cur < 0) {
    return delta > 0 ? (nodes[0] ?? null) : (nodes[nodes.length - 1] ?? null);
  }
  const next = cur + delta;
  if (next < 0 || next >= nodes.length) return null;
  return nodes[next] ?? null;
}

/**
 * Pure in-conversation find helpers (Cmd/Ctrl+F).
 * Case-insensitive match over user + assistant message text (and tool titles).
 */

import { caseInsensitiveSpans } from "./caseFoldIndex";

export type ChatFindMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | string;
  content: string;
  /** Optional tool display title when role is tool / tool_step. */
  toolTitle?: string | null;
  marker?: string | null;
};

export type ChatFindMatch = {
  /** Global 0-based index among all matches for the query. */
  index: number;
  messageId: string;
  /** 0-based occurrence within this message's searchable text. */
  occurrence: number;
  start: number;
  end: number;
};

/**
 * Extract plain text searched for a message.
 * User/assistant: message body. Tool: title (or content fallback).
 * Skips empty / non-searchable rows.
 */
export function searchableTextForMessage(m: ChatFindMessage): string {
  if (m.role === "user" || m.role === "assistant") {
    return m.content ?? "";
  }
  if (m.role === "tool" || m.marker === "tool_step") {
    const title = (m.toolTitle || "").trim();
    if (title) return title;
    // tool_step|status|kind|title\n…
    const raw = m.content ?? "";
    if (raw.startsWith("tool_step|")) {
      const header = raw.split("\n")[0] || "";
      const parts = header.split("|");
      return parts.slice(3).join("|") || parts[2] || "";
    }
    return raw;
  }
  return "";
}

/** Whether this message should participate in find (has searchable text path). */
export function isChatFindableMessage(m: ChatFindMessage): boolean {
  return m.role === "user" || m.role === "assistant" || m.role === "tool" || m.marker === "tool_step";
}

/**
 * Find all case-insensitive occurrences of `query` across messages
 * in document order. Empty / whitespace-only query → no matches.
 */
export function findChatMatches(
  query: string,
  messages: ChatFindMessage[],
): ChatFindMatch[] {
  const q = query.trim();
  if (!q) return [];
  const out: ChatFindMatch[] = [];

  for (const m of messages) {
    if (!isChatFindableMessage(m)) continue;
    const text = searchableTextForMessage(m);
    if (!text) continue;
    const spans = caseInsensitiveSpans(text, q);
    for (let occurrence = 0; occurrence < spans.length; occurrence++) {
      const span = spans[occurrence]!;
      out.push({
        index: out.length,
        messageId: m.id,
        occurrence,
        start: span.start,
        end: span.end,
      });
    }
  }

  return out;
}

/**
 * How many query hits sit in `full` before the visible slice.
 * Used so Cmd+F occurrence indexes (scanned on the raw message body) line
 * up with highlights on a folded conclusion / speech paragraph.
 */
export function findMatchesBeforeVisible(input: {
  full: string;
  visible: string;
  query: string;
}): number {
  const full = input.full ?? "";
  const visible = input.visible ?? "";
  const query = input.query;
  if (!query.trim() || !full) return 0;
  let prefix = "";
  if (visible && full.endsWith(visible)) {
    prefix = full.slice(0, full.length - visible.length);
  } else if (visible) {
    const at = full.indexOf(visible);
    prefix = at >= 0 ? full.slice(0, at) : "";
  } else {
    prefix = full;
  }
  if (!prefix) return 0;
  return findChatMatches(query, [
    { id: "_", role: "assistant", content: prefix },
  ]).length;
}

/** Next / previous match index with wrap-around. */
export function stepChatFindIndex(
  current: number,
  total: number,
  direction: 1 | -1,
): number {
  if (total <= 0) return 0;
  if (current < 0 || current >= total) {
    return direction === 1 ? 0 : total - 1;
  }
  return (current + direction + total) % total;
}

export type HighlightPart = {
  text: string;
  /** True when this slice is a match for the query. */
  match: boolean;
  /** Occurrence index within the full `text` argument (only for match parts). */
  occurrence?: number;
};

/**
 * Split plain text into alternating plain / match parts for rendering
 * `<mark>` nodes. Case-insensitive; empty query returns a single plain part.
 */
export function splitHighlightParts(text: string, query: string): HighlightPart[] {
  const q = query.trim();
  if (!q || !text) {
    return text ? [{ text, match: false }] : [];
  }
  const spans = caseInsensitiveSpans(text, q);
  if (spans.length === 0) return [{ text, match: false }];
  const parts: HighlightPart[] = [];
  let from = 0;
  for (let occurrence = 0; occurrence < spans.length; occurrence++) {
    const span = spans[occurrence]!;
    if (span.start > from) {
      parts.push({ text: text.slice(from, span.start), match: false });
    }
    parts.push({
      text: text.slice(span.start, span.end),
      match: true,
      occurrence,
    });
    from = span.end;
  }
  if (from < text.length) {
    parts.push({ text: text.slice(from), match: false });
  }
  return parts;
}

/** Display label like "3 / 12" or "0 / 0". */
export function formatChatFindCount(activeIndex: number, total: number): {
  current: number;
  total: number;
} {
  if (total <= 0) return { current: 0, total: 0 };
  const current = activeIndex >= 0 && activeIndex < total ? activeIndex + 1 : 1;
  return { current, total };
}

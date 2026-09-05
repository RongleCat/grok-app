/**
 * Conversation quotes / annotations (Codex-style).
 *
 * Selected transcript text becomes its own composer item — not pasted into
 * the input. Optional per-quote comment. Journal dual-writes a fenced block
 * so reload can rebuild the cards.
 */

export const COMPOSER_QUOTE_TEXT_MAX = 8000;
export const COMPOSER_QUOTE_NOTE_MAX = 4000;

export type ComposerQuote = {
  id: string;
  text: string;
  comment: string;
  sourceMessageId?: string;
};

const OPEN_QUOTE = "[[quote]]";
const CLOSE_QUOTE = "[[/quote]]";
const OPEN_NOTE = "[[note]]";
const CLOSE_NOTE = "[[/note]]";

export function makeComposerQuoteId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    return `qte-${c.randomUUID()}`;
  }
  return `qte-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeComposerQuote(raw: unknown): ComposerQuote | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const text = typeof o.text === "string" ? o.text.trim() : "";
  if (!text) return null;
  const comment = typeof o.comment === "string" ? o.comment : "";
  const id =
    typeof o.id === "string" && o.id.trim()
      ? o.id.trim()
      : makeComposerQuoteId();
  const sourceMessageId =
    typeof o.sourceMessageId === "string" && o.sourceMessageId.trim()
      ? o.sourceMessageId.trim()
      : undefined;
  return {
    id,
    text: text.length > COMPOSER_QUOTE_TEXT_MAX
      ? text.slice(0, COMPOSER_QUOTE_TEXT_MAX)
      : text,
    comment:
      comment.length > COMPOSER_QUOTE_NOTE_MAX
        ? comment.slice(0, COMPOSER_QUOTE_NOTE_MAX)
        : comment,
    sourceMessageId,
  };
}

/** Enter / Send: quote cards count as a body, same as files. */
export function composerHasSendPayload(opts: {
  draftEmpty: boolean;
  attachmentCount: number;
  chatAttachmentCount?: number;
  quoteCount: number;
}): boolean {
  return (
    !opts.draftEmpty ||
    opts.attachmentCount > 0 ||
    (opts.chatAttachmentCount ?? 0) > 0 ||
    opts.quoteCount > 0
  );
}

export function normalizeComposerQuotes(raw: unknown): ComposerQuote[] {
  if (!Array.isArray(raw)) return [];
  const out: ComposerQuote[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const q = normalizeComposerQuote(item);
    if (!q || seen.has(q.id)) continue;
    seen.add(q.id);
    out.push(q);
  }
  return out;
}

function fenceSafe(s: string): string {
  return s.replace(/\[\[\/(quote|note)\]\]/g, "[[ /$1]]");
}

/** Encode quotes ahead of the user-typed body for the journal / bubble. */
export function appendQuotesToContent(
  body: string,
  quotes: readonly ComposerQuote[],
): string {
  const text = (body ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!quotes.length) return text;
  const blocks: string[] = [];
  for (const q of quotes) {
    const n = normalizeComposerQuote(q);
    if (!n) continue;
    blocks.push(`${OPEN_QUOTE}\n${fenceSafe(n.text)}\n${CLOSE_QUOTE}`);
    if (n.comment.trim()) {
      blocks.push(`${OPEN_NOTE}\n${fenceSafe(n.comment)}\n${CLOSE_NOTE}`);
    }
  }
  if (!blocks.length) return text;
  return text ? `${blocks.join("\n")}\n\n${text}` : blocks.join("\n");
}

export function parseQuotesFromContent(content: string): {
  text: string;
  quotes: ComposerQuote[];
} {
  if (!content) return { text: "", quotes: [] };
  if (!content.includes("[[quote]]")) return { text: content, quotes: [] };
  const src = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const quotes: ComposerQuote[] = [];
  let rest = src;
  const quoteRe =
    /^\[\[quote\]\]\n([\s\S]*?)\n\[\[\/quote\]\](?:\n\[\[note\]\]\n([\s\S]*?)\n\[\[\/note\]\])?(?:\n+|$)/;

  while (true) {
    const m = quoteRe.exec(rest);
    if (!m || m.index !== 0) break;
    const text = (m[1] ?? "").trim();
    const comment = (m[2] ?? "").trim();
    if (text) {
      quotes.push({
        id: makeComposerQuoteId(),
        text,
        comment,
      });
    }
    rest = rest.slice(m[0].length);
  }
  return { text: rest, quotes };
}

/** Agent-facing body: quotes stay structured, not mixed into the typed prompt. */
export function serializeQuotesForAgent(
  quotes: readonly ComposerQuote[],
  body: string,
): string {
  const blocks: string[] = [];
  for (const q of quotes) {
    const n = normalizeComposerQuote(q);
    if (!n) continue;
    const chunk = [`Quoted excerpt:`, `"""`, n.text, `"""`];
    if (n.comment.trim()) {
      chunk.push(`Comment: ${n.comment.trim()}`);
    }
    blocks.push(chunk.join("\n"));
  }
  const typed = (body ?? "").trim();
  if (!blocks.length) return typed;
  if (!typed) return blocks.join("\n\n");
  return `${blocks.join("\n\n")}\n\n${typed}`;
}

export function isQuotesOnlySend(
  body: string,
  quotes: readonly ComposerQuote[],
): boolean {
  return !body.trim() && quotes.some((q) => (q.text ?? "").trim());
}

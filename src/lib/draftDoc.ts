/**
 * Composer draft document model: text segments + inline skill chips.
 * Storage / user bubbles use stable tokens `[[skill:name]]`.
 * Agent prompts serialize skills as `/name` (Grok Build invocable form).
 */

export type DraftSegment =
  | { type: "text"; text: string }
  | { type: "skill"; name: string }
  | { type: "chat"; sessionId: string; scope?: "recent" | "user" | "full" };

/** Skill name character class: letters, digits, `_` `.` `:` `-`. */
export const SKILL_NAME_RE = /[a-zA-Z0-9_.:-]+/;

const SKILL_TOKEN_RE = /\[\[skill:([a-zA-Z0-9_.:-]+)\]\]/g;

/** Combined skill + attached-chat tokens, in document order. */
const STORED_TOKEN_RE =
  /\[\[skill:([a-zA-Z0-9_.:-]+)\]\]|\[\[chat:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?::(recent|user|full))?\]\]/g;

/**
 * Slash names that are App/Build commands, not skill chips, when rehydrating
 * agent-form history (`/name` lines saved from session_send).
 */
const NON_SKILL_SLASH = new Set(
  [
    "goal",
    "plan",
    "compact",
    "status",
    "mcp",
    "doctor",
    "new",
    "newchat",
    "automations",
    "workflow",
    "workflows",
    "settings",
    "yolo",
    "always-approve",
    "loop",
    "model",
    "effort",
    "help",
    "clear",
    "resume",
    "export",
    "copy",
    "find",
    "history",
    "feedback",
    "live-voice",
    "livevoice",
    "attach-chat",
    "attachchat",
  ].map((s) => s.toLowerCase()),
);

/**
 * Convert agent-form user text (`/skill-name\nbody`) into display tokens
 * (`[[skill:name]]\nbody`) so history bubbles can render chips.
 * Already-tokenized content is left unchanged.
 */
export function hydrateDisplayContent(content: string): string {
  if (!content) return content;
  if (content.includes("[[skill:")) return content;
  if (!content.startsWith("/") && !content.includes("/goal")) return content;

  let rest = content;
  // Drop goal mode prefix from display hydration (mode is session chrome, not a chip).
  if (rest.startsWith("/goal\n")) {
    rest = rest.slice("/goal\n".length);
  } else if (rest === "/goal") {
    return content;
  }

  const nl = rest.indexOf("\n");
  const firstLine = (nl === -1 ? rest : rest.slice(0, nl)).trim();
  const body = nl === -1 ? "" : rest.slice(nl + 1);

  if (!firstLine) return content;

  const parts = firstLine.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return content;
  if (!parts.every((p) => /^\/[a-zA-Z0-9_.:-]+$/.test(p))) return content;

  const names = parts.map((p) => p.slice(1));
  // Require at least one invocable skill; skip pure built-in command lines.
  const skillNames = names.filter(
    (n) => !NON_SKILL_SLASH.has(n.toLowerCase()),
  );
  if (skillNames.length === 0) return content;
  // Only convert when every first-line token is a skill (not mixed with builtins).
  if (skillNames.length !== names.length) return content;

  const chips = skillNames.map((n) => `[[skill:${n}]]`).join("");
  if (!body) return chips;
  // Preserve body; chips sit before the rest of the message.
  return `${chips}\n${body}`;
}

/** Parse user message for display/edit (hydrates agent-form history first). */
export function parseUserMessageContent(content: string): DraftSegment[] {
  return parseStoredContent(hydrateDisplayContent(content));
}

/** Empty draft (no segments). */
export function emptyDraft(): DraftSegment[] {
  return [];
}

/** Single text segment, or empty draft when text is empty. */
export function draftFromPlainText(text: string): DraftSegment[] {
  if (!text) return [];
  return [{ type: "text", text }];
}

/**
 * Parse stored content with `[[skill:name]]` tokens into segments.
 * Invalid / incomplete tokens stay as plain text.
 */
export function parseStoredContent(content: string): DraftSegment[] {
  if (!content) return [];
  if (!content.includes("[[skill:") && !content.includes("[[chat:")) {
    return [{ type: "text", text: content }];
  }
  const segments: DraftSegment[] = [];
  let last = 0;
  const re = new RegExp(STORED_TOKEN_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) {
      segments.push({ type: "text", text: content.slice(last, m.index) });
    }
    if (m[1]) {
      segments.push({ type: "skill", name: m[1] });
    } else if (m[2]) {
      const scope =
        m[3] === "user" || m[3] === "full" || m[3] === "recent"
          ? m[3]
          : undefined;
      segments.push({
        type: "chat",
        sessionId: m[2],
        scope: scope === "recent" ? undefined : scope,
      });
    }
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    segments.push({ type: "text", text: content.slice(last) });
  }
  return segments;
}

/** Serialize segments back to stored form (`[[skill:name]]` tokens). */
export function serializeStored(segments: DraftSegment[]): string {
  return segments
    .map((s) => {
      if (s.type === "text") return s.text;
      if (s.type === "skill") return `[[skill:${s.name}]]`;
      return s.scope && s.scope !== "recent"
        ? `[[chat:${s.sessionId}:${s.scope}]]`
        : `[[chat:${s.sessionId}]]`;
    })
    .join("");
}

/**
 * Replace `[[skill:name]]` with `/name` in place for one-line previews
 * (queue strip, titles). Keeps surrounding text order — unlike
 * {@link serializeForAgent}, which groups skills first.
 */
export function previewStoredAsSlash(stored: string): string {
  if (!stored) return stored;
  return stored
    .replace(new RegExp(SKILL_TOKEN_RE.source, "g"), "/$1")
    .replace(
      /\[\[chat:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?::(recent|user|full))?\]\]/g,
      "",
    )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/^\n+/, "")
    .trim();
}

/**
 * Text of text segments only (skills omitted).
 * Do not use alone for "has content" when skills may be present — use `isDraftEmpty`.
 */
export function plainTextOf(segments: DraftSegment[]): string {
  return segments
    .filter((s): s is { type: "text"; text: string } => s.type === "text")
    .map((s) => s.text)
    .join("");
}

/** Empty when there are no skills, no attached chats, and no non-whitespace text. */
export function isDraftEmpty(segments: DraftSegment[]): boolean {
  for (const s of segments) {
    if (s.type === "skill" || s.type === "chat") return false;
    if (s.type === "text" && s.text.trim() !== "") return false;
  }
  return true;
}

/**
 * Build the string sent to the agent:
 * - skills in order as `/name`, space-joined
 * - then `\n` + joined text parts (ends trimmed; internal newlines kept)
 * - `goalMode` prefixes `/goal\n`
 */
export function serializeForAgent(
  segments: DraftSegment[],
  opts?: { goalMode?: boolean },
): string {
  const skillTokens: string[] = [];
  const textParts: string[] = [];
  for (const s of segments) {
    if (s.type === "skill") skillTokens.push(`/${s.name}`);
    else if (s.type === "text") textParts.push(s.text);
  }

  const skillsPart = skillTokens.join(" ");
  // Trim only leading/trailing whitespace; keep internal newlines.
  const textPart = textParts.join("").replace(/^\s+/, "").replace(/\s+$/, "");

  let body: string;
  if (skillsPart && textPart) body = `${skillsPart}\n${textPart}`;
  else if (skillsPart) body = skillsPart;
  else body = textPart;

  if (opts?.goalMode) {
    return body ? `/goal\n${body}` : "/goal";
  }
  return body;
}

/**
 * Replace the active slash range `[slashStart, slashEnd)` with a skill token
 * plus a trailing space.
 */
export function applySkillAtSlash(
  stored: string,
  slashStart: number,
  slashEnd: number,
  skillName: string,
): string {
  const token = `[[skill:${skillName}]] `;
  return stored.slice(0, slashStart) + token + stored.slice(slashEnd);
}

/**
 * Normalize contenteditable plain text without changing newline structure.
 * Fullwidth solidus → `/` (1:1); drop zero-width / object-replacement ghosts.
 */
export function normalizeEditorPlainText(t: string): string {
  return t
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\uFF0F/g, "/") // fullwidth solidus
    .replace(/[\u200B-\u200D\uFEFF\u2060\uFFFC]/g, ""); // zero-width + ORC
}

/**
 * Plain text as shown in a contenteditable (not React draft state).
 * Prefer this for live slash *filter display* when IME lags draft/onChange.
 * Do **not** use indices from this string to mutate stored draft when chips
 * are present — use {@link readStoredEditorText} / {@link detectSlashRangeOnStored}.
 */
export function readPlainEditorText(el: HTMLElement): string {
  let t = el.innerText ?? el.textContent ?? "";
  return normalizeEditorPlainText(t);
}

/**
 * Contenteditable → stored draft form (`[[skill:name]]` tokens + real newlines).
 *
 * Policy for the **user bubble / journal**: store what the user typed — including
 * blank lines. Do not fold `\n+`, re-paragraph, or “pretty up” text.
 *
 * Uses an in-tree walk (not detached `innerText`, which is layout-dependent and
 * lossy on clones). Top-level block boxes (WebKit `DIV` lines) become lines
 * joined by `\n`; empty blocks are empty lines.
 */
export function readStoredEditorText(el: HTMLElement): string {
  return serializeEditorDomWalk(el);
}

/** Block tags WebKit/contenteditable use as line boxes. */
function isEditorBlockTag(tag: string): boolean {
  return (
    tag === "DIV" ||
    tag === "P" ||
    tag === "LI" ||
    tag === "H1" ||
    tag === "H2" ||
    tag === "H3" ||
    tag === "H4" ||
    tag === "H5" ||
    tag === "H6" ||
    tag === "SECTION" ||
    tag === "ARTICLE" ||
    tag === "BLOCKQUOTE"
  );
}

function cleanEditorText(raw: string): string {
  return raw
    .replace(/[\u200B-\u200D\uFEFF\u2060\uFFFC]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

/**
 * Inline content of one line box: text + soft `<br>` → `\n` + skill tokens.
 * A caret-only `<br>` in an otherwise empty line yields `""` (empty line body).
 */
export function serializeEditorLineContent(el: HTMLElement): string {
  const parts: string[] = [];

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = cleanEditorText(node.textContent ?? "");
      if (t) parts.push(t);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const he = node as HTMLElement;
    if (he.dataset?.skill != null || he.hasAttribute("data-skill")) {
      const name =
        he.dataset?.skill || he.getAttribute("data-skill") || "";
      parts.push(`[[skill:${name}]]`);
      return;
    }
    if (he.tagName === "BR") {
      parts.push("\n");
      return;
    }
    const kids = he.childNodes;
    for (let i = 0; i < kids.length; i++) walk(kids[i]!);
  };

  const kids = el.childNodes;
  for (let i = 0; i < kids.length; i++) walk(kids[i]!);

  let line = parts.join("");
  // Empty line placeholder: sole <br> → treat as empty body (caller joins lines).
  if (line === "\n" || line === "") return "";
  // "hello<br>" caret at end of non-empty line → drop one trailing break.
  if (line.endsWith("\n") && !line.endsWith("\n\n")) {
    line = line.slice(0, -1);
  }
  return line;
}

/**
 * DOM → stored draft (live tree walk). Exported for tests via structural helpers.
 *
 * - **Block children** of the editor: each top-level `DIV`/`P`/… is one line;
 *   lines joined with `\n`. Empty block ⇒ blank line (keeps `\n\n`).
 * - **Flat** (text + `<br>` + chips, no line boxes): br/text walk, keep every `\n`.
 */
export function serializeEditorDomWalk(
  root: HTMLElement,
  opts?: { preserveWhitespaceOnly?: boolean },
): string {
  const kids = Array.from(root.childNodes);
  const hasBlockChild = kids.some(
    (n) =>
      n.nodeType === Node.ELEMENT_NODE &&
      isEditorBlockTag((n as Element).tagName),
  );

  let t: string;

  if (hasBlockChild) {
    const lines: string[] = [];
    for (const n of kids) {
      if (n.nodeType === Node.TEXT_NODE) {
        const tx = cleanEditorText(n.textContent ?? "");
        if (!tx) continue;
        // Rare loose text at root with embedded newlines.
        const pieces = tx.split("\n");
        for (const p of pieces) lines.push(p);
        continue;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      const he = n as HTMLElement;
      if (he.tagName === "BR") {
        // Extra break between blocks = extra empty line.
        lines.push("");
        continue;
      }
      if (he.dataset?.skill != null || he.hasAttribute("data-skill")) {
        const name =
          he.dataset?.skill || he.getAttribute("data-skill") || "";
        lines.push(`[[skill:${name}]]`);
        continue;
      }
      if (isEditorBlockTag(he.tagName)) {
        lines.push(serializeEditorLineContent(he));
        continue;
      }
      // Other wrappers (e.g. pad spans): fold as a line fragment.
      lines.push(serializeEditorLineContent(he));
    }
    // WebKit inserts a caret sentinel empty block. Drop it — unless the last
    // block is an intentional trailing newline (`data-composer-nl`).
    const lastBlock = [...kids]
      .reverse()
      .find(
        (n) =>
          n.nodeType === Node.ELEMENT_NODE &&
          isEditorBlockTag((n as Element).tagName),
      ) as HTMLElement | undefined;
    const lastEmpty = lines.length > 0 && lines[lines.length - 1] === "";
    const keepTrailingEmpty = shouldKeepTrailingEmptyLine({
      lastLineEmpty: lastEmpty,
      markedIntentional: lastBlock?.getAttribute("data-composer-nl") === "1",
      caretInLastLine: false,
      lineCount: lines.length,
    });
    t = joinEditorBlockLines(lines, keepTrailingEmpty);
  } else {
    // Flat model (insertText \n / appendTextWithBreaks).
    const parts: string[] = [];
    const walkFlat = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const tx = cleanEditorText(node.textContent ?? "");
        if (tx) parts.push(tx);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const he = node as HTMLElement;
      if (he.dataset?.skill != null || he.hasAttribute("data-skill")) {
        const name =
          he.dataset?.skill || he.getAttribute("data-skill") || "";
        parts.push(`[[skill:${name}]]`);
        return;
      }
      if (he.tagName === "BR") {
        parts.push("\n");
        return;
      }
      const ch = he.childNodes;
      for (let i = 0; i < ch.length; i++) walkFlat(ch[i]!);
    };
    for (const n of kids) walkFlat(n);
    t = parts.join("");
  }

  if (
    !opts?.preserveWhitespaceOnly &&
    !t.replace(/\n/g, "").trim() &&
    !/\[\[skill:/.test(t)
  ) {
    return "";
  }
  return t;
}

/** True when the last empty block is a real trailing newline, not a caret sentinel. */
export function shouldKeepTrailingEmptyLine(opts: {
  lastLineEmpty: boolean;
  markedIntentional: boolean;
  caretInLastLine: boolean;
  lineCount: number;
}): boolean {
  if (opts.lineCount < 2 || !opts.lastLineEmpty) return false;
  return opts.markedIntentional || opts.caretInLastLine;
}

/** Join block-line bodies. Keep a last empty line only when it is intentional. */
export function joinEditorBlockLines(
  lines: string[],
  keepTrailingEmpty: boolean,
): string {
  const out = [...lines];
  if (!keepTrailingEmpty && out.length >= 2 && out[out.length - 1] === "") {
    out.pop();
  }
  return out.join("\n");
}

/**
 * Insert a newline into a stored draft string at `caret` (0…length).
 * Pure helper for Enter handling — draft is SoT, not a lossy DOM round-trip.
 */
export function insertNewlineAt(stored: string, caret: number): string {
  const i = Math.max(0, Math.min(caret, stored.length));
  return stored.slice(0, i) + "\n" + stored.slice(i);
}

/**
 * Next stored draft after Enter / Shift+Enter.
 * `liveStored` must be the serialized **live editor**, never a lagging React
 * snapshot — rewriting the contenteditable from `lastValue` deleted typed text.
 */
export function composerEnterNextStored(
  liveStored: string,
  caret: number,
): string {
  return insertNewlineAt(liveStored, caret);
}

/**
 * Detect an active slash token at the end of `textBeforeCursor`.
 * `/` must be at index 0 or immediately after whitespace.
 * Query is the non-whitespace rest after `/`.
 * Returns null when there is no active slash (e.g. `https://`).
 *
 * Contenteditable almost always serializes a trailing `\n` (from `<br>`).
 * Without trimming, `/目标\n` fails `$` anchor and filtering looks "broken".
 *
 * Indices are on the trailing-whitespace-trimmed form of the input (after
 * 1:1 fullwidth `/` and zero-width strip). Prefer {@link detectSlashRangeOnStored}
 * when applying mutations so `end` is exact on the stored draft.
 *
 * Pass **text before the caret** (not necessarily the full draft) so a `/query`
 * in the middle of the message — after a newline or space — still opens the panel.
 */
export function detectSlashQuery(
  textBeforeCursor: string,
): { start: number; query: string } | null {
  const range = detectSlashRangeOnStored(textBeforeCursor);
  if (!range) return null;
  return { start: range.start, query: range.query };
}

/**
 * Slash range on **stored draft form** (or the stored prefix before the caret).
 * Trailing whitespace is ignored for matching only; `start`/`end` are never
 * taken from a newline-collapsed rewrite of the body.
 *
 * `end` is exclusive and equals `start + 1 + query.length` (the `/query` span).
 *
 * When `text` is only the prefix before the caret, indices are also valid in the
 * full draft (prefix is a stored-form prefix of the full string).
 */
export function detectSlashRangeOnStored(
  stored: string,
): { start: number; query: string; end: number } | null {
  if (!stored) return null;
  // 1:1 / ghost cleanup only — do not collapse newlines or drop blank lines.
  const cleaned = normalizeEditorPlainText(stored);
  // Trim trailing whitespace for `$` match without rewriting the body prefix.
  let endExclusive = cleaned.length;
  while (endExclusive > 0) {
    const ch = cleaned.charCodeAt(endExclusive - 1);
    // space, tab, LF, CR, NBSP (NBSP already mapped to space in normalize)
    if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d) {
      endExclusive -= 1;
      continue;
    }
    break;
  }
  const head = cleaned.slice(0, endExclusive);
  const m = /(^|[\s])\/([^\s]*)$/u.exec(head);
  if (!m) return null;
  const start = m.index + m[1]!.length;
  const query = m[2]!;
  const end = start + 1 + query.length;
  return { start, query, end };
}

/**
 * Stored-form text from the start of the editor through the caret
 * (same coordinate space as {@link readStoredEditorText}).
 * Returns null when there is no collapsed caret inside `el`.
 */
export function getStoredTextBeforeCaret(
  el: HTMLElement | null | undefined,
): string | null {
  if (!el || typeof window === "undefined") return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  const frag = pre.cloneContents();
  const tmp = document.createElement("div");
  tmp.appendChild(frag);
  // Caret-prefix clones are often newline-only (`\n\n` before later text).
  // Collapsing those to "" made Enter insert at offset 0 and rewrite the body.
  return serializeEditorDomWalk(tmp, { preserveWhitespaceOnly: true });
}

/**
 * Live slash token from a contenteditable element.
 *
 * Prefers **text before the caret** so `/query` works mid-message (after a
 * newline or space), not only at the end of the full draft. Falls back to the
 * full stored text when the caret cannot be read.
 *
 * Indices are stored-form so they apply to React draft / `applySkillAtSlash`.
 */
export function detectSlashQueryFromEditor(
  el: HTMLElement | null | undefined,
): { start: number; query: string; end: number } | null {
  if (!el) return null;
  const before = getStoredTextBeforeCaret(el);
  if (before != null) {
    const atCaret = detectSlashRangeOnStored(before);
    if (atCaret) return atCaret;
    // Caret known but no slash before it — do not fall back to a slash at the
    // far end of the document (user is editing elsewhere).
    return null;
  }
  return detectSlashRangeOnStored(readStoredEditorText(el));
}

/** Collapse consecutive text segments into one. */
export function mergeAdjacentText(segments: DraftSegment[]): DraftSegment[] {
  if (segments.length === 0) return [];
  const out: DraftSegment[] = [];
  for (const s of segments) {
    const prev = out[out.length - 1];
    if (s.type === "text" && prev?.type === "text") {
      out[out.length - 1] = { type: "text", text: prev.text + s.text };
    } else {
      out.push(s);
    }
  }
  return out;
}

/**
 * Simple editor projection: text as-is, skills as `[[skill:name]]`.
 * Same wire form as `serializeStored`.
 */
export function segmentsToPlainEditorText(segments: DraftSegment[]): string {
  return serializeStored(segments);
}

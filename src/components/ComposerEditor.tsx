/**
 * Contenteditable composer: plain text + inline skill chips.
 * Value is stored form with [[skill:name]] tokens.
 *
 * Slash filter: parent also derives query from `value` (draft). This editor
 * still emits caret-based slashQuery for mid-line tokens and live IME updates.
 */

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type Ref,
} from "react";
import { skillChipGlyphSvg } from "@/components/SkillChip";
import {
  clipboardLooksLikeMedia,
  clipboardLooksLikeOsFiles,
  clipboardPlainText,
  collectFilesFromDataTransfer,
  isFileUrlOnlyText,
  readClipboardMediaFiles,
} from "@/lib/clipboardPaste";
import {
  installComposerControlHeldTracking,
  shouldSteerOnKeydown,
} from "@/lib/composerSendKey";
import {
  composerEnterNextStored,
  detectSlashRangeOnStored,
  getStoredTextBeforeCaret,
  joinEditorBlockLines,
  parseStoredContent,
  readStoredEditorText,
  serializeEditorLineContent,
  shouldKeepTrailingEmptyLine,
  type DraftSegment,
} from "@/lib/draftDoc";
import { detectAppPlatform } from "@/lib/appPlatform";
import {
  hugePlainTextFileName,
  hugePlainTextToFile,
  shouldSpillHugePlainText,
} from "@/lib/longAssistantSpill";

/** Caret landing pad around non-editable skill chips (stripped on serialize). */
const CARET_PAD = "\u200B";

function clearNode(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** DOM projection of stored text. A trailing `\n` must keep an editable pad
 *  after the last `<br>` — a lone trailing break is WebKit's empty-editor
 *  sentinel, so the first Shift+Enter would not show a new line. */
export type ComposerEditorNodeSpec =
  | { type: "text"; value: string }
  | { type: "br" };

export function storedTextToEditorNodes(
  text: string,
  caretPad = CARET_PAD,
): ComposerEditorNodeSpec[] {
  const nodes: ComposerEditorNodeSpec[] = [];
  const parts = text.split("\n");
  parts.forEach((part, i) => {
    if (part) nodes.push({ type: "text", value: part });
    if (i < parts.length - 1) nodes.push({ type: "br" });
  });
  if (text.endsWith("\n")) nodes.push({ type: "text", value: caretPad });
  return nodes;
}

const CARET_PAD_RE = /[\u200B-\u200D\uFEFF\u2060]/g;

/**
 * ZWSP pads hold the caret on a trailing newline, but IME types *into* that
 * node and splits Chinese glyphs (caret in the middle, odd fallback font).
 * Strip pads before composition / after landing the caret on a new line.
 */
export function stripCaretPadsInEditor(el: HTMLElement) {
  const sel = window.getSelection();
  const caretNode = sel?.anchorNode ?? null;
  const caretOff = sel?.anchorOffset ?? 0;
  let nextNode: Node | null = caretNode;
  let nextOff = caretOff;

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) texts.push(n as Text);

  for (const t of texts) {
    if (!CARET_PAD_RE.test(t.data)) continue;
    CARET_PAD_RE.lastIndex = 0;
    const before =
      t === caretNode ? t.data.slice(0, caretOff).replace(CARET_PAD_RE, "") : "";
    const cleaned = t.data.replace(CARET_PAD_RE, "");
    t.data = cleaned;
    if (t === caretNode) {
      nextNode = t;
      nextOff = before.length;
    }
  }

  if (sel && nextNode && el.contains(nextNode)) {
    const max =
      nextNode.nodeType === Node.TEXT_NODE
        ? (nextNode.textContent ?? "").length
        : 0;
    try {
      const range = document.createRange();
      range.setStart(nextNode, Math.max(0, Math.min(nextOff, max)));
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {
      /* ignore */
    }
  }
}

function isChipEl(node: Node | null | undefined): node is HTMLElement {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
  const he = node as HTMLElement;
  return !!(
    he.dataset?.skill ||
    he.getAttribute("data-skill") ||
    he.dataset?.plugin ||
    he.getAttribute("data-plugin")
  );
}

function chipTokenOf(he: HTMLElement): string {
  const plugin =
    he.dataset?.plugin || he.getAttribute("data-plugin") || "";
  if (plugin || he.hasAttribute("data-plugin")) {
    return plugin ? `[[plugin:${plugin}]]` : "";
  }
  const name = he.dataset?.skill || he.getAttribute("data-skill") || "";
  return name ? `[[skill:${name}]]` : "";
}

function makeSkillChipEl(name: string): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "skill-chip skill-chip--sm skill-chip--editor";
  wrap.contentEditable = "false";
  wrap.dataset.skill = name;
  wrap.setAttribute("data-skill", name);
  wrap.setAttribute("contenteditable", "false");

  const icon = document.createElement("span");
  icon.className = "skill-chip__glyph";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = skillChipGlyphSvg(name);

  const label = document.createElement("span");
  label.className = "skill-chip__name";
  label.textContent = name;

  wrap.appendChild(icon);
  wrap.appendChild(label);
  return wrap;
}

function makePluginChipEl(name: string): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className =
    "skill-chip skill-chip--sm skill-chip--editor skill-chip--plugin";
  wrap.contentEditable = "false";
  wrap.dataset.plugin = name;
  wrap.setAttribute("data-plugin", name);
  wrap.setAttribute("contenteditable", "false");

  const icon = document.createElement("span");
  icon.className = "skill-chip__glyph";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = skillChipGlyphSvg(name);

  const label = document.createElement("span");
  label.className = "skill-chip__name";
  label.textContent = name;

  wrap.appendChild(icon);
  wrap.appendChild(label);
  return wrap;
}

/** ZWSP pad so caret can sit immediately before/after a non-editable chip. */
function appendCaretPad(el: HTMLElement) {
  el.appendChild(document.createTextNode(CARET_PAD));
}

const COMPOSER_NL_ATTR = "data-composer-nl";

type LineInline =
  | { type: "text"; value: string }
  | { type: "skill"; name: string }
  | { type: "plugin"; name: string };

function segmentsToLines(segments: DraftSegment[]): LineInline[][] {
  const lines: LineInline[][] = [[]];
  for (const seg of segments) {
    if (seg.type === "skill" || seg.type === "plugin") {
      lines[lines.length - 1]!.push({ type: seg.type, name: seg.name });
      continue;
    }
    if (seg.type === "chat") {
      continue;
    }
    const parts = seg.text.split("\n");
    parts.forEach((part, i) => {
      if (part) lines[lines.length - 1]!.push({ type: "text", value: part });
      if (i < parts.length - 1) lines.push([]);
    });
  }
  return lines;
}

function fillLineDiv(div: HTMLElement, items: LineInline[]) {
  if (items.length === 0) {
    div.appendChild(document.createElement("br"));
    return;
  }
  for (const item of items) {
    if (item.type === "text") {
      div.appendChild(document.createTextNode(item.value));
    } else {
      appendCaretPad(div);
      div.appendChild(
        item.type === "plugin"
          ? makePluginChipEl(item.name)
          : makeSkillChipEl(item.name),
      );
      appendCaretPad(div);
    }
  }
}

/** One DIV per line. Trailing empty line is marked so serialize keeps the \n. */
function renderSegmentsInto(el: HTMLElement, segments: DraftSegment[]) {
  clearNode(el);
  if (segments.length === 0) return;
  const lines = segmentsToLines(segments);
  const stored = segments
    .map((s) => (s.type === "text" ? s.text : ""))
    .join("");
  lines.forEach((items, i) => {
    const div = document.createElement("div");
    fillLineDiv(div, items);
    if (items.length === 0 && i === lines.length - 1 && stored.endsWith("\n")) {
      div.setAttribute(COMPOSER_NL_ATTR, "1");
    }
    el.appendChild(div);
  });
}

/** True when the collapsed caret is immediately after a skill chip (ignoring ZWSP). */
function skillChipBeforeCaret(el: HTMLElement): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return null;

  let node: Node | null = range.startContainer;
  let offset = range.startOffset;

  if (node === el) {
    // Caret between children of the editor root.
    const prev = el.childNodes[offset - 1] ?? null;
    if (isChipEl(prev)) return prev;
    if (
      prev?.nodeType === Node.TEXT_NODE &&
      isPadOnlyText(prev.textContent) &&
      isChipEl(prev.previousSibling)
    ) {
      return prev.previousSibling as HTMLElement;
    }
    return null;
  }

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    // Only consider "just after" when caret is at start of a pad after chip,
    // or at offset 0 with previous sibling chip, or offset into empty/pad after chip.
    if (offset === 0) {
      let prev = node.previousSibling;
      if (isChipEl(prev)) return prev;
      if (prev?.nodeType === Node.TEXT_NODE && isPadOnlyText(prev.textContent)) {
        prev = prev.previousSibling;
        if (isChipEl(prev)) return prev;
      }
      return null;
    }
    // Caret mid text: only if the text before caret is only pads and chip is prev.
    const before = text.slice(0, offset);
    if (isPadOnlyText(before)) {
      let prev = node.previousSibling;
      if (isChipEl(prev)) return prev;
    }
    return null;
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    const prev = node.childNodes[offset - 1] ?? null;
    if (isChipEl(prev)) return prev;
  }
  return null;
}

/** True when the collapsed caret is immediately before a skill chip. */
function skillChipAfterCaret(el: HTMLElement): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return null;

  let node: Node | null = range.startContainer;
  let offset = range.startOffset;

  if (node === el) {
    const next = el.childNodes[offset] ?? null;
    if (isChipEl(next)) return next;
    if (
      next?.nodeType === Node.TEXT_NODE &&
      isPadOnlyText(next.textContent) &&
      isChipEl(next.nextSibling)
    ) {
      return next.nextSibling as HTMLElement;
    }
    return null;
  }

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    if (offset >= text.length || isPadOnlyText(text.slice(offset))) {
      let next = node.nextSibling;
      if (isChipEl(next)) return next;
      if (next?.nodeType === Node.TEXT_NODE && isPadOnlyText(next.textContent)) {
        next = next.nextSibling;
        if (isChipEl(next)) return next;
      }
    }
    return null;
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    const next = node.childNodes[offset] ?? null;
    if (isChipEl(next)) return next;
  }
  return null;
}

function isPadOnlyText(s: string | null | undefined): boolean {
  if (s == null || s === "") return true;
  return /^[\u200B-\u200D\uFEFF\u2060\u00a0\s]*$/.test(s);
}

/**
 * Remove a skill chip element from the editor DOM and return the new stored
 * string (caller commits). Places caret where the chip was.
 */
function removeSkillChipEl(el: HTMLElement, chip: HTMLElement): string {
  // Drop adjacent caret pads that only exist for this chip.
  const prev = chip.previousSibling;
  const next = chip.nextSibling;
  if (prev?.nodeType === Node.TEXT_NODE && isPadOnlyText(prev.textContent)) {
    prev.parentNode?.removeChild(prev);
  }
  if (next?.nodeType === Node.TEXT_NODE && isPadOnlyText(next.textContent)) {
    // Keep a single pad if we need a caret target; leave one empty text for now.
    const afterNext = next.nextSibling;
    next.parentNode?.removeChild(next);
    void afterNext;
  }
  const parent = chip.parentNode;
  const ref = chip.nextSibling;
  parent?.removeChild(chip);
  // Ensure there is somewhere to put the caret.
  if (!el.firstChild) {
    el.appendChild(document.createTextNode(""));
  }
  // Place caret at the removal point.
  try {
    const sel = window.getSelection();
    if (sel && parent) {
      const r = document.createRange();
      if (ref && parent.contains(ref)) {
        r.setStartBefore(ref);
      } else if (parent === el || el.contains(parent)) {
        r.selectNodeContents(el);
        r.collapse(false);
      } else {
        r.selectNodeContents(el);
        r.collapse(false);
      }
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  } catch {
    placeCaretAtEnd(el);
  }
  return serializeDom(el);
}

/**
 * Strip caret/layout ghosts WebKit injects into contenteditable
 * (ZWSP, object-replacement “□”, BOM, word-joiner). Used for caret-edge
 * checks only — not for slash mutation ranges.
 */
function stripEditorGhostChars(s: string): string {
  return s.replace(/[\u200B-\u200D\uFEFF\u2060\uFFFC]/g, "");
}

/**
 * Serialize contenteditable → stored draft.
 * Delegates to {@link readStoredEditorText} (skill chips → `[[skill:…]]`,
 * block-level Enter keeps real newlines). Shared with slash range detection
 * so mutation indices always land on the same coordinate space as React draft.
 */
export function serializeDom(el: HTMLElement): string {
  return readStoredEditorText(el);
}

/** Line-div draft: keep a trailing \n when the caret is on that empty line. */
function serializeComposerDraft(el: HTMLElement): string {
  const lines = lineDivsOf(el);
  if (lines.length === 0) return serializeDom(el);
  const bodies = lines.map((d) => serializeEditorLineContent(d));
  const last = lines[lines.length - 1]!;
  const sel = window.getSelection();
  const caretInLast = !!(
    sel &&
    sel.anchorNode &&
    (last === sel.anchorNode || last.contains(sel.anchorNode))
  );
  const keep = shouldKeepTrailingEmptyLine({
    lastLineEmpty: (bodies[bodies.length - 1] ?? "") === "",
    markedIntentional: last.getAttribute("data-composer-nl") === "1",
    caretInLastLine: caretInLast,
    lineCount: lines.length,
  });
  const t = joinEditorBlockLines(bodies, keep);
  if (!t.replace(/\n/g, "").trim() && !/\[\[skill:/.test(t)) return "";
  return t;
}

function getTextBeforeCaret(el: HTMLElement): string | null {
  return getStoredTextBeforeCaret(el);
}

/**
 * Caret offset as length of serialized content before the caret.
 * Caller clamps to current draft length when applying an insert.
 */
export function getComposerCaretOffset(
  el: HTMLElement | null | undefined,
): number | null {
  if (!el) return null;
  const before = getTextBeforeCaret(el);
  if (before == null) return null;
  return before.length;
}

/** Caret index clamped into `draft` (0…draft.length); end if unknown. */
export function getComposerCaretIndex(
  el: HTMLElement | null | undefined,
  draft: string,
): number {
  const off = getComposerCaretOffset(el);
  if (off == null) return draft.length;
  return Math.max(0, Math.min(off, draft.length));
}

function lineDivsOf(el: HTMLElement): HTMLElement[] {
  return Array.from(el.children).filter(
    (c): c is HTMLElement =>
      c instanceof HTMLElement &&
      c.tagName === "DIV" &&
      !c.dataset?.skill &&
      !c.hasAttribute("data-skill") &&
      !c.dataset?.plugin &&
      !c.hasAttribute("data-plugin"),
  );
}

function padEmptyComposerLine(div: HTMLElement) {
  const hasChip = !!div.querySelector("[data-skill], [data-plugin]");
  if (hasChip || serializeEditorLineContent(div)) return;
  while (div.firstChild) div.removeChild(div.firstChild);
  div.appendChild(document.createElement("br"));
}

function markTrailingEmptyComposerLine(el: HTMLElement) {
  const lines = lineDivsOf(el);
  for (const d of lines) d.removeAttribute(COMPOSER_NL_ATTR);
  const last = lines[lines.length - 1];
  if (last && serializeEditorLineContent(last) === "") {
    last.setAttribute(COMPOSER_NL_ATTR, "1");
  }
}

/** Wrap flat text/`<br>` children into one line DIV without copying text. */
function ensureComposerLineDivs(el: HTMLElement) {
  if (lineDivsOf(el).length > 0) return;
  const wrap = document.createElement("div");
  if (!el.firstChild) {
    wrap.appendChild(document.createElement("br"));
  } else {
    while (el.firstChild) wrap.appendChild(el.firstChild);
  }
  el.appendChild(wrap);
}

function lineDivForCaret(el: HTMLElement, range: Range): HTMLElement | null {
  const lines = lineDivsOf(el);
  if (lines.length === 0) return null;
  const node = range.startContainer;
  if (node === el) {
    const last = Math.max(0, el.childNodes.length - 1);
    const child = el.childNodes[Math.min(range.startOffset, last)] ?? null;
    if (child instanceof HTMLElement && lines.includes(child)) return child;
    return lines[Math.min(range.startOffset, lines.length - 1)]!;
  }
  for (const d of lines) {
    if (d === node || d.contains(node)) return d;
  }
  return lines[lines.length - 1]!;
}

/**
 * Split the current line DIV at the caret. Does **not** clear the editor —
 * rewriting from a React snapshot was deleting live typed text on Shift+Enter.
 *
 * WebKit often reports the caret on the editor root (`startContainer === el`,
 * offset 0) after wrapping a typed line. Treating that as "start of line"
 * extracted the whole line onto the next row. If the caret is visually at
 * the end, insert an empty next line instead of moving the text.
 */
export function insertComposerLineBreakInPlace(el: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  let range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer) && range.startContainer !== el) {
    return false;
  }

  const visuallyAtEnd = isCaretAtEditorEnd(el);
  const anchorNode = range.startContainer;
  const anchorOff = range.startOffset;

  ensureComposerLineDivs(el);
  if (sel.rangeCount === 0) return false;
  if (
    anchorNode.nodeType === Node.TEXT_NODE &&
    el.contains(anchorNode)
  ) {
    try {
      const restored = document.createRange();
      const max = (anchorNode.textContent ?? "").length;
      restored.setStart(anchorNode, Math.max(0, Math.min(anchorOff, max)));
      restored.collapse(true);
      sel.removeAllRanges();
      sel.addRange(restored);
      range = restored;
    } catch {
      range = sel.getRangeAt(0);
    }
  } else {
    range = sel.getRangeAt(0);
  }
  if (!range.collapsed) {
    range.deleteContents();
    if (sel.rangeCount === 0) return false;
    range = sel.getRangeAt(0);
  }

  const line = lineDivForCaret(el, range);
  if (!line) return false;

  const next = document.createElement("div");
  if (visuallyAtEnd) {
    padEmptyComposerLine(line);
    next.appendChild(document.createElement("br"));
    line.insertAdjacentElement("afterend", next);
    markTrailingEmptyComposerLine(el);
    placeCaretInLine(next, true);
    return true;
  }

  const tail = document.createRange();
  try {
    if (line.contains(range.startContainer) || range.startContainer === line) {
      tail.setStart(range.startContainer, range.startOffset);
    } else if (range.startContainer === el) {
      // (el, i) = before child i. Past this line → split at end; else start.
      const lineIndex = lineDivsOf(el).indexOf(line);
      if (range.startOffset > lineIndex) {
        tail.setStart(line, line.childNodes.length);
      } else {
        tail.setStart(line, 0);
      }
    } else {
      return false;
    }
    tail.setEnd(line, line.childNodes.length);
  } catch {
    return false;
  }

  const contents = tail.extractContents();
  next.appendChild(contents);
  padEmptyComposerLine(line);
  padEmptyComposerLine(next);
  line.insertAdjacentElement("afterend", next);
  markTrailingEmptyComposerLine(el);
  placeCaretInLine(next, true);
  return true;
}

function placeCaretInLine(div: HTMLElement, atStart: boolean) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
  let text: Text | null = null;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (atStart) {
      text = n as Text;
      break;
    }
    text = n as Text;
  }
  if (text && (text.textContent ?? "").length > 0) {
    range.setStart(text, atStart ? 0 : text.textContent!.length);
    range.collapse(true);
  } else {
    range.selectNodeContents(div);
    range.collapse(true);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

function placeCaretAtEnd(el: HTMLElement) {
  el.focus();
  const lines = lineDivsOf(el);
  if (lines.length > 0) {
    placeCaretInLine(lines[lines.length - 1]!, false);
    return;
  }
  const sel = window.getSelection();
  if (!sel) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let lastText: Text | null = null;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    lastText = n as Text;
  }
  const range = document.createRange();
  if (lastText) {
    range.setStart(lastText, lastText.textContent?.length ?? 0);
    range.collapse(true);
  } else {
    range.selectNodeContents(el);
    range.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * Place caret at a stored-draft offset (same coordinate space as serializeDom:
 * ZWSP pads ignored, BR = 1, skill chip = `[[skill:name]]` length).
 */
function placeCaretInLineAt(div: HTMLElement, offset: number) {
  if (offset <= 0) {
    placeCaretInLine(div, true);
    return;
  }
  const sel = window.getSelection();
  if (!sel) return;
  let seen = 0;
  const kids = Array.from(div.childNodes);
  for (const child of kids) {
    if (child.nodeType === Node.TEXT_NODE) {
      const raw = child.textContent ?? "";
      let local = 0;
      for (let i = 0; i < raw.length; i++) {
        const ch = raw.charCodeAt(i);
        if (
          ch === 0x200b ||
          ch === 0x200c ||
          ch === 0x200d ||
          ch === 0xfeff ||
          ch === 0x2060 ||
          ch === 0xfffc
        ) {
          continue;
        }
        if (seen === offset) {
          const range = document.createRange();
          range.setStart(child, i);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          return;
        }
        seen++;
        local++;
      }
      if (seen === offset) {
        const range = document.createRange();
        range.setStart(child, raw.length);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      continue;
    }
    if (child.nodeType === Node.ELEMENT_NODE && isChipEl(child)) {
      const tokenLen = chipTokenOf(child as HTMLElement).length;
      if (seen + tokenLen >= offset) {
        const after = child.nextSibling;
        const range = document.createRange();
        if (after?.nodeType === Node.TEXT_NODE) {
          range.setStart(after, 0);
        } else {
          range.setStartAfter(child);
        }
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      seen += tokenLen;
    }
  }
  placeCaretInLine(div, false);
}

function placeCaretAtStoredOffset(el: HTMLElement, target: number) {
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const want = Math.max(0, target);
  const lines = lineDivsOf(el);
  if (lines.length > 0) {
    let remaining = want;
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        if (remaining === 0) {
          placeCaretInLine(lines[i]!, true);
          return;
        }
        remaining -= 1;
      }
      const lineLen = serializeEditorLineContent(lines[i]!).length;
      if (remaining <= lineLen) {
        placeCaretInLineAt(lines[i]!, remaining);
        return;
      }
      remaining -= lineLen;
    }
    placeCaretAtEnd(el);
    return;
  }
  let count = 0;

  const setCaret = (node: Node, offset: number) => {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const walk = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.textContent ?? "";
      let cleanedLen = 0;
      for (let i = 0; i < raw.length; i++) {
        const ch = raw.charCodeAt(i);
        // Skip ZWSP / BOM / ORC (same as serialize)
        if (
          ch === 0x200b ||
          ch === 0x200c ||
          ch === 0x200d ||
          ch === 0xfeff ||
          ch === 0x2060 ||
          ch === 0xfffc
        ) {
          continue;
        }
        if (count + cleanedLen === want) {
          setCaret(node, i);
          return true;
        }
        cleanedLen++;
      }
      if (count + cleanedLen === want) {
        setCaret(node, raw.length);
        return true;
      }
      count += cleanedLen;
      return false;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const he = node as HTMLElement;
    const chipTok = chipTokenOf(he);
    if (chipTok) {
      const tokenLen = chipTok.length;
      if (count + tokenLen >= want) {
        // Land after the chip (and its following pad if any).
        const after = he.nextSibling;
        if (after?.nodeType === Node.TEXT_NODE) {
          setCaret(after, 0);
        } else {
          const range = document.createRange();
          range.setStartAfter(he);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        return true;
      }
      count += tokenLen;
      return false;
    }
    if (he.tagName === "BR") {
      if (count === want) {
        const range = document.createRange();
        range.setStartBefore(he);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return true;
      }
      if (count + 1 === want) {
        // Land at the end of the pad node; IME must not insert at offset 0
        // inside a ZWSP (that splits the next Chinese glyph).
        const after = he.nextSibling;
        if (after?.nodeType === Node.TEXT_NODE) {
          setCaret(after, after.textContent?.length ?? 0);
        } else {
          const range = document.createRange();
          range.setStartAfter(he);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        return true;
      }
      count += 1;
      return false;
    }
    const kids = he.childNodes;
    for (let i = 0; i < kids.length; i++) {
      if (walk(kids[i]!)) return true;
    }
    return false;
  };

  if (!walk(el)) placeCaretAtEnd(el);
}

/** True when the caret is collapsed at (or past) the visual end of the editor. */
function isCaretAtEditorEnd(el: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.endContainer)) return false;
  const after = document.createRange();
  after.selectNodeContents(el);
  after.setStart(range.endContainer, range.endOffset);
  const frag = after.cloneContents();
  const tmp = document.createElement("div");
  tmp.appendChild(frag);
  const rest = stripEditorGhostChars(tmp.innerText || tmp.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\n\r]+/g, "");
  return rest.length === 0;
}

/** True when the caret is collapsed at the visual start of the editor. */
function isCaretAtEditorStart(el: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return false;
  const before = document.createRange();
  before.selectNodeContents(el);
  before.setEnd(range.startContainer, range.startOffset);
  const frag = before.cloneContents();
  const tmp = document.createElement("div");
  tmp.appendChild(frag);
  const head = stripEditorGhostChars(tmp.innerText || tmp.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\n\r]+/g, "");
  return head.length === 0;
}

const COMPOSER_LINE_PX = 22;
const COMPOSER_MAX_LINES = 10;

/**
 * Resolve a screen rect for the current caret.
 * Collapsed carets on a bare `<br>` / empty block often report an empty
 * Range rect — fall back to nearby nodes so scroll math still works.
 */
export function getComposerCaretRect(el: HTMLElement): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return null;

  const rects = range.getClientRects();
  if (rects.length > 0) {
    return rects[rects.length - 1]!;
  }
  const br = range.getBoundingClientRect();
  if (br.height > 0 || br.width > 0) return br;

  const node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) {
    return node.parentElement?.getBoundingClientRect() ?? null;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    const parent = node as Element;
    const child =
      parent.childNodes[range.startOffset] ??
      parent.childNodes[range.startOffset - 1] ??
      null;
    if (child) {
      if (child.nodeType === Node.TEXT_NODE) {
        return child.parentElement?.getBoundingClientRect() ?? null;
      }
      if (child.nodeType === Node.ELEMENT_NODE) {
        return (child as Element).getBoundingClientRect();
      }
    }
    return parent.getBoundingClientRect();
  }
  return null;
}

/**
 * How much to add to `scrollTop` so `caret` stays inside `box` (viewport).
 * Positive = scroll down; negative = scroll up; 0 = already visible.
 */
export function composerCaretScrollDelta(
  caret: { top: number; bottom: number },
  box: { top: number; bottom: number },
  margin = 4,
): number {
  if (caret.bottom > box.bottom - margin) {
    return caret.bottom - box.bottom + margin;
  }
  if (caret.top < box.top + margin) {
    return -(box.top - caret.top + margin);
  }
  return 0;
}

/** True when the collapsed selection is at the end of `el`. */
function isCollapsedCaretAtEnd(el: HTMLElement): boolean {
  try {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
    const caret = sel.getRangeAt(0);
    if (!el.contains(caret.endContainer)) return false;
    const end = document.createRange();
    end.selectNodeContents(el);
    end.collapse(false);
    return caret.compareBoundaryPoints(Range.START_TO_END, end) >= 0;
  } catch {
    return false;
  }
}

/**
 * Re-apply the current selection so WebKit/Chromium redraws the caret layer.
 * Rapid scrollTop changes during key-repeat otherwise leave ghost carets.
 */
export function repaintComposerCaret(el: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  if (!el.contains(sel.anchorNode)) return;
  try {
    const range = sel.getRangeAt(0).cloneRange();
    sel.removeAllRanges();
    // Force a layout pass so the old caret paint is discarded.
    void el.offsetHeight;
    sel.addRange(range);
  } catch {
    /* ignore */
  }
}

/**
 * Keep the contenteditable caret inside the editor scrollport.
 * Browsers do not reliably scroll after `insertLineBreak` + height clamp.
 *
 * Prefer an atomic `scrollTop = max` pin when the caret is at the end —
 * incremental `scrollTop += delta` during Shift+Enter key-repeat leaves
 * sticky ghost carets in WebKit (Tauri WebView).
 */
export function scrollComposerCaretIntoView(el: HTMLElement): void {
  if (el.scrollHeight <= el.clientHeight + 1) return;
  const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);

  if (isCollapsedCaretAtEnd(el)) {
    if (el.scrollTop !== maxScroll) el.scrollTop = maxScroll;
    return;
  }

  const rect = getComposerCaretRect(el);
  if (!rect) {
    // Unknown caret geometry — pin bottom as a safe default for newlines.
    el.scrollTop = maxScroll;
    return;
  }

  const box = el.getBoundingClientRect();
  const delta = composerCaretScrollDelta(rect, box);
  if (delta === 0) return;
  el.scrollTop = Math.max(0, Math.min(maxScroll, el.scrollTop + delta));
}

/**
 * Auto-grow the composer input up to max lines.
 *
 * Prefer measuring via `scrollHeight` while constrained (grow / maxed paths)
 * so we never set `height:auto` during Shift+Enter key-repeat — that expand
 * → clamp cycle wipes scrollTop, reflows the chat shell, and leaves ghost carets.
 * `height:auto` is only used when we may need to shrink.
 */
export function resizeComposerInput(el: HTMLElement): void {
  const min = COMPOSER_LINE_PX;
  const max = COMPOSER_LINE_PX * COMPOSER_MAX_LINES;
  const prevScrollTop = el.scrollTop;
  const clientH = el.clientHeight;
  const scrollH = el.scrollHeight;

  // Grow while under max: constrained scrollHeight already reflects content.
  if (scrollH > clientH + 1 && clientH < max - 1) {
    const nextH = Math.min(Math.max(scrollH, min), max);
    el.style.height = `${nextH}px`;
    if (scrollH > nextH) scrollComposerCaretIntoView(el);
    return;
  }

  // Already maxed and still overflowing — pin caret only.
  if (clientH >= max - 1 && scrollH > clientH + 1) {
    el.style.height = `${max}px`;
    scrollComposerCaretIntoView(el);
    return;
  }

  // Shrink / initial measure (content may be shorter than the fixed box).
  el.style.height = "auto";
  const contentH = el.scrollHeight;
  const nextH = Math.min(Math.max(contentH, min), max);
  el.style.height = `${nextH}px`;

  if (contentH > nextH) {
    // height:auto cleared scrollTop — restore then pin caret.
    el.scrollTop = prevScrollTop;
    scrollComposerCaretIntoView(el);
  }
}

/**
 * Paste as plain text only — strip HTML / rich styles from clipboard.
 * Uses insertText when available (keeps undo); falls back to Range insert.
 */
function insertPlainTextAtSelection(text: string) {
  if (!text) return;
  const plain = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  try {
    if (document.queryCommandSupported?.("insertText")) {
      const ok = document.execCommand("insertText", false, plain);
      if (ok) return;
    }
  } catch {
    /* fall through */
  }

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();

  const frag = document.createDocumentFragment();
  const parts = plain.split("\n");
  parts.forEach((part, i) => {
    if (part) frag.appendChild(document.createTextNode(part));
    if (i < parts.length - 1) frag.appendChild(document.createElement("br"));
  });
  const last = frag.lastChild;
  range.insertNode(frag);
  if (last) {
    range.setStartAfter(last);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

export type ComposerEditorProps = {
  value: string;
  onChange: (stored: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Accessible name for the contenteditable (screen readers). */
  "aria-label"?: string;
  className?: string;
  /** Browser spellcheck on the contenteditable root. Default false. */
  spellCheck?: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  onContextMenu?: (e: MouseEvent<HTMLDivElement>) => void;
  onSlashQueryChange?: (
    q: { start: number; query: string; end: number } | null,
  ) => void;
  editorRef?: Ref<HTMLDivElement | null>;
  onPasteFiles?: (files: File[]) => void;
  /**
   * When the paste event looks like media but has no File objects (and async
   * Clipboard API also fails), parent should try native OS clipboard.
   * `expectMedia: true` → show a failure toast if nothing was attached.
   */
  onPasteMediaFallback?: (opts?: {
    expectMedia?: boolean;
  }) => void | Promise<void>;
};

/**
 * After an external draft mutation (skill chip insert, history, …) place the
 * caret at this stored offset on the next value projection. `'end'` = after
 * all content. Cleared once consumed.
 */
let pendingStoredCaret: number | "end" | null = null;

/** Request caret placement after the next `value`-driven re-render. */
export function requestComposerStoredCaret(at: number | "end") {
  pendingStoredCaret = at;
}

function takePendingStoredCaret(): number | "end" | null {
  const p = pendingStoredCaret;
  pendingStoredCaret = null;
  return p;
}

export const ComposerEditor = memo(function ComposerEditor({
  value,
  onChange,
  disabled,
  placeholder,
  "aria-label": ariaLabel,
  className,
  spellCheck,
  onKeyDown,
  onContextMenu,
  onSlashQueryChange,
  editorRef,
  onPasteFiles,
  onPasteMediaFallback,
}: ComposerEditorProps) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const lastValue = useRef(value);
  const composing = useRef(false);
  const focused = useRef(false);
  /** Guard against double paste events (some WebViews fire paste twice). */
  const pasteInFlight = useRef(false);
  /** Coalesced rAF for post-newline caret pin (key-repeat must not stack). */
  const newlinePaintRaf = useRef(0);
  /**
   * DOM may show typed / IME glyphs before React `value` commits.
   * Track live emptiness so the overlay placeholder never paints over ink.
   */
  const [domEmpty, setDomEmpty] = useState(() => !value.trim());

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      elRef.current = node;
      if (typeof editorRef === "function") editorRef(node);
      else if (editorRef && "current" in editorRef) {
        (editorRef as { current: HTMLDivElement | null }).current = node;
      }
    },
    [editorRef],
  );

  const resize = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    resizeComposerInput(el);
  }, []);

  /**
   * One layout pass per frame after newlines.
   * Do NOT repaint the caret here during key-repeat — removeAllRanges every
   * frame leaves sticky residue. Repaint only when Enter is released.
   */
  const scheduleNewlinePaint = useCallback((el: HTMLElement) => {
    if (newlinePaintRaf.current) cancelAnimationFrame(newlinePaintRaf.current);
    newlinePaintRaf.current = requestAnimationFrame(() => {
      newlinePaintRaf.current = 0;
      if (elRef.current !== el) return;
      resizeComposerInput(el);
      scrollComposerCaretIntoView(el);
    });
  }, []);

  const emitSlash = useCallback(() => {
    const el = elRef.current;
    if (!el || !onSlashQueryChange) return;
    const beforeCaret = getTextBeforeCaret(el);
    // Mid-document `/query` (after space/newline): detect on caret prefix only.
    // Do not fall back to full-document end when caret is known — that would
    // open the panel for a trailing `/` while the user edits elsewhere.
    let q =
      beforeCaret != null
        ? detectSlashRangeOnStored(beforeCaret)
        : detectSlashRangeOnStored(serializeDom(el)) ??
          detectSlashRangeOnStored(lastValue.current);
    if (!q) {
      // During composition the DOM may briefly not contain `/…`; keep prior.
      if (composing.current) return;
      onSlashQueryChange(null);
      return;
    }
    onSlashQueryChange({ start: q.start, query: q.query, end: q.end });
  }, [onSlashQueryChange]);

  const syncDomEmpty = useCallback((el: HTMLElement) => {
    const stored = serializeDom(el);
    const empty =
      !stored.trim() ||
      (parseStoredContent(stored).every(
        (s) => s.type === "text" && !s.text.trim(),
      ) &&
        !stored.includes("[[skill:") &&
        !stored.includes("[[plugin:"));
    setDomEmpty(empty);
  }, []);

  const commitFromDom = useCallback(
    (el: HTMLElement) => {
      let stored = serializeComposerDraft(el);
      if (
        /\[\[(?:skill|plugin):[a-zA-Z0-9_.:-]+\]\]/.test(stored) &&
        !el.querySelector("[data-skill], [data-plugin]")
      ) {
        renderSegmentsInto(el, parseStoredContent(stored));
        stored = serializeDom(el);
        placeCaretAtEnd(el);
      }
      syncDomEmpty(el);
      if (stored !== lastValue.current) {
        lastValue.current = stored;
        onChange(stored);
      }
      emitSlash();
      resize();
    },
    [onChange, emitSlash, resize, syncDomEmpty],
  );

  // Drop pending newline paint rAF on unmount.
  useEffect(() => {
    return () => {
      if (newlinePaintRaf.current) cancelAnimationFrame(newlinePaintRaf.current);
    };
  }, []);

  // Mac WKWebView often drops `ctrlKey` on Control+Return; remember Control itself.
  useEffect(() => installComposerControlHeldTracking(), []);

  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    if (composing.current) return;
    const current = serializeDom(el);
    if (current === value && el.childNodes.length > 0) {
      lastValue.current = value;
      // Still honor a pending caret (e.g. skill insert when serialize matched).
      const pendingSame = takePendingStoredCaret();
      if (pendingSame != null) {
        if (pendingSame === "end") placeCaretAtEnd(el);
        else placeCaretAtStoredOffset(el, pendingSame);
        scrollComposerCaretIntoView(el);
        emitSlash();
      }
      resize();
      return;
    }
    if (focused.current && value === lastValue.current) {
      resize();
      return;
    }
    // External or Enter/skill value change: re-project DOM from stored draft.
    // Always pin caret — clicking the slash panel blurs the editor, and the old
    // unfocused path left selection at offset 0 ("cursor jumps to top"), which
    // also broke slash detection (token must be at end of stored text).
    renderSegmentsInto(el, parseStoredContent(value));
    lastValue.current = value;
    const pending = takePendingStoredCaret();
    if (pending === "end" || pending == null) placeCaretAtEnd(el);
    else placeCaretAtStoredOffset(el, pending);
    scrollComposerCaretIntoView(el);
    resize();
    emitSlash();
  }, [value, resize, emitSlash]);

  const onInput = (e: FormEvent<HTMLDivElement>) => {
    // Hide placeholder as soon as the DOM has glyphs (incl. IME preedit).
    syncDomEmpty(e.currentTarget);
    if (composing.current) {
      // Live pinyin in DOM — update slash filter without committing draft yet.
      emitSlash();
      resize();
      return;
    }
    commitFromDom(e.currentTarget);
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (pasteInFlight.current) return;

    // Prefer nativeEvent — React's synthetic clipboardData is empty on some WebViews.
    const cd =
      e.clipboardData ??
      (e.nativeEvent as globalThis.ClipboardEvent | undefined)?.clipboardData ??
      null;

    const files = collectFilesFromDataTransfer(cd);
    const plain = clipboardPlainText(cd);

    if ((files.length || clipboardLooksLikeOsFiles(cd)) && onPasteFiles) {
      // Explorer/Finder copy: File blobs are often unreadable (NotReadableError
      // on .dmp). Parent should prefer native clipboard paths over arrayBuffer.
      onPasteFiles(files);
    } else if (onPasteFiles && clipboardLooksLikeMedia(cd)) {
      // Screenshot paste: event often has image/* types but no File objects.
      pasteInFlight.current = true;
      void (async () => {
        try {
          const asyncFiles = await readClipboardMediaFiles();
          if (asyncFiles.length) {
            onPasteFiles(asyncFiles);
            return;
          }
          await onPasteMediaFallback?.({ expectMedia: true });
        } finally {
          pasteInFlight.current = false;
        }
      })();
    } else if (!files.length && onPasteMediaFallback) {
      // Empty-looking paste on Mac can still be a pure bitmap clipboard.
      // Only run native fallback when no text is about to be inserted.
      if (!plain.trim()) {
        pasteInFlight.current = true;
        void (async () => {
          try {
            const asyncFiles = await readClipboardMediaFiles();
            if (asyncFiles.length) {
              onPasteFiles?.(asyncFiles);
              return;
            }
            // Soft try — no error toast if clipboard has no image.
            await onPasteMediaFallback({ expectMedia: false });
          } finally {
            pasteInFlight.current = false;
          }
        })();
      }
    }

    if (!plain) return;
    if (files.length && isFileUrlOnlyText(plain)) return;
    // Windows: a huge clipboard insert freezes the contenteditable + draft
    // store. Attach as .txt instead — same path as image/file paste.
    if (
      onPasteFiles &&
      shouldSpillHugePlainText(plain.length, detectAppPlatform())
    ) {
      onPasteFiles([
        hugePlainTextToFile(plain, hugePlainTextFileName(plain)),
      ]);
      return;
    }
    insertPlainTextAtSelection(plain);
    const el = elRef.current;
    if (el) commitFromDom(el);
  };

  const flushAfterIme = useCallback(
    (el: HTMLElement) => {
      composing.current = false;
      stripCaretPadsInEditor(el);
      commitFromDom(el);
      requestAnimationFrame(() => {
        commitFromDom(el);
        requestAnimationFrame(() => commitFromDom(el));
      });
      window.setTimeout(() => commitFromDom(el), 0);
      window.setTimeout(() => commitFromDom(el), 50);
    },
    [commitFromDom],
  );

  /**
   * Live sync while focused: contenteditable + IME can change the DOM without a
   * clean input event. MutationObserver keeps draft + slash filter aligned with
   * what the user actually sees (including after 汉字 selection).
   */
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    let raf = 0;
    const sync = () => {
      if (!elRef.current) return;
      if (composing.current) {
        emitSlash();
        return;
      }
      const live = serializeDom(el);
      if (live !== lastValue.current) {
        commitFromDom(el);
      } else {
        emitSlash();
      }
    };
    const schedule = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(sync);
    };

    const mo = new MutationObserver(schedule);
    mo.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [commitFromDom, emitSlash, value]);

  const valueEmpty =
    !value.trim() ||
    (parseStoredContent(value).every(
      (s) => s.type === "text" && !s.text.trim(),
    ) &&
      !value.includes("[[skill:") &&
      !value.includes("[[plugin:"));
  // Both prop and live DOM must be empty — otherwise placeholder covers ink.
  const isEmpty = valueEmpty && domEmpty;

  // External value clear (send / clear) must restore placeholder.
  useEffect(() => {
    if (valueEmpty) {
      const el = elRef.current;
      if (el) syncDomEmpty(el);
      else setDomEmpty(true);
    } else {
      setDomEmpty(false);
    }
  }, [valueEmpty, value, syncDomEmpty]);

  return (
    <div className="composer-editor-wrap">
      {isEmpty && placeholder ? (
        <div className="composer-editor__placeholder" aria-hidden>
          {placeholder}
        </div>
      ) : null}
      <div
        ref={setRefs}
        className={className ?? "composer__input"}
        contentEditable={!disabled}
        spellCheck={spellCheck ?? false}
        role="textbox"
        aria-multiline
        aria-label={ariaLabel}
        aria-placeholder={placeholder}
        data-placeholder={placeholder}
        suppressContentEditableWarning
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
        }}
        onInput={onInput}
        onPaste={onPaste}
        onKeyUp={(e) => {
          if (!composing.current) emitSlash();
          // After Enter: only repaint caret / scroll. Do NOT re-serialize from
          // DOM — Enter already wrote "\n" into the draft SoT. A lossy serialize
          // here was re-deleting blank lines on keyup.
          if (e.key === "Enter" && !e.altKey && !e.metaKey && !e.ctrlKey) {
            const node = elRef.current;
            if (node) {
              scrollComposerCaretIntoView(node);
              repaintComposerCaret(node);
            }
          }
        }}
        onClick={() => emitSlash()}
        onCompositionStart={() => {
          composing.current = true;
          const node = elRef.current;
          if (node) stripCaretPadsInEditor(node);
        }}
        onCompositionUpdate={() => {
          emitSlash();
        }}
        onCompositionEnd={(e: CompositionEvent<HTMLDivElement>) => {
          flushAfterIme(e.currentTarget);
        }}
        onContextMenu={onContextMenu}
        onKeyDown={(e) => {
          const el = elRef.current;
          const ne = e.nativeEvent;
          const steerChord = shouldSteerOnKeydown(e);
          // IME must not swallow Control+Return (stuck composing.current / 229).
          if (
            !steerChord &&
            (ne.isComposing || ne.keyCode === 229 || composing.current)
          ) {
            return;
          }
          // WebKit: ArrowRight past the last glyph can inject U+FFFC (□) /
          // ZWSP ghosts that serialize as real characters and show as boxes.
          if (
            el &&
            e.key === "ArrowRight" &&
            !e.shiftKey &&
            !e.altKey &&
            !e.metaKey &&
            !e.ctrlKey &&
            isCaretAtEditorEnd(el)
          ) {
            e.preventDefault();
            return;
          }
          if (
            el &&
            e.key === "ArrowLeft" &&
            !e.shiftKey &&
            !e.altKey &&
            !e.metaKey &&
            !e.ctrlKey &&
            isCaretAtEditorStart(el)
          ) {
            e.preventDefault();
            return;
          }
          // Parent handles send / steer / menus (may preventDefault).
          onKeyDown?.(e);
          // Always eat Control+Return so WKWebView cannot insert a newline
          // when the parent did not steer (idle, or chord mis-detected).
          if (steerChord) {
            e.preventDefault();
            return;
          }
          if (e.defaultPrevented) return;

          // Skill chips are contentEditable=false — native Backspace/Delete often
          // no-ops or traps the caret. Remove the adjacent chip explicitly.
          if (
            el &&
            (e.key === "Backspace" || e.key === "Delete") &&
            !e.altKey &&
            !e.metaKey &&
            !e.ctrlKey
          ) {
            const chip =
              e.key === "Backspace"
                ? skillChipBeforeCaret(el)
                : skillChipAfterCaret(el);
            if (chip) {
              e.preventDefault();
              const stored = removeSkillChipEl(el, chip);
              lastValue.current = stored;
              onChange(stored);
              syncDomEmpty(el);
              emitSlash();
              resize();
              return;
            }
          }

          // Newline path (Shift+Enter, or plain Enter when send-key is mod-enter).
          // Split the live line in place. Never rebuild from lastValue — that
          // snapshot can lag IME/input and the rewrite deleted typed text.
          if (e.key === "Enter" && !e.altKey && !e.metaKey && !e.ctrlKey) {
            try {
              e.preventDefault();
              if (!el) return;
              const split = insertComposerLineBreakInPlace(el);
              if (!split) {
                const live = serializeComposerDraft(el);
                const caret = getComposerCaretIndex(el, live);
                const next = composerEnterNextStored(live, caret);
                lastValue.current = next;
                onChange(next);
                renderSegmentsInto(el, parseStoredContent(next));
                placeCaretAtStoredOffset(el, caret + 1);
              } else {
                const stored = serializeComposerDraft(el);
                lastValue.current = stored;
                onChange(stored);
              }
              syncDomEmpty(el);
              emitSlash();
              resizeComposerInput(el);
              scheduleNewlinePaint(el);
            } catch {
              /* browser default */
            }
          }
        }}
      />
    </div>
  );
});

export function focusComposerEnd(el: HTMLDivElement | null) {
  placeCaretAtEnd(el!);
}

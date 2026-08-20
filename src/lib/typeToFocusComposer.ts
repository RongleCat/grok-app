/**
 * Type-to-focus composer: when the chat is frontmost but focus is not in
 * an input, a printable key focuses the composer so the character lands
 * there. Letters are focus-only (native types once). Space inserts after
 * preventDefault so the page does not scroll.
 *
 * Decision is pure (no DOM). The hook applies focus / insert.
 */

import { isTypingTarget } from "@/lib/a11yFocus";

/** Surfaces that must keep their own keyboard (terminal, code, rich text). */
export const TYPE_TO_FOCUS_PROTECTED_SEL = [
  ".xterm",
  ".xterm-helper-textarea",
  ".sw-terminal",
  ".bt",
  ".cm-editor",
  ".cm-content",
  ".ProseMirror",
  "[data-testid='side-terminal-xterm']",
  "[data-testid='bottom-terminal']",
].join(", ");

export type TypeToFocusKey = {
  key: string;
  /** Legacy IME signal (Windows / some WebKit). */
  keyCode?: number;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing: boolean;
};

export type TypeToFocusContext = {
  /** Chat workbench is showing a typeable composer. */
  enabled: boolean;
  /** Dialog / palette / menu / permission / voice owns the keyboard. */
  overlayOpen: boolean;
  /** Settings is capturing a new shortcut chord. */
  recordingShortcut: boolean;
  /** Target is an input / terminal / editor. */
  blockedSurface: boolean;
  /** Sidebar list has focus and this key is j/k/arrows. */
  sidebarNavOwnsKey: boolean;
  /** Space/Enter would activate the focused button/link. */
  spaceActivatesControl: boolean;
};

export type TypeToFocusDecision =
  | { action: "ignore" }
  | { action: "focus"; preventDefault: boolean }
  | { action: "focus-and-insert"; text: string; preventDefault: boolean };

/** IME / dead-key: focus only, never insert the latin letter ourselves. */
export function isImeOrDeadKey(e: TypeToFocusKey): boolean {
  if (e.isComposing) return true;
  if (e.keyCode === 229) return true;
  const k = e.key;
  return k === "Process" || k === "Unidentified" || k === "Dead";
}

/** Unmodified single Unicode key (letters, digits, punctuation, space). */
export function isPrintableTypeKey(e: TypeToFocusKey): boolean {
  if (e.key.length !== 1) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return true;
}

/** Cmd/Ctrl+V — focus composer so paste can land there. */
export function isPasteFocusKey(e: TypeToFocusKey): boolean {
  if (e.altKey) return false;
  if (!(e.ctrlKey || e.metaKey)) return false;
  return e.key.toLowerCase() === "v";
}

/** Sidebar session nav (same keys as AppWorkbench j/k handler). */
export function isSidebarSessionNavKey(key: string): boolean {
  const k = key.length === 1 ? key.toLowerCase() : key.toLowerCase();
  return k === "j" || k === "k" || k === "arrowdown" || k === "arrowup";
}

/** Space/Enter should fire the focused control, not type into the composer. */
export function isActivateKeyControl(
  el: EventTarget | null | undefined,
): boolean {
  if (!el || typeof (el as HTMLElement).tagName !== "string") return false;
  const node = el as HTMLElement;
  const tag = node.tagName.toLowerCase();
  if (tag === "button" || tag === "a" || tag === "summary") return true;
  const role =
    typeof node.getAttribute === "function" ? node.getAttribute("role") : null;
  return (
    role === "button" ||
    role === "menuitem" ||
    role === "tab" ||
    role === "switch" ||
    role === "checkbox" ||
    role === "radio" ||
    role === "option" ||
    role === "link"
  );
}

/**
 * True when typing must stay on the current surface (inputs, xterm, CM).
 * Composer itself is a contenteditable — this is also true when it is focused.
 */
export function isComposerRedirectBlocked(
  el: EventTarget | null | undefined,
): boolean {
  if (isTypingTarget(el)) return true;
  if (!el || typeof (el as HTMLElement).closest !== "function") return false;
  try {
    return !!(el as HTMLElement).closest(TYPE_TO_FOCUS_PROTECTED_SEL);
  } catch {
    return false;
  }
}

/** Composer already has the caret — never steal or re-insert. */
export function composerOwnsFocus(
  editor: EventTarget | null | undefined,
  active: EventTarget | null | undefined,
): boolean {
  if (!editor || !active) return false;
  if (editor === active) return true;
  const node = editor as HTMLElement;
  return typeof node.contains === "function" && node.contains(active as Node);
}

export function decideTypeToFocusComposer(
  e: TypeToFocusKey,
  ctx: TypeToFocusContext,
): TypeToFocusDecision {
  if (!ctx.enabled) return { action: "ignore" };
  if (ctx.overlayOpen) return { action: "ignore" };
  if (ctx.recordingShortcut) return { action: "ignore" };
  if (ctx.blockedSurface) return { action: "ignore" };
  if (ctx.sidebarNavOwnsKey) return { action: "ignore" };

  if (isImeOrDeadKey(e)) {
    return { action: "focus", preventDefault: false };
  }

  if (isPasteFocusKey(e)) {
    return { action: "focus", preventDefault: false };
  }

  if (!isPrintableTypeKey(e)) return { action: "ignore" };

  if (e.key === " " && ctx.spaceActivatesControl) {
    return { action: "ignore" };
  }

  // Letters: focus only. Inserting as well doubles the glyph in Chromium
  // (WebView2) — the same key still types into the newly focused editor.
  // Do not preventDefault: IME needs the key (macOS pinyin first letter).
  if (e.key !== " ") {
    return { action: "focus", preventDefault: false };
  }
  // Space would scroll the page if we let the default through on body.
  return { action: "focus-and-insert", text: " ", preventDefault: true };
}

export function focusComposerForTyping(el: HTMLElement): void {
  el.focus({ preventScroll: true });
  const sel = window.getSelection();
  if (!sel) return;
  if (sel.anchorNode && el.contains(sel.anchorNode)) return;
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    /* ignore */
  }
}

export function insertTextIntoFocusedComposer(
  el: HTMLElement,
  text: string,
): void {
  if (!text) return;
  focusComposerForTyping(el);
  try {
    document.execCommand("insertText", false, text);
  } catch {
    /* contenteditable engines that reject execCommand */
  }
}

export function applyTypeToFocusComposer(
  el: HTMLElement,
  decision: Exclude<TypeToFocusDecision, { action: "ignore" }>,
): void {
  focusComposerForTyping(el);
  if (decision.action === "focus-and-insert") {
    insertTextIntoFocusedComposer(el, decision.text);
  }
}

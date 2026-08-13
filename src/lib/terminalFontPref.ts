/**
 * Side-workbench terminal font family + size (Appearance).
 * localStorage-only — no Rust AppSettings (avoids prefs schema conflicts).
 */

import { expandNerdFontAliases, joinCssFontStack } from "@/lib/cssFontFamily";
import { TERMINAL_FONT_FAMILY, TERMINAL_FONT_STACK } from "@/lib/sideTerminalTheme";

export const TERMINAL_FONT_FAMILY_STORAGE_KEY = "grok.terminalFontFamily";
export const TERMINAL_FONT_SIZE_STORAGE_KEY = "grok.terminalFontSize";

/** Fired on `window` after a same-tab terminal font save (storage is cross-tab only). */
export const TERMINAL_FONT_CHANGED_EVENT = "grok:terminalFont";

/** Empty → built-in Nerd Font stack from sideTerminalTheme. */
export const DEFAULT_TERMINAL_FONT_FAMILY = "";
export const DEFAULT_TERMINAL_FONT_SIZE = 13;
export const MIN_TERMINAL_FONT_SIZE = 10;
export const MAX_TERMINAL_FONT_SIZE = 24;

function emitTerminalFontChanged(): void {
  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new Event(TERMINAL_FONT_CHANGED_EVENT));
    }
  } catch {
    /* ignore */
  }
}

export interface TerminalFontStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function storageOrMemory(): TerminalFontStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  const mem = new Map<string, string>();
  return {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => {
      mem.set(k, v);
    },
    removeItem: (k) => {
      mem.delete(k);
    },
  };
}

export function parseTerminalFontFamily(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_TERMINAL_FONT_FAMILY;
  return raw.trim();
}

export function parseTerminalFontSize(raw: unknown): number {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseInt(raw, 10)
        : NaN;
  if (!Number.isFinite(n)) return DEFAULT_TERMINAL_FONT_SIZE;
  return Math.min(
    MAX_TERMINAL_FONT_SIZE,
    Math.max(MIN_TERMINAL_FONT_SIZE, Math.round(n)),
  );
}

export function loadTerminalFontFamily(
  storage: TerminalFontStorage = storageOrMemory(),
): string {
  try {
    return parseTerminalFontFamily(
      storage.getItem(TERMINAL_FONT_FAMILY_STORAGE_KEY),
    );
  } catch {
    return DEFAULT_TERMINAL_FONT_FAMILY;
  }
}

export function saveTerminalFontFamily(
  family: string,
  storage: TerminalFontStorage = storageOrMemory(),
): void {
  try {
    const v = parseTerminalFontFamily(family);
    if (!v) {
      storage.removeItem?.(TERMINAL_FONT_FAMILY_STORAGE_KEY);
      if (!storage.removeItem) storage.setItem(TERMINAL_FONT_FAMILY_STORAGE_KEY, "");
    } else {
      storage.setItem(TERMINAL_FONT_FAMILY_STORAGE_KEY, v);
    }
  } catch {
    /* private mode / quota */
  }
  emitTerminalFontChanged();
}

export function loadTerminalFontSize(
  storage: TerminalFontStorage = storageOrMemory(),
): number {
  try {
    return parseTerminalFontSize(storage.getItem(TERMINAL_FONT_SIZE_STORAGE_KEY));
  } catch {
    return DEFAULT_TERMINAL_FONT_SIZE;
  }
}

export function saveTerminalFontSize(
  size: number,
  storage: TerminalFontStorage = storageOrMemory(),
): void {
  try {
    storage.setItem(
      TERMINAL_FONT_SIZE_STORAGE_KEY,
      String(parseTerminalFontSize(size)),
    );
  } catch {
    /* private mode / quota */
  }
  emitTerminalFontChanged();
}

/**
 * CSS/xterm font-family string. Custom family is listed first (plus known
 * Nerd Font aliases — Mono faces first), then the built-in stack so
 * Powerline glyphs still resolve when the typed name is a shorthand.
 */
export function resolveTerminalFontFamily(custom: string | null | undefined): string {
  const c = (custom ?? "").trim();
  if (!c) return TERMINAL_FONT_FAMILY;
  return joinCssFontStack([...expandNerdFontAliases(c), ...TERMINAL_FONT_STACK]);
}

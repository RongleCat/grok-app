/**
 * Embedded terminal font (Appearance → Interface).
 * localStorage-only — no Rust AppSettings.
 * Empty family = default Nerd-first stack from sideTerminalTheme.
 */

import { TERMINAL_FONT_FAMILY } from "./sideTerminalTheme";
import { sanitizeFontFamily } from "./uiFontPref";

export const TERMINAL_FONT_FAMILY_STORAGE_KEY = "grok.terminalFontFamily";
export const TERMINAL_FONT_SIZE_STORAGE_KEY = "grok.terminalFontSize";
export const TERMINAL_FONT_CHANGE_EVENT = "grok-terminal-font";

export const DEFAULT_TERMINAL_FONT_SIZE = 13;
export const TERMINAL_FONT_SIZES = [11, 12, 13, 14, 15, 16, 18] as const;
export type TerminalFontSize = (typeof TERMINAL_FONT_SIZES)[number];

/** Curated mono / Nerd Font presets. Empty id = default stack. */
export const TERMINAL_FONT_PRESETS: readonly { id: string; label: string }[] = [
  { id: "", label: "Default (Nerd stack)" },
  { id: "MesloLGS NF", label: "MesloLGS NF" },
  { id: "MesloLGM Nerd Font", label: "MesloLGM Nerd Font" },
  { id: "JetBrainsMono Nerd Font", label: "JetBrainsMono Nerd Font" },
  { id: "Hack Nerd Font", label: "Hack Nerd Font" },
  { id: "FiraCode Nerd Font", label: "FiraCode Nerd Font" },
  { id: "CaskaydiaCove Nerd Font", label: "CaskaydiaCove Nerd Font" },
  { id: "SauceCodePro Nerd Font", label: "SauceCodePro Nerd Font" },
  { id: "SF Mono", label: "SF Mono" },
  { id: "Menlo", label: "Menlo" },
  { id: "Monaco", label: "Monaco" },
  { id: "Cascadia Code", label: "Cascadia Code" },
  { id: "Consolas", label: "Consolas" },
] as const;

export const TERMINAL_FONT_CUSTOM_VALUE = "__custom__";

/** Sample for preview (folder / git / powerline-ish private-use glyphs). */
export const TERMINAL_FONT_PREVIEW_SAMPLE =
  "\uE5FE  project  \uE0A0 main  \uE0B0  12:00";

export interface TerminalFontStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type TerminalFontPrefs = {
  family: string;
  size: number;
};

export function parseTerminalFontFamily(raw: unknown): string {
  return sanitizeFontFamily(raw);
}

export function isTerminalFontSize(value: unknown): value is TerminalFontSize {
  return (
    typeof value === "number" &&
    (TERMINAL_FONT_SIZES as readonly number[]).includes(value)
  );
}

export function parseTerminalFontSize(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return clampTerminalFontSize(raw);
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return clampTerminalFontSize(n);
  }
  return DEFAULT_TERMINAL_FONT_SIZE;
}

export function clampTerminalFontSize(n: number): number {
  const rounded = Math.round(n);
  if (!Number.isFinite(rounded)) return DEFAULT_TERMINAL_FONT_SIZE;
  return Math.min(24, Math.max(10, rounded));
}

export function loadTerminalFontFamily(
  storage: TerminalFontStorage = typeof localStorage !== "undefined"
    ? localStorage
    : { getItem: () => null, setItem: () => {} },
): string {
  try {
    return parseTerminalFontFamily(
      storage.getItem(TERMINAL_FONT_FAMILY_STORAGE_KEY),
    );
  } catch {
    return "";
  }
}

export function saveTerminalFontFamily(
  family: string,
  storage: TerminalFontStorage = typeof localStorage !== "undefined"
    ? localStorage
    : { getItem: () => null, setItem: () => {} },
): void {
  try {
    storage.setItem(
      TERMINAL_FONT_FAMILY_STORAGE_KEY,
      sanitizeFontFamily(family),
    );
  } catch {
    /* private mode / quota */
  }
}

export function loadTerminalFontSize(
  storage: TerminalFontStorage = typeof localStorage !== "undefined"
    ? localStorage
    : { getItem: () => null, setItem: () => {} },
): number {
  try {
    return parseTerminalFontSize(
      storage.getItem(TERMINAL_FONT_SIZE_STORAGE_KEY),
    );
  } catch {
    return DEFAULT_TERMINAL_FONT_SIZE;
  }
}

export function saveTerminalFontSize(
  size: number,
  storage: TerminalFontStorage = typeof localStorage !== "undefined"
    ? localStorage
    : { getItem: () => null, setItem: () => {} },
): void {
  try {
    storage.setItem(
      TERMINAL_FONT_SIZE_STORAGE_KEY,
      String(clampTerminalFontSize(size)),
    );
  } catch {
    /* private mode / quota */
  }
}

export function loadTerminalFontPrefs(
  storage?: TerminalFontStorage,
): TerminalFontPrefs {
  return {
    family: loadTerminalFontFamily(storage),
    size: loadTerminalFontSize(storage),
  };
}

/**
 * CSS / xterm fontFamily string.
 * Empty → full default Nerd-first stack; else preferred family + stack.
 */
export function resolveTerminalFontFamily(family: string): string {
  const name = sanitizeFontFamily(family);
  if (!name) return TERMINAL_FONT_FAMILY;
  return `"${name}", ${TERMINAL_FONT_FAMILY}`;
}

export function terminalFontSelectValue(family: string): string {
  const name = sanitizeFontFamily(family);
  if (!name) return "";
  if (TERMINAL_FONT_PRESETS.some((p) => p.id === name)) return name;
  return TERMINAL_FONT_CUSTOM_VALUE;
}

export function dispatchTerminalFontChange(prefs: TerminalFontPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent(TERMINAL_FONT_CHANGE_EVENT, {
        detail: {
          family: sanitizeFontFamily(prefs.family),
          size: clampTerminalFontSize(prefs.size),
        } satisfies TerminalFontPrefs,
      }),
    );
  } catch {
    /* ignore */
  }
}

/** Persist family + size and notify terminal listeners. */
export function setTerminalFontPrefs(
  prefs: TerminalFontPrefs,
  storage?: TerminalFontStorage,
): TerminalFontPrefs {
  const next: TerminalFontPrefs = {
    family: sanitizeFontFamily(prefs.family),
    size: clampTerminalFontSize(prefs.size),
  };
  saveTerminalFontFamily(next.family, storage);
  saveTerminalFontSize(next.size, storage);
  dispatchTerminalFontChange(next);
  return next;
}

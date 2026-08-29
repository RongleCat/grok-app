/**
 * Custom appearance chrome (text color + font shadow).
 * localStorage-only — same pattern as UI font.
 *
 * Text color overrides only exposed chrome (sidebar, title bar, welcome
 * mark, connection banners, aside tab chrome) via `--appearance-chrome-ink`.
 * It must NOT replace global `--text-primary`, or solid panels / settings /
 * menus go unreadable.
 */

export const TEXT_COLOR_STORAGE_KEY = "grok-app.text-color";
export const FONT_SHADOW_STORAGE_KEY = "grok-app.font-shadow";

/** `null` = follow theme (near-black on light, near-white on dark). */
export const DEFAULT_TEXT_COLOR: string | null = null;
export const DEFAULT_FONT_SHADOW = false;

/** Swatches shown in the picker while following theme. Not persisted. */
export const THEME_DEFAULT_TEXT_COLOR = {
  dark: "#ebebeb",
  light: "#1c1c1c",
} as const;

export interface AppearanceChromeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface AppearanceChromeRoot {
  style: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): void;
  };
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

const HEX6 = /^#([0-9a-fA-F]{6})$/;
const HEX3 = /^#([0-9a-fA-F]{3})$/;

function storageOrMemory(): AppearanceChromeStorage {
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

function defaultRoot(): AppearanceChromeRoot | null {
  return typeof document !== "undefined" ? document.documentElement : null;
}

/** Normalize `#rgb` / `#rrggbb` to lowercase `#rrggbb`. Anything else → null. */
export function parseTextColor(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower === "default" || lower === "theme") return null;
  const m6 = HEX6.exec(s);
  if (m6) return `#${m6[1]!.toLowerCase()}`;
  const m3 = HEX3.exec(s);
  if (m3) {
    const [r, g, b] = m3[1]!.toLowerCase().split("");
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

export function parseFontShadow(raw: unknown): boolean {
  if (raw === true || raw === 1) return true;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    return s === "1" || s === "true" || s === "on" || s === "yes";
  }
  return false;
}

export function loadTextColor(
  storage: AppearanceChromeStorage = storageOrMemory(),
): string | null {
  try {
    return parseTextColor(storage.getItem(TEXT_COLOR_STORAGE_KEY));
  } catch {
    return DEFAULT_TEXT_COLOR;
  }
}

export function saveTextColor(
  value: string | null,
  storage: AppearanceChromeStorage = storageOrMemory(),
): void {
  try {
    const next = parseTextColor(value);
    if (!next) {
      storage.removeItem?.(TEXT_COLOR_STORAGE_KEY);
      if (!storage.removeItem) storage.setItem(TEXT_COLOR_STORAGE_KEY, "");
      return;
    }
    storage.setItem(TEXT_COLOR_STORAGE_KEY, next);
  } catch {
    /* private mode / quota */
  }
}

export function loadFontShadow(
  storage: AppearanceChromeStorage = storageOrMemory(),
): boolean {
  try {
    return parseFontShadow(storage.getItem(FONT_SHADOW_STORAGE_KEY));
  } catch {
    return DEFAULT_FONT_SHADOW;
  }
}

export function saveFontShadow(
  value: boolean,
  storage: AppearanceChromeStorage = storageOrMemory(),
): void {
  try {
    if (!value) {
      storage.removeItem?.(FONT_SHADOW_STORAGE_KEY);
      if (!storage.removeItem) storage.setItem(FONT_SHADOW_STORAGE_KEY, "0");
      return;
    }
    storage.setItem(FONT_SHADOW_STORAGE_KEY, "1");
  } catch {
    /* private mode / quota */
  }
}

export function applyTextColor(
  value: string | null,
  root: AppearanceChromeRoot | null | undefined = defaultRoot(),
): void {
  if (!root) return;
  const color = parseTextColor(value);
  if (!color) {
    root.style.removeProperty("--appearance-chrome-ink");
    // Legacy cleanup: older builds wrote these on <html>.
    root.style.removeProperty("--text-primary");
    root.style.removeProperty("--text-secondary");
    root.style.removeProperty("--text-tertiary");
    root.style.removeProperty("--wallpaper-chrome-foreground");
    root.removeAttribute("data-text-color");
    return;
  }
  root.style.setProperty("--appearance-chrome-ink", color);
  // Do not override theme --text-primary on <html> — solid surfaces
  // (settings, menus, cards) must keep light/dark defaults.
  root.style.removeProperty("--text-primary");
  root.style.removeProperty("--text-secondary");
  root.style.removeProperty("--text-tertiary");
  root.style.removeProperty("--wallpaper-chrome-foreground");
  root.setAttribute("data-text-color", "custom");
}

export function applyFontShadow(
  value: boolean,
  root: AppearanceChromeRoot | null | undefined = defaultRoot(),
): void {
  if (!root) return;
  if (value) root.setAttribute("data-font-shadow", "1");
  else root.removeAttribute("data-font-shadow");
}

export type AppearanceChrome = {
  textColor: string | null;
  fontShadow: boolean;
};

export function loadAppearanceChrome(
  storage: AppearanceChromeStorage = storageOrMemory(),
): AppearanceChrome {
  return {
    textColor: loadTextColor(storage),
    fontShadow: loadFontShadow(storage),
  };
}

export function applyAppearanceChrome(
  chrome: AppearanceChrome,
  root: AppearanceChromeRoot | null | undefined = defaultRoot(),
): void {
  applyTextColor(chrome.textColor, root);
  applyFontShadow(chrome.fontShadow, root);
}

export function isDefaultAppearanceChrome(chrome: {
  textColor?: string | null;
  fontShadow?: boolean;
}): boolean {
  return !parseTextColor(chrome.textColor) && !chrome.fontShadow;
}

export function resetAppearanceChrome(
  storage: AppearanceChromeStorage = storageOrMemory(),
  root: AppearanceChromeRoot | null | undefined = defaultRoot(),
): AppearanceChrome {
  const next: AppearanceChrome = {
    textColor: DEFAULT_TEXT_COLOR,
    fontShadow: DEFAULT_FONT_SHADOW,
  };
  saveTextColor(next.textColor, storage);
  saveFontShadow(next.fontShadow, storage);
  applyAppearanceChrome(next, root);
  return next;
}

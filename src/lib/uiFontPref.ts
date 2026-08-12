/**
 * App UI font family (Appearance → Interface).
 * localStorage-only — no Rust AppSettings (avoids prefs schema conflicts).
 * Applied by overriding CSS var `--font-sans` on `document.documentElement`.
 * Empty string = design-token default stack (system sans).
 */

export const UI_FONT_STORAGE_KEY = "grok.uiFontFamily";
/** Matches `tokens.css` --font-sans. */
export const DEFAULT_UI_FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
export const UI_FONT_CHANGE_EVENT = "grok-ui-font";

/** Curated sans presets (family CSS name). Empty id = system default. */
export const UI_FONT_PRESETS: readonly { id: string; label: string }[] = [
  { id: "", label: "System default" },
  { id: "Inter", label: "Inter" },
  { id: "SF Pro Text", label: "SF Pro Text" },
  { id: "Segoe UI", label: "Segoe UI" },
  { id: "Helvetica Neue", label: "Helvetica Neue" },
  { id: "Arial", label: "Arial" },
  { id: "PingFang SC", label: "PingFang SC" },
  { id: "Hiragino Sans GB", label: "Hiragino Sans GB" },
  { id: "Microsoft YaHei", label: "Microsoft YaHei" },
  { id: "Noto Sans CJK SC", label: "Noto Sans CJK SC" },
  { id: "Source Han Sans SC", label: "Source Han Sans SC" },
] as const;

export const UI_FONT_CUSTOM_VALUE = "__custom__";

export interface UiFontStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Strip chars that break CSS custom properties / injection. */
export function sanitizeFontFamily(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\0-\x1f\x7f"'`;{}\\<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function parseUiFontFamily(raw: unknown): string {
  return sanitizeFontFamily(raw);
}

export function loadUiFontFamily(
  storage: UiFontStorage = typeof localStorage !== "undefined"
    ? localStorage
    : { getItem: () => null, setItem: () => {} },
): string {
  try {
    return parseUiFontFamily(storage.getItem(UI_FONT_STORAGE_KEY));
  } catch {
    return "";
  }
}

export function saveUiFontFamily(
  family: string,
  storage: UiFontStorage = typeof localStorage !== "undefined"
    ? localStorage
    : { getItem: () => null, setItem: () => {} },
): void {
  try {
    storage.setItem(UI_FONT_STORAGE_KEY, sanitizeFontFamily(family));
  } catch {
    /* private mode / quota */
  }
}

/**
 * Build `font-family` value for --font-sans.
 * Empty family → default token stack (caller may removeProperty instead).
 */
export function resolveUiFontStack(family: string): string {
  const name = sanitizeFontFamily(family);
  if (!name) return DEFAULT_UI_FONT_STACK;
  return `"${name}", ${DEFAULT_UI_FONT_STACK}`;
}

/** Map stored family → Select value (preset id or custom sentinel). */
export function uiFontSelectValue(family: string): string {
  const name = sanitizeFontFamily(family);
  if (!name) return "";
  if (UI_FONT_PRESETS.some((p) => p.id === name)) return name;
  return UI_FONT_CUSTOM_VALUE;
}

export interface UiFontRoot {
  style: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): void;
  };
}

/**
 * Apply UI font via `--font-sans` on the document root.
 * Empty family removes the override so tokens.css default applies.
 */
export function applyUiFont(
  family: string,
  root: UiFontRoot = typeof document !== "undefined"
    ? document.documentElement
    : {
        style: {
          setProperty: () => {},
          removeProperty: () => {},
        },
      },
): void {
  const name = sanitizeFontFamily(family);
  if (!name) {
    root.style.removeProperty("--font-sans");
    return;
  }
  root.style.setProperty("--font-sans", resolveUiFontStack(name));
}

export function dispatchUiFontChange(family: string): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent(UI_FONT_CHANGE_EVENT, {
        detail: sanitizeFontFamily(family),
      }),
    );
  } catch {
    /* ignore */
  }
}

/** Persist + apply (+ event) for Settings onChange. */
export function setUiFontFamily(
  family: string,
  storage?: UiFontStorage,
  root?: UiFontRoot,
): void {
  const next = sanitizeFontFamily(family);
  saveUiFontFamily(next, storage);
  applyUiFont(next, root);
  dispatchUiFontChange(next);
}

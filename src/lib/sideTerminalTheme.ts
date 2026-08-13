import { joinCssFontStack } from "@/lib/cssFontFamily";

/**
 * xterm theme + font for Side Workbench interactive terminal.
 *
 * Veil strategy (critical for “fill to bottom”):
 * - CSS paints a single 50% black/white layer on `.sw-terminal--pty`
 * - xterm canvas background is fully transparent so FitAddon’s fractional-row
 *   gap at the bottom matches the rest of the pane (no empty strip)
 *
 * Do not stack the same veil on ancestors + canvas — that becomes solid black.
 */

/** Minimal theme shape (matches @xterm/xterm ITheme fields we set). */
export type SideTerminalTheme = {
  background?: string;
  foreground?: string;
  cursor?: string;
  cursorAccent?: string;
  selectionBackground?: string;
  selectionInactiveBackground?: string;
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  magenta?: string;
  cyan?: string;
  white?: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightMagenta?: string;
  brightCyan?: string;
  brightWhite?: string;
};

/**
 * Prefer Nerd Font *Mono* faces so Powerline / Starship separators stay
 * single-cell. Names are quoted — unquoted `JetBrainsMono Nerd Font` is
 * parsed as three families and can match non-patched JetBrains Mono.
 */
export const TERMINAL_FONT_STACK = [
  "JetBrainsMono Nerd Font Mono",
  "JetBrainsMono NFM",
  "JetBrainsMono Nerd Font",
  "JetBrainsMono NF",
  "MesloLGS NF",
  "MesloLGM Nerd Font",
  "Hack Nerd Font Mono",
  "Hack Nerd Font",
  "FiraCode Nerd Font Mono",
  "FiraCode Nerd Font",
  "Maple Mono NF CN",
  "SFMono-Regular",
  "Menlo",
  "Monaco",
  "Consolas",
  "Liberation Mono",
  "ui-monospace",
  "monospace",
] as const;

export const TERMINAL_FONT_FAMILY = joinCssFontStack(TERMINAL_FONT_STACK);

/** 50% opacity — used by CSS host (single layer). */
export const TERM_BG_DARK_50 = "#00000080";
export const TERM_BG_LIGHT_50 = "#ffffff80";

/** Fully transparent canvas so cell-grid gaps show the CSS veil evenly. */
export const TERM_BG_CANVAS = "#00000000";

/**
 * Read a CSS color token from the document (falls back if missing).
 */
export function readCssColor(
  name: string,
  fallback: string,
  el?: HTMLElement | null,
): string {
  if (typeof window === "undefined" || typeof getComputedStyle === "undefined") {
    return fallback;
  }
  const target = el ?? document.documentElement;
  const v = getComputedStyle(target).getPropertyValue(name).trim();
  return v || fallback;
}

/** True when app is in light appearance. */
export function isAppLightTheme(_el?: HTMLElement | null): boolean {
  if (typeof document === "undefined") return false;
  const data = document.documentElement.getAttribute("data-theme") || "";
  if (data === "light") return true;
  if (data === "dark") return false;
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: light)").matches;
  }
  return false;
}

/** CSS host veil color (50%). */
export function resolveTerminalSurfaceBg(host?: HTMLElement | null): string {
  return isAppLightTheme(host) ? TERM_BG_LIGHT_50 : TERM_BG_DARK_50;
}

/**
 * Build xterm ITheme — transparent canvas bg; veil lives in CSS.
 */
export function buildSideTerminalTheme(
  host?: HTMLElement | null,
): SideTerminalTheme {
  const light = isAppLightTheme(host);
  const fg = light
    ? readCssColor("--text-primary", "#1a1a1a", host)
    : readCssColor("--text-primary", "#e8e8e8", host);
  const cursor = light
    ? readCssColor("--text-secondary", "#333333", host)
    : readCssColor("--text-secondary", "#c8c8c8", host);
  const selection = light
    ? "rgba(40, 90, 200, 0.22)"
    : "rgba(128, 160, 255, 0.28)";

  return {
    background: TERM_BG_CANVAS,
    foreground: fg,
    cursor,
    cursorAccent: TERM_BG_CANVAS,
    selectionBackground: selection,
    selectionInactiveBackground: light
      ? "rgba(40, 90, 200, 0.12)"
      : "rgba(128, 160, 255, 0.14)",

    black: "#000000",
    red: "#c91b00",
    green: "#00c200",
    yellow: "#c7c400",
    blue: "#0225c7",
    magenta: "#ca30c7",
    cyan: "#00c5c7",
    white: "#c7c7c7",
    brightBlack: light ? "#8a8a8a" : "#686868",
    brightRed: "#ff6e67",
    brightGreen: "#5ffa68",
    brightYellow: "#fffc67",
    brightBlue: "#6871ff",
    brightMagenta: "#ff77ff",
    brightCyan: "#60fdff",
    brightWhite: "#ffffff",
  };
}

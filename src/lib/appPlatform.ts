/**
 * Lightweight OS detection for desktop UI chrome (file manager labels, etc.).
 * Uses userAgent — enough for menu copy; host path_reveal still does real open.
 */

import type { MessageKey } from "@/i18n";

export type AppPlatform = "mac" | "win" | "linux" | "other";

/**
 * Self-drawn min/max/close (no native title bar).
 * Windows + Linux ship frameless; `other` is the same fallback.
 */
export function usesCustomWindowChrome(platform: AppPlatform): boolean {
  return platform === "win" || platform === "linux" || platform === "other";
}

/** Detect mac / Windows / Linux from a UA string (or `navigator.userAgent`). */
export function detectAppPlatform(
  userAgent?: string | null,
): AppPlatform {
  const ua = (
    userAgent ??
    (typeof navigator !== "undefined" ? navigator.userAgent : "")
  ).toLowerCase();
  if (!ua) return "other";
  // iPadOS 13+ may report MacIntel — still treat as mac-like for Finder.
  if (ua.includes("mac") || ua.includes("iphone") || ua.includes("ipad")) {
    return "mac";
  }
  if (ua.includes("win")) return "win";
  if (ua.includes("linux") || ua.includes("android")) return "linux";
  return "other";
}

/**
 * i18n key for “Reveal in Finder / Explorer / file manager”.
 * - mac → Finder
 * - win → Explorer
 * - linux / other → generic file manager
 */
export function revealInOsMessageKey(platform: AppPlatform): MessageKey {
  if (platform === "win") return "main.openInExplorer";
  if (platform === "mac") return "main.openInFinder";
  return "main.openInFileManager";
}

/** Translate “Reveal in …” for the current (or given) platform. */
export function revealInOsLabel(
  tr: (key: MessageKey) => string,
  platform?: AppPlatform,
): string {
  return tr(revealInOsMessageKey(platform ?? detectAppPlatform()));
}

/**
 * Persistable open-location target id for the file manager row
 * (`finder` | `explorer` — both map to path_reveal on Host).
 */
export function fileManagerOpenTarget(platform: AppPlatform): "finder" | "explorer" {
  return platform === "win" ? "explorer" : "finder";
}

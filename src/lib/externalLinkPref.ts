/**
 * User preference: confirm before opening external http(s) links from chat.
 * localStorage-only — does not touch Host AppSettings.
 * Default: false (open immediately, no extra friction).
 */

export const CONFIRM_EXTERNAL_LINKS_STORAGE_KEY = "grok.confirmExternalLinks";

/** Fired on `window` after a successful save (detail = boolean confirm). */
export const CONFIRM_EXTERNAL_LINKS_CHANGE_EVENT =
  "grok-confirm-external-links-change";

export const DEFAULT_CONFIRM_EXTERNAL_LINKS = false;

/** Minimal storage surface so unit tests need no jsdom. */
export interface ConfirmExternalLinksStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): ConfirmExternalLinksStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/** Parse stored value; invalid / empty → default false. */
export function parseConfirmExternalLinksPref(raw: unknown): boolean {
  if (raw === "1" || raw === "true" || raw === true) return true;
  if (raw === "0" || raw === "false" || raw === false) return false;
  return DEFAULT_CONFIRM_EXTERNAL_LINKS;
}

export function loadConfirmExternalLinksPref(
  storage: ConfirmExternalLinksStorage = defaultStorage(),
): boolean {
  try {
    return parseConfirmExternalLinksPref(
      storage.getItem(CONFIRM_EXTERNAL_LINKS_STORAGE_KEY),
    );
  } catch {
    /* private mode */
    return DEFAULT_CONFIRM_EXTERNAL_LINKS;
  }
}

export function saveConfirmExternalLinksPref(
  confirm: boolean,
  storage: ConfirmExternalLinksStorage = defaultStorage(),
): void {
  try {
    storage.setItem(CONFIRM_EXTERNAL_LINKS_STORAGE_KEY, confirm ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(CONFIRM_EXTERNAL_LINKS_CHANGE_EVENT, {
          detail: confirm,
        }),
      );
    } catch {
      /* ignore */
    }
  }
}

/**
 * True for absolute http/https URLs that should leave the app.
 * Skips mailto, hash anchors, relative paths, and non-http schemes.
 */
export function isExternalHttpUrl(href: string): boolean {
  const t = (href ?? "").trim();
  if (!t) return false;
  // Fragment / relative / other schemes — not external browser navigation.
  if (t.startsWith("#")) return false;
  if (t.startsWith("mailto:") || t.startsWith("MAILTO:")) return false;
  if (t.startsWith("javascript:") || t.startsWith("data:")) return false;
  if (t.startsWith("./") || t.startsWith("../")) return false;
  // Absolute path on same origin (or protocol-relative) — not our concern.
  if (t.startsWith("/") && !t.startsWith("//")) return false;
  return /^https?:\/\//i.test(t);
}

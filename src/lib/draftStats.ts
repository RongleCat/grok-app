/**
 * Composer draft character / word stats (pure helpers) and optional UI toggle.
 * Pref is localStorage-only — does not touch Host AppSettings.
 * Default: show stats when the draft is non-empty.
 */

/** Storage key for the optional composer draft stats toggle. */
export const COMPOSER_DRAFT_STATS_KEY = "grok.composerDraftStats";

/** Fired on `window` after a same-tab preference save (storage events are cross-tab only). */
export const COMPOSER_DRAFT_STATS_CHANGED_EVENT = "grok:composerDraftStats";

/** Show muted char/word count by default when the draft is non-empty. */
export const DEFAULT_SHOW_COMPOSER_DRAFT_STATS = true;

/** Minimal storage surface so unit tests need no jsdom. */
export interface DraftStatsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): DraftStatsStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

// ── Pure stats ──────────────────────────────────────────────────────────────

export type DraftStats = {
  /** Unicode code-point length (emoji-safe). */
  chars: number;
  /** Whitespace-separated token count; 0 when empty / whitespace-only. */
  words: number;
  /** True when text has no non-whitespace content. */
  empty: boolean;
};

/** Character count using Unicode code points (not UTF-16 code units). */
export function countDraftChars(text: string): number {
  if (!text) return 0;
  return [...text].length;
}

/**
 * Word count: trim, then split on whitespace runs.
 * Empty / whitespace-only → 0. Does not special-case CJK (whole run = 1 word).
 */
export function countDraftWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Full draft stats for UI. Whitespace-only drafts are treated as empty
 * (no counter shown).
 */
export function computeDraftStats(text: string): DraftStats {
  if (!text || text.trim().length === 0) {
    return { chars: 0, words: 0, empty: true };
  }
  return {
    chars: countDraftChars(text),
    words: countDraftWords(text),
    empty: false,
  };
}

// ── Preference ──────────────────────────────────────────────────────────────

/** Parse stored value; invalid / empty → default true. */
export function parseComposerDraftStatsPref(raw: unknown): boolean {
  if (raw === "0" || raw === "false" || raw === false) return false;
  if (raw === "1" || raw === "true" || raw === true) return true;
  return DEFAULT_SHOW_COMPOSER_DRAFT_STATS;
}

export function loadComposerDraftStatsPref(
  storage: DraftStatsStorage = defaultStorage(),
): boolean {
  try {
    return parseComposerDraftStatsPref(
      storage.getItem(COMPOSER_DRAFT_STATS_KEY),
    );
  } catch {
    /* private mode */
    return DEFAULT_SHOW_COMPOSER_DRAFT_STATS;
  }
}

export function saveComposerDraftStatsPref(
  show: boolean,
  storage: DraftStatsStorage = defaultStorage(),
): void {
  try {
    storage.setItem(COMPOSER_DRAFT_STATS_KEY, show ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      window.dispatchEvent(
        new CustomEvent(COMPOSER_DRAFT_STATS_CHANGED_EVENT, { detail: show }),
      );
    } catch {
      /* ignore */
    }
  }
}

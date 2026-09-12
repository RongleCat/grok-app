/**
 * Optional auto-cancel timeout for the Ask User Question modal.
 * localStorage-only — App-enforced (does not rewrite Host AppSettings).
 *
 * Aligns conceptually with Grok Build CLI 0.2.117
 * `[toolset.ask_user_question] timeout_enabled / timeout_secs`
 * (and env `GROK_ASK_USER_QUESTION_TIMEOUT_*`). The App timer is independent
 * and typically much shorter (presets up to 5m); CLI still has its own
 * default budget (~30m) when enabled.
 *
 * 0 = off (default). Positive seconds until the same cancel path as Dismiss.
 * Settings offers presets; storage accepts any non-negative integer.
 */

export const ASK_USER_TIMEOUT_STORAGE_KEY = "grok.askUserTimeoutSec";

/** Fired on `window` after a successful save (detail = seconds). */
export const ASK_USER_TIMEOUT_CHANGE_EVENT = "grok-ask-user-timeout-change";

export const DEFAULT_ASK_USER_TIMEOUT_SEC = 0;

/** Preset values shown in Settings select (seconds). */
export const ASK_USER_TIMEOUT_PRESETS = [0, 30, 60, 120, 300] as const;

/** Soft upper bound when parsing free-form values (1 hour). */
export const ASK_USER_TIMEOUT_MAX_SEC = 3600;

/** Minimal storage surface so unit tests need no jsdom. */
export interface AskUserTimeoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): AskUserTimeoutStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/**
 * Parse stored / form value to a non-negative integer seconds.
 * Invalid / empty → 0 (off). Free numbers allowed (clamped to max).
 */
export function parseAskUserTimeoutSec(raw: unknown): number {
  if (raw == null || raw === "") return DEFAULT_ASK_USER_TIMEOUT_SEC;
  if (typeof raw === "boolean") return DEFAULT_ASK_USER_TIMEOUT_SEC;
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw.trim())
        : NaN;
  if (!Number.isFinite(n) || n < 0) return DEFAULT_ASK_USER_TIMEOUT_SEC;
  return Math.min(ASK_USER_TIMEOUT_MAX_SEC, Math.round(n));
}

export function loadAskUserTimeoutSec(
  storage: AskUserTimeoutStorage = defaultStorage(),
): number {
  try {
    return parseAskUserTimeoutSec(storage.getItem(ASK_USER_TIMEOUT_STORAGE_KEY));
  } catch {
    /* private mode */
    return DEFAULT_ASK_USER_TIMEOUT_SEC;
  }
}

export function saveAskUserTimeoutSec(
  seconds: number,
  storage: AskUserTimeoutStorage = defaultStorage(),
): void {
  const next = parseAskUserTimeoutSec(seconds);
  try {
    storage.setItem(ASK_USER_TIMEOUT_STORAGE_KEY, String(next));
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(ASK_USER_TIMEOUT_CHANGE_EVENT, { detail: next }),
      );
    } catch {
      /* ignore */
    }
  }
}

/**
 * Pure helper: whole seconds remaining until auto-cancel.
 * Returns 0 when timeout is off, already expired, or inputs are invalid.
 * Uses ceil so the UI shows `timeoutSec` until the first second elapses.
 */
export function askUserTimeoutRemainingSec(
  startedAtMs: number,
  timeoutSec: number,
  nowMs: number = Date.now(),
): number {
  if (!(timeoutSec > 0) || !Number.isFinite(timeoutSec)) return 0;
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs)) return 0;
  const left = Math.ceil(timeoutSec - (nowMs - startedAtMs) / 1000);
  return Math.max(0, left);
}

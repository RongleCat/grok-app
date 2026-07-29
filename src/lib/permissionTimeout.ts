/**
 * Optional auto-deny timeout for the permission bar.
 * localStorage-only — does not touch Host AppSettings.
 *
 * 0 = off (default). Positive seconds until the same deny path as Escape / Deny.
 * Settings offers presets; storage accepts any non-negative integer.
 */

export const PERMISSION_TIMEOUT_STORAGE_KEY = "grok.permissionTimeoutSec";

/** Fired on `window` after a successful save (detail = seconds). */
export const PERMISSION_TIMEOUT_CHANGE_EVENT = "grok-permission-timeout-change";

export const DEFAULT_PERMISSION_TIMEOUT_SEC = 0;

/** Preset values shown in Settings select (seconds). */
export const PERMISSION_TIMEOUT_PRESETS = [0, 30, 60, 120, 300] as const;

/** Soft upper bound when parsing free-form values (1 hour). */
export const PERMISSION_TIMEOUT_MAX_SEC = 3600;

/** Minimal storage surface so unit tests need no jsdom. */
export interface PermissionTimeoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): PermissionTimeoutStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/**
 * Parse stored / form value to a non-negative integer seconds.
 * Invalid / empty → 0 (off). Free numbers allowed (clamped to max).
 */
export function parsePermissionTimeoutSec(raw: unknown): number {
  if (raw == null || raw === "") return DEFAULT_PERMISSION_TIMEOUT_SEC;
  if (typeof raw === "boolean") return DEFAULT_PERMISSION_TIMEOUT_SEC;
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw.trim())
        : NaN;
  if (!Number.isFinite(n) || n < 0) return DEFAULT_PERMISSION_TIMEOUT_SEC;
  return Math.min(PERMISSION_TIMEOUT_MAX_SEC, Math.round(n));
}

export function loadPermissionTimeoutSec(
  storage: PermissionTimeoutStorage = defaultStorage(),
): number {
  try {
    return parsePermissionTimeoutSec(
      storage.getItem(PERMISSION_TIMEOUT_STORAGE_KEY),
    );
  } catch {
    /* private mode */
    return DEFAULT_PERMISSION_TIMEOUT_SEC;
  }
}

export function savePermissionTimeoutSec(
  seconds: number,
  storage: PermissionTimeoutStorage = defaultStorage(),
): void {
  const next = parsePermissionTimeoutSec(seconds);
  try {
    storage.setItem(PERMISSION_TIMEOUT_STORAGE_KEY, String(next));
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(PERMISSION_TIMEOUT_CHANGE_EVENT, { detail: next }),
      );
    } catch {
      /* ignore */
    }
  }
}

/**
 * Pure helper: whole seconds remaining until auto-deny.
 * Returns 0 when timeout is off, already expired, or inputs are invalid.
 * Uses ceil so the UI shows `timeoutSec` until the first second elapses.
 */
export function permissionTimeoutRemainingSec(
  startedAtMs: number,
  timeoutSec: number,
  nowMs: number = Date.now(),
): number {
  if (!(timeoutSec > 0) || !Number.isFinite(timeoutSec)) return 0;
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs)) return 0;
  const left = Math.ceil(timeoutSec - (nowMs - startedAtMs) / 1000);
  return Math.max(0, left);
}

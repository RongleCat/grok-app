/**
 * Quiet hours for desktop notifications.
 * localStorage-only — does not touch Host AppSettings.
 *
 * When enabled, system desktop notifications are suppressed during the local
 * time window. In-app toasts remain unaffected (callers use this only at the
 * desktop notify boundary).
 *
 * Overnight ranges (e.g. 22:00–08:00) are supported: start > end wraps midnight.
 */

export type NotifyQuietHoursPref = {
  enabled: boolean;
  /** Local start time, HH:mm (24h). */
  start: string;
  /** Local end time, HH:mm (24h). Quiet ends at this minute (exclusive). */
  end: string;
};

export const NOTIFY_QUIET_HOURS_STORAGE_KEY = "grok.notifyQuietHours";

/** Fired on `window` after a successful save (detail = pref). */
export const NOTIFY_QUIET_HOURS_CHANGE_EVENT = "grok-notify-quiet-hours-change";

export const DEFAULT_NOTIFY_QUIET_HOURS: NotifyQuietHoursPref = {
  enabled: false,
  start: "22:00",
  end: "08:00",
};

/** Minimal storage surface so unit tests need no jsdom. */
export interface NotifyQuietHoursStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): NotifyQuietHoursStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/** HH:mm or HTML time value HH:mm:ss (seconds ignored). */
const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/**
 * Parse HH:mm (optional leading zero on hour; optional :ss) to minutes from midnight.
 * Returns null when invalid.
 */
export function parseTimeToMinutes(raw: string): number | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(HHMM_RE);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

/** Normalize to zero-padded HH:mm, or null if invalid. */
export function normalizeHHmm(raw: string): string | null {
  const mins = parseTimeToMinutes(raw);
  if (mins == null) return null;
  const h = Math.floor(mins / 60);
  const min = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * Whether `now` falls inside the quiet window for `pref`.
 * - disabled → false
 * - invalid times → false
 * - start === end → false (zero-width window)
 * - start < end → same-day [start, end)
 * - start > end → overnight [start, 24h) ∪ [0, end)
 */
export function isInQuietHours(
  now: Date,
  pref: NotifyQuietHoursPref | null | undefined,
): boolean {
  if (!pref?.enabled) return false;
  const start = parseTimeToMinutes(pref.start);
  const end = parseTimeToMinutes(pref.end);
  if (start == null || end == null) return false;
  if (start === end) return false;

  const mins = now.getHours() * 60 + now.getMinutes();
  if (start < end) {
    return mins >= start && mins < end;
  }
  // Overnight (e.g. 22:00 → 08:00).
  return mins >= start || mins < end;
}

/** Convenience: load pref + check current local time. */
export function isQuietHoursActive(
  now: Date = new Date(),
  storage: NotifyQuietHoursStorage = defaultStorage(),
): boolean {
  return isInQuietHours(now, loadNotifyQuietHoursPref(storage));
}

/** Parse stored JSON / object; invalid → defaults. */
export function parseNotifyQuietHoursPref(raw: unknown): NotifyQuietHoursPref {
  if (raw == null || raw === "") return { ...DEFAULT_NOTIFY_QUIET_HOURS };

  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw) as unknown;
    } catch {
      return { ...DEFAULT_NOTIFY_QUIET_HOURS };
    }
  }
  if (!obj || typeof obj !== "object") {
    return { ...DEFAULT_NOTIFY_QUIET_HOURS };
  }

  const rec = obj as Record<string, unknown>;
  const enabled = rec.enabled === true;
  const start =
    typeof rec.start === "string"
      ? normalizeHHmm(rec.start) ?? DEFAULT_NOTIFY_QUIET_HOURS.start
      : DEFAULT_NOTIFY_QUIET_HOURS.start;
  const end =
    typeof rec.end === "string"
      ? normalizeHHmm(rec.end) ?? DEFAULT_NOTIFY_QUIET_HOURS.end
      : DEFAULT_NOTIFY_QUIET_HOURS.end;

  return { enabled, start, end };
}

export function loadNotifyQuietHoursPref(
  storage: NotifyQuietHoursStorage = defaultStorage(),
): NotifyQuietHoursPref {
  try {
    return parseNotifyQuietHoursPref(
      storage.getItem(NOTIFY_QUIET_HOURS_STORAGE_KEY),
    );
  } catch {
    /* private mode */
    return { ...DEFAULT_NOTIFY_QUIET_HOURS };
  }
}

export function saveNotifyQuietHoursPref(
  pref: NotifyQuietHoursPref,
  storage: NotifyQuietHoursStorage = defaultStorage(),
): void {
  const start =
    normalizeHHmm(pref.start) ?? DEFAULT_NOTIFY_QUIET_HOURS.start;
  const end = normalizeHHmm(pref.end) ?? DEFAULT_NOTIFY_QUIET_HOURS.end;
  const next: NotifyQuietHoursPref = {
    enabled: !!pref.enabled,
    start,
    end,
  };
  try {
    storage.setItem(NOTIFY_QUIET_HOURS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(NOTIFY_QUIET_HOURS_CHANGE_EVENT, { detail: next }),
      );
    } catch {
      /* ignore */
    }
  }
}

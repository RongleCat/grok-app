/**
 * Bridge event timeline — local ring buffer (no secrets).
 *
 * Records Bridge lifecycle + channel connect/reload/test outcomes only.
 * Never stores tokens, secrets, URLs with credentials, or raw credential values.
 * Newest first, max ~50. LocalStorage only — no network surface.
 *
 * Spec depth: docs/llm-wiki/remote-im.md §3.1 / §9 / §10
 */

import { intlLocale } from "@/i18n";

export type RimBridgeEventType =
  | "bridge_started"
  | "bridge_stopped"
  | "bridge_restarted"
  | "bridge_config"
  | "channel_reloaded"
  | "channel_connected"
  | "channel_disconnected"
  | "channel_error"
  | "test_ok"
  | "test_fail";

export type RimBridgeEvent = {
  id: string;
  type: RimBridgeEventType;
  /** ISO-8601 timestamp */
  at: string;
  /** Optional channel id (never free-form secret material) */
  channel?: string;
  /** Optional instance id (opaque, no secrets) */
  instanceId?: string;
  /** Optional short note — never secrets/tokens/URLs */
  note?: string;
};

export const RIM_EVENT_TIMELINE_STORAGE_KEY = "grok-app.remoteIm.eventTimeline";
export const RIM_EVENT_TIMELINE_MAX = 50;
export const RIM_EVENT_NOTE_MAX = 200;

/** Fired on `window` after a successful record/clear (detail = events). */
export const RIM_EVENT_TIMELINE_CHANGE_EVENT = "grok-remote-im-event-timeline-change";

const EVENT_TYPES = new Set<RimBridgeEventType>([
  "bridge_started",
  "bridge_stopped",
  "bridge_restarted",
  "bridge_config",
  "channel_reloaded",
  "channel_connected",
  "channel_disconnected",
  "channel_error",
  "test_ok",
  "test_fail",
]);

/** Minimal storage surface so unit tests need no jsdom. */
export interface RimEventTimelineStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function defaultStorage(): RimEventTimelineStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

function newEventId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `rim-ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Normalize optional note: trim, strip controls, cap length.
 * Drops notes that look like URLs, tokens, or secret material.
 */
export function sanitizeRimEventNote(
  raw: unknown,
  max = RIM_EVENT_NOTE_MAX,
): string | undefined {
  if (typeof raw !== "string") return undefined;
  let s = raw.replace(/[\u0000-\u001f]/g, "").trim();
  if (!s) return undefined;
  if (
    /https?:\/\//i.test(s) ||
    /[?&#]token=/i.test(s) ||
    /\btoken\s*[:=]/i.test(s) ||
    /\bbearer\s+/i.test(s) ||
    /\b(secret|password|app_secret|bot_token|access_token)\s*[:=]/i.test(s) ||
    /\b(sk|xai|xoxb|xapp|ghp)-[A-Za-z0-9._-]{8,}\b/i.test(s)
  ) {
    return undefined;
  }
  if (s.length > max) s = s.slice(0, max);
  return s;
}

/** Safe id-like string (channel / instance); reject junk and secret-looking values. */
export function sanitizeRimEventIdField(
  raw: unknown,
  max = 80,
): string | undefined {
  if (typeof raw !== "string") return undefined;
  let s = raw.replace(/[\u0000-\u001f]/g, "").trim();
  if (!s) return undefined;
  if (/https?:\/\//i.test(s) || /\s/.test(s)) return undefined;
  if (s.length > max) s = s.slice(0, max);
  // Opaque ids only — no long opaque tokens
  if (s.length > 64 && /[A-Za-z0-9+/=_-]{40,}/.test(s) && !/^[a-z0-9_-]+$/i.test(s.slice(0, 20))) {
    return undefined;
  }
  return s;
}

/**
 * Normalize one raw object into a RimBridgeEvent, or null if invalid.
 * Only known fields; drops free-form payload that could carry secrets.
 */
export function parseRimBridgeEvent(raw: unknown): RimBridgeEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const typeRaw = typeof o.type === "string" ? o.type.trim() : "";
  if (!EVENT_TYPES.has(typeRaw as RimBridgeEventType)) return null;
  const type = typeRaw as RimBridgeEventType;

  const idRaw = typeof o.id === "string" ? o.id.trim() : "";
  const id = idRaw.replace(/[\u0000-\u001f]/g, "").trim();
  if (!id) return null;

  const at =
    typeof o.at === "string" && o.at.trim()
      ? o.at.trim()
      : new Date(0).toISOString();

  const channel = sanitizeRimEventIdField(o.channel);
  const instanceId = sanitizeRimEventIdField(o.instanceId);
  const note = sanitizeRimEventNote(o.note);

  return {
    id,
    type,
    at,
    ...(channel ? { channel } : {}),
    ...(instanceId ? { instanceId } : {}),
    ...(note ? { note } : {}),
  };
}

/**
 * Parse stored JSON into a clean, newest-first list (capped).
 * Tolerates corrupt / partial data. Dedupes by id (keep first = newest).
 */
export function parseRimEventTimeline(
  raw: unknown,
  max = RIM_EVENT_TIMELINE_MAX,
): RimBridgeEvent[] {
  let list: unknown[] = [];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      return [];
    }
  } else if (Array.isArray(raw)) {
    list = raw;
  } else {
    return [];
  }

  const out: RimBridgeEvent[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const e = parseRimBridgeEvent(item);
    if (!e) continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Pure ring-buffer push: newest first, max length.
 * Does not touch storage. Replaces any existing entry with the same id.
 */
export function pushRimBridgeEvent(
  existing: readonly RimBridgeEvent[],
  entry: RimBridgeEvent,
  max = RIM_EVENT_TIMELINE_MAX,
): RimBridgeEvent[] {
  const next = parseRimBridgeEvent(entry);
  if (!next) return parseRimEventTimeline(existing, max);
  const rest = existing.filter((e) => e.id !== next.id);
  return parseRimEventTimeline([next, ...rest], max);
}

export function loadRimEventTimeline(
  storage: RimEventTimelineStorage = defaultStorage(),
  max = RIM_EVENT_TIMELINE_MAX,
): RimBridgeEvent[] {
  try {
    return parseRimEventTimeline(
      storage.getItem(RIM_EVENT_TIMELINE_STORAGE_KEY),
      max,
    );
  } catch {
    return [];
  }
}

export function saveRimEventTimeline(
  entries: readonly RimBridgeEvent[],
  storage: RimEventTimelineStorage = defaultStorage(),
  max = RIM_EVENT_TIMELINE_MAX,
): void {
  const clean = parseRimEventTimeline(entries, max);
  try {
    storage.setItem(RIM_EVENT_TIMELINE_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    /* private mode / quota */
  }
}

function notifyTimelineChange(next: RimBridgeEvent[]): void {
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(RIM_EVENT_TIMELINE_CHANGE_EVENT, { detail: next }),
      );
    } catch {
      /* ignore */
    }
  }
}

/**
 * Record a Bridge event: load → push → save → notify.
 * Never accepts or stores secret values / credential-bearing URLs.
 * Returns the updated list.
 */
export function recordRimBridgeEvent(
  input: {
    type: RimBridgeEventType;
    channel?: string | null;
    instanceId?: string | null;
    note?: string | null;
    at?: string;
    id?: string;
  },
  storage: RimEventTimelineStorage = defaultStorage(),
  max = RIM_EVENT_TIMELINE_MAX,
): RimBridgeEvent[] {
  if (!EVENT_TYPES.has(input.type)) {
    return loadRimEventTimeline(storage, max);
  }
  const entry: RimBridgeEvent = {
    id: (input.id && String(input.id).trim()) || newEventId(),
    type: input.type,
    at: input.at || new Date().toISOString(),
    ...(input.channel != null ? { channel: String(input.channel) } : {}),
    ...(input.instanceId != null
      ? { instanceId: String(input.instanceId) }
      : {}),
    ...(input.note != null ? { note: String(input.note) } : {}),
  };
  const clean = parseRimBridgeEvent(entry);
  if (!clean) return loadRimEventTimeline(storage, max);

  const next = pushRimBridgeEvent(
    loadRimEventTimeline(storage, max),
    clean,
    max,
  );
  saveRimEventTimeline(next, storage, max);
  notifyTimelineChange(next);
  return next;
}

/** Clear the entire timeline (local only). Returns empty list. */
export function clearRimEventTimeline(
  storage: RimEventTimelineStorage = defaultStorage(),
): RimBridgeEvent[] {
  try {
    if (typeof storage.removeItem === "function") {
      storage.removeItem(RIM_EVENT_TIMELINE_STORAGE_KEY);
    } else {
      storage.setItem(RIM_EVENT_TIMELINE_STORAGE_KEY, "[]");
    }
  } catch {
    /* private mode */
  }
  notifyTimelineChange([]);
  return [];
}

/** Stable i18n key for an event type. */
export function rimBridgeEventTypeKey(
  type: RimBridgeEventType,
): `settings.remoteIm.timeline.type.${RimBridgeEventType}` {
  return `settings.remoteIm.timeline.type.${type}`;
}

/** Compact local time for timeline rows. */
export function formatRimEventAt(
  iso: string,
  locale: string | null,
  now = Date.now(),
): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  const sameDay =
    new Date(now).toDateString() === d.toDateString();
  try {
    if (sameDay) {
      return d.toLocaleTimeString(intlLocale(locale), {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
    }
    return d.toLocaleString(intlLocale(locale), {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

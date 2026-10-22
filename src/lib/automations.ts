/**
 * Scheduled automations (Codex-style "已安排").
 * Host stores metadata; shell fires when the app is open.
 */

export type AutomationFrequency = "daily" | "weekly" | "weekdays" | "once";
export type AutomationNotify = "all" | "failures" | "none";

export interface Automation {
  id: string;
  title: string;
  prompt: string;
  enabled: boolean;
  projectId: string | null;
  modelId: string | null;
  effort: string | null;
  frequency: AutomationFrequency | string;
  /** Local wall-clock `HH:MM` (24h). */
  time: string;
  /** For weekly: 0=Sun … 6=Sat */
  weekdays: number[];
  notify: AutomationNotify | string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
}

export interface AutomationInput {
  title: string;
  prompt: string;
  enabled?: boolean;
  projectId?: string | null;
  modelId?: string | null;
  effort?: string | null;
  frequency?: string;
  time?: string;
  weekdays?: number[];
  notify?: string;
  nextRunAt?: string | null;
}

const LS_KEY = "grok-app.automations";

/** Browser / fallback store when Tauri is unavailable. */
export function loadAutomationsLocal(): Automation[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as Automation[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveAutomationsLocal(list: Automation[]): void {
  localStorage.setItem(LS_KEY, JSON.stringify(list));
}

function parseTime(hhmm: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, m: min };
}

/** Compute next run after `from` (default: now). Returns ISO string. */
export function computeNextRunAt(
  auto: Pick<Automation, "frequency" | "time" | "weekdays" | "enabled">,
  from: Date = new Date(),
): string | null {
  if (!auto.enabled) return null;
  const tm = parseTime(auto.time || "09:00");
  if (!tm) return null;

  const start = new Date(from.getTime());
  // Search up to 14 days ahead for a matching slot.
  for (let day = 0; day < 14; day++) {
    const d = new Date(start);
    d.setDate(start.getDate() + day);
    d.setHours(tm.h, tm.m, 0, 0);
    if (d.getTime() <= from.getTime()) continue;

    const dow = d.getDay(); // 0 Sun … 6 Sat
    const freq = (auto.frequency || "daily").toLowerCase();
    if (freq === "daily") return d.toISOString();
    if (freq === "weekdays") {
      if (dow >= 1 && dow <= 5) return d.toISOString();
      continue;
    }
    if (freq === "weekly") {
      const days =
        auto.weekdays?.length > 0 ? auto.weekdays : [from.getDay()];
      if (days.includes(dow)) return d.toISOString();
      continue;
    }
    if (freq === "once") {
      // Once: first future wall-clock match only.
      return d.toISOString();
    }
    // unknown → treat as daily
    return d.toISOString();
  }
  return null;
}

/** True if automation is due at `now` (within the last 90s window). */
export function isDue(auto: Automation, now: Date = new Date()): boolean {
  if (!auto.enabled) return false;
  if (!auto.nextRunAt) {
    // Lazy: if never scheduled, check if today's slot just passed within window.
    const next = computeNextRunAt(auto, new Date(now.getTime() - 90_000));
    if (!next) return false;
    const t = new Date(next).getTime();
    return t <= now.getTime() && now.getTime() - t < 90_000;
  }
  const t = new Date(auto.nextRunAt).getTime();
  if (Number.isNaN(t)) return false;
  return t <= now.getTime();
}

export function formatScheduleSummary(
  auto: Pick<Automation, "frequency" | "time" | "weekdays">,
  labels: {
    daily: string;
    weekly: string;
    weekdays: string;
    once: string;
    at: string;
  },
): string {
  const time = auto.time || "09:00";
  const freq = (auto.frequency || "daily").toLowerCase();
  if (freq === "daily") return `${labels.daily} · ${labels.at} ${time}`;
  if (freq === "weekdays") return `${labels.weekdays} · ${labels.at} ${time}`;
  if (freq === "once") return `${labels.once} · ${labels.at} ${time}`;
  if (freq === "weekly") return `${labels.weekly} · ${labels.at} ${time}`;
  return `${freq} · ${labels.at} ${time}`;
}

/** Relative “next run in X” for list subtitle. */
export function formatNextRunRelative(
  nextRunAt: string | null | undefined,
  now: Date = new Date(),
  labels: {
    overdue: string;
    inHours: string;
    inDays: string;
    inMinutes: string;
    unknown: string;
  },
): string {
  if (!nextRunAt) return labels.unknown;
  const t = new Date(nextRunAt).getTime();
  if (Number.isNaN(t)) return labels.unknown;
  const diff = t - now.getTime();
  if (diff <= 0) return labels.overdue;
  const mins = Math.round(diff / 60_000);
  // Under ~30s rounds to 0. The run is still ahead, so the subtitle stays
  // "in 1 min" instead of "in 0 min".
  if (mins < 60) {
    return labels.inMinutes.replace("{n}", String(mins < 1 ? 1 : mins));
  }
  const hours = Math.round(mins / 60);
  if (hours < 48) return labels.inHours.replace("{n}", String(hours));
  const days = Math.round(hours / 24);
  return labels.inDays.replace("{n}", String(days));
}

/** Seed prompt for AI-assisted create — natural language only (no JSON schema). */
export { aiCreateSeedPrompt } from "./automationSetup";

/** Header written by shell when a scheduled task fires (user bubble first line). */
export const SCHEDULED_USER_HEADER_RE =
  /^\[Scheduled:\s*([^\]]+)\](?:\r?\n)+(.*)$/s;

/** Parse `[Scheduled: title]\\n\\nbody` from automation runs. */
export function parseScheduledUserContent(content: string): {
  title: string;
  body: string;
} | null {
  const m = SCHEDULED_USER_HEADER_RE.exec(content || "");
  if (!m) return null;
  const title = (m[1] || "").trim();
  if (!title) return null;
  return { title, body: (m[2] || "").replace(/^\r?\n/, "") };
}

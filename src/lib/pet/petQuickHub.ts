/**
 * Pure logic for the pet quick-access panel: merging recent chats with live
 * task states, search, keyboard selection and the saved quick-prompt list.
 * No DOM / IPC here so vitest drives the real rules.
 */
import type { PetQuickRecent } from "@/lib/api/petQuick";
import type { PetKind } from "./petFocus";

export type HubTone = "idle" | "busy" | "attention" | "done" | "error";

export type HubRow = PetQuickRecent & { tone: HubTone; snippet: string | null };

export function hubTone(kind: PetKind | null | undefined, phase?: "active" | "done"): HubTone {
  if (phase === "done") return kind === "error" ? "error" : "done";
  switch (kind) {
    case "working":
    case "connecting":
      return "busy";
    case "needs_you":
      return "attention";
    case "ready":
      return "done";
    case "error":
      return "error";
    default:
      return "idle";
  }
}

type TaskLike = {
  sessionId: string;
  kind: PetKind;
  phase: "active" | "done";
  snippet: string | null;
};

function fold(s: string): string {
  return s.toLocaleLowerCase("tr").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");
}

/** Pinned + recent rows with live state; needs-approval chats float to the top of each group. */
export function buildHubRows(
  recents: readonly PetQuickRecent[],
  tasks: readonly TaskLike[],
  query: string,
): { pinned: HubRow[]; recent: HubRow[] } {
  const byId = new Map(tasks.map((t) => [t.sessionId, t]));
  const q = fold(query.trim());
  const rows: HubRow[] = recents
    .filter((r) => !q || fold(`${r.title} ${r.project}`).includes(q))
    .map((r) => {
      const t = byId.get(r.id);
      return { ...r, tone: t ? hubTone(t.kind, t.phase) : "idle", snippet: t?.snippet ?? null };
    });
  const rank = (r: HubRow) => (r.tone === "attention" ? 0 : r.tone === "busy" ? 1 : 2);
  const sort = (a: HubRow, b: HubRow) => rank(a) - rank(b) || b.updatedAt - a.updatedAt;
  return {
    pinned: rows.filter((r) => r.pinned).sort(sort),
    recent: rows.filter((r) => !r.pinned).sort(sort),
  };
}

/** Wrap-around keyboard selection; -1 = nothing selected (focus in the prompt). */
export function moveHubSelection(cur: number, delta: number, len: number): number {
  if (len <= 0) return -1;
  if (cur < 0) return delta > 0 ? 0 : len - 1;
  return (cur + delta + len) % len;
}

export const SAVED_PROMPTS_KEY = "grok.petQuick.savedPrompts";
export const SAVED_PROMPTS_MAX = 12;

export function addSavedPrompt(list: readonly string[], text: string): string[] {
  const t = text.trim();
  if (!t) return [...list];
  return [t, ...list.filter((x) => x !== t)].slice(0, SAVED_PROMPTS_MAX);
}

export function removeSavedPrompt(list: readonly string[], text: string): string[] {
  return list.filter((x) => x !== text);
}

export function parseSavedPrompts(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, SAVED_PROMPTS_MAX)
      : [];
  } catch {
    return [];
  }
}

/** Magnetic hover offset: pull toward the pointer, capped (px). */
export function magneticOffset(
  px: number,
  py: number,
  rect: { left: number; top: number; width: number; height: number },
  strength = 0.25,
  cap = 4,
): [number, number] {
  const dx = (px - (rect.left + rect.width / 2)) * strength;
  const dy = (py - (rect.top + rect.height / 2)) * strength;
  const c = (v: number) => Math.max(-cap, Math.min(cap, Math.round(v * 10) / 10));
  return [c(dx), c(dy)];
}

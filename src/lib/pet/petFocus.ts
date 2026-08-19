/**
 * Multi-session desktop-pet focus picker.
 *
 * Highest-priority live work wins:
 *   needs_you > error > ready (finished + unread) > working > idle
 *   (connecting handshake is ignored so switching chats stays quiet)
 *
 * Tool-title chatter must not flip session/kind: {@link resolvePetFocus} sticks
 * to the previous session while it still qualifies for the winning kind.
 */

import {
  mapDashboardStatus,
  type AgentDashboardStatus,
} from "@/lib/agentDashboard";
import type { SessionLiveMap, SessionLiveSnapshot } from "@/lib/sessionLiveStore";

export type PetKind =
  | "idle"
  | "connecting"
  | "working"
  | "needs_you"
  | "ready"
  | "error";

export type PetFocus = {
  kind: PetKind;
  sessionId: string | null;
  title: string | null;
  toolTitle: string | null;
  rank: number;
  updatedAt: number;
};

export type PetFocusSession = {
  id: string;
  title?: string | null;
};

export type PetFocusInput = {
  liveMap: SessionLiveMap;
  unreadIds: ReadonlySet<string>;
  finishedTurns: Readonly<Record<string, number>>;
  sessions: readonly PetFocusSession[];
  /** Latest assistant stage reply per session (pet chips only). */
  snippets?: Readonly<Record<string, string>>;
  now?: number;
};

const KIND_RANK: Record<PetKind, number> = {
  needs_you: 0,
  error: 1,
  ready: 2,
  working: 3,
  connecting: 4,
  idle: 5,
};

export function petKindRank(kind: PetKind): number {
  return KIND_RANK[kind];
}

function dashToKind(status: AgentDashboardStatus): PetKind | null {
  if (status === "permission") return "needs_you";
  if (status === "error") return "error";
  if (status === "busy") return "working";
  // Connecting is handshake noise when switching chats — not a shown task.
  return null;
}

export function kindForSession(
  sessionId: string,
  input: PetFocusInput,
): PetKind {
  const snap: SessionLiveSnapshot | undefined = input.liveMap[sessionId];
  const dash = mapDashboardStatus(snap);
  const mapped = dashToKind(dash);
  if (mapped) return mapped;
  const unread = input.unreadIds.has(sessionId);
  const finishedAt = input.finishedTurns[sessionId];
  if (unread && typeof finishedAt === "number" && Number.isFinite(finishedAt)) {
    return "ready";
  }
  return "idle";
}

function collectIds(input: PetFocusInput): string[] {
  const ids = new Set<string>();
  for (const id of Object.keys(input.liveMap)) {
    if (id) ids.add(id);
  }
  for (const id of input.unreadIds) {
    if (id) ids.add(id);
  }
  for (const id of Object.keys(input.finishedTurns)) {
    if (id) ids.add(id);
  }
  for (const s of input.sessions) {
    if (s.id) ids.add(s.id);
  }
  return [...ids];
}

function titleFor(sessionId: string, input: PetFocusInput): string | null {
  const row = input.sessions.find((s) => s.id === sessionId);
  const t = row?.title?.trim();
  return t ? t : null;
}

function activityAt(
  sessionId: string,
  kind: PetKind,
  input: PetFocusInput,
): number {
  const snap = input.liveMap[sessionId];
  if (kind === "ready") {
    return input.finishedTurns[sessionId] ?? snap?.updatedAt ?? 0;
  }
  return snap?.startedAt ?? snap?.updatedAt ?? 0;
}

function focusOf(
  sessionId: string | null,
  kind: PetKind,
  input: PetFocusInput,
  now: number,
): PetFocus {
  if (!sessionId) {
    return {
      kind: "idle",
      sessionId: null,
      title: null,
      toolTitle: null,
      rank: petKindRank("idle"),
      updatedAt: now,
    };
  }
  const snap = input.liveMap[sessionId];
  return {
    kind,
    sessionId,
    title: titleFor(sessionId, input),
    toolTitle: snap?.liveToolTitle ?? null,
    rank: petKindRank(kind),
    updatedAt: activityAt(sessionId, kind, input) || now,
  };
}

/**
 * Stateless best pick (no stickiness). Prefer {@link resolvePetFocus} at the
 * product boundary so tool-title ticks do not bounce between peers.
 */
export function pickPetFocus(input: PetFocusInput): PetFocus {
  const now = input.now ?? Date.now();
  const ids = collectIds(input);
  let bestId: string | null = null;
  let bestKind: PetKind = "idle";
  let bestActivity = -1;
  for (const id of ids) {
    const kind = kindForSession(id, input);
    const rank = petKindRank(kind);
    const bestRank = petKindRank(bestKind);
    const activity = activityAt(id, kind, input);
    if (
      rank < bestRank ||
      (rank === bestRank &&
        (activity > bestActivity ||
          (activity === bestActivity && id < (bestId ?? ""))))
    ) {
      bestId = id;
      bestKind = kind;
      bestActivity = activity;
    }
  }
  if (bestKind === "idle") return focusOf(null, "idle", input, now);
  return focusOf(bestId, bestKind, input, now);
}

/**
 * Shipped multi-session focus picker. Sticks to `previous.sessionId` while that
 * session still has the current winning kind — tool-title chatter on another
 * busy session cannot steal focus.
 */
export function resolvePetFocus(
  previous: PetFocus | null | undefined,
  input: PetFocusInput,
): PetFocus {
  const now = input.now ?? Date.now();
  const ids = collectIds(input);
  let winningKind: PetKind = "idle";
  for (const id of ids) {
    const kind = kindForSession(id, input);
    if (petKindRank(kind) < petKindRank(winningKind)) winningKind = kind;
  }
  if (winningKind === "idle") return focusOf(null, "idle", input, now);

  const prevId = previous?.sessionId;
  if (
    prevId &&
    kindForSession(prevId, input) === winningKind
  ) {
    return focusOf(prevId, winningKind, input, now);
  }

  let bestId: string | null = null;
  let bestActivity = -1;
  for (const id of ids) {
    if (kindForSession(id, input) !== winningKind) continue;
    const activity = activityAt(id, winningKind, input);
    if (
      activity > bestActivity ||
      (activity === bestActivity && id < (bestId ?? ""))
    ) {
      bestId = id;
      bestActivity = activity;
    }
  }
  return focusOf(bestId, winningKind, input, now);
}

export type PetVerb =
  | "idle"
  | "sleeping"
  | "thinking"
  | "searching"
  | "working"
  | "writing"
  | "waiting"
  | "notifying"
  | "sad"
  | "waking"
  | "happy"
  | "curious"
  | "confused"
  | "playful"
  | "shy"
  | "proud"
  | "bored"
  | "drowsy"
  | "excited"
  | "surprised"
  | "laughing"
  | "scared"
  | "angry"
  | "suspicious"
  | "celebrate"
  | "dragging";

export function petVerbFor(
  kind: PetKind,
  toolTitle?: string | null,
): PetVerb {
  switch (kind) {
    case "needs_you":
      return "waiting";
    case "error":
      return "sad";
    case "ready":
      return "notifying";
    case "connecting":
      return "waking";
    case "working": {
      const t = (toolTitle ?? "").toLowerCase();
      if (/\b(search|web_search|browse|fetch)\b/.test(t)) return "searching";
      if (/\b(think|reason)\b/.test(t)) return "thinking";
      if (
        /\b(write|edit|apply_patch|str_replace|strreplace|create_file)\b/.test(t)
      ) {
        return "writing";
      }
      return "working";
    }
    default:
      return "idle";
  }
}

/**
 * Cross-session agent activity for the Tasks panel.
 *
 * Host remains authoritative via session://runtime + liveMap projection.
 * This module only aggregates UI rows — no second process model.
 */

import {
  isSessionLiveStreaming,
  type SessionState,
} from "./session";
import type {
  SessionLiveMap,
  SessionLiveSnapshot,
} from "./sessionLiveStore";

export type ActivitySessionStatus =
  | "streaming"
  | "awaiting_permission"
  | "connecting"
  | "ready"
  | "other";

export interface ActivitySessionRow {
  sessionId: string;
  /** Sidebar title when known. */
  title: string;
  status: ActivitySessionStatus;
  /** Running tool title from live projection, if any. */
  liveToolTitle: string | null;
  /** True when this is the chat currently on screen. */
  isCurrent: boolean;
  updatedAt: number;
}

export type SessionTitleLookup = {
  id: string;
  title?: string | null;
};

function mapStatus(state: SessionState): ActivitySessionStatus {
  if (state === "streaming") return "streaming";
  if (state === "awaiting_permission") return "awaiting_permission";
  if (state === "connecting") return "connecting";
  if (state === "ready" || state === "idle") return "ready";
  return "other";
}

/** True when the session should appear in the global activity list. */
export function isActiveSessionSnapshot(
  snap: SessionLiveSnapshot | undefined | null,
): boolean {
  if (!snap) return false;
  if (snap.awaitingPermission) return true;
  if (isSessionLiveStreaming(snap.state)) return true;
  if (snap.state === "connecting") return true;
  return false;
}

/**
 * Build activity rows for all busy / connecting sessions.
 * Current session is included (flagged) so the panel can show "this chat".
 */
export function collectActivitySessions(opts: {
  liveMap: SessionLiveMap;
  sessions: SessionTitleLookup[];
  currentSessionId?: string | null;
  untitledLabel?: string;
}): ActivitySessionRow[] {
  const titleById = new Map<string, string>();
  for (const s of opts.sessions) {
    const t = (s.title || "").trim();
    if (t) titleById.set(s.id, t);
  }
  const untitled = opts.untitledLabel || "Untitled";
  const current = opts.currentSessionId || null;
  const rows: ActivitySessionRow[] = [];

  for (const [sessionId, snap] of Object.entries(opts.liveMap)) {
    if (!isActiveSessionSnapshot(snap)) continue;
    rows.push({
      sessionId,
      title: titleById.get(sessionId) || untitled,
      status: mapStatus(snap.state),
      liveToolTitle: snap.liveToolTitle,
      isCurrent: current != null && sessionId === current,
      updatedAt: snap.updatedAt,
    });
  }

  // Newest activity first; current chat stays first among ties.
  rows.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
  return rows;
}

/** Busy sessions excluding the currently viewed chat. */
export function otherBusySessions(
  rows: ActivitySessionRow[],
): ActivitySessionRow[] {
  return rows.filter((r) => !r.isCurrent);
}

/** True when a Tasks-panel activity row can be stopped via `sessionStop`. */
export function isStoppableActivityStatus(
  status: ActivitySessionStatus,
): boolean {
  return (
    status === "streaming" ||
    status === "awaiting_permission" ||
    status === "connecting"
  );
}

/** Activity rows that accept Stop / Stop all (busy stream / permission / connect). */
export function stoppableActivitySessions(
  rows: ActivitySessionRow[],
): ActivitySessionRow[] {
  return rows.filter((r) => isStoppableActivityStatus(r.status));
}

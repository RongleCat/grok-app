/**
 * Open state and live fleet events for the background-tasks pane.
 * The pane sits on the right of the open chat. Open state is per session.
 * Subscribed from that pane. Not App or AppWorkbench state.
 */
import { useSyncExternalStore } from "react";

export type FleetWireEvent = {
  kind: string;
  body: unknown;
};

type Listener = () => void;

const EMPTY: FleetWireEvent[] = [];
const MAX_EVENTS = 200;
/** Pane id for a new chat that does not have a session id yet. */
export const FLEET_DRAFT_ID = "__draft__";

let focusId: string | null = null;
let revision = 0;
let chatSessionId: string | null = null;
let chatStreaming = false;
/** Per open chat. A missing key means the user has not opened that chat's pane. */
const openBySession = new Map<string, boolean>();
const eventsBySession = new Map<string, FleetWireEvent[]>();
/**
 * Row ids already shown for a chat. Lives here, not in the pane, so closing
 * the pane still sticks if the chat view remounts. A later new id reopens it.
 */
const seenRowsBySession = new Map<string, Set<string>>();
const listeners = new Set<Listener>();

export type BackgroundTasksSnapshot = {
  open: boolean;
  focusId: string | null;
  revision: number;
  sessionId: string | null;
  streaming: boolean;
};

let snapshot: BackgroundTasksSnapshot = {
  open: false,
  focusId: null,
  revision: 0,
  sessionId: null,
  streaming: false,
};

function sessionPaneOpen(sessionId: string | null): boolean {
  if (!sessionId) return false;
  return openBySession.get(sessionId) === true;
}

function publish(): void {
  revision += 1;
  snapshot = {
    open: sessionPaneOpen(chatSessionId),
    focusId,
    revision,
    sessionId: chatSessionId,
    streaming: chatStreaming,
  };
  for (const listener of listeners) listener();
}

/** Open the floating pane for a new empty chat. A later close stays closed. */
export function beginNewChatFleet(): void {
  if (openBySession.has(FLEET_DRAFT_ID)) return;
  openBySession.set(FLEET_DRAFT_ID, true);
}

/**
 * Carry the new-chat pane onto the session that chat just created.
 * Does nothing when that session already has its own open state.
 */
export function adoptDraftFleet(sessionId: string): void {
  const sid = sessionId.trim();
  if (!sid || sid === FLEET_DRAFT_ID || openBySession.has(sid)) {
    openBySession.delete(FLEET_DRAFT_ID);
    return;
  }
  openBySession.set(sid, openBySession.get(FLEET_DRAFT_ID) === true);
  openBySession.delete(FLEET_DRAFT_ID);
}

/** Drop the new-chat pane so the next new chat can open it again. */
export function clearDraftFleet(): void {
  if (!openBySession.has(FLEET_DRAFT_ID)) return;
  openBySession.delete(FLEET_DRAFT_ID);
}

function rowKeys(row: {
  id: string;
  toolCallId?: string;
  childSessionId?: string;
}): string[] {
  const keys = [row.id, row.toolCallId, row.childSessionId];
  const out: string[] = [];
  for (const key of keys) {
    const trimmed = key?.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}

/**
 * Remember the rows on screen. Returns true when this chat should open the
 * pane: a row is running the first time we look, or a row shows up that was
 * not already on screen. Finished history stays closed. The same task
 * changing id (tool call → task id) does not count as a new row.
 */
export function noteFleetRowsForAutoOpen(
  sessionId: string,
  rows: readonly {
    id: string;
    toolCallId?: string;
    childSessionId?: string;
    running?: boolean;
  }[],
): boolean {
  const sid = sessionId.trim();
  if (!sid) return false;
  let seen = seenRowsBySession.get(sid);
  const first = !seen;
  if (!seen) {
    seen = new Set();
    seenRowsBySession.set(sid, seen);
  }
  const bag = seen;
  let hasNew = false;
  for (const row of rows) {
    const keys = rowKeys(row);
    if (keys.length === 0) continue;
    if (!keys.some((key) => bag.has(key))) hasNew = true;
    for (const key of keys) bag.add(key);
  }
  if (first) return rows.some((row) => row.running === true);
  return hasNew;
}

/** Forget remembered row ids. Tests use this so auto-open starts clean. */
export function forgetFleetAutoOpen(): void {
  seenRowsBySession.clear();
}

/** Which open chat the right-hand list belongs to. */
export function setFleetChatContext(sessionId: string | null, streaming: boolean): void {
  const sid = (sessionId || "").trim() || null;
  if (chatSessionId === sid && chatStreaming === streaming) return;
  chatSessionId = sid;
  chatStreaming = streaming;
  publish();
}

export function subscribeBackgroundTasks(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getBackgroundTasksSnapshot(): BackgroundTasksSnapshot {
  return snapshot;
}

export function useBackgroundTasks(): BackgroundTasksSnapshot {
  return useSyncExternalStore(
    subscribeBackgroundTasks,
    getBackgroundTasksSnapshot,
    getBackgroundTasksSnapshot,
  );
}

export function backgroundFleetEvents(sessionId: string): readonly FleetWireEvent[] {
  return eventsBySession.get(sessionId) ?? EMPTY;
}

export function pushFleetEvent(sessionId: string, kind: string, body: unknown): void {
  const sid = sessionId.trim();
  const eventKind = kind.trim();
  if (!sid || !eventKind) return;
  const prev = eventsBySession.get(sid) ?? EMPTY;
  const next = prev.length >= MAX_EVENTS ? prev.slice(prev.length - (MAX_EVENTS - 1)) : prev.slice();
  next.push({ kind: eventKind, body });
  eventsBySession.set(sid, next);
  publish();
}

export function setBackgroundTasksOpen(next: boolean): void {
  if (!chatSessionId) return;
  if (sessionPaneOpen(chatSessionId) === next) return;
  openBySession.set(chatSessionId, next);
  publish();
}

export function toggleBackgroundTasks(): void {
  if (!chatSessionId) return;
  openBySession.set(chatSessionId, !sessionPaneOpen(chatSessionId));
  publish();
}

/** Open this chat's pane and scroll the matching row into view. */
export function focusFleetRow(sessionId: string, id: string): void {
  const rowId = id.trim();
  const sid = sessionId.trim();
  if (!rowId) return;
  focusId = rowId;
  if (sid) openBySession.set(sid, true);
  publish();
}

export function clearFleetFocus(): void {
  if (!focusId) return;
  focusId = null;
  publish();
}

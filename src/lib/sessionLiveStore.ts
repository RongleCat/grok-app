/**
 * Per-session live snapshot projection (multi-session busy without retyping).
 * Host remains authoritative; this is a client-side cache keyed by sessionId.
 */

import type { ChatMessage, SessionState } from "./session";
import { isSessionLiveStreaming, pickRunningTurnTool } from "./session";
import type { EndOfTurnReason } from "./endOfTurn";

export interface SessionLiveSnapshot {
  sessionId: string;
  state: SessionState;
  streamingMessageId: string | null;
  /** Running tool title if any */
  liveToolTitle: string | null;
  liveToolId: string | null;
  terminalReason: EndOfTurnReason | null;
  /** First model output seen this turn (for stall tier). Sticky until turn ends. */
  sawModelOutput: boolean;
  /** Tool activity observed this turn (stall tier; sticky until turn ends). */
  sawToolActivity: boolean;
  startedAt: number | null;
  updatedAt: number;
  /** Permission waiting */
  awaitingPermission: boolean;
}

export type SessionLiveMap = Record<string, SessionLiveSnapshot>;

export function emptyLiveSnapshot(
  sessionId: string,
  nowMs: number = Date.now(),
): SessionLiveSnapshot {
  return {
    sessionId,
    state: "idle",
    streamingMessageId: null,
    liveToolTitle: null,
    liveToolId: null,
    terminalReason: null,
    sawModelOutput: false,
    sawToolActivity: false,
    startedAt: null,
    updatedAt: nowMs,
    awaitingPermission: false,
  };
}

export function upsertLiveSnapshot(
  map: SessionLiveMap,
  patch: Partial<SessionLiveSnapshot> & { sessionId: string },
  nowMs: number = Date.now(),
): SessionLiveMap {
  const prev = map[patch.sessionId] ?? emptyLiveSnapshot(patch.sessionId, nowMs);
  return {
    ...map,
    [patch.sessionId]: {
      ...prev,
      ...patch,
      updatedAt: nowMs,
    },
  };
}

/** Project Host snapshot into the live map. */
export function projectHostIntoLiveMap(
  map: SessionLiveMap,
  host: {
    sessionId: string | null;
    state: SessionState;
    streamingMessageId?: string | null;
  },
  nowMs: number = Date.now(),
): SessionLiveMap {
  if (!host.sessionId) return map;
  const awaitingPermission = host.state === "awaiting_permission";
  const live = isSessionLiveStreaming(host.state);
  const prev = map[host.sessionId];
  return upsertLiveSnapshot(
    map,
    {
      sessionId: host.sessionId,
      state: host.state,
      streamingMessageId: host.streamingMessageId ?? null,
      awaitingPermission,
      startedAt: live ? (prev?.startedAt ?? nowMs) : null,
      // Clear live tool when not streaming. Keep saw* sticky until turn truly ends
      // so stall copy never says "waiting for first token" after a full answer.
      ...(live
        ? {}
        : {
            liveToolTitle: null,
            liveToolId: null,
            // Only reset progress flags when leaving a live turn (ready/idle/error).
            sawModelOutput: false,
            sawToolActivity: false,
          }),
    },
    nowMs,
  );
}

/**
 * Settle one stopped turn without disturbing other live sessions.
 *
 * `sessionStop` can resolve before (or without) a final Host state event. The
 * message view already stops locally in that case, so the sidebar projection
 * must also leave its busy state instead of spinning indefinitely.
 */
export function settleStoppedSessionInLiveMap(
  map: SessionLiveMap,
  sessionId: string,
  nowMs: number = Date.now(),
): SessionLiveMap {
  const snapshot = map[sessionId];
  if (
    !snapshot ||
    (!snapshot.awaitingPermission &&
      !isSessionLiveStreaming(snapshot.state))
  ) {
    return map;
  }
  return projectHostIntoLiveMap(
    map,
    {
      sessionId,
      state: "ready",
      streamingMessageId: null,
    },
    nowMs,
  );
}

/** Settle a matching focused/workbench snapshot after Stop succeeds. */
export function settleStoppedSessionSnapshot<
  T extends {
    sessionId: string | null;
    state: SessionState;
    streamingMessageId?: string | null;
  },
>(snapshot: T, sessionId: string): T {
  if (
    snapshot.sessionId !== sessionId ||
    !isSessionLiveStreaming(snapshot.state)
  ) {
    return snapshot;
  }
  return {
    ...snapshot,
    state: "ready",
    streamingMessageId: null,
  };
}

/**
 * State to project when (re)opening `sessionId`.
 *
 * The Host live slot wins. Otherwise a *background* turn's snapshot is used, so
 * switching back to a demoted chat re-attaches the spinner and stream pipeline
 * instead of showing a finished-looking `idle` thread while the agent is still
 * writing into it.
 */
export function resumeStateForSession(
  sessionId: string,
  live: {
    sessionId: string | null;
    state: SessionState;
    streamingMessageId?: string | null;
  },
  map: SessionLiveMap,
): { state: SessionState; streamingMessageId: string | null } {
  if (live.sessionId && live.sessionId === sessionId) {
    return {
      state: live.state,
      streamingMessageId: live.streamingMessageId ?? null,
    };
  }
  const snap = map[sessionId];
  if (snap && (isSessionLiveStreaming(snap.state) || snap.state === "connecting")) {
    return { state: snap.state, streamingMessageId: snap.streamingMessageId };
  }
  return { state: "idle", streamingMessageId: null };
}

/** Update live tool from messages for a session. */
export function projectLiveToolFromMessages(
  map: SessionLiveMap,
  sessionId: string,
  messages: ChatMessage[],
  nowMs: number = Date.now(),
): SessionLiveMap {
  const tool = pickRunningTurnTool(messages);
  return upsertLiveSnapshot(
    map,
    {
      sessionId,
      liveToolTitle: tool ? tool.content || null : null,
      liveToolId: tool?.toolCallId ?? null,
    },
    nowMs,
  );
}

export function markSawModelOutput(
  map: SessionLiveMap,
  sessionId: string,
  nowMs: number = Date.now(),
): SessionLiveMap {
  return upsertLiveSnapshot(
    map,
    { sessionId, sawModelOutput: true },
    nowMs,
  );
}

export function markSawToolActivity(
  map: SessionLiveMap,
  sessionId: string,
  nowMs: number = Date.now(),
): SessionLiveMap {
  return upsertLiveSnapshot(
    map,
    { sessionId, sawToolActivity: true },
    nowMs,
  );
}

/**
 * Infer sticky progress flags from journal messages for the *current* turn
 * (from last user message to end). Used when opening a session or before stall UI.
 */
export function inferTurnProgressFromMessages(
  messages: ChatMessage[],
): { sawModelOutput: boolean; sawToolActivity: boolean } {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      lastUser = i;
      break;
    }
  }
  const slice = lastUser >= 0 ? messages.slice(lastUser + 1) : messages;
  let sawModelOutput = false;
  let sawToolActivity = false;
  for (const m of slice) {
    if (m.role === "assistant" && (m.content || "").trim().length > 0) {
      sawModelOutput = true;
    }
    if (m.role === "tool" || m.marker === "tool_step") {
      sawToolActivity = true;
    }
  }
  return { sawModelOutput, sawToolActivity };
}

/** Merge journal-inferred progress into the live map (OR with existing sticky flags). */
export function mergeTurnProgressFromMessages(
  map: SessionLiveMap,
  sessionId: string,
  messages: ChatMessage[],
  nowMs: number = Date.now(),
): SessionLiveMap {
  const inferred = inferTurnProgressFromMessages(messages);
  const prev = map[sessionId] ?? emptyLiveSnapshot(sessionId, nowMs);
  return upsertLiveSnapshot(
    map,
    {
      sessionId,
      sawModelOutput: prev.sawModelOutput || inferred.sawModelOutput,
      sawToolActivity: prev.sawToolActivity || inferred.sawToolActivity,
    },
    nowMs,
  );
}

export function setTerminalReason(
  map: SessionLiveMap,
  sessionId: string,
  reason: EndOfTurnReason | null,
  nowMs: number = Date.now(),
): SessionLiveMap {
  const patch: Partial<SessionLiveSnapshot> & { sessionId: string } = {
    sessionId,
    terminalReason: reason,
    liveToolTitle: null,
    liveToolId: null,
  };
  if (reason) patch.state = "ready";
  return upsertLiveSnapshot(map, patch, nowMs);
}

/** Session ids that should show sidebar busy/permission indicator. */
export function busySessionIds(map: SessionLiveMap): Set<string> {
  const out = new Set<string>();
  for (const s of Object.values(map)) {
    if (
      s.awaitingPermission ||
      s.state === "streaming" ||
      s.state === "awaiting_permission"
    ) {
      out.add(s.sessionId);
    }
  }
  return out;
}

export function isSessionLiveBusy(
  map: SessionLiveMap,
  sessionId: string | null | undefined,
): boolean {
  if (!sessionId) return false;
  return busySessionIds(map).has(sessionId);
}

export function sessionNeedsPermission(
  map: SessionLiveMap,
  sessionId: string | null | undefined,
): boolean {
  if (!sessionId) return false;
  const s = map[sessionId];
  return !!s?.awaitingPermission || s?.state === "awaiting_permission";
}

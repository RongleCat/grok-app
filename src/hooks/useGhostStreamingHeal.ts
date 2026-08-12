/**
 * Auto-heal optimistic "Thinking…" when Host never started a turn.
 *
 * See `ghostStreamingHeal.ts` for the policy. This hook only wires timers +
 * workbench mutations; no Host cancel (there is nothing to cancel).
 */

import { useEffect, useRef, type MutableRefObject } from "react";
import {
  findOptimisticGhostTurn,
  GHOST_STREAMING_POLL_MS,
  shouldHealGhostStreaming,
  stripGhostTurnMessages,
} from "@/lib/ghostStreamingHeal";
import type { SessionLiveMap } from "@/lib/sessionLiveStore";
import { settleStoppedSessionInLiveMap } from "@/lib/sessionLiveStore";
import type {
  ChatMessage,
  SessionSnapshot,
  SessionState,
} from "@/lib/session";

export type GhostStreamingHealDeps = {
  enabled: boolean;
  sessionState: SessionState;
  sessionId: string | null;
  messages: ChatMessage[];
  turnStartedAt: number | null;
  /** Always-updated map (prefer ref — full map may be unsubscribed when panels closed). */
  liveMapRef: MutableRefObject<SessionLiveMap>;
  liveHostRef: MutableRefObject<SessionSnapshot>;
  /** Bumped on heal so a hung sessionSend cannot re-dirty UI after return. */
  sendEpochRef: MutableRefObject<number>;
  sendInFlightRef: MutableRefObject<boolean>;
  messagesBySessionRef: MutableRefObject<Map<string, ChatMessage[]>>;
  patchSessionMessages: (
    sessionId: string,
    updater: (prev: ChatMessage[]) => ChatMessage[],
  ) => void;
  setMessages: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
  setSession: (updater: (prev: SessionSnapshot) => SessionSnapshot) => void;
  setLiveHost: (updater: (prev: SessionSnapshot) => SessionSnapshot) => void;
  setLiveMap: (updater: (prev: SessionLiveMap) => SessionLiveMap) => void;
  /** Stop a specific chat's turn clock (session-scoped). */
  clearTurnClock: (sessionId?: string | null) => void;
  setStreamStall: (v: null) => void;
  /** Restore optimistic user text into the composer. */
  restoreComposer: (text: string) => void;
  /** User-visible notice (toast / localError). */
  onHealed: (restoredText: string) => void;
};

/**
 * Host-authoritative busy for the viewed chat.
 *
 * Prefer `liveMap` only — `liveHost.state` is often painted optimistically in
 * `executeSend` before `sessionSend` reaches the agent, so trusting it would
 * never heal pure frontend ghosts.
 *
 * `null` means "no Host projection" → treated as idle by heal policy.
 */
function hostStateForViewed(
  sessionId: string | null,
  liveMap: SessionLiveMap,
  _liveHost: SessionSnapshot,
): SessionState | null {
  if (!sessionId) return null;
  const row = liveMap[sessionId];
  return row?.state ?? null;
}

/**
 * While the viewed chat shows an empty streaming shell, poll heal conditions.
 * When Host/liveMap never entered a real turn past the grace window, strip the
 * optimistic pair, unlock busy, restore composer text, and notify.
 */
export function useGhostStreamingHeal(deps: GhostStreamingHealDeps): void {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const healingRef = useRef(false);

  const emptyStreaming = deps.messages.some(
    (m) =>
      m.role === "assistant" &&
      m.streaming &&
      !(m.content ?? "").trim() &&
      !m.marker,
  );
  const watch =
    deps.enabled &&
    (deps.sessionState === "streaming" ||
      deps.sessionState === "awaiting_permission" ||
      emptyStreaming);

  useEffect(() => {
    if (!watch) return;

    const tick = () => {
      const d = depsRef.current;
      if (healingRef.current) return;

      const hostState = hostStateForViewed(
        d.sessionId,
        d.liveMapRef.current,
        d.liveHostRef.current,
      );

      if (
        !shouldHealGhostStreaming({
          uiSessionState: d.sessionState,
          viewedSessionId: d.sessionId,
          messages: d.messages,
          turnStartedAt: d.turnStartedAt,
          nowMs: Date.now(),
          hostStateForSession: hostState,
          sendInFlight: d.sendInFlightRef.current,
        })
      ) {
        return;
      }

      const turn = findOptimisticGhostTurn(d.messages);
      if (!turn) return;

      healingRef.current = true;
      try {
        // Invalidate any hung executeSend still awaiting sessionSend.
        d.sendEpochRef.current += 1;
        d.sendInFlightRef.current = false;

        const drop = new Set(turn.dropIds);
        const strip = (prev: ChatMessage[]) =>
          stripGhostTurnMessages(prev, drop);

        if (d.sessionId) {
          d.patchSessionMessages(d.sessionId, strip);
          d.setLiveMap((prev) =>
            settleStoppedSessionInLiveMap(prev, d.sessionId!),
          );
        } else {
          d.setMessages((prev) => {
            const next = strip(prev);
            d.messagesBySessionRef.current.set("__draft__", next);
            return next;
          });
        }

        d.setSession((prev) => {
          if (
            prev.state !== "streaming" &&
            prev.state !== "awaiting_permission"
          ) {
            return prev;
          }
          return {
            ...prev,
            state: prev.sessionId ? "ready" : "idle",
            lastError: null,
            streamingMessageId: null,
          };
        });

        d.setLiveHost((prev) => {
          // Only rewind optimistic streaming we claimed for this chat.
          if (
            d.sessionId &&
            prev.sessionId &&
            prev.sessionId !== d.sessionId
          ) {
            return prev;
          }
          if (
            prev.state !== "streaming" &&
            prev.state !== "awaiting_permission"
          ) {
            return prev;
          }
          const next: SessionSnapshot = {
            ...prev,
            state: prev.sessionId ? "ready" : "idle",
            streamingMessageId: null,
            lastError: null,
          };
          d.liveHostRef.current = next;
          return next;
        });

        d.clearTurnClock(d.sessionId);
        d.setStreamStall(null);

        const text = turn.restoreComposerText;
        if (text.trim()) {
          d.restoreComposer(text);
        }
        d.onHealed(text);
      } finally {
        healingRef.current = false;
      }
    };

    // Immediate check (covers already-stuck sessions when effect re-arms).
    tick();
    const id = window.setInterval(tick, GHOST_STREAMING_POLL_MS);
    return () => window.clearInterval(id);
  }, [
    watch,
    deps.sessionState,
    deps.sessionId,
    deps.turnStartedAt,
    // Re-arm when message list shape changes (new optimistic shell).
    deps.messages.length,
    emptyStreaming,
  ]);
}

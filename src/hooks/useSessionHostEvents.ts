// @ts-nocheck — lifted Host listeners; ctx bag typed loosely during residual extract.
/**
 * Host session event subscriptions (session://state, stream, tools, ...).
 * Extracted from AppWorkbench (residual-appworkbench).
 */
import { useEffect, useRef } from "react";
import * as api from "@/lib/api";
import { isMirrorClient } from "@/lib/mirrorTransport";
import { isValidAskUserPayload } from "@/lib/askUserPayload";
import {
  applyContextCompact,
  applyGeneratedImage,
  applyInterjection,
  applyStreamChunk,
  applyToolEvent,
  applyTurnError,
  applyTurnMarker,
  isSessionBusy,
  isSessionLiveStreaming,
  pickRunningTurnTool,
  upgradeMessagesFromJournal,
  weaveToolsIntoAssistantSegments,
  ensureBusyTurnStreaming,
  settleStreamingOnHostReady,
  type AskUserPayload,
  type ChatMessage,
  type GeneratedImagePayload,
  type PermissionPayload,
  type SessionSnapshot,
  type StreamPayload,
  type TurnErrorPayload,
} from "@/lib/session";
import {
  applyResolvedSessionMedia,
  collectSessionRelativeMediaRefs,
} from "@/lib/attachments";
import { mapStoredMessagesToChat } from "@/lib/mapStoredMessages";
import {
  projectHostIntoLiveMap,
  mayPromoteStreamingFromStreamChunk,
  projectLiveToolFromMessages,
  markSawModelOutput,
  markSawToolActivity,
  mergeTurnProgressFromMessages,
  settleStoppedSessionInLiveMap,
  settleStoppedSessionSnapshot,
} from "@/lib/sessionLiveStore";
import {
  reconcileSessionState,
} from "@/lib/sessionPhase";
import { createStopLatchState } from "@/lib/stopLatch";
import {
  isTurnDoneReadyTransition,
  markUnread as markSessionUnread,
  shouldMarkUnreadOnTurnDone,
} from "@/lib/sessionUnread";
import {
  shouldShowDesktopNotify,
  showDesktopNotification,
} from "@/lib/desktopNotify";
import {
  mergeSessionChange,
} from "@/lib/sessionChanges";
import {
  reduceContextUsage,
  mergeCompactTokensBefore,
  saveSessionUsageSnapshot,
  isLikelyBillingAggregateUsage,
} from "@/lib/contextUsage";
import {
  emptySessionPlan,
  invalidatePlanGate,
  mergePlanFromEvent,
  planStateToStored,
} from "@/lib/planSession";
import { planDisplayMarkdown } from "@/lib/planBody";
import { computePlanProgress, parsePlanEntries } from "@/lib/planStatus";
import { recordPlanHistory } from "@/lib/planHistory";
import { parseProcessLimitEvent } from "@/lib/processBudget";
import {
  DEFAULT_RELIABILITY_MAX_STALLS,
  prependReliabilityRing,
  recordStallHistoryFromSignal,
  reliabilityStallFromEvent,
} from "@/lib/reliabilityCenter";
import {
  GOAL_ORCH_EVENT_MAX,
  goalEventFromHostPayload,
  prependGoalOrchEvent,
} from "@/lib/goalOrch";
import {
  ingestHookLogLine,
  ingestHostHookPayload,
  ingestToolHookSignal,
} from "@/lib/hooksDebug";
import { recordCostUsageSample, sampleFromUsageEvent } from "@/lib/costRollup";
import { ingestSessionSpend } from "@/lib/sessionSpend";
import { mapSessionListRow } from "@/lib/app/sidebarModels";
import {
  StreamCoalescer,
  TimedBatchQueue,
  resolveStreamFlushMs,
  toolEventNeedsImmediateFlush,
} from "@/lib/streamCoalesce";
import {
  JOURNAL_REHYDRATE_RETRY_GAPS_MS,
  shouldApplyLateStreamText,
  shouldHealJournalOnStreamDone,
  shouldIgnorePrematureStreamDone,
} from "@/lib/streamLateToken";
import {
  chatcutHandoffToResourceOpenTarget,
  resolveChatcutHandoffFromToolEvent,
} from "@/lib/chatcutHandoff";
import { toolEventSuggestsSkillCatalogChange } from "@/lib/skillCatalogRefresh";

/** Mutable bag of AppWorkbench bindings used by Host event handlers. */
export type SessionHostEventsCtx = {
  [key: string]: unknown;
  patchSessionMessages: (
    targetSessionId: string | undefined | null,
    reduce: (prev: ChatMessage[]) => ChatMessage[],
  ) => void;
  tryApplyAutomationFromSession: (sessionId: string) => void | Promise<void>;
  /**
   * Schedule a skills catalog reload (`skills_list`) when a chat turn
   * installs/writes skills so slash / + palette update without app restart.
   */
  onSkillCatalogMaybeStale?: () => void;
};

/** Dedup handoff opens within a short window (same URL). */
const chatcutHandoffRecent = new Map<string, number>();
const CHATCUT_HANDOFF_DEDUP_MS = 8_000;

function openChatcutUrlInSystemBrowser(url: string) {
  if (api.isTauri()) {
    void api.openExternalUrl(url).catch((e) => {
      console.error("[chatcut] openExternalUrl failed", e);
      try {
        window.open(url, "_blank", "noopener,noreferrer");
      } catch {
        /* ignore */
      }
    });
  } else {
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      /* ignore */
    }
  }
}

function maybeOpenChatcutHandoffFromTool(
  c: {
    localeRef?: { current?: string };
    viewingSessionIdRef?: { current?: string | null };
    openAsidePaneRef?: { current?: () => void };
    openAsidePane?: () => void;
    setResourceOpenTarget?: (t: {
      type: "url";
      url: string;
      title?: string;
    }) => void;
    navigateWorkbench?: () => void;
  },
  p: {
    sessionId?: string;
    title?: string;
    kind?: string;
    status?: string;
    path?: string | null;
    detail?: string | null;
  },
) {
  const status = (p.status || "").toLowerCase();
  // Only act on terminal success-ish statuses (or unknown completed payloads).
  if (
    status &&
    status !== "completed" &&
    status !== "success" &&
    status !== "done" &&
    status !== "ok"
  ) {
    // Still allow when path/detail clearly carries a handoff URL mid-flight.
    const hay = `${p.path ?? ""}\n${p.detail ?? ""}`;
    if (!/browserHandoff|editorUrl|chatcut\.io\/.*editor/i.test(hay)) {
      return;
    }
  }
  const locale = c.localeRef?.current ?? undefined;
  const action = resolveChatcutHandoffFromToolEvent(
    {
      title: p.title,
      detail: p.detail,
      path: p.path,
      kind: p.kind,
    },
    { locale },
  );
  if (action.kind === "none") return;

  const openUrl =
    action.kind === "open_external"
      ? action.url
      : action.kind === "open_in_app_browser"
        ? action.url
        : null;
  if (!openUrl) return;

  const now = Date.now();
  const last = chatcutHandoffRecent.get(openUrl) ?? 0;
  if (now - last < CHATCUT_HANDOFF_DEDUP_MS) return;
  chatcutHandoffRecent.set(openUrl, now);
  // Bound map size
  if (chatcutHandoffRecent.size > 40) {
    for (const [k, t] of chatcutHandoffRecent) {
      if (now - t > CHATCUT_HANDOFF_DEDUP_MS * 2) chatcutHandoffRecent.delete(k);
    }
  }

  const sid = p.sessionId || c.viewingSessionIdRef?.current;
  if (sid && c.viewingSessionIdRef?.current && sid !== c.viewingSessionIdRef.current) {
    // Background session: skip auto-open so we do not steal focus.
    return;
  }

  // Default: system browser (editor / billing / other). Embedded WebView cannot
  // reliably play ChatCut media.
  if (action.kind === "open_external") {
    openChatcutUrlInSystemBrowser(action.url);
    return;
  }

  // Opt-in only: side Resources EmbeddedBrowser (forceEditorInApp).
  const target = chatcutHandoffToResourceOpenTarget(action);
  if (!target) return;

  try {
    c.navigateWorkbench?.();
  } catch {
    /* optional */
  }
  try {
    (c.openAsidePaneRef?.current ?? c.openAsidePane)?.();
  } catch {
    /* optional */
  }
  try {
    c.setResourceOpenTarget?.(target);
  } catch {
    /* optional */
  }
}

export function useSessionHostEvents(ctx: SessionHostEventsCtx) {
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const patchSessionMessages = ctx.patchSessionMessages;
  const tryApplyAutomationFromSession = ctx.tryApplyAutomationFromSession;

  useEffect(() => {
    // Fresh bindings for this subscription epoch (matches prior closure timing).
    const c = ctxRef.current as any;
    if (!api.isTauri() && !isMirrorClient()) return;

    let cancelled = false;
    const cleanups: Array<() => void> = [];
    const registrationPromises: Promise<unknown>[] = [];

    /**
     * Registering a listener is an IPC operation in both desktop and mirror
     * modes.  A transient transport failure must not abort the rest of the
    * listener boot sequence (the old `track(...)` chain did exactly
     * that).  Keep retrying with a capped backoff until this subscription epoch
     * is disposed; this also lets a mirror reconnect heal a missed listener
     * without requiring a full window remount.
     */
    const listenWithRetry = async <T>(
      event: string,
      handler: (payload: T) => void,
    ): Promise<() => void> => {
      let attempt = 0;
      let lastError: unknown;
      while (!cancelled) {
        try {
          return await api.listen<T>(event, handler);
        } catch (e) {
          lastError = e;
          const delayMs = Math.min(5_000, 250 * 2 ** Math.min(attempt, 4));
          attempt += 1;
          if (attempt === 1 || attempt % 5 === 0) {
            console.warn(
              `[host-events] listener registration failed (${event}); retrying`,
              e,
            );
          }
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, delayMs);
          });
        }
      }
      // The caller will immediately dispose this no-op when cancellation wins
      // the race with an in-flight registration.
      if (lastError) {
        console.debug(`[host-events] listener registration cancelled (${event})`);
      }
      return () => {};
    };

    /**
     * Start registration independently.  Do not await one listener before
     * starting the next: a single broken event channel must not create a
     * startup-wide event window for every later channel.
     */
    const track = (p: Promise<() => void>) => {
      const registration = p
        .then((un) => {
          if (cancelled) {
            un();
          } else {
            cleanups.push(un);
          }
        })
        .catch((e) => {
          // `listenWithRetry` normally only rejects on an unexpected API
          // failure.  Keep this isolated so one listener can never suppress
          // snapshot hydration or the remaining listeners.
          if (!cancelled) {
            console.warn("[host-events] listener registration abandoned", e);
          }
        });
      registrationPromises.push(registration);
      void registration;
    };

    void (async () => {
      try {
        /**
         * Resolve `![](puppy.png)` / `images/N.jpg` against session + project
         * roots and attach the real abs path. Ready often fires before the
         * journal tail (and the markdown image) lands — openSession already
         * does this, which is why a session switch "fixes" missing cards.
         */
        const applyResolvedRelativeMedia = (
          sid: string | null | undefined,
          rows: ChatMessage[],
        ) => {
          if (!sid) return;
          const rels = collectSessionRelativeMediaRefs(rows);
          if (!rels.length) return;
          void api
            .sessionResolveRelativeMedia(sid, rels)
            .then((list) => {
              if (
                cancelled ||
                !list.length ||
                c.viewingSessionIdRef.current !== sid
              ) {
                return;
              }
              const resolved = list.map((a) => ({
                path: a.path,
                name: a.name || a.path.split(/[/\\]/).pop() || a.path,
                isDir: !!a.isDir,
              }));
              c.patchSessionMessages(sid, (cur) =>
                applyResolvedSessionMedia(cur, resolved),
              );
            })
            .catch(() => {
              /* best-effort — pathMap / next remount still apply */
            });
        };

        /**
         * Heal missed stream tail from Host journal after early ready.
         * Upgrade is pure against the session cache; React state is set from
         * the same result.
         *
         * Always one delayed retry: Host may still be force-flushing the final
         * assistant row when the first ready event lands (partial body already
         * painted). Empty-body-only retry left mid-status text stuck until the
         * user switched sessions and remounted from disk.
         */
        const scheduleJournalRehydrate = (
          sid: string,
          attempt: number,
          opts?: { clearStreaming?: boolean },
        ) => {
          void api
            .sessionMessages(sid)
            .then((stored) => {
              if (cancelled || c.viewingSessionIdRef.current !== sid) return;
              const hostState =
                c.liveMapRef.current[sid]?.state ??
                (c.liveHostRef.current?.sessionId === sid
                  ? c.liveHostRef.current.state
                  : undefined);
              const stillBusy =
                hostState === "streaming" ||
                hostState === "awaiting_permission";
              // Never freeze a turn Host still marks live (switch-back
              // journal heal used to clear streaming and stop the timer).
              const shouldClear = !!opts?.clearStreaming && !stillBusy;
              const woven = weaveToolsIntoAssistantSegments(
                mapStoredMessagesToChat(stored),
              );
              // Session-scoped cache only — never merge journal into the
              // previous chat's still-painted React prev (#529 pollution).
              const cached: ChatMessage[] =
                c.messagesBySessionRef.current.get(sid) ?? [];
              const base = shouldClear
                ? settleStreamingOnHostReady(cached)
                : cached;
              // Empty cache → journal is sole source (openSession may race-write).
              // Non-empty → lift longer journal tails into this session only.
              let next =
                base.length === 0
                  ? woven
                  : upgradeMessagesFromJournal(base, woven);
              // Lift may have filled the queued pending from disk. Settle
              // again so a complete body is frozen and replay cannot append.
              if (shouldClear) {
                next = settleStreamingOnHostReady(next);
              }
              if (stillBusy) {
                next = ensureBusyTurnStreaming(next, hostState);
                next = weaveToolsIntoAssistantSegments(next);
              }
              c.messagesBySessionRef.current.set(sid, next);
              // patchSession / setMessages both honor session ownership.
              c.patchSessionMessages(sid, () => next);
              // Journal often holds the full `grok-automation` fence after a
              // truncated stream. Apply must run post-rehydrate for the
              // *viewed* session too (stream `done` alone is not enough).
              void c.tryApplyAutomationFromSession(sid);
              applyResolvedRelativeMedia(sid, next);
              const gap = JOURNAL_REHYDRATE_RETRY_GAPS_MS[attempt];
              if (gap != null) {
                window.setTimeout(() => {
                  if (!cancelled) {
                    scheduleJournalRehydrate(sid, attempt + 1, opts);
                  }
                }, gap);
              }
            })
            .catch(() => {
              /* journal rehydrate is best-effort */
            });
        };

        // Populated before stream/tool listeners; flushed on turn end for honesty.
        let streamCoalescer: StreamCoalescer | null = null;
        let toolEventCoalescer: TimedBatchQueue<{
          sessionId?: string;
          toolCallId?: string;
          title?: string;
          kind?: string;
          status?: string;
          path?: string | null;
          detail?: string | null;
          before?: string | null;
          after?: string | null;
        }> | null = null;
        const flushHostCoalescers = () => {
          toolEventCoalescer?.flushAll();
          streamCoalescer?.flushAll();
        };

        // Snapshot hydration runs after all event channels are registered.
        const hydrateInitialSnapshot = async (opts?: {
          adoptHostFocus?: boolean;
        }) => {
          const adoptHostFocus = opts?.adoptHostFocus ?? true;
          const requestedViewing = c.viewingSessionIdRef.current;
          const requestedOpening = c.openingSessionIdRef?.current ?? null;
          const snap = await api.sessionGetState();
          if (!cancelled) {
          c.setLiveHost(snap);
          c.liveHostRef.current = snap;
          // Project Host live row into liveMap for sidebar busy badges.
          // Secondary windows keep their deep-link focus — never adopt the
          // Host live slot as the viewed session (that would fight main).
          const secondary =
            c.isSecondaryWindowRef.current ||
            !!c.secondaryFocusSessionIdRef.current;
          if (snap.sessionId) {
            c.setLiveMap((prev) =>
              projectHostIntoLiveMap(prev, {
                sessionId: snap.sessionId,
                state: snap.state,
                streamingMessageId: snap.streamingMessageId,
              }),
            );
            const canAdoptHostFocus =
              adoptHostFocus &&
              (requestedViewing == null || requestedViewing === snap.sessionId) &&
              c.viewingSessionIdRef.current === requestedViewing &&
              (c.openingSessionIdRef?.current ?? null) === requestedOpening;
            if (!secondary && canAdoptHostFocus) {
              c.setSession((prev) => ({
                ...snap,
                state: reconcileSessionState(snap.state, prev.state),
              }));
              c.viewingSessionIdRef.current = snap.sessionId;
            } else if (
              c.secondaryFocusSessionIdRef.current &&
              snap.sessionId === c.secondaryFocusSessionIdRef.current
            ) {
              // Same chat is already live on Host — mirror state without
              // passive warm-connect (secondary still follows streams by id).
              c.setSession((prev) => ({
                ...snap,
                state: reconcileSessionState(snap.state, prev.state),
              }));
              c.viewingSessionIdRef.current = snap.sessionId;
            }
          }
          }
        };

        // Mirror clients force a reconnect when the broadcast ring reports a
        // lagged receiver. Rehydrate the host snapshot and the currently
        // viewed journal as soon as that socket is back so dropped stream
        // frames cannot leave the phone UI permanently stale.
        if (isMirrorClient()) {
          track(
            listenWithRetry<{ resumed?: boolean }>(
              "mirror://reconnected",
              () => {
                void hydrateInitialSnapshot({ adoptHostFocus: false })
                  .then(() => {
                    const sid = c.viewingSessionIdRef.current;
                    if (sid) scheduleJournalRehydrate(sid, 0);
                  })
                  .catch((e) => {
                    if (!cancelled) {
                      console.warn("[host-events] mirror resync failed", e);
                    }
                  });
              },
            ),
          );
        }

        // Host finished a turn but App journal may still miss the final
        // assistant body (stream dropped / sticky finish). Rehydrate so UI
        // leaves "thinking" and shows the real answer.
       track(
          listenWithRetry<{ sessionId?: string; changed?: number }>(
            "session://journal_reconciled",
            (p) => {
              if (cancelled || !p?.sessionId) return;
              const sid = p.sessionId;
              if (c.viewingSessionIdRef.current === sid) {
                const liveState = c.liveMapRef.current[sid]?.state;
                const stillBusy =
                  liveState === "streaming" ||
                  liveState === "awaiting_permission";
                scheduleJournalRehydrate(sid, 0, {
                  clearStreaming: !stillBusy,
                });
              }
              void c.tryApplyAutomationFromSession(sid);
            },
          ),
        );
       track(
          listenWithRetry<SessionSnapshot>("session://state", (s) => {
            if (cancelled) return;
            // Host focus slot (the process under the live cursor). Multi-session
            // busy demotions also emit session://runtime so liveMap stays honest.
            const prevLiveState = s.sessionId
              ? c.liveMapRef.current[s.sessionId]?.state
              : undefined;
            // Stamp unread before liveMap drops `working`, so the pet done-bubble
            // never has a gap. Unfocused viewing still counts as unread.
            let background = false;
            if (
              s.sessionId &&
              s.state === "ready" &&
              isTurnDoneReadyTransition(prevLiveState, s.state)
            ) {
              background = shouldMarkUnreadOnTurnDone({
                sessionId: s.sessionId,
                viewingSessionId: c.viewingSessionIdRef.current,
              });
              if (background) {
                markSessionUnread(s.sessionId);
              }
            }
            c.setLiveHost(s);
            c.liveHostRef.current = s;
            c.setLiveMap((prev) =>
              projectHostIntoLiveMap(prev, {
                sessionId: s.sessionId,
                state: s.state,
                streamingMessageId: s.streamingMessageId,
              }),
            );
            if (
              s.sessionId &&
              s.state === "ready" &&
              isTurnDoneReadyTransition(prevLiveState, s.state)
            ) {
              // Desktop notify for turn_done:
              // - background chat: force (app may be focused on another chat)
              // - current chat: only when window unfocused (hasFocus gate inside)
              if (
                shouldShowDesktopNotify(
                  "turn_done",
                  c.notifyPrefsRef.current,
                )
              ) {
                showDesktopNotification({
                  title: c.trRef.current("notify.turnDoneTitle"),
                  body: c.trRef.current("notify.turnDoneBody"),
                  tag: `turn-done-${s.sessionId}`,
                  sessionId: s.sessionId,
                  force: background,
                });
              }
            }
            if (
              s.state !== "streaming" &&
              s.state !== "awaiting_permission" &&
              c.stopLatchRef.current.phase !== "idle"
            ) {
              const cleared = createStopLatchState();
              c.stopLatchRef.current = cleared;
              c.setStopLatch(cleared);
            }
            // Only update the workbench session when the user is viewing it.
            // Otherwise switching sessions would yank selection back to the live agent.
            // Turn-done desktop notify is handled above for all sessions (not only
            // the viewed one — background chats were previously silent).
            if (
              s.sessionId &&
              s.sessionId === c.viewingSessionIdRef.current
            ) {
              c.setSession((prev) => ({
                ...s,
                state: reconcileSessionState(s.state, prev.state),
              }));
              // Clear retry chip / turn timer / stall banner when turn ends or errors out
              if (s.state !== "streaming" && s.state !== "awaiting_permission") {
                // Drain coalesced stream/tool so final tokens land before streaming=false.
                flushHostCoalescers();
                c.setRetryStatus(null);
                c.setStreamStall(null);
                // Session-scoped: a background chat going idle must not stop the
                // clock of the chat the user is watching.
                c.clearTurnClock(s.sessionId);
                // Freeze the turn that just finished. Do not settle an
                // optimistic queued pending — auto-flush may already have
                // painted the next shell on this same ready.
                c.setMessages((prev) => {
                  const next = settleStreamingOnHostReady(prev);
                  if (next === prev) return prev;
                  if (s.sessionId) {
                    c.messagesBySessionRef.current.set(s.sessionId, next);
                  }
                  return next;
                });
                // Viewed-session backup: stream `done` can fire before the full
                // fence lands (or be missed). Non-viewed path already applies
                // below; viewed chats previously only relied on stream done.
                if (s.sessionId) {
                  void c.tryApplyAutomationFromSession(s.sessionId);
                }
              } else if (
                s.state === "streaming" ||
                s.state === "awaiting_permission"
              ) {
                // Runs for background chats too — each keeps its own start, so
                // returning to one mid-turn resumes instead of restarting.
                c.startTurnClock(s.sessionId);
              }
              // After a turn, rehydrate any longer journal body (missed stream
              // tail) and resolve `images/N.jpg` short paths into image cards.
              // Retry once: Host may still be flushing the final assistant row
              // when the ready event lands (early prompt_complete race).
              if (s.state === "ready") {
                const sid = s.sessionId;
                if (
                  isTurnDoneReadyTransition(prevLiveState, s.state) &&
                  sid
                ) {
                  scheduleJournalRehydrate(sid, 0);
                }
                applyResolvedRelativeMedia(
                  sid,
                  c.messagesBySessionRef.current.get(sid) ?? [],
                );
              }
            } else if (!isSessionBusy(s.state)) {
              if (c.viewingSessionIdRef.current === s.sessionId) {
                c.setRetryStatus(null);
              }
              // Backup apply path if stream `done` chunk was missed.
              if (s.sessionId) {
                void c.tryApplyAutomationFromSession(s.sessionId);
              }
            }
          }),
        );
        // Background / parked multi-session runtime (does not steal liveHost focus).
       track(
          listenWithRetry<SessionSnapshot>("session://runtime", (s) => {
            if (cancelled || !s.sessionId) return;
            const prevLiveState = c.liveMapRef.current[s.sessionId]?.state;
            let background = false;
            if (
              s.state === "ready" &&
              isTurnDoneReadyTransition(prevLiveState, s.state)
            ) {
              background = shouldMarkUnreadOnTurnDone({
                sessionId: s.sessionId,
                viewingSessionId: c.viewingSessionIdRef.current,
              });
              if (background) {
                markSessionUnread(s.sessionId);
              }
            }
            c.setLiveMap((prev) =>
              projectHostIntoLiveMap(prev, {
                sessionId: s.sessionId,
                state: s.state,
                streamingMessageId: s.streamingMessageId,
              }),
            );
            // Background / demoted turn finished → unread + desktop notify.
            if (
              s.state === "ready" &&
              isTurnDoneReadyTransition(prevLiveState, s.state)
            ) {
              if (
                shouldShowDesktopNotify(
                  "turn_done",
                  c.notifyPrefsRef.current,
                )
              ) {
                showDesktopNotification({
                  title: c.trRef.current("notify.turnDoneTitle"),
                  body: c.trRef.current("notify.turnDoneBody"),
                  tag: `turn-done-${s.sessionId}`,
                  sessionId: s.sessionId,
                  force: background,
                });
              }
            }
            // If user is viewing this demoted session, keep workbench state in sync.
            if (s.sessionId === c.viewingSessionIdRef.current) {
              c.setSession((prev) => ({
                ...prev,
                sessionId: s.sessionId,
                state: reconcileSessionState(s.state, prev.state),
                streamingMessageId: s.streamingMessageId,
                lastError: s.lastError ?? prev.lastError,
                title: s.title || prev.title,
              }));
              // Background turn finished while still viewing → heal missed stream tail.
              if (
                s.state === "ready" &&
                isTurnDoneReadyTransition(prevLiveState, s.state)
              ) {
                scheduleJournalRehydrate(s.sessionId, 0, {
                  clearStreaming: true,
                });
              }
              if (
                s.state !== "streaming" &&
                s.state !== "awaiting_permission"
              ) {
                c.setMessages((prev) => {
                  const next = settleStreamingOnHostReady(prev);
                  if (next === prev) return prev;
                  c.messagesBySessionRef.current.set(s.sessionId!, next);
                  return next;
                });
              }
            }
          }),
        );
        // Adaptive flush: longer on ≤8-core (Intel) laptops, snappier on high-core.
        const streamFlushMs = resolveStreamFlushMs();

        type HostToolEvent = {
          sessionId?: string;
          toolCallId?: string;
          title?: string;
          kind?: string;
          status?: string;
          path?: string | null;
          detail?: string | null;
          /** Call argument (target file / command / query) for primary labels. */
          input?: string | null;
          before?: string | null;
          after?: string | null;
        };

        // Batch high-frequency tool progress/detail into one setMessages apply.
        // Terminal statuses flush immediately so the Tasks panel stays honest.
        const applyToolBatchToUi = (events: HostToolEvent[]) => {
          if (cancelled || !events.length) return;
          // Group by session so multi-session tool traffic stays correct.
          const bySid = new Map<string, HostToolEvent[]>();
          for (const p of events) {
            const sid = p.sessionId || c.viewingSessionIdRef.current;
            if (!sid || !p.toolCallId) continue;
            const list = bySid.get(sid);
            if (list) list.push(p);
            else bySid.set(sid, [p]);
          }
          for (const [sid, list] of bySid) {
            c.patchSessionMessages(sid, (prev) => {
              let next = prev;
              for (const p of list) {
                next = applyToolEvent(next, p);
              }
              c.setLiveMap((lm) => {
                let m = projectLiveToolFromMessages(lm, sid, next);
                m = markSawToolActivity(m, sid);
                return m;
              });
              return next;
            });
            c.setSessionChangesById((prev) => {
              let listChanges = prev[sid] ?? [];
              let changed = false;
              for (const p of list) {
                const next = mergeSessionChange(listChanges, {
                  toolCallId: p.toolCallId,
                  title: p.title,
                  kind: p.kind,
                  status: p.status,
                  path: p.path,
                  detail: p.detail,
                  before: p.before,
                  after: p.after,
                });
                if (next !== listChanges) {
                  listChanges = next;
                  changed = true;
                }
              }
              if (!changed) return prev;
              return { ...prev, [sid]: listChanges };
            });
            c.startTurnClock(sid);
            if (sid === c.viewingSessionIdRef.current) {
              // Tool activity counts as progress — clear stall banner (I06).
              c.setStreamStall(null);
              // #544: CLI rejects Host optionId → turn cancels mid-tool with no
              // turn_error. Surface as local error deck so users see why work
              // stopped after ~1s (not a silent Ready).
              for (const p of list) {
                const st = (p.status || "").toLowerCase();
                if (st !== "failed" && st !== "error") continue;
                const blob = `${p.detail || ""}\n${p.title || ""}`.toLowerCase();
                if (
                  blob.includes("unknown permission option") ||
                  blob.includes("failed to request permission")
                ) {
                  const msg = (p.detail || p.title || "").trim();
                  if (msg) c.setLocalError(msg);
                  break;
                }
              }
            }
          }
        };
        toolEventCoalescer = new TimedBatchQueue<HostToolEvent>({
          flushMs: streamFlushMs,
          shouldFlushImmediate: (p) => toolEventNeedsImmediateFlush(p.status),
          onFlush: applyToolBatchToUi,
        });
        cleanups.push(() => toolEventCoalescer?.dispose());

        // Batch high-frequency stream tokens before React setState (long turns).
        const applyStreamToUi = (chunk: StreamPayload) => {
          if (cancelled) return;
          // Ignore empty terminal ticks that only flip done
          if (!chunk.text && !chunk.done) return;
          // Anti-replay vs late answer after early ready (see streamLateToken).
          // Busy/liveMap re-promotion stays gated via mayPromoteStreamingFromStreamChunk.
          const host = c.liveHostRef.current;
          const sidForChunk = chunk.sessionId || "";
          const cachedForChunk = sidForChunk
            ? (c.messagesBySessionRef.current.get(sidForChunk) ?? [])
            : [];
          const hostLive =
            !!sidForChunk &&
            ((host.sessionId === sidForChunk &&
              isSessionLiveStreaming(host.state)) ||
              isSessionLiveStreaming(
                c.liveMapRef.current[sidForChunk]?.state,
              ));
          const ignoreDone =
            !!chunk.done &&
            shouldIgnorePrematureStreamDone({
              hostLiveStreaming: hostLive,
              hasRunningTool: !!pickRunningTurnTool(cachedForChunk),
            });
          const effective: StreamPayload = ignoreDone
            ? { ...chunk, done: false }
            : chunk;
          if (chunk.text && chunk.sessionId) {
            const msgs =
              c.messagesBySessionRef.current.get(chunk.sessionId) ?? [];
            if (
              !shouldApplyLateStreamText({
                hostLiveStreaming: isSessionLiveStreaming(host.state),
                chunkIsForFocusedHost: chunk.sessionId === host.sessionId,
                messages: msgs,
              })
            ) {
              return;
            }
          }
          if (
            chunk.text &&
            chunk.sessionId === c.viewingSessionIdRef.current
          ) {
            c.setRetryStatus(null);
            // Progress clears stall banner (I06).
            c.setStreamStall(null);
          }
          // Multi-session busy projection for in-progress streams only.
          // Never re-promote a turn already settled to ready/idle (late/coalesced
          // tokens after host ready — issue #225 stuck sidebar spinner).
          if (chunk.sessionId && !effective.done) {
            c.setLiveMap((prev) => {
              const sid = chunk.sessionId!;
              if (
                !mayPromoteStreamingFromStreamChunk(prev[sid], {
                  done: effective.done,
                })
              ) {
                return prev;
              }
              return projectHostIntoLiveMap(prev, {
                sessionId: sid,
                state: "streaming",
                streamingMessageId: chunk.messageId ?? null,
              });
            });
          }
          if (effective.done && chunk.sessionId) {
            // Stamp unread before liveMap leaves `working` so the pet
            // done-bubble stays up (including unfocused viewing).
            if (
              shouldMarkUnreadOnTurnDone({
                sessionId: chunk.sessionId,
                viewingSessionId: c.viewingSessionIdRef.current,
              })
            ) {
              markSessionUnread(chunk.sessionId);
            }
            c.setLiveMap((prev) =>
              projectHostIntoLiveMap(prev, {
                sessionId: chunk.sessionId!,
                state: "ready",
                streamingMessageId: null,
              }),
            );
            // liveMap is already ready here, so session://state ready→ready
            // will not schedule a heal. Lift any journal tail the late-token
            // filter or a dropped IPC batch missed.
            if (
              shouldHealJournalOnStreamDone({
                isViewingSession:
                  chunk.sessionId === c.viewingSessionIdRef.current,
                streamDone: true,
              })
            ) {
              scheduleJournalRehydrate(chunk.sessionId, 0);
            }
          }
          c.patchSessionMessages(chunk.sessionId, (prev) => {
            const next = applyStreamChunk(prev, effective);
            // Keep cache in sync immediately so post-turn apply sees final text.
            if (chunk.sessionId) {
              c.messagesBySessionRef.current.set(chunk.sessionId, next);
            }
            return next;
          });
          if (chunk.sessionId && chunk.text) {
            c.setLiveMap((prev) =>
              markSawModelOutput(prev, chunk.sessionId!),
            );
          }
          // After a completed assistant stream, try silent automation create.
          if (effective.done && chunk.sessionId) {
            void c.tryApplyAutomationFromSession(chunk.sessionId);
          }
        };
        streamCoalescer = new StreamCoalescer({
          flushMs: streamFlushMs,
          onFlush: (raw) => {
            applyStreamToUi({
              sessionId: raw.sessionId ?? "",
              messageId: raw.messageId ?? "",
              text: raw.text ?? "",
              done: !!raw.done,
              kind: (raw.kind as StreamPayload["kind"]) || "assistant",
              thoughtPhase: raw.thoughtPhase ?? undefined,
            });
          },
        });
        cleanups.push(() => streamCoalescer?.dispose());
       track(
          listenWithRetry<StreamPayload>("session://stream", (chunk) => {
            if (cancelled) return;
            // Turn-end honesty: drain pending tool progress before applying done.
            if (chunk.done) toolEventCoalescer?.flushAll();
            streamCoalescer?.push(chunk);
          }),
        );
       track(
          listenWithRetry<{
            sessionId: string;
            message: ChatMessage;
            postStreamMessageId?: string | null;
          }>("session://interjection", (payload) => {
            if (cancelled || !payload?.sessionId || !payload.message?.id) {
              return;
            }
            // Only apply to the journal for that session; multi-session safe.
            // Seed post-steer streaming assistant + restart live thinking timer
            // so the UI does not freeze between ACK and the next token.
            c.patchSessionMessages(payload.sessionId, (prev) =>
              applyInterjection(
                prev,
                payload.message,
                payload.postStreamMessageId,
              ),
            );
            // Steering restarts the thinking episode for that chat — background
            // chats keep their own clock rather than borrowing the viewed one.
            c.restartTurnClock(payload.sessionId);
          }),
        );
       track(
          listenWithRetry<GeneratedImagePayload>(
            "session://generated_image",
            (p) => {
              if (cancelled || !p?.path) return;
              c.patchSessionMessages(p.sessionId, (prev) =>
                applyGeneratedImage(prev, p),
              );
            },
          ),
        );
       track(
          listenWithRetry<{
            sessionId?: string;
            messageId?: string;
            trigger?: string;
            tokensBefore?: number;
            tokensAfter?: number;
            summaryPreview?: string;
            note?: string;
            content?: string;
          }>("session://context_compact", (p) => {
            if (cancelled || !p) return;
            const sid = p.sessionId;
            if (!sid) return;
            const trigger = (p.trigger || "auto").toLowerCase();
            const isManual = trigger === "manual";
            const pending = c.pendingCompactBeforeRef.current;
            const pendingFresh =
              pending &&
              pending.sessionId === sid &&
              Date.now() - pending.at < 120_000
                ? pending
                : null;
            // Prefer agent tokensBefore; for manual compact, fall back to the
            // estimate captured in the confirm dialog so the banner can show a range.
            const tokensBefore = mergeCompactTokensBefore(
              p.tokensBefore,
              isManual ? pendingFresh?.tokensBefore : null,
            );
            if (pendingFresh && isManual) {
              c.pendingCompactBeforeRef.current = null;
            }
            const payload = { ...p, tokensBefore };
            c.patchSessionMessages(sid, (prev) =>
              applyContextCompact(prev, payload),
            );
            // Cost rollup: compact tokensAfter is a known context snapshot (not spend).
            if (p.tokensAfter != null) {
              const row = c.sessionsRef.current.find((s) => s.id === sid);
              const project = row?.projectId
                ? c.projectsRef.current.find((pr) => pr.id === row.projectId)
                : null;
              recordCostUsageSample(
                sampleFromUsageEvent({
                  sessionId: sid,
                  projectId: row?.projectId ?? null,
                  projectName: project?.name ?? null,
                  modelId: row?.modelId ?? null,
                  totalTokens: p.tokensAfter,
                  source: "journal_compact",
                }),
              );
              // Compact gives an authoritative post-compact snapshot — persist
              // it so a reopened session shows the real context size.
              saveSessionUsageSnapshot(sid, {
                totalTokens: p.tokensAfter,
                inputTokens: null,
                outputTokens: null,
                systemTokens: null,
                toolsTokens: null,
                historyTokens: null,
                cachedReadTokens: null,
                costUsdTicks: null,
                source: "compact",
              });
            }
            if (sid === c.viewingSessionIdRef.current) {
              c.setContextUsage((prev) =>
                reduceContextUsage(prev, {
                  type: "compact",
                  trigger: p.trigger,
                  tokensBefore,
                  tokensAfter: p.tokensAfter,
                  summaryPreview: p.summaryPreview,
                  note: p.note,
                  messageId: p.messageId,
                }),
              );
              const auto = !isManual;
              if (auto) {
                c.setToast(c.tr("compact.toastAuto"));
                window.setTimeout(() => c.setToast(null), 3200);
              }
            }
          }),
        );
       track(
          listenWithRetry<{
            sessionId?: string;
            totalTokens?: number;
            inputTokens?: number;
            outputTokens?: number;
            systemTokens?: number;
            toolsTokens?: number;
            historyTokens?: number;
            cachedReadTokens?: number;
            cacheCreationTokens?: number;
            reasoningTokens?: number;
            costUsdTicks?: number;
            modelCalls?: number;
            apiDurationMs?: number;
            costIsPartial?: boolean;
            usageIsIncomplete?: boolean;
            contextWindow?: number;
            percentage?: number;
            source?: string;
          }>("session://usage", (p) => {
            if (cancelled || !p) return;
            const sid = p.sessionId;
            if (!sid) return;
            ingestSessionSpend(sid, {
              source: p.source,
              inputTokens: p.inputTokens,
              outputTokens: p.outputTokens,
              totalTokens: p.totalTokens,
              cachedReadTokens: p.cachedReadTokens,
              reasoningTokens: p.reasoningTokens,
              modelCalls: p.modelCalls,
              apiDurationMs: p.apiDurationMs,
              costUsdTicks: p.costUsdTicks,
              costIsPartial: p.costIsPartial,
              usageIsIncomplete: p.usageIsIncomplete,
            });
            // Cost rollup: record known usage for any session (not only focused).
            const row = c.sessionsRef.current.find((s) => s.id === sid);
            const project = row?.projectId
              ? c.projectsRef.current.find((pr) => pr.id === row.projectId)
              : null;
            recordCostUsageSample(
              sampleFromUsageEvent({
                sessionId: sid,
                projectId: row?.projectId ?? null,
                projectName: project?.name ?? null,
                modelId: row?.modelId ?? null,
                inputTokens: p.inputTokens,
                outputTokens: p.outputTokens,
                totalTokens: p.totalTokens,
                source: p.source ?? "usage",
              }),
            );
            // Persist occupancy for ring restore (host journal has no turn usage).
            // Skip turn_completed multi-call billing sums — those inflate the
            // ring to 50–100% after short agentic turns (see contextUsage.ts).
            if (
              p.totalTokens != null &&
              !isLikelyBillingAggregateUsage({
                source: p.source,
                totalTokens: p.totalTokens,
                inputTokens: p.inputTokens,
                outputTokens: p.outputTokens,
                cachedReadTokens: p.cachedReadTokens,
              })
            ) {
              saveSessionUsageSnapshot(sid, {
                totalTokens: p.totalTokens,
                inputTokens: p.inputTokens ?? null,
                outputTokens: p.outputTokens ?? null,
                systemTokens: p.systemTokens ?? null,
                toolsTokens: p.toolsTokens ?? null,
                historyTokens: p.historyTokens ?? null,
                cachedReadTokens: p.cachedReadTokens ?? null,
                costUsdTicks: p.costUsdTicks ?? null,
                contextWindow: p.contextWindow ?? null,
                percentage: p.percentage ?? null,
                source: p.source ?? "usage",
              });
            }
            if (sid !== c.viewingSessionIdRef.current) return;
            c.setContextUsage((prev) =>
              reduceContextUsage(prev, {
                type: "usage",
                totalTokens: p.totalTokens,
                inputTokens: p.inputTokens,
                outputTokens: p.outputTokens,
                systemTokens: p.systemTokens,
                toolsTokens: p.toolsTokens,
                historyTokens: p.historyTokens,
                cachedReadTokens: p.cachedReadTokens,
                cacheCreationTokens: p.cacheCreationTokens,
                reasoningTokens: p.reasoningTokens,
                costUsdTicks: p.costUsdTicks,
                contextWindow: p.contextWindow,
                percentage: p.percentage,
                source: p.source,
              }),
            );
          }),
        );
       track(
          listenWithRetry<HostToolEvent>("session://tool", (p) => {
            if (cancelled || !p?.toolCallId) return;
            const sid = p.sessionId || c.viewingSessionIdRef.current;
            if (!sid) return;
            // Hooks debug: tool failures / hookSpecificOutput (Extensions → Hooks).
            // Keep immediate — not a React message path; failures should surface now.
            ingestToolHookSignal({
              title: p.title,
              kind: p.kind,
              status: p.status,
              detail: p.detail,
              path: p.path,
              toolCallId: p.toolCallId,
            });
            toolEventCoalescer?.push({ ...p, sessionId: sid });
            // ChatCut handoff → system default browser (EmbeddedBrowser cannot play media).
            // Run on each event (not only batch flush) so terminal handoffs open promptly.
            maybeOpenChatcutHandoffFromTool(c, p);
            // Conversation skill/plugin install → refresh App skills_list (debounced
            // in AppWorkbench). CLI hot-reloads skill files; App catalog is snapshot.
            if (toolEventSuggestsSkillCatalogChange(p)) {
              try {
                c.onSkillCatalogMaybeStale?.();
              } catch {
                /* never break the tool stream */
              }
            }
          }),
        );
       track(
          listenWithRetry<{
            sessionId?: string;
            kind?: string;
            eventName?: string;
            toolName?: string;
            ok?: boolean | null;
            detail?: string;
            update?: unknown;
          }>("session://hook", (p) => {
            if (cancelled || !p) return;
            // Structured ACP hook_execution / hook_annotation from Host.
            ingestHostHookPayload(p);
          }),
        );
       track(
          listenWithRetry<GoalOrchHostPayload>("session://goal", (p) => {
            if (cancelled || !p) return;
            // CLI 0.2.117+ goal_updated — soft-fail when CLI never emits.
            const ev = goalEventFromHostPayload(p);
            if (!ev) return;
            c.setGoalOrchEvents((prev) =>
              prependGoalOrchEvent(prev, ev, GOAL_ORCH_EVENT_MAX),
            );
          }),
        );
       track(
          listenWithRetry<{ line?: string }>("session://stderr", (p) => {
            if (cancelled || !p?.line) return;
            // Fallback: agent log lines that mention hooks (fail-open, timeouts, …).
            ingestHookLogLine(p.line);
          }),
        );
       track(
          listenWithRetry<{
            sessionId?: string;
            messageId?: string;
            marker?: string;
            reason?: string;
            content?: string;
          }>("session://turn_marker", (p) => {
            if (cancelled || !p) return;
            const sid = p.sessionId;
            if (!sid) return;
            // Drain coalesced tool/stream so marker sees final rows.
            flushHostCoalescers();
            c.patchSessionMessages(sid, (prev) => applyTurnMarker(prev, p));
            // Turn is over — any gate it raised can no longer be answered.
            c.clearPendingGatesRef.current(sid);
            c.clearTurnClock(sid);
            if (sid === c.viewingSessionIdRef.current) {
              c.setStreamStall(null);
            }
          }),
        );
       track(
          listenWithRetry<{ sessionId?: string; reason?: string }>(
            "session://idle_recycled",
            (p) => {
              if (cancelled || !p) return;
              // Process gone — never leave sidebar spinner on a recycled chat.
              if (p.sessionId) {
                c.setLiveMap((prev) =>
                  settleStoppedSessionInLiveMap(prev, p.sessionId!),
                );
              }
              if (p.reason === "capacity") {
                // Housekeeping, NOT a failure: Host reclaimed an *idle parked*
                // chat so this spawn could proceed. Reporting it as "process
                // limit reached" made a successful connect look broken, and
                // claimed every slot was running a task when none was.
                c.setToast(c.tr("agent.capacityRecycledToast"));
                window.setTimeout(() => c.setToast(null), 4200);
                return;
              }
              // Toast when the focused (or unknown) session was idle-recycled.
              if (
                !p.sessionId ||
                p.sessionId === c.viewingSessionIdRef.current
              ) {
                c.setToast(c.tr("agent.idleRecycledToast"));
                window.setTimeout(() => c.setToast(null), 4200);
              }
            },
          ),
        );
       track(
          listenWithRetry<{ reason?: string; killed?: number }>(
            "session://agents_recycled",
            (p) => {
              if (cancelled || !p) return;
              // session_data_mode flip, custom provider route apply (#376), CLI upgrade, etc.
              // Mid-turn hard ends also journal turn_cancelled|<reason> chips; toast is a
              // short global hint (transcript chip is the durable source of truth).
              if (p.reason === "cli_upgrade") {
                c.setToast(c.tr("endOfTurn.cliUpgrade"));
                window.setTimeout(() => c.setToast(null), 4800);
                return;
              }
              if (p.reason === "app_update") {
                c.setToast(c.tr("endOfTurn.appUpdate"));
                window.setTimeout(() => c.setToast(null), 4800);
                return;
              }
              if (p.reason === "provider_route" || p.reason === "account_auth") {
                // Model / provider switch — the picker already shows the new
                // route. Login/logout/account switch: UI already refreshed;
                // no data-mode toast (would mislead as "histories not merged").
                return;
              }
              if (
                p.reason === "session_data_mode" ||
                (p.killed != null && p.killed > 0)
              ) {
                c.setToast(c.tr("agent.dataModeRecycledToast"));
                window.setTimeout(() => c.setToast(null), 4800);
              }
            },
          ),
        );
        // #524 + plan gates: agent recycled / exited while a human gate was open —
        // drop stale Approve (permission / plan / ask_user) so UI never writes to
        // a dead stdin. Host payload includes planRpcId / askUserRpcId.
       track(
          listenWithRetry<{
            reason?: string;
            sessions?: Array<{
              sessionId?: string;
              permissionRpcId?: number | null;
              planRpcId?: number | null;
              askUserRpcId?: number | null;
            }>;
          }>("session://permissions_invalidated", (p) => {
            if (cancelled || !p) return;
            const sessions = Array.isArray(p.sessions) ? p.sessions : [];
            const viewing = c.viewingSessionIdRef.current;
            const planMap = c.planBySessionRef?.current as
              | Map<string, import("@/lib/planSession").SessionPlanState>
              | undefined;

            const dropPlanGate = (sid: string) => {
              if (!planMap) return;
              if (sid === viewing) {
                c.setPlan(
                  (prev: import("@/lib/planSession").SessionPlanState) => {
                    const next = invalidatePlanGate(prev);
                    planMap.set(sid, next);
                    c.markPlanPendingBadge?.(sid, next);
                    return next;
                  },
                );
                return;
              }
              const base = planMap.get(sid);
              if (!base) return;
              const next = invalidatePlanGate(base);
              planMap.set(sid, next);
              c.markPlanPendingBadge?.(sid, next);
            };

            for (const row of sessions) {
              const sid = row?.sessionId;
              if (!sid) continue;
              c.pendingPermBySessionRef.current.delete(sid);
              c.pendingAskUserBySessionRef.current.delete(sid);
              // Session listed ⇒ process/gates gone; drop plan Approve even if
              // planRpcId was already taken in Host before emit.
              dropPlanGate(sid);
              c.clearPendingGatesRef.current?.(sid);
              if (sid === viewing) {
                c.setPerm(null);
                c.setAskUser?.(null);
              }
            }
            // Also clear any focused permission that lost its process even if
            // the payload omitted session ids (older hosts).
            if (!sessions.length) {
              c.pendingPermBySessionRef.current.clear();
              c.pendingAskUserBySessionRef.current.clear();
              c.setPerm(null);
              c.setAskUser?.(null);
              if (viewing) dropPlanGate(viewing);
            }
          }),
        );
       track(
          listenWithRetry<{ reason?: string }>(
            "session://agent_soft_respawn",
            (p) => {
              if (cancelled || !p) return;
              // Spawn flags / extensions changed while an agent was live.
              c.setToast(c.tr("agent.softRespawnToast"));
              window.setTimeout(() => c.setToast(null), 3600);
            },
          ),
        );
       track(
          listenWithRetry<{
            sessionId?: string;
            stopReason?: string;
            toolCount?: number;
          }>("session://turn_empty_run", (p) => {
            if (cancelled || !p) return;
            // Host already force-ended; ensure sidebar liveMap leaves busy even if
            // stream `done` / state event was lost (issue #225).
            if (p.sessionId) {
              c.setLiveMap((prev) =>
                settleStoppedSessionInLiveMap(prev, p.sessionId!),
              );
              if (p.sessionId === c.viewingSessionIdRef.current) {
                c.setSession((prev) =>
                  settleStoppedSessionSnapshot(prev, p.sessionId!),
                );
                c.setLiveHost((prev) => {
                  const next = settleStoppedSessionSnapshot(prev, p.sessionId!);
                  c.liveHostRef.current = next;
                  return next;
                });
                c.setMessages((prev) => {
                  if (!prev.some((m) => m.streaming)) return prev;
                  const next = prev.map((m) =>
                    m.streaming ? { ...m, streaming: false } : m,
                  );
                  c.messagesBySessionRef.current.set(p.sessionId!, next);
                  return next;
                });
              }
            }
            if (
              p.sessionId &&
              p.sessionId !== c.viewingSessionIdRef.current
            ) {
              return;
            }
            c.setToast(c.tr("session.emptyRunToast"));
            window.setTimeout(() => c.setToast(null), 7200);
          }),
        );
       track(
          listenWithRetry<{
            sessionId?: string;
            code?: string;
            message?: string;
            maxConcurrentAgents?: number;
          }>("session://process_limit", (p) => {
            if (cancelled || !p) return;
            // Remember for process-budget UI (Settings pool / Reliability).
            const ev = parseProcessLimitEvent(p, Date.now());
            if (ev) c.setLastProcessLimit(ev);
            c.setToast(c.tr("agent.processLimitToast"));
            window.setTimeout(() => c.setToast(null), 5200);
            if (
              !p.sessionId ||
              p.sessionId === c.viewingSessionIdRef.current
            ) {
              c.setLocalError(
                p.message
                  ? `PROCESS_LIMIT: ${p.message}`
                  : "PROCESS_LIMIT",
              );
            }
          }),
        );
       track(
          listenWithRetry<{
            sessionId?: string;
            stallSeconds?: number;
            code?: string;
            message?: string;
            tier?: string;
            sawModelOutput?: boolean;
            sawToolActivity?: boolean;
          }>("session://stream_stall", (p) => {
            if (cancelled || !p) return;
            // Only prompt for the viewed session (or unknown id).
            if (
              p.sessionId &&
              p.sessionId !== c.viewingSessionIdRef.current
            ) {
              return;
            }
            const secs =
              typeof p.stallSeconds === "number" && p.stallSeconds > 0
                ? Math.round(p.stallSeconds)
                : c.streamStallSeconds;
            // Merge journal evidence so we never show pre-token after a full answer.
            const sid = p.sessionId || c.viewingSessionIdRef.current || "";
            if (sid) {
              c.setLiveMap((prev) => {
                const msgs = c.messagesBySessionRef.current.get(sid) ?? [];
                let next = mergeTurnProgressFromMessages(prev, sid, msgs);
                if (p.sawModelOutput) {
                  next = markSawModelOutput(next, sid);
                }
                if (p.sawToolActivity) {
                  next = markSawToolActivity(next, sid);
                }
                return next;
              });
            }
            c.setStreamStall({
              sessionId: p.sessionId,
              stallSeconds: secs,
              tier: p.tier,
              sawModelOutput: p.sawModelOutput,
              sawToolActivity: p.sawToolActivity,
            });
            // Reliability center ring — title resolved at view assembly time.
            const activeStall = reliabilityStallFromEvent({
              kind: "active",
              sessionId: p.sessionId ?? null,
              stallSeconds: secs,
              tier: p.tier ?? null,
              reason: "stall",
            });
            c.setRecentStallSignals((prev) =>
              prependReliabilityRing(
                prev,
                activeStall,
                DEFAULT_RELIABILITY_MAX_STALLS,
              ),
            );
            // Persist stall timeline (localStorage ring; no secrets).
            recordStallHistoryFromSignal(activeStall);
          }),
        );
        // Long-tool heartbeat: Host re-armed stall; clear soft banner for this chat.
       track(
          listenWithRetry<{
            sessionId?: string;
            toolCallIds?: string[];
            openCount?: number;
          }>("session://tool_heartbeat", (p) => {
            if (cancelled || !p?.sessionId) return;
            const sid = p.sessionId;
            c.setLiveMap((prev) => markSawToolActivity(prev, sid));
            if (sid === c.viewingSessionIdRef.current) {
              c.setStreamStall(null);
            }
          }),
        );
       track(
          listenWithRetry<{
            sessionId?: string;
            stallSeconds?: number;
            code?: string;
          }>("session://stream_stall_hard_end", (p) => {
            if (cancelled || !p) return;
            c.setStreamStall(null);
            const hardEndStall = reliabilityStallFromEvent({
              kind: "hard_end",
              sessionId: p.sessionId ?? null,
              stallSeconds:
                typeof p.stallSeconds === "number" ? p.stallSeconds : null,
              reason: "stall",
            });
            c.setRecentStallSignals((prev) =>
              prependReliabilityRing(
                prev,
                hardEndStall,
                DEFAULT_RELIABILITY_MAX_STALLS,
              ),
            );
            // Persist stall timeline (localStorage ring; no secrets).
            recordStallHistoryFromSignal(hardEndStall);
            // Host force-ended the turn (runtime Ready already emitted). Settle
            // client projection so the sidebar cannot stay spinning if a late
            // stream token races after this event (issue #225).
            if (p.sessionId) {
              c.setLiveMap((prev) =>
                settleStoppedSessionInLiveMap(prev, p.sessionId!),
              );
              if (p.sessionId === c.viewingSessionIdRef.current) {
                c.setSession((prev) =>
                  settleStoppedSessionSnapshot(prev, p.sessionId!),
                );
                c.setLiveHost((prev) => {
                  const next = settleStoppedSessionSnapshot(prev, p.sessionId!);
                  c.liveHostRef.current = next;
                  return next;
                });
                c.setMessages((prev) => {
                  if (!prev.some((m) => m.streaming)) return prev;
                  return prev.map((m) =>
                    m.streaming ? { ...m, streaming: false } : m,
                  );
                });
              }
            }
            if (
              !p.sessionId ||
              p.sessionId === c.viewingSessionIdRef.current
            ) {
              c.setToast(c.tr("agent.streamStallHardEndToast"));
              window.setTimeout(() => c.setToast(null), 4200);
            }
          }),
        );
       track(
          listenWithRetry<{
            attempt?: number;
            maxRetries?: number;
            reason?: string;
            aborting?: boolean;
            sessionId?: string;
          }>("session://retry", (p) => {
            if (cancelled) return;
            // Retry chip is only meaningful on the viewed live session.
            if (
              p.sessionId &&
              p.sessionId !== c.viewingSessionIdRef.current
            ) {
              return;
            }
            if (
              c.liveHostRef.current.sessionId &&
              c.liveHostRef.current.sessionId !== c.viewingSessionIdRef.current
            ) {
              return;
            }
            const attempt = p.attempt ?? 0;
            const maxRetries = p.maxRetries ?? 12;
            const reason = (p.reason || "").trim();
            c.setRetryStatus({ attempt, maxRetries, reason });
          }),
        );
       track(
          listenWithRetry<TurnErrorPayload>("session://turn_error", (p) => {
            if (cancelled) return;
            c.clearPendingGatesRef.current(p.sessionId);
            if (p.sessionId === c.viewingSessionIdRef.current) {
              c.setRetryStatus(null);
            }
            c.patchSessionMessages(p.sessionId, (prev) =>
              applyTurnError(prev, p, c.localeRef.current),
            );
          }),
        );
       track(
          listenWithRetry<PermissionPayload>("session://permission", (p) => {
            if (cancelled) return;
            // Park it against its session so returning to that chat can answer.
            if (p.sessionId) {
              c.pendingPermBySessionRef.current.set(p.sessionId, p);
            }
            // Only surface the bar when viewing the session that needs it.
            if (
              p.sessionId &&
              p.sessionId !== c.viewingSessionIdRef.current
            ) {
              // Multi-session stream: another chat needs approval — nudge user.
              c.setToast(c.trRef.current("session.backgroundPermission"));
              window.setTimeout(() => c.setToast(null), 4200);
              if (
                shouldShowDesktopNotify(
                  "permission",
                  c.notifyPrefsRef.current,
                )
              ) {
                showDesktopNotification({
                  title: c.trRef.current("notify.permissionTitle"),
                  body: c.trRef.current("session.backgroundPermission"),
                  tag: `perm-bg-${p.sessionId || p.rpcId}`,
                  force: true,
                  sessionId: p.sessionId ?? null,
                });
              }
              return;
            }
            c.setPerm(p);
            if (
              shouldShowDesktopNotify("permission", c.notifyPrefsRef.current)
            ) {
              showDesktopNotification({
                title: c.trRef.current("notify.permissionTitle"),
                body: c.trRef.current("notify.permissionBody"),
                tag: `perm-${p.sessionId || p.rpcId}`,
                force: true,
                sessionId: p.sessionId ?? null,
              });
            }
          }),
        );
       track(
          listenWithRetry<AskUserPayload>("session://ask_user", (p) => {
            if (cancelled) return;
            // rpcId may legitimately be 0 (JSON-RPC ids start at 0). A truthy
            // guard here used to drop id=0 questions, so the modal never showed
            // and the turn hung until cancelled.
            if (!isValidAskUserPayload(p)) {
              return;
            }
            if (p.sessionId) {
              c.pendingAskUserBySessionRef.current.set(p.sessionId, p);
            }
            if (
              p.sessionId &&
              p.sessionId !== c.viewingSessionIdRef.current
            ) {
              // Background chat asked a question — answer it on reopen.
              c.setToast(c.trRef.current("session.backgroundPermission"));
              window.setTimeout(() => c.setToast(null), 4200);
              if (
                shouldShowDesktopNotify("ask_user", c.notifyPrefsRef.current)
              ) {
                showDesktopNotification({
                  title: c.trRef.current("notify.askUserTitle"),
                  body: c.trRef.current("notify.askUserBody"),
                  tag: `ask-bg-${p.sessionId || p.rpcId}`,
                  force: true,
                  sessionId: p.sessionId ?? null,
                });
              }
              return;
            }
            c.setAskUser(p);
            // Agent is blocked on an answer — same as permission bar.
            if (
              shouldShowDesktopNotify("ask_user", c.notifyPrefsRef.current)
            ) {
              showDesktopNotification({
                title: c.trRef.current("notify.askUserTitle"),
                body: c.trRef.current("notify.askUserBody"),
                tag: `ask-${p.sessionId || p.rpcId}`,
                force: true,
                sessionId: p.sessionId ?? null,
              });
            }
          }),
        );
        // Host stop / interject auto-cancels pending questionnaires — drop the modal.
       track(
          listenWithRetry<{ sessionId?: string; reason?: string }>(
            "session://ask_user_cleared",
            (p) => {
              if (cancelled) return;
              const sid = p?.sessionId?.trim();
              if (!sid) return;
              c.clearPendingGatesRef.current(sid);
              if (sid === c.viewingSessionIdRef.current) {
                c.setAskUser(null);
              }
            },
          ),
        );
       track(
          listenWithRetry<{
            entries?: unknown[];
            body?: string | null;
            sessionId?: string;
            rpcId?: number | null;
            toolCallId?: string | null;
            waiting?: boolean;
          }>("session://plan", (p) => {
            if (cancelled) return;
            const readyTitle = c.trRef.current("plan.ready");
            const composerMode = c.modeRef.current;
            const targetSid =
              (p.sessionId && p.sessionId.trim()) ||
              c.viewingSessionIdRef.current ||
              null;

            const planJustCompleted = (
              prev: PlanState,
              next: PlanState,
              sid: string | null,
            ) => {
              if (!sid) return;
              const prevProg = computePlanProgress(
                parsePlanEntries(prev.entries),
              );
              const nextProg = computePlanProgress(
                parsePlanEntries(next.entries),
              );
              const wasDone =
                prevProg.total > 0 &&
                prevProg.completed + prevProg.cancelled >= prevProg.total &&
                prevProg.inProgress === 0 &&
                prevProg.pending === 0;
              const nowDone =
                nextProg.total > 0 &&
                nextProg.completed + nextProg.cancelled >= nextProg.total &&
                nextProg.inProgress === 0 &&
                nextProg.pending === 0;
              if (!nowDone || wasDone) return;
              const cycleKey = `${sid}|${next.toolCallId ?? "notool"}`;
              if (c.planCompletedRecordedRef.current.has(cycleKey)) return;
              c.planCompletedRecordedRef.current.add(cycleKey);
              // Bound the dedupe set.
              if (c.planCompletedRecordedRef.current.size > 80) {
                const first = c.planCompletedRecordedRef.current.values().next()
                  .value;
                if (first != null) c.planCompletedRecordedRef.current.delete(first);
              }
              const bodyMd = planDisplayMarkdown(next.body, next.entries);
              if (!bodyMd.trim()) return;
              const row = c.sessionsRef.current.find((s) => s.id === sid);
              const sessionTitle = row?.title?.trim() || undefined;
              try {
                recordPlanHistory({
                  sessionId: sid,
                  decision: "completed",
                  title: sessionTitle,
                  bodyPreview: bodyMd,
                });
              } catch {
                /* private mode */
              }
            };

            // Background session: keep plan cache warm without stealing the bar.
            if (
              p.sessionId &&
              p.sessionId !== c.viewingSessionIdRef.current
            ) {
              const prev =
                c.planBySessionRef.current.get(p.sessionId) ??
                emptySessionPlan(readyTitle);
              const next = mergePlanFromEvent(
                prev,
                p,
                readyTitle,
                composerMode,
              );
              c.planBySessionRef.current.set(p.sessionId, next);
              c.markPlanPendingBadge?.(p.sessionId, next);
              planJustCompleted(prev, next, p.sessionId);
              void api
                .sessionPlanChromeSet(p.sessionId, planStateToStored(next))
                .catch(() => {});
              // exit_plan_mode gate on a demoted turn — nudge like permission bar.
              const becameReview =
                next.rpcId != null &&
                (prev.rpcId == null || !prev.visible) &&
                next.visible &&
                !next.userClosed;
              if (becameReview) {
                c.setToast(c.trRef.current("session.backgroundPlan"));
                window.setTimeout(() => c.setToast(null), 4200);
                if (
                  shouldShowDesktopNotify(
                    "permission",
                    c.notifyPrefsRef.current,
                  )
                ) {
                  showDesktopNotification({
                    title: c.trRef.current("plan.ready"),
                    body: c.trRef.current("session.backgroundPlan"),
                    tag: `plan-bg-${p.sessionId}-${next.rpcId}`,
                    force: true,
                    sessionId: p.sessionId,
                  });
                }
              }
              return;
            }

            c.setPlan((prev) => {
              const next = mergePlanFromEvent(
                prev,
                p,
                readyTitle,
                composerMode,
              );
              // Suppressed hard-dismiss: no UI thrash.
              if (prev.userClosed && next.userClosed) {
                return prev;
              }
              const becameReview =
                next.rpcId != null &&
                (prev.rpcId == null || !prev.visible);
              if (becameReview && next.visible && !next.userClosed) {
                // Auto-open resource Plan workbench when gate is ready.
                // c.openAsidePane grows the window first, then clamps aside.
                queueMicrotask(() => {
                  c.planOpenedAsideRef.current = true;
                  c.openAsidePaneRef.current();
                  c.setPlanFocusKey((k) => k + 1);
                });
              }
              if (targetSid) {
                c.planBySessionRef.current.set(targetSid, next);
                c.markPlanPendingBadge?.(targetSid, next);
                planJustCompleted(prev, next, targetSid);
                void api
                  .sessionPlanChromeSet(targetSid, planStateToStored(next))
                  .catch(() => {});
              }
              return next;
            });
          }),
        );
       track(
          listenWithRetry<{ sessionId?: string; title?: string }>(
            "session://title",
            (p) => {
              if (cancelled || !p.sessionId || !p.title) return;
              c.setSessions((list) =>
                list.map((s) =>
                  s.id === p.sessionId ? { ...s, title: p.title! } : s,
                ),
              );
              c.setSession((prev) =>
                prev.sessionId === p.sessionId
                  ? { ...prev, title: p.title! }
                  : prev,
              );
              c.setLiveHost((prev) =>
                prev.sessionId === p.sessionId
                  ? { ...prev, title: p.title! }
                  : prev,
              );
            },
          ),
        );
        // Remote IM wrote sessions_index / messages.json — refresh sidebar +
        // reload journal if the user is currently viewing that session.
       track(
          listenWithRetry<{ sessionId?: string; source?: string }>(
            "session://index_changed",
            (p) => {
              if (cancelled) return;
              void (async () => {
                try {
                  const list = await api.sessionsList();
                  if (cancelled) return;
                  c.setSessions(list.map(mapSessionListRow));
                  c.setSessions(list.map((s) => mapSessionListRow(s)));
                  const sid = p?.sessionId;
                  if (
                    !sid ||
                    c.viewingSessionIdRef.current !== sid ||
                    c.openingSessionIdRef.current
                  ) {
                    return;
                  }
                  // Drop cache so preferSessionMessages cannot hide disk IM turns.
                  c.messagesBySessionRef.current.delete(sid);
                  const stored = await api.sessionMessages(sid);
                  if (cancelled || c.viewingSessionIdRef.current !== sid) return;
                  // Same mapper as openSession — keep attachments on IM reload.
                  const mapped = mapStoredMessagesToChat(stored);
                  const woven = weaveToolsIntoAssistantSegments(mapped);
                  c.messagesBySessionRef.current.set(sid, woven);
                  c.setMessages(woven);
                } catch {
                  /* ignore */
                }
              })();
            },
          ),
        );
        // Give successful listener registrations a chance to settle before
        // hydrating the snapshot. A broken channel must not block startup
        // forever: listenWithRetry keeps retrying independently, while this
        // bounded barrier lets snapshot/journal hydration compensate for any
        // subscription that is still unavailable.
        await Promise.race([
          Promise.allSettled(registrationPromises),
          new Promise<void>((resolve) => window.setTimeout(resolve, 1000)),
        ]);
        await hydrateInitialSnapshot().catch((e) => {
          if (!cancelled) {
            console.warn("[host-events] initial snapshot failed", e);
          }
        });
        const initialSid = c.viewingSessionIdRef.current;
        if (initialSid) scheduleJournalRehydrate(initialSid, 0);
      } catch (e) {
        if (!cancelled) c.setLocalError(String(e));
      }
    })();

    return () => {
      cancelled = true;
      cleanups.forEach((u) => u());
    };
  
  }, [patchSessionMessages, tryApplyAutomationFromSession]);
}

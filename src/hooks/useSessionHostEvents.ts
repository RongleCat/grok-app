// @ts-nocheck — lifted Host listeners; ctx bag typed loosely during residual extract.
/**
 * Host session event subscriptions (session://state, stream, tools, ...).
 * Extracted from AppWorkbench (residual-appworkbench).
 */
import { useEffect, useRef } from "react";
import * as api from "@/lib/api";
import { isMirrorClient } from "@/lib/mirrorTransport";
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
  upgradeMessagesFromJournal,
  weaveToolsIntoAssistantSegments,
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
} from "@/lib/contextUsage";
import {
  emptySessionPlan,
  mergePlanFromEvent,
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
import { mapSessionListRow } from "@/lib/app/sidebarModels";
import {
  StreamCoalescer,
  TimedBatchQueue,
  resolveStreamFlushMs,
  toolEventNeedsImmediateFlush,
} from "@/lib/streamCoalesce";

/** Mutable bag of AppWorkbench bindings used by Host event handlers. */
export type SessionHostEventsCtx = {
  [key: string]: unknown;
  patchSessionMessages: (
    targetSessionId: string | undefined | null,
    reduce: (prev: ChatMessage[]) => ChatMessage[],
  ) => void;
  tryApplyAutomationFromSession: (sessionId: string) => void | Promise<void>;
};

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

    const track = async (p: Promise<() => void>) => {
      const un = await p;
      if (cancelled) {
        un();
      } else {
        cleanups.push(un);
      }
    };

    void (async () => {
      try {
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
            if (!secondary) {
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

        await track(
          api.listen<SessionSnapshot>("session://state", (s) => {
            if (cancelled) return;
            // Host focus slot (the process under the live cursor). Multi-session
            // busy demotions also emit session://runtime so liveMap stays honest.
            const prevLiveState = s.sessionId
              ? c.liveMapRef.current[s.sessionId]?.state
              : undefined;
            c.setLiveHost(s);
            c.liveHostRef.current = s;
            c.setLiveMap((prev) =>
              projectHostIntoLiveMap(prev, {
                sessionId: s.sessionId,
                state: s.state,
                streamingMessageId: s.streamingMessageId,
              }),
            );
            // Background turn finished while user is elsewhere → unread dot.
            // Mute only suppresses desktop notify; unread still applies.
            if (
              s.sessionId &&
              s.state === "ready" &&
              isTurnDoneReadyTransition(prevLiveState, s.state) &&
              shouldMarkUnreadOnTurnDone({
                sessionId: s.sessionId,
                viewingSessionId: c.viewingSessionIdRef.current,
              })
            ) {
              markSessionUnread(s.sessionId);
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
                c.setTurnStartedAt(null);
                // Ensure no assistant is left with streaming=true after the turn
                // (missed done chunk) — otherwise the next send can bind to it.
                c.setMessages((prev) => {
                  if (!prev.some((m) => m.streaming)) return prev;
                  const next = prev.map((m) =>
                    m.streaming ? { ...m, streaming: false } : m,
                  );
                  if (s.sessionId) {
                    c.messagesBySessionRef.current.set(s.sessionId, next);
                  }
                  return next;
                });
                if (
                  s.state === "ready" &&
                  shouldShowDesktopNotify(
                    "turn_done",
                    c.notifyPrefsRef.current,
                  )
                ) {
                  const turnSid = s.sessionId || null;
                  showDesktopNotification({
                    title: c.trRef.current("notify.turnDoneTitle"),
                    body: c.trRef.current("notify.turnDoneBody"),
                    tag: `turn-done-${turnSid || "x"}`,
                    sessionId: turnSid,
                  });
                }
              } else if (
                (s.state === "streaming" || s.state === "awaiting_permission") &&
                s.sessionId === c.viewingSessionIdRef.current
              ) {
                c.setTurnStartedAt((prev) => prev ?? Date.now());
              }
              // After a turn, rehydrate any longer journal body (missed stream
              // tail) and resolve `images/N.jpg` short paths into image cards.
              if (s.state === "ready") {
                const sid = s.sessionId;
                if (
                  isTurnDoneReadyTransition(prevLiveState, s.state) &&
                  sid
                ) {
                  void api
                    .sessionMessages(sid)
                    .then((stored) => {
                      if (
                        cancelled ||
                        c.viewingSessionIdRef.current !== sid
                      ) {
                        return;
                      }
                      const mapped = mapStoredMessagesToChat(stored);
                      const woven = weaveToolsIntoAssistantSegments(mapped);
                      c.setMessages((prev) => {
                        const next = upgradeMessagesFromJournal(prev, woven);
                        if (next !== prev) {
                          c.messagesBySessionRef.current.set(sid, next);
                        }
                        return next;
                      });
                    })
                    .catch(() => {
                      /* journal rehydrate is best-effort */
                    });
                }
                c.setMessages((prev) => {
                  const rels = collectSessionRelativeMediaRefs(prev);
                  if (!rels.length) return prev;
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
                        name:
                          a.name ||
                          a.path.split(/[/\\]/).pop() ||
                          a.path,
                        isDir: !!a.isDir,
                      }));
                      c.setMessages((cur) =>
                        applyResolvedSessionMedia(cur, resolved),
                      );
                    })
                    .catch(() => {
                      /* ignore */
                    });
                  return prev;
                });
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
        await track(
          api.listen<SessionSnapshot>("session://runtime", (s) => {
            if (cancelled || !s.sessionId) return;
            const prevLiveState = c.liveMapRef.current[s.sessionId]?.state;
            c.setLiveMap((prev) =>
              projectHostIntoLiveMap(prev, {
                sessionId: s.sessionId,
                state: s.state,
                streamingMessageId: s.streamingMessageId,
              }),
            );
            // Background turn finished (demoted agent) → unread; mute is separate.
            if (
              s.state === "ready" &&
              isTurnDoneReadyTransition(prevLiveState, s.state) &&
              shouldMarkUnreadOnTurnDone({
                sessionId: s.sessionId,
                viewingSessionId: c.viewingSessionIdRef.current,
              })
            ) {
              markSessionUnread(s.sessionId);
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
                const sid = s.sessionId;
                void api
                  .sessionMessages(sid)
                  .then((stored) => {
                    if (
                      cancelled ||
                      c.viewingSessionIdRef.current !== sid
                    ) {
                      return;
                    }
                    const mapped = mapStoredMessagesToChat(stored);
                    const woven = weaveToolsIntoAssistantSegments(mapped);
                    c.setMessages((prev) => {
                      const cleared = prev.map((m) =>
                        m.streaming ? { ...m, streaming: false } : m,
                      );
                      const next = upgradeMessagesFromJournal(cleared, woven);
                      c.messagesBySessionRef.current.set(sid, next);
                      return next;
                    });
                  })
                  .catch(() => {
                    /* best-effort */
                  });
              }
              if (
                s.state !== "streaming" &&
                s.state !== "awaiting_permission"
              ) {
                c.setMessages((prev) => {
                  if (!prev.some((m) => m.streaming)) return prev;
                  const next = prev.map((m) =>
                    m.streaming ? { ...m, streaming: false } : m,
                  );
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
            if (sid === c.viewingSessionIdRef.current) {
              c.setTurnStartedAt((t) => t ?? Date.now());
              // Tool activity counts as progress — clear stall banner (I06).
              c.setStreamStall(null);
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
          // Anti-replay: only drop when the *same* focused host session is idle.
          // Multi-session: background turns keep streaming after switch — never
          // gate on liveHost.state alone (that monopolizes the focused chat).
          const host = c.liveHostRef.current;
          if (
            chunk.text &&
            chunk.sessionId &&
            chunk.sessionId === host.sessionId &&
            !isSessionLiveStreaming(host.state)
          ) {
            return;
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
          if (chunk.sessionId && !chunk.done) {
            c.setLiveMap((prev) => {
              const sid = chunk.sessionId!;
              if (
                !mayPromoteStreamingFromStreamChunk(prev[sid], {
                  done: chunk.done,
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
          if (chunk.done && chunk.sessionId) {
            c.setLiveMap((prev) =>
              projectHostIntoLiveMap(prev, {
                sessionId: chunk.sessionId!,
                state: "ready",
                streamingMessageId: null,
              }),
            );
            // Stream done for a non-viewed session → unread (mute still allows this).
            if (
              shouldMarkUnreadOnTurnDone({
                sessionId: chunk.sessionId,
                viewingSessionId: c.viewingSessionIdRef.current,
              })
            ) {
              markSessionUnread(chunk.sessionId);
            }
          }
          c.patchSessionMessages(chunk.sessionId, (prev) => {
            const next = applyStreamChunk(prev, chunk);
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
          if (chunk.done && chunk.sessionId) {
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
        await track(
          api.listen<StreamPayload>("session://stream", (chunk) => {
            if (cancelled) return;
            // Turn-end honesty: drain pending tool progress before applying done.
            if (chunk.done) toolEventCoalescer?.flushAll();
            streamCoalescer?.push(chunk);
          }),
        );
        await track(
          api.listen<{ sessionId: string; message: ChatMessage }>(
            "session://interjection",
            (payload) => {
              if (cancelled || !payload?.sessionId || !payload.message?.id) {
                return;
              }
              // Only apply to the journal for that session; multi-session safe.
              c.patchSessionMessages(payload.sessionId, (prev) =>
                applyInterjection(prev, payload.message),
              );
            },
          ),
        );
        await track(
          api.listen<GeneratedImagePayload>(
            "session://generated_image",
            (p) => {
              if (cancelled || !p?.path) return;
              c.patchSessionMessages(p.sessionId, (prev) =>
                applyGeneratedImage(prev, p),
              );
            },
          ),
        );
        await track(
          api.listen<{
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
              c.setToast(
                auto
                  ? c.tr("compact.toastAuto")
                  : c.tr("compact.toastManual"),
              );
              window.setTimeout(() => c.setToast(null), 3200);
            }
          }),
        );
        await track(
          api.listen<{
            sessionId?: string;
            totalTokens?: number;
            inputTokens?: number;
            outputTokens?: number;
            systemTokens?: number;
            toolsTokens?: number;
            historyTokens?: number;
            source?: string;
          }>("session://usage", (p) => {
            if (cancelled || !p) return;
            const sid = p.sessionId;
            if (!sid) return;
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
                source: p.source,
              }),
            );
          }),
        );
        await track(
          api.listen<HostToolEvent>("session://tool", (p) => {
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
          }),
        );
        await track(
          api.listen<{
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
        await track(
          api.listen<GoalOrchHostPayload>("session://goal", (p) => {
            if (cancelled || !p) return;
            // CLI 0.2.117+ goal_updated — soft-fail when CLI never emits.
            const ev = goalEventFromHostPayload(p);
            if (!ev) return;
            c.setGoalOrchEvents((prev) =>
              prependGoalOrchEvent(prev, ev, GOAL_ORCH_EVENT_MAX),
            );
          }),
        );
        await track(
          api.listen<{ line?: string }>("session://stderr", (p) => {
            if (cancelled || !p?.line) return;
            // Fallback: agent log lines that mention hooks (fail-open, timeouts, …).
            ingestHookLogLine(p.line);
          }),
        );
        await track(
          api.listen<{
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
            if (sid === c.viewingSessionIdRef.current) {
              c.setTurnStartedAt(null);
              c.setStreamStall(null);
              if (p.marker === "turn_cancelled") {
                c.setToast(c.tr("activity.cancelledToast"));
                window.setTimeout(() => c.setToast(null), 2800);
              }
            }
          }),
        );
        await track(
          api.listen<{ sessionId?: string; reason?: string }>(
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
        await track(
          api.listen<{ reason?: string; killed?: number }>(
            "session://agents_recycled",
            (p) => {
              if (cancelled || !p) return;
              // session_data_mode flip, custom provider route apply (#376), CLI upgrade, etc.
              if (p.reason === "provider_route") {
                c.setToast(c.tr("prov.switchedHotReload"));
                window.setTimeout(() => c.setToast(null), 3600);
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
        await track(
          api.listen<{ reason?: string }>(
            "session://agent_soft_respawn",
            (p) => {
              if (cancelled || !p) return;
              // Spawn flags / extensions changed while an agent was live.
              c.setToast(c.tr("agent.softRespawnToast"));
              window.setTimeout(() => c.setToast(null), 3600);
            },
          ),
        );
        await track(
          api.listen<{
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
        await track(
          api.listen<{
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
        await track(
          api.listen<{
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
        await track(
          api.listen<{
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
        await track(
          api.listen<{
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
        await track(
          api.listen<{
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
        await track(
          api.listen<TurnErrorPayload>("session://turn_error", (p) => {
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
        await track(
          api.listen<PermissionPayload>("session://permission", (p) => {
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
        await track(
          api.listen<AskUserPayload>("session://ask_user", (p) => {
            if (cancelled) return;
            if (!p?.rpcId || !Array.isArray(p.questions) || !p.questions.length) {
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
        await track(
          api.listen<{
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
              planJustCompleted(prev, next, p.sessionId);
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
                planJustCompleted(prev, next, targetSid);
              }
              return next;
            });
          }),
        );
        await track(
          api.listen<{ sessionId?: string; title?: string }>(
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
        await track(
          api.listen<{ sessionId?: string; source?: string }>(
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

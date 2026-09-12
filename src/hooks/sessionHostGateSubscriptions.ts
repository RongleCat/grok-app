import * as api from "@/lib/api";
import { isValidAskUserPayload } from "@/lib/askUser/askUserPayload";
import { mapSessionListRow } from "@/lib/app/sidebarModels";
import {
  shouldShowDesktopNotify,
  showDesktopNotification,
} from "@/lib/desktopNotify";
import { mapStoredMessagesToChat } from "@/lib/mapStoredMessages";
import { planDisplayMarkdown } from "@/lib/planBody";
import { recordPlanHistory } from "@/lib/planHistory";
import {
  emptySessionPlan,
  mergePlanFromEvent,
  planStateToStored,
  type SessionPlanState,
} from "@/lib/planSession";
import { computePlanProgress, parsePlanEntries } from "@/lib/planStatus";
import {
  applyTurnError,
  weaveToolsIntoAssistantSegments,
  type AskUserPayload,
  type PermissionPayload,
  type TurnErrorPayload,
} from "@/lib/session";
import type { SessionHostEventsCtx } from "./useSessionHostEvents";

/**
 * Gate / meta lifecycle subscriptions: turn_error, permission, ask_user
 * (+cleared), plan bar + completion history, title, index_changed (Remote IM
 * disk writes). Extracted from useSessionHostEvents so the subscription list
 * reads as domains, not one 300-line wall. `env` carries the epoch machinery
 * owned by the parent effect — same single-effect lifecycle as before.
 */
export function registerGateAndMetaSubscriptions(
  c: SessionHostEventsCtx,
  env: {
    isCancelled: () => boolean;
    track: (p: Promise<() => void>) => void;
    listenWithRetry: <T>(
      event: string,
      handler: (payload: T) => void,
    ) => Promise<() => void>;
  },
) {
  const { isCancelled, track, listenWithRetry } = env;
       track(
          listenWithRetry<TurnErrorPayload>("session://turn_error", (p) => {
            if (isCancelled()) return;
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
            if (isCancelled()) return;
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
            if (isCancelled()) return;
            // rpcId may legitimately be 0 (JSON-RPC ids start at 0). A truthy
            // guard here used to drop id=0 questions, so the modal never showed
            // and the turn hung until isCancelled().
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
              if (isCancelled()) return;
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
            if (isCancelled()) return;
            const readyTitle = c.trRef.current("plan.ready");
            const composerMode = c.modeRef.current;
            const targetSid =
              (p.sessionId && p.sessionId.trim()) ||
              c.viewingSessionIdRef.current ||
              null;

            const planJustCompleted = (
              prev: SessionPlanState,
              next: SessionPlanState,
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
              if (isCancelled() || !p.sessionId || !p.title) return;
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
              if (isCancelled()) return;
              void (async () => {
                try {
                  const list = await api.sessionsList();
                  if (isCancelled()) return;
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
                  if (isCancelled() || c.viewingSessionIdRef.current !== sid) return;
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
}

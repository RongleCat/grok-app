/**
 * Chat stage: secondary-live banner, stall/plan/find/tasks chrome, error
 * banner, a11y live region, and ConversationThreadLive. Composer is passed
 * as children so it stays inside main__stage.
 */
import type { CSSProperties, Dispatch, ReactNode, RefObject, SetStateAction } from "react";
import * as api from "@/lib/api";
import type { MessageKey } from "@/i18n";
import { createT, resolveLocale } from "@/i18n";
import { pathsEqual, type GitWorktreeEntry } from "@/lib/gitWorktree";
import {
  classifyTasksBindCwdError,
  classifyTasksStopError,
  type TasksBindCwdResult,
} from "@/lib/tasksPanelPro";
import { settleStoppedSessionInLiveMap } from "@/lib/sessionLiveStore";
import {
  stallMessageKey,
  stallTierFromProgress,
  normalizeStallTier,
} from "@/lib/sessionPhase";
import { goalOrchPhaseLabelKey, type GoalOrchEvent } from "@/lib/goalOrch";
import { AttachedChatLookupContext, type AttachedChatLookup } from "@/components/AttachedChatLookup";
import type { ResourceOpenTarget } from "@/components/resource-viewer/types";
import type { ModelOption } from "@/lib/grokCatalog";
import type { MessageTimeFormat } from "@/lib/messageTimeFormatPref";
import type { SessionPlanState } from "@/lib/planSession";
import type { GoalOrchSessionIndicator } from "@/lib/goalOrchView";
import type { StopAllSurface } from "@/lib/stopAllHonesty";
import type { StopLatchState } from "@/lib/stopLatch";
import type { UiBusyGate } from "@/lib/sessionPhase";
import type { SessionLiveMap } from "@/lib/sessionLiveStore";
import { sessionTranscriptStore as sessionTranscriptStoreInstance } from "@/lib/sessionTranscriptStore";
import type { ErrorBannerView } from "@/lib/session/errors";
import type { ErrorDeckAction } from "@/lib/errorDeck";
import type { Attachment } from "@/lib/attachments";
import type { SessionFileChange } from "@/lib/sessionChanges";
import { type Project, type SessionRow } from "@/lib/app/sidebarModels";
import type { ChatMessage, SessionSnapshot } from "@/lib/session";
import { UiErrorBoundary } from "@/components/UiErrorBoundary";
import { ConversationThreadLive } from "@/components/lobe-chat";
import { GoalOrchSessionChip } from "@/components/GoalOrchSessionChip";
import { PlanStatusBar } from "@/components/PlanStatusBar";
import { ChatFindLive } from "@/components/ChatFindLive";
import { AgentTasksPanelLive } from "@/components/AgentTasksPanelLive";

type TFn = ReturnType<typeof createT>;
type TStore = typeof sessionTranscriptStoreInstance;
type StreamStallView = {
  sessionId?: string;
  stallSeconds: number;
  tier?: string;
  sawModelOutput?: boolean;
  sawToolActivity?: boolean;
} | null;

export type WorkbenchChatStageProps = {
  children: ReactNode;
  activeProject: Project | null;
  approvePlan: () => Promise<void>;
  attachLabels: {
    open: string;
    reveal: string;
    copyPath: string;
    copyImage: string;
    addToComposer: string;
    remove: string;
    viewImage: string;
    previewBroken: string;
    previewMissing: string;
    previewPending: string;
  };
  attachedChatLookup: AttachedChatLookup;
  availableModels: ModelOption[];
  beginEditLastUser: (msg: ChatMessage) => void;
  canEditLastUser: boolean;
  canRewindSession: boolean;
  cancelEditUser: () => void;
  chatFindFocusKey: number;
  composerFloatPad: number;
  connecting: boolean;
  copyGoalOrchControlSummary: () => Promise<void>;
  dismissPlan: () => void;
  editAttachments: Attachment[];
  editSubmitting: boolean;
  editingUserMessageId: string | null;
  effectiveProjectPath: string | null;
  errorBanner: ErrorBannerView | null;
  errorDetailOpen: boolean;
  exitPlanMode: () => void;
  gitWorktrees: GitWorktreeEntry[];
  goalMode: boolean;
  goalOrchSessionChip: GoalOrchSessionIndicator | null;
  goalOrchSessionEvents: GoalOrchEvent[];
  hasChatTurnError: boolean;
  isSecondaryWindow: boolean;
  journalPending: boolean;
  lastUserMessageId: string | null;
  liveMap: SessionLiveMap;
  locale: string;
  mainPane: "chat" | "automations" | "kanban";
  markSessionWorktree: (
    sessionId: string | null | undefined,
    path: string,
    branch: string | null | undefined,
  ) => Promise<void>;
  messageTimeFormat: MessageTimeFormat;
  mode: string;
  modelId: string;
  onForkFromAssistantMessage: (msg: ChatMessage) => void;
  onRewindToUserMessage: (msg: ChatMessage) => void;
  onThreadAddAttachmentToComposer: (att: Attachment) => void;
  onThreadAddQuote: (quote: {
    text: string;
    comment: string;
    sourceMessageId?: string;
  }) => void;
  onThreadContinueInterrupted: () => void;
  onThreadOpenError: (message: string) => void;
  onThreadOpenModifiedPath: (path: string) => void;
  onThreadOpenResource: (target: ResourceOpenTarget) => void;
  onThreadOpenSessionChanges: () => void;
  onThreadRemoveEditAttachment: (att: Attachment) => void;
  openExternalLinkFromChat: (url: string) => void;
  openPlanInResource: () => void;
  openReliability: () => void;
  openRequestPlanChanges: () => void;
  openSession: (s: SessionRow, project?: Project | null) => Promise<void>;
  plan: SessionPlanState;
  projects: Project[];
  regenerateLastAssistant: (
    message: ChatMessage,
    opts?: { modelId?: string },
  ) => Promise<void>;
  requestClearLocalGoalOrchTimeline: () => void;
  retryAgentConnect: () => void;
  runErrorBannerAction: (action: ErrorDeckAction) => void;
  session: SessionSnapshot;
  sessionChanges: SessionFileChange[];
  sessionJsonSchema: string | null;
  sessionTranscriptStore: TStore;
  sessions: SessionRow[];
  setAgentDashboardOpen: Dispatch<SetStateAction<boolean>>;
  setErrorDetailOpen: Dispatch<SetStateAction<boolean>>;
  setGoalMode: Dispatch<SetStateAction<boolean>>;
  setLiveMap: (
    next: SessionLiveMap | ((prev: SessionLiveMap) => SessionLiveMap),
  ) => void;
  setShowChatFind: Dispatch<SetStateAction<boolean>>;
  setStreamStall: Dispatch<SetStateAction<StreamStallView>>;
  setTasksPanelOpen: Dispatch<SetStateAction<boolean>>;
  shouldDisableReconnectBecauseConnecting: (connecting: boolean) => boolean;
  showChatFind: boolean;
  showMessageTimestamps: boolean;
  showReplyLength: boolean;
  showToast: (msg: string, ms?: number) => void;
  stop: () => Promise<void>;
  stopAllBusySessions: (surface?: StopAllSurface) => void;
  stopGate: UiBusyGate;
  stopLatch: StopLatchState;
  streamA11yNote: string;
  streamStall: StreamStallView;
  structuredOutputLabels: {
    title: string;
    badge: string;
    copy: string;
    copied: string;
    export: string;
    invalidJson: string;
    empty: string;
    valid: string;
    schemaMismatch: string;
    missingRequired: string;
    streaming?: string;
    partial?: string;
    partialKeys?: string;
    timeline?: string;
    usage?: string;
    usageIo?: string;
    usageTotal?: string;
  };
  structuredOutputUsage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  } | null;
  subagentWorktreeSnapshotEnabled: boolean;
  submitEditLastUser: (msg: ChatMessage, storedDisplay: string) => Promise<void>;
  switchToWorktree: (wt: GitWorktreeEntry) => Promise<void>;
  tasksPanelOpen: boolean;
  tr: TFn;
  turnStartedAt: number | null;
  viewingSessionIdRef: RefObject<string | null>;
  welcomeSession: boolean;
  worktreeEntryForPath: (
    path: string | null,
    worktrees?: GitWorktreeEntry[] | null,
  ) => GitWorktreeEntry | null;
};
export function WorkbenchChatStage(p: WorkbenchChatStageProps) {
  const {
    activeProject, approvePlan, attachLabels, attachedChatLookup, availableModels, beginEditLastUser,
    canEditLastUser, canRewindSession, cancelEditUser, chatFindFocusKey, composerFloatPad, connecting,
    copyGoalOrchControlSummary, dismissPlan, editAttachments, editSubmitting, editingUserMessageId, effectiveProjectPath,
    errorBanner, errorDetailOpen, exitPlanMode, gitWorktrees, goalMode, goalOrchSessionChip,
    goalOrchSessionEvents, hasChatTurnError, isSecondaryWindow, journalPending, lastUserMessageId, liveMap,
    locale, mainPane, markSessionWorktree, messageTimeFormat, mode, modelId,
    onForkFromAssistantMessage, onRewindToUserMessage, onThreadAddAttachmentToComposer, onThreadAddQuote, onThreadContinueInterrupted, onThreadOpenError,
    onThreadOpenModifiedPath, onThreadOpenResource, onThreadOpenSessionChanges, onThreadRemoveEditAttachment, openExternalLinkFromChat, openPlanInResource,
    openReliability, openRequestPlanChanges, openSession, plan, projects, regenerateLastAssistant,
    requestClearLocalGoalOrchTimeline, retryAgentConnect, runErrorBannerAction, session, sessionChanges, sessionJsonSchema, sessionTranscriptStore,
    sessions, setAgentDashboardOpen, setErrorDetailOpen, setGoalMode, setLiveMap, setShowChatFind,
    setStreamStall, setTasksPanelOpen, shouldDisableReconnectBecauseConnecting, showChatFind, showMessageTimestamps, showReplyLength,
    showToast, stop, stopAllBusySessions, stopGate, stopLatch, streamA11yNote,
    streamStall, structuredOutputLabels, structuredOutputUsage, subagentWorktreeSnapshotEnabled, submitEditLastUser, switchToWorktree,
    tasksPanelOpen, tr, turnStartedAt, viewingSessionIdRef, welcomeSession, worktreeEntryForPath,
    children,
  } = p;
  return (
    <>
          {/* Secondary multi-window: concurrent live tip + focus main. */}
          {isSecondaryWindow && mainPane === "chat" && (
            <div
              className="view-only-banner"
              role="status"
              aria-label={tr("session.secondaryLiveTitle")}
            >
              <div className="view-only-banner__row">
                <div className="view-only-banner__copy">
                  <div className="view-only-banner__title">
                    {tr("session.secondaryLiveTitle")}
                  </div>
                  <div className="view-only-banner__body">
                    {tr("session.secondaryLiveBanner")}
                  </div>
                </div>
                {api.isDesktopHost() ? (
                  <button
                    type="button"
                    className="btn btn--ghost view-only-banner__action"
                    onClick={() => {
                      void api.focusMainWindow().catch((e) => {
                        showToast(
                          tr("session.focusMainWindowFailed") +
                            ": " +
                            String(e),
                          3200,
                        );
                      });
                    }}
                  >
                    {tr("session.focusMainWindow")}
                  </button>
                ) : null}
              </div>
            </div>
          )}

          {/* I06: soft stall — heal-first Host; soft banner is secondary. Primary = keep waiting. */}
          {streamStall && mainPane === "chat" && (
            <div
              className={`stall-banner error-banner${
                (() => {
                  const sid = streamStall.sessionId || session.sessionId || "";
                  const live = liveMap[sid];
                  const saw =
                    !!streamStall.sawModelOutput ||
                    !!live?.sawModelOutput ||
                    false;
                  const tools =
                    !!streamStall.sawToolActivity ||
                    !!live?.sawToolActivity ||
                    false;
                  const hostTier = normalizeStallTier(streamStall.tier);
                  const tier =
                    hostTier ??
                    stallTierFromProgress({
                      sawModelOutput: saw,
                      sawToolActivity: tools,
                      terminalCandidate: saw && !live?.liveToolId,
                    });
                  return tier === "maybe_done" || tier === "post_output"
                    ? " stall-banner--soft"
                    : "";
                })()
              }`}
              role="status"
            >
              <div className="error-banner__code">STREAM_STALL</div>
              <div className="error-banner__summary">
                {(() => {
                  const sid = streamStall.sessionId || session.sessionId || "";
                  const live = liveMap[sid];
                  const saw =
                    !!streamStall.sawModelOutput || !!live?.sawModelOutput;
                  const tools =
                    !!streamStall.sawToolActivity || !!live?.sawToolActivity;
                  const hostTier = normalizeStallTier(streamStall.tier);
                  const tier =
                    hostTier ??
                    stallTierFromProgress({
                      sawModelOutput: saw,
                      sawToolActivity: tools,
                      terminalCandidate: saw && !live?.liveToolId,
                    });
                  const key = stallMessageKey(tier);
                  if (key === "endOfTurn.stallPreToken") {
                    return tr("endOfTurn.stallPreToken");
                  }
                  if (key === "endOfTurn.stallWorkingTools") {
                    return tr("endOfTurn.stallWorkingTools");
                  }
                  if (key === "endOfTurn.stallMaybeDone") {
                    return tr("endOfTurn.stallMaybeDone");
                  }
                  return tr("error.deck.stall.problem");
                })()}
              </div>
              <div className="error-banner__cause">
                {tr("error.deck.stall.cause", {
                  seconds: String(streamStall.stallSeconds),
                })}
              </div>
              <div className="stall-banner__actions error-banner__actions">
                <button
                  type="button"
                  className="btn btn--primary stall-banner__btn"
                  onClick={() => setStreamStall(null)}
                >
                  {tr("agent.streamStallKeepWaiting")}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost stall-banner__btn"
                  onClick={() => {
                    setStreamStall(null);
                    void stop();
                  }}
                >
                  {tr("agent.streamStallEndTurn")}
                </button>
              </div>
            </div>
          )}

          {mainPane === "chat" && (!plan.barDismissed || goalMode) && (
            <PlanStatusBar
              goalMode={goalMode}
              mode={mode}
              planVisible={plan.visible}
              planWaiting={plan.waiting}
              planRpcId={plan.rpcId}
              planNeedsResume={
                plan.visible &&
                plan.rpcId == null &&
                (plan.gateStale || plan.awaitingAgentApproval)
              }
              entries={plan.entries}
              labels={{
                goal: tr("planBar.goal"),
                planMode: tr("planBar.planMode"),
                progress: tr("planBar.progress"),
                review: tr("planBar.review"),
                done: tr("planBar.done"),
                resume: tr("planBar.resume"),
                fraction: tr("planBar.fraction"),
                current: tr("planBar.current"),
                approve: tr("plan.approve"),
                changes: tr("plan.changes"),
                dismiss: tr("plan.dismiss"),
                exitPlanMode: tr("plan.exitPlanMode"),
                expand: tr("planBar.expand"),
                clearGoal: tr("planBar.clearGoal"),
                aria: tr("planBar.aria"),
              }}
              onApprove={() => void approvePlan()}
              onRequestChanges={() => openRequestPlanChanges()}
              onDismiss={() => void dismissPlan()}
              onExitPlanMode={exitPlanMode}
              onClearGoal={() => setGoalMode(false)}
              onOpenDetails={() => openPlanInResource()}
            />
          )}

          {mainPane === "chat" && goalOrchSessionChip ? (
            <GoalOrchSessionChip
              indicator={goalOrchSessionChip}
              phaseLabel={tr(
                goalOrchPhaseLabelKey(goalOrchSessionChip.phase),
              )}
              canClear={goalOrchSessionEvents.length > 0}
              labels={{
                chipLabel:
                  goalOrchSessionChip.kind === "waiting"
                    ? tr("reliability.goal.sessionChipWaiting")
                    : tr("reliability.goal.sessionChip", {
                        phase: tr(
                          goalOrchPhaseLabelKey(goalOrchSessionChip.phase),
                        ),
                      }),
                aria:
                  goalOrchSessionChip.kind === "waiting"
                    ? tr("reliability.goal.sessionChipWaitingAria")
                    : tr("reliability.goal.sessionChipAria", {
                        phase: tr(
                          goalOrchPhaseLabelKey(goalOrchSessionChip.phase),
                        ),
                      }),
                title:
                  goalOrchSessionChip.kind === "waiting"
                    ? tr("reliability.goal.sessionChipWaitingTitle")
                    : tr(goalOrchPhaseLabelKey(goalOrchSessionChip.phase)),
                menuAria: tr("reliability.goal.sessionMenuAria"),
                openReliability: tr("reliability.goal.openReliability"),
                copySummary: tr("reliability.goal.copySummary"),
                clearTimeline: tr("reliability.goal.clearTimeline"),
              }}
              onOpenReliability={() => openReliability()}
              onCopySummary={() => void copyGoalOrchControlSummary()}
              onClearTimeline={requestClearLocalGoalOrchTimeline}
            />
          ) : null}

          {mainPane === "chat" && showChatFind && (
            <ChatFindLive
              focusNonce={chatFindFocusKey}
              labels={{
                placeholder: tr("chatFind.placeholder"),
                prev: tr("chatFind.prev"),
                next: tr("chatFind.next"),
                close: tr("chatFind.close"),
                count: tr("chatFind.count"),
                noMatches: tr("chatFind.noMatches"),
                aria: tr("chatFind.aria"),
              }}
              onClose={() => setShowChatFind(false)}
            />
          )}
          {mainPane === "chat" && tasksPanelOpen && session.sessionId ? (
            <AgentTasksPanelLive
              t={(k, vars) => tr(k, vars)}
              onClose={() => setTasksPanelOpen(false)}
              subagentWorktreeSnapshotEnabled={
                subagentWorktreeSnapshotEnabled
              }
              activityLookupSessions={sessions}
              currentSessionId={session.sessionId}
              untitledLabel={tr("session.untitled")}
              onSelectSession={(id) => {
                const row = sessions.find((s) => s.id === id);
                if (!row) return;
                const proj = projects.find((p) => p.id === row.projectId) || null;
                void openSession(row, proj);
              }}
              onStopSession={async (id) => {
                try {
                  await api.sessionStop(id);
                  setLiveMap((lm: any) => settleStoppedSessionInLiveMap(lm, id));
                } catch (e) {
                  const view = classifyTasksStopError(e);
                  showToast(tr(view.titleKey as MessageKey), 4000);
                  // Re-throw so the panel can also show an inline soft-fail hint.
                  throw e;
                }
              }}
              onStopAllSessions={() => stopAllBusySessions("tasks")}
              onOpenDashboard={() => setAgentDashboardOpen(true)}
              activeCwd={activeProject?.path ?? null}
              onOpenCwd={async (cwd): Promise<TasksBindCwdResult> => {
                const path = (cwd || "").trim();
                if (!path) {
                  return { ok: false, kind: "empty_path" };
                }
                if (!api.isTauri()) {
                  return { ok: false, kind: "host_only" };
                }
                if (
                  activeProject?.path &&
                  pathsEqual(path, activeProject.path)
                ) {
                  return { ok: false, kind: "already_active" };
                }
                const wt = worktreeEntryForPath(path, gitWorktrees);
                if (!wt) {
                  return { ok: false, kind: "not_worktree" };
                }
                try {
                  await switchToWorktree(wt);
                  const liveId =
                    viewingSessionIdRef.current || session.sessionId || null;
                  if (liveId) {
                    await markSessionWorktree(liveId, wt.path, wt.branch);
                  }
                  return { ok: true };
                } catch (e) {
                  const view = classifyTasksBindCwdError(e);
                  showToast(tr(view.titleKey as MessageKey), 4000);
                  return {
                    ok: false,
                    kind: view.kind,
                    detail: view.detail || undefined,
                  };
                }
              }}
            />
          ) : null}

          {/* Pre-turn / host errors: T04 deck (problem · cause · primary · secondary) */}
          {errorBanner && !hasChatTurnError && (
            <div className="error-banner" role="alert">
              {errorBanner.code ? (
                <div className="error-banner__code">{errorBanner.code}</div>
              ) : null}
              <div className="error-banner__summary">{errorBanner.summary}</div>
              {errorBanner.cause ? (
                <div className="error-banner__cause">{errorBanner.cause}</div>
              ) : null}
              <div className="error-banner__actions">
                {errorBanner.primary ? (
                  <button
                    type="button"
                    className="btn btn--primary error-banner__primary"
                    disabled={
                      shouldDisableReconnectBecauseConnecting(connecting) &&
                      errorBanner.primary.id === "reconnect"
                    }
                    onClick={() => {
                      if (errorBanner.primary) {
                        runErrorBannerAction(errorBanner.primary);
                      }
                    }}
                  >
                    {errorBanner.primary.label}
                  </button>
                ) : null}
                {errorBanner.secondary ? (
                  <button
                    type="button"
                    className="btn btn--ghost error-banner__secondary"
                    disabled={
                      shouldDisableReconnectBecauseConnecting(connecting) &&
                      errorBanner.secondary.id === "reconnect"
                    }
                    onClick={() => {
                      if (errorBanner.secondary) {
                        runErrorBannerAction(errorBanner.secondary);
                      }
                    }}
                  >
                    {errorBanner.secondary.label}
                  </button>
                ) : null}
                {!errorBanner.primary &&
                  (errorBanner.reconnectHint ||
                    session.state === "disconnected") && (
                    <button
                      type="button"
                      className="btn btn--ghost error-banner__reconnect"
                      disabled={shouldDisableReconnectBecauseConnecting(
                        connecting,
                      )}
                      onClick={() => {
                        setErrorDetailOpen(false);
                        retryAgentConnect();
                      }}
                    >
                      {tr("main.reconnect")}
                    </button>
                  )}
                {errorBanner.detail ? (
                  <button
                    type="button"
                    className="error-banner__details-btn"
                    aria-expanded={errorDetailOpen}
                    onClick={() => setErrorDetailOpen((v: boolean) => !v)}
                  >
                    {errorDetailOpen
                      ? tr("error.hideDetails")
                      : tr("error.details")}
                  </button>
                ) : null}
              </div>
              {errorBanner.detail && errorDetailOpen && (
                <pre className="error-banner__detail">{errorBanner.detail}</pre>
              )}
            </div>
          )}

          <div
            className="main__stage"
            style={
              {
                ["--composer-float-pad"]: `${composerFloatPad}px`,
              } as CSSProperties
            }
          >
          <div className="sr-only" aria-live="polite" aria-atomic="true">
            {streamA11yNote}
          </div>
          <AttachedChatLookupContext.Provider value={attachedChatLookup}>
          <UiErrorBoundary
            resetKey={session.sessionId ?? `draft-${session.title ?? "new"}`}
            labels={{
              title: tr("ui.errorBoundary.title"),
              body: tr("ui.errorBoundary.body"),
              retry: tr("ui.errorBoundary.retry"),
            }}
          >
          <ConversationThreadLive
            onContinueInterrupted={onThreadContinueInterrupted}
            onAddQuote={onThreadAddQuote}
            locale={resolveLocale(locale)}
            sessionState={
              stopLatch.phase === "force_idle" || stopGate.forceIdle
                ? "ready"
                : session.state
            }
            sessionKey={session.sessionId ?? `draft-${session.title ?? "new"}`}
            projectPath={effectiveProjectPath}
            sshAlias={activeProject?.sshAlias ?? null}
            suppressEmptyCopy={welcomeSession}
            journalLoading={journalPending}
            hasExistingSession={!!session.sessionId}
            journalHydrated={
              !!session.sessionId &&
              sessionTranscriptStore.isJournalHydrated(session.sessionId)
            }
            canEditLastUser={canEditLastUser}
            lastUserMessageId={lastUserMessageId}
            editingUserMessageId={editingUserMessageId}
            editSubmitting={editSubmitting}
            editAttachments={editAttachments}
            onEditUserMessage={beginEditLastUser}
            onCancelEditUserMessage={cancelEditUser}
            onSubmitEditUserMessage={submitEditLastUser}
            onRemoveEditAttachment={onThreadRemoveEditAttachment}
            canRegenerate={canEditLastUser && !editSubmitting}
            onRegenerateAssistant={regenerateLastAssistant}
            regenerateModels={availableModels}
            regenerateModelId={modelId}
            canRewindSession={canRewindSession && !!session.sessionId}
            onRewindToUserMessage={onRewindToUserMessage}
            onForkFromAssistantMessage={onForkFromAssistantMessage}
            turnStartedAt={turnStartedAt}
            onOpenSessionChanges={onThreadOpenSessionChanges}
            onOpenModifiedPath={onThreadOpenModifiedPath}
            sessionChanges={sessionChanges}
            onOpenResource={onThreadOpenResource}
            onOpenError={onThreadOpenError}
            onOpenExternalLink={openExternalLinkFromChat}
            onAddAttachmentToComposer={onThreadAddAttachmentToComposer}
            attachLabels={attachLabels}
            showTimestamps={showMessageTimestamps}
            messageTimeFormat={messageTimeFormat}
            showReplyLength={showReplyLength}
            structuredOutputActive={!!sessionJsonSchema}
            structuredOutputSchema={sessionJsonSchema}
            structuredOutputUsage={structuredOutputUsage}
            structuredOutputLabels={structuredOutputLabels}
          />
          </UiErrorBoundary>
          </AttachedChatLookupContext.Provider>
          {children}
          </div>
    </>
  );
}

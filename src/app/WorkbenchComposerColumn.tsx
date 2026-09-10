/**
 * Composer column: welcome mark, ask-user / permission bars, context chips, portal wrap.
 * Draft/queue chrome lives in WorkbenchComposerShell.
 */
import type { Dispatch, MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject, SetStateAction } from "react";
import { createT } from "@/i18n";
import type { AccountStatus } from "@/lib/api/account";
import type { Project, SessionRow } from "@/lib/app/sidebarModels";
import type { ComposerAtFileEntry } from "@/components/ComposerAtPanel";
import type { ComposerPlusEntry } from "@/components/ComposerPlusPanel";
import type { SuperGrokBrandKind } from "@/components/SuperGrokMark";
import type { PermissionPayload, AskUserPayload, SessionSnapshot } from "@/lib/session";
import type { PermissionPolicyId, ModelOption, EffortOption } from "@/lib/grokCatalog";
import type { SlashItem, SlashKindFilter, SlashKindCounts } from "@/lib/slashCatalog";
import type { FloatingPos } from "@/lib/floatingMenu";
import type { LiveTokenQuery } from "@/hooks/useComposerController";
import type { VoiceGate } from "@/hooks/useVoiceDictation";
import type { VoiceFsmState } from "@/lib/voiceDictation";
import type { SideWorkbenchState } from "@/lib/sideWorkbench";
import type { SessionChangesSummary } from "@/lib/sessionChanges";
import type { SendQueueStripState } from "@/lib/sendQueue";
import type { RecentPromptEntry } from "@/lib/recentPromptHistory";
import type { LayoutPrefs } from "@/lib/layout";
import type { GitDirtySummary } from "@/lib/workspaceGit";
import type { ContextUsageDisplay } from "@/lib/contextUsage";
import type { ComposerModelPick } from "@/lib/composerModelGroups";
import type { CliWorktreeEntry } from "@/lib/cliWorktrees";
import type { ChatRef, AttachableSession } from "@/lib/chatAttach";
import type { GitWorktreeEntry } from "@/lib/gitWorktree";
import type { GitBranchEntry } from "@/lib/gitBranches";
import type { ResourceOpenTarget } from "@/components/resource-viewer/types";
import { useSendQueue } from "@/hooks/useSendQueue";
import type { PromptHistoryEntry, PromptHistoryScope } from "@/lib/composerPromptHistory";
import type { QueuedSend } from "@/lib/sendQueue";
import type { Attachment } from "@/lib/attachments";
import type { ComposerQuote } from "@/lib/composerQuotes";
import * as api from "@/lib/api";
import { ComposerProjectMenu } from "@/components/ComposerProjectMenu";
import { ComposerRemoteMenu } from "@/components/ComposerRemoteMenu";
import { ComposerWorktreeMenu } from "@/components/ComposerWorktreeMenu";
import { AskUserBar } from "@/components/AskUserBar";
import { PermissionCountdown } from "@/components/PermissionCountdown";
import { SuperGrokMark } from "@/components/SuperGrokMark";
import { IconFileDiff, IconGitBranch } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { mapProjectsList, projectDisplayName } from "@/lib/app/sidebarModels";
import { isMirrorClient } from "@/lib/mirrorTransport";
import {
  displayPermissionPreview,
  formatPermissionSummary,
  mapPermissionButtons,
} from "@/lib/permissionOptions";
import {
  canClaimAskUserSettle,
  settleAskUserDecision,
} from "@/lib/askUserSettle";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ComposerModelMenu } from "@/components/ComposerModelMenu";
import { WorkbenchComposerShell } from "@/app/WorkbenchComposerShell";

export type WorkbenchComposerColumnProps = {
  account: AccountStatus | null;
  activeProject: Project | null;
  addProjectFromPicker: (opts: { bindSession: boolean; autoTrust?: boolean | undefined; }) => Promise<void>;
  applyAtFile: (entry: ComposerAtFileEntry) => void;
  applyAttachedChat: (id: string, title: string, updatedAt?: string | undefined) => void;
  applyCreateVideo: () => void;
  applyPermissionPolicy: (next: PermissionPolicyId) => void;
  applyPromptHistoryEntry: (entry: PromptHistoryEntry, opts?: PromptHistoryEntryOpts) => void;
  applySlashItem: (item: SlashItem) => void;
  atActiveIndex: number;
  atEntries: ComposerAtFileEntry[];
  atLoading: boolean;
  atMenuOpen: boolean;
  atPanelRef: RefObject<HTMLDivElement | null>;
  atSoftFail: string | null;
  attachChatActive: number;
  attachChatFilter: string;
  attachChatOpen: boolean;
  attachChatPanelRef: RefObject<HTMLDivElement | null>;
  attachChatPos: FloatingPos | null;
  attachLabels: ComposerAttachLabels;
  attachScopeLabel: (scope?: string | undefined) => string;
  attachableSessions: AttachableSession[];
  attachments: Attachment[];
  availableModels: ModelOption[];
  bindSessionProject: (proj: Project | null) => Promise<void>;
  setProjects: Dispatch<SetStateAction<Project[]>>;
  setLocalError: Dispatch<SetStateAction<string | null>>;
  canGuideQueuedMessage: boolean;
  channelEffortOptions: EffortOption[] | null;
  chatAttachments: ChatRef[];
  clearSlashFilters: () => void;
  cliWorktrees: CliWorktreeEntry[];
  cliWorktreesAvailable: boolean | null;
  cliWorktreesLoading: boolean;
  cliWorktreesReason: string | null;
  closeAttachChat: () => void;
  closeComposerMenu: () => void;
  closePromptHistory: () => void;
  composerAtPos: FloatingPos | null;
  composerInputRef: RefObject<HTMLDivElement | null>;
  composerMenuEntries: ComposerPlusEntry[];
  composerMenuOpen: boolean;
  composerPlusPanelRef: RefObject<HTMLDivElement | null>;
  composerPlusPos: FloatingPos | null;
  composerPlusTriggerRef: RefObject<HTMLButtonElement | null>;
  composerProviderInputs: { id: string; name: string; model: string; models: { id: string; name: string; }[]; }[];
  composerShellRef: RefObject<HTMLDivElement | null>;
  composerSpellcheck: boolean;
  composerWrapRef: RefObject<HTMLDivElement | null>;
  confirmRemoveWorktree: (wt: GitWorktreeEntry) => void;
  connecting: boolean;
  contextUsageDisplay: ContextUsageDisplay;
  currentModelWindow: number | null;
  customRouteActive: boolean;
  cycleAttachedChatScope: (id: string) => void;
  effectiveCanSend: boolean;
  effectiveCanStop: boolean;
  effort: string;
  formatPermCountdown: (seconds: string) => string;
  gitDirtySummary: GitDirtySummary | null;
  gitWorktrees: GitWorktreeEntry[];
  gitWorktreesAvailable: boolean | null;
  gitWorktreesLoading: boolean;
  gitWorktreesReason: string | null;
  gitBranches: GitBranchEntry[];
  gitBranchesAvailable: boolean | null;
  gitBranchesLoading: boolean;
  gitBranchesReason: string | null;
  gitBranchesBusy: boolean;
  goalMode: boolean;
  guideQueuedMessage: (item: QueuedSend) => Promise<void>;
  guidingQueueItemId: string | null;
  handleContextWindow: (tokens: number) => Promise<void>;
  handleEffortPick: (nextEffort: string) => void;
  handleModelPick: (pick: ComposerModelPick) => Promise<void>;
  layout: LayoutPrefs;
  liveAt: LiveTokenQuery;
  liveSlash: LiveTokenQuery;
  liveVoiceOpen: boolean;
  locale: "en" | "de" | "es" | "fil" | "fr" | "id" | "it" | "ja" | "ko" | "pt-BR" | "ru" | "ta" | "uk" | "zh" | "zh-TW";
  mode: string;
  modelId: string;
  onComposerContextMenu: (e: ReactMouseEvent) => void;
  onComposerDraftChange: (next: string) => void;
  onComposerKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  onComposerPasteFiles: (files: File[]) => void;
  onComposerPasteMediaFallback: (opts?: { expectMedia?: boolean | undefined; } | undefined) => void;
  onSlashQueryChange: (q: { start: number; query: string; end: number; } | null) => void;
  openAsidePane: () => void;
  openQueueEdit: (item: QueuedSend) => void;
  openSession: (s: SessionRow, project?: Project | null | undefined) => Promise<void>;
  openShipFlow: () => void;
  openSideSkillsPanel: () => void;
  openWorktreeCreate: (optsCreate?: { startNewChat?: boolean | undefined; } | undefined) => void;
  openWorktreeGc: () => void;
  askUser: AskUserPayload | null;
  askUserTimeoutSec: number;
  clearPendingGates: (sessionId?: string | null | undefined) => void;
  perm: PermissionPayload | null;
  permBarRef: RefObject<HTMLDivElement | null>;
  setAskUser: Dispatch<SetStateAction<AskUserPayload | null>>;
  permCountdownStartedAt: number;
  permissionTimeoutSec: number;
  phoneLayout: boolean;
  phoneToolsOpen: boolean;
  pickComposerFiles: () => Promise<void>;
  policy: string;
  projects: Project[];
  promptHistoryActive: number;
  promptHistoryEntries: PromptHistoryEntry[];
  promptHistoryEntryMeta: string[] | undefined;
  promptHistoryFilter: string;
  promptHistoryFocusFilter: boolean;
  promptHistoryOpen: boolean;
  promptHistoryPanelRef: RefObject<HTMLDivElement | null>;
  promptHistoryPos: FloatingPos | null;
  promptHistoryScope: PromptHistoryScope;
  promptHistoryUnfilteredCount: number;
  providerActiveId: string | null;
  providerActiveSource: string;
  queueEditItemId: string | null;
  queuePreviewLabels: { filesCount: (n: number) => string; chatsCount: (n: number) => string; empty: string; };
  quotes: ComposerQuote[];
  refreshCliWorktrees: () => Promise<void>;
  refreshGitWorktrees: () => Promise<void>;
  refreshGitBranches: () => Promise<void>;
  removeAttachedChat: (id: string) => void;
  requestClearComposerDraft: () => void;
  requestClearSendQueue: () => void;
  resizingSidebar: boolean;
  resolvePermission: (p: PermissionPayload, decision: "allow_once" | "allow_session" | "deny", optionId: string) => Promise<void>;
  resolveSlashDescription: (item: SlashItem) => string;
  resolveSlashTitle: (item: SlashItem) => string;
  send: () => Promise<void>;
  sendQueue: SendQueueApi;
  sendQueueStrip: SendQueueStripState;
  session: SessionSnapshot;
  sessionChangesSummary: SessionChangesSummary | null;
  sessionJsonSchema: string | null;
  sessions: SessionRow[];
  setAtActiveIndex: Dispatch<SetStateAction<number>>;
  setAttachChatActive: Dispatch<SetStateAction<number>>;
  setAttachChatFilter: Dispatch<SetStateAction<string>>;
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  setCompactNote: Dispatch<SetStateAction<string>>;
  setGoalMode: Dispatch<SetStateAction<boolean>>;
  setJsonSchemaDraft: Dispatch<SetStateAction<string>>;
  setMode: Dispatch<SetStateAction<string>>;
  setPhoneToolsOpen: Dispatch<SetStateAction<boolean>>;
  setPromptHistoryActive: Dispatch<SetStateAction<number>>;
  setPromptHistoryClearOpen: Dispatch<SetStateAction<boolean>>;
  setPromptHistoryFilter: Dispatch<SetStateAction<string>>;
  setPromptHistoryIndex: Dispatch<SetStateAction<number | null>>;
  setPromptHistoryScope: Dispatch<SetStateAction<PromptHistoryScope>>;
  setQuotes: Dispatch<SetStateAction<ComposerQuote[]>>;
  setRecentPromptHistory: Dispatch<SetStateAction<RecentPromptEntry[]>>;
  setResourceOpenTarget: Dispatch<SetStateAction<ResourceOpenTarget | null>>;
  setShowCompactModal: Dispatch<SetStateAction<boolean>>;
  setShowComposerPlus: Dispatch<SetStateAction<boolean>>;
  setShowJsonSchemaModal: Dispatch<SetStateAction<boolean>>;
  setShowUsageLimitModal: Dispatch<SetStateAction<boolean>>;
  setSlashActiveIndex: Dispatch<SetStateAction<number>>;
  setSlashKindFilter: Dispatch<SetStateAction<SlashKindFilter>>;
  showComposerDraftStats: boolean;
  showToast: (msg: string, ms?: number) => void;
  sideDockActive: boolean;
  sideWorkbench: SideWorkbenchState;
  skillsLoadError: string | null;
  skillsLoading: boolean;
  slashActiveIndex: number;
  slashCatalog: { commands: SlashItem[]; skills: SlashItem[]; };
  slashCatalogCount: number;
  slashKindCounts: SlashKindCounts;
  slashKindFilter: SlashKindFilter;
  stop: () => Promise<void>;
  switchToWorktree: (wt: GitWorktreeEntry) => Promise<void>;
  switchToBranch: (branch: GitBranchEntry) => Promise<void>;
  toggleVoice: () => void;
  voice: VoiceFsmState;
  voiceDictationAutoSend: boolean;
  voiceGate: VoiceGate;
  welcomeBrandKind: SuperGrokBrandKind;
  welcomeProviderBrandNode: ReactNode | null;
  welcomeSession: boolean;
  welcomeMotionEnabled: boolean;
  welcomeIntroActive: boolean;
  welcomePrompt: string;
  setWelcomeIntroActive: Dispatch<SetStateAction<boolean>>;
  dockSidebarOccupied: number;
  dragZone: "main" | "sidebar" | null;
  mainPane: "chat" | "automations" | "kanban";
  tr: TFn;
  slashFilterQuery: string;
  composerPlusStyle: CSSProperties | undefined;
  composerAtStyle: CSSProperties | undefined;
  attachChatStyle: CSSProperties | undefined;
  promptHistoryStyle: CSSProperties | undefined;
  promptHistoryIndexRef: RefObject<number | null>;
};
type TFn = ReturnType<typeof createT>;
type SendQueueApi = ReturnType<typeof useSendQueue>;
type PromptHistoryEntryOpts = {
  close?: boolean;
  listIndex?: number;
  scope?: PromptHistoryScope;
};
type ComposerAttachLabels = {
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


export function WorkbenchComposerColumn(p: WorkbenchComposerColumnProps) {
  const {
    account,
    activeProject,
    addProjectFromPicker,
    bindSessionProject,
    setProjects,
    setLocalError,
    cliWorktrees,
    cliWorktreesAvailable,
    cliWorktreesLoading,
    cliWorktreesReason,
    composerWrapRef,
    confirmRemoveWorktree,
    customRouteActive,
    formatPermCountdown,
    gitDirtySummary,
    gitWorktrees,
    gitWorktreesAvailable,
    gitWorktreesLoading,
    gitWorktreesReason,
    gitBranches,
    gitBranchesAvailable,
    gitBranchesLoading,
    gitBranchesReason,
    gitBranchesBusy,
    openAsidePane,
    openShipFlow,
    openWorktreeCreate,
    openWorktreeGc,
    askUser,
    askUserTimeoutSec,
    clearPendingGates,
    perm,
    permBarRef,
    permCountdownStartedAt,
    permissionTimeoutSec,
    setAskUser,
    phoneLayout,
    projects,
    refreshCliWorktrees,
    refreshGitWorktrees,
    refreshGitBranches,
    resizingSidebar,
    resolvePermission,
    sessionChangesSummary,
    setResourceOpenTarget,
    showToast,
    sideDockActive,
    switchToWorktree,
    switchToBranch,
    welcomeBrandKind,
    welcomeProviderBrandNode,
    welcomeSession,
    welcomeMotionEnabled,
    welcomeIntroActive,
    welcomePrompt,
    setWelcomeIntroActive,
    dockSidebarOccupied,
    mainPane,
    tr,
    session,
    locale,
    modelId,
    effort,
    availableModels,
    composerProviderInputs,
    providerActiveSource,
    providerActiveId,
    channelEffortOptions,
    currentModelWindow,
    handleContextWindow,
    handleModelPick,
    handleEffortPick,
  } = p;
  const [permBusy, setPermBusy] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);
  const askUserSettlingRpcRef = useRef<number | null>(null);
  const askUserLiveRef = useRef(askUser);
  askUserLiveRef.current = askUser;
  const previewText = displayPermissionPreview(perm?.preview);
  useEffect(() => {
    setPermBusy(false);
    setPermError(null);
  }, [perm?.rpcId, perm?.sessionId]);
  useEffect(() => {
    if (!welcomeMotionEnabled || !welcomeIntroActive) return;
    const id = window.setTimeout(() => setWelcomeIntroActive(false), 1300);
    return () => window.clearTimeout(id);
  }, [welcomeMotionEnabled, welcomeIntroActive, setWelcomeIntroActive]);
  return (() => {
            const composerNode = (
          <div
            ref={composerWrapRef}
            className={
              "composer-wrap composer-wrap--float" +
              (welcomeSession && !sideDockActive
                ? " composer-wrap--welcome"
                : "") +
              (sideDockActive ? " composer-wrap--side-dock" : "") +
              (resizingSidebar ? " is-sidebar-resizing" : "")
            }
            style={
              sideDockActive
                ? ({
                    ["--sw-sidebar-occupied"]: `${dockSidebarOccupied}px`,
                  } as CSSProperties)
                : undefined
            }
            data-side-dock={sideDockActive ? "true" : undefined}
          >
            {welcomeSession && welcomeBrandKind && !sideDockActive ? (
              <div
                className={
                  "composer-welcome-mark" +
                  (welcomeMotionEnabled && welcomeIntroActive
                    ? " is-entering"
                    : "")
                }
              >
                <div className="composer-welcome-brand">
                  {welcomeProviderBrandNode ?? (
                    <SuperGrokMark
                      kind={welcomeBrandKind}
                      title={
                        customRouteActive
                          ? "SuperGrok"
                          : account?.billing?.subscriptionTier?.trim() ||
                            (welcomeBrandKind === "heavy"
                              ? "SuperGrok Heavy"
                              : "SuperGrok")
                      }
                    />
                  )}
                </div>
                <div
                  className="composer-welcome-prompt"
                  style={
                    {
                      ["--welcome-prompt-steps"]: String(
                        Math.max(1, Array.from(String(welcomePrompt ?? "")).length),
                      ),
                    } as CSSProperties
                  }
                  onAnimationEnd={() => setWelcomeIntroActive(false)}
                >
                  {welcomePrompt}
                </div>
              </div>
            ) : null}
            {askUser ? (
              <AskUserBar
                payload={askUser}
                timeoutSec={askUserTimeoutSec}
                labels={{
                  title: tr("askUser.title"),
                  submit: tr("askUser.submit"),
                  cancel: tr("askUser.cancel"),
                  otherPlaceholder: tr("askUser.otherPlaceholder"),
                  freeTextHint: tr("askUser.freeTextHint"),
                  multiHint: tr("askUser.multiHint"),
                  minimize: tr("askUser.minimize"),
                  restore: tr("askUser.restore"),
                  pendingChip: tr("askUser.pendingChip"),
                  autoCancelCountdown: tr("askUser.autoCancelCountdown"),
                }}
                onSubmit={async (answers) => {
                  if (!askUser) return;
                  if (
                    !canClaimAskUserSettle(
                      askUserSettlingRpcRef.current,
                      askUser.rpcId,
                    )
                  ) {
                    return;
                  }
                  const payload = askUser;
                  askUserSettlingRpcRef.current = payload.rpcId;
                  setAskUser(null);
                  const settled = await settleAskUserDecision({
                    payload,
                    decision: "accepted",
                    answers,
                    viewingSessionId: () => session.sessionId,
                    currentRpcId: () => askUserLiveRef.current?.rpcId ?? null,
                    resolve: (args) => api.sessionResolveAskUser(args),
                  });
                  if (settled.kind === "restore") {
                    setAskUser(payload);
                    showToast(String(settled.error), 4500);
                  } else {
                    clearPendingGates(payload.sessionId);
                  }
                  if (askUserSettlingRpcRef.current === payload.rpcId) {
                    askUserSettlingRpcRef.current = null;
                  }
                }}
                onCancel={async () => {
                  if (!askUser) return;
                  if (
                    !canClaimAskUserSettle(
                      askUserSettlingRpcRef.current,
                      askUser.rpcId,
                    )
                  ) {
                    return;
                  }
                  const payload = askUser;
                  askUserSettlingRpcRef.current = payload.rpcId;
                  setAskUser(null);
                  await settleAskUserDecision({
                    payload,
                    decision: "cancelled",
                    viewingSessionId: () => session.sessionId,
                    currentRpcId: () => askUserLiveRef.current?.rpcId ?? null,
                    resolve: (args) => api.sessionResolveAskUser(args),
                  });
                  clearPendingGates(payload.sessionId);
                  if (askUserSettlingRpcRef.current === payload.rpcId) {
                    askUserSettlingRpcRef.current = null;
                  }
                }}
              />
            ) : null}
            {perm ? (
              <div
                ref={permBarRef}
                className="perm-bar"
                role="dialog"
                aria-modal="true"
                aria-labelledby="perm-bar-title"
                aria-describedby="perm-bar-summary"
              >
                <div className="sr-only" aria-live="assertive">
                  {tr("a11y.permissionNeeded")}
                </div>
                <div className="perm-bar__head">
                  <span className="perm-bar__badge" id="perm-bar-title">
                    {tr("perm.title")}
                  </span>
                  <span className="perm-bar__tool">
                    {perm.title || perm.toolName}
                  </span>
                  {permissionTimeoutSec > 0 ? (
                    <PermissionCountdown
                      startedAtMs={permCountdownStartedAt}
                      timeoutSec={permissionTimeoutSec}
                      format={formatPermCountdown}
                    />
                  ) : null}
                </div>
                <p className="perm-bar__summary" id="perm-bar-summary">
                  {formatPermissionSummary({
                    toolName: perm.toolName,
                    title: perm.title,
                    command: previewText,
                  })}
                </p>
                {previewText ? (
                  <pre className="perm-bar__preview">{previewText}</pre>
                ) : null}
                {permError ? (
                  <p className="perm-bar__error" role="alert">
                    {permError}
                  </p>
                ) : null}
                <div className="perm-bar__actions" role="group">
                  {mapPermissionButtons(
                    perm.options,
                    {
                      allowOnce: tr("perm.allowOnce"),
                      allowSession: tr("perm.allowSession"),
                      deny: tr("perm.deny"),
                    },
                    perm.toolName,
                  ).map((btn) => (
                    <button
                      key={btn.decision + btn.optionId}
                      type="button"
                      className={
                        "perm-bar__btn" +
                        (btn.decision === "allow_once"
                          ? " perm-bar__btn--allow"
                          : btn.decision === "deny"
                            ? " perm-bar__btn--deny"
                            : " perm-bar__btn--session")
                      }
                      disabled={permBusy}
                      title={
                        btn.decision === "allow_once"
                          ? tr("perm.hintOnce")
                          : btn.decision === "allow_session"
                            ? tr("perm.hintSession")
                            : tr("perm.hintDeny")
                      }
                      onClick={() => {
                        if (permBusy) return;
                        setPermBusy(true);
                        setPermError(null);
                        void Promise.resolve(
                          resolvePermission(perm, btn.decision, btn.optionId),
                        )
                          .catch((e: unknown) => {
                            setPermError(String(e));
                          })
                          .finally(() => setPermBusy(false));
                      }}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {(() => {
              // Desktop composer always shows the workspace chip (including
              // unbound / default workspace). Phone uses PhoneComposerToolsSheet.
              const showComposerProjectRow = !phoneLayout;
              // Env menu (chat chrome) already shows change stats — hide
              // the duplicate composer context chips to avoid two "N 变更".
              const envOwnsChangeSummary =
                mainPane === "chat" && !phoneLayout;
              const showChangesChips =
                !phoneLayout &&
                !envOwnsChangeSummary &&
                (!!sessionChangesSummary || !!gitDirtySummary);
              const showContextBar =
                showComposerProjectRow || showChangesChips;
              // Desktop: workspace cluster left, model/effort right.
              // Phone keeps model/access in PhoneComposerToolsSheet.
              const showComposerChrome = !phoneLayout;
              return (
            <div
              className={
                "composer-stack" +
                (showContextBar || showComposerChrome
                  ? " composer-stack--with-context"
                  : "")
              }
            >
            {showComposerChrome ? (
            <div className="composer__chrome">
            {/* Workspace / branch + session/workspace change chips.
                Hidden entirely when the bar would be empty. */}
            {showContextBar ? (
              <div
                className="composer__context-bar composer__chip-shell"
                aria-label={
                  showComposerProjectRow
                    ? tr("composer.pickProject")
                    : tr("changes.chipAria")
                }
              >
                {showComposerProjectRow ? (
                  <>
                <ComposerProjectMenu
                  variant="context"
                  activeProject={
                    activeProject
                      ? {
                          ...activeProject,
                          name: projectDisplayName(activeProject, tr),
                        }
                      : null
                  }
                  projects={projects.map((p: any) => ({
                    ...p,
                    name: projectDisplayName(p, tr),
                  }))}
                  labels={{
                    noProject: tr("project.general"),
                    pickProject: tr("composer.pickProject"),
                    addProject: tr("composer.addProject"),
                    pathMissing: tr("project.pathMissingShort"),
                  }}
                  disabled={
                    session.state === "streaming" ||
                    session.state === "awaiting_permission"
                  }
                    onSelect={(proj: any) => {
                    // Menu default-workspace row still passes null; bind resolves it.
                    const full = proj
                      ? projects.find((p: any) => p.id === proj.id) ?? null
                      : null;
                    void bindSessionProject(full);
                  }}
                  onAdd={() => {
                    void addProjectFromPicker({ bindSession: true });
                  }}
                />
                <ComposerRemoteMenu
                  t={(k, vars) => tr(k as Parameters<TFn>[0], vars)}
                  disabled={
                    session.state === "streaming" ||
                    session.state === "awaiting_permission"
                  }
                  onOpenRemote={(alias, path) => {
                    void (async () => {
                      try {
                        const proj = (await api.projectAddSsh(
                          alias,
                          path,
                          true,
                        )) as (typeof projects)[number];
                        if (typeof setProjects === "function") {
                          setProjects(
                            mapProjectsList(
                              (await api.projectsList()) as typeof projects,
                            ),
                          );
                        }
                        void bindSessionProject(proj);
                      } catch (e) {
                        if (typeof setLocalError === "function") {
                          setLocalError(String(e));
                        }
                      }
                    })();
                  }}
                />
                {activeProject && gitWorktreesAvailable === true ? (
                  <ComposerWorktreeMenu
                    variant="context"
                    activePath={activeProject.path}
                    worktrees={gitWorktrees}
                    worktreesAvailable={gitWorktreesAvailable}
                    worktreesLoading={gitWorktreesLoading}
                    worktreesReason={gitWorktreesReason}
                    branches={gitBranches}
                    branchesAvailable={gitBranchesAvailable}
                    branchesLoading={gitBranchesLoading}
                    branchesReason={gitBranchesReason}
                    branchesBusy={gitBranchesBusy}
                    cliWorktrees={cliWorktrees}
                    cliWorktreesAvailable={cliWorktreesAvailable}
                    cliWorktreesLoading={cliWorktreesLoading}
                    cliWorktreesReason={cliWorktreesReason}
                    disabled={
                      session.state === "streaming" ||
                      session.state === "awaiting_permission"
                    }
                    labels={{
                      worktrees: tr("composer.worktrees"),
                      worktreesEmpty: tr("composer.worktreesEmpty"),
                      worktreesUnavailable: tr(
                        "composer.worktreesUnavailable",
                      ),
                      worktreesLoading: tr("composer.worktreesLoading"),
                      worktreeCurrent: tr("composer.worktreeCurrent"),
                      worktreeMain: tr("composer.worktreeMain"),
                      worktreeDetached: tr("composer.worktreeDetached"),
                      worktreeTip: tr("composer.worktreeTip"),
                      branches: tr("composer.branches"),
                      branchesEmpty: tr("composer.branchesEmpty"),
                      branchesUnavailable: tr("composer.branchesUnavailable"),
                      branchesLoading: tr("composer.branchesLoading"),
                      branchesSearchPlaceholder: tr(
                        "composer.branchesSearchPlaceholder",
                      ),
                      branchesTruncated: tr("composer.branchesTruncated"),
                      branchRemote: tr("composer.branchRemote"),
                      branchElsewhere: tr("composer.branchElsewhere"),
                      worktreeNew: tr("composer.worktreeNew"),
                      worktreeNewChat: tr("composer.worktreeNewChat"),
                      worktreeGc: tr("composer.worktreeGc"),
                      worktreeShip: tr("composer.worktreeShip"),
                      worktreeShipTip: tr("composer.worktreeShipTip"),
                      worktreeRemove: tr("composer.worktreeRemove"),
                      worktreeRemoveTip: tr("composer.worktreeRemoveTip"),
                      cliWorktrees: tr("composer.cliWorktrees"),
                      cliWorktreesEmpty: tr("composer.cliWorktreesEmpty"),
                      cliWorktreesUnavailable: tr(
                        "composer.cliWorktreesUnavailable",
                      ),
                      cliWorktreesLoading: tr("composer.cliWorktreesLoading"),
                      cliWorktreeRefresh: tr("composer.cliWorktreeRefresh"),
                      cliWorktreeReveal: tr("composer.cliWorktreeReveal"),
                      cliWorktreeOpen: tr("composer.cliWorktreeOpen"),
                      cliWorktreeOpenUnavailable: tr(
                        "composer.cliWorktreeOpenUnavailable",
                      ),
                      cliWorktreeMissingPath: tr(
                        "composer.cliWorktreeMissingPath",
                      ),
                    }}
                    onSwitch={(wt) => {
                      void switchToWorktree(wt);
                    }}
                    onSwitchBranch={(row) => {
                      void switchToBranch(row);
                    }}
                    onCreate={() => openWorktreeCreate()}
                    onCreateAndChat={() =>
                      openWorktreeCreate({ startNewChat: true })
                    }
                    onGc={openWorktreeGc}
                    onShip={openShipFlow}
                    onRemove={confirmRemoveWorktree}
                    onOpen={() => {
                      void refreshGitWorktrees();
                      void refreshGitBranches();
                      void refreshCliWorktrees();
                    }}
                    onCliRefresh={() => {
                      void refreshCliWorktrees();
                    }}
                    onCliReveal={(wt) => {
                      const p = wt.path?.trim();
                      if (!p) return;
                      void api
                        .pathReveal(p)
                        .catch((e) => showToast(String(e), 3500));
                    }}
                    onCliOpen={(wt) => {
                      if (!wt.pathOk || !wt.path?.trim()) {
                        showToast(
                          tr("composer.cliWorktreeOpenUnavailable"),
                          3500,
                        );
                        return;
                      }
                      void switchToWorktree({
                        path: wt.path,
                        branch: wt.branch ?? null,
                        detached: !wt.branch || wt.branch === "HEAD",
                        isMain: false,
                        locked: false,
                        prunable: false,
                        head: wt.head ?? null,
                      });
                    }}
                  />
                ) : null}
                  </>
                ) : null}
                {showChangesChips ? (
                  <div className="composer__context-changes">
                    {sessionChangesSummary ? (
                      <Tip label={tr("changes.chipTip")}>
                        <button
                          type="button"
                          className="composer__context-item composer__context-item--changes"
                          data-testid="session-changes-chip"
                          aria-label={
                            sessionChangesSummary.mode === "diff"
                              ? `${tr("changes.chipAria")}: ${tr(
                                  "changes.chipDiff",
                                  {
                                    a: String(
                                      sessionChangesSummary.addedLines ?? 0,
                                    ),
                                    d: String(
                                      sessionChangesSummary.removedLines ?? 0,
                                    ),
                                  },
                                )}`
                              : `${tr("changes.chipAria")}: ${tr(
                                  "changes.chipFiles",
                                  {
                                    n: String(sessionChangesSummary.fileCount),
                                  },
                                )}`
                          }
                          onClick={() => {
                            openAsidePane();
                            setResourceOpenTarget({ type: "changes" });
                          }}
                        >
                          <IconFileDiff size={14} aria-hidden />
                          <span className="composer__context-label chip__label--nums">
                            {sessionChangesSummary.mode === "diff"
                              ? tr("changes.chipDiff", {
                                  a: String(
                                    sessionChangesSummary.addedLines ?? 0,
                                  ),
                                  d: String(
                                    sessionChangesSummary.removedLines ?? 0,
                                  ),
                                })
                              : tr("changes.chipFiles", {
                                  n: String(sessionChangesSummary.fileCount),
                                })}
                          </span>
                        </button>
                      </Tip>
                    ) : null}
                    {gitDirtySummary ? (
                      <Tip label={tr("changes.workspace.chipTip")}>
                        <button
                          type="button"
                          className="composer__context-item composer__context-item--git-dirty"
                          data-testid="git-dirty-chip"
                          aria-label={`${tr("changes.workspace.chipAria")}: ${tr(
                            "changes.workspace.chip",
                            { n: String(gitDirtySummary.count) },
                          )}`}
                          onClick={() => {
                            const path = activeProject?.path?.trim() || "";
                            if (
                              api.isTauri() &&
                              !isMirrorClient() &&
                              path
                            ) {
                              openAsidePane();
                              setResourceOpenTarget({ type: "changes" });
                            } else if (path) {
                              showToast(
                                tr("changes.workspace.toastPath", {
                                  path,
                                }),
                                4000,
                              );
                            }
                          }}
                        >
                          <IconGitBranch size={14} aria-hidden />
                          <span className="composer__context-label chip__label--nums">
                            {tr("changes.workspace.chip", {
                              n: String(gitDirtySummary.count),
                            })}
                          </span>
                        </button>
                      </Tip>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
              <div
                className="composer__model-bar composer__chip-shell"
                aria-label={tr("composer.model")}
              >
                <ComposerModelMenu
                  locale={locale}
                  modelId={modelId}
                  effort={effort}
                  models={availableModels}
                  providers={composerProviderInputs}
                  activeSource={providerActiveSource}
                  activeProviderId={providerActiveId}
                  channelEfforts={channelEffortOptions}
                  contextWindow={currentModelWindow}
                  contextWindowEditable={customRouteActive}
                  onContextWindow={handleContextWindow}
                  labels={{
                    model: tr("composer.model"),
                    modelGroupOfficial: tr("composer.modelGroupOfficial"),
                    modelViaProvider: tr("composer.modelViaProvider"),
                    effort: tr("composer.effort"),
                    effortHigh: tr("effort.high"),
                    effortMedium: tr("effort.medium"),
                    effortLow: tr("effort.low"),
                    effortXhigh: tr("effort.xhigh"),
                    effortMax: tr("effort.max"),
                    modelSearchPlaceholder: tr(
                      "composer.modelSearchPlaceholder",
                    ),
                    modelSearchEmpty: tr("composer.modelSearchEmpty"),
                    contextWindow: tr("composer.contextWindow"),
                    contextWindowOfficial: tr(
                      "composer.contextWindowOfficial",
                    ),
                    contextWindowCustom: tr("composer.contextWindowCustom"),
                    contextWindowPlaceholder: tr(
                      "composer.contextWindowPlaceholder",
                    ),
                    contextWindowSave: tr("composer.contextWindowSave"),
                    contextWindowOfficialHint: tr(
                      "composer.contextWindowOfficialHint",
                    ),
                    advanced: tr("composer.advanced"),
                    effortHint: tr("composer.effortPanelHint"),
                    effortFaster: tr("composer.effortFaster"),
                    effortSmarter: tr("composer.effortSmarter"),
                  }}
                  onModelPick={(pick) => {
                    void handleModelPick(pick);
                  }}
                  onEffort={handleEffortPick}
                />
              </div>
            </div>
            ) : null}
            <WorkbenchComposerShell {...p} />
            </div>
              );
            })()}
          </div>
            );
            return sideDockActive && typeof document !== "undefined"
              ? createPortal(composerNode, document.body)
              : composerNode;
          })();
}

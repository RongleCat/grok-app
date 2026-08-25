import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useThemeShell } from "@/providers/ThemeProvider";
import { usePetCompanion } from "@/hooks/usePetCompanion";
import { useFloatingMenu } from "@/lib/floatingMenu";
import { DEFAULT_WALLPAPER_FOCUS } from "@/lib/themeSkin";
import { formatRelativeTime } from "@/lib/accountUi";
import {
  canFetchOfficialQuota,
  mergeAccountStatusPreservingLocalUsage,
} from "@/lib/accountQuotaRefresh";
import { loadConfirmExternalLinksPref } from "@/lib/externalLinkPref";
import {
  chatcutHandoffToResourceOpenTarget,
  resolveChatcutLinkClick,
} from "@/lib/chatcutHandoff";
import { loadStopAllSkipConfirmPref } from "@/lib/stopAllSkipConfirmPref";
import {
  planStopAllBusySessions,
  stopAllDialogKeys,
  stopAllEmptyMessageKey,
  stopAllResultToast,
  type StopAllSurface,
} from "@/lib/stopAllHonesty";
import {
  detectAppPlatform,
  revealInOsLabel,
  usesCustomWindowChrome,
} from "@/lib/appPlatform";
import {
  isFileDrag,
  pathsFromDroppedFiles,
  shouldSkipHtml5AfterNative,
} from "@/lib/fileDrop";
import { writeOpenTargetStorage } from "@/lib/openEditorHonesty";
import { buildContinueAgentPrompt } from "@/lib/continueInterruptedTurn";
import {
  APP_CLOSE_REQUESTED_EVENT,
  APP_CLOSE_TAB_OR_WINDOW_EVENT,
  loadAlwaysQuitWithoutAskingPref,
  shouldConfirmQuit,
} from "@/lib/confirmQuit";
import { QUIT_DOUBLE_PRESS_MS } from "@/lib/doublePressQuit";
import { useDoublePressQuit } from "@/hooks/useDoublePressQuit";
import {
  canLiveParticipate,
  canOpenSessionInNewWindow,
  isSessionWindowLabel,
  parseSessionDeepLinkHash,
  resolveSecondarySessionId,
  resolveStopTargets,
} from "@/lib/multiWindow";
import {
  applyChatWidth,
  loadChatWidth,
} from "@/lib/chatWidthPref";
import {
  dropGateClocks,
  gateClockKey,
  resumeGateClock,
} from "@/lib/gateClock";
import { WallpaperMediaLayer } from "@/components/WallpaperMediaLayer";
import { SidebarCliImportCta } from "@/components/SidebarCliImportCta";
import { useCliCallLogImport } from "@/hooks/useCliCallLogImport";
import {
  DEFAULT_LAYOUT,
  SIDEBAR_DEFAULT_WIDTH,
} from "@/lib/layout";
import { resolveWorkbenchPaneOverlay } from "@/lib/paneOverlay";
import { isFakeMaximized } from "@/lib/windowChrome";
import { usePaneSplitMotion } from "@/hooks/usePaneSplitMotion";
import {
  PHONE_KEYBOARD_INSET_VAR,
  keyboardInsetBottom,
} from "@/lib/phoneViewport";
import {
  hitDragZoneFromRects,
  querySidebarEl,
  toClientDragPoint,
} from "@/lib/dragZone";
import {
  applyTurnError,
  applyTurnMarker,
  canSend,
  canType,
  isSessionLiveStreaming,
  presentErrorBanner,
  type ErrorBannerView,
  weaveToolsIntoAssistantSegments,
  truncateBeforeLastUser,
  truncateThroughUserPrompt,
  canRewindToUserPrompt,
  canRegenerateAssistant,
  userPromptIndexOf,
  userPromptIndexContaining,
  localRewindPoints,
  IDLE_SNAPSHOT,
  type AskUserPayload,
  type ChatMessage,
  type PermissionPayload,
} from "@/lib/session";
import {
  INITIAL_CONTEXT_USAGE,
  resolveContextUsageDisplay,
  type ContextUsageState,
} from "@/lib/contextUsage";
import {
  applyPlanPendingMembership,
  closedSessionPlan,
  emptySessionPlan,
  invalidatePlanGate,
  planStateToStored,
  restorePlanFromPersistence,
  type SessionPlanState,
} from "@/lib/planSession";
import { shouldExitComposerPlanModeAfterDecision } from "@/lib/planModePro";
import {
  collectActivitySessions,
  countQuitBlockingSessions,
  stoppableActivitySessions,
} from "@/lib/agentActivity";
import { resolveTrayBusyBadgeCount } from "@/lib/trayNotifyPro";
import {
  collectAgentDashboardRows,
  countBusyDashboardRows,
} from "@/lib/agentDashboard";
import { buildTaskBoard } from "@/lib/sessionTaskBoard";
import type { OpsEntryCounts, OpsEntryDestinationId } from "@/lib/opsEntry";
import {
  BATCH_AGENTS_HEADLESS_TIMEOUT_MS,
  buildBatchPromptBody,
  buildBatchSessionTitle,
  classifyBatchError,
  mapHeadlessHostResult,
  summarizeBatchResults,
  upsertBatchResultItem,
  type BatchDispatchItemResult,
  type BatchDispatchMode,
  type BatchDispatchSummary,
  type BatchProjectInput,
} from "@/lib/batchAgents";
import {
  type ProcessLimitEvent,
} from "@/lib/processBudget";
import {
  buildReliabilityCenter,
  reliabilityErrorFromDeck,
} from "@/lib/reliabilityCenter";
import {
  buildGoalControlSummary,
  filterGoalOrchEvents,
  planClearGoalOrchEvents,
  resolveGoalOrchSessionIndicator,
  shouldConfirmClearGoalOrch,
} from "@/lib/goalOrch";
import * as api from "@/lib/api";
import { queueComposerPreferenceApply } from "@/lib/composerPrefsBarrier";
import {
  isDangerousSandboxProfile,
  normalizeSandboxProfile,
  sandboxDangerConfirmKey,
  sandboxProfileLabelKey,
  type SandboxProfileId,
} from "@/lib/sandboxProfile";
import { shouldRestoreLastSession } from "@/lib/sessionRestore";
import {
  planArchiveOlderThan,
  type ArchiveAgePlan,
} from "@/lib/sessionArchiveAge";
import {
  collapsedIdsFromExpandMap,
  expandMapFromCollapsedIds,
  sameCollapsedIdSet,
} from "@/lib/sidebarExpand";
import {
  armStopLatch,
  createStopLatchState,
  tickStopLatch,
  STOP_LATCH_MS,
} from "@/lib/stopLatch";
import {
  isSettingsEscapeOwnedByNestedLayer,
  shouldEscapeCloseSettings,
  shouldEscapeStopGeneration,
} from "@/lib/escapeStop";
import { endOfTurnMarkerContent } from "@/lib/endOfTurn";
import {
  isMirrorClient,
  mirrorEnsureTransport,
  mirrorHello,
  mirrorToken,
  mirrorWsConnected,
} from "@/lib/mirrorTransport";
import { deriveMirrorClientLinkStatus } from "@/lib/mirrorStatus";

import {
  createT,
  parseLocalePreference,
  htmlLangForLocale,
  resolveLocale,
  readSystemLangTag,
  resolveLocaleFromSystem,
  resolveLocalePreference,
  DEFAULT_LOCALE_PREFERENCE,
  loadLocaleCatalog,
  type Locale,
  type LocalePreference,
} from "@/i18n";
import {
  DEFAULT_EFFORT,
  DEFAULT_MODEL_ID,
  GROK_BUILD_EFFORTS,
  GROK_BUILD_MODELS,
  findModel,
  effortCatalogForRoute,
  effortOptionsFromProvider,
  isValidEffort,
  isValidModelId,
  isValidPolicy,
  isValidPrefsScope,
  mapEffortToTargetCatalog,
  pickDefaultEffort,
  pickDefaultModelId,
  resolveContextWindow,
  type EffortOption,
  type ModelOption,
  type PermissionPolicyId,
} from "@/lib/grokCatalog";
import {
  mapPermissionButtons,
} from "@/lib/permissionOptions";
import { dropAskUserClocks } from "@/components/AskUserModal";
import { type PaletteActionDef } from "@/lib/paletteActions";
import {
  canOfferContinueCwd,
  classifyContinueCwdEmptyResult,
  continueCwdSoftFailMessageKey,
  evaluateContinueCwd,
  resolveContinueCwdEmptyHonesty,
  resolveContinueCwdSoftFail,
  type ContinueCwdSoftFailKind,
} from "@/lib/continueCwd";

import {
  clearPlanHistory,
  loadPlanHistory,
  recordPlanHistory,
  PLAN_HISTORY_CHANGE_EVENT,
  PLAN_HISTORY_STORAGE_KEY,
} from "@/lib/planHistory";
import type { PlanHistoryEntry } from "@/lib/planHistory";
import { planDisplayMarkdown } from "@/lib/planBody";

import {
  connPillForState,
  connPillRetryable,
  shouldDisableReconnectBecauseConnecting,
} from "@/lib/connStatus";
import {
  formatShortcutHint,
  matchGlobalShortcut,
} from "@/lib/shortcuts";
import { nextSessionId } from "@/lib/sidebarSessionNav";
import {
  isShortcutRecordingActive,
  loadShortcutRemaps,
  SHORTCUT_REMAP_CHANGED_EVENT,
  SHORTCUT_REMAP_STORAGE_KEY,
  type ShortcutRemapMap,
} from "@/lib/shortcutRemap";
import {
  loadVoiceHotkeyEnabled,
  shouldFireLiveVoiceHotkey,
  VOICE_HOTKEY_CHANGED_EVENT,
  VOICE_HOTKEY_STORAGE_KEY,
} from "@/lib/voiceHotkeyPref";
import {
  ensureNotifyPermission,
  listenForNativeNotifyClicks,
  setDesktopNotifySessionFocusHandler,
} from "@/lib/desktopNotify";
import {
  clearAllMutes as clearAllSessionMutes,
  loadMutedSessionIds,
  SESSION_MUTE_CHANGE_EVENT,
  shouldConfirmClearAllMutes,
  toggle as toggleSessionMute,
} from "@/lib/sessionMute";
import {
  clearAllUnread as clearAllSessionUnread,
  clearUnread as clearSessionUnread,
  isWorkbenchForeground,
  loadUnreadSessionIds,
  markUnread as markSessionUnread,
  SESSION_UNREAD_CHANGE_EVENT,
  shouldConfirmClearAllUnread,
} from "@/lib/sessionUnread";
import {
  clearNote as clearSessionNote,
  getNote as getSessionNote,
  loadSessionNotes,
  setNote as setSessionNote,
  shouldConfirmSessionNoteClear,
  shouldConfirmSessionNoteDiscard,
  validateSessionNote,
} from "@/lib/sessionNotes";
import {
  dismissCliUpdateNotice,
  shouldOfferCliUpdateNotice,
} from "@/lib/cliUpdateNotice";
import {
  loadDone as loadProductTutorialDone,
  markDone as markProductTutorialDone,
  shouldAutoOffer as shouldAutoOfferProductTutorial,
} from "@/lib/productTutorial";
import {
  buildAgentPrompt,
  mergeAttachments,
  type Attachment,
} from "@/lib/attachments";
import {
  addChatRef,
  lookupChatTitle,
  parseChatTokens,
  prependChatTokens,
  stripChatTokens,
} from "@/lib/chatAttach";
import { useAttachChat } from "@/hooks/useAttachChat";
import { mapStoredMessagesToChat } from "@/lib/mapStoredMessages";
import {
  detectAtQueryFromEditor,
  rankAtFileHits,
  removeAtTokenFromDraft,
} from "@/lib/atFileQuery";
import {
  type ComposerAtFileEntry,
} from "@/components/ComposerAtPanel";
import {
  formatAttachErrorMessage,
  isAttachPayloadTooLarge,
  resolveAttachError,
  resolveHostOnlyAttach,
  resolveNativeClipboardEmpty,
} from "@/lib/attachmentsPro";
import { fileKey as clipboardFileKey, readClipboardMediaFiles } from "@/lib/clipboardPaste";
import {
  applySkillAtSlash,
  isDraftEmpty,
  detectSlashQueryFromEditor,
  detectSlashRangeOnStored,
  parseStoredContent,
  serializeForAgent,
} from "@/lib/draftDoc";
import {
  isActiveJsonSchema,
  wrapAgentTextWithJsonSchema,
} from "@/lib/jsonSchema";
import { sanitizeExtraRules } from "@/lib/sessionExtraRules";
import { normalizeMaxAgentTurns } from "@/lib/sessionMaxAgentTurns";
import { sanitizeSystemPromptOverride } from "@/lib/sessionSystemPrompt";
import {
  presentSessionPromptSoftFail,
  shouldConfirmSessionTextDiscard,
  validateSessionTextField,
} from "@/lib/rulesPromptPro";
import {
  collectUserPromptHistory,
  filterPromptHistory,
  promptHistoryListNavFromKey,
  shouldHandlePromptHistoryKey,
  stepPromptHistory,
  stepPromptHistoryListIndex,
  type PromptHistoryEntry,
} from "@/lib/composerPromptHistory";
import {
  clearRecentPromptHistory,
  filterRecentPromptHistory,
  loadRecentPromptHistory,
  recordRecentPrompt,
  RECENT_PROMPT_HISTORY_CHANGE_EVENT,
  RECENT_PROMPT_HISTORY_STORAGE_KEY,
} from "@/lib/recentPromptHistory";
import {
  composerSteerLive,
  resolveComposerSubmitAction,
} from "@/lib/composerSendKey";
import {
  composerDraftStore,
  getDraft as getComposerDraft,
} from "@/lib/composerDraftStore";
import {
  clearComposerProjectDraft,
  loadComposerProjectDraft,
  projectDraftKey,
  resolveComposerProjectDraftToApply,
  saveComposerProjectDraft,
  type ComposerProjectDraft,
} from "@/lib/composerProjectDraft";
import {
  loadComposerSessionDraft,
  saveComposerSessionDraft,
} from "@/lib/composerSessionDraft";
import {
  appendQuotesToContent,
  makeComposerQuoteId,
  serializeQuotesForAgent,
  type ComposerQuote,
} from "@/lib/composerQuotes";
import { shouldReopenUnhydratedSession } from "@/lib/chatTranscriptEmpty";
import {
  type PromptHistoryScope,
} from "@/components/PromptHistoryPanel";
import {
  makeQueuedSend,
  queueSessionKey,
  resolveSendQueueStripState,
  type QueuedSend,
} from "@/lib/sendQueue";
import {
  resolveTurnClockKey,
  shouldSyncViewedTurnClock,
} from "@/lib/turnClock";
import {
  useSendQueue,
  type ExecuteSendFromQueue,
} from "@/hooks/useSendQueue";
import {
  buildSlashCatalog,
  countSlashByKind,
  flattenFilteredCatalog,
  type SlashItem,
} from "@/lib/slashCatalog";
import {
  leftoverWorkflowArgs,
  resolveWorkflowSlashAction,
  stripWorkflowSlashFromDraft,
} from "@/lib/workflowSlash";
import type { MessageKey } from "@/i18n";
import { ImageViewerProvider } from "@/components/ImageViewer";
import {
  type SidebarSessionRowLabels,
  type SidebarSessionWorktreeBadgeProp,
} from "@/components/SidebarSessionRow";
import { sidebarSessionRowMetrics } from "@/lib/sidebarDensity";
import { sortSessionsForSidebar } from "@/lib/sidebarDateGroups";
import { nextSessionTitle } from "@/lib/sidebarSessionRename";
import { GrokLogo } from "@/components/GrokLogo";
import type { SetupCliInfo } from "@/components/SetupWizard";
import {
  buildAuthDeferredFlags,
  formatCliTooOldDetail,
  isCliVersionUnsupported,
  resolveSetupGateBoot,
} from "@/lib/setupGatePro";
import { mapProbeToCliInfo } from "@/lib/cliVersionStatus";
import {
  requestComposerStoredCaret,
  resizeComposerInput,
  serializeDom,
} from "@/components/ComposerEditor";

import {
  applyGitStatusBranch,
  buildWorktreePath,
  canRemoveWorktree,
  mainWorktreePath,
  normalizeWorktreeLayout,
  pathsEqual,
  resolveSessionWorktreeBadge,
  sanitizeWorktreeName,
  sanitizeWorktreeRef,
  sessionWorktreeTooltip,
  worktreeEntryForPath,
  worktreeRemoveErrorSuggestsForce,
  type SessionWorktreeBadge,
  type WorktreeLayout,
} from "@/lib/gitWorktree";
import { filterCliWorktreesForProject } from "@/lib/cliWorktrees";
import {
  canShipWorktree,
  combineShipOutcome,
  defaultPrTitleFromBranch,
  redactShipOutput,
  sanitizePrBody,
  sanitizePrTitle,
  shipOutcomeSummary,
} from "@/lib/wtShipFlow";
import {
  PR_HUB_ANCHOR_ID,
  buildPrHubDeepLink,
  parseGithubPrNumber,
} from "@/lib/prHubDeepLink";
import {
  buildForkWorktreeName,
  canRestoreCodeOnFork,
  defaultForkAgentChecked,
  forkSuccessToastKey,
  isWorktreeNameCollisionError,
  resolveForkAgentCheckbox,
  resolveForkAgentSession,
  resolveSessionForkSoftFail,
  softFailKindFromRestoreGate,
} from "@/lib/sessionFork";
import {
  buildResumeWorktreeName,
  canOfferResumeWithCodeRestore,
  canRestoreCodeOnResume,
} from "@/lib/sessionResumeRestore";
import { isProjectPathMissing } from "@/lib/projectPath";
import {
  normalizeProjectColor,
  type ProjectColorToken,
} from "@/lib/projectColor";
import { appendPluginDir } from "@/lib/sessionPluginDirs";
import { isVoiceToggleKey } from "@/lib/voiceDictation";
import {
  buildComposerPlusEntries,
  createVideoMatchesQuery,
  jsonSchemaMatchesQuery,
  uploadMatchesQuery,
} from "@/components/ComposerPlusPanel";
import { planInsertSkill } from "@/lib/skillsTaskPicker";
import {
  IconPlus,
  IconClipboardList,
} from "@/components/icons";
import { PhoneAccountSheet } from "@/components/PhoneAccountSheet";
import { PhoneComposerToolsSheet } from "@/components/PhoneComposerToolsSheet";
import { type ContextMenuItem } from "@/components/ContextMenu";
import {
  aiCreateSeedPrompt,
  computeNextRunAt,
  type Automation,
} from "@/lib/automations";
import { automationsBackgroundStatus } from "@/lib/automationsBackgroundStatus";
import { recordAutomationRun } from "@/lib/automationRunHistory";
import {
  extractAutomationPayload,
  recentUserPlainText,
  resolveAutomationUpsertTarget,
  shouldAutoApplyAutomationFence,
} from "@/lib/automationSetup";

import type { ComposerModelPick } from "@/lib/composerModelGroups";
import {
  alignGrokPresetEfforts,
  resolveProviderBrandId,
} from "@/lib/providerPresets";
import {
  classifyProviderBalanceError,
  providerBalanceErrorMessageKey,
  supportsProviderBalance,
} from "@/lib/providerBalanceHonesty";
import {
  isProviderBalanceCacheFresh,
  type ProviderBalanceCache,
} from "@/lib/providerBalanceFormat";
import type { ResourceOpenTarget } from "@/components/ResourceViewer";
import {
  applySideStripClose,
  emptySideWorkbenchState,
  openSideTab,
  openSideTabFromPicker,
  type SidePickerKind,
  type SideWorkbenchState,
} from "@/lib/sideWorkbench";
import {
  isSideDockComposerActive,
  shouldHideChatForSideExpand,
} from "@/lib/sideFloatComposer";
import { applySideContextOpen } from "@/lib/sideContextOpen";
import { resolveSidePathDeepLink } from "@/lib/sidePathDeepLink";

import { WorkbenchAppDialogStage } from "@/app/WorkbenchAppDialogStage";
import { WorkbenchComposerModals } from "@/app/WorkbenchComposerModals";
import {
  mergeSessionChange,
  summarizeSessionChanges,
  type SessionFileChange,
} from "@/lib/sessionChanges";
import {
  gitDirtySummariesEqual,
  summarizeGitDirty,
  type GitDirtySummary,
} from "@/lib/workspaceGit";

const AutomationsPage = lazy(async () => {
  const m = await import("@/components/AutomationsPage");
  return { default: m.AutomationsPage };
});
const KanbanBoardPage = lazy(async () => {
  const m = await import("@/components/KanbanBoardPage");
  return { default: m.KanbanBoardPage };
});
const SetupWizard = lazy(async () => {
  const m = await import("@/components/SetupWizard");
  return { default: m.SetupWizard };
});
const BottomTerminal = lazy(async () => {
  const m = await import("@/components/bottom-terminal/BottomTerminal");
  return { default: m.BottomTerminal };
});

import {
  isTypingTarget,
  preferPermissionFocus,
  trapTabKey,
} from "@/lib/a11yFocus";
import {
  quotaFromHostItem,
  type SwitcherQuota,
} from "@/lib/accountSwitcherQuota";
import {
  type SettingsSectionId,
} from "@/components/SettingsPage";
import { isSettingsSectionId } from "@/lib/settingsCatalog";
import {
  isAccountConnected,
  loadCachedSuperGrokBrand,
  resolveWelcomeBrandKind,
  saveCachedSuperGrokBrand,
  superGrokBrandKind,
} from "@/lib/accountUi";
import {
  type SuperGrokBrandKind,
} from "@/components/SuperGrokMark";
import {
  DeepSeekFullMark,
  OpenCodeWordmark,
  VolcanoArkWelcomeMark,
} from "@/components/ProviderWelcomeMark";
import {
  WindowControls,
  tauriDragRegion,
  titlebarMaximizeHandlers,
} from "@/components/WindowControls";

import {
  isGeneralProject,
  mapProjectsList,
  mapSessionListRow,
  normalizeProject,
  normalizeProjectId,
  normalizeSessionRow,
  projectDisplayName,
  type Project,
  type SessionRow,
} from "@/lib/app/sidebarModels";
import {
  moveProjectInPinGroup,
} from "@/lib/app/projectOrder";
import { useSidebarProjectReorder } from "@/hooks/useSidebarProjectReorder";
import { useSessionMoveProject } from "@/hooks/useSessionMoveProject";
import { useSidebarSessionMoveDrag } from "@/hooks/useSidebarSessionMoveDrag";
import { useSideWorkbenchProjectIsolation } from "@/hooks/useSideWorkbenchProjectIsolation";
import { useBottomTerminal } from "@/hooks/useBottomTerminal";
import { useProjectSpaces } from "@/hooks/useProjectSpaces";
import {
  findSpace,
  spaceDisplayName,
  type CreateSpaceError,
  type DeleteSpaceError,
  type SpaceNameError,
} from "@/lib/projectSpaces";
import type { ContextMenuState } from "@/lib/app/appDialogTypes";
import { useSessionRuntime } from "@/hooks/useSessionRuntime";
import { sessionTranscriptStore } from "@/lib/sessionTranscriptStore";
import { useSessionConnect, createSessionConnectHost } from "@/hooks/useSessionConnect";
import { useComposerController } from "@/hooks/useComposerController";
import { useTypeToFocusComposer } from "@/hooks/useTypeToFocusComposer";
import { useAppDialogs } from "@/hooks/useAppDialogs";
import { useSessionHostEvents } from "@/hooks/useSessionHostEvents";
import { useSessionSpend } from "@/hooks/useSessionSpend";
import { useGhostStreamingHeal } from "@/hooks/useGhostStreamingHeal";
import { useAccountQuotaAutoRefresh } from "@/hooks/useAccountQuotaAutoRefresh";
import { useWorkbenchDisplayPrefs } from "@/hooks/useWorkbenchDisplayPrefs";
import { useWorkbenchLayout } from "@/hooks/useWorkbenchLayout";
import { usePaneUnreadDot } from "@/hooks/usePaneUnreadDot";
import { useSettingsNavigation } from "@/hooks/useSettingsNavigation";
import { useAppSettingsPrefs } from "@/hooks/useAppSettingsPrefs";
import { useSearchPalette } from "@/hooks/useSearchPalette";
import { useCompactDialog } from "@/hooks/useCompactDialog";
import { useQueueEditDialog } from "@/hooks/useQueueEditDialog";
import { useVoiceDictation } from "@/hooks/useVoiceDictation";
import { useComposerSend } from "@/hooks/useComposerSend";
import { useSessionCatalog } from "@/hooks/useSessionCatalog";
import {
  createSessionNavHost,
  useSessionNavigation,
} from "@/hooks/useSessionNavigation";
import { WorkbenchSessionTree } from "@/app/WorkbenchSessionTree";
import { WorkbenchSidebar } from "@/app/WorkbenchSidebar";
import { WorkbenchMain } from "@/app/WorkbenchMain";
import { WorkbenchResourcesAside } from "@/app/WorkbenchResourcesAside";
import { WorkbenchDomainOverlays } from "@/app/WorkbenchDomainOverlays";
import { WorkbenchSessionModals } from "@/app/WorkbenchSessionModals";
import { WorkbenchChromeOverlays } from "@/app/WorkbenchChromeOverlays";
import { WorkbenchComposerColumn } from "@/app/WorkbenchComposerColumn";
import { WorkbenchFloatingMenus } from "@/app/WorkbenchFloatingMenus";
import { WorkbenchSettingsStage } from "@/app/WorkbenchSettingsStage";
import { WorkbenchChatStage } from "@/app/WorkbenchChatStage";
import { PaneToggleButton } from "@/components/PaneToggleButton";
import { useSessionExportText } from "@/hooks/useSessionExportText";
import { useSessionExportImage } from "@/hooks/useSessionExportImage";
import {
  useReliabilityCenter,
  useSandboxWizard,
} from "@/hooks/useSandboxReliability";
import { createDebouncedSkillsReload } from "@/lib/skillCatalogRefresh";

/** App-local plan chrome state (session-scoped via planBySessionRef). */
type PlanState = SessionPlanState;

function spaceErrorKey(
  err: SpaceNameError | CreateSpaceError | DeleteSpaceError,
): MessageKey {
  switch (err) {
    case "empty":
      return "sidebar.spaces.err.empty";
    case "duplicate":
      return "sidebar.spaces.err.duplicate";
    case "too_long":
      return "sidebar.spaces.err.tooLong";
    case "limit":
      return "sidebar.spaces.err.limit";
    case "last":
      return "sidebar.spaces.err.last";
    case "default":
      return "sidebar.spaces.err.default";
    case "not_found":
      return "sidebar.spaces.err.notFound";
  }
}

export function AppWorkbench() {
  const {
    theme,
    themePreference,
    themeSchedule,
    skin,
    wallpaperRecord,
    wallpaperUrl,
    wallpaperScrim,
    applyThemeChoice,
    applyThemeScheduleChoice,
    applySkinChoice,
    applyWallpaperChoice: applyWallpaperChoiceBase,
    applyWallpaperAdjustChoice,
    applyWallpaperMediaSize,
    applyWallpaperScrimChoice,
  } = useThemeShell();
  const {
    showMessageTimestamps,
    setShowMessageTimestamps,
    showReplyLength,
    setShowReplyLength,
    replaceProviderBrandLogo,
    setReplaceProviderBrandLogo,
    welcomeMotionEnabled,
    setWelcomeMotionEnabled,
    goalOrchUiEnabled,
    setGoalOrchUiEnabled,
    goalOrchEvents,
    setGoalOrchEvents,
    messageTimeFormat,
    setMessageTimeFormat,
    sidebarShowRelativeTime,
    setSidebarShowRelativeTime,
    notifySound,
    setNotifySound,
    windowAlwaysOnTop,
    setWindowAlwaysOnTop,
    trayBusyBadge,
    setTrayBusyBadge,
    winTaskbarOverlay,
    setWinTaskbarOverlay,
    composerSendKeyPref,
    showComposerDraftStats,
    composerSpellcheck,
    sidebarDensity,
    permissionTimeoutSec,
    setPermissionTimeoutSec,
    askUserTimeoutSec,
    setAskUserTimeoutSec,
  } = useWorkbenchDisplayPrefs();
  // Warm loopback media HTTP endpoint ASAP so chat images resolve to
  // http://127.0.0.1 (not media://) before the first history paint.
  useEffect(() => {
    void import("@/lib/imageSrc")
      .then((m) => m.ensureMediaEndpoint())
      .catch(() => {
        /* non-Tauri / server down */
      });
  }, []);
  /** Per-session desktop notification mute (localStorage Set). */
  const [mutedSessionIds, setMutedSessionIds] = useState<Set<string>>(
    () => loadMutedSessionIds(),
  );
  useEffect(() => {
    const onChange = () => setMutedSessionIds(loadMutedSessionIds());
    window.addEventListener(SESSION_MUTE_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(SESSION_MUTE_CHANGE_EVENT, onChange);
  }, []);
  /**
   * Sessions that finished a turn while not viewed (localStorage Set).
   * Independent of mute — muted chats still show the sidebar unread dot.
   */
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(
    () => loadUnreadSessionIds(),
  );
  useEffect(() => {
    const onChange = () => setUnreadSessionIds(loadUnreadSessionIds());
    window.addEventListener(SESSION_UNREAD_CHANGE_EVENT, onChange);
    return () =>
      window.removeEventListener(SESSION_UNREAD_CHANGE_EVENT, onChange);
  }, []);
  /**
   * Clear one session's unread marker and sync React state immediately so
   * sidebar dots + dock/tray badge count drop without waiting solely on the
   * storage CustomEvent (open / focus / mark-as-read paths share this).
   */
  const applyClearSessionUnread = useCallback(
    (sessionId: string | null | undefined) => {
      const id = typeof sessionId === "string" ? sessionId.trim() : "";
      if (!id) return;
      clearSessionUnread(id);
      setUnreadSessionIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [],
  );
  /**
   * Manual "mark as unread" while the chat is still open: hold the badge until
   * the user leaves and re-opens the thread (auto clear-on-view still applies).
   */
  const manualUnreadHoldIdsRef = useRef<Set<string>>(new Set());
  const applyMarkSessionUnread = useCallback(
    (sessionId: string | null | undefined) => {
      const id = typeof sessionId === "string" ? sessionId.trim() : "";
      if (!id) return;
      markSessionUnread(id);
      setUnreadSessionIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      if (viewingSessionIdRef.current === id) {
        manualUnreadHoldIdsRef.current.add(id);
      }
    },
    [],
  );
  /**
   * Sessions with an open plan review gate (or restored re-park wait).
   * Sidebar badge only — does not change open/busy/select interactions.
   */
  const [planPendingSessionIds, setPlanPendingSessionIds] = useState<
    Set<string>
  >(() => new Set());
  const markPlanPendingBadge = useCallback(
    (sessionId: string | null | undefined, plan: SessionPlanState) => {
      setPlanPendingSessionIds((prev) =>
        applyPlanPendingMembership(prev, sessionId, plan),
      );
    },
    [],
  );
  const {
    appDialog,
    setAppDialog,
    dismissDialog,
    dialogInput,
    setDialogInput,
    dialogError,
    setDialogError,
    dialogInputRef,
    confirmBtnRef,
    appDialogPanelRef,
    appDialogRef,
    sessionNotesMap,
    setSessionNotesMap,
    sessionNoteTarget,
    setSessionNoteTarget,
    sessionNoteDraft,
    setSessionNoteDraft,
    sessionNoteBaseline,
    setSessionNoteBaseline,
    sessionNoteDiscardOpen,
    setSessionNoteDiscardOpen,
    sessionNoteClearOpen,
    setSessionNoteClearOpen,
    sessionRulesTarget,
    setSessionRulesTarget,
    sessionRulesDraft,
    setSessionRulesDraft,
    sessionRulesBaseline,
    setSessionRulesBaseline,
    sessionRulesBusy,
    setSessionRulesBusy,
    sessionRulesError,
    setSessionRulesError,
    sessionRulesDiscardOpen,
    setSessionRulesDiscardOpen,
    sessionMaxTurnsTarget,
    setSessionMaxTurnsTarget,
    sessionMaxTurnsDraft,
    setSessionMaxTurnsDraft,
    sessionSysPromptTarget,
    setSessionSysPromptTarget,
    sessionSysPromptDraft,
    setSessionSysPromptDraft,
    sessionSysPromptBaseline,
    setSessionSysPromptBaseline,
    sessionSysPromptBusy,
    setSessionSysPromptBusy,
    sessionSysPromptError,
    setSessionSysPromptError,
    sessionSysPromptDiscardOpen,
    setSessionSysPromptDiscardOpen,
    rewindTimeline,
    setRewindTimeline,
    rewindBusy,
    setRewindBusy,
    rewindConfirm,
    setRewindConfirm,
    rewindRestoreFiles,
    setRewindRestoreFiles,
    rewindError,
    setRewindError,
    rewindModalRef,
    forkConfirm,
    setForkConfirm,
    forkRestoreCode,
    setForkRestoreCode,
    forkCliSession,
    setForkCliSession,
    forkBusy,
    setForkBusy,
    resumeRestoreConfirm,
    setResumeRestoreConfirm,
    resumeForkCliSession,
    setResumeForkCliSession,
    resumeRestoreBusy,
    setResumeRestoreBusy,
  } = useAppDialogs();
  const asideCloseExtrasRef = useRef<() => void>(() => {});
  const {
    layout,
    layoutRef,
    zenMode,
    setZenModeEnabled,
    transcriptFilter,
    toggleTranscriptFilter,
    phoneLayout,
    viewportWidth,
    sidebarOpenW,
    asideOpenW,
    sidebarOverlay,
    resizingAside,
    resizingSidebar,
    openAsidePane,
    openAsidePaneRef,
    closeAsidePane,
    collapseAsidePersisted,
    collapseChromeEphemeral,
    openSidebarPane,
    closeSidebarPane,
    closePhoneDrawer,
    openPhoneDrawer,
    beginSidebarResize,
    beginAsideResize,
  } = useWorkbenchLayout({
    onAsideClose: () => asideCloseExtrasRef.current(),
  });
  /** Side Workbench multi-kind tabs (session-local; Phase 0+). */
  const [sideWorkbench, setSideWorkbench] = useState<SideWorkbenchState>(
    emptySideWorkbenchState,
  );
  const sideWorkbenchRef = useRef(sideWorkbench);
  sideWorkbenchRef.current = sideWorkbench;
  const [closeActiveSideRequest, setCloseActiveSideRequest] = useState<{
    token: number;
  } | null>(null);
  const closeActiveSideTokenRef = useRef(0);
  /**
   * When side is expanded: optional bottom-docked compressed composer (icon toggle).
   * Resets whenever expand ends.
   */
  const [sideDockComposer, setSideDockComposer] = useState(false);
  /**
   * Measured height of the docked composer strip.
   * Drives --sw-dock-composer-h so the side pane ends above it.
   */
  const [sideDockComposerH, setSideDockComposerH] = useState(0);
  /** Git work tree gate for Review picker entry. */
  const [sideIsGitProject, setSideIsGitProject] = useState(false);

  /**
   * Secondary session window (`session-*` label / `#/session/<id>` deep link).
   * Live-capable (session-keyed Host pool): send / stop / warm-connect use the
   * shared process Host (session-targeted). Connecting/sending on this chat
   * demotes other busy agents to background (stream continues) — never kills.
   */
  // True only for real `session-*` windows (set after label detect). Hash alone
  // on main must not change layout / chrome.
  const [isSecondaryWindow, setIsSecondaryWindow] = useState(false);
  const isSecondaryWindowRef = useRef(false);
  isSecondaryWindowRef.current = isSecondaryWindow;
  /** Session id this secondary window should open (from hash or label). */
  const [secondaryFocusSessionId, setSecondaryFocusSessionId] = useState<
    string | null
  >(() =>
    typeof window !== "undefined"
      ? parseSessionDeepLinkHash(window.location.hash)
      : null,
  );
  const secondaryFocusSessionIdRef = useRef<string | null>(
    secondaryFocusSessionId,
  );
  secondaryFocusSessionIdRef.current = secondaryFocusSessionId;
  /** False until desktop window label is resolved (or non-desktop path). */
  const [windowRoleReady, setWindowRoleReady] = useState(
    () => !api.isDesktopHost(),
  );
  const secondaryOpenedRef = useRef(false);
  const {
    session,
    setSession,
    liveHost,
    setLiveHost,
    liveHostRef,
    setLiveMap,
    liveMapRef,
    stopLatch,
    setStopLatch,
    stopLatchRef,
    messages,
    setMessages,
    messagesRef,
    messagesBySessionRef,
    viewingSessionIdRef,
    currentViewFocus,
    bumpViewEpoch,
    patchSessionMessages,
    busyIds,
    settleStoppedSessionUi,
    stopGate,
    effectiveCanSend,
    effectiveCanStop,
    transcriptMeta,
  } = useSessionRuntime({ isSecondaryWindow });

  /** Context usage chip — known tokens from compact events + estimate fallback. */
  const [contextUsage, setContextUsage] = useState<ContextUsageState>(
    INITIAL_CONTEXT_USAGE,
  );
  /**
   * Files written/edited by agent tools per session (Changes / diff panel).
   * Live tool events may enrich entries with before/after snippets.
   */
  const [sessionChangesById, setSessionChangesById] = useState<
    Record<string, SessionFileChange[]>
  >({});
  /**
   * Workspace git dirty summary for the active project (composer chip).
   * Null when not a repo, unavailable, clean, or no active project.
   */
  const [gitDirtySummary, setGitDirtySummary] =
    useState<GitDirtySummary | null>(null);
  const {
    getDraft,
    setDraft,
    attachments,
    attachmentsRef,
    setAttachments,
    chatAttachments,
    setChatAttachments,
    attachChatOpen,
    setAttachChatOpen,
    attachChatFilter,
    setAttachChatFilter,
    attachChatActive,
    setAttachChatActive,
    attachChatPanelRef,
    attachChatOpenRef,
    quotes,
    quotesRef,
    setQuotes,
    suppressProjectDraftPersistRef,
    setPromptHistoryIndex,
    promptHistoryIndexRef,
    promptHistoryOpen,
    setPromptHistoryOpen,
    promptHistoryFilter,
    setPromptHistoryFilter,
    promptHistoryActive,
    setPromptHistoryActive,
    promptHistoryFocusFilter,
    setPromptHistoryFocusFilter,
    promptHistoryScope,
    setPromptHistoryScope,
    promptHistoryScopeRef,
    recentPromptHistory,
    setRecentPromptHistory,
    promptHistoryClearOpen,
    setPromptHistoryClearOpen,
    promptHistoryPanelRef,
    promptHistoryOpenRef,
    skillInfos,
    setSkillInfos,
    skillsLoading,
    setSkillsLoading,
    skillsLoadError,
    setSkillsLoadError,
    slashQuery,
    setSlashQuery,
    liveSlash,
    setLiveSlash,
    liveSlashRef,
    slashDismissedSigRef,
    showComposerPlusRef,
    slashActiveIndex,
    setSlashActiveIndex,
    slashKindFilter,
    setSlashKindFilter,
    liveAt,
    setLiveAt,
    liveAtRef,
    atDismissedSigRef,
    atActiveIndex,
    setAtActiveIndex,
    atEntries,
    setAtEntries,
    atLoading,
    setAtLoading,
    atSoftFail,
    setAtSoftFail,
    atPanelRef,
    atSearchGenRef,
    showComposerPlus,
    setShowComposerPlus,
    composerPlusTriggerRef,
    composerPlusPanelRef,
    composerInputRef,
    composerShellRef,
    composerFloatPad,
    setComposerFloatPad,
  } = useComposerController();
  const typeToFocusLiveRef = useRef({ enabled: false, overlayOpen: false });
  useTypeToFocusComposer({
    getEditor: () => composerInputRef.current,
    getLive: () => typeToFocusLiveRef.current,
  });

  /**
   * Archive-by-age pro confirm (GlassModal with preview count + title samples).
   * Null when closed. Built via pure `planArchiveOlderThan`.
   */
  const [archiveAgeConfirm, setArchiveAgeConfirm] =
    useState<ArchiveAgePlan<SessionRow> | null>(null);
  const [archiveAgeBusy, setArchiveAgeBusy] = useState(false);
  /** Filled after useVoiceDictation; shortcuts read this at keydown time. */
  const voiceStealsEscapeRef = useRef(false);
  const voiceNotifyRef = useRef<(msg: string, ms?: number) => void>(() => {});
  const voiceSignedInRef = useRef(false);
  const [goalMode, setGoalMode] = useState(false);
  /** Per-session (or draft) JSON Schema for structured output. */
  const [sessionJsonSchema, setSessionJsonSchema] = useState<string | null>(
    null,
  );
  const sessionJsonSchemaRef = useRef<string | null>(null);
  sessionJsonSchemaRef.current = sessionJsonSchema;
  const [showJsonSchemaModal, setShowJsonSchemaModal] = useState(false);
  const [jsonSchemaDraft, setJsonSchemaDraft] = useState("");
  /**
   * Prevent overlapping sends per App session.  The boolean ref is retained
   * as a compatibility aggregate for older hooks; all new claims use the
   * session-keyed set so chat B is never blocked by chat A.
   */
  const sendInFlightRef = useRef(false);
  const sendInFlightBySessionRef = useRef<Set<string>>(new Set());
  const sendEpochBySessionRef = useRef<Map<string, number>>(new Map());
  const isSendInFlightForSession = (sessionId: string | null | undefined) =>
    sendInFlightBySessionRef.current.has(queueSessionKey(sessionId));
  const claimSendForSession = (sessionId: string | null | undefined) => {
    const key = queueSessionKey(sessionId);
    const set = sendInFlightBySessionRef.current;
    if (set.has(key)) return false;
    set.add(key);
    sendInFlightRef.current = set.size > 0;
    return true;
  };
  /**
   * Bumped when a send is superseded (ghost heal / new attempt) so a hung
   * `sessionSend` await cannot re-apply liveMap busy after UI already healed.
   */
  const sendEpochRef = useRef(0);
  const sendQueueRef = useRef<ReturnType<typeof useSendQueue> | null>(null);
  const showToastRef = useRef<(msg: string, ms?: number) => void>(() => {});
  const executeSendFromQueueRef = useRef<ExecuteSendFromQueue>(
    async () => false,
  );
  const executeSendLatestRef = useRef<
    (opts: {
      storedDisplay: string;
      att: Attachment[];
      quotes?: ComposerQuote[];
      goalMode: boolean;
      fromQueue?: boolean;
      targetSessionId?: string | null;
      agentTextOverride?: string;
    }) => Promise<boolean>
  >(async () => false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showUsageLimitModal, setShowUsageLimitModal] = useState(false);
  const [showMcpModal, setShowMcpModal] = useState(false);
  const [mcpServers, setMcpServers] = useState<api.McpDto[]>([]);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpLoading, setMcpLoading] = useState(false);
  /** MCP doctor report (coexists with inspect list; host `mcp_doctor`). */
  const [mcpDoctorReport, setMcpDoctorReport] =
    useState<api.McpDoctorReport | null>(null);
  const [mcpDoctorError, setMcpDoctorError] = useState<string | null>(null);
  const [mcpDoctorLoading, setMcpDoctorLoading] = useState(false);
  const [mcpDoctorFocus, setMcpDoctorFocus] = useState<string | null>(null);
  /** Last user message open in inline edit (not main composer). */
  const [editingUserMessageId, setEditingUserMessageId] = useState<
    string | null
  >(null);
  /** Attachments for the open inline edit (reloaded from the message, editable). */
  const [editAttachments, setEditAttachments] = useState<Attachment[]>([]);
  const editingUserMessageIdRef = useRef<string | null>(null);
  editingUserMessageIdRef.current = editingUserMessageId;
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const projectSpaces = useProjectSpaces();
  const visibleProjects = projectSpaces.visibleProjects(projects);
  const {
    sessions,
    setSessions,
    sessionsRef,
    refreshSessions,
    refreshSessionsRef,
    sessionSelectMode,
    selectedSessionIds,
    selectableSessionCount,
    enterSessionSelectMode,
    exitSessionSelectMode,
    toggleSessionSelected,
    toggleSessionsSelected,
  } = useSessionCatalog({
    projects,
    isDialogOpen: () => !!appDialogRef.current,
  });
  usePetCompanion({
    host: windowRoleReady && !isSecondaryWindow,
    sessions,
  });
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  useSideWorkbenchProjectIsolation(
    activeProject?.id,
    sideWorkbench,
    setSideWorkbench,
  );
  const bottomTerminal = useBottomTerminal(activeProject?.id);
  const [bottomTerminalMounted, setBottomTerminalMounted] = useState(false);
  useEffect(() => {
    if (bottomTerminal.state.open || bottomTerminal.state.tabs.length > 0) {
      setBottomTerminalMounted(true);
    }
  }, [bottomTerminal.state.open, bottomTerminal.state.tabs.length]);
  /**
   * On-disk default cwd for unbound chats (`workspaces/general`).
   * Not a sidebar project — used by connect / resource pane when no folder bound.
   */
  const [generalWorkspacePath, setGeneralWorkspacePath] = useState<string | null>(
    null,
  );
  /** Effective agent / resource root: bound project, else general workspace dir. */
  const effectiveProjectPath =
    activeProject?.path?.trim() || generalWorkspacePath || null;
  /** Probe git so Side Workbench Review entry is gated. */
  useEffect(() => {
    const path = effectiveProjectPath?.trim();
    if (!path) {
      setSideIsGitProject(false);
      return;
    }
    let cancelled = false;
    void api
      .gitStatus(path)
      .then((r) => {
        if (!cancelled) setSideIsGitProject(!!r?.available);
      })
      .catch(() => {
        if (!cancelled) setSideIsGitProject(false);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveProjectPath]);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  /** Avoid writing collapse prefs before settings hydrate on launch. */
  const expandedProjectsHydratedRef = useRef(false);
  const [projectsOpen, setProjectsOpen] = useState(true);
  /** Orphan / “Other sessions” tree section. Hydrated from AppSettings. */
  const [historyOpen, setHistoryOpen] = useState(true);
  /** Avoid writing other-sessions collapse before settings hydrate on launch. */
  const historyOpenHydratedRef = useRef(false);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>(null);
  /** Project rules dialog (from project context menu). */
  const [projectRulesTarget, setProjectRulesTarget] = useState<{
    path: string;
    name: string;
  } | null>(null);
  /** Filled after `useSearchPalette` mounts; shortcuts bind before that. */
  const searchPaletteApiRef = useRef({
    openPalette: () => {},
    openBlank: () => {},
    closePalette: () => {},
    open: false,
  });
  /** Floating composer shell — height drives chat bottom padding. */
  const composerWrapRef = useRef<HTMLDivElement>(null);
  /** One-shot welcome motion: initial draft and each accepted new-chat action. */
  const [welcomeIntroActive, setWelcomeIntroActive] = useState(
    welcomeMotionEnabled,
  );
  useEffect(() => {
    if (!welcomeMotionEnabled) {
      setWelcomeIntroActive(false);
      return;
    }
    if (!welcomeIntroActive) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const settle = () => {
      if (reducedMotion.matches) setWelcomeIntroActive(false);
    };
    settle();
    reducedMotion.addEventListener("change", settle);
    return () => reducedMotion.removeEventListener("change", settle);
  }, [welcomeIntroActive, welcomeMotionEnabled]);
  /** Set by newChat; applied after chat pane + textarea mount. */
  const pendingComposerFocus = useRef(false);
  const composerFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [showUserMenu, setShowUserMenu] = useState(false);
  /** Desktop Connect panel (AC7) — close does not stop host. */

  /** Phone mirror chrome: WS link + host account summary. */
  const [mirrorLinkOk, setMirrorLinkOk] = useState(() =>
    typeof window !== "undefined" && isMirrorClient() ? mirrorWsConnected() : false,
  );
  const [mirrorHostLabel, setMirrorHostLabel] = useState<string | null>(null);
  const [phoneToolsOpen, setPhoneToolsOpen] = useState(false);
  const [phoneAccountOpen, setPhoneAccountOpen] = useState(false);
  /** Inside workbench: chat thread vs scheduled tasks vs agent kanban. */
  const [mainPane, setMainPane] = useState<"chat" | "automations" | "kanban">(
    "chat",
  );
  /** Prevent overlapping automation runs. */
  const automationRunLock = useRef(false);
  /** Conversation is guiding the user to create a scheduled task. */
  const automationSetupDraftRef = useRef(false);
  const automationSetupSessionsRef = useRef(new Set<string>());
  const automationAppliedRef = useRef(new Set<string>());
  const sessionNavHostRef = useRef(createSessionNavHost());
  const sessionConnectHostRef = useRef(createSessionConnectHost());
  const {
    openSession,
    newChat,
    openSessionRef,
    openingSessionIdRef,
    invalidateOpenPipelines,
  } = useSessionNavigation({
    hostRef: sessionNavHostRef,
    focusedSessionId: session.sessionId,
    viewingSessionIdRef,
    bumpViewEpoch,
  });

  // ContextMenu handles outside click + Escape for sidebar menus.

  // Global shortcuts: search, find-in-chat, help, doctor, copy last reply, toggle sidebar, new chat, settings, voice, Esc-stop.
  // Handlers go through refs so we don't re-bind every render.
  const shortcutHandlersRef = useRef({
    newChat: () => {},
    openSettings: () => {},
    closeSettings: () => {},
    openChatFind: () => {},
    copyLastReply: () => {},
    toggleSidebar: () => {},
    /** Right Side Workbench (⌥⌘B). */
    toggleRightPane: () => {},
    /** Open / focus a Side Workbench tab from the empty-state picker chords. */
    openSidePicker: (_kind: SidePickerKind) => {},
    /** Toggle the chat-column bottom terminal (⌘`). */
    toggleBottomTerminal: () => {},
    toggleVoice: () => {},
    cancelVoice: () => {},
    startLiveVoice: () => {},
    stopGeneration: () => {},
    /** Open a sidebar session by id (j/k nav + tray). */
    openSessionById: (_id: string) => {},
  });
  /** Ordered visible session ids for sidebar j/k (visual tree order). */
  const sidebarNavIdsRef = useRef<string[]>([]);
  /** Active / viewing session id for j/k relative moves. */
  const sidebarNavCurrentIdRef = useRef<string | null>(null);
  /** Live Esc→stop gate (overlays / menus / busy) for the capture-phase handler. */
  const escapeStopLiveRef = useRef({
    streamingOrBusy: false,
    overlayOpen: false,
    permOpen: false,
    askUserOpen: false,
    chatFindOpen: false,
    slashOrMenuOpen: false,
    promptHistoryOpen: false,
    settingsOpen: false,
  });
  /** Live user remaps for capture-phase matching + help table. */
  const [shortcutRemaps, setShortcutRemaps] = useState<ShortcutRemapMap>(() =>
    typeof localStorage !== "undefined" ? loadShortcutRemaps() : {},
  );
  const shortcutRemapsRef = useRef<ShortcutRemapMap>(shortcutRemaps);
  shortcutRemapsRef.current = shortcutRemaps;
  /** Live Voice catalog hotkey on/off (localStorage; Settings → Voice). */
  const [voiceHotkeyEnabled, setVoiceHotkeyEnabled] = useState(() =>
    typeof localStorage !== "undefined" ? loadVoiceHotkeyEnabled() : true,
  );
  const voiceHotkeyEnabledRef = useRef(voiceHotkeyEnabled);
  voiceHotkeyEnabledRef.current = voiceHotkeyEnabled;
  useEffect(() => {
    const reload = () => setVoiceHotkeyEnabled(loadVoiceHotkeyEnabled());
    window.addEventListener(VOICE_HOTKEY_CHANGED_EVENT, reload);
    const onStorage = (e: StorageEvent) => {
      if (e.key === VOICE_HOTKEY_STORAGE_KEY || e.key === null) reload();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(VOICE_HOTKEY_CHANGED_EVENT, reload);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  useEffect(() => {
    const reload = () => setShortcutRemaps(loadShortcutRemaps());
    window.addEventListener(SHORTCUT_REMAP_CHANGED_EVENT, reload);
    const onStorage = (e: StorageEvent) => {
      if (e.key === SHORTCUT_REMAP_STORAGE_KEY || e.key === null) reload();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SHORTCUT_REMAP_CHANGED_EVENT, reload);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      // Settings is capturing a new binding — do not run global actions.
      if (isShortcutRecordingActive()) return;
      // Esc cancels in-progress dictation (steal before other Esc handlers).
      if (e.key === "Escape" && voiceStealsEscapeRef.current) {
        e.preventDefault();
        e.stopPropagation();
        shortcutHandlersRef.current.cancelVoice();
        return;
      }
      // Esc: leave Settings, else stop the active turn (catalog: shortcuts.stop).
      if (e.key === "Escape") {
        const gate = escapeStopLiveRef.current;
        const voiceSteals = voiceStealsEscapeRef.current;
        const nestedLayerOpen =
          gate.settingsOpen &&
          isSettingsEscapeOwnedByNestedLayer(
            typeof document !== "undefined" ? document : null,
          );
        if (
          shouldEscapeCloseSettings({
            ...gate,
            voiceStealsEscape: voiceSteals,
            nestedLayerOpen,
          })
        ) {
          e.preventDefault();
          e.stopPropagation();
          shortcutHandlersRef.current.closeSettings();
          return;
        }
        if (
          shouldEscapeStopGeneration({
            ...gate,
            voiceStealsEscape: voiceSteals,
          })
        ) {
          e.preventDefault();
          e.stopPropagation();
          shortcutHandlersRef.current.stopGeneration();
          return;
        }
      }
      // Ctrl+Space toggles voice (not Cmd+Space — Spotlight on macOS).
      // Stays outside matchGlobalShortcut (ctrl-only; order before mod branch).
      if (isVoiceToggleKey(e)) {
        e.preventDefault();
        e.stopPropagation();
        shortcutHandlersRef.current.toggleVoice();
        return;
      }
      // Mod-based catalog actions — single registry in lib/shortcuts.ts.
      // Esc-stop stays special-cased above (order vs voice cancel / overlays).
      const target = e.target as HTMLElement | null;
      const typing = isTypingTarget(target);
      // Sidebar j/k and ArrowUp/Down: next/prev chat when focus is inside the
      // open sidebar list. Never steals from inputs/textareas/contenteditable
      // or when modifiers are held.
      if (
        !typing &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        const navNext =
          key === "j" || key === "arrowdown" || e.key === "ArrowDown";
        const navPrev =
          key === "k" || key === "arrowup" || e.key === "ArrowUp";
        if (navNext || navPrev) {
          const sidebar = querySidebarEl();
          if (sidebar && target && sidebar.contains(target)) {
            const dir = navNext ? "next" : "prev";
            const nextId = nextSessionId(
              sidebarNavIdsRef.current,
              sidebarNavCurrentIdRef.current,
              dir,
            );
            if (nextId) {
              e.preventDefault();
              e.stopPropagation();
              if (nextId !== sidebarNavCurrentIdRef.current) {
                shortcutHandlersRef.current.openSessionById(nextId);
              }
            }
            return;
          }
        }
      }
      // Catalog mod chords — defaults + user remaps (keep Esc / Ctrl+Space special-cased above).
      const matched = matchGlobalShortcut(
        {
          key: e.key.toLowerCase(),
          mod: e.metaKey || e.ctrlKey,
          shift: e.shiftKey,
          alt: e.altKey,
          typing,
        },
        shortcutRemapsRef.current,
        {
          voiceHotkeyEnabled: voiceHotkeyEnabledRef.current,
          settingsOpen: escapeStopLiveRef.current.settingsOpen,
        },
      );
      if (!matched) return;
      e.preventDefault();
      switch (matched) {
        case "findInChat":
          shortcutHandlersRef.current.openChatFind();
          return;
        case "search":
          searchPaletteApiRef.current.openPalette();
          return;
        case "help":
          setShowShortcuts((v) => !v);
          return;
        case "settings":
          if (escapeStopLiveRef.current.settingsOpen) {
            shortcutHandlersRef.current.closeSettings();
          } else {
            shortcutHandlersRef.current.openSettings();
          }
          return;
        case "newChat":
          shortcutHandlersRef.current.newChat();
          return;
        case "doctor":
          setShowDoctor(true);
          return;
        case "copyLastReply":
          shortcutHandlersRef.current.copyLastReply();
          return;
        case "toggleSidebar":
          shortcutHandlersRef.current.toggleSidebar();
          return;
        case "toggleRightPane":
          shortcutHandlersRef.current.toggleRightPane();
          return;
        case "sideFiles":
          shortcutHandlersRef.current.openSidePicker("file");
          return;
        case "sideBrowser":
          shortcutHandlersRef.current.openSidePicker("browser");
          return;
        case "sideTerminal":
          shortcutHandlersRef.current.toggleBottomTerminal();
          return;
        case "liveVoice":
          // Defense in depth: Settings can disable only this hotkey.
          if (!shouldFireLiveVoiceHotkey(voiceHotkeyEnabledRef.current)) {
            return;
          }
          shortcutHandlersRef.current.startLiveVoice();
          return;
        default:
          return;
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  /** First-run gate: loading → setup wizard → ready (home). Mirror forces ready. */
  const [appGate, setAppGate] = useState<"loading" | "setup" | "ready">(() => {
    if (typeof window === "undefined") return "loading";
    if (isMirrorClient()) return "ready";
    // Vite HMR / host heartbeats used to remount this splash forever in `tauri dev`.
    if (import.meta.env.DEV) return "ready";
    return "loading";
  });
  /** Boot probe hung / timed out — show retry on the loading gate. */
  const [bootDetectTimedOut, setBootDetectTimedOut] = useState(false);
  const [bootDetectSlow, setBootDetectSlow] = useState(false);
  const [bootRetryNonce, setBootRetryNonce] = useState(0);
  // Ask once for notification permission after first ready.
  useEffect(() => {
    if (appGate !== "ready") return;
    void ensureNotifyPermission();
  }, [appGate]);
  /** Soft CLI update offer after Ready (#238) — never blocks startup. */
  const [cliUpdateOffer, setCliUpdateOffer] = useState<{
    current: string;
    latest: string;
  } | null>(null);
  const [cliUpdateBusy, setCliUpdateBusy] = useState(false);
  useEffect(() => {
    if (appGate !== "ready" || !api.isTauri() || isMirrorClient()) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const r = await api.cliUpdateCheck();
          if (cancelled || r.error || !r.updateAvailable) return;
          const current = String(
            r.currentVersion || r.current || r.version || "",
          ).trim();
          const latest = String(r.latestVersion || r.latest || "").trim();
          if (!latest || !shouldOfferCliUpdateNotice(latest)) return;
          setCliUpdateOffer({ current: current || "—", latest });
        } catch {
          /* network / CLI missing: silent */
        }
      })();
    }, 4500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [appGate]);
  const [setupCliSeed, setSetupCliSeed] = useState<SetupCliInfo | null>(null);
  const [showDoctor, setShowDoctor] = useState(false);
  const [showTraces, setShowTraces] = useState(false);
  /** Local plan review archive (approved / abandoned / completed). */
  const [showPlanHistory, setShowPlanHistory] = useState(false);
  const [planHistoryPreview, setPlanHistoryPreview] =
    useState<PlanHistoryEntry | null>(null);
  /** Non-empty archive — drives Plan empty-state history CTA. */
  const [planHistoryNonEmpty, setPlanHistoryNonEmpty] = useState(
    () => loadPlanHistory().length > 0,
  );
  /** Request-changes note modal (optional free-form feedback). */
  const [planReviseOpen, setPlanReviseOpen] = useState(false);

  // Keep plan-history empty CTA honest after archive / clear.
  useEffect(() => {
    const refresh = () => setPlanHistoryNonEmpty(loadPlanHistory().length > 0);
    refresh();
    const onChange = () => refresh();
    window.addEventListener(PLAN_HISTORY_CHANGE_EVENT, onChange);
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === PLAN_HISTORY_STORAGE_KEY) refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(PLAN_HISTORY_CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  const [planReviseNote, setPlanReviseNote] = useState("");
  /**
   * Dedupe plan-complete history rows per session+toolCall cycle
   * (session://plan can emit multiple “all done” updates).
   */
  const planCompletedRecordedRef = useRef(new Set<string>());
  /** Reliability / Observability center (busy · stalls · error deck). */
  const {
    open: showReliability,
    openCenter: openReliability,
    closeCenter: closeReliability,
    recentStallSignals,
    setRecentStallSignals,
    recentErrorEntries,
    recordError: recordReliabilityError,
  } = useReliabilityCenter();
  const [showShortcuts, setShowShortcuts] = useState(false);
  /** Optional product tour (not first-run account setup). */
  const [showProductTutorial, setShowProductTutorial] = useState(false);
  const productTutorialAutoOfferedRef = useRef(false);
  // Soft one-time product tour after setup gate — never blocks setup wizard.
  useEffect(() => {
    if (appGate !== "ready") return;
    if (productTutorialAutoOfferedRef.current) return;
    if (!shouldAutoOfferProductTutorial(true, loadProductTutorialDone())) {
      return;
    }
    productTutorialAutoOfferedRef.current = true;
    const t = window.setTimeout(() => {
      setShowProductTutorial(true);
    }, 700);
    return () => window.clearTimeout(t);
  }, [appGate]);
  /** In-conversation find (Cmd/Ctrl+F) — not the palette/session search. */
  const [showChatFind, setShowChatFind] = useState(false);
  const [savedAccounts, setSavedAccounts] = useState<api.SavedAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [accountQuotas, setAccountQuotas] = useState<
    Record<string, SwitcherQuota>
  >({});
  const [perm, setPerm] = useState<PermissionPayload | null>(null);
  const permBarRef = useRef<HTMLDivElement | null>(null);
  const [askUser, setAskUser] = useState<AskUserPayload | null>(null);
  const askUserRef = useRef(askUser);
  askUserRef.current = askUser;
  /**
   * Unanswered gates per session (`sessionId` → payload).
   *
   * A background turn can ask for approval while the user reads another chat.
   * Without this the request was toast-only and lost forever: returning to that
   * chat showed no bar and the turn blocked until the agent timed out. Entries
   * are restored on `openSession` and dropped once answered / turn resolved.
   */
  const pendingPermBySessionRef = useRef<Map<string, PermissionPayload>>(
    new Map(),
  );
  /**
   * When each pending permission request first started its clock
   * (`sessionId:rpcId` → epoch ms).
   *
   * The auto-deny countdown belongs to the *request*, not to the bar being
   * mounted. Leaving the chat — "new chat" clears `perm`, so does switching —
   * unmounts the bar, and restarting from `Date.now()` on return handed the
   * request a fresh full timeout every time, so it could never expire.
   */
  const permRaisedAtRef = useRef<Map<string, number>>(new Map());
  const pendingAskUserBySessionRef = useRef<Map<string, AskUserPayload>>(
    new Map(),
  );
  /** Polite SR announce for stream start/stop (not every token). */
  const [streamA11yNote, setStreamA11yNote] = useState("");
  const wasStreamingRef = useRef(false);
  const [plan, setPlan] = useState<PlanState>(() => emptySessionPlan());
  /** Latest plan for the viewed session (mirrors `plan` for switch/cache). */
  const planRef = useRef(plan);
  planRef.current = plan;
  /**
   * Plan UI is session-scoped: switching chats restores that session's plan
   * (or hides the bar when the target has none / was hard-dismissed).
   * Live events for background sessions update this map without stealing the bar.
   * Hard-dismiss sets `userClosed` so reopen stays empty until a new plan cycle.
   */
  const planBySessionRef = useRef(new Map<string, PlanState>());
  /**
   * Drop a session's stored gates (answered, cancelled, turn ended, process dead).
   * Also clears plan review rpcId so Approve cannot target a dead reverse-RPC.
   */
  const clearPendingGates = useCallback((sessionId?: string | null) => {
    if (!sessionId) return;
    pendingPermBySessionRef.current.delete(sessionId);
    pendingAskUserBySessionRef.current.delete(sessionId);
    // The request is settled — its clock must not outlive it.
    dropGateClocks(permRaisedAtRef.current, sessionId);
    dropAskUserClocks(sessionId);
    const cached = planBySessionRef.current.get(sessionId);
    if (cached && cached.rpcId != null) {
      const next = invalidatePlanGate(cached);
      planBySessionRef.current.set(sessionId, next);
      markPlanPendingBadge(sessionId, next);
      if (sessionId === viewingSessionIdRef.current) {
        setPlan(next);
      }
    } else if (sessionId === viewingSessionIdRef.current) {
      setPlan((prev) => {
        if (prev.rpcId == null) return prev;
        const next = invalidatePlanGate(prev);
        markPlanPendingBadge(sessionId, next);
        return next;
      });
    }
  }, [markPlanPendingBadge]);
  /** Stable handle for the once-mounted event listeners. */
  const clearPendingGatesRef = useRef(clearPendingGates);
  clearPendingGatesRef.current = clearPendingGates;
  const [localePreference, setLocalePreference] =
    useState<LocalePreference>(DEFAULT_LOCALE_PREFERENCE);
  const [locale, setLocale] = useState<Locale>(() =>
    resolveLocalePreference(DEFAULT_LOCALE_PREFERENCE),
  );
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const [localeCatalogRev, setLocaleCatalogRev] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void loadLocaleCatalog(locale).then(() => {
      if (!cancelled) setLocaleCatalogRev((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);
  const tr = useMemo(() => createT(locale), [locale, localeCatalogRev]);
  const trRef = useRef(tr);
  trRef.current = tr;
  const {
    settingsOpen,
    settingsSection,
    settingsTab,
    settingsFocusAnchor,
    setSettingsFocusAnchor,
    prHubHighlightPr,
    setPrHubHighlightPr,
    settingsLabels,
    navigateSettings,
    closeSettings,
    openWorkflowsSettings,
  } = useSettingsNavigation({
    tr,
    onWorkbenchPane: setMainPane,
    onMenuClose: () => setShowUserMenu(false),
  });
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [effort, setEffort] = useState(DEFAULT_EFFORT);
  const [mode, setMode] = useState("agent");
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [policy, setPolicy] = useState("ask");
  /** Live selectable models from Host (official CLI catalog only; not providers). */
  const [availableModels, setAvailableModels] =
    useState<ModelOption[]>(GROK_BUILD_MODELS);
  const sidebarRowMetrics = sidebarSessionRowMetrics(sidebarDensity);
  /** Chat file/url card → open in right resource pane / Side Workbench. */
  const [resourceOpenTarget, setResourceOpenTarget] =
    useState<ResourceOpenTarget | null>(null);
  /** Bump to force ResourceViewer into Plan review mode (详情 / auto-open). */
  const [planFocusKey, setPlanFocusKey] = useState(0);
  /**
   * True when we expanded the right resource pane for this plan cycle
   * (auto-open on review or 详情). Hard-dismiss collapses it so the next
   * open is a clean files pane, not a stuck Plan workbench.
   */
  const planOpenedAsideRef = useRef(false);
  asideCloseExtrasRef.current = () => {
    planOpenedAsideRef.current = false;
    setSideWorkbench((s) => (s.expanded ? { ...s, expanded: false } : s));
    setSideDockComposer(false);
  };
  /** Live drag-drop target for zone overlays (null = not dragging). */
  const [dragZone, setDragZone] = useState<"sidebar" | "main" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const dragPathsRef = useRef<string[]>([]);
  /** Tauri OS drop timestamp — HTML5 fallback must not double-attach. */
  const lastNativeDropAtRef = useRef(0);
  const html5DragDepthRef = useRef(0);
  const [, setSetup] = useState({ cli: false, auth: false, project: false });
  const [localError, setLocalError] = useState<string | null>(null);
  const ensureConnectedRef = useRef<() => Promise<string | null>>(
    async () => null,
  );
  const compact = useCompactDialog({
    tr,
    ensureConnectedRef,
    onFail: setLocalError,
  });
  /** Expand technical dump under the compact error banner. */
  const [errorDetailOpen, setErrorDetailOpen] = useState(false);
  const [cliInfo, setCliInfo] = useState(() =>
    mapProbeToCliInfo({ found: false }),
  );
  const [cliAgentSkewRepairing, setCliAgentSkewRepairing] = useState(false);
  const {
    sessionDataMode,
    setSessionDataMode,
    defaultOpenTarget,
    setDefaultOpenTarget,
    prefsScope,
    setPrefsScope,
    acpServerAddr,
    setAcpServerAddr,
    proxyMode,
    setProxyMode,
    proxyUrl,
    setProxyUrl,
    proxyNoProxy,
    setProxyNoProxy,
    maxConcurrentAgents,
    setMaxConcurrentAgents,
    agentIdleMinutes,
    setAgentIdleMinutes,
    streamStallSeconds,
    setStreamStallSeconds,
    auditLedgerRetentionDays,
    setAuditLedgerRetentionDays,
    includePartialMessages,
    setIncludePartialMessages,
    maxAgentTurns,
    setMaxAgentTurns,
    backgroundWaitPolicy,
    setBackgroundWaitPolicy,
    backgroundWaitTimeoutSec,
    setBackgroundWaitTimeoutSec,
    storeApiKeysInKeychain,
    setStoreApiKeysInKeychain,
    sandboxProfile,
    setSandboxProfile,
    preferredAgent,
    setPreferredAgent,
    agentProfilePath,
    setAgentProfilePath,
    agentsJson,
    setAgentsJson,
    agentCatalog,
    setAgentCatalog,
    experimentalMemory,
    setExperimentalMemory,
    twoPassCompactionEnabled,
    setTwoPassCompactionEnabled,
    voiceId,
    setVoiceId,
    voiceDictationAutoSend,
    setVoiceDictationAutoSend,
    voiceKeepAgentsOnEnd,
    setVoiceKeepAgentsOnEnd,
    sttEngine,
    setSttEngine,
    sttCustomBaseUrl,
    setSttCustomBaseUrl,
    sttCustomModel,
    setSttCustomModel,
    sttCustomLanguage,
    setSttCustomLanguage,
    sttZhScript,
    setSttZhScript,
    allowUnverifiedCliInstall,
    setAllowUnverifiedCliInstall,
    lastCliChecksumVerified,
    subagentsEnabled,
    setSubagentsEnabled,
    subagentWorktreeSnapshotEnabled,
    setSubagentWorktreeSnapshotEnabled,
    autoWakeEnabled,
    setAutoWakeEnabled,
    workflowsEnabled,
    setWorkflowsEnabled,
    planEnabled,
    setPlanEnabled,
    todoGateEnabled,
    setTodoGateEnabled,
    todoGateMaxFiresPerPrompt,
    setTodoGateMaxFiresPerPrompt,
    disableWebSearch,
    setDisableWebSearch,
    noAskUser,
    setNoAskUser,
    disallowedTools,
    setDisallowedTools,
    allowedTools,
    setAllowedTools,
    useLeader,
    setUseLeader,
    reopenLastSession,
    setReopenLastSession,
    closeToTray,
    setCloseToTray,
    keepTrayForSchedules,
    setKeepTrayForSchedules,
    launchAtLogin,
    setLaunchAtLogin,
    notifyOnTurnDone,
    setNotifyOnTurnDone,
    notifyOnPermission,
    setNotifyOnPermission,
    notifyPrefsRef,
    lastSessionId,
    setLastSessionId,
    manualCliPath,
    setManualCliPath,
    hydrateFromSettings,
  } = useAppSettingsPrefs();
  /** Last process_limit event for Settings / Reliability honesty (ids only). */
  const [lastProcessLimit, setLastProcessLimit] =
    useState<ProcessLimitEvent | null>(null);
  const {
    open: sandboxWizardOpen,
    mode: sandboxWizardMode,
    maybeOfferAfterTrust: maybeOfferSandboxWizardAfterTrust,
    openGuide: openSandboxWizardGuide,
    close: closeSandboxWizard,
    skip: skipSandboxWizard,
    finishApply: finishSandboxWizardApply,
  } = useSandboxWizard({ sandboxProfile });
  const voiceDictationAutoSendRef = useRef(false);
  const sendRef = useRef<(() => Promise<void>) | null>(null);
  const {
    voice,
    liveVoiceOpen,
    setLiveVoiceOpen,
    voiceGate,
    cancelVoice,
    toggleVoice,
    startLiveVoice,
    voiceStealsEscape: voiceStealsEscapeNow,
    refreshVoiceGate,
  } = useVoiceDictation({
    tr,
    localeRef,
    composerInputRef,
    sendRef,
    voiceDictationAutoSendRef,
    setDraft,
    sessionState: session.state,
    refreshSessions,
    sttEngine,
    sttCustomBaseUrl,
    signedInRef: voiceSignedInRef,
    notifyRef: voiceNotifyRef,
  });
  voiceStealsEscapeRef.current = voiceStealsEscapeNow;
    const didRestoreLastRef = useRef(false);
  const [tasksPanelOpen, setTasksPanelOpen] = useState(false);
  const [agentDashboardOpen, setAgentDashboardOpen] = useState(false);
  const [taskBoardOpen, setTaskBoardOpen] = useState(false);
  const [taskBoardIncludeArchived, setTaskBoardIncludeArchived] =
    useState(false);
  const [batchAgentsOpen, setBatchAgentsOpen] = useState(false);
  /** Ops hub (palette open-ops) — routes to tasks / dashboard / board / batch. */
  const [opsEntryOpen, setOpsEntryOpen] = useState(false);
  const [gitWorktrees, setGitWorktrees] = useState<api.GitWorktreeEntry[]>([]);
  /** null = unknown/loading; true = git work tree; false = not a git repo. */
  const [gitWorktreesAvailable, setGitWorktreesAvailable] = useState<
    boolean | null
  >(null);
  const [gitWorktreesLoading, setGitWorktreesLoading] = useState(false);
  const [gitWorktreesReason, setGitWorktreesReason] = useState<string | null>(
    null,
  );
  /** New worktree dialog (name + optional start-point + layout). */
  const [worktreeCreateOpen, setWorktreeCreateOpen] = useState(false);
  const [worktreeCreateName, setWorktreeCreateName] = useState("");
  const [worktreeCreateRef, setWorktreeCreateRef] = useState("");
  /** Default CLI-aligned (`~/.grok/worktrees`); optional sibling. */
  const [worktreeCreateLayout, setWorktreeCreateLayout] =
    useState<WorktreeLayout>("cli");
  const [worktreeCreateBusy, setWorktreeCreateBusy] = useState(false);
  const [worktreeCreateError, setWorktreeCreateError] = useState<string | null>(
    null,
  );
  /** When true, after create bind cwd and open a draft chat on that path. */
  const [worktreeCreateStartChat, setWorktreeCreateStartChat] = useState(false);
  /** Absolute `~/.grok` from host list (CLI path preview + badge detection). */
  const [cliGrokHome, setCliGrokHome] = useState<string | null>(null);
  /** CLI-tracked worktrees from `grok worktree list` (soft-fail). */
  const [cliWorktrees, setCliWorktrees] = useState<api.CliWorktreeEntry[]>([]);
  const [cliWorktreesAvailable, setCliWorktreesAvailable] = useState<
    boolean | null
  >(null);
  const [cliWorktreesLoading, setCliWorktreesLoading] = useState(false);
  const [cliWorktreesReason, setCliWorktreesReason] = useState<string | null>(
    null,
  );
  /** Clean stale worktrees (git worktree prune) dialog. */
  const [worktreeGcOpen, setWorktreeGcOpen] = useState(false);
  const [worktreeGcForce, setWorktreeGcForce] = useState(false);
  const [worktreeGcBusy, setWorktreeGcBusy] = useState(false);
  const [worktreeGcPreviewBusy, setWorktreeGcPreviewBusy] = useState(false);
  const [worktreeGcError, setWorktreeGcError] = useState<string | null>(null);
  const [worktreeGcPreview, setWorktreeGcPreview] =
    useState<api.GitWorktreeGcResult | null>(null);
  /** Worktree ship flow (push + Open PR) dialog. */
  const [shipOpen, setShipOpen] = useState(false);
  const [shipTitle, setShipTitle] = useState("");
  const [shipBody, setShipBody] = useState("");
  const [shipDraft, setShipDraft] = useState(false);
  const [shipCreatePr, setShipCreatePr] = useState(true);
  const [shipBusy, setShipBusy] = useState(false);
  const [shipError, setShipError] = useState<string | null>(null);
  const [shipBranch, setShipBranch] = useState<string | null>(null);
  const [shipStatus, setShipStatus] = useState<string | null>(null);
  /** After successful `gh pr create` — success panel with URL + Open in PR hub. */
  const [shipSuccess, setShipSuccess] = useState<{
    prUrl: string;
    prNumber: number | null;
  } | null>(null);
  /** Host stream-stall prompt (I06); null when dismissed or not stalled. */
  const [streamStall, setStreamStall] = useState<{
    sessionId?: string;
    stallSeconds: number;
    tier?: string;
    sawModelOutput?: boolean;
    sawToolActivity?: boolean;
  } | null>(null);

  const {
    connecting,
    connectingBySessionRef,
    ensureConnectCountRef,
    liveMap,
    claimSessionConnection,
    releaseSessionConnection,
    syncEnsureConnectingUi,
    ensureConnected,
    retryAgentConnect,
  } = useSessionConnect({
    hostRef: sessionConnectHostRef,
    liveMapEnabled:
      showReliability ||
      agentDashboardOpen ||
      taskBoardOpen ||
      opsEntryOpen ||
      streamStall != null ||
      liveVoiceOpen ||
      mainPane === "kanban",
    viewedSessionId: session.sessionId,
  });
  /** Queue item currently being steered into the live turn. */
  const [guidingQueueItemId, setGuidingQueueItemId] = useState<string | null>(null);
  /** Queue item open in the edit dialog (`null` when closed). */
  /** Effort changes respawn the CLI; sends must wait for that write to settle. */
  const effortApplyRef = useRef<Promise<void>>(Promise.resolve());
  /** Live provider retry progress (session://retry); cleared on success/stop/error. */
  // Value intentionally unbound (retry chip hidden): only the setter is kept
  // for cleanup calls. See the hidden-retry comment at the status-pill site.
  const [, setRetryStatus] = useState<{
    attempt: number;
    maxRetries: number;
    reason: string;
  } | null>(null);
  /** Epoch ms when the current agent turn became busy (for elapsed UI). */
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  /**
   * Turn clock per chat (`sessionId` → epoch ms the running turn started).
   *
   * A single global value could not survive multi-session use: a *background*
   * chat going idle cleared it, and returning to a chat that was still
   * streaming had nothing left to restore from — so "thinking for N" restarted
   * from zero on every chat switch. The map is the truth; `turnStartedAt`
   * mirrors whichever chat is on screen.
   */
  const turnStartedAtBySessionRef = useRef<Map<string, number>>(new Map());
  /** Mirror a chat's clock into the visible timer when it is the viewed one. */
  const syncViewedTurnClock = useCallback((sessionId: string) => {
    if (
      !shouldSyncViewedTurnClock({
        clockSessionId: sessionId,
        viewingSessionId: viewingSessionIdRef.current,
      })
    ) {
      return;
    }
    setTurnStartedAt(turnStartedAtBySessionRef.current.get(sessionId) ?? null);
  }, [viewingSessionIdRef]);
  /** Begin a chat's turn clock, keeping the start of a turn already running. */
  const startTurnClock = useCallback(
    (sessionId?: string | null, at: number = Date.now()) => {
      if (!sessionId) return;
      if (!turnStartedAtBySessionRef.current.has(sessionId)) {
        turnStartedAtBySessionRef.current.set(sessionId, at);
      }
      syncViewedTurnClock(sessionId);
    },
    [syncViewedTurnClock],
  );
  /** Restart a chat's turn clock (new send / steer starts a fresh episode). */
  const restartTurnClock = useCallback(
    (sessionId?: string | null, at: number = Date.now()) => {
      if (!sessionId) return;
      turnStartedAtBySessionRef.current.set(sessionId, at);
      syncViewedTurnClock(sessionId);
    },
    [syncViewedTurnClock],
  );
  /** Clear a chat's turn clock (turn ended, stopped, or healed). */
  const clearTurnClock = useCallback(
    (sessionId?: string | null) => {
      if (!sessionId) {
        // Viewed timer only. An in-flight new-chat send still owns `__draft__`
        // in the map until migrateDraftTurnClock; deleting it here would leave
        // that background session with no grace clock if the user hits New chat.
        setTurnStartedAt(null);
        return;
      }
      turnStartedAtBySessionRef.current.delete(sessionId);
      syncViewedTurnClock(sessionId);
    },
    [syncViewedTurnClock],
  );
  const hideChatForSideExpand = shouldHideChatForSideExpand({
    expanded: sideWorkbench.expanded,
    phoneLayout,
  });
  const asideOverlay =
    !phoneLayout &&
    !shouldHideChatForSideExpand({
      expanded: sideWorkbench.expanded,
      phoneLayout,
    }) &&
    resolveWorkbenchPaneOverlay({
      viewportWidth,
      sidebarOpen: !layout.sidebarCollapsed,
      sidebarWidth: sidebarOpenW,
      asideOpen: true,
      asideWidth: asideOpenW,
    }).asideOverlay;
  const sidePaneCoversMain =
    hideChatForSideExpand || (asideOverlay && !layout.asideCollapsed);
  const { paneMotionClass } = usePaneSplitMotion({
    sidebarCollapsed: layout.sidebarCollapsed,
    asideCollapsed: layout.asideCollapsed,
    phoneLayout,
    sidebarOverlay,
    asideOverlay,
    asideInFlow: !phoneLayout && !hideChatForSideExpand && !asideOverlay,
    sideExpanded: hideChatForSideExpand,
  });
  const [account, setAccount] = useState<api.AccountStatus | null>(null);
  voiceSignedInRef.current = !!account?.profile?.signedIn;
  useEffect(() => {
    void refreshVoiceGate();
  }, [account?.profile?.signedIn, refreshVoiceGate]);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  /** Soft-fail heatmap / account_status error (never invents activity or quota). */
  const [accountHeatmapError, setAccountHeatmapError] = useState<unknown>(null);
  /** Soft-fail last account_status / billing probe error (never invents quota %). */
  const [accountProbeError, setAccountProbeError] = useState<unknown>(null);
  const [loginHint, setLoginHint] = useState<string | null>(null);
  const platform = useMemo(() => detectAppPlatform(), []);
  const settingsShortcutHint = useMemo(
    () =>
      formatShortcutHint(
        "settings",
        shortcutRemaps,
        platform === "mac" ? "mac" : "win",
      ),
    [shortcutRemaps, platform],
  );
  /** Self-drawn chrome when OS title bar is disabled (Win / Linux frameless). */
  const useCustomWindowChrome = usesCustomWindowChrome(platform);
  /** Titlebar / chrome-strip double-click → maximize on mac + win. */
  const titlebarMax = titlebarMaximizeHandlers({
    enabled: !phoneLayout && !isMirrorClient(),
  });
  const dragRegion = tauriDragRegion(platform);
  const [windowMaximized, setWindowMaximized] = useState(false);

  /** Route chat context opens into Side Workbench tabs.
   * When the aside is mounted, SideWorkbench `openRequest` is the only consumer. */
  useEffect(() => {
    if (!resourceOpenTarget) return;
    if (!layout.asideCollapsed) return;
    const result = applySideContextOpen(sideWorkbench, resourceOpenTarget, {
      isGitProject: sideIsGitProject,
    });
    if (result.noticeKey) {
      showToast(tr(result.noticeKey), 2400);
    }
    if (result.needAsideOpen) {
      setSideWorkbench(result.state);
      openAsidePane();
    }
    setResourceOpenTarget(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- consume once per target
  }, [resourceOpenTarget, layout.asideCollapsed]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = htmlLangForLocale(locale);
  }, [locale]);

  // Follow OS / browser UI language when preference is "system".
  useEffect(() => {
    if (localePreference !== "system") return;
    const applySystem = (tag: string | null) => {
      setLocale(resolveLocaleFromSystem(tag));
    };
    // `navigator.language` is the WebView's language, not the OS's: on a
    // Windows box whose UI is Japanese it still reports `en-US`, so reading it
    // meant "follow system" quietly settled on English. `readSystemLangTag`
    // prefers the OS tag the Host injects and only then falls back to the
    // navigator.
    applySystem(readSystemLangTag());
    if (typeof window === "undefined" || !("addEventListener" in window)) {
      return;
    }
    // A `languagechange` means the WebView's own list moved, which the tag
    // captured at window build time cannot know about — trust it here.
    const onLanguageChange = () =>
      applySystem(
        (typeof navigator !== "undefined" ? navigator.language : "") ||
          readSystemLangTag(),
      );
    window.addEventListener("languagechange", onLanguageChange);
    return () => window.removeEventListener("languagechange", onLanguageChange);
  }, [localePreference]);

  useEffect(() => {
    document.documentElement.classList.remove(
      "platform-mac",
      "platform-win",
      "platform-linux",
      "platform-other",
    );
    if (platform === "mac") document.documentElement.classList.add("platform-mac");
    if (platform === "win") document.documentElement.classList.add("platform-win");
    if (platform === "linux") document.documentElement.classList.add("platform-linux");
    if (platform === "other") document.documentElement.classList.add("platform-other");
  }, [platform]);

  // Track maximized on every desktop host (mac Overlay + Win frameless) so
  // .is-maximized chrome + layout reclamp stay honest after titlebar dblclick.
  useEffect(() => {
    if (!api.isDesktopHost() || !api.isTauri()) return;
    let unlistenResize: (() => void) | undefined;
    let unlistenMoved: (() => void) | undefined;
    let unlistenScale: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const w = getCurrentWindow();
        const sync = async () => {
          try {
            setWindowMaximized(
              (await w.isMaximized()) || isFakeMaximized(),
            );
          } catch {
            /* ignore */
          }
        };
        await sync();
        unlistenResize = await w.onResized(() => {
          void sync();
        });
        try {
          unlistenMoved = await w.onMoved(() => {
            void sync();
          });
        } catch {
          /* older API */
        }
        try {
          unlistenScale = await w.onScaleChanged(() => {
            void sync();
          });
        } catch {
          /* older API */
        }
        if (cancelled) {
          unlistenResize?.();
          unlistenMoved?.();
          unlistenScale?.();
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
      unlistenResize?.();
      unlistenMoved?.();
      unlistenScale?.();
    };
  }, []);

  // Chat transcript reading width (Appearance) — html[data-chat-width].
  useEffect(() => {
    applyChatWidth(loadChatWidth());
  }, []);

  /**
   * Detect secondary session window early (label + deep-link hash).
   * Sets role before warm-connect / last-session restore can run.
   */
  useEffect(() => {
    if (!api.isDesktopHost()) {
      // Browser / mirror: still honor `#/session/<id>` for manual testing.
      const fromHash = parseSessionDeepLinkHash(
        typeof window !== "undefined" ? window.location.hash : "",
      );
      if (fromHash) {
        setSecondaryFocusSessionId(fromHash);
        setIsSecondaryWindow(true);
        isSecondaryWindowRef.current = true;
      }
      setWindowRoleReady(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        if (cancelled) return;
        const label = getCurrentWindow().label;
        const secondary = isSessionWindowLabel(label);
        const focusId = resolveSecondarySessionId({
          hash: window.location.hash,
          windowLabel: label,
        });
        // Label wins for secondary role: only real session-* windows skip
        // passive warm-connect and collapse chrome. Hash alone on main must
        // not change layout (e.g. manual hash edit).
        setIsSecondaryWindow(secondary);
        isSecondaryWindowRef.current = secondary;
        if (focusId) {
          setSecondaryFocusSessionId(focusId);
          secondaryFocusSessionIdRef.current = focusId;
        }
        // Collapse chrome in secondary so the chat is front-and-center.
        if (secondary) {
          collapseChromeEphemeral();
          closeSettings();
          setMainPane("chat");
        }
      } catch (e) {
        console.warn("multi-window role detect failed", e);
      } finally {
        if (!cancelled) setWindowRoleReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Dock / tray badge: unread sessions that finished a turn in the background.
  // Only updates after turn end (markUnread), never on send / while streaming.
  // Secondary windows must not overwrite the dock badge (main owns chrome).
  // Count is clamped for display (TRAY-NOTIFY-PRO); pref off clears to 0.
  useEffect(() => {
    const resolved = resolveTrayBusyBadgeCount({
      enabled: trayBusyBadge,
      busyCount: unreadSessionIds.size,
      isSecondaryWindow,
    });
    if (!resolved.apply) return;
    void api.traySetBusyCount(resolved.count);
  }, [unreadSessionIds.size, trayBusyBadge, isSecondaryWindow]);

  // Windows taskbar *button* overlay: independent of trayBusyBadge (default off).
  // Secondary windows must not apply. Pref off sends 0 (clear).
  useEffect(() => {
    const resolved = resolveTrayBusyBadgeCount({
      enabled: winTaskbarOverlay,
      busyCount: unreadSessionIds.size,
      isSecondaryWindow,
    });
    if (!resolved.apply) return;
    void api.traySetWindowsOverlay(resolved.count);
  }, [unreadSessionIds.size, winTaskbarOverlay, isSecondaryWindow]);

  const applyComposerPrefs = useCallback(
    (prefs: api.ComposerPrefs, catalog: ModelOption[]) => {
      const models = catalog.length > 0 ? catalog : GROK_BUILD_MODELS;
      let nextModelId: string;
      if (prefs.modelId && isValidModelId(prefs.modelId, models)) {
        nextModelId = prefs.modelId;
      } else {
        nextModelId = pickDefaultModelId(models);
      }
      setModelId(nextModelId);
      const model = findModel(nextModelId, models);
      setEffort(
        isValidEffort(prefs.effort, model)
          ? prefs.effort
          : pickDefaultEffort(model),
      );
      setMode(prefs.mode || "agent");
      setPolicy(
        isValidPolicy(prefs.permissionPolicy) ? prefs.permissionPolicy : "ask",
      );
      if (isValidPrefsScope(prefs.scope)) {
        setPrefsScope(prefs.scope);
      }
    },
    [],
  );

  const refreshLists = useCallback(async () => {
    // Mirror phone client: never SetupWizard / Doctor hard-block (DESIGN §10.3).
    if (isMirrorClient()) {
      setAppGate("ready");
      setSetupCliSeed({
        found: true,
        path: null,
        version: "mirror",
        source: "mirror",
        cliAuthPresent: false,
      });
      try {
        await mirrorEnsureTransport();
        const [p, s, settings, modelsRes] = await Promise.all([
          api.projectsList().catch(() => []),
          api.sessionsList().catch(() => []),
          api.settingsGet().catch(() => null),
          api.modelsListAvailable().catch(() => null),
        ]);
        setProjects(mapProjectsList(p as Project[]));
        setSessions(
          (s as Array<Parameters<typeof mapSessionListRow>[0]>).map(
            mapSessionListRow,
          ),
        );
        void api
          .generalWorkspacePath()
          .then((path) => setGeneralWorkspacePath(path || null))
          .catch(() => {});
        if (settings) {
          const pref = parseLocalePreference(settings.locale);
          setLocalePreference(pref);
          setLocale(resolveLocalePreference(pref));
          hydrateFromSettings(settings);
        }
        const catalog: ModelOption[] =
          modelsRes?.models?.length
            ? modelsRes.models.map((m) => ({
                id: m.id,
                label: m.label || m.id,
                source: m.source,
                isDefault: m.isDefault,
                contextWindow: m.contextWindow ?? null,
              }))
            : GROK_BUILD_MODELS;
        setAvailableModels(catalog);
        const prefs = await api
          .composerPrefsResolve({ projectId: null, sessionId: null })
          .catch(() => null);
        if (prefs) {
          applyComposerPrefs(prefs, catalog);
        }
        // Light account chip (display only; never login on phone).
        const st = await api
          .accountStatus({ refreshBilling: false })
          .catch(() => null);
        if (st) setAccount(st);
      } catch {
        /* never reset gate — soft-fail optional RPCs */
      }
      return;
    }
    if (!api.isTauri()) {
      // Browser/Vite-only preview: skip Host gate.
      setAppGate("ready");
      setSetupCliSeed({
        found: true,
        path: null,
        version: "browser",
        source: "browser",
        cliAuthPresent: false,
      });
      return;
    }
    try {
      // Boot is two-phase so the full-screen "detecting" gate is not blocked by
      // lists / models / keychain / catalog — only settings + CLI probe decide
      // loading → setup | ready. Everything else hydrates after the shell paints.
      setBootDetectTimedOut(false);
      setBootDetectSlow(false);
      const BOOT_SLOW_MS = 4_000;
      const BOOT_TIMEOUT_MS = 12_000;
      const slowTimer = window.setTimeout(
        () => setBootDetectSlow(true),
        BOOT_SLOW_MS,
      );
      const settingsP = api.settingsGet();
      const cliP = api.probeCli();
      const projectsP = api.projectsList();
      const sessionsP = api.sessionsList();
      const modelsP = api.modelsListAvailable().catch(() => null);

      // Never hang forever on a stuck Host probe / IPC (was: infinite "Checking…").
      // Settings first: if this install already finished the wizard, paint the
      // workbench even while `probeCli` is slow (dev CLI spawn / hung grok).
      type BootSettings = Awaited<ReturnType<typeof api.settingsGet>>;
      type BootCli = Awaited<ReturnType<typeof api.probeCli>>;
      let timeoutId: number | undefined;
      const timed = <T,>(ms: number) =>
        new Promise<T>((_resolve, reject) => {
          timeoutId = window.setTimeout(() => {
            reject(new Error("BOOT_DETECT_TIMEOUT"));
          }, ms);
        });
      let settings: BootSettings;
      try {
        settings = await Promise.race([settingsP, timed<BootSettings>(BOOT_TIMEOUT_MS)]);
      } finally {
        if (timeoutId != null) window.clearTimeout(timeoutId);
      }
      const wizardCompleted = !!settings.setupWizardCompleted;
      const legacyDone =
        !!settings.onboardingDone || !!settings.setupSkipped;
      if (wizardCompleted || legacyDone) {
        window.clearTimeout(slowTimer);
        setBootDetectTimedOut(false);
        setBootDetectSlow(false);
        setAppGate("ready");
      }
      let cli: BootCli;
      try {
        cli = await Promise.race([cliP, timed<BootCli>(BOOT_TIMEOUT_MS)]);
      } catch (e) {
        if (!(wizardCompleted || legacyDone)) throw e;
        cli = {
          found: false,
          path: null,
          version: null,
          source: "timeout",
          cliAuthPresent: false,
        } as BootCli;
      } finally {
        window.clearTimeout(slowTimer);
        if (timeoutId != null) window.clearTimeout(timeoutId);
      }

      {
        const pref = parseLocalePreference(settings.locale);
        setLocalePreference(pref);
        setLocale(resolveLocalePreference(pref));
      }
      setCliInfo(mapProbeToCliInfo(cli));
      const cliSeed: SetupCliInfo = {
        found: cli.found,
        path: cli.path,
        version: cli.version,
        source: cli.source || "",
        cliAuthPresent: !!cli.cliAuthPresent,
      };
      setSetupCliSeed(cliSeed);
      if (isCliVersionUnsupported(cli.versionSupported)) {
        setLocalError(
          formatCliTooOldDetail({
            version: cli.version,
            minVersion: cli.minVersion,
          }),
        );
      }

      // SETUP-GATE-PRO: leave loading as soon as CLI + wizard flags are known.
      // Wizard already done: workbench is up; do not bounce back to Setup if
      // this boot's CLI probe is late or empty.
      const gate = resolveSetupGateBoot({
        cliFound: !!cli.found,
        wizardCompleted,
        legacyDone,
        isMirror: isMirrorClient(),
      });
      if (!(wizardCompleted || legacyDone)) {
        setBootDetectTimedOut(false);
        setBootDetectSlow(false);
        setAppGate(gate.phase);
      }

      // Phase 2 — workbench data (does not block gate chrome).
      const [p, s, modelsRes] = await Promise.all([
        projectsP,
        sessionsP,
        modelsP,
      ]);
      setProjects(mapProjectsList(p as Project[]));
      setSessions(
        (s as Array<Parameters<typeof mapSessionListRow>[0]>).map(
          mapSessionListRow,
        ),
      );
      void api
        .generalWorkspacePath()
        .then((path) => setGeneralWorkspacePath(path || null))
        .catch(() => {});
      void api.trayRefresh();
      const catalog: ModelOption[] =
        modelsRes?.models?.length
          ? modelsRes.models.map((m) => {
              const efforts: EffortOption[] | undefined =
                m.reasoningEfforts?.length
                  ? m.reasoningEfforts.map((e) => ({
                      id: e.id,
                      value: e.value,
                      label: e.label,
                      description: e.description,
                      isDefault: e.isDefault,
                    }))
                  : undefined;
              return {
                id: m.id,
                label: m.label || m.id,
                source: m.source,
                isDefault: m.isDefault,
                reasoningEfforts: efforts,
                contextWindow: m.contextWindow ?? null,
              };
            })
          : GROK_BUILD_MODELS;
      setAvailableModels(catalog);
      // Bootstrap: global-effective prefs (context re-resolved when project/session changes).
      const prefs = await api
        .composerPrefsResolve({ projectId: null, sessionId: null })
        .catch(() => null);
      if (prefs) {
        applyComposerPrefs(prefs, catalog);
      } else {
        setPolicy(
          isValidPolicy(settings.permissionPolicy || "")
            ? settings.permissionPolicy
            : "ask",
        );
        {
          const mid =
            settings.modelId && isValidModelId(settings.modelId, catalog)
              ? settings.modelId
              : pickDefaultModelId(catalog);
          const model = findModel(mid, catalog);
          setEffort(
            isValidEffort(settings.effort || "", model)
              ? settings.effort!
              : pickDefaultEffort(model),
          );
        }
        setMode(settings.mode || "agent");
        if (settings.modelId && isValidModelId(settings.modelId, catalog)) {
          setModelId(settings.modelId);
        } else {
          setModelId(
            modelsRes?.defaultModelId &&
              isValidModelId(modelsRes.defaultModelId, catalog)
              ? modelsRes.defaultModelId
              : pickDefaultModelId(catalog),
          );
        }
      }
      hydrateFromSettings(settings, { fallbackCliPath: cli.path });
      compact.applyFromSettings(settings);
      void api
        .agentsCatalog(null)
        .then((cat) => {
          setAgentCatalog(
            (cat.agents ?? []).map((a) => ({
              name: a.name,
              source: a.source,
            })),
          );
        })
        .catch(() => {
          setAgentCatalog(
            ["explore", "general-purpose", "plan"].map((name) => ({
              name,
              source: "builtin",
            })),
          );
        });

      // Keychain can be slow on first access — never block the gate on it.
      const masked = await api.secretsGetMasked().catch(() => null);
      const authOk =
        !!cli.cliAuthPresent ||
        !!masked?.hasOfficialKey ||
        !!masked?.hasRelayKey;
      setSetup({
        cli: cli.found,
        auth: authOk,
        project: p.some((x) => (x as Project).trusted) || p.length > 0,
      });

      if (gate.shouldMigrateLegacy) {
        // Older installs that finished the account modal before setupWizardCompleted.
        const flags = buildAuthDeferredFlags({
          authDeferred: !!settings.setupSkipped,
          authOk,
        });
        void api
          .settingsSet({
            ...settings,
            setupWizardCompleted: true,
            authSetupDeferred: flags.authSetupDeferred,
          })
          .catch(() => {});
      }

      // One-shot: corrupt store JSON was renamed aside on load (shared-mode safety).
      void api
        .storeTakeQuarantine()
        .then((path) => {
          if (!path) return;
          const msg = createT(resolveLocale(settings.locale))(
            "store.quarantineNotice",
            { path },
          );
          setToast(msg);
          window.setTimeout(() => setToast(null), 9000);
        })
        .catch(() => {});

      // Draft new-chat launch: no project selected. Only keep a mid-session
      // selection when re-bootstrapping (e.g. refreshLists) if it still exists.
      setActiveProject((prev) => {
        if (prev && (p as Project[]).some((x) => x.id === prev.id)) {
          return (p as Project[]).find((x) => x.id === prev.id) || prev;
        }
        return null;
      });
      // Restore sidebar project collapse (missing id ⇒ expanded).
      setExpandedProjects(
        expandMapFromCollapsedIds(
          (p as Project[]).map((proj) => proj.id),
          settings.sidebarCollapsedProjectIds,
        ),
      );
      expandedProjectsHydratedRef.current = true;
      // Restore “Other sessions” section (missing / undefined ⇒ open).
      // Only hydrate once so later refreshLists does not clobber in-session toggles.
      if (!historyOpenHydratedRef.current) {
        setHistoryOpen(settings.sidebarOtherSessionsOpen !== false);
        historyOpenHydratedRef.current = true;
      }
    } catch (e) {
      const msg = String(e || "");
      const isTimeout =
        msg.includes("BOOT_DETECT_TIMEOUT") || /timed?\s*out/i.test(msg);
      if (isTimeout) {
        setBootDetectTimedOut(true);
        setLocalError(trRef.current("setup.detectTimeoutHint"));
        // Stay on loading chrome with Retry — do not pretend Setup finished.
        setSetupCliSeed((prev) =>
          prev ?? {
            found: false,
            path: null,
            version: null,
            source: "timeout",
            cliAuthPresent: false,
          },
        );
        return;
      }
      setLocalError(msg);
      // Still surface setup if Tauri partially works
      setSetupCliSeed((prev) =>
        prev ?? {
          found: false,
          path: null,
          version: null,
          source: "error",
          cliAuthPresent: false,
        },
      );
      setAppGate((g) => (g === "loading" ? "setup" : g));
    }
  }, []);

  // Bootstrap lists once (+ manual retry after boot timeout).
  useEffect(() => {
    void refreshLists();
  }, [refreshLists, bootRetryNonce]);

  // Re-resolve model/permission when project or chat changes.
  // Permission always cascades project/session tiers (L10), even when model
  // memory scope is global — so project-level tiers apply after a switch.
  useEffect(() => {
    if (!api.isTauri()) return;
    let cancelled = false;
    void api
      .composerPrefsResolve({
        projectId: activeProject?.id ?? null,
        sessionId: session.sessionId ?? null,
      })
      .then((prefs) => {
        if (!cancelled) applyComposerPrefs(prefs, availableModels);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    activeProject?.id,
    session.sessionId,
    prefsScope,
    applyComposerPrefs,
    availableModels,
  ]);

  // Prompt history browse is per viewed session — leave browse mode on switch / new chat.
  // Cross-session recent ring is not cleared (lives in localStorage).
  useEffect(() => {
    promptHistoryIndexRef.current = null;
    setPromptHistoryIndex(null);
    setPromptHistoryOpen(false);
    setPromptHistoryFilter("");
    setPromptHistoryActive(0);
    setPromptHistoryFocusFilter(false);
    setPromptHistoryScope("session");
  }, [session.sessionId]);

  // Keep recent-prompt ring in sync (this window + storage events / own writes).
  useEffect(() => {
    const reload = () => {
      setRecentPromptHistory(loadRecentPromptHistory());
    };
    const onCustom = () => reload();
    const onStorage = (e: StorageEvent) => {
      if (e.key === RECENT_PROMPT_HISTORY_STORAGE_KEY || e.key === null) {
        reload();
      }
    };
    window.addEventListener(RECENT_PROMPT_HISTORY_CHANGE_EVENT, onCustom);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(RECENT_PROMPT_HISTORY_CHANGE_EVENT, onCustom);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  /**
   * After any turn, if the last assistant message contains a grok-automation
   * fence, strip it from the bubble and maybe call automation_create.
   *
   * Auto-create when:
   * - session is in explicit AI-create setup, or
   * - recent user text looks like a real schedule (time / recurrence).
   * Otherwise confirm (reduces role-card / /goal mis-schedules) without
   * removing intentional chat-driven scheduling.
   * Deduped per assistant message id.
   */
  const tryApplyAutomationFromSession = useCallback(
    async (sessionId: string) => {
      if (!sessionId) return;

      const msgs = messagesBySessionRef.current.get(sessionId) ?? [];
      let lastAssistantIdx = -1;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i]?.role === "assistant" && !msgs[i]?.isError) {
          lastAssistantIdx = i;
          break;
        }
      }
      if (lastAssistantIdx < 0) return;
      const assistant = msgs[lastAssistantIdx]!;
      if (assistant.streaming) return;

      const applyKey = assistant.id || `${sessionId}:last`;
      if (automationAppliedRef.current.has(applyKey)) return;

      const { cleanText, input, rawJson, existingId, action } =
        extractAutomationPayload(assistant.content || "");
      // Always strip fence from UI when present (even if JSON incomplete).
      if (cleanText !== (assistant.content || "")) {
        const aid = assistant.id;
        patchSessionMessages(sessionId, (prev) =>
          prev.map((m) => (m.id === aid ? { ...m, content: cleanText } : m)),
        );
      }
      if (!input) return;

      // Also dedupe identical payloads in this session.
      const payloadKey = `${sessionId}:${rawJson ?? input.title}`;
      if (automationAppliedRef.current.has(payloadKey)) return;

      const recentUserText = recentUserPlainText(msgs, 4);
      const auto = shouldAutoApplyAutomationFence({
        inExplicitAutomationSetup:
          automationSetupSessionsRef.current.has(sessionId),
        recentUserText,
      });

      const doApply = async () => {
        automationAppliedRef.current.add(applyKey);
        automationAppliedRef.current.add(payloadKey);
        try {
          const list = await api.automationsList();
          const target = resolveAutomationUpsertTarget(list, {
            title: input.title,
            existingId,
            action,
          });
          if (target.kind === "update") {
            const prev = list.find((a) => a.id === target.id);
            await api.automationUpdate(target.id, {
              ...input,
              projectId:
                input.projectId !== undefined && input.projectId !== null
                  ? input.projectId
                  : (prev?.projectId ?? null),
              modelId:
                input.modelId !== undefined && input.modelId !== null
                  ? input.modelId
                  : (prev?.modelId ?? null),
              effort:
                input.effort !== undefined && input.effort !== null
                  ? input.effort
                  : (prev?.effort ?? null),
            });
            automationSetupSessionsRef.current.delete(sessionId);
            setToast(
              tr("automations.updatedToast", { title: input.title }),
            );
          } else {
            await api.automationCreate(input);
            automationSetupSessionsRef.current.delete(sessionId);
            setToast(
              tr("automations.createdToast", { title: input.title }),
            );
          }
          window.setTimeout(() => setToast(null), 4200);
        } catch {
          automationAppliedRef.current.delete(applyKey);
          automationAppliedRef.current.delete(payloadKey);
          setToast(tr("automations.createFailed"));
          window.setTimeout(() => setToast(null), 4200);
        }
      };

      if (auto) {
        await doApply();
        return;
      }

      // Unexpected fence (e.g. role card / goal mis-route): ask once, never
      // window.confirm. Mark applyKey so we do not re-open on every tick.
      automationAppliedRef.current.add(applyKey);
      setAppDialog({
        kind: "confirm",
        title: tr("automations.confirmUnexpected.title"),
        message: tr("automations.confirmUnexpected.message", {
          title: input.title,
          frequency: input.frequency || "—",
          time: input.time || "—",
        }),
        confirmLabel: tr("automations.confirmUnexpected.confirm"),
        onConfirm: () => {
          void doApply();
        },
        onDismiss: () => {
          automationAppliedRef.current.add(payloadKey);
          setToast(tr("automations.confirmUnexpected.dismissed"));
          window.setTimeout(() => setToast(null), 3600);
        },
      });
    },
    [patchSessionMessages, setAppDialog, tr],
  );

  // Phone mirror chrome: track WS + host account from hello (DESIGN §4.3).
  useEffect(() => {
    if (!isMirrorClient()) return;
    let cancelled = false;
    const cleanups: Array<() => void> = [];
    const applyHello = () => {
      const h = mirrorHello() as {
        account?: {
          signedIn?: boolean;
          displayName?: string | null;
          email?: string | null;
        };
      } | null;
      if (!h) return;
      const acc = h.account;
      if (acc?.signedIn) {
        setMirrorHostLabel(
          (acc.displayName || acc.email || "").trim() ||
            tr("mirror.chrome.accountHost"),
        );
      } else if (acc) {
        setMirrorHostLabel(tr("mirror.chrome.signedOut"));
      }
    };
    const tick = () => {
      if (cancelled) return;
      setMirrorLinkOk(mirrorWsConnected());
      applyHello();
    };
    tick();
    const id = window.setInterval(tick, 1500);
    void api
      .listen<unknown>("mirror://hello", () => {
        if (!cancelled) {
          setMirrorLinkOk(true);
          applyHello();
        }
      })
      .then((un) => {
        if (cancelled) un();
        else cleanups.push(un);
      });
    return () => {
      cancelled = true;
      window.clearInterval(id);
      for (const u of cleanups) u();
    };
  }, [tr]);

  // Keep composer above the soft keyboard via visualViewport inset.
  useEffect(() => {
    if (!phoneLayout) {
      document.documentElement.style.removeProperty(PHONE_KEYBOARD_INSET_VAR);
      return;
    }
    const vv = window.visualViewport;
    const apply = () => {
      const inset = keyboardInsetBottom(
        vv
          ? { height: vv.height, offsetTop: vv.offsetTop }
          : null,
        window.innerHeight,
      );
      document.documentElement.style.setProperty(
        PHONE_KEYBOARD_INSET_VAR,
        `${inset}px`,
      );
    };
    apply();
    if (!vv) return;
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      document.documentElement.style.removeProperty(PHONE_KEYBOARD_INSET_VAR);
    };
  }, [phoneLayout]);

  /**
   * Debounced skills_list reload after conversation skill installs.
   * Bump target is wired below (skillsReloadToken lives later in this component).
   * See skillCatalogRefresh.ts.
   */
  const skillsReloadBumpRef = useRef<() => void>(() => {});
  const skillsCatalogReloadRef = useRef(
    createDebouncedSkillsReload(() => {
      skillsReloadBumpRef.current();
    }, 900),
  );
  useEffect(() => {
    return () => {
      skillsCatalogReloadRef.current.cancel();
    };
  }, []);

  useSessionHostEvents({
    patchSessionMessages,
    tryApplyAutomationFromSession,
    onSkillCatalogMaybeStale: () => {
      skillsCatalogReloadRef.current.schedule();
    },
    setLiveHost,
    liveHostRef,
    setLiveMap,
    liveMapRef,
    setSession,
    setMessages,
    messagesBySessionRef,
    viewingSessionIdRef,
    isSecondaryWindowRef,
    secondaryFocusSessionIdRef,
    openingSessionIdRef,
    setStopLatch,
    stopLatchRef,
    setLocalError,
    setToast,
    setSessions,
    sessionsRef,
    projectsRef,
    setSessionChangesById,
    setContextUsage,
    setRetryStatus,
    setStreamStall,
    setTurnStartedAt,
    startTurnClock,
    restartTurnClock,
    clearTurnClock,
    setRecentStallSignals,
    setGoalOrchEvents,
    setLastProcessLimit,
    setAskUser,
    setPerm,
    setPlan,
    setPlanFocusKey,
    planBySessionRef,
    markPlanPendingBadge,
    planOpenedAsideRef,
    planCompletedRecordedRef,
    openAsidePane,
    openAsidePaneRef,
    setResourceOpenTarget,
    navigateWorkbench: () => {
      closeSettings();
      setMainPane("chat");
    },
    pendingAskUserBySessionRef,
    pendingPermBySessionRef,
    pendingCompactBeforeRef: compact.pendingBeforeRef,
    clearPendingGatesRef,
    notifyPrefsRef,
    localeRef,
    trRef,
    tr,
    modeRef,
    maxConcurrentAgents,
    streamStallSeconds,
  });

  const navigateWorkbench = useCallback(() => {
    closeSettings();
    setMainPane("chat");
  }, [closeSettings]);

  const navigateAutomations = useCallback(() => {
    closeSettings();
    setMainPane("automations");
    setShowUserMenu(false);
    if (typeof window !== "undefined") {
      window.location.hash = "#/automations";
    }
  }, [closeSettings]);

  const navigateKanban = useCallback(() => {
    closeSettings();
    setMainPane("kanban");
    setShowUserMenu(false);
    if (typeof window !== "undefined") {
      window.location.hash = "#/kanban";
    }
  }, [closeSettings]);

  const persistOpenTarget = useCallback((target: string) => {
    setDefaultOpenTarget(target);
    writeOpenTargetStorage(target);
    void api.settingsGet().then((s) =>
      api.settingsSet({ ...s, defaultOpenTarget: target }),
    );
  }, []);

  /**
   * Composition root for session open: other domains' verbs, mutated in place
   * so `useSessionNavigation` never captures a stale host object.
   */
  {
    const connectHost = sessionConnectHostRef.current;
    connectHost.tr = tr;
    connectHost.session = session;
    connectHost.mode = mode;
    connectHost.connecting = connecting;
    connectHost.activeProject = activeProject;
    connectHost.generalWorkspacePath = generalWorkspacePath;
    connectHost.gitWorktrees = gitWorktrees;
    connectHost.isSecondaryWindowRef = isSecondaryWindowRef;
    connectHost.liveHostRef = liveHostRef;
    connectHost.viewingSessionIdRef = viewingSessionIdRef;
    connectHost.messagesBySessionRef = messagesBySessionRef;
    connectHost.turnStartedAtBySessionRef = turnStartedAtBySessionRef;
    connectHost.sendInFlightRef = sendInFlightRef;
    connectHost.sendInFlightBySessionRef = sendInFlightBySessionRef;
    connectHost.sendEpochBySessionRef = sendEpochBySessionRef;
    connectHost.sessionJsonSchemaRef = sessionJsonSchemaRef;
    connectHost.currentViewFocus = currentViewFocus;
    connectHost.syncViewedTurnClock = syncViewedTurnClock;
    connectHost.setLocalError = setLocalError;
    connectHost.setSession = setSession;
    connectHost.setLiveHost = setLiveHost;
    connectHost.setLiveMap = setLiveMap;
    connectHost.setSessionJsonSchema = setSessionJsonSchema;
    connectHost.setActiveProject = setActiveProject;
    connectHost.setExpandedProjects = setExpandedProjects;
    connectHost.refreshSessions = refreshSessions;
    const host = sessionNavHostRef.current;
    host.chrome.goToChat = () => {
      setMainPane("chat");
      closeSettings();
      if (typeof window !== "undefined" && window.location.hash) {
        window.history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search,
        );
      }
    };
    host.chrome.closePhoneDrawerIfNeeded = () => {
      if (phoneLayout) closePhoneDrawer();
    };
    host.catalog.resolveProject = (s, hint) =>
      hint || projects.find((p) => p.id === s.projectId) || null;
    host.catalog.setActiveProject = setActiveProject;
    host.catalog.markScheduled = (sessionId) => {
      setSessions((list) =>
        list.map((row) =>
          row.id === sessionId ? { ...row, scheduled: true } : row,
        ),
      );
      if (api.isTauri()) {
        void api.sessionSetScheduled(sessionId, true).catch(() => {});
      }
    };
    host.catalog.rememberLastSession = (sessionId, projectId) => {
      setLastSessionId(sessionId);
      void api.settingsRememberLastSession(sessionId, projectId).catch(() => {});
    };
    host.catalog.clearUnread = (sessionId) => {
      applyClearSessionUnread(sessionId);
    };
    host.catalog.getActiveProject = () => activeProject;
    host.catalog.rejectUnusable = (project) => {
      if (project && !project.trusted) {
        setLocalError(tr("project.trustFirst", { name: project.name }));
        return true;
      }
      if (project && isProjectPathMissing(project.pathOk)) {
        setLocalError(tr("project.pathMissing", { name: project.name }));
        return true;
      }
      return false;
    };
    host.catalog.revealInSidebar = (project) => {
      if (project) {
        setExpandedProjects((e) => ({ ...e, [project.id]: true }));
      } else {
        setHistoryOpen(true);
      }
    };
    host.composer.stashLeaving = (leavingSessionId) => {
      const snap = {
        text: getDraft(),
        attachments,
        chatAttachments,
        quotes,
        goalMode,
      };
      if (leavingSessionId == null) {
        saveComposerProjectDraft(
          projectDraftKey(activeProject?.id ?? null),
          snap,
        );
      } else {
        saveComposerSessionDraft(leavingSessionId, snap);
      }
    };
    host.composer.restoreForSession = (sessionId) => {
      const saved = loadComposerSessionDraft(sessionId);
      suppressProjectDraftPersistRef.current = true;
      if (saved) {
        setDraft(saved.text || "");
        setAttachments(saved.attachments ?? []);
        setChatAttachments(saved.chatAttachments ?? []);
        setQuotes(saved.quotes ?? []);
        if (typeof saved.goalMode === "boolean") {
          setGoalMode(saved.goalMode);
        }
      } else {
        setDraft("");
        setAttachments([]);
        setChatAttachments([]);
        setQuotes([]);
      }
      requestAnimationFrame(() => {
        suppressProjectDraftPersistRef.current = false;
      });
    };
    host.plan.stashLeaving = (sessionId) => {
      planBySessionRef.current.set(sessionId, planRef.current);
    };
    host.plan.restoreChrome = (sessionId, stillThisOpen) => {
      setPlan(
        planBySessionRef.current.get(sessionId) ??
          emptySessionPlan(trRef.current("plan.ready")),
      );
      void (async () => {
        try {
          const [chrome, agentSnap] = await Promise.all([
            api.sessionPlanChromeGet(sessionId),
            api.sessionAgentPlanSnapshot(sessionId),
          ]);
          if (!stillThisOpen()) return;
          const mem = planBySessionRef.current.get(sessionId);
          if (mem && mem.rpcId != null) return;
          const restored = restorePlanFromPersistence(
            chrome,
            agentSnap,
            trRef.current("plan.ready"),
          );
          if (!restored.visible && !restored.userClosed && !restored.body) {
            return;
          }
          planBySessionRef.current.set(sessionId, restored);
          markPlanPendingBadge(sessionId, restored);
          if (stillThisOpen()) setPlan(restored);
        } catch {
          /* soft-fail restore */
        }
      })();
    };
    host.hydrate.applyOpenResult = (sessionId, result) => {
      if (result.status === "applied") {
        setSessionChangesById((prev) => {
          const existing = prev[sessionId] ?? [];
          let list = result.changesFromHistory;
          for (const e of existing) {
            if (e.before != null || e.after != null) {
              list = mergeSessionChange(list, {
                toolCallId: e.toolCallId,
                title: e.title,
                kind: e.toolKind,
                status: e.status,
                path: e.path,
                before: e.before,
                after: e.after,
                updatedAt: e.updatedAt,
              });
            }
          }
          return { ...prev, [sessionId]: list };
        });
        setContextUsage(result.usage);
        void tryApplyAutomationFromSession(sessionId);
        if (result.scheduledFromJournal) {
          sessionNavHostRef.current.catalog.markScheduled(sessionId);
        }
      } else {
        setContextUsage(result.usage);
      }
    };
    host.hydrate.applyReconcileResult = (sessionId, result) => {
      setContextUsage(result.usage);
      void tryApplyAutomationFromSession(sessionId);
    };
    host.gates.restoreForSession = (sessionId, { stillThisOpen, liveSessionId }) => {
      const parkedPerm = pendingPermBySessionRef.current.get(sessionId) ?? null;
      setPerm(parkedPerm);
      if (!parkedPerm && api.isTauri()) {
        void api
          .sessionPendingPermission(sessionId)
          .then((p) => {
            if (!p || !stillThisOpen()) return;
            if (pendingPermBySessionRef.current.has(sessionId)) return;
            pendingPermBySessionRef.current.set(sessionId, p);
            setPerm(p);
          })
          .catch(() => {});
      }
      setAskUser(pendingAskUserBySessionRef.current.get(sessionId) ?? null);
      setTurnStartedAt(turnStartedAtBySessionRef.current.get(sessionId) ?? null);
      if (liveSessionId !== sessionId) setRetryStatus(null);
    };
    host.gates.clearEditingAndSchema = (jsonSchema) => {
      setEditingUserMessageId(null);
      setEditAttachments([]);
      setSessionJsonSchema(
        typeof jsonSchema === "string" && jsonSchema.trim()
          ? jsonSchema
          : null,
      );
      setShowJsonSchemaModal(false);
    };
    host.gates.setLocalError = setLocalError;
    host.draft.setAutomationSetup = (on) => {
      automationSetupDraftRef.current = on;
    };
    host.draft.resetUsageAndClock = () => {
      setContextUsage(INITIAL_CONTEXT_USAGE);
      clearTurnClock();
      if (!isSendInFlightForSession(null)) {
        turnStartedAtBySessionRef.current.delete(resolveTurnClockKey(null));
      }
    };
    host.draft.resetPlanAndGates = () => {
      setPlan(emptySessionPlan(tr("plan.ready")));
      setPerm(null);
      setAskUser(null);
      setRetryStatus(null);
      setSessionJsonSchema(null);
      setShowJsonSchemaModal(false);
      setLocalError(null);
    };
    host.draft.newChatTitle = () => tr("session.new");
    host.draft.startWelcomeIntro = () => {
      setWelcomeIntroActive(welcomeMotionEnabled);
    };
    host.connect.isSecondaryWindow = () => isSecondaryWindowRef.current;
    host.connect.isSendInFlight = (sessionId) =>
      isSendInFlightForSession(sessionId);
    host.connect.isConnecting = (sessionId) =>
      connectingBySessionRef.current.has(queueSessionKey(sessionId));
    host.connect.claim = (sessionId) => claimSessionConnection(sessionId);
    host.connect.release = (sessionId) =>
      releaseSessionConnection([queueSessionKey(sessionId)]);
    host.connect.workspacePath = () => generalWorkspacePath || undefined;
    host.connect.isProjectWarmable = (project) =>
      !project || (project.trusted && !isProjectPathMissing(project.pathOk));
  }

  const searchPaletteHostRef = useRef({
    runAction: (_action: PaletteActionDef) => {},
  });
  const searchPalette = useSearchPalette({
    sessions,
    projects,
    tr,
    onRunAction: (action) => searchPaletteHostRef.current.runAction(action),
    onPickProject: (p) => {
      projectSpaces.revealProject(p.id);
      setProjectsOpen(true);
      setExpandedProjects((e) => ({ ...e, [p.id]: true }));
    },
    onPickSession: (hit) => {
      const s = sessions.find((x) => x.id === hit.id);
      const row: SessionRow =
        s ??
        normalizeSessionRow({
          id: hit.id,
          title: hit.title,
          projectId: hit.projectId ?? null,
          updatedAt: "",
          archived: hit.archived,
        });
      const proj = projects.find(
        (p) => p.id === (row.projectId ?? hit.projectId),
      );
      void openSessionRef.current(row, proj ?? null);
    },
  });
  searchPaletteApiRef.current = {
    openPalette: searchPalette.openPalette,
    openBlank: searchPalette.openBlank,
    closePalette: searchPalette.closePalette,
    open: searchPalette.open,
  };

  // Persist sidebar project collapse (only false entries) after hydrate.
  useEffect(() => {
    if (!expandedProjectsHydratedRef.current) return;
    if (!api.isTauri()) return;
    const ids = collapsedIdsFromExpandMap(expandedProjects);
    void api
      .settingsGet()
      .then((s) => {
        const prev = s.sidebarCollapsedProjectIds ?? [];
        if (sameCollapsedIdSet(prev, ids)) return;
        return api.settingsSet({
          ...s,
          sidebarCollapsedProjectIds: ids,
        });
      })
      .catch(() => {});
  }, [expandedProjects]);

  // Persist sidebar “Other sessions” expand/collapse after hydrate.
  useEffect(() => {
    if (!historyOpenHydratedRef.current) return;
    if (!api.isTauri()) return;
    void api
      .settingsGet()
      .then((s) => {
        // Treat missing as open (legacy default) so we still write explicit false.
        const prev = s.sidebarOtherSessionsOpen !== false;
        if (prev === historyOpen) return;
        return api.settingsSet({
          ...s,
          sidebarOtherSessionsOpen: historyOpen,
        });
      })
      .catch(() => {});
  }, [historyOpen]);

  /** Apply a saved project draft (or empty) into the composer UI. */
  const applyComposerProjectDraft = useCallback(
    (saved: ComposerProjectDraft | null, seedText?: string) => {
      suppressProjectDraftPersistRef.current = true;
      if (seedText != null) {
        setDraft(seedText);
        setAttachments([]);
        setChatAttachments([]);
        setQuotes([]);
      } else if (saved) {
        setDraft(saved.text || "");
        setAttachments(saved.attachments ?? []);
        setChatAttachments(saved.chatAttachments ?? []);
        setQuotes(saved.quotes ?? []);
        if (typeof saved.goalMode === "boolean") {
          setGoalMode(saved.goalMode);
        }
      } else {
        setDraft("");
        setAttachments([]);
        setChatAttachments([]);
        setQuotes([]);
      }
      // Allow debounced persist again after React commits the load.
      requestAnimationFrame(() => {
        suppressProjectDraftPersistRef.current = false;
      });
    },
    [],
  );

  /**
   * Load the per-project new-session buffer, but drop leftovers that match a
   * recently sent prompt so New session does not revive the last first message.
   */
  const restoreComposerProjectDraft = useCallback(
    (key: string) => {
      const saved = loadComposerProjectDraft(key);
      const resolved = resolveComposerProjectDraftToApply(
        saved,
        loadRecentPromptHistory().map((e) => e.text),
      );
      if (saved && !resolved) {
        clearComposerProjectDraft(key);
      }
      applyComposerProjectDraft(resolved);
    },
    [applyComposerProjectDraft],
  );

  /**
   * While on a new-chat page, keep the per-project buffer in sync so a crash
   * or hard switch mid-type still restores on next newChat.
   * Subscribes to the external draft store so AppWorkbench does not re-render on type.
   */
  useEffect(() => {
    let t: number | undefined;
    const persist = () => {
      if (suppressProjectDraftPersistRef.current) return;
      // Real session follow-ups must not overwrite the new-task buffer.
      if (session.sessionId != null || viewingSessionIdRef.current != null) {
        return;
      }
      const key = projectDraftKey(activeProject?.id ?? null);
      saveComposerProjectDraft(key, {
        text: getComposerDraft(),
        attachments,
        chatAttachments,
        quotes,
        goalMode,
      });
    };
    const schedule = () => {
      if (suppressProjectDraftPersistRef.current) return;
      if (session.sessionId != null || viewingSessionIdRef.current != null) {
        return;
      }
      window.clearTimeout(t);
      t = window.setTimeout(persist, 280);
    };
    schedule();
    const unsub = composerDraftStore.subscribe(schedule);
    return () => {
      window.clearTimeout(t);
      unsub();
    };
  }, [attachments, chatAttachments, quotes, goalMode, activeProject?.id, session.sessionId]);

  /**
   * While viewing a real thread, keep the per-session follow-up buffer in sync
   * so crash / hard switch mid-type still restores when reopening that thread.
   */
  useEffect(() => {
    let t: number | undefined;
    const sessionKey = () =>
      viewingSessionIdRef.current ?? session.sessionId ?? null;
    const persist = () => {
      if (suppressProjectDraftPersistRef.current) return;
      const id = sessionKey();
      if (!id) return;
      saveComposerSessionDraft(id, {
        text: getComposerDraft(),
        attachments,
        chatAttachments,
        quotes,
        goalMode,
      });
    };
    const schedule = () => {
      if (suppressProjectDraftPersistRef.current) return;
      if (!sessionKey()) return;
      window.clearTimeout(t);
      t = window.setTimeout(persist, 280);
    };
    schedule();
    const unsub = composerDraftStore.subscribe(schedule);
    return () => {
      window.clearTimeout(t);
      unsub();
    };
  }, [attachments, chatAttachments, quotes, goalMode, session.sessionId]);

  useEffect(() => {
    if (appGate !== "ready") return;
    if (didRestoreLastRef.current) return;
    // Wait for window role so main does not restore last while a secondary
    // deep-link is still resolving (or vice versa).
    if (!windowRoleReady) return;
    // Secondary / deep-link: open the focused session once list is ready.
    // Prefer this over "reopen last session" so multi-window does not fight.
    const deepFocus =
      secondaryFocusSessionIdRef.current ||
      parseSessionDeepLinkHash(
        typeof window !== "undefined" ? window.location.hash : "",
      );
    // Secondary window or explicit deep-link hash → open that session first.
    if (deepFocus && (isSecondaryWindowRef.current || secondaryFocusSessionId)) {
      if (sessions.length === 0) {
        // Wait until sessions load (another effect tick).
        return;
      }
      didRestoreLastRef.current = true;
      secondaryOpenedRef.current = true;
      const row = sessions.find((s) => s.id === deepFocus);
      if (row) {
        void openSessionRef.current(row);
      } else {
        setLocalError(tr("session.openInNewWindowMissing"));
      }
      return;
    }
    if (!api.isTauri()) {
      didRestoreLastRef.current = true;
      // Browser / non-host: still restore orphan new-chat draft if any.
      if (session.sessionId == null && viewingSessionIdRef.current == null) {
        restoreComposerProjectDraft(projectDraftKey(activeProject?.id ?? null));
      }
      return;
    }
    // Main window only: reopen last session.
    if (isSecondaryWindowRef.current) {
      didRestoreLastRef.current = true;
      return;
    }
    const id = shouldRestoreLastSession({
      enabled: reopenLastSession,
      workbenchReady: true,
      lastSessionId,
      sessions,
      currentSessionId: session.sessionId,
    });
    didRestoreLastRef.current = true;
    if (id) {
      const row = sessions.find((s) => s.id === id);
      if (row) {
        void openSessionRef.current(row);
        return;
      }
    }
    // Default launch = new chat: restore per-project (or orphan) buffer.
    if (session.sessionId == null && viewingSessionIdRef.current == null) {
      restoreComposerProjectDraft(projectDraftKey(activeProject?.id ?? null));
    }
  }, [
    appGate,
    windowRoleReady,
    reopenLastSession,
    lastSessionId,
    sessions,
    session.sessionId,
    activeProject?.id,
    applyComposerProjectDraft,
    restoreComposerProjectDraft,
    tr,
    secondaryFocusSessionId,
    isSecondaryWindow,
  ]);

  // HMR / remount: shell may keep the selected session while the journal
  // cache is empty. Re-open so the thread does not look like a failed empty chat.
  useEffect(() => {
    const id = session.sessionId;
    if (
      !shouldReopenUnhydratedSession({
        sessionId: id,
        mainPaneIsChat: mainPane === "chat",
        journalHydrated: id
          ? sessionTranscriptStore.isJournalHydrated(id)
          : false,
        journalLoading: id
          ? sessionTranscriptStore.isJournalLoading(id)
          : false,
        messageCount: transcriptMeta.length,
        rowExists: !!id && sessions.some((row) => row.id === id),
      })
    ) {
      return;
    }
    const row = sessions.find((s) => s.id === id);
    if (row) void openSessionRef.current(row);
  }, [
    session.sessionId,
    mainPane,
    sessions,
    transcriptMeta.length,
    transcriptMeta.journalLoading,
  ]);

  /** Open (or focus) a chat in a secondary live-capable webview window. */
  const openSessionInNewWindow = useCallback(
    (s: SessionRow) => {
      if (
        !canOpenSessionInNewWindow({
          isDesktopHost: api.isDesktopHost(),
          isSecondaryWindow: isSecondaryWindowRef.current,
          sessionId: s.id,
        })
      ) {
        return;
      }
      void (async () => {
        try {
          await api.openSessionWindow(s.id, s.title || null);
        } catch (e) {
          showToast(
            tr("session.openInNewWindowFailed") + ": " + String(e),
            4500,
          );
        }
      })();
    },
    [tr],
  );

  /**
   * Focus composer after React commit. Retries until the textarea is mounted
   * (e.g. switching from automations → chat) or attempts run out.
   * Must be called after any await so state updates have been scheduled.
   */
  const requestComposerFocus = useCallback(() => {
    pendingComposerFocus.current = true;
    const tryFocus = (attemptsLeft: number) => {
      const el = composerInputRef.current;
      if (el && el.getAttribute("contenteditable") !== "false") {
        el.focus({ preventScroll: true });
        resizeComposerInput(el);
        try {
          const sel = window.getSelection();
          if (sel) {
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        } catch {
          /* ignore */
        }
        if (document.activeElement === el) {
          pendingComposerFocus.current = false;
          return;
        }
      }
      if (attemptsLeft <= 0) {
        pendingComposerFocus.current = false;
        return;
      }
      requestAnimationFrame(() => tryFocus(attemptsLeft - 1));
    };
    // macOS: button click keeps focus on the button until the next tick.
    if (composerFocusTimerRef.current) {
      clearTimeout(composerFocusTimerRef.current);
    }
    composerFocusTimerRef.current = setTimeout(() => {
      composerFocusTimerRef.current = null;
      tryFocus(12);
    }, 0);
  }, []);

  /**
   * Visual order of sessions in the open sidebar (expanded projects + orphans).
   * Used by j/k navigation via {@link nextSessionId}.
   */
  const sidebarNavSessionIds = useMemo(() => {
    const ids: string[] = [];
    const projectIdSet = new Set(projects.map((p) => p.id));
    if (projectsOpen) {
      for (const proj of projects) {
        if (expandedProjects[proj.id] === false) continue;
        const projSessions = sessions.filter(
          (s) => s.projectId === proj.id && !s.archived,
        );
        for (const s of sortSessionsForSidebar(projSessions)) ids.push(s.id);
      }
    }
    if (historyOpen) {
      const orphans = sessions.filter(
        (s) =>
          (!s.projectId || !projectIdSet.has(s.projectId)) && !s.archived,
      );
      for (const s of sortSessionsForSidebar(orphans)) ids.push(s.id);
    }
    return ids;
  }, [projectsOpen, projects, expandedProjects, sessions, historyOpen]);
  sidebarNavIdsRef.current = sidebarNavSessionIds;
  sidebarNavCurrentIdRef.current =
    session.sessionId ?? viewingSessionIdRef.current ?? null;

  /** Archived chats grouped by project for Settings → Archived. */
  const archivedGroups = useMemo(() => {
    const archived = sessions
      .filter((s) => s.archived)
      .slice()
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    const byProject = new Map<string | null, SessionRow[]>();
    for (const s of archived) {
      const key =
        s.projectId && projects.some((p) => p.id === s.projectId)
          ? s.projectId
          : null;
      const list = byProject.get(key) ?? [];
      list.push(s);
      byProject.set(key, list);
    }
    const groups: Array<{
      id: string | null;
      name: string;
      sessions: SessionRow[];
    }> = [];
    // Stable order: pin projects list order, then orphan bucket.
    for (const p of projects) {
      const list = byProject.get(p.id);
      if (list?.length) {
        groups.push({ id: p.id, name: p.name, sessions: list });
      }
    }
    const orphan = byProject.get(null);
    if (orphan?.length) {
      groups.push({
        id: null,
        name: tr("settings.archived.orphan"),
        sessions: orphan,
      });
    }
    return groups;
  }, [sessions, projects, tr]);

  /**
   * Run a scheduled automation now: open chat under its project (or orphan),
   * connect, and send the stored prompt.
   * @returns true if the prompt was handed to the agent (mark_run applied).
   */
  const runAutomation = useCallback(
    async (
      auto: Automation,
      opts?: { fromScheduler?: boolean },
    ): Promise<boolean> => {
      if (automationRunLock.current) {
        // Soft skip — do not invent a fire; only note busy contention.
        recordAutomationRun({
          scheduleId: auto.id,
          name: auto.title,
          outcome: "skipped",
          source: "run_now",
          error: "busy",
        });
        return false;
      }
      if (opts?.fromScheduler && (session.state === "streaming" || connecting)) {
        recordAutomationRun({
          scheduleId: auto.id,
          name: auto.title,
          outcome: "skipped",
          source: "run_now",
          error: "session_busy",
        });
        return false;
      }
      automationRunLock.current = true;
      let createdSessionId: string | null = null;
      try {
        const proj = auto.projectId
          ? projects.find((p) => p.id === auto.projectId) ?? null
          : null;
        if (proj && !proj.trusted) {
          const detail = tr("project.trustFirst", { name: proj.name });
          setLocalError(detail);
          recordAutomationRun({
            scheduleId: auto.id,
            name: auto.title,
            outcome: "error",
            source: "run_now",
            error: detail,
          });
          return false;
        }
        if (proj && isProjectPathMissing(proj.pathOk)) {
          const detail = tr("project.pathMissing", { name: proj.name });
          setLocalError(detail);
          recordAutomationRun({
            scheduleId: auto.id,
            name: auto.title,
            outcome: "error",
            source: "run_now",
            error: detail,
          });
          return false;
        }
        setMainPane("chat");
        closeSettings();
        setActiveProject(proj);
        if (proj) {
          setExpandedProjects((e) => ({ ...e, [proj.id]: true }));
        } else {
          setHistoryOpen(true);
        }
        openingSessionIdRef.current = null;
        invalidateOpenPipelines();
        bumpViewEpoch();
        viewingSessionIdRef.current = null;
        sessionTranscriptStore.setViewingSessionId(null);
        sessionTranscriptStore.clearJournalLoad();
        setMessages([]);
        setAttachments([]);
        setQuotes([]);
        setPerm(null);
        setAskUser(null);
        setRetryStatus(null);
        setLocalError(null);
        setDraft("");
        if (api.isTauri()) {
          try {
            await api.sessionDisconnect();
          } catch {
            /* ignore */
          }
        }
        setSession({
          ...IDLE_SNAPSHOT,
          sessionId: null,
          title: auto.title || tr("session.new"),
          state: "idle",
          backend: "grok_agent_stdio",
        });
        {
          const idle = { ...IDLE_SNAPSHOT };
          setLiveHost(idle);
          liveHostRef.current = idle;
        }

        let sessionId: string | null = null;
        if (api.isTauri()) {
          const meta = (await api.sessionCreate(
            proj?.id,
            auto.title || tr("session.new"),
            { scheduled: true },
          )) as { id: string; title?: string; scheduled?: boolean };
          sessionId = meta.id;
          createdSessionId = meta.id;
          viewingSessionIdRef.current = meta.id;
          setSession((prev) => ({
            ...prev,
            sessionId: meta.id,
            title: meta.title || auto.title,
          }));
          await refreshSessions();
        }

        // Persist model/effort for this session before connect when possible.
        if (sessionId && api.isTauri() && (auto.modelId || auto.effort)) {
          try {
            await api.composerPrefsSet({
              sessionId,
              projectId: proj?.id ?? null,
              modelId: auto.modelId,
              effort: auto.effort,
            });
          } catch {
            /* soft-fail */
          }
        }

        const snap = await api.sessionConnect({
          projectPath: proj?.path || generalWorkspacePath || undefined,
          sessionId: sessionId ?? undefined,
          mode: "agent",
        });
        setLiveHost(snap);
        liveHostRef.current = snap;
        if (snap.sessionId) {
          viewingSessionIdRef.current = snap.sessionId;
          sessionId = snap.sessionId;
        }
        setSession({
          ...snap,
          title: snap.title || auto.title || snap.title,
        });
        if (snap.lastError || snap.state !== "ready") {
          const code = snap.lastError?.code ?? "AGENT_CRASHED";
          const msg = snap.lastError?.message ?? "connect failed";
          const detail = `${code}: ${msg}`;
          setLocalError(
            tr("automations.connectFailed", { detail }),
          );
          recordAutomationRun({
            scheduleId: auto.id,
            name: auto.title,
            outcome: "error",
            source: "run_now",
            error: detail,
          });
          // Drop empty shell sessions so sidebar does not show SuperGrok ghosts.
          if (createdSessionId && api.isTauri()) {
            try {
              await api.sessionDelete(createdSessionId);
              await refreshSessions();
            } catch {
              /* ignore */
            }
            if (viewingSessionIdRef.current === createdSessionId) {
              viewingSessionIdRef.current = null;
              setMessages([]);
              setSession({ ...IDLE_SNAPSHOT, state: "idle" });
            }
          }
          return false;
        }

        if (sessionId && auto.modelId && api.isTauri()) {
          try {
            await api.sessionSetModel(auto.modelId, {
              sessionId,
              projectId: proj?.id ?? null,
            });
          } catch {
            /* soft-fail */
          }
        }

        const header = `[Scheduled: ${auto.title}]\n\n`;
        const promptBody = header + auto.prompt;
        const autoMsgs: ChatMessage[] = [
          {
            id: `u-auto-${Date.now()}`,
            role: "user",
            content: promptBody,
            createdAt: new Date().toISOString(),
          },
        ];
        if (sessionId) {
          messagesBySessionRef.current.set(sessionId, autoMsgs);
        }
        setMessages(autoMsgs);
        setSession((prev) => ({
          ...prev,
          state: "streaming",
          lastError: null,
          title: auto.title || prev.title,
        }));

        try {
          await api.sessionSend(promptBody, null, sessionId);
        } catch (sendErr) {
          const errText = String(sendErr);
          const failed: ChatMessage[] = [
            ...autoMsgs,
            {
              id: `err-auto-${Date.now()}`,
              role: "assistant",
              content: errText,
              isError: true,
              createdAt: new Date().toISOString(),
            },
          ];
          if (sessionId) {
            messagesBySessionRef.current.set(sessionId, failed);
          }
          setMessages(failed);
          setLocalError(errText);
          setSession((prev) =>
            prev.sessionId === sessionId
              ? { ...prev, state: "ready" }
              : prev,
          );
          recordAutomationRun({
            scheduleId: auto.id,
            name: auto.title,
            outcome: "error",
            source: "run_now",
            error: errText,
          });
          return false;
        }

        const lastRunAt = new Date().toISOString();
        const nextRunAt =
          auto.frequency === "once"
            ? null
            : computeNextRunAt(
                { ...auto, enabled: auto.frequency !== "once" },
                new Date(Date.now() + 60_000),
              );
        await api.automationMarkRun(auto.id, lastRunAt, nextRunAt);
        if (auto.frequency === "once") {
          await api.automationSetEnabled(auto.id, false);
        }
        recordAutomationRun({
          scheduleId: auto.id,
          name: auto.title,
          outcome: "ok",
          source: "run_now",
          at: lastRunAt,
        });
        return true;
      } catch (e) {
        setLocalError(String(e));
        recordAutomationRun({
          scheduleId: auto.id,
          name: auto.title,
          outcome: "error",
          source: "run_now",
          error: e,
        });
        return false;
      } finally {
        automationRunLock.current = false;
      }
    },
    [projects, session.state, connecting, tr],
  );

  // Host automation_runner ticks while the process is alive (including tray).
  // UI only surfaces toasts / refreshes list — do not double-fire from WebView.
  useEffect(() => {
    if (!api.isTauri()) return;
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    const track = async (p: Promise<() => void>) => {
      try {
        const u = await p;
        if (cancelled) u();
        else unsubs.push(u);
      } catch {
        /* ignore */
      }
    };
    void track(
      api.listen<{
        title?: string;
        sessionId?: string;
        automationId?: string;
      }>("automation://ran", (p) => {
        if (cancelled) return;
        const title = (p?.title || "").trim() || "automation";
        // Observe host fire while process is alive — never invent offline runs.
        recordAutomationRun({
          scheduleId: p?.automationId ?? "",
          name: title,
          outcome: "ok",
          source: "host",
        });
        void refreshSessions();
      }),
    );
    void track(
      api.listen<{
        title?: string;
        error?: string;
        automationId?: string;
      }>("automation://error", (p) => {
        if (cancelled) return;
        const title = (p?.title || "").trim() || "automation";
        const err = (p?.error || "").trim() || "failed";
        recordAutomationRun({
          scheduleId: p?.automationId ?? "",
          name: title,
          outcome: "error",
          source: "host",
          error: err,
        });
        setLocalError(
          tr("automations.hostRunFailed", { title, detail: err }),
        );
      }),
    );
    return () => {
      cancelled = true;
      for (const u of unsubs) u();
    };
    // refreshSessions is stable enough via closure for mount-only listen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tr]);

  const refreshProjects = async () => {
    try {
      const list = await api.projectsList();
      const mapped = mapProjectsList(list as Project[]);
      setProjects(mapped);
      // Keep active project pathOk/path in sync with Host re-check.
      // Drop retired system:general if it was still selected.
      setActiveProject((prev) => {
        if (!prev) return prev;
        if (isGeneralProject(prev)) return null;
        return mapped.find((x) => x.id === prev.id) ?? prev;
      });
      void api
        .generalWorkspacePath()
        .then((path) => setGeneralWorkspacePath(path || null))
        .catch(() => {});
    } catch {
      /* ignore */
    }
  };

  /** Persist sidebar project order (pin groups enforced on Host). */
  const projectsOrderRef = useRef(projects);
  projectsOrderRef.current = projects;
  const applyProjectsOrder = useCallback(
    async (next: Project[]) => {
      const prev = projectsOrderRef.current;
      setProjects(next);
      projectsOrderRef.current = next;
      try {
        const saved = mapProjectsList(
          (await api.projectsReorder(next.map((p) => p.id))) as Project[],
        );
        setProjects(saved);
        projectsOrderRef.current = saved;
      } catch (e) {
        setProjects(prev);
        projectsOrderRef.current = prev;
        setLocalError(
          e instanceof Error ? e.message : tr("project.reorderFailed"),
        );
      }
    },
    [tr],
  );

  const projectReorder = useSidebarProjectReorder({
    projects: visibleProjects,
    enabled:
      !sessionSelectMode &&
      !isMirrorClient() &&
      visibleProjects.length > 1,
    onReorder: (next) => {
      void applyProjectsOrder(
        projectSpaces.spliceOrder(projectsOrderRef.current, next),
      );
    },
  });

  const moveProjectByMenu = useCallback(
    (projId: string, direction: "up" | "down") => {
      const nextVisible = moveProjectInPinGroup(
        visibleProjects,
        projId,
        direction,
      );
      if (nextVisible === visibleProjects) return;
      void applyProjectsOrder(
        projectSpaces.spliceOrder(projects, nextVisible),
      );
    },
    [visibleProjects, projects, applyProjectsOrder, projectSpaces],
  );

  const applySessionTitle = useCallback(
    (sessionId: string, title: string) => {
      setSessions((list) =>
        list.map((s) => (s.id === sessionId ? { ...s, title } : s)),
      );
      setSession((prev) =>
        prev.sessionId === sessionId ? { ...prev, title } : prev,
      );
      void api.trayRefresh();
    },
    [],
  );

  /** Open chat markdown http(s) links via desktop shell; optional confirm pref. */
  const openExternalLinkFromChat = useCallback(
    (url: string) => {
      // ChatCut editor/billing → system default browser (EmbeddedBrowser cannot
      // reliably play media). Opt-in only: forceEditorInApp → side Resources.
      const action = resolveChatcutLinkClick(url, { locale });
      if (action.kind === "open_in_app_browser") {
        const target = chatcutHandoffToResourceOpenTarget(action);
        if (target) {
          navigateWorkbench();
          openAsidePane();
          setResourceOpenTarget(target);
          return;
        }
      }
      // Prefer resolved external URL (locale + stripped Codex-only params).
      const openUrl =
        action.kind === "open_external" ? action.url : url;
      const doOpen = () => {
        if (api.isTauri()) {
          void api.openExternalUrl(openUrl).catch((e) => {
            console.error("[chat] openExternalUrl failed", e);
            // Fallback for hosts that reject shell open.
            try {
              window.open(openUrl, "_blank", "noopener,noreferrer");
            } catch {
              /* ignore */
            }
          });
        } else {
          window.open(openUrl, "_blank", "noopener,noreferrer");
        }
      };
      if (loadConfirmExternalLinksPref()) {
        setAppDialog({
          kind: "confirm",
          title: tr("chat.externalLinkConfirmTitle"),
          message: tr("chat.externalLinkConfirmMessage", { url }),
          confirmLabel: tr("chat.externalLinkOpen"),
          onConfirm: doOpen,
        });
        return;
      }
      doOpen();
    },
    [tr, locale, navigateWorkbench, openAsidePane],
  );

  const renameProject = (proj: Project) => {
    setCtxMenu(null);
    setAppDialog({
      kind: "prompt",
      title: tr("project.rename"),
      initial: proj.name,
      onSubmit: async (name) => {
        const next = name.trim();
        if (!next || next === proj.name) return;
        try {
          await api.projectRename(proj.id, next);
          await refreshProjects();
          void api.trayRefresh();
          if (activeProject?.id === proj.id) {
            setActiveProject((p) => (p ? { ...p, name: next } : p));
          }
        } catch (e) {
          setLocalError(String(e));
        }
      },
    });
  };

  /**
   * Pick a new folder for a project whose path is gone or moved (D05).
   * Host persists path and re-checks is_dir → pathOk true.
   */
  const relocateProject = async (proj: Project) => {
    setCtxMenu(null);
    if (!api.isTauri()) {
      setLocalError(tr("error.needTauri"));
      return;
    }
    try {
      const dir = await api.pickDirectory();
      if (!dir) return;
      const updated = (await api.projectRelocate(proj.id, dir)) as Project;
      await refreshProjects();
      void api.trayRefresh();
      if (activeProject?.id === proj.id) {
        setActiveProject(updated);
        // Force reconnect on next send — cwd changed.
        setSession((prev) =>
          prev.sessionId
            ? {
                ...IDLE_SNAPSHOT,
                sessionId: prev.sessionId,
                title: prev.title,
                state: "idle",
                backend: prev.backend || "grok_agent_stdio",
              }
            : prev,
        );
        setLiveHost((prev) =>
          prev.sessionId ? { ...IDLE_SNAPSHOT } : prev,
        );
      }
      setLocalError(null);
    } catch (e) {
      setLocalError(String(e));
    }
  };

  /**
   * Apply a project-level permission tier (L10).
   * `null` clears the override so the app default is used again.
   * YOLO still requires the same two-step confirm as the composer chip.
   */
  const applyProjectPermissionPolicy = (
    proj: Project,
    next: PermissionPolicyId | null,
  ) => {
    setCtxMenu(null);

    const commit = async () => {
      try {
        const updated = (await api.projectSetPermissionPolicy(
          proj.id,
          next,
        )) as Project;
        await refreshProjects();
        if (activeProject?.id === proj.id) {
          setActiveProject((p) =>
            p
              ? {
                  ...p,
                  permissionPolicy: updated.permissionPolicy ?? null,
                }
              : p,
          );
          const prefs = await api.composerPrefsResolve({
            projectId: proj.id,
            sessionId: session.sessionId ?? null,
          });
          applyComposerPrefs(prefs, availableModels);
        }
      } catch (e) {
        setLocalError(String(e));
      }
    };

    if (next === "always_approve") {
      setAppDialog({
        kind: "confirm",
        title: tr("policy.always_approve"),
        message: tr("policy.yoloConfirm"),
        confirmLabel: tr("common.confirm"),
        danger: true,
        onConfirm: () => {
          setAppDialog({
            kind: "confirm",
            title: tr("policy.always_approve"),
            message: tr("policy.yoloConfirm2"),
            confirmLabel: tr("policy.short.always_approve"),
            danger: true,
            onConfirm: () => {
              void commit();
            },
          });
        },
      });
      return;
    }

    void commit();
  };

  const sandboxProfileLabel = (id: SandboxProfileId) =>
    tr(sandboxProfileLabelKey(id));

  /**
   * Apply a project-level OS sandbox profile.
   * `null` clears the override so app Settings apply.
   * Switching to off/devbox requires the same danger confirm as Settings.
   */
  const applyProjectSandboxProfile = (
    proj: Project,
    next: SandboxProfileId | null,
  ) => {
    setCtxMenu(null);

    const commit = async () => {
      try {
        const updated = (await api.projectSetSandboxProfile(
          proj.id,
          next,
        )) as Project;
        await refreshProjects();
        if (activeProject?.id === proj.id) {
          setActiveProject((p) =>
            p
              ? {
                  ...p,
                  sandboxProfile: updated.sandboxProfile ?? null,
                }
              : p,
          );
        }
      } catch (e) {
        setLocalError(String(e));
      }
    };

    if (next && isDangerousSandboxProfile(next)) {
      const bodyKey = sandboxDangerConfirmKey(next);
      setAppDialog({
        kind: "confirm",
        title: tr("settings.sandbox.dangerConfirmTitle"),
        message: bodyKey ? tr(bodyKey) : tr("settings.sandbox.dangerConfirmOff"),
        confirmLabel: tr("common.confirm"),
        danger: true,
        onConfirm: () => {
          void commit();
        },
      });
      return;
    }

    void commit();
  };

  const projectColorLabel = (token: ProjectColorToken) =>
    tr(
      (
        {
          blue: "project.colorBlue",
          green: "project.colorGreen",
          orange: "project.colorOrange",
          purple: "project.colorPurple",
          pink: "project.colorPink",
          gray: "project.colorGray",
        } as const
      )[token],
    );

  /** Set or clear a project sidebar accent color. `null` clears. */
  const applyProjectColor = (proj: Project, next: string | null) => {
    setCtxMenu(null);
    void (async () => {
      try {
        const updated = (await api.projectSetColor(proj.id, next)) as Project;
        await refreshProjects();
        if (activeProject?.id === proj.id) {
          setActiveProject((p) =>
            p
              ? {
                  ...p,
                  color: normalizeProjectColor(updated.color) ?? null,
                }
              : p,
          );
        }
      } catch (e) {
        setLocalError(String(e));
      }
    })();
  };

  /** Persist global sandbox Settings; confirm when switching to off/devbox. */
  const applyGlobalSandboxProfile = (nextRaw: string) => {
    const next =
      normalizeSandboxProfile(nextRaw) ?? ("off" as SandboxProfileId);
    const prev = sandboxProfile;
    if (next === prev) return;

    const commit = () => {
      setSandboxProfile(next);
      void api
        .settingsGet()
        .then((s) => api.settingsSet({ ...s, sandboxProfile: next }))
        .catch((e) => {
          setSandboxProfile(prev);
          showToast(String(e), 4500);
        });
    };

    if (isDangerousSandboxProfile(next) && next !== prev) {
      const bodyKey = sandboxDangerConfirmKey(next);
      setAppDialog({
        kind: "confirm",
        title: tr("settings.sandbox.dangerConfirmTitle"),
        message: bodyKey ? tr(bodyKey) : tr("settings.sandbox.dangerConfirmOff"),
        confirmLabel: tr("common.confirm"),
        danger: true,
        onConfirm: () => {
          commit();
        },
      });
      return;
    }

    commit();
  };

  /** Remove project from app list only (disk folder + chats kept). */
  const removeProjectFromApp = (proj: Project) => {
    setCtxMenu(null);
    if (isGeneralProject(proj)) {
      // Should not appear in the list; no-op.
      return;
    }
    setAppDialog({
      kind: "confirm",
      title: tr("project.removeTitle"),
      message: tr("project.removeConfirmDetail", {
        name: projectDisplayName(proj, tr),
      }),
      confirmLabel: tr("project.remove"),
      danger: true,
      onConfirm: async () => {
        try {
          if (!api.isTauri()) {
            setLocalError(tr("error.needTauri"));
            return;
          }
          await api.projectRemove(proj.id);
          projectSpaces.forgetProject(proj.id);
          if (activeProject?.id === proj.id) {
            // Unbound — sessions for this folder show under "其他会话".
            setActiveProject(null);
            setHistoryOpen(true);
            setSession(IDLE_SNAPSHOT);
            setMessages([]);
          }
          await refreshProjects();
          await refreshSessions();
          setLocalError(null);
        } catch (e) {
          setLocalError(String(e));
        }
      },
    });
  };

  const persistSessionTitle = async (s: SessionRow, next: string) => {
    try {
      await api.sessionRename(s.id, next);
      applySessionTitle(s.id, next);
      await refreshSessions();
    } catch (e) {
      setLocalError(String(e));
    }
  };

  const renameSession = (s: SessionRow) => {
    setCtxMenu(null);
    const shown = s.title || tr("session.untitled");
    setAppDialog({
      kind: "prompt",
      title: tr("session.renamePrompt"),
      initial: shown,
      placeholder: tr("session.renamePlaceholder"),
      onSubmit: async (title) => {
        const next = nextSessionTitle(title, shown);
        if (!next) return;
        await persistSessionTitle(s, next);
      },
    });
  };

  /**
   * Archive / unarchive a session.
   * If the open conversation is archived, leave it for a fresh draft so the
   * main pane does not keep showing a chat that disappeared from the tree.
   */
  const archiveSession = async (s: SessionRow, archived = true) => {
    setCtxMenu(null);
    const wasViewing =
      archived &&
      (session.sessionId === s.id || viewingSessionIdRef.current === s.id);
    try {
      await api.sessionSetArchived(s.id, archived);
      await refreshSessions();
      if (wasViewing) {
        const proj = s.projectId
          ? projects.find((p) => p.id === s.projectId) ?? null
          : null;
        // Same project context when possible; orphan → “其他会话” draft.
        if (proj) await newChat(proj, { switchToChat: true });
        else await newChat(null, { switchToChat: true });
      } else if (!archived && s.projectId) {
        setExpandedProjects((e) => ({ ...e, [s.projectId!]: true }));
      }
    } catch (e) {
      setLocalError(String(e));
    }
  };

  /** Pin / unpin a session (floats to top of its sidebar group). */
  const pinSession = async (s: SessionRow, pinned = true) => {
    setCtxMenu(null);
    try {
      await api.sessionSetPinned(s.id, pinned);
      await refreshSessions();
    } catch (e) {
      setLocalError(String(e));
    }
  };

  /**
   * Attach a folder as a session-only `--plugin-dir` (does not change Extensions).
   * Soft-respawns when this chat is the live agent.
   */
  const addSessionPluginDir = async (s: SessionRow) => {
    setCtxMenu(null);
    try {
      if (!api.isTauri()) {
        setLocalError(tr("error.needTauri"));
        return;
      }
      const folder = await api.pickAttachFolder();
      if (!folder) return;
      const next = appendPluginDir(s.pluginDirs, folder);
      await api.sessionSetPluginDirs(s.id, next);
      await refreshSessions();
    } catch (e) {
      setLocalError(String(e));
    }
  };

  /** Clear session-only plugin dirs (global Extensions unchanged). */
  const clearSessionPluginDirs = async (s: SessionRow) => {
    setCtxMenu(null);
    try {
      if (!api.isTauri()) {
        setLocalError(tr("error.needTauri"));
        return;
      }
      await api.sessionSetPluginDirs(s.id, []);
      await refreshSessions();
    } catch (e) {
      setLocalError(String(e));
    }
  };

  /** Open GlassModal to edit per-session extra rules (`grok --rules`). */
  const openSessionRules = (s: SessionRow) => {
    setCtxMenu(null);
    const initial =
      typeof s.extraRules === "string" ? s.extraRules : "";
    setSessionRulesDraft(initial);
    setSessionRulesBaseline(initial);
    setSessionRulesError(null);
    setSessionRulesBusy(false);
    setSessionRulesDiscardOpen(false);
    setSessionRulesTarget({
      id: s.id,
      title: s.title || tr("session.untitled"),
    });
  };

  const forceCloseSessionRulesModal = () => {
    setSessionRulesTarget(null);
    setSessionRulesDraft("");
    setSessionRulesBaseline("");
    setSessionRulesError(null);
    setSessionRulesBusy(false);
    setSessionRulesDiscardOpen(false);
  };

  const closeSessionRulesModal = () => {
    if (sessionRulesBusy) return;
    const v = validateSessionTextField({
      field: "extra_rules",
      draft: sessionRulesDraft,
      baseline: sessionRulesBaseline,
    });
    if (shouldConfirmSessionTextDiscard(v)) {
      setSessionRulesDiscardOpen(true);
      return;
    }
    forceCloseSessionRulesModal();
  };

  const saveSessionRulesModal = async () => {
    const target = sessionRulesTarget;
    if (!target || sessionRulesBusy) return;
    const next = sanitizeExtraRules(sessionRulesDraft);
    setSessionRulesBusy(true);
    setSessionRulesError(null);
    try {
      if (!api.isTauri()) {
        setSessionRulesError(tr("session.promptError.needTauri"));
        setSessionRulesBusy(false);
        return;
      }
      const saved = await api.sessionSetExtraRules(target.id, next || null);
      const stored =
        typeof saved.extraRules === "string" && saved.extraRules.trim()
          ? saved.extraRules
          : next || null;
      setSessions((list) =>
        list.map((row) =>
          row.id === target.id ? { ...row, extraRules: stored } : row,
        ),
      );
      forceCloseSessionRulesModal();
    } catch (e) {
      const soft = presentSessionPromptSoftFail(e);
      setSessionRulesError(
        soft.detail.trim()
          ? `${tr(soft.messageKey)}: ${soft.detail}`
          : tr(soft.messageKey),
      );
      setSessionRulesBusy(false);
    }
  };

  const clearSessionRulesModal = async () => {
    const target = sessionRulesTarget;
    if (!target || sessionRulesBusy) return;
    setSessionRulesBusy(true);
    setSessionRulesError(null);
    try {
      if (!api.isTauri()) {
        setSessionRulesError(tr("session.promptError.needTauri"));
        setSessionRulesBusy(false);
        return;
      }
      await api.sessionSetExtraRules(target.id, null);
      setSessions((list) =>
        list.map((row) =>
          row.id === target.id ? { ...row, extraRules: null } : row,
        ),
      );
      forceCloseSessionRulesModal();
    } catch (e) {
      const soft = presentSessionPromptSoftFail(e);
      setSessionRulesError(
        soft.detail.trim()
          ? `${tr(soft.messageKey)}: ${soft.detail}`
          : tr(soft.messageKey),
      );
      setSessionRulesBusy(false);
    }
  };

  /** Open GlassModal to edit per-session max agent turns (`grok --max-turns`). */
  const openSessionMaxTurns = (s: SessionRow) => {
    setCtxMenu(null);
    const n = normalizeMaxAgentTurns(s.maxAgentTurns);
    setSessionMaxTurnsDraft(n != null ? String(n) : "");
    setSessionMaxTurnsTarget({
      id: s.id,
      title: s.title || tr("session.untitled"),
    });
  };

  const closeSessionMaxTurnsModal = () => {
    setSessionMaxTurnsTarget(null);
    setSessionMaxTurnsDraft("");
  };

  const saveSessionMaxTurnsModal = async () => {
    const target = sessionMaxTurnsTarget;
    if (!target) return;
    const next = normalizeMaxAgentTurns(sessionMaxTurnsDraft);
    try {
      if (!api.isTauri()) {
        setLocalError(tr("error.needTauri"));
        return;
      }
      const saved = await api.sessionSetMaxAgentTurns(target.id, next);
      const stored = normalizeMaxAgentTurns(
        typeof saved.maxAgentTurns === "number" ? saved.maxAgentTurns : next,
      );
      setSessions((list) =>
        list.map((row) =>
          row.id === target.id ? { ...row, maxAgentTurns: stored } : row,
        ),
      );
      closeSessionMaxTurnsModal();
    } catch (e) {
      setLocalError(String(e));
    }
  };

  const clearSessionMaxTurnsModal = async () => {
    const target = sessionMaxTurnsTarget;
    if (!target) return;
    try {
      if (!api.isTauri()) {
        setLocalError(tr("error.needTauri"));
        return;
      }
      await api.sessionSetMaxAgentTurns(target.id, null);
      setSessions((list) =>
        list.map((row) =>
          row.id === target.id ? { ...row, maxAgentTurns: null } : row,
        ),
      );
      setSessionMaxTurnsDraft("");
      closeSessionMaxTurnsModal();
    } catch (e) {
      setLocalError(String(e));
    }
  };

  /** Open GlassModal to edit per-session system prompt override. */
  const openSessionSysPrompt = (s: SessionRow) => {
    setCtxMenu(null);
    const initial =
      typeof s.systemPromptOverride === "string"
        ? s.systemPromptOverride
        : "";
    setSessionSysPromptDraft(initial);
    setSessionSysPromptBaseline(initial);
    setSessionSysPromptError(null);
    setSessionSysPromptBusy(false);
    setSessionSysPromptDiscardOpen(false);
    setSessionSysPromptTarget({
      id: s.id,
      title: s.title || tr("session.untitled"),
    });
  };

  const forceCloseSessionSysPromptModal = () => {
    setSessionSysPromptTarget(null);
    setSessionSysPromptDraft("");
    setSessionSysPromptBaseline("");
    setSessionSysPromptError(null);
    setSessionSysPromptBusy(false);
    setSessionSysPromptDiscardOpen(false);
  };

  const closeSessionSysPromptModal = () => {
    if (sessionSysPromptBusy) return;
    const v = validateSessionTextField({
      field: "system_prompt",
      draft: sessionSysPromptDraft,
      baseline: sessionSysPromptBaseline,
    });
    if (shouldConfirmSessionTextDiscard(v)) {
      setSessionSysPromptDiscardOpen(true);
      return;
    }
    forceCloseSessionSysPromptModal();
  };

  const saveSessionSysPromptModal = async () => {
    const target = sessionSysPromptTarget;
    if (!target || sessionSysPromptBusy) return;
    const next = sanitizeSystemPromptOverride(sessionSysPromptDraft);
    setSessionSysPromptBusy(true);
    setSessionSysPromptError(null);
    try {
      if (!api.isTauri()) {
        setSessionSysPromptError(tr("session.promptError.needTauri"));
        setSessionSysPromptBusy(false);
        return;
      }
      const saved = await api.sessionSetSystemPromptOverride(
        target.id,
        next || null,
      );
      const stored =
        typeof saved.systemPromptOverride === "string" &&
        saved.systemPromptOverride.trim()
          ? saved.systemPromptOverride
          : next || null;
      setSessions((list) =>
        list.map((row) =>
          row.id === target.id
            ? { ...row, systemPromptOverride: stored }
            : row,
        ),
      );
      forceCloseSessionSysPromptModal();
    } catch (e) {
      const soft = presentSessionPromptSoftFail(e);
      setSessionSysPromptError(
        soft.detail.trim()
          ? `${tr(soft.messageKey)}: ${soft.detail}`
          : tr(soft.messageKey),
      );
      setSessionSysPromptBusy(false);
    }
  };

  const clearSessionSysPromptModal = async () => {
    const target = sessionSysPromptTarget;
    if (!target || sessionSysPromptBusy) return;
    setSessionSysPromptBusy(true);
    setSessionSysPromptError(null);
    try {
      if (!api.isTauri()) {
        setSessionSysPromptError(tr("session.promptError.needTauri"));
        setSessionSysPromptBusy(false);
        return;
      }
      await api.sessionSetSystemPromptOverride(target.id, null);
      setSessions((list) =>
        list.map((row) =>
          row.id === target.id
            ? { ...row, systemPromptOverride: null }
            : row,
        ),
      );
      forceCloseSessionSysPromptModal();
    } catch (e) {
      const soft = presentSessionPromptSoftFail(e);
      setSessionSysPromptError(
        soft.detail.trim()
          ? `${tr(soft.messageKey)}: ${soft.detail}`
          : tr(soft.messageKey),
      );
      setSessionSysPromptBusy(false);
    }
  };

  /** Permanent delete — confirm first; leave workbench if viewing that chat. */
  const deleteSessionConfirm = (s: SessionRow) => {
    deleteSessionsConfirm([s]);
  };

  /** Bulk restore archived sessions. */
  const restoreSessions = async (rows: SessionRow[]) => {
    if (!rows.length) return;
    try {
      if (!api.isTauri()) {
        setLocalError(tr("error.needTauri"));
        return;
      }
      for (const s of rows) {
        await api.sessionSetArchived(s.id, false);
        if (s.projectId) {
          setExpandedProjects((e) => ({ ...e, [s.projectId!]: true }));
        }
      }
      await refreshSessions();
      setLocalError(null);
    } catch (e) {
      setLocalError(String(e));
    }
  };

  /**
   * Bulk-archive chats whose last update is older than `days`.
   * Skips pinned + already-archived. Preview count + GlassModal confirm
   * (never window.confirm). Empty → classified honesty toast.
   */
  const confirmArchiveOlderThan = (days: number) => {
    setCtxMenu(null);
    const plan = planArchiveOlderThan(sessions, days);
    if (!plan.confirmNeeded || plan.count === 0) {
      return;
    }
    setArchiveAgeConfirm(plan);
  };

  /** Apply a planned archive-by-age batch (GlassModal confirm). */
  const runArchiveAgePlan = async (plan: ArchiveAgePlan<SessionRow>) => {
    const rows = plan.sessions;
    if (!rows.length) {
      setArchiveAgeConfirm(null);
      return;
    }
    setArchiveAgeBusy(true);
    try {
      if (!api.isTauri()) {
        setLocalError(tr("error.needTauri"));
        return;
      }
      const openId =
        session.sessionId ?? viewingSessionIdRef.current ?? null;
      const wasViewing = !!openId && rows.some((s) => s.id === openId);
      const viewingRow = wasViewing
        ? rows.find((s) => s.id === openId) ?? null
        : null;

      const results = await Promise.allSettled(
        rows.map((s) => api.sessionSetArchived(s.id, true)),
      );
      const firstFail = results.find(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );

      await refreshSessions();

      if (wasViewing && viewingRow) {
        const proj = viewingRow.projectId
          ? projects.find((p) => p.id === viewingRow.projectId) ?? null
          : null;
        if (proj) await newChat(proj, { switchToChat: true });
        else await newChat(null, { switchToChat: true });
      }

      if (firstFail) {
        setLocalError(String(firstFail.reason));
      } else {
        setLocalError(null);
      }
      setArchiveAgeConfirm(null);
    } catch (e) {
      setLocalError(String(e));
    } finally {
      setArchiveAgeBusy(false);
    }
  };

  /**
   * Multi-select archive / restore with one confirm.
   * Sidebar select mode lists active chats → archive; restore path kept for
   * selected archived rows if that view is shown later.
   */
  const confirmBulkSetArchived = (archived: boolean) => {
    const rows = sessions.filter((s) => selectedSessionIds.has(s.id));
    if (!rows.length) return;
    const n = rows.length;
    setAppDialog({
      kind: "confirm",
      title: archived
        ? tr("sidebar.archiveSelectedTitle")
        : tr("sidebar.restoreSelectedTitle"),
      message: archived
        ? tr("sidebar.archiveSelectedConfirm", { n: String(n) })
        : tr("sidebar.restoreSelectedConfirm", { n: String(n) }),
      confirmLabel: archived
        ? tr("sidebar.archiveSelected", { n: String(n) })
        : tr("sidebar.restoreSelected", { n: String(n) }),
      onConfirm: async () => {
        try {
          if (!api.isTauri()) {
            setLocalError(tr("error.needTauri"));
            return;
          }
          const openId =
            session.sessionId ?? viewingSessionIdRef.current ?? null;
          const wasViewing =
            archived && !!openId && rows.some((s) => s.id === openId);
          const viewingRow = wasViewing
            ? rows.find((s) => s.id === openId) ?? null
            : null;

          const results = await Promise.allSettled(
            rows.map((s) => api.sessionSetArchived(s.id, archived)),
          );
          const firstFail = results.find(
            (r): r is PromiseRejectedResult => r.status === "rejected",
          );

          if (!archived) {
            for (const s of rows) {
              if (s.projectId) {
                setExpandedProjects((e) => ({
                  ...e,
                  [s.projectId!]: true,
                }));
              }
            }
          }

          await refreshSessions();
          exitSessionSelectMode();

          if (wasViewing && viewingRow) {
            const proj = viewingRow.projectId
              ? projects.find((p) => p.id === viewingRow.projectId) ?? null
              : null;
            if (proj) await newChat(proj, { switchToChat: true });
            else await newChat(null, { switchToChat: true });
          }

          if (firstFail) {
            setLocalError(String(firstFail.reason));
          } else {
            setLocalError(null);
          }
        } catch (e) {
          setLocalError(String(e));
        }
      },
    });
  };

  /** Bulk permanent delete with one confirm. */
  const deleteSessionsConfirm = (rows: SessionRow[]) => {
    setCtxMenu(null);
    if (!rows.length) return;
    const n = rows.length;
    const title =
      n === 1
        ? rows[0].title || tr("session.untitled")
        : tr("session.deleteManyTitle");
    const message =
      n === 1
        ? tr("session.deleteConfirm", {
            name: rows[0].title || tr("session.untitled"),
          })
        : tr("session.deleteManyConfirm", { n: String(n) });
    setAppDialog({
      kind: "confirm",
      title: n === 1 ? tr("session.deleteTitle") : title,
      message,
      confirmLabel: tr("session.delete"),
      danger: true,
      onConfirm: async () => {
        try {
          if (!api.isTauri()) {
            setLocalError(tr("error.needTauri"));
            return;
          }
          const openId =
            session.sessionId ?? viewingSessionIdRef.current ?? null;
          const wasViewing = !!openId && rows.some((s) => s.id === openId);
          const viewingRow = wasViewing
            ? rows.find((s) => s.id === openId)
            : null;
          const deletedIds = new Set(rows.map((s) => s.id));
          for (const s of rows) {
            await api.sessionDelete(s.id);
            messagesBySessionRef.current.delete(s.id);
            planBySessionRef.current.delete(s.id);
            clearPendingGates(s.id);
          }
          sendQueue.dropSessions(deletedIds);
          await refreshSessions();
          exitSessionSelectMode();
          if (wasViewing && viewingRow) {
            const proj = viewingRow.projectId
              ? projects.find((p) => p.id === viewingRow.projectId) ?? null
              : null;
            if (proj) await newChat(proj, { switchToChat: true });
            else await newChat(null, { switchToChat: true });
          }
          setLocalError(null);
        } catch (e) {
          setLocalError(String(e));
        }
      },
    });
  };

  /** Archive all chats under a project; exit mid-pane if current chat is among them. */
  const archiveProjectSessions = async (proj: Project) => {
    setCtxMenu(null);
    const openId = session.sessionId ?? viewingSessionIdRef.current;
    const openBelongs =
      !!openId &&
      sessions.some((s) => s.id === openId && s.projectId === proj.id);
    try {
      await api.projectArchiveSessions(proj.id);
      await refreshSessions();
      if (openBelongs) {
        await newChat(proj, { switchToChat: true });
      }
    } catch (e) {
      setLocalError(String(e));
    }
  };

  /**
   * CLI `grok -c/--continue` for a project folder: find newest agent session
   * under active GROK_HOME for that path, import if needed, open App chat.
   * Classified soft-fail (no session / no CLI / untrusted / host-only / import)
   * with empty honesty when none exist — never invents a session id.
   */
  const continueLastAgentForProject = async (proj: Project) => {
    setCtxMenu(null);
    const toastContinueSoftFail = (kind: ContinueCwdSoftFailKind, detail = "") => {
      const key = continueCwdSoftFailMessageKey(kind) as MessageKey;
      const base = tr(key);
      showToast(detail ? `${base}: ${detail}` : base, kind === "no_session" ? 4200 : 4500);
    };
    const gate = evaluateContinueCwd(
      { path: proj.path, trusted: proj.trusted },
      { isTauri: api.isTauri() },
    );
    if (!gate.ok) {
      toastContinueSoftFail(gate.kind);
      return;
    }
    try {
      const meta = await api.cliSessionContinueCwd(proj.path, {
        projectId: proj.id,
      });
      const emptyKind = classifyContinueCwdEmptyResult(meta);
      if (emptyKind) {
        const honesty = resolveContinueCwdEmptyHonesty();
        showToast(tr(honesty.messageKey as MessageKey), 4200);
        return;
      }
      const id = meta!.id;
      await refreshSessions();
      const list = (await api.sessionsList()) as SessionRow[];
      const row =
        list.map((s) => normalizeSessionRow(s)).find((s) => s.id === id) ??
        normalizeSessionRow({
          id,
          title: meta!.title || tr("session.untitled"),
          projectId: meta!.projectId ?? proj.id,
          updatedAt: meta!.updatedAt || new Date().toISOString(),
          agentSessionId: meta!.agentSessionId ?? null,
        });
      const openProj =
        (row.projectId && projects.find((p) => p.id === row.projectId)) || proj;
      setExpandedProjects((e) => ({ ...e, [openProj.id]: true }));
      await openSession(row, openProj);
    } catch (e) {
      const soft = resolveContinueCwdSoftFail(e);
      toastContinueSoftFail(soft.kind, soft.detail);
    }
  };

  const copySessionId = async (s: SessionRow) => {
    setCtxMenu(null);
    try {
      await navigator.clipboard.writeText(s.id);
    } catch {
      setLocalError(s.id);
    }
  };

  const openSessionMenu = (e: ReactMouseEvent, s: SessionRow) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ kind: "session", id: s.id, x: e.clientX, y: e.clientY });
  };

  // Stable refs so memoized SidebarSessionRow does not re-render on App stream ticks.
  const pinSessionRef = useRef(pinSession);
  pinSessionRef.current = pinSession;
  const archiveSessionRef = useRef(archiveSession);
  archiveSessionRef.current = archiveSession;
  const openSessionMenuRef = useRef(openSessionMenu);
  openSessionMenuRef.current = openSessionMenu;
  const persistSessionTitleRef = useRef(persistSessionTitle);
  persistSessionTitleRef.current = persistSessionTitle;

  const resolveSidebarSession = useCallback(
    (partial: { id: string }): SessionRow =>
      sessionsRef.current.find((x) => x.id === partial.id) ??
      (partial as SessionRow),
    [],
  );

  const onSidebarSessionOpen = useCallback(
    (s: { id: string }) => {
      void openSessionRef.current(resolveSidebarSession(s));
    },
    [resolveSidebarSession],
  );

  const onSidebarSessionContextMenu = useCallback(
    (e: ReactMouseEvent, s: { id: string }) => {
      openSessionMenuRef.current(e, resolveSidebarSession(s));
    },
    [resolveSidebarSession],
  );

  const onSidebarSessionPin = useCallback(
    (s: { id: string; pinned?: boolean }) => {
      const full = resolveSidebarSession(s);
      void pinSessionRef.current(full, !full.pinned);
    },
    [resolveSidebarSession],
  );

  const onSidebarSessionArchive = useCallback(
    (s: { id: string; archived?: boolean }) => {
      const full = resolveSidebarSession(s);
      void archiveSessionRef.current(full, !full.archived);
    },
    [resolveSidebarSession],
  );

  const onSidebarSessionMenu = useCallback(
    (e: ReactMouseEvent, s: { id: string }) => {
      openSessionMenuRef.current(e, resolveSidebarSession(s));
    },
    [resolveSidebarSession],
  );

  const onSidebarSessionRename = useCallback(
    (s: { id: string }, title: string) => {
      void persistSessionTitleRef.current(resolveSidebarSession(s), title);
    },
    [resolveSidebarSession],
  );

  const sidebarSessionLabels = useMemo<SidebarSessionRowLabels>(
    () => ({
      unreadAria: tr("session.unreadAria"),
      planPendingAria: tr("session.planPendingAria"),
      pinned: tr("session.pinned"),
      muted: tr("session.muted"),
      noteAria: tr("session.noteAria"),
      automationsTag: tr("automations.msgTag"),
      working: tr("sidebar.sessionWorking"),
      pin: tr("session.pin"),
      unpin: tr("session.unpin"),
      archive: tr("sidebar.archive"),
      unarchive: tr("sidebar.unarchive"),
      menu: tr("sidebar.menu"),
      untitled: tr("session.untitled"),
      renameLabel: tr("session.renamePrompt"),
      renamePlaceholder: tr("session.renamePlaceholder"),
    }),
    [tr],
  );

  const handleToggleSessionMute = useCallback((sessionId: string) => {
    toggleSessionMute(sessionId);
    setMutedSessionIds(loadMutedSessionIds());
  }, []);

  const applyClearAllSessionUnread = useCallback(() => {
    clearAllSessionUnread();
    manualUnreadHoldIdsRef.current.clear();
    setUnreadSessionIds(loadUnreadSessionIds());
  }, []);

  const handleClearAllSessionUnread = useCallback(() => {
    const n = unreadSessionIds.size;
    if (n <= 0) {
      return;
    }
    if (shouldConfirmClearAllUnread(n)) {
      setAppDialog({
        kind: "confirm",
        title: tr("session.clearAllUnreadTitle"),
        message: tr("session.clearAllUnreadBody", { n: String(n) }),
        confirmLabel: tr("session.clearAllUnreadAction"),
        onConfirm: () => {
          applyClearAllSessionUnread();
        },
      });
      return;
    }
    applyClearAllSessionUnread();
  }, [unreadSessionIds.size, tr, applyClearAllSessionUnread]);

  const applyClearAllSessionMutes = useCallback(() => {
    clearAllSessionMutes();
    setMutedSessionIds(loadMutedSessionIds());
  }, []);

  const handleClearAllSessionMutes = useCallback(() => {
    const n = mutedSessionIds.size;
    if (n <= 0) {
      return;
    }
    if (shouldConfirmClearAllMutes(n)) {
      setAppDialog({
        kind: "confirm",
        title: tr("session.clearAllMutesTitle"),
        message: tr("session.clearAllMutesBody", { n: String(n) }),
        confirmLabel: tr("session.clearAllMutesAction"),
        onConfirm: () => {
          applyClearAllSessionMutes();
        },
      });
      return;
    }
    applyClearAllSessionMutes();
  }, [mutedSessionIds.size, tr, applyClearAllSessionMutes]);

  const handleClearSessionUnread = useCallback(
    (sessionId: string) => {
      // Explicit "mark as read" also drops any manual hold.
      manualUnreadHoldIdsRef.current.delete(sessionId);
      applyClearSessionUnread(sessionId);
    },
    [applyClearSessionUnread],
  );

  const handleMarkSessionUnread = useCallback(
    (sessionId: string) => {
      applyMarkSessionUnread(sessionId);
    },
    [applyMarkSessionUnread],
  );

  // Binding a session while the workbench is in front clears its unread
  // (sidebar + dock/tray badge + pet done-bubble). Hidden / unfocused
  // windows are not a read — the bubble stays until they click it or
  // actually view this chat with the window focused.
  useEffect(() => {
    if (!session.sessionId) return;
    manualUnreadHoldIdsRef.current.delete(session.sessionId);
    if (!isWorkbenchForeground()) return;
    applyClearSessionUnread(session.sessionId);
  }, [session.sessionId, applyClearSessionUnread]);

  // Dock/taskbar or OS focus while already on a finished chat: clear that
  // session's unread so the badge and pet bubble drop without re-clicking.
  useEffect(() => {
    const clearViewingIfPresent = () => {
      const id = viewingSessionIdRef.current;
      if (!id) return;
      // Keep manual "mark as unread" until the user leaves this thread.
      if (manualUnreadHoldIdsRef.current.has(id)) return;
      if (!isWorkbenchForeground()) return;
      applyClearSessionUnread(id);
    };
    const onVis = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "visible"
      ) {
        clearViewingIfPresent();
      }
    };
    window.addEventListener("focus", clearViewingIfPresent);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", clearViewingIfPresent);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [applyClearSessionUnread]);

  const openProjectMenu = (e: ReactMouseEvent, proj: Project) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ kind: "project", id: proj.id, x: e.clientX, y: e.clientY });
  };

  const agentDashboardRows = useMemo(
    () =>
      collectAgentDashboardRows({
        sessions,
        projects: projects.map((p) => ({
          id: p.id,
          name: p.name,
          path: p.path,
        })),
        liveMap,
        currentSessionId: session.sessionId,
        untitledLabel: tr("session.untitled"),
        generalWorkspacePath,
        unboundProjectLabel: tr("sidebar.otherSessions"),
      }),
    [
      sessions,
      projects,
      liveMap,
      session.sessionId,
      tr,
      generalWorkspacePath,
    ],
  );
  const sessionTaskBoard = useMemo(
    () =>
      buildTaskBoard({
        sessions,
        projects: projects.map((p) => ({
          id: p.id,
          name: p.name,
          path: p.path,
        })),
        liveMap,
        currentSessionId: session.sessionId,
        includeArchived: taskBoardIncludeArchived,
        untitledLabel: tr("session.untitled"),
        generalWorkspacePath,
        unboundProjectLabel: tr("sidebar.otherSessions"),
      }),
    [
      sessions,
      projects,
      liveMap,
      session.sessionId,
      taskBoardIncludeArchived,
      tr,
      generalWorkspacePath,
    ],
  );
  /** Honesty counts for the Ops hub (liveMap-backed; never invents work). */
  const opsEntryCounts = useMemo((): OpsEntryCounts => {
    return {
      busySessionCount: countBusyDashboardRows(agentDashboardRows),
      sessionCount: sessions.length,
      hasActiveSession: !!session.sessionId,
      // Tool-row scan is expensive here; leave unknown so meta does not invent idle.
      tasksRunningCount: null,
    };
  }, [agentDashboardRows, sessions.length, session.sessionId]);
  const connPill = useMemo(
    () => connPillForState(session.state, connecting),
    [session.state, connecting],
  );
  const connPillCanRetry = connPillRetryable(session.state, connecting);

  const isPlaceholderTitle = useCallback(
    (title: string | undefined | null) => {
      const t = (title || "").trim();
      if (!t) return true;
      // Keep in sync with src-tauri/src/session_title.rs PLACEHOLDERS so
      // auto-title still runs after locale switches / tray copy.
      const placeholders = [
        tr("session.new"),
        tr("session.placeholderTitle"),
        tr("session.untitled"),
        "New chat",
        "New conversation",
        "新会话",
        "新对话",
        "新對話",
        "新建会话",
        "Untitled",
        "未命名",
      ];
      return placeholders.some((p) => p.toLowerCase() === t.toLowerCase());
    },
    [tr],
  );

  ensureConnectedRef.current = () => ensureConnected();

  const attachLabels = useMemo(
    () => ({
      open: tr("attach.open"),
      reveal: revealInOsLabel(tr, platform),
      copyPath: tr("attach.copyPath"),
      copyImage: tr("attach.copyImage"),
      addToComposer: tr("attach.addToComposer"),
      remove: tr("composer.attachRemove"),
      viewImage: tr("image.view"),
      previewBroken: tr("attach.preview.broken"),
      previewMissing: tr("attach.preview.missing"),
      previewPending: tr("attach.preview.pending"),
    }),
    [tr, platform],
  );

  const structuredOutputLabels = useMemo(
    () => ({
      title: tr("message.structuredJson"),
      badge: tr("message.structuredJsonBadge"),
      copy: tr("message.structuredJsonCopy"),
      copied: tr("message.copied"),
      export: tr("message.structuredJsonExport"),
      invalidJson: tr("message.structuredJsonInvalid"),
      empty: tr("message.structuredJsonEmpty"),
      valid: tr("message.structuredJsonValid"),
      schemaMismatch: tr("message.structuredJsonSchemaMismatch"),
      missingRequired: tr("message.structuredJsonMissingRequired"),
      streaming: tr("message.structuredJsonStreaming"),
      partial: tr("message.structuredJsonPartial"),
      partialKeys: tr("message.structuredJsonPartialKeys"),
      timeline: tr("message.structuredJsonTimeline"),
      usage: tr("message.structuredJsonUsage"),
      usageIo: tr("message.structuredJsonUsageIo"),
      usageTotal: tr("message.structuredJsonUsageTotal"),
    }),
    [tr],
  );

  const structuredOutputUsage = useMemo(() => {
    const u = contextUsage.knownUsage;
    if (!u) return null;
    return {
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      totalTokens: u.totalTokens,
    };
  }, [
    contextUsage.knownUsage?.inputTokens,
    contextUsage.knownUsage?.outputTokens,
    contextUsage.knownUsage?.totalTokens,
  ]);

  const lastUserMessageId = transcriptMeta.lastUserId;

  // Streaming perf mode — shrink browse overscan on integrated GPU Retina.
  // Do not zero the flag in the update cleanup (that flashes 1→0→1).
  // Turn it off after paint so it does not restyle in the same frame as settle.
  useEffect(() => {
    const on =
      session.state === "streaming" ||
      session.state === "awaiting_permission" ||
      transcriptMeta.hasStreamingAssistant;
    if (on) {
      document.documentElement.dataset.streamPerf = "1";
      return;
    }
    const id = window.setTimeout(() => {
      document.documentElement.dataset.streamPerf = "0";
    }, 80);
    return () => window.clearTimeout(id);
  }, [session.state, transcriptMeta.hasStreamingAssistant]);
  useEffect(() => {
    return () => {
      document.documentElement.dataset.streamPerf = "0";
    };
  }, []);

  const canEditLastUser =
    !!lastUserMessageId &&
    canSend(session.state) &&
    !connecting &&
    session.state !== "streaming" &&
    session.state !== "awaiting_permission";

  /** Idle-ish: allow fork / rewind from transcript (not mid-turn). */
  const canRewindSession =
    canSend(session.state) &&
    !connecting &&
    !editSubmitting &&
    !rewindBusy;

  const {
    executeSend,
    send,
    clearComposerAfterSubmit,
    requestClearComposerDraft,
  } = useComposerSend({
    tr,
    session,
    sessions,
    activeProject,
    connecting,
    goalMode,
    attachments,
    chatAttachments,
    quotes,
    editSubmitting,
    editingUserMessageId,
    isPlaceholderTitle,
    isSecondaryWindowRef,
    viewingSessionIdRef,
    composerInputRef,
    liveHostRef,
    messagesBySessionRef,
    sessionJsonSchemaRef,
    automationSetupDraftRef,
    automationSetupSessionsRef,
    sendInFlightRef,
    sendInFlightBySessionRef,
    sendEpochRef,
    sendEpochBySessionRef,
    turnStartedAtBySessionRef,
    effortApplyRef,
    promptHistoryIndexRef,
    quotesRef,
    attachmentsRef,
    sendQueueRef,
    showToastRef,
    sendRef,
    executeSendFromQueueRef,
    executeSendLatestRef,
    claimSendForSession,
    currentViewFocus,
    patchSessionMessages,
    ensureConnected,
    getDraft,
    requestComposerFocus,
    openWorkflowsSettings,
    applySessionTitle,
    restartTurnClock,
    syncViewedTurnClock,
    setLocalError,
    setSession,
    setMessages,
    setLiveHost,
    setLiveMap,
    setDraft,
    setQuotes,
    setAttachments,
    setChatAttachments,
    setAttachChatOpen,
    setSlashQuery,
    setPromptHistoryIndex,
    setPromptHistoryOpen,
    setPromptHistoryFilter,
    setPromptHistoryActive,
    setPromptHistoryFocusFilter,
    setPromptHistoryScope,
    setEditingUserMessageId,
    setEditAttachments,
    setRetryStatus,
    setRecentPromptHistory,
    setAppDialog,
  });
  voiceDictationAutoSendRef.current = voiceDictationAutoSend;


  const queuePreviewLabels = useMemo(
    () => ({
      filesCount: (n: number) =>
        tr("composer.queueFilesCount", { n: String(n) }),
      chatsCount: (n: number) =>
        tr("composer.queueChatsCount", { n: String(n) }),
      empty: tr("composer.queueEmptyPreview"),
    }),
    [tr],
  );

  const reportAttachError = useCallback(
    (
      err: unknown,
      source: Parameters<typeof resolveAttachError>[1] = "other",
    ) => {
      const resolved = resolveAttachError(err, source);
      const msg = formatAttachErrorMessage(resolved, tr);
      if (msg) setLocalError(msg);
    },
    [tr],
  );

  const addAttachmentsFromPaths = useCallback(
    async (paths: string[]) => {
      if (!paths.length) {
        setLocalError(tr("attach.droppedNone"));
        return;
      }
      // While inline-editing a sent message, drops target the edit form — not the composer.
      const intoEdit = !!editingUserMessageIdRef.current;
      const mergeInto = intoEdit ? setEditAttachments : setAttachments;
      try {
        if (!api.isTauri()) {
          mergeInto((prev) =>
            mergeAttachments(
              prev,
              paths.map((p) => ({
                path: p,
                name: p.split(/[/\\]/).pop() || p,
                isDir: false,
              })),
            ),
          );
          return;
        }
        const classified = await api.pathsClassify(paths);
        // Accept all formats (images, docs, …). Keep entries even if exists is false
        // so transient sandbox / iCloud paths still show; open may fail later.
        const next = classified.map((c) => ({
          path: c.path,
          name: c.name,
          isDir: c.isDir,
        }));
        if (!next.length) {
          setLocalError(tr("attach.droppedNone"));
          return;
        }
        mergeInto((prev) => mergeAttachments(prev, next));
        setLocalError(null);
      } catch (e) {
        reportAttachError(e, "drop");
      }
    },
    [reportAttachError, tr],
  );

  /** Web File list (paste / HTML5 drop) → absolute paths for agent `@path`. */
  const addAttachmentsFromFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const withPath: string[] = [];
      const withoutPath: File[] = [];
      const seenPath = new Set<string>();
      const seenBlob = new Set<string>();
      for (const f of files) {
        if (!f) continue;
        const anyF = f as File & { path?: string };
        // WebView2 Explorer drops can report size 0 while File.path is set.
        if (f.size <= 0 && !anyF.path) continue;
        if (anyF.path) {
          if (seenPath.has(anyF.path)) continue;
          seenPath.add(anyF.path);
          withPath.push(anyF.path);
        } else {
          // Same paste often yields two File wrappers (files + items); keep one.
          const key = clipboardFileKey(f);
          if (seenBlob.has(key)) continue;
          seenBlob.add(key);
          withoutPath.push(f);
        }
      }
      if (withPath.length) {
        await addAttachmentsFromPaths(withPath);
      }
      if (!withoutPath.length) return;
      if (!api.isTauri()) {
        const host = resolveHostOnlyAttach("paste");
        const msg = formatAttachErrorMessage(host, tr);
        if (msg) setLocalError(msg);
        return;
      }
      const intoEdit = !!editingUserMessageIdRef.current;
      const mergeInto = intoEdit ? setEditAttachments : setAttachments;
      try {
        let saved = 0;
        for (const f of withoutPath) {
          if (isAttachPayloadTooLarge(f.size)) {
            reportAttachError(
              { code: "too_large", message: "attachment too large (max 40 MiB)" },
              "paste",
            );
            return;
          }
          const buf = await f.arrayBuffer();
          const bytes = new Uint8Array(buf);
          if (!bytes.length) continue;
          // Chunked base64 to avoid call-stack limits on large pastes
          let binary = "";
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode(
              ...bytes.subarray(i, Math.min(i + chunk, bytes.length)),
            );
          }
          const b64 = btoa(binary);
          const name =
            f.name && f.name !== "image.png" && f.name !== "blob"
              ? f.name
              : f.type?.startsWith("image/")
                ? `paste.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`
                : f.name || "paste.bin";
          const entry = await api.saveTempAttachment(b64, name, f.type || null);
          saved += 1;
          mergeInto((prev) =>
            mergeAttachments(prev, [
              {
                path: entry.path,
                name: entry.name,
                isDir: entry.isDir,
              },
            ]),
          );
        }
        if (!saved) {
          // All zero-byte after read — honest empty, not a fake success.
          reportAttachError(
            { code: "empty", message: "empty attachment payload" },
            "paste",
          );
          return;
        }
        setLocalError(null);
      } catch (e) {
        reportAttachError(e, "paste");
      }
    },
    [addAttachmentsFromPaths, reportAttachError, tr],
  );

  /**
   * Native OS clipboard image (arboard) when WebView paste has no File objects.
   * Used for macOS screenshots / system image clipboard.
   */
  const pasteMediaFromNativeClipboard = useCallback(
    async (opts?: { expectMedia?: boolean }) => {
      if (!api.isTauri()) {
        if (opts?.expectMedia) {
          const host = resolveHostOnlyAttach("native_clipboard");
          const msg = formatAttachErrorMessage(host, tr);
          if (msg) setLocalError(msg);
        }
        return;
      }
      try {
        const entry = await api.clipboardPasteImage();
        if (!entry?.path) {
          const empty = resolveNativeClipboardEmpty(opts);
          const msg = formatAttachErrorMessage(empty, tr);
          if (msg) setLocalError(msg);
          return;
        }
        await addAttachmentsFromPaths([entry.path]);
        setLocalError(null);
      } catch (e) {
        reportAttachError(e, "native_clipboard");
      }
    },
    [addAttachmentsFromPaths, reportAttachError, tr],
  );

  const closeComposerMenu = useCallback(() => {
    const live = liveSlashRef.current;
    if (live.present) {
      slashDismissedSigRef.current = `${live.start}:${live.query}`;
    }
    setShowComposerPlus(false);
    setSlashQuery(null);
    setSlashKindFilter("all");
    const cleared = { present: false, query: "", start: 0, end: 0 };
    setLiveSlash(cleared);
    liveSlashRef.current = cleared;
  }, []);

  /**
   * Clear kind chip + typed slash query (keeps bare `/` so the palette stays
   * open). Never uses window.confirm.
   */
  const clearSlashFilters = useCallback(() => {
    setSlashKindFilter("all");
    const live = liveSlashRef.current;
    if (live.present && live.query) {
      // Re-detect on current stored draft so ranges never come from a stale
      // DOM plain / collapsed coordinate space.
      setDraft((d) => {
        const range = detectSlashRangeOnStored(d);
        if (!range || !range.query) return d;
        return d.slice(0, range.start + 1) + d.slice(range.end);
      });
    }
    setSlashActiveIndex(0);
  }, []);

  /** Stable slash-query setter: skip no-op updates so filter effects don't thrash. */
  const onSlashQueryChange = useCallback(
    (q: { start: number; query: string; end: number } | null) => {
      setSlashQuery((prev) => {
        if (q == null) return prev == null ? prev : null;
        if (
          prev &&
          prev.start === q.start &&
          prev.query === q.query &&
          prev.end === q.end
        ) {
          return prev;
        }
        return q;
      });
    },
    [],
  );

  /**
   * Composer right-click menu (Paste + Command panel). Same ContextMenu
   * baseline as attachment cards; native menu is already suppressed.
   */
  const [composerCtxMenu, setComposerCtxMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const onComposerContextMenu = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setComposerCtxMenu({ x: e.clientX, y: e.clientY });
  }, []);

  /**
   * Paste into the composer from the OS clipboard (context-menu item).
   * Text → append to draft; image → attach as attachment; empty/unusable →
   * honest toast (never a silent no-op that leaves a native paste affordance).
   */
  const pasteIntoComposer = useCallback(() => {
    void (async () => {
      // 1. Text on the clipboard.
      let text = "";
      try {
        text = ((await navigator.clipboard.readText()) ?? "").trim();
      } catch {
        /* not readable as text — fall through to media */
      }
      // Bare file:// URL(s) from copying a file in the OS — not useful as
      // draft text; the real payload is handled by the media paths below.
      const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const fileUrlOnly =
        lines.length > 0 && lines.every((l) => /^file:\/\//i.test(l));
      if (text && !fileUrlOnly) {
        setDraft((prev) => {
          if (!prev) return text;
          return /\s$/.test(prev) ? prev + text : prev + "\n\n" + text;
        });
        requestComposerFocus();
        return;
      }
      // 1b. Explorer/Finder file list (native paths — do not arrayBuffer dumps).
      if (api.isTauri()) {
        const native = await api.clipboardFilePaths();
        if (native.length) {
          await addAttachmentsFromPaths(native);
          return;
        }
      }
      // 2. Image via the async Clipboard API (Chromium / some WKWebView).
      const files = await readClipboardMediaFiles();
      if (files.length) {
        await addAttachmentsFromFiles(files);
        return;
      }
      // 3. Native clipboard image (arboard — macOS screenshots etc.).
      if (api.isTauri()) {
        try {
          const entry = await api.clipboardPasteImage();
          if (entry?.path) {
            await addAttachmentsFromPaths([entry.path]);
            return;
          }
        } catch {
          /* native clipboard read failed */
        }
      }
      // 4. Nothing usable — honest feedback instead of a silent no-op.
      const msg = tr("chat.selectionPasteEmpty");
      setToast(msg);
      window.setTimeout(
        () => setToast((cur) => (cur === msg ? null : cur)),
        2200,
      );
    })();
  }, [
    setDraft,
    requestComposerFocus,
    addAttachmentsFromFiles,
    addAttachmentsFromPaths,
    tr,
    setToast,
  ]);

  const composerCtxItems = useMemo<ContextMenuItem[]>(
    () => [
      {
        id: "composer-paste",
        label: tr("chat.selectionPaste"),
        icon: <IconClipboardList size={16} />,
        onClick: pasteIntoComposer,
      },
      {
        id: "composer-command-panel",
        label: tr("composer.commandPanel"),
        icon: <IconPlus size={16} />,
        onClick: () => {
          setComposerCtxMenu(null);
          closeComposerMenu();
          setShowComposerPlus(true);
        },
      },
    ],
    [tr, pasteIntoComposer, closeComposerMenu, setShowComposerPlus],
  );

  const pickComposerFiles = useCallback(async () => {
    closeComposerMenu();
    if (isMirrorClient()) {
      setToast(tr("mirror.desktopOnly"));
      window.setTimeout(() => setToast(null), 3200);
      return;
    }
    if (!api.isTauri()) {
      const host = resolveHostOnlyAttach("pick");
      const msg = formatAttachErrorMessage(host, tr);
      if (msg) setLocalError(msg);
      return;
    }
    try {
      const paths = await api.pickAttachFiles();
      if (!paths.length) {
        // Cancelled — silent (never invent “no files” for dismiss).
        return;
      }
      await addAttachmentsFromPaths(paths);
      setLocalError(null);
    } catch (e) {
      const resolved = resolveAttachError(e, "pick");
      if (resolved.kind === "unsupported") {
        setToast(tr("mirror.unsupported"));
        window.setTimeout(() => setToast(null), 3200);
        return;
      }
      if (resolved.silent) return;
      const msg = formatAttachErrorMessage(resolved, tr);
      if (msg) setLocalError(msg);
    }
  }, [addAttachmentsFromPaths, closeComposerMenu, tr]);

  const addProjectsFromPaths = useCallback(
    async (paths: string[]) => {
      if (!paths.length || !api.isTauri()) return;
      try {
        const classified = await api.pathsClassify(paths);
        const dirs = classified.filter((c) => c.exists && c.isDir);
        if (!dirs.length) {
          setLocalError(tr("composer.dropProjectFilesOnly"));
          return;
        }
        let last: Project | null = null;
        const addedIds: string[] = [];
        for (const d of dirs) {
          last = (await api.projectAdd(d.path, false)) as Project;
          addedIds.push(last.id);
        }
        const list = mapProjectsList((await api.projectsList()) as Project[]);
        setProjects(list);
        projectSpaces.assignNewProjects(addedIds);
        if (last) {
          setActiveProject(list.find((p) => p.id === last!.id) ?? last);
          setExpandedProjects((e) => ({ ...e, [last!.id]: true }));
          setLocalError(null);
        }
      } catch (e) {
        setLocalError(String(e));
      }
    },
    [tr],
  );

  /**
   * Hit-test CSS client point against the live sidebar box.
   * Only the real left rail is "sidebar" (add project); rest of workbench is attach.
   */
  const hitDragZone = useCallback(
    (clientX: number, clientY: number): "sidebar" | "main" => {
      const collapsed = layoutRef.current.sidebarCollapsed;
      if (collapsed) return "main";
      const el = querySidebarEl();
      if (!el) return "main";
      return hitDragZoneFromRects(
        clientX,
        clientY,
        el.getBoundingClientRect(),
        false,
      );
    },
    [],
  );

  // Tauri OS file drag-drop (full absolute paths)
  useEffect(() => {
    if (!api.isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const webview = getCurrentWebview();
        const win = getCurrentWindow();
        const factor = await win.scaleFactor();

        unlisten = await webview.onDragDropEvent((event) => {
          if (cancelled) return;
          const payload = event.payload;
          if (payload.type === "enter" || payload.type === "drop") {
            if ("paths" in payload && payload.paths?.length) {
              dragPathsRef.current = payload.paths;
            }
          }
          if (payload.type === "leave") {
            setDragZone(null);
            dragPathsRef.current = [];
            return;
          }
          if (payload.type === "enter" || payload.type === "over") {
            // macOS: coords are already view points; win: physical → / factor
            const { x, y } = toClientDragPoint(
              payload.position,
              factor,
              platform,
            );
            setDragZone(hitDragZone(x, y));
            return;
          }
          if (payload.type === "drop") {
            const { x, y } = toClientDragPoint(
              payload.position,
              factor,
              platform,
            );
            const zone = hitDragZone(x, y);
            const paths = payload.paths?.length
              ? payload.paths
              : dragPathsRef.current;
            setDragZone(null);
            dragPathsRef.current = [];
            lastNativeDropAtRef.current = Date.now();
            if (!paths.length) {
              return;
            }
            if (zone === "sidebar") {
              void addProjectsFromPaths(paths);
            } else {
              // All file types (images, pdf, …) attach in main zone
              void addAttachmentsFromPaths(paths);
            }
          }
        });
      } catch {
        /* webview API unavailable */
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [
    addAttachmentsFromPaths,
    addProjectsFromPaths,
    hitDragZone,
    platform,
  ]);

  // HTML5 fallback. Windows sets dragDropEnabled:false so WebView2 actually
  // delivers File blobs (Tauri's native handler otherwise swallows Explorer
  // drops). Capture phase so contenteditable cannot cancel the drop.
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) {
        return;
      }
      e.preventDefault();
      html5DragDepthRef.current += 1;
      setDragZone(hitDragZone(e.clientX, e.clientY));
    };
    const onDragOver = (e: DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) {
        return;
      }
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setDragZone(hitDragZone(e.clientX, e.clientY));
    };
    const onDragLeave = (e: DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) {
        return;
      }
      html5DragDepthRef.current = Math.max(0, html5DragDepthRef.current - 1);
      if (html5DragDepthRef.current === 0) setDragZone(null);
    };
    const onDrop = (e: DragEvent) => {
      html5DragDepthRef.current = 0;
      setDragZone(null);
      if (!isFileDrag(e.dataTransfer)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (shouldSkipHtml5AfterNative(lastNativeDropAtRef.current, Date.now())) {
        return;
      }
      const files = e.dataTransfer?.files?.length
        ? Array.from(e.dataTransfer.files)
        : [];
      const paths = pathsFromDroppedFiles(files);
      const zone = hitDragZone(e.clientX, e.clientY);
      if (paths.length) {
        if (zone === "sidebar") void addProjectsFromPaths(paths);
        else void addAttachmentsFromPaths(paths);
        return;
      }
      // Path-less File list (Windows Explorer after dragDropEnabled:false,
      // or an image dragged from another app).
      if (zone !== "sidebar" && files.length) {
        void addAttachmentsFromFiles(files);
      } else if (!files.length) {
        setLocalError(tr("attach.droppedNone"));
      }
    };
    const opts: AddEventListenerOptions = { capture: true };
    window.addEventListener("dragenter", onDragEnter, opts);
    window.addEventListener("dragover", onDragOver, opts);
    window.addEventListener("dragleave", onDragLeave, opts);
    window.addEventListener("drop", onDrop, opts);
    return () => {
      window.removeEventListener("dragenter", onDragEnter, opts);
      window.removeEventListener("dragover", onDragOver, opts);
      window.removeEventListener("dragleave", onDragLeave, opts);
      window.removeEventListener("drop", onDrop, opts);
    };
  }, [
    addAttachmentsFromFiles,
    addAttachmentsFromPaths,
    addProjectsFromPaths,
    hitDragZone,
    tr,
  ]);

  /** Programmatic draft / layout changes: recompute height after paint. */
  const syncComposerHeight = useCallback(() => {
    // Double rAF: wait for React commit + layout after mainPane switch.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const node = composerInputRef.current;
        if (node) resizeComposerInput(node);
      });
    });
  }, []);

  /** Bumped when Extensions skill toggles change, or chat installs skills, so slash palette reloads. */
  const [skillsReloadToken, setSkillsReloadToken] = useState(0);
  skillsReloadBumpRef.current = () => setSkillsReloadToken((n) => n + 1);

  // Refresh agent definition catalog when the active project changes.
  useEffect(() => {
    if (!api.isTauri()) return;
    let cancelled = false;
    void api
      .agentsCatalog(activeProject?.path ?? null)
      .then((cat) => {
        if (cancelled) return;
        setAgentCatalog(
          (cat.agents ?? []).map((a) => ({
            name: a.name,
            source: a.source,
          })),
        );
      })
      .catch(() => {
        /* keep previous catalog */
      });
    return () => {
      cancelled = true;
    };
  }, [activeProject?.path]);

  // Load skills catalog for slash / + palette (Grok inspect + Extensions enable).
  useEffect(() => {
    if (!api.isTauri()) return;
    let cancelled = false;
    setSkillsLoading(true);
    void api
      .skillsList(activeProject?.path ?? null)
      .then((res) => {
        if (cancelled) return;
        const err = (res.error ?? "").trim();
        setSkillsLoadError(err || null);
        setSkillInfos(
          (res.skills ?? []).map((s) => ({
            name: s.name,
            description: s.description ?? "",
            source: s.source,
            // Host omits or defaults invocable; explicit false stays false.
            userInvocable: s.userInvocable !== false,
            enabled: s.enabled !== false,
          })),
        );
      })
      .catch((e) => {
        if (cancelled) return;
        setSkillInfos([]);
        setSkillsLoadError(String(e));
      })
      .finally(() => {
        if (!cancelled) setSkillsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProject?.path, skillsReloadToken]);

  const slashCatalog = useMemo(
    () => buildSlashCatalog(skillInfos),
    [skillInfos],
  );
  const resolveSlashTitle = useCallback(
    (item: SlashItem) => {
      if (item.titleKey) {
        try {
          return tr(item.titleKey as MessageKey);
        } catch {
          /* fall through */
        }
      }
      return item.displayTitle || item.name;
    },
    [tr],
  );
  const resolveSlashDescription = useCallback(
    (item: SlashItem) => {
      if (item.descriptionKey) {
        try {
          return tr(item.descriptionKey as MessageKey);
        } catch {
          /* fall through */
        }
      }
      return item.displayDescription || "";
    },
    [tr],
  );
  /** Filter query from live editor poll only. */
  const slashFilterQuery = liveSlash.present ? liveSlash.query : "";

  /** Shared filter for + menu and `/` slash — empty query + all kind = full catalog. */
  const slashFiltered = useMemo(
    () =>
      flattenFilteredCatalog(
        slashCatalog,
        { query: slashFilterQuery, kind: slashKindFilter },
        (item) => ({
          title: resolveSlashTitle(item),
          description: resolveSlashDescription(item),
        }),
      ),
    [
      slashCatalog,
      slashFilterQuery,
      slashKindFilter,
      resolveSlashTitle,
      resolveSlashDescription,
    ],
  );
  const slashCatalogCount =
    slashCatalog.commands.length + slashCatalog.skills.length;
  const slashKindCounts = useMemo(
    () =>
      countSlashByKind([
        ...slashCatalog.commands,
        ...slashCatalog.skills,
      ]),
    [slashCatalog],
  );
  // Upload / JSON Schema live under the Add section — only when kind is All.
  const showUploadInMenu = useMemo(
    () =>
      slashKindFilter === "all" &&
      uploadMatchesQuery(slashFilterQuery, {
        title: tr("composer.addFiles"),
        hint: tr("composer.addFilesHint"),
      }),
    [slashFilterQuery, slashKindFilter, tr],
  );
  const showJsonSchemaInMenu = useMemo(
    () =>
      slashKindFilter === "all" &&
      jsonSchemaMatchesQuery(slashFilterQuery, {
        title: tr("composer.jsonSchema"),
        hint: tr("composer.jsonSchemaHint"),
      }),
    [slashFilterQuery, slashKindFilter, tr],
  );
  const showCreateVideoInMenu = useMemo(() => {
    if (slashKindFilter !== "all") return false;
    const hasImagine = slashCatalog.skills.some((s) => s.name === "imagine");
    if (!hasImagine) return false;
    return createVideoMatchesQuery(slashFilterQuery, {
      title: tr("skill.createVideo"),
      hint: tr("skill.createVideoDesc"),
    });
  }, [slashCatalog.skills, slashFilterQuery, slashKindFilter, tr]);
  const composerMenuEntries = useMemo(
    () =>
      buildComposerPlusEntries({
        showUpload: showUploadInMenu,
        showJsonSchema: showJsonSchemaInMenu,
        showCreateVideo: showCreateVideoInMenu,
        commands: slashFiltered.commands,
        skills: slashFiltered.skills,
      }),
    [
      showUploadInMenu,
      showJsonSchemaInMenu,
      showCreateVideoInMenu,
      slashFiltered.commands,
      slashFiltered.skills,
    ],
  );
  const composerMenuEntriesRef = useRef(composerMenuEntries);
  composerMenuEntriesRef.current = composerMenuEntries;

  /** + button and `/` open the same panel. */
  const composerMenuOpen = showComposerPlus || liveSlash.present;

  /**
   * rAF poll → live slash token (open palette + filter).
   * Prefer DOM serialize, fall back to draft store (Enter SoT can leave DOM
   * one frame behind; slash is end-anchored so we need a reliable string).
   */
  useEffect(() => {
    let raf = 0;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const el = composerInputRef.current;
      const detected =
        detectSlashQueryFromEditor(el) ??
        detectSlashRangeOnStored(getComposerDraft());
      let next = detected
        ? {
            present: true as const,
            query: detected.query,
            start: detected.start,
            end: detected.end,
          }
        : {
            present: false as const,
            query: "",
            start: 0,
            end: 0,
          };
      // Honor Escape dismiss until the user edits the `/token`.
      if (next.present && slashDismissedSigRef.current != null) {
        const sig = `${next.start}:${next.query}`;
        if (sig === slashDismissedSigRef.current) {
          next = { present: false, query: "", start: 0, end: 0 };
        } else {
          slashDismissedSigRef.current = null;
        }
      }
      if (!next.present && detected == null) {
        slashDismissedSigRef.current = null;
      }
      const prev = liveSlashRef.current;
      if (
        prev.present !== next.present ||
        prev.query !== next.query ||
        prev.start !== next.start ||
        prev.end !== next.end
      ) {
        liveSlashRef.current = next;
        setLiveSlash(next);
        if (next.present) {
          setSlashQuery({
            start: next.start,
            query: next.query,
            end: next.end,
          });
        } else if (!showComposerPlusRef.current) {
          setSlashQuery((q) => (q == null ? q : null));
        }
      }
      // @ file mention — suppressed while slash/plus is open.
      let atNext: {
        present: boolean;
        query: string;
        start: number;
        end: number;
      } = {
        present: false,
        query: "",
        start: 0,
        end: 0,
      };
      if (!next.present && !showComposerPlusRef.current) {
        const atDetected = detectAtQueryFromEditor(el);
        if (atDetected) {
          atNext = {
            present: true,
            query: atDetected.query,
            start: atDetected.start,
            end: atDetected.end,
          };
          if (atDismissedSigRef.current != null) {
            const sig = `${atNext.start}:${atNext.query}`;
            if (sig === atDismissedSigRef.current) {
              atNext = { present: false, query: "", start: 0, end: 0 };
            } else {
              atDismissedSigRef.current = null;
            }
          }
        } else {
          atDismissedSigRef.current = null;
        }
      }
      const prevAt = liveAtRef.current;
      if (
        prevAt.present !== atNext.present ||
        prevAt.query !== atNext.query ||
        prevAt.start !== atNext.start ||
        prevAt.end !== atNext.end
      ) {
        liveAtRef.current = atNext;
        setLiveAt(atNext);
        if (atNext.present) setAtActiveIndex(0);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  /** Pin above input card; width matches composer shell.
   * Re-anchor when filter results change height (short list must sit on input). */
  const { pos: composerPlusPos, style: composerPlusStyle } = useFloatingMenu({
    open: composerMenuOpen,
    triggerRef: composerShellRef,
    panelRef: composerPlusPanelRef,
    roots: [composerPlusTriggerRef, composerShellRef, composerInputRef],
    onClose: closeComposerMenu,
    placement: "up",
    fitContent: false,
    matchTriggerWidth: true,
    minWidth: 280,
    estHeight: 220,
    gap: 8,
    deps: [slashFilterQuery, composerMenuEntries.length],
  });

  /**
   * Open Find skills in the right Side Workbench (next to Files/Browser/Terminal).
   * Ranks host skills against the live composer draft.
   */
  const openSideSkillsPanel = useCallback(() => {
    setShowComposerPlus(false);
    setSlashQuery(null);
    setLiveSlash({ present: false, query: "", start: 0, end: 0 });
    liveSlashRef.current = { present: false, query: "", start: 0, end: 0 };
    setSideWorkbench((s) => openSideTab(s, "skills"));
    openAsidePane();
  }, [
    setShowComposerPlus,
    setSlashQuery,
    setLiveSlash,
    liveSlashRef,
    openAsidePane,
  ]);

  const atMenuOpen = liveAt.present && !composerMenuOpen;
  const closeAtMenu = useCallback(() => {
    const live = liveAtRef.current;
    if (live.present) {
      atDismissedSigRef.current = `${live.start}:${live.query}`;
    }
    const cleared = { present: false, query: "", start: 0, end: 0 };
    liveAtRef.current = cleared;
    setLiveAt(cleared);
    setAtEntries([]);
    setAtSoftFail(null);
    setAtLoading(false);
  }, []);

  const applyAtFile = useCallback(
    (entry: ComposerAtFileEntry) => {
      const live = liveAtRef.current;
      if (live.present) {
        setDraft((d) => removeAtTokenFromDraft(d, live.start, live.end));
      }
      const cleared = { present: false, query: "", start: 0, end: 0 };
      liveAtRef.current = cleared;
      setLiveAt(cleared);
      setAtEntries([]);
      setAtSoftFail(null);
      setAttachments((prev) =>
        mergeAttachments(prev, [
          {
            path: entry.path,
            name: entry.name || entry.path.split(/[/\\]/).pop() || entry.path,
            isDir: !!entry.isDir,
          },
        ]),
      );
      requestComposerFocus();
    },
    [requestComposerFocus],
  );

  // Debounced project file search for @ panel.
  useEffect(() => {
    if (!atMenuOpen) return;
    const projectPath = activeProject?.path?.trim() || "";
    if (!projectPath) {
      setAtEntries([]);
      setAtSoftFail("no_project");
      setAtLoading(false);
      return;
    }
    if (!api.isTauri()) {
      setAtEntries([]);
      setAtSoftFail("need_tauri");
      setAtLoading(false);
      return;
    }
    const gen = ++atSearchGenRef.current;
    setAtLoading(true);
    const q = liveAt.query;
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await api.projectCodebaseSearch({
            projectPath,
            query: q,
            mode: "name",
            limit: 40,
          });
          if (gen !== atSearchGenRef.current) return;
          if (res.softFail) {
            setAtSoftFail(res.softFail);
            setAtEntries([]);
          } else {
            setAtSoftFail(null);
            const hits: ComposerAtFileEntry[] = rankAtFileHits(
              (res.hits ?? []).map((h) => ({
                path: h.path,
                name: h.name,
                relativePath: h.relativePath,
                mtimeMs: h.mtimeMs,
              })),
              q,
            );
            setAtEntries(hits);
          }
        } catch (e) {
          if (gen !== atSearchGenRef.current) return;
          setAtSoftFail("host_error");
          setAtEntries([]);
        } finally {
          if (gen === atSearchGenRef.current) setAtLoading(false);
        }
      })();
    }, q.trim() ? 180 : 80);
    return () => {
      window.clearTimeout(t);
    };
  }, [atMenuOpen, liveAt.query, activeProject?.path]);

  const { pos: composerAtPos, style: composerAtStyle } = useFloatingMenu({
    open: atMenuOpen,
    triggerRef: composerShellRef,
    panelRef: atPanelRef,
    roots: [composerShellRef, composerInputRef, atPanelRef],
    onClose: closeAtMenu,
    placement: "up",
    fitContent: false,
    matchTriggerWidth: true,
    minWidth: 280,
    estHeight: 220,
    gap: 8,
    deps: [liveAt.query, atEntries.length],
  });

  const sessionPromptHistory = useMemo(
    () => collectUserPromptHistory(messages),
    [messages],
  );
  const sessionPromptHistoryEntries = useMemo(
    () => filterPromptHistory(sessionPromptHistory, promptHistoryFilter),
    [sessionPromptHistory, promptHistoryFilter],
  );
  const recentPromptHistoryEntries = useMemo(
    () =>
      filterRecentPromptHistory(recentPromptHistory, promptHistoryFilter).map(
        (e) => ({
          historyIndex: e.historyIndex,
          text: e.text,
          sessionId: e.sessionId,
          at: e.at,
        }),
      ),
    [recentPromptHistory, promptHistoryFilter],
  );
  const promptHistoryEntries =
    promptHistoryScope === "recent"
      ? recentPromptHistoryEntries
      : sessionPromptHistoryEntries;
  const promptHistoryUnfilteredCount =
    promptHistoryScope === "recent"
      ? recentPromptHistory.length
      : sessionPromptHistory.length;
  const promptHistoryEntryMeta = useMemo(() => {
    if (promptHistoryScope !== "recent") return undefined;
    return recentPromptHistoryEntries.map((e) =>
      e.at ? formatRelativeTime(e.at, locale) : "",
    );
  }, [promptHistoryScope, recentPromptHistoryEntries, locale]);

  const closePromptHistory = useCallback(() => {
    setPromptHistoryOpen(false);
    setPromptHistoryFilter("");
    setPromptHistoryActive(0);
    setPromptHistoryFocusFilter(false);
    setPromptHistoryScope("session");
    setPromptHistoryClearOpen(false);
  }, []);

  const applyPromptHistoryEntry = useCallback(
    (
      entry: PromptHistoryEntry,
      opts?: { close?: boolean; listIndex?: number; scope?: PromptHistoryScope },
    ) => {
      const scope = opts?.scope ?? promptHistoryScopeRef.current;
      if (scope === "session") {
        // Session tab: keep CLI-like browse index aligned with this chat.
        promptHistoryIndexRef.current = entry.historyIndex;
        setPromptHistoryIndex(entry.historyIndex);
      } else {
        // Recent tab is cross-session — not part of ↑/↓ session browse.
        promptHistoryIndexRef.current = null;
        setPromptHistoryIndex(null);
      }
      if (typeof opts?.listIndex === "number") {
        setPromptHistoryActive(opts.listIndex);
      }
      setDraft(entry.text);
      if (opts?.close !== false) {
        closePromptHistory();
        requestAnimationFrame(() => {
          composerInputRef.current?.focus?.();
        });
      }
    },
    [closePromptHistory],
  );

  const closePromptHistoryUnlessClearing = useCallback(() => {
    // Keep picker open while App-level clear GlassModal is up (portaled outside roots).
    if (promptHistoryClearOpen) return;
    closePromptHistory();
  }, [closePromptHistory, promptHistoryClearOpen]);

  const { pos: promptHistoryPos, style: promptHistoryStyle } = useFloatingMenu({
    open: promptHistoryOpen,
    triggerRef: composerShellRef,
    panelRef: promptHistoryPanelRef,
    roots: [composerShellRef, composerInputRef, promptHistoryPanelRef],
    onClose: closePromptHistoryUnlessClearing,
    placement: "up",
    fitContent: false,
    matchTriggerWidth: true,
    minWidth: 280,
    estHeight: 300,
    gap: 8,
    deps: [
      promptHistoryFilter,
      promptHistoryEntries.length,
      promptHistoryScope,
    ],
  });

  // Keep highlight in range when the filtered list shrinks; reset on filter/scope.
  const prevPromptHistoryFilterRef = useRef(promptHistoryFilter);
  const prevPromptHistoryScopeRef = useRef(promptHistoryScope);
  useEffect(() => {
    if (!promptHistoryOpen) return;
    if (
      prevPromptHistoryFilterRef.current !== promptHistoryFilter ||
      prevPromptHistoryScopeRef.current !== promptHistoryScope
    ) {
      prevPromptHistoryFilterRef.current = promptHistoryFilter;
      prevPromptHistoryScopeRef.current = promptHistoryScope;
      setPromptHistoryActive(0);
      return;
    }
    setPromptHistoryActive((i) => {
      if (promptHistoryEntries.length === 0) return 0;
      return i >= promptHistoryEntries.length
        ? promptHistoryEntries.length - 1
        : i;
    });
  }, [
    promptHistoryEntries.length,
    promptHistoryFilter,
    promptHistoryOpen,
    promptHistoryScope,
  ]);

  // Reset highlight only when the filter *string* changes.
  const prevFilterQueryRef = useRef(slashFilterQuery);
  useEffect(() => {
    if (prevFilterQueryRef.current === slashFilterQuery) return;
    prevFilterQueryRef.current = slashFilterQuery;
    setSlashActiveIndex(0);
  }, [slashFilterQuery]);

  // Keep highlight in range when the filtered list shrinks (no forced 0).
  useEffect(() => {
    setSlashActiveIndex((i) => {
      if (composerMenuEntries.length === 0) return 0;
      return i >= composerMenuEntries.length
        ? composerMenuEntries.length - 1
        : i;
    });
  }, [composerMenuEntries.length]);

  /** Re-run inspect list only — does not clear doctor findings. */
  const refreshMcpModal = useCallback(async () => {
    setMcpLoading(true);
    setMcpError(null);
    try {
      const res = await api.inspectMcp(activeProject?.path ?? null);
      // Host list only — never invent placeholder servers.
      setMcpServers(res.servers ?? []);
      if (res.error) setMcpError(res.error);
    } catch (e) {
      setMcpServers([]);
      setMcpError(String(e));
    } finally {
      setMcpLoading(false);
    }
  }, [activeProject?.path]);

  const openMcpModal = useCallback(async () => {
    setShowMcpModal(true);
    // Keep prior doctor results when re-opening; only refresh inspect list.
    await refreshMcpModal();
  }, [refreshMcpModal]);

  /**
   * Run `grok mcp doctor --json [name]`. Optional name focuses one server
   * (must already exist in CLI config — host does not invent servers).
   */
  const runMcpDoctor = useCallback(
    async (
      name?: string | null,
    ): Promise<{
      report: api.McpDoctorReport | null;
      error: string | null;
    }> => {
      if (!api.isTauri()) {
        const error = tr("ext.needTauri");
        setMcpDoctorError(error);
        // Soft-fail: modal classifies host_only; no window.alert.
        return { report: null, error };
      }
      const focus = name?.trim() || null;
      setMcpDoctorFocus(focus);
      setMcpDoctorLoading(true);
      setMcpDoctorError(null);
      try {
        const report = await api.mcpDoctor(focus);
        setMcpDoctorReport(report);
        return { report, error: null };
      } catch (e) {
        const error = String(e);
        // Soft-fail CLI missing / too old / timeout is classified in the modal.
        setMcpDoctorReport(null);
        setMcpDoctorError(error);
        return { report: null, error };
      } finally {
        setMcpDoctorLoading(false);
      }
    },
    [],
  );

  const showToast = useCallback((msg: string, ms = 3200) => {
    setToast(msg);
    window.setTimeout(() => {
      setToast((cur) => (cur === msg ? null : cur));
    }, ms);
  }, []);

  voiceNotifyRef.current = showToast;
  showToastRef.current = showToast;

  const promptCreateSpace = useCallback(
    (afterCreate?: (id: string) => void) => {
      setAppDialog({
        kind: "prompt",
        title: tr("sidebar.spaces.newTitle"),
        initial: "",
        placeholder: tr("sidebar.spaces.namePlaceholder"),
        onSubmit: (value) => {
          const result = projectSpaces.create(value);
          if (!result.ok) {
            return tr(spaceErrorKey(result.error));
          }
          showToast(
            tr("sidebar.spaces.created", { name: value.trim() }),
            2400,
          );
          afterCreate?.(result.id);
        },
      });
    },
    [projectSpaces, setAppDialog, showToast, tr],
  );

  const promptRenameSpace = useCallback(
    (id: string) => {
      const space = findSpace(projectSpaces.state, id);
      if (!space) return;
      setAppDialog({
        kind: "prompt",
        title: tr("sidebar.spaces.renameTitle"),
        initial: space.name || tr("sidebar.spaces.default"),
        placeholder: tr("sidebar.spaces.namePlaceholder"),
        onSubmit: (value) => {
          const result = projectSpaces.rename(id, value);
          if (!result.ok) {
            return tr(spaceErrorKey(result.error));
          }
          showToast(
            tr("sidebar.spaces.renamed", { name: value.trim() }),
            2400,
          );
        },
      });
    },
    [projectSpaces, setAppDialog, showToast, tr],
  );

  const confirmDeleteSpace = useCallback(
    (id: string) => {
      const space = findSpace(projectSpaces.state, id);
      if (!space) return;
      const name = spaceDisplayName(space, tr("sidebar.spaces.default"));
      setAppDialog({
        kind: "confirm",
        title: tr("sidebar.spaces.deleteTitle"),
        message: tr("sidebar.spaces.deleteConfirm", { name }),
        confirmLabel: tr("sidebar.spaces.delete"),
        danger: true,
        onConfirm: () => {
          const result = projectSpaces.remove(id);
          if (!result.ok) {
            showToast(tr(spaceErrorKey(result.error)), 2800);
            return;
          }
          showToast(tr("sidebar.spaces.deleted", { name }), 2400);
        },
      });
    },
    [projectSpaces, setAppDialog, showToast, tr],
  );

  const onLiveVoiceClassifiedNotice = useCallback(
    (message: string) => {
      showToast(message, 4800);
    },
    [showToast],
  );

  const applyWallpaperChoice = (
    record: Parameters<typeof applyWallpaperChoiceBase>[0],
  ) =>
    applyWallpaperChoiceBase(record, {
      onError: (msg) => showToast(msg, 4000),
    });

  /** Open GlassModal to edit per-session sticky note (local only; never sent to agent). */
  const openSessionNote = useCallback(
    (s: SessionRow) => {
      setCtxMenu(null);
      const initial = getSessionNote(s.id);
      setSessionNoteDraft(initial);
      setSessionNoteBaseline(initial);
      setSessionNoteDiscardOpen(false);
      setSessionNoteClearOpen(false);
      setSessionNoteTarget({
        id: s.id,
        title: s.title || tr("session.untitled"),
      });
    },
    [tr],
  );

  const forceCloseSessionNoteModal = useCallback(() => {
    setSessionNoteTarget(null);
    setSessionNoteDraft("");
    setSessionNoteBaseline("");
    setSessionNoteDiscardOpen(false);
    setSessionNoteClearOpen(false);
  }, []);

  const closeSessionNoteModal = useCallback(() => {
    const v = validateSessionNote({
      draft: sessionNoteDraft,
      baseline: sessionNoteBaseline,
    });
    if (shouldConfirmSessionNoteDiscard(v)) {
      setSessionNoteDiscardOpen(true);
      return;
    }
    forceCloseSessionNoteModal();
  }, [sessionNoteDraft, sessionNoteBaseline, forceCloseSessionNoteModal]);

  const saveSessionNoteModal = useCallback(() => {
    const target = sessionNoteTarget;
    if (!target) return;
    setSessionNote(target.id, sessionNoteDraft);
    setSessionNotesMap(loadSessionNotes());
    forceCloseSessionNoteModal();
  }, [sessionNoteTarget, sessionNoteDraft, forceCloseSessionNoteModal]);

  const requestClearSessionNoteModal = useCallback(() => {
    const target = sessionNoteTarget;
    if (!target) return;
    const hadStored = Boolean(sessionNotesMap[target.id]?.trim());
    if (
      !shouldConfirmSessionNoteClear({
        draft: sessionNoteDraft,
        hadStored,
      })
    ) {
      return;
    }
    setSessionNoteClearOpen(true);
  }, [sessionNoteTarget, sessionNoteDraft, sessionNotesMap]);

  const confirmClearSessionNoteModal = useCallback(() => {
    const target = sessionNoteTarget;
    if (!target) return;
    clearSessionNote(target.id);
    setSessionNotesMap(loadSessionNotes());
    forceCloseSessionNoteModal();
  }, [sessionNoteTarget, forceCloseSessionNoteModal]);

  /** Confirm then stop the given session ids (dashboard / multi-select / stop-all). */
  const stopBusySessionsByIds = useCallback(
    (
      idsIn: string[],
      labels?: {
        title?: string;
        message?: string;
        confirmLabel?: string;
      },
    ) => {
      const ids = [...new Set(idsIn.filter(Boolean))];
      if (!ids.length) return;
      const n = ids.length;
      const runStop = async () => {
        const live = stoppableActivitySessions(
          collectActivitySessions({
            liveMap: liveMapRef.current,
            sessions,
            currentSessionId: session.sessionId,
            untitledLabel: tr("session.untitled"),
          }),
        );
        const liveIds = new Set(live.map((s) => s.sessionId));
        const toStop = ids.filter((id) => liveIds.has(id));
        const results = await Promise.allSettled(
          toStop.map((id) => api.sessionStop(id)),
        );
        let ok = 0;
        let fail = 0;
        for (let i = 0; i < results.length; i++) {
          const r = results[i]!;
          const id = toStop[i]!;
          if (r.status === "fulfilled") {
            ok += 1;
            settleStoppedSessionUi(id);
            clearPendingGates(id);
            if (
              id ===
              (viewingSessionIdRef.current || liveHostRef.current.sessionId)
            ) {
              setAskUser(null);
              setPerm(null);
            }
          } else {
            fail += 1;
          }
        }
        // Honest outcome toast: done / partial / all-failed (never silent fail).
        const outcome = stopAllResultToast(ok, fail);
        if (outcome.kind === "done") {
          showToast(tr(outcome.messageKey as MessageKey, outcome.vars), 3200);
        } else if (outcome.kind === "partial") {
          showToast(tr(outcome.messageKey as MessageKey, outcome.vars), 4000);
        } else if (outcome.kind === "all_failed") {
          showToast(tr(outcome.messageKey as MessageKey, outcome.vars), 4000);
        }
      };
      if (loadStopAllSkipConfirmPref()) {
        void runStop();
        return;
      }
      setAppDialog({
        kind: "confirm",
        title: labels?.title ?? tr("tasks.activity.stopAllTitle"),
        message:
          labels?.message ??
          tr("tasks.activity.stopAllConfirm", { n: String(n) }),
        confirmLabel:
          labels?.confirmLabel ?? tr("tasks.activity.stopAll"),
        danger: true,
        onConfirm: () => {
          void runStop();
        },
      });
    },
    [
      clearPendingGates,
      settleStoppedSessionUi,
      sessions,
      session.sessionId,
      showToast,
      tr,
    ],
  );

  /**
   * Global Stop-all (Tasks / dashboard): every stoppable busy **session**
   * app-wide via Host sessionStop. Distinct from:
   * - composer / Escape Stop → current chat only
   * - per-tool kill → not available over ACP
   * Surface selects confirm copy; action scope is always app busy sessions.
   */
  const stopAllBusySessions = useCallback(
    (surface: StopAllSurface = "tasks") => {
      const rows = stoppableActivitySessions(
        collectActivitySessions({
          liveMap: liveMapRef.current,
          sessions,
          currentSessionId: session.sessionId,
          untitledLabel: tr("session.untitled"),
        }),
      );
      const resolved = resolveStopTargets({
        scope: "all_busy",
        currentSessionId: session.sessionId,
        busySessionIds: rows.map((r) => r.sessionId),
      });
      const plan = planStopAllBusySessions(resolved);
      if (plan.kind === "empty") {
        showToast(tr(stopAllEmptyMessageKey() as MessageKey), 2400);
        return;
      }
      const keys = stopAllDialogKeys(surface);
      stopBusySessionsByIds(plan.sessionIds, {
        title: tr(keys.titleKey as MessageKey),
        message: tr(keys.messageKey as MessageKey, {
          n: String(plan.count),
        }),
        confirmLabel: tr(keys.confirmKey as MessageKey),
      });
    },
    [
      sessions,
      session.sessionId,
      stopBusySessionsByIds,
      showToast,
      tr,
    ],
  );

  /**
   * Open prompt history picker (Build `/history` + cross-session recent).
   * @param focusFilter — true for slash `/history` (search box); false for empty ↑.
   * @param seedDraft — fill composer with the active row (empty ↑, session tab).
   */
  const openPromptHistory = useCallback(
    (opts?: { focusFilter?: boolean; seedDraft?: boolean }) => {
      const history = collectUserPromptHistory(messagesRef.current);
      const recent = loadRecentPromptHistory();
      setRecentPromptHistory(recent);
      if (history.length === 0 && recent.length === 0) {
        showToast(tr("slash.historyEmpty"), 2400);
        return;
      }
      // Don't stack with slash/plus menu.
      setShowComposerPlus(false);
      setSlashQuery(null);
      setLiveSlash({ present: false, query: "", start: 0, end: 0 });
      liveSlashRef.current = { present: false, query: "", start: 0, end: 0 };

      // Prefer this chat; fall back to recent when the session has no prompts yet.
      const initialScope: PromptHistoryScope =
        history.length > 0 ? "session" : "recent";
      setPromptHistoryScope(initialScope);
      setPromptHistoryFilter("");
      setPromptHistoryActive(0);
      setPromptHistoryFocusFilter(opts?.focusFilter === true);
      setPromptHistoryOpen(true);
      // Empty-↑ browse only seeds from current-session history (Build-aligned).
      if (opts?.seedDraft !== false && history.length > 0) {
        promptHistoryIndexRef.current = 0;
        setPromptHistoryIndex(0);
        setDraft(history[0] ?? "");
      }
    },
    [showToast, tr],
  );

  const writePlanForViewing = useCallback((next: PlanState) => {
    const sid = viewingSessionIdRef.current;
    if (sid) {
      planBySessionRef.current.set(sid, next);
      markPlanPendingBadge(sid, next);
      // Soft-persist plan chrome so App restart can restore body / closed flags.
      void api.sessionPlanChromeSet(sid, planStateToStored(next)).catch(() => {
        /* private / host soft-fail */
      });
    }
    setPlan(next);
  }, [markPlanPendingBadge]);

  /** Archive a plan decision to localStorage (preview only; no secrets). */
  const archivePlanDecision = useCallback(
    (
      decision: "approved" | "abandoned" | "completed",
      snapshot: Pick<PlanState, "body" | "entries" | "title">,
      sessionId: string | null | undefined,
    ) => {
      const sid = (sessionId || "").trim();
      if (!sid) return;
      const bodyMd = planDisplayMarkdown(snapshot.body, snapshot.entries);
      if (!bodyMd.trim() && decision !== "abandoned" && decision !== "approved") {
        // Completing with no body/steps is not useful to archive.
        return;
      }
      const row = sessionsRef.current.find((s) => s.id === sid);
      const sessionTitle = row?.title?.trim() || undefined;
      const planTitle =
        snapshot.title?.trim() &&
        snapshot.title.trim() !== trRef.current("plan.ready")
          ? snapshot.title.trim()
          : undefined;
      try {
        recordPlanHistory({
          sessionId: sid,
          decision,
          title: sessionTitle || planTitle,
          bodyPreview: bodyMd,
        });
      } catch {
        /* private mode / quota */
      }
    },
    [],
  );

  const approvePlan = useCallback(async () => {
    try {
      const snap = planRef.current;
      const sid = viewingSessionIdRef.current;
      await api.sessionResolvePlan({
        decision: "approved",
        rpcId: plan.rpcId,
        // Plan chrome is per-viewed-session; the gate may sit on a demoted turn.
        sessionId: sid,
      });
      archivePlanDecision("approved", snap, sid);
      writePlanForViewing({
        ...planRef.current,
        visible: false,
        waiting: false,
        rpcId: null,
        userClosed: false,
      });
      // Product loop: Approve & build → agent mode so the idle plan chip
      // does not stick after the review gate closes.
      if (
        shouldExitComposerPlanModeAfterDecision({
          decision: "approved",
          composerMode: modeRef.current,
        })
      ) {
        setMode("agent");
        setGoalMode(false);
        void api
          .composerPrefsSet({
            projectId: activeProject?.id ?? null,
            sessionId: session.sessionId ?? null,
            mode: "agent",
          })
          .catch((e) => showToast(String(e), 4000));
      }
    } catch (e) {
      showToast(String(e), 4500);
    }
  }, [
    activeProject?.id,
    archivePlanDecision,
    plan.rpcId,
    session.sessionId,
    showToast,
    writePlanForViewing,
  ]);

  /**
   * Resolve pending plan review as "cancelled" (revise).
   * `note` is optional free-form feedback; empty falls back to the default
   * revise prompt so the agent still knows to rework the plan.
   */
  const requestPlanChanges = useCallback(
    async (note?: string) => {
      const trimmed = typeof note === "string" ? note.trim() : "";
      const feedback = trimmed || tr("plan.reviseFeedback");
      try {
        await api.sessionResolvePlan({
          decision: "cancelled",
          feedback,
          rpcId: plan.rpcId,
          sessionId: viewingSessionIdRef.current,
        });
        writePlanForViewing({
          ...planRef.current,
          visible: false,
          waiting: false,
          rpcId: null,
          userClosed: false,
        });
        setPlanReviseOpen(false);
        setPlanReviseNote("");
      } catch (e) {
        showToast(String(e), 4500);
      }
    },
    [plan.rpcId, showToast, writePlanForViewing],
  );

  /** Open optional revision-note modal, then call requestPlanChanges. */
  const openRequestPlanChanges = useCallback(() => {
    setPlanReviseNote("");
    setPlanReviseOpen(true);
  }, []);

  /** Clear local plan history after in-app confirm (no window.confirm). */
  const confirmClearPlanHistory = useCallback(() => {
    setAppDialog({
      kind: "confirm",
      title: tr("plan.historyClearTitle"),
      message: tr("plan.historyClearMessage"),
      confirmLabel: tr("plan.historyClearConfirm"),
      danger: true,
      onConfirm: () => {
        try {
          clearPlanHistory();
          setPlanHistoryPreview(null);
        } catch {
          /* private mode */
        }
      },
    });
  }, []);

  /** Open the session that produced a plan history entry, if it still exists. */
  const openPlanHistorySession = useCallback(
    (entry: PlanHistoryEntry) => {
      const id = entry.sessionId?.trim();
      if (!id) {
        showToast(tr("plan.historySessionMissing"), 2800);
        return;
      }
      const row = sessions.find((s) => s.id === id);
      if (!row) {
        // Try openSessionById (refreshes list); toast if still missing.
        void (async () => {
          let found =
            sessionsRef.current.find((s) => s.id === id) ?? null;
          if (!found) {
            try {
              const list = await api.sessionsList();
              const hit = list.find((s) => s.id === id);
              if (hit) {
                found = mapSessionListRow(hit);
                setSessions(list.map((s) => mapSessionListRow(s)));
              }
            } catch {
              /* ignore */
            }
          }
          if (!found) {
            showToast(tr("plan.historySessionMissing"), 2800);
            return;
          }
          setShowPlanHistory(false);
          setPlanHistoryPreview(null);
          const proj =
            projects.find((p) => p.id === found!.projectId) ?? null;
          await openSessionRef.current(found, proj);
        })();
        return;
      }
      setShowPlanHistory(false);
      setPlanHistoryPreview(null);
      const proj = projects.find((p) => p.id === row.projectId) ?? null;
      void openSession(row, proj);
    },
    [openSession, projects, sessions, showToast, tr],
  );

  /**
   * User closes plan chrome (top bar / resource panel).
   * Flow: confirm → abandon pending review RPC if any → hard-close session plan
   * so reopen stays empty until a new plan cycle (new toolCallId / new rpcId).
   * Residual updates while still in composer plan mode stay suppressed.
   */
  const dismissPlan = useCallback(() => {
    const cur = planRef.current;
    if (!cur.visible && !cur.entries.length && !cur.body && cur.rpcId == null) {
      return;
    }
    setAppDialog({
      kind: "confirm",
      title: tr("plan.dismissConfirmTitle"),
      message: tr("plan.dismissConfirmMessage"),
      confirmLabel: tr("plan.dismiss"),
      danger: false,
      onConfirm: async () => {
        const latest = planRef.current;
        const abandonedRpcId = latest.rpcId ?? null;
        const sid = viewingSessionIdRef.current;
        if (abandonedRpcId != null) {
          try {
            await api.sessionResolvePlan({
              decision: "abandoned",
              rpcId: abandonedRpcId,
              sessionId: sid,
            });
          } catch {
            /* clear UI anyway */
          }
        }
        // Archive when user abandons review or dismisses an in-flight plan.
        if (
          latest.body.trim() ||
          latest.entries.length > 0 ||
          abandonedRpcId != null
        ) {
          archivePlanDecision("abandoned", latest, sid);
        }
        writePlanForViewing(
          closedSessionPlan(
            trRef.current("plan.ready"),
            latest.toolCallId ?? null,
            abandonedRpcId,
          ),
        );
        // If we opened the resource pane for this plan, close it so the next
        // files open is not stuck on the Plan workbench.
        if (planOpenedAsideRef.current) {
          planOpenedAsideRef.current = false;
          collapseAsidePersisted();
        }
      },
    });
  }, [archivePlanDecision, tr, writePlanForViewing]);

  /** Open Side Workbench Plan tab (review / waiting empty / open-in-resources). */
  const openPlanInResource = useCallback(() => {
    planOpenedAsideRef.current = true;
    setSideWorkbench((s) =>
      openSideTab(s, "plan", { name: "side.tab.plan" }),
    );
    openAsidePane();
    setPlanFocusKey((k) => k + 1);
  }, [openAsidePane]);

  /**
   * Exit the bare “计划模式” chip (mode === "plan", no plan content yet).
   *
   * Distinct from {@link dismissPlan}, which archives an in-flight plan /
   * abandons a review rpc. This just flips the composer mode back to agent and
   * persists it — the only way out when the bar is showing the idle plan chip
   * with no entries / body / rpc (previously there was no exit control at all).
   */
  const exitPlanMode = useCallback(() => {
    if (modeRef.current !== "plan") return;
    setMode("agent");
    setGoalMode(false);
    void api
      .composerPrefsSet({
        projectId: activeProject?.id ?? null,
        sessionId: session.sessionId ?? null,
        mode: "agent",
      })
      .catch((e) => showToast(String(e), 4000));
  }, [activeProject?.id, session.sessionId, showToast]);

  const sendQueueLabels = useMemo(
    () => ({
      sendFailed: tr("composer.queueSendFailed"),
      droppedOldest: (n: number, max: number) =>
        tr("composer.queueDroppedOldest", {
          n: String(n),
          max: String(max),
        }),
      externalAdded: (preview: string) =>
        tr("composer.queueExternalAdded", { preview }),
      externalAddedOther: (preview: string) =>
        tr("composer.queueExternalAddedOther", { preview }),
    }),
    [tr],
  );
  const sendQueue = useSendQueue({
    sessionId: session.sessionId,
    sessionState: session.state,
    connecting,
    liveHostRef,
    viewingSessionIdRef,
    sendInFlightRef,
    sendInFlightBySessionRef,
    connectingBySessionRef,
    executeSendRef: executeSendFromQueueRef,
    showToast,
    acceptExternal: !isSecondaryWindow,
    labels: sendQueueLabels,
  });

  sendQueueRef.current = sendQueue;

  const queueEdit = useQueueEditDialog({
    tr,
    showToast,
    activeQueue: sendQueue.activeQueue,
    updateItem: sendQueue.updateItem,
    pauseFlush: sendQueue.pauseFlush,
    releaseFlushHold: sendQueue.releaseFlushHold,
    clearQueue: sendQueue.clearQueue,
  });

  // sendQueue / composer focus exist only after this point. Mutate in place;
  // do not replace the host object (useSessionNavigation closes over hostRef).
  {
    const host = sessionNavHostRef.current;
    host.composer.restoreForNewChat = (proj, seedDraft) => {
      const nextKey = projectDraftKey(proj?.id ?? null);
      if (seedDraft != null) {
        applyComposerProjectDraft(null, seedDraft);
        saveComposerProjectDraft(nextKey, {
          text: seedDraft,
          attachments: [],
          goalMode,
        });
      } else {
        restoreComposerProjectDraft(nextKey);
      }
    };
    host.composer.clearDraftQueue = () => {
      sendQueue.clearDraftQueue();
    };
    host.composer.requestFocus = requestComposerFocus;
  }

  /**
   * Optimistic "Thinking…" with no Host turn (liveMap never streaming) — after
   * grace, strip the ghost pair, unlock busy, restore text to composer.
   * Power users can Stop; everyone else gets automatic recovery.
   */
  useGhostStreamingHeal({
    enabled: api.hasHost() && canLiveParticipate(isSecondaryWindow),
    sessionState: session.state,
    sessionId: session.sessionId,
    messages,
    turnStartedAt,
    liveMapRef,
    liveHostRef,
    sendEpochRef,
    sendInFlightRef,
    messagesBySessionRef,
    patchSessionMessages,
    setMessages,
    setSession,
    setLiveHost,
    setLiveMap,
    clearTurnClock,
    setStreamStall: (v) => setStreamStall(v),
    sendInFlightBySessionRef,
    sendEpochBySessionRef,
    restoreComposer: (text) => {
      setDraft(text);
      requestComposerFocus();
    },
    onHealed: () => {
      showToast(tr("agent.ghostStreamingHealed"), 5200);
      setLocalError(tr("agent.ghostStreamingHealed"));
    },
    uiConnecting: connecting,
    connectInFlightCountRef: ensureConnectCountRef,
    releaseConnecting: (sessionId) => {
      releaseSessionConnection([
        queueSessionKey(sessionId),
        queueSessionKey(null),
      ]);
      syncEnsureConnectingUi();
    },
    onZombieHealed: () => {
      showToast(tr("agent.zombieBusyHealed"), 4200);
    },
  });

  // Soft-steer while a live turn is producing (streaming / permission). Align
  // with Host pick_interjection_target mid-turn, not streaming-only FSM.
  const canGuideQueuedMessage =
    !!session.sessionId &&
    !connecting &&
    isSessionLiveStreaming(session.state) &&
    (liveHost.sessionId === session.sessionId
      ? isSessionLiveStreaming(liveHost.state) ||
        isSessionLiveStreaming(session.state)
      : true);

  const sendQueueStrip = useMemo(
    () =>
      resolveSendQueueStripState({
        queue: sendQueue.activeQueue,
        flushHold: sendQueue.flushHold,
      }),
    [sendQueue.activeQueue, sendQueue.flushHold],
  );

  const sendQueuedMessageNow = useCallback(
    async (item: QueuedSend) => {
      if (
        guidingQueueItemId ||
        isSendInFlightForSession(
          viewingSessionIdRef.current ?? session.sessionId,
        )
      ) {
        return;
      }
      sendQueue.removeItem(item.id);
      setGuidingQueueItemId(item.id);
      const ok = await executeSendFromQueueRef.current({
        storedDisplay: item.storedDisplay,
        att: item.attachments,
        quotes: item.quotes,
        goalMode: item.goalMode,
        fromQueue: true,
        targetSessionId: session.sessionId,
      });
      if (!ok) {
        sendQueue.enqueue({
          storedDisplay: item.storedDisplay,
          attachments: item.attachments,
          quotes: item.quotes,
          goalMode: item.goalMode,
        });
        showToast(tr("composer.queueSendNowFailed"), 4200);
      }
      setGuidingQueueItemId((current) =>
        current === item.id ? null : current,
      );
    },
    [
      guidingQueueItemId,
      sendQueue.removeItem,
      sendQueue.enqueue,
      session.sessionId,
      showToast,
      tr,
    ],
  );

  const guideQueuedMessage = useCallback(
    async (item: QueuedSend) => {
      if (guidingQueueItemId) return;
      if (!session.sessionId) return;
      if (!canGuideQueuedMessage) {
        await sendQueuedMessageNow(item);
        return;
      }
      const quotesForGuide = item.quotes ?? [];
      const segments = parseStoredContent(item.storedDisplay);
      const agentBody = serializeQuotesForAgent(
        quotesForGuide,
        serializeForAgent(segments, { goalMode: item.goalMode }),
      );
      let agentText = buildAgentPrompt(agentBody, item.attachments);
      const schemaForGuide = sessionJsonSchemaRef.current?.trim() || "";
      if (schemaForGuide && isActiveJsonSchema(schemaForGuide)) {
        agentText = wrapAgentTextWithJsonSchema(agentText, schemaForGuide);
      }
      if (!agentText.trim()) {
        showToast(tr("composer.queueEditEmpty"), 2800);
        return;
      }
      const journalDisplay = appendQuotesToContent(
        item.storedDisplay,
        quotesForGuide,
      );

      setGuidingQueueItemId(item.id);
      // Optimistic dequeue: don't leave the strip on「正在引导…」for the whole RPC.
      // Host also emits session://interjection → live thinking shell + timer reset.
      sendQueue.removeItem(item.id);
      // Fresh wall-clock for post-steer thinking chrome (event may also set this).
      restartTurnClock(viewingSessionIdRef.current);
      try {
        // Host interject has its own RPC timeout; also bound the UI so a wedged
        // agent cannot leave the button stuck on "正在引导…" forever.
        const GUIDE_UI_TIMEOUT_MS = 20_000;
        await Promise.race([
          api.sessionInterject(
            agentText,
            journalDisplay,
            item.attachments.map((attachment) => ({
              path: attachment.path,
              name: attachment.name,
              isDir: attachment.isDir,
            })),
            session.sessionId,
          ),
          new Promise<never>((_, reject) => {
            window.setTimeout(
              () => reject(new Error("guide timeout")),
              GUIDE_UI_TIMEOUT_MS,
            );
          }),
        ]);
      } catch (err) {
        // Re-queue so the follow-up is not lost when steer fails.
        sendQueue.enqueue({
          storedDisplay: item.storedDisplay,
          attachments: item.attachments,
          quotes: item.quotes,
          goalMode: item.goalMode,
        });
        const raw =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : err != null
                ? String(err)
                : "";
        const detail = raw.replace(/\s+/g, " ").trim().slice(0, 160);
        if (detail) {
          console.warn("[queue-guide]", detail);
        }
        showToast(
          detail
            ? `${tr("composer.queueGuideFailed")} (${detail})`
            : tr("composer.queueGuideFailed"),
          5200,
        );
      } finally {
        setGuidingQueueItemId((current) =>
          current === item.id ? null : current,
        );
      }
    },
    [
      canGuideQueuedMessage,
      guidingQueueItemId,
      session.sessionId,
      sendQueue.removeItem,
      sendQueue.enqueue,
      sendQueuedMessageNow,
      showToast,
      tr,
    ],
  );

  /**
   * Ctrl+Enter (Grok Build CLI mid-turn chord): steer the composer draft
   * into the live turn. Empty composer + a queued follow-up steers the head.
   */
  const steerFromComposer = useCallback(async () => {
    if (!canLiveParticipate(isSecondaryWindowRef.current)) {
      showToast(tr("session.secondaryLiveBanner"), 4000);
      return;
    }
    if (guidingQueueItemId) return;
    if (session.state === "awaiting_permission") {
      showToast(tr("composer.queueBlockedPermission"), 2800);
      return;
    }
    if (!canGuideQueuedMessage) return;

    const editorEl = composerInputRef.current;
    let draft = getDraft();
    if (editorEl) {
      try {
        const live = serializeDom(editorEl);
        if (live !== draft) {
          setDraft(live);
          draft = live;
        }
      } catch {
        /* keep getDraft() */
      }
    }
    const fromDraft = parseChatTokens(draft, (id) =>
      lookupChatTitle(id, sessions, ""),
    );
    let refs = chatAttachments;
    for (const extra of fromDraft) {
      refs = addChatRef(refs, extra, { currentId: session.sessionId }).refs;
    }
    const storedDisplay = prependChatTokens(stripChatTokens(draft), refs);
    const segments = parseStoredContent(storedDisplay);
    const att = attachments;
    const sendQuotes = quotesRef.current;
    const hasBody =
      !isDraftEmpty(segments) || att.length > 0 || sendQuotes.length > 0;

    if (hasBody) {
      const item = makeQueuedSend({
        storedDisplay,
        attachments: att,
        quotes: sendQuotes,
        goalMode,
      });
      const fromNewChatPage = session.sessionId == null;
      clearComposerAfterSubmit({
        clearProjectDraft: fromNewChatPage,
        clearSessionDraft: !fromNewChatPage,
        sessionDraftId: viewingSessionIdRef.current ?? session.sessionId,
      });
      await guideQueuedMessage(item);
      return;
    }

    const head = sendQueue.activeQueue[0];
    if (head) await guideQueuedMessage(head);
  }, [
    attachments,
    canGuideQueuedMessage,
    chatAttachments,
    goalMode,
    guidingQueueItemId,
    guideQueuedMessage,
    sessions,
    session.sessionId,
    session.state,
    sendQueue.activeQueue,
    showToast,
    tr,
  ]);

  /** Honest fork-agent checkbox presentation (never claims available without id). */
  const forkAgentCheckbox = useMemo(
    () =>
      resolveForkAgentCheckbox(
        forkConfirm?.source.agentSessionId,
        "fork",
        forkCliSession,
      ),
    [forkConfirm?.source.agentSessionId, forkCliSession],
  );
  const resumeAgentCheckbox = useMemo(
    () =>
      resolveForkAgentCheckbox(
        resumeRestoreConfirm?.agentSessionId,
        "resume",
        resumeForkCliSession,
      ),
    [resumeRestoreConfirm?.agentSessionId, resumeForkCliSession],
  );

  /** Toast classified soft-fail for fork / resume-restore (silent on cancel). */
  const toastSessionForkSoftFail = useCallback(
    (
      err: unknown,
      opts?: {
        op?: "fork" | "resume_restore";
        preferredKind?:
          | "need_tauri"
          | "busy"
          | "dirty"
          | "no_project"
          | "unavailable"
          | "worktree_collision"
          | "worktree_failed"
          | "bind_failed"
          | "fork_failed"
          | "cli_arm_failed"
          | "cancelled"
          | "other"
          | null;
        durationMs?: number;
      },
    ) => {
      const r = resolveSessionForkSoftFail(err, {
        op: opts?.op ?? "fork",
        preferredKind: opts?.preferredKind,
      });
      if (r.silent) return r;
      const base = tr(r.messageKey as Parameters<typeof tr>[0]);
      showToast(r.detail ? `${base}: ${r.detail}` : base, opts?.durationMs ?? 4500);
      return r;
    },
    [showToast, tr],
  );

  /**
   * Fork a session (full history or through a user-prompt index) and open it.
   * Optional restore-code: when clean git work tree, create a sibling worktree
   * at HEAD and bind the forked session to that path (never force on dirty).
   * Optional CLI `--fork-session`: new agent session id with parent context.
   * Soft-fail on dirty / worktree / bind; never invents agent-fork success.
   */
  const runForkSession = useCallback(
    async (
      source: SessionRow,
      opts?: {
        throughUserPromptIndex?: number | null;
        restoreCode?: boolean;
        forkCliSession?: boolean;
      },
    ) => {
      if (!api.isTauri()) {
        toastSessionForkSoftFail("need tauri", {
          preferredKind: "need_tauri",
        });
        return;
      }
      const restoreCode = !!opts?.restoreCode;
      // Checkbox honesty: never arm agent fork without a linked source id.
      const forkResolved = resolveForkAgentSession({
        wantFork: !!opts?.forkCliSession,
        agentSessionId: source.agentSessionId,
      });
      setForkBusy(true);
      try {
        const sourceProjectId = normalizeProjectId(source.projectId);
        const sourceProject = sourceProjectId
          ? projects.find((p) => p.id === sourceProjectId) ?? null
          : null;

        let bindProject: Project | null = sourceProject;
        let restoredWorktree = false;

        if (restoreCode) {
          const projectPath = sourceProject?.path?.trim() || "";
          if (!projectPath) {
            toastSessionForkSoftFail("no project", {
              preferredKind: "no_project",
              durationMs: 4500,
            });
            // Keep dialog open so the user can uncheck restore and fork journal-only.
            return;
          }
          let status: api.GitStatusResult;
          try {
            status = await api.gitStatus(projectPath);
          } catch (e) {
            toastSessionForkSoftFail(e, {
              preferredKind: "unavailable",
              durationMs: 4500,
            });
            return;
          }
          const gate = canRestoreCodeOnFork(projectPath, status);
          if (!gate.ok) {
            const kind = softFailKindFromRestoreGate(gate);
            toastSessionForkSoftFail(gate.reason, {
              preferredKind: kind,
              durationMs: kind === "dirty" ? 5200 : 4500,
            });
            // Keep dialog open so the user can uncheck restore and fork journal-only.
            return;
          }

          // Create sibling worktree at current HEAD of the source project.
          let created: api.GitWorktreeAddResult | null = null;
          let lastErr: unknown = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            const name = buildForkWorktreeName(source.id, {
              attempt,
              now: Date.now() + attempt,
            });
            try {
              created = await api.gitWorktreeAdd(projectPath, name, null);
              break;
            } catch (e) {
              lastErr = e;
              // Retry only on path/branch collision; other errors are fatal.
              if (!isWorktreeNameCollisionError(e)) {
                break;
              }
            }
          }
          if (!created) {
            toastSessionForkSoftFail(lastErr ?? "worktree failed", {
              preferredKind: isWorktreeNameCollisionError(lastErr)
                ? "worktree_collision"
                : "worktree_failed",
              durationMs: 5200,
            });
            return;
          }

          const trust = !!sourceProject?.trusted;
          const existing = projects.find((p) =>
            pathsEqual(p.path, created!.path),
          );
          if (existing) {
            bindProject = existing;
          } else {
            const added = (await api.projectAdd(
              created.path,
              trust,
            )) as Project;
            const list = mapProjectsList(
              (await api.projectsList()) as Project[],
            );
            setProjects(list);
            projectSpaces.assignNewProjects([added.id]);
            bindProject =
              list.find((p) => p.id === added.id) ??
              list.find((p) => pathsEqual(p.path, created!.path)) ??
              normalizeProject(added);
          }
          restoredWorktree = true;
        }

        const base = (source.title || tr("session.untitled")).trim();
        // Avoid double-prefix when forking a fork (any locale).
        const title = /^(fork of|分叉：|分叉:)\s*/i.test(base)
          ? base
          : tr("session.forkTitleOf", { name: base || "chat" });
        let meta: Awaited<ReturnType<typeof api.sessionFork>>;
        try {
          meta = await api.sessionFork(source.id, {
            throughUserPromptIndex: opts?.throughUserPromptIndex ?? null,
            title,
            forkAgentSession: forkResolved.fork,
          });
        } catch (e) {
          toastSessionForkSoftFail(e, {
            preferredKind: "fork_failed",
            durationMs: 4500,
          });
          return;
        }

        // Rebind fork to the worktree project when restore-code succeeded.
        let projectId = meta.projectId ?? source.projectId;
        if (restoredWorktree && bindProject?.id) {
          try {
            const updated = await api.sessionSetProject(
              meta.id,
              bindProject.id,
            );
            projectId = updated.projectId ?? bindProject.id;
          } catch (e) {
            toastSessionForkSoftFail(e, {
              preferredKind: "bind_failed",
              durationMs: 4500,
            });
            // Fall through: journal fork still exists on source project.
            bindProject = sourceProject;
            projectId = meta.projectId ?? source.projectId;
            restoredWorktree = false;
          }
        }

        setForkConfirm(null);
        setForkRestoreCode(false);
        setForkCliSession(false);
        await refreshSessions();
        const row = normalizeSessionRow({
          ...source,
          ...(meta as SessionRow),
          id: meta.id,
          title: meta.title || title,
          projectId,
          updatedAt: meta.updatedAt || new Date().toISOString(),
          modelId: meta.modelId ?? source.modelId ?? null,
          effort: source.effort ?? null,
          archived: meta.archived,
          pinned: !!(meta as SessionRow).pinned,
          scheduled: meta.scheduled,
          agentSessionId:
            (meta as SessionRow).agentSessionId ??
            (forkResolved.fork ? forkResolved.sourceAgentId : null),
        });
        const proj =
          (projectId
            ? projects.find((p) => p.id === projectId) ?? null
            : null) ??
          bindProject;
        // Prefer bindProject when we just added it (may not be in stale projects).
        const openProj =
          restoredWorktree && bindProject
            ? bindProject
            : proj ?? bindProject;
        if (row.projectId) {
          setExpandedProjects((e) => ({ ...e, [row.projectId!]: true }));
        } else {
          setHistoryOpen(true);
        }
        await openSession(row, openProj);
        showToast(
          tr(
            forkSuccessToastKey({
              restoredWorktree,
              // Partial forks wait for session://fork_trimmed before claiming a new agent id.
              forkedAgent:
                opts?.throughUserPromptIndex != null
                  ? false
                  : forkResolved.fork,
            }) as Parameters<typeof tr>[0],
          ),
          2800,
        );
      } catch (e) {
        toastSessionForkSoftFail(e, { preferredKind: "fork_failed" });
      } finally {
        setForkBusy(false);
      }
    },
    // openSession / refreshSessions via closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects, showToast, toastSessionForkSoftFail, tr],
  );

  const confirmForkSession = useCallback(
    (source: SessionRow, throughUserPromptIndex?: number | null) => {
      setCtxMenu(null);
      setForkRestoreCode(false);
      // Prefer live snapshot agent id when forking the open chat.
      const agentId =
        source.agentSessionId ||
        (session.sessionId === source.id ? session.agentSessionId : null);
      const enriched = { ...source, agentSessionId: agentId ?? null };
      // Honest default: on only when a linked agent session exists.
      setForkCliSession(
        defaultForkAgentChecked(enriched.agentSessionId, "fork"),
      );
      setForkConfirm({
        source: enriched,
        throughUserPromptIndex: throughUserPromptIndex ?? null,
      });
    },
    [session.sessionId, session.agentSessionId],
  );

  /**
   * Resume an existing session on a clean sibling worktree at current HEAD.
   * Reuses the fork restore-code dirty gate; does not clone the journal.
   * Optional CLI `--fork-session`: new agent session id (source agent left intact).
   * Soft-fail on dirty / worktree / bind; never invents agent-fork success.
   */
  const runResumeWithCodeRestore = useCallback(
    async (
      source: SessionRow,
      opts?: { forkCliSession?: boolean },
    ) => {
      if (!api.isTauri()) {
        toastSessionForkSoftFail("need tauri", {
          op: "resume_restore",
          preferredKind: "need_tauri",
        });
        return;
      }
      const isOpenSource =
        session.sessionId === source.id ||
        viewingSessionIdRef.current === source.id;
      if (
        busyIds.has(source.id) ||
        (isOpenSource && !canRewindSession)
      ) {
        toastSessionForkSoftFail("busy", {
          op: "resume_restore",
          preferredKind: "busy",
          durationMs: 3500,
        });
        return;
      }
      // Checkbox honesty: never arm agent fork without a linked source id.
      const forkResolved = resolveForkAgentSession({
        wantFork: !!opts?.forkCliSession,
        agentSessionId: source.agentSessionId,
      });
      setResumeRestoreBusy(true);
      try {
        const sourceProjectId = normalizeProjectId(source.projectId);
        const sourceProject = sourceProjectId
          ? projects.find((p) => p.id === sourceProjectId) ?? null
          : null;
        const projectPath = sourceProject?.path?.trim() || "";
        if (!projectPath) {
          toastSessionForkSoftFail("no project", {
            op: "resume_restore",
            preferredKind: "no_project",
            durationMs: 4500,
          });
          return;
        }

        let status: api.GitStatusResult;
        try {
          status = await api.gitStatus(projectPath);
        } catch (e) {
          toastSessionForkSoftFail(e, {
            op: "resume_restore",
            preferredKind: "unavailable",
            durationMs: 4500,
          });
          return;
        }
        const gate = canRestoreCodeOnResume(projectPath, status);
        if (!gate.ok) {
          const kind = softFailKindFromRestoreGate(gate);
          toastSessionForkSoftFail(gate.reason, {
            op: "resume_restore",
            preferredKind: kind,
            durationMs: kind === "dirty" ? 5200 : 4500,
          });
          return;
        }

        let created: api.GitWorktreeAddResult | null = null;
        let lastErr: unknown = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const name = buildResumeWorktreeName(source.id, {
            attempt,
            now: Date.now() + attempt,
          });
          try {
            created = await api.gitWorktreeAdd(projectPath, name, null);
            break;
          } catch (e) {
            lastErr = e;
            if (!isWorktreeNameCollisionError(e)) {
              break;
            }
          }
        }
        if (!created) {
          toastSessionForkSoftFail(lastErr ?? "worktree failed", {
            op: "resume_restore",
            preferredKind: isWorktreeNameCollisionError(lastErr)
              ? "worktree_collision"
              : "worktree_failed",
            durationMs: 5200,
          });
          return;
        }

        const trust = !!sourceProject?.trusted;
        const existing = projects.find((p) =>
          pathsEqual(p.path, created!.path),
        );
        let bindProject: Project | null = existing ?? null;
        if (!bindProject) {
          const added = (await api.projectAdd(created.path, trust)) as Project;
          const list = mapProjectsList(
            (await api.projectsList()) as Project[],
          );
          setProjects(list);
          projectSpaces.assignNewProjects([added.id]);
          bindProject =
            list.find((p) => p.id === added.id) ??
            list.find((p) => pathsEqual(p.path, created!.path)) ??
            normalizeProject(added);
        }

        try {
          await api.sessionSetProject(source.id, bindProject.id);
        } catch (e) {
          toastSessionForkSoftFail(e, {
            op: "resume_restore",
            preferredKind: "bind_failed",
            durationMs: 4500,
          });
          return;
        }

        const branch =
          created.branch?.trim() ||
          created.name ||
          tr("composer.worktreeDetached");
        try {
          await api.sessionSetWorktree(source.id, {
            worktreePath: created.path,
            worktreeBranch: branch,
          });
        } catch {
          /* soft-fail badge meta */
        }

        if (forkResolved.fork) {
          try {
            await api.sessionSetForkAgentSession(source.id, true);
          } catch (e) {
            toastSessionForkSoftFail(e, {
              op: "resume_restore",
              preferredKind: "cli_arm_failed",
              durationMs: 4500,
            });
            // Worktree rebind still succeeded — continue without agent fork.
          }
        }

        setResumeRestoreConfirm(null);
        setResumeForkCliSession(false);
        await refreshSessions();
        await refreshGitWorktrees();
        const row = normalizeSessionRow({
          ...source,
          projectId: bindProject.id,
          worktreePath: created.path,
          worktreeBranch: branch,
          isWorktreeSession: true,
          updatedAt: new Date().toISOString(),
        });
        setExpandedProjects((e) => ({ ...e, [bindProject!.id]: true }));
        await openSession(row, bindProject);
      } catch (e) {
        toastSessionForkSoftFail(e, {
          op: "resume_restore",
          preferredKind: "other",
        });
      } finally {
        setResumeRestoreBusy(false);
      }
    },
    // openSession / refreshSessions / busyIds / canRewindSession via closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects, showToast, toastSessionForkSoftFail, tr, session.sessionId],
  );

  const confirmResumeWithCodeRestore = useCallback(
    (source: SessionRow) => {
      setCtxMenu(null);
      const agentId =
        source.agentSessionId ||
        (session.sessionId === source.id ? session.agentSessionId : null);
      // Honest default: off (reuse agent id); opt-in only when available.
      setResumeForkCliSession(
        defaultForkAgentChecked(agentId, "resume"),
      );
      setResumeRestoreConfirm({
        ...source,
        agentSessionId: agentId ?? null,
      });
    },
    [session.sessionId, session.agentSessionId],
  );

  /**
   * Duplicate a session: full journal clone via sessionFork (no cut, no restore-code).
   * Idle-only so we don't snapshot a mid-turn journal.
   */
  const runDuplicateSession = useCallback(
    async (source: SessionRow) => {
      if (!api.isTauri()) {
        showToast(tr("error.needTauri"));
        return;
      }
      const isOpenSource =
        session.sessionId === source.id ||
        viewingSessionIdRef.current === source.id;
      if (
        busyIds.has(source.id) ||
        (isOpenSource && !canRewindSession)
      ) {
        showToast(tr("session.duplicateBusy"), 3500);
        return;
      }
      setCtxMenu(null);
      setForkBusy(true);
      try {
        const base = (source.title || tr("session.untitled")).trim();
        // Avoid double-prefix when duplicating a copy (any locale).
        const title = /^(copy of|副本：|副本:)\s*/i.test(base)
          ? base
          : tr("session.duplicateTitleOf", { name: base || "chat" });
        const meta = await api.sessionFork(source.id, {
          throughUserPromptIndex: null,
          title,
        });
        await refreshSessions();
        const projectId = meta.projectId ?? source.projectId;
        const row = normalizeSessionRow({
          ...source,
          ...(meta as SessionRow),
          id: meta.id,
          title: meta.title || title,
          projectId,
          updatedAt: meta.updatedAt || new Date().toISOString(),
          modelId: meta.modelId ?? source.modelId ?? null,
          effort: source.effort ?? null,
          archived: meta.archived,
          pinned: !!(meta as SessionRow).pinned,
          scheduled: meta.scheduled,
        });
        const openProj = projectId
          ? projects.find((p) => p.id === projectId) ?? null
          : null;
        if (row.projectId) {
          setExpandedProjects((e) => ({ ...e, [row.projectId!]: true }));
        } else {
          setHistoryOpen(true);
        }
        await openSession(row, openProj);
      } catch (e) {
        showToast(tr("session.duplicateFailed") + ": " + String(e), 4500);
      } finally {
        setForkBusy(false);
      }
    },
    // openSession / refreshSessions via closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      busyIds,
      canRewindSession,
      projects,
      session.sessionId,
      showToast,
      tr,
    ],
  );

  /**
   * Apply rewind: truncate local journal (+ agent when live), refresh messages UI.
   * `restoreFiles` is opt-in (safe default off) — reverts workspace files when agent supports it.
   */
  const runRewindToPrompt = useCallback(
    async (
      sessionId: string,
      targetPromptIndex: number,
      restoreFiles = false,
    ) => {
      if (!api.isTauri()) {
        const msg = tr("error.needTauri");
        setRewindError(msg);
        showToast(msg);
        return;
      }
      if (!canRewindSession) {
        const msg = tr("session.rewindBusy");
        setRewindError(msg);
        showToast(msg);
        return;
      }
      setRewindError(null);
      setRewindBusy(true);
      try {
        // Prefer live connect so agent rewind can run; local truncate still works if not.
        if (
          (session.sessionId === sessionId ||
            viewingSessionIdRef.current === sessionId) &&
          session.state !== "ready"
        ) {
          try {
            await ensureConnected();
          } catch {
            /* local-only path */
          }
        }

        const result = await api.sessionRewindExecute(targetPromptIndex, {
          sessionId,
          restoreFiles,
        });

        // Refresh UI from truncated journal.
        if (viewingSessionIdRef.current === sessionId) {
          const stored = await api.sessionMessages(sessionId);
          const mapped = mapStoredMessagesToChat(stored);
          const woven = weaveToolsIntoAssistantSegments(mapped);
          const kept = truncateThroughUserPrompt(woven, targetPromptIndex);
          const finalMsgs =
            kept.length || woven.length <= result.keptCount
              ? kept.length
                ? kept
                : woven
              : woven.slice(0, result.keptCount);
          messagesBySessionRef.current.set(sessionId, finalMsgs);
          setMessages(finalMsgs);
        } else {
          messagesBySessionRef.current.delete(sessionId);
        }

        setRewindTimeline(null);
        setRewindConfirm(null);
        setRewindRestoreFiles(false);
        setRewindError(null);
        if (!result.agentOk) {
          showToast(tr("session.rewindLocalOnly"), 4200);
        }
        await refreshSessions();
      } catch (e) {
        const msg = tr("session.rewindFailed") + ": " + String(e);
        setRewindError(msg);
        showToast(msg, 4500);
      } finally {
        setRewindBusy(false);
      }
    },
    // ensureConnected / refreshSessions via closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canRewindSession, session.sessionId, session.state, showToast, tr],
  );

  const confirmRewindToPrompt = useCallback(
    (sessionId: string, targetPromptIndex: number, preview?: string) => {
      setCtxMenu(null);
      // GlassModal with restore-files checkbox (default off) — not bare setAppDialog.
      // Close the timeline first so two overlays cannot swallow the confirm click.
      setRewindTimeline(null);
      setRewindRestoreFiles(false);
      setRewindError(null);
      setRewindConfirm({
        sessionId,
        targetPromptIndex,
        preview: preview?.trim() || undefined,
      });
    },
    [],
  );

  const openRewindTimeline = useCallback(
    async (sessionId: string) => {
      setCtxMenu(null);
      if (!api.isTauri()) {
        showToast(tr("error.needTauri"));
        return;
      }
      if (!canRewindSession) {
        showToast(tr("session.rewindBusy"));
        return;
      }
      try {
        let points = await api.sessionRewindPoints(sessionId);
        if (!points.length) {
          if (viewingSessionIdRef.current === sessionId) {
            points = localRewindPoints(messagesRef.current).map((p) => ({
              promptIndex: p.promptIndex,
              messageId: p.messageId,
              preview: p.preview,
            }));
          }
        }
        if (!points.length) {
          showToast(tr("session.rewindEmpty"));
          return;
        }
        setRewindTimeline({ sessionId, points });
      } catch (e) {
        if (viewingSessionIdRef.current === sessionId) {
          const points = localRewindPoints(messagesRef.current);
          if (points.length) {
            setRewindTimeline({
              sessionId,
              points: points.map((p) => ({
                promptIndex: p.promptIndex,
                messageId: p.messageId,
                preview: p.preview,
              })),
            });
            return;
          }
        }
        showToast(tr("session.rewindFailed") + ": " + String(e), 4500);
      }
    },
    [canRewindSession, showToast, tr],
  );

  const onRewindToUserMessage = useCallback(
    (msg: ChatMessage) => {
      const sid = session.sessionId ?? viewingSessionIdRef.current;
      if (!sid) {
        showToast(tr("session.rewindFailed"));
        return;
      }
      if (!canRewindSession) {
        showToast(tr("session.rewindBusy"));
        return;
      }
      const idx = userPromptIndexOf(messages, msg.id);
      if (idx < 0) return;
      if (!canRewindToUserPrompt(messages, idx)) {
        return;
      }
      const preview = (msg.content || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
      confirmRewindToPrompt(sid, idx, preview);
    },
    [
      canRewindSession,
      confirmRewindToPrompt,
      messages,
      session.sessionId,
      showToast,
      tr,
    ],
  );

  const onForkFromAssistantMessage = useCallback(
    (msg: ChatMessage) => {
      const sid = session.sessionId ?? viewingSessionIdRef.current;
      if (!sid) {
        showToast(tr("session.forkFailed"));
        return;
      }
      const row =
        sessions.find((s) => s.id === sid) ??
        ({
          id: sid,
          title: session.title || tr("session.untitled"),
          projectId: activeProject?.id ?? null,
          updatedAt: new Date().toISOString(),
        } satisfies SessionRow);
      const idx = userPromptIndexContaining(messages, msg.id);
      if (idx < 0) return;
      confirmForkSession(row, idx);
    },
    [
      activeProject?.id,
      confirmForkSession,
      messages,
      session.sessionId,
      session.title,
      sessions,
      showToast,
      tr,
    ],
  );

  /**
   * Apply permission policy (incl. YOLO). Never use window.confirm in Tauri —
   * it is unreliable in the WebView and blocks YOLO enable/disable.
   */
  const applyPermissionPolicy = useCallback(
    (next: PermissionPolicyId) => {
      if (!isValidPolicy(next)) return;

      const commit = () => {
        setPolicy(next);
        void api
          .sessionSetPolicy(next, {
            projectId: activeProject?.id ?? null,
            sessionId: session.sessionId ?? null,
          })
          .catch((e) => showToast(String(e), 4000));
      };

      if (next !== "always_approve") {
        commit();
        return;
      }

      // Two-step in-app confirm (dangerous YOLO).
      setAppDialog({
        kind: "confirm",
        title: tr("policy.always_approve"),
        message: tr("policy.yoloConfirm"),
        confirmLabel: tr("common.confirm"),
        danger: true,
        onConfirm: () => {
          setAppDialog({
            kind: "confirm",
            title: tr("policy.always_approve"),
            message: tr("policy.yoloConfirm2"),
            confirmLabel: tr("policy.short.always_approve"),
            danger: true,
            onConfirm: commit,
          });
        },
      });
    },
    [activeProject?.id, session.sessionId, showToast, tr],
  );

  const applyCreateVideo = useCallback(() => {
    const live = liveSlashRef.current;
    const q =
      slashQuery ??
      (live.present
        ? { start: live.start, query: live.query, end: live.end }
        : null);
    setSlashQuery(null);
    setLiveSlash({ present: false, query: "", start: 0, end: 0 });
    liveSlashRef.current = { present: false, query: "", start: 0, end: 0 };
    setShowComposerPlus(false);

    const prompt = tr("skill.createVideoPrompt");
    setDraft((d) => {
      const range =
        (q && d.slice(q.start, q.end).startsWith("/") ? q : null) ??
        detectSlashRangeOnStored(d);
      if (range && d.slice(range.start, range.end).startsWith("/")) {
        const withSkill = applySkillAtSlash(
          d,
          range.start,
          range.end,
          "imagine",
        );
        const next = `${withSkill}${prompt}`;
        requestComposerStoredCaret(
          range.start + `[[skill:imagine]] `.length + prompt.length,
        );
        return next;
      }
      const needsSpace = d.length > 0 && !/\s$/.test(d);
      const next = `${d}${needsSpace ? " " : ""}[[skill:imagine]] ${prompt}`;
      requestComposerStoredCaret("end");
      return next;
    });
    requestAnimationFrame(() => {
      composerInputRef.current?.focus?.();
    });
  }, [slashQuery, tr]);

  const onBeforeOpenAttachPicker = useCallback(() => {
    setShowComposerPlus(false);
    setSlashQuery(null);
    setLiveSlash({ present: false, query: "", start: 0, end: 0 });
    liveSlashRef.current = { present: false, query: "", start: 0, end: 0 };
    setPromptHistoryOpen(false);
  }, [setShowComposerPlus, setSlashQuery, setLiveSlash, setPromptHistoryOpen]);

  const {
    closeAttachChat,
    openAttachChat,
    applyAttachedChat,
    cycleAttachedChatScope,
    attachedChatLookup,
    attachScopeLabel,
    attachableSessions,
    attachChatPos,
    attachChatStyle,
    removeAttachedChat,
  } = useAttachChat({
    sessions,
    currentSessionId: session.sessionId,
    currentProjectId: activeProject?.id ?? null,
    chatAttachments,
    setChatAttachments,
    attachChatOpen,
    setAttachChatOpen,
    attachChatFilter,
    setAttachChatFilter,
    attachChatActive,
    setAttachChatActive,
    attachChatPanelRef,
    composerShellRef,
    composerInputRef,
    showToast,
    tr,
    onBeforeOpenPicker: onBeforeOpenAttachPicker,
    openSession: (row) => {
      const full = sessions.find((s) => s.id === row.id);
      if (full) void openSession(full);
    },
  });

  const applySlashItem = useCallback(
    (item: SlashItem) => {
      const live = liveSlashRef.current;
      const q =
        slashQuery ??
        (live.present
          ? { start: live.start, query: live.query, end: live.end }
          : null);
      setSlashQuery(null);
      setLiveSlash({ present: false, query: "", start: 0, end: 0 });
      liveSlashRef.current = { present: false, query: "", start: 0, end: 0 };
      setShowComposerPlus(false);

      if (
        item.kind === "action" &&
        (item.action === "workflow" || item.action === "workflows")
      ) {
        const stored = getDraft();
        const leftover = q ? leftoverWorkflowArgs(stored, q.end) : "";
        const match = resolveWorkflowSlashAction({
          query: q?.query,
          leftoverArgs: leftover,
          forceDashboard: item.action === "workflows",
        });
        if (q) {
          setDraft((d) => stripWorkflowSlashFromDraft(d, q.start, q.end));
          requestComposerStoredCaret(q.start);
        }
        if (match.kind === "session" && match.command) {
          void executeSend({
            storedDisplay: match.command,
            att: [],
            goalMode: false,
          });
        } else {
          openWorkflowsSettings();
        }
        return;
      }

      if (item.kind === "skill") {
        setDraft((d) => {
          // Prefer live range (DOM/draft poll), then re-detect on this draft.
          const range =
            (q && d.slice(q.start, q.end).startsWith("/")
              ? q
              : null) ?? detectSlashRangeOnStored(d);
          if (range && d.slice(range.start, range.end).startsWith("/")) {
            const next = applySkillAtSlash(
              d,
              range.start,
              range.end,
              item.name,
            );
            // Caret after `[[skill:name]] ` — not document start (panel click blurs).
            requestComposerStoredCaret(
              range.start + `[[skill:${item.name}]] `.length,
            );
            return next;
          }
          const needsSpace = d.length > 0 && !/\s$/.test(d);
          const next = `${d}${needsSpace ? " " : ""}[[skill:${item.name}]] `;
          requestComposerStoredCaret("end");
          return next;
        });
        // Refocus so the user can keep typing after picking from the panel.
        requestAnimationFrame(() => {
          composerInputRef.current?.focus?.();
        });
        return;
      }

      // Remove the /query from draft for mode/action
      if (q) {
        setDraft((d) => {
          const range =
            (q && d.slice(q.start, q.end).startsWith("/")
              ? q
              : null) ?? detectSlashRangeOnStored(d);
          if (range && d.slice(range.start, range.end).startsWith("/")) {
            requestComposerStoredCaret(range.start);
            return d.slice(0, range.start) + d.slice(range.end);
          }
          return d;
        });
        requestAnimationFrame(() => {
          composerInputRef.current?.focus?.();
        });
      }

      if (item.kind === "mode") {
        if (item.mode === "goal") {
          setGoalMode(true);
          if (mode === "plan") setMode("agent");
          return;
        }
        if (item.mode === "plan") {
          setGoalMode(false);
          setMode("plan");
          void api
            .composerPrefsSet({
              projectId: activeProject?.id ?? null,
              sessionId: session.sessionId ?? null,
              mode: "plan",
            })
            .catch((e) => showToast(String(e), 4000));
          return;
        }
      }

      if (item.kind === "action") {
        switch (item.action) {
          case "doctor":
            openDoctor();
            return;
          case "tutorial":
            setShowProductTutorial(true);
            return;
          case "status":
            setShowStatusModal(true);
            return;
          case "usage":
            setShowUsageLimitModal(true);
            return;
          case "mcp":
            void openMcpModal();
            return;
          case "compact":
            compact.openWithPresetNote();
            return;
          case "newChat":
            void newChat();
            return;
          case "automations":
            navigateAutomations();
            return;
          case "live-voice":
          case "liveVoice":
            startLiveVoice();
            return;
          case "settings":
            navigateSettings();
            return;
          case "pet":
            void import("@/lib/api/pet").then((m) => m.petToggle());
            return;
          case "export":
            void exportActiveSessionMd();
            return;
          case "copy":
            void copyLastAssistantReply();
            return;
          case "find":
            openChatFind();
            return;
          case "history":
            openPromptHistory({ focusFilter: true, seedDraft: false });
            return;
          case "attach-chat":
            openAttachChat();
            return;
          case "extensions":
            navigateSettings("extensions");
            return;
          case "yolo": {
            const next: PermissionPolicyId =
              policy === "always_approve" ? "ask" : "always_approve";
            applyPermissionPolicy(next);
            return;
          }
          case "goal-clear":
            setGoalMode(false);
            return;
          default:
            return;
        }
      }
    },
    // many deps — intentionally broad for stable handlers used in render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      slashQuery,
      mode,
      policy,
      activeProject?.id,
      session.sessionId,
      tr,
      openMcpModal,
      applyPermissionPolicy,
      showToast,
      openPromptHistory,
      openWorkflowsSettings,
      openAttachChat,
    ],
  );

  // Seed draft / clear / pane switch: grow textarea. If a focus request is still
  // pending (e.g. textarea just remounted), retry focus here as a backstop.
  // Also re-run on external draft store changes without re-rendering AppWorkbench.
  useEffect(() => {
    if (mainPane !== "chat") return;
    const run = () => {
      if (pendingComposerFocus.current) {
        requestComposerFocus();
        return;
      }
      syncComposerHeight();
    };
    run();
    return composerDraftStore.subscribe(run);
  }, [mainPane, session.sessionId, requestComposerFocus, syncComposerHeight]);

  /** Session file-changes chip (+/− or N files); hidden when empty. */
  const sessionChangesSummary = useMemo(() => {
    const sid = session.sessionId || "";
    const list = sid ? (sessionChangesById[sid] ?? []) : [];
    return summarizeSessionChanges(list);
  }, [session.sessionId, sessionChangesById]);

  const sidebarToggleUnread = usePaneUnreadDot({
    open: !layout.sidebarCollapsed,
    keys: unreadSessionIds,
  });
  const asideToggleUnread = usePaneUnreadDot({
    open: !layout.asideCollapsed,
    keys: (session.sessionId
      ? (sessionChangesById[session.sessionId] ?? [])
      : []
    ).map((change) =>
      JSON.stringify([
        change.path,
        change.updatedAt,
        change.status,
        change.toolCallId ?? "",
      ]),
    ),
    resetKey: session.sessionId || "",
  });

  // Reset find when switching conversation (keep open across same session).
  useEffect(() => {
    setShowChatFind(false);
  }, [session.sessionId]);

  // Close find when leaving the chat pane (not when opening from another pane).
  useEffect(() => {
    if (mainPane !== "chat") {
      setShowChatFind(false);
    }
  }, [mainPane]);

  useEffect(() => {
    if (!showChatFind) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.isComposing) return;
      // Permission bar / dialogs own Escape when open.
      if (perm || appDialog) return;
      e.preventDefault();
      e.stopPropagation();
      setShowChatFind(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [showChatFind, perm, appDialog]);

  const [chatFindFocusKey, setChatFindFocusKey] = useState(0);
  const openChatFind = useCallback(() => {
    // Ensure chat pane first; opening find after pane switch is handled by
    // setting show true in the same tick (pane effect only closes on leave).
    if (mainPane !== "chat") {
      setMainPane("chat");
    }
    setShowChatFind(true);
    setChatFindFocusKey((k) => k + 1);
  }, [mainPane]);

  /** Copy last non-error assistant reply body to the clipboard. */
  const copyLastAssistantReply = useCallback(async () => {
    let last: ChatMessage | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role === "assistant" && !m.isError) {
        last = m;
        break;
      }
    }
    const text = (last?.content ?? "").trim();
    if (!text) {
      showToast(tr("slash.copyEmpty"));
      return;
    }
    try {
      await navigator.clipboard.writeText(last!.content);
    } catch (e) {
      showToast(String(e), 4000);
    }
  }, [messages, showToast]);

  /**
   * New empty draft only: lift composer and SuperGrok brand.
   * Existing sessions (even with empty journal) must not look like a fresh chat.
   */
  const welcomeSession =
    mainPane === "chat" &&
    !session.sessionId &&
    transcriptMeta.length === 0 &&
    session.state !== "streaming";
  const welcomePrompt = tr("composer.welcomePrompt");
  const journalPending =
    !!session.sessionId &&
    (transcriptMeta.journalLoading ||
      !sessionTranscriptStore.isJournalHydrated(session.sessionId));
  const emptyExistingSession =
    mainPane === "chat" &&
    !!session.sessionId &&
    transcriptMeta.length === 0 &&
    !journalPending &&
    session.state !== "streaming" &&
    session.state !== "connecting";
  // Live billing can take seconds (quota network). Cache last mark so the
  // welcome logo paints immediately — the SVG itself is inline, not a fetch.
  const [cachedBrandKind, setCachedBrandKind] =
    useState<SuperGrokBrandKind | null>(() => loadCachedSuperGrokBrand());
  /** Active inference channel: custom relay identity replaces official account chrome. */
  const [activeCustomProvider, setActiveCustomProvider] =
    useState<api.CustomProvider | null>(null);
  /** Session-memory DeepSeek (etc.) balance for sidebar footer / UserMenu. */
  const [providerBalanceCache, setProviderBalanceCache] =
    useState<ProviderBalanceCache | null>(null);
  const [providerBalanceBusy, setProviderBalanceBusy] = useState(false);
  const [providerBalanceError, setProviderBalanceError] = useState<
    string | null
  >(null);
  /** Guards a one-time-per-session re-fetch of live model context windows. */
  const refreshedModelsSidRef = useRef<string | null>(null);
  const currentModelWindow = useMemo(
    () =>
      resolveContextWindow({
        activeCustomProvider,
        modelId,
        models: availableModels,
        // Prefer live agent occupancy denominator (Grok Build 1.0 → 500k).
        agentContextWindow: contextUsage.agentContextWindow,
      }),
    [
      activeCustomProvider,
      modelId,
      availableModels,
      contextUsage.agentContextWindow,
    ],
  );
  useEffect(() => {
    if (
      session.state === "ready" &&
      session.sessionId &&
      refreshedModelsSidRef.current !== session.sessionId
    ) {
      refreshedModelsSidRef.current = session.sessionId;
      api.modelsListAvailable()
        .then((res) => {
          if (!res?.models?.length) return;
          // Full merge so official live windows (500k) replace cold-start null
          // / stale catalog values — never leave a silent 200k official default.
          setAvailableModels((prev) => {
            const prevById = new Map(prev.map((m) => [m.id, m]));
            return res.models.map((m) => {
              const prior = prevById.get(m.id);
              return {
                id: m.id,
                label: m.label || m.id,
                source: m.source,
                isDefault: m.isDefault,
                reasoningEfforts:
                  m.reasoningEfforts?.length
                    ? m.reasoningEfforts.map((e) => ({
                        id: e.id,
                        value: e.value,
                        label: e.label,
                        description: e.description,
                        isDefault: e.isDefault,
                      }))
                    : prior?.reasoningEfforts,
                contextWindow:
                  m.contextWindow != null && m.contextWindow > 0
                    ? m.contextWindow
                    : (prior?.contextWindow ?? null),
              };
            });
          });
        })
        .catch(() => {});
    }
  }, [session.state, session.sessionId]);
  /** Context usage chip label/state from compact events + message estimate. */
  const contextUsageDisplay = useMemo(
    () =>
      resolveContextUsageDisplay(
        contextUsage,
        messages,
        locale,
        currentModelWindow,
      ),
    [contextUsage, messages, locale, currentModelWindow],
  );
  const sessionSpend = useSessionSpend(session.sessionId);
  /** Full provider list for composer model menu groups. */
  const [customProviders, setCustomProviders] = useState<api.CustomProvider[]>(
    [],
  );
  const [providerActiveSource, setProviderActiveSource] =
    useState<string>("official");
  const [providerActiveId, setProviderActiveId] = useState<string | null>(null);
  const [modelPickBusy, setModelPickBusy] = useState(false);
  const customRouteActive = activeCustomProvider != null;
  const composerProviderInputs = useMemo(
    () =>
      customProviders.map((p) => ({
        id: p.id,
        name: p.name,
        model: p.model,
        models: (p.models?.length
          ? p.models
          : p.model
            ? [{ id: p.model, name: p.model }]
            : []
        ).map((m) => ({ id: m.id, name: m.name || m.id })),
      })),
    [customProviders],
  );
  const refreshProviderRoute = useCallback(async () => {
    if (!api.isTauri()) {
      setActiveCustomProvider(null);
      setCustomProviders([]);
      setProviderActiveSource("official");
      setProviderActiveId(null);
      return;
    }
    try {
      const list = await api.providersList();
      setCustomProviders(list.providers);
      setProviderActiveSource(list.activeSource);
      setProviderActiveId(list.activeProviderId);
      const active =
        list.activeSource === "custom"
          ? list.providers.find((provider) => provider.id === list.activeProviderId) ?? null
          : null;
      setActiveCustomProvider(active);
    } catch {
      /* keep previous */
    }
  }, []);
  useEffect(() => {
    void refreshProviderRoute();
  }, [refreshProviderRoute]);

  const loadProviderBalance = useCallback(
    async (opts?: { force?: boolean; provider?: api.CustomProvider | null }) => {
      const p = opts?.provider ?? activeCustomProvider;
      if (!p || !api.isTauri()) {
        setProviderBalanceCache(null);
        setProviderBalanceError(null);
        return;
      }
      if (
        !supportsProviderBalance({
          providerId: p.id,
          baseUrl: p.baseUrl,
        })
      ) {
        setProviderBalanceCache(null);
        setProviderBalanceError(null);
        return;
      }
      if (
        !opts?.force &&
        isProviderBalanceCacheFresh(providerBalanceCache, p.id)
      ) {
        return;
      }
      setProviderBalanceBusy(true);
      setProviderBalanceError(null);
      try {
        const result = await api.providersBalance({
          providerId: p.id,
          baseUrl: p.baseUrl,
        });
        if (result.ok) {
          setProviderBalanceCache({
            providerId: p.id,
            fetchedAt: Date.now(),
            result,
          });
        } else {
          setProviderBalanceCache((prev) =>
            prev?.providerId === p.id ? null : prev,
          );
          const kind = classifyProviderBalanceError({
            errorKind: result.errorKind,
            error: result.error,
            isTauri: true,
          });
          const key = providerBalanceErrorMessageKey(kind) as MessageKey;
          setProviderBalanceError(
            kind === "other"
              ? tr("prov.balance.err.other", {
                  detail: result.error ?? "unknown",
                })
              : tr(key),
          );
        }
      } catch (e) {
        setProviderBalanceCache((prev) =>
          prev?.providerId === p.id ? null : prev,
        );
        const kind = classifyProviderBalanceError({
          error: String(e),
          isTauri: api.isTauri(),
        });
        const key = providerBalanceErrorMessageKey(kind) as MessageKey;
        setProviderBalanceError(
          kind === "other"
            ? tr("prov.balance.err.other", { detail: String(e) })
            : tr(key),
        );
      } finally {
        setProviderBalanceBusy(false);
      }
    },
    [activeCustomProvider, providerBalanceCache, tr],
  );

  // Prefetch balance when active custom route is DeepSeek.
  useEffect(() => {
    if (!activeCustomProvider) {
      setProviderBalanceCache(null);
      setProviderBalanceError(null);
      return;
    }
    if (
      !supportsProviderBalance({
        providerId: activeCustomProvider.id,
        baseUrl: activeCustomProvider.baseUrl,
      })
    ) {
      setProviderBalanceCache(null);
      setProviderBalanceError(null);
      return;
    }
    // Drop stale cache from another provider id.
    if (
      providerBalanceCache &&
      providerBalanceCache.providerId !== activeCustomProvider.id
    ) {
      setProviderBalanceCache(null);
    }
    void loadProviderBalance({ provider: activeCustomProvider });
    // Intentionally depend on route identity, not the whole load callback (TTL).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefetch on route switch only
  }, [activeCustomProvider?.id, activeCustomProvider?.baseUrl]);

  // Re-evaluate composer mic when switching official ↔ custom provider.
  useEffect(() => {
    void refreshVoiceGate();
  }, [customRouteActive, refreshVoiceGate]);

  /** Effort list for the active channel (custom provider catalog or official). */
  const channelEffortOptions = useMemo(() => {
    if (providerActiveSource !== "custom" || !activeCustomProvider) {
      return null;
    }
    const aligned = alignGrokPresetEfforts({
      providerId: activeCustomProvider.id,
      baseUrl: activeCustomProvider.baseUrl,
      efforts: activeCustomProvider.efforts,
    });
    return effortOptionsFromProvider(
      aligned ?? activeCustomProvider.efforts,
    );
  }, [providerActiveSource, activeCustomProvider]);

  /**
   * Active effort catalog for the composer: custom channel efforts, else the
   * selected official model (grok-4.6 is 4-tier with xhigh).
   */
  const officialEffortCatalog = useMemo(
    () =>
      effortCatalogForRoute({
        model: findModel(modelId, availableModels),
      }),
    [modelId, availableModels],
  );
  const activeEffortCatalog = useMemo(
    () =>
      effortCatalogForRoute({
        model: findModel(modelId, availableModels),
        channelEfforts: channelEffortOptions,
      }),
    [modelId, availableModels, channelEffortOptions],
  );
  const prevEffortCatalogRef = useRef(activeEffortCatalog);

  // When switching channels / catalogs, map effort into the target list
  // (DeepSeek high → Grok medium; xhigh/max → Grok high; reverse accordingly).
  useEffect(() => {
    const source = prevEffortCatalogRef.current;
    prevEffortCatalogRef.current = activeEffortCatalog;
    const next = mapEffortToTargetCatalog(
      effort,
      activeEffortCatalog,
      source,
    );
    if (next !== effort) setEffort(next);
  }, [activeEffortCatalog, effort]);

  const handleEffortPick = useCallback(
    (nextEffort: string) => {
      if (!isValidEffort(nextEffort, activeEffortCatalog)) return;
      setEffort(nextEffort);
      effortApplyRef.current = queueComposerPreferenceApply(
        effortApplyRef.current,
        () =>
          api.composerPrefsSet({
            projectId: activeProject?.id ?? null,
            sessionId: session.sessionId ?? null,
            effort: nextEffort,
          }),
        (error) => showToast(String(error), 4000),
      );
    },
    [activeEffortCatalog, activeProject?.id, session.sessionId, showToast],
  );

  const handleModelPick = useCallback(
    async (pick: ComposerModelPick) => {
      if (modelPickBusy) return;
      setModelPickBusy(true);
      try {
        if (pick.kind === "official") {
          if (providerActiveSource === "custom" && api.isTauri()) {
            await api.providersActivate("official");
            await refreshProviderRoute();
          }
          if (!isValidModelId(pick.modelId, availableModels)) return;
          setModelId(pick.modelId);
          const targetOfficial = effortCatalogForRoute({
            model: findModel(pick.modelId, availableModels),
          });
          const clampedOfficial = mapEffortToTargetCatalog(
            effort,
            targetOfficial,
            channelEffortOptions ?? officialEffortCatalog,
          );
          setEffort(clampedOfficial);
          void api
            .composerPrefsSet({
              projectId: activeProject?.id ?? null,
              sessionId: session.sessionId ?? null,
              modelId: pick.modelId,
              effort: clampedOfficial,
            })
            .catch((e) => showToast(String(e), 4000));
        } else {
          if (!api.isTauri()) return;
          const provider = customProviders.find(
            (p) => p.id === pick.providerId,
          );
          if (!provider) {
            showToast(tr("prov.err.unknownProvider"), 4000);
            return;
          }
          // Switch request model on the channel when needed (keeps multi-model catalog).
          if (provider.model.trim() !== pick.modelId.trim()) {
            const models =
              provider.models?.length
                ? provider.models
                : [{ id: provider.model, name: provider.model }];
            const catalog = models.some((m) => m.id === pick.modelId)
              ? models
              : [
                  ...models,
                  { id: pick.modelId, name: pick.modelId },
                ];
            await api.providersUpsert({
              id: provider.id,
              model: pick.modelId,
              baseUrl: provider.baseUrl,
              name: provider.name,
              apiBackend: provider.apiBackend,
              models: catalog,
              efforts: provider.efforts,
              // Preserve channel context window (Host also keeps on omit; pass
              // explicitly so load/fillback never drops a 1M custom cap).
              contextWindow: provider.contextWindow ?? undefined,
              setAsDefault: false,
            });
          }
          if (
            providerActiveSource !== "custom" ||
            providerActiveId !== pick.providerId
          ) {
            const activated = await api.providersActivate(
              "custom",
              pick.providerId,
            );
            // #557: custom routes require independent agent-home GROK_HOME.
            if (activated.switchedToIndependent) {
              setSessionDataMode("independent");
              showToast(tr("prov.switchedToIndependent"), 5200);
            }
          }
          await refreshProviderRoute();
          // Map effort into the picked channel's catalog (Grok ↔ DeepSeek tiers).
          const alignedPick = alignGrokPresetEfforts({
            providerId: provider.id,
            baseUrl: provider.baseUrl,
            efforts: provider.efforts,
          });
          const nextEfforts =
            effortOptionsFromProvider(alignedPick ?? provider.efforts) ??
            GROK_BUILD_EFFORTS;
          const clampedCustom = mapEffortToTargetCatalog(
            effort,
            nextEfforts,
            channelEffortOptions ?? officialEffortCatalog,
          );
          setEffort(clampedCustom);
          void api
            .composerPrefsSet({
              projectId: activeProject?.id ?? null,
              sessionId: session.sessionId ?? null,
              modelId: pick.modelId,
              effort: clampedCustom,
            })
            .catch((e) => showToast(String(e), 4000));
        }
      } catch (e) {
        showToast(String(e), 4000);
      } finally {
        setModelPickBusy(false);
      }
    },
    [
      modelPickBusy,
      providerActiveSource,
      providerActiveId,
      availableModels,
      customProviders,
      activeProject?.id,
      session.sessionId,
      effort,
      channelEffortOptions,
      officialEffortCatalog,
      refreshProviderRoute,
      showToast,
      tr,
      channelEffortOptions,
      officialEffortCatalog,
    ],
  );
  const handleContextWindow = useCallback(
    async (tokens: number) => {
      if (!api.isTauri() || !activeCustomProvider) return;
      try {
        await api.providersUpsert({
          id: activeCustomProvider.id,
          model: activeCustomProvider.model,
          baseUrl: activeCustomProvider.baseUrl,
          name: activeCustomProvider.name,
          apiBackend: activeCustomProvider.apiBackend,
          models: activeCustomProvider.models,
          efforts: activeCustomProvider.efforts,
          setAsDefault: false,
          contextWindow: tokens,
        });
        await refreshProviderRoute();
      } catch (e) {
        showToast(String(e), 4000);
      }
    },
    [activeCustomProvider, refreshProviderRoute, showToast],
  );
  const liveBrandKind = useMemo(
    () =>
      superGrokBrandKind(
        account?.billing,
        !!account?.profile?.signedIn,
      ),
    [account?.billing, account?.profile?.signedIn],
  );
  useEffect(() => {
    // Do not cache Heavy while on a custom route — welcome mark is always SuperGrok.
    if (customRouteActive) return;
    if (liveBrandKind) {
      saveCachedSuperGrokBrand(liveBrandKind);
      setCachedBrandKind(liveBrandKind);
      return;
    }
    if (account && !account.profile.signedIn) {
      saveCachedSuperGrokBrand(null);
      setCachedBrandKind(null);
    }
  }, [liveBrandKind, account, customRouteActive]);
  const welcomeBrandKind = useMemo(
    () =>
      resolveWelcomeBrandKind(liveBrandKind, cachedBrandKind, {
        accountReady: account != null,
        signedIn: !!account?.profile?.signedIn,
        customRoute: customRouteActive,
      }),
    [liveBrandKind, cachedBrandKind, account, customRouteActive],
  );

  /**
   * Preset provider wordmark on the welcome composer.
   * DeepSeek → full DeepSeek wordmark; OpenCode → theme-aware wordmark;
   * Volcengine Ark → logo + “火山方舟”; every other channel keeps SuperGrok.
   */
  const welcomeProviderBrandNode = useMemo(() => {
    if (!customRouteActive) return null;
    const brand = resolveProviderBrandId({
      providerId: activeCustomProvider?.id ?? null,
      baseUrl: activeCustomProvider?.baseUrl ?? null,
    });
    if (brand === "deepseek") {
      return <DeepSeekFullMark title="DeepSeek" />;
    }
    if (brand === "opencode-go") {
      return <OpenCodeWordmark title="OpenCode" />;
    }
    if (brand === "volcano-ark") {
      return <VolcanoArkWelcomeMark title="火山方舟" />;
    }
    return null;
  }, [customRouteActive, activeCustomProvider]);

  // Floating composer height → chat bottom pad so messages can scroll under it.
  // ResizeObserver covers typing growth; no draft subscription (would thrash shell).
  useEffect(() => {
    if (mainPane !== "chat") return;
    const el = composerWrapRef.current;
    if (!el) return;
    const measure = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h <= 0) return;
      // Ignore 1px subpixel flicker — pad thrash reflows chat scrollHeight
      // and looks like the transcript bouncing while you type/scroll.
      setComposerFloatPad((prev) => (Math.abs(prev - h) <= 1 ? prev : h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [
    mainPane,
    attachments.length,
    showComposerPlus,
    messages.length,
    welcomeSession,
    welcomeBrandKind,
  ]);

  const sidebarPaint =
    layout.sidebarCollapsed || sidebarOverlay
      ? 0
      : layout.sidebarWidth || SIDEBAR_DEFAULT_WIDTH;
  const asidePaint =
    layout.asideCollapsed || asideOverlay ? 0 : layout.asideWidth;
  const sideDockActive = isSideDockComposerActive({
    expanded: sideWorkbench.expanded,
    dockComposer: sideDockComposer,
    phoneLayout,
  });
  const dockSidebarOccupied =
    phoneLayout || layout.sidebarCollapsed || sidebarOverlay
      ? 0
      : layout.sidebarWidth;

  // Expand ends → close dock toggle.
  useEffect(() => {
    if (sideWorkbench.expanded) return;
    setSideDockComposer(false);
    setSideDockComposerH(0);
  }, [sideWorkbench.expanded]);

  // Dock on: measure composer height → shrink side pane bottom.
  // Webview host follows aside height (no native hole-punch).
  useEffect(() => {
    if (!sideDockActive) {
      setSideDockComposerH(0);
      return;
    }
    const el = composerWrapRef.current;
    if (!el) {
      setSideDockComposerH(0);
      return;
    }
    const measure = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h <= 0) return;
      setSideDockComposerH((prev) => (Math.abs(prev - h) <= 1 ? prev : h));
    };
    measure();
    // Double rAF: portal + dock CSS settle before first measure.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(measure);
    });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      ro.disconnect();
    };
  }, [
    sideDockActive,
    mainPane,
    attachments.length,
    showComposerPlus,
    welcomeSession,
  ]);

  const onToggleSideDockComposer = useCallback(() => {
    setSideDockComposer((on) => !on);
  }, []);

  const stop = async () => {
    const now = Date.now();
    // Composer Stop scope = current viewed chat only (not global Stop-all).
    // Preferring the Host live slot cancelled a foreign turn whenever the
    // viewed chat had been demoted to background.
    const sid =
      resolveStopTargets({
        scope: "current",
        currentSessionId:
          viewingSessionIdRef.current || liveHostRef.current.sessionId || null,
        busySessionIds: [],
      })[0] ?? null;
    const armed = armStopLatch(stopLatchRef.current, sid, now);
    stopLatchRef.current = armed;
    setStopLatch(armed);

    /** Always clear local busy chrome for this chat (ghost / sticky stream). */
    const forceUnlockLocal = (id: string | null, reason: "ok" | "force") => {
      if (!id) {
        setMessages((m) => m.map((x) => ({ ...x, streaming: false })));
        return;
      }
      settleStoppedSessionUi(id);
      clearPendingGates(id);
      if (
        id ===
        (viewingSessionIdRef.current || liveHostRef.current.sessionId)
      ) {
        setAskUser(null);
        setPerm(null);
      }
      patchSessionMessages(id, (m) =>
        m.map((x) => ({ ...x, streaming: false })),
      );
      patchSessionMessages(id, (prev) => {
        if (
          prev.some(
            (x) =>
              x.marker === "turn_end" ||
              x.marker === "turn_cancelled" ||
              x.content?.startsWith("turn_end|") ||
              x.content?.startsWith("turn_cancelled|"),
          )
        ) {
          return prev;
        }
        return applyTurnMarker(prev, {
          sessionId: id,
          messageId: `end-stop-${reason}-${Date.now()}`,
          marker: "turn_end",
          reason: "user_stop",
          content: endOfTurnMarkerContent("user_stop"),
        });
      });
      setRetryStatus(null);
      setStreamStall(null);
      clearTurnClock(id);
    };

    // Optimistic unlock: sticky "thinking" + wedged cancel used to keep the
    // UI busy until `sessionStop` returned (or forever on Host hang).
    forceUnlockLocal(sid, "force");

    let timeoutSettledSessionId: string | null = sid;
    // Force-unlock again if Host stays busy past STOP_LATCH_MS.
    window.setTimeout(() => {
      // Prefer this chat's liveMap row; fall back to focused Host slot.
      const mapState =
        (sid && liveMapRef.current[sid]?.state) || liveHostRef.current.state;
      const tick = tickStopLatch(
        stopLatchRef.current,
        mapState,
        Date.now(),
        STOP_LATCH_MS,
      );
      stopLatchRef.current = tick.latch;
      setStopLatch(tick.latch);
      if (tick.forceComplete) {
        const id = sid || liveHostRef.current.sessionId;
        timeoutSettledSessionId = id;
        forceUnlockLocal(id, "force");
      }
    }, STOP_LATCH_MS + 50);
    try {
      await api.sessionStop(sid);
      setRetryStatus(null);
      setStreamStall(null);
      clearTurnClock(sid);
      // Stop must dismiss ask-user / permission gates even if Host event is late.
      {
        const gateId =
          sid ||
          viewingSessionIdRef.current ||
          liveHostRef.current.sessionId ||
          null;
        if (gateId) clearPendingGates(gateId);
        setAskUser(null);
        setPerm(null);
      }
      const liveId = sid || liveHostRef.current.sessionId;
      if (liveId && timeoutSettledSessionId !== liveId) {
        forceUnlockLocal(liveId, "ok");
      } else if (liveId) {
        // Already optimistically unlocked — still ensure Host projection Ready.
        settleStoppedSessionUi(liveId);
        patchSessionMessages(liveId, (m) =>
          m.map((x) => ({ ...x, streaming: false })),
        );
      }
      const cleared = createStopLatchState();
      stopLatchRef.current = cleared;
      setStopLatch(cleared);
    } catch (e) {
      // Host stop can fail ("no active session") while UI still shows thinking.
      // Always finish local unlock so Stop never leaves a dead busy shell.
      forceUnlockLocal(sid || liveHostRef.current.sessionId, "force");
      const cleared = createStopLatchState();
      stopLatchRef.current = cleared;
      setStopLatch(cleared);
      setLocalError(String(e));
    }
  };

  const resetLiveAfterMove = useCallback(
    (sessionId: string) => {
      setSession((prev) =>
        prev.sessionId === sessionId
          ? {
              ...IDLE_SNAPSHOT,
              sessionId,
              title: prev.title,
              state: "idle",
              backend: prev.backend || "grok_agent_stdio",
            }
          : prev,
      );
      setLiveHost((prev) =>
        prev.sessionId === sessionId ? { ...IDLE_SNAPSHOT } : prev,
      );
    },
    [setLiveHost, setSession],
  );

  const { requestMove, moveMenuItemsFor, bulkMoveMenuItems } =
    useSessionMoveProject({
      tr,
      projects,
      sessions,
      busyIds,
      viewingSessionId: session.sessionId,
      setAppDialog,
      showToast,
      setSessions,
      setActiveProject,
      setExpandedProjects,
      setHistoryOpen,
      onViewingMoved: resetLiveAfterMove,
      refreshSessions,
      onMoved: exitSessionSelectMode,
    });

  useSidebarSessionMoveDrag({
    enabled: !phoneLayout && !isMirrorClient(),
    sessions,
    selectedIds: selectedSessionIds,
    selectMode: sessionSelectMode,
    formatGhost: (count, title) =>
      count > 1
        ? tr("session.move.ghostMany", { n: String(count) })
        : title || tr("session.untitled"),
    onDrop: requestMove,
    onAttach: (rows) => {
      for (const row of rows) {
        applyAttachedChat(row.id, row.title, row.updatedAt);
      }
    },
  });

  /**
   * Bind the open session's project. Draft chats only switch workspace context.
   * Existing chats go through the confirmed move path (cwd + agent reset).
   */
  const bindSessionProject = useCallback(
    async (proj: Project | null) => {
      const target = proj && !isGeneralProject(proj) ? proj : null;
      const sid = session.sessionId;
      if (!sid || !api.isTauri()) {
        setActiveProject(target);
        if (target) {
          setExpandedProjects((e) => ({ ...e, [target.id]: true }));
        } else {
          setHistoryOpen(true);
        }
        return;
      }
      const row = sessions.find((s) => s.id === sid);
      if (!row) {
        setActiveProject(target);
        return;
      }
      requestMove([row], target?.id ?? null);
    },
    [requestMove, session.sessionId, sessions],
  );

  const gitWorktreesReqRef = useRef(0);
  const gitWorktreesPathRef = useRef<string | null>(null);
  const refreshGitWorktrees = useCallback(async () => {
    const path = activeProject?.path?.trim() || null;
    if (!path || !api.isTauri()) {
      gitWorktreesReqRef.current += 1;
      gitWorktreesPathRef.current = null;
      setGitWorktrees([]);
      setGitWorktreesAvailable(null);
      setGitWorktreesReason(null);
      setCliGrokHome(null);
      setGitWorktreesLoading(false);
      return;
    }
    const reqId = ++gitWorktreesReqRef.current;
    // Drop stale rows when the active project path changes; soft-refresh keeps
    // the previous list for the same path so the menu does not flash empty.
    if (gitWorktreesPathRef.current !== path) {
      gitWorktreesPathRef.current = path;
      setGitWorktrees([]);
      setGitWorktreesAvailable(null);
      setGitWorktreesReason(null);
    }
    setGitWorktreesLoading(true);
    try {
      const res = await api.gitWorktreesList(path);
      if (reqId !== gitWorktreesReqRef.current) return;
      const home = (res.cliGrokHome || "").trim() || null;
      if (home) setCliGrokHome(home);
      if (!res.available) {
        setGitWorktrees([]);
        setGitWorktreesAvailable(false);
        setGitWorktreesReason(res.reason?.trim() || "unavailable");
      } else {
        setGitWorktrees(res.worktrees ?? []);
        setGitWorktreesAvailable(true);
        setGitWorktreesReason(null);
      }
    } catch (e) {
      if (reqId !== gitWorktreesReqRef.current) return;
      setGitWorktrees([]);
      setGitWorktreesAvailable(false);
      setGitWorktreesReason(String(e));
    } finally {
      if (reqId === gitWorktreesReqRef.current) {
        setGitWorktreesLoading(false);
      }
    }
  }, [activeProject?.path]);

  useEffect(() => {
    void refreshGitWorktrees();
  }, [refreshGitWorktrees]);

  const cliWorktreesReqRef = useRef(0);
  const refreshCliWorktrees = useCallback(async () => {
    if (!api.isTauri()) {
      cliWorktreesReqRef.current += 1;
      setCliWorktrees([]);
      setCliWorktreesAvailable(null);
      setCliWorktreesReason(null);
      setCliWorktreesLoading(false);
      return;
    }
    const reqId = ++cliWorktreesReqRef.current;
    setCliWorktreesLoading(true);
    try {
      const projectPath = activeProject?.path?.trim() || null;
      const repoSlug = projectPath
        ? projectPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ||
          null
        : null;
      const res = await api.cliWorktreesList({
        all: false,
        // CLI --repo matches repo_name (e.g. grok-app), not folder basename.
        // Leave unfiltered; UI filters by source path / worktrees slug.
        repo: null,
      });
      if (reqId !== cliWorktreesReqRef.current) return;
      if (!res.available) {
        setCliWorktrees([]);
        setCliWorktreesAvailable(false);
        setCliWorktreesReason(res.reason?.trim() || "unavailable");
      } else {
        // Prefer rows for the active project when we can match source/repo.
        const filtered = filterCliWorktreesForProject(
          res.worktrees ?? [],
          projectPath,
          repoSlug,
        );
        setCliWorktrees(filtered);
        setCliWorktreesAvailable(true);
        setCliWorktreesReason(null);
      }
    } catch (e) {
      if (reqId !== cliWorktreesReqRef.current) return;
      setCliWorktrees([]);
      setCliWorktreesAvailable(false);
      setCliWorktreesReason(String(e));
    } finally {
      if (reqId === cliWorktreesReqRef.current) {
        setCliWorktreesLoading(false);
      }
    }
  }, [activeProject?.path]);

  useEffect(() => {
    // Load CLI list when the branch menu can appear (git work tree confirmed).
    if (gitWorktreesAvailable === true) {
      void refreshCliWorktrees();
    } else if (gitWorktreesAvailable === false) {
      cliWorktreesReqRef.current += 1;
      setCliWorktrees([]);
      setCliWorktreesAvailable(null);
      setCliWorktreesReason(null);
      setCliWorktreesLoading(false);
    }
  }, [gitWorktreesAvailable, refreshCliWorktrees]);

  /**
   * Poll workspace git status for the active project so the composer dirty chip
   * stays current (hide when clean / not a repo). Soft-fail; no toast spam.
   */
  const gitDirtyReqRef = useRef(0);
  const refreshGitDirtyStatus = useCallback(async () => {
    const path = activeProject?.path?.trim() || null;
    if (!path || !api.isTauri()) {
      gitDirtyReqRef.current += 1;
      setGitDirtySummary((prev) => (prev == null ? prev : null));
      return;
    }
    const reqId = ++gitDirtyReqRef.current;
    try {
      const status = await api.gitStatus(path);
      if (reqId !== gitDirtyReqRef.current) return;
      const next = summarizeGitDirty(status);
      setGitDirtySummary((prev) =>
        gitDirtySummariesEqual(prev, next) ? prev : next,
      );
      // Same poll already has HEAD. Patch the composer branch chip so an
      // in-place checkout does not stay stale until the menu is clicked.
      setGitWorktrees((prev) => applyGitStatusBranch(prev, path, status));
    } catch {
      if (reqId !== gitDirtyReqRef.current) return;
      setGitDirtySummary((prev) => (prev == null ? prev : null));
    }
  }, [activeProject?.path]);

  useEffect(() => {
    void refreshGitDirtyStatus();
    // Soft poll while a project is bound; refresh sooner on focus.
    // Faster while a turn is live — agent may `git switch` mid-session.
    const path = activeProject?.path?.trim() || null;
    if (!path || !api.isTauri()) return;
    const busy =
      session.state === "streaming" || session.state === "awaiting_permission";
    const intervalMs = busy ? 2000 : 8000;
    const id = window.setInterval(() => {
      void refreshGitDirtyStatus();
    }, intervalMs);
    const onFocus = () => {
      void refreshGitDirtyStatus();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [
    activeProject?.path,
    refreshGitDirtyStatus,
    session.sessionId,
    session.state,
  ]);

  /**
   * After a project is created/updated: refresh list, expand, optionally trust
   * via in-app confirm, then set active (+ bind session when requested).
   */
  const finalizeAddedProject = useCallback(
    async (p: Project, opts: { bindSession: boolean }) => {
      const list = mapProjectsList((await api.projectsList()) as Project[]);
        setProjects(list);
      projectSpaces.assignNewProjects([p.id]);
      setSetup((s) => ({ ...s, project: true }));

      const apply = async (proj: Project) => {
        const fresh = mapProjectsList((await api.projectsList()) as Project[]);
        setProjects(fresh);
        const current = fresh.find((x) => x.id === proj.id) ?? proj;
        if (opts.bindSession) {
          await bindSessionProject(current);
        } else {
          setActiveProject(current);
          setExpandedProjects((e) => ({ ...e, [current.id]: true }));
        }
      };

      // Tauri WebView: never use window.confirm — offer in-app trust dialog.
      if (!p.trusted) {
        setAppDialog({
          kind: "confirm",
          title: tr("project.trustTitle"),
          message: tr("project.trustConfirm", {
            name: p.name,
            path: p.path,
          }),
          confirmLabel: tr("project.trustToSend", { name: p.name }),
          onConfirm: async () => {
            try {
              const trusted = (await api.projectTrust(p.id)) as Project;
              await apply(trusted);
              maybeOfferSandboxWizardAfterTrust();
            } catch (e) {
              setLocalError(String(e));
            }
          },
        });
        return;
      }
      await apply(p);
    },
    [
      bindSessionProject,
      maybeOfferSandboxWizardAfterTrust,
      projectSpaces,
      setAppDialog,
      showToast,
      tr,
    ],
  );

  /** Open gc dialog and run dry-run preview. */
  const openWorktreeGc = useCallback(() => {
    setWorktreeGcForce(false);
    setWorktreeGcError(null);
    setWorktreeGcBusy(false);
    setWorktreeGcPreview(null);
    setWorktreeGcOpen(true);
  }, []);

  /** Open Ship… dialog for the active project / worktree cwd. */
  const openShipFlow = useCallback(() => {
    if (!api.isTauri() || !activeProject?.path) {
      showToast(tr("composer.worktreeShipNeedProject"), 3500);
      return;
    }
    const current =
      gitWorktrees.find((w) => pathsEqual(w.path, activeProject.path)) ?? null;
    const branch =
      current?.branch?.trim() ||
      (session.sessionId
        ? sessions.find((s) => s.id === session.sessionId)?.worktreeBranch
        : null) ||
      null;
    if (
      !canShipWorktree({
        branch,
        detached: current?.detached ?? !branch,
        available: gitWorktreesAvailable,
      })
    ) {
      // Still allow open with empty title if branch unknown — host resolves HEAD.
      // But refuse detached when we know it.
      if (current?.detached) {
        showToast(tr("composer.worktreeShipDetached"), 4000);
        return;
      }
    }
    setShipBranch(branch);
    setShipTitle(defaultPrTitleFromBranch(branch));
    setShipBody("");
    setShipDraft(false);
    setShipCreatePr(true);
    setShipError(null);
    setShipStatus(null);
    setShipSuccess(null);
    setShipBusy(false);
    setShipOpen(true);
  }, [
    activeProject?.path,
    gitWorktrees,
    gitWorktreesAvailable,
    session.sessionId,
    sessions,
    showToast,
    tr,
  ]);

  /** Close ship dialog and clear transient success state. */
  const closeShipFlow = useCallback(() => {
    if (shipBusy) return;
    setShipOpen(false);
    setShipError(null);
    setShipStatus(null);
    setShipSuccess(null);
  }, [shipBusy]);

  /**
   * Navigate to Settings → Runtime → Tools PR hub for the active project,
   * optionally highlighting a PR number. Soft-fails with a toast (never throws).
   */
  const openPrHubFromShip = useCallback(
    (prNumber: number | null) => {
      try {
        if (!activeProject?.path?.trim()) {
          showToast(tr("composer.worktreeShipOpenHubFailed"), 4000);
          return;
        }
        setPrHubHighlightPr(prNumber);
        setSettingsFocusAnchor(PR_HUB_ANCHOR_ID);
        navigateSettings("runtime", "tools");
        if (typeof window !== "undefined") {
          const hash = buildPrHubDeepLink({ prNumber });
          if (window.location.hash !== hash) {
            window.location.hash = hash;
          }
        }
        setShipOpen(false);
        setShipSuccess(null);
        setShipError(null);
        setShipStatus(null);
      } catch {
        showToast(tr("composer.worktreeShipOpenHubFailed"), 4000);
      }
    },
    [activeProject?.path, navigateSettings, showToast, tr],
  );

  const submitShipFlow = useCallback(async () => {
    if (!api.isTauri() || !activeProject?.path) return;
    let title: string;
    let body: string;
    try {
      title = sanitizePrTitle(shipTitle);
      body = sanitizePrBody(shipBody);
    } catch (e) {
      setShipError(String(e));
      return;
    }
    setShipBusy(true);
    setShipError(null);
    setShipSuccess(null);
    setShipStatus(tr("composer.worktreeShipPushing"));
    try {
      const push = await api.gitPushBranch(activeProject.path);
      let pr: api.GhPrCreateResult | null = null;
      if (shipCreatePr) {
        setShipStatus(tr("composer.worktreeShipCreatingPr"));
        pr = await api.ghPrCreate({
          projectPath: activeProject.path,
          title,
          body,
          draft: shipDraft,
          base: "main",
        });
      }
      const outcome = combineShipOutcome(push, pr, {
        createPr: shipCreatePr,
      });
      const summary = shipOutcomeSummary(outcome);
      if (outcome.ok) {
        setShipStatus(null);
        if (outcome.prUrl) {
          // Success panel: PR URL + Open in PR hub (do not force-close).
          const prNumber = parseGithubPrNumber(outcome.prUrl);
          setShipSuccess({ prUrl: outcome.prUrl, prNumber });
        } else {
          setShipOpen(false);
          setShipSuccess(null);
        }
      } else {
        const detail = redactShipOutput(
          outcome.failReason ||
            pr?.reason ||
            push.reason ||
            summary ||
            "ship failed",
          600,
        );
        setShipError(detail);
        setShipStatus(null);
        // Honest toast — never claim PR opened when gh failed.
        showToast(
          shipCreatePr
            ? tr("composer.worktreeShipFailed", { reason: detail })
            : tr("composer.worktreeShipPushFailed", { reason: detail }),
          6000,
        );
      }
    } catch (e) {
      const msg = redactShipOutput(String(e), 600);
      setShipError(msg);
      setShipStatus(null);
      showToast(tr("composer.worktreeShipFailed", { reason: msg }), 6000);
    } finally {
      setShipBusy(false);
    }
  }, [
    activeProject?.path,
    shipBody,
    shipCreatePr,
    shipDraft,
    shipTitle,
    showToast,
    tr,
  ]);

  /** Dry-run `git worktree prune` for the modal preview. */
  const refreshWorktreeGcPreview = useCallback(async () => {
    if (!api.isTauri() || !activeProject?.path || !worktreeGcOpen) return;
    setWorktreeGcPreviewBusy(true);
    setWorktreeGcError(null);
    try {
      const res = await api.gitWorktreeGc(
        activeProject.path,
        true,
        worktreeGcForce,
      );
      setWorktreeGcPreview(res);
    } catch (e) {
      setWorktreeGcPreview(null);
      setWorktreeGcError(String(e));
    } finally {
      setWorktreeGcPreviewBusy(false);
    }
  }, [activeProject?.path, worktreeGcForce, worktreeGcOpen]);

  useEffect(() => {
    if (!worktreeGcOpen) return;
    void refreshWorktreeGcPreview();
  }, [worktreeGcOpen, refreshWorktreeGcPreview]);

  /** Apply prune (non-dry-run), refresh list, toast. */
  const submitWorktreeGc = useCallback(async () => {
    if (!api.isTauri() || !activeProject?.path) return;
    setWorktreeGcBusy(true);
    setWorktreeGcError(null);
    try {
      setWorktreeGcOpen(false);
      setWorktreeGcPreview(null);
      setWorktreeGcForce(false);
      await refreshGitWorktrees();
    } catch (e) {
      setWorktreeGcError(String(e));
    } finally {
      setWorktreeGcBusy(false);
    }
  }, [
    activeProject?.path,
    refreshGitWorktrees,
    showToast,
    tr,
    worktreeGcForce,
  ]);

  /** Open a linked worktree as project cwd (reuse existing project if path matches). */
  const switchToWorktree = useCallback(
    async (wt: api.GitWorktreeEntry) => {
      if (!api.isTauri()) return;
      const path = wt.path?.trim();
      if (!path) return;
      try {
        const existing = projects.find((p) => pathsEqual(p.path, path));
        if (existing) {
          await bindSessionProject(existing);
          return;
        }
        const trust = !!activeProject?.trusted;
        const added = (await api.projectAdd(path, trust)) as Project;
        const list = mapProjectsList((await api.projectsList()) as Project[]);
        setProjects(list);
        projectSpaces.assignNewProjects([added.id]);
        const proj = list.find((p) => p.id === added.id) ?? added;
        if (!proj.trusted) {
          await finalizeAddedProject(proj, { bindSession: true });
        } else {
          await bindSessionProject(proj);
        }
      } catch (e) {
        showToast(String(e), 4500);
      }
    },
    [
      activeProject?.trusted,
      bindSessionProject,
      finalizeAddedProject,
      projects,
      showToast,
      tr,
    ],
  );

  /**
   * Remove a live linked worktree via host `git_worktree_remove`.
   * Never removes main. Dirty trees: first attempt without force, then
   * in-app confirm for force. If the active cwd is removed, switch to main.
   */
  const executeWorktreeRemove = useCallback(
    async (wt: api.GitWorktreeEntry, force: boolean) => {
      if (!api.isTauri() || !canRemoveWorktree(wt)) return;
      const mainPath =
        mainWorktreePath(gitWorktrees) || activeProject?.path?.trim() || "";
      if (!mainPath) {
        showToast(tr("composer.worktreeRemoveFailed"), 4000);
        return;
      }
      const wasCurrent = pathsEqual(wt.path, activeProject?.path);
      try {
        await api.gitWorktreeRemove({
          projectPath: mainPath,
          worktreePath: wt.path,
          force,
        });
        // Drop WT meta on sessions that pointed at the removed tree.
        try {
          const linked = sessions.filter(
            (s) =>
              s.isWorktreeSession ||
              pathsEqual(s.worktreePath, wt.path),
          );
          for (const s of linked) {
            if (
              pathsEqual(s.worktreePath, wt.path) ||
              (!s.worktreePath &&
                pathsEqual(
                  projects.find((p) => p.id === s.projectId)?.path,
                  wt.path,
                ))
            ) {
              await api.sessionSetWorktree(s.id, {
                worktreePath: null,
                worktreeBranch: null,
              });
            }
          }
          if (linked.length) await refreshSessions();
        } catch {
          /* soft-fail */
        }
        if (wasCurrent) {
          const main =
            gitWorktrees.find((w) => w.isMain) ??
            gitWorktrees.find((w) => pathsEqual(w.path, mainPath)) ??
            null;
          if (main) {
            await switchToWorktree(main);
          } else {
            await refreshGitWorktrees();
          }
        } else {
          await refreshGitWorktrees();
        }
      } catch (e) {
        const err = String(e);
        if (!force && worktreeRemoveErrorSuggestsForce(err)) {
          setAppDialog({
            kind: "confirm",
            title: tr("composer.worktreeRemoveTitle"),
            message: `${tr("composer.worktreeRemoveForce")}\n\n${err}`,
            confirmLabel: tr("composer.worktreeRemove"),
            danger: true,
            onConfirm: () => {
              void executeWorktreeRemove(wt, true);
            },
          });
          return;
        }
        showToast(
          `${tr("composer.worktreeRemoveFailed")}: ${err}`,
          5000,
        );
      }
    },
    [
      activeProject?.path,
      gitWorktrees,
      projects,
      // refreshSessions via closure
      sessions,
      refreshGitWorktrees,
      showToast,
      switchToWorktree,
      tr,
    ],
  );

  const confirmRemoveWorktree = useCallback(
    (wt: api.GitWorktreeEntry) => {
      if (!canRemoveWorktree(wt)) return;
      const branch =
        wt.branch?.trim() || tr("composer.worktreeDetached");
      const isCurrent = pathsEqual(wt.path, activeProject?.path);
      const parts = [
        tr("composer.worktreeRemoveHint"),
        tr("composer.worktreeRemoveConfirm", {
          branch,
          path: wt.path,
        }),
      ];
      if (isCurrent) {
        parts.push(tr("composer.worktreeRemoveCurrentWarn"));
      }
      setAppDialog({
        kind: "confirm",
        title: tr("composer.worktreeRemoveTitle"),
        message: parts.join("\n\n"),
        confirmLabel: tr("composer.worktreeRemove"),
        danger: true,
        onConfirm: () => {
          void executeWorktreeRemove(wt, false);
        },
      });
    },
    [activeProject?.path, executeWorktreeRemove, tr],
  );

  const openWorktreeCreate = useCallback((opts?: { startNewChat?: boolean }) => {
    setWorktreeCreateName("");
    setWorktreeCreateRef("");
    setWorktreeCreateLayout("cli");
    setWorktreeCreateError(null);
    setWorktreeCreateBusy(false);
    setWorktreeCreateStartChat(!!opts?.startNewChat);
    setWorktreeCreateOpen(true);
  }, []);

  const worktreeCreatePreviewPath = (() => {
    try {
      const main = mainWorktreePath(gitWorktrees) || activeProject?.path || "";
      if (!main || !worktreeCreateName.trim()) return null;
      const layout = normalizeWorktreeLayout(worktreeCreateLayout);
      if (layout === "cli" && !cliGrokHome) {
        // Host has not reported home yet — show tilde form for CLI layout.
        return buildWorktreePath(
          "cli",
          main,
          worktreeCreateName.trim(),
          "~/.grok",
        );
      }
      return buildWorktreePath(
        layout,
        main,
        worktreeCreateName.trim(),
        cliGrokHome,
      );
    } catch {
      return null;
    }
  })();

  /**
   * Persist worktree path/branch on a session (sidebar WT badge + manage menu).
   * Soft-fails so create/switch UX is never blocked by meta write errors.
   */
  const markSessionWorktree = useCallback(
    async (
      sessionId: string | null | undefined,
      path: string,
      branch: string | null | undefined,
    ) => {
      if (!sessionId || !api.isTauri()) return;
      const p = path.trim();
      if (!p) return;
      try {
        await api.sessionSetWorktree(sessionId, {
          worktreePath: p,
          worktreeBranch: (branch || "").trim() || null,
        });
        await refreshSessions();
      } catch {
        /* soft-fail */
      }
    },
    // refreshSessions is stable enough via closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** Resolve WT/CLI badge for a session row (meta first, git list fallback). */
  const sessionWorktreeBadgeFor = useCallback(
    (s: SessionRow): SessionWorktreeBadge | null => {
      const proj = s.projectId
        ? projects.find((p) => p.id === s.projectId) ?? null
        : null;
      return resolveSessionWorktreeBadge(
        {
          worktreePath: s.worktreePath,
          worktreeBranch: s.worktreeBranch,
          isWorktreeSession: s.isWorktreeSession,
        },
        proj?.path ?? s.worktreePath,
        gitWorktrees,
        { grokHome: cliGrokHome },
      );
    },
    [cliGrokHome, gitWorktrees, projects],
  );

  /** Pre-translated worktree chip for memoized SidebarSessionRow. */
  const buildSidebarWorktreeBadge = useCallback(
    (s: SessionRow): SidebarSessionWorktreeBadgeProp | null => {
      const wtBadge = sessionWorktreeBadgeFor(s);
      if (!wtBadge) return null;
      const title = sessionWorktreeTooltip(wtBadge, {
        detachedLabel: tr("composer.worktreeDetached"),
        cliLayoutLabel: tr("session.worktreeLayoutCli"),
        siblingLayoutLabel: tr("session.worktreeLayoutSibling"),
        otherLayoutLabel: tr("session.worktreeBadge"),
      });
      const ariaKey =
        wtBadge.layoutKind === "cli"
          ? "session.worktreeBadgeCliAria"
          : "session.worktreeBadgeAria";
      return {
        label: wtBadge.label,
        branch: wtBadge.branch,
        layoutKind: wtBadge.layoutKind,
        title,
        ariaLabel: tr(ariaKey, {
          branch: wtBadge.branch || tr("composer.worktreeDetached"),
        }),
      };
    },
    [sessionWorktreeBadgeFor, tr],
  );

  /**
   * Create worktree → refresh list → add as project (trust inherited) →
   * either bind current session or start a draft chat on that path.
   * Worktree+chat creates a real session immediately so meta can be persisted.
   */
  const submitWorktreeCreate = useCallback(async () => {
    if (!api.isTauri() || !activeProject?.path) return;
    const rawName = worktreeCreateName.trim();
    if (!rawName) {
      setWorktreeCreateError(tr("composer.worktreeNameRequired"));
      return;
    }
    let safeName: string;
    try {
      safeName = sanitizeWorktreeName(rawName);
    } catch {
      setWorktreeCreateError(tr("composer.worktreeNameInvalid"));
      return;
    }
    let start: string | null;
    try {
      start = sanitizeWorktreeRef(worktreeCreateRef);
    } catch {
      setWorktreeCreateError(tr("composer.worktreeRefInvalid"));
      return;
    }
    const layout = normalizeWorktreeLayout(worktreeCreateLayout);
    setWorktreeCreateBusy(true);
    setWorktreeCreateError(null);
    try {
      const created = await api.gitWorktreeAdd(
        activeProject.path,
        safeName,
        start,
        layout,
      );
      setWorktreeCreateOpen(false);
      await refreshGitWorktrees();

      const path = created.path;
      const branch =
        created.branch?.trim() ||
        created.name ||
        tr("composer.worktreeDetached");
      const trust = !!activeProject.trusted;
      const startChat = worktreeCreateStartChat;
      const existing = projects.find((p) => pathsEqual(p.path, path));
      let target: Project | null = existing ?? null;
      if (!target) {
        const added = (await api.projectAdd(path, trust)) as Project;
        const list = mapProjectsList((await api.projectsList()) as Project[]);
        setProjects(list);
        projectSpaces.assignNewProjects([added.id]);
        target = list.find((p) => p.id === added.id) ?? added;
      }

      if (!target.trusted) {
        // Trust prompt first; bind only (chat requires trusted project).
        await finalizeAddedProject(target, { bindSession: true });
        return;
      }

      if (startChat) {
        // Materialize session now so worktree meta survives before first send.
        const meta = (await api.sessionCreate(
          target.id,
          tr("session.new"),
        )) as SessionRow & { id: string; title?: string };
        await markSessionWorktree(meta.id, path, branch);
        const row = normalizeSessionRow({
          ...meta,
          projectId: target.id,
          worktreePath: path,
          worktreeBranch: branch,
          isWorktreeSession: true,
        });
        setExpandedProjects((e) => ({ ...e, [target!.id]: true }));
        await openSession(row, target);
      } else {
        await bindSessionProject(target);
        // Tag the currently open chat when switching cwd into the new worktree.
        const liveId =
          viewingSessionIdRef.current || session.sessionId || null;
        if (liveId) {
          await markSessionWorktree(liveId, path, branch);
        }
      }
    } catch (e) {
      setWorktreeCreateError(String(e));
    } finally {
      setWorktreeCreateBusy(false);
    }
  }, [
    activeProject?.path,
    activeProject?.trusted,
    bindSessionProject,
    finalizeAddedProject,
    markSessionWorktree,
    openSession,
    projects,
    refreshGitWorktrees,
    session.sessionId,
    showToast,
    tr,
    worktreeCreateLayout,
    worktreeCreateName,
    worktreeCreateRef,
    worktreeCreateStartChat,
  ]);

  /**
   * Pick folder → add project (name = folder basename; no rename prompt).
   * `bindSession` also attaches the open chat under the new project.
   */
  const addProjectFromPicker = useCallback(
    async (opts: { bindSession: boolean; autoTrust?: boolean }) => {
      setLocalError(null);
      try {
        if (isMirrorClient()) {
          showToast(tr("mirror.desktopOnly"), 3200);
          return;
        }
        if (!api.isTauri()) {
          setLocalError(tr("error.needTauri"));
          return;
        }
        const path = await api.pickDirectory();
        if (!path) return;
        const p = (await api.projectAdd(path, !!opts.autoTrust)) as Project;
        await finalizeAddedProject(p, { bindSession: opts.bindSession });
      } catch (e) {
        const code =
          e && typeof e === "object" && "code" in e
            ? String((e as { code?: string }).code)
            : "";
        if (code === "UNSUPPORTED" || isMirrorClient()) {
          showToast(tr("mirror.desktopOnly"), 3200);
        } else {
          setLocalError(String(e));
        }
      }
    },
    [finalizeAddedProject, showToast, tr],
  );

  const addProject = async (autoTrust = false) => {
    await addProjectFromPicker({ bindSession: false, autoTrust });
  };

  const trustProject = async (proj?: Project | null) => {
    const target = proj || activeProject;
    if (!target) return;
    try {
      const p = (await api.projectTrust(target.id)) as Project;
      setActiveProject(p);
      setProjects(mapProjectsList((await api.projectsList()) as Project[]));
      setLocalError(null);
      maybeOfferSandboxWizardAfterTrust();
      // CLI connects on first send only.
    } catch (e) {
      setLocalError(String(e));
    }
  };

  const openDoctor = () => {
    setShowDoctor(true);
  };

  const openBatchAgents = useCallback(() => {
    setBatchAgentsOpen(true);
  }, []);

  /** Route from Ops hub → existing openers (no new App.tsx state piles). */
  const openOpsDestination = useCallback(
    (id: OpsEntryDestinationId) => {
      setOpsEntryOpen(false);
      closeSettings();
      switch (id) {
        case "tasks":
          setMainPane("chat");
          if (!session.sessionId) {
            showToast(tr("ops.tasksNeedSession"), 3200);
            return;
          }
          setTasksPanelOpen(true);
          break;
        case "dashboard":
          setAgentDashboardOpen(true);
          break;
        case "task_board":
          setTaskBoardOpen(true);
          break;
        case "batch_agents":
          openBatchAgents();
          break;
      }
    },
    [openBatchAgents, session.sessionId, showToast, tr],
  );

  /**
   * Multi-project batch dispatch: sessions (create+connect+send) or headless
   * one-shots. Soft-fails per project; never uses window.confirm.
   */
  const runBatchAgentsDispatch = useCallback(
    async (opts: {
      mode: BatchDispatchMode;
      prompt: string;
      projects: BatchProjectInput[];
      onProgress: (items: BatchDispatchItemResult[]) => void;
    }): Promise<BatchDispatchSummary> => {
      let items: BatchDispatchItemResult[] = opts.projects.map((p) => ({
        projectId: p.id,
        projectName: p.name || p.id,
        projectPath: p.path || "",
        status: "pending" as const,
        reason: null,
        sessionId: null,
        summary: null,
      }));
      opts.onProgress(items);

      const title = buildBatchSessionTitle(opts.prompt);
      let firstSessionId: string | null = null;
      let firstProjectId: string | null = null;

      for (const proj of opts.projects) {
        const t0 = Date.now();
        if (opts.mode === "headless") {
          try {
            if (!api.isTauri()) {
              items = upsertBatchResultItem(items, {
                projectId: proj.id,
                projectName: proj.name || proj.id,
                projectPath: proj.path || "",
                status: "soft_fail",
                reason: "not_desktop",
                summary: "Desktop host required",
                durationMs: Date.now() - t0,
              });
              opts.onProgress(items);
              continue;
            }
            const host = await api.batchAgentsHeadless({
              projectPath: proj.path,
              prompt: opts.prompt,
              timeoutMs: BATCH_AGENTS_HEADLESS_TIMEOUT_MS,
            });
            items = upsertBatchResultItem(
              items,
              mapHeadlessHostResult(proj, host),
            );
          } catch (e) {
            const c = classifyBatchError(e);
            items = upsertBatchResultItem(items, {
              projectId: proj.id,
              projectName: proj.name || proj.id,
              projectPath: proj.path || "",
              status: c.status,
              reason: c.reason,
              summary: c.summary,
              durationMs: Date.now() - t0,
            });
          }
          opts.onProgress(items);
          continue;
        }

        // ── sessions mode ──
        let createdId: string | null = null;
        try {
          if (!api.isTauri()) {
            items = upsertBatchResultItem(items, {
              projectId: proj.id,
              projectName: proj.name || proj.id,
              projectPath: proj.path || "",
              status: "soft_fail",
              reason: "not_desktop",
              summary: "Desktop host required",
              durationMs: Date.now() - t0,
            });
            opts.onProgress(items);
            continue;
          }
          const meta = (await api.sessionCreate(proj.id, title)) as {
            id: string;
            title?: string;
          };
          createdId = meta.id;
          const promptBody = buildBatchPromptBody(opts.prompt, {
            projectName: proj.name,
          });
          const snap = await api.sessionConnect({
            projectPath: proj.path || undefined,
            sessionId: createdId,
            mode: "agent",
          });
          if (
            snap.lastError ||
            (snap.state !== "ready" && snap.state !== "streaming")
          ) {
            const code = snap.lastError?.code ?? "CONNECT_FAILED";
            const msg = snap.lastError?.message ?? "connect failed";
            items = upsertBatchResultItem(items, {
              projectId: proj.id,
              projectName: proj.name || proj.id,
              projectPath: proj.path || "",
              status: "soft_fail",
              reason: String(code).toLowerCase(),
              summary: `${code}: ${msg}`,
              sessionId: createdId,
              durationMs: Date.now() - t0,
            });
            try {
              await api.sessionDelete(createdId);
              createdId = null;
            } catch {
              /* soft-fail cleanup */
            }
            opts.onProgress(items);
            continue;
          }
          const autoMsgs: ChatMessage[] = [
            {
              id: `u-batch-${createdId}-${Date.now()}`,
              role: "user",
              content: promptBody,
              createdAt: new Date().toISOString(),
            },
          ];
          messagesBySessionRef.current.set(createdId, autoMsgs);
          try {
            await api.sessionSend(promptBody, null, createdId);
          } catch (sendErr) {
            const c = classifyBatchError(sendErr);
            items = upsertBatchResultItem(items, {
              projectId: proj.id,
              projectName: proj.name || proj.id,
              projectPath: proj.path || "",
              status: c.status,
              reason: c.reason,
              summary: c.summary,
              sessionId: createdId,
              durationMs: Date.now() - t0,
            });
            opts.onProgress(items);
            continue;
          }
          if (!firstSessionId) {
            firstSessionId = createdId;
            firstProjectId = proj.id;
          }
          items = upsertBatchResultItem(items, {
            projectId: proj.id,
            projectName: proj.name || proj.id,
            projectPath: proj.path || "",
            status: "ok",
            reason: null,
            sessionId: createdId,
            summary: title,
            durationMs: Date.now() - t0,
          });
        } catch (e) {
          const c = classifyBatchError(e);
          if (createdId) {
            try {
              await api.sessionDelete(createdId);
            } catch {
              /* soft-fail cleanup */
            }
          }
          items = upsertBatchResultItem(items, {
            projectId: proj.id,
            projectName: proj.name || proj.id,
            projectPath: proj.path || "",
            status: c.status,
            reason: c.reason,
            summary: c.summary,
            durationMs: Date.now() - t0,
          });
        }
        opts.onProgress(items);
      }

      try {
        await refreshSessionsRef.current();
      } catch {
        /* soft-fail list refresh */
      }

      // Focus first successful session without interrupting others.
      if (opts.mode === "sessions" && firstSessionId) {
        try {
          const list = (await api.sessionsList()) as SessionRow[];
          const row = list.find((s) => s.id === firstSessionId);
          if (row) {
            const p =
              projects.find(
                (x) => x.id === (row.projectId || firstProjectId || ""),
              ) || null;
            void openSessionRef.current(row, p);
          }
        } catch {
          /* soft-fail focus */
        }
      }

      const summary = summarizeBatchResults({
        mode: opts.mode,
        prompt: opts.prompt,
        items,
      });
      return summary;
    },
    [projects, tr],
  );

  const runPaletteAction = (action: PaletteActionDef) => {
    switch (action.id) {
      case "new-chat":
        void newChat(activeProject);
        break;
      case "add-project":
        void addProject(false);
        break;
      case "new-space":
        promptCreateSpace();
        break;
      case "open-automations":
        navigateAutomations();
        break;
      case "open-ops":
        // Ops hub: pick tasks / dashboard / board / batch (not a silent dashboard alias).
        closeSettings();
        setOpsEntryOpen(true);
        if (
          typeof window !== "undefined" &&
          window.location.hash.includes("settings")
        ) {
          window.location.hash = "#/workbench";
        }
        break;
      case "open-tasks":
        closeSettings();
        setMainPane("chat");
        setTasksPanelOpen(true);
        if (
          typeof window !== "undefined" &&
          window.location.hash.includes("settings")
        ) {
          window.location.hash = "#/workbench";
        }
        break;
      case "open-agent-dashboard":
        closeSettings();
        setAgentDashboardOpen(true);
        if (
          typeof window !== "undefined" &&
          window.location.hash.includes("settings")
        ) {
          window.location.hash = "#/workbench";
        }
        break;
      case "open-task-board":
        closeSettings();
        setTaskBoardOpen(true);
        if (
          typeof window !== "undefined" &&
          window.location.hash.includes("settings")
        ) {
          window.location.hash = "#/workbench";
        }
        break;
      case "open-kanban":
        navigateKanban();
        break;
      case "open-batch-agents":
        openBatchAgents();
        break;
      case "doctor":
        setShowDoctor(true);
        break;
      case "traces":
        setShowTraces(true);
        break;
      case "reliability":
        openReliability();
        break;
      case "shortcuts-help":
        setShowShortcuts(true);
        break;
      case "product-tutorial":
        setShowProductTutorial(true);
        break;
      case "copy-conversation-md":
        void copyConversationMarkdown(
          session.sessionId
            ? {
                id: session.sessionId,
                title: session.title || tr("session.untitled"),
                projectId:
                  sessions.find((s) => s.id === session.sessionId)?.projectId ??
                  activeProject?.id ??
                  null,
              }
            : undefined,
        );
        break;
      case "resume-with-code-restore": {
        const sid = session.sessionId || viewingSessionIdRef.current;
        if (!sid) {
          showToast(tr("session.resumeRestoreNoProject"), 3500);
          break;
        }
        const row =
          sessions.find((s) => s.id === sid) ??
          (sid
            ? normalizeSessionRow({
                id: sid,
                title: session.title || tr("session.untitled"),
                projectId: activeProject?.id ?? null,
                updatedAt: new Date().toISOString(),
              })
            : null);
        if (!row) {
          showToast(tr("session.resumeRestoreNoProject"), 3500);
          break;
        }
        const proj = row.projectId
          ? projects.find((p) => p.id === row.projectId) ?? activeProject
          : activeProject;
        if (
          !canOfferResumeWithCodeRestore(proj?.path, {
            gitAvailable: gitWorktreesAvailable,
          })
        ) {
          showToast(
            proj?.path
              ? tr("session.resumeRestoreUnavailable")
              : tr("session.resumeRestoreNoProject"),
            3500,
          );
          break;
        }
        confirmResumeWithCodeRestore({
          ...row,
          projectId: row.projectId ?? proj?.id ?? null,
        });
        break;
      }
      case "continue-cwd": {
        const proj = activeProject;
        if (!proj || !canOfferContinueCwd(proj.path)) {
          showToast(
            tr(
              continueCwdSoftFailMessageKey("no_project") as MessageKey,
            ),
            3500,
          );
          break;
        }
        void continueLastAgentForProject(proj);
        break;
      }
      case "settings-general":
        navigateSettings("general");
        break;
      case "settings-appearance":
        navigateSettings("appearance");
        break;
      case "settings-account":
        navigateSettings("account");
        break;
      case "settings-extensions":
        navigateSettings("extensions");
        break;
      case "settings-runtime":
        navigateSettings("runtime");
        break;
      case "settings-workflows":
        navigateSettings("runtime", "tools");
        // Scroll to workflows card after settings mounts.
        if (typeof window !== "undefined") {
          window.setTimeout(() => {
            document
              .getElementById("settings-anchor-workflows")
              ?.scrollIntoView({ block: "center", behavior: "smooth" });
          }, 120);
        }
        break;
      case "workflows-docs":
        navigateSettings("runtime", "tools");
        if (typeof window !== "undefined") {
          window.setTimeout(() => {
            document
              .getElementById("settings-anchor-workflows")
              ?.scrollIntoView({ block: "center", behavior: "smooth" });
          }, 120);
        }
        // Best-effort: reveal bundled create-workflow skill when present.
        void api
          .workflowsList(activeProject?.path)
          .then((res) => {
            const p = res.createWorkflowSkill?.trim();
            if (p) return api.pathReveal(p);
            showToast(tr("settings.workflows.docsMissing"), 3200);
          })
          .catch(() => {
            showToast(tr("settings.workflows.docsMissing"), 3200);
          });
        break;
      case "settings-remote":
        navigateSettings("remote_im");
        break;
      case "settings-shortcuts":
        navigateSettings("shortcuts");
        break;
      case "settings-about":
        navigateSettings("about");
        break;
      default:
        break;
    }
  };
  searchPaletteHostRef.current.runAction = runPaletteAction;

  // Keep tray menu actions on latest closures (listeners registered once).
  const trayHandlersRef = useRef({
    newChat: () => {},
    openSessionById: (_id: string) => {},
    /** Omit section to restore last settings route. */
    openSettings: (_section?: SettingsSectionId) => {},
    openDoctor: () => {},
  });
  const openSessionByIdHandler = (id: string) => {
    void (async () => {
      let row = sessions.find((s) => s.id === id) ?? null;
      if (!row) {
        try {
          const list = await api.sessionsList();
          const hit = list.find((s) => s.id === id);
          if (hit) {
            row = mapSessionListRow(hit);
            setSessions(list.map((s) => mapSessionListRow(s)));
          }
        } catch {
          /* ignore */
        }
      }
      if (!row) return;
      const proj = projects.find((p) => p.id === row!.projectId) ?? null;
      await openSession(row, proj);
      // Keep keyboard focus on the active sidebar row so j/k can continue.
      requestAnimationFrame(() => {
        const sidebar = querySidebarEl();
        const active = sidebar?.querySelector(
          ".tree-l3--active",
        ) as HTMLElement | null;
        active?.focus?.({ preventScroll: true });
      });
    })();
  };
  shortcutHandlersRef.current = {
    newChat: () => {
      void newChat();
    },
    openSettings: (section?: SettingsSectionId) => {
      navigateSettings(section);
    },
    closeSettings: () => {
      navigateWorkbench();
    },
    openChatFind: () => {
      openChatFind();
    },
    copyLastReply: () => {
      void copyLastAssistantReply();
    },
    toggleSidebar: () => {
      // Same layout flag as phone drawer open/close and desktop rail hide/show.
      if (layoutRef.current.sidebarCollapsed) {
        openSidebarPane();
        return;
      }
      closeSidebarPane();
    },
    toggleRightPane: () => {
      if (layoutRef.current.asideCollapsed) {
        openAsidePane();
        return;
      }
      closeAsidePane();
    },
    openSidePicker: (kind: SidePickerKind) => {
      setSideWorkbench((s) => {
        const next = openSideTabFromPicker(s, kind, {
          isGitProject: sideIsGitProject,
        });
        if (!("created" in next)) return s;
        return next;
      });
      openAsidePane();
    },
    toggleBottomTerminal: () => {
      bottomTerminal.toggle();
    },
    toggleVoice: () => {
      toggleVoice();
    },
    cancelVoice: () => {
      cancelVoice();
    },
    startLiveVoice: () => {
      startLiveVoice();
    },
    stopGeneration: () => {
      void stop();
    },
    openSessionById: openSessionByIdHandler,
  };
  trayHandlersRef.current = {
    newChat: () => {
      void newChat();
    },
    openSessionById: openSessionByIdHandler,
    openSettings: (section?: SettingsSectionId) => {
      navigateSettings(section);
    },
    openDoctor: () => {
      void openDoctor();
    },
  };

  // Desktop notification click → open the session that fired the notify.
  // Web Notification.onclick and Host notify://clicked share this handler.
  // Wait for window role: secondary `session-*` windows must not subscribe
  // (Host already restores main; a second listener would steal focus).
  useEffect(() => {
    if (!windowRoleReady) return;
    if (isSecondaryWindow) return;
    setDesktopNotifySessionFocusHandler((sessionId) => {
      trayHandlersRef.current.openSessionById(sessionId);
    });
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listenForNativeNotifyClicks().then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    });
    return () => {
      cancelled = true;
      unlisten?.();
      setDesktopNotifySessionFocusHandler(null);
    };
  }, [windowRoleReady, isSecondaryWindow]);

  // System tray / menu-bar (Codex-style): Recent · More · Usage · New Chat · Open · Quit
  // Secondary windows ignore tray navigation — main owns app chrome.
  useEffect(() => {
    if (!api.isTauri()) return;
    if (isSecondaryWindow) return;
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        if (cancelled) return;
        unsubs.push(
          await listen("tray://new-chat", () => {
            trayHandlersRef.current.newChat();
          }),
        );
        unsubs.push(
          await listen<{ sessionId?: string }>("tray://open-session", (ev) => {
            const id = ev.payload?.sessionId;
            if (id) trayHandlersRef.current.openSessionById(id);
          }),
        );
        unsubs.push(
          await listen<{ section?: string }>("tray://open-settings", (ev) => {
            // No section (tray "Settings…") → restore last. Explicit section
            // (e.g. Account) always wins; invalid ids fall back to general.
            const raw = ev.payload?.section;
            if (raw == null || raw === "") {
              trayHandlersRef.current.openSettings();
              return;
            }
            const section = isSettingsSectionId(raw)
              ? raw
              : ("general" as SettingsSectionId);
            trayHandlersRef.current.openSettings(section);
          }),
        );
        unsubs.push(
          await listen("tray://open-doctor", () => {
            trayHandlersRef.current.openDoctor();
          }),
        );
      } catch (e) {
        console.warn("tray listeners failed", e);
      }
    })();
    return () => {
      cancelled = true;
      for (const u of unsubs) u();
    };
  }, [isSecondaryWindow]);

  /**
   * Real app exit (window close when not close-to-tray, or tray Quit).
   * Host always prevent_close + emits app://close-requested + arms a 3s
   * force-exit failsafe. We confirm only for truly busy turns (stream /
   * permission) — never for stuck Connecting. Dialog opens synchronously
   * (no await) so a hung automationsList cannot trap quit.
   * Second close while the confirm is open → force quit immediately.
   * Secondary windows never quit the process from their chrome.
   */
  const quitBusyDialogOpenRef = useRef(false);
  const requestAppQuit = useCallback((source: "chrome" | "shortcut" = "chrome") => {
    // Window chrome on a secondary pane must not quit the process.
    // Ctrl+Q is app-wide and may fire from any window.
    if (isSecondaryWindowRef.current && source !== "shortcut") return;
    // Second OS close / tray Quit while confirming → leave now.
    if (quitBusyDialogOpenRef.current) {
      quitBusyDialogOpenRef.current = false;
      void api.appForceQuit();
      return;
    }
    // Quit-busy excludes Connecting (dead reconnect must not trap exit).
    let busyCount = countQuitBlockingSessions(liveMapRef.current);
    // liveHost may be streaming before liveMap has the row (same as sidebar busyIds).
    const host = liveHostRef.current;
    if (
      host.sessionId &&
      isSessionLiveStreaming(host.state) &&
      !liveMapRef.current[host.sessionId]
    ) {
      busyCount += 1;
    }
    if (
      !shouldConfirmQuit(busyCount, loadAlwaysQuitWithoutAskingPref())
    ) {
      void api.appForceQuit();
      return;
    }
    const busyMessage = tr("app.quitBusy.message", { n: String(busyCount) });
    const dismissQuit = () => {
      quitBusyDialogOpenRef.current = false;
      void api.appCancelPendingQuit();
    };
    // Open immediately — never await network before showing quit UI.
    quitBusyDialogOpenRef.current = true;
    // Host arms a 3s force-exit when CloseRequested fires. We answered and are
    // waiting on the user: disarm so the confirm is not killed mid-read.
    // Second close still force-quits (ref above); if FE dies after this, a
    // further CloseRequested re-arms the failsafe.
    void api.appCancelPendingQuit();
    setAppDialog({
      kind: "confirm",
      title: tr("app.quitBusy.title"),
      message: busyMessage,
      confirmLabel: tr("app.quitBusy.confirm"),
      danger: true,
      onConfirm: () => {
        quitBusyDialogOpenRef.current = false;
        void api.appForceQuit();
      },
      onDismiss: dismissQuit,
    });
    // Optional enrichment (automations note) — fail soft, never blocks dialog.
    void (async () => {
      try {
        const rows = await api.automationsList();
        const enabledCount = rows.filter((r) => r.enabled).length;
        const bg = automationsBackgroundStatus({
          openAtLogin: launchAtLogin,
          enabledCount,
          runnerKnown: api.isTauri(),
        });
        if (!bg.quitNoteKey) return;
        // Only enrich if still the quit dialog.
        const cur = appDialogRef.current;
        if (
          !cur ||
          cur.kind !== "confirm" ||
          cur.title !== tr("app.quitBusy.title")
        ) {
          return;
        }
        setAppDialog({
          ...cur,
          message: `${busyMessage}\n\n${tr(bg.quitNoteKey)}`,
        });
      } catch {
        /* ignore — busy confirm still works without the note */
      }
    })();
  }, [tr, launchAtLogin, setAppDialog]);

  useEffect(() => {
    if (!api.isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await api.listen(APP_CLOSE_REQUESTED_EVENT, () => {
          requestAppQuit();
        });
        if (cancelled) unlisten();
      } catch (e) {
        console.warn("close-requested listener failed", e);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [requestAppQuit]);

  useDoublePressQuit({
    enabled: api.isTauri(),
    onArm: () => showToast(tr("app.quitPressAgain"), QUIT_DOUBLE_PRESS_MS),
    onQuit: () => requestAppQuit("shortcut"),
  });

  /**
   * Host menu ⌘W / Ctrl+W (replaces native Close Window). Browser-like:
   * active side tab first when the strip is non-empty and the aside is open;
   * empty strip (or collapsed leftover tabs) falls through to window close.
   * Decision is pure — see {@link applySideStripClose}.
   */
  const closeSideTabOrWindow = useCallback(() => {
    const s = sideWorkbenchRef.current;
    const result = applySideStripClose(s, {
      asideCollapsed: layoutRef.current.asideCollapsed,
    });
    if (result.closeWindow) {
      void (async () => {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          await getCurrentWindow().close();
        } catch (e) {
          console.warn("close window after empty side tabs failed", e);
        }
      })();
      return;
    }
    closeActiveSideTokenRef.current += 1;
    setCloseActiveSideRequest({ token: closeActiveSideTokenRef.current });
  }, []);

  useEffect(() => {
    if (!api.isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await api.listen(APP_CLOSE_TAB_OR_WINDOW_EVENT, () => {
          closeSideTabOrWindow();
        });
        if (cancelled) unlisten();
      } catch (e) {
        console.warn("close-tab-or-window listener failed", e);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [closeSideTabOrWindow]);

  const error = session.lastError;
  const errorBanner = useMemo(
    () =>
      presentErrorBanner(error, localError, locale, {
        activeSource:
          providerActiveSource === "custom" || providerActiveSource === "official"
            ? providerActiveSource
            : null,
      }),
    [error, localError, locale, providerActiveSource],
  );
  /** Prefer in-thread turn error; avoid stacking with the top error banner. */
  const hasChatTurnError = useMemo(
    () => messages.some((m) => m.isError),
    [messages],
  );
  // Collapse technical dump whenever the visible error changes.
  useEffect(() => {
    setErrorDetailOpen(false);
  }, [errorBanner?.code, errorBanner?.summary, errorBanner?.detail]);

  // Reliability center: keep a short in-memory ring of structured error cards.
  useEffect(() => {
    if (!errorBanner?.summary) return;
    const entry = reliabilityErrorFromDeck({
      code: errorBanner.code,
      problem: errorBanner.summary,
      cause: errorBanner.cause,
      sessionId: session.sessionId,
      source: error ? "session" : "local",
    });
    recordReliabilityError(entry);
  }, [
    errorBanner?.code,
    errorBanner?.summary,
    errorBanner?.cause,
    error,
    session.sessionId,
    recordReliabilityError,
  ]);

  const reliabilityView = useMemo(() => {
    const titleById = new Map(
      sessions.map((s) => [s.id, (s.title || "").trim()] as const),
    );
    const untitled = tr("session.untitled");
    const currentErrors = errorBanner?.summary
      ? [
          reliabilityErrorFromDeck({
            code: errorBanner.code,
            problem: errorBanner.summary,
            cause: errorBanner.cause,
            sessionId: session.sessionId,
            title: session.sessionId
              ? titleById.get(session.sessionId) || untitled
              : null,
            source: error ? "session" : "local",
            at: Date.now(),
          }),
        ]
      : [];
    // Attach session titles to ring stalls when known.
    const recentStalls = recentStallSignals.map((s) => ({
      ...s,
      title:
        s.title ||
        (s.sessionId ? titleById.get(s.sessionId) || untitled : null),
    }));
    const recentErrors = recentErrorEntries.map((e) => ({
      ...e,
      title:
        e.title ||
        (e.sessionId ? titleById.get(e.sessionId) || untitled : null),
    }));
    return buildReliabilityCenter({
      liveMap,
      sessions,
      currentSessionId: session.sessionId,
      untitledLabel: untitled,
      activeStreamStall: streamStall,
      recentStalls,
      recentErrors,
      currentErrors,
    });
  }, [
    liveMap,
    sessions,
    session.sessionId,
    streamStall,
    recentStallSignals,
    recentErrorEntries,
    errorBanner,
    error,
    tr,
  ]);

  /** Soft chip: latest goal_updated, or waiting when /goal mode is on. */
  const goalOrchSessionChip = useMemo(
    () =>
      resolveGoalOrchSessionIndicator({
        uiEnabled: goalOrchUiEnabled,
        events: goalOrchEvents,
        sessionId: session.sessionId ?? null,
        goalMode,
      }),
    [goalOrchUiEnabled, goalOrchEvents, session.sessionId, goalMode],
  );

  /** Session-scoped observed events for chip copy (never invents rows). */
  const goalOrchSessionEvents = useMemo(
    () => filterGoalOrchEvents(goalOrchEvents, session.sessionId ?? null),
    [goalOrchEvents, session.sessionId],
  );

  const clearLocalGoalOrchTimeline = useCallback(() => {
    const plan = planClearGoalOrchEvents(
      goalOrchEvents,
      session.sessionId ?? null,
    );
    setGoalOrchEvents(plan.next);
    if (plan.cleared > 0) {
      showToast(
        tr("reliability.goal.clearDone", { count: plan.cleared }),
        2400,
      );
    }
  }, [goalOrchEvents, session.sessionId, showToast, tr]);

  const requestClearLocalGoalOrchTimeline = useCallback(() => {
    const plan = planClearGoalOrchEvents(
      goalOrchEvents,
      session.sessionId ?? null,
    );
    if (plan.cleared <= 0) return;
    if (shouldConfirmClearGoalOrch(plan.cleared)) {
      setAppDialog({
        kind: "confirm",
        title: tr("reliability.goal.clearConfirmTitle"),
        message: tr("reliability.goal.clearConfirmMessage", {
          count: plan.cleared,
        }),
        confirmLabel: tr("reliability.goal.clearConfirmAction"),
        onConfirm: () => clearLocalGoalOrchTimeline(),
      });
      return;
    }
    clearLocalGoalOrchTimeline();
  }, [goalOrchEvents, clearLocalGoalOrchTimeline, setAppDialog, tr]);

  const copyGoalOrchControlSummary = useCallback(async () => {
    try {
      const text = buildGoalControlSummary(goalOrchSessionEvents, {
        title: tr("reliability.goal.title"),
        generatedAt: new Date().toISOString(),
      });
      await navigator.clipboard.writeText(text);
      showToast(tr("reliability.goal.copied"), 2200);
    } catch {
      showToast(tr("reliability.goal.copyFail"), 3200);
    }
  }, [goalOrchSessionEvents, showToast, tr]);

  // T15: announce stream start/end once (avoid token-level noise).
  useEffect(() => {
    const streaming =
      session.state === "streaming" ||
      messages.some((m) => m.role === "assistant" && m.streaming);
    if (streaming && !wasStreamingRef.current) {
      setStreamA11yNote(tr("a11y.assistantStreaming"));
    } else if (!streaming && wasStreamingRef.current) {
      setStreamA11yNote(tr("a11y.assistantDone"));
      const t = window.setTimeout(() => setStreamA11yNote(""), 2500);
      wasStreamingRef.current = streaming;
      return () => window.clearTimeout(t);
    }
    wasStreamingRef.current = streaming;
  }, [session.state, messages, tr]);

  /** Same path as Deny button / Escape / optional auto-deny timeout. */
  const resolvePermission = useCallback(
    (
      p: PermissionPayload,
      decision: "allow_once" | "allow_session" | "deny",
      optionId: string,
    ) => {
      return api
        .sessionResolvePermission({
          rpcId: p.rpcId,
          decision,
          optionId,
          scopeKey: p.scopeKey,
          // Background turns raise permissions on their own ACP child.
          sessionId: p.sessionId,
          // Host re-coerces wire optionIds from this list when pending is empty (#542).
          options: p.options,
          toolName: p.toolName,
        })
        .then(() => {
          clearPendingGates(p.sessionId);
          setPerm(null);
        })
        .catch((e) => {
          const code =
            e && typeof e === "object" && "code" in e
              ? String((e as { code?: string }).code)
              : "";
          const msg =
            code === "UNSUPPORTED" ? tr("mirror.unsupported") : String(e);
          showToast(msg, 4000);
          throw e instanceof Error ? e : new Error(msg);
        });
    },
    [clearPendingGates, showToast, tr],
  );

  const denyActivePermission = useCallback(
    (p: PermissionPayload) => {
      const deny = mapPermissionButtons(
        p.options,
        {
          allowOnce: tr("perm.allowOnce"),
          allowSession: tr("perm.allowSession"),
          deny: tr("perm.deny"),
        },
        p.toolName,
      ).find((b) => b.decision === "deny");
      if (!deny) return;
      void resolvePermission(p, deny.decision, deny.optionId).catch(() => {
        /* toast already shown */
      });
    },
    [resolvePermission, tr],
  );

  // T15: permission bar — focus primary action, Tab trap, Escape → deny.
  useEffect(() => {
    if (!perm) return;
    const t = window.setTimeout(() => {
      preferPermissionFocus(permBarRef.current);
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        denyActivePermission(perm);
        return;
      }
      trapTabKey(e, permBarRef.current);
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [perm, denyActivePermission]);

  // Optional auto-deny after N seconds (Settings → Permissions; 0 = off).
  useEffect(() => {
    if (!perm || permissionTimeoutSec <= 0) {
      return;
    }
    // Resume this request's own clock rather than restarting it — the bar
    // remounts on every return to the chat, and a fresh `Date.now()` here reset
    // the countdown (and the auto-deny) to the full timeout each time.
    const raisedAt = resumeGateClock(
      permRaisedAtRef.current,
      gateClockKey(perm.sessionId, perm.rpcId),
    );
    const t = window.setTimeout(
      () => {
        denyActivePermission(perm);
      },
      Math.max(0, permissionTimeoutSec * 1000 - (Date.now() - raisedAt)),
    );
    return () => {
      window.clearTimeout(t);
    };
  }, [perm, permissionTimeoutSec, denyActivePermission]);

  const permCountdownStartedAt =
    perm && permissionTimeoutSec > 0
      ? resumeGateClock(
          permRaisedAtRef.current,
          gateClockKey(perm.sessionId, perm.rpcId),
        )
      : 0;

  /** T04 deck buttons: reconnect / Doctor / Settings sections / project / MCP / dismiss. */
  const runErrorBannerAction = useCallback(
    (action: NonNullable<ErrorBannerView["primary"]>) => {
      setErrorDetailOpen(false);
      switch (action.id) {
        case "reconnect":
          retryAgentConnect();
          break;
        case "open_doctor":
          setLocalError(null);
          openDoctor();
          break;
        case "open_runtime":
          setLocalError(null);
          navigateSettings("runtime");
          break;
        case "upgrade_cli":
          setLocalError(null);
          navigateSettings("runtime");
          break;
        case "open_network":
          setLocalError(null);
          navigateSettings("runtime", "network");
          break;
        case "open_account":
          setLocalError(null);
          navigateSettings("account");
          break;
        case "open_providers":
          setLocalError(null);
          // Providers live under account / extensions path — account is the
          // login+key surface; extensions holds MCP. Prefer account for keys.
          navigateSettings("account");
          break;
        case "open_permissions":
          setLocalError(null);
          navigateSettings("general", "permissions");
          break;
        case "open_extensions":
          setLocalError(null);
          navigateSettings("extensions");
          break;
        case "open_mcp":
          setLocalError(null);
          void openMcpModal();
          break;
        case "trust_project":
          setLocalError(null);
          void trustProject(activeProject);
          break;
        case "relocate_project":
          setLocalError(null);
          if (activeProject) void relocateProject(activeProject);
          break;
        case "add_project":
          setLocalError(null);
          void addProject(false);
          break;
        case "dismiss":
        case "keep_waiting":
          // keep_waiting is for the stream-stall banner (clears prompt only).
          setLocalError(null);
          break;
        case "cancel_turn":
          setLocalError(null);
          void stop();
          break;
        default:
          break;
      }
    },
    [
      activeProject,
      addProject,
      ensureConnected,
      navigateSettings,
      openDoctor,
      openMcpModal,
      relocateProject,
      stop,
      trustProject,
    ],
  );

  const refreshAccount = useCallback(
    async (opts?: {
      refreshBilling?: boolean;
      /** No spinner / error flash — background quota tick. */
      quiet?: boolean;
      /** Skip heatmap / call-log walk (billing-only). */
      includeLocalUsage?: boolean;
      /** Drop Host reply after unmount / superseded probe. */
      isCurrent?: () => boolean;
    }) => {
      if (!api.isTauri()) {
        // Browser preview: soft-fail host_only — never invent heatmap/quota.
        setAccountHeatmapError({ code: "host_only", message: "need tauri" });
        // Browser / non-host: soft-fail host_only so Account never invents %.
        setAccountProbeError({
          code: "host_only",
          message: "Account requires Tauri desktop runtime",
        });
        return;
      }
      const quiet = opts?.quiet === true;
      const includeLocalUsage = opts?.includeLocalUsage ?? true;
      if (!quiet) setAccountLoading(true);
      try {
        const st = await api.accountStatus({
          refreshBilling: opts?.refreshBilling ?? true,
          includeLocalUsage,
          manualCliPath: manualCliPath || null,
        });
        if (opts?.isCurrent && !opts.isCurrent()) return;
        setAccount((prev) =>
          includeLocalUsage
            ? st
            : mergeAccountStatusPreservingLocalUsage(prev, st),
        );
        if (!quiet) setAccountHeatmapError(null);
        setAccountProbeError(null);
        setSetup((s) => ({
          ...s,
          auth: isAccountConnected(st),
          cli: st.cliFound || s.cli,
        }));
        if (!quiet) {
          try {
            const list = await api.accountsList();
            setSavedAccounts(list.profiles ?? []);
            setActiveAccountId(list.activeId ?? null);
          } catch {
            // multi-account list is best-effort
          }
        }
        // Usage line on tray menu (Codex-style)
        void api.trayRefresh();
      } catch (e) {
        if (opts?.isCurrent && !opts.isCurrent()) return;
        console.warn("account status failed", e);
        if (!quiet) {
          setAccountHeatmapError(e);
          setAccountProbeError(e);
        }
      } finally {
        if (!quiet) setAccountLoading(false);
      }
    },
    [manualCliPath],
  );

  const refreshSavedAccounts = useCallback(async () => {
    if (!api.isTauri()) return;
    try {
      const list = await api.accountsList();
      setSavedAccounts(list.profiles ?? []);
      setActiveAccountId(list.activeId ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  const refreshAccountQuotas = useCallback(async () => {
    if (!api.isTauri()) return;
    try {
      const r = await api.accountsQuota();
      const map: Record<string, SwitcherQuota> = {};
      for (const item of r.items ?? []) {
        map[item.id] = quotaFromHostItem(item);
      }
      setAccountQuotas(map);
    } catch {
      /* ignore — rows stay on live seed / em dash */
    }
  }, []);

  /** Import markdown/JSON transcript as a new local session (from PR #24). */
  const importChatTranscript = useCallback(async () => {
    if (!api.isTauri()) {
      showToast(tr("error.needTauri"));
      return;
    }
    setAccountBusy(true);
    try {
      const created = await api.sessionImportTranscriptFile(
        null,
        activeProject?.id ?? null,
      );
      if (!created) return;
      await refreshSessions();
      const list = (await api.sessionsList()) as SessionRow[];
      const hit = list.find((s) => s.id === created.id);
      if (hit) {
        const proj =
          projects.find((p) => p.id === (hit.projectId ?? undefined)) ?? null;
        void openSession(hit, proj ?? undefined);
      }
    } catch (e) {
      showToast(
        `${tr("account.importChatFailed")}: ${String(e)}`,
        5000,
      );
    } finally {
      setAccountBusy(false);
    }
  }, [activeProject?.id, projects, showToast, tr]);

  const unarchivedAppSessionCount = sessions.filter((s) => !s.archived).length;
  const linkedAgentIds = sessions
    .map((s) => s.agentSessionId)
    .filter((id): id is string => !!id);
  const cliCallLogImport = useCliCallLogImport({
    callLogs: account?.callLogs,
    unarchivedAppSessionCount,
    linkedAgentIds,
    onImported: () => {
      void refreshSessions();
      void refreshProjects();
    },
  });
  const importCliCallLogsFromSidebar = useCallback(async () => {
    try {
      const result = await cliCallLogImport.importListed();
      if (result.imported.length > 0) {
        showToast(
          tr("settings.cliSessionsImportedN", {
            n: String(result.imported.length),
          }),
        );
      }
      if (result.failed > 0) {
        showToast(
          tr("account.callLogsImportPartial", {
            n: String(result.failed),
          }),
          5000,
        );
      }
    } catch (e) {
      showToast(String(e), 5000);
    }
  }, [cliCallLogImport, showToast, tr]);
  const browseCliSessionsSettings = useCallback(() => {
    navigateSettings("account");
    setSettingsFocusAnchor("settings-anchor-account-callLogs");
  }, [navigateSettings]);
  const sidebarCliImportCta = cliCallLogImport.showCta ? (
    <SidebarCliImportCta
      hint={tr("sidebar.importCliSessionsHint")}
      importLabel={
        cliCallLogImport.importing
          ? tr("settings.cliSessionsImporting")
          : tr("sidebar.importCliSessions")
      }
      browseLabel={tr("account.callLogs")}
      importing={cliCallLogImport.importing}
      onImport={() => void importCliCallLogsFromSidebar()}
      onBrowse={browseCliSessionsSettings}
    />
  ) : null;
  const {
    exportMdTarget,
    exportMdBusy,
    exportMdIncludeThoughts,
    setExportMdIncludeThoughts,
    exportMdIncludeTools,
    setExportMdIncludeTools,
    exportMdHonesty,
    closeExportSessionMd,
    runExportSessionMd,
    openExportSessionMd,
    exportActiveSessionMd,
    copyConversationMarkdown,
    exportSessionJson,
    exportSessionPlain,
    exportSessionHtml,
    exportSessionStreamNdjson,
    exportSessionDiagnostic,
    exportSessionTrace,
    confirmExportSessionTraceUpload,
  } = useSessionExportText({
    session,
    sessions,
    messages,
    projects,
    activeProject,
    tr,
    showToast,
    setAppDialog,
  });
  const {
    exportImageTarget,
    exportImageBusy,
    exportImageSmart,
    setExportImageSmart,
    exportImageSkin,
    applyExportImageSkin,
    exportImageCanAct,
    exportImagePreviewPhase,
    exportImagePreviewUrl,
    exportImageOptionsMatch,
    exportImagePreviewError,
    exportImageBytesLabel,
    exportImageMetaParts,
    closeExportSessionImage,
    runExportSessionImage,
    openExportSessionImage,
  } = useSessionExportImage({
    session,
    sessions,
    messages,
    projects,
    activeProject,
    locale,
    tr,
    showToast,
  });

  const beginEditLastUser = useCallback(
    (msg: ChatMessage) => {
      if (msg.role !== "user") return;
      if (msg.id !== lastUserMessageId) {
        showToast(tr("message.editOnlyLast"));
        return;
      }
      if (!canEditLastUser) {
        showToast(tr("message.editBusy"));
        return;
      }
      // Inline only — do not move content into the main composer.
      // Reload original attachments into editable chips.
      setEditAttachments(
        (msg.attachments ?? []).map((a) => ({
          path: a.path,
          name: a.name,
          isDir: a.isDir,
        })),
      );
      setEditingUserMessageId(msg.id);
    },
    [lastUserMessageId, canEditLastUser, showToast, tr],
  );

  const cancelEditUser = useCallback(() => {
    if (editSubmitting) return;
    setEditingUserMessageId(null);
    setEditAttachments([]);
  }, [editSubmitting]);

  /**
   * Resend the last user turn (edit-resend or regenerate): commit UI immediately
   * (user bubble + thinking), then connect / rewind / send while thinking is visible.
   */
  const resendLastUserTurn = useCallback(
    async (
      msg: ChatMessage,
      storedDisplay: string,
      att: Attachment[],
      opts?: {
        onlyLastToastKey?: "message.editOnlyLast" | "message.regenerateOnlyLast";
        busyToastKey?: "message.editBusy" | "message.regenerateBusy";
        /** When set and different from current, apply before resend. */
        modelId?: string;
      },
    ) => {
      if (msg.role !== "user" || msg.id !== lastUserMessageId) {
        showToast(tr(opts?.onlyLastToastKey ?? "message.editOnlyLast"));
        return;
      }
      if (!canEditLastUser || editSubmitting) {
        showToast(tr(opts?.busyToastKey ?? "message.editBusy"));
        return;
      }
      const segments = parseStoredContent(storedDisplay);
      if (isDraftEmpty(segments) && !att.length) return;

      const agentBody = serializeForAgent(segments, { goalMode });
      let agentText = buildAgentPrompt(agentBody, att);
      const schemaForEdit = sessionJsonSchemaRef.current?.trim() || "";
      if (schemaForEdit && isActiveJsonSchema(schemaForEdit)) {
        agentText = wrapAgentTextWithJsonSchema(agentText, schemaForEdit);
      }
      const titleSeed =
        serializeForAgent(segments).replace(/\n/g, " ").trim() ||
        att.map((a) => a.name).join(", ");
      const shouldAutoTitle =
        isPlaceholderTitle(session.title) || !session.sessionId;
      const pendingAssistantId = `a-pending-${Date.now()}`;
      // May still be a draft id; ensureConnected materializes it later.
      let sendTargetId = session.sessionId;
      let cacheKey = sendTargetId ?? "__draft__";
      const nowIso = new Date().toISOString();
      const nextModelId = opts?.modelId?.trim() || "";
      const switchModel =
        !!nextModelId &&
        nextModelId !== modelId &&
        isValidModelId(nextModelId, availableModels);

      // Optimistic UI + prefs: live agent model is applied after connect.
      if (switchModel) {
        setModelId(nextModelId);
      }

      setEditSubmitting(true);

      // 1) Instant UI commit — same as normal send: user bubble + thinking.
      //    Connect/rewind wait happens under this thinking row, not the edit form.
      setMessages((m) => {
        const kept = truncateBeforeLastUser(m);
        const next: ChatMessage[] = [
          ...kept,
          {
            id: `u-${Date.now()}`,
            role: "user",
            content: storedDisplay,
            attachments: att.length ? att : undefined,
            createdAt: nowIso,
          },
          {
            id: pendingAssistantId,
            role: "assistant",
            content: "",
            streaming: true,
            createdAt: nowIso,
          },
        ];
        messagesBySessionRef.current.set(cacheKey, next);
        return next;
      });
      setEditingUserMessageId(null);
      setEditAttachments([]);
      setRetryStatus(null);
      setSession((prev) =>
        prev.state === "streaming" || prev.state === "awaiting_permission"
          ? prev
          : { ...prev, state: "streaming", lastError: null },
      );
      setLiveHost((prev) => {
        if (sendTargetId && prev.sessionId && prev.sessionId !== sendTargetId) {
          return prev;
        }
        const next = {
          ...prev,
          sessionId: sendTargetId ?? prev.sessionId,
          state: "streaming" as const,
          lastError: null,
        };
        liveHostRef.current = next;
        return next;
      });

      const failPending = (errText?: string) => {
        const errTarget = sendTargetId ?? viewingSessionIdRef.current;
        patchSessionMessages(errTarget, (m) =>
          applyTurnError(
            m,
            {
              messageId: pendingAssistantId,
              content: errText || tr("message.editConnectFailed"),
            },
            localeRef.current,
          ),
        );
        if (
          viewingSessionIdRef.current === sendTargetId ||
          viewingSessionIdRef.current === errTarget ||
          (!sendTargetId && viewingSessionIdRef.current === null)
        ) {
          setSession((prev) =>
            prev.state === "streaming"
              ? { ...prev, state: prev.sessionId ? "ready" : prev.state }
              : prev,
          );
        }
      };

      // 2) Background: connect → rewind journal → send (thinking already shown).
      try {
        const sessionId = await ensureConnected();
        if (!sessionId) {
          failPending(tr("message.editConnectFailed"));
          return;
        }
        // Draft / id migrate after materialize.
        if (sessionId !== cacheKey) {
          const prevCache = messagesBySessionRef.current.get(cacheKey);
          if (prevCache?.length) {
            messagesBySessionRef.current.set(sessionId, prevCache);
            messagesBySessionRef.current.delete(cacheKey);
          }
          sendTargetId = sessionId;
          cacheKey = sessionId;
        }

        if (api.isTauri()) {
          try {
            await api.sessionRewindDropLastUser(sessionId);
          } catch (e) {
            console.warn("session rewind before edit failed", e);
            // Continue: UI already replaced the turn; resend still proceeds.
          }
        }

        if (switchModel && api.isTauri()) {
          try {
            await api.sessionSetModel(nextModelId, {
              sessionId,
              projectId: activeProject?.id ?? null,
            });
          } catch (e) {
            console.warn("session set model before resend failed", e);
            // Soft-fail: UI model already switched; resend may still use prior agent model.
          }
        } else if (switchModel) {
          void api
            .composerPrefsSet({
              projectId: activeProject?.id ?? null,
              sessionId,
              modelId: nextModelId,
            })
            .catch(() => {
              /* ignore */
            });
        }

        await api.sessionSend(agentText, storedDisplay, sessionId, att);
        if (storedDisplay.trim()) {
          setRecentPromptHistory(
            recordRecentPrompt({
              text: storedDisplay,
              sessionId,
              at: new Date().toISOString(),
            }),
          );
        }
        // Mirror-allowlisted (`session.autoTitle`) — safe for phone clients.
        if (shouldAutoTitle && api.hasHost()) {
          void api
            .sessionAutoTitle(sessionId, titleSeed)
            .then((meta) => {
              if (meta?.title) applySessionTitle(sessionId, meta.title);
            })
            .catch(() => {
              /* ignore */
            });
        }
      } catch (e) {
        failPending(String(e));
        if (
          viewingSessionIdRef.current === sendTargetId ||
          viewingSessionIdRef.current === null
        ) {
          setLocalError(String(e));
        }
      } finally {
        setEditSubmitting(false);
      }
    },
    [
      lastUserMessageId,
      canEditLastUser,
      editSubmitting,
      showToast,
      tr,
      goalMode,
      session.title,
      session.sessionId,
      modelId,
      availableModels,
      activeProject?.id,
      // ensureConnected / patchSessionMessages / applySessionTitle via closure
    ],
  );

  /** Edit last user turn — uses inline edit attachment chips as source of truth. */
  const submitEditLastUser = useCallback(
    async (msg: ChatMessage, storedDisplay: string) => {
      const att: Attachment[] = editAttachments.map((a) => ({
        path: a.path,
        name: a.name,
        isDir: a.isDir,
      }));
      await resendLastUserTurn(msg, storedDisplay, att);
    },
    [editAttachments, resendLastUserTurn],
  );

  /**
   * Regenerate last assistant reply: resend the last user turn unchanged
   * (same content + attachments) via the edit-resend pipeline.
   * Optional `modelId` switches session model for this turn when it differs.
   */
  const regenerateLastAssistant = useCallback(
    async (message: ChatMessage, opts?: { modelId?: string }) => {
      if (message.role !== "assistant") return;
      if (!canEditLastUser || editSubmitting) {
        showToast(tr("message.regenerateBusy"));
        return;
      }
      if (
        !lastUserMessageId ||
        !canRegenerateAssistant(messages, message.id)
      ) {
        showToast(tr("message.regenerateOnlyLast"));
        return;
      }
      const userMsg = messages.find((m) => m.id === lastUserMessageId);
      if (!userMsg || userMsg.role !== "user") return;
      const att: Attachment[] = (userMsg.attachments ?? []).map((a) => ({
        path: a.path,
        name: a.name,
        isDir: a.isDir,
      }));
      const pick = opts?.modelId?.trim();
      await resendLastUserTurn(userMsg, userMsg.content, att, {
        onlyLastToastKey: "message.regenerateOnlyLast",
        busyToastKey: "message.regenerateBusy",
        modelId:
          pick && isValidModelId(pick, availableModels) ? pick : undefined,
      });
    },
    [
      canEditLastUser,
      editSubmitting,
      lastUserMessageId,
      messages,
      resendLastUserTurn,
      showToast,
      tr,
      availableModels,
    ],
  );

  const onThreadContinueInterrupted = useCallback(() => {
    const sid = session.sessionId;
    if (!sid) return;
    if (
      session.state === "streaming" ||
      session.state === "awaiting_permission" ||
      session.state === "connecting"
    ) {
      return;
    }
    void (async () => {
      const ctx = await api.sessionInterruptContext(sid);
      const journal = tr("endOfTurn.continuePrompt");
      await executeSendLatestRef.current({
        storedDisplay: journal,
        att: [],
        goalMode: false,
        targetSessionId: sid,
        agentTextOverride: buildContinueAgentPrompt(ctx),
      });
    })();
  }, [session.sessionId, session.state, tr]);

  const onThreadAddQuote = useCallback(
    (quote: { text: string; comment: string; sourceMessageId?: string }) => {
      setQuotes((prev) => [
        ...prev,
        {
          id: makeComposerQuoteId(),
          text: quote.text,
          comment: quote.comment,
          sourceMessageId: quote.sourceMessageId,
        },
      ]);
    },
    [setQuotes],
  );

  const onThreadRemoveEditAttachment = useCallback((att: Attachment) => {
    setEditAttachments((prev) => prev.filter((x) => x.path !== att.path));
  }, []);

  const onThreadOpenSessionChanges = useCallback(() => {
    openAsidePane();
    setResourceOpenTarget({ type: "changes" });
  }, [openAsidePane]);

  const onThreadOpenModifiedPath = useCallback(
    (path: string) => {
      openAsidePane();
      setResourceOpenTarget({ type: "changes", path });
    },
    [openAsidePane],
  );

  const onThreadOpenResource = useCallback(
    (target: ResourceOpenTarget) => {
      if (target.type === "file" && target.path) {
        const decision = resolveSidePathDeepLink({
          path: target.path,
          title: target.title,
          projectPath: effectiveProjectPath,
          projectTrusted: activeProject ? activeProject.trusted : null,
        });
        if (!decision.ok) {
          setLocalError(tr(decision.messageKey));
          if (
            decision.shouldReveal &&
            decision.revealPath &&
            api.isTauri()
          ) {
            void api.pathReveal(decision.revealPath).catch(() => {
              /* reveal is best-effort fallback */
            });
          }
          return;
        }
        openAsidePane();
        setResourceOpenTarget({
          type: "file",
          path: decision.path,
          title: decision.title,
          line: target.line ?? null,
          column: target.column ?? null,
        });
        return;
      }
      openAsidePane();
      setResourceOpenTarget(target);
    },
    [activeProject, effectiveProjectPath, openAsidePane, tr],
  );

  const onThreadAddAttachmentToComposer = useCallback((att: Attachment) => {
    setAttachments((prev) => mergeAttachments(prev, [att]));
  }, []);

  const onThreadOpenError = useCallback((message: string) => {
    setLocalError(message);
  }, []);

  const formatPermCountdown = useCallback(
    (seconds: string) => tr("perm.autoDenyCountdown", { seconds }),
    [tr],
  );

  const runAccountLogin = useCallback(
    async (method: "oauth" | "device" = "oauth"): Promise<boolean> => {
      if (!api.isTauri()) {
        showToast(tr("error.needTauri"));
        return false;
      }
      setAccountBusy(true);
      setLoginHint(null);
      try {
        const res = await api.accountLogin(method);
        if (res.ok) {
          setLoginHint(null);
        } else if (res.timedOut) {
          const msg = `${tr("account.loginTimeout")} ${tr(
            "account.loginUnreachableHint",
          )}`;
          setLoginHint(msg);
          showToast(msg, 10000);
        } else {
          const msg = res.message || tr("account.loginFailed");
          setLoginHint(msg);
          showToast(msg, 6000);
        }
        if (res.deviceUrl) {
          try {
            await api.openExternalUrl(res.deviceUrl);
          } catch {
            /* host may already open it */
          }
        }
        await refreshAccount({ refreshBilling: true });
        await refreshSavedAccounts();
        // Host account_login recycles live/bg/parked/prewarm on success
        // (`account_auth`) so warm CLIs cannot keep stale/missing OIDC.
        // Reset focused shell snapshot only — do not sessionDisconnect (that
        // parks processes and used to leave prewarm alive for reuse).
        if (res.ok) {
          setSession({ ...IDLE_SNAPSHOT });
        }
        return !!res.ok;
      } catch (e) {
        const msg = String(e);
        setLoginHint(msg);
        showToast(msg, 4500);
        return false;
      } finally {
        setAccountBusy(false);
      }
    },
    [refreshAccount, refreshSavedAccounts, showToast, tr],
  );

  /** Abort a running login (OAuth/device) so the user can pick another method
   *  without restarting the app. The backend kills the `grok login` child. */
  const cancelAccountLogin = useCallback(async () => {
    try {
      await api.accountLoginCancel();
    } catch {
      /* ignore — still unlock UI */
    }
    setAccountBusy(false);
  }, []);

  /**
   * Paste a browser-shown verification code into the running `grok login`.
   * auth.x.ai sometimes asks to “copy this code into Grok Build” instead of
   * completing via localhost callback.
   */
  const submitAccountLoginCode = useCallback(
    async (code: string) => {
      if (!api.isTauri()) {
        showToast(tr("error.needTauri"));
        return;
      }
      try {
        await api.accountLoginSubmitCode(code);
        showToast(tr("account.loginPasteOk"), 4000);
      } catch (e) {
        const msg = `${tr("account.loginPasteFailed")}: ${String(e)}`;
        setLoginHint(msg);
        showToast(msg, 5000);
      }
    },
    [showToast, tr],
  );

  const runSaveAccount = useCallback(async () => {
    if (!api.isTauri()) return;
    setAccountBusy(true);
    try {
      await api.accountSaveCurrent();
      await refreshSavedAccounts();
    } catch (e) {
      showToast(String(e), 4500);
    } finally {
      setAccountBusy(false);
    }
  }, [refreshSavedAccounts, showToast, tr]);

  /**
   * Save current login (if any), then start OAuth so the user can add another
   * account without losing the previous snapshot.
   */
  const runAddAccount = useCallback(async () => {
    if (!api.isTauri()) {
      showToast(tr("error.needTauri"));
      return;
    }
    // Snapshot current auth first so switcher keeps it.
    if (account?.profile?.signedIn) {
      setAccountBusy(true);
      try {
        await api.accountSaveCurrent();
        await refreshSavedAccounts();
      } catch (e) {
        // Still try login — user may want a fresh account even if save fails.
        showToast(String(e), 3500);
      } finally {
        setAccountBusy(false);
      }
    }
    await runAccountLogin("oauth");
  }, [
    account?.profile?.signedIn,
    refreshSavedAccounts,
    runAccountLogin,
    showToast,
    tr,
  ]);

  const runSwitchAccount = useCallback(
    async (id: string) => {
      if (!api.isTauri()) return;
      setAccountBusy(true);
      try {
        await api.accountSwitch(id);
        await refreshAccount({ refreshBilling: true });
        await refreshSavedAccounts();
        // Host account_switch recycles all agents (account_auth).
        setSession({ ...IDLE_SNAPSHOT });
      } catch (e) {
        showToast(String(e), 4500);
      } finally {
        setAccountBusy(false);
      }
    },
    [refreshAccount, refreshSavedAccounts, showToast, tr],
  );

  const runRemoveAccount = useCallback(
    (id: string) => {
      if (!api.isTauri()) return;
      const label =
        savedAccounts.find((a) => a.id === id)?.label || id.slice(0, 8);
      setAppDialog({
        kind: "confirm",
        title: tr("account.profileRemove"),
        message: tr("account.profilesHint"),
        confirmLabel: tr("account.profileRemove"),
        danger: true,
        onConfirm: async () => {
          setAccountBusy(true);
          try {
            await api.accountRemove(id);
            await refreshSavedAccounts();
          } catch (e) {
            showToast(String(e), 4500);
          } finally {
            setAccountBusy(false);
          }
        },
      });
      void label;
    },
    [refreshSavedAccounts, savedAccounts, showToast, tr],
  );

  const runAccountLogout = useCallback(async () => {
    if (!api.isTauri()) return;
    setAccountBusy(true);
    try {
      await api.accountLogout();
      await refreshAccount({ refreshBilling: false });
      await refreshSavedAccounts();
      // Host account_logout recycles all agents (account_auth).
      setSession({ ...IDLE_SNAPSHOT });
    } catch (e) {
      showToast(String(e), 4500);
    } finally {
      setAccountBusy(false);
    }
  }, [refreshAccount, refreshSavedAccounts, showToast]);

  // Account boot: paint fast from disk cache first, then refresh quota on network.
  // Welcome SuperGrok logo depends on billing tier — waiting only on the slow
  // path made the mark look like a "slow image" even though it is inline SVG.
  useEffect(() => {
    if (!api.isTauri()) return;
    let cancelled = false;
    void (async () => {
      const isCurrent = () => !cancelled;
      await refreshAccount({ refreshBilling: false, isCurrent });
      if (cancelled) return;
      await refreshAccount({ refreshBilling: true, isCurrent });
      if (cancelled) return;
      await refreshSavedAccounts();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshAccount, refreshSavedAccounts]);

  useEffect(() => {
    if (settingsOpen && settingsSection === "account") {
      void refreshAccount({ refreshBilling: true });
      void refreshSavedAccounts();
    }
  }, [settingsOpen, settingsSection, refreshAccount, refreshSavedAccounts]);

  useAccountQuotaAutoRefresh({
    enabled: api.isTauri(),
    canFetch: canFetchOfficialQuota(account),
    refresh: (isCurrent) =>
      refreshAccount({
        refreshBilling: true,
        quiet: true,
        includeLocalUsage: false,
        isCurrent,
      }),
  });

  // Keep Esc→stop gate current for the capture-phase shortcut listener.
  escapeStopLiveRef.current = {
    streamingOrBusy: effectiveCanStop,
    settingsOpen,
    overlayOpen: Boolean(
      appDialog ||
        searchPalette.open ||
        showDoctor ||
        showTraces ||
        showPlanHistory ||
        planHistoryPreview ||
        planReviseOpen ||
        showShortcuts ||
        showProductTutorial ||
        showStatusModal ||
        showUsageLimitModal ||
        showMcpModal ||
        compact.open ||
        exportMdTarget ||
        exportImageTarget ||
        rewindConfirm ||
        forkConfirm ||
        resumeRestoreConfirm ||
        worktreeCreateOpen ||
        worktreeGcOpen ||
        shipOpen ||
        projectRulesTarget ||
        agentDashboardOpen ||
        taskBoardOpen ||
        batchAgentsOpen ||
        opsEntryOpen,
    ),
    permOpen: !!perm,
    askUserOpen: !!askUser,
    chatFindOpen: showChatFind,
    slashOrMenuOpen:
      composerMenuOpen || phoneToolsOpen || !!ctxMenu || showUserMenu,
    promptHistoryOpen,
  };
  typeToFocusLiveRef.current = {
    enabled:
      appGate === "ready" &&
      !settingsOpen &&
      mainPane === "chat" &&
      canType(session.state),
    overlayOpen: Boolean(
      escapeStopLiveRef.current.overlayOpen ||
        escapeStopLiveRef.current.permOpen ||
        escapeStopLiveRef.current.askUserOpen ||
        escapeStopLiveRef.current.slashOrMenuOpen ||
        escapeStopLiveRef.current.promptHistoryOpen ||
        liveVoiceOpen ||
        showJsonSchemaModal ||
        phoneAccountOpen ||
        sessionSelectMode,
    ),
  };

  /**
   * Stable composer editor callbacks so memo(ComposerEditor) can skip
   * stream-driven shell re-renders when draft/value props are unchanged.
   */
  const onComposerDraftChange = useCallback((next: string) => {
    // Manual edit exits history browse; same text (DOM re-sync) keeps it.
    const idx = promptHistoryIndexRef.current;
    if (idx !== null) {
      const hist = collectUserPromptHistory(messagesRef.current);
      if (next !== hist[idx]) {
        promptHistoryIndexRef.current = null;
        setPromptHistoryIndex(null);
      }
    }
  }, []);

  const onComposerPasteFiles = useCallback(
    (files: File[]) => {
      void (async () => {
        // Explorer copy already has an on-disk path (CF_HDROP). Reading the
        // WebView File via arrayBuffer() throws NotReadableError for .dmp and
        // other locked/large files — attach the original path instead.
        if (api.isTauri()) {
          const native = await api.clipboardFilePaths();
          if (native.length) {
            await addAttachmentsFromPaths(native);
            setLocalError(null);
            return;
          }
        }
        if (files.length) {
          await addAttachmentsFromFiles(files);
          return;
        }
        reportAttachError({ code: "unreadable" }, "paste");
      })();
    },
    [addAttachmentsFromFiles, addAttachmentsFromPaths, reportAttachError],
  );

  const onComposerPasteMediaFallback = useCallback(
    (opts?: { expectMedia?: boolean }) => {
      void pasteMediaFromNativeClipboard(opts);
    },
    [pasteMediaFromNativeClipboard],
  );

  const composerKeyDownRef = useRef<
    (e: ReactKeyboardEvent<HTMLDivElement>) => void
  >(() => {});
  composerKeyDownRef.current = (e) => {
    if (
      e.nativeEvent.isComposing ||
      (e.nativeEvent as KeyboardEvent).keyCode === 229
    ) {
      return;
    }
    if (atMenuOpen) {
      const n = atEntries.length;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!n) return;
        setAtActiveIndex((i) => (i + 1) % n);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (!n) return;
        setAtActiveIndex((i) => (i - 1 + n) % n);
        return;
      }
      if (
        (e.key === "Enter" || e.key === "Tab") &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey
      ) {
        e.preventDefault();
        if (!n) return;
        const entry =
          atEntries[
            Math.min(Math.max(0, atActiveIndex), Math.max(0, n - 1))
          ];
        if (entry) applyAtFile(entry);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeAtMenu();
        return;
      }
    }
    if (composerMenuOpen) {
      // Ref = same array the panel renders (never desync).
      const flat = composerMenuEntriesRef.current;
      const n = flat.length;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!n) return;
        setSlashActiveIndex((i) => (i + 1) % n);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (!n) return;
        setSlashActiveIndex((i) => (i - 1 + n) % n);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const entry =
          flat[
            Math.min(Math.max(0, slashActiveIndex), Math.max(0, n - 1))
          ];
        if (!entry) return;
        if (entry.kind === "upload") void pickComposerFiles();
        else if (entry.kind === "create-video") applyCreateVideo();
        else if (entry.kind === "json-schema") {
          closeComposerMenu();
          setJsonSchemaDraft(sessionJsonSchema ?? "");
          setShowJsonSchemaModal(true);
        } else applySlashItem(entry.item);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeComposerMenu();
        return;
      }
      if (e.key === "Tab" && n > 0) {
        e.preventDefault();
        const entry =
          flat[Math.min(Math.max(0, slashActiveIndex), n - 1)]!;
        if (entry.kind === "upload") void pickComposerFiles();
        else if (entry.kind === "create-video") applyCreateVideo();
        else if (entry.kind === "json-schema") {
          closeComposerMenu();
          setJsonSchemaDraft(sessionJsonSchema ?? "");
          setShowJsonSchemaModal(true);
        } else applySlashItem(entry.item);
        return;
      }
    }
    // Prompt history picker open: ↑/↓/Home/End/Page move selection;
    // Enter/Tab apply; Esc closes (Build `/history` + empty-↑).
    if (promptHistoryOpenRef.current && !composerMenuOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        closePromptHistory();
        return;
      }
      if (
        (e.key === "Enter" && !e.ctrlKey && !e.metaKey) ||
        e.key === "Tab"
      ) {
        const entry = promptHistoryEntries[promptHistoryActive];
        if (entry) {
          e.preventDefault();
          applyPromptHistoryEntry(entry, {
            listIndex: promptHistoryActive,
          });
          return;
        }
      }
      const listNav = promptHistoryListNavFromKey(e.key);
      if (listNav) {
        e.preventDefault();
        if (promptHistoryEntries.length === 0) return;
        const liveSeed =
          !promptHistoryFocusFilter && promptHistoryScope === "session";
        // ArrowDown past newest on live session browse: clear + close.
        if (listNav === "down" && promptHistoryActive <= 0 && liveSeed) {
          promptHistoryIndexRef.current = null;
          setPromptHistoryIndex(null);
          setDraft("");
          closePromptHistory();
          return;
        }
        const next = stepPromptHistoryListIndex(
          promptHistoryActive,
          promptHistoryEntries.length,
          listNav,
        );
        setPromptHistoryActive(next);
        const entry = promptHistoryEntries[next];
        if (entry && liveSeed) {
          applyPromptHistoryEntry(entry, {
            close: false,
            listIndex: next,
            scope: "session",
          });
        }
        return;
      }
    }
    // CLI-like prompt history: ↑ on empty draft opens picker + seeds newest.
    // Only when slash palette is closed so palette ↑/↓ is untouched.
    if (
      (e.key === "ArrowUp" || e.key === "ArrowDown") &&
      !composerMenuOpen &&
      !promptHistoryOpenRef.current
    ) {
      const history = collectUserPromptHistory(messagesRef.current);
      const draftEmpty = isDraftEmpty(parseStoredContent(getDraft()));
      const browsing = promptHistoryIndexRef.current !== null;
      if (
        shouldHandlePromptHistoryKey({
          key: e.key,
          draftEmpty,
          browsing,
          historyLength: history.length,
        })
      ) {
        e.preventDefault();
        if (e.key === "ArrowUp" && !browsing) {
          openPromptHistory({
            focusFilter: false,
            seedDraft: true,
          });
          return;
        }
        const step = stepPromptHistory(
          history,
          promptHistoryIndexRef.current,
          e.key === "ArrowUp" ? "up" : "down",
        );
        promptHistoryIndexRef.current = step.index;
        setPromptHistoryIndex(step.index);
        setDraft(step.text);
        if (step.index == null) {
          closePromptHistory();
        } else if (!promptHistoryOpenRef.current) {
          openPromptHistory({
            focusFilter: false,
            seedDraft: false,
          });
          setPromptHistoryActive(step.index);
        } else {
          setPromptHistoryActive(step.index);
        }
        return;
      }
    }
    const submit = resolveComposerSubmitAction({
      event: e,
      sendPref: composerSendKeyPref,
      canSteer: composerSteerLive({
        canGuideQueuedMessage,
        sessionState: session.state,
      }),
    });
    if (submit === "steer") {
      e.preventDefault();
      void steerFromComposer();
      return;
    }
    if (submit === "send") {
      e.preventDefault();
      const draftNow = getDraft();
      const hasBody =
        !isDraftEmpty(parseStoredContent(draftNow)) ||
        attachments.length > 0 ||
        chatAttachments.length > 0;
      if (hasBody && session.state !== "awaiting_permission") {
        void send();
      }
    }
    if (e.key === "Escape") {
      if (promptHistoryOpenRef.current) {
        closePromptHistory();
        return;
      }
      if (attachChatOpenRef.current) {
        closeAttachChat();
        return;
      }
      closeComposerMenu();
    }
  };

  const onComposerKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      composerKeyDownRef.current(e);
    },
    [],
  );

  return (
    <ImageViewerProvider locale={locale}>
    <div
      className={
        `app-shell platform-${platform}` +
        (windowMaximized ? " is-maximized" : "") +
        (useCustomWindowChrome && !isMirrorClient() ? " has-custom-chrome" : "") +
        (isMirrorClient() ? " app-shell--mirror" : "") +
        (phoneLayout ? " app-shell--phone" : "")
      }
      data-testid="app-shell"
      data-mirror={isMirrorClient() ? "1" : undefined}
      data-phone={phoneLayout ? "1" : undefined}
      style={
        {
          ["--sidebar-rail-width"]: `${layout.sidebarWidth || SIDEBAR_DEFAULT_WIDTH}px`,
        } as CSSProperties
      }
    >
      <WindowControls
        visible={useCustomWindowChrome && !isMirrorClient()}
        labels={{
          minimize: tr("window.minimize"),
          maximize: tr("window.maximize"),
          restore: tr("window.restore"),
          close: tr("window.close"),
        }}
      />

      {wallpaperUrl && wallpaperRecord ? (
        <WallpaperMediaLayer
          url={wallpaperUrl}
          kind={wallpaperRecord.kind}
          focus={wallpaperRecord.focus ?? DEFAULT_WALLPAPER_FOCUS}
          clip={wallpaperRecord.clip ?? null}
          intrinsicSize={
            wallpaperRecord.width && wallpaperRecord.height
              ? { w: wallpaperRecord.width, h: wallpaperRecord.height }
              : null
          }
          onIntrinsicSize={applyWallpaperMediaSize}
        />
      ) : null}

      {appGate === "loading" && (
        <div className="setup-gate" data-testid="setup-booting">
          <div
            className="setup-gate__drag"
            data-tauri-drag-region={dragRegion}
            {...titlebarMax}
          />
          <div className="setup-gate__center">
            <div className="setup-hero">
              <div
                className={
                  "setup-logo" + (bootDetectTimedOut ? "" : " setup-logo--spin")
                }
              >
                <GrokLogo size={44} />
              </div>
              <h1 className="setup-title">
                {bootDetectTimedOut
                  ? tr("setup.detectTimeout")
                  : tr("setup.title")}
              </h1>
              <p className="setup-subtitle">
                {bootDetectTimedOut
                  ? tr("setup.detectTimeoutHint")
                  : bootDetectSlow
                    ? tr("setup.detectingSlow")
                    : tr("setup.detecting")}
              </p>
              {bootDetectTimedOut ? (
                <div className="setup-gate__actions" style={{ marginTop: 20 }}>
                  <button
                    type="button"
                    className="btn btn--primary"
                    data-testid="setup-boot-retry"
                    onClick={() => {
                      setBootDetectTimedOut(false);
                      setBootDetectSlow(false);
                      setLocalError(null);
                      setBootRetryNonce((n) => n + 1);
                    }}
                  >
                    {tr("setup.detectRetry")}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    style={{ marginLeft: 8 }}
                    onClick={() => {
                      setBootDetectTimedOut(false);
                      setAppGate("setup");
                    }}
                  >
                    {tr("setup.cli.required")}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {appGate === "setup" && (
        <Suspense fallback={null}>
        <SetupWizard
          tr={tr}
          platform={platform}
          useCustomWindowChrome={useCustomWindowChrome}
          initialCli={
            setupCliSeed ?? {
              found: false,
              path: null,
              version: null,
              source: "",
              cliAuthPresent: false,
            }
          }
          onAccountLoginOauth={() => runAccountLogin("oauth")}
          onComplete={(cli) => {
            setCliInfo(mapProbeToCliInfo(cli));
            if (cli.path) setManualCliPath(cli.path);
            setSetup((s) => ({
              ...s,
              cli: cli.found,
              auth: s.auth || cli.cliAuthPresent,
            }));
            setAppGate("ready");
            void refreshLists();
            void refreshAccount({ refreshBilling: false });
          }}
        />
        </Suspense>
      )}

      {appGate === "ready" && (
      <>
      {settingsOpen ? (
      <WorkbenchSettingsStage
        account={account}
        accountBusy={accountBusy}
        accountHeatmapError={accountHeatmapError}
        accountLoading={accountLoading}
        accountProbeError={accountProbeError}
        acpServerAddr={acpServerAddr}
        activeAccountId={activeAccountId}
        activeProject={activeProject}
        agentCatalog={agentCatalog}
        agentIdleMinutes={agentIdleMinutes}
        agentProfilePath={agentProfilePath}
        agentsJson={agentsJson}
        allowUnverifiedCliInstall={allowUnverifiedCliInstall}
        allowedTools={allowedTools}
        applyComposerPrefs={applyComposerPrefs}
        applyGlobalSandboxProfile={applyGlobalSandboxProfile}
        applyPermissionPolicy={applyPermissionPolicy}
        applySkinChoice={applySkinChoice}
        applyThemeChoice={applyThemeChoice}
        applyThemeScheduleChoice={applyThemeScheduleChoice}
        applyWallpaperAdjustChoice={applyWallpaperAdjustChoice}
        applyWallpaperChoice={applyWallpaperChoice}
        applyWallpaperMediaSize={applyWallpaperMediaSize}
        applyWallpaperScrimChoice={applyWallpaperScrimChoice}
        archivedGroups={archivedGroups}
        askUserTimeoutSec={askUserTimeoutSec}
        auditLedgerRetentionDays={auditLedgerRetentionDays}
        autoWakeEnabled={autoWakeEnabled}
        availableModels={availableModels}
        backgroundWaitPolicy={backgroundWaitPolicy}
        backgroundWaitTimeoutSec={backgroundWaitTimeoutSec}
        cancelAccountLogin={cancelAccountLogin}
        cliAgentSkewRepairing={cliAgentSkewRepairing}
        cliInfo={cliInfo}
        closeToTray={closeToTray}
        compactionDetail={compact.compactionDetail}
        compactionMode={compact.compactionMode}
        confirmArchiveOlderThan={confirmArchiveOlderThan}
        defaultOpenTarget={defaultOpenTarget}
        deleteSessionsConfirm={deleteSessionsConfirm}
        disableWebSearch={disableWebSearch}
        disallowedTools={disallowedTools}
        effectiveProjectPath={effectiveProjectPath}
        experimentalMemory={experimentalMemory}
        goalOrchUiEnabled={goalOrchUiEnabled}
        handleClearAllSessionMutes={handleClearAllSessionMutes}
        handleClearAllSessionUnread={handleClearAllSessionUnread}
        importChatTranscript={importChatTranscript}
        includePartialMessages={includePartialMessages}
        keepTrayForSchedules={keepTrayForSchedules}
        lastCliChecksumVerified={lastCliChecksumVerified}
        lastProcessLimit={lastProcessLimit}
        launchAtLogin={launchAtLogin}
        locale={locale}
        localePreference={localePreference}
        loginHint={loginHint}
        manualCliPath={manualCliPath}
        maxAgentTurns={maxAgentTurns}
        maxConcurrentAgents={maxConcurrentAgents}
        messageTimeFormat={messageTimeFormat}
        mutedSessionIds={mutedSessionIds}
        navigateSettings={navigateSettings}
        navigateWorkbench={navigateWorkbench}
        noAskUser={noAskUser}
        notifyOnPermission={notifyOnPermission}
        notifyOnTurnDone={notifyOnTurnDone}
        notifySound={notifySound}
        openAsidePane={openAsidePane}
        openBatchAgents={openBatchAgents}
        openDoctor={openDoctor}
        openReliability={openReliability}
        openSandboxWizardGuide={openSandboxWizardGuide}
        permissionTimeoutSec={permissionTimeoutSec}
        phoneLayout={phoneLayout}
        planEnabled={planEnabled}
        policy={policy}
        prHubHighlightPr={prHubHighlightPr}
        preferredAgent={preferredAgent}
        prefsScope={prefsScope}
        projects={projects}
        proxyMode={proxyMode}
        proxyNoProxy={proxyNoProxy}
        proxyUrl={proxyUrl}
        refreshAccount={refreshAccount}
        refreshProviderRoute={refreshProviderRoute}
        refreshSessions={refreshSessions}
        refreshVoiceGate={refreshVoiceGate}
        reopenLastSession={reopenLastSession}
        replaceProviderBrandLogo={replaceProviderBrandLogo}
        welcomeMotionEnabled={welcomeMotionEnabled}
        setWelcomeMotionEnabled={setWelcomeMotionEnabled}
        restoreSessions={restoreSessions}
        runAccountLogin={runAccountLogin}
        runAccountLogout={runAccountLogout}
        runAddAccount={runAddAccount}
        runRemoveAccount={runRemoveAccount}
        runSaveAccount={runSaveAccount}
        runSwitchAccount={runSwitchAccount}
        sandboxProfile={sandboxProfile}
        savedAccounts={savedAccounts}
        session={session}
        sessionDataMode={sessionDataMode}
        sessions={sessions}
        setAcpServerAddr={setAcpServerAddr}
        setAgentIdleMinutes={setAgentIdleMinutes}
        setAgentProfilePath={setAgentProfilePath}
        setAgentsJson={setAgentsJson}
        setAllowUnverifiedCliInstall={setAllowUnverifiedCliInstall}
        setAllowedTools={setAllowedTools}
        setAppDialog={setAppDialog}
        setAskUserTimeoutSec={setAskUserTimeoutSec}
        setAuditLedgerRetentionDays={setAuditLedgerRetentionDays}
        setAutoWakeEnabled={setAutoWakeEnabled}
        setBackgroundWaitPolicy={setBackgroundWaitPolicy}
        setBackgroundWaitTimeoutSec={setBackgroundWaitTimeoutSec}
        setCliAgentSkewRepairing={setCliAgentSkewRepairing}
        setCliInfo={setCliInfo}
        setCloseToTray={setCloseToTray}
        setCompactionDetail={compact.setCompactionDetail}
        setCompactionMode={compact.setCompactionMode}
        setDefaultOpenTarget={setDefaultOpenTarget}
        setDisableWebSearch={setDisableWebSearch}
        setDisallowedTools={setDisallowedTools}
        setExperimentalMemory={setExperimentalMemory}
        setGoalOrchUiEnabled={setGoalOrchUiEnabled}
        setIncludePartialMessages={setIncludePartialMessages}
        setKeepTrayForSchedules={setKeepTrayForSchedules}
        setLaunchAtLogin={setLaunchAtLogin}
        setLocale={setLocale}
        setLocalePreference={setLocalePreference}
        setManualCliPath={setManualCliPath}
        setMaxAgentTurns={setMaxAgentTurns}
        setMaxConcurrentAgents={setMaxConcurrentAgents}
        setMessageTimeFormat={setMessageTimeFormat}
        setNoAskUser={setNoAskUser}
        setNotifyOnPermission={setNotifyOnPermission}
        setNotifyOnTurnDone={setNotifyOnTurnDone}
        setNotifySound={setNotifySound}
        setPermissionTimeoutSec={setPermissionTimeoutSec}
        setPlanEnabled={setPlanEnabled}
        setPreferredAgent={setPreferredAgent}
        setPrefsScope={setPrefsScope}
        setProviderBalanceCache={setProviderBalanceCache}
        setProxyMode={setProxyMode}
        setProxyNoProxy={setProxyNoProxy}
        setProxyUrl={setProxyUrl}
        setReopenLastSession={setReopenLastSession}
        setReplaceProviderBrandLogo={setReplaceProviderBrandLogo}
        setResourceOpenTarget={setResourceOpenTarget}
        setSession={setSession}
        setSessionDataMode={setSessionDataMode}
        setSettingsFocusAnchor={setSettingsFocusAnchor}
        setSetup={setSetup}
        setShowMessageTimestamps={setShowMessageTimestamps}
        setShowProductTutorial={setShowProductTutorial}
        setShowReplyLength={setShowReplyLength}
        setShowShortcuts={setShowShortcuts}
        setSidebarShowRelativeTime={setSidebarShowRelativeTime}
        setSkillsReloadToken={setSkillsReloadToken}
        setStoreApiKeysInKeychain={setStoreApiKeysInKeychain}
        setStreamStallSeconds={setStreamStallSeconds}
        setSttCustomBaseUrl={setSttCustomBaseUrl}
        setSttCustomLanguage={setSttCustomLanguage}
        setSttCustomModel={setSttCustomModel}
        setSttEngine={setSttEngine}
        setSttZhScript={setSttZhScript}
        setSubagentWorktreeSnapshotEnabled={setSubagentWorktreeSnapshotEnabled}
        setSubagentsEnabled={setSubagentsEnabled}
        setToast={setToast}
        setTodoGateEnabled={setTodoGateEnabled}
        setTodoGateMaxFiresPerPrompt={setTodoGateMaxFiresPerPrompt}
        setTrayBusyBadge={setTrayBusyBadge}
        setTwoPassCompactionEnabled={setTwoPassCompactionEnabled}
        setUseLeader={setUseLeader}
        setVoiceDictationAutoSend={setVoiceDictationAutoSend}
        setVoiceId={setVoiceId}
        setVoiceKeepAgentsOnEnd={setVoiceKeepAgentsOnEnd}
        setWinTaskbarOverlay={setWinTaskbarOverlay}
        setWindowAlwaysOnTop={setWindowAlwaysOnTop}
        setWorkflowsEnabled={setWorkflowsEnabled}
        setZenModeEnabled={setZenModeEnabled}
        settingsFocusAnchor={settingsFocusAnchor}
        settingsLabels={settingsLabels}
        settingsSection={settingsSection}
        settingsTab={settingsTab}
        showMessageTimestamps={showMessageTimestamps}
        showReplyLength={showReplyLength}
        showToast={showToast}
        sidebarShowRelativeTime={sidebarShowRelativeTime}
        skin={skin}
        storeApiKeysInKeychain={storeApiKeysInKeychain}
        streamStallSeconds={streamStallSeconds}
        sttCustomBaseUrl={sttCustomBaseUrl}
        sttCustomLanguage={sttCustomLanguage}
        sttCustomModel={sttCustomModel}
        sttEngine={sttEngine}
        sttZhScript={sttZhScript}
        subagentWorktreeSnapshotEnabled={subagentWorktreeSnapshotEnabled}
        subagentsEnabled={subagentsEnabled}
        submitAccountLoginCode={submitAccountLoginCode}
        theme={theme}
        themePreference={themePreference}
        themeSchedule={themeSchedule}
        todoGateEnabled={todoGateEnabled}
        todoGateMaxFiresPerPrompt={todoGateMaxFiresPerPrompt}
        tr={tr}
        trayBusyBadge={trayBusyBadge}
        trayHandlersRef={trayHandlersRef}
        twoPassCompactionEnabled={twoPassCompactionEnabled}
        unreadSessionIds={unreadSessionIds}
        useLeader={useLeader}
        voiceDictationAutoSend={voiceDictationAutoSend}
        voiceId={voiceId}
        voiceKeepAgentsOnEnd={voiceKeepAgentsOnEnd}
        wallpaperRecord={wallpaperRecord}
        wallpaperScrim={wallpaperScrim}
        wallpaperUrl={wallpaperUrl}
        winTaskbarOverlay={winTaskbarOverlay}
        windowAlwaysOnTop={windowAlwaysOnTop}
        workflowsEnabled={workflowsEnabled}
        zenMode={zenMode}
      />
      ) : null}
      <div
        className={
          "workbench" +
          (phoneLayout ? " workbench--phone" : "") +
          (sidePaneCoversMain ? " workbench--side-expanded" : "") +
          (sideDockActive ? " workbench--side-dock" : "") +
          paneMotionClass
        }
        aria-hidden={settingsOpen || undefined}
        inert={settingsOpen || undefined}
        style={
          {
            // Free-area left edge for expanded side overlay (px).
            ["--sw-sidebar-occupied"]:
              phoneLayout || layout.sidebarCollapsed || sidebarOverlay
                ? "0px"
                : `${layout.sidebarWidth}px`,
            // Bottom strip reserved only while dock toggle is on.
            // Floor avoids first-frame cover before ResizeObserver measures.
            ["--sw-dock-composer-h"]: sideDockActive
              ? `${Math.max(sideDockComposerH, 96)}px`
              : "0px",
          } as CSSProperties
        }
      >
        {!phoneLayout ? (
          <>
            <PaneToggleButton
              side="left"
              open={!layout.sidebarCollapsed}
              unread={sidebarToggleUnread}
              label={tr(
                layout.sidebarCollapsed
                  ? "main.leftPaneShow"
                  : "main.leftPaneHide",
              )}
              unreadLabel={tr("main.paneUnread")}
              controlsId="workbench-sidebar"
              onToggle={
                layout.sidebarCollapsed ? openSidebarPane : closeSidebarPane
              }
            />
            <PaneToggleButton
              side="right"
              open={!layout.asideCollapsed}
              unread={asideToggleUnread}
              label={tr(
                layout.asideCollapsed
                  ? "main.rightPaneShow"
                  : "main.rightPaneHide",
              )}
              unreadLabel={tr("main.paneUnread")}
              controlsId="workbench-aside"
              testId="main-side-toggle"
              onToggle={layout.asideCollapsed ? openAsidePane : closeAsidePane}
            />
          </>
        ) : null}
        {/* Phone drawer scrim — tap closes without resizing the conversation */}
        {phoneLayout && !layout.sidebarCollapsed ? (
          <button
            type="button"
            className="phone-drawer-scrim"
            aria-label={tr("phone.drawerClose")}
            onClick={closePhoneDrawer}
          />
        ) : null}
        {!phoneLayout && sidebarOverlay && !layout.sidebarCollapsed ? (
          <button
            type="button"
            className="workbench-pane-scrim"
            aria-label={tr("phone.drawerClose")}
            onClick={() => {
              closeSidebarPane();
            }}
          />
        ) : null}
        {/* LEFT — fully hideable (not icon-rail); fixed toggle reopens it */}
        <WorkbenchSidebar
          tr={tr}
          locale={locale}
          layout={layout}
          phoneLayout={phoneLayout}
          sidebarOverlay={sidebarOverlay}
          resizingSidebar={resizingSidebar}
          dragZone={dragZone}
          sidebarOpenW={sidebarOpenW}
          sidebarPaint={sidebarPaint}
          beginSidebarResize={beginSidebarResize}
          dragRegion={dragRegion}
          titlebarMax={titlebarMax}
          replaceProviderBrandLogo={replaceProviderBrandLogo}
          customRouteActive={customRouteActive}
          activeCustomProvider={activeCustomProvider}
          mainPane={mainPane}
          onOpenSearch={() => searchPalette.openBlank()}
          onNewChat={() => void newChat(null)}
          onNavigateAutomations={navigateAutomations}
          onNavigateKanban={navigateKanban}
          onNavigateRemoteIm={() => navigateSettings("remote_im", "im")}
          showUserMenu={showUserMenu}
          setShowUserMenu={setShowUserMenu}
          closeImmediately={settingsOpen}
          theme={theme}
          themePreference={themePreference}
          account={account}
          accountBusy={accountBusy}
          providerBalanceCache={providerBalanceCache}
          providerBalanceBusy={providerBalanceBusy}
          providerBalanceError={providerBalanceError}
          loadProviderBalance={loadProviderBalance}
          applyThemeChoice={applyThemeChoice}
          onSettings={() => navigateSettings()}
          onAccountSettings={() => navigateSettings("account")}
          onTutorial={() => setShowProductTutorial(true)}
          onLogin={() => void runAccountLogin("oauth")}
          onLogout={() => void runAccountLogout()}
          savedAccounts={savedAccounts}
          activeAccountId={activeAccountId}
          accountQuotas={accountQuotas}
          onSwitchAccount={(id) => void runSwitchAccount(id)}
          onUserMenuOpened={() => {
            void refreshAccount({ refreshBilling: !customRouteActive });
            void refreshSavedAccounts();
            if (!customRouteActive) void refreshAccountQuotas();
            if (
              activeCustomProvider &&
              supportsProviderBalance({
                providerId: activeCustomProvider.id,
                baseUrl: activeCustomProvider.baseUrl,
              })
            ) {
              void loadProviderBalance();
            }
          }}
        >
          <WorkbenchSessionTree
            tr={tr}
            locale={locale}
            sidebarCliImportCta={sidebarCliImportCta}
            projects={projects}
            visibleProjects={visibleProjects}
            sessions={sessions}
            projectsOpen={projectsOpen}
            setProjectsOpen={setProjectsOpen}
            historyOpen={historyOpen}
            setHistoryOpen={setHistoryOpen}
            expandedProjects={expandedProjects}
            setExpandedProjects={setExpandedProjects}
            projectSpaces={projectSpaces}
            promptCreateSpace={promptCreateSpace}
            promptRenameSpace={promptRenameSpace}
            confirmDeleteSpace={confirmDeleteSpace}
            sessionSelectMode={sessionSelectMode}
            selectedSessionIds={selectedSessionIds}
            selectableSessionCount={selectableSessionCount}
            enterSessionSelectMode={enterSessionSelectMode}
            exitSessionSelectMode={exitSessionSelectMode}
            toggleSessionSelected={toggleSessionSelected}
            toggleSessionsSelected={toggleSessionsSelected}
            unreadSessionIds={unreadSessionIds}
            handleClearAllSessionUnread={handleClearAllSessionUnread}
            setCtxMenu={setCtxMenu}
            addProject={addProject}
            projectReorder={projectReorder}
            openProjectMenu={openProjectMenu}
            newChat={newChat}
            relocateProject={relocateProject}
            trustProject={trustProject}
            viewingSessionId={session.sessionId}
            busyIds={busyIds}
            planPendingSessionIds={planPendingSessionIds}
            mutedSessionIds={mutedSessionIds}
            sessionNotesMap={sessionNotesMap}
            sidebarSessionLabels={sidebarSessionLabels}
            sidebarShowRelativeTime={sidebarShowRelativeTime}
            sidebarRowMetrics={sidebarRowMetrics}
            buildSidebarWorktreeBadge={buildSidebarWorktreeBadge}
            onSidebarSessionOpen={onSidebarSessionOpen}
            onSidebarSessionContextMenu={onSidebarSessionContextMenu}
            onSidebarSessionPin={onSidebarSessionPin}
            onSidebarSessionArchive={onSidebarSessionArchive}
            onSidebarSessionMenu={onSidebarSessionMenu}
            onSidebarSessionRename={onSidebarSessionRename}
            confirmBulkSetArchived={confirmBulkSetArchived}
            deleteSessionsConfirm={deleteSessionsConfirm}
          />
        </WorkbenchSidebar>

        <WorkbenchMain
          tr={tr}
          locale={locale}
          layout={layout}
          phoneLayout={phoneLayout}
          dragZone={dragZone}
          sidePaneCoversMain={sidePaneCoversMain}
          toast={toast}
          dragRegion={dragRegion}
          titlebarMax={titlebarMax}
          mainPane={mainPane}
          sessions={sessions}
          session={session}
          activeProject={activeProject}
          messages={messages}
          openPhoneDrawer={openPhoneDrawer}
          closePhoneDrawer={closePhoneDrawer}
          sidebarToggleUnread={sidebarToggleUnread}
          openSessionMenu={openSessionMenu}
          onOpenPhoneAccount={() => setPhoneAccountOpen(true)}
          bottomTerminalOpen={bottomTerminal.state.open}
          onToggleBottomTerminal={bottomTerminal.toggle}
          mirrorLinkOk={mirrorLinkOk}
          mirrorHostLabel={mirrorHostLabel}
          connPill={connPill}
          connPillCanRetry={connPillCanRetry}
          onRetryAgentConnect={retryAgentConnect}
          defaultOpenTarget={defaultOpenTarget}
          persistOpenTarget={persistOpenTarget}
          onOpenLocationError={(e) => setLocalError(e)}
          platform={platform}
          effectiveProjectPath={effectiveProjectPath}
          sideIsGitProject={sideIsGitProject}
          sessionChangesSummary={sessionChangesSummary}
          gitDirtySummary={gitDirtySummary}
          sideWorkbench={sideWorkbench}
          setSideWorkbench={setSideWorkbench}
          openAsidePane={openAsidePane}
          showToast={showToast}
        >
          {mainPane === "kanban" ? (
            <Suspense fallback={null}>
              <KanbanBoardPage
                locale={locale}
                sessions={sessions}
                projects={projects.map((p) => ({
                  id: p.id,
                  name: p.name,
                  path: p.path,
                }))}
                liveMap={liveMap}
                currentSessionId={session.sessionId}
                untitledLabel={tr("session.untitled")}
                generalWorkspacePath={generalWorkspacePath}
                unboundProjectLabel={tr("sidebar.otherSessions")}
                onSelectSession={openSessionByIdHandler}
              />
            </Suspense>
          ) : mainPane === "automations" ? (
                        <Suspense fallback={null}>
              <AutomationsPage
              t={(k, vars) =>
              tr(k as Parameters<typeof tr>[0], vars as Record<string, string | number>)
              }
              projects={projects.map((p) => ({ id: p.id, name: p.name }))}
              defaultModelId={modelId}
              defaultEffort={effort}
              models={availableModels}
              openAtLogin={launchAtLogin}
              onOpenLaunchAtLogin={() => {
              navigateSettings("general", "app");
              // Scroll/highlight Launch at login after Settings mounts.
              window.setTimeout(() => {
              const el = document.getElementById(
              "settings-anchor-launchAtLogin",
              );
              if (el) {
              el.scrollIntoView({ block: "center", behavior: "smooth" });
              el.classList.add("is-search-hit");
              window.setTimeout(
              () => el.classList.remove("is-search-hit"),
              1600,
              );
              }
              }, 120);
              }}
              closeToTray={closeToTray}
              keepTrayForSchedules={keepTrayForSchedules}
              onKeepTrayForSchedules={(v) => {
              setKeepTrayForSchedules(v);
              void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, keepTrayForSchedules: v }),
              );
              }}
              onOpenKeepTraySetting={() => {
              navigateSettings("general", "app");
              window.setTimeout(() => {
              const el = document.getElementById(
              "settings-anchor-keepTrayForSchedules",
              );
              if (el) {
              el.scrollIntoView({ block: "center", behavior: "smooth" });
              el.classList.add("is-search-hit");
              window.setTimeout(
              () => el.classList.remove("is-search-hit"),
              1600,
              );
              }
              }, 120);
              }}
              onAiCreate={() => {
              void newChat(null, {
              seedDraft: aiCreateSeedPrompt("Grok"),
              switchToChat: true,
              automationSetup: true,
              });
              setToast(tr("automations.aiComposerHint"));
              window.setTimeout(() => setToast(null), 4200);
              }}
              onRunNow={(auto) => void runAutomation(auto)}
              />            </Suspense>
          ) : (
          <>
          {activeProject && isProjectPathMissing(activeProject.pathOk) && (
            <div className="conn-bar">
              <span style={{ fontSize: 12, opacity: 0.9, marginRight: 8 }}>
                {tr("project.pathMissingShort")}
              </span>
              <button
                type="button"
                className="btn btn--primary"
                style={{ height: 24, fontSize: 11 }}
                onClick={() => void relocateProject(activeProject)}
              >
                {tr("project.relocateToSend")}
              </button>
            </div>
          )}
          {activeProject &&
            !isProjectPathMissing(activeProject.pathOk) &&
            !activeProject.trusted && (
            <div className="conn-bar">
              <button
                type="button"
                className="btn btn--primary"
                style={{ height: 24, fontSize: 11 }}
                onClick={() => void trustProject(activeProject)}
              >
                {tr("project.trustToSend", { name: activeProject.name })}
              </button>
            </div>
          )}

          {emptyExistingSession && (
            <div className="conn-bar" role="status">
              <span style={{ fontSize: 12, opacity: 0.85 }}>
                {tr("automations.emptySession")}
              </span>
            </div>
          )}

          {cliUpdateOffer && mainPane === "chat" && (
            <div className="conn-bar cli-update-notice" role="status">
              <span style={{ fontSize: 12, flex: 1 }}>
                {tr("cliUpdate.notice", {
                  current: cliUpdateOffer.current,
                  latest: cliUpdateOffer.latest,
                })}
              </span>
              <button
                type="button"
                className="btn btn--primary"
                style={{ height: 24, fontSize: 11 }}
                disabled={cliUpdateBusy}
                onClick={() => {
                  void (async () => {
                    setCliUpdateBusy(true);
                    try {
                      const r = await api.cliUpdateInstall();
                      if (!r.ok) {
                        showToast(
                          tr("settings.cliUpdateInstallFailed", {
                            error: r.message || "failed",
                          }),
                          4500,
                        );
                        return;
                      }
                      dismissCliUpdateNotice(cliUpdateOffer.latest);
                      setCliUpdateOffer(null);
                      try {
                        await api.agentsRecycleAll();
                      } catch {
                        /* soft */
                      }
                    } catch (e) {
                      showToast(
                        tr("settings.cliUpdateInstallFailed", {
                          error: String(e),
                        }),
                        4500,
                      );
                    } finally {
                      setCliUpdateBusy(false);
                    }
                  })();
                }}
              >
                {cliUpdateBusy
                  ? tr("settings.cliUpdateInstalling")
                  : tr("cliUpdate.action")}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                style={{ height: 24, fontSize: 11 }}
                disabled={cliUpdateBusy}
                onClick={() => {
                  dismissCliUpdateNotice(cliUpdateOffer.latest);
                  setCliUpdateOffer(null);
                }}
              >
                {tr("cliUpdate.later")}
              </button>
            </div>
          )}

          <WorkbenchChatStage
            activeProject={activeProject}
            approvePlan={approvePlan}
            attachLabels={attachLabels}
            attachedChatLookup={attachedChatLookup}
            availableModels={availableModels}
            beginEditLastUser={beginEditLastUser}
            canEditLastUser={canEditLastUser}
            canRewindSession={canRewindSession}
            cancelEditUser={cancelEditUser}
            chatFindFocusKey={chatFindFocusKey}
            composerFloatPad={composerFloatPad}
            connecting={connecting}
            copyGoalOrchControlSummary={copyGoalOrchControlSummary}
            dismissPlan={dismissPlan}
            editAttachments={editAttachments}
            editSubmitting={editSubmitting}
            editingUserMessageId={editingUserMessageId}
            effectiveProjectPath={effectiveProjectPath}
            errorBanner={errorBanner}
            errorDetailOpen={errorDetailOpen}
            exitPlanMode={exitPlanMode}
            gitWorktrees={gitWorktrees}
            goalMode={goalMode}
            goalOrchSessionChip={goalOrchSessionChip}
            goalOrchSessionEvents={goalOrchSessionEvents}
            hasChatTurnError={hasChatTurnError}
            isSecondaryWindow={isSecondaryWindow}
            journalPending={journalPending}
            lastUserMessageId={lastUserMessageId}
            liveMap={liveMap}
            locale={locale}
            mainPane={mainPane}
            markSessionWorktree={markSessionWorktree}
            messageTimeFormat={messageTimeFormat}
            mode={mode}
            modelId={modelId}
            onForkFromAssistantMessage={onForkFromAssistantMessage}
            onRewindToUserMessage={onRewindToUserMessage}
            onThreadAddAttachmentToComposer={onThreadAddAttachmentToComposer}
            onThreadAddQuote={onThreadAddQuote}
            onThreadContinueInterrupted={onThreadContinueInterrupted}
            onThreadOpenError={onThreadOpenError}
            onThreadOpenModifiedPath={onThreadOpenModifiedPath}
            onThreadOpenResource={onThreadOpenResource}
            onThreadOpenSessionChanges={onThreadOpenSessionChanges}
            onThreadRemoveEditAttachment={onThreadRemoveEditAttachment}
            openExternalLinkFromChat={openExternalLinkFromChat}
            openPlanInResource={openPlanInResource}
            openReliability={openReliability}
            openRequestPlanChanges={openRequestPlanChanges}
            openSession={openSession}
            plan={plan}
            projects={projects}
            regenerateLastAssistant={regenerateLastAssistant}
            requestClearLocalGoalOrchTimeline={requestClearLocalGoalOrchTimeline}
            retryAgentConnect={retryAgentConnect}
            runErrorBannerAction={runErrorBannerAction}
            session={session}
            sessionJsonSchema={sessionJsonSchema}
            sessionTranscriptStore={sessionTranscriptStore}
            sessions={sessions}
            setAgentDashboardOpen={setAgentDashboardOpen}
            setErrorDetailOpen={setErrorDetailOpen}
            setGoalMode={setGoalMode}
            setLiveMap={setLiveMap}
            setShowChatFind={setShowChatFind}
            setStreamStall={setStreamStall}
            setTasksPanelOpen={setTasksPanelOpen}
            shouldDisableReconnectBecauseConnecting={shouldDisableReconnectBecauseConnecting}
            showChatFind={showChatFind}
            showMessageTimestamps={showMessageTimestamps}
            showReplyLength={showReplyLength}
            showToast={showToast}
            stop={stop}
            stopAllBusySessions={stopAllBusySessions}
            stopGate={stopGate}
            stopLatch={stopLatch}
            streamA11yNote={streamA11yNote}
            streamStall={streamStall}
            structuredOutputLabels={structuredOutputLabels}
            structuredOutputUsage={structuredOutputUsage}
            subagentWorktreeSnapshotEnabled={subagentWorktreeSnapshotEnabled}
            submitEditLastUser={submitEditLastUser}
            switchToWorktree={switchToWorktree}
            tasksPanelOpen={tasksPanelOpen}
            tr={tr}
            turnStartedAt={turnStartedAt}
            viewingSessionIdRef={viewingSessionIdRef}
            welcomeSession={welcomeSession}
            worktreeEntryForPath={worktreeEntryForPath}
          >
          <WorkbenchComposerColumn
            account={account}
            activeProject={activeProject}
            addProjectFromPicker={addProjectFromPicker}
            applyAtFile={applyAtFile}
            applyAttachedChat={applyAttachedChat}
            applyCreateVideo={applyCreateVideo}
            applyPermissionPolicy={applyPermissionPolicy}
            applyPromptHistoryEntry={applyPromptHistoryEntry}
            applySlashItem={applySlashItem}
            atActiveIndex={atActiveIndex}
            atEntries={atEntries}
            atLoading={atLoading}
            atMenuOpen={atMenuOpen}
            atPanelRef={atPanelRef}
            atSoftFail={atSoftFail}
            attachChatActive={attachChatActive}
            attachChatFilter={attachChatFilter}
            attachChatOpen={attachChatOpen}
            attachChatPanelRef={attachChatPanelRef}
            attachChatPos={attachChatPos}
            attachLabels={attachLabels}
            attachScopeLabel={attachScopeLabel}
            attachableSessions={attachableSessions}
            attachments={attachments}
            availableModels={availableModels}
            bindSessionProject={bindSessionProject}
            canGuideQueuedMessage={canGuideQueuedMessage}
            channelEffortOptions={channelEffortOptions}
            chatAttachments={chatAttachments}
            clearSlashFilters={clearSlashFilters}
            cliWorktrees={cliWorktrees}
            cliWorktreesAvailable={cliWorktreesAvailable}
            cliWorktreesLoading={cliWorktreesLoading}
            cliWorktreesReason={cliWorktreesReason}
            closeAttachChat={closeAttachChat}
            closeComposerMenu={closeComposerMenu}
            closePromptHistory={closePromptHistory}
            composerAtPos={composerAtPos}
            composerInputRef={composerInputRef}
            composerMenuEntries={composerMenuEntries}
            composerMenuOpen={composerMenuOpen}
            composerPlusPanelRef={composerPlusPanelRef}
            composerPlusPos={composerPlusPos}
            composerPlusTriggerRef={composerPlusTriggerRef}
            composerProviderInputs={composerProviderInputs}
            composerShellRef={composerShellRef}
            composerSpellcheck={composerSpellcheck}
            composerWrapRef={composerWrapRef}
            confirmRemoveWorktree={confirmRemoveWorktree}
            connecting={connecting}
            contextUsageDisplay={contextUsageDisplay}
            currentModelWindow={currentModelWindow}
            customRouteActive={customRouteActive}
            cycleAttachedChatScope={cycleAttachedChatScope}
            effectiveCanSend={effectiveCanSend}
            effectiveCanStop={effectiveCanStop}
            effort={effort}
            formatPermCountdown={formatPermCountdown}
            gitDirtySummary={gitDirtySummary}
            gitWorktrees={gitWorktrees}
            gitWorktreesAvailable={gitWorktreesAvailable}
            gitWorktreesLoading={gitWorktreesLoading}
            gitWorktreesReason={gitWorktreesReason}
            goalMode={goalMode}
            guideQueuedMessage={guideQueuedMessage}
            guidingQueueItemId={guidingQueueItemId}
            handleContextWindow={handleContextWindow}
            handleEffortPick={handleEffortPick}
            handleModelPick={handleModelPick}
            layout={layout}
            liveAt={liveAt}
            liveSlash={liveSlash}
            liveVoiceOpen={liveVoiceOpen}
            locale={locale}
            mode={mode}
            modelId={modelId}
            onComposerContextMenu={onComposerContextMenu}
            onComposerDraftChange={onComposerDraftChange}
            onComposerKeyDown={onComposerKeyDown}
            onComposerPasteFiles={onComposerPasteFiles}
            onComposerPasteMediaFallback={onComposerPasteMediaFallback}
            onSlashQueryChange={onSlashQueryChange}
            openAsidePane={openAsidePane}
            openQueueEdit={queueEdit.openEdit}
            openSession={openSession}
            openShipFlow={openShipFlow}
            openSideSkillsPanel={openSideSkillsPanel}
            openWorktreeCreate={openWorktreeCreate}
            openWorktreeGc={openWorktreeGc}
            perm={perm}
            permBarRef={permBarRef}
            permCountdownStartedAt={permCountdownStartedAt}
            permissionTimeoutSec={permissionTimeoutSec}
            phoneLayout={phoneLayout}
            phoneToolsOpen={phoneToolsOpen}
            pickComposerFiles={pickComposerFiles}
            policy={policy}
            projects={projects}
            promptHistoryActive={promptHistoryActive}
            promptHistoryEntries={promptHistoryEntries}
            promptHistoryEntryMeta={promptHistoryEntryMeta}
            promptHistoryFilter={promptHistoryFilter}
            promptHistoryFocusFilter={promptHistoryFocusFilter}
            promptHistoryOpen={promptHistoryOpen}
            promptHistoryPanelRef={promptHistoryPanelRef}
            promptHistoryPos={promptHistoryPos}
            promptHistoryScope={promptHistoryScope}
            promptHistoryUnfilteredCount={promptHistoryUnfilteredCount}
            providerActiveId={providerActiveId}
            providerActiveSource={providerActiveSource}
            queueEditItemId={queueEdit.editItemId}
            queuePreviewLabels={queuePreviewLabels}
            quotes={quotes}
            refreshCliWorktrees={refreshCliWorktrees}
            refreshGitWorktrees={refreshGitWorktrees}
            removeAttachedChat={removeAttachedChat}
            requestClearComposerDraft={requestClearComposerDraft}
            requestClearSendQueue={queueEdit.requestClear}
            resizingSidebar={resizingSidebar}
            resolvePermission={resolvePermission}
            resolveSlashDescription={resolveSlashDescription}
            resolveSlashTitle={resolveSlashTitle}
            send={send}
            sendQueue={sendQueue}
            sendQueueStrip={sendQueueStrip}
            session={session}
            sessionChangesSummary={sessionChangesSummary}
            sessionJsonSchema={sessionJsonSchema}
            sessions={sessions}
            setAtActiveIndex={setAtActiveIndex}
            setAttachChatActive={setAttachChatActive}
            setAttachChatFilter={setAttachChatFilter}
            setAttachments={setAttachments}
            setCompactNote={compact.setNote}
            setGoalMode={setGoalMode}
            setJsonSchemaDraft={setJsonSchemaDraft}
            setMode={setMode}
            setPhoneToolsOpen={setPhoneToolsOpen}
            setPromptHistoryActive={setPromptHistoryActive}
            setPromptHistoryClearOpen={setPromptHistoryClearOpen}
            setPromptHistoryFilter={setPromptHistoryFilter}
            setPromptHistoryIndex={setPromptHistoryIndex}
            setPromptHistoryScope={setPromptHistoryScope}
            setQuotes={setQuotes}
            setRecentPromptHistory={setRecentPromptHistory}
            setResourceOpenTarget={setResourceOpenTarget}
            setShowCompactModal={compact.setOpen}
            setShowComposerPlus={setShowComposerPlus}
            setShowJsonSchemaModal={setShowJsonSchemaModal}
            setShowUsageLimitModal={setShowUsageLimitModal}
            setSlashActiveIndex={setSlashActiveIndex}
            setSlashKindFilter={setSlashKindFilter}
            showComposerDraftStats={showComposerDraftStats}
            showToast={showToast}
            sideDockActive={sideDockActive}
            sideWorkbench={sideWorkbench}
            skillsLoadError={skillsLoadError}
            skillsLoading={skillsLoading}
            slashActiveIndex={slashActiveIndex}
            slashCatalog={slashCatalog}
            slashCatalogCount={slashCatalogCount}
            slashKindCounts={slashKindCounts}
            slashKindFilter={slashKindFilter}
            stop={stop}
            switchToWorktree={switchToWorktree}
            toggleVoice={toggleVoice}
            voice={voice}
            voiceDictationAutoSend={voiceDictationAutoSend}
            voiceGate={voiceGate}
            welcomeBrandKind={welcomeBrandKind}
            welcomeProviderBrandNode={welcomeProviderBrandNode}
            welcomeSession={welcomeSession}
            welcomeMotionEnabled={welcomeMotionEnabled}
            welcomeIntroActive={welcomeIntroActive}
            welcomePrompt={welcomePrompt}
            setWelcomeIntroActive={setWelcomeIntroActive}
            dockSidebarOccupied={dockSidebarOccupied}
            dragZone={dragZone}
            mainPane={mainPane}
            tr={tr}
            slashFilterQuery={slashFilterQuery}
            composerPlusStyle={composerPlusStyle}
            composerAtStyle={composerAtStyle}
            attachChatStyle={attachChatStyle}
            promptHistoryStyle={promptHistoryStyle}
            promptHistoryIndexRef={promptHistoryIndexRef}
          />
          </WorkbenchChatStage>
          </>
          )}
          {bottomTerminalMounted ? (
            <Suspense fallback={null}>
              <BottomTerminal
                locale={locale}
                projectPath={effectiveProjectPath}
                state={bottomTerminal.state}
                onAddTab={bottomTerminal.addTab}
                onCloseTab={bottomTerminal.closeTab}
                onCloseAllTabs={bottomTerminal.closeAllTabs}
                onActivateTab={bottomTerminal.activateTab}
                onHeightChange={bottomTerminal.setHeight}
                onClosePanel={bottomTerminal.closePanel}
              />
            </Suspense>
          ) : null}
        </WorkbenchMain>

        <WorkbenchResourcesAside
          tr={tr}
          locale={locale}
          layout={layout}
          phoneLayout={phoneLayout}
          sidePaneCoversMain={sidePaneCoversMain}
          asideOverlay={asideOverlay}
          resizingAside={resizingAside}
          asideOpenW={asideOpenW}
          asidePaint={asidePaint}
          beginAsideResize={beginAsideResize}
          effectiveProjectPath={effectiveProjectPath}
          projectName={
            activeProject
              ? projectDisplayName(activeProject, tr)
              : tr("composer.noProject")
          }
          sideIsGitProject={sideIsGitProject}
          sideWorkbench={sideWorkbench}
          setSideWorkbench={setSideWorkbench}
          sideDockComposer={sideDockComposer}
          onToggleSideDockComposer={onToggleSideDockComposer}
          sessionChanges={
            sessionChangesById[session.sessionId || ""] ?? []
          }
          plan={plan}
          planFocusKey={planFocusKey}
          composerMode={mode}
          planEnabled={planEnabled}
          planUserClosed={plan.userClosed}
          planHistoryNonEmpty={planHistoryNonEmpty}
          onApprovePlan={() => void approvePlan()}
          onRequestPlanChanges={() => openRequestPlanChanges()}
          onDismissPlan={() => void dismissPlan()}
          onOpenPlanHistory={() => setShowPlanHistory(true)}
          resourceOpenTarget={resourceOpenTarget}
          onOpenRequestConsumed={() => setResourceOpenTarget(null)}
          closeActiveSideRequest={closeActiveSideRequest}
          onCloseActiveRequestConsumed={() =>
            setCloseActiveSideRequest(null)
          }
          onCloseSide={closeAsidePane}
          onExpandedChange={(expanded) => {
            if (phoneLayout) return;
            if (!expanded) setSideDockComposer(false);
          }}
          skillInfos={skillInfos}
          skillsLoading={skillsLoading}
          skillsLoadError={skillsLoadError}
          onSelectSkill={(skill) => {
            setDraft((d) => {
              const next = planInsertSkill(d, skill.name);
              requestComposerStoredCaret("end");
              return next;
            });
            window.setTimeout(() => requestComposerFocus(), 40);
          }}
        />
      </div>
      </>
      )}

      {phoneLayout ? (
        <>
          <PhoneComposerToolsSheet
            locale={locale}
            open={phoneToolsOpen}
            onClose={() => setPhoneToolsOpen(false)}
            labels={{
              title: tr("phone.toolsTitle"),
              close: tr("common.close"),
              attach: tr("phone.toolsAttach"),
              project: tr("phone.toolsProject"),
              model: tr("phone.toolsModel"),
              effort: tr("composer.effort"),
              access: tr("phone.toolsAccess"),
              context: tr("phone.toolsContext"),
              noProject: tr("project.general"),
              addProject: tr("composer.addProject"),
              mode: tr("composer.mode"),
              permission: tr("composer.permission"),
              modeAgent: tr("mode.agent"),
              modePlan: tr("mode.plan"),
              modeAsk: tr("mode.ask"),
              modelGroupOfficial: tr("composer.modelGroupOfficial"),
              modelViaProvider: tr("composer.modelViaProvider"),
              policyAsk: tr("policy.ask"),
              policyAcceptEdits: tr("policy.accept_edits"),
              policySession: tr("policy.allow_for_session"),
              policyAuto: tr("policy.auto"),
              policyDontAsk: tr("policy.dont_ask"),
              policyYolo: tr("policy.always_approve"),
              effortHigh: tr("effort.high"),
              effortMedium: tr("effort.medium"),
              effortLow: tr("effort.low"),
              effortXhigh: tr("effort.xhigh"),
              effortMax: tr("effort.max"),
              contextCurrent: tr("context.current"),
              contextUnknown: tr("phone.contextUnknown"),
              contextCompact: tr("context.compactAction"),
              sourceKnown: tr("context.sourceKnown"),
              sourceEstimated: tr("context.sourceEstimated"),
              sourceUnknown: tr("context.sourceUnknown"),
              contextWindow: tr("context.window"),
              contextPercentUsed: tr("context.percentLabel"),
              contextCacheHit: tr("context.cacheHit"),
              breakdownUser: tr("context.breakdownUser"),
              breakdownAssistant: tr("context.breakdownAssistant"),
              breakdownThought: tr("context.breakdownThought"),
              back: tr("phone.toolsBack"),
            }}
            activeProject={activeProject}
            projects={projects}
            modelId={modelId}
            effort={effort}
            models={availableModels}
            providers={composerProviderInputs}
            activeSource={providerActiveSource}
            activeProviderId={providerActiveId}
            channelEfforts={channelEffortOptions}
            mode={mode}
            policy={policy}
            contextDisplay={contextUsageDisplay}
            onAttach={() => {
              void pickComposerFiles();
            }}
            onSelectProject={(proj) => {
              if (!proj) {
                void bindSessionProject(null);
                return;
              }
              const full =
                projects.find((p) => p.id === proj.id) ?? null;
              void bindSessionProject(full);
            }}
            onAddProject={() => {
              void addProjectFromPicker({ bindSession: true });
            }}
            onModelPick={(pick) => {
              void handleModelPick(pick);
            }}
            onEffort={handleEffortPick}
            onMode={(v) => {
              setMode(v);
              if (v === "plan") setGoalMode(false);
              void api
                .composerPrefsSet({
                  projectId: activeProject?.id ?? null,
                  sessionId: session.sessionId ?? null,
                  mode: v,
                })
                .catch((e) => showToast(String(e), 4000));
            }}
            onPolicy={(v: PermissionPolicyId) => {
              applyPermissionPolicy(v);
            }}
            onCompact={() => {
              compact.openBare();
            }}
          />
          <PhoneAccountSheet
            open={phoneAccountOpen}
            onClose={() => setPhoneAccountOpen(false)}
            labels={{
              title: tr("phone.accountTitle"),
              close: tr("common.close"),
              hostAccount: tr("mirror.chrome.accountHost"),
              linkStatus: tr("phone.linkStatus"),
              agentStatus: tr("phone.agentStatus"),
              openFiles: tr("phone.openFiles"),
              connected: tr("mirror.chrome.connected"),
              reconnecting: tr("mirror.chrome.reconnecting"),
              disconnected: tr("mirror.chrome.disconnected"),
              tokenMissing: tr("mirror.chrome.tokenMissing"),
            }}
            hostLabel={mirrorHostLabel}
            linkOk={mirrorLinkOk}
            {...(() => {
              const link = deriveMirrorClientLinkStatus({
                wsConnected: mirrorLinkOk,
                hasToken: !!mirrorToken(),
              });
              return {
                linkTone: link.tone,
                linkStatusLabel: tr(link.labelKey as MessageKey),
              };
            })()}
            agentStatusLabel={tr(connPill.labelKey as MessageKey)}
            agentTone={connPill.tone}
            onOpenFiles={() => openAsidePane()}
          />
        </>
      ) : null}

      <WorkbenchChromeOverlays
        locale={locale}
        platform={platform}
        showDoctor={showDoctor}
        closeDoctor={() => setShowDoctor(false)}
        onDoctorConfirm={({ title, message, confirmLabel, danger, onConfirm }) => {
          setAppDialog({
            kind: "confirm",
            title,
            message,
            confirmLabel,
            danger,
            onConfirm,
          });
        }}
        onDoctorResetDone={() => {
          void refreshLists();
        }}
        onOpenReliability={() => openReliability()}
        projectRulesTarget={projectRulesTarget}
        closeProjectRules={() => setProjectRulesTarget(null)}
        promptHistoryClearOpen={promptHistoryClearOpen}
        closePromptHistoryClear={() => setPromptHistoryClearOpen(false)}
        onConfirmPromptHistoryClear={() => {
          setRecentPromptHistory(clearRecentPromptHistory());
          setPromptHistoryActive(0);
          setPromptHistoryClearOpen(false);
        }}
        archiveAgePlan={archiveAgeConfirm}
        archiveAgeBusy={archiveAgeBusy}
        closeArchiveAge={() => setArchiveAgeConfirm(null)}
        onConfirmArchiveAge={() => {
          if (!archiveAgeConfirm) return;
          void runArchiveAgePlan(archiveAgeConfirm);
        }}
        worktreeCreateOpen={worktreeCreateOpen}
        worktreeCreateBusy={worktreeCreateBusy}
        worktreeCreateStartChat={worktreeCreateStartChat}
        worktreeCreateName={worktreeCreateName}
        worktreeCreateLayout={worktreeCreateLayout}
        worktreeCreateRef={worktreeCreateRef}
        worktreeCreatePreviewPath={worktreeCreatePreviewPath}
        worktreeCreateError={worktreeCreateError}
        closeWorktreeCreate={() => setWorktreeCreateOpen(false)}
        submitWorktreeCreate={() => {
          void submitWorktreeCreate();
        }}
        onWorktreeCreateNameChange={(value) => {
          setWorktreeCreateName(value);
          setWorktreeCreateError(null);
        }}
        onWorktreeCreateLayoutChange={(value) => {
          setWorktreeCreateLayout(value);
          setWorktreeCreateError(null);
        }}
        onWorktreeCreateRefChange={(value) => {
          setWorktreeCreateRef(value);
          setWorktreeCreateError(null);
        }}
        worktreeGcOpen={worktreeGcOpen}
        worktreeGcBusy={worktreeGcBusy}
        worktreeGcPreviewBusy={worktreeGcPreviewBusy}
        worktreeGcForce={worktreeGcForce}
        worktreeGcPreview={worktreeGcPreview}
        worktreeGcError={worktreeGcError}
        closeWorktreeGc={() => {
          setWorktreeGcOpen(false);
          setWorktreeGcError(null);
          setWorktreeGcPreview(null);
          setWorktreeGcForce(false);
        }}
        submitWorktreeGc={() => {
          void submitWorktreeGc();
        }}
        setWorktreeGcForce={setWorktreeGcForce}
        shipOpen={shipOpen}
        shipBusy={shipBusy}
        shipSuccess={shipSuccess}
        shipTitle={shipTitle}
        shipBody={shipBody}
        shipCreatePr={shipCreatePr}
        shipDraft={shipDraft}
        shipBranch={shipBranch}
        shipStatus={shipStatus}
        shipError={shipError}
        closeShip={closeShipFlow}
        submitShip={() => {
          void submitShipFlow();
        }}
        onShipTitleChange={(value) => {
          setShipTitle(value);
          setShipError(null);
        }}
        onShipBodyChange={(value) => {
          setShipBody(value);
          setShipError(null);
        }}
        setShipCreatePr={setShipCreatePr}
        setShipDraft={setShipDraft}
        onOpenPrHubFromShip={openPrHubFromShip}
        showToast={showToast}
        showShortcuts={showShortcuts}
        composerSendKeyPref={composerSendKeyPref}
        shortcutRemaps={shortcutRemaps}
        voiceHotkeyEnabled={voiceHotkeyEnabled}
        closeShortcuts={() => setShowShortcuts(false)}
        showProductTutorial={showProductTutorial}
        closeProductTutorial={() => {
          markProductTutorialDone();
          setShowProductTutorial(false);
        }}
        liveVoiceOpen={liveVoiceOpen}
        voiceLocale={resolveLocale(locale)}
        voiceProjectPath={effectiveProjectPath}
        voiceProjectId={activeProject?.id ?? null}
        voiceProjectName={
          activeProject
            ? projectDisplayName(activeProject, tr)
            : tr("composer.noProject")
        }
        voiceId={voiceId}
        voiceKeepAgentsOnEnd={voiceKeepAgentsOnEnd}
        voiceHasActiveSession={Boolean(session.sessionId)}
        voiceHasAuth={voiceGate.available}
        voiceSessions={sessions.map((s) => ({
          id: s.id,
          title: s.title || tr("session.untitled"),
          status: liveMap[s.id]?.state ?? "idle",
        }))}
        closeLiveVoice={() => setLiveVoiceOpen(false)}
        onLiveVoiceClassifiedNotice={onLiveVoiceClassifiedNotice}
        onSendVoiceTranscriptAsPrompt={
          session.sessionId
            ? async (prompt) => {
                await executeSend({
                  storedDisplay: prompt,
                  att: [],
                  goalMode: false,
                });
              }
            : undefined
        }
        onVoiceFocusSession={(id) => {
          setLiveVoiceOpen(false);
          void (async () => {
            await refreshSessions();
            let row = sessions.find((s) => s.id === id) ?? null;
            if (!row) {
              try {
                const list = await api.sessionsList();
                const hit = list.find((s) => s.id === id);
                if (hit) {
                  row = normalizeSessionRow({
                    ...hit,
                    title: hit.title || tr("session.untitled"),
                  });
                }
              } catch {
                /* ignore */
              }
            }
            if (row) {
              const proj =
                projects.find((p) => p.id === row!.projectId) ?? activeProject;
              void openSession(row, proj ?? undefined);
            } else {
              showToast(tr("voice.sessionMissing"), 3500);
            }
          })();
        }}
      />

      <WorkbenchSessionModals
        account={account}
        agentDashboardOpen={agentDashboardOpen}
        agentDashboardRows={agentDashboardRows}
        askUser={askUser}
        askUserTimeoutSec={askUserTimeoutSec}
        batchAgentsOpen={batchAgentsOpen}
        clearPendingGates={clearPendingGates}
        clearSessionMaxTurnsModal={clearSessionMaxTurnsModal}
        clearSessionRulesModal={clearSessionRulesModal}
        clearSessionSysPromptModal={clearSessionSysPromptModal}
        closeSessionMaxTurnsModal={closeSessionMaxTurnsModal}
        closeSessionNoteModal={closeSessionNoteModal}
        closeSessionRulesModal={closeSessionRulesModal}
        closeSessionSysPromptModal={closeSessionSysPromptModal}
        confirmClearPlanHistory={confirmClearPlanHistory}
        confirmClearSessionNoteModal={confirmClearSessionNoteModal}
        confirmRewindToPrompt={confirmRewindToPrompt}
        customRouteActive={customRouteActive}
        effectiveProjectPath={effectiveProjectPath}
        effort={effort}
        forceCloseSessionNoteModal={forceCloseSessionNoteModal}
        forceCloseSessionRulesModal={forceCloseSessionRulesModal}
        forceCloseSessionSysPromptModal={forceCloseSessionSysPromptModal}
        forkAgentCheckbox={forkAgentCheckbox}
        forkBusy={forkBusy}
        forkConfirm={forkConfirm}
        forkRestoreCode={forkRestoreCode}
        jsonSchemaDraft={jsonSchemaDraft}
        locale={locale}
        maxAgentTurns={maxAgentTurns}
        mcpDoctorError={mcpDoctorError}
        mcpDoctorFocus={mcpDoctorFocus}
        mcpDoctorLoading={mcpDoctorLoading}
        mcpDoctorReport={mcpDoctorReport}
        mcpError={mcpError}
        mcpLoading={mcpLoading}
        mcpServers={mcpServers}
        messages={messages}
        mode={mode}
        modelId={modelId}
        navigateSettings={navigateSettings}
        openBatchAgents={openBatchAgents}
        openOpsDestination={openOpsDestination}
        openPlanHistorySession={openPlanHistorySession}
        openSession={openSession}
        opsEntryCounts={opsEntryCounts}
        opsEntryOpen={opsEntryOpen}
        planHistoryPreview={planHistoryPreview}
        planReviseNote={planReviseNote}
        planReviseOpen={planReviseOpen}
        policy={policy}
        projects={projects}
        refreshMcpModal={refreshMcpModal}
        requestClearSessionNoteModal={requestClearSessionNoteModal}
        requestPlanChanges={requestPlanChanges}
        resumeAgentCheckbox={resumeAgentCheckbox}
        resumeRestoreBusy={resumeRestoreBusy}
        resumeRestoreConfirm={resumeRestoreConfirm}
        rewindBusy={rewindBusy}
        rewindConfirm={rewindConfirm}
        rewindError={rewindError}
        rewindModalRef={rewindModalRef}
        rewindRestoreFiles={rewindRestoreFiles}
        setRewindError={setRewindError}
        rewindTimeline={rewindTimeline}
        runBatchAgentsDispatch={runBatchAgentsDispatch}
        runForkSession={runForkSession}
        runMcpDoctor={runMcpDoctor}
        runResumeWithCodeRestore={runResumeWithCodeRestore}
        runRewindToPrompt={runRewindToPrompt}
        saveSessionMaxTurnsModal={saveSessionMaxTurnsModal}
        saveSessionNoteModal={saveSessionNoteModal}
        saveSessionRulesModal={saveSessionRulesModal}
        saveSessionSysPromptModal={saveSessionSysPromptModal}
        session={session}
        sessionJsonSchema={sessionJsonSchema}
        sessionMaxTurnsDraft={sessionMaxTurnsDraft}
        sessionMaxTurnsTarget={sessionMaxTurnsTarget}
        sessionNoteBaseline={sessionNoteBaseline}
        sessionNoteClearOpen={sessionNoteClearOpen}
        sessionNoteDiscardOpen={sessionNoteDiscardOpen}
        sessionNoteDraft={sessionNoteDraft}
        sessionNoteTarget={sessionNoteTarget}
        sessionNotesMap={sessionNotesMap}
        sessionRulesBaseline={sessionRulesBaseline}
        sessionRulesBusy={sessionRulesBusy}
        sessionRulesDiscardOpen={sessionRulesDiscardOpen}
        sessionRulesDraft={sessionRulesDraft}
        sessionRulesError={sessionRulesError}
        sessionRulesTarget={sessionRulesTarget}
        sessionSpend={sessionSpend}
        sessionSysPromptBaseline={sessionSysPromptBaseline}
        sessionSysPromptBusy={sessionSysPromptBusy}
        sessionSysPromptDiscardOpen={sessionSysPromptDiscardOpen}
        sessionSysPromptDraft={sessionSysPromptDraft}
        sessionSysPromptError={sessionSysPromptError}
        sessionSysPromptTarget={sessionSysPromptTarget}
        sessionTaskBoard={sessionTaskBoard}
        sessions={sessions}
        setAgentDashboardOpen={setAgentDashboardOpen}
        setAskUser={setAskUser}
        setBatchAgentsOpen={setBatchAgentsOpen}
        setForkCliSession={setForkCliSession}
        setForkConfirm={setForkConfirm}
        setForkRestoreCode={setForkRestoreCode}
        setJsonSchemaDraft={setJsonSchemaDraft}
        setOpsEntryOpen={setOpsEntryOpen}
        setPlanHistoryPreview={setPlanHistoryPreview}
        setPlanReviseNote={setPlanReviseNote}
        setPlanReviseOpen={setPlanReviseOpen}
        setResumeForkCliSession={setResumeForkCliSession}
        setResumeRestoreConfirm={setResumeRestoreConfirm}
        setRewindConfirm={setRewindConfirm}
        setRewindRestoreFiles={setRewindRestoreFiles}
        setRewindTimeline={setRewindTimeline}
        setSessionJsonSchema={setSessionJsonSchema}
        setSessionMaxTurnsDraft={setSessionMaxTurnsDraft}
        setSessionNoteClearOpen={setSessionNoteClearOpen}
        setSessionNoteDiscardOpen={setSessionNoteDiscardOpen}
        setSessionNoteDraft={setSessionNoteDraft}
        setSessionRulesDiscardOpen={setSessionRulesDiscardOpen}
        setSessionRulesDraft={setSessionRulesDraft}
        setSessionRulesError={setSessionRulesError}
        setSessionSysPromptDiscardOpen={setSessionSysPromptDiscardOpen}
        setSessionSysPromptDraft={setSessionSysPromptDraft}
        setSessionSysPromptError={setSessionSysPromptError}
        setSessions={setSessions}
        setShowJsonSchemaModal={setShowJsonSchemaModal}
        setShowMcpModal={setShowMcpModal}
        setShowPlanHistory={setShowPlanHistory}
        setShowStatusModal={setShowStatusModal}
        setShowTraces={setShowTraces}
        setShowUsageLimitModal={setShowUsageLimitModal}
        setTaskBoardIncludeArchived={setTaskBoardIncludeArchived}
        setTaskBoardOpen={setTaskBoardOpen}
        showJsonSchemaModal={showJsonSchemaModal}
        showMcpModal={showMcpModal}
        showPlanHistory={showPlanHistory}
        showStatusModal={showStatusModal}
        showToast={showToast}
        showTraces={showTraces}
        showUsageLimitModal={showUsageLimitModal}
        stopAllBusySessions={stopAllBusySessions}
        stopBusySessionsByIds={stopBusySessionsByIds}
        taskBoardIncludeArchived={taskBoardIncludeArchived}
        taskBoardOpen={taskBoardOpen}
        tr={tr}
      />

      <WorkbenchDomainOverlays
        locale={locale}
        platform={platform}
        cliVersion={cliInfo.version}
        showReliability={showReliability}
        closeReliability={closeReliability}
        reliabilityView={reliabilityView}
        goalOrchUiEnabled={goalOrchUiEnabled}
        goalOrchEvents={goalOrchEvents}
        lastProcessLimit={lastProcessLimit}
        sessionIds={sessions.map((s) => s.id)}
        onOpenDoctor={() => void openDoctor()}
        onSelectReliabilitySession={(id) => {
          closeReliability();
          trayHandlersRef.current.openSessionById(id);
        }}
        sandboxWizardOpen={sandboxWizardOpen}
        sandboxWizardMode={sandboxWizardMode}
        closeSandboxWizard={closeSandboxWizard}
        skipSandboxWizard={skipSandboxWizard}
        onApplySandbox={(profile, opts) => {
          finishSandboxWizardApply(opts);
          applyGlobalSandboxProfile(profile);
        }}
        exportMdOpen={!!exportMdTarget}
        exportMdBusy={exportMdBusy}
        exportMdIncludeThoughts={exportMdIncludeThoughts}
        exportMdIncludeTools={exportMdIncludeTools}
        exportMdHonesty={exportMdHonesty}
        closeExportSessionMd={closeExportSessionMd}
        runExportSessionMd={runExportSessionMd}
        setExportMdIncludeThoughts={setExportMdIncludeThoughts}
        setExportMdIncludeTools={setExportMdIncludeTools}
        exportImageOpen={!!exportImageTarget}
        exportImageBusy={exportImageBusy}
        exportImageCanAct={exportImageCanAct}
        exportImageSkin={exportImageSkin}
        exportImageSmart={exportImageSmart}
        exportImagePreviewPhase={exportImagePreviewPhase}
        exportImagePreviewUrl={exportImagePreviewUrl}
        exportImageOptionsMatch={exportImageOptionsMatch}
        exportImagePreviewError={exportImagePreviewError}
        exportImageBytesLabel={exportImageBytesLabel}
        exportImageMetaParts={exportImageMetaParts}
        closeExportSessionImage={closeExportSessionImage}
        runExportSessionImage={runExportSessionImage}
        applyExportImageSkin={applyExportImageSkin}
        setExportImageSmart={setExportImageSmart}
        searchPalette={searchPalette}
        sessions={sessions}
        projects={projects}
        settingsShortcutHint={settingsShortcutHint}
        onPickSearchSession={(row, proj) => {
          searchPalette.closePalette();
          void openSession(row, proj);
        }}
      />

      <WorkbenchComposerModals
        locale={locale}
        tr={tr}
        compact={compact}
        queueEdit={queueEdit}
        turnLive={
          session.state === "streaming" ||
          session.state === "awaiting_permission"
        }
        usage={contextUsageDisplay}
      />

      <WorkbenchAppDialogStage
        locale={locale}
        dialog={appDialog}
        dialogRef={appDialogRef}
        panelRef={appDialogPanelRef}
        confirmBtnRef={confirmBtnRef}
        inputRef={dialogInputRef}
        inputValue={dialogInput}
        error={dialogError}
        onDismiss={dismissDialog}
        onInputChange={setDialogInput}
        setDialog={setAppDialog}
        setError={setDialogError}
      />
          <WorkbenchFloatingMenus
            activeProject={activeProject}
            addSessionPluginDir={addSessionPluginDir}
            applyAttachedChat={applyAttachedChat}
            applyProjectColor={applyProjectColor}
            applyProjectPermissionPolicy={applyProjectPermissionPolicy}
            applyProjectSandboxProfile={applyProjectSandboxProfile}
            archiveProjectSessions={archiveProjectSessions}
            archiveSession={archiveSession}
            bulkMoveMenuItems={bulkMoveMenuItems}
            busyIds={busyIds}
            canRewindSession={canRewindSession}
            clearSessionPluginDirs={clearSessionPluginDirs}
            composerCtxItems={composerCtxItems}
            composerCtxMenu={composerCtxMenu}
            confirmArchiveOlderThan={confirmArchiveOlderThan}
            confirmExportSessionTraceUpload={confirmExportSessionTraceUpload}
            confirmForkSession={confirmForkSession}
            confirmRemoveWorktree={confirmRemoveWorktree}
            confirmResumeWithCodeRestore={confirmResumeWithCodeRestore}
            continueLastAgentForProject={continueLastAgentForProject}
            copyConversationMarkdown={copyConversationMarkdown}
            copySessionId={copySessionId}
            ctxMenu={ctxMenu}
            deleteSessionConfirm={deleteSessionConfirm}
            enterSessionSelectMode={enterSessionSelectMode}
            exportSessionDiagnostic={exportSessionDiagnostic}
            exportSessionHtml={exportSessionHtml}
            exportSessionJson={exportSessionJson}
            exportSessionPlain={exportSessionPlain}
            exportSessionStreamNdjson={exportSessionStreamNdjson}
            exportSessionTrace={exportSessionTrace}
            forkBusy={forkBusy}
            gitWorktrees={gitWorktrees}
            handleClearAllSessionUnread={handleClearAllSessionUnread}
            handleClearSessionUnread={handleClearSessionUnread}
            handleMarkSessionUnread={handleMarkSessionUnread}
            handleToggleSessionMute={handleToggleSessionMute}
            isSecondaryWindow={isSecondaryWindow}
            messages={messages}
            moveProjectByMenu={moveProjectByMenu}
            mutedSessionIds={mutedSessionIds}
            navigator={navigator}
            openExportSessionImage={openExportSessionImage}
            openExportSessionMd={openExportSessionMd}
            openRewindTimeline={openRewindTimeline}
            openSandboxWizardGuide={openSandboxWizardGuide}
            openSessionInNewWindow={openSessionInNewWindow}
            openSessionMaxTurns={openSessionMaxTurns}
            openSessionNote={openSessionNote}
            openSessionRules={openSessionRules}
            openSessionSysPrompt={openSessionSysPrompt}
            openShipFlow={openShipFlow}
            pinSession={pinSession}
            platform={platform}
            projectColorLabel={projectColorLabel}
            projectReorder={projectReorder}
            projectSpaces={projectSpaces}
            projects={projects}
            refreshProjects={refreshProjects}
            relocateProject={relocateProject}
            removeProjectFromApp={removeProjectFromApp}
            renameProject={renameProject}
            renameSession={renameSession}
            resumeRestoreBusy={resumeRestoreBusy}
            runDuplicateSession={runDuplicateSession}
            sandboxProfileLabel={sandboxProfileLabel}
            session={session}
            sessionSelectMode={sessionSelectMode}
            sessionWorktreeBadgeFor={sessionWorktreeBadgeFor}
            sessions={sessions}
            setAppDialog={setAppDialog}
            setComposerCtxMenu={setComposerCtxMenu}
            setCtxMenu={setCtxMenu}
            setLocalError={setLocalError}
            setProjectRulesTarget={setProjectRulesTarget}
            setShowPlanHistory={setShowPlanHistory}
            setShowTraces={setShowTraces}
            showToast={showToast}
            spaceErrorKey={spaceErrorKey}
            toggleTranscriptFilter={toggleTranscriptFilter}
            tr={tr}
            unreadSessionIds={unreadSessionIds}
            visibleProjects={visibleProjects}
            transcriptFilter={transcriptFilter}
            gitWorktreesAvailable={gitWorktreesAvailable}
            moveMenuItemsFor={moveMenuItemsFor}
            viewingSessionIdRef={viewingSessionIdRef}
          />

      <span hidden data-layout-default={JSON.stringify(DEFAULT_LAYOUT)} />
    </div>
    </ImageViewerProvider>
  );
}

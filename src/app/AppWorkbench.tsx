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
import { createPortal } from "react-dom";
import { useFloatingMenu } from "@/lib/floatingMenu";
import { DEFAULT_WALLPAPER_FOCUS } from "@/lib/themeSkin";
import {
  loadMessageTimestampsPref,
  MESSAGE_TIMESTAMPS_CHANGE_EVENT,
  saveMessageTimestampsPref
} from "@/lib/messageTimestampsPref";
import {
  loadShowReplyLengthPref,
  saveShowReplyLengthPref,
  SHOW_REPLY_LENGTH_CHANGE_EVENT
} from "@/lib/messageLength";
import {
  loadMessageTimeFormatPref,
  MESSAGE_TIME_FORMAT_CHANGE_EVENT,
  saveMessageTimeFormatPref,
  type MessageTimeFormat
} from "@/lib/messageTimeFormatPref";
import {
  loadSidebarShowRelativeTimePref,
  saveSidebarShowRelativeTimePref,
  SIDEBAR_SHOW_RELATIVE_TIME_CHANGE_EVENT
} from "@/lib/sidebarShowRelativeTimePref";
import { formatRelativeTime } from "@/lib/accountUi";
import { loadConfirmExternalLinksPref } from "@/lib/externalLinkPref";
import {
  chatcutHandoffToResourceOpenTarget,
  resolveChatcutLinkClick,
} from "@/lib/chatcutHandoff";
import { loadStopAllSkipConfirmPref } from "@/lib/stopAllSkipConfirmPref";
import { detectAppPlatform, revealInOsLabel } from "@/lib/appPlatform";
import {
  APP_CLOSE_REQUESTED_EVENT,
  loadAlwaysQuitWithoutAskingPref,
  shouldConfirmQuit
} from "@/lib/confirmQuit";
import {
  loadNotifySoundPref,
  NOTIFY_SOUND_CHANGE_EVENT,
  saveNotifySoundPref
} from "@/lib/notifySound";
import {
  applyWindowAlwaysOnTop,
  loadWindowAlwaysOnTopPref,
  saveWindowAlwaysOnTopPref
} from "@/lib/windowAlwaysOnTop";
import {
  canLiveParticipate,
  canOpenSessionInNewWindow,
  isSessionWindowLabel,
  parseSessionDeepLinkHash,
  resolveSecondarySessionId,
  resolveStopTargets,
  shouldDeferWarmConnectForForeignBusy,
  shouldSkipWarmConnect
} from "@/lib/multiWindow";
import {
  applyChatWidth,
  loadChatWidth
} from "@/lib/chatWidthPref";
import {
  loadPermissionTimeoutSec,
  PERMISSION_TIMEOUT_CHANGE_EVENT,
  permissionTimeoutRemainingSec,
  savePermissionTimeoutSec
} from "@/lib/permissionTimeout";
import {
  ASK_USER_TIMEOUT_CHANGE_EVENT,
  loadAskUserTimeoutSec,
  saveAskUserTimeoutSec
} from "@/lib/askUserTimeout";
import { WallpaperMediaLayer } from "@/components/WallpaperMediaLayer";
import {
  ASIDE_WIDTH_MIN,
  DEFAULT_LAYOUT,
  WINDOW_CONTROLS_INSET,
  clampAsideWidth,
  clampSidebarDragWidth,
  clampSidebarWidth,
  resolveSidebarDragEnd,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_WIDTH_MIN,
  isMirrorPhoneLayout,
  loadLayout,
  saveLayout,
  withMirrorPhoneDrawerDefault,
} from "@/lib/layout";
import {
  ZEN_MODE_CHANGE_EVENT,
  applyZenModeLayoutTransition,
  clearZenModePrior,
  loadZenMode,
  loadZenModePrior,
  saveZenMode,
  saveZenModePrior
} from "@/lib/zenMode";
import {
  TRANSCRIPT_FILTER_CHANGE_EVENT,
  loadTranscriptFilterPref,
  saveTranscriptFilterPref,
  type TranscriptFilterMode
} from "@/lib/transcriptFilterPref";
import {
  ensureWindowFitsLayout,
  isWindowFitSuppressed
} from "@/lib/windowFit";
import {
  PHONE_KEYBOARD_INSET_VAR,
  keyboardInsetBottom
} from "@/lib/phoneViewport";
import {
  hitDragZoneFromRects,
  querySidebarEl,
  toClientDragPoint
} from "@/lib/dragZone";
import {
  applyTurnError,
  applyTurnMarker,
  canSend,
  canType,
  clearPriorTurnStreaming,
  isSessionLiveStreaming,
  isSessionNotLiveError,
  preferSessionMessages,
  presentErrorBanner,
  snapshotOutgoingMessages,
  type ErrorBannerView,
  weaveToolsIntoAssistantSegments,
  truncateBeforeLastUser,
  truncateThroughUserPrompt,
  canRewindToUserPrompt,
  canRegenerateAssistant,
  userPromptIndexOf,
  localRewindPoints,
  IDLE_SNAPSHOT,
  type AskUserPayload,
  type ChatMessage,
  type PermissionPayload,
  type SessionSnapshot
} from "@/lib/session";
import { UiErrorBoundary } from "@/components/UiErrorBoundary";
import {
  buildCompactSlashCommand,
  COMPACT_PRESET_IDS,
  DEFAULT_COMPACT_PRESET,
  estimateCompactAfterTokens,
  formatCompactBeforeAfterRange,
  formatTokenCount,
  INITIAL_CONTEXT_USAGE,
  resolveCompactNoteBody,
  resolveContextUsageDisplay,
  restoreContextUsageForSession,
  type CompactPresetId,
  type ContextUsageState
} from "@/lib/contextUsage";
import {
  COMPACTION_DETAILS,
  COMPACTION_MODES,
  DEFAULT_COMPACTION_DETAIL,
  DEFAULT_COMPACTION_MODE,
  compactionDetailApplies,
  normalizeCompactionDetail,
  normalizeCompactionMode,
  type CompactionDetailId,
  type CompactionModeId
} from "@/lib/compactionMode";
import { ContextUsageChip } from "@/components/ContextUsageChip";
import { PlanStatusBar } from "@/components/PlanStatusBar";
import {
  applyPlanPendingMembership,
  closedSessionPlan,
  emptySessionPlan,
  invalidatePlanGate,
  planStateToStored,
  restorePlanFromPersistence,
  type SessionPlanState
} from "@/lib/planSession";
import {
  collectActivitySessions,
  countBusyLiveMapSessions,
  stoppableActivitySessions
} from "@/lib/agentActivity";
import {
  classifyTasksBindCwdError,
  classifyTasksStopError,
  type TasksBindCwdResult
} from "@/lib/tasksPanelPro";
import {
  loadTrayBusyBadgePref,
  saveTrayBusyBadgePref
} from "@/lib/trayBusyBadgePref";
import { resolveTrayBusyBadgeCount } from "@/lib/trayNotifyPro";
import {
  collectAgentDashboardRows
} from "@/lib/agentDashboard";
import { buildTaskBoard } from "@/lib/sessionTaskBoard";
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
  type BatchProjectInput
} from "@/lib/batchAgents";
import {
  type ProcessLimitEvent
} from "@/lib/processBudget";
import {
  buildReliabilityCenter,
  DEFAULT_RELIABILITY_MAX_ERRORS,
  prependReliabilityRing,
  reliabilityErrorFromDeck,
  type ReliabilityErrorEntry,
  type ReliabilityStallSignal
} from "@/lib/reliabilityCenter";
import {
  goalOrchPhaseLabelKey,
  loadGoalOrchUiEnabled,
  resolveGoalOrchSessionIndicator,
  saveGoalOrchUiEnabled,
  type GoalOrchEvent
} from "@/lib/goalOrch";
import * as api from "@/lib/api";
import {
  DEFAULT_SANDBOX_PROFILE,
  SANDBOX_PROFILES,
  isDangerousSandboxProfile,
  normalizeSandboxProfile,
  sandboxDangerConfirmKey,
  sandboxProfileLabelKey,
  type SandboxProfileId
} from "@/lib/sandboxProfile";
import { shouldRestoreLastSession } from "@/lib/sessionRestore";
import {
  listArchiveAgeOptionPreviews,
  planArchiveOlderThan,
  type ArchiveAgePlan
} from "@/lib/sessionArchiveAge";
import {
  collapsedIdsFromExpandMap,
  expandMapFromCollapsedIds,
  sameCollapsedIdSet
} from "@/lib/sidebarExpand";
import {
  addIdsToSet,
  areAllIdsSelected,
  pruneSelectedIds,
  rangeIdsInclusive,
  toggleIdInSet,
  toggleIdsInSet,
} from "@/lib/sessionSelect";
import {
  armStopLatch,
  createStopLatchState,
  tickStopLatch,
  STOP_LATCH_MS
} from "@/lib/stopLatch";
import { shouldEscapeStopGeneration } from "@/lib/escapeStop";
import {
  isSameView,
  isViewingSendTarget,
  shouldAdoptView
} from "@/lib/viewFocus";
import {
  projectHostIntoLiveMap,
  resumeStateForSession,
  settleStoppedSessionInLiveMap
} from "@/lib/sessionLiveStore";
import { endOfTurnMarkerContent } from "@/lib/endOfTurn";
import {
  stallMessageKey,
  stallTierFromProgress,
  normalizeStallTier,
  reconcileSessionState
} from "@/lib/sessionPhase";
import {
  isMirrorClient,
  mirrorEnsureTransport,
  mirrorHello,
  mirrorToken,
  mirrorWsConnected
} from "@/lib/mirrorTransport";
import { deriveMirrorClientLinkStatus } from "@/lib/mirrorStatus";

import {
  createT,
  parseLocalePreference,
  resolveLocale,
  resolveLocaleFromSystem,
  resolveLocalePreference,
  type Locale,
  type LocalePreference
} from "@/i18n";
import {
  DEFAULT_EFFORT,
  DEFAULT_MODEL_ID,
  GROK_BUILD_EFFORTS,
  GROK_BUILD_MODELS,
  PERMISSION_POLICIES,
  findModel,
  effortOptionsFromProvider,
  isValidEffort,
  isValidModelId,
  isValidPolicy,
  isValidPrefsScope,
  mapEffortToTargetCatalog,
  pickDefaultEffort,
  pickDefaultModelId,
  resolveContextWindow,
  type ComposerPrefsScope,
  type EffortOption,
  type ModelOption,
  type PermissionPolicyId
} from "@/lib/grokCatalog";
import {
  formatPermissionSummary,
  mapPermissionButtons
} from "@/lib/permissionOptions";
import { AskUserModal } from "@/components/AskUserModal";
import { TraceHistoryList } from "@/components/TraceHistoryList";
import { PlanHistoryList } from "@/components/PlanHistoryList";
import { MarkdownBody } from "@/components/MarkdownBody";
import {
  clearSessionSearchFilters,
  filterSessionSearch,
  hasActiveSessionSearchFilters,
  mergeSessionSearchHits,
  resolveSessionSearchEmptyState,
  sessionSearchBadge,
  sessionSearchBadgeLabelKey,
  sessionSearchModeLabelKey,
  sessionSearchRankModeLabelKey,
  shouldScanSessionContent,
  SESSION_SEARCH_RANK_MODES,
  type SessionContentHit,
  type SessionSearchMode,
  SESSION_SEARCH_MODES,
  type SessionSearchRankMode
} from "@/lib/sessionSearch";
import {
  loadSessionSearchFilterPref,
  saveSessionSearchFilterPref,
  SESSION_SEARCH_FILTER_CHANGE_EVENT
} from "@/lib/sessionSearchFilterPref";
import {
  loadSessionSearchRankPref,
  saveSessionSearchRankPref,
  SESSION_SEARCH_RANK_CHANGE_EVENT
} from "@/lib/sessionSearchRankPref";
import {
  defaultPaletteActions,
  filterPaletteActions,
  type PaletteActionDef
} from "@/lib/paletteActions";
import {
  canOfferContinueCwd,
  classifyContinueCwdEmptyResult,
  continueCwdSoftFailMessageKey,
  evaluateContinueCwd,
  resolveContinueCwdEmptyHonesty,
  resolveContinueCwdSoftFail,
  type ContinueCwdSoftFailKind
} from "@/lib/continueCwd";
import {
  sessionExportMimeType,
  sessionToHtml,
  sessionToJson,
  sessionToMarkdown,
  sessionToPlain,
  shouldPreferCliMarkdownExport
} from "@/lib/sessionExport";
import {
  buildStreamSessionNdjson,
  streamSessionExportFilename,
  streamSessionExportMimeType,
  type StreamSessionExportFormat
} from "@/lib/streamSessionExport";
import {
  canSessionExportActions,
  estimateSessionExportSizeClass,
  formatSessionExportBytes,
  isSessionExportJournalEmpty,
  resolveSessionExportSoftFail,
  sessionExportFormatNameKey,
  sessionExportSafeFilename,
  sessionExportSizeClassLabelKey
} from "@/lib/sessionExportPro";
import {
  blobToBase64 as pngBlobToBase64,
  buildExportImagePipeline,
  copyPngBlob,
  downloadPngBlob,
  exportableToShareMessages,
  sessionExportImageFilename,
  type ShareCardMessage
} from "@/lib/sessionExportImage";
import {
  buildSessionFilePathMap,
  mergePathMaps
} from "@/lib/sessionPathMap";
import {
  loadExportImageSkinPref,
  saveExportImageSkinPref,
  SHARE_CARD_SKIN_IDS,
  type ShareCardSkinId
} from "@/lib/shareCardSkins";
import {
  buildExportImageMetaParts,
  canExportImageActions,
  deriveExportImagePreviewPhase,
  exportImageBlobMatchesOptions,
  formatExportImageBytes,
  resolveExportImageError,
  shareCardSkinMessageKey,
  stampFromPipelineResult,
  type ExportImageBlobStamp
} from "@/lib/exportSharePro";
import { loadExportLogoPref } from "@/lib/exportLogoPref";
import { recordTraceExport } from "@/lib/traceHistory";
import {
  clearPlanHistory,
  loadPlanHistory,
  recordPlanHistory,
  PLAN_HISTORY_CHANGE_EVENT,
  PLAN_HISTORY_STORAGE_KEY
} from "@/lib/planHistory";
import type { PlanHistoryEntry } from "@/lib/planHistory";
import { planDisplayMarkdown } from "@/lib/planBody";
import {
  findChatMatches,
  stepChatFindIndex,
  type ChatFindMatch
} from "@/lib/chatFind";
import { connPillForState } from "@/lib/connStatus";
import {
  matchGlobalShortcut,
  shortcutsForPlatform
} from "@/lib/shortcuts";
import { nextSessionId } from "@/lib/sidebarSessionNav";
import {
  isShortcutRecordingActive,
  loadShortcutRemaps,
  SHORTCUT_REMAP_CHANGED_EVENT,
  SHORTCUT_REMAP_STORAGE_KEY,
  type ShortcutRemapMap
} from "@/lib/shortcutRemap";
import {
  SHORTCUT_KEYS_OFF,
  loadVoiceHotkeyEnabled,
  shouldFireLiveVoiceHotkey,
  VOICE_HOTKEY_CHANGED_EVENT,
  VOICE_HOTKEY_STORAGE_KEY
} from "@/lib/voiceHotkeyPref";
import {
  ensureNotifyPermission,
  setDesktopNotifySessionFocusHandler
} from "@/lib/desktopNotify";
import {
  clearAllMutes as clearAllSessionMutes,
  loadMutedSessionIds,
  SESSION_MUTE_CHANGE_EVENT,
  shouldConfirmClearAllMutes,
  toggle as toggleSessionMute
} from "@/lib/sessionMute";
import {
  clearAllUnread as clearAllSessionUnread,
  clearUnread as clearSessionUnread,
  loadUnreadSessionIds,
  markUnread as markSessionUnread,
  SESSION_UNREAD_CHANGE_EVENT,
  shouldConfirmClearAllUnread,
} from "@/lib/sessionUnread";
import {
  SESSION_NOTE_MAX_LENGTH,
  clampSessionNoteInput,
  clearNote as clearSessionNote,
  getNote as getSessionNote,
  loadSessionNotes,
  notePreview,
  setNote as setSessionNote,
  shouldConfirmSessionNoteClear,
  shouldConfirmSessionNoteDiscard,
  validateSessionNote
} from "@/lib/sessionNotes";
import {
  dismissCliUpdateNotice,
  shouldOfferCliUpdateNotice
} from "@/lib/cliUpdateNotice";
import { GlassModal } from "@/components/GlassModal";
import { Select } from "@/components/Select";
import {
  loadDone as loadProductTutorialDone,
  markDone as markProductTutorialDone,
  shouldAutoOffer as shouldAutoOfferProductTutorial
} from "@/lib/productTutorial";
import { ChatFindBar } from "@/components/ChatFindBar";
import {
  applyResolvedSessionMedia,
  buildAgentPrompt,
  buildInlineMediaPathMap,
  collectSessionRelativeMediaRefs,
  isDisplayableAttachmentPath,
  isImagePath,
  mergeAttachments,
  type Attachment
} from "@/lib/attachments";
import { mapStoredMessagesToChat } from "@/lib/mapStoredMessages";
import {
  detectAtQueryFromEditor,
  rankAtFileHits,
  removeAtTokenFromDraft
} from "@/lib/atFileQuery";
import {
  ComposerAtPanel,
  type ComposerAtFileEntry
} from "@/components/ComposerAtPanel";
import {
  formatAttachErrorMessage,
  isAttachPayloadTooLarge,
  resolveAttachError,
  resolveHostOnlyAttach,
  resolveNativeClipboardEmpty
} from "@/lib/attachmentsPro";
import { fileKey as clipboardFileKey, readClipboardMediaFiles } from "@/lib/clipboardPaste";
import {
  applySkillAtSlash,
  isDraftEmpty,
  detectSlashQueryFromEditor,
  parseStoredContent,
  serializeForAgent
} from "@/lib/draftDoc";
import {
  isActiveJsonSchema,
  parseJsonSchemaText,
  wrapAgentTextWithJsonSchema
} from "@/lib/jsonSchema";
import {
  SESSION_EXTRA_RULES_MAX_CHARS,
  sanitizeExtraRules
} from "@/lib/sessionExtraRules";
import {
  MAX_AGENT_TURNS_CAP,
  normalizeMaxAgentTurns
} from "@/lib/sessionMaxAgentTurns";
import {
  SESSION_SYSTEM_PROMPT_MAX_CHARS,
  sanitizeSystemPromptOverride
} from "@/lib/sessionSystemPrompt";
import {
  clampSessionTextInput,
  presentSessionPromptSoftFail,
  shouldConfirmSessionTextDiscard,
  validateSessionTextField
} from "@/lib/rulesPromptPro";
import {
  collectUserPromptHistory,
  filterPromptHistory,
  promptHistoryListNavFromKey,
  shouldHandlePromptHistoryKey,
  stepPromptHistory,
  stepPromptHistoryListIndex,
  type PromptHistoryEntry
} from "@/lib/composerPromptHistory";
import {
  clearRecentPromptHistory,
  filterRecentPromptHistory,
  loadRecentPromptHistory,
  recordRecentPrompt,
  removeRecentPrompt,
  RECENT_PROMPT_HISTORY_CHANGE_EVENT,
  RECENT_PROMPT_HISTORY_STORAGE_KEY
} from "@/lib/recentPromptHistory";
import {
  COMPOSER_SEND_KEY_CHANGED_EVENT,
  loadComposerSendKeyPref,
  shouldSendOnKeydown,
  type ComposerSendKeyPref
} from "@/lib/composerSendKey";
import {
  COMPOSER_DRAFT_STATS_CHANGED_EVENT,
  countDraftChars,
  loadComposerDraftStatsPref
} from "@/lib/draftStats";
import {
  composerDraftStore,
  getDraft as getComposerDraft,
} from "@/lib/composerDraftStore";
import {
  COMPOSER_SPELLCHECK_CHANGED_EVENT,
  loadComposerSpellcheck
} from "@/lib/composerSpellcheck";
import {
  clearComposerProjectDraft,
  loadComposerProjectDraft,
  projectDraftKey,
  saveComposerProjectDraft,
  type ComposerProjectDraft
} from "@/lib/composerProjectDraft";
import {
  clearComposerSessionDraft,
  loadComposerSessionDraft,
  saveComposerSessionDraft,
} from "@/lib/composerSessionDraft";
import {
  PromptHistoryPanel,
  type PromptHistoryScope
} from "@/components/PromptHistoryPanel";
import {
  planClearSendQueue,
  queuePreviewText,
  resolveSendQueueStripState,
  shouldEnqueueSend,
  type QueuedSend
} from "@/lib/sendQueue";
import {
  useSendQueue,
  type ExecuteSendFromQueue
} from "@/hooks/useSendQueue";
import {
  buildSlashCatalog,
  countSlashByKind,
  flattenFilteredCatalog,
  type SlashItem
} from "@/lib/slashCatalog";
import type { MessageKey } from "@/i18n";
import { AttachmentCard } from "@/components/AttachmentCard";
import { ImageViewerProvider } from "@/components/ImageViewer";
import { OverlayScroll } from "@/components/OverlayScroll";
import { VirtualList } from "@/components/VirtualList";
import {
  SidebarSessionRow,
  type SidebarSessionRowLabels,
  type SidebarSessionWorktreeBadgeProp,
} from "@/components/SidebarSessionRow";
import {
  SIDEBAR_DENSITY_EVENT,
  loadSidebarDensity,
  sidebarSessionRowMetrics,
  type SidebarDensity
} from "@/lib/sidebarDensity";
import { sortSessionsForSidebar } from "@/lib/sidebarDateGroups";
import { GrokLogo } from "@/components/GrokLogo";
import type { SetupCliInfo } from "@/components/SetupWizard";
import {
  buildAuthDeferredFlags,
  formatCliTooOldDetail,
  isCliVersionUnsupported,
  resolveSetupGateBoot
} from "@/lib/setupGatePro";
import { mapProbeToCliInfo } from "@/lib/cliVersionStatus";
import {
  getComposerCaretOffset,
  resizeComposerInput,
} from "@/components/ComposerEditor";
import { ComposerDraftEditor } from "@/components/ComposerDraftEditor";
import {
  ComposerClearDraftButton,
  ComposerDraftStats,
  ComposerSendCluster,
} from "@/components/ComposerDraftChrome";
import { ComposerProjectMenu } from "@/components/ComposerProjectMenu";
import { ComposerWorktreeMenu } from "@/components/ComposerWorktreeMenu";
import {
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
  type WorktreeLayout
} from "@/lib/gitWorktree";
import { filterCliWorktreesForProject } from "@/lib/cliWorktrees";
import {
  canShipWorktree,
  combineShipOutcome,
  defaultPrTitleFromBranch,
  redactShipOutput,
  sanitizePrBody,
  sanitizePrTitle,
  shipOutcomeSummary
} from "@/lib/wtShipFlow";
import {
  PR_HUB_ANCHOR_ID,
  buildPrHubDeepLink,
  parseGithubPrNumber,
  parsePrHubDeepLink
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
  softFailKindFromRestoreGate
} from "@/lib/sessionFork";
import {
  buildResumeWorktreeName,
  canOfferResumeWithCodeRestore,
  canRestoreCodeOnResume
} from "@/lib/sessionResumeRestore";
import { isProjectPathMissing } from "@/lib/projectPath";
import {
  PROJECT_COLOR_TOKENS,
  normalizeProjectColor,
  resolveProjectColorCss,
  type ProjectColorToken
} from "@/lib/projectColor";
import { appendPluginDir } from "@/lib/sessionPluginDirs";
import {
  classifyVoiceError,
  initialVoiceState,
  insertTranscriptIntoDraft,
  isVoiceToggleKey,
  reduceVoice,
  resolveVoiceErrorClass,
  voiceAvailabilityFromAuth,
  voiceIsActive,
  voiceResultStillCurrent,
  voiceStealsEscape,
  VOICE_MAX_RECORD_MS,
  type VoiceErrorClass,
  type VoiceFsmState
} from "@/lib/voiceDictation";
import {
  blobToBase64,
  extensionForMime,
  startVoiceCapture,
  type CaptureHandle
} from "@/lib/voiceCapture";
import {
  ComposerPlusPanel,
  buildComposerPlusEntries,
  jsonSchemaMatchesQuery,
  uploadMatchesQuery
} from "@/components/ComposerPlusPanel";
import { StatusModal } from "@/components/StatusModal";
import {
  IconChevronDown,
  IconChevronUp,
  IconChevronRight,
  IconMore,
  IconPlus,
  IconSearch,
  IconAttach,
  IconMic,
  IconFolder,
  IconFolderPlus,
  IconArrowsVerticalCollapse,
  IconArrowsMinimize,
  IconChat,
  IconClock,
  IconClose,
  IconCode,
  IconClipboardList,
  IconNewChat as IconSquarePen,
  IconNewChat,
  IconImagine,
  IconScheduled,
  IconMenu,
  IconPanel,
  IconPanelRight,
  IconUser,
  IconArchive,
  IconListCheck,
  IconPin,
  IconPinOff,
  IconBell,
  IconBellOff,
  IconNotes,
  IconRename,
  IconCopy,
  IconExportImage,
  IconFiles,
  IconTrash,
  IconExternalLink,
  IconFork,
  IconRewind,
  IconHistory,
  IconDeviceMobile,
  IconShield,
  IconCheck,
  IconCircle,
  IconList,
  IconListNumbers,
  IconRobot,
  IconPlan,
  IconFileDiff,
  IconGitBranch,
  IconUpload,
  IconFileText,
  IconSettings,
  IconAppearance,
  IconPuzzle
} from "@/components/icons";
import { PhoneAccountSheet } from "@/components/PhoneAccountSheet";
import { PhoneComposerToolsSheet } from "@/components/PhoneComposerToolsSheet";
import { OpenLocationButton } from "@/components/OpenLocationButton";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import {
  aiCreateSeedPrompt,
  computeNextRunAt,

  parseScheduledUserContent,
  type Automation
} from "@/lib/automations";
import { automationsBackgroundStatus } from "@/lib/automationsBackgroundStatus";
import { recordAutomationRun } from "@/lib/automationRunHistory";
import {
  extractAutomationPayload,
  looksLikeScheduleIntent,
  wrapAutomationSetupAgentText
} from "@/lib/automationSetup";
import {
  ComposerAccessMenu,
  ComposerModelMenu
} from "@/components/ComposerModelMenu";
import type { ComposerModelPick } from "@/lib/composerModelGroups";
import { resolveProviderBrandId } from "@/lib/providerPresets";
import {
  ProviderBrandIcon,
  providerAvatarLetter
} from "@/components/ProviderBrandIcon";
import {
  classifyProviderBalanceError,
  providerBalanceErrorMessageKey,
  supportsProviderBalance,
} from "@/lib/providerBalanceHonesty";
import {
  formatProviderBalanceLine,
  isProviderBalanceCacheFresh,
  type ProviderBalanceCache,
} from "@/lib/providerBalanceFormat";
import type { ResourceOpenTarget } from "@/components/ResourceViewer";
import { EnvInfoButton } from "@/components/side-workbench/EnvInfoButton";
import {
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
import { ProjectRulesModal } from "@/components/ProjectRulesModal";
import {
  mergeSessionChange,
  sessionChangesFromMessages,
  summarizeSessionChanges,
  type SessionFileChange
} from "@/lib/sessionChanges";
import {
  summarizeGitDirty,
  type GitDirtySummary
} from "@/lib/workspaceGit";
import { ConversationThreadLive } from "@/components/lobe-chat";
import { AgentTasksPanelLive } from "@/components/AgentTasksPanelLive";

const SettingsPage = lazy(async () => {
  const m = await import("@/components/SettingsPage");
  return { default: m.SettingsPage };
});
const AutomationsPage = lazy(async () => {
  const m = await import("@/components/AutomationsPage");
  return { default: m.AutomationsPage };
});
const SideWorkbench = lazy(async () => {
  const m = await import("@/components/side-workbench/SideWorkbench");
  return { default: m.SideWorkbench };
});
const AgentDashboardModal = lazy(async () => {
  const m = await import("@/components/AgentDashboardModal");
  return { default: m.AgentDashboardModal };
});
const SessionTaskBoardModal = lazy(async () => {
  const m = await import("@/components/SessionTaskBoardModal");
  return { default: m.SessionTaskBoardModal };
});
const BatchAgentsModal = lazy(async () => {
  const m = await import("@/components/BatchAgentsModal");
  return { default: m.BatchAgentsModal };
});
const ReliabilityCenterModal = lazy(async () => {
  const m = await import("@/components/ReliabilityCenterModal");
  return { default: m.ReliabilityCenterModal };
});
const DoctorModal = lazy(async () => {
  const m = await import("@/components/DoctorModal");
  return { default: m.DoctorModal };
});
const VoiceOverlay = lazy(async () => {
  const m = await import("@/components/VoiceOverlay");
  return { default: m.VoiceOverlay };
});
const ProductTutorial = lazy(async () => {
  const m = await import("@/components/ProductTutorial");
  return { default: m.ProductTutorial };
});
const McpStatusModal = lazy(async () => {
  const m = await import("@/components/McpStatusModal");
  return { default: m.McpStatusModal };
});
const SetupWizard = lazy(async () => {
  const m = await import("@/components/SetupWizard");
  return { default: m.SetupWizard };
});
import { dispatchCollapseAllActivity } from "@/lib/collapseAllActivity";
import {
  installDialogFocus,
  isTypingTarget,
  preferPermissionFocus,
  trapTabKey
} from "@/lib/a11yFocus";
import { UserMenu, remainingPercent } from "@/components/UserMenu";
import type { SettingsSectionId } from "@/components/SettingsPage";
import {
  buildSettingsHash,
  isSettingsSectionId,
  parseSettingsHash,
  type SettingsTabId
} from "@/lib/settingsCatalog";
import {
  loadSettingsLastRoute,
  resolveOpenSettingsLocation,
  saveSettingsLastRoute
} from "@/lib/settingsLastRoute";
import {
  accountDisplayName,
  accountInitials,
  isAccountConnected,
  loadCachedSuperGrokBrand,
  resolveWelcomeBrandKind,
  saveCachedSuperGrokBrand,
  superGrokBrandKind
} from "@/lib/accountUi";
import {
  SuperGrokMark,
  type SuperGrokBrandKind
} from "@/components/SuperGrokMark";
import {
  DeepSeekFullMark,
  OpenCodeWordmark,
  VolcanoArkWelcomeMark
} from "@/components/ProviderWelcomeMark";
import { Tip } from "@/components/ui/tooltip";
import {
  WindowControls,
  titlebarMaximizeHandlers
} from "@/components/WindowControls";

import { paletteActionIcon } from "@/app/paletteActionIcon";
import {
  isGeneralProject,
  mapProjectsList,
  mapSessionListRow,
  normalizeProject,
  normalizeProjectId,
  normalizeSessionRow,
  projectDisplayName,
  type Project,
  type SessionRow
} from "@/lib/app/sidebarModels";
import type { ContextMenuState } from "@/lib/app/appDialogTypes";
import { useSessionRuntime } from "@/hooks/useSessionRuntime";
import { sessionTranscriptStore } from "@/lib/sessionTranscriptStore";
import { useLiveMapWhen } from "@/hooks/useSessionLiveMap";
import { useComposerController } from "@/hooks/useComposerController";
import { useAppDialogs } from "@/hooks/useAppDialogs";
import { useSessionHostEvents } from "@/hooks/useSessionHostEvents";
import { createDebouncedSkillsReload } from "@/lib/skillCatalogRefresh";

/** App-local plan chrome state (session-scoped via planBySessionRef). */
type PlanState = SessionPlanState;


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
  const [showMessageTimestamps, setShowMessageTimestamps] = useState(() =>
    loadMessageTimestampsPref(localStorage),
  );
  const [showReplyLength, setShowReplyLength] = useState(() =>
    loadShowReplyLengthPref(localStorage),
  );
  /** Display-only: Reliability “Goal orchestration” section (default on). */
  const [goalOrchUiEnabled, setGoalOrchUiEnabled] = useState(() =>
    loadGoalOrchUiEnabled(localStorage),
  );
  /** In-memory ring of CLI goal_updated / goal phase events (never invented). */
  const [goalOrchEvents, setGoalOrchEvents] = useState<GoalOrchEvent[]>([]);
  const [messageTimeFormat, setMessageTimeFormat] = useState<MessageTimeFormat>(
    () => loadMessageTimeFormatPref(localStorage),
  );
  const [sidebarShowRelativeTime, setSidebarShowRelativeTime] = useState(() =>
    loadSidebarShowRelativeTimePref(localStorage),
  );
  // Warm loopback media HTTP endpoint ASAP so chat images resolve to
  // http://127.0.0.1 (not media://) before the first history paint.
  useEffect(() => {
    void import("@/lib/imageSrc")
      .then((m) => m.ensureMediaEndpoint())
      .catch(() => {
        /* non-Tauri / server down */
      });
  }, []);
  useEffect(() => {
    const reload = () =>
      setSidebarShowRelativeTime(loadSidebarShowRelativeTimePref(localStorage));
    window.addEventListener(SIDEBAR_SHOW_RELATIVE_TIME_CHANGE_EVENT, reload);
    return () =>
      window.removeEventListener(
        SIDEBAR_SHOW_RELATIVE_TIME_CHANGE_EVENT,
        reload,
      );
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
    dialogInput,
    setDialogInput,
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

  const [notifySound, setNotifySound] = useState(() =>
    loadNotifySoundPref(localStorage),
  );
  const [windowAlwaysOnTop, setWindowAlwaysOnTop] = useState(() =>
    loadWindowAlwaysOnTopPref(localStorage),
  );
  const [trayBusyBadge, setTrayBusyBadge] = useState(() =>
    loadTrayBusyBadgePref(localStorage),
  );
  const [layout, setLayout] = useState(() => {
    // Platform UA is available at first paint; reserve window-control inset on Win.
    const ua =
      typeof navigator !== "undefined"
        ? navigator.userAgent.toLowerCase()
        : "";
    const winChrome =
      ua.includes("win") ||
      (!ua.includes("mac") && typeof navigator !== "undefined");
    const clampOpts =
      typeof window !== "undefined"
        ? {
            windowControlsInset: winChrome ? WINDOW_CONTROLS_INSET : 0,
            viewportWidth: window.innerWidth,
          }
        : undefined;
    let base = loadLayout(localStorage, clampOpts);
    // Zen mode maximizes chat: force both side panes collapsed on cold start.
    if (loadZenMode(localStorage)) {
      base = {
        ...base,
        sidebarCollapsed: true,
        asideCollapsed: true,
      };
    }
    // Mirror phone: drawer starts collapsed so chat is not covered on first paint.
    if (typeof window !== "undefined" && isMirrorClient()) {
      return withMirrorPhoneDrawerDefault(base, {
        isMirror: true,
        viewportWidth: window.innerWidth,
      });
    }
    return base;
  });
  /** Hide left + right chrome to maximize chat (localStorage `grok.zenMode`). */
  const [zenMode, setZenModeState] = useState(() => loadZenMode(localStorage));
  const zenModeRef = useRef(zenMode);
  /** Side Workbench multi-kind tabs (session-local; Phase 0+). */
  const [sideWorkbench, setSideWorkbench] = useState<SideWorkbenchState>(
    emptySideWorkbenchState,
  );
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
  zenModeRef.current = zenMode;
  /** Transcript filter: all activity vs conversation-only (hide tool steps). */
  const [transcriptFilter, setTranscriptFilter] =
    useState<TranscriptFilterMode>(() => loadTranscriptFilterPref());

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
    getLiveMap,
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
    setAttachments,
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

  /**
   * Archive-by-age pro confirm (GlassModal with preview count + title samples).
   * Null when closed. Built via pure `planArchiveOlderThan`.
   */
  const [archiveAgeConfirm, setArchiveAgeConfirm] =
    useState<ArchiveAgePlan<SessionRow> | null>(null);
  const [archiveAgeBusy, setArchiveAgeBusy] = useState(false);
  /** Composer voice dictation FSM (record → STT → insert draft). */
  const [voice, setVoice] = useState<VoiceFsmState>(() => initialVoiceState());
  /** Full-duplex live voice overlay (separate from composer dictation). */
  const [liveVoiceOpen, setLiveVoiceOpen] = useState(false);
  const [voiceGate, setVoiceGate] = useState<{
    available: boolean;
    reason: VoiceErrorClass | null;
  }>({ available: false, reason: "not_available" });
  const voiceCaptureRef = useRef<CaptureHandle | null>(null);
  const voiceTimersRef = useRef<{ max?: number; noSpeech?: number }>({});
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  /** Bumped on cancel/start so in-flight STT never mutates draft after cancel. */
  const voiceGenRef = useRef(0);
  /** Caret in draft string captured when stop is requested. */
  const voiceCaretRef = useRef<number | null>(null);
  const [goalMode, setGoalMode] = useState(false);
  /** Per-session (or draft) JSON Schema for structured output. */
  const [sessionJsonSchema, setSessionJsonSchema] = useState<string | null>(
    null,
  );
  const sessionJsonSchemaRef = useRef<string | null>(null);
  sessionJsonSchemaRef.current = sessionJsonSchema;
  const [showJsonSchemaModal, setShowJsonSchemaModal] = useState(false);
  const [jsonSchemaDraft, setJsonSchemaDraft] = useState("");
  /** Prevent overlapping executeSend / queue auto-flush races. */
  const sendInFlightRef = useRef(false);
  const executeSendFromQueueRef = useRef<ExecuteSendFromQueue>(
    async () => false,
  );
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showMcpModal, setShowMcpModal] = useState(false);
  const [showCompactModal, setShowCompactModal] = useState(false);
  const [compactNote, setCompactNote] = useState("");
  /** light / standard / aggressive — seeds note templates (CLI has no intensity flag). */
  const [compactPreset, setCompactPreset] =
    useState<CompactPresetId>(DEFAULT_COMPACT_PRESET);
  /** CLI 0.2.117+ --compaction-mode / GROK_COMPACTION_MODE (global settings). */
  const [compactionMode, setCompactionMode] =
    useState<CompactionModeId>(DEFAULT_COMPACTION_MODE);
  /** CLI 0.2.117+ --compaction-detail (segments only). */
  const [compactionDetail, setCompactionDetail] =
    useState<CompactionDetailId>(DEFAULT_COMPACTION_DETAIL);
  const compactNoteRef = useRef<HTMLInputElement>(null);
  /**
   * UI estimate of tokens-before captured when the user confirms manual compact.
   * Fills banner range when the agent omits `tokensBefore`.
   */
  const pendingCompactBeforeRef = useRef<{
    sessionId: string;
    tokensBefore: number | null;
    at: number;
  } | null>(null);
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
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const [activeProject, setActiveProject] = useState<Project | null>(null);
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
  /** Sidebar multi-select: archive / restore several sessions at once. */
  const [sessionSelectMode, setSessionSelectMode] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  /** Anchor for Shift+click contiguous range select in the sidebar. */
  const sessionSelectAnchorIdRef = useRef<string | null>(null);
  /** Latest sidebar order for range select (avoids stale closures). */
  const sidebarSelectOrderIdsRef = useRef<string[]>([]);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>(null);
  /** Project rules dialog (from project context menu). */
  const [projectRulesTarget, setProjectRulesTarget] = useState<{
    path: string;
    name: string;
  } | null>(null);
  const searchPanelRef = useRef<HTMLDivElement>(null);
  const compactModalRef = useRef<HTMLFormElement>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  /** Keyword hybrid scope: all | title | content (no embeddings). Persisted. */
  const [searchMode, setSearchMode] = useState<SessionSearchMode>(
    () => loadSessionSearchFilterPref().mode,
  );
  const [searchIncludeArchived, setSearchIncludeArchived] = useState(
    () => loadSessionSearchFilterPref().includeArchived,
  );
  /** Keyword vs local hybrid ranking for palette session search. */
  const [searchRankMode, setSearchRankMode] = useState<SessionSearchRankMode>(
    () => loadSessionSearchRankPref(),
  );
  /** Debounced journal content hits from `sessions_search`. */
  const [contentSearchHits, setContentSearchHits] = useState<
    SessionContentHit[]
  >([]);
  const [contentSearchLoading, setContentSearchLoading] = useState(false);
  const contentSearchSeq = useRef(0);
  /** Floating composer shell — height drives chat bottom padding. */
  const composerWrapRef = useRef<HTMLDivElement>(null);
  /** Set by newChat; applied after chat pane + textarea mount. */
  const pendingComposerFocus = useRef(false);
  const [sessionDataMode, setSessionDataMode] = useState("independent");
  const [defaultOpenTarget, setDefaultOpenTarget] = useState("finder");
  const [showUserMenu, setShowUserMenu] = useState(false);
  /** Desktop Connect panel (AC7) — close does not stop host. */

  /** Phone mirror chrome: WS link + host account summary. */
  const [mirrorLinkOk, setMirrorLinkOk] = useState(() =>
    typeof window !== "undefined" && isMirrorClient() ? mirrorWsConnected() : false,
  );
  const [mirrorHostLabel, setMirrorHostLabel] = useState<string | null>(null);
  /** Mirror + ≤820px — phone chrome only; desktop layout path never sets this. */
  const [phoneLayout, setPhoneLayout] = useState(() =>
    typeof window !== "undefined"
      ? isMirrorPhoneLayout({
          isMirror: isMirrorClient(),
          viewportWidth: window.innerWidth,
        })
      : false,
  );
  const [phoneToolsOpen, setPhoneToolsOpen] = useState(false);
  const [phoneAccountOpen, setPhoneAccountOpen] = useState(false);
  /** Hash route: workbench | settings/:section | automations */
  const [appView, setAppView] = useState<"workbench" | "settings">("workbench");
  /** Inside workbench: chat thread vs scheduled tasks list. */
  const [mainPane, setMainPane] = useState<"chat" | "automations">("chat");
  const [settingsSection, setSettingsSection] =
    useState<SettingsSectionId>("general");
  const [settingsTab, setSettingsTab] = useState<SettingsTabId | null>(
    "composer",
  );
  /** Prevent overlapping automation runs. */
  const automationRunLock = useRef(false);
  /** Conversation is guiding the user to create a scheduled task. */
  const automationSetupDraftRef = useRef(false);
  const automationSetupSessionsRef = useRef<Set<string>>(new Set());
  const automationAppliedRef = useRef<Set<string>>(new Set());
  /** While openSession loads, do not let session.sessionId effect clobber viewing id. */
  const openingSessionIdRef = useRef<string | null>(null);

  // ContextMenu handles outside click + Escape for sidebar menus.

  // Command palette: Tab trap + Escape (autoFocus on input).
  useEffect(() => {
    if (!showSearch) return;
    return installDialogFocus(() => searchPanelRef.current, {
      onEscape: () => setShowSearch(false),
      capture: true,
      initialFocus: "none",
      restoreFocus: true,
    });
  }, [showSearch]);

  // Compact slash dialog — focus trap + Escape.
  useEffect(() => {
    if (!showCompactModal) return;
    return installDialogFocus(() => compactModalRef.current, {
      onEscape: () => {
        setShowCompactModal(false);
        setCompactNote("");
        setCompactPreset(DEFAULT_COMPACT_PRESET);
      },
      capture: true,
      initialFocus: "first",
      restoreFocus: true,
    });
  }, [showCompactModal]);

  // Settings (or other windows) may change hybrid rank pref via localStorage event.
  // Settings (or other windows) may change hybrid rank / filter prefs.
  useEffect(() => {
    const syncRank = () => setSearchRankMode(loadSessionSearchRankPref());
    const syncFilters = () => {
      const f = loadSessionSearchFilterPref();
      setSearchMode(f.mode);
      setSearchIncludeArchived(f.includeArchived);
    };
    const syncAll = () => {
      syncRank();
      syncFilters();
    };
    const onRank = (e: Event) => {
      const detail = (e as CustomEvent<SessionSearchRankMode>).detail;
      if (detail === "hybrid" || detail === "keyword") {
        setSearchRankMode(detail);
      } else {
        syncRank();
      }
    };
    const onFilter = (e: Event) => {
      const detail = (
        e as CustomEvent<{ mode?: SessionSearchMode; includeArchived?: boolean }>
      ).detail;
      if (detail && typeof detail === "object") {
        if (
          detail.mode === "all" ||
          detail.mode === "title" ||
          detail.mode === "content"
        ) {
          setSearchMode(detail.mode);
        }
        if (typeof detail.includeArchived === "boolean") {
          setSearchIncludeArchived(detail.includeArchived);
        }
      } else {
        syncFilters();
      }
    };
    window.addEventListener(SESSION_SEARCH_RANK_CHANGE_EVENT, onRank);
    window.addEventListener(SESSION_SEARCH_FILTER_CHANGE_EVENT, onFilter);
    window.addEventListener("storage", syncAll);
    return () => {
      window.removeEventListener(SESSION_SEARCH_RANK_CHANGE_EVENT, onRank);
      window.removeEventListener(SESSION_SEARCH_FILTER_CHANGE_EVENT, onFilter);
      window.removeEventListener("storage", syncAll);
    };
  }, []);

  useEffect(() => {
    if (!sessionSelectMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (appDialogRef.current) return;
      e.preventDefault();
      setSessionSelectMode(false);
      setSelectedSessionIds(new Set());
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sessionSelectMode]);

  // Debounced content search over App journals (title filter stays instant).
  // Title-only mode skips the journal scan entirely.
  useEffect(() => {
    if (!showSearch) {
      setContentSearchHits([]);
      setContentSearchLoading(false);
      return;
    }
    const q = searchQuery.trim();
    if (!shouldScanSessionContent(q, searchMode)) {
      setContentSearchHits([]);
      setContentSearchLoading(false);
      return;
    }
    setContentSearchLoading(true);
    const seq = ++contentSearchSeq.current;
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const hits = await api.sessionsSearch(q, 20);
          if (contentSearchSeq.current !== seq) return;
          setContentSearchHits(
            hits.map((h) => ({
              id: h.id,
              title: h.title,
              projectId: h.projectId,
              snippet: h.snippet,
              matchCount: h.matchCount,
              updatedAt: h.updatedAt,
              archived: h.archived,
            })),
          );
        } catch {
          if (contentSearchSeq.current !== seq) return;
          setContentSearchHits([]);
        } finally {
          if (contentSearchSeq.current === seq) {
            setContentSearchLoading(false);
          }
        }
      })();
    }, 280);
    return () => window.clearTimeout(t);
  }, [searchQuery, showSearch, searchMode]);

  // Global shortcuts: search, find-in-chat, help, doctor, copy last reply, toggle sidebar, new chat, settings, voice, Esc-stop.
  // Handlers go through refs so we don't re-bind every render.
  const shortcutHandlersRef = useRef({
    newChat: () => {},
    openSettings: () => {},
    openChatFind: () => {},
    copyLastReply: () => {},
    toggleSidebar: () => {},
    /** Right Side Workbench (⌥⌘B). */
    toggleRightPane: () => {},
    /** Open / focus a Side Workbench tab from the empty-state picker chords. */
    openSidePicker: (_kind: SidePickerKind) => {},
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
      if (e.key === "Escape" && voiceStealsEscape(voiceRef.current.phase)) {
        e.preventDefault();
        e.stopPropagation();
        shortcutHandlersRef.current.cancelVoice();
        return;
      }
      // Esc stops the active turn when nothing else owns Escape (catalog: shortcuts.stop).
      if (e.key === "Escape") {
        const gate = escapeStopLiveRef.current;
        if (
          shouldEscapeStopGeneration({
            ...gate,
            voiceStealsEscape: voiceStealsEscape(voiceRef.current.phase),
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
        { voiceHotkeyEnabled: voiceHotkeyEnabledRef.current },
      );
      if (!matched) return;
      e.preventDefault();
      switch (matched) {
        case "findInChat":
          shortcutHandlersRef.current.openChatFind();
          return;
        case "search":
          setShowSearch(true);
          return;
        case "help":
          setShowShortcuts((v) => !v);
          return;
        case "settings":
          shortcutHandlersRef.current.openSettings();
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
          shortcutHandlersRef.current.openSidePicker("terminal");
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
  const [appGate, setAppGate] = useState<"loading" | "setup" | "ready">(() =>
    typeof window !== "undefined" && isMirrorClient() ? "ready" : "loading",
  );
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
  const [, setPlanHistoryNonEmpty] = useState(
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
  const [showReliability, setShowReliability] = useState(false);
  /** In-session ring of recent stall events (soft/hard); no secrets. */
  const [recentStallSignals, setRecentStallSignals] = useState<
    ReliabilityStallSignal[]
  >([]);
  /** In-session ring of recent error-deck cards. */
  const [recentErrorEntries, setRecentErrorEntries] = useState<
    ReliabilityErrorEntry[]
  >([]);
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
  const [chatFindQuery, setChatFindQuery] = useState("");
  const [chatFindIndex, setChatFindIndex] = useState(0);
  const [savedAccounts, setSavedAccounts] = useState<api.SavedAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [perm, setPerm] = useState<PermissionPayload | null>(null);
  const permBarRef = useRef<HTMLDivElement | null>(null);
  /** Seconds until auto-deny (null when off / no active timer). */
  const [permCountdownSec, setPermCountdownSec] = useState<number | null>(null);
  const [permissionTimeoutSec, setPermissionTimeoutSec] = useState(() =>
    loadPermissionTimeoutSec(localStorage),
  );
  const [askUserTimeoutSec, setAskUserTimeoutSec] = useState(() =>
    loadAskUserTimeoutSec(localStorage),
  );
  const [askUser, setAskUser] = useState<AskUserPayload | null>(null);
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
    useState<LocalePreference>("en");
  const [locale, setLocale] = useState<Locale>(() =>
    resolveLocalePreference("en"),
  );
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const tr = useMemo(() => createT(locale), [locale]);
  const trRef = useRef(tr);
  trRef.current = tr;
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [effort, setEffort] = useState(DEFAULT_EFFORT);
  const [mode, setMode] = useState("agent");
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [policy, setPolicy] = useState("ask");
  /** Live selectable models from Host (official CLI catalog only; not providers). */
  const [availableModels, setAvailableModels] =
    useState<ModelOption[]>(GROK_BUILD_MODELS);
  /** Where model/permission chips are remembered. */
  const [prefsScope, setPrefsScope] =
    useState<ComposerPrefsScope>("global");
  /** Enter vs ⌘/Ctrl+Enter to send (localStorage; Settings → Composer). */
  const [composerSendKeyPref, setComposerSendKeyPref] =
    useState<ComposerSendKeyPref>(() => loadComposerSendKeyPref());
  useEffect(() => {
    const reload = () => setComposerSendKeyPref(loadComposerSendKeyPref());
    window.addEventListener(COMPOSER_SEND_KEY_CHANGED_EVENT, reload);
    return () =>
      window.removeEventListener(COMPOSER_SEND_KEY_CHANGED_EVENT, reload);
  }, []);
  /** Muted char/word count on non-empty drafts (localStorage; Settings → Composer). */
  const [showComposerDraftStats, setShowComposerDraftStats] = useState(() =>
    loadComposerDraftStatsPref(),
  );
  useEffect(() => {
    const reload = () => setShowComposerDraftStats(loadComposerDraftStatsPref());
    window.addEventListener(COMPOSER_DRAFT_STATS_CHANGED_EVENT, reload);
    return () =>
      window.removeEventListener(COMPOSER_DRAFT_STATS_CHANGED_EVENT, reload);
  }, []);
  /** Browser spellcheck on main composer (localStorage; Settings → Composer). */
  const [composerSpellcheck, setComposerSpellcheck] = useState(() =>
    loadComposerSpellcheck(),
  );
  useEffect(() => {
    const reload = () => setComposerSpellcheck(loadComposerSpellcheck());
    window.addEventListener(COMPOSER_SPELLCHECK_CHANGED_EVENT, reload);
    return () =>
      window.removeEventListener(COMPOSER_SPELLCHECK_CHANGED_EVENT, reload);
  }, []);
  /** Sidebar session-list density (localStorage; Settings → Appearance). */
  const [sidebarDensity, setSidebarDensity] = useState<SidebarDensity>(() =>
    loadSidebarDensity(),
  );
  useEffect(() => {
    const reload = () => setSidebarDensity(loadSidebarDensity());
    window.addEventListener(SIDEBAR_DENSITY_EVENT, reload);
    return () => window.removeEventListener(SIDEBAR_DENSITY_EVENT, reload);
  }, []);
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
  /** Live drag-drop target for zone overlays (null = not dragging). */
  const [dragZone, setDragZone] = useState<"sidebar" | "main" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const dragPathsRef = useRef<string[]>([]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [, setSetup] = useState({ cli: false, auth: false, project: false });
  const [localError, setLocalError] = useState<string | null>(null);
  /** Expand technical dump under the compact error banner. */
  const [errorDetailOpen, setErrorDetailOpen] = useState(false);
  const [cliInfo, setCliInfo] = useState(() =>
    mapProbeToCliInfo({ found: false }),
  );
  const [cliAgentSkewRepairing, setCliAgentSkewRepairing] = useState(false);
  const [manualCliPath, setManualCliPath] = useState("");
  const [acpServerAddr, setAcpServerAddr] = useState("");
  const [proxyMode, setProxyMode] = useState("system");
  const [proxyUrl, setProxyUrl] = useState("");
  const [proxyNoProxy, setProxyNoProxy] = useState("");
  const [maxConcurrentAgents, setMaxConcurrentAgents] = useState(8);
  /** Last process_limit event for Settings / Reliability honesty (ids only). */
  const [lastProcessLimit, setLastProcessLimit] =
    useState<ProcessLimitEvent | null>(null);
  const [agentIdleMinutes, setAgentIdleMinutes] = useState(30);
  const [streamStallSeconds, setStreamStallSeconds] = useState(600);
  /** Tool audit ledger retention days: 7 | 30 | 90 | 0 = unlimited. */
  const [auditLedgerRetentionDays, setAuditLedgerRetentionDays] = useState(0);
  /** Headless partial stream events (CLI 0.2.117+). */
  const [includePartialMessages, setIncludePartialMessages] = useState(false);
  /** 0 = omit `--max-turns` (CLI default). */
  const [maxAgentTurns, setMaxAgentTurns] = useState(0);
  /** Headless bg wait: wait | no_wait | timeout (CLI 0.2.117+). */
  const [backgroundWaitPolicy, setBackgroundWaitPolicy] = useState("wait");
  const [backgroundWaitTimeoutSec, setBackgroundWaitTimeoutSec] = useState(600);
  const [storeApiKeysInKeychain, setStoreApiKeysInKeychain] = useState(false);
  const [sandboxProfile, setSandboxProfile] = useState(DEFAULT_SANDBOX_PROFILE);
  /** Preferred CLI agent definition for spawn (`""` = CLI default). */
  const [preferredAgent, setPreferredAgent] = useState("");
  /** Optional `grok agent --agent-profile <PATH>` (empty = omit). */
  const [agentProfilePath, setAgentProfilePath] = useState("");
  /** Optional top-level `grok --agents <JSON>` (empty = omit). */
  const [agentsJson, setAgentsJson] = useState("");
  const [agentCatalog, setAgentCatalog] = useState<
    Array<{ name: string; source: string }>
  >([]);
  const [experimentalMemory, setExperimentalMemory] = useState(false);
  // compactionMode / compactionDetail state lives near compact modal (shared with Settings).
  const [twoPassCompactionEnabled, setTwoPassCompactionEnabled] =
    useState(false);
  const [voiceId, setVoiceId] = useState("eve");
  const [voiceDictationAutoSend, setVoiceDictationAutoSend] = useState(false);
  const [voiceKeepAgentsOnEnd, setVoiceKeepAgentsOnEnd] = useState(true);
  const [allowUnverifiedCliInstall, setAllowUnverifiedCliInstall] =
    useState(false);
  const [lastCliChecksumVerified, setLastCliChecksumVerified] = useState<
    boolean | null
  >(null);
  const voiceDictationAutoSendRef = useRef(false);
  const sendRef = useRef<(() => Promise<void>) | null>(null);
  const [subagentsEnabled, setSubagentsEnabled] = useState(true);
  const [subagentWorktreeSnapshotEnabled, setSubagentWorktreeSnapshotEnabled] =
    useState(false);
  const [autoWakeEnabled, setAutoWakeEnabled] = useState(false);
  const [workflowsEnabled, setWorkflowsEnabled] = useState(false);
  const [planEnabled, setPlanEnabled] = useState(true);
  const [todoGateEnabled, setTodoGateEnabled] = useState(false);
  const [todoGateMaxFiresPerPrompt, setTodoGateMaxFiresPerPrompt] =
    useState(3);
  const [disableWebSearch, setDisableWebSearch] = useState(false);
  const [noAskUser, setNoAskUser] = useState(false);
  const [disallowedTools, setDisallowedTools] = useState<string[]>([]);
  const [allowedTools, setAllowedTools] = useState<string[]>([]);
  const [useLeader, setUseLeader] = useState(false);
  /** Default off → launch on draft new-chat page. */
  const [reopenLastSession, setReopenLastSession] = useState(false);
  const [closeToTray, setCloseToTray] = useState(true);
  const [keepTrayForSchedules, setKeepTrayForSchedules] = useState(true);
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  /** Desktop notification prefs (default on). Refs keep event listeners fresh. */
  const [notifyOnTurnDone, setNotifyOnTurnDone] = useState(true);
  const [notifyOnPermission, setNotifyOnPermission] = useState(true);
  const notifyPrefsRef = useRef({
    notifyOnTurnDone: true,
    notifyOnPermission: true,
  });
  notifyPrefsRef.current = { notifyOnTurnDone, notifyOnPermission };
  const [lastSessionId, setLastSessionId] = useState<string | null>(null);
  const didRestoreLastRef = useRef(false);
  const [tasksPanelOpen, setTasksPanelOpen] = useState(false);
  const [agentDashboardOpen, setAgentDashboardOpen] = useState(false);
  const [taskBoardOpen, setTaskBoardOpen] = useState(false);
  const [taskBoardIncludeArchived, setTaskBoardIncludeArchived] =
    useState(false);
  const [batchAgentsOpen, setBatchAgentsOpen] = useState(false);
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
  /** PR hub row highlight from ship deep link / `?pr=`. */
  const [prHubHighlightPr, setPrHubHighlightPr] = useState<number | null>(null);
  /** One-shot Settings scroll target (e.g. settings-anchor-prHub). */
  const [settingsFocusAnchor, setSettingsFocusAnchor] = useState<string | null>(
    null,
  );
  /** Host stream-stall prompt (I06); null when dismissed or not stalled. */
  const [streamStall, setStreamStall] = useState<{
    sessionId?: string;
    stallSeconds: number;
    tier?: string;
    sawModelOutput?: boolean;
    sawToolActivity?: boolean;
  } | null>(null);

  // Full multi-session liveMap only while chrome that needs every row is open.
  const liveMap = useLiveMapWhen(
    showReliability ||
      agentDashboardOpen ||
      taskBoardOpen ||
      tasksPanelOpen ||
      streamStall != null,
  );
  /** Queue item currently being steered into the live turn. */
  const [guidingQueueItemId, setGuidingQueueItemId] = useState<string | null>(null);
  /** Queue item open in the edit dialog (`null` when closed). */
  const [queueEditItemId, setQueueEditItemId] = useState<string | null>(null);
  const [queueEditText, setQueueEditText] = useState("");
  const queueEditTextareaRef = useRef<HTMLTextAreaElement>(null);
  /** Clear-all send queue — App-level GlassModal (never window.confirm). */
  const [sendQueueClearOpen, setSendQueueClearOpen] = useState(false);

  const [connecting, setConnecting] = useState(false);
  /** Sync gate for ensureConnected (React state alone races two rapid sends). */
  const connectingRef = useRef(false);
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
  const [resizingAside, setResizingAside] = useState(false);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  /** Pointer-drag origin for left-rail resize (clientX + width at down). */
  const sidebarResizeStartRef = useRef<{ x: number; width: number } | null>(
    null,
  );
  const [account, setAccount] = useState<api.AccountStatus | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  /** Soft-fail heatmap / account_status error (never invents activity or quota). */
  const [accountHeatmapError, setAccountHeatmapError] = useState<unknown>(null);
  /** Soft-fail last account_status / billing probe error (never invents quota %). */
  const [accountProbeError, setAccountProbeError] = useState<unknown>(null);
  const [loginHint, setLoginHint] = useState<string | null>(null);
  const platform = useMemo(() => detectAppPlatform(), []);
  /** Self-drawn chrome when OS title bar is disabled (Windows release config). */
  const useCustomWindowChrome = platform === "win" || platform === "other";
  /** Titlebar / chrome-strip double-click → maximize on mac + win. */
  const titlebarMax = titlebarMaximizeHandlers({
    enabled: !phoneLayout && !isMirrorClient(),
  });
  /** Right inset so resource chrome icons clear min/max/close. */
  const windowControlsInset = useCustomWindowChrome ? WINDOW_CONTROLS_INSET : 0;
  const [windowMaximized, setWindowMaximized] = useState(false);

  const asideClampOpts = useCallback((): {
    windowControlsInset: number;
    viewportWidth?: number;
    sidebarOccupiedWidth?: number;
  } => {
    const sidebarOpen = !layout.sidebarCollapsed && !phoneLayout;
    return {
      windowControlsInset,
      viewportWidth:
        typeof window !== "undefined" ? window.innerWidth : undefined,
      // Match open `.sidebar` width so aside max leaves chat ≥ MAIN_CHAT_MIN_WIDTH.
      sidebarOccupiedWidth: sidebarOpen
        ? layout.sidebarWidth || SIDEBAR_DEFAULT_WIDTH
        : 0,
    };
  }, [
    windowControlsInset,
    layout.sidebarCollapsed,
    layout.sidebarWidth,
    phoneLayout,
  ]);

  /**
   * Soft-grow the right resource pane from content hints (preview kind, tree,
   * tabs). Never auto-shrink a wider user width; always enforce chrome-safe min
   * so action icons do not sit under window controls.
   */
  /**
   * Single grow + optional aside clamp. One setSize only — no multi-pass
   * measure loops (those caused grow↔clamp flicker).
   */
  const fitWindowThenClampAside = useCallback(
    async (projected: {
      sidebarCollapsed: boolean;
      sidebarWidth: number;
      asideCollapsed: boolean;
      asideWidth: number;
    }) => {
      if (phoneLayout) return projected.asideWidth;
      const preferredAside = projected.asideCollapsed
        ? projected.asideWidth
        : Math.max(
            projected.asideWidth || 0,
            DEFAULT_LAYOUT.asideWidth,
            ASIDE_WIDTH_MIN,
          );
      const target = {
        ...projected,
        sidebarWidth: projected.sidebarWidth || SIDEBAR_DEFAULT_WIDTH,
        asideWidth: preferredAside,
      };
      await ensureWindowFitsLayout(target);
      if (projected.asideCollapsed) return projected.asideWidth;
      const opts = {
        ...asideClampOpts(),
        viewportWidth:
          typeof window !== "undefined" ? window.innerWidth : undefined,
        sidebarOccupiedWidth: projected.sidebarCollapsed
          ? 0
          : target.sidebarWidth,
      };
      return clampAsideWidth(preferredAside, opts);
    },
    [asideClampOpts, phoneLayout],
  );

  /**
   * Open the right pane immediately, then fit/clamp the window in the
   * background. Waiting on Tauri window APIs before uncollapsing made chat
   * file-card preview feel like the side pane was frozen for a long time.
   */
  const openAsidePane = useCallback(() => {
    if (phoneLayout) {
      setLayout((l) => {
        if (!l.asideCollapsed) return l;
        const n = { ...l, asideCollapsed: false };
        saveLayout(localStorage, n);
        return n;
      });
      return;
    }
    const cur = layoutRef.current;
    const preferredAside = Math.max(
      cur.asideWidth || 0,
      DEFAULT_LAYOUT.asideWidth,
      ASIDE_WIDTH_MIN,
    );
    // Sync-clamp to the *current* viewport before paint. Opening at preferred
    // width first (old path) made sidebar + main min + aside overflow narrow
    // non-maximized windows, clipping the side chrome close control off-screen.
    const syncWidth = clampAsideWidth(preferredAside, {
      ...asideClampOpts(),
      viewportWidth:
        typeof window !== "undefined" ? window.innerWidth : undefined,
      sidebarOccupiedWidth: cur.sidebarCollapsed
        ? 0
        : cur.sidebarWidth || SIDEBAR_DEFAULT_WIDTH,
    });
    // If the frame is too tight for any aside (syncWidth 0), still paint a
    // small pane and let window fit / expand try to recover.
    const paintWidth =
      syncWidth > 0
        ? syncWidth
        : Math.min(preferredAside, ASIDE_WIDTH_MIN);
    setLayout((l) => {
      if (!l.asideCollapsed && (l.asideWidth || 0) === paintWidth) return l;
      const n = {
        ...l,
        asideCollapsed: false,
        asideWidth: paintWidth,
      };
      saveLayout(localStorage, n);
      return n;
    });
    const projected = {
      sidebarCollapsed: cur.sidebarCollapsed,
      sidebarWidth: cur.sidebarWidth || SIDEBAR_DEFAULT_WIDTH,
      asideCollapsed: false as const,
      asideWidth: preferredAside,
    };
    void fitWindowThenClampAside(projected).then((width) => {
      setLayout((l) => {
        // User may have closed the pane while the window fit was in flight.
        if (l.asideCollapsed) return l;
        if (l.asideWidth === width) return l;
        const n = { ...l, asideWidth: width };
        saveLayout(localStorage, n);
        return n;
      });
    });
  }, [asideClampOpts, fitWindowThenClampAside, phoneLayout]);

  /** Collapse the right Side Workbench (and exit expand / dock composer). */
  const closeAsidePane = useCallback(() => {
    planOpenedAsideRef.current = false;
    setSideWorkbench((s) => (s.expanded ? { ...s, expanded: false } : s));
    setSideDockComposer(false);
    setLayout((l) => {
      if (l.asideCollapsed) return l;
      const n = { ...l, asideCollapsed: true };
      saveLayout(localStorage, n);
      return n;
    });
  }, []);

  /** Route chat context opens into Side Workbench tabs (Phase 6). */
  useEffect(() => {
    if (!resourceOpenTarget) return;
    const result = applySideContextOpen(sideWorkbench, resourceOpenTarget, {
      isGitProject: sideIsGitProject,
    });
    if (result.needAsideOpen) {
      setSideWorkbench(result.state);
      openAsidePane();
    }
    setResourceOpenTarget(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- consume once per target
  }, [resourceOpenTarget]);

  /** Open the left project rail; one window fit (+ reclamp open files pane). */
  const openSidebarPane = useCallback(() => {
    if (phoneLayout) {
      setLayout((l) => {
        if (!l.sidebarCollapsed) return l;
        const n = { ...l, sidebarCollapsed: false };
        saveLayout(localStorage, n);
        return n;
      });
      return;
    }
    const cur = layoutRef.current;
    // After auto-collapse (drag below threshold) width is stored as MIN;
    // always open at least SIDEBAR_WIDTH_MIN.
    const openWidth = clampSidebarWidth(
      cur.sidebarWidth || SIDEBAR_WIDTH_MIN,
      {
        viewportWidth:
          typeof window !== "undefined" ? window.innerWidth : undefined,
        asideOccupiedWidth: cur.asideCollapsed ? 0 : cur.asideWidth || 0,
      },
    );
    const projected = {
      sidebarCollapsed: false as const,
      sidebarWidth: openWidth,
      asideCollapsed: cur.asideCollapsed,
      asideWidth: cur.asideCollapsed
        ? cur.asideWidth
        : Math.max(cur.asideWidth || 0, DEFAULT_LAYOUT.asideWidth),
    };
    void fitWindowThenClampAside(projected).then((width) => {
      setLayout((l) => {
        let n = {
          ...l,
          sidebarCollapsed: false,
          sidebarWidth: openWidth,
        };
        if (!projected.asideCollapsed) {
          n = { ...n, asideWidth: width };
        }
        saveLayout(localStorage, n);
        return n;
      });
    });
  }, [fitWindowThenClampAside, phoneLayout]);

  const openAsidePaneRef = useRef(openAsidePane);
  openAsidePaneRef.current = openAsidePane;

  /**
   * Enter/exit zen mode: remember prior collapse, force both panes hidden,
   * restore on disable. Escape is not bound (Esc→stop must keep working).
   */
  const setZenModeEnabled = useCallback((enabled: boolean) => {
    if (zenModeRef.current === enabled) return;
    const cur = layoutRef.current;
    const prior = enabled ? null : loadZenModePrior(localStorage);
    const { layout: nextCollapse, nextPrior } = applyZenModeLayoutTransition(
      enabled,
      {
        sidebarCollapsed: cur.sidebarCollapsed,
        asideCollapsed: cur.asideCollapsed,
      },
      prior,
    );
    if (enabled) {
      if (nextPrior) saveZenModePrior(nextPrior, localStorage);
    } else {
      clearZenModePrior(localStorage);
    }
    setLayout((l) => {
      const n = {
        ...l,
        sidebarCollapsed: nextCollapse.sidebarCollapsed,
        asideCollapsed: nextCollapse.asideCollapsed,
      };
      saveLayout(localStorage, n);
      return n;
    });
    // Sync ref before saveZenMode dispatches, so the change listener is a no-op.
    zenModeRef.current = enabled;
    setZenModeState(enabled);
    saveZenMode(enabled, localStorage);
  }, []);

  /** Toggle transcript filter (all ↔ conversation) — Settings + chat chrome. */
  const setTranscriptFilterMode = useCallback((mode: TranscriptFilterMode) => {
    const next: TranscriptFilterMode =
      mode === "conversation" ? "conversation" : "all";
    setTranscriptFilter(next);
    saveTranscriptFilterPref(next);
  }, []);
  const toggleTranscriptFilter = useCallback(() => {
    setTranscriptFilterMode(
      transcriptFilter === "conversation" ? "all" : "conversation",
    );
  }, [transcriptFilter, setTranscriptFilterMode]);

  useEffect(() => {
    const onPref = (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      if (detail === "all" || detail === "conversation") {
        setTranscriptFilter(detail);
      } else {
        setTranscriptFilter(loadTranscriptFilterPref());
      }
    };
    window.addEventListener(TRANSCRIPT_FILTER_CHANGE_EVENT, onPref);
    return () =>
      window.removeEventListener(TRANSCRIPT_FILTER_CHANGE_EVENT, onPref);
  }, []);

  // Settings (or another surface) may flip zen via localStorage + event.
  useEffect(() => {
    const onChange = (ev: Event) => {
      const detail = (ev as CustomEvent<boolean>).detail;
      const next =
        typeof detail === "boolean" ? detail : loadZenMode(localStorage);
      setZenModeEnabled(next);
    };
    window.addEventListener(ZEN_MODE_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(ZEN_MODE_CHANGE_EVENT, onChange);
  }, [setZenModeEnabled]);


  // Follow OS / browser UI language when preference is "system".
  useEffect(() => {
    if (localePreference !== "system") return;
    const applySystem = () => {
      const next = resolveLocaleFromSystem(
        typeof navigator !== "undefined" ? navigator.language : null,
      );
      setLocale(next);
    };
    applySystem();
    if (typeof window === "undefined" || !("addEventListener" in window)) {
      return;
    }
    window.addEventListener("languagechange", applySystem);
    return () => window.removeEventListener("languagechange", applySystem);
  }, [localePreference]);


  useEffect(() => {
    document.documentElement.classList.remove(
      "platform-mac",
      "platform-win",
      "platform-other",
    );
    if (platform === "mac") document.documentElement.classList.add("platform-mac");
    if (platform === "win") document.documentElement.classList.add("platform-win");
    if (platform === "other") document.documentElement.classList.add("platform-other");
  }, [platform]);

  // Track maximized on every desktop host (mac Overlay + Win frameless) so
  // .is-maximized chrome + layout reclamp stay honest after titlebar dblclick.
  useEffect(() => {
    if (!api.isDesktopHost() || !api.isTauri()) return;
    let unlistenResize: (() => void) | undefined;
    let unlistenScale: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const w = getCurrentWindow();
        const sync = async () => {
          try {
            setWindowMaximized(await w.isMaximized());
          } catch {
            /* ignore */
          }
        };
        await sync();
        unlistenResize = await w.onResized(() => {
          void sync();
        });
        try {
          unlistenScale = await w.onScaleChanged(() => {
            void sync();
          });
        } catch {
          /* older API */
        }
        if (cancelled) {
          unlistenResize?.();
          unlistenScale?.();
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
      unlistenResize?.();
      unlistenScale?.();
    };
  }, []);

  // Apply always-on-top from localStorage on boot (and whenever state is set).
  useEffect(() => {
    void applyWindowAlwaysOnTop(windowAlwaysOnTop);
  }, [windowAlwaysOnTop]);

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
          setLayout((l) => {
            if (l.sidebarCollapsed && l.asideCollapsed) return l;
            // Do not persist secondary layout over the main window's prefs.
            return { ...l, sidebarCollapsed: true, asideCollapsed: true };
          });
          setAppView("workbench");
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
          if (
            settings.composerPrefsScope &&
            isValidPrefsScope(settings.composerPrefsScope)
          ) {
            setPrefsScope(settings.composerPrefsScope);
          }
          setSessionDataMode(settings.sessionDataMode || "independent");
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
      type BootPair = [
        Awaited<ReturnType<typeof api.settingsGet>>,
        Awaited<ReturnType<typeof api.probeCli>>,
      ];
      const bootPair = Promise.all([settingsP, cliP]) as Promise<BootPair>;
      let timeoutId: number | undefined;
      const timed = new Promise<BootPair>((_resolve, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error("BOOT_DETECT_TIMEOUT"));
        }, BOOT_TIMEOUT_MS);
      });
      let settings: Awaited<ReturnType<typeof api.settingsGet>>;
      let cli: Awaited<ReturnType<typeof api.probeCli>>;
      try {
        [settings, cli] = await Promise.race([bootPair, timed]);
      } finally {
        window.clearTimeout(slowTimer);
        if (timeoutId != null) window.clearTimeout(timeoutId);
      }

      {
        const pref = parseLocalePreference(settings.locale);
        setLocalePreference(pref);
        setLocale(resolveLocalePreference(pref));
      }
      setManualCliPath(settings.manualCliPath || cli.path || "");
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
      const wizardCompleted = !!settings.setupWizardCompleted;
      const legacyDone =
        !!settings.onboardingDone || !!settings.setupSkipped;
      const gate = resolveSetupGateBoot({
        cliFound: !!cli.found,
        wizardCompleted,
        legacyDone,
        isMirror: isMirrorClient(),
      });
      setBootDetectTimedOut(false);
      setBootDetectSlow(false);
      setAppGate(gate.phase);

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
      if (
        settings.composerPrefsScope &&
        isValidPrefsScope(settings.composerPrefsScope)
      ) {
        setPrefsScope(settings.composerPrefsScope);
      }
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
      setSessionDataMode(settings.sessionDataMode || "independent");
      setDefaultOpenTarget(
        (settings as { defaultOpenTarget?: string }).defaultOpenTarget ||
          "finder",
      );
      setAcpServerAddr(settings.acpServerAddr || "");
      {
        const st = settings as {
          proxyMode?: string;
          proxyUrl?: string | null;
          proxyNoProxy?: string | null;
        };
        setProxyMode(st.proxyMode || "system");
        setProxyUrl(st.proxyUrl || "");
        setProxyNoProxy(st.proxyNoProxy || "");
      }
      setMaxConcurrentAgents(
        typeof settings.maxConcurrentAgents === "number" &&
          settings.maxConcurrentAgents >= 1
          ? Math.min(32, Math.round(settings.maxConcurrentAgents))
          : 3,
      );
      setAgentIdleMinutes(
        typeof settings.agentIdleMinutes === "number" &&
          settings.agentIdleMinutes >= 1
          ? Math.min(1440, Math.round(settings.agentIdleMinutes))
          : 30,
      );
      setStreamStallSeconds(
        typeof settings.streamStallSeconds === "number" &&
          settings.streamStallSeconds >= 15
          ? Math.min(900, Math.round(settings.streamStallSeconds))
          : 120,
      );
      {
        const raw = settings.auditLedgerRetentionDays;
        const n =
          typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : 0;
        setAuditLedgerRetentionDays(
          n === 7 || n === 30 || n === 90 ? n : 0,
        );
      }
      setIncludePartialMessages(!!settings.includePartialMessages);
      {
        const raw = settings.maxAgentTurns;
        setMaxAgentTurns(
          typeof raw === "number" && raw > 0
            ? Math.min(200, Math.round(raw))
            : 0,
        );
      }
      {
        const pol = (settings.backgroundWaitPolicy || "wait")
          .trim()
          .toLowerCase()
          .replace(/-/g, "_");
        setBackgroundWaitPolicy(
          pol === "no_wait" || pol === "timeout" ? pol : "wait",
        );
        const ts = settings.backgroundWaitTimeoutSec;
        setBackgroundWaitTimeoutSec(
          typeof ts === "number" && Number.isFinite(ts)
            ? Math.min(3600, Math.max(1, Math.round(ts)))
            : 600,
        );
      }
      setStoreApiKeysInKeychain(!!settings.storeApiKeysInKeychain);
      {
        const sb = (settings.sandboxProfile || DEFAULT_SANDBOX_PROFILE)
          .trim()
          .toLowerCase();
        setSandboxProfile(
          normalizeSandboxProfile(sb) ?? DEFAULT_SANDBOX_PROFILE,
        );
      }
      setPreferredAgent((settings.preferredAgent || "").trim());
      setAgentProfilePath((settings.agentProfilePath || "").trim());
      setAgentsJson((settings.agentsJson || "").trim());
      setExperimentalMemory(!!settings.experimentalMemory);
      setCompactionMode(normalizeCompactionMode(settings.compactionMode));
      setCompactionDetail(normalizeCompactionDetail(settings.compactionDetail));
      setTwoPassCompactionEnabled(!!settings.twoPassCompactionEnabled);
      setVoiceId((settings.voiceId || "eve").trim() || "eve");
      setVoiceDictationAutoSend(!!settings.voiceDictationAutoSend);
      setVoiceKeepAgentsOnEnd(
        settings.voiceKeepAgentsOnEnd !== false,
      );
      setAllowUnverifiedCliInstall(!!settings.allowUnverifiedCliInstall);
      setLastCliChecksumVerified(
        typeof settings.lastCliChecksumVerified === "boolean"
          ? settings.lastCliChecksumVerified
          : null,
      );
      setSubagentsEnabled(settings.subagentsEnabled !== false);
      setSubagentWorktreeSnapshotEnabled(
        !!settings.subagentWorktreeSnapshotEnabled,
      );
      setAutoWakeEnabled(!!settings.autoWakeEnabled);
      setWorkflowsEnabled(!!settings.workflowsEnabled);
      setPlanEnabled(settings.planEnabled !== false);
      setTodoGateEnabled(!!settings.todoGateEnabled);
      {
        const raw = settings.todoGateMaxFiresPerPrompt;
        setTodoGateMaxFiresPerPrompt(
          typeof raw === "number" && raw > 0
            ? Math.min(20, Math.max(1, Math.round(raw)))
            : 3,
        );
      }
      setDisableWebSearch(!!settings.disableWebSearch);
      setNoAskUser(!!settings.noAskUser);
      setDisallowedTools(
        Array.isArray(settings.disallowedTools)
          ? settings.disallowedTools.filter(
              (x): x is string => typeof x === "string",
            )
          : [],
      );
      setAllowedTools(
        Array.isArray(settings.allowedTools)
          ? settings.allowedTools.filter(
              (x): x is string => typeof x === "string",
            )
          : [],
      );
      setUseLeader(!!settings.useLeader);
      // Opt-in only (missing key / false → draft new chat on launch).
      setReopenLastSession(settings.reopenLastSession === true);
      setCloseToTray(settings.closeToTray !== false);
      setKeepTrayForSchedules(settings.keepTrayForSchedules !== false);
      setLaunchAtLogin(settings.launchAtLogin === true);
      setNotifyOnTurnDone(settings.notifyOnTurnDone !== false);
      setNotifyOnPermission(settings.notifyOnPermission !== false);
      setLastSessionId(
        typeof settings.lastSessionId === "string"
          ? settings.lastSessionId.trim() || null
          : null,
      );
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
        setLocalError(tr("setup.detectTimeoutHint"));
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
  }, [tr]);

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

  // Keep refs aligned for event handlers — but not while openSession is loading
  // (otherwise an intermediate null sessionId wipes viewing id and skips UI update).
  useEffect(() => {
    if (openingSessionIdRef.current) return;
    viewingSessionIdRef.current = session.sessionId;
  }, [session.sessionId]);

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
   * fence, strip it from the bubble and call automation_create.
   * Applies to all sessions (not only “用 AI 创建”), so normal chat can schedule.
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

      const { cleanText, input, rawJson } = extractAutomationPayload(
        assistant.content || "",
      );
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

      automationAppliedRef.current.add(applyKey);
      automationAppliedRef.current.add(payloadKey);
      try {
        await api.automationCreate(input);
        automationSetupSessionsRef.current.delete(sessionId);
      } catch {
        automationAppliedRef.current.delete(applyKey);
        automationAppliedRef.current.delete(payloadKey);
        setToast(tr("automations.createFailed"));
        window.setTimeout(() => setToast(null), 4200);
      }
    },
    [patchSessionMessages, tr],
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

  // Message timestamps visibility (localStorage; Settings dispatches change event).
  useEffect(() => {
    const onChange = (ev: Event) => {
      const detail = (ev as CustomEvent<unknown>).detail;
      if (typeof detail === "boolean") {
        setShowMessageTimestamps(detail);
        return;
      }
      setShowMessageTimestamps(loadMessageTimestampsPref(localStorage));
    };
    window.addEventListener(MESSAGE_TIMESTAMPS_CHANGE_EVENT, onChange);
    return () =>
      window.removeEventListener(MESSAGE_TIMESTAMPS_CHANGE_EVENT, onChange);
  }, []);

  // Assistant reply word/char count under bubble (localStorage; Settings event).
  useEffect(() => {
    const onChange = (ev: Event) => {
      const detail = (ev as CustomEvent<unknown>).detail;
      if (typeof detail === "boolean") {
        setShowReplyLength(detail);
        return;
      }
      setShowReplyLength(loadShowReplyLengthPref(localStorage));
    };
    window.addEventListener(SHOW_REPLY_LENGTH_CHANGE_EVENT, onChange);
    return () =>
      window.removeEventListener(SHOW_REPLY_LENGTH_CHANGE_EVENT, onChange);
  }, []);

  // Message time format absolute/relative (localStorage; Settings change event).
  useEffect(() => {
    const onChange = (ev: Event) => {
      const detail = (ev as CustomEvent<unknown>).detail;
      if (detail === "absolute" || detail === "relative") {
        setMessageTimeFormat(detail);
        return;
      }
      setMessageTimeFormat(loadMessageTimeFormatPref(localStorage));
    };
    window.addEventListener(MESSAGE_TIME_FORMAT_CHANGE_EVENT, onChange);
    return () =>
      window.removeEventListener(MESSAGE_TIME_FORMAT_CHANGE_EVENT, onChange);
  }, []);

  // Optional notify beep (localStorage; Settings dispatches change event).
  useEffect(() => {
    const onChange = (ev: Event) => {
      const detail = (ev as CustomEvent<unknown>).detail;
      if (typeof detail === "boolean") {
        setNotifySound(detail);
        return;
      }
      setNotifySound(loadNotifySoundPref(localStorage));
    };
    window.addEventListener(NOTIFY_SOUND_CHANGE_EVENT, onChange);
    return () =>
      window.removeEventListener(NOTIFY_SOUND_CHANGE_EVENT, onChange);
  }, []);

  // Permission auto-deny timeout (localStorage; Settings dispatches change event).
  useEffect(() => {
    const onChange = (ev: Event) => {
      const detail = (ev as CustomEvent<unknown>).detail;
      if (typeof detail === "number" && Number.isFinite(detail)) {
        setPermissionTimeoutSec(detail);
        return;
      }
      setPermissionTimeoutSec(loadPermissionTimeoutSec(localStorage));
    };
    window.addEventListener(PERMISSION_TIMEOUT_CHANGE_EVENT, onChange);
    return () =>
      window.removeEventListener(PERMISSION_TIMEOUT_CHANGE_EVENT, onChange);
  }, []);

  // Ask User Question auto-cancel timeout (localStorage; Settings dispatches change).
  useEffect(() => {
    const onChange = (ev: Event) => {
      const detail = (ev as CustomEvent<unknown>).detail;
      if (typeof detail === "number" && Number.isFinite(detail)) {
        setAskUserTimeoutSec(detail);
        return;
      }
      setAskUserTimeoutSec(loadAskUserTimeoutSec(localStorage));
    };
    window.addEventListener(ASK_USER_TIMEOUT_CHANGE_EVENT, onChange);
    return () =>
      window.removeEventListener(ASK_USER_TIMEOUT_CHANGE_EVENT, onChange);
  }, []);

  // Phone layout flag: mirror client + ≤820px only (desktop ≥821px unchanged).
  useEffect(() => {
    if (!isMirrorClient()) {
      setPhoneLayout(false);
      return;
    }
    const sync = () => {
      setPhoneLayout(
        isMirrorPhoneLayout({
          isMirror: true,
          viewportWidth: window.innerWidth,
        }),
      );
    };
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  // User-driven window resize only: clamp open aside. Ignore programmatic setSize
  // (isWindowFitSuppressed) so open-pane fit does not fight resize handlers.
  useEffect(() => {
    if (phoneLayout) return;
    let resizeTimer: number | null = null;
    const onResize = () => {
      if (isWindowFitSuppressed()) return;
      if (resizeTimer != null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (isWindowFitSuppressed()) return;
        const opts = asideClampOpts();
        setLayout((l) => {
          if (l.asideCollapsed) return l;
          const next = clampAsideWidth(l.asideWidth, opts);
          if (next === l.asideWidth) return l;
          const n = { ...l, asideWidth: next };
          saveLayout(localStorage, n);
          return n;
        });
      }, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (resizeTimer != null) window.clearTimeout(resizeTimer);
    };
  }, [asideClampOpts, phoneLayout]);

  // Cold start once: if panes restored open, clamp aside to the *current*
  // window only. Do NOT grow the OS window here — geometry was restored before
  // show; a post-show setSize flashes size (large↔small). Pane open handlers
  // still call fitWindowThenClampAside when the user opens a rail.
  useEffect(() => {
    if (phoneLayout || !api.isDesktopHost()) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (cancelled) return;
      const l = layoutRef.current;
      if (l.asideCollapsed) return;
      const opts = {
        ...asideClampOpts(),
        viewportWidth:
          typeof window !== "undefined" ? window.innerWidth : undefined,
        sidebarOccupiedWidth: l.sidebarCollapsed
          ? 0
          : l.sidebarWidth || SIDEBAR_DEFAULT_WIDTH,
      };
      const width = clampAsideWidth(l.asideWidth, opts);
      if (width === l.asideWidth) return;
      setLayout((prev) => {
        if (prev.asideCollapsed || prev.asideWidth === width) return prev;
        const n = { ...prev, asideWidth: width };
        saveLayout(localStorage, n);
        return n;
      });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only cold clamp
  }, [phoneLayout]);

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

  const closePhoneDrawer = useCallback(() => {
    setLayout((l) => {
      if (l.sidebarCollapsed) return l;
      const n = { ...l, sidebarCollapsed: true };
      saveLayout(localStorage, n);
      return n;
    });
  }, []);

  const openPhoneDrawer = useCallback(() => {
    setLayout((l) => {
      if (!l.sidebarCollapsed) return l;
      const n = { ...l, sidebarCollapsed: false };
      saveLayout(localStorage, n);
      return n;
    });
  }, []);

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
      setAppView("workbench");
      setMainPane("chat");
    },
    pendingAskUserBySessionRef,
    pendingPermBySessionRef,
    pendingCompactBeforeRef,
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
    setAppView("workbench");
    setMainPane("chat");
    if (typeof window !== "undefined" && window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  const navigateAutomations = useCallback(() => {
    setAppView("workbench");
    setMainPane("automations");
    setShowUserMenu(false);
    if (typeof window !== "undefined") {
      window.location.hash = "#/automations";
    }
  }, []);

  const persistOpenTarget = useCallback((target: string) => {
    setDefaultOpenTarget(target);
    try {
      localStorage.setItem("grok-app.openTarget", target);
    } catch {
      /* ignore */
    }
    void api.settingsGet().then((s) =>
      api.settingsSet({ ...s, defaultOpenTarget: target }),
    );
  }, []);

  /**
   * Open Settings at section/tab.
   * - Omit `section` (generic open: ⌘,, gear, slash /settings, tray Settings…)
   *   → restore last route when valid, else general.
   * - Explicit section always wins (palette, deep link, account, errors).
   * - Persists the resolved route to localStorage for the next generic open.
   */
  const navigateSettings = useCallback(
    (section?: SettingsSectionId | null, tab?: string | null) => {
      const loc = resolveOpenSettingsLocation({
        section: section ?? undefined,
        tab,
        last: section == null ? loadSettingsLastRoute() : null,
      });
      setSettingsSection(loc.section);
      setSettingsTab(loc.tab);
      setAppView("settings");
      setShowUserMenu(false);
      saveSettingsLastRoute(loc);
      if (typeof window !== "undefined") {
        // Phone: generic settings open lands on the section index (SettingsPage
        // starts at phonePane=index). Specific sections still set the hash so a
        // later drill-in / deep-link matches the intended section.
        const hash = buildSettingsHash({
          section: loc.section,
          tab: loc.tab,
        });
        // Avoid no-op hash writes (some webviews skip hashchange; state still set above).
        if (window.location.hash !== hash) {
          window.location.hash = hash;
        }
      }
    },
    [],
  );

  // Hash route: #/settings[/section[/tab]][?pr=N] | #/automations | #/workbench
  // Explicit #/settings/{section}… deep links always win; bare #/settings uses last.
  useEffect(() => {
    const syncFromHash = () => {
      const fullHash = window.location.hash || "";
      const raw = fullHash.replace(/^#\/?/, "");
      if (raw.startsWith("settings")) {
        const parts = raw.split("/").filter(Boolean);
        // parts[0] === "settings"; parts[1] may be section (ignore ?query)
        const sectionPart = (parts[1] ?? "").split("?")[0];
        const hasExplicitSection = isSettingsSectionId(sectionPart);
        if (hasExplicitSection) {
          const loc = parseSettingsHash(raw);
          if (loc) {
            setSettingsSection(loc.section);
            setSettingsTab(loc.tab ?? null);
            saveSettingsLastRoute(loc);
          }
          // PR hub deep link with explicit ?pr=N: highlight row + scroll to hub.
          // Bare runtime/tools (no query) must not steal focus to the PR hub card.
          const prHub = parsePrHubDeepLink(fullHash);
          if (prHub && prHub.prNumber != null) {
            setPrHubHighlightPr(prHub.prNumber);
            setSettingsFocusAnchor(PR_HUB_ANCHOR_ID);
          }
        } else {
          // Bare #/settings or unknown first segment → last route if valid.
          const last = loadSettingsLastRoute();
          const loc = resolveOpenSettingsLocation({ last });
          setSettingsSection(loc.section);
          setSettingsTab(loc.tab);
          saveSettingsLastRoute(loc);
          const hash = buildSettingsHash(loc);
          if (window.location.hash !== hash) {
            window.location.hash = hash;
          }
        }
        setAppView("settings");
      } else if (raw === "automations" || raw.startsWith("automations")) {
        setAppView("workbench");
        setMainPane("automations");
      } else if (raw === "" || raw === "workbench" || raw === "home") {
        setAppView("workbench");
        setMainPane("chat");
      }
    };
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  /**
   * Open a stored session. Loads journal immediately; warms the ACP agent in
   * the background so the first send skips cold process spawn when possible.
   */
  const openSession = async (s: SessionRow, project?: Project | null) => {
    const proj =
      project ||
      projects.find((p) => p.id === s.projectId) ||
      null;
    setMainPane("chat");
    setAppView("workbench");
    // Phone drawer: selecting a session closes the overlay (does not push layout).
    if (phoneLayout) closePhoneDrawer();

    // Leaving a new-chat page: stash composer under the project so newChat can restore.
    // Leaving a real thread: stash per-session so switching back restores the follow-up.
    const leavingBeforeOpen = viewingSessionIdRef.current;
    if (leavingBeforeOpen == null) {
      saveComposerProjectDraft(projectDraftKey(activeProject?.id ?? null), {
        text: getDraft(),
        attachments,
        goalMode,
      });
    } else {
      saveComposerSessionDraft(leavingBeforeOpen, {
        text: getDraft(),
        attachments,
        goalMode,
      });
    }

    // User navigation: invalidate any in-flight work that wants the workbench.
    bumpViewEpoch();
    // Snapshot the outgoing thread so a mid-turn switch does not lose the user bubble.
    const leavingId = leavingBeforeOpen;
    if (leavingId) {
      messagesBySessionRef.current.set(
        leavingId,
        snapshotOutgoingMessages(
          messagesBySessionRef.current.get(leavingId),
          messagesRef.current,
        ),
      );
      // Plan progress is per-session — stash bar state before switching.
      planBySessionRef.current.set(leavingId, planRef.current);
    }

    // Point viewing id immediately so late stream chunks land in the right cache.
    openingSessionIdRef.current = s.id;
    viewingSessionIdRef.current = s.id;
    // Restore this thread's follow-up draft immediately (sync localStorage) so
    // the composer matches the session before journal load, and mid-load typing
    // is attributed to the right thread on the next switch.
    {
      const saved = loadComposerSessionDraft(s.id);
      suppressProjectDraftPersistRef.current = true;
      if (saved) {
        setDraft(saved.text || "");
        setAttachments(saved.attachments ?? []);
        if (typeof saved.goalMode === "boolean") {
          setGoalMode(saved.goalMode);
        }
      } else {
        setDraft("");
        setAttachments([]);
      }
      requestAnimationFrame(() => {
        suppressProjectDraftPersistRef.current = false;
      });
    }
    // P0 (#529): immediately paint this session's cache (or empty) so stream /
    // rehydrate / clear-streaming never reduce against the previous chat while
    // viewing id has already moved. Disk load below may replace with prefer().
    {
      const early = messagesBySessionRef.current.get(s.id) ?? [];
      messagesBySessionRef.current.set(s.id, early);
      setMessages(early);
    }
    // Opening/viewing clears sidebar unread + dock/tray badge for this chat.
    applyClearSessionUnread(s.id);
    // Swap plan chrome to this session (memory cache first; Host restore below).
    setPlan(
      planBySessionRef.current.get(s.id) ??
        emptySessionPlan(trRef.current("plan.ready")),
    );
    // P1: restore plan chrome from disk + agent plan_mode.json / plan.md.
    void (async () => {
      const openId = s.id;
      try {
        const [chrome, agentSnap] = await Promise.all([
          api.sessionPlanChromeGet(openId),
          api.sessionAgentPlanSnapshot(openId),
        ]);
        if (viewingSessionIdRef.current !== openId) return;
        // Live map with a live rpcId wins over stale disk (session still warm).
        const mem = planBySessionRef.current.get(openId);
        if (mem && mem.rpcId != null) return;
        const restored = restorePlanFromPersistence(
          chrome,
          agentSnap,
          trRef.current("plan.ready"),
        );
        if (!restored.visible && !restored.userClosed && !restored.body) {
          return;
        }
        planBySessionRef.current.set(openId, restored);
        markPlanPendingBadge(openId, restored);
        if (viewingSessionIdRef.current === openId) {
          setPlan(restored);
        }
      } catch {
        /* soft-fail restore */
      }
    })();
    setEditingUserMessageId(null);
    setEditAttachments([]);
    setSessionJsonSchema(
      typeof s.jsonSchema === "string" && s.jsonSchema.trim()
        ? s.jsonSchema
        : null,
    );
    setShowJsonSchemaModal(false);

    try {
      const stored = await api.sessionMessages(s.id);
      let mapped: ChatMessage[] = mapStoredMessagesToChat(stored);
      // Short paths like `images/1.jpg` → agent session dir → image cards
      if (api.isTauri()) {
        const rels = collectSessionRelativeMediaRefs(mapped);
        if (rels.length) {
          try {
            const list = await api.sessionResolveRelativeMedia(s.id, rels);
            if (list.length) {
              mapped = applyResolvedSessionMedia(
                mapped,
                list.map((a) => ({
                  path: a.path,
                  name:
                    a.name || a.path.split(/[/\\]/).pop() || a.path,
                  isDir: !!a.isDir,
                })),
              );
            }
          } catch {
            /* ignore */
          }
        }
      }
      // Prefer in-memory cache (optimistic user msg + partial stream) over disk.
      // Weave journal tool_step rows into preceding assistant segments so reload
      // still shows tools on the message timeline (live already interleaves).
      let chosen = weaveToolsIntoAssistantSegments(
        preferSessionMessages(
          messagesBySessionRef.current.get(s.id),
          mapped,
        ),
      );
      // Grant path_scope + refine isDir before first paint so history
      // thumbnails (Desktop/Downloads drops, etc.) do not flash broken.
      // Drop false extracts / missing local files so dead paperclip thumbs
      // never paint (https media always kept).
      const allPaths = chosen.flatMap(
        (m) => m.attachments?.map((a) => a.path) ?? [],
      );
      if (allPaths.length && api.isTauri()) {
        try {
          const list = await api.pathsClassify(allPaths);
          if (list.length) {
            const byPath = new Map(list.map((c) => [c.path, c]));
            chosen = chosen.map((msg) => {
              if (!msg.attachments?.length) return msg;
              const nextAtts = msg.attachments
                .map((a) => {
                  if (!isDisplayableAttachmentPath(a.path)) return null;
                  const remote = /^https?:\/\//i.test(a.path);
                  const c = byPath.get(a.path);
                  if (remote) {
                    return c
                      ? { path: c.path, name: c.name, isDir: c.isDir }
                      : a;
                  }
                  // Local: require exists after classify (also grants path_scope).
                  if (c && !c.exists) return null;
                  return c
                    ? { path: c.path, name: c.name, isDir: c.isDir }
                    : a;
                })
                .filter((a): a is NonNullable<typeof a> => a != null);
              return {
                ...msg,
                attachments: nextAtts.length ? nextAtts : undefined,
              };
            });
          }
        } catch {
          /* classify is best-effort — still drop known false extracts */
          chosen = chosen.map((msg) => {
            if (!msg.attachments?.length) return msg;
            const nextAtts = msg.attachments.filter((a) =>
              isDisplayableAttachmentPath(a.path),
            );
            return {
              ...msg,
              attachments: nextAtts.length ? nextAtts : undefined,
            };
          });
        }
      } else if (allPaths.length) {
        chosen = chosen.map((msg) => {
          if (!msg.attachments?.length) return msg;
          const nextAtts = msg.attachments.filter((a) =>
            isDisplayableAttachmentPath(a.path),
          );
          return {
            ...msg,
            attachments: nextAtts.length ? nextAtts : undefined,
          };
        });
      }
      if (viewingSessionIdRef.current !== s.id) {
        // User switched again while we were loading — keep cache warm, skip UI write.
        messagesBySessionRef.current.set(s.id, chosen);
        if (openingSessionIdRef.current === s.id) {
          openingSessionIdRef.current = null;
        }
        return;
      }
      // Cache raw journal (may include fences) so apply can read them.
      messagesBySessionRef.current.set(s.id, chosen);
      // Rebuild Changes list from tool_step history; preserve live before/after.
      {
        const fromHist = sessionChangesFromMessages(chosen);
        setSessionChangesById((prev) => {
          const existing = prev[s.id] ?? [];
          let list = fromHist;
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
          return { ...prev, [s.id]: list };
        });
      }
      const stripped = chosen.map((m) => {
        if (m.role !== "assistant" || !m.content) return m;
        const { cleanText } = extractAutomationPayload(m.content);
        return cleanText === m.content ? m : { ...m, content: cleanText };
      });
      setMessages(stripped);
      setContextUsage(restoreContextUsageForSession(s.id, stripped));
      // Backfill create if assistant still has a fence in journal (failed chat-create).
      void tryApplyAutomationFromSession(s.id);
      // Backfill scheduled flag from journal (older automation sessions).
      if (
        !s.scheduled &&
        chosen.some(
          (m) =>
            m.role === "user" && !!parseScheduledUserContent(m.content || ""),
        )
      ) {
        setSessions((list) =>
          list.map((row) =>
            row.id === s.id ? { ...row, scheduled: true } : row,
          ),
        );
        if (api.isTauri()) {
          void api.sessionSetScheduled(s.id, true).catch(() => {});
        }
      }
    } catch {
      if (viewingSessionIdRef.current !== s.id) {
        if (openingSessionIdRef.current === s.id) {
          openingSessionIdRef.current = null;
        }
        return;
      }
      const cached = messagesBySessionRef.current.get(s.id);
      setMessages(cached ?? []);
      setContextUsage(restoreContextUsageForSession(s.id, cached ?? []));
    }
    if (viewingSessionIdRef.current !== s.id) {
      if (openingSessionIdRef.current === s.id) {
        openingSessionIdRef.current = null;
      }
      return;
    }
    // Orphan sessions clear project context; project sessions select their folder.
    setActiveProject(proj);
    // Composer follow-up draft was restored at switch time (per-session buffer).
    // Reattach live host snapshot when reopening the session that is still running.
    const live = liveHostRef.current;
    if (live.sessionId === s.id) {
      setSession({
        ...live,
        title: s.title || live.title || "Untitled",
      });
    } else {
      // A chat demoted to background is still running: re-attach its state so
      // the thread shows the spinner / streaming bubble instead of looking done.
      const resume = resumeStateForSession(s.id, live, liveMapRef.current);
      setSession({
        ...IDLE_SNAPSHOT,
        sessionId: s.id,
        title: s.title || "Untitled",
        state: resume.state,
        streamingMessageId: resume.streamingMessageId,
        backend: "grok_agent_stdio",
      });
    }
    if (openingSessionIdRef.current === s.id) {
      openingSessionIdRef.current = null;
    }
    setLocalError(null);
    // Gates are session-scoped: restore any unanswered request for this chat
    // (it may have been raised while demoted to background), else clear chrome.
    setPerm(pendingPermBySessionRef.current.get(s.id) ?? null);
    setAskUser(pendingAskUserBySessionRef.current.get(s.id) ?? null);
    if (live.sessionId !== s.id) {
      setRetryStatus(null);
    }

    // Secondary windows must not rewrite "last session" for the main workbench.
    if (api.isTauri() && !isSecondaryWindowRef.current) {
      setLastSessionId(s.id);
      void api
        .settingsRememberLastSession(s.id, proj?.id ?? null)
        .catch(() => {});
    }

    // Warm ACP: connect while the user reads history (trusted project or orphan).
    // Host serializes connect; first send no-ops if already ready.
    //
    // Multi-session (main): if *another* session is mid-turn, defer warm-connect
    // so browsing does not thrash demote/spawn. Secondary windows exist for
    // concurrent work — Host session-keyed pool keeps foreign busy turns in
    // background (never kills), so secondary may warm-connect immediately.
    // The next send still runs ensureConnected if warm was deferred.
    // Skip when project folder is missing (D05) — user must relocate first.
    if (shouldSkipWarmConnect(isSecondaryWindowRef.current)) {
      return;
    }
    const foreignBusy =
      Object.entries(getLiveMap()).some(
        ([id, snap]) =>
          id !== s.id &&
          (snap.state === "streaming" || snap.state === "awaiting_permission"),
      ) ||
      (!!live.sessionId &&
        live.sessionId !== s.id &&
        isSessionLiveStreaming(live.state));
    const deferForeign = shouldDeferWarmConnectForForeignBusy({
      isSecondaryWindow: isSecondaryWindowRef.current,
      foreignBusy,
    });
    // Also defer while a send / connect is in flight: warm-connecting mid-send
    // used to steal the live slot from the turn being dispatched.
    if (
      api.isTauri() &&
      !deferForeign &&
      !sendInFlightRef.current &&
      !connectingRef.current &&
      (!proj || (proj.trusted && !isProjectPathMissing(proj.pathOk))) &&
      !(live.sessionId === s.id && live.state === "ready")
    ) {
      const warmId = s.id;
      void (async () => {
        if (viewingSessionIdRef.current !== warmId) return;
        if (sendInFlightRef.current || connectingRef.current) return;
        if (shouldSkipWarmConnect(isSecondaryWindowRef.current)) return;
        try {
          const snap = await api.sessionConnect({
            projectPath:
              proj?.path || generalWorkspacePath || undefined,
            sessionId: warmId,
          });
          if (viewingSessionIdRef.current !== warmId) return;
          setLiveHost(snap);
          liveHostRef.current = snap;
          if (snap.sessionId === warmId) {
            setSession((prev) => ({
              ...snap,
              title: prev.title || s.title || snap.title || "Untitled",
            }));
          }
          if (snap.lastError && snap.state !== "ready") {
            // Soft: keep chat readable; send will retry via ensureConnected.
            console.warn(
              "warm connect:",
              snap.lastError.code,
              snap.lastError.message,
            );
          }
        } catch (e) {
          console.warn("warm connect failed", e);
        }
      })();
    }
  };

  const openSessionRef = useRef(openSession);
  openSessionRef.current = openSession;

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
      } else if (saved) {
        setDraft(saved.text || "");
        setAttachments(saved.attachments ?? []);
        if (typeof saved.goalMode === "boolean") {
          setGoalMode(saved.goalMode);
        }
      } else {
        setDraft("");
        setAttachments([]);
      }
      // Allow debounced persist again after React commits the load.
      requestAnimationFrame(() => {
        suppressProjectDraftPersistRef.current = false;
      });
    },
    [],
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
  }, [attachments, goalMode, activeProject?.id, session.sessionId]);

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
  }, [attachments, goalMode, session.sessionId]);

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
        applyComposerProjectDraft(
          loadComposerProjectDraft(projectDraftKey(activeProject?.id ?? null)),
        );
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
      applyComposerProjectDraft(
        loadComposerProjectDraft(projectDraftKey(activeProject?.id ?? null)),
      );
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
    tr,
    secondaryFocusSessionId,
    isSecondaryWindow,
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
    window.setTimeout(() => tryFocus(12), 0);
  }, []);

  /**
   * Draft new chat (Codex-style): clear UI only.
   * No store row / CLI until first successful send via ensureConnected.
   * Pass `null` for a project-less session (listed under “其他会话”).
   * Omit / pass undefined to use the active project (requires one).
   *
   * Composer text/attachments: leaving a real thread stashes per-session
   * follow-ups; the new-chat page restores the per-project buffer so a
   * half-typed new task survives switching away and back.
   */
  const newChat = async (
    project?: Project | null,
    opts?: {
      seedDraft?: string;
      switchToChat?: boolean;
      /** Enter conversation-driven scheduled-task setup mode. */
      automationSetup?: boolean;
    },
  ) => {
    // Explicit null → orphan; undefined → keep active project when set,
    // otherwise orphan draft (no forced "pick a project first").
    const proj = project === undefined ? activeProject : project;
    if (proj && !proj.trusted) {
      setLocalError(tr("project.trustFirst", { name: proj.name }));
      return;
    }
    if (proj && isProjectPathMissing(proj.pathOk)) {
      setLocalError(tr("project.pathMissing", { name: proj.name }));
      return;
    }

    // Snapshot outgoing composer: new-chat → per-project; real thread → per-session.
    const prevKey = projectDraftKey(activeProject?.id ?? null);
    const wasDraftPage = viewingSessionIdRef.current == null;
    const leavingId = viewingSessionIdRef.current;
    if (wasDraftPage) {
      saveComposerProjectDraft(prevKey, {
        text: getDraft(),
        attachments,
        goalMode,
      });
    } else if (leavingId) {
      saveComposerSessionDraft(leavingId, {
        text: getDraft(),
        attachments,
        goalMode,
      });
    }

    automationSetupDraftRef.current = !!opts?.automationSetup;
    if (opts?.switchToChat !== false) {
      setMainPane("chat");
      setAppView("workbench");
    }
    if (phoneLayout) closePhoneDrawer();
    setActiveProject(proj);
    if (proj) {
      setExpandedProjects((e) => ({ ...e, [proj.id]: true }));
    } else {
      setHistoryOpen(true);
    }
    // User navigation: a connect/send still in flight for the previous chat must
    // not drag the workbench back here once it resolves.
    bumpViewEpoch();
    // Preserve outgoing thread in cache before clearing the draft UI.
    // Always snapshot current messages (not only if already cached) so a mid-send
    // switch does not drop the optimistic user/assistant bubbles.
    if (leavingId) {
      messagesBySessionRef.current.set(
        leavingId,
        snapshotOutgoingMessages(
          messagesBySessionRef.current.get(leavingId),
          messagesRef.current,
        ),
      );
      planBySessionRef.current.set(leavingId, planRef.current);
    }
    viewingSessionIdRef.current = null;
    setMessages([]);
    setContextUsage(INITIAL_CONTEXT_USAGE);

    const nextKey = projectDraftKey(proj?.id ?? null);
    if (opts?.seedDraft != null) {
      applyComposerProjectDraft(null, opts.seedDraft);
      // Explicit seed replaces the saved buffer for this project.
      saveComposerProjectDraft(nextKey, {
        text: opts.seedDraft,
        attachments: [],
        goalMode,
      });
    } else {
      applyComposerProjectDraft(loadComposerProjectDraft(nextKey));
    }

    sendQueue.clearDraftQueue();
    setPlan(emptySessionPlan(tr("plan.ready")));
    setPerm(null);
    setAskUser(null);
    setRetryStatus(null);
    setSessionJsonSchema(null);
    setShowJsonSchemaModal(false);
    setSession({
      ...IDLE_SNAPSHOT,
      sessionId: null,
      title: tr("session.new"),
      state: "idle",
      backend: "grok_agent_stdio",
    });
    setLocalError(null);
    // Multi-session: NEVER sessionDisconnect here.
    // Disconnect kills the live ACP process — that aborted in-flight turns when
    // users hit "new chat" right after send (sessions with agentSessionId but
    // empty journals). Leave liveHost as-is so Host keeps executing; the next
    // send on this draft will demote+spawn via ensureConnected.
    const prevLive = liveHostRef.current;
    if (
      prevLive.sessionId &&
      isSessionLiveStreaming(prevLive.state)
    ) {
      setLiveMap((prev) =>
        projectHostIntoLiveMap(prev, {
          sessionId: prevLive.sessionId,
          state: prevLive.state,
          streamingMessageId: prevLive.streamingMessageId,
        }),
      );
    }
    // Focus explicitly — do not rely only on useEffect: after await, effects may
    // already have run, and identical draft/sessionId can skip a re-render.
    requestComposerFocus();
    // Entering new-chat view: prewarm a CLI process (spawn+init+auth, no
    // session, no project binding) so the first send is near-instant. The host
    // skips when a warm process already exists. Never awaited.
    api.sessionPrewarm();
  };

  const sessionsForProject = (projectId: string) =>
    sessions.filter((s) => s.projectId === projectId && !s.archived);

  const orphanSessions = sessions.filter(
    (s) =>
      (!s.projectId || !projects.some((p) => p.id === s.projectId)) &&
      !s.archived,
  );
  const orphanSessionIds = orphanSessions.map((s) => s.id);
  const orphanAllSelected = areAllIdsSelected(
    selectedSessionIds,
    orphanSessionIds,
  );

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

  /**
   * Full multi-select order (all projects + orphans), independent of expand/collapse.
   * Shift+click range uses this so contiguous select matches tree order.
   */
  const sidebarSelectOrderIds = useMemo(() => {
    const ids: string[] = [];
    const projectIdSet = new Set(projects.map((p) => p.id));
    for (const proj of projects) {
      const projSessions = sessions.filter(
        (s) => s.projectId === proj.id && !s.archived,
      );
      for (const s of sortSessionsForSidebar(projSessions)) ids.push(s.id);
    }
    const orphans = sessions.filter(
      (s) =>
        (!s.projectId || !projectIdSet.has(s.projectId)) && !s.archived,
    );
    for (const s of sortSessionsForSidebar(orphans)) ids.push(s.id);
    return ids;
  }, [projects, sessions]);
  sidebarSelectOrderIdsRef.current = sidebarSelectOrderIds;

  /** Active (non-archived) session ids visible in the sidebar tree. */
  const selectableSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of sessions) {
      if (!s.archived) ids.add(s.id);
    }
    return ids;
  }, [sessions]);
  const selectableSessionCount = selectableSessionIds.size;

  // Drop selection for sessions that left the active list.
  useEffect(() => {
    setSelectedSessionIds((prev) => pruneSelectedIds(prev, selectableSessionIds));
    const anchor = sessionSelectAnchorIdRef.current;
    if (anchor && !selectableSessionIds.has(anchor)) {
      sessionSelectAnchorIdRef.current = null;
    }
  }, [selectableSessionIds]);

  const exitSessionSelectMode = useCallback(() => {
    setSessionSelectMode(false);
    setSelectedSessionIds(new Set());
    sessionSelectAnchorIdRef.current = null;
  }, []);

  const enterSessionSelectMode = useCallback(() => {
    setSessionSelectMode(true);
    setSelectedSessionIds(new Set());
    sessionSelectAnchorIdRef.current = null;
  }, []);

  const toggleSessionSelected = useCallback(
    (id: string, opts?: { shiftKey?: boolean }) => {
      if (opts?.shiftKey) {
        const anchor = sessionSelectAnchorIdRef.current;
        if (anchor) {
          const range = rangeIdsInclusive(
            sidebarSelectOrderIdsRef.current,
            anchor,
            id,
          );
          if (range.length > 0) {
            setSelectedSessionIds((prev) => addIdsToSet(prev, range));
            return;
          }
        }
        // No usable anchor — fall through to a normal select of the target.
        setSelectedSessionIds((prev) => addIdsToSet(prev, [id]));
        sessionSelectAnchorIdRef.current = id;
        return;
      }
      setSelectedSessionIds((prev) => toggleIdInSet(prev, id));
      sessionSelectAnchorIdRef.current = id;
    },
    [],
  );

  /** Project / “Other sessions” group: select all under the folder, or clear that group. */
  const toggleSessionsSelected = useCallback((ids: readonly string[]) => {
    if (ids.length === 0) return;
    setSelectedSessionIds((prev) => {
      const next = toggleIdsInSet(prev, ids);
      // Keep Shift range coherent: after group select, anchor at the last id.
      if (areAllIdsSelected(next, ids)) {
        sessionSelectAnchorIdRef.current = ids[ids.length - 1] ?? null;
      }
      return next;
    });
  }, []);

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

  const refreshSessions = async () => {
    try {
      const list = await api.sessionsList();
      setSessions(list.map(mapSessionListRow));
      setSessions(list.map((s) => mapSessionListRow(s)));
      void api.trayRefresh();
    } catch {
      /* ignore */
    }
  };

  /**
   * Cross-device sessions-index sync (DESIGN §7.3 fanout).
   *
   * The host emits `sessions://changed` whenever a *mirror* client mutates the
   * index (session.create / rename / autoTitle). Desktop mutations already
   * refresh in-process, so this only adds the missing direction: a chat started
   * on the phone shows up in the desktop window — and in any other phone — with
   * no manual refresh. Coalesced so a burst reloads the list once.
   */
  const refreshSessionsRef = useRef(refreshSessions);
  refreshSessionsRef.current = refreshSessions;
  useEffect(() => {
    if (!api.hasHost()) return;
    let cancelled = false;
    let timer: number | null = null;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const un = await api.listen<{ reason?: string; sessionId?: string }>(
        "sessions://changed",
        () => {
          if (cancelled) return;
          if (timer !== null) window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            timer = null;
            void refreshSessionsRef.current();
          }, 150);
        },
      );
      if (cancelled) un();
      else unlisten = un;
    })();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      unlisten?.();
    };
  }, []);

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
        setAppView("workbench");
        setActiveProject(proj);
        if (proj) {
          setExpandedProjects((e) => ({ ...e, [proj.id]: true }));
        } else {
          setHistoryOpen(true);
        }
        openingSessionIdRef.current = null;
        bumpViewEpoch();
        viewingSessionIdRef.current = null;
        setMessages([]);
        setAttachments([]);
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
      // ChatCut editor handoff → side Resources browser (Codex parity).
      // Billing/pricing stays system browser.
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
      const doOpen = () => {
        if (api.isTauri()) {
          void api.openExternalUrl(url).catch((e) => {
            console.error("[chat] openExternalUrl failed", e);
            // Fallback for hosts that reject shell open.
            try {
              window.open(url, "_blank", "noopener,noreferrer");
            } catch {
              /* ignore */
            }
          });
        } else {
          window.open(url, "_blank", "noopener,noreferrer");
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

  const renameSession = (s: SessionRow) => {
    setCtxMenu(null);
    setAppDialog({
      kind: "prompt",
      title: tr("session.renamePrompt"),
      initial: s.title || tr("session.untitled"),
      placeholder: tr("session.renamePlaceholder"),
      onSubmit: async (title) => {
        const next = title.trim();
        if (!next) return;
        try {
          await api.sessionRename(s.id, next);
          applySessionTitle(s.id, next);
          await refreshSessions();
        } catch (e) {
          setLocalError(String(e));
        }
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

  // Any path that binds the workbench to a session clears its unread marker
  // (sidebar + dock/tray badge). Covers openSession, deep links, tray Recent.
  // Also ends a manual "mark as unread" hold when the user re-opens the chat.
  useEffect(() => {
    if (session.sessionId) {
      manualUnreadHoldIdsRef.current.delete(session.sessionId);
      applyClearSessionUnread(session.sessionId);
    }
  }, [session.sessionId, applyClearSessionUnread]);

  // Dock/taskbar or OS focus while already on a finished chat: clear that
  // session's unread so the badge decrements without re-clicking the row.
  useEffect(() => {
    const clearViewingIfPresent = () => {
      const id = viewingSessionIdRef.current;
      if (!id) return;
      // Keep manual "mark as unread" until the user leaves this thread.
      if (manualUnreadHoldIdsRef.current.has(id)) return;
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

  const searchHits = useMemo(
    () =>
      filterSessionSearch(
        searchQuery,
        sessions.map((s) => ({
          id: s.id,
          title: s.title,
          projectId: s.projectId,
          archived: s.archived,
        })),
        projects.map((p) => ({ id: p.id, name: p.name, path: p.path })),
        {
          includeArchived: searchIncludeArchived,
          mode: searchMode,
          rankMode: searchRankMode,
        },
      ),
    [searchQuery, sessions, projects, searchIncludeArchived, searchMode, searchRankMode],
  );

  const mergedSessionHits = useMemo(
    () =>
      mergeSessionSearchHits(
        searchQuery,
        searchHits.matchedSessions,
        contentSearchHits,
        {
          includeArchived: searchIncludeArchived,
          mode: searchMode,
          rankMode: searchRankMode,
        },
      ),
    [
      searchQuery,
      searchHits.matchedSessions,
      contentSearchHits,
      searchIncludeArchived,
      searchMode,
      searchRankMode,
    ],
  );

  const paletteActionHits = useMemo(
    () => filterPaletteActions(searchQuery, defaultPaletteActions(), tr),
    [searchQuery, tr],
  );

  const searchEmptyState = useMemo(
    () =>
      resolveSessionSearchEmptyState({
        query: searchQuery,
        sessionHitCount: mergedSessionHits.length,
        contentLoading: contentSearchLoading,
        mode: searchMode,
        includeArchived: searchIncludeArchived,
        rankMode: searchRankMode,
      }),
    [
      searchQuery,
      mergedSessionHits.length,
      contentSearchLoading,
      searchMode,
      searchIncludeArchived,
      searchRankMode,
    ],
  );

  const searchFiltersActive = useMemo(
    () =>
      hasActiveSessionSearchFilters({
        mode: searchMode,
        includeArchived: searchIncludeArchived,
      }),
    [searchMode, searchIncludeArchived],
  );

  const applySearchMode = useCallback((mode: SessionSearchMode) => {
    setSearchMode(mode);
    saveSessionSearchFilterPref({ mode });
  }, []);

  const applySearchIncludeArchived = useCallback((includeArchived: boolean) => {
    setSearchIncludeArchived(includeArchived);
    saveSessionSearchFilterPref({ includeArchived });
  }, []);

  const clearSearchFilters = useCallback(() => {
    const next = clearSessionSearchFilters();
    setSearchMode(next.mode);
    setSearchIncludeArchived(next.includeArchived);
    saveSessionSearchFilterPref(next);
  }, []);

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
  const connPill = useMemo(
    () => connPillForState(session.state, connecting),
    [session.state, connecting],
  );

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

  /**
   * Ensure app session row + silent CLI connect.
   * Creates store session only on first send (draft → real).
   * Reconnects when disconnected / crashed. Pass force to tear down a "ready"
   * session that may be wedged (e.g. after a timeout).
   * Returns the live session id when ready, else null.
   *
   * Prefer `opts.sessionId` (e.g. queue flush target) over the render-time
   * `session` closure so connect never binds the wrong chat after a switch.
   *
   * Does not yank the UI if the user already switched to another session while
   * connect is in flight; still updates liveHost so the sidebar spinner tracks work.
   */
  const ensureConnected = async (
    forceOrOpts:
      | boolean
      | { force?: boolean; sessionId?: string | null } = false,
  ): Promise<string | null> => {
    // Session-keyed pool: secondary may connect when the user sends (shared Host).
    if (!canLiveParticipate(isSecondaryWindowRef.current)) {
      return null;
    }
    const opts =
      typeof forceOrOpts === "boolean"
        ? { force: forceOrOpts, sessionId: undefined as string | null | undefined }
        : forceOrOpts;
    const force = !!opts.force;
    // Explicit target wins; else the session this render is bound to.
    const preferredId =
      opts.sessionId !== undefined ? opts.sessionId : session.sessionId;

    // Bound project when set; unbound chats use general workspace cwd on Host.
    const connectProject =
      activeProject && !isGeneralProject(activeProject) ? activeProject : null;
    if (connectProject && !connectProject.trusted) {
      setLocalError(
        tr("project.trustFirst", {
          name: projectDisplayName(connectProject, tr),
        }),
      );
      return null;
    }
    if (connectProject && isProjectPathMissing(connectProject.pathOk)) {
      setLocalError(
        tr("project.pathMissing", {
          name: projectDisplayName(connectProject, tr),
        }),
      );
      return null;
    }
    // Fast path: already ready on the *preferred* session (not merely "any" ready).
    if (
      !force &&
      preferredId &&
      session.sessionId === preferredId &&
      session.state === "ready" &&
      !session.lastError
    ) {
      return preferredId;
    }
    // Live host may already be on the target even if viewed session differs.
    if (!force && preferredId) {
      const live = liveHostRef.current;
      if (
        live.sessionId === preferredId &&
        live.state === "ready" &&
        !live.lastError
      ) {
        return preferredId;
      }
    }
    // Serialize connects with a ref so two rapid sends cannot both pass a stale
    // `connecting` state check (React setState is async).
    if (connectingRef.current) {
      // Another connect is in flight — do not drop the caller's send. Wait briefly
      // for the in-flight connect if it targets the same preferred session.
      const waitStart = Date.now();
      while (connectingRef.current && Date.now() - waitStart < 120_000) {
        await new Promise((r) => setTimeout(r, 50));
        const live = liveHostRef.current;
        if (
          preferredId &&
          live.sessionId === preferredId &&
          live.state === "ready" &&
          !live.lastError
        ) {
          return preferredId;
        }
      }
      if (connectingRef.current) return null;
    }
    connectingRef.current = true;
    setConnecting(true);
    // Capture view identity before awaits. Drafts are all `null`, so the epoch
    // is what distinguishes "still on my draft" from "user opened a new one".
    const originView = currentViewFocus();
    try {
      let sessionId = preferredId ?? null;
      // First send: materialize draft into a real session (project or orphan).
      // `hasHost`, not `isTauri`: phone mirror clients have a backend too and
      // `session.create` is on the mirror allowlist — otherwise phone chats are
      // never persisted (connect runs with sessionId undefined).
      if (!sessionId && api.hasHost()) {
        const meta = (await api.sessionCreate(
          connectProject?.id,
          tr("session.new"),
        )) as { id: string; title?: string };
        sessionId = meta.id;
        // Persist draft-page JSON Schema onto the new session before connect
        // so spawn can take top-level `grok --json-schema`.
        const pendingSchema = sessionJsonSchemaRef.current?.trim() || "";
        if (
          pendingSchema &&
          isActiveJsonSchema(pendingSchema) &&
          api.isTauri()
        ) {
          try {
            const saved = await api.sessionSetJsonSchema(
              meta.id,
              pendingSchema,
            );
            const next =
              typeof saved.jsonSchema === "string" && saved.jsonSchema.trim()
                ? saved.jsonSchema
                : pendingSchema;
            setSessionJsonSchema(next);
          } catch {
            /* best-effort; prompt wrap still applies */
          }
        }
        // Bind draft messages cache to the new id (was under null / unkeyed).
        const draftMsgs = messagesBySessionRef.current.get("__draft__");
        if (draftMsgs?.length) {
          messagesBySessionRef.current.set(meta.id, draftMsgs);
          messagesBySessionRef.current.delete("__draft__");
        }
        // Auto-tag worktree-bound chats when cwd is a linked worktree.
        if (api.isTauri() && connectProject?.path) {
          const linked = resolveSessionWorktreeBadge(
            null,
            connectProject.path,
            gitWorktrees,
          );
          if (linked?.path) {
            try {
              await api.sessionSetWorktree(meta.id, {
                worktreePath: linked.path,
                worktreeBranch: linked.branch,
              });
            } catch {
              /* soft-fail */
            }
          }
        }
        // Only take over the workbench if the user has not navigated since.
        // `viewingSessionIdRef.current === null` used to pass here, which is how
        // opening a new chat in another project got yanked back to this one.
        if (shouldAdoptView(originView, currentViewFocus(), meta.id)) {
          viewingSessionIdRef.current = meta.id;
          setSession((prev) => ({
            ...prev,
            sessionId: meta.id,
            title: meta.title || tr("session.new"),
          }));
          // Sidebar reveal belongs to the takeover — never re-expand a project
          // the user has already navigated away from.
          if (connectProject) {
            setActiveProject((prev) => prev ?? connectProject);
            setExpandedProjects((e) => ({
              ...e,
              [connectProject.id]: true,
            }));
          } else {
            setHistoryOpen(true);
          }
        }
        await refreshSessions();
      }
      const snap = await api.sessionConnect({
        // Host falls back to workspaces/general when path is omitted.
        projectPath: connectProject?.path || generalWorkspacePath || undefined,
        sessionId: sessionId ?? undefined,
        mode,
      });
      setLiveHost(snap);
      liveHostRef.current = snap;
      // Only rebind the viewed session when the user is still on it (or has not
      // navigated since this connect started).
      if (
        snap.sessionId &&
        shouldAdoptView(originView, currentViewFocus(), snap.sessionId)
      ) {
        viewingSessionIdRef.current = snap.sessionId;
        setSession((prev) => ({
          ...snap,
          state: reconcileSessionState(snap.state, prev.state),
        }));
        setLiveMap((prev) =>
          projectHostIntoLiveMap(prev, {
            sessionId: snap.sessionId,
            state: snap.state,
            streamingMessageId: snap.streamingMessageId,
          }),
        );
      }
      if (snap.lastError || snap.state !== "ready") {
        const code = snap.lastError?.code ?? "AGENT_CRASHED";
        const msg = snap.lastError?.message ?? "connect failed";
        if (viewingSessionIdRef.current === (snap.sessionId || sessionId)) {
          setLocalError(`${code}: ${msg}`);
        }
        return null;
      }
      if (viewingSessionIdRef.current === (snap.sessionId || sessionId)) {
        setLocalError(null);
      }
      // Always return the connected id even if the user switched away mid-connect
      // so executeSend can still sessionSend for the original target.
      return snap.sessionId || sessionId || null;
    } catch (e) {
      // Only surface the error on the view that asked for the connect.
      if (
        (preferredId != null && viewingSessionIdRef.current === preferredId) ||
        isSameView(originView, currentViewFocus())
      ) {
        setLocalError(String(e));
      }
      return null;
    } finally {
      connectingRef.current = false;
      setConnecting(false);
    }
  };

  /**
   * `/compact [note]` — richer compact dialog:
   * presets (light/standard/aggressive as note templates; CLI has no intensity flag),
   * optional keep-note, current usage + honest after estimate when tokens known.
   * Empty note → `/compact`; non-empty → `/compact {note}`.
   * Never uses window.prompt (unreliable in Tauri WebView).
   */
  const openCompactWithNote = () => {
    setCompactPreset(DEFAULT_COMPACT_PRESET);
    setCompactNote(tr("slash.compactPresetNote.standard"));
    setShowCompactModal(true);
  };

  const compactPresetNote = (id: CompactPresetId): string => {
    if (id === "light") return tr("slash.compactPresetNote.light");
    if (id === "aggressive") return tr("slash.compactPresetNote.aggressive");
    return tr("slash.compactPresetNote.standard");
  };

  const selectCompactPreset = (id: CompactPresetId) => {
    setCompactPreset(id);
    setCompactNote(compactPresetNote(id));
  };

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

  const lastUserMessageId = transcriptMeta.lastUserId;

  // Streaming perf mode — cheapen wallpaper/glass on integrated GPU Retina.
  useEffect(() => {
    const on =
      session.state === "streaming" ||
      session.state === "awaiting_permission" ||
      transcriptMeta.hasStreamingAssistant;
    document.documentElement.dataset.streamPerf = on ? "1" : "0";
    return () => {
      document.documentElement.dataset.streamPerf = "0";
    };
  }, [session.state, transcriptMeta.hasStreamingAssistant]);

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

  /**
   * Dispatch one user turn (optimistic UI + connect + session_send).
   * @param targetSessionId When set (queue flush), bind optimistic UI to this id.
   * @param fromQueue Drop user+assistant on failure so requeue does not duplicate.
   */
  const executeSend = async (opts: {
    storedDisplay: string;
    att: Attachment[];
    goalMode: boolean;
    fromQueue?: boolean;
    targetSessionId?: string | null;
  }): Promise<boolean> => {
    // Session-keyed pool: secondary may send via shared Host (session-targeted).
    if (!canLiveParticipate(isSecondaryWindowRef.current)) {
      setLocalError(tr("session.secondaryLiveBanner"));
      return false;
    }
    if (sendInFlightRef.current) return false;
    sendInFlightRef.current = true;
    const { storedDisplay, att, goalMode: useGoal, fromQueue } = opts;
    const segments = parseStoredContent(storedDisplay);
    if (isDraftEmpty(segments) && !att.length) {
      sendInFlightRef.current = false;
      return false;
    }
    const sendTargetId =
      opts.targetSessionId !== undefined
        ? opts.targetSessionId
        : session.sessionId;
    const cacheKey = sendTargetId ?? "__draft__";
    // Draft sends have no id to compare, so pin them to the view they came from:
    // otherwise the optimistic bubbles / streaming state paint whatever *new*
    // draft the user opened in the meantime.
    const originView = currentViewFocus();
    const viewingTarget = () =>
      isViewingSendTarget(originView, currentViewFocus(), sendTargetId);

    const agentBody = serializeForAgent(segments, { goalMode: useGoal });
    let agentText = buildAgentPrompt(agentBody, att);
    const schemaForSend = sessionJsonSchemaRef.current?.trim() || "";
    if (schemaForSend && isActiveJsonSchema(schemaForSend)) {
      agentText = wrapAgentTextWithJsonSchema(agentText, schemaForSend);
    }
    const scheduleIntent = looksLikeScheduleIntent(agentText);
    const inAutomationSetup =
      automationSetupDraftRef.current ||
      scheduleIntent ||
      (!!sendTargetId &&
        automationSetupSessionsRef.current.has(sendTargetId));
    if (inAutomationSetup) {
      agentText = wrapAutomationSetupAgentText(agentText);
    }
    const titleSeed =
      serializeForAgent(segments).replace(/\n/g, " ").trim() ||
      att.map((a) => a.name).join(", ");
    const shouldAutoTitle =
      isPlaceholderTitle(session.title) || !sendTargetId;
    const ts = Date.now();
    const userMessageId = `u-${ts}`;
    const pendingAssistantId = `a-pending-${ts}`;
    const dropIds = fromQueue
      ? new Set([userMessageId, pendingAssistantId])
      : new Set([pendingAssistantId]);
    const stripOptimistic = (m: ChatMessage[]) =>
      m.filter((x) => !dropIds.has(x.id));

    if (editingUserMessageId) {
      setEditingUserMessageId(null);
      setEditAttachments([]);
    }

    if (viewingTarget()) setRetryStatus(null);
    const nowIso = new Date().toISOString();
    const appendOptimistic = (m: ChatMessage[]): ChatMessage[] => {
      const cleaned = clearPriorTurnStreaming(m);
      return [
        ...cleaned,
        {
          id: userMessageId,
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
        },
      ];
    };
    if (sendTargetId) {
      patchSessionMessages(sendTargetId, appendOptimistic);
    } else if (viewingTarget()) {
      setMessages((m) => {
        const next = appendOptimistic(m);
        messagesBySessionRef.current.set(cacheKey, next);
        return next;
      });
    } else {
      const prev = messagesBySessionRef.current.get(cacheKey) ?? [];
      messagesBySessionRef.current.set(cacheKey, appendOptimistic(prev));
    }
    if (viewingTarget()) {
      setSession((prev) =>
        prev.state === "streaming" || prev.state === "awaiting_permission"
          ? prev
          : { ...prev, state: "streaming", lastError: null },
      );
      setTurnStartedAt(Date.now());
    }
    // Optimistic liveHost only when we already own the live slot (or nothing is live).
    // Never stamp streaming onto a foreign mid-turn — ensureConnected demotes first.
    setLiveHost((prev) => {
      if (prev.sessionId) {
        if (sendTargetId && prev.sessionId !== sendTargetId) return prev;
        // Draft / null target while another session is live → leave Host alone.
        if (!sendTargetId && prev.sessionId) return prev;
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

    const failStrip = () => {
      if (sendTargetId) {
        patchSessionMessages(sendTargetId, stripOptimistic);
      } else {
        const draftMsgs = messagesBySessionRef.current.get("__draft__");
        if (draftMsgs) {
          messagesBySessionRef.current.set(
            "__draft__",
            stripOptimistic(draftMsgs),
          );
        }
        if (viewingTarget()) setMessages((m) => stripOptimistic(m));
      }
      if (viewingTarget()) {
        setSession((prev) =>
          prev.state === "streaming"
            ? { ...prev, state: prev.sessionId ? "ready" : prev.state }
            : prev,
        );
      }
      // Symmetric rollback of optimistic liveHost streaming — otherwise
      // useSendQueue.flush sees streaming forever and auto-flush starves.
      // Mirror the optimistic guard: never rewind a foreign mid-turn we did not claim.
      setLiveHost((prev) => {
        if (prev.sessionId) {
          if (sendTargetId && prev.sessionId !== sendTargetId) return prev;
          if (!sendTargetId && prev.sessionId) return prev;
        }
        if (prev.state !== "streaming") return prev;
        const next = {
          ...prev,
          state: (prev.sessionId ? "ready" : "idle") as SessionSnapshot["state"],
        };
        liveHostRef.current = next;
        return next;
      });
    };

    try {
      let sessionId: string | null = null;
      const live = liveHostRef.current;
      if (
        sendTargetId &&
        live.sessionId === sendTargetId &&
        live.state === "ready" &&
        !live.lastError
      ) {
        sessionId = sendTargetId;
      } else if (
        fromQueue &&
        sendTargetId &&
        viewingSessionIdRef.current !== sendTargetId
      ) {
        failStrip();
        return false;
      } else {
        sessionId = await ensureConnected({ sessionId: sendTargetId });
      }
      if (!sessionId) {
        failStrip();
        return false;
      }
      if (fromQueue && sendTargetId && sessionId !== sendTargetId) {
        failStrip();
        return false;
      }
      // Bind draft message cache to the real id early (Host already materialized).
      // Queue migrate waits until sessionSend succeeds so a failed flush can
      // requeue under the original claim key (`__draft__`) without splitting.
      if (!sendTargetId) {
        const draftMsgs = messagesBySessionRef.current.get("__draft__");
        if (draftMsgs?.length) {
          messagesBySessionRef.current.set(sessionId, draftMsgs);
          messagesBySessionRef.current.delete("__draft__");
        }
      }
      if (automationSetupDraftRef.current || inAutomationSetup) {
        automationSetupSessionsRef.current.add(sessionId);
        automationSetupDraftRef.current = false;
      }
      if (
        fromQueue &&
        sendTargetId &&
        liveHostRef.current.sessionId &&
        liveHostRef.current.sessionId !== sendTargetId
      ) {
        failStrip();
        return false;
      }
      // Bind the turn to `sessionId`, never to "whatever is live". Host
      // re-focuses that chat (background/parked → live) before prompting, so a
      // warm connect racing this send cannot deliver it to another chat — and
      // a mid-send "new chat" still lets this turn complete.
      try {
        await api.sessionSend(agentText, storedDisplay, sessionId, att);
      } catch (sendErr) {
        // Host refuses rather than misroute when the chat lost its process
        // (idle recycle / crash while `liveHost` still looked ready).
        // Cold-connect that chat once, then retry the same turn.
        if (!isSessionNotLiveError(sendErr)) throw sendErr;
        const reconnected = await ensureConnected({
          sessionId,
          force: true,
        });
        if (reconnected !== sessionId) throw sendErr;
        await api.sessionSend(agentText, storedDisplay, sessionId, att);
      }
      // Keep liveMap busy for this session if the user already left the thread.
      setLiveMap((prev) =>
        projectHostIntoLiveMap(prev, {
          sessionId,
          state: "streaming",
          streamingMessageId: null,
        }),
      );
      // Only after a successful send: move remaining draft follow-ups onto the
      // real session. If this threw, claim requeues under `__draft__` intact.
      if (!sendTargetId) {
        sendQueue.migrateDraft(sessionId);
      }
      // Cross-session recent prompts (localStorage ring, max 50).
      // Store display form so chips/skill tokens rehydrate in the composer.
      if (storedDisplay.trim()) {
        setRecentPromptHistory(
          recordRecentPrompt({
            text: storedDisplay,
            sessionId,
            at: nowIso,
          }),
        );
      }
      // `session.autoTitle` is on the mirror allowlist, so phone chats get a
      // real title instead of staying on the "new chat" placeholder forever.
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
      return true;
    } catch (e) {
      failStrip();
      if (viewingTarget()) setLocalError(String(e));
      return false;
    } finally {
      sendInFlightRef.current = false;
    }
  };

  const clearComposerAfterSubmit = (opts?: {
    /** Drop the per-project new-chat buffer (only when leaving a draft send). */
    clearProjectDraft?: boolean;
    /** Drop the per-session follow-up buffer (send / clear on a real thread). */
    clearSessionDraft?: boolean;
    sessionDraftId?: string | null;
  }) => {
    setDraft("");
    promptHistoryIndexRef.current = null;
    setPromptHistoryIndex(null);
    setPromptHistoryOpen(false);
    setPromptHistoryFilter("");
    setPromptHistoryActive(0);
    setPromptHistoryFocusFilter(false);
    setPromptHistoryScope("session");
    setSlashQuery(null);
    setAttachments([]);
    if (opts?.clearProjectDraft) {
      clearComposerProjectDraft(projectDraftKey(activeProject?.id ?? null));
    }
    if (opts?.clearSessionDraft) {
      const sid =
        opts.sessionDraftId ??
        viewingSessionIdRef.current ??
        session.sessionId ??
        null;
      if (sid) clearComposerSessionDraft(sid);
    }
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(".composer__input");
      if (el) el.style.height = "auto";
    });
  };

  /**
   * Wipe the main composer (text + attachments). Also leaves inline edit mode
   * and drops the per-project new-chat buffer when on a draft page, or the
   * per-session follow-up buffer when on a real thread.
   */
  const applyClearComposerDraft = useCallback(() => {
    const onDraftPage =
      session.sessionId == null && viewingSessionIdRef.current == null;
    clearComposerAfterSubmit({
      clearProjectDraft: onDraftPage,
      clearSessionDraft: !onDraftPage,
    });
    if (!editSubmitting) {
      setEditingUserMessageId(null);
      setEditAttachments([]);
    }
    requestComposerFocus();
  }, [editSubmitting, requestComposerFocus, session.sessionId]);

  /** Clear immediately, or confirm first when the draft is long (>200 chars). */
  const requestClearComposerDraft = useCallback(() => {
    const draft = getDraft();
    const hasBody =
      !isDraftEmpty(parseStoredContent(draft)) || attachments.length > 0;
    if (!hasBody) return;
    if (countDraftChars(draft) > 200) {
      setAppDialog({
        kind: "confirm",
        title: tr("composer.clearDraftConfirmTitle"),
        message: tr("composer.clearDraftConfirmMessage"),
        confirmLabel: tr("composer.clearDraftConfirm"),
        danger: true,
        onConfirm: () => applyClearComposerDraft(),
      });
      return;
    }
    applyClearComposerDraft();
  }, [applyClearComposerDraft, attachments.length, getDraft, tr]);

  /** Enqueue when agent is busy; otherwise send immediately. */
  const send = async () => {
    if (!canLiveParticipate(isSecondaryWindowRef.current)) {
      showToast(tr("session.secondaryLiveBanner"), 4000);
      return;
    }
    const draft = getDraft();
    const segments = parseStoredContent(draft);
    const storedDisplay = draft;
    const att = attachments;
    if (isDraftEmpty(segments) && !att.length) return;
    if (session.state === "awaiting_permission") {
      showToast(tr("composer.queueBlockedPermission"), 2800);
      return;
    }
    // Unassigned chats use workspaces/general as cwd (no sidebar project).
    sendQueue.releaseFlushHold();

    // New-chat page → after send, forget the project buffer so restore is empty.
    // Existing-session follow-ups clear the per-session buffer only (not project).
    const fromNewChatPage = session.sessionId == null;
    const clearDraftOpts = {
      clearProjectDraft: fromNewChatPage,
      clearSessionDraft: !fromNewChatPage,
      sessionDraftId: viewingSessionIdRef.current ?? session.sessionId,
    };

    // Enqueue only when *this viewed chat* FSM is busy (streaming/connecting).
    // Host mid-turn on another session → executeSend demotes + spawns concurrent
    // work. Never park a new-chat / other-session send into a fake local queue
    // (that showed “本会话队列” on empty welcome while the real turn ran elsewhere).
    // Also ignore the process-global `connecting` flag — foreign ensureConnected
    // must not make SuperGrok welcome enqueue (see shouldEnqueueSend).
    if (shouldEnqueueSend(session.state, connecting)) {
      sendQueue.enqueue({
        storedDisplay,
        attachments: att,
        goalMode,
      });
      clearComposerAfterSubmit(clearDraftOpts);
      return;
    }

    clearComposerAfterSubmit(clearDraftOpts);
    await executeSend({
      storedDisplay,
      att,
      goalMode,
      targetSessionId: session.sessionId,
    });
  };
  sendRef.current = send;
  voiceDictationAutoSendRef.current = voiceDictationAutoSend;

  executeSendFromQueueRef.current = (opts) => executeSend(opts);

  const queuePreviewLabels = useMemo(
    () => ({
      filesCount: (n: number) =>
        tr("composer.queueFilesCount", { n: String(n) }),
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
        if (!f || f.size <= 0) continue;
        const anyF = f as File & { path?: string };
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
      // Keep `/` at live.start; drop the query so filter shows full catalog.
      setDraft((d) => d.slice(0, live.start + 1) + d.slice(live.end));
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
        for (const d of dirs) {
          last = (await api.projectAdd(d.path, false)) as Project;
        }
        const list = mapProjectsList((await api.projectsList()) as Project[]);
        setProjects(list);
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
            if (!paths.length) {
              setLocalError(tr("attach.droppedNone"));
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
    tr,
  ]);

  // HTML5 fallback: some image drags only expose File list in the webview.
  // Prefer Tauri paths; use File.path when present (Tauri webview).
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.files?.length) return;
      // If Tauri already handled this OS drop, paths may be empty here.
      const files = Array.from(e.dataTransfer.files);
      const paths = files
        .map((f) => {
          const anyF = f as File & { path?: string };
          return anyF.path || "";
        })
        .filter(Boolean);
      const zone = hitDragZone(e.clientX, e.clientY);
      if (paths.length) {
        e.preventDefault();
        e.stopPropagation();
        if (zone === "sidebar") void addProjectsFromPaths(paths);
        else void addAttachmentsFromPaths(paths);
        return;
      }
      // Browser-only / path-less File list (e.g. image from another app)
      if (zone !== "sidebar" && files.length) {
        e.preventDefault();
        e.stopPropagation();
        void addAttachmentsFromFiles(files);
      }
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [
    addAttachmentsFromFiles,
    addAttachmentsFromPaths,
    addProjectsFromPaths,
    hitDragZone,
  ]);

  // Drag-resize right resource pane.
  // Live clamp only — do NOT fitWindowThenClampAside on pointer-up (that
  // re-applied preferred min / window grow and bounced the divider back).
  useEffect(() => {
    if (!resizingAside) return;
    const clampOpts = () => ({
      ...asideClampOpts(),
      viewportWidth: window.innerWidth,
    });
    const onMove = (e: PointerEvent) => {
      if (isWindowFitSuppressed()) return;
      const desired = Math.round(window.innerWidth - e.clientX);
      const next = clampAsideWidth(desired, clampOpts());
      setLayout((l) => {
        if (l.asideWidth === next && !l.asideCollapsed) return l;
        return { ...l, asideWidth: next, asideCollapsed: false };
      });
    };
    const onUp = () => {
      setResizingAside(false);
      // Persist the last live width (same clamp as drag). No window grow /
      // preferredAside bump — those caused a visible spring-back at chat min.
      const cur = layoutRef.current;
      const width = clampAsideWidth(cur.asideWidth, clampOpts());
      setLayout((l) => {
        const n = {
          ...l,
          asideCollapsed: false,
          asideWidth: width,
        };
        saveLayout(localStorage, n);
        return n;
      });
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [asideClampOpts, resizingAside]);

  // Drag-resize left session rail.
  // Collapse as soon as desired width crosses below the open min — never paint
  // a crushed rail, and do not wait for pointer-up.
  useEffect(() => {
    if (!resizingSidebar) return;
    const clampOpts = () => {
      const cur = layoutRef.current;
      return {
        viewportWidth: window.innerWidth,
        asideOccupiedWidth: cur.asideCollapsed ? 0 : cur.asideWidth || 0,
      };
    };
    const endResizeChrome = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    const applyCollapseLive = () => {
      const cur = layoutRef.current;
      const n = {
        ...cur,
        sidebarCollapsed: true,
        sidebarWidth: SIDEBAR_WIDTH_MIN,
      };
      setLayout(n);
      saveLayout(localStorage, n);
      sidebarResizeStartRef.current = null;
      setResizingSidebar(false);
      endResizeChrome();
    };
    const onMove = (e: PointerEvent) => {
      if (isWindowFitSuppressed()) return;
      const start = sidebarResizeStartRef.current;
      if (!start) return;
      const desired = Math.round(start.width + (e.clientX - start.x));
      // Live collapse before any compressed layout is shown.
      if (desired < SIDEBAR_WIDTH_MIN) {
        applyCollapseLive();
        return;
      }
      const next = clampSidebarDragWidth(desired, clampOpts());
      setLayout((l) => {
        if (l.sidebarWidth === next && !l.sidebarCollapsed) return l;
        return { ...l, sidebarWidth: next, sidebarCollapsed: false };
      });
    };
    const onUp = () => {
      // If we already live-collapsed, effect teardown cleared state — still safe.
      if (!sidebarResizeStartRef.current && layoutRef.current.sidebarCollapsed) {
        setResizingSidebar(false);
        endResizeChrome();
        return;
      }
      setResizingSidebar(false);
      sidebarResizeStartRef.current = null;
      const cur = layoutRef.current;
      if (cur.sidebarCollapsed) {
        endResizeChrome();
        return;
      }
      const resolved = resolveSidebarDragEnd(
        cur.sidebarWidth || SIDEBAR_DEFAULT_WIDTH,
        clampOpts(),
      );
      const n =
        resolved.action === "collapse"
          ? {
              ...cur,
              sidebarCollapsed: true,
              sidebarWidth: resolved.sidebarWidth,
            }
          : {
              ...cur,
              sidebarCollapsed: false,
              sidebarWidth: resolved.sidebarWidth,
            };
      setLayout(n);
      saveLayout(localStorage, n);
      endResizeChrome();
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [resizingSidebar]);

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
  const composerMenuEntries = useMemo(
    () =>
      buildComposerPlusEntries({
        showUpload: showUploadInMenu,
        showJsonSchema: showJsonSchemaInMenu,
        commands: slashFiltered.commands,
        skills: slashFiltered.skills,
      }),
    [
      showUploadInMenu,
      showJsonSchemaInMenu,
      slashFiltered.commands,
      slashFiltered.skills,
    ],
  );
  const composerMenuEntriesRef = useRef(composerMenuEntries);
  composerMenuEntriesRef.current = composerMenuEntries;

  /** + button and `/` open the same panel. */
  const composerMenuOpen = showComposerPlus || liveSlash.present;

  /**
   * rAF poll of composer innerText → live slash token.
   * Single source of truth for open state + filter (not React draft).
   */
  useEffect(() => {
    let raf = 0;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const el = composerInputRef.current;
      const detected = detectSlashQueryFromEditor(el);
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

  /** Confirm then stop the given session ids (dashboard / multi-select). */
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
        const results = await Promise.allSettled(
          ids.map((id) => api.sessionStop(id)),
        );
        let ok = 0;
        let fail = 0;
        for (let i = 0; i < results.length; i++) {
          const r = results[i]!;
          const id = ids[i]!;
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
        if (fail > 0) {
          showToast(
            tr("tasks.activity.stopAllPartial", {
              ok: String(ok),
              fail: String(fail),
            }),
            4000,
          );
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
    [clearPendingGates, settleStoppedSessionUi, showToast, tr],
  );

  /**
   * Global Stop-all (Tasks / dashboard): every stoppable busy session.
   * Distinct from composer Stop, which targets only the viewed chat
   * (`resolveStopTargets({ scope: "current" })`).
   */
  const stopAllBusySessions = useCallback(() => {
    const rows = stoppableActivitySessions(
      collectActivitySessions({
        liveMap: liveMapRef.current,
        sessions,
        currentSessionId: session.sessionId,
        untitledLabel: tr("session.untitled"),
      }),
    );
    const ids = resolveStopTargets({
      scope: "all_busy",
      currentSessionId: session.sessionId,
      busySessionIds: rows.map((r) => r.sessionId),
    });
    if (!ids.length) return;
    stopBusySessionsByIds(ids);
  }, [
    sessions,
    session.sessionId,
    stopBusySessionsByIds,
    tr,
  ]);

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

  const voiceErrorMessage = useCallback(
    (cls: VoiceErrorClass | null | undefined) => {
      const key = (`composer.voiceErr.${cls ?? "unknown"}`) as MessageKey;
      try {
        return tr(key);
      } catch {
        return tr("composer.voiceErr.unknown");
      }
    },
    [tr],
  );

  const clearVoiceTimers = useCallback(() => {
    const t = voiceTimersRef.current;
    if (t.max != null) window.clearTimeout(t.max);
    if (t.noSpeech != null) window.clearTimeout(t.noSpeech);
    voiceTimersRef.current = {};
  }, []);

  const refreshVoiceGate = useCallback(async () => {
    // Resolve whether the active inference route is a custom/third-party provider.
    let customActive = false;
    if (api.isTauri()) {
      try {
        const list = await api.providersList();
        customActive = list.activeSource === "custom";
      } catch {
        /* ignore */
      }
    }
    try {
      // Desktop Tauri and phone mirror both resolve availability from the host
      // voice.status (mirror routes it over the WS allowlist). The host also
      // refuses speech when active provider is custom.
      if (api.isTauri() || isMirrorClient()) {
        if (customActive) {
          setVoiceGate({ available: false, reason: "not_available" });
          return;
        }
        const st = await api.voiceStatus();
        setVoiceGate({
          available: !!st.available,
          reason: (st.reason as VoiceErrorClass | null) ?? "not_available",
        });
        return;
      }
    } catch {
      /* fall through to local estimate */
    }
    const signedIn = !!account?.profile?.signedIn;
    let hasOfficial = false;
    let hasRelay = false;
    try {
      const masked = await api.secretsGetMasked();
      hasOfficial = !!masked.hasOfficialKey;
      hasRelay = !!masked.hasRelayKey;
    } catch {
      /* ignore */
    }
    const gate = voiceAvailabilityFromAuth({
      signedInOfficial: signedIn,
      hasOfficialApiKey: hasOfficial,
      hasRelayOnly: hasRelay && !hasOfficial && !signedIn,
      activeProviderIsCustom: customActive,
    });
    setVoiceGate({
      available: gate.available,
      reason: gate.reason,
    });
  }, [account?.profile?.signedIn]);

  useEffect(() => {
    void refreshVoiceGate();
  }, [refreshVoiceGate]);

  const cancelVoice = useCallback(() => {
    voiceGenRef.current += 1;
    clearVoiceTimers();
    try {
      voiceCaptureRef.current?.cancel();
    } catch {
      /* ignore */
    }
    voiceCaptureRef.current = null;
    voiceCaretRef.current = null;
    setVoice(reduceVoice(voiceRef.current, { type: "cancel" }));
  }, [clearVoiceTimers]);

  // Drop in-progress dictation / live session when speech becomes unavailable
  // (e.g. switched to a third-party provider).
  useEffect(() => {
    if (voiceGate.available) return;
    if (voiceIsActive(voiceRef.current.phase)) {
      cancelVoice();
    }
    if (liveVoiceOpen) {
      setLiveVoiceOpen(false);
    }
  }, [voiceGate.available, cancelVoice, liveVoiceOpen]);

  // Live Voice host created/updated a coding session — refresh sidebar list.
  useEffect(() => {
    const onVoiceSession = () => {
      void refreshSessions();
    };
    window.addEventListener("grok-app:voice-session-changed", onVoiceSession);
    return () =>
      window.removeEventListener(
        "grok-app:voice-session-changed",
        onVoiceSession,
      );
    // refreshSessions is stable enough for mount-scoped listen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finishVoiceTranscribe = useCallback(
    async (blob: Blob, gen: number) => {
      if (!voiceResultStillCurrent(gen, voiceGenRef.current)) return;
      setVoice((s) => reduceVoice(s, { type: "stop" }));
      try {
        if (blob.size < 256) {
          if (!voiceResultStillCurrent(gen, voiceGenRef.current)) return;
          setVoice((s) =>
            reduceVoice(s, {
              type: "transcribe_fail",
              error: "no_speech",
            }),
          );
          showToast(voiceErrorMessage("no_speech"), 4200);
          return;
        }
        const b64 = await blobToBase64(blob);
        if (!voiceResultStillCurrent(gen, voiceGenRef.current)) return;
        const mime = blob.type || "audio/webm";
        const ext = extensionForMime(mime);
        const res = await api.voiceTranscribe({
          audioBase64: b64,
          filename: `dictation.${ext}`,
          mime,
        });
        if (!voiceResultStillCurrent(gen, voiceGenRef.current)) return;
        if (!res.ok || !res.text?.trim()) {
          const cls = resolveVoiceErrorClass(res.errorClass, res.error);
          setVoice((s) =>
            reduceVoice(s, { type: "transcribe_fail", error: cls }),
          );
          showToast(voiceErrorMessage(cls), 4800);
          return;
        }
        if (!voiceResultStillCurrent(gen, voiceGenRef.current)) return;
        const caret = voiceCaretRef.current;
        let inserted = "";
        setDraft((d) => {
          const at =
            caret == null ? d.length : Math.max(0, Math.min(caret, d.length));
          inserted = insertTranscriptIntoDraft(d, res.text!, at).text;
          return inserted;
        });
        setVoice((s) => reduceVoice(s, { type: "transcribe_ok" }));
        if (
          voiceDictationAutoSendRef.current &&
          inserted.trim().length > 0
        ) {
          window.setTimeout(() => {
            void sendRef.current?.();
          }, 0);
        }
      } catch (e) {
        if (!voiceResultStillCurrent(gen, voiceGenRef.current)) return;
        const cls = classifyVoiceError(String(e));
        setVoice((s) =>
          reduceVoice(s, { type: "transcribe_fail", error: cls }),
        );
        showToast(voiceErrorMessage(cls), 4800);
      } finally {
        if (voiceResultStillCurrent(gen, voiceGenRef.current)) {
          voiceCaptureRef.current = null;
          voiceCaretRef.current = null;
          clearVoiceTimers();
        }
      }
    },
    [clearVoiceTimers, showToast, voiceErrorMessage],
  );

  const startVoice = useCallback(async () => {
    if (!voiceGate.available) {
      showToast(
        voiceErrorMessage(voiceGate.reason ?? "not_available"),
        4800,
      );
      return;
    }
    if (voiceIsActive(voiceRef.current.phase)) return;
    voiceGenRef.current += 1;
    const gen = voiceGenRef.current;
    setVoice((s) => reduceVoice(s, { type: "start" }));
    try {
      const handle = await startVoiceCapture();
      if (gen !== voiceGenRef.current) {
        handle.cancel();
        return;
      }
      voiceCaptureRef.current = handle;
      setVoice((s) => reduceVoice(s, { type: "mic_granted" }, Date.now()));
      clearVoiceTimers();
      // Auto-stop cap: stop() + STT (never cancel/discard live speech).
      // "no_speech" only after STT empty / tiny blob — phase-1 has no VAD.
      const autoStopAndTranscribe = () => {
        void (async () => {
          if (!voiceResultStillCurrent(gen, voiceGenRef.current)) return;
          if (voiceRef.current.phase !== "recording") return;
          const cap = voiceCaptureRef.current;
          if (!cap) return;
          clearVoiceTimers();
          try {
            voiceCaretRef.current = getComposerCaretOffset(
              composerInputRef.current,
            );
            const blob = await cap.stop();
            await finishVoiceTranscribe(blob, gen);
          } catch (e) {
            if (!voiceResultStillCurrent(gen, voiceGenRef.current)) return;
            const cls = classifyVoiceError(String(e));
            setVoice((s) =>
              reduceVoice(s, { type: "transcribe_fail", error: cls }),
            );
            showToast(voiceErrorMessage(cls), 4200);
          }
        })();
      };
      voiceTimersRef.current.max = window.setTimeout(
        autoStopAndTranscribe,
        VOICE_MAX_RECORD_MS,
      );
    } catch (e) {
      if (gen !== voiceGenRef.current) return;
      const code =
        e && typeof e === "object" && "code" in e
          ? String((e as { code?: string }).code)
          : "";
      if (code === "mic_denied") {
        setVoice((s) => reduceVoice(s, { type: "mic_denied" }));
        showToast(voiceErrorMessage("mic_denied"), 5200);
      } else if (code === "mic_missing") {
        setVoice((s) => reduceVoice(s, { type: "mic_missing" }));
        showToast(voiceErrorMessage("mic_missing"), 4200);
      } else {
        const cls = classifyVoiceError(String(e));
        setVoice((s) =>
          reduceVoice(s, { type: "transcribe_fail", error: cls }),
        );
        showToast(voiceErrorMessage(cls), 4200);
      }
      voiceCaptureRef.current = null;
    }
  }, [
    clearVoiceTimers,
    finishVoiceTranscribe,
    showToast,
    voiceErrorMessage,
    voiceGate.available,
    voiceGate.reason,
  ]);

  const stopVoice = useCallback(async () => {
    if (voiceRef.current.phase !== "recording") return;
    const gen = voiceGenRef.current;
    // Capture caret before focus/selection changes during stop.
    voiceCaretRef.current = getComposerCaretOffset(composerInputRef.current);
    clearVoiceTimers();
    const cap = voiceCaptureRef.current;
    if (!cap) {
      setVoice(initialVoiceState());
      return;
    }
    try {
      const blob = await cap.stop();
      await finishVoiceTranscribe(blob, gen);
    } catch (e) {
      if (gen !== voiceGenRef.current) return;
      const cls = classifyVoiceError(String(e));
      setVoice((s) =>
        reduceVoice(s, { type: "transcribe_fail", error: cls }),
      );
      showToast(voiceErrorMessage(cls), 4200);
      voiceCaptureRef.current = null;
    }
  }, [clearVoiceTimers, finishVoiceTranscribe, showToast, voiceErrorMessage]);

  const toggleVoice = useCallback(() => {
    const phase = voiceRef.current.phase;
    if (phase === "recording") {
      void stopVoice();
      return;
    }
    if (phase === "requesting_mic" || phase === "transcribing") {
      cancelVoice();
      return;
    }
    if (phase === "error") {
      setVoice(initialVoiceState());
    }
    void startVoice();
  }, [cancelVoice, startVoice, stopVoice]);

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
    } catch (e) {
      showToast(String(e), 4500);
    }
  }, [archivePlanDecision, plan.rpcId, showToast, writePlanForViewing]);

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
          setLayout((l) => {
            if (l.asideCollapsed) return l;
            const n = { ...l, asideCollapsed: true };
            saveLayout(localStorage, n);
            return n;
          });
        }
      },
    });
  }, [archivePlanDecision, tr, writePlanForViewing]);

  /** Open resource pane Plan review (replaces scroll-to-card “详情”). */
  const openPlanInResource = useCallback(() => {
    planOpenedAsideRef.current = true;
    openAsidePane();
    setPlanFocusKey((k) => k + 1);
  }, [openAsidePane]);

  const sendQueueLabels = useMemo(
    () => ({
      sendFailed: tr("composer.queueSendFailed"),
      droppedOldest: (n: number, max: number) =>
        tr("composer.queueDroppedOldest", {
          n: String(n),
          max: String(max),
        }),
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
    executeSendRef: executeSendFromQueueRef,
    showToast,
    labels: sendQueueLabels,
  });

  const canGuideQueuedMessage =
    session.state === "streaming" &&
    !connecting &&
    !!session.sessionId &&
    // Host may report streaming on this chat even when demoted; prefer viewed id.
    (liveHost.sessionId === session.sessionId
      ? liveHost.state === "streaming"
      : session.state === "streaming");

  const closeQueueEdit = useCallback(() => {
    setQueueEditItemId(null);
    setQueueEditText("");
    // Resume auto-flush after edit dialog (hold was set while open).
    sendQueue.releaseFlushHold();
  }, [sendQueue.releaseFlushHold]);

  const openQueueEdit = useCallback(
    (item: QueuedSend) => {
      // Pause auto-flush so the item is not claimed while the dialog is open.
      sendQueue.pauseFlush();
      setQueueEditItemId(item.id);
      setQueueEditText(item.storedDisplay);
      window.setTimeout(() => {
        queueEditTextareaRef.current?.focus();
        queueEditTextareaRef.current?.select();
      }, 0);
    },
    [sendQueue.pauseFlush],
  );

  const sendQueueStrip = useMemo(
    () =>
      resolveSendQueueStripState({
        queue: sendQueue.activeQueue,
        flushHold: sendQueue.flushHold,
      }),
    [sendQueue.activeQueue, sendQueue.flushHold],
  );

  const sendQueueClearPlan = useMemo(
    () => planClearSendQueue(sendQueue.activeQueue),
    [sendQueue.activeQueue],
  );

  /** Open clear confirm when there is something to clear; no-op when empty. */
  const requestClearSendQueue = useCallback(() => {
    const plan = planClearSendQueue(sendQueue.activeQueue);
    if (!plan.confirmNeeded) {
      // Empty honesty: nothing to clear (strip should already be hidden).
      return;
    }
    setSendQueueClearOpen(true);
  }, [sendQueue.activeQueue]);

  const confirmClearSendQueue = useCallback(() => {
    sendQueue.clearQueue();
    setSendQueueClearOpen(false);
  }, [sendQueue.clearQueue]);

  const saveQueueEdit = useCallback(() => {
    if (!queueEditItemId) return;
    const item = sendQueue.activeQueue.find((q) => q.id === queueEditItemId);
    if (!item) {
      closeQueueEdit();
      return;
    }
    const trimmed = queueEditText.trim();
    if (!trimmed && item.attachments.length === 0) {
      showToast(tr("composer.queueEditEmpty"), 2800);
      return;
    }
    sendQueue.updateItem(queueEditItemId, { storedDisplay: trimmed });
    closeQueueEdit();
  }, [
    queueEditItemId,
    queueEditText,
    sendQueue.activeQueue,
    sendQueue.updateItem,
    closeQueueEdit,
    showToast,
    tr,
  ]);

  const guideQueuedMessage = useCallback(
    async (item: QueuedSend) => {
      if (guidingQueueItemId || !canGuideQueuedMessage || !session.sessionId) {
        return;
      }
      const segments = parseStoredContent(item.storedDisplay);
      const agentBody = serializeForAgent(segments, { goalMode: item.goalMode });
      let agentText = buildAgentPrompt(agentBody, item.attachments);
      const schemaForGuide = sessionJsonSchemaRef.current?.trim() || "";
      if (schemaForGuide && isActiveJsonSchema(schemaForGuide)) {
        agentText = wrapAgentTextWithJsonSchema(agentText, schemaForGuide);
      }
      if (!agentText.trim()) return;

      setGuidingQueueItemId(item.id);
      try {
        // Host interject has its own RPC timeout; also bound the UI so a wedged
        // agent cannot leave the button stuck on "正在引导…" forever.
        const GUIDE_UI_TIMEOUT_MS = 55_000;
        await Promise.race([
          api.sessionInterject(
            agentText,
            item.storedDisplay,
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
        sendQueue.removeItem(item.id);
      } catch {
        showToast(tr("composer.queueGuideFailed"), 3600);
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
      showToast,
      tr,
    ],
  );


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
              forkedAgent: forkResolved.fork,
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
        showToast(tr("error.needTauri"));
        return;
      }
      if (!canRewindSession) {
        showToast(tr("session.rewindBusy"));
        return;
      }
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
        if (!result.agentOk) {
          showToast(tr("session.rewindLocalOnly"), 4200);
        }
        await refreshSessions();
      } catch (e) {
        showToast(tr("session.rewindFailed") + ": " + String(e), 4500);
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
      setRewindRestoreFiles(false);
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

  const onForkFromUserMessage = useCallback(
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
      const idx = userPromptIndexOf(messages, msg.id);
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

      if (item.kind === "skill") {
        if (q) {
          setDraft((d) => applySkillAtSlash(d, q.start, q.end, item.name));
        } else {
          setDraft((d) => {
            const needsSpace = d.length > 0 && !/\s$/.test(d);
            return `${d}${needsSpace ? " " : ""}[[skill:${item.name}]] `;
          });
        }
        return;
      }

      // Remove the /query from draft for mode/action
      if (q) {
        setDraft((d) => d.slice(0, q.start) + d.slice(q.end));
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
          case "mcp":
            void openMcpModal();
            return;
          case "compact":
            openCompactWithNote();
            return;
          case "newChat":
            void newChat();
            return;
          case "automations":
            navigateAutomations();
            return;
          case "live-voice":
          case "liveVoice":
            if (!voiceGate.available) {
              showToast(
                voiceErrorMessage(voiceGate.reason ?? "not_available"),
                4200,
              );
              return;
            }
            setLiveVoiceOpen(true);
            return;
          case "settings":
            navigateSettings();
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

  /**
   * In-chat find matches — user + assistant bodies only.
   * Historical tool_step rows are not rendered in the transcript, so matching
   * them would land on invisible hits.
   */
  const [chatFindLiveTick, setChatFindLiveTick] = useState(0);
  useEffect(() => {
    if (!showChatFind) return;
    let raf = 0;
    const unsub = sessionTranscriptStore.subscribeContent(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setChatFindLiveTick((n) => n + 1));
    });
    return () => {
      cancelAnimationFrame(raf);
      unsub();
    };
  }, [showChatFind]);

  const chatFindMatches = useMemo((): ChatFindMatch[] => {
    if (!showChatFind) return [];
    void chatFindLiveTick;
    const live = sessionTranscriptStore.getMessages();
    return findChatMatches(
      chatFindQuery,
      live
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          marker: m.marker,
        })),
    );
  }, [showChatFind, chatFindQuery, chatFindLiveTick, messages]);

  const chatFindHitIds = useMemo(() => {
    const s = new Set<string>();
    for (const m of chatFindMatches) s.add(m.messageId);
    return s;
  }, [chatFindMatches]);

  const chatFindActive = useMemo(() => {
    if (!showChatFind || chatFindMatches.length === 0) return null;
    const idx =
      chatFindIndex >= 0 && chatFindIndex < chatFindMatches.length
        ? chatFindIndex
        : 0;
    const hit = chatFindMatches[idx]!;
    return { messageId: hit.messageId, occurrence: hit.occurrence };
  }, [showChatFind, chatFindMatches, chatFindIndex]);

  // Clamp active index when the match list shrinks (query edit / new messages).
  useEffect(() => {
    if (!showChatFind) return;
    if (chatFindMatches.length === 0) {
      if (chatFindIndex !== 0) setChatFindIndex(0);
      return;
    }
    if (chatFindIndex >= chatFindMatches.length) {
      setChatFindIndex(0);
    }
  }, [showChatFind, chatFindMatches.length, chatFindIndex]);

  // Reset find when switching conversation (keep open across same session).
  useEffect(() => {
    setShowChatFind(false);
    setChatFindQuery("");
    setChatFindIndex(0);
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

  const chatFindNext = useCallback(() => {
    setChatFindIndex((i) =>
      stepChatFindIndex(i, chatFindMatches.length, 1),
    );
  }, [chatFindMatches.length]);

  const chatFindPrev = useCallback(() => {
    setChatFindIndex((i) =>
      stepChatFindIndex(i, chatFindMatches.length, -1),
    );
  }, [chatFindMatches.length]);

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
  const emptyExistingSession =
    mainPane === "chat" &&
    !!session.sessionId &&
    transcriptMeta.length === 0 &&
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
      }),
    [activeCustomProvider, modelId, availableModels],
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
          setAvailableModels((prev) =>
            prev.map((model) => {
              const live = res.models.find((m) => m.id === model.id);
              return live?.contextWindow != null
                ? { ...model, contextWindow: live.contextWindow }
                : model;
            }),
          );
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
    return effortOptionsFromProvider(activeCustomProvider.efforts);
  }, [providerActiveSource, activeCustomProvider]);

  /**
   * Active effort catalog for the composer: custom channel efforts, else Grok 3-tier.
   * Used when remapping after route/model switches (DeepSeek 4-tier ↔ Grok 3-tier).
   */
  const activeEffortCatalog = useMemo(
    () => channelEffortOptions ?? GROK_BUILD_EFFORTS,
    [channelEffortOptions],
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
          // DeepSeek 4-tier → Grok 3-tier (low→low, high→medium, xhigh/max→high).
          setEffort((prev) =>
            mapEffortToTargetCatalog(
              prev,
              GROK_BUILD_EFFORTS,
              channelEffortOptions ?? undefined,
            ),
          );
          void api
            .composerPrefsSet({
              projectId: activeProject?.id ?? null,
              sessionId: session.sessionId ?? null,
              modelId: pick.modelId,
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
              setAsDefault: false,
            });
          }
          if (
            providerActiveSource !== "custom" ||
            providerActiveId !== pick.providerId
          ) {
            await api.providersActivate("custom", pick.providerId);
          }
          await refreshProviderRoute();
          // Map effort into the picked channel's catalog (Grok ↔ DeepSeek tiers).
          const nextEfforts =
            effortOptionsFromProvider(provider.efforts) ?? GROK_BUILD_EFFORTS;
          setEffort((prev) =>
            mapEffortToTargetCatalog(
              prev,
              nextEfforts,
              channelEffortOptions ?? GROK_BUILD_EFFORTS,
            ),
          );
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
      refreshProviderRoute,
      showToast,
      tr,
      channelEffortOptions,
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

  const hideChatForSideExpand = shouldHideChatForSideExpand({
    expanded: sideWorkbench.expanded,
    phoneLayout,
  });
  const sideDockActive = isSideDockComposerActive({
    expanded: sideWorkbench.expanded,
    dockComposer: sideDockComposer,
    phoneLayout,
  });
  const dockSidebarOccupied =
    phoneLayout || layout.sidebarCollapsed ? 0 : layout.sidebarWidth;

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
    let timeoutSettledSessionId: string | null = null;
    // Force-unlock if Host stays busy past STOP_LATCH_MS.
    window.setTimeout(() => {
      const tick = tickStopLatch(
        stopLatchRef.current,
        liveHostRef.current.state,
        Date.now(),
        STOP_LATCH_MS,
      );
      stopLatchRef.current = tick.latch;
      setStopLatch(tick.latch);
      if (tick.forceComplete) {
        const id = sid || liveHostRef.current.sessionId;
        if (id) {
          timeoutSettledSessionId = id;
          settleStoppedSessionUi(id);
          patchSessionMessages(id, (prev) =>
            applyTurnMarker(prev, {
              sessionId: id,
              messageId: `end-stop-${Date.now()}`,
              marker: "turn_end",
              reason: "user_stop",
              content: endOfTurnMarkerContent("user_stop"),
            }),
          );
          patchSessionMessages(id, (m) =>
            m.map((x) => ({ ...x, streaming: false })),
          );
        }
        setRetryStatus(null);
        setStreamStall(null);
        setTurnStartedAt(null);
      }
    }, STOP_LATCH_MS + 50);
    try {
      await api.sessionStop(sid);
      setRetryStatus(null);
      setStreamStall(null);
      setTurnStartedAt(null);
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
      if (liveId) {
        if (timeoutSettledSessionId !== liveId) {
          settleStoppedSessionUi(liveId);
        }
        patchSessionMessages(liveId, (m) =>
          m.map((x) => ({ ...x, streaming: false })),
        );
        // Prefer a clean end marker when stop settles normally.
        if (stopLatchRef.current.phase !== "force_idle") {
          patchSessionMessages(liveId, (prev) => {
            if (
              prev.some(
                (x) =>
                  x.marker === "turn_end" ||
                  x.marker === "turn_cancelled" ||
                  x.content?.startsWith("turn_end|"),
              )
            ) {
              return prev;
            }
            return applyTurnMarker(prev, {
              sessionId: liveId,
              messageId: `end-stop-ok-${Date.now()}`,
              marker: "turn_end",
              reason: "user_stop",
              content: endOfTurnMarkerContent("user_stop"),
            });
          });
        }
      } else {
        setMessages((m) => m.map((x) => ({ ...x, streaming: false })));
      }
      const cleared = createStopLatchState();
      stopLatchRef.current = cleared;
      setStopLatch(cleared);
    } catch (e) {
      setLocalError(String(e));
    }
  };

  /**
   * Bind the open session's project. Draft chats only switch workspace context.
   * Untrusted projects refuse bind when a session exists. Passing `null`
   * unbinds the folder (other sessions + general workspace cwd).
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
      if (target && !target.trusted) {
        setLocalError(
          tr("project.trustFirst", {
            name: projectDisplayName(target, tr),
          }),
        );
        return;
      }
      if (target && isProjectPathMissing(target.pathOk)) {
        setLocalError(
          tr("project.pathMissing", {
            name: projectDisplayName(target, tr),
          }),
        );
        return;
      }
      try {
        await api.sessionSetProject(sid, target?.id ?? null);
        setActiveProject(target);
        setSessions((list) =>
          list.map((s) =>
            s.id === sid ? { ...s, projectId: target?.id ?? null } : s,
          ),
        );
        // Live agent used old cwd — force reconnect next send
        setSession((prev) =>
          prev.sessionId === sid
            ? {
                ...IDLE_SNAPSHOT,
                sessionId: sid,
                title: prev.title,
                state: "idle",
                backend: prev.backend || "grok_agent_stdio",
              }
            : prev,
        );
        setLiveHost((prev) =>
          prev.sessionId === sid ? { ...IDLE_SNAPSHOT } : prev,
        );
        if (target) {
          setExpandedProjects((e) => ({ ...e, [target.id]: true }));
        } else {
          setHistoryOpen(true);
        }
        setLocalError(null);
      } catch (e) {
        showToast(String(e), 4500);
      }
    },
    [session.sessionId, showToast, tr],
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
      setGitDirtySummary(null);
      return;
    }
    const reqId = ++gitDirtyReqRef.current;
    try {
      const status = await api.gitStatus(path);
      if (reqId !== gitDirtyReqRef.current) return;
      setGitDirtySummary(summarizeGitDirty(status));
    } catch {
      if (reqId !== gitDirtyReqRef.current) return;
      setGitDirtySummary(null);
    }
  }, [activeProject?.path]);

  useEffect(() => {
    void refreshGitDirtyStatus();
    // Soft poll while a project is bound; refresh sooner on focus.
    const path = activeProject?.path?.trim() || null;
    if (!path || !api.isTauri()) return;
    const intervalMs = 8000;
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
  }, [activeProject?.path, refreshGitDirtyStatus]);

  /**
   * After a project is created/updated: refresh list, expand, optionally trust
   * via in-app confirm, then set active (+ bind session when requested).
   */
  const finalizeAddedProject = useCallback(
    async (p: Project, opts: { bindSession: boolean }) => {
      const list = mapProjectsList((await api.projectsList()) as Project[]);
        setProjects(list);
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
            } catch (e) {
              setLocalError(String(e));
            }
          },
        });
        return;
      }
      await apply(p);
    },
    [bindSessionProject, showToast, tr],
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
      // CLI connects on first send only.
    } catch (e) {
      setLocalError(String(e));
    }
  };

  const openDoctor = () => {
    setShowDoctor(true);
  };

  const openReliability = () => {
    setShowReliability(true);
  };

  const openBatchAgents = useCallback(() => {
    setBatchAgentsOpen(true);
  }, []);

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
    setShowSearch(false);
    setSearchQuery("");
    switch (action.id) {
      case "new-chat":
        void newChat(activeProject);
        break;
      case "add-project":
        void addProject(false);
        break;
      case "open-automations":
        navigateAutomations();
        break;
      case "open-ops":
        // Ops hub: multi-session dashboard (fleet + stop-all).
        setAppView("workbench");
        setAgentDashboardOpen(true);
        if (
          typeof window !== "undefined" &&
          window.location.hash.includes("settings")
        ) {
          window.location.hash = "#/workbench";
        }
        break;
      case "open-tasks":
        setAppView("workbench");
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
        setAppView("workbench");
        setAgentDashboardOpen(true);
        if (
          typeof window !== "undefined" &&
          window.location.hash.includes("settings")
        ) {
          window.location.hash = "#/workbench";
        }
        break;
      case "open-task-board":
        setAppView("workbench");
        setTaskBoardOpen(true);
        if (
          typeof window !== "undefined" &&
          window.location.hash.includes("settings")
        ) {
          window.location.hash = "#/workbench";
        }
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
        setShowReliability(true);
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
      setLayout((l) => {
        if (l.sidebarCollapsed) return l;
        const n = { ...l, sidebarCollapsed: true };
        saveLayout(localStorage, n);
        return n;
      });
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
        // File tree stays closed unless the user opens it.
        return next;
      });
      openAsidePane();
    },
    toggleVoice: () => {
      toggleVoice();
    },
    cancelVoice: () => {
      cancelVoice();
    },
    startLiveVoice: () => {
      if (!voiceGate.available) {
        showToast(
          voiceErrorMessage(voiceGate.reason ?? "not_available"),
          4200,
        );
        return;
      }
      if (voiceIsActive(voiceRef.current.phase)) {
        cancelVoice();
      }
      setLiveVoiceOpen(true);
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
  useEffect(() => {
    setDesktopNotifySessionFocusHandler((sessionId) => {
      trayHandlersRef.current.openSessionById(sessionId);
    });
    return () => {
      setDesktopNotifySessionFocusHandler(null);
    };
  }, []);

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
   * Host always prevent_close + emits app://close-requested; we confirm if busy.
   * When confirming, optionally append an honest automations-after-quit note
   * (no fake detached daemon — schedules pause until the app is reopened).
   * Secondary windows never quit the process from their chrome.
   */
  const requestAppQuit = useCallback(() => {
    if (isSecondaryWindowRef.current) return;
    let busyCount = countBusyLiveMapSessions(liveMapRef.current);
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
    // Enrich with automations note when list is available; fail soft.
    void (async () => {
      let message = busyMessage;
      try {
        const rows = await api.automationsList();
        const enabledCount = rows.filter((r) => r.enabled).length;
        const bg = automationsBackgroundStatus({
          openAtLogin: launchAtLogin,
          enabledCount,
          runnerKnown: api.isTauri(),
        });
        if (bg.quitNoteKey) {
          message = `${busyMessage}\n\n${tr(bg.quitNoteKey)}`;
        }
      } catch {
        /* ignore — busy confirm still works without the note */
      }
      setAppDialog({
        kind: "confirm",
        title: tr("app.quitBusy.title"),
        message,
        confirmLabel: tr("app.quitBusy.confirm"),
        danger: true,
        onConfirm: () => {
          void api.appForceQuit();
        },
      });
    })();
  }, [tr, launchAtLogin]);

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
    setRecentErrorEntries((prev) =>
      prependReliabilityRing(prev, entry, DEFAULT_RELIABILITY_MAX_ERRORS),
    );
  }, [
    errorBanner?.code,
    errorBanner?.summary,
    errorBanner?.cause,
    error,
    session.sessionId,
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
      void api
        .sessionResolvePermission({
          rpcId: p.rpcId,
          decision,
          optionId,
          scopeKey: p.scopeKey,
          // Background turns raise permissions on their own ACP child.
          sessionId: p.sessionId,
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
          showToast(
            code === "UNSUPPORTED"
              ? tr("mirror.unsupported")
              : String(e),
            4000,
          );
        });
    },
    [clearPendingGates, showToast, tr],
  );

  const denyActivePermission = useCallback(
    (p: PermissionPayload) => {
      const deny = mapPermissionButtons(p.options, {
        allowOnce: tr("perm.allowOnce"),
        allowSession: tr("perm.allowSession"),
        deny: tr("perm.deny"),
      }).find((b) => b.decision === "deny");
      if (!deny) return;
      resolvePermission(p, deny.decision, deny.optionId);
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
      setPermCountdownSec(null);
      return;
    }
    const startedAt = Date.now();
    setPermCountdownSec(
      permissionTimeoutRemainingSec(startedAt, permissionTimeoutSec, startedAt),
    );
    const tick = window.setInterval(() => {
      setPermCountdownSec(
        permissionTimeoutRemainingSec(
          startedAt,
          permissionTimeoutSec,
          Date.now(),
        ),
      );
    }, 250);
    const t = window.setTimeout(() => {
      denyActivePermission(perm);
    }, permissionTimeoutSec * 1000);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(tick);
      setPermCountdownSec(null);
    };
  }, [perm, permissionTimeoutSec, denyActivePermission]);

  /** T04 deck buttons: reconnect / Doctor / Settings sections / project / MCP / dismiss. */
  const runErrorBannerAction = useCallback(
    (action: NonNullable<ErrorBannerView["primary"]>) => {
      setErrorDetailOpen(false);
      switch (action.id) {
        case "reconnect":
          setLocalError(null);
          void ensureConnected(true).then((sid) => {
            if (sid) setLocalError(null);
          });
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
    async (opts?: { refreshBilling?: boolean }) => {
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
      setAccountLoading(true);
      try {
        const st = await api.accountStatus({
          refreshBilling: opts?.refreshBilling ?? true,
          manualCliPath: manualCliPath || null,
        });
        setAccount(st);
        setAccountHeatmapError(null);
        setAccountProbeError(null);
        setSetup((s) => ({
          ...s,
          auth: isAccountConnected(st),
          cli: st.cliFound || s.cli,
        }));
        try {
          const list = await api.accountsList();
          setSavedAccounts(list.profiles ?? []);
          setActiveAccountId(list.activeId ?? null);
        } catch {
          // multi-account list is best-effort
        }
        // Usage line on tray menu (Codex-style)
        void api.trayRefresh();
      } catch (e) {
        console.warn("account status failed", e);
        setAccountHeatmapError(e);
        setAccountProbeError(e);
      } finally {
        setAccountLoading(false);
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

  type ExportMdTarget = {
    id: string;
    title: string;
    projectId?: string | null;
  };
  const [exportMdTarget, setExportMdTarget] = useState<ExportMdTarget | null>(
    null,
  );
  const [exportMdIncludeThoughts, setExportMdIncludeThoughts] = useState(true);
  const [exportMdIncludeTools, setExportMdIncludeTools] = useState(true);
  const [exportMdBusy, setExportMdBusy] = useState(false);

  type ExportImageTarget = {
    id: string;
    title: string;
    projectId?: string | null;
  };
  const [exportImageTarget, setExportImageTarget] =
    useState<ExportImageTarget | null>(null);
  /** Smart summary poster vs full transcript card. */
  const [exportImageSmart, setExportImageSmart] = useState(true);
  /** Curated visual skin for smart + full export cards. */
  const [exportImageSkin, setExportImageSkin] = useState<ShareCardSkinId>(() =>
    loadExportImageSkinPref(),
  );
  const [exportImageBusy, setExportImageBusy] = useState(false);
  /** Object URL for share-card preview (revoked on close / re-render). */
  const [exportImagePreviewUrl, setExportImagePreviewUrl] = useState<
    string | null
  >(null);
  const [exportImagePreviewError, setExportImagePreviewError] = useState<
    string | null
  >(null);
  /** Honest meta for the last successful preview (skin / layout / bytes). */
  const [exportImagePreviewStamp, setExportImagePreviewStamp] =
    useState<ExportImageBlobStamp | null>(null);
  const exportImagePreviewBlobRef = useRef<Blob | null>(null);
  const exportImagePreviewStampRef = useRef<ExportImageBlobStamp | null>(null);
  /**
   * Freeze chat rows when the export dialog opens so live streaming does not
   * re-trigger rasterization (modal flicker).
   */
  const exportImageMsgsSnapRef = useRef<ChatMessage[] | null>(null);
  const exportImageGenRef = useRef(0);

  /** Build markdown for a session; used by download + copy. */
  const buildSessionMarkdown = useCallback(
    async (
      sessionMeta: ExportMdTarget | undefined,
      options: { includeThoughts: boolean; includeToolSummary: boolean },
    ) => {
      const id = sessionMeta?.id ?? session.sessionId;
      if (!id) {
        const err = new Error("no target");
        (err as Error & { code?: string }).code = "no_target";
        throw err;
      }
      const title =
        sessionMeta?.title ||
        sessions.find((s) => s.id === id)?.title ||
        session.title ||
        tr("session.untitled");
      const projectId =
        sessionMeta?.projectId ??
        sessions.find((s) => s.id === id)?.projectId ??
        null;
      const proj =
        projects.find((p) => p.id === projectId) || activeProject || null;
      let msgs = messages;
      if (id !== session.sessionId) {
        try {
          msgs = (await api.sessionMessages(id)) as ChatMessage[];
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          (err as Error & { code?: string }).code = "load_failed";
          throw err;
        }
      }
      const exportable = msgs.map((m) => ({
        role: m.role,
        content: m.content,
        thought: m.thought,
        createdAt: m.createdAt,
        marker: m.marker,
      }));
      const journalEmpty = isSessionExportJournalEmpty(exportable, {
        format: "markdown",
        options,
      });
      const md = sessionToMarkdown({
        title,
        projectName: proj?.name,
        projectPath: proj?.path,
        sessionId: id,
        options: {
          includeThoughts: options.includeThoughts,
          includeToolSummary: options.includeToolSummary,
        },
        messages: exportable,
      });
      return { id, title, md, journalEmpty, exportable };
    },
    [
      session.sessionId,
      session.title,
      sessions,
      messages,
      projects,
      activeProject,
      tr,
    ],
  );

  /** Toast classified soft-fail for text-format export (silent on cancel). */
  const toastSessionExportSoftFail = useCallback(
    (err: unknown) => {
      const r = resolveSessionExportSoftFail(err);
      if (r.silent) return;
      const base = tr(r.messageKey as Parameters<typeof tr>[0]);
      showToast(r.detail ? `${base}: ${r.detail}` : base);
    },
    [showToast, tr],
  );

  /** Open export options (thoughts / tools / download / copy). */
  const openExportSessionMd = useCallback(
    (sessionMeta?: {
      id: string;
      title: string;
      projectId?: string | null;
    }) => {
      const id = sessionMeta?.id ?? session.sessionId;
      if (!id) {
        showToast(tr("session.exportNoTarget"));
        return;
      }
      setExportMdIncludeThoughts(true);
      setExportMdIncludeTools(true);
      setExportMdTarget({
        id,
        title:
          sessionMeta?.title ||
          sessions.find((s) => s.id === id)?.title ||
          session.title ||
          tr("session.untitled"),
        projectId:
          sessionMeta?.projectId ??
          sessions.find((s) => s.id === id)?.projectId ??
          null,
      });
    },
    [session.sessionId, session.title, sessions, showToast, tr],
  );

  /**
   * Honest empty + size estimate for the open Markdown export dialog when the
   * target is the live session (options toggle updates emptiness).
   */
  const exportMdHonesty = useMemo(() => {
    if (!exportMdTarget) {
      return {
        journalEmpty: null as boolean | null,
        sizeClassKey: null as string | null,
        sizeBytesLabel: null as string | null,
        canAct: false,
      };
    }
    if (exportMdTarget.id !== session.sessionId) {
      return {
        journalEmpty: null as boolean | null,
        sizeClassKey: null as string | null,
        sizeBytesLabel: null as string | null,
        canAct: canSessionExportActions({
          hasTarget: true,
          journalEmpty: null,
          busy: exportMdBusy,
        }),
      };
    }
    const exportable = messages.map((m) => ({
      role: m.role,
      content: m.content,
      thought: m.thought,
      createdAt: m.createdAt,
      marker: m.marker,
    }));
    const options = {
      includeThoughts: exportMdIncludeThoughts,
      includeToolSummary: exportMdIncludeTools,
    };
    const journalEmpty = isSessionExportJournalEmpty(exportable, {
      format: "markdown",
      options,
    });
    const md = sessionToMarkdown({
      title: exportMdTarget.title || tr("session.untitled"),
      sessionId: exportMdTarget.id,
      options,
      messages: exportable,
    });
    const est = estimateSessionExportSizeClass(journalEmpty ? "" : md);
    return {
      journalEmpty,
      sizeClassKey: sessionExportSizeClassLabelKey(est.sizeClass),
      sizeBytesLabel: formatSessionExportBytes(est.byteLength),
      canAct: canSessionExportActions({
        hasTarget: true,
        journalEmpty,
        busy: exportMdBusy,
      }),
    };
  }, [
    exportMdTarget,
    exportMdIncludeThoughts,
    exportMdIncludeTools,
    exportMdBusy,
    session.sessionId,
    messages,
    tr,
  ]);

  const runExportSessionMd = useCallback(
    async (mode: "download" | "copy") => {
      if (!exportMdTarget) return;
      setExportMdBusy(true);
      try {
        const exportOpts = {
          includeThoughts: exportMdIncludeThoughts,
          includeToolSummary: exportMdIncludeTools,
        };
        // Prefer CLI `grok export` for full-transcript download when linked;
        // soft-fail to local journal (thoughts/tools options always apply locally).
        if (
          mode === "download" &&
          shouldPreferCliMarkdownExport(exportOpts)
        ) {
          try {
            const cli = await api.sessionCliExport(exportMdTarget.id);
            const md = typeof cli?.markdown === "string" ? cli.markdown : "";
            if (cli?.ok && md.trim()) {
              const blob = new Blob([md], {
                type: sessionExportMimeType("markdown"),
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = sessionExportSafeFilename(
                "markdown",
                exportMdTarget.title,
                exportMdTarget.id,
              );
              a.click();
              URL.revokeObjectURL(url);
              setExportMdTarget(null);
              return;
            }
          } catch {
            // Soft-fail: local journal below.
          }
        }
        const { id, title, md, journalEmpty } = await buildSessionMarkdown(
          exportMdTarget,
          exportOpts,
        );
        if (journalEmpty) {
          showToast(tr("session.exportEmpty"));
          return;
        }
        if (mode === "copy") {
          try {
            await navigator.clipboard.writeText(md);
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            (err as Error & { code?: string }).code = "clipboard";
            toastSessionExportSoftFail(err);
            return;
          }
        } else {
          try {
            const blob = new Blob([md], {
              type: sessionExportMimeType("markdown"),
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = sessionExportSafeFilename("markdown", title, id);
            a.click();
            URL.revokeObjectURL(url);
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            (err as Error & { code?: string }).code = "write_failed";
            toastSessionExportSoftFail(err);
            return;
          }
        }
        setExportMdTarget(null);
      } catch (e) {
        toastSessionExportSoftFail(e);
      } finally {
        setExportMdBusy(false);
      }
    },
    [
      exportMdTarget,
      exportMdIncludeThoughts,
      exportMdIncludeTools,
      buildSessionMarkdown,
      showToast,
      toastSessionExportSoftFail,
      tr,
    ],
  );

  /**
   * One-click copy of the full conversation as Markdown.
   * Skips pure tool_step noise by default (unlike the export dialog).
   */
  const copyConversationMarkdown = useCallback(
    async (sessionMeta?: {
      id: string;
      title: string;
      projectId?: string | null;
    }) => {
      const id = sessionMeta?.id ?? session.sessionId;
      if (!id) {
        showToast(tr("session.exportNoTarget"));
        return;
      }
      try {
        const { md, journalEmpty } = await buildSessionMarkdown(
          {
            id,
            title:
              sessionMeta?.title ||
              sessions.find((s) => s.id === id)?.title ||
              session.title ||
              tr("session.untitled"),
            projectId:
              sessionMeta?.projectId ??
              sessions.find((s) => s.id === id)?.projectId ??
              null,
          },
          {
            includeThoughts: true,
            includeToolSummary: false,
          },
        );
        if (journalEmpty || !md.trim()) {
          showToast(tr("session.copyMdEmpty"));
          return;
        }
        await navigator.clipboard.writeText(md);
      } catch (e) {
        toastSessionExportSoftFail(e);
      }
    },
    [
      session.sessionId,
      session.title,
      sessions,
      buildSessionMarkdown,
      showToast,
      toastSessionExportSoftFail,
      tr,
    ],
  );

  /** Quick export with defaults (slash /export, message actions). */
  const exportActiveSessionMd = useCallback(
    async (sessionMeta?: {
      id: string;
      title: string;
      projectId?: string | null;
    }) => {
      openExportSessionMd(sessionMeta);
    },
    [openExportSessionMd],
  );

  /**
   * Download session as import-friendly JSON (user/assistant only; no modal).
   * Reuses the same message loading path as Markdown export.
   */
  const exportSessionJson = useCallback(
    async (sessionMeta?: {
      id: string;
      title: string;
      projectId?: string | null;
    }) => {
      const id = sessionMeta?.id ?? session.sessionId;
      if (!id) {
        showToast(tr("session.exportNoTarget"));
        return;
      }
      const title =
        sessionMeta?.title ||
        sessions.find((s) => s.id === id)?.title ||
        session.title ||
        tr("session.untitled");
      try {
        let msgs = messages;
        if (id !== session.sessionId) {
          try {
            msgs = (await api.sessionMessages(id)) as ChatMessage[];
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            (err as Error & { code?: string }).code = "load_failed";
            toastSessionExportSoftFail(err);
            return;
          }
        }
        const exportable = msgs.map((m) => ({
          role: m.role,
          content: m.content,
          thought: m.thought,
          createdAt: m.createdAt,
          marker: m.marker,
        }));
        if (
          isSessionExportJournalEmpty(exportable, {
            format: "json",
            options: { includeThoughts: false, includeToolSummary: false },
          })
        ) {
          showToast(tr("session.exportEmpty"));
          return;
        }
        const json = sessionToJson({
          title,
          sessionId: id,
          // Clean re-import: omit thoughts/tools by default.
          options: { includeThoughts: false, includeToolSummary: false },
          messages: exportable,
        });
        const blob = new Blob([json], {
          type: sessionExportMimeType("json"),
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = sessionExportSafeFilename("json", title, id);
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        toastSessionExportSoftFail(e);
      }
    },
    [
      session.sessionId,
      session.title,
      sessions,
      messages,
      showToast,
      toastSessionExportSoftFail,
      tr,
    ],
  );

  const revokeExportImagePreview = useCallback(() => {
    setExportImagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    exportImagePreviewBlobRef.current = null;
    exportImagePreviewStampRef.current = null;
    setExportImagePreviewStamp(null);
    setExportImagePreviewError(null);
  }, []);

  const closeExportSessionImage = useCallback(() => {
    if (exportImageBusy) return;
    revokeExportImagePreview();
    exportImageMsgsSnapRef.current = null;
    setExportImageTarget(null);
  }, [exportImageBusy, revokeExportImagePreview]);

  /** Open share-card export (PNG) options dialog. */
  const openExportSessionImage = useCallback(
    (sessionMeta?: {
      id: string;
      title: string;
      projectId?: string | null;
    }) => {
      const id = sessionMeta?.id ?? session.sessionId;
      if (!id) {
        showToast(tr("session.exportImageNoTarget"));
        return;
      }
      // Invalidate any prior session's preview immediately so session B never
      // shows/saves session A's blob while B is still rendering (AC cross-session).
      exportImageGenRef.current += 1;
      revokeExportImagePreview();
      setExportImagePreviewError(null);
      setExportImageBusy(true);

      // Snapshot live transcript once — do not follow streaming updates.
      // Other sessions: null → builder loads via sessionMessages(id).
      const snap =
        id === session.sessionId
          ? (messages as ChatMessage[]).map((m) => ({ ...m }))
          : null;
      exportImageMsgsSnapRef.current = snap;
      setExportImageSmart(true);
      setExportImageSkin(loadExportImageSkinPref());
      setExportImageTarget({
        id,
        title:
          sessionMeta?.title ||
          sessions.find((s) => s.id === id)?.title ||
          session.title ||
          tr("session.untitled"),
        projectId:
          sessionMeta?.projectId ??
          sessions.find((s) => s.id === id)?.projectId ??
          null,
      });
    },
    [
      session.sessionId,
      session.title,
      sessions,
      messages,
      showToast,
      tr,
      revokeExportImagePreview,
    ],
  );

  /** Build share-card model + PNG blob for the open export dialog. */
  const buildExportImageBlob = useCallback(async () => {
    if (!exportImageTarget) throw new Error("no target");
    const id = exportImageTarget.id;
    const title =
      exportImageTarget.title ||
      sessions.find((s) => s.id === id)?.title ||
      session.title ||
      tr("session.untitled");
    const projectId =
      exportImageTarget.projectId ??
      sessions.find((s) => s.id === id)?.projectId ??
      null;
    const proj =
      projects.find((p) => p.id === projectId) || activeProject || null;

    let msgs = exportImageMsgsSnapRef.current;
    if (!msgs) {
      if (id !== session.sessionId) {
        msgs = (await api.sessionMessages(id)) as ChatMessage[];
      } else {
        msgs = messages as ChatMessage[];
      }
      exportImageMsgsSnapRef.current = msgs.map((m) => ({ ...m }));
    }

    // Resolve session-relative media (`images/1.jpg`) into message attachments —
    // same path chat uses before MarkdownChat / ImageUi render.
    let msgsForExport = msgs;
    if (api.isTauri() && !exportImageSmart) {
      try {
        const rels = collectSessionRelativeMediaRefs(msgs);
        if (rels.length) {
          const list = await api.sessionResolveRelativeMedia(id, rels);
          if (list.length) {
            msgsForExport = applyResolvedSessionMedia(
              msgs.map((m) => ({
                ...m,
                attachments: m.attachments?.map((a) => ({ ...a })),
              })),
              list.map((a) => ({
                path: a.path,
                name: a.name || a.path.split(/[/\\]/).pop() || a.path,
                isDir: !!a.isDir,
              })),
            ) as typeof msgs;
          }
        }
      } catch {
        /* best-effort */
      }
    }

    const projectPath = proj?.path ?? activeProject?.path ?? null;
    let shareMsgs: ShareCardMessage[];
    if (exportImageSmart) {
      shareMsgs = exportableToShareMessages(
        msgsForExport.map((m) => ({
          role: m.role,
          content: m.content,
          thought: m.thought,
          createdAt: m.createdAt,
          marker: m.marker,
        })),
      );
    } else {
      // Mirror lobe ConversationThread path map construction.
      const sessionPathMap = buildSessionFilePathMap(
        msgsForExport as ChatMessage[],
        projectPath,
      );
      shareMsgs = [];
      for (const m of msgsForExport) {
        if (m.role === "tool" || m.marker === "tool_step") continue;
        const atts = (m.attachments ?? []).map((a) => ({
          path: a.path,
          name: a.name || a.path.split(/[/\\]/).pop() || a.path,
          isDir: !!a.isDir,
        }));
        const imagePathMap = mergePathMaps(
          buildInlineMediaPathMap(atts),
          sessionPathMap,
        );
        shareMsgs.push({
          role: m.role,
          content: m.content || "",
          thought: m.thought,
          createdAt: m.createdAt,
          attachments: atts.length ? atts : undefined,
          imagePathMap:
            Object.keys(imagePathMap).length > 0 ? imagePathMap : undefined,
        });
      }
    }

    const logoDataUrl = loadExportLogoPref();
    const result = await buildExportImagePipeline({
      title,
      projectName: proj?.name,
      projectPath,
      sessionId: id,
      messages: shareMsgs,
      smart: exportImageSmart,
      skinId: exportImageSkin,
      logoDataUrl,
      pixelRatio: 2,
      locale,
    });
    const stamp = stampFromPipelineResult(
      { sessionId: id, skinId: exportImageSkin, smart: exportImageSmart },
      {
        skinId: result.skinId,
        mode: result.mode,
        layout: result.layout ?? null,
        byteLength: result.byteLength,
        messageCount: result.messageCount,
      },
    );
    return {
      blob: result.blob,
      title,
      id,
      skinId: result.skinId,
      stamp,
    };
  }, [
    exportImageTarget,
    exportImageSmart,
    exportImageSkin,
    session.sessionId,
    session.title,
    sessions,
    messages,
    projects,
    activeProject,
    locale,
    tr,
  ]);

  // Keep latest builder without re-firing the preview effect on every stream tick.
  const buildExportImageBlobRef = useRef(buildExportImageBlob);
  buildExportImageBlobRef.current = buildExportImageBlob;

  /** Preview refresh: dialog target, smart toggle, or skin change. */
  useEffect(() => {
    if (!exportImageTarget) {
      revokeExportImagePreview();
      exportImageMsgsSnapRef.current = null;
      return;
    }
    const gen = ++exportImageGenRef.current;
    let cancelled = false;
    // Always invalidate prior preview when rebuilding (session / smart / skin).
    // Leaving the old blob makes Save/Copy export the wrong mode or skin.
    revokeExportImagePreview();
    setExportImageBusy(true);
    setExportImagePreviewError(null);
    void (async () => {
      try {
        const built = await buildExportImageBlobRef.current();
        if (cancelled || gen !== exportImageGenRef.current) return;
        // Guard: never attach a blob built for another session id.
        const targetId = exportImageTarget?.id;
        if (targetId && built.id !== targetId) return;
        const { blob, stamp } = built;
        // Honesty: stamp must match the options this effect was built for.
        if (
          !exportImageBlobMatchesOptions(stamp, {
            sessionId: targetId || stamp.sessionId,
            skinId: exportImageSkin,
            smart: exportImageSmart,
          })
        ) {
          return;
        }
        const url = URL.createObjectURL(blob);
        setExportImagePreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        exportImagePreviewBlobRef.current = blob;
        exportImagePreviewStampRef.current = stamp;
        setExportImagePreviewStamp(stamp);
        setExportImagePreviewError(null);
      } catch (e) {
        if (cancelled || gen !== exportImageGenRef.current) return;
        revokeExportImagePreview();
        const resolved = resolveExportImageError(e);
        if (resolved.silent) {
          setExportImagePreviewError(null);
        } else {
          const base = tr(resolved.messageKey as Parameters<typeof tr>[0]);
          setExportImagePreviewError(
            resolved.detail ? `${base}: ${resolved.detail}` : base,
          );
        }
      } finally {
        if (!cancelled && gen === exportImageGenRef.current) {
          setExportImageBusy(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    exportImageTarget?.id,
    exportImageTarget?.title,
    exportImageTarget?.projectId,
    exportImageSmart,
    exportImageSkin,
    revokeExportImagePreview,
    tr,
  ]);

  const exportImageOptionsMatch = exportImageBlobMatchesOptions(
    exportImagePreviewStamp,
    {
      sessionId: exportImageTarget?.id ?? "",
      skinId: exportImageSkin,
      smart: exportImageSmart,
    },
  );
  // Ready for Save/Copy only when preview URL + stamp match current options.
  const exportImageCanAct = canExportImageActions({
    open: !!exportImageTarget,
    hasMatchingBlob: !!exportImagePreviewUrl && exportImageOptionsMatch,
  });
  const exportImagePreviewPhase = deriveExportImagePreviewPhase({
    open: !!exportImageTarget,
    busy: exportImageBusy,
    hasPreviewUrl: !!exportImagePreviewUrl && exportImageOptionsMatch,
    hasError: !!exportImagePreviewError,
  });
  const exportImageMetaParts = buildExportImageMetaParts({
    stamp: exportImageOptionsMatch ? exportImagePreviewStamp : null,
    skinId: exportImageSkin,
    smart: exportImageSmart,
  });
  const exportImageBytesLabel = formatExportImageBytes(
    exportImageOptionsMatch ? exportImagePreviewStamp?.byteLength : null,
  );

  const runExportSessionImage = useCallback(
    async (mode: "download" | "copy") => {
      if (!exportImageTarget) return;
      // Never save a mid-rebuild / stale-skin preview.
      const options = {
        sessionId: exportImageTarget.id,
        skinId: exportImageSkin,
        smart: exportImageSmart,
      };
      const stampOk = exportImageBlobMatchesOptions(
        exportImagePreviewStampRef.current,
        options,
      );
      if (exportImageBusy && !(exportImagePreviewBlobRef.current && stampOk)) {
        return;
      }
      setExportImageBusy(true);
      try {
        let blob = stampOk ? exportImagePreviewBlobRef.current : null;
        let title = exportImageTarget.title;
        let id = exportImageTarget.id;
        // Rebuild when no matching blob (cleared on smart/skin toggle / open).
        if (!blob) {
          const built = await buildExportImageBlob();
          blob = built.blob;
          title = built.title;
          id = built.id;
          exportImagePreviewBlobRef.current = blob;
          exportImagePreviewStampRef.current = built.stamp;
          setExportImagePreviewStamp(built.stamp);
        } else {
          title =
            exportImageTarget.title ||
            sessions.find((s) => s.id === id)?.title ||
            session.title ||
            tr("session.untitled");
        }
        const filename = sessionExportImageFilename(title, id);
        if (mode === "copy") {
          // Prefer native OS clipboard (arboard). WebView ClipboardItem often fails.
          if (api.isTauri()) {
            const b64 = await pngBlobToBase64(blob);
            await api.clipboardWriteImage(b64);
          } else {
            const ok = await copyPngBlob(blob);
            if (!ok) {
              const err = new Error("clipboard blocked");
              (err as Error & { code?: string }).code = "clipboard";
              throw err;
            }
          }
        } else if (api.isTauri()) {
          const b64 = await pngBlobToBase64(blob);
          const result = await api.exportBytesSave({
            bytesBase64: b64,
            defaultName: filename,
            dialogTitle: tr("session.exportImageSaveTitle"),
            filterName: "PNG",
            extensions: ["png"],
          });
          if (result.cancelled) {
            // User dismissed the native save dialog — keep modal open (silent).
            return;
          }
          if (!result.ok) {
            const err = new Error(result.path || "save failed");
            (err as Error & { code?: string }).code = "save_failed";
            throw err;
          }
        } else {
          // Browser / non-Tauri fallback.
          downloadPngBlob(blob, filename);
        }
        revokeExportImagePreview();
        exportImageMsgsSnapRef.current = null;
        setExportImageTarget(null);
      } catch (e) {
        const resolved = resolveExportImageError(e);
        if (resolved.silent) return;
        const base = tr(resolved.messageKey as Parameters<typeof tr>[0]);
        showToast(resolved.detail ? `${base}: ${resolved.detail}` : base);
      } finally {
        setExportImageBusy(false);
      }
    },
    [
      exportImageBusy,
      exportImageTarget,
      exportImageSkin,
      exportImageSmart,
      buildExportImageBlob,
      session.sessionId,
      session.title,
      sessions,
      showToast,
      tr,
      revokeExportImagePreview,
    ],
  );

  /**
   * Download session as plain text (headless `--output-format plain` style).
   * Local journal only; no modal. Thoughts + tool summaries on by default.
   */
  const exportSessionPlain = useCallback(
    async (sessionMeta?: {
      id: string;
      title: string;
      projectId?: string | null;
    }) => {
      const id = sessionMeta?.id ?? session.sessionId;
      if (!id) {
        showToast(tr("session.exportNoTarget"));
        return;
      }
      const title =
        sessionMeta?.title ||
        sessions.find((s) => s.id === id)?.title ||
        session.title ||
        tr("session.untitled");
      const projectId =
        sessionMeta?.projectId ??
        sessions.find((s) => s.id === id)?.projectId ??
        null;
      const proj =
        projects.find((p) => p.id === projectId) || activeProject || null;
      try {
        let msgs = messages;
        if (id !== session.sessionId) {
          try {
            msgs = (await api.sessionMessages(id)) as ChatMessage[];
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            (err as Error & { code?: string }).code = "load_failed";
            toastSessionExportSoftFail(err);
            return;
          }
        }
        const exportable = msgs.map((m) => ({
          role: m.role,
          content: m.content,
          thought: m.thought,
          createdAt: m.createdAt,
          marker: m.marker,
        }));
        if (
          isSessionExportJournalEmpty(exportable, {
            format: "plain",
            options: { includeThoughts: true, includeToolSummary: true },
          })
        ) {
          showToast(tr("session.exportEmpty"));
          return;
        }
        const text = sessionToPlain({
          title,
          projectName: proj?.name,
          projectPath: proj?.path,
          sessionId: id,
          options: { includeThoughts: true, includeToolSummary: true },
          messages: exportable,
        });
        const blob = new Blob([text], {
          type: sessionExportMimeType("plain"),
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = sessionExportSafeFilename("plain", title, id);
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        toastSessionExportSoftFail(e);
      }
    },
    [
      session.sessionId,
      session.title,
      sessions,
      messages,
      projects,
      activeProject,
      showToast,
      toastSessionExportSoftFail,
      tr,
    ],
  );

  /**
   * Download session as a standalone HTML page (blob save).
   * Defaults match Markdown file export: thoughts + tool summaries on.
   */
  const exportSessionHtml = useCallback(
    async (sessionMeta?: {
      id: string;
      title: string;
      projectId?: string | null;
    }) => {
      const id = sessionMeta?.id ?? session.sessionId;
      if (!id) {
        showToast(tr("session.exportNoTarget"));
        return;
      }
      const title =
        sessionMeta?.title ||
        sessions.find((s) => s.id === id)?.title ||
        session.title ||
        tr("session.untitled");
      const projectId =
        sessionMeta?.projectId ??
        sessions.find((s) => s.id === id)?.projectId ??
        null;
      const proj =
        projects.find((p) => p.id === projectId) || activeProject || null;
      try {
        let msgs = messages;
        if (id !== session.sessionId) {
          try {
            msgs = (await api.sessionMessages(id)) as ChatMessage[];
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            (err as Error & { code?: string }).code = "load_failed";
            toastSessionExportSoftFail(err);
            return;
          }
        }
        const exportable = msgs.map((m) => ({
          role: m.role,
          content: m.content,
          thought: m.thought,
          createdAt: m.createdAt,
          marker: m.marker,
        }));
        if (
          isSessionExportJournalEmpty(exportable, {
            format: "html",
            options: { includeThoughts: true, includeToolSummary: true },
          })
        ) {
          showToast(tr("session.exportEmpty"));
          return;
        }
        const html = sessionToHtml({
          title,
          projectName: proj?.name,
          projectPath: proj?.path,
          sessionId: id,
          options: { includeThoughts: true, includeToolSummary: true },
          messages: exportable,
        });
        const blob = new Blob([html], {
          type: sessionExportMimeType("html"),
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = sessionExportSafeFilename("html", title, id);
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        toastSessionExportSoftFail(e);
      }
    },
    [
      session.sessionId,
      session.title,
      sessions,
      messages,
      projects,
      activeProject,
      showToast,
      toastSessionExportSoftFail,
      tr,
    ],
  );

  /**
   * Download session journal as redacted ACP streaming NDJSON
   * (`streaming-json` or `streaming-messages-json`). Soft-empty toast when
   * the journal has no exportable rows.
   */
  const exportSessionStreamNdjson = useCallback(
    async (
      format: StreamSessionExportFormat,
      sessionMeta?: {
        id: string;
        title: string;
        projectId?: string | null;
      },
    ) => {
      const id = sessionMeta?.id ?? session.sessionId;
      if (!id) {
        showToast(tr("session.exportFail"));
        return;
      }
      const title =
        sessionMeta?.title ||
        sessions.find((s) => s.id === id)?.title ||
        session.title ||
        tr("session.untitled");
      const projectId =
        sessionMeta?.projectId ??
        sessions.find((s) => s.id === id)?.projectId ??
        null;
      const proj =
        projects.find((p) => p.id === projectId) || activeProject || null;
      try {
        let msgs = messages;
        if (id !== session.sessionId) {
          msgs = (await api.sessionMessages(id)) as ChatMessage[];
        }
        const result = buildStreamSessionNdjson(format, {
          title,
          projectName: proj?.name,
          projectPath: proj?.path,
          sessionId: id,
          options: { includeThoughts: true, includeToolSummary: true },
          messages: msgs.map((m) => ({
            role: m.role,
            content: m.content,
            thought: m.thought,
            createdAt: m.createdAt,
            marker: m.marker,
          })),
        });
        if (result.empty || !result.body) {
          showToast(tr("session.exportStreamEmpty"));
          return;
        }
        const blob = new Blob([result.body], {
          type: streamSessionExportMimeType(format),
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = streamSessionExportFilename(format, title, id);
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        showToast(`${tr("session.exportFail")}: ${String(e)}`);
      }
    },
    [
      session.sessionId,
      session.title,
      sessions,
      messages,
      projects,
      activeProject,
      showToast,
      tr,
    ],
  );

  /** Full diagnostic zip (messages + agent trail + logs) for bug reports. */
  const exportSessionDiagnostic = useCallback(
    async (sessionId?: string | null) => {
      const id = sessionId || session.sessionId;
      if (!id) {
        showToast(tr("session.exportBundleFail"));
        return;
      }
      try {
        const res = await api.exportSessionBundle(id);
        if (!(res?.ok && res.path)) {
          showToast(tr("session.exportBundleFail"));
        }
      } catch (e) {
        showToast(`${tr("session.exportBundleFail")}: ${String(e)}`, 5000);
      }
    },
    [session.sessionId, showToast, tr],
  );

  /**
   * Export Grok Build CLI session trace.
   * `localOnly` default true → `grok trace --local`. False omits `--local` (may upload).
   */
  const exportSessionTrace = useCallback(
    async (
      sessionId?: string | null,
      opts?: { localOnly?: boolean },
    ) => {
      const id = sessionId || session.sessionId;
      const localOnly = opts?.localOnly !== false;
      if (!id) {
        showToast(tr("session.exportTraceFail"));
        return;
      }
      try {
        const res = await api.sessionTraceExport(id, { localOnly });
        if (res?.ok && res.path) {
          const row = sessions.find((s) => s.id === id);
          const uploaded = res.uploaded === true;
          recordTraceExport({
            sessionId: id,
            path: res.path,
            title: row?.title ?? null,
            sizeBytes:
              typeof res.sizeBytes === "number" ? res.sizeBytes : null,
            uploaded: uploaded || null,
          });
          if (!localOnly && !uploaded) {
            // Network allowed but CLI only wrote local (upload disabled / fallback).
            showToast(tr("session.exportTraceDoneLocalFallback"), 5000);
          }
        } else {
          showToast(tr("session.exportTraceFail"));
        }
      } catch (e) {
        const msg = String(e);
        if (/no agent session/i.test(msg)) {
          showToast(tr("session.exportTraceNoAgent"), 5000);
        } else if (/cli not found|grok build cli not found/i.test(msg)) {
          showToast(`${tr("session.exportTraceFail")}: ${tr("session.exportTraceNoCli")}`, 5500);
        } else if (/timed out/i.test(msg)) {
          showToast(
            `${tr("session.exportTraceFail")}: ${tr("session.exportTraceTimeout")}`,
            5500,
          );
        } else if (!localOnly && /upload|network|telemetry|403|401|forbidden/i.test(msg)) {
          showToast(
            `${tr("session.exportTraceUploadFail")}: ${msg}`,
            6000,
          );
        } else {
          // Actionable: surface host/CLI reason (already redacted server-side).
          showToast(`${tr("session.exportTraceFail")}: ${msg}`, 5500);
        }
      }
    },
    [session.sessionId, sessions, showToast, tr],
  );

  /** Confirm network upload before `grok trace` without `--local`. */
  const confirmExportSessionTraceUpload = useCallback(
    (sessionId?: string | null) => {
      const id = sessionId || session.sessionId;
      if (!id) {
        showToast(tr("session.exportTraceFail"));
        return;
      }
      setAppDialog({
        kind: "confirm",
        title: tr("session.exportTraceUploadTitle"),
        message: tr("session.exportTraceUploadMessage"),
        confirmLabel: tr("session.exportTraceUploadConfirm"),
        onConfirm: () => {
          void exportSessionTrace(id, { localOnly: false });
        },
      });
    },
    [exportSessionTrace, session.sessionId, showToast, tr],
  );

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
      await refreshAccount({ refreshBilling: false });
      if (cancelled) return;
      await refreshAccount({ refreshBilling: true });
      if (cancelled) return;
      await refreshSavedAccounts();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshAccount, refreshSavedAccounts]);

  useEffect(() => {
    if (appView === "settings" && settingsSection === "account") {
      void refreshAccount({ refreshBilling: true });
      void refreshSavedAccounts();
    }
  }, [appView, settingsSection, refreshAccount, refreshSavedAccounts]);

  const settingsLabels = useMemo(() => {
    const keys = [
      "settings.backToApp",
      "settings.searchPlaceholder",
      "settings.group.personal",
      "settings.group.system",
      "settings.nav.general",
      "settings.nav.appearance",
      "settings.nav.account",
      "settings.nav.archived",
      "settings.nav.extensions",
      "settings.nav.runtime",
      "settings.nav.shortcuts",
      "settings.nav.about",
      "settings.shortcuts.title",
      "settings.shortcuts.desc",
      "settings.archived.desc",
      "settings.archived.empty",
      "settings.archived.restore",
      "settings.archived.delete",
      "settings.archived.orphan",
      "settings.archived.selectAll",
      "settings.archived.deselectAll",
      "settings.archived.selectedCount",
      "settings.archived.totalCount",
      "settings.archived.archiveOlder",
      "settings.archived.archiveOlderDesc",
      "settings.archived.archiveOlderDays",
      "session.untitled",
      "settings.section.permissions",
      "settings.section.composer",
      "settings.section.general",
      "settings.language",
      "settings.languageDesc",
      "settings.languageSystem",
      "settings.sessionDataMode",
      "settings.sessionDataModeDesc",
      "settings.cliPath",
      "settings.cliPathDesc",
      "settings.cliNotFound",
      "settings.permissionDeep",
      "settings.permissionDeepDesc",
      "settings.preferredAgent",
      "settings.preferredAgentDesc",
      "settings.preferredAgent.default",
      "settings.preferredAgent.source.builtin",
      "settings.preferredAgent.source.bundled",
      "settings.preferredAgent.source.user",
      "settings.preferredAgent.source.project",
      "settings.agentProfilePath",
      "settings.agentProfilePathDesc",
      "settings.agentProfilePathBrowse",
      "settings.agentProfilePathClear",
      "settings.agentProfilePathPlaceholder",
      "settings.agentsJson",
      "settings.agentsJsonDesc",
      "settings.agentsJsonPlaceholder",
      "settings.agentsJsonInvalid",
      "settings.agentsJsonApply",
      "settings.agentsJsonClear",
      "settings.prefsScope",
      "settings.prefsScopeDesc",
      "settings.prefsScope.global",
      "settings.prefsScope.project",
      "settings.prefsScope.session",
      "settings.availableModels",
      "settings.availableModelsDesc",
      "settings.availableModelsEmpty",
      "settings.theme",
      "settings.themeDesc",
      "settings.themeSystem",
      "settings.themeLight",
      "settings.themeDark",
      "settings.doctorDesc",
      "settings.runDoctor",
      "settings.aboutApp",
      "composer.permissionTitle",
      "policy.ask",
      "policy.accept_edits",
      "policy.allow_for_session",
      "policy.auto",
      "policy.dont_ask",
      "policy.always_approve",
      "settings.modeIndependent",
      "settings.modeShared",
      "settings.tabOfficial",
      "settings.tabProviders",
      "settings.tabExtras",
      "settings.tabOfficialHint",
      "settings.tabProvidersHint",
      "settings.tabExtrasHint",
      "settings.openTarget",
      "settings.openTargetDesc",
      "settings.openFinder",
      "settings.sharedConfirm",
      "doctor.title",
      "doctor.close",
      "doctor.rerun",
      "doctor.copy",
      "doctor.copied",
      "doctor.loading",
      "doctor.error",
      "doctor.empty",
      "doctor.summary",
      "doctor.generatedAt",
      "doctor.level.ok",
      "doctor.level.warn",
      "doctor.level.fail",
      "doctor.check.cli",
      "doctor.check.auth",
      "doctor.check.workspace",
      "doctor.check.backend",
      "doctor.check.logs",
      "common.local",
      "common.close",
      "common.cancel",
      "account.section.profile",
      "account.section.runtime",
      "account.signedIn",
      "account.signedOut",
      "account.loginOauth",
      "account.loginDevice",
      "account.loginBusy",
      "account.loginCancel",
      "account.logout",
      "account.refresh",
      "account.refreshing",
      "account.manageUsage",
      "account.subscribe",
      "account.channel",
      "account.channel.oauth",
      "account.channel.key",
      "account.channel.relay",
      "account.channel.none",
      "account.subscription",
      "account.weeklyTitle",
      "account.quota",
      "account.quotaRemaining",
      "account.quotaUsed",
      "account.quotaUnknown",
      "account.quota.loading",
      "account.quota.loadingHint",
      "account.quota.signedOut",
      "account.quota.signedOutHint",
      "account.quota.chip.loading",
      "account.quota.chip.unknown",
      "account.quota.chip.signedOut",
      "account.quota.chip.err.network",
      "account.quota.chip.err.auth",
      "account.quota.chip.err.host_only",
      "account.quota.chip.err.other",
      "account.quota.err.network",
      "account.quota.err.networkHint",
      "account.quota.err.auth",
      "account.quota.err.authHint",
      "account.quota.err.host_only",
      "account.quota.err.host_onlyHint",
      "account.quota.err.other",
      "account.quota.err.otherHint",
      "account.period",
      "account.prepaid",
      "account.onDemand",
      "account.resetsAt",
      "account.fetchedAt",
      "account.products",
      "account.heatmap",
      "account.heatmapHint",
      "account.heatmap.less",
      "account.heatmap.more",
      "account.heatmap.noData",
      "account.heatmap.aria",
      "account.heatmap.requests",
      "account.heatmap.tokens",
      "account.callLogs",
      "account.callLogsEmpty",
      "account.col.session",
      "account.col.model",
      "account.col.turns",
      "account.col.tokens",
      "account.col.duration",
      "account.col.when",
      "account.expired",
      "account.team",
      "account.billingUnavailable",
      "account.cliAuthOk",
      "account.cliAuthMissing",
      "account.loginHelpTitle",
      "account.loginHelpBody",
      "account.loginTryDevice",
      "account.profiles",
      "account.profilesHint",
      "account.profilesEmpty",
      "account.profileSave",
      "account.profileSwitch",
      "account.profileRemove",
      "account.profileActive",
      "account.manageAccounts",
      "account.addAccount",
      "account.profileSwitch",
      "account.profileRemove",
      "account.profileActive",
      "account.importChat",
      "account.importChatHint",
      "account.importChatBtn",
    ] as const;
    const out: Record<string, string> = {};
    for (const k of keys) out[k] = tr(k);
    return out;
  }, [tr]);

  // Keep Esc→stop gate current for the capture-phase shortcut listener.
  escapeStopLiveRef.current = {
    streamingOrBusy: effectiveCanStop,
    overlayOpen: Boolean(
      appDialog ||
        showSearch ||
        showDoctor ||
        showTraces ||
        showPlanHistory ||
        planHistoryPreview ||
        planReviseOpen ||
        showShortcuts ||
        showProductTutorial ||
        showStatusModal ||
        showMcpModal ||
        showCompactModal ||
        exportMdTarget ||
        exportImageTarget ||
        rewindConfirm ||
        forkConfirm ||
        resumeRestoreConfirm ||
        worktreeCreateOpen ||
        worktreeGcOpen ||
        shipOpen ||
        projectRulesTarget ||
        agentDashboardOpen,
    ),
    permOpen: !!perm,
    askUserOpen: !!askUser,
    chatFindOpen: showChatFind,
    slashOrMenuOpen:
      composerMenuOpen || phoneToolsOpen || !!ctxMenu || showUserMenu,
    promptHistoryOpen,
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
      void addAttachmentsFromFiles(files);
    },
    [addAttachmentsFromFiles],
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
      if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
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
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const entry =
          flat[
            Math.min(Math.max(0, slashActiveIndex), Math.max(0, n - 1))
          ];
        if (!entry) return;
        if (entry.kind === "upload") void pickComposerFiles();
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
      if (e.key === "Enter" || e.key === "Tab") {
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
    if (shouldSendOnKeydown(e, composerSendKeyPref)) {
      e.preventDefault();
      const draftNow = getDraft();
      const hasBody =
        !isDraftEmpty(parseStoredContent(draftNow)) ||
        attachments.length > 0;
      if (hasBody && session.state !== "awaiting_permission") {
        void send();
      }
    }
    if (e.key === "Escape") {
      if (promptHistoryOpenRef.current) {
        closePromptHistory();
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
            data-tauri-drag-region
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

      {appGate === "ready" && (appView === "settings" ? (
                <Suspense fallback={null}>
          <SettingsPage
          section={settingsSection}
          tab={settingsTab}
          onSection={(id, nextTab) => {
          navigateSettings(id, nextTab);
          }}
          onBack={navigateWorkbench}
          phoneLayout={phoneLayout}
          focusAnchorId={settingsFocusAnchor}
          prHubHighlightPr={prHubHighlightPr}
          onFocusAnchorConsumed={() => setSettingsFocusAnchor(null)}
          labels={settingsLabels}
          locale={locale}
          localePreference={localePreference}
          onLocale={(v) => {
          const pref = parseLocalePreference(v);
          setLocalePreference(pref);
          const next = resolveLocalePreference(pref);
          setLocale(next);
          void api.settingsGet().then(async (s) => {
          // Persist preference including "system" (not the resolved catalog id).
          await api.settingsSet({ ...s, locale: pref });
          // settings_set also refreshes tray; call again so UI stays in sync if invoke fails mid-way.
          void api.trayRefresh();
          });
          }}
          theme={theme}
          themePreference={themePreference}
          onTheme={applyThemeChoice}
          themeSchedule={themeSchedule}
          onThemeSchedule={applyThemeScheduleChoice}
          showMessageTimestamps={showMessageTimestamps}
          onShowMessageTimestamps={(v) => {
          saveMessageTimestampsPref(v, localStorage);
          setShowMessageTimestamps(v);
          }}
          showReplyLength={showReplyLength}
          onShowReplyLength={(v) => {
          saveShowReplyLengthPref(v, localStorage);
          setShowReplyLength(v);
          }}
          goalOrchUiEnabled={goalOrchUiEnabled}
          onGoalOrchUiEnabled={(v) => {
          saveGoalOrchUiEnabled(v, localStorage);
          setGoalOrchUiEnabled(v);
          }}
          messageTimeFormat={messageTimeFormat}
          onMessageTimeFormat={(v) => {
          saveMessageTimeFormatPref(v, localStorage);
          setMessageTimeFormat(v);
          }}
          sidebarShowRelativeTime={sidebarShowRelativeTime}
          onSidebarShowRelativeTime={(v) => {
          saveSidebarShowRelativeTimePref(v, localStorage);
          setSidebarShowRelativeTime(v);
          }}
          mutedSessionCount={mutedSessionIds.size}
          onClearAllSessionMutes={handleClearAllSessionMutes}
          unreadSessionCount={unreadSessionIds.size}
          onClearAllSessionUnread={handleClearAllSessionUnread}
          zenMode={zenMode}
          onZenMode={setZenModeEnabled}
          skin={skin}
          onSkin={applySkinChoice}
          wallpaperUrl={wallpaperUrl}
          wallpaperKind={wallpaperRecord?.kind ?? null}
          wallpaperFocus={wallpaperRecord?.focus ?? null}
          wallpaperClip={wallpaperRecord?.clip ?? null}
          wallpaperMediaSize={
          wallpaperRecord?.width && wallpaperRecord?.height
          ? { w: wallpaperRecord.width, h: wallpaperRecord.height }
          : null
          }
          onWallpaper={applyWallpaperChoice}
          onWallpaperAdjust={applyWallpaperAdjustChoice}
          onWallpaperMediaSize={applyWallpaperMediaSize}
          wallpaperScrim={wallpaperScrim}
          onWallpaperScrim={applyWallpaperScrimChoice}
          sessionDataMode={sessionDataMode}
          onCliSessionsImported={() => {
          void refreshSessions();
          }}
          onOpenCliSession={(appSessionId) => {
          void (async () => {
          await refreshSessions();
          trayHandlersRef.current.openSessionById(appSessionId);
          })();
          }}
          onSessionDataMode={(v) => {
          const commit = () => {
          setSessionDataMode(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, sessionDataMode: v }),
          );
          };
          // Tauri WebView: window.confirm is unreliable (often always false).
          if (v === "shared") {
          setAppDialog({
          kind: "confirm",
          title: tr("settings.sessionDataMode"),
          message: tr("settings.sharedConfirm"),
          confirmLabel: tr("common.confirm"),
          onConfirm: commit,
          });
          return;
          }
          commit();
          }}
          policy={policy}
          onPolicy={(v) => {
          if (!isValidPolicy(v)) return;
          applyPermissionPolicy(v);
          }}
          prefsScope={prefsScope}
          onPrefsScope={(v) => {
          if (!isValidPrefsScope(v)) return;
          setPrefsScope(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, composerPrefsScope: v }),
          );
          void api
          .composerPrefsResolve({
          projectId: activeProject?.id ?? null,
          sessionId: session.sessionId ?? null,
          })
          .then((prefs) => applyComposerPrefs(prefs, availableModels))
          .catch(() => {});
          }}
          availableModels={availableModels}
          manualCliPath={manualCliPath}
          onManualCliPath={setManualCliPath}
          onCliBlur={(v) => {
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, manualCliPath: v || null }),
          );
          void api.probeCli(v || undefined).then((cli) => {
          setCliInfo(mapProbeToCliInfo(cli));
          setSetup((prev) => ({
          ...prev,
          cli: cli.found,
          auth: prev.auth || !!cli.cliAuthPresent,
          }));
          });
          }}
          allowUnverifiedCliInstall={allowUnverifiedCliInstall}
          lastCliChecksumVerified={lastCliChecksumVerified}
          onAllowUnverifiedCliInstall={(v) => {
          setAllowUnverifiedCliInstall(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, allowUnverifiedCliInstall: v }),
          );
          }}
          acpServerAddr={acpServerAddr}
          onAcpServerAddr={setAcpServerAddr}
          onAcpServerBlur={(v) => {
          setAcpServerAddr(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, acpServerAddr: v.trim() || null }),
          );
          }}
          proxyMode={proxyMode}
          onProxyMode={(v) => {
          setProxyMode(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, proxyMode: v }),
          );
          }}
          proxyUrl={proxyUrl}
          onProxyUrl={(v) => {
          setProxyUrl(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, proxyUrl: v.trim() || null }),
          );
          }}
          proxyNoProxy={proxyNoProxy}
          onProxyNoProxy={(v) => {
          setProxyNoProxy(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, proxyNoProxy: v.trim() || null }),
          );
          }}
          maxConcurrentAgents={maxConcurrentAgents}
          onMaxConcurrentAgents={(v) => {
          setMaxConcurrentAgents(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, maxConcurrentAgents: v }),
          );
          }}
          lastProcessLimit={lastProcessLimit}
          agentIdleMinutes={agentIdleMinutes}
          onAgentIdleMinutes={(v) => {
          setAgentIdleMinutes(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, agentIdleMinutes: v }),
          );
          }}
          streamStallSeconds={streamStallSeconds}
          onStreamStallSeconds={(v) => {
          setStreamStallSeconds(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, streamStallSeconds: v }),
          );
          }}
          auditLedgerRetentionDays={auditLedgerRetentionDays}
          onAuditLedgerRetentionDays={(v) => {
          const n = v === 7 || v === 30 || v === 90 ? v : 0;
          setAuditLedgerRetentionDays(n);
          void api
          .settingsGet()
          .then((s) =>
          api.settingsSet({ ...s, auditLedgerRetentionDays: n }),
          );
          }}
          includePartialMessages={includePartialMessages}
          onIncludePartialMessages={(v) => {
          setIncludePartialMessages(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, includePartialMessages: v }),
          );
          }}
          maxAgentTurns={maxAgentTurns}
          onMaxAgentTurns={(v) => {
          const n = v > 0 ? Math.min(200, Math.round(v)) : 0;
          setMaxAgentTurns(n);
          void api.settingsGet().then((s) =>
          api.settingsSet({
          ...s,
          // null clears the optional field; 0 would also omit on spawn.
          maxAgentTurns: n > 0 ? n : null,
          }),
          );
          }}
          backgroundWaitPolicy={backgroundWaitPolicy}
          onBackgroundWaitPolicy={(v) => {
          const next =
          v === "no_wait" || v === "timeout" ? v : "wait";
          setBackgroundWaitPolicy(next);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, backgroundWaitPolicy: next }),
          );
          }}
          backgroundWaitTimeoutSec={backgroundWaitTimeoutSec}
          onBackgroundWaitTimeoutSec={(v) => {
          const n = Math.min(3600, Math.max(1, Math.round(v)));
          setBackgroundWaitTimeoutSec(n);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, backgroundWaitTimeoutSec: n }),
          );
          }}
          storeApiKeysInKeychain={storeApiKeysInKeychain}
          onStoreApiKeysInKeychain={(v) => {
          const prev = storeApiKeysInKeychain;
          setStoreApiKeysInKeychain(v);
          void api
          .settingsGet()
          .then((s) =>
          api.settingsSet({ ...s, storeApiKeysInKeychain: v }),
          )
          .catch((e) => {
          setStoreApiKeysInKeychain(prev);
          showToast(String(e), 4500);
          });
          }}
          sandboxProfile={sandboxProfile}
          onSandboxProfile={(v) => {
          applyGlobalSandboxProfile(v);
          }}
          preferredAgent={preferredAgent}
          onPreferredAgent={(v) => {
          setPreferredAgent(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, preferredAgent: v }),
          );
          }}
          agentProfilePath={agentProfilePath}
          onAgentProfilePath={setAgentProfilePath}
          onAgentProfilePathCommit={(v) => {
          const next = (v || "").trim();
          setAgentProfilePath(next);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, agentProfilePath: next }),
          );
          }}
          agentsJson={agentsJson}
          onAgentsJson={setAgentsJson}
          onAgentsJsonCommit={async (v) => {
          const next = (v || "").trim();
          setAgentsJson(next);
          const s = await api.settingsGet();
          await api.settingsSet({ ...s, agentsJson: next });
          }}
          agentCatalog={agentCatalog}
          experimentalMemory={experimentalMemory}
          onExperimentalMemory={(v) => {
          setExperimentalMemory(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, experimentalMemory: v }),
          );
          }}
          compactionMode={compactionMode}
          onCompactionMode={(v) => {
          const next = normalizeCompactionMode(v);
          setCompactionMode(next);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, compactionMode: next }),
          );
          }}
          compactionDetail={compactionDetail}
          onCompactionDetail={(v) => {
          const next = normalizeCompactionDetail(v);
          setCompactionDetail(next);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, compactionDetail: next }),
          );
          }}
          twoPassCompactionEnabled={twoPassCompactionEnabled}
          onTwoPassCompactionEnabled={(v) => {
          setTwoPassCompactionEnabled(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, twoPassCompactionEnabled: v }),
          );
          }}
          voiceId={voiceId}
          onVoiceId={(v) => {
          const next = (v || "eve").trim() || "eve";
          setVoiceId(next);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, voiceId: next }),
          );
          }}
          voiceDictationAutoSend={voiceDictationAutoSend}
          onVoiceDictationAutoSend={(v) => {
          setVoiceDictationAutoSend(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, voiceDictationAutoSend: v }),
          );
          }}
          voiceKeepAgentsOnEnd={voiceKeepAgentsOnEnd}
          onVoiceKeepAgentsOnEnd={(v) => {
          setVoiceKeepAgentsOnEnd(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, voiceKeepAgentsOnEnd: v }),
          );
          }}
          subagentsEnabled={subagentsEnabled}
          onSubagentsEnabled={(v) => {
          setSubagentsEnabled(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, subagentsEnabled: v }),
          );
          }}
          subagentWorktreeSnapshotEnabled={subagentWorktreeSnapshotEnabled}
          onSubagentWorktreeSnapshotEnabled={(v) => {
          setSubagentWorktreeSnapshotEnabled(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, subagentWorktreeSnapshotEnabled: v }),
          );
          }}
          autoWakeEnabled={autoWakeEnabled}
          onAutoWakeEnabled={(v) => {
          setAutoWakeEnabled(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, autoWakeEnabled: v }),
          );
          }}
          workflowsEnabled={workflowsEnabled}
          onWorkflowsEnabled={(v) => {
          setWorkflowsEnabled(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, workflowsEnabled: v }),
          );
          }}
          planEnabled={planEnabled}
          onPlanEnabled={(v) => {
          setPlanEnabled(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, planEnabled: v }),
          );
          }}
          todoGateEnabled={todoGateEnabled}
          onTodoGateEnabled={(v) => {
          setTodoGateEnabled(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, todoGateEnabled: v }),
          );
          }}
          todoGateMaxFiresPerPrompt={todoGateMaxFiresPerPrompt}
          // Host has no fire-activity channel yet — Settings shows honest N/A.
          todoGateFireSignal={null}
          onTodoGateMaxFiresPerPrompt={(v) => {
          const n =
          typeof v === "number" && Number.isFinite(v) && v > 0
          ? Math.min(20, Math.max(1, Math.round(v)))
          : 3;
          setTodoGateMaxFiresPerPrompt(n);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, todoGateMaxFiresPerPrompt: n }),
          );
          }}
          disableWebSearch={disableWebSearch}
          onDisableWebSearch={(v) => {
          setDisableWebSearch(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, disableWebSearch: v }),
          );
          }}
          noAskUser={noAskUser}
          onNoAskUser={(v) => {
          setNoAskUser(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, noAskUser: v }),
          );
          }}
          disallowedTools={disallowedTools}
          onDisallowedTools={(v) => {
          setDisallowedTools(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, disallowedTools: v }),
          );
          }}
          allowedTools={allowedTools}
          onAllowedTools={(v) => {
          setAllowedTools(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, allowedTools: v }),
          );
          }}
          useLeader={useLeader}
          onUseLeader={(v) => {
          setUseLeader(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, useLeader: v }),
          );
          }}
          reopenLastSession={reopenLastSession}
          onReopenLastSession={(v) => {
          setReopenLastSession(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, reopenLastSession: v }),
          );
          }}
          closeToTray={closeToTray}
          onCloseToTray={(v) => {
          setCloseToTray(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, closeToTray: v }),
          );
          }}
          keepTrayForSchedules={keepTrayForSchedules}
          onKeepTrayForSchedules={(v) => {
          setKeepTrayForSchedules(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, keepTrayForSchedules: v }),
          );
          }}
          trayBusyBadge={trayBusyBadge}
          trayBusyCount={unreadSessionIds.size}
          onTrayBusyBadge={(v) => {
          saveTrayBusyBadgePref(v, localStorage);
          setTrayBusyBadge(v);
          }}
          launchAtLogin={launchAtLogin}
          onLaunchAtLogin={(v) => {
          setLaunchAtLogin(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, launchAtLogin: v }).catch(() => {
          // Host rolls back AppSettings when OS login-item update fails.
          setLaunchAtLogin(!v);
          }),
          );
          }}
          windowAlwaysOnTop={windowAlwaysOnTop}
          onWindowAlwaysOnTop={(v) => {
          saveWindowAlwaysOnTopPref(v, localStorage);
          setWindowAlwaysOnTop(v);
          }}
          notifyOnTurnDone={notifyOnTurnDone}
          onNotifyOnTurnDone={(v) => {
          setNotifyOnTurnDone(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, notifyOnTurnDone: v }),
          );
          }}
          notifyOnPermission={notifyOnPermission}
          onNotifyOnPermission={(v) => {
          setNotifyOnPermission(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, notifyOnPermission: v }),
          );
          }}
          notifySound={notifySound}
          onNotifySound={(v) => {
          saveNotifySoundPref(v, localStorage);
          setNotifySound(v);
          }}
          permissionTimeoutSec={permissionTimeoutSec}
          onPermissionTimeoutSec={(v) => {
          savePermissionTimeoutSec(v, localStorage);
          setPermissionTimeoutSec(v);
          }}
          askUserTimeoutSec={askUserTimeoutSec}
          onAskUserTimeoutSec={(v) => {
          saveAskUserTimeoutSec(v, localStorage);
          setAskUserTimeoutSec(v);
          }}
          cliInfo={cliInfo}
          cliAgentSkewRepairing={cliAgentSkewRepairing}
          onCliRepairAgentSidecar={async () => {
            if (cliAgentSkewRepairing) {
              return { ok: false, error: "busy" };
            }
            setCliAgentSkewRepairing(true);
            try {
              const r = await api.cliRepairAgentSidecar(cliInfo.path);
              const again = await api.probeCli(
                manualCliPath || cliInfo.path || undefined,
              );
              setCliInfo(mapProbeToCliInfo(again));
              return {
                ok: !!r.ok && !again.agentBinarySkew,
                agentVersion:
                  again.agentVersion ?? r.agentVersion ?? again.version,
                error: again.agentBinarySkew
                  ? "still_skewed"
                  : null,
              };
            } catch (e) {
              return {
                ok: false,
                error: e instanceof Error ? e.message : String(e),
              };
            } finally {
              setCliAgentSkewRepairing(false);
            }
          }}
          onDoctor={() => void openDoctor()}
          onOpenReliability={() => openReliability()}
          onOpenBatchAgents={() => openBatchAgents()}
          costRollupSessions={sessions.map((s) => ({
          id: s.id,
          projectId: s.projectId,
          title: s.title,
          modelId: s.modelId,
          updatedAt: s.updatedAt,
          }))}
          costRollupProjects={projects.map((p) => ({
          id: p.id,
          name: p.name,
          }))}
          onOpenShortcutsHelp={() => setShowShortcuts(true)}
          onOpenProductTutorial={() => setShowProductTutorial(true)}
          versionFooter={tr("app.versionFooter")}
          account={account}
          accountLoading={accountLoading}
          accountBusy={accountBusy}
          accountHeatmapError={accountHeatmapError}
          accountProbeError={accountProbeError}
          loginHint={loginHint}
          savedAccounts={savedAccounts}
          activeAccountId={activeAccountId}
          onAccountLoginOauth={() => void runAccountLogin("oauth")}
          onAccountLoginDevice={() => void runAccountLogin("device")}
          onAccountLoginSubmitCode={(code) => void submitAccountLoginCode(code)}
          onCancelLogin={() => void cancelAccountLogin()}
          onAccountLogout={() => void runAccountLogout()}
          onAccountRefresh={() => void refreshAccount({ refreshBilling: true })}
          onAccountManageUsage={() => void api.accountOpenUsage()}
          onAccountSubscribe={() => void api.accountOpenSubscribe()}
          onSaveAccount={() => void runSaveAccount()}
          onAddAccount={() => void runAddAccount()}
          onSwitchAccount={(id) => void runSwitchAccount(id)}
          onRemoveAccount={(id) => void runRemoveAccount(id)}
          onImportChat={() => void importChatTranscript()}
          defaultOpenTarget={defaultOpenTarget}
          onDefaultOpenTarget={(v) => {
          setDefaultOpenTarget(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, defaultOpenTarget: v }),
          );
          }}
          archivedGroups={archivedGroups}
          onRestoreArchivedSessions={(ids) => {
          const rows = ids
          .map((id) => sessions.find((x) => x.id === id))
          .filter((s): s is SessionRow => !!s);
          void restoreSessions(rows);
          }}
          onDeleteArchivedSessions={(ids) => {
          const rows = ids
          .map((id) => sessions.find((x) => x.id === id))
          .filter((s): s is SessionRow => !!s);
          deleteSessionsConfirm(rows);
          }}
          onArchiveOlderThan={(days) => {
          confirmArchiveOlderThan(days);
          }}
          archiveAgeSessions={sessions}
          projectPath={effectiveProjectPath}
          onOpenProjectFileInResources={({ path, relativePath }) => {
          const targetPath = (path || relativePath || "").trim();
          if (!targetPath) return;
          navigateWorkbench();
          openAsidePane();
          setResourceOpenTarget({
          type: "file",
          path: targetPath,
          title: relativePath || targetPath,
          });
          }}
          onSkillsPrefsChanged={() =>
          setSkillsReloadToken((n) => n + 1)
          }
          trustedProjects={projects
          .filter((p) => p.trusted)
          .map((p) => ({ id: p.id, name: p.name, path: p.path }))}
          onProvidersChanged={() => {
          // CRUD on provider list / models / efforts — keep composer menu in sync.
          void refreshProviderRoute();
          }}
          onProviderBalanceLoaded={(providerId, result) => {
            if (!result.ok) return;
            setProviderBalanceCache({
              providerId,
              fetchedAt: Date.now(),
              result,
            });
          }}
          onProviderActivated={() => {
          // Host already recycled warm agents on upsert/activate. Refresh UI
          // chrome only — never park (sessionDisconnect) a live process: that
          // kept stale OIDC/config in memory and required a full app restart
          // (issue #376). Soft-fail so save UI never sticks on “Saving…”.
          void (async () => {
          try {
          if (api.isTauri()) {
          setSession({ ...IDLE_SNAPSHOT });
          }
          await refreshProviderRoute();
          await refreshAccount({ refreshBilling: false }).catch(() => {
          /* soft-fail billing refresh */
          });
          await refreshVoiceGate().catch(() => {
          /* soft-fail voice gate */
          });
        } catch (e) {
          setToast(
          tr("prov.savedApplyFailed", { detail: String(e) }),
          );
          window.setTimeout(() => setToast(null), 4800);
          }
          })();
          }}
          />        </Suspense>
      ) : (
      <div
        className={
          "workbench" +
          (phoneLayout ? " workbench--phone" : "") +
          (hideChatForSideExpand ? " workbench--side-expanded" : "") +
          (sideDockActive ? " workbench--side-dock" : "")
        }
        style={
          {
            // Free-area left edge for expanded side overlay (px).
            ["--sw-sidebar-occupied"]:
              phoneLayout || layout.sidebarCollapsed
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
        {/* Phone drawer scrim — tap closes without resizing the conversation */}
        {phoneLayout && !layout.sidebarCollapsed ? (
          <button
            type="button"
            className="phone-drawer-scrim"
            aria-label={tr("phone.drawerClose")}
            onClick={closePhoneDrawer}
          />
        ) : null}
        {/* LEFT — fully hideable (not icon-rail); open via top-bar icon when closed */}
        <aside
          className={
            "sidebar" +
            (layout.sidebarCollapsed ? " sidebar--hidden" : "") +
            (resizingSidebar ? " is-resizing" : "") +
            (dragZone === "sidebar" ? " is-drop-target" : "") +
            (dragZone === "main" ? " is-drop-idle" : "") +
            (phoneLayout ? " sidebar--phone-drawer" : "")
          }
          aria-label={tr("a11y.sidebar")}
          aria-hidden={layout.sidebarCollapsed}
          style={
            !layout.sidebarCollapsed && !phoneLayout
              ? {
                  width: layout.sidebarWidth || SIDEBAR_DEFAULT_WIDTH,
                  minWidth: layout.sidebarWidth || SIDEBAR_DEFAULT_WIDTH,
                  maxWidth: layout.sidebarWidth || SIDEBAR_DEFAULT_WIDTH,
                }
              : undefined
          }
        >
          {dragZone === "sidebar" && (
            <div className="drop-overlay drop-overlay--project" aria-hidden>
              <div className="drop-overlay__card">
                <span className="drop-overlay__icon">
                  <IconFolderPlus size={22} />
                </span>
                <strong>{tr("composer.dropProjectTitle")}</strong>
                <span>{tr("composer.dropProjectHint")}</span>
              </div>
            </div>
          )}
          {/* Right-edge drag handle — desktop only (phone is overlay drawer) */}
          {!layout.sidebarCollapsed && !phoneLayout ? (
            <div
              className="sidebar-resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label={tr("sidebar.resize")}
              aria-valuenow={layout.sidebarWidth || SIDEBAR_DEFAULT_WIDTH}
              aria-valuemin={SIDEBAR_WIDTH_MIN}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                sidebarResizeStartRef.current = {
                  x: e.clientX,
                  width: layout.sidebarWidth || SIDEBAR_DEFAULT_WIDTH,
                };
                setResizingSidebar(true);
              }}
            />
          ) : null}
          {/* Row 1: traffic-light height — panel toggle sits just right of traffic lights */}
          <div
            className="sidebar-chrome"
            data-tauri-drag-region
            {...titlebarMax}
          >
            <Tip label={tr("main.leftPaneHide")}>
              <button
                type="button"
                className="chrome-btn chrome-btn--traffic main__pane-toggle is-on"
                aria-label={tr("main.leftPaneHide")}
                onClick={() =>
                  setLayout((l) => {
                    const n = { ...l, sidebarCollapsed: true };
                    saveLayout(localStorage, n);
                    return n;
                  })
                }
              >
                <IconPanel size={16} />
              </button>
            </Tip>
            <div
              className="sidebar-chrome__drag"
              data-tauri-drag-region
              {...titlebarMax}
            />
          </div>

          {/* Row 2: brand + search (Codex: title left, search right) */}
          <div className="sidebar-brand-row">
            <div className="sidebar-brand-row__left">
              <GrokLogo size={20} />
              <span>Grok</span>
            </div>
            <Tip label={tr("sidebar.search")}>
              <button
                type="button"
                className="chrome-btn"
                aria-label={tr("sidebar.search")}
                onClick={() => {
                  setShowSearch(true);
                  setSearchQuery("");
                }}
              >
                <IconSearch size={16} />
              </button>
            </Tip>
          </div>

          {/* Primary nav — new orphan session + scheduled tasks (Codex parity) */}
          <div className="sidebar-nav">
            <button
              type="button"
              className="nav-new"
              onClick={() => void newChat(null)}
            >
              <span className="nav-item__icon">
                <IconNewChat size={16} />
              </span>
              {tr("sidebar.newSession")}
            </button>
            <button
              type="button"
              className={
                "nav-item" +
                (mainPane === "automations" ? " nav-item--active" : "")
              }
              onClick={() => navigateAutomations()}
            >
              <span className="nav-item__icon">
                <IconScheduled size={16} />
              </span>
              {tr("sidebar.scheduled")}
            </button>
            {api.isDesktopHost() ? (
              <button
                type="button"
                className="nav-item"
                onClick={() => navigateSettings("remote_im", "im")}
                title={tr("settings.nav.remoteIm")}
              >
                <span className="nav-item__icon">
                  <IconDeviceMobile size={16} />
                </span>
                {tr("mirror.connect")}
              </button>
            ) : null}
          </div>

          <OverlayScroll className="sidebar__scroll" viewportClassName="sidebar__scroll-inner">
            {/* L1 — Projects section */}
            <div className="tree-l1">
              <button
                type="button"
                className="tree-l1__head"
                onClick={() => setProjectsOpen((v) => !v)}
              >
                {projectsOpen ? (
                  <IconChevronDown size={14} />
                ) : (
                  <IconChevronRight size={14} />
                )}
                <span className="tree-l1__label">
                  {tr("sidebar.projects")}
                </span>
              </button>
              <div className="tree-l1__actions">
                {sessionSelectMode ? (
                  <Tip label={tr("common.cancel")}>
                    <button
                      type="button"
                      className="tree-l1__action"
                      aria-label={tr("common.cancel")}
                      onClick={(e) => {
                        e.stopPropagation();
                        exitSessionSelectMode();
                      }}
                    >
                      <IconClose size={15} />
                    </button>
                  </Tip>
                ) : selectableSessionCount > 0 ? (
                  <>
                    <Tip label={tr("sidebar.select")}>
                      <button
                        type="button"
                        className="tree-l1__action"
                        aria-label={tr("sidebar.select")}
                        onClick={(e) => {
                          e.stopPropagation();
                          enterSessionSelectMode();
                        }}
                      >
                        <IconListCheck size={15} />
                      </button>
                    </Tip>
                    {unreadSessionIds.size > 0 ? (
                      <Tip label={tr("session.clearAllUnread")}>
                        <button
                          type="button"
                          className="tree-l1__action"
                          aria-label={tr("session.clearAllUnread")}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleClearAllSessionUnread();
                          }}
                        >
                          <IconCheck size={15} />
                        </button>
                      </Tip>
                    ) : null}
                    <Tip label={tr("sidebar.archiveOlder")}>
                      <button
                        type="button"
                        className="tree-l1__action"
                        aria-label={tr("sidebar.archiveOlder")}
                        onClick={(e) => {
                          e.stopPropagation();
                          setCtxMenu({
                            kind: "archive-older",
                            x: e.clientX,
                            y: e.clientY,
                          });
                        }}
                      >
                        <IconArchive size={15} />
                      </button>
                    </Tip>
                  </>
                ) : null}
                {projects.length > 0 && !sessionSelectMode ? (
                  <Tip label={tr("sidebar.collapseAllProjects")}>
                    <button
                      type="button"
                      className="tree-l1__action"
                      aria-label={tr("sidebar.collapseAllProjects")}
                      onClick={(e) => {
                        // Collapse each project folder only — not the L1 section.
                        e.stopPropagation();
                        setExpandedProjects((prev) => {
                          const next = { ...prev };
                          for (const p of projects) {
                            next[p.id] = false;
                          }
                          return next;
                        });
                      }}
                    >
                      <IconArrowsVerticalCollapse size={15} />
                    </button>
                  </Tip>
                ) : null}
                {!isMirrorClient() && !sessionSelectMode ? (
                  <Tip label={tr("sidebar.addProject")}>
                    <button
                      type="button"
                      className="tree-l1__action"
                      aria-label={tr("sidebar.addProject")}
                      onClick={() => void addProject(false)}
                    >
                      <IconPlus size={15} />
                    </button>
                  </Tip>
                ) : null}
              </div>
            </div>

            {projectsOpen && projects.length === 0 && (
              <div className="sidebar-empty">
                {tr("sidebar.noProjects")}
              </div>
            )}

            {projectsOpen &&
              projects.map((proj) => {
                const open = expandedProjects[proj.id] !== false;
                const projSessions = sessionsForProject(proj.id);
                const projSessionIds = projSessions.map((s) => s.id);
                const projAllSelected = areAllIdsSelected(
                  selectedSessionIds,
                  projSessionIds,
                );
                return (
                  <div key={proj.id} className="tree-project">
                    {/* L2 — project folder: expand/collapse only (not selectable) */}
                    <div
                      className={
                        "tree-l2" +
                        (isProjectPathMissing(proj.pathOk)
                          ? " tree-l2--path-missing"
                          : "") +
                        (sessionSelectMode ? " tree-l2--select-mode" : "")
                      }
                      role="button"
                      tabIndex={0}
                      aria-expanded={open}
                      onClick={() => {
                        setExpandedProjects((e) => ({
                          ...e,
                          [proj.id]: !open,
                        }));
                      }}
                      onContextMenu={(e) => openProjectMenu(e, proj)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setExpandedProjects((ex) => ({
                            ...ex,
                            [proj.id]: !open,
                          }));
                        }
                      }}
                    >
                      <span className="tree-l2__icon">
                        <IconFolder size={15} />
                      </span>
                      {resolveProjectColorCss(proj.color) ? (
                        <span
                          className="tree-l2__color-dot"
                          style={
                            {
                              "--project-color": resolveProjectColorCss(
                                proj.color,
                              ),
                            } as CSSProperties
                          }
                          aria-hidden
                        />
                      ) : null}
                      <Tip
                        label={
                          isProjectPathMissing(proj.pathOk)
                            ? tr("project.pathMissing", { name: proj.name })
                            : proj.path
                        }
                      >
                        <span className="tree-l2__name">
                          {proj.pinned ? (
                            <IconPin size={12} className="tree-l2__pin" />
                          ) : null}
                          {projectDisplayName(proj, tr)}
                        </span>
                      </Tip>
                      {isProjectPathMissing(proj.pathOk) ? (
                        <span className="project-row__badge project-row__badge--path-missing">
                          {tr("sidebar.pathMissing")}
                        </span>
                      ) : !proj.trusted ? (
                        <span className="project-row__badge">
                          {tr("sidebar.untrusted")}
                        </span>
                      ) : null}
                      <span
                        className={
                          "tree-l2__actions" +
                          (sessionSelectMode
                            ? " tree-l2__actions--select-mode"
                            : "")
                        }
                      >
                        {sessionSelectMode ? (
                          projSessionIds.length > 0 ? (
                            <button
                              type="button"
                              className={
                                "tree-l2__select-all" +
                                (projAllSelected
                                  ? " tree-l2__select-all--on"
                                  : "")
                              }
                              aria-label={
                                projAllSelected
                                  ? tr("sidebar.deselectAllInGroup")
                                  : tr("sidebar.selectAllInGroup")
                              }
                              aria-pressed={projAllSelected}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSessionsSelected(projSessionIds);
                              }}
                            >
                              <span
                                className={
                                  "tree-l3__check" +
                                  (projAllSelected ? " is-on" : "")
                                }
                                aria-hidden
                              >
                                {projAllSelected ? (
                                  <IconCheck size={11} stroke={2.4} />
                                ) : null}
                              </span>
                              <span className="tree-l2__select-all-label">
                                {projAllSelected
                                  ? tr("sidebar.deselectAllInGroup")
                                  : tr("sidebar.selectAllInGroup")}
                              </span>
                            </button>
                          ) : null
                        ) : (
                          <>
                            <Tip label={tr("sidebar.newConversation")}>
                              <button
                                type="button"
                                className="tree-icon-btn"
                                disabled={
                                  !proj.trusted ||
                                  isProjectPathMissing(proj.pathOk)
                                }
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void newChat(proj);
                                }}
                              >
                                <IconSquarePen size={14} />
                              </button>
                            </Tip>
                            <Tip label={tr("sidebar.menu")}>
                              <button
                                type="button"
                                className="tree-icon-btn"
                                onClick={(e) => openProjectMenu(e, proj)}
                              >
                                <IconMore size={14} />
                              </button>
                            </Tip>
                          </>
                        )}
                      </span>
                    </div>

                    {open && (
                      <div className="tree-l3-list-wrap">
                        {isProjectPathMissing(proj.pathOk) && (
                          <button
                            type="button"
                            className="tree-l3 tree-l3--hint"
                            onClick={(e) => {
                              e.stopPropagation();
                              void relocateProject(proj);
                            }}
                          >
                            {tr("sidebar.relocateProject")}
                          </button>
                        )}
                        {!proj.trusted && !isProjectPathMissing(proj.pathOk) && (
                          <button
                            type="button"
                            className="tree-l3 tree-l3--hint"
                            onClick={(e) => {
                              e.stopPropagation();
                              void trustProject(proj);
                            }}
                          >
                            {tr("sidebar.trustProject")}
                          </button>
                        )}
                        {projSessions.length > 0
                          ? (() => {
                              const sortedSessions =
                                sortSessionsForSidebar(projSessions);
                              return (
                                <VirtualList
                                  className="tree-l3-list"
                                  items={sortedSessions}
                                  getKey={(s) => s.id}
                                  rowHeight={sidebarRowMetrics.rowHeight}
                                  gap={sidebarRowMetrics.gap}
                                  scrollToKey={
                                    session.sessionId &&
                                    sortedSessions.some(
                                      (x) => x.id === session.sessionId,
                                    )
                                      ? session.sessionId
                                      : null
                                  }
                                  renderItem={(s) => {
                                    const working = busyIds.has(s.id);
                                    const checked =
                                      selectedSessionIds.has(s.id);
                                    const unread = unreadSessionIds.has(s.id);
                                    const planPending =
                                      planPendingSessionIds.has(s.id);
                                    const noteRaw =
                                      sessionNotesMap[s.id]?.trim() || "";
                                    return (
                                      <SidebarSessionRow
                                        session={s}
                                        variant="project"
                                        active={session.sessionId === s.id}
                                        working={working}
                                        unread={unread}
                                        planPending={planPending}
                                        checked={checked}
                                        selectMode={sessionSelectMode}
                                        muted={mutedSessionIds.has(s.id)}
                                        noteTitle={
                                          noteRaw
                                            ? notePreview(noteRaw) ||
                                              sidebarSessionLabels.noteAria
                                            : null
                                        }
                                        worktreeBadge={buildSidebarWorktreeBadge(
                                          s,
                                        )}
                                        labels={sidebarSessionLabels}
                                        locale={locale}
                                        showRelativeTime={
                                          sidebarShowRelativeTime
                                        }
                                        onOpen={onSidebarSessionOpen}
                                        onContextMenu={
                                          onSidebarSessionContextMenu
                                        }
                                        onToggleSelect={toggleSessionSelected}
                                        onPin={onSidebarSessionPin}
                                        onArchive={onSidebarSessionArchive}
                                        onMenu={onSidebarSessionMenu}
                                      />
                                    );
                                  }}
                                />
                              );
                            })()
                          : null}
                        {projSessions.length === 0 && proj.trusted && (
                          <div className="sidebar-empty" style={{ padding: "4px 10px" }}>
                            {tr("sidebar.noChats")}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

            {/* Orphans / history */}
            <div className="tree-l1" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="tree-l1__head"
                onClick={() => setHistoryOpen((v) => !v)}
              >
                {historyOpen ? (
                  <IconChevronDown size={14} />
                ) : (
                  <IconChevronRight size={14} />
                )}
                <span className="tree-l1__label">
                  {tr("sidebar.otherSessions")}
                </span>
              </button>
              {sessionSelectMode && orphanSessionIds.length > 0 ? (
                <div className="tree-l1__actions tree-l1__actions--select-mode">
                  <button
                    type="button"
                    className={
                      "tree-l1__select-all" +
                      (orphanAllSelected ? " tree-l1__select-all--on" : "")
                    }
                    aria-label={
                      orphanAllSelected
                        ? tr("sidebar.deselectAllInGroup")
                        : tr("sidebar.selectAllInGroup")
                    }
                    aria-pressed={orphanAllSelected}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSessionsSelected(orphanSessionIds);
                    }}
                  >
                    <span
                      className={
                        "tree-l3__check" +
                        (orphanAllSelected ? " is-on" : "")
                      }
                      aria-hidden
                    >
                      {orphanAllSelected ? (
                        <IconCheck size={11} stroke={2.4} />
                      ) : null}
                    </span>
                    <span className="tree-l1__select-all-label">
                      {orphanAllSelected
                        ? tr("sidebar.deselectAllInGroup")
                        : tr("sidebar.selectAllInGroup")}
                    </span>
                  </button>
                </div>
              ) : null}
            </div>
            {historyOpen && orphanSessions.length > 0
              ? (() => {
                  const sortedOrphans = sortSessionsForSidebar(orphanSessions);
                  return (
                      <VirtualList
                        className="tree-orphan-list"
                        items={sortedOrphans}
                        getKey={(s) => s.id}
                        rowHeight={sidebarRowMetrics.rowHeight}
                        gap={sidebarRowMetrics.gap}
                        scrollToKey={
                          session.sessionId &&
                          sortedOrphans.some(
                            (x) => x.id === session.sessionId,
                          )
                            ? session.sessionId
                            : null
                        }
                        renderItem={(s) => {
                          const working = busyIds.has(s.id);
                          const checked = selectedSessionIds.has(s.id);
                          const unread = unreadSessionIds.has(s.id);
                          const planPending =
                            planPendingSessionIds.has(s.id);
                          const noteRaw =
                            sessionNotesMap[s.id]?.trim() || "";
                          return (
                            <SidebarSessionRow
                              session={s}
                              variant="orphan"
                              active={session.sessionId === s.id}
                              working={working}
                              unread={unread}
                              planPending={planPending}
                              checked={checked}
                              selectMode={sessionSelectMode}
                              muted={mutedSessionIds.has(s.id)}
                              noteTitle={
                                noteRaw
                                  ? notePreview(noteRaw) ||
                                    sidebarSessionLabels.noteAria
                                  : null
                              }
                              worktreeBadge={buildSidebarWorktreeBadge(s)}
                              labels={sidebarSessionLabels}
                              locale={locale}
                              showRelativeTime={sidebarShowRelativeTime}
                              onOpen={onSidebarSessionOpen}
                              onContextMenu={onSidebarSessionContextMenu}
                              onToggleSelect={toggleSessionSelected}
                              onPin={onSidebarSessionPin}
                              onArchive={onSidebarSessionArchive}
                              onMenu={onSidebarSessionMenu}
                            />
                          );
                        }}
                      />
                  );
                })()
              : null}
          </OverlayScroll>

          {sessionSelectMode ? (
            <div className="sidebar-select-bar" role="toolbar">
              <span className="sidebar-select-bar__count">
                {tr("sidebar.selectedCount", {
                  n: selectedSessionIds.size,
                })}
              </span>
              <div className="sidebar-select-bar__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={exitSessionSelectMode}
                >
                  {tr("common.cancel")}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={selectedSessionIds.size === 0}
                  onClick={() => confirmBulkSetArchived(true)}
                >
                  {tr("sidebar.archiveSelected", {
                    n: selectedSessionIds.size,
                  })}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm btn--danger"
                  disabled={selectedSessionIds.size === 0}
                  onClick={() => {
                    const rows = sessions.filter((s) =>
                      selectedSessionIds.has(s.id),
                    );
                    deleteSessionsConfirm(rows);
                  }}
                >
                  {tr("sidebar.deleteSelected", {
                    n: selectedSessionIds.size,
                  })}
                </button>
              </div>
            </div>
          ) : null}

          <UserMenu
            open={showUserMenu}
            onClose={() => setShowUserMenu(false)}
            theme={theme}
            themePreference={themePreference}
            account={account}
            activeProvider={activeCustomProvider}
            accountBusy={accountBusy}
            providerBalance={
              providerBalanceCache != null &&
              providerBalanceCache.providerId === activeCustomProvider?.id
                ? providerBalanceCache.result
                : null
            }
            providerBalanceBusy={providerBalanceBusy}
            providerBalanceError={
              activeCustomProvider &&
              supportsProviderBalance({
                providerId: activeCustomProvider.id,
                baseUrl: activeCustomProvider.baseUrl,
              })
                ? providerBalanceError
                : null
            }
            onRefreshProviderBalance={
              activeCustomProvider &&
              supportsProviderBalance({
                providerId: activeCustomProvider.id,
                baseUrl: activeCustomProvider.baseUrl,
              })
                ? () => {
                    void loadProviderBalance({ force: true });
                  }
                : undefined
            }
            labels={{
              settings: tr("sidebar.settings"),
              tutorial: tr("tutorial.menu"),
              theme: tr("user.theme"),
              themeSystem: tr("settings.themeSystem"),
              themeLight: tr("settings.themeLight"),
              themeDark: tr("settings.themeDark"),
              local: tr("common.local"),
              signedIn: tr("account.signedIn"),
              signedOut: tr("account.signedOut"),
              login: tr("account.login"),
              logout: tr("account.logout"),
              remaining: tr("account.quotaRemaining"),
              customProvider: tr("prov.customProvider"),
              resetsAt: tr("account.resetsAt"),
              balanceAvailable: tr("prov.balance.available"),
              balanceUnavailable: tr("prov.balance.unavailable"),
              balanceGranted: tr("prov.balance.granted"),
              balanceToppedUp: tr("prov.balance.toppedUp"),
              balanceRefresh: tr("prov.balance.refresh"),
              balanceChecking: tr("prov.balance.checking"),
            }}
            onSettings={() => navigateSettings()}
            onAccountSettings={() => navigateSettings("account")}
            onTutorial={() => setShowProductTutorial(true)}
            onTheme={applyThemeChoice}
            onLogin={() => void runAccountLogin("oauth")}
            onLogout={() => void runAccountLogout()}
          >
            <Tip label={tr("user.menu")}>
            <button
              type="button"
              className={
                "sidebar__footer" + (showUserMenu ? " is-open" : "")
              }
              aria-haspopup="menu"
              aria-expanded={showUserMenu}
              onClick={() => {
                setShowUserMenu((v) => !v);
                if (!showUserMenu) {
                  void refreshAccount({ refreshBilling: !customRouteActive });
                  if (
                    activeCustomProvider &&
                    supportsProviderBalance({
                      providerId: activeCustomProvider.id,
                      baseUrl: activeCustomProvider.baseUrl,
                    })
                  ) {
                    void loadProviderBalance();
                  }
                }
              }}
            >
              <div
                className={
                  "user-avatar" +
                  (activeCustomProvider &&
                  resolveProviderBrandId({
                    providerId: activeCustomProvider.id,
                    baseUrl: activeCustomProvider.baseUrl,
                  })
                    ? " user-avatar--logo"
                    : account?.profile?.signedIn
                      ? " user-avatar--logo"
                      : "")
                }
                aria-hidden
              >
                {activeCustomProvider ? (
                  resolveProviderBrandId({
                    providerId: activeCustomProvider.id,
                    baseUrl: activeCustomProvider.baseUrl,
                  }) ? (
                    <ProviderBrandIcon
                      providerId={activeCustomProvider.id}
                      baseUrl={activeCustomProvider.baseUrl}
                      size={20}
                    />
                  ) : (
                    providerAvatarLetter(
                      activeCustomProvider.name.trim() ||
                        activeCustomProvider.id,
                    )
                  )
                ) : account?.profile?.signedIn ? (
                  <GrokLogo size={20} />
                ) : account?.profile ? (
                  accountInitials(account.profile)
                ) : (
                  "G"
                )}
              </div>
              <div className="user-meta">
                <span className="user-meta__name">
                  {activeCustomProvider
                    ? activeCustomProvider.name.trim() || activeCustomProvider.id
                    : account?.profile
                      ? accountDisplayName(account.profile, tr("common.local"))
                      : tr("common.local")}
                </span>
                {(() => {
                  // Custom DeepSeek: show total balance when we have an honest cache.
                  if (customRouteActive && activeCustomProvider) {
                    if (
                      !supportsProviderBalance({
                        providerId: activeCustomProvider.id,
                        baseUrl: activeCustomProvider.baseUrl,
                      })
                    ) {
                      return null;
                    }
                    const line =
                      providerBalanceCache?.providerId ===
                      activeCustomProvider.id
                        ? formatProviderBalanceLine(
                            providerBalanceCache.result,
                          )
                        : null;
                    return line ? (
                      <span className="user-meta__quota">{line}</span>
                    ) : null;
                  }
                  // Official SuperGrok remaining only when signed in.
                  if (!account?.profile?.signedIn) return null;
                  const rem = remainingPercent(account);
                  return rem != null ? (
                    <span className="user-meta__quota">{rem.toFixed(0)}%</span>
                  ) : null;
                })()}
              </div>
            </button>
            </Tip>
          </UserMenu>
        </aside>

        {/* CENTER — solid pane; top icons fully toggle L/R columns */}
        <main
          className={
            "main" +
            (layout.sidebarCollapsed ? " main--sidebar-hidden" : "") +
            (dragZone === "main" ? " is-drop-target" : "") +
            (dragZone === "sidebar" ? " is-drop-idle" : "") +
            (hideChatForSideExpand ? " main--side-covered" : "")
          }
          aria-hidden={hideChatForSideExpand ? true : undefined}
          // Keep chat DOM mounted under the side overlay; block interaction.
          inert={hideChatForSideExpand ? true : undefined}
        >
          {dragZone === "main" && (
            <div className="drop-overlay drop-overlay--attach" aria-hidden>
              <div className="drop-overlay__card">
                <span className="drop-overlay__icon">
                  <IconAttach size={22} />
                </span>
                <strong>{tr("composer.dropAttachTitle")}</strong>
                <span>{tr("composer.dropAttachHint")}</span>
              </div>
            </div>
          )}
          {toast && (
            <div className="app-toast" role="status">
              {toast}
            </div>
          )}
          <div
            className={
              "main__top" + (phoneLayout ? " main__top--phone" : "")
            }
            data-tauri-drag-region
            {...titlebarMax}
          >
            <div className="main__title-row" data-tauri-drag-region>
              {/* Phone: always-visible hamburger (≥44px). Desktop: reopen when rail hidden. */}
              {phoneLayout ? (
                <button
                  type="button"
                  className="chrome-btn main__phone-menu"
                  aria-label={tr("phone.menu")}
                  aria-expanded={!layout.sidebarCollapsed}
                  onClick={() => {
                    if (layout.sidebarCollapsed) openPhoneDrawer();
                    else closePhoneDrawer();
                  }}
                >
                  <IconMenu size={20} />
                </button>
              ) : (
                layout.sidebarCollapsed && (
                  <Tip label={tr("main.leftPaneShow")}>
                    <button
                      type="button"
                      className="chrome-btn chrome-btn--traffic main__pane-toggle"
                      aria-label={tr("main.leftPaneShow")}
                      onClick={() => openSidebarPane()}
                    >
                      <IconPanel size={16} />
                    </button>
                  </Tip>
                )
              )}
              {mainPane === "automations" ? (
                <>
                  {!phoneLayout ? (
                    <span className="main__title-icon">
                      <IconScheduled size={16} />
                    </span>
                  ) : null}
                  <h1 className="main__title" data-tauri-drag-region>
                    {tr("automations.title")}
                  </h1>
                </>
              ) : (
                (() => {
                  const cur = sessions.find((s) => s.id === session.sessionId);
                  const title =
                    cur?.title ||
                    session.title ||
                    activeProject?.name ||
                    tr("session.new");
                  const isScheduledSession =
                    !!cur?.scheduled ||
                    messages.some(
                      (m) =>
                        m.role === "user" &&
                        !!parseScheduledUserContent(m.content || ""),
                    );
                  return (
                    <>
                      {isScheduledSession && !phoneLayout ? (
                        <span
                          className="main__title-icon"
                          title={tr("automations.msgTag")}
                          aria-label={tr("automations.msgTag")}
                        >
                          <IconClock size={16} />
                        </span>
                      ) : null}
                      {phoneLayout ? (
                        <h1 className="main__title" data-tauri-drag-region>
                          {title}
                        </h1>
                      ) : (
                        <Tip label={title}>
                          <h1 className="main__title" data-tauri-drag-region>
                            {title}
                          </h1>
                        </Tip>
                      )}
                      {cur && !phoneLayout && (
                        <Tip label={tr("session.menu")}>
                          <button
                            type="button"
                            className="chrome-btn main__title-menu"
                            onClick={(e) => openSessionMenu(e, cur)}
                          >
                            <IconMore size={16} />
                          </button>
                        </Tip>
                      )}
                    </>
                  );
                })()
              )}
            </div>
            <div className="main__top-actions">
              {phoneLayout ? (
                <button
                  type="button"
                  className="chrome-btn main__phone-account"
                  aria-label={tr("phone.account")}
                  onClick={() => setPhoneAccountOpen(true)}
                >
                  <IconUser size={20} />
                </button>
              ) : (
                <>
                  {isMirrorClient() && (() => {
                    const link = deriveMirrorClientLinkStatus({
                      wsConnected: mirrorLinkOk,
                      hasToken: !!mirrorToken(),
                    });
                    const linkLabel = tr(link.labelKey as MessageKey);
                    return (
                    <span
                      className={
                        "status-pill status-pill--" + link.tone
                      }
                      role="status"
                      title={
                        mirrorHostLabel
                          ? `${mirrorHostLabel} · ${linkLabel}`
                          : linkLabel
                      }
                    >
                      <span className="status-pill__dot" aria-hidden />
                      {mirrorLinkOk
                        ? mirrorHostLabel || linkLabel
                        : linkLabel}
                    </span>
                    );
                  })()}
                  {mainPane === "chat" && (
                    <span
                      className={`status-pill status-pill--${connPill.tone}`}
                      role="status"
                      title={tr(connPill.labelKey as MessageKey)}
                    >
                      <span className="status-pill__dot" aria-hidden />
                      {tr(connPill.labelKey as MessageKey)}
                    </span>
                  )}
                  {/* Retry progress is intentionally NOT shown: mid-connect
                      network retries (reqwest stream errors, transient 5xx)
                      are normal and self-healing — surfacing them as a chip
                      reads as a failure. Final failures surface via
                      session://turn_error instead. setRetryStatus(null) calls
                      stay as no-op cleanup. */}
                  {/* Codex Side Workbench chrome:
                      collapsed → open-with · env · side
                      open      → open-with · env · side (also on side bar)
                      Main keeps a toggle when open so narrow/non-maximized
                      windows can still close if side chrome is clipped. */}
                  {mainPane === "chat" &&
                    activeProject &&
                    !isMirrorClient() && (
                      <OpenLocationButton
                        path={activeProject.path}
                        target={defaultOpenTarget || "finder"}
                        onTargetChange={persistOpenTarget}
                        onOpenError={(e) => setLocalError(e)}
                        platform={platform}
                        labels={{
                          openLocation: tr("main.openLocation"),
                          openHint: tr("main.openLocationHint"),
                          openMenu: tr("main.openLocationMenu"),
                          finder: revealInOsLabel(tr, platform),
                          systemDefault: tr("main.openSystemDefault"),
                          copyPath: tr("attach.copyPath"),
                        }}
                      />
                    )}
                  {mainPane === "chat" ? (
                    <EnvInfoButton
                      locale={locale}
                      projectPath={effectiveProjectPath}
                      projectName={
                        activeProject
                          ? projectDisplayName(activeProject, tr)
                          : null
                      }
                      isGitProject={sideIsGitProject}
                      changeSummary={
                        sessionChangesSummary?.mode === "diff"
                          ? {
                              add: sessionChangesSummary.addedLines ?? 0,
                              del: sessionChangesSummary.removedLines ?? 0,
                              fileCount: sessionChangesSummary.fileCount,
                            }
                          : sessionChangesSummary
                            ? {
                                add: 0,
                                del: 0,
                                fileCount: sessionChangesSummary.fileCount,
                              }
                            : gitDirtySummary
                              ? {
                                  add: 0,
                                  del: 0,
                                  fileCount: gitDirtySummary.count,
                                }
                              : null
                      }
                      onJump={(jump) => {
                        if (jump.type === "review") {
                          // Phase 3: env review jump only for git projects.
                          if (!sideIsGitProject) return;
                          const result = applySideContextOpen(
                            sideWorkbench,
                            { type: "changes" },
                            { isGitProject: true },
                          );
                          if (!result.needAsideOpen) return;
                          setSideWorkbench(result.state);
                          openAsidePane();
                          return;
                        }
                        if (jump.type === "local") {
                          // Open / focus files workbench for the bound project.
                          const next = openSideTab(sideWorkbench, "file", {
                            path: effectiveProjectPath || undefined,
                            name: activeProject
                              ? projectDisplayName(activeProject, tr)
                              : undefined,
                          });
                          setSideWorkbench(next);
                          openAsidePane();
                        }
                        // branch / push / pr: display-only in Phase 3 (no write ops).
                      }}
                    />
                  ) : null}
                  {/* Always keep a main-chrome toggle: when the window is not
                      maximized, the side pane can clip its own close control
                      past the right edge — main column stays reachable. */}
                  {layout.asideCollapsed ? (
                    <Tip label={tr("main.rightPaneShow")}>
                      <button
                        type="button"
                        className="chrome-btn main__pane-toggle"
                        aria-label={tr("main.rightPaneShow")}
                        aria-pressed={false}
                        data-testid="main-side-toggle"
                        onClick={() => openAsidePane()}
                      >
                        <IconPanelRight size={16} />
                      </button>
                    </Tip>
                  ) : (
                    <Tip label={tr("main.rightPaneHide")}>
                      <button
                        type="button"
                        className="chrome-btn main__pane-toggle is-on"
                        aria-label={tr("main.rightPaneHide")}
                        aria-pressed
                        data-testid="main-side-toggle"
                        onClick={() => closeAsidePane()}
                      >
                        <IconPanelRight size={16} />
                      </button>
                    </Tip>
                  )}
                </>
              )}
            </div>
          </div>

          {mainPane === "automations" ? (
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
                expand: tr("planBar.expand"),
                clearGoal: tr("planBar.clearGoal"),
                aria: tr("planBar.aria"),
              }}
              onApprove={() => void approvePlan()}
              onRequestChanges={() => openRequestPlanChanges()}
              onDismiss={() => void dismissPlan()}
              onClearGoal={() => setGoalMode(false)}
              onOpenDetails={() => openPlanInResource()}
            />
          )}

          {mainPane === "chat" && goalOrchSessionChip ? (
            <div className="goal-orch-session-chip-wrap">
              <button
                type="button"
                className={
                  "goal-orch-session-chip" +
                  (goalOrchSessionChip.kind === "waiting"
                    ? " goal-orch-session-chip--waiting"
                    : "")
                }
                data-testid="goal-orch-session-chip"
                data-kind={goalOrchSessionChip.kind}
                title={[
                  goalOrchSessionChip.kind === "waiting"
                    ? tr("reliability.goal.sessionChipWaitingTitle")
                    : tr(goalOrchPhaseLabelKey(goalOrchSessionChip.phase)),
                  goalOrchSessionChip.label,
                  goalOrchSessionChip.progress,
                  goalOrchSessionChip.detail,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                aria-label={
                  goalOrchSessionChip.kind === "waiting"
                    ? tr("reliability.goal.sessionChipWaitingAria")
                    : tr("reliability.goal.sessionChipAria", {
                        phase: tr(
                          goalOrchPhaseLabelKey(goalOrchSessionChip.phase),
                        ),
                      })
                }
                onClick={() => openReliability()}
              >
                <span className="goal-orch-session-chip__dot" aria-hidden />
                <span className="goal-orch-session-chip__label">
                  {goalOrchSessionChip.kind === "waiting"
                    ? tr("reliability.goal.sessionChipWaiting")
                    : tr("reliability.goal.sessionChip", {
                        phase: tr(
                          goalOrchPhaseLabelKey(goalOrchSessionChip.phase),
                        ),
                      })}
                  {goalOrchSessionChip.kind === "active" &&
                  goalOrchSessionChip.detail
                    ? ` · ${goalOrchSessionChip.detail.slice(0, 48)}${
                        goalOrchSessionChip.detail.length > 48 ? "…" : ""
                      }`
                    : ""}
                </span>
                {goalOrchSessionChip.progress ? (
                  <span className="goal-orch-session-chip__meta">
                    {goalOrchSessionChip.progress}
                  </span>
                ) : null}
              </button>
            </div>
          ) : null}

          {mainPane === "chat" && showChatFind && (
            <ChatFindBar
              key={chatFindFocusKey}
              query={chatFindQuery}
              activeIndex={chatFindIndex}
              matchCount={chatFindMatches.length}
              labels={{
                placeholder: tr("chatFind.placeholder"),
                prev: tr("chatFind.prev"),
                next: tr("chatFind.next"),
                close: tr("chatFind.close"),
                count: tr("chatFind.count"),
                noMatches: tr("chatFind.noMatches"),
                aria: tr("chatFind.aria"),
              }}
              onQueryChange={(q) => {
                setChatFindQuery(q);
                setChatFindIndex(0);
              }}
              onPrev={chatFindPrev}
              onNext={chatFindNext}
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
              activitySessions={collectActivitySessions({
                liveMap,
                sessions,
                currentSessionId: session.sessionId,
                untitledLabel: tr("session.untitled"),
              })}
              onSelectSession={(id) => {
                const row = sessions.find((s) => s.id === id);
                if (!row) return;
                const proj =
                  projects.find((p) => p.id === row.projectId) || null;
                void openSession(row, proj);
              }}
              onStopSession={async (id) => {
                try {
                  await api.sessionStop(id);
                  setLiveMap((lm) => settleStoppedSessionInLiveMap(lm, id));
                } catch (e) {
                  const view = classifyTasksStopError(e);
                  showToast(tr(view.titleKey as MessageKey), 4000);
                  // Re-throw so the panel can also show an inline soft-fail hint.
                  throw e;
                }
              }}
              onStopAllSessions={stopAllBusySessions}
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
                      connecting && errorBanner.primary.id === "reconnect"
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
                      connecting && errorBanner.secondary.id === "reconnect"
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
                      disabled={connecting}
                      onClick={() => {
                        setLocalError(null);
                        setErrorDetailOpen(false);
                        void ensureConnected(true).then((sid) => {
                          if (sid) setLocalError(null);
                        });
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
                    onClick={() => setErrorDetailOpen((v) => !v)}
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
          <UiErrorBoundary
            resetKey={session.sessionId ?? `draft-${session.title ?? "new"}`}
            labels={{
              title: tr("ui.errorBoundary.title"),
              body: tr("ui.errorBoundary.body"),
              retry: tr("ui.errorBoundary.retry"),
            }}
          >
          <ConversationThreadLive
            locale={locale}
            sessionState={
              stopLatch.phase === "force_idle" || stopGate.forceIdle
                ? "ready"
                : session.state
            }
            sessionKey={session.sessionId ?? `draft-${session.title ?? "new"}`}
            projectPath={effectiveProjectPath}
            suppressEmptyCopy={welcomeSession}
            canEditLastUser={canEditLastUser}
            lastUserMessageId={lastUserMessageId}
            editingUserMessageId={editingUserMessageId}
            editSubmitting={editSubmitting}
            editAttachments={editAttachments}
            onEditUserMessage={beginEditLastUser}
            onCancelEditUserMessage={cancelEditUser}
            onSubmitEditUserMessage={(msg, content) => {
              void submitEditLastUser(msg, content);
            }}
            onRemoveEditAttachment={(att) =>
              setEditAttachments((prev) =>
                prev.filter((x) => x.path !== att.path),
              )
            }
            canRegenerate={canEditLastUser && !editSubmitting}
            onRegenerateAssistant={(msg, opts) => {
              void regenerateLastAssistant(msg, opts);
            }}
            regenerateModels={availableModels}
            regenerateModelId={modelId}
            canRewindSession={canRewindSession && !!session.sessionId}
            onRewindToUserMessage={onRewindToUserMessage}
            onForkFromUserMessage={onForkFromUserMessage}
            turnStartedAt={turnStartedAt}
            onOpenSessionChanges={() => {
              openAsidePane();
              setResourceOpenTarget({ type: "changes" });
            }}
            onOpenModifiedPath={(path) => {
              openAsidePane();
              setResourceOpenTarget({ type: "changes", path });
            }}
            onOpenResource={(target) => {
              openAsidePane();
              setResourceOpenTarget(target);
            }}
            onOpenError={(message) => setLocalError(message)}
            onOpenExternalLink={openExternalLinkFromChat}
            onAddAttachmentToComposer={(att) =>
              setAttachments((prev) => mergeAttachments(prev, [att]))
            }
            attachLabels={attachLabels}
            findQuery={showChatFind ? chatFindQuery : ""}
            findHitMessageIds={showChatFind ? chatFindHitIds : undefined}
            findActive={showChatFind ? chatFindActive : null}
            showTimestamps={showMessageTimestamps}
            messageTimeFormat={messageTimeFormat}
            showReplyLength={showReplyLength}
            structuredOutputActive={!!sessionJsonSchema}
            structuredOutputSchema={sessionJsonSchema}
            structuredOutputUsage={
              contextUsage.knownUsage
                ? {
                    inputTokens: contextUsage.knownUsage.inputTokens,
                    outputTokens: contextUsage.knownUsage.outputTokens,
                    totalTokens: contextUsage.knownUsage.totalTokens,
                  }
                : null
            }
            structuredOutputLabels={{
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
            }}
          />
          </UiErrorBoundary>

          {(() => {
            const composerNode = (
          <div
            ref={composerWrapRef}
            className={
              "composer-wrap composer-wrap--float" +
              (welcomeSession && !sideDockActive
                ? " composer-wrap--welcome"
                : "") +
              (sideDockActive ? " composer-wrap--side-dock" : "")
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
              <div className="composer-welcome-mark">
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
                  {permCountdownSec != null && permCountdownSec > 0 ? (
                    <span className="perm-bar__countdown" aria-live="polite">
                      {tr("perm.autoDenyCountdown", {
                        seconds: String(permCountdownSec),
                      })}
                    </span>
                  ) : null}
                </div>
                <p className="perm-bar__summary" id="perm-bar-summary">
                  {formatPermissionSummary({
                    toolName: perm.toolName,
                    title: perm.title,
                    command: perm.preview,
                  })}
                </p>
                {perm.preview?.trim() ? (
                  <pre className="perm-bar__preview">{perm.preview.trim()}</pre>
                ) : null}
                <div className="perm-bar__actions" role="group">
                  {mapPermissionButtons(perm.options, {
                    allowOnce: tr("perm.allowOnce"),
                    allowSession: tr("perm.allowSession"),
                    deny: tr("perm.deny"),
                  }).map((btn) => (
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
                      title={
                        btn.decision === "allow_once"
                          ? tr("perm.hintOnce")
                          : btn.decision === "allow_session"
                            ? tr("perm.hintSession")
                            : tr("perm.hintDeny")
                      }
                      onClick={() =>
                        resolvePermission(perm, btn.decision, btn.optionId)
                      }
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {(() => {
              const showWelcomeProjectRow =
                welcomeSession && !phoneLayout && !!activeProject;
              // Env menu (chat chrome) already shows change stats — hide
              // the duplicate composer context chips to avoid two "N 变更".
              const envOwnsChangeSummary =
                mainPane === "chat" && !phoneLayout;
              const showChangesChips =
                !phoneLayout &&
                !envOwnsChangeSummary &&
                (!!sessionChangesSummary || !!gitDirtySummary);
              const showContextBar =
                showWelcomeProjectRow || showChangesChips;
              return (
            <div
              className={
                "composer-stack" +
                (showContextBar ? " composer-stack--with-context" : "")
              }
            >
            {/* Project/branch (new session) + session/workspace change chips.
                Hidden entirely when the bar would be empty. */}
            {showContextBar ? (
              <div
                className="composer__context-bar"
                aria-label={
                  showWelcomeProjectRow
                    ? tr("composer.pickProject")
                    : tr("changes.chipAria")
                }
              >
                {showWelcomeProjectRow && activeProject ? (
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
                  projects={projects.map((p) => ({
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
                  onSelect={(proj) => {
                    // Menu "general" row still passes null; bind resolves it.
                    const full = proj
                      ? projects.find((p) => p.id === proj.id) ?? null
                      : null;
                    void bindSessionProject(full);
                  }}
                  onAdd={() => {
                    void addProjectFromPicker({ bindSession: true });
                  }}
                />
                {gitWorktreesAvailable === true ? (
                  <ComposerWorktreeMenu
                    variant="context"
                    activePath={activeProject.path}
                    worktrees={gitWorktrees}
                    worktreesAvailable={gitWorktreesAvailable}
                    worktreesLoading={gitWorktreesLoading}
                    worktreesReason={gitWorktreesReason}
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
                    onCreate={() => openWorktreeCreate()}
                    onCreateAndChat={() =>
                      openWorktreeCreate({ startNewChat: true })
                    }
                    onGc={openWorktreeGc}
                    onShip={openShipFlow}
                    onRemove={confirmRemoveWorktree}
                    onOpen={() => {
                      void refreshGitWorktrees();
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
              ref={composerShellRef}
              className={
                "composer" +
                (dragZone === "main" ? " composer--drop-ready" : "")
              }
            >
              {sendQueueStrip.visible && (
                <div
                  className="composer__queue"
                  aria-label={tr("composer.queueCount", {
                    n: String(sendQueueStrip.count),
                  })}
                >
                  <div className="composer__queue-head">
                    <IconClock size={14} aria-hidden />
                    <span className="composer__queue-title">
                      {tr("composer.queueCount", {
                        n: String(sendQueueStrip.count),
                      })}
                    </span>
                    <button
                      type="button"
                      className="composer__queue-clear"
                      data-testid="queue-clear"
                      disabled={!sendQueueStrip.canClear}
                      onClick={requestClearSendQueue}
                    >
                      {tr("composer.queueClear")}
                    </button>
                  </div>
                  {sendQueueStrip.showHold ? (
                    <div className="composer__queue-hold" role="status">
                      <span className="composer__queue-hold-text">
                        {tr("composer.queueHold")}
                      </span>
                      <button
                        type="button"
                        className="composer__queue-hold-retry"
                        onClick={() => sendQueue.resumeFlush()}
                      >
                        {tr("composer.queueHoldRetry")}
                      </button>
                    </div>
                  ) : null}
                  <ul className="composer__queue-list">
                    {sendQueue.activeQueue.map((item, idx) => {
                      const queueLen = sendQueue.activeQueue.length;
                      const rowBusy =
                        guidingQueueItemId === item.id ||
                        queueEditItemId !== null;
                      return (
                      <li key={item.id} className="composer__queue-item">
                        <span className="composer__queue-idx" aria-hidden>
                          {idx + 1}
                        </span>
                        <span
                          className="composer__queue-text"
                          title={queuePreviewText(
                            item.storedDisplay,
                            item.attachments,
                            200,
                            queuePreviewLabels,
                          )}
                        >
                          {queuePreviewText(
                            item.storedDisplay,
                            item.attachments,
                            72,
                            queuePreviewLabels,
                          )}
                        </span>
                        <div className="composer__queue-move">
                          <button
                            type="button"
                            className="composer__queue-move-btn"
                            data-testid="queue-move-up"
                            aria-label={tr("composer.queueMoveUp")}
                            title={tr("composer.queueMoveUp")}
                            disabled={rowBusy || idx === 0}
                            onClick={() =>
                              sendQueue.moveItem(item.id, "up")
                            }
                          >
                            <IconChevronUp size={12} aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="composer__queue-move-btn"
                            data-testid="queue-move-down"
                            aria-label={tr("composer.queueMoveDown")}
                            title={tr("composer.queueMoveDown")}
                            disabled={rowBusy || idx >= queueLen - 1}
                            onClick={() =>
                              sendQueue.moveItem(item.id, "down")
                            }
                          >
                            <IconChevronDown size={12} aria-hidden />
                          </button>
                        </div>
                        <button
                          type="button"
                          className="composer__queue-edit"
                          data-testid="queue-edit"
                          aria-label={tr("composer.queueEdit")}
                          title={tr("composer.queueEdit")}
                          disabled={rowBusy}
                          onClick={() => openQueueEdit(item)}
                        >
                          {tr("composer.queueEdit")}
                        </button>
                        <button
                          type="button"
                          className="composer__queue-guide"
                          data-testid="queue-guide"
                          aria-label={
                            guidingQueueItemId === item.id ||
                            guidingQueueItemId !== null
                              ? tr("composer.queueGuiding")
                              : canGuideQueuedMessage
                                ? tr("composer.queueGuide")
                                : tr("composer.queueGuideUnavailable")
                          }
                          title={
                            guidingQueueItemId === item.id ||
                            guidingQueueItemId !== null
                              ? tr("composer.queueGuiding")
                              : canGuideQueuedMessage
                                ? tr("composer.queueGuide")
                                : tr("composer.queueGuideUnavailable")
                          }
                          disabled={
                            !canGuideQueuedMessage || guidingQueueItemId !== null
                          }
                          onClick={() => void guideQueuedMessage(item)}
                        >
                          {guidingQueueItemId === item.id
                            ? tr("composer.queueGuiding")
                            : tr("composer.queueGuide")}
                        </button>
                        <button
                          type="button"
                          className="composer__queue-remove"
                          aria-label={tr("composer.queueRemove")}
                          disabled={guidingQueueItemId === item.id}
                          onClick={() => sendQueue.removeItem(item.id)}
                        >
                          <IconClose size={12} />
                        </button>
                      </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {attachments.length > 0 && (
                <div
                  className="composer__attachments"
                  aria-label={tr("composer.attachCount", {
                    n: String(attachments.length),
                  })}
                >
                  {attachments.map((a) => (
                    <AttachmentCard
                      key={a.path}
                      attachment={a}
                      variant="chip"
                      labels={attachLabels}
                      galleryPaths={attachments
                        .filter((x) => !x.isDir && isImagePath(x.path))
                        .map((x) => x.path)}
                      onRemove={(att) =>
                        setAttachments((prev) =>
                          prev.filter((x) => x.path !== att.path),
                        )
                      }
                      onAddToComposer={(att) =>
                        setAttachments((prev) => mergeAttachments(prev, [att]))
                      }
                    />
                  ))}
                </div>
              )}
              {composerMenuOpen &&
                composerPlusPos &&
                typeof document !== "undefined" &&
                createPortal(
                  <ComposerPlusPanel
                    open
                    panelRef={composerPlusPanelRef}
                    locale={locale}
                    entries={composerMenuEntries}
                    filterQuery={
                      liveSlash.present ? slashFilterQuery : undefined
                    }
                    kindFilter={slashKindFilter}
                    onKindFilterChange={(k) => {
                      setSlashKindFilter(k);
                      setSlashActiveIndex(0);
                    }}
                    catalogCount={slashCatalogCount}
                    kindCounts={slashKindCounts}
                    skillsLoading={skillsLoading}
                    skillsError={skillsLoadError}
                    skillCount={slashCatalog.skills.length}
                    activeIndex={slashActiveIndex}
                    onActiveIndexChange={setSlashActiveIndex}
                    onSelectUpload={() => {
                      void pickComposerFiles();
                    }}
                    onSelectJsonSchema={() => {
                      closeComposerMenu();
                      setJsonSchemaDraft(sessionJsonSchema ?? "");
                      setShowJsonSchemaModal(true);
                    }}
                    onSelectSlash={applySlashItem}
                    onClearFilters={clearSlashFilters}
                    resolveTitle={resolveSlashTitle}
                    resolveDescription={resolveSlashDescription}
                    style={{
                      ...composerPlusStyle,
                      zIndex: 10050,
                    }}
                  />,
                  document.body,
                )}
              {atMenuOpen &&
                composerAtPos &&
                typeof document !== "undefined" &&
                createPortal(
                  <ComposerAtPanel
                    open
                    panelRef={atPanelRef}
                    locale={locale}
                    entries={atEntries}
                    filterQuery={liveAt.query}
                    loading={atLoading}
                    softFail={atSoftFail}
                    activeIndex={atActiveIndex}
                    onActiveIndexChange={setAtActiveIndex}
                    onSelect={applyAtFile}
                    style={{
                      ...composerAtStyle,
                      zIndex: 10050,
                    }}
                  />,
                  document.body,
                )}
              {promptHistoryOpen &&
                promptHistoryPos &&
                typeof document !== "undefined" &&
                createPortal(
                  <PromptHistoryPanel
                    open
                    panelRef={promptHistoryPanelRef}
                    scope={promptHistoryScope}
                    onScopeChange={(next) => {
                      setPromptHistoryScope(next);
                      setPromptHistoryActive(0);
                      // Leaving session browse when switching to recent.
                      if (next === "recent") {
                        promptHistoryIndexRef.current = null;
                        setPromptHistoryIndex(null);
                      }
                    }}
                    entries={promptHistoryEntries}
                    unfilteredCount={promptHistoryUnfilteredCount}
                    query={promptHistoryFilter}
                    activeIndex={promptHistoryActive}
                    focusFilter={promptHistoryFocusFilter}
                    entryMeta={promptHistoryEntryMeta}
                    labels={{
                      tabSession: tr("promptHistory.tabSession"),
                      tabRecent: tr("promptHistory.tabRecent"),
                      placeholder: tr("promptHistory.placeholder"),
                      empty: tr("promptHistory.empty"),
                      emptyFilter: tr("promptHistory.emptyFilter"),
                      emptyRecent: tr("promptHistory.emptyRecent"),
                      emptyRecentFilter: tr("promptHistory.emptyRecentFilter"),
                      aria: tr("promptHistory.aria"),
                      clearFilter: tr("promptHistory.clearFilter"),
                      clearRecent: tr("promptHistory.clearRecent"),
                      removeRecent: tr("promptHistory.removeRecent"),
                    }}
                    onQueryChange={setPromptHistoryFilter}
                    onActiveIndexChange={(i) => {
                      setPromptHistoryActive(i);
                      const entry = promptHistoryEntries[i];
                      if (
                        entry &&
                        !promptHistoryFocusFilter &&
                        promptHistoryScope === "session"
                      ) {
                        // Empty-↑ browse: mirror Build — each step lands in the input.
                        applyPromptHistoryEntry(entry, {
                          close: false,
                          listIndex: i,
                          scope: "session",
                        });
                      }
                    }}
                    onSelect={(entry) =>
                      applyPromptHistoryEntry(entry, {
                        scope: promptHistoryScope,
                      })
                    }
                    onRequestClearRecent={() => setPromptHistoryClearOpen(true)}
                    onRemoveRecent={(historyIndex) => {
                      setRecentPromptHistory(removeRecentPrompt(historyIndex));
                      setPromptHistoryActive((i) => Math.max(0, i));
                    }}
                    onClose={closePromptHistory}
                    style={{
                      ...promptHistoryStyle,
                      zIndex: 10050,
                    }}
                  />,
                  document.body,
                )}
              <ComposerDraftEditor
                editorRef={composerInputRef}
                className="composer__input"
                disabled={!canType(session.state)}
                spellCheck={composerSpellcheck}
                aria-label={tr("a11y.composerInput")}
                placeholder={
                  goalMode
                    ? tr("composer.goalPlaceholder")
                    : tr("composer.placeholder")
                }
                onDraftChange={onComposerDraftChange}
                onPasteFiles={onComposerPasteFiles}
                onPasteMediaFallback={onComposerPasteMediaFallback}
                onSlashQueryChange={onSlashQueryChange}
                onKeyDown={onComposerKeyDown}
                onContextMenu={onComposerContextMenu}
              />
              <div
                className={
                  "composer__row" + (phoneLayout ? " composer__row--phone" : "")
                }
              >
                <Tip label={tr("composer.add")} disabled={phoneLayout}>
                  <button
                    ref={composerPlusTriggerRef}
                    type="button"
                    className={
                      "icon-btn icon-btn--plus" +
                      (composerMenuOpen || phoneToolsOpen ? " is-open" : "")
                    }
                    aria-label={tr("composer.add")}
                    onClick={() => {
                      if (phoneLayout) {
                        setPhoneToolsOpen((v) => !v);
                        closeComposerMenu();
                        return;
                      }
                      if (composerMenuOpen) {
                        closeComposerMenu();
                      } else {
                        setShowComposerPlus(true);
                      }
                    }}
                  >
                    <IconPlus size={18} />
                  </button>
                </Tip>
                {!phoneLayout ? (
                  <>
                    {goalMode ? (
                      <Tip label={tr("composer.goalHint")}>
                        <button
                          type="button"
                          className="chip chip--goal"
                          onClick={() => setGoalMode(false)}
                          aria-label={tr("composer.goalClear")}
                        >
                          <IconImagine size={14} />
                          <span className="chip__label">
                            {tr("composer.goal")}
                          </span>
                          <IconClose size={12} />
                        </button>
                      </Tip>
                    ) : null}
                    {sessionJsonSchema ? (
                      <Tip
                        label={sessionJsonSchema}
                        className="ui-tip--wrap ui-tip--mono"
                      >
                        <button
                          type="button"
                          className="icon-btn chip--json-schema is-active"
                          onClick={() => {
                            setJsonSchemaDraft(sessionJsonSchema);
                            setShowJsonSchemaModal(true);
                          }}
                          aria-label={tr("composer.jsonSchemaActive")}
                        >
                          <IconCode size={16} />
                        </button>
                      </Tip>
                    ) : null}
                    <ComposerModelMenu
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
                      }}
                      onModelPick={(pick) => {
                        void handleModelPick(pick);
                      }}
                      onEffort={(v) => {
                        if (
                          !isValidEffort(
                            v,
                            channelEffortOptions ?? undefined,
                          )
                        )
                          return;
                        setEffort(v);
                        void api
                          .composerPrefsSet({
                            projectId: activeProject?.id ?? null,
                            sessionId: session.sessionId ?? null,
                            effort: v,
                          })
                          .catch((e) => showToast(String(e), 4000));
                      }}
                    />
                    <ComposerAccessMenu
                      mode={mode}
                      policy={policy}
                      labels={{
                        access: tr("composer.access"),
                        accessHint: tr("composer.accessHint"),
                        mode: tr("composer.mode"),
                        modeAgent: tr("mode.agent"),
                        modePlan: tr("mode.plan"),
                        modeAsk: tr("mode.ask"),
                        modeAgentDesc: tr("mode.agentDesc"),
                        modePlanDesc: tr("mode.planDesc"),
                        modeAskDesc: tr("mode.askDesc"),
                        permission: tr("composer.permission"),
                        policyAsk: tr("policy.ask"),
                        policyAcceptEdits: tr("policy.accept_edits"),
                        policySession: tr("policy.allow_for_session"),
                        policyAuto: tr("policy.auto"),
                        policyDontAsk: tr("policy.dont_ask"),
                        policyYolo: tr("policy.always_approve"),
                        policyAskDesc: tr("policy.askDesc"),
                        policyAcceptEditsDesc: tr("policy.accept_editsDesc"),
                        policySessionDesc: tr(
                          "policy.allow_for_sessionDesc",
                        ),
                        policyAutoDesc: tr("policy.autoDesc"),
                        policyDontAskDesc: tr("policy.dont_askDesc"),
                        policyYoloDesc: tr("policy.always_approveDesc"),
                        policyShortAsk: tr("policy.short.ask"),
                        policyShortAccept: tr("policy.short.accept_edits"),
                        policyShortSession: tr(
                          "policy.short.allow_for_session",
                        ),
                        policyShortAuto: tr("policy.short.auto"),
                        policyShortDontAsk: tr("policy.short.dont_ask"),
                        policyShortYolo: tr("policy.short.always_approve"),
                      }}
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
                    />
                    <ContextUsageChip
                      display={contextUsageDisplay}
                      locale={locale}
                      labels={{
                        aria: tr("context.chipAria"),
                        tipUnknown: tr("context.chipTipUnknown"),
                        tipEstimated: tr("context.chipTipEstimated"),
                        tipKnown: tr("context.chipTipKnown"),
                        menuTitle: tr("context.menuTitle"),
                        current: tr("context.current"),
                        sourceKnown: tr("context.sourceKnown"),
                        sourceEstimated: tr("context.sourceEstimated"),
                        sourceUnknown: tr("context.sourceUnknown"),
                        lastCompact: tr("context.lastCompact"),
                        lastCompactNone: tr("context.lastCompactNone"),
                        tokensRange: tr("compact.tokensRange"),
                        compactAction: tr("context.compactAction"),
                        heuristicNote: tr("context.heuristicNote"),
                        auto: tr("context.triggerAuto"),
                        manual: tr("context.triggerManual"),
                        breakdownUser: tr("context.breakdownUser"),
                        breakdownAssistant: tr("context.breakdownAssistant"),
                        breakdownThought: tr("context.breakdownThought"),
                        breakdownEstimatedNote: tr(
                          "context.breakdownEstimatedNote",
                        ),
                        window: tr("context.window"),
                        percentUsed: tr("context.percentLabel"),
                        cacheHit: tr("context.cacheHit"),
                      }}
                      onCompact={() => {
                        setCompactNote("");
                        setShowCompactModal(true);
                      }}
                    />
                  </>
                ) : null}
                <ComposerDraftStats show={showComposerDraftStats} tr={tr} />
                <ComposerClearDraftButton
                  attachmentsLength={attachments.length}
                  onClear={() => requestClearComposerDraft()}
                  label={tr("composer.clearDraft")}
                />
                <span className="composer__spacer" />
                {/* Dictation (mic): official auth only. Live Voice icon entry hidden. */}
                {(voiceGate.available || voiceIsActive(voice.phase)) && (
                  <Tip
                    label={
                      voice.phase === "recording"
                        ? tr("composer.voiceListening")
                        : voice.phase === "transcribing"
                          ? tr("composer.voiceTranscribing")
                          : tr("composer.voice")
                    }
                  >
                    <button
                      type="button"
                      className={
                        "icon-btn composer__voice" +
                        (voice.phase === "recording"
                          ? " composer__voice--live"
                          : "") +
                        (voice.phase === "transcribing"
                          ? " composer__voice--busy"
                          : "")
                      }
                      disabled={
                        voice.phase === "transcribing" ||
                        voice.phase === "requesting_mic" ||
                        liveVoiceOpen ||
                        !canType(session.state)
                      }
                      aria-pressed={voice.phase === "recording"}
                      aria-label={
                        voice.phase === "recording"
                          ? tr("composer.voiceListening")
                          : tr("composer.voice")
                      }
                      onClick={() => toggleVoice()}
                    >
                      <IconMic size={16} />
                    </button>
                  </Tip>
                )}
                <ComposerSendCluster
                  attachmentsLength={attachments.length}
                  effectiveCanStop={effectiveCanStop}
                  connecting={connecting}
                  sessionState={session.state}
                  effectiveCanSend={effectiveCanSend}
                  shouldEnqueue={shouldEnqueueSend(session.state, connecting)}
                  canShowQueueButton={(state, conn, hasBody) =>
                    sendQueue.canShowQueueButton(state, conn, hasBody)
                  }
                  onSend={() => void send()}
                  onStop={() => void stop()}
                  tr={tr}
                />
              </div>
            </div>
            </div>
              );
            })()}
          </div>
            );
            // Portal out of .main so main[inert] cannot block focus/clicks.
            // Fixed bottom strip; aside bottom = --sw-dock-composer-h.
            return sideDockActive && typeof document !== "undefined"
              ? createPortal(composerNode, document.body)
              : composerNode;
          })()}
          </div>
          </>
          )}
        </main>

        {/* RIGHT — session-linked project resource viewer (fully hideable + resizable) */}
        <aside
          className={
            (layout.asideCollapsed ? "aside aside--hidden" : "aside") +
            (resizingAside ? " is-resizing" : "") +
            (phoneLayout ? " aside--phone-overlay" : "") +
            (hideChatForSideExpand ? " aside--side-expanded" : "")
          }
          aria-label={tr("a11y.resourcesPane")}
          aria-hidden={layout.asideCollapsed}
          style={
            !layout.asideCollapsed && !phoneLayout && !hideChatForSideExpand
              ? {
                  width: layout.asideWidth,
                  minWidth: layout.asideWidth,
                  maxWidth: layout.asideWidth,
                }
              : undefined
          }
        >
          {!layout.asideCollapsed && !hideChatForSideExpand && (
            <div
              className="aside-resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize files pane"
              onPointerDown={(e) => {
                e.preventDefault();
                setResizingAside(true);
              }}
            />
          )}
          <div className="aside__inner">
            <Suspense fallback={null}>
              <SideWorkbench
                locale={locale}
                projectPath={effectiveProjectPath}
                projectName={
                  activeProject
                    ? projectDisplayName(activeProject, tr)
                    : tr("composer.noProject")
                }
                isGitProject={sideIsGitProject}
                state={sideWorkbench}
                onStateChange={setSideWorkbench}
                dockComposer={sideDockComposer}
                onToggleDockComposer={
                  phoneLayout ? undefined : onToggleSideDockComposer
                }
                paneActive={!layout.asideCollapsed}
                sessionChanges={
                  sessionChangesById[session.sessionId || ""] ?? []
                }
                plan={plan}
                planFocusKey={planFocusKey}
                onApprovePlan={() => void approvePlan()}
                onRequestPlanChanges={() => openRequestPlanChanges()}
                onDismissPlan={() => void dismissPlan()}
                openRequest={resourceOpenTarget}
                onOpenRequestConsumed={() => setResourceOpenTarget(null)}
                onCloseSide={closeAsidePane}
                onExpandedChange={(expanded) => {
                  if (phoneLayout) return;
                  if (!expanded) setSideDockComposer(false);
                }}
              />
            </Suspense>
          </div>
        </aside>
      </div>
      ))}

      {phoneLayout ? (
        <>
          <PhoneComposerToolsSheet
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
            onEffort={(v) => {
              if (
                !isValidEffort(v, channelEffortOptions ?? undefined)
              )
                return;
              setEffort(v);
              void api
                .composerPrefsSet({
                  projectId: activeProject?.id ?? null,
                  sessionId: session.sessionId ?? null,
                  effort: v,
                })
                .catch((e) => showToast(String(e), 4000));
            }}
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
              setCompactNote("");
              setShowCompactModal(true);
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

      {(showDoctor) ? (
      <Suspense fallback={null}>
      <DoctorModal
        open={showDoctor}
        onClose={() => setShowDoctor(false)}
        locale={locale}
        onConfirm={({ title, message, confirmLabel, danger, onConfirm }) => {
          setAppDialog({
            kind: "confirm",
            title,
            message,
            confirmLabel,
            danger,
            onConfirm,
          });
        }}
        onResetDone={() => {
          void refreshLists();
        }}
        onOpenReliability={() => openReliability()}
      />
      </Suspense>
      ) : null}
      {(showReliability) ? (
      <Suspense fallback={null}>
      <ReliabilityCenterModal
        open={showReliability}
        onClose={() => setShowReliability(false)}
        locale={locale}
        view={reliabilityView}
        goalOrchUiEnabled={goalOrchUiEnabled}
        goalOrchEvents={goalOrchEvents}
        lastProcessLimit={lastProcessLimit}
        existingSessionIds={sessions.map((s) => s.id)}
        onOpenDoctor={() => void openDoctor()}
        onSelectSession={(id) => {
          setShowReliability(false);
          trayHandlersRef.current.openSessionById(id);
        }}
      />
      </Suspense>
      ) : null}
      <ProjectRulesModal
        open={!!projectRulesTarget}
        onClose={() => setProjectRulesTarget(null)}
        projectPath={projectRulesTarget?.path ?? null}
        projectName={projectRulesTarget?.name ?? null}
        locale={locale}
      />
      <GlassModal
        open={promptHistoryClearOpen}
        onClose={() => setPromptHistoryClearOpen(false)}
        title={tr("promptHistory.clearRecentConfirmTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setPromptHistoryClearOpen(false)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              data-testid="prompt-history-clear-confirm"
              onClick={() => {
                setRecentPromptHistory(clearRecentPromptHistory());
                setPromptHistoryActive(0);
                setPromptHistoryClearOpen(false);
              }}
            >
              {tr("promptHistory.clearRecentConfirmAction")}
            </button>
          </>
        }
      >
        <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>
          {tr("promptHistory.clearRecentConfirmBody")}
        </p>
      </GlassModal>
      <GlassModal
        open={!!archiveAgeConfirm}
        onClose={() => {
          if (archiveAgeBusy) return;
          setArchiveAgeConfirm(null);
        }}
        title={tr("sidebar.archiveOlderTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        closeOnOverlay={!archiveAgeBusy}
        showClose={!archiveAgeBusy}
        wrapBody
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={archiveAgeBusy}
              onClick={() => setArchiveAgeConfirm(null)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={archiveAgeBusy || !archiveAgeConfirm?.count}
              data-testid="archive-age-confirm"
              onClick={() => {
                if (!archiveAgeConfirm) return;
                void runArchiveAgePlan(archiveAgeConfirm);
              }}
            >
              {tr("sidebar.archiveOlderConfirmAction", {
                n: String(archiveAgeConfirm?.count ?? 0),
              })}
            </button>
          </>
        }
      >
        {archiveAgeConfirm ? (
          <div className="archive-age-modal">
            <p className="archive-age-modal__msg">
              {tr("sidebar.archiveOlderConfirm", {
                n: String(archiveAgeConfirm.count),
                days: String(archiveAgeConfirm.days),
              })}
            </p>
            {archiveAgeConfirm.previewTitles.length > 0 ? (
              <div className="archive-age-modal__preview">
                <div className="archive-age-modal__preview-label">
                  {tr("sidebar.archiveOlderPreviewLabel")}
                </div>
                <ul className="archive-age-modal__list">
                  {archiveAgeConfirm.previewTitles.map((title, i) => {
                    const row = archiveAgeConfirm.sessions[i];
                    const key = row?.id ?? `preview-${i}`;
                    return (
                      <li key={key} className="archive-age-modal__item">
                        {title || tr("session.untitled")}
                      </li>
                    );
                  })}
                </ul>
                {archiveAgeConfirm.previewMore > 0 ? (
                  <div className="archive-age-modal__more">
                    {tr("sidebar.archiveOlderPreviewMore", {
                      n: String(archiveAgeConfirm.previewMore),
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </GlassModal>
      <GlassModal
        open={worktreeCreateOpen}
        onClose={() => {
          if (worktreeCreateBusy) return;
          setWorktreeCreateOpen(false);
        }}
        title={
          worktreeCreateStartChat
            ? tr("composer.worktreeNewChatTitle")
            : tr("composer.worktreeNewTitle")
        }
        size="sm"
        closeLabel={tr("common.close")}
        closeOnOverlay={!worktreeCreateBusy}
        showClose={!worktreeCreateBusy}
        wrapBody
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={worktreeCreateBusy}
              onClick={() => setWorktreeCreateOpen(false)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={worktreeCreateBusy || !worktreeCreateName.trim()}
              onClick={() => {
                void submitWorktreeCreate();
              }}
            >
              {worktreeCreateBusy
                ? tr("composer.worktreeCreating")
                : worktreeCreateStartChat
                  ? tr("composer.worktreeCreateChat")
                  : tr("composer.worktreeCreate")}
            </button>
          </>
        }
      >
        <form
          className="wt-create"
          onSubmit={(e) => {
            e.preventDefault();
            if (worktreeCreateBusy) return;
            void submitWorktreeCreate();
          }}
        >
          <p className="wt-create__hint">
            {worktreeCreateStartChat
              ? tr("composer.worktreeNewChatHint")
              : tr("composer.worktreeNewHint")}
          </p>
          <label className="wt-create__field">
            <span className="wt-create__label">
              {tr("composer.worktreeName")}
            </span>
            <input
              className="settings-input"
              value={worktreeCreateName}
              onChange={(e) => {
                setWorktreeCreateName(e.target.value);
                setWorktreeCreateError(null);
              }}
              placeholder={tr("composer.worktreeNamePlaceholder")}
              autoComplete="off"
              autoFocus
              disabled={worktreeCreateBusy}
              spellCheck={false}
            />
          </label>
          <fieldset className="wt-create__field wt-create__layout" disabled={worktreeCreateBusy}>
            <legend className="wt-create__label">
              {tr("composer.worktreeLayout")}
            </legend>
            <label className="wt-create__radio">
              <input
                type="radio"
                name="worktree-layout"
                value="cli"
                checked={worktreeCreateLayout === "cli"}
                onChange={() => {
                  setWorktreeCreateLayout("cli");
                  setWorktreeCreateError(null);
                }}
              />
              <span>{tr("composer.worktreeLayoutCli")}</span>
            </label>
            <label className="wt-create__radio">
              <input
                type="radio"
                name="worktree-layout"
                value="sibling"
                checked={worktreeCreateLayout === "sibling"}
                onChange={() => {
                  setWorktreeCreateLayout("sibling");
                  setWorktreeCreateError(null);
                }}
              />
              <span>{tr("composer.worktreeLayoutSibling")}</span>
            </label>
          </fieldset>
          <label className="wt-create__field">
            <span className="wt-create__label">
              {tr("composer.worktreeRef")}
            </span>
            <input
              className="settings-input"
              value={worktreeCreateRef}
              onChange={(e) => {
                setWorktreeCreateRef(e.target.value);
                setWorktreeCreateError(null);
              }}
              placeholder={tr("composer.worktreeRefPlaceholder")}
              autoComplete="off"
              disabled={worktreeCreateBusy}
              spellCheck={false}
            />
          </label>
          {worktreeCreatePreviewPath ? (
            <p className="wt-create__preview">
              {tr("composer.worktreePathPreview", {
                path: worktreeCreatePreviewPath,
              })}
            </p>
          ) : null}
          {worktreeCreateError ? (
            <p className="wt-create__error" role="alert">
              {worktreeCreateError}
            </p>
          ) : null}
        </form>
      </GlassModal>
      <GlassModal
        open={worktreeGcOpen}
        onClose={() => {
          if (worktreeGcBusy) return;
          setWorktreeGcOpen(false);
          setWorktreeGcError(null);
          setWorktreeGcPreview(null);
          setWorktreeGcForce(false);
        }}
        title={tr("composer.worktreeGcTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        closeOnOverlay={!worktreeGcBusy}
        showClose={!worktreeGcBusy}
        wrapBody
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={worktreeGcBusy}
              onClick={() => {
                setWorktreeGcOpen(false);
                setWorktreeGcError(null);
                setWorktreeGcPreview(null);
                setWorktreeGcForce(false);
              }}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={worktreeGcBusy || worktreeGcPreviewBusy}
              onClick={() => {
                void submitWorktreeGc();
              }}
            >
              {worktreeGcBusy
                ? tr("composer.worktreeGcRunning")
                : tr("composer.worktreeGcConfirm")}
            </button>
          </>
        }
      >
        <div className="wt-gc">
          <p className="wt-gc__hint">{tr("composer.worktreeGcHint")}</p>
          <label className="wt-gc__force">
            <input
              type="checkbox"
              checked={worktreeGcForce}
              disabled={worktreeGcBusy || worktreeGcPreviewBusy}
              onChange={(e) => setWorktreeGcForce(e.target.checked)}
            />
            <span>{tr("composer.worktreeGcForce")}</span>
          </label>
          <div className="wt-gc__preview-head">{tr("composer.worktreeGcPreview")}</div>
          {worktreeGcPreviewBusy ? (
            <p className="wt-gc__preview-status">
              {tr("composer.worktreeGcPreviewLoading")}
            </p>
          ) : worktreeGcPreview ? (
            <>
              {(worktreeGcPreview.prunable?.length ?? 0) > 0 ? (
                <p className="wt-gc__prunable">
                  {tr("composer.worktreeGcPrunable", {
                    n: String(worktreeGcPreview.prunable?.length ?? 0),
                  })}
                </p>
              ) : null}
              {(worktreeGcPreview.output ?? "").trim() ||
              (worktreeGcPreview.prunable?.length ?? 0) > 0 ? (
                <pre className="wt-gc__output" tabIndex={0}>
                  {(worktreeGcPreview.output ?? "").trim() ||
                    (Array.isArray(worktreeGcPreview.prunable)
                      ? worktreeGcPreview.prunable.join("\n")
                      : "")}
                </pre>
              ) : (
                <p className="wt-gc__preview-status">
                  {tr("composer.worktreeGcPreviewEmpty")}
                </p>
              )}
            </>
          ) : worktreeGcError ? null : (
            <p className="wt-gc__preview-status">
              {tr("composer.worktreeGcPreviewEmpty")}
            </p>
          )}
          {worktreeGcError ? (
            <p className="wt-gc__error" role="alert">
              {worktreeGcError}
            </p>
          ) : null}
        </div>
      </GlassModal>
      <GlassModal
        open={shipOpen}
        onClose={closeShipFlow}
        title={
          shipSuccess
            ? tr("composer.worktreeShipSuccessTitle")
            : tr("composer.worktreeShipTitle")
        }
        size="md"
        closeLabel={tr("common.close")}
        closeOnOverlay={!shipBusy}
        showClose={!shipBusy}
        wrapBody
        footer={
          shipSuccess ? (
            <>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={closeShipFlow}
                data-testid="ship-success-done"
              >
                {tr("composer.worktreeShipDone")}
              </button>
              <button
                type="button"
                className="btn btn--solid"
                onClick={() => openPrHubFromShip(shipSuccess.prNumber)}
                data-testid="ship-open-pr-hub"
              >
                {tr("composer.worktreeShipOpenInHub")}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={shipBusy}
                onClick={closeShipFlow}
              >
                {tr("common.cancel")}
              </button>
              <button
                type="button"
                className="btn btn--solid"
                disabled={shipBusy || !shipTitle.trim()}
                onClick={() => {
                  void submitShipFlow();
                }}
                data-testid="ship-submit"
              >
                {shipBusy
                  ? shipStatus || tr("composer.worktreeShipRunning")
                  : shipCreatePr
                    ? tr("composer.worktreeShipConfirmPr")
                    : tr("composer.worktreeShipConfirmPush")}
              </button>
            </>
          )
        }
      >
        {shipSuccess ? (
          <div
            className="wt-ship wt-ship--success"
            data-testid="ship-success"
          >
            <p className="wt-ship__hint">
              {tr("composer.worktreeShipDonePr", { url: shipSuccess.prUrl })}
            </p>
            <p className="wt-ship__success-url" title={shipSuccess.prUrl}>
              {shipSuccess.prUrl}
            </p>
            <div className="wt-ship__success-actions">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  void api.openExternalUrl(shipSuccess.prUrl).catch(() => {
                    showToast(tr("composer.worktreeShipOpenBrowserFailed"), 3500);
                  });
                }}
                data-testid="ship-open-browser"
              >
                {tr("composer.worktreeShipOpenInBrowser")}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => openPrHubFromShip(shipSuccess.prNumber)}
              >
                {tr("composer.worktreeShipOpenInHub")}
              </button>
            </div>
          </div>
        ) : (
          <form
            className="wt-ship"
            onSubmit={(e) => {
              e.preventDefault();
              if (shipBusy || !shipTitle.trim()) return;
              void submitShipFlow();
            }}
          >
            <p className="wt-ship__hint">{tr("composer.worktreeShipHint")}</p>
            {shipBranch ? (
              <p className="wt-ship__branch">
                {tr("composer.worktreeShipBranch", { branch: shipBranch })}
              </p>
            ) : null}
            <label className="wt-ship__field">
              <span className="wt-ship__label">
                {tr("composer.worktreeShipTitleField")}
              </span>
              <input
                className="settings-input"
                value={shipTitle}
                onChange={(e) => {
                  setShipTitle(e.target.value);
                  setShipError(null);
                }}
                placeholder={tr("composer.worktreeShipTitlePlaceholder")}
                autoComplete="off"
                autoFocus
                disabled={shipBusy}
                spellCheck={true}
                data-testid="ship-title"
              />
            </label>
            <label className="wt-ship__field">
              <span className="wt-ship__label">
                {tr("composer.worktreeShipBodyField")}
              </span>
              <textarea
                className="settings-input wt-ship__body"
                value={shipBody}
                onChange={(e) => {
                  setShipBody(e.target.value);
                  setShipError(null);
                }}
                placeholder={tr("composer.worktreeShipBodyPlaceholder")}
                rows={5}
                disabled={shipBusy}
                spellCheck={true}
                data-testid="ship-body"
              />
            </label>
            <label className="wt-ship__check">
              <input
                type="checkbox"
                checked={shipCreatePr}
                disabled={shipBusy}
                onChange={(e) => setShipCreatePr(e.target.checked)}
              />
              <span>{tr("composer.worktreeShipCreatePr")}</span>
            </label>
            <label className="wt-ship__check">
              <input
                type="checkbox"
                checked={shipDraft}
                disabled={shipBusy || !shipCreatePr}
                onChange={(e) => setShipDraft(e.target.checked)}
              />
              <span>{tr("composer.worktreeShipDraft")}</span>
            </label>
            {shipStatus ? (
              <p className="wt-ship__status" aria-live="polite">
                {shipStatus}
              </p>
            ) : null}
            {shipError ? (
              <p className="wt-ship__error" role="alert">
                {shipError}
              </p>
            ) : null}
          </form>
        )}
      </GlassModal>
      <GlassModal
        open={showShortcuts}
        onClose={() => setShowShortcuts(false)}
        title={tr("shortcuts.title")}
        size="md"
        closeLabel={tr("shortcuts.close")}
        footer={
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setShowShortcuts(false)}
          >
            {tr("shortcuts.close")}
          </button>
        }
      >
        <ul className="shortcuts-list">
          {shortcutsForPlatform(
            platform === "mac" ? "mac" : platform === "win" ? "win" : "other",
            composerSendKeyPref,
            shortcutRemaps,
            voiceHotkeyEnabled,
          ).map((row) => (
            <li key={row.id} className="shortcuts-list__row">
              <span className="shortcuts-list__label">
                {tr(row.labelKey as MessageKey)}
              </span>
              <kbd className="shortcuts-list__keys">
                {row.keys === SHORTCUT_KEYS_OFF
                  ? tr("shortcuts.off")
                  : row.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </GlassModal>
      {(showProductTutorial) ? (
      <Suspense fallback={null}>
      <ProductTutorial
        open={showProductTutorial}
        locale={locale}
        onClose={() => {
          markProductTutorialDone();
          setShowProductTutorial(false);
        }}
        onSkip={() => {
          markProductTutorialDone();
          setShowProductTutorial(false);
        }}
        onDone={() => {
          markProductTutorialDone();
          setShowProductTutorial(false);
        }}
      />
      </Suspense>
      ) : null}
      {(liveVoiceOpen) ? (
      <Suspense fallback={null}>
      <VoiceOverlay
        locale={resolveLocale(locale)}
        open={liveVoiceOpen}
        projectPath={effectiveProjectPath}
        projectId={activeProject?.id ?? null}
        projectName={
          activeProject
            ? projectDisplayName(activeProject, tr)
            : tr("composer.noProject")
        }
        voiceId={voiceId}
        keepAgentsOnEnd={voiceKeepAgentsOnEnd}
        hasActiveSession={Boolean(session.sessionId)}
        onClose={() => setLiveVoiceOpen(false)}
        onSendTranscriptAsPrompt={
          session.sessionId
            ? async (prompt) => {
                await executeSend({
                  storedDisplay: prompt,
                  att: [],
                  goalMode: false,
                  targetSessionId: session.sessionId,
                });
              }
            : undefined
        }
        onOpenSession={(id) => {
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
      </Suspense>
      ) : null}
      <AskUserModal
        payload={askUser}
        timeoutSec={askUserTimeoutSec}
        labels={{
          title: tr("askUser.title"),
          submit: tr("askUser.submit"),
          cancel: tr("askUser.cancel"),
          otherPlaceholder: tr("askUser.otherPlaceholder"),
          freeTextHint: tr("askUser.freeTextHint"),
          multiHint: tr("askUser.multiHint"),
          close: tr("common.close"),
          autoCancelCountdown: tr("askUser.autoCancelCountdown"),
        }}
        onSubmit={async (answers) => {
          if (!askUser) return;
          try {
            await api.sessionResolveAskUser({
              decision: "accepted",
              answers,
              rpcId: askUser.rpcId,
              sessionId: askUser.sessionId,
            });
            clearPendingGates(askUser.sessionId);
            setAskUser(null);
          } catch (e) {
            showToast(String(e), 4500);
          }
        }}
        onCancel={async () => {
          if (!askUser) return;
          try {
            await api.sessionResolveAskUser({
              decision: "cancelled",
              rpcId: askUser.rpcId,
              sessionId: askUser.sessionId,
            });
          } catch {
            /* still hide UI */
          }
          clearPendingGates(askUser.sessionId);
          setAskUser(null);
        }}
      />
      <StatusModal
        open={showStatusModal}
        locale={locale}
        sessionId={session.sessionId}
        agentSessionId={session.agentSessionId}
        modelId={modelId}
        effort={effort}
        mode={mode}
        policy={policy}
        projectPath={effectiveProjectPath}
        messageCount={messages.length}
        onClose={() => setShowStatusModal(false)}
      />
      {(agentDashboardOpen) ? (
      <Suspense fallback={null}>
      <AgentDashboardModal
        open={agentDashboardOpen}
        locale={locale}
        rows={agentDashboardRows}
        onClose={() => setAgentDashboardOpen(false)}
        onSelectSession={(id) => {
          const row = sessions.find((s) => s.id === id);
          if (!row) return;
          const proj = projects.find((p) => p.id === row.projectId) || null;
          void openSession(row, proj);
        }}
        onStopAllBusy={stopAllBusySessions}
        onStopSessions={(ids) => {
          const n = ids.length;
          stopBusySessionsByIds(ids, {
            title: tr("dashboard.stopSelectedTitle", { n }),
            message: tr("dashboard.stopSelectedConfirm", { n: String(n) }),
            confirmLabel: tr("dashboard.stopSelected", { n }),
          });
        }}
        onOpenBatchAgents={() => {
          setAgentDashboardOpen(false);
          openBatchAgents();
        }}
      />
      </Suspense>
      ) : null}
      {(taskBoardOpen) ? (
      <Suspense fallback={null}>
      <SessionTaskBoardModal
        open={taskBoardOpen}
        locale={locale}
        board={sessionTaskBoard}
        includeArchived={taskBoardIncludeArchived}
        onIncludeArchivedChange={setTaskBoardIncludeArchived}
        onClose={() => setTaskBoardOpen(false)}
        onSelectSession={(id) => {
          setTaskBoardOpen(false);
          const row = sessions.find((s) => s.id === id);
          if (!row) return;
          const proj = projects.find((p) => p.id === row.projectId) || null;
          void openSession(row, proj);
        }}
      />
      </Suspense>
      ) : null}
      {(batchAgentsOpen) ? (
      <Suspense fallback={null}>
      <BatchAgentsModal
        open={batchAgentsOpen}
        locale={locale}
        projects={projects.map(
          (p): BatchProjectInput => ({
            id: p.id,
            name: p.name,
            path: p.path,
            trusted: p.trusted,
            pathOk: p.pathOk,
            system: p.system,
          }),
        )}
        onClose={() => setBatchAgentsOpen(false)}
        onDispatch={runBatchAgentsDispatch}
      />
      </Suspense>
      ) : null}
      {(showMcpModal) ? (
      <Suspense fallback={null}>
      <McpStatusModal
        open={showMcpModal}
        locale={locale}
        servers={mcpServers}
        error={mcpError}
        loading={mcpLoading}
        onClose={() => setShowMcpModal(false)}
        onManage={() => navigateSettings("extensions")}
        onRefresh={() => void refreshMcpModal()}
        doctorReport={mcpDoctorReport}
        doctorError={mcpDoctorError}
        doctorLoading={mcpDoctorLoading}
        doctorFocus={mcpDoctorFocus}
        onRunDoctor={(name) => void runMcpDoctor(name)}
        onRefreshDoctor={(name) => runMcpDoctor(name)}
      />
      </Suspense>
      ) : null}
      {rewindTimeline && (
        <div
          className="overlay"
          role="presentation"
          onClick={() => {
            if (!rewindBusy) setRewindTimeline(null);
          }}
        >
          <div
            ref={rewindModalRef}
            className="modal rewind-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rewind-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-head">
              <h2 id="rewind-modal-title" className="modal-title">
                {tr("session.rewindTitle")}
              </h2>
              <button
                type="button"
                className="icon-btn modal-close"
                onClick={() => setRewindTimeline(null)}
                aria-label={tr("common.close")}
                disabled={rewindBusy}
              >
                <IconClose size={16} />
              </button>
            </header>
            <p className="rewind-modal__msg">{tr("session.rewindHint")}</p>
            <div className="rewind-modal__list" role="list">
              {rewindTimeline.points.map((p) => {
                const isLast =
                  p.promptIndex ===
                  rewindTimeline.points[rewindTimeline.points.length - 1]
                    ?.promptIndex;
                return (
                  <button
                    key={`${p.promptIndex}-${p.messageId ?? ""}`}
                    type="button"
                    role="listitem"
                    className="rewind-modal__item"
                    disabled={rewindBusy || isLast}
                    title={
                      isLast
                        ? tr("session.rewindNoop")
                        : tr("message.rewindHere")
                    }
                    onClick={() => {
                      if (isLast) {
                        return;
                      }
                      confirmRewindToPrompt(
                        rewindTimeline.sessionId,
                        p.promptIndex,
                        p.preview,
                      );
                    }}
                  >
                    <span className="rewind-modal__idx">
                      #{p.promptIndex + 1}
                    </span>
                    <span className="rewind-modal__preview">
                      {p.preview || "…"}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn--ghost"
                disabled={rewindBusy}
                onClick={() => setRewindTimeline(null)}
              >
                {tr("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      <GlassModal
        open={!!rewindConfirm}
        onClose={() => {
          if (rewindBusy) return;
          setRewindConfirm(null);
          setRewindRestoreFiles(false);
        }}
        title={tr("session.rewindTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        closeOnOverlay={!rewindBusy}
        showClose={!rewindBusy}
        wrapBody
        className="rewind-confirm-modal"
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={rewindBusy}
              onClick={() => {
                setRewindConfirm(null);
                setRewindRestoreFiles(false);
              }}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={rewindBusy || !rewindConfirm}
              onClick={() => {
                if (!rewindConfirm) return;
                void runRewindToPrompt(
                  rewindConfirm.sessionId,
                  rewindConfirm.targetPromptIndex,
                  rewindRestoreFiles,
                );
              }}
            >
              {tr("session.rewindConfirmLabel")}
            </button>
          </>
        }
      >
        <div className="rewind-confirm">
          <p className="rewind-confirm__msg">
            {tr("session.rewindConfirm")}
            {rewindConfirm?.preview
              ? `\n\n“${rewindConfirm.preview}”`
              : ""}
          </p>
          <label className="rewind-confirm__restore">
            <input
              type="checkbox"
              checked={rewindRestoreFiles}
              disabled={rewindBusy}
              onChange={(e) => setRewindRestoreFiles(e.target.checked)}
            />
            <span>{tr("session.rewindRestoreFiles")}</span>
          </label>
          <p className="rewind-confirm__hint">
            {tr("session.rewindRestoreFilesHint")}
          </p>
        </div>
      </GlassModal>

      <GlassModal
        open={!!forkConfirm}
        onClose={() => {
          if (forkBusy) return;
          setForkConfirm(null);
          setForkRestoreCode(false);
          setForkCliSession(false);
        }}
        title={tr("session.forkTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        closeOnOverlay={!forkBusy}
        showClose={!forkBusy}
        wrapBody
        className="fork-confirm-modal"
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={forkBusy}
              onClick={() => {
                setForkConfirm(null);
                setForkRestoreCode(false);
                setForkCliSession(false);
              }}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn"
              disabled={forkBusy || !forkConfirm}
              onClick={() => {
                if (!forkConfirm) return;
                void runForkSession(forkConfirm.source, {
                  throughUserPromptIndex:
                    forkConfirm.throughUserPromptIndex ?? null,
                  restoreCode: forkRestoreCode,
                  // Honesty: only pass true when checkbox is actually available.
                  forkCliSession: forkAgentCheckbox.checked,
                });
              }}
            >
              {forkBusy ? tr("session.forkWorking") : tr("session.fork")}
            </button>
          </>
        }
      >
        <div className="fork-confirm">
          <p className="fork-confirm__msg">
            {forkConfirm?.throughUserPromptIndex != null &&
            forkConfirm.throughUserPromptIndex !== undefined
              ? tr("session.forkConfirmPartial")
              : tr("session.forkConfirm")}
          </p>
          <label className="fork-confirm__restore">
            <input
              type="checkbox"
              checked={forkRestoreCode}
              disabled={forkBusy}
              onChange={(e) => setForkRestoreCode(e.target.checked)}
            />
            <span>{tr("session.forkRestoreCode")}</span>
          </label>
          <p className="fork-confirm__hint">
            {tr("session.forkRestoreCodeHint")}
          </p>
          <label
            className={
              "fork-confirm__restore" +
              (forkAgentCheckbox.disabled ? " fork-confirm__restore--disabled" : "")
            }
          >
            <input
              type="checkbox"
              checked={forkAgentCheckbox.checked}
              disabled={forkBusy || forkAgentCheckbox.disabled}
              onChange={(e) => {
                if (forkAgentCheckbox.disabled) return;
                setForkCliSession(e.target.checked);
              }}
              aria-disabled={forkAgentCheckbox.disabled || undefined}
            />
            <span>{tr("session.forkCliSession")}</span>
          </label>
          <p className="fork-confirm__hint">
            {tr(forkAgentCheckbox.hintKey as Parameters<typeof tr>[0])}
          </p>
        </div>
      </GlassModal>

      <GlassModal
        open={!!resumeRestoreConfirm}
        onClose={() => {
          if (resumeRestoreBusy) return;
          setResumeRestoreConfirm(null);
          setResumeForkCliSession(false);
        }}
        title={tr("session.resumeRestoreTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        closeOnOverlay={!resumeRestoreBusy}
        showClose={!resumeRestoreBusy}
        wrapBody
        className="fork-confirm-modal"
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={resumeRestoreBusy}
              onClick={() => {
                setResumeRestoreConfirm(null);
                setResumeForkCliSession(false);
              }}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn"
              disabled={resumeRestoreBusy || !resumeRestoreConfirm}
              onClick={() => {
                if (!resumeRestoreConfirm) return;
                void runResumeWithCodeRestore(resumeRestoreConfirm, {
                  // Honesty: only pass true when checkbox is actually available.
                  forkCliSession: resumeAgentCheckbox.checked,
                });
              }}
            >
              {resumeRestoreBusy
                ? tr("session.resumeRestoreWorking")
                : tr("session.resumeRestore")}
            </button>
          </>
        }
      >
        <div className="fork-confirm">
          <p className="fork-confirm__msg">
            {tr("session.resumeRestoreConfirm")}
          </p>
          <p className="fork-confirm__hint">
            {tr("session.resumeRestoreHint")}
          </p>
          <label
            className={
              "fork-confirm__restore" +
              (resumeAgentCheckbox.disabled
                ? " fork-confirm__restore--disabled"
                : "")
            }
          >
            <input
              type="checkbox"
              checked={resumeAgentCheckbox.checked}
              disabled={resumeRestoreBusy || resumeAgentCheckbox.disabled}
              onChange={(e) => {
                if (resumeAgentCheckbox.disabled) return;
                setResumeForkCliSession(e.target.checked);
              }}
              aria-disabled={resumeAgentCheckbox.disabled || undefined}
            />
            <span>{tr("session.forkCliSession")}</span>
          </label>
          <p className="fork-confirm__hint">
            {tr(resumeAgentCheckbox.hintKey as Parameters<typeof tr>[0])}
          </p>
        </div>
      </GlassModal>

      <GlassModal
        open={showTraces}
        onClose={() => setShowTraces(false)}
        title={tr("session.tracesTitle")}
        size="md"
        closeLabel={tr("common.close")}
        wrapBody
        className="trace-history-modal"
        footer={
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setShowTraces(false)}
          >
            {tr("common.close")}
          </button>
        }
      >
        <p className="trace-history-modal__desc">{tr("session.tracesDesc")}</p>
        <TraceHistoryList
          labels={{
            empty: tr("session.tracesEmpty"),
            emptyFilter: tr("session.tracesEmptyFilter"),
            reveal: tr("session.tracesReveal"),
            copyPath: tr("session.tracesCopyPath"),
            copied: tr("session.tracesCopied"),
            remove: tr("session.tracesRemove"),
            clearAll: tr("session.tracesClearAll"),
            clearConfirmTitle: tr("session.tracesClearConfirmTitle"),
            clearConfirmMessage: tr("session.tracesClearConfirmMessage"),
            clearConfirmAction: tr("session.tracesClearConfirmAction"),
            cancel: tr("common.cancel"),
            searchPlaceholder: tr("session.tracesSearch"),
            listAria: tr("session.tracesTitle"),
            uploadedBadge: tr("session.tracesUploadedBadge"),
          }}
          onError={(msg) => showToast(msg, 4000)}
        />
      </GlassModal>

      <GlassModal
        open={showPlanHistory}
        onClose={() => setShowPlanHistory(false)}
        title={tr("plan.historyTitle")}
        size="md"
        closeLabel={tr("common.close")}
        wrapBody
        className="plan-history-modal"
        footer={
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setShowPlanHistory(false)}
          >
            {tr("common.close")}
          </button>
        }
      >
        <p className="plan-history-modal__desc">{tr("plan.historyDesc")}</p>
        <PlanHistoryList
          labels={{
            empty: tr("plan.historyEmpty"),
            emptyFilter: tr("plan.historyEmptyFilter"),
            open: tr("plan.historyOpen"),
            openSession: tr("plan.historyOpenSession"),
            clearAll: tr("plan.historyClear"),
            searchPlaceholder: tr("plan.historySearchPlaceholder"),
            filterAll: tr("plan.historyFilterAll"),
            decisionApproved: tr("plan.historyDecisionApproved"),
            decisionAbandoned: tr("plan.historyDecisionAbandoned"),
            decisionCompleted: tr("plan.historyDecisionCompleted"),
            listAria: tr("plan.historyTitle"),
          }}
          existingSessionIds={sessions.map((s) => s.id)}
          onOpen={(entry) => setPlanHistoryPreview(entry)}
          onOpenSession={(entry) => openPlanHistorySession(entry)}
          onRequestClearAll={confirmClearPlanHistory}
        />
      </GlassModal>

      <GlassModal
        open={!!planHistoryPreview}
        onClose={() => setPlanHistoryPreview(null)}
        title={tr("plan.historyPreviewTitle")}
        size="md"
        closeLabel={tr("common.close")}
        wrapBody
        className="plan-history-preview-modal"
        footer={
          <>
            {planHistoryPreview &&
            sessions.some((s) => s.id === planHistoryPreview.sessionId) ? (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  if (planHistoryPreview) {
                    openPlanHistorySession(planHistoryPreview);
                  }
                }}
              >
                {tr("plan.historyOpenSession")}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setPlanHistoryPreview(null)}
            >
              {tr("common.close")}
            </button>
          </>
        }
      >
        {planHistoryPreview ? (
          <div className="plan-history-preview">
            <div className="plan-history-preview__meta">
              <span>
                {planHistoryPreview.decision === "approved"
                  ? tr("plan.historyDecisionApproved")
                  : planHistoryPreview.decision === "abandoned"
                    ? tr("plan.historyDecisionAbandoned")
                    : tr("plan.historyDecisionCompleted")}
              </span>
              {planHistoryPreview.title ? (
                <span title={planHistoryPreview.title}>
                  {planHistoryPreview.title}
                </span>
              ) : null}
              {planHistoryPreview.at ? (
                <span>
                  {(() => {
                    const d = Date.parse(planHistoryPreview.at);
                    if (!Number.isFinite(d)) return planHistoryPreview.at;
                    try {
                      return new Date(d).toLocaleString();
                    } catch {
                      return planHistoryPreview.at;
                    }
                  })()}
                </span>
              ) : null}
            </div>
            {planHistoryPreview.bodyPreview.trim() ? (
              <MarkdownBody locale={locale}>
                {planHistoryPreview.bodyPreview}
              </MarkdownBody>
            ) : (
              <div className="plan-history-preview__empty">
                {tr("plan.historyPreviewEmpty")}
              </div>
            )}
          </div>
        ) : null}
      </GlassModal>

      <GlassModal
        open={planReviseOpen}
        onClose={() => {
          setPlanReviseOpen(false);
          setPlanReviseNote("");
        }}
        title={tr("plan.reviseNoteTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        wrapBody
        className="plan-revise-modal"
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setPlanReviseOpen(false);
                setPlanReviseNote("");
              }}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => void requestPlanChanges(planReviseNote)}
              data-testid="plan-revise-submit"
            >
              {tr("plan.reviseNoteSubmit")}
            </button>
          </>
        }
      >
        <p className="plan-revise-modal__desc">{tr("plan.reviseNoteDesc")}</p>
        <label className="plan-revise-modal__field">
          <span className="sr-only">{tr("plan.reviseNotePlaceholder")}</span>
          <textarea
            className="plan-revise-modal__textarea"
            value={planReviseNote}
            onChange={(e) => setPlanReviseNote(e.target.value)}
            placeholder={tr("plan.reviseNotePlaceholder")}
            rows={4}
            autoFocus
            data-testid="plan-revise-note"
          />
        </label>
      </GlassModal>

      <GlassModal
        open={showJsonSchemaModal}
        onClose={() => setShowJsonSchemaModal(false)}
        title={tr("composer.jsonSchemaTitle")}
        size="md"
        closeLabel={tr("common.close")}
        wrapBody
        className="json-schema-modal"
        footer={
          <div className="json-schema-modal__actions">
            {sessionJsonSchema ? (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  void (async () => {
                    const sid = session.sessionId;
                    setSessionJsonSchema(null);
                    setJsonSchemaDraft("");
                    setShowJsonSchemaModal(false);
                    if (sid && api.isTauri()) {
                      try {
                        await api.sessionSetJsonSchema(sid, null);
                      } catch {
                        /* ignore */
                      }
                    }
                    if (sid) {
                      setSessions((list) =>
                        list.map((row) =>
                          row.id === sid ? { ...row, jsonSchema: null } : row,
                        ),
                      );
                    }
                  })();
                }}
              >
                {tr("composer.jsonSchemaClear")}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setShowJsonSchemaModal(false)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                void (async () => {
                  const parsed = parseJsonSchemaText(jsonSchemaDraft);
                  if (!parsed.ok) {
                    showToast(tr("composer.jsonSchemaInvalid"), 4000);
                    return;
                  }
                  const sid = session.sessionId;
                  setSessionJsonSchema(parsed.normalized);
                  if (sid && api.isTauri()) {
                    try {
                      const saved = await api.sessionSetJsonSchema(
                        sid,
                        parsed.normalized,
                      );
                      const next =
                        typeof saved.jsonSchema === "string" &&
                        saved.jsonSchema.trim()
                          ? saved.jsonSchema
                          : parsed.normalized;
                      setSessionJsonSchema(next);
                      setSessions((list) =>
                        list.map((row) =>
                          row.id === sid
                            ? { ...row, jsonSchema: next }
                            : row,
                        ),
                      );
                    } catch (e) {
                      showToast(String(e), 4000);
                      return;
                    }
                  } else if (!sid) {
                    showToast(tr("composer.jsonSchemaEmptySession"), 3200);
                  }
                  setShowJsonSchemaModal(false);
                })();
              }}
            >
              {tr("composer.jsonSchemaApply")}
            </button>
          </div>
        }
      >
        <p className="json-schema-modal__hint">
          {tr("composer.jsonSchemaHint")}
        </p>
        <p className="json-schema-modal__experimental">
          {tr("composer.jsonSchemaExperimental")}
        </p>
        <textarea
          className="json-schema-modal__textarea"
          value={jsonSchemaDraft}
          onChange={(e) => setJsonSchemaDraft(e.target.value)}
          placeholder={tr("composer.jsonSchemaPlaceholder")}
          spellCheck={false}
          aria-label={tr("composer.jsonSchemaTitle")}
        />
      </GlassModal>

      <GlassModal
        open={!!sessionNoteTarget}
        onClose={closeSessionNoteModal}
        title={tr("session.noteTitle")}
        size="md"
        closeLabel={tr("common.close")}
        wrapBody
        className="session-note-modal"
        footer={
          <div className="session-note-modal__actions">
            {sessionNoteTarget &&
            (sessionNotesMap[sessionNoteTarget.id]?.trim() ||
              sessionNoteDraft.trim()) ? (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={requestClearSessionNoteModal}
              >
                {tr("session.noteClear")}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--ghost"
              onClick={closeSessionNoteModal}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={saveSessionNoteModal}
            >
              {tr("common.save")}
            </button>
          </div>
        }
      >
        <p className="session-note-modal__hint">
          {tr("session.noteHint", { n: String(SESSION_NOTE_MAX_LENGTH) })}
        </p>
        {sessionNoteTarget ? (
          <p
            className="session-note-modal__session"
            title={sessionNoteTarget.title}
          >
            {sessionNoteTarget.title}
          </p>
        ) : null}
        {(() => {
          const v = validateSessionNote({
            draft: sessionNoteDraft,
            baseline: sessionNoteBaseline,
            hadStored: Boolean(
              sessionNoteTarget &&
                sessionNotesMap[sessionNoteTarget.id]?.trim(),
            ),
          });
          return (
            <>
              {v.statusKey ? (
                <p
                  className={
                    "session-prompt-status" +
                    (v.severity === "warn"
                      ? " session-prompt-status--warn"
                      : v.severity === "info"
                        ? " session-prompt-status--info"
                        : "")
                  }
                  role="status"
                >
                  {tr(v.statusKey)}
                </p>
              ) : null}
              <textarea
                className={
                  "session-note-modal__textarea" +
                  (v.severity === "warn"
                    ? " session-prompt-textarea--warn"
                    : "")
                }
                value={sessionNoteDraft}
                onChange={(e) => {
                  const next = clampSessionNoteInput(
                    e.target.value,
                    SESSION_NOTE_MAX_LENGTH,
                  );
                  setSessionNoteDraft(next.value);
                }}
                placeholder={tr("session.notePlaceholder")}
                maxLength={SESSION_NOTE_MAX_LENGTH}
                spellCheck
                aria-label={tr("session.noteTitle")}
              />
              <p
                className={
                  "session-note-modal__count" +
                  (v.severity === "warn"
                    ? " session-prompt-count--warn"
                    : "")
                }
                aria-live="polite"
              >
                {tr("session.noteChars", {
                  n: String(v.budget.rawLen),
                  max: String(v.budget.max),
                })}
              </p>
            </>
          );
        })()}
      </GlassModal>

      <GlassModal
        open={sessionNoteDiscardOpen}
        onClose={() => setSessionNoteDiscardOpen(false)}
        title={tr("resources.discardTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setSessionNoteDiscardOpen(false)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => {
                setSessionNoteDiscardOpen(false);
                forceCloseSessionNoteModal();
              }}
            >
              {tr("resources.discardConfirm")}
            </button>
          </>
        }
      >
        <p className="rp-modal-copy">{tr("session.noteDiscardBody")}</p>
      </GlassModal>

      <GlassModal
        open={sessionNoteClearOpen}
        onClose={() => setSessionNoteClearOpen(false)}
        title={tr("session.noteClearTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setSessionNoteClearOpen(false)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid btn--danger"
              onClick={() => {
                setSessionNoteClearOpen(false);
                confirmClearSessionNoteModal();
              }}
            >
              {tr("session.noteClearConfirm")}
            </button>
          </>
        }
      >
        <p className="rp-modal-copy">{tr("session.noteClearBody")}</p>
      </GlassModal>

      <GlassModal
        open={!!sessionRulesTarget}
        onClose={closeSessionRulesModal}
        title={tr("session.rulesTitle")}
        size="md"
        closeLabel={tr("common.close")}
        wrapBody
        className="session-rules-modal"
        closeOnOverlay={!sessionRulesBusy}
        showClose={!sessionRulesBusy}
        footer={
          <div className="session-rules-modal__actions">
            {sessionRulesTarget &&
            (sessionRulesDraft.trim() ||
              sessions.some(
                (row) =>
                  row.id === sessionRulesTarget.id &&
                  !!sanitizeExtraRules(row.extraRules),
              )) ? (
              <button
                type="button"
                className="btn btn--ghost"
                disabled={sessionRulesBusy}
                onClick={() => {
                  void clearSessionRulesModal();
                }}
              >
                {tr("session.rulesClear")}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--ghost"
              disabled={sessionRulesBusy}
              onClick={closeSessionRulesModal}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={sessionRulesBusy}
              onClick={() => {
                void saveSessionRulesModal();
              }}
            >
              {sessionRulesBusy ? tr("resources.saving") : tr("common.save")}
            </button>
          </div>
        }
      >
        <p className="session-rules-modal__hint">
          {tr("session.rulesHint", {
            n: String(SESSION_EXTRA_RULES_MAX_CHARS),
          })}
        </p>
        {sessionRulesTarget ? (
          <p
            className="session-rules-modal__session"
            title={sessionRulesTarget.title}
          >
            {sessionRulesTarget.title}
          </p>
        ) : null}
        {(() => {
          const v = validateSessionTextField({
            field: "extra_rules",
            draft: sessionRulesDraft,
            baseline: sessionRulesBaseline,
            hadStored: sessions.some(
              (row) =>
                sessionRulesTarget &&
                row.id === sessionRulesTarget.id &&
                !!sanitizeExtraRules(row.extraRules),
            ),
          });
          return (
            <>
              {v.statusKey ? (
                <p
                  className={
                    "session-prompt-status" +
                    (v.severity === "warn"
                      ? " session-prompt-status--warn"
                      : v.severity === "info"
                        ? " session-prompt-status--info"
                        : "")
                  }
                  role="status"
                >
                  {tr(v.statusKey)}
                </p>
              ) : null}
              {sessionRulesError ? (
                <p className="session-prompt-error" role="alert">
                  {sessionRulesError}
                </p>
              ) : null}
              <textarea
                className={
                  "session-rules-modal__textarea" +
                  (v.severity === "warn"
                    ? " session-prompt-textarea--warn"
                    : "")
                }
                value={sessionRulesDraft}
                onChange={(e) => {
                  const next = clampSessionTextInput(
                    e.target.value,
                    SESSION_EXTRA_RULES_MAX_CHARS,
                  );
                  setSessionRulesDraft(next.value);
                  setSessionRulesError(null);
                }}
                placeholder={tr("session.rulesPlaceholder")}
                maxLength={SESSION_EXTRA_RULES_MAX_CHARS}
                spellCheck={false}
                disabled={sessionRulesBusy}
                aria-label={tr("session.rulesTitle")}
              />
              <p
                className={
                  "session-rules-modal__count" +
                  (v.severity === "warn"
                    ? " session-prompt-count--warn"
                    : "")
                }
                aria-live="polite"
              >
                {tr("session.rulesChars", {
                  n: String(v.budget.rawLen),
                  max: String(v.budget.max),
                })}
              </p>
            </>
          );
        })()}
      </GlassModal>

      <GlassModal
        open={sessionRulesDiscardOpen}
        onClose={() => setSessionRulesDiscardOpen(false)}
        title={tr("resources.discardTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setSessionRulesDiscardOpen(false)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => {
                setSessionRulesDiscardOpen(false);
                forceCloseSessionRulesModal();
              }}
            >
              {tr("resources.discardConfirm")}
            </button>
          </>
        }
      >
        <p className="rp-modal-copy">{tr("session.promptDiscardBody")}</p>
      </GlassModal>

      <GlassModal
        open={!!sessionMaxTurnsTarget}
        onClose={closeSessionMaxTurnsModal}
        title={tr("session.maxTurnsTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        wrapBody
        className="session-max-turns-modal"
        footer={
          <div className="session-max-turns-modal__actions">
            {sessionMaxTurnsTarget &&
            (sessionMaxTurnsDraft.trim() ||
              sessions.some(
                (row) =>
                  row.id === sessionMaxTurnsTarget.id &&
                  normalizeMaxAgentTurns(row.maxAgentTurns) != null,
              )) ? (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  void clearSessionMaxTurnsModal();
                }}
              >
                {tr("session.maxTurnsClear")}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--ghost"
              onClick={closeSessionMaxTurnsModal}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                void saveSessionMaxTurnsModal();
              }}
            >
              {tr("common.save")}
            </button>
          </div>
        }
      >
        <p className="session-max-turns-modal__hint">
          {tr("session.maxTurnsHint", {
            max: String(MAX_AGENT_TURNS_CAP),
            global:
              maxAgentTurns > 0
                ? String(maxAgentTurns)
                : tr("session.maxTurnsGlobalUnlimited"),
          })}
        </p>
        {sessionMaxTurnsTarget ? (
          <p
            className="session-max-turns-modal__session"
            title={sessionMaxTurnsTarget.title}
          >
            {sessionMaxTurnsTarget.title}
          </p>
        ) : null}
        <input
          className="session-max-turns-modal__input"
          type="number"
          min={0}
          max={MAX_AGENT_TURNS_CAP}
          step={1}
          value={sessionMaxTurnsDraft}
          onChange={(e) => {
            const raw = e.target.value;
            if (!raw.trim()) {
              setSessionMaxTurnsDraft("");
              return;
            }
            const n = Number(raw);
            if (!Number.isFinite(n)) return;
            const clamped = Math.min(
              MAX_AGENT_TURNS_CAP,
              Math.max(0, Math.round(n)),
            );
            setSessionMaxTurnsDraft(String(clamped));
          }}
          placeholder={tr("session.maxTurnsPlaceholder")}
          aria-label={tr("session.maxTurnsTitle")}
        />
      </GlassModal>

      <GlassModal
        open={!!sessionSysPromptTarget}
        onClose={closeSessionSysPromptModal}
        title={tr("session.sysPromptTitle")}
        size="md"
        closeLabel={tr("common.close")}
        wrapBody
        className="session-sys-prompt-modal"
        closeOnOverlay={!sessionSysPromptBusy}
        showClose={!sessionSysPromptBusy}
        footer={
          <div className="session-sys-prompt-modal__actions">
            {sessionSysPromptTarget &&
            (sessionSysPromptDraft.trim() ||
              sessions.some(
                (row) =>
                  row.id === sessionSysPromptTarget.id &&
                  !!sanitizeSystemPromptOverride(row.systemPromptOverride),
              )) ? (
              <button
                type="button"
                className="btn btn--ghost"
                disabled={sessionSysPromptBusy}
                onClick={() => {
                  void clearSessionSysPromptModal();
                }}
              >
                {tr("session.sysPromptClear")}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--ghost"
              disabled={sessionSysPromptBusy}
              onClick={closeSessionSysPromptModal}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={sessionSysPromptBusy}
              onClick={() => {
                void saveSessionSysPromptModal();
              }}
            >
              {sessionSysPromptBusy ? tr("resources.saving") : tr("common.save")}
            </button>
          </div>
        }
      >
        <p className="session-sys-prompt-modal__hint">
          {tr("session.sysPromptHint", {
            n: String(SESSION_SYSTEM_PROMPT_MAX_CHARS),
          })}
        </p>
        {sessionSysPromptTarget ? (
          <p
            className="session-sys-prompt-modal__session"
            title={sessionSysPromptTarget.title}
          >
            {sessionSysPromptTarget.title}
          </p>
        ) : null}
        {(() => {
          const v = validateSessionTextField({
            field: "system_prompt",
            draft: sessionSysPromptDraft,
            baseline: sessionSysPromptBaseline,
            hadStored: sessions.some(
              (row) =>
                sessionSysPromptTarget &&
                row.id === sessionSysPromptTarget.id &&
                !!sanitizeSystemPromptOverride(row.systemPromptOverride),
            ),
          });
          return (
            <>
              {v.statusKey ? (
                <p
                  className={
                    "session-prompt-status" +
                    (v.severity === "warn"
                      ? " session-prompt-status--warn"
                      : v.severity === "info"
                        ? " session-prompt-status--info"
                        : "")
                  }
                  role="status"
                >
                  {tr(v.statusKey)}
                </p>
              ) : null}
              {sessionSysPromptError ? (
                <p className="session-prompt-error" role="alert">
                  {sessionSysPromptError}
                </p>
              ) : null}
              <textarea
                className={
                  "session-sys-prompt-modal__textarea" +
                  (v.severity === "warn"
                    ? " session-prompt-textarea--warn"
                    : "")
                }
                value={sessionSysPromptDraft}
                onChange={(e) => {
                  const next = clampSessionTextInput(
                    e.target.value,
                    SESSION_SYSTEM_PROMPT_MAX_CHARS,
                  );
                  setSessionSysPromptDraft(next.value);
                  setSessionSysPromptError(null);
                }}
                placeholder={tr("session.sysPromptPlaceholder")}
                maxLength={SESSION_SYSTEM_PROMPT_MAX_CHARS}
                spellCheck={false}
                disabled={sessionSysPromptBusy}
                aria-label={tr("session.sysPromptTitle")}
              />
              <p
                className={
                  "session-sys-prompt-modal__count" +
                  (v.severity === "warn"
                    ? " session-prompt-count--warn"
                    : "")
                }
                aria-live="polite"
              >
                {tr("session.sysPromptChars", {
                  n: String(v.budget.rawLen),
                  max: String(v.budget.max),
                })}
              </p>
            </>
          );
        })()}
      </GlassModal>

      <GlassModal
        open={sessionSysPromptDiscardOpen}
        onClose={() => setSessionSysPromptDiscardOpen(false)}
        title={tr("resources.discardTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setSessionSysPromptDiscardOpen(false)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => {
                setSessionSysPromptDiscardOpen(false);
                forceCloseSessionSysPromptModal();
              }}
            >
              {tr("resources.discardConfirm")}
            </button>
          </>
        }
      >
        <p className="rp-modal-copy">{tr("session.promptDiscardBody")}</p>
      </GlassModal>

      <GlassModal
        open={!!exportMdTarget}
        onClose={() => {
          if (exportMdBusy) return;
          setExportMdTarget(null);
        }}
        title={tr("session.exportMdTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        closeOnOverlay={!exportMdBusy}
        showClose={!exportMdBusy}
        wrapBody
        className="export-md-modal"
      >
        {/*
          Layout: options first; action buttons on a second row (cancel / copy /
          download) like edit+save dialogs — not in the modal header/top.
        */}
        <div className="export-md-options">
          <p className="export-md-options__msg">{tr("session.exportMdHint")}</p>
          <div
            className="export-md-options__meta"
            role="status"
            aria-live="polite"
          >
            <span className="export-md-options__chip">
              {tr(
                sessionExportFormatNameKey(
                  "markdown",
                ) as Parameters<typeof tr>[0],
              )}
            </span>
            {exportMdHonesty.sizeClassKey ? (
              <span className="export-md-options__chip">
                {tr("session.exportSizeHint", {
                  size: exportMdHonesty.sizeBytesLabel
                    ? `${tr(exportMdHonesty.sizeClassKey as Parameters<typeof tr>[0])} · ${exportMdHonesty.sizeBytesLabel}`
                    : tr(
                        exportMdHonesty.sizeClassKey as Parameters<
                          typeof tr
                        >[0],
                      ),
                })}
              </span>
            ) : null}
          </div>
          {exportMdHonesty.journalEmpty === true ? (
            <p className="export-md-options__empty" role="status">
              {tr("session.exportEmpty")}
            </p>
          ) : null}
          <label className="export-md-options__row">
            <input
              type="checkbox"
              checked={exportMdIncludeThoughts}
              disabled={exportMdBusy}
              onChange={(e) => setExportMdIncludeThoughts(e.target.checked)}
            />
            <span>{tr("session.exportMdIncludeThoughts")}</span>
          </label>
          <label className="export-md-options__row">
            <input
              type="checkbox"
              checked={exportMdIncludeTools}
              disabled={exportMdBusy}
              onChange={(e) => setExportMdIncludeTools(e.target.checked)}
            />
            <span>{tr("session.exportMdIncludeTools")}</span>
          </label>
          <div className="export-md-options__actions" role="group">
            <button
              type="button"
              className="btn btn--ghost"
              disabled={exportMdBusy}
              onClick={() => setExportMdTarget(null)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={
                exportMdBusy ||
                !exportMdTarget ||
                !exportMdHonesty.canAct
              }
              onClick={() => void runExportSessionMd("copy")}
            >
              {tr("session.exportMdCopy")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={
                exportMdBusy ||
                !exportMdTarget ||
                !exportMdHonesty.canAct
              }
              onClick={() => void runExportSessionMd("download")}
            >
              {exportMdBusy
                ? tr("session.exportMdWorking")
                : tr("session.exportMdDownload")}
            </button>
          </div>
        </div>
      </GlassModal>

      <GlassModal
        open={!!exportImageTarget}
        onClose={closeExportSessionImage}
        title={tr("session.exportImageTitle")}
        size="md"
        closeLabel={tr("common.close")}
        closeOnOverlay={!exportImageBusy}
        showClose={!exportImageBusy}
        wrapBody
        className="export-md-modal export-image-modal"
      >
        <div className="export-md-options">
          <div
            className="export-image-skins"
            role="radiogroup"
            aria-label={tr("session.exportImageTheme")}
          >
            {SHARE_CARD_SKIN_IDS.map((skinId) => (
              <button
                key={skinId}
                type="button"
                role="radio"
                aria-checked={exportImageSkin === skinId}
                className={
                  "export-image-skin" +
                  (exportImageSkin === skinId
                    ? " export-image-skin--active"
                    : "")
                }
                disabled={exportImageBusy}
                data-skin={skinId}
                onClick={() => {
                  setExportImageSkin(skinId);
                  saveExportImageSkinPref(skinId);
                }}
              >
                <span
                  className="export-image-skin__swatch"
                  aria-hidden
                  data-skin={skinId}
                />
                <span className="export-image-skin__label">
                  {tr(
                    shareCardSkinMessageKey(skinId) as Parameters<
                      typeof tr
                    >[0],
                  )}
                </span>
              </button>
            ))}
          </div>
          <div
            className="export-image-meta"
            aria-live="polite"
            data-phase={exportImagePreviewPhase}
          >
            <span className="export-image-meta__chip">
              {tr(
                exportImageMetaParts.modeKey as Parameters<typeof tr>[0],
              )}
            </span>
            <span className="export-image-meta__chip">
              {tr(
                exportImageMetaParts.skinKey as Parameters<typeof tr>[0],
              )}
            </span>
            {exportImageMetaParts.layoutKey ? (
              <span className="export-image-meta__chip export-image-style-chip">
                {tr(
                  exportImageMetaParts.layoutKey as Parameters<typeof tr>[0],
                )}
              </span>
            ) : null}
            {exportImageBytesLabel && exportImagePreviewPhase === "ready" ? (
              <span
                className="export-image-meta__chip export-image-meta__chip--muted"
                title={tr("session.exportImageSize")}
              >
                {exportImageBytesLabel}
              </span>
            ) : null}
          </div>
          <div
            key={
              exportImagePreviewUrl && exportImageOptionsMatch
                ? exportImagePreviewUrl
                : "export-image-preview-empty"
            }
            className={
              "export-image-preview" +
              (exportImagePreviewPhase === "error"
                ? " export-image-preview--error"
                : "") +
              (exportImagePreviewPhase === "rendering"
                ? " export-image-preview--busy"
                : "")
            }
            aria-busy={exportImageBusy}
            aria-live="polite"
            data-phase={exportImagePreviewPhase}
          >
            {exportImagePreviewUrl && exportImageOptionsMatch ? (
              <img
                src={exportImagePreviewUrl}
                alt={tr("session.exportImagePreview")}
                className="export-image-preview__img"
              />
            ) : exportImagePreviewError ? (
              <p className="export-image-preview__err" role="alert">
                {exportImagePreviewError}
              </p>
            ) : (
              <p className="export-image-preview__placeholder">
                {exportImagePreviewPhase === "rendering" || exportImageBusy
                  ? tr("session.exportImageWorking")
                  : tr("session.exportImagePreview")}
              </p>
            )}
          </div>
          <label className="export-md-options__row">
            <input
              type="checkbox"
              checked={exportImageSmart}
              disabled={exportImageBusy}
              onChange={(e) => setExportImageSmart(e.target.checked)}
            />
            <span>
              {tr("session.exportImageSmart")}
              <span className="export-image-smart-hint">
                {" "}
                — {tr("session.exportImageSmartDesc")}
              </span>
            </span>
          </label>
          <div className="export-md-options__actions" role="group">
            <button
              type="button"
              className="btn btn--ghost"
              disabled={exportImageBusy}
              onClick={closeExportSessionImage}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={!exportImageCanAct || exportImageBusy}
              onClick={() => void runExportSessionImage("copy")}
            >
              {tr("session.exportImageCopy")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={!exportImageCanAct || exportImageBusy}
              onClick={() => void runExportSessionImage("download")}
            >
              {exportImageBusy
                ? tr("session.exportImageWorking")
                : tr("session.exportImageDownload")}
            </button>
          </div>
        </div>
      </GlassModal>

      {showCompactModal && (
        <div
          className="overlay"
          role="presentation"
          onClick={() => {
            setShowCompactModal(false);
            setCompactNote("");
            setCompactPreset(DEFAULT_COMPACT_PRESET);
          }}
        >
          <form
            ref={compactModalRef}
            className="modal compact-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="compact-modal-title"
            onSubmit={(e) => {
              e.preventDefault();
              if (
                session.state === "streaming" ||
                session.state === "awaiting_permission"
              ) {
                return;
              }
              const note = resolveCompactNoteBody(
                compactNote,
                compactPresetNote(compactPreset),
              );
              const uiBefore = contextUsageDisplay.tokens;
              const preset = compactPreset;
              setShowCompactModal(false);
              setCompactNote("");
              setCompactPreset(DEFAULT_COMPACT_PRESET);
              void (async () => {
                const cmd = buildCompactSlashCommand(note, { preset });
                try {
                  const sid = await ensureConnected();
                  if (!sid) return;
                  pendingCompactBeforeRef.current = {
                    sessionId: sid,
                    tokensBefore:
                      uiBefore != null && Number.isFinite(uiBefore)
                        ? Math.floor(uiBefore)
                        : null,
                    at: Date.now(),
                  };
                  await api.sessionSend(cmd, null, sid);
                } catch (err) {
                  pendingCompactBeforeRef.current = null;
                  setLocalError(String(err));
                }
              })();
            }}
          >
            <header className="modal-head">
              <h2 id="compact-modal-title" className="modal-title">
                {tr("slash.compact")}
              </h2>
              <button
                type="button"
                className="icon-btn modal-close"
                onClick={() => {
                  setShowCompactModal(false);
                  setCompactNote("");
                  setCompactPreset(DEFAULT_COMPACT_PRESET);
                }}
                aria-label={tr("common.close")}
              >
                <IconClose size={16} />
              </button>
            </header>
            <p className="compact-modal__msg">
              {tr("slash.compactExplain")}
            </p>
            <div
              className="compact-modal__presets"
              role="radiogroup"
              aria-label={tr("slash.compactPresets")}
            >
              {COMPACT_PRESET_IDS.map((id) => {
                const labelKey =
                  id === "light"
                    ? "slash.compactPreset.light"
                    : id === "aggressive"
                      ? "slash.compactPreset.aggressive"
                      : "slash.compactPreset.standard";
                const hintKey =
                  id === "light"
                    ? "slash.compactPresetHint.light"
                    : id === "aggressive"
                      ? "slash.compactPresetHint.aggressive"
                      : "slash.compactPresetHint.standard";
                const active = compactPreset === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={
                      "compact-modal__preset" + (active ? " is-active" : "")
                    }
                    title={tr(hintKey)}
                    onClick={() => selectCompactPreset(id)}
                  >
                    <span className="compact-modal__preset-label">
                      {tr(labelKey)}
                    </span>
                    <span className="compact-modal__preset-hint">
                      {tr(hintKey)}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="compact-modal__hint compact-modal__hint--presets">
              {tr("slash.compactPresetCliNote")}
            </p>
            <div className="compact-modal__cli-fields">
              <div className="compact-modal__field-label">
                {tr("slash.compactMode")}
              </div>
              <Select
                value={compactionMode}
                aria-label={tr("slash.compactMode")}
                title={tr("slash.compactModeHint")}
                onChange={(v) => {
                  const next = normalizeCompactionMode(v);
                  setCompactionMode(next);
                  void api.settingsGet().then((s) =>
                    api.settingsSet({ ...s, compactionMode: next }),
                  );
                }}
                options={COMPACTION_MODES.map((id) => ({
                  value: id,
                  label: tr(
                    id === "transcript"
                      ? "settings.compactionMode.transcript"
                      : id === "segments"
                        ? "settings.compactionMode.segments"
                        : "settings.compactionMode.summary",
                  ),
                }))}
              />
              <p className="compact-modal__hint">{tr("slash.compactModeHint")}</p>
              <div className="compact-modal__field-label">
                {tr("slash.compactDetail")}
              </div>
              <Select
                value={compactionDetail}
                aria-label={tr("slash.compactDetail")}
                title={tr("slash.compactDetailHint")}
                disabled={!compactionDetailApplies(compactionMode)}
                onChange={(v) => {
                  const next = normalizeCompactionDetail(v);
                  setCompactionDetail(next);
                  void api.settingsGet().then((s) =>
                    api.settingsSet({ ...s, compactionDetail: next }),
                  );
                }}
                options={COMPACTION_DETAILS.map((id) => ({
                  value: id,
                  label: tr(
                    id === "none"
                      ? "settings.compactionDetail.none"
                      : id === "minimal"
                        ? "settings.compactionDetail.minimal"
                        : id === "balanced"
                          ? "settings.compactionDetail.balanced"
                          : "settings.compactionDetail.verbose",
                  ),
                }))}
              />
              <p className="compact-modal__hint">
                {tr("slash.compactDetailHint")}
              </p>
            </div>
            <div className="compact-modal__usage" aria-live="polite">
              <div className="compact-modal__usage-row">
                <span className="compact-modal__usage-k">
                  {tr("slash.compactBefore")}
                </span>
                <span className="compact-modal__usage-v">
                  <span className="compact-modal__usage-tokens">
                    {contextUsageDisplay.tokens != null
                      ? contextUsageDisplay.label
                      : tr("slash.compactCurrentUnknown")}
                  </span>
                  {contextUsageDisplay.tokens != null ? (
                    <span className="compact-modal__usage-src">
                      {contextUsageDisplay.source === "known"
                        ? tr("context.sourceKnown")
                        : contextUsageDisplay.source === "estimated"
                          ? tr("context.sourceEstimated")
                          : tr("context.sourceUnknown")}
                    </span>
                  ) : null}
                </span>
              </div>
              {(() => {
                const afterEst = estimateCompactAfterTokens(
                  contextUsageDisplay.tokens,
                  compactPreset,
                );
                if (afterEst == null) {
                  return (
                    <div className="compact-modal__usage-row">
                      <span className="compact-modal__usage-k">
                        {tr("slash.compactAfterEst")}
                      </span>
                      <span className="compact-modal__usage-v">
                        <span className="compact-modal__usage-tokens">
                          {tr("slash.compactAfterUnknown")}
                        </span>
                      </span>
                    </div>
                  );
                }
                return (
                  <div className="compact-modal__usage-row">
                    <span className="compact-modal__usage-k">
                      {tr("slash.compactAfterEst")}
                    </span>
                    <span className="compact-modal__usage-v">
                      <span className="compact-modal__usage-tokens">
                        ~{formatTokenCount(afterEst, locale)}
                      </span>
                      <span className="compact-modal__usage-src">
                        {tr("context.sourceEstimated")}
                      </span>
                    </span>
                  </div>
                );
              })()}
              {contextUsageDisplay.lastCompact &&
              (contextUsageDisplay.lastCompact.tokensBefore != null ||
                contextUsageDisplay.lastCompact.tokensAfter != null) ? (
                <div className="compact-modal__usage-row compact-modal__usage-row--last">
                  <span className="compact-modal__usage-k">
                    {tr("context.lastCompact")}
                  </span>
                  <span className="compact-modal__usage-v">
                    <span className="compact-modal__usage-tokens">
                      {formatCompactBeforeAfterRange(
                        contextUsageDisplay.lastCompact.tokensBefore,
                        contextUsageDisplay.lastCompact.tokensAfter,
                        {
                          locale,
                          template: tr("compact.tokensRange"),
                        },
                      ) ?? tr("context.lastCompactNone")}
                    </span>
                  </span>
                </div>
              ) : null}
            </div>
            <p className="compact-modal__hint">
              {tr("slash.compactEstimateHint")}
            </p>
            <label className="compact-modal__field-label" htmlFor="compact-note">
              {tr("slash.compactNote")}
            </label>
            <input
              id="compact-note"
              ref={compactNoteRef}
              className="compact-modal__field"
              value={compactNote}
              onChange={(e) => setCompactNote(e.target.value)}
              placeholder={tr("slash.compactNoteOptional")}
              autoFocus
              autoComplete="off"
            />
            <div
              className="compact-modal__chips"
              role="group"
              aria-label={tr("slash.compactNote")}
            >
              {(
                [
                  "slash.compactNoteChipDecisions",
                  "slash.compactNoteChipErrors",
                  "slash.compactNoteChipFiles",
                  "slash.compactNoteChipTodos",
                ] as const
              ).map((key) => {
                const label = tr(key);
                const active = compactNote.trim() === label;
                return (
                  <button
                    key={key}
                    type="button"
                    className={
                      "compact-modal__chip" + (active ? " is-active" : "")
                    }
                    aria-pressed={active}
                    onClick={() =>
                      setCompactNote((prev) =>
                        prev.trim() === label ? "" : label,
                      )
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {(session.state === "streaming" ||
              session.state === "awaiting_permission") && (
              <p className="compact-modal__busy" role="status">
                {tr("slash.compactBusy")}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  setShowCompactModal(false);
                  setCompactNote("");
                  setCompactPreset(DEFAULT_COMPACT_PRESET);
                }}
              >
                {tr("slash.compactConfirmCancel")}
              </button>
              <button
                type="submit"
                className="btn btn--solid"
                disabled={
                  session.state === "streaming" ||
                  session.state === "awaiting_permission"
                }
              >
                {tr("slash.compactConfirmOk")}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Search / command palette (Codex-style) */}
      {showSearch && (
        <div
          className="overlay"
          role="presentation"
          onClick={() => setShowSearch(false)}
        >
          <div
            ref={searchPanelRef}
            className="search-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={tr("search.title")}
          >
            <div className="search-panel__head">
              <IconSearch size={16} />
              <input
                autoFocus
                className="search-panel__input"
                placeholder={
                  tr("search.placeholder")
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button
                type="button"
                className="icon-btn modal-close"
                onClick={() => setShowSearch(false)}
                aria-label={tr("common.close")}
              >
                <IconClose size={16} />
              </button>
            </div>
            <div className="search-panel__filters">
              <div
                className="search-panel__modes"
                role="tablist"
                aria-label={tr("search.modeLabel")}
              >
                {SESSION_SEARCH_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={searchMode === mode}
                    className={
                      "search-panel__mode" +
                      (searchMode === mode ? " is-active" : "")
                    }
                    onClick={() => applySearchMode(mode)}
                  >
                    {tr(sessionSearchModeLabelKey(mode))}
                  </button>
                ))}
              </div>
              <label className="search-panel__archived">
                <input
                  type="checkbox"
                  checked={searchIncludeArchived}
                  onChange={(e) =>
                    applySearchIncludeArchived(e.target.checked)
                  }
                />
                <span>{tr("search.includeArchived")}</span>
              </label>
              {searchFiltersActive ? (
                <button
                  type="button"
                  className="search-panel__clear-filters"
                  onClick={clearSearchFilters}
                >
                  {tr("search.clearFilters")}
                </button>
              ) : null}
            </div>
            <div className="search-panel__filters">
              <div
                className="search-panel__modes"
                role="tablist"
                aria-label={tr("search.rankModeLabel")}
              >
                {SESSION_SEARCH_RANK_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={searchRankMode === mode}
                    className={
                      "search-panel__mode" +
                      (searchRankMode === mode ? " is-active" : "")
                    }
                    onClick={() => {
                      setSearchRankMode(mode);
                      saveSessionSearchRankPref(mode);
                    }}
                  >
                    {tr(sessionSearchRankModeLabelKey(mode))}
                  </button>
                ))}
              </div>
              <span className="search-panel__rank-hint">
                {searchRankMode === "hybrid"
                  ? tr("search.rankHybridHint")
                  : tr("search.rankKeywordHint")}
              </span>
            </div>
            {paletteActionHits.length > 0 && (
              <>
                <div className="search-panel__section">
                  {tr("search.actions")}
                </div>
                {paletteActionHits.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    className="search-panel__row"
                    onClick={() => runPaletteAction(action)}
                  >
                    {paletteActionIcon(action.id)}
                    <span className="search-panel__title">
                      {tr(action.labelKey)}
                    </span>
                  </button>
                ))}
              </>
            )}
            {searchHits.matchedProjects.length > 0 && (
              <>
                <div className="search-panel__section">
                  {tr("sidebar.projects")}
                </div>
                {searchHits.matchedProjects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="search-panel__row"
                    onClick={() => {
                      setShowSearch(false);
                      // Project is a folder: expand only; selection is for sessions.
                      setProjectsOpen(true);
                      setExpandedProjects((e) => ({ ...e, [p.id]: true }));
                    }}
                  >
                    <IconFolder size={15} />
                    <span className="search-panel__title">{p.name}</span>
                    <span className="search-panel__meta">{p.path}</span>
                  </button>
                ))}
              </>
            )}
            <div className="search-panel__section">
              {tr("search.chats")}
              {contentSearchLoading &&
              shouldScanSessionContent(searchQuery, searchMode)
                ? ` · ${tr("search.searchingContent")}`
                : null}
            </div>
            {searchEmptyState ? (
              <div
                className="search-panel__empty"
                role="status"
                data-kind={searchEmptyState.kind}
              >
                <p className="search-panel__empty-title">
                  {tr(searchEmptyState.titleKey)}
                </p>
                <p className="search-panel__empty-hint">
                  {tr(searchEmptyState.hintKey)}
                </p>
                {searchEmptyState.showClearFilters ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm search-panel__empty-clear"
                    onClick={clearSearchFilters}
                  >
                    {tr("search.clearFilters")}
                  </button>
                ) : null}
              </div>
            ) : null}
            {mergedSessionHits.map((hit, i) => {
              const s = sessions.find((x) => x.id === hit.id);
              // Content-only hits may lack a live row if the list is stale; still open by id.
              const row: SessionRow = s ?? normalizeSessionRow({
                id: hit.id,
                title: hit.title,
                projectId: hit.projectId ?? null,
                updatedAt: "",
                archived: hit.archived,
              });
              const proj = projects.find(
                (p) => p.id === (row.projectId ?? hit.projectId),
              );
              const badge = sessionSearchBadge(hit);
              const metaParts: string[] = [];
              if (proj?.name) metaParts.push(proj.name);
              if (hit.contentMatch && hit.matchCount && hit.matchCount > 0) {
                metaParts.push(
                  tr("search.matchCount", { n: String(hit.matchCount) }),
                );
              }
              if (i < 9) metaParts.push(`⌘${i + 1}`);
              return (
                <button
                  key={hit.id}
                  type="button"
                  className="search-panel__row"
                  onClick={() => {
                    setShowSearch(false);
                    void openSession(row, proj ?? null);
                  }}
                >
                  <IconSquarePen size={15} />
                  <span className="search-panel__body">
                    <span className="search-panel__title">
                      <span className="search-panel__title-text">
                        {hit.title || s?.title || "Untitled"}
                      </span>
                      {badge ? (
                        <span
                          className={
                            "search-panel__badge" +
                            (badge === "content"
                              ? " search-panel__badge--content"
                              : badge === "both"
                                ? " search-panel__badge--both"
                                : "")
                          }
                        >
                          {tr(sessionSearchBadgeLabelKey(badge))}
                        </span>
                      ) : null}
                    </span>
                    {hit.snippet ? (
                      <span className="search-panel__snippet">
                        {hit.snippet}
                      </span>
                    ) : null}
                  </span>
                  <span className="search-panel__meta">
                    {metaParts.join(" · ") || "—"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Edit queued follow-up (textarea; not window.prompt) */}
      <GlassModal
        open={queueEditItemId !== null}
        onClose={closeQueueEdit}
        title={tr("composer.queueEditTitle")}
        size="md"
        closeLabel={tr("common.close")}
        wrapBody
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={closeQueueEdit}
            >
              {tr("composer.queueEditCancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              onClick={saveQueueEdit}
            >
              {tr("composer.queueEditSave")}
            </button>
          </>
        }
      >
        <label className="composer__queue-edit-field">
          <span className="sr-only">{tr("composer.queueEditTitle")}</span>
          <textarea
            ref={queueEditTextareaRef}
            className="composer__queue-edit-textarea settings-input"
            value={queueEditText}
            onChange={(e) => setQueueEditText(e.target.value)}
            rows={6}
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                closeQueueEdit();
              }
              // ⌘/Ctrl+Enter saves (Enter alone inserts newline).
              if (
                e.key === "Enter" &&
                (e.metaKey || e.ctrlKey) &&
                !e.shiftKey &&
                !e.altKey
              ) {
                e.preventDefault();
                saveQueueEdit();
              }
            }}
          />
        </label>
      </GlassModal>

      {/* Clear all queued follow-ups (GlassModal; never window.confirm) */}
      <GlassModal
        open={sendQueueClearOpen}
        onClose={() => setSendQueueClearOpen(false)}
        title={tr("composer.queueClearConfirmTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setSendQueueClearOpen(false)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              data-testid="queue-clear-confirm"
              disabled={!sendQueueClearPlan.confirmNeeded}
              onClick={confirmClearSendQueue}
            >
              {tr("composer.queueClearConfirmAction")}
            </button>
          </>
        }
      >
        <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>
          {sendQueueClearPlan.confirmNeeded
            ? tr("composer.queueClearConfirmMessage", {
                n: String(sendQueueClearPlan.count),
              })
            : tr("composer.queueClearEmpty")}
        </p>
      </GlassModal>

      {/* In-app confirm / prompt (Tauri WebView has no reliable window.prompt/confirm) */}
      {appDialog &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="overlay app-dialog-overlay"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setAppDialog(null);
            }}
          >
            <div
              ref={appDialogPanelRef}
              className="modal app-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="app-dialog-title"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <header className="modal-head">
                <h2 id="app-dialog-title" className="modal-title">
                  {appDialog.title}
                </h2>
                <button
                  type="button"
                  className="icon-btn modal-close"
                  onClick={() => setAppDialog(null)}
                  aria-label={tr("common.close")}
                >
                  <IconClose size={16} />
                </button>
              </header>
              {appDialog.kind === "confirm" ? (
                <form
                  className="app-dialog__form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    // Prefer the keyboard path's latest ref so chained
                    // dialogs (YOLO step1 → step2) stay consistent.
                    const dialog = appDialogRef.current;
                    if (!dialog || dialog.kind !== "confirm") return;
                    const run = dialog.onConfirm;
                    setAppDialog(null);
                    void run();
                  }}
                >
                  <p className="app-dialog__msg">{appDialog.message}</p>
                  <div className="app-dialog__actions modal-actions">
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => setAppDialog(null)}
                    >
                      {tr("common.cancel")}
                    </button>
                    <button
                      ref={confirmBtnRef}
                      type="submit"
                      className={`btn ${appDialog.danger ? "btn--danger" : "btn--solid"}`}
                    >
                      {appDialog.confirmLabel || tr("common.confirm")}
                    </button>
                  </div>
                </form>
              ) : (
                <form
                  className="app-dialog__form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const value = dialogInput;
                    const submit = appDialog.onSubmit;
                    setAppDialog(null);
                    void submit(value);
                  }}
                >
                  {appDialog.message ? (
                    <p className="app-dialog__msg">{appDialog.message}</p>
                  ) : null}
                  <input
                    ref={dialogInputRef}
                    className="app-dialog__input"
                    value={dialogInput}
                    placeholder={appDialog.placeholder}
                    onChange={(e) => setDialogInput(e.target.value)}
                    autoComplete="off"
                  />
                  <div className="app-dialog__actions modal-actions">
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => setAppDialog(null)}
                    >
                      {tr("common.cancel")}
                    </button>
                    <button type="submit" className="btn btn--solid">
                      {appDialog.submitLabel || tr("common.save")}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>,
          document.body,
        )}

      {/* Floating context menu (project / session) — unified ContextMenu */}
      {(() => {
        let items: ContextMenuItem[] = [];
        if (ctxMenu?.kind === "archive-older") {
          const agePreviews = listArchiveAgeOptionPreviews(sessions);
          items = agePreviews.map(({ days, count }) => ({
            id: `archive-older-${days}`,
            label:
              count > 0
                ? tr("sidebar.archiveOlderDaysCount", {
                    days: String(days),
                    n: String(count),
                  })
                : tr("sidebar.archiveOlderDays", { days: String(days) }),
            icon: <IconArchive size={16} />,
            // Keep rows clickable when empty so empty-honesty toast can fire.
            disabled: false,
            onClick: () => {
              confirmArchiveOlderThan(days);
            },
          }));
        } else if (ctxMenu?.kind === "project") {
          const proj = projects.find((p) => p.id === ctxMenu.id);
          if (proj) {
            items = [
              {
                id: "pin",
                label: proj.pinned
                  ? tr("project.unpin")
                  : tr("project.pin"),
                icon: proj.pinned ? (
                  <IconPinOff size={16} />
                ) : (
                  <IconPin size={16} />
                ),
                onClick: () => {
                  void api
                    .projectSetPinned(proj.id, !proj.pinned)
                    .then(() => refreshProjects());
                },
              },
              {
                id: "color",
                label: tr("project.color"),
                icon: (() => {
                  const css = resolveProjectColorCss(proj.color);
                  return css ? (
                    <span
                      className="project-color-swatch"
                      style={{ background: css }}
                      aria-hidden
                    />
                  ) : (
                    <IconAppearance size={16} />
                  );
                })(),
                onClick: () => {
                  setCtxMenu({
                    kind: "project-color",
                    id: proj.id,
                    x: ctxMenu.x,
                    y: ctxMenu.y,
                  });
                },
              },
              {
                id: "reveal",
                label: revealInOsLabel(tr, platform),
                icon: <IconExternalLink size={16} />,
                onClick: () => {
                  void api
                    .projectReveal(proj.id)
                    .catch((e) => setLocalError(String(e)));
                },
              },
              ...(isGeneralProject(proj)
                ? []
                : [
                    {
                      id: "relocate",
                      label: tr("project.relocate"),
                      icon: <IconFolderPlus size={16} />,
                      onClick: () => {
                        void relocateProject(proj);
                      },
                    } satisfies ContextMenuItem,
                    {
                      id: "rename",
                      label: tr("project.rename"),
                      icon: <IconRename size={16} />,
                      onClick: () => renameProject(proj),
                    } satisfies ContextMenuItem,
                  ]),
              {
                id: "rules",
                label: tr("project.rules"),
                icon: <IconFileText size={16} />,
                onClick: () => {
                  setProjectRulesTarget({
                    path: proj.path,
                    name: projectDisplayName(proj, tr),
                  });
                },
              },
              ...(canOfferContinueCwd(proj.path)
                ? [
                    {
                      id: "continue-cwd",
                      label: tr("project.continueCwd"),
                      icon: <IconHistory size={16} />,
                      onClick: () => {
                        void continueLastAgentForProject(proj);
                      },
                    } satisfies ContextMenuItem,
                  ]
                : []),
              ...(proj.trusted
                ? [
                    {
                      id: "permission",
                      label: tr("project.permission"),
                      icon: <IconShield size={16} />,
                      onClick: () => {
                        setCtxMenu({
                          kind: "project-policy",
                          id: proj.id,
                          x: ctxMenu.x,
                          y: ctxMenu.y,
                        });
                      },
                    } satisfies ContextMenuItem,
                    {
                      id: "sandbox",
                      label: tr("project.sandbox"),
                      icon: <IconShield size={16} />,
                      onClick: () => {
                        setCtxMenu({
                          kind: "project-sandbox",
                          id: proj.id,
                          x: ctxMenu.x,
                          y: ctxMenu.y,
                        });
                      },
                    } satisfies ContextMenuItem,
                  ]
                : []),
              {
                id: "archive-chats",
                label: tr("project.archiveChats"),
                icon: <IconArchive size={16} />,
                onClick: () => {
                  void archiveProjectSessions(proj);
                },
              },
              ...(isGeneralProject(proj)
                ? []
                : [
                    {
                      id: "remove",
                      label: tr("project.remove"),
                      icon: <IconTrash size={16} />,
                      danger: true,
                      onClick: () => removeProjectFromApp(proj),
                    } satisfies ContextMenuItem,
                  ]),
            ];
          }
        } else if (ctxMenu?.kind === "project-policy") {
          const proj = projects.find((p) => p.id === ctxMenu.id);
          if (proj && proj.trusted) {
            const current = proj.permissionPolicy?.trim() || null;
            const policyLabel = (id: PermissionPolicyId) =>
              tr(
                (
                  {
                    ask: "policy.ask",
                    accept_edits: "policy.accept_edits",
                    allow_for_session: "policy.allow_for_session",
                    auto: "policy.auto",
                    dont_ask: "policy.dont_ask",
                    always_approve: "policy.always_approve",
                  } as const
                )[id],
              );
            items = [
              {
                id: "inherit",
                label: tr("project.permissionInherit"),
                icon: !current ? <IconCheck size={16} /> : undefined,
                onClick: () => applyProjectPermissionPolicy(proj, null),
              },
              ...PERMISSION_POLICIES.map(
                (p) =>
                  ({
                    id: `policy-${p.id}`,
                    label: policyLabel(p.id),
                    icon:
                      current === p.id ? <IconCheck size={16} /> : undefined,
                    danger: !!p.dangerous,
                    onClick: () => applyProjectPermissionPolicy(proj, p.id),
                  }) satisfies ContextMenuItem,
              ),
            ];
          }
        } else if (ctxMenu?.kind === "project-sandbox") {
          const proj = projects.find((p) => p.id === ctxMenu.id);
          if (proj && proj.trusted) {
            const current =
              normalizeSandboxProfile(proj.sandboxProfile) ?? null;
            items = [
              {
                id: "sandbox-inherit",
                label: tr("project.sandboxInherit"),
                icon: !current ? <IconCheck size={16} /> : undefined,
                onClick: () => applyProjectSandboxProfile(proj, null),
              },
              ...SANDBOX_PROFILES.map(
                (id) =>
                  ({
                    id: `sandbox-${id}`,
                    label: sandboxProfileLabel(id),
                    icon: current === id ? <IconCheck size={16} /> : undefined,
                    danger: isDangerousSandboxProfile(id),
                    onClick: () => applyProjectSandboxProfile(proj, id),
                  }) satisfies ContextMenuItem,
              ),
            ];
          }
        } else if (ctxMenu?.kind === "project-color") {
          const proj = projects.find((p) => p.id === ctxMenu.id);
          if (proj) {
            const current = normalizeProjectColor(proj.color);
            items = [
              {
                id: "color-none",
                label: tr("project.colorNone"),
                icon: !current ? <IconCheck size={16} /> : undefined,
                onClick: () => applyProjectColor(proj, null),
              },
              ...PROJECT_COLOR_TOKENS.map(
                (tok) =>
                  ({
                    id: `color-${tok}`,
                    label: projectColorLabel(tok),
                    icon:
                      current === tok ? (
                        <IconCheck size={16} />
                      ) : (
                        <span
                          className="project-color-swatch"
                          style={{
                            background: resolveProjectColorCss(tok) ?? undefined,
                          }}
                          aria-hidden
                        />
                      ),
                    onClick: () => applyProjectColor(proj, tok),
                  }) satisfies ContextMenuItem,
              ),
            ];
          }
        } else if (ctxMenu?.kind === "session") {
          const s = sessions.find((x) => x.id === ctxMenu.id);
          if (s) {
            const isOpen =
              session.sessionId === s.id ||
              viewingSessionIdRef.current === s.id;
            const wtBadge = sessionWorktreeBadgeFor(s);
            const sessionMuted = mutedSessionIds.has(s.id);
            const sessionUnread = unreadSessionIds.has(s.id);
            const canPopOut = canOpenSessionInNewWindow({
              isDesktopHost: api.isDesktopHost(),
              isSecondaryWindow,
              sessionId: s.id,
            });

            const settingsChildren: ContextMenuItem[] = [
              {
                id: "session-note",
                label: tr("session.note"),
                icon: <IconNotes size={16} />,
                onClick: () => openSessionNote(s),
              },
              {
                id: "session-rules",
                label: tr("session.rules"),
                icon: <IconList size={16} />,
                onClick: () => openSessionRules(s),
              },
              {
                id: "session-sys-prompt",
                label: sanitizeSystemPromptOverride(s.systemPromptOverride)
                  ? tr("session.sysPromptActive")
                  : tr("session.sysPrompt"),
                icon: <IconRobot size={16} />,
                onClick: () => openSessionSysPrompt(s),
              },
              {
                id: "session-max-turns",
                label:
                  normalizeMaxAgentTurns(s.maxAgentTurns) != null
                    ? tr("session.maxTurnsCount", {
                        n: String(normalizeMaxAgentTurns(s.maxAgentTurns)),
                      })
                    : tr("session.maxTurns"),
                icon: <IconListNumbers size={16} />,
                onClick: () => openSessionMaxTurns(s),
              },
              {
                id: "session-plugin-add",
                label:
                  (s.pluginDirs?.length ?? 0) > 0
                    ? tr("session.pluginDirsAddCount", {
                        n: String(s.pluginDirs!.length),
                      })
                    : tr("session.pluginDirsAdd"),
                icon: <IconPuzzle size={16} />,
                onClick: () => {
                  void addSessionPluginDir(s);
                },
              },
              ...((s.pluginDirs?.length ?? 0) > 0
                ? [
                    {
                      id: "session-plugin-clear",
                      label: tr("session.pluginDirsClear"),
                      icon: <IconPuzzle size={16} />,
                      onClick: () => {
                        void clearSessionPluginDirs(s);
                      },
                    } satisfies ContextMenuItem,
                  ]
                : []),
            ];

            const conversationChildren: ContextMenuItem[] = [
              {
                id: "rewind",
                label: tr("session.rewind"),
                icon: <IconRewind size={16} />,
                disabled: !isOpen || !canRewindSession,
                onClick: () => {
                  void openRewindTimeline(s.id);
                },
              },
              {
                id: "collapse-all-activity",
                label: tr("session.collapseAllActivity"),
                icon: <IconArrowsMinimize size={16} />,
                disabled: !isOpen,
                onClick: () => {
                  dispatchCollapseAllActivity();
                },
              },
              {
                id: "transcript-filter",
                label:
                  transcriptFilter === "conversation"
                    ? tr("session.transcriptFilter.showTools")
                    : tr("session.transcriptFilter.hideTools"),
                icon: <IconChat size={16} />,
                disabled: !isOpen,
                onClick: () => {
                  toggleTranscriptFilter();
                },
              },
              {
                id: "plan-history",
                label: tr("plan.history"),
                icon: <IconPlan size={16} />,
                onClick: () => {
                  setShowPlanHistory(true);
                },
              },
            ];

            const copyChildren: ContextMenuItem[] = [
              {
                id: "copy-md",
                label: tr("session.copyMd"),
                icon: <IconCopy size={16} />,
                onClick: () => {
                  void copyConversationMarkdown({
                    id: s.id,
                    title: s.title,
                    projectId: s.projectId,
                  });
                },
              },
              {
                id: "copy-id",
                label: tr("session.copyId"),
                icon: <IconCopy size={16} />,
                onClick: () => {
                  void copySessionId(s);
                },
              },
              ...(wtBadge
                ? [
                    {
                      id: "wt-copy-path",
                      label: tr("session.worktreeCopyPath"),
                      icon: <IconCopy size={16} />,
                      onClick: () => {
                        void (async () => {
                          try {
                            await navigator.clipboard.writeText(wtBadge.path);
                          } catch {
                            setLocalError(wtBadge.path);
                          }
                        })();
                      },
                    } satisfies ContextMenuItem,
                  ]
                : []),
            ];

            // Soft-empty honesty for the live session only (other sessions load on demand).
            const liveExportable =
              s.id === session.sessionId
                ? messages.map((m) => ({
                    role: m.role,
                    content: m.content,
                    thought: m.thought,
                    createdAt: m.createdAt,
                    marker: m.marker,
                  }))
                : null;
            const liveJournalEmptyMd =
              liveExportable != null
                ? isSessionExportJournalEmpty(liveExportable, {
                    format: "markdown",
                  })
                : null;
            const liveJournalEmptyJson =
              liveExportable != null
                ? isSessionExportJournalEmpty(liveExportable, {
                    format: "json",
                  })
                : null;
            const liveJournalEmptyPlain =
              liveExportable != null
                ? isSessionExportJournalEmpty(liveExportable, {
                    format: "plain",
                  })
                : null;
            const liveJournalEmptyHtml =
              liveExportable != null
                ? isSessionExportJournalEmpty(liveExportable, {
                    format: "html",
                  })
                : null;
            const emptySuffix = (empty: boolean | null) =>
              empty === true ? ` · ${tr("session.exportEmptyShort")}` : "";

            const exportChildren: ContextMenuItem[] = [
              {
                id: "export-image",
                label: tr("session.exportImage"),
                icon: <IconExportImage size={16} />,
                onClick: () => {
                  openExportSessionImage({
                    id: s.id,
                    title: s.title,
                    projectId: s.projectId,
                  });
                },
              },
              {
                id: "export-md",
                label: `${tr("session.exportMd")}${emptySuffix(liveJournalEmptyMd)}`,
                icon: <IconCopy size={16} />,
                disabled: liveJournalEmptyMd === true,
                onClick: () => {
                  if (liveJournalEmptyMd === true) {
                    showToast(tr("session.exportEmpty"));
                    return;
                  }
                  openExportSessionMd({
                    id: s.id,
                    title: s.title,
                    projectId: s.projectId,
                  });
                },
              },
              {
                id: "export-plain",
                label: `${tr("session.exportPlain")}${emptySuffix(liveJournalEmptyPlain)}`,
                icon: <IconCopy size={16} />,
                disabled: liveJournalEmptyPlain === true,
                onClick: () => {
                  void exportSessionPlain({
                    id: s.id,
                    title: s.title,
                    projectId: s.projectId,
                  });
                },
              },
              {
                id: "export-json",
                label: `${tr("session.exportJson")}${emptySuffix(liveJournalEmptyJson)}`,
                icon: <IconCopy size={16} />,
                disabled: liveJournalEmptyJson === true,
                onClick: () => {
                  void exportSessionJson({
                    id: s.id,
                    title: s.title,
                    projectId: s.projectId,
                  });
                },
              },
              {
                id: "export-html",
                label: `${tr("session.exportHtml")}${emptySuffix(liveJournalEmptyHtml)}`,
                icon: <IconCopy size={16} />,
                disabled: liveJournalEmptyHtml === true,
                onClick: () => {
                  void exportSessionHtml({
                    id: s.id,
                    title: s.title,
                    projectId: s.projectId,
                  });
                },
              },
              {
                id: "export-stream-json",
                label: tr("session.exportStreamJson"),
                icon: <IconCopy size={16} />,
                onClick: () => {
                  void exportSessionStreamNdjson("streaming-json", {
                    id: s.id,
                    title: s.title,
                    projectId: s.projectId,
                  });
                },
              },
              {
                id: "export-stream-messages-json",
                label: tr("session.exportStreamMessagesJson"),
                icon: <IconCopy size={16} />,
                onClick: () => {
                  void exportSessionStreamNdjson("streaming-messages-json", {
                    id: s.id,
                    title: s.title,
                    projectId: s.projectId,
                  });
                },
              },
              {
                id: "export-trace-local",
                label: tr("session.exportTraceLocal"),
                icon: <IconArchive size={16} />,
                onClick: () => {
                  void exportSessionTrace(s.id, { localOnly: true });
                },
              },
              {
                id: "export-trace-upload",
                label: tr("session.exportTraceUpload"),
                icon: <IconArchive size={16} />,
                onClick: () => {
                  confirmExportSessionTraceUpload(s.id);
                },
              },
              {
                id: "export-bundle",
                label: tr("session.exportBundle"),
                icon: <IconCopy size={16} />,
                onClick: () => {
                  void exportSessionDiagnostic(s.id);
                },
              },
              {
                id: "traces",
                label: tr("session.traces"),
                icon: <IconFolder size={16} />,
                onClick: () => {
                  setShowTraces(true);
                },
              },
            ];

            const worktreeChildren: ContextMenuItem[] = wtBadge
              ? [
                  {
                    id: "wt-reveal",
                    label: tr("session.worktreeReveal"),
                    icon: <IconExternalLink size={16} />,
                    onClick: () => {
                      void (async () => {
                        try {
                          await api.fsOpenPath(wtBadge.path);
                        } catch (e) {
                          showToast(String(e), 4000);
                        }
                      })();
                    },
                  },
                  {
                    id: "wt-copy-path-sub",
                    label: tr("session.worktreeCopyPath"),
                    icon: <IconCopy size={16} />,
                    onClick: () => {
                      void (async () => {
                        try {
                          await navigator.clipboard.writeText(wtBadge.path);
                        } catch {
                          setLocalError(wtBadge.path);
                        }
                      })();
                    },
                  },
                  {
                    id: "wt-ship",
                    label: tr("composer.worktreeShip"),
                    icon: <IconUpload size={16} />,
                    onClick: () => {
                      openShipFlow();
                    },
                  },
                  {
                    id: "wt-remove",
                    label: tr("composer.worktreeRemove"),
                    icon: <IconTrash size={16} />,
                    danger: true,
                    onClick: () => {
                      const fromList =
                        gitWorktrees.find((w) =>
                          pathsEqual(w.path, wtBadge.path),
                        ) ?? null;
                      const wt: api.GitWorktreeEntry = fromList ?? {
                        path: wtBadge.path,
                        branch: wtBadge.branch,
                        detached: !wtBadge.branch,
                        isMain: false,
                        locked: false,
                        prunable: false,
                      };
                      if (!canRemoveWorktree(wt) && fromList?.isMain) {
                        showToast(tr("composer.worktreeRemoveFailed"), 3500);
                        return;
                      }
                      confirmRemoveWorktree({ ...wt, isMain: false });
                    },
                  },
                ]
              : [];

            const resumeRestoreItem = (() => {
              const proj = s.projectId
                ? projects.find((p) => p.id === s.projectId) ?? null
                : null;
              const path = proj?.path?.trim() || "";
              const gitKnown =
                activeProject &&
                path &&
                pathsEqual(activeProject.path, path)
                  ? gitWorktreesAvailable
                  : null;
              if (
                !canOfferResumeWithCodeRestore(path, {
                  gitAvailable: gitKnown,
                })
              ) {
                return null;
              }
              return {
                id: "resume-restore",
                label: tr("session.resumeRestore"),
                icon: <IconGitBranch size={16} />,
                disabled:
                  resumeRestoreBusy ||
                  forkBusy ||
                  busyIds.has(s.id) ||
                  (isOpen && !canRewindSession),
                onClick: () => confirmResumeWithCodeRestore(s),
              } satisfies ContextMenuItem;
            })();

            items = [
              {
                id: "pin",
                label: s.pinned ? tr("session.unpin") : tr("session.pin"),
                icon: s.pinned ? (
                  <IconPinOff size={16} />
                ) : (
                  <IconPin size={16} />
                ),
                onClick: () => {
                  void pinSession(s, !s.pinned);
                },
              },
              ...(canPopOut
                ? [
                    {
                      id: "open-new-window",
                      label: tr("session.openInNewWindow"),
                      icon: <IconExternalLink size={16} />,
                      onClick: () => openSessionInNewWindow(s),
                    } satisfies ContextMenuItem,
                  ]
                : []),
              {
                id: "mute",
                label: sessionMuted
                  ? tr("session.unmute")
                  : tr("session.mute"),
                icon: sessionMuted ? (
                  <IconBell size={16} />
                ) : (
                  <IconBellOff size={16} />
                ),
                onClick: () => handleToggleSessionMute(s.id),
              },
              {
                id: sessionUnread ? "clear-unread" : "mark-unread",
                label: sessionUnread
                  ? tr("session.clearUnread")
                  : tr("session.markUnread"),
                icon: sessionUnread ? (
                  <IconCheck size={16} />
                ) : (
                  <IconCircle size={16} />
                ),
                onClick: () => {
                  if (sessionUnread) handleClearSessionUnread(s.id);
                  else handleMarkSessionUnread(s.id);
                },
              },
              ...(unreadSessionIds.size > 0
                ? [
                    {
                      id: "clear-all-unread",
                      label: tr("session.clearAllUnread"),
                      icon: <IconCheck size={16} />,
                      onClick: () => handleClearAllSessionUnread(),
                    } satisfies ContextMenuItem,
                  ]
                : []),
              {
                id: "rename",
                label: tr("session.rename"),
                icon: <IconRename size={16} />,
                onClick: () => renameSession(s),
              },
              {
                id: "session-settings",
                label: tr("session.menuSettings"),
                icon: <IconSettings size={16} />,
                children: settingsChildren,
              },
              {
                id: "fork",
                label: tr("session.fork"),
                icon: <IconFork size={16} />,
                onClick: () => confirmForkSession(s),
              },
              {
                id: "duplicate",
                label: tr("session.duplicate"),
                icon: <IconFiles size={16} />,
                disabled:
                  forkBusy ||
                  busyIds.has(s.id) ||
                  (isOpen && !canRewindSession),
                onClick: () => {
                  void runDuplicateSession(s);
                },
              },
              ...(resumeRestoreItem ? [resumeRestoreItem] : []),
              {
                id: "conversation",
                label: tr("session.menuConversation"),
                icon: <IconChat size={16} />,
                children: conversationChildren,
              },
              ...(worktreeChildren.length > 0
                ? [
                    {
                      id: "worktree",
                      label: tr("session.menuWorktree"),
                      icon: <IconGitBranch size={16} />,
                      children: worktreeChildren,
                    } satisfies ContextMenuItem,
                  ]
                : []),
              {
                id: "copy",
                label: tr("session.menuCopy"),
                icon: <IconCopy size={16} />,
                children: copyChildren,
              },
              {
                id: "export",
                label: tr("session.menuExport"),
                icon: <IconExportImage size={16} />,
                children: exportChildren,
              },
              {
                id: "archive",
                label: s.archived
                  ? tr("sidebar.unarchive")
                  : tr("sidebar.archive"),
                icon: <IconArchive size={16} />,
                onClick: () => {
                  void archiveSession(s, !s.archived);
                },
              },
              {
                id: "delete",
                label: tr("session.delete"),
                icon: <IconTrash size={16} />,
                danger: true,
                onClick: () => deleteSessionConfirm(s),
              },
            ];
          }
        }
        return (
          <>
          <ContextMenu
            open={!!ctxMenu && items.length > 0}
            x={ctxMenu?.x ?? 0}
            y={ctxMenu?.y ?? 0}
            onClose={() => setCtxMenu(null)}
            items={items}
            estimatedHeight={
              ctxMenu?.kind === "session"
                ? 360
                : ctxMenu?.kind === "project-policy"
                  ? 280
                  : 240
            }
          />
          <ContextMenu
            open={!!composerCtxMenu}
            x={composerCtxMenu?.x ?? 0}
            y={composerCtxMenu?.y ?? 0}
            onClose={() => setComposerCtxMenu(null)}
            items={composerCtxItems}
            estimatedHeight={88}
          />
          </>
        );
      })()}

      <span hidden data-layout-default={JSON.stringify(DEFAULT_LAYOUT)} />
    </div>
    </ImageViewerProvider>
  );
}

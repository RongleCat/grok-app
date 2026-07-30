import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { useFloatingMenu } from "@/lib/floatingMenu";
import {
  applyNativeWindowTheme,
  applyThemePreference,
  applyThemeToDocument,
  getSystemTheme,
  loadThemePreference,
  resolveTheme,
  saveThemePreference,
  subscribeSystemTheme,
  toggleThemePreference,
  type Theme,
  type ThemePreference,
} from "@/lib/theme";
import {
  applySkinToDocument,
  applyWallpaperFlag,
  applyWallpaperScrimToDocument,
  clearWallpaper,
  DEFAULT_WALLPAPER_FOCUS,
  loadSkin,
  loadWallpaperRecord,
  loadWallpaperScrim,
  saveSkin,
  saveWallpaper,
  saveWallpaperAdjust,
  saveWallpaperMediaSize,
  saveWallpaperScrim,
  skinPreferredTheme,
  type ThemeSkinId,
  type WallpaperClip,
  type WallpaperFocus,
  type WallpaperRecord,
} from "@/lib/themeSkin";
import {
  loadMessageTimestampsPref,
  MESSAGE_TIMESTAMPS_CHANGE_EVENT,
  saveMessageTimestampsPref,
} from "@/lib/messageTimestampsPref";
import {
  loadMessageTimeFormatPref,
  MESSAGE_TIME_FORMAT_CHANGE_EVENT,
  saveMessageTimeFormatPref,
  type MessageTimeFormat,
} from "@/lib/messageTimeFormatPref";
import {
  loadSidebarShowRelativeTimePref,
  saveSidebarShowRelativeTimePref,
  SIDEBAR_SHOW_RELATIVE_TIME_CHANGE_EVENT,
} from "@/lib/sidebarShowRelativeTimePref";
import {
  formatMessageTime,
  formatRelativeTime,
} from "@/lib/accountUi";
import { loadConfirmExternalLinksPref } from "@/lib/externalLinkPref";
import {
  loadNotifySoundPref,
  NOTIFY_SOUND_CHANGE_EVENT,
  saveNotifySoundPref,
} from "@/lib/notifySound";
import {
  applyWindowAlwaysOnTop,
  loadWindowAlwaysOnTopPref,
  saveWindowAlwaysOnTopPref,
} from "@/lib/windowAlwaysOnTop";
import {
  loadPermissionTimeoutSec,
  PERMISSION_TIMEOUT_CHANGE_EVENT,
  permissionTimeoutRemainingSec,
  savePermissionTimeoutSec,
} from "@/lib/permissionTimeout";
import { WallpaperMediaLayer } from "@/components/WallpaperMediaLayer";
import {
  ASIDE_WIDTH_MIN,
  DEFAULT_LAYOUT,
  WINDOW_CONTROLS_INSET,
  clampAsideWidth,
  SIDEBAR_DEFAULT_WIDTH,
  isMirrorPhoneLayout,
  loadLayout,
  mergeAsideWidth,
  saveLayout,
  suggestAsideWidth,
  withMirrorPhoneDrawerDefault,
  type AsideLayoutHint,
} from "@/lib/layout";
import {
  ZEN_MODE_CHANGE_EVENT,
  applyZenModeLayoutTransition,
  clearZenModePrior,
  loadZenMode,
  loadZenModePrior,
  saveZenMode,
  saveZenModePrior,
} from "@/lib/zenMode";
import {
  ensureWindowFitsLayout,
  isWindowFitSuppressed,
} from "@/lib/windowFit";
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
  applyContextCompact,
  applyGeneratedImage,
  applyInterjection,
  applyStreamChunk,
  applyToolEvent,
  applyTurnError,
  applyTurnMarker,
  parseCompactContent,
  parseToolStepContent,
  canSend,
  canType,
  clearPriorTurnStreaming,
  isSessionBusy,
  isSessionLiveStreaming,
  isSessionNotLiveError,
  preferSessionMessages,
  presentErrorBanner,
  snapshotOutgoingMessages,
  type ErrorBannerView,
  buildSegmentsFromLegacy,
  weaveToolsIntoAssistantSegments,
  splitThoughtPhases,
  truncateBeforeLastUser,
  truncateThroughUserPrompt,
  canRewindToUserPrompt,
  canRegenerateAssistant,
  userPromptIndexOf,
  localRewindPoints,
  IDLE_SNAPSHOT,
  type AskUserPayload,
  type ChatMessage,
  type GeneratedImagePayload,
  type PermissionPayload,
  type SessionSnapshot,
  type StreamPayload,
  type TurnErrorPayload,
} from "@/lib/session";
import { StreamCoalescer } from "@/lib/streamCoalesce";
import { UiErrorBoundary } from "@/components/UiErrorBoundary";
import {
  INITIAL_CONTEXT_USAGE,
  reduceContextUsage,
  resolveContextUsageDisplay,
  type ContextUsageState,
} from "@/lib/contextUsage";
import { ContextUsageChip } from "@/components/ContextUsageChip";
import { PlanStatusBar } from "@/components/PlanStatusBar";
import {
  closedSessionPlan,
  emptySessionPlan,
  mergePlanFromEvent,
  type SessionPlanState,
} from "@/lib/planSession";
import { AgentTasksPanel } from "@/components/AgentTasksPanel";
import {
  collectActivitySessions,
  stoppableActivitySessions,
} from "@/lib/agentActivity";
import * as api from "@/lib/api";
import { shouldRestoreLastSession } from "@/lib/sessionRestore";
import {
  collapsedIdsFromExpandMap,
  expandMapFromCollapsedIds,
  sameCollapsedIdSet,
} from "@/lib/sidebarExpand";
import {
  pruneSelectedIds,
  toggleIdInSet,
} from "@/lib/sessionSelect";
import {
  collectSessionTasks,
  countRunningTasks,
} from "@/lib/sessionTasks";
import {
  armStopLatch,
  canStopWithStopLatch,
  createStopLatchState,
  tickStopLatch,
  type StopLatchState,
  STOP_LATCH_MS,
} from "@/lib/stopLatch";
import { shouldEscapeStopGeneration } from "@/lib/escapeStop";
import {
  isSameView,
  isViewingSendTarget,
  shouldAdoptView,
  type ViewFocus,
} from "@/lib/viewFocus";
import {
  busySessionIds,
  projectHostIntoLiveMap,
  mayPromoteStreamingFromStreamChunk,
  projectLiveToolFromMessages,
  markSawModelOutput,
  markSawToolActivity,
  mergeTurnProgressFromMessages,
  resumeStateForSession,
  settleStoppedSessionInLiveMap,
  settleStoppedSessionSnapshot,
  type SessionLiveMap,
} from "@/lib/sessionLiveStore";
import { endOfTurnMarkerContent } from "@/lib/endOfTurn";
import {
  stallMessageKey,
  stallTierFromProgress,
  normalizeStallTier,
  reconcileSessionState,
  reconcileUiBusyGate,
} from "@/lib/sessionPhase";
import {
  isMirrorClient,
  mirrorEnsureTransport,
  mirrorHello,
  mirrorWsConnected,
} from "@/lib/mirrorTransport";

import { createT, resolveLocale, type Locale } from "@/i18n";
import {
  DEFAULT_EFFORT,
  DEFAULT_MODEL_ID,
  GROK_BUILD_MODELS,
  PERMISSION_POLICIES,
  findModel,
  isValidEffort,
  isValidModelId,
  isValidPolicy,
  isValidPrefsScope,
  pickDefaultEffort,
  pickDefaultModelId,
  type ComposerPrefsScope,
  type EffortOption,
  type ModelOption,
  type PermissionPolicyId,
} from "@/lib/grokCatalog";
import {
  formatPermissionSummary,
  mapPermissionButtons,
} from "@/lib/permissionOptions";
import { AskUserModal } from "@/components/AskUserModal";
import { DoctorModal } from "@/components/DoctorModal";
import { VoiceOverlay } from "@/components/VoiceOverlay";
import {
  filterSessionSearch,
  mergeSessionSearchHits,
  type SessionContentHit,
} from "@/lib/sessionSearch";
import {
  defaultPaletteActions,
  filterPaletteActions,
  type PaletteActionDef,
} from "@/lib/paletteActions";
import {
  sessionExportFilename,
  sessionExportJsonFilename,
  sessionToJson,
  sessionToMarkdown,
} from "@/lib/sessionExport";
import {
  findChatMatches,
  stepChatFindIndex,
  type ChatFindMatch,
} from "@/lib/chatFind";
import { connPillForState } from "@/lib/connStatus";
import {
  matchGlobalShortcut,
  shortcutsForPlatform,
} from "@/lib/shortcuts";
import {
  ensureNotifyPermission,
  setDesktopNotifySessionFocusHandler,
  shouldShowDesktopNotify,
  showDesktopNotification,
} from "@/lib/desktopNotify";
import { GlassModal } from "@/components/GlassModal";
import { ChatFindBar } from "@/components/ChatFindBar";
import {
  applyResolvedSessionMedia,
  buildAgentPrompt,
  collectSessionRelativeMediaRefs,
  isImagePath,
  mergeAttachments,
  mergeMessageAttachments,
  parseAttachmentsFromContent,
  type Attachment,
} from "@/lib/attachments";
import { fileKey as clipboardFileKey } from "@/lib/clipboardPaste";
import {
  applySkillAtSlash,
  isDraftEmpty,
  hydrateDisplayContent,
  detectSlashQueryFromEditor,
  parseStoredContent,
  serializeForAgent,
} from "@/lib/draftDoc";
import {
  collectUserPromptHistory,
  filterPromptHistory,
  shouldHandlePromptHistoryKey,
  stepPromptHistory,
  type PromptHistoryEntry,
} from "@/lib/composerPromptHistory";
import {
  COMPOSER_SEND_KEY_CHANGED_EVENT,
  loadComposerSendKeyPref,
  shouldSendOnKeydown,
  type ComposerSendKeyPref,
} from "@/lib/composerSendKey";
import {
  COMPOSER_DRAFT_STATS_CHANGED_EVENT,
  computeDraftStats,
  countDraftChars,
  loadComposerDraftStatsPref,
} from "@/lib/draftStats";
import {
  COMPOSER_SPELLCHECK_CHANGED_EVENT,
  loadComposerSpellcheck,
} from "@/lib/composerSpellcheck";
import {
  clearComposerProjectDraft,
  loadComposerProjectDraft,
  projectDraftKey,
  saveComposerProjectDraft,
  type ComposerProjectDraft,
} from "@/lib/composerProjectDraft";
import { PromptHistoryPanel } from "@/components/PromptHistoryPanel";
import {
  queuePreviewText,
  shouldEnqueueSend,
  type QueuedSend,
} from "@/lib/sendQueue";
import {
  useSendQueue,
  type ExecuteSendFromQueue,
} from "@/hooks/useSendQueue";
import {
  buildSlashCatalog,
  flattenFilteredCatalog,
  type SlashItem,
  type SkillInfo,
} from "@/lib/slashCatalog";
import type { MessageKey } from "@/i18n";
import { AttachmentCard } from "@/components/AttachmentCard";
import { ImageViewerProvider } from "@/components/ImageViewer";
import { OverlayScroll } from "@/components/OverlayScroll";
import { VirtualList } from "@/components/VirtualList";
import {
  SIDEBAR_DENSITY_EVENT,
  loadSidebarDensity,
  sidebarSessionRowMetrics,
  type SidebarDensity,
} from "@/lib/sidebarDensity";
import { GrokLogo } from "@/components/GrokLogo";
import { SetupWizard, type SetupCliInfo } from "@/components/SetupWizard";
import {
  ComposerEditor,
  getComposerCaretOffset,
} from "@/components/ComposerEditor";
import { ComposerProjectMenu } from "@/components/ComposerProjectMenu";
import { ComposerWorktreeMenu } from "@/components/ComposerWorktreeMenu";
import {
  buildWorktreeSiblingPath,
  canRemoveWorktree,
  mainWorktreePath,
  pathsEqual,
  sanitizeWorktreeName,
  worktreeLabel,
  worktreeRemoveErrorSuggestsForce,
} from "@/lib/gitWorktree";
import { isProjectPathMissing } from "@/lib/projectPath";
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
  type VoiceFsmState,
} from "@/lib/voiceDictation";
import {
  blobToBase64,
  extensionForMime,
  startVoiceCapture,
  type CaptureHandle,
} from "@/lib/voiceCapture";
import {
  ComposerPlusPanel,
  buildComposerPlusEntries,
  uploadMatchesQuery,
} from "@/components/ComposerPlusPanel";
import { StatusModal } from "@/components/StatusModal";
import { McpStatusModal } from "@/components/McpStatusModal";
import {
  IconChevronDown,
  IconChevronRight,
  IconMore,
  IconPlus,
  IconSearch,
  IconAttach,
  IconSend,
  IconMic,
  IconLiveVoice,
  IconQueue,
  IconStop,
  IconFolder,
  IconFolderPlus,
  IconArrowsVerticalCollapse,
  IconArrowsMinimize,
  IconZen,
  IconClock,
  IconClose,
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
  IconRename,
  IconCopy,
  IconTrash,
  IconExternalLink,
  IconFork,
  IconRewind,
  IconDeviceMobile,
  IconShield,
  IconCheck,
  IconList,
  IconFileText,
  IconSettings,
  IconDoctor,
  IconKeyboard,
  IconAppearance,
  IconInfo,
  IconPlug,
} from "@/components/icons";
import { PhoneAccountSheet } from "@/components/PhoneAccountSheet";
import { PhoneComposerToolsSheet } from "@/components/PhoneComposerToolsSheet";
import { AutomationsPage } from "@/components/AutomationsPage";
import { OpenLocationButton } from "@/components/OpenLocationButton";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import {
  aiCreateSeedPrompt,
  computeNextRunAt,

  parseScheduledUserContent,
  type Automation,
} from "@/lib/automations";
import {
  extractAutomationPayload,
  looksLikeScheduleIntent,
  wrapAutomationSetupAgentText,
} from "@/lib/automationSetup";
import {
  ComposerAccessMenu,
  ComposerModelMenu,
} from "@/components/ComposerModelMenu";
import {
  ResourceViewer,
  type ResourceOpenTarget,
} from "@/components/ResourceViewer";
import { ProjectRulesModal } from "@/components/ProjectRulesModal";
import {
  mergeSessionChange,
  sessionChangesFromMessages,
  type SessionFileChange,
} from "@/lib/sessionChanges";
import { ConversationThread } from "@/components/lobe-chat";
import { dispatchCollapseAllActivity } from "@/lib/collapseAllActivity";
import {
  preferPermissionFocus,
  trapTabKey,
} from "@/lib/a11yFocus";
import { Spinner } from "@/components/ui/spinner";
import { UserMenu, remainingPercent } from "@/components/UserMenu";
import {
  SettingsPage,
  type SettingsSectionId,
} from "@/components/SettingsPage";
import {
  buildSettingsHash,
  isSettingsSectionId,
  parseSettingsHash,
  type SettingsTabId,
} from "@/lib/settingsCatalog";
import {
  loadSettingsLastRoute,
  resolveOpenSettingsLocation,
  saveSettingsLastRoute,
} from "@/lib/settingsLastRoute";
import {
  accountDisplayName,
  accountInitials,
  isAccountConnected,
  loadCachedSuperGrokBrand,
  resolveWelcomeBrandKind,
  saveCachedSuperGrokBrand,
  superGrokBrandKind,
} from "@/lib/accountUi";
import {
  SuperGrokMark,
  type SuperGrokBrandKind,
} from "@/components/SuperGrokMark";
import { Tip } from "@/components/ui/tooltip";
import {
  WindowControls,
  toggleMaximizeFromTitlebar,
} from "@/components/WindowControls";

/** Icon for a command-palette action row (stable by action id). */
function paletteActionIcon(id: string) {
  const size = 15;
  switch (id) {
    case "new-chat":
      return <IconSquarePen size={size} />;
    case "add-project":
      return <IconFolder size={size} />;
    case "open-automations":
      return <IconScheduled size={size} />;
    case "open-tasks":
      return <IconList size={size} />;
    case "doctor":
      return <IconDoctor size={size} />;
    case "shortcuts-help":
    case "settings-shortcuts":
      return <IconKeyboard size={size} />;
    case "settings-appearance":
      return <IconAppearance size={size} />;
    case "settings-account":
      return <IconUser size={size} />;
    case "settings-extensions":
      return <IconPlug size={size} />;
    case "settings-runtime":
      return <IconDoctor size={size} />;
    case "settings-remote":
      return <IconDeviceMobile size={size} />;
    case "settings-about":
      return <IconInfo size={size} />;
    case "settings-general":
    default:
      return <IconSettings size={size} />;
  }
}

interface Project {
  id: string;
  name: string;
  path: string;
  trusted: boolean;
  pathOk: boolean;
  pinned?: boolean;
  /** App-managed general workspace — cannot be removed. */
  system?: boolean;
  /** Project-level permission tier (L10). Null/undefined → app default. */
  permissionPolicy?: string | null;
}

/** Retired sidebar project id — sessions rehomed to orphan ("其他会话"). */
const GENERAL_PROJECT_ID = "system:general";

function isGeneralProject(p: { id?: string | null; system?: boolean } | null | undefined) {
  return !!p && (p.id === GENERAL_PROJECT_ID || !!p.system);
}

/** Treat legacy system:general bindings as unbound (other sessions). */
function normalizeProjectId(id: string | null | undefined): string | null {
  if (!id || id === GENERAL_PROJECT_ID) return null;
  return id;
}

function projectDisplayName(
  p: { id?: string | null; name?: string | null; system?: boolean } | null | undefined,
  tr: (k: MessageKey, vars?: Record<string, string>) => string,
): string {
  if (!p || isGeneralProject(p)) return tr("composer.noProject");
  return (p?.name || "").trim() || tr("main.noProject");
}

/** Normalize API project rows; drop retired system:general if Host still returns it. */
function normalizeProject(x: Project): Project {
  return {
    ...x,
    system: false,
    pinned: !!x.pinned,
    trusted: !!x.trusted,
  };
}

function mapProjectsList(list: Project[]): Project[] {
  return list
    .filter((p) => !isGeneralProject(p))
    .map((p) => normalizeProject({ ...p, pinned: !!p.pinned }));
}

interface SessionRow {
  id: string;
  title: string;
  projectId: string | null;
  updatedAt: string;
  archived?: boolean;
  /** Pinned chats float to the top of the sidebar */
  pinned?: boolean;
  /** Shell scheduled-automation run */
  scheduled?: boolean;
}

type ContextMenuState =
  | { kind: "project"; id: string; x: number; y: number }
  | { kind: "project-policy"; id: string; x: number; y: number }
  | { kind: "session"; id: string; x: number; y: number }
  | null;

/** In-app dialogs — window.prompt/confirm are unreliable in Tauri WebView. */
type AppDialog =
  | {
      kind: "confirm";
      title: string;
      message: string;
      confirmLabel?: string;
      danger?: boolean;
      onConfirm: () => void | Promise<void>;
    }
  | {
      kind: "prompt";
      title: string;
      initial: string;
      /** Optional secondary copy above the input (e.g. compact confirm). */
      message?: string;
      placeholder?: string;
      /** Primary submit button label (default: common.save). */
      submitLabel?: string;
      onSubmit: (value: string) => void | Promise<void>;
    }
  | null;

/** App-local plan chrome state (session-scoped via planBySessionRef). */
type PlanState = SessionPlanState;

export default function App() {
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    loadThemePreference(localStorage),
  );
  const [systemTheme, setSystemTheme] = useState<Theme>(() => getSystemTheme());
  const theme = useMemo(
    () => resolveTheme(themePreference, systemTheme),
    [themePreference, systemTheme],
  );
  const [skin, setSkin] = useState<ThemeSkinId>(() => loadSkin(localStorage));
  const [wallpaperRecord, setWallpaperRecord] = useState<WallpaperRecord | null>(
    null,
  );
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(null);
  // Holds the current blob: URL so we can revoke it when replacing/clearing.
  const wallpaperUrlRef = useRef<string | null>(null);
  const [wallpaperScrim, setWallpaperScrim] = useState(() =>
    loadWallpaperScrim(localStorage),
  );
  const [showMessageTimestamps, setShowMessageTimestamps] = useState(() =>
    loadMessageTimestampsPref(localStorage),
  );
  const [messageTimeFormat, setMessageTimeFormat] = useState<MessageTimeFormat>(
    () => loadMessageTimeFormatPref(localStorage),
  );
  const [sidebarShowRelativeTime, setSidebarShowRelativeTime] = useState(() =>
    loadSidebarShowRelativeTimePref(localStorage),
  );
  /** Shared tick so relative session labels recompute ~once a minute. */
  const [sidebarRelativeTick, setSidebarRelativeTick] = useState(0);
  useEffect(() => {
    if (!sidebarShowRelativeTime) return;
    const id = window.setInterval(() => {
      setSidebarRelativeTick((n) => n + 1);
    }, 60_000);
    return () => window.clearInterval(id);
  }, [sidebarShowRelativeTime]);
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
  const [notifySound, setNotifySound] = useState(() =>
    loadNotifySoundPref(localStorage),
  );
  const [windowAlwaysOnTop, setWindowAlwaysOnTop] = useState(() =>
    loadWindowAlwaysOnTopPref(localStorage),
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
  zenModeRef.current = zenMode;

  const [session, setSession] = useState<SessionSnapshot>(IDLE_SNAPSHOT);
  /** Host live agent (may differ from the session currently viewed in the UI). */
  const [liveHost, setLiveHost] = useState<SessionSnapshot>(IDLE_SNAPSHOT);
  /** Multi-session live projection (busy / permission badges). */
  const [liveMap, setLiveMap] = useState<SessionLiveMap>({});
  /** Latest live map for callbacks that must not close over a stale render. */
  const liveMapRef = useRef(liveMap);
  liveMapRef.current = liveMap;
  /** Stop interrupt honesty latch (force unlock after budget). */
  const [stopLatch, setStopLatch] = useState<StopLatchState>(() =>
    createStopLatchState(),
  );
  const stopLatchRef = useRef<StopLatchState>(createStopLatchState());
  stopLatchRef.current = stopLatch;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
  /** Composer stored form (may include [[skill:name]] tokens). */
  const [draft, setDraft] = useState("");
  /**
   * Skip debounced project-draft persist while programmatically loading a
   * saved buffer into the composer (newChat restore).
   */
  const suppressProjectDraftPersistRef = useRef(false);
  /**
   * CLI-like prompt history browse index (0 = newest user msg).
   * null = not browsing; only engaged when draft empty (or already browsing).
   * Ref tracks live index for key-repeat before React re-renders.
   */
  const [promptHistoryIndex, setPromptHistoryIndex] = useState<number | null>(
    null,
  );
  const promptHistoryIndexRef = useRef<number | null>(null);
  promptHistoryIndexRef.current = promptHistoryIndex;
  /**
   * `/history` + empty-↑ picker — current session prompts only (Build-aligned).
   * Filter focuses on slash open; empty ↑ keeps focus in the composer.
   */
  const [promptHistoryOpen, setPromptHistoryOpen] = useState(false);
  const [promptHistoryFilter, setPromptHistoryFilter] = useState("");
  const [promptHistoryActive, setPromptHistoryActive] = useState(0);
  const [promptHistoryFocusFilter, setPromptHistoryFocusFilter] =
    useState(false);
  const promptHistoryPanelRef = useRef<HTMLDivElement>(null);
  const promptHistoryOpenRef = useRef(false);
  promptHistoryOpenRef.current = promptHistoryOpen;
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
  /** Prevent overlapping executeSend / queue auto-flush races. */
  const sendInFlightRef = useRef(false);
  const executeSendFromQueueRef = useRef<ExecuteSendFromQueue>(
    async () => false,
  );
  const [skillInfos, setSkillInfos] = useState<SkillInfo[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  /** Host `skills_list` error (CLI missing / inspect fail); empty when ok. */
  const [skillsLoadError, setSkillsLoadError] = useState<string | null>(null);
  const [slashQuery, setSlashQuery] = useState<{
    start: number;
    query: string;
    end: number;
  } | null>(null);
  /**
   * Live slash token from contenteditable.innerText (rAF poll).
   * Independent of React draft so IME / <br> / missed onChange cannot desync.
   * `present` is true for bare `/` as well as `/query`.
   */
  const [liveSlash, setLiveSlash] = useState<{
    present: boolean;
    query: string;
    start: number;
    end: number;
  }>({ present: false, query: "", start: 0, end: 0 });
  const liveSlashRef = useRef(liveSlash);
  liveSlashRef.current = liveSlash;
  /** After Escape, suppress re-open until the `/token` text changes. */
  const slashDismissedSigRef = useRef<string | null>(null);
  const showComposerPlusRef = useRef(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showMcpModal, setShowMcpModal] = useState(false);
  const [showCompactModal, setShowCompactModal] = useState(false);
  const [compactNote, setCompactNote] = useState("");
  const compactNoteRef = useRef<HTMLInputElement>(null);
  const [mcpServers, setMcpServers] = useState<api.McpDto[]>([]);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpLoading, setMcpLoading] = useState(false);
  /** Rewind timeline picker (session menu / status). */
  const [rewindTimeline, setRewindTimeline] = useState<{
    sessionId: string;
    points: Array<{ promptIndex: number; messageId?: string | null; preview: string }>;
  } | null>(null);
  const [rewindBusy, setRewindBusy] = useState(false);
  /** Confirm rewind target + optional file restore (default off). */
  const [rewindConfirm, setRewindConfirm] = useState<{
    sessionId: string;
    targetPromptIndex: number;
    preview?: string;
  } | null>(null);
  const [rewindRestoreFiles, setRewindRestoreFiles] = useState(false);
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
  const [sessions, setSessions] = useState<SessionRow[]>([]);
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
  /** Per-session message cache so switching away mid-turn does not drop the UI. */
  const messagesBySessionRef = useRef<Map<string, ChatMessage[]>>(new Map());
  const viewingSessionIdRef = useRef<string | null>(null);
  /**
   * Bumped on every user navigation (open chat / new chat). Async work captures
   * {@link currentViewFocus} before its first await and must re-check before
   * touching view state — otherwise a slow connect started on one draft yanks
   * the workbench away from the draft the user opened since.
   */
  const viewEpochRef = useRef(0);
  const currentViewFocus = useCallback(
    (): ViewFocus => ({
      sessionId: viewingSessionIdRef.current,
      epoch: viewEpochRef.current,
    }),
    [],
  );
  const bumpViewEpoch = useCallback(() => {
    viewEpochRef.current += 1;
  }, []);
  const liveHostRef = useRef<SessionSnapshot>(IDLE_SNAPSHOT);
  const messagesRef = useRef<ChatMessage[]>([]);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  /** Avoid writing collapse prefs before settings hydrate on launch. */
  const expandedProjectsHydratedRef = useRef(false);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(true);
  /** Sidebar multi-select: archive / restore several sessions at once. */
  const [sessionSelectMode, setSessionSelectMode] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>(null);
  /** Project rules dialog (from project context menu). */
  const [projectRulesTarget, setProjectRulesTarget] = useState<{
    path: string;
    name: string;
  } | null>(null);
  const [appDialog, setAppDialog] = useState<AppDialog>(null);
  const [dialogInput, setDialogInput] = useState("");
  const dialogInputRef = useRef<HTMLInputElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  /** Latest dialog for Enter/Escape handlers (avoids stale chained confirms). */
  const appDialogRef = useRef<AppDialog>(null);
  appDialogRef.current = appDialog;
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  /** Debounced journal content hits from `sessions_search`. */
  const [contentSearchHits, setContentSearchHits] = useState<
    SessionContentHit[]
  >([]);
  const [contentSearchLoading, setContentSearchLoading] = useState(false);
  const contentSearchSeq = useRef(0);
  const [showComposerPlus, setShowComposerPlus] = useState(false);
  showComposerPlusRef.current = showComposerPlus;
  const composerPlusTriggerRef = useRef<HTMLButtonElement>(null);
  const composerPlusPanelRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLDivElement>(null);
  /** Actual input card (.composer) — command panel anchors here. */
  const composerShellRef = useRef<HTMLDivElement>(null);
  /** Floating composer shell — height drives chat bottom padding. */
  const composerWrapRef = useRef<HTMLDivElement>(null);
  const [composerFloatPad, setComposerFloatPad] = useState(168);
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

  useEffect(() => {
    if (!appDialog) return;
    if (appDialog.kind === "prompt") {
      setDialogInput(appDialog.initial);
      const t = window.setTimeout(() => {
        dialogInputRef.current?.focus();
        dialogInputRef.current?.select();
      }, 0);
      return () => window.clearTimeout(t);
    }
    // Confirm: focus primary action so keyboard users land on Confirm.
    // Enter is also handled globally below so it still confirms if focus
    // sits on Cancel / close (needed for multi-step YOLO Enter spam).
    if (appDialog.kind === "confirm") {
      const t = window.setTimeout(() => {
        confirmBtnRef.current?.focus();
      }, 0);
      return () => window.clearTimeout(t);
    }
  }, [appDialog]);

  useEffect(() => {
    if (!appDialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setAppDialog(null);
        return;
      }
      // Confirm dialogs: Enter always accepts (including chained YOLO steps).
      // Capture phase + preventDefault so we don't double-fire with a focused
      // submit button's native activation.
      if (e.key !== "Enter" && e.key !== "NumpadEnter") return;
      if (e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
      const dialog = appDialogRef.current;
      if (!dialog || dialog.kind !== "confirm") return;
      e.preventDefault();
      e.stopPropagation();
      const run = dialog.onConfirm;
      setAppDialog(null);
      void run();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [appDialog]);

  useEffect(() => {
    if (!showSearch) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowSearch(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showSearch]);

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
  useEffect(() => {
    if (!showSearch) {
      setContentSearchHits([]);
      setContentSearchLoading(false);
      return;
    }
    const q = searchQuery.trim();
    if (!q) {
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
  }, [searchQuery, showSearch]);

  // Global shortcuts: search, find-in-chat, help, doctor, copy last reply, toggle sidebar, new chat, settings, voice, Esc-stop.
  // Handlers go through refs so we don't re-bind every render.
  const shortcutHandlersRef = useRef({
    newChat: () => {},
    openSettings: () => {},
    openChatFind: () => {},
    copyLastReply: () => {},
    toggleSidebar: () => {},
    toggleVoice: () => {},
    cancelVoice: () => {},
    startLiveVoice: () => {},
    stopGeneration: () => {},
  });
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
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
      const tag = target?.tagName?.toLowerCase();
      const typing =
        tag === "input" ||
        tag === "textarea" ||
        !!target?.isContentEditable;
      // Catalog mod chords — single registry in shortcuts.ts (keep Esc / Ctrl+Space special-cased above).
      const matched = matchGlobalShortcut({
        key: e.key.toLowerCase(),
        mod: e.metaKey || e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        typing,
      });
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
        case "liveVoice":
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
  // Ask once for notification permission after first ready.
  useEffect(() => {
    if (appGate !== "ready") return;
    void ensureNotifyPermission();
  }, [appGate]);
  const [setupCliSeed, setSetupCliSeed] = useState<SetupCliInfo | null>(null);
  const [showDoctor, setShowDoctor] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
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
  /** Drop a session's stored gates (answered, cancelled, or turn ended). */
  const clearPendingGates = useCallback((sessionId?: string | null) => {
    if (!sessionId) return;
    pendingPermBySessionRef.current.delete(sessionId);
    pendingAskUserBySessionRef.current.delete(sessionId);
  }, []);
  /** Stable handle for the once-mounted event listeners. */
  const clearPendingGatesRef = useRef(clearPendingGates);
  clearPendingGatesRef.current = clearPendingGates;
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
  const [locale, setLocale] = useState<Locale>("zh");
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
  /** Files/folders attached for next send (@path to agent). */
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  /** Chat file/url card → open in right resource pane. */
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
  const [cliInfo, setCliInfo] = useState<{
    found: boolean;
    path: string | null;
    version: string | null;
    source: string;
    cliAuthPresent: boolean;
  }>({ found: false, path: null, version: null, source: "", cliAuthPresent: false });
  const [manualCliPath, setManualCliPath] = useState("");
  const [acpServerAddr, setAcpServerAddr] = useState("");
  const [proxyMode, setProxyMode] = useState("system");
  const [proxyUrl, setProxyUrl] = useState("");
  const [proxyNoProxy, setProxyNoProxy] = useState("");
  const [maxConcurrentAgents, setMaxConcurrentAgents] = useState(8);
  const [agentIdleMinutes, setAgentIdleMinutes] = useState(30);
  const [streamStallSeconds, setStreamStallSeconds] = useState(180);
  /** 0 = omit `--max-turns` (CLI default). */
  const [maxAgentTurns, setMaxAgentTurns] = useState(0);
  const [storeApiKeysInKeychain, setStoreApiKeysInKeychain] = useState(false);
  const [sandboxProfile, setSandboxProfile] = useState("off");
  /** Preferred CLI agent definition for spawn (`""` = CLI default). */
  const [preferredAgent, setPreferredAgent] = useState("");
  const [agentCatalog, setAgentCatalog] = useState<
    Array<{ name: string; source: string }>
  >([]);
  const [experimentalMemory, setExperimentalMemory] = useState(false);
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
  const [planEnabled, setPlanEnabled] = useState(true);
  const [disableWebSearch, setDisableWebSearch] = useState(false);
  const [useLeader, setUseLeader] = useState(false);
  /** Default off → launch on draft new-chat page. */
  const [reopenLastSession, setReopenLastSession] = useState(false);
  const [closeToTray, setCloseToTray] = useState(true);
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
  const [gitWorktrees, setGitWorktrees] = useState<api.GitWorktreeEntry[]>([]);
  /** null = unknown/loading; true = git work tree; false = not a git repo. */
  const [gitWorktreesAvailable, setGitWorktreesAvailable] = useState<
    boolean | null
  >(null);
  const [gitWorktreesLoading, setGitWorktreesLoading] = useState(false);
  const [gitWorktreesReason, setGitWorktreesReason] = useState<string | null>(
    null,
  );
  /** New worktree dialog (name + optional start-point). */
  const [worktreeCreateOpen, setWorktreeCreateOpen] = useState(false);
  const [worktreeCreateName, setWorktreeCreateName] = useState("");
  const [worktreeCreateRef, setWorktreeCreateRef] = useState("");
  const [worktreeCreateBusy, setWorktreeCreateBusy] = useState(false);
  const [worktreeCreateError, setWorktreeCreateError] = useState<string | null>(
    null,
  );
  /** When true, after create bind cwd and open a draft chat on that path. */
  const [worktreeCreateStartChat, setWorktreeCreateStartChat] = useState(false);
  /** Clean stale worktrees (git worktree prune) dialog. */
  const [worktreeGcOpen, setWorktreeGcOpen] = useState(false);
  const [worktreeGcForce, setWorktreeGcForce] = useState(false);
  const [worktreeGcBusy, setWorktreeGcBusy] = useState(false);
  const [worktreeGcPreviewBusy, setWorktreeGcPreviewBusy] = useState(false);
  const [worktreeGcError, setWorktreeGcError] = useState<string | null>(null);
  const [worktreeGcPreview, setWorktreeGcPreview] =
    useState<api.GitWorktreeGcResult | null>(null);
  /** Host stream-stall prompt (I06); null when dismissed or not stalled. */
  const [streamStall, setStreamStall] = useState<{
    sessionId?: string;
    stallSeconds: number;
    tier?: string;
    sawModelOutput?: boolean;
    sawToolActivity?: boolean;
  } | null>(null);
  /** Queue item currently being steered into the live turn. */
  const [guidingQueueItemId, setGuidingQueueItemId] = useState<string | null>(null);

  const [connecting, setConnecting] = useState(false);
  /** Sync gate for ensureConnected (React state alone races two rapid sends). */
  const connectingRef = useRef(false);
  /** Live provider retry progress (session://retry); cleared on success/stop/error. */
  const [retryStatus, setRetryStatus] = useState<{
    attempt: number;
    maxRetries: number;
    reason: string;
  } | null>(null);
  /** Epoch ms when the current agent turn became busy (for elapsed UI). */
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [resizingAside, setResizingAside] = useState(false);
  const [account, setAccount] = useState<api.AccountStatus | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [loginHint, setLoginHint] = useState<string | null>(null);
  const platform = useMemo(() => {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("mac")) return "mac" as const;
    if (ua.includes("win")) return "win" as const;
    return "other" as const;
  }, []);
  /** Self-drawn chrome when OS title bar is disabled (Windows release config). */
  const useCustomWindowChrome = platform === "win" || platform === "other";
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
      // Match open `.sidebar` width so aside max leaves chat ≥ 400px.
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

  const applyAsideLayoutHint = useCallback(
    (hint: AsideLayoutHint) => {
      if (phoneLayout || isWindowFitSuppressed()) return;
      const cur = layoutRef.current;
      if (cur.asideCollapsed) return;
      const opts = asideClampOpts();
      const suggested = suggestAsideWidth(
        { ...hint, windowControlsInset: opts.windowControlsInset },
        opts,
      );
      // Soft-grow only; do not auto-expand the OS window on every content hint
      // (that stacked with open-pane fit and flickered).
      const nextW = mergeAsideWidth(cur.asideWidth, suggested, opts);
      if (nextW === cur.asideWidth) return;
      setLayout((l) => {
        if (l.asideCollapsed || l.asideWidth === nextW) return l;
        const n = { ...l, asideWidth: nextW };
        saveLayout(localStorage, n);
        return n;
      });
    },
    [asideClampOpts, phoneLayout],
  );

  /** Open the right pane: open first, then one window fit + clamp. */
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
    );
    const projected = {
      sidebarCollapsed: cur.sidebarCollapsed,
      sidebarWidth: cur.sidebarWidth || SIDEBAR_DEFAULT_WIDTH,
      asideCollapsed: false as const,
      asideWidth: preferredAside,
    };
    void fitWindowThenClampAside(projected).then((width) => {
      setLayout((l) => {
        const n = {
          ...l,
          asideCollapsed: false,
          asideWidth: width,
        };
        saveLayout(localStorage, n);
        return n;
      });
    });
  }, [fitWindowThenClampAside, phoneLayout]);

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
    const projected = {
      sidebarCollapsed: false as const,
      sidebarWidth: cur.sidebarWidth || SIDEBAR_DEFAULT_WIDTH,
      asideCollapsed: cur.asideCollapsed,
      asideWidth: cur.asideCollapsed
        ? cur.asideWidth
        : Math.max(cur.asideWidth || 0, DEFAULT_LAYOUT.asideWidth),
    };
    void fitWindowThenClampAside(projected).then((width) => {
      setLayout((l) => {
        let n = { ...l, sidebarCollapsed: false };
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

  // Keep data-theme + native chrome in sync with the resolved theme.
  // When preference is "system", native must stay unlocked (null) so the
  // WebView continues to receive OS scheme changes via matchMedia.
  useEffect(() => {
    applyThemeToDocument(theme);
    void applyNativeWindowTheme(
      themePreference === "system" ? null : theme,
    );
  }, [theme, themePreference]);

  // Follow OS light/dark: re-read immediately on enter, then live-subscribe.
  useEffect(() => {
    if (themePreference !== "system") return;
    let cancelled = false;
    void (async () => {
      // Unlock native first so getSystemTheme() sees the real OS scheme.
      await applyNativeWindowTheme(null);
      if (cancelled) return;
      const sys = getSystemTheme();
      setSystemTheme(sys);
      applyThemeToDocument(sys);
    })();
    const unsub = subscribeSystemTheme((next) => {
      setSystemTheme(next);
      applyThemeToDocument(next);
      // Keep native unlocked while following system.
      void applyNativeWindowTheme(null);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [themePreference]);

  useEffect(() => {
    applySkinToDocument(skin);
  }, [skin]);

  // Cold-load persisted wallpaper from IndexedDB (blob is async-only) and
  // create the object URL for the media layer. The data-wallpaper flag is
  // already set synchronously in main.tsx so the shell is transparent now.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rec = await loadWallpaperRecord();
      if (cancelled || !rec) return;
      const url = URL.createObjectURL(rec.blob);
      wallpaperUrlRef.current = url;
      setWallpaperRecord(rec);
      setWallpaperUrl(url);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the data-wallpaper flag in sync when the user uploads / clears.
  useEffect(() => {
    applyWallpaperFlag(wallpaperUrl !== null);
  }, [wallpaperUrl]);

  // Scrim strength only dims the wallpaper overlay (::after), not chrome.
  useEffect(() => {
    applyWallpaperScrimToDocument(wallpaperScrim);
  }, [wallpaperScrim]);

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

  useEffect(() => {
    if (!useCustomWindowChrome || !api.isTauri()) return;
    let unlisten: (() => void) | undefined;
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
        unlisten = await w.onResized(() => {
          void sync();
        });
        if (cancelled) unlisten?.();
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [useCustomWindowChrome]);

  // Apply always-on-top from localStorage on boot (and whenever state is set).
  useEffect(() => {
    void applyWindowAlwaysOnTop(windowAlwaysOnTop);
  }, [windowAlwaysOnTop]);

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
          (
            s as Array<SessionRow & { archived?: boolean; scheduled?: boolean }>
          ).map((x) => ({
            id: x.id,
            title: x.title,
            projectId: normalizeProjectId(x.projectId),
            updatedAt: x.updatedAt,
            archived: !!x.archived,
            scheduled: !!x.scheduled,
          })),
        );
        void api
          .generalWorkspacePath()
          .then((path) => setGeneralWorkspacePath(path || null))
          .catch(() => {});
        if (settings) {
          setLocale(resolveLocale(settings.locale));
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
      const [p, s, settings, cli, modelsRes] = await Promise.all([
        api.projectsList(),
        api.sessionsList(),
        api.settingsGet(),
        api.probeCli(),
        api.modelsListAvailable().catch(() => null),
      ]);
      setProjects(mapProjectsList(p as Project[]));
      setSessions(
        (
          s as Array<
            SessionRow & {
              archived?: boolean;
              pinned?: boolean;
              scheduled?: boolean;
            }
          >
        ).map((x) => ({
          id: x.id,
          title: x.title,
          projectId: normalizeProjectId(x.projectId),
          updatedAt: x.updatedAt,
          archived: !!x.archived,
          pinned: !!x.pinned,
          scheduled: !!x.scheduled,
        })),
      );
      void api
        .generalWorkspacePath()
        .then((path) => setGeneralWorkspacePath(path || null))
        .catch(() => {});
      void api.trayRefresh();
      setLocale(resolveLocale(settings.locale));
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
      if (cli.versionSupported === false) {
        setLocalError(
          `CLI_TOO_OLD: grok CLI ${cli.version ?? "?"} < required ${
            cli.minVersion ?? ""
          }`.trim(),
        );
      }
      setSessionDataMode(settings.sessionDataMode || "independent");
      setDefaultOpenTarget(
        (settings as { defaultOpenTarget?: string }).defaultOpenTarget ||
          "finder",
      );
      setManualCliPath(settings.manualCliPath || cli.path || "");
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
        const raw = settings.maxAgentTurns;
        setMaxAgentTurns(
          typeof raw === "number" && raw > 0
            ? Math.min(200, Math.round(raw))
            : 0,
        );
      }
      setStoreApiKeysInKeychain(!!settings.storeApiKeysInKeychain);
      {
        const sb = (settings.sandboxProfile || "off").trim().toLowerCase();
        const known = ["off", "workspace", "read-only", "strict", "devbox"];
        setSandboxProfile(known.includes(sb) ? sb : "off");
      }
      setPreferredAgent((settings.preferredAgent || "").trim());
      setExperimentalMemory(!!settings.experimentalMemory);
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
      setPlanEnabled(settings.planEnabled !== false);
      setDisableWebSearch(!!settings.disableWebSearch);
      setUseLeader(!!settings.useLeader);
      // Opt-in only (missing key / false → draft new chat on launch).
      setReopenLastSession(settings.reopenLastSession === true);
      setCloseToTray(settings.closeToTray !== false);
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
      setCliInfo({
        found: cli.found,
        path: cli.path,
        version: cli.version,
        source: cli.source || "",
        cliAuthPresent: !!cli.cliAuthPresent,
      });
      const masked = await api.secretsGetMasked();
      const authOk =
        !!cli.cliAuthPresent ||
        masked.hasOfficialKey ||
        masked.hasRelayKey;
      setSetup({
        cli: cli.found,
        auth: authOk,
        project: p.some((x) => (x as Project).trusted) || p.length > 0,
      });

      // ── Setup gate: CLI is hard-required; account may be deferred ──
      const cliSeed: SetupCliInfo = {
        found: cli.found,
        path: cli.path,
        version: cli.version,
        source: cli.source || "",
        cliAuthPresent: !!cli.cliAuthPresent,
      };
      setSetupCliSeed(cliSeed);

      const wizardCompleted = !!settings.setupWizardCompleted;
      const legacyDone =
        !!settings.onboardingDone || !!settings.setupSkipped;

      if (cli.found && !wizardCompleted && legacyDone) {
        // Migrate older installs that already finished the account modal.
        try {
          await api.settingsSet({
            ...settings,
            setupWizardCompleted: true,
            authSetupDeferred: !!settings.setupSkipped && !authOk,
          });
        } catch {
          /* ignore */
        }
        setAppGate("ready");
      } else if (!cli.found || !wizardCompleted) {
        // No CLI → always wizard. First launch with CLI → account step.
        setAppGate("setup");
      } else {
        setAppGate("ready");
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
    } catch (e) {
      setLocalError(String(e));
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

  // Bootstrap lists once
  useEffect(() => {
    void refreshLists();
  }, [refreshLists]);

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

  // Prompt history is per viewed session — leave browse mode on switch / new chat.
  useEffect(() => {
    promptHistoryIndexRef.current = null;
    setPromptHistoryIndex(null);
    setPromptHistoryOpen(false);
    setPromptHistoryFilter("");
    setPromptHistoryActive(0);
    setPromptHistoryFocusFilter(false);
  }, [session.sessionId]);

  useEffect(() => {
    liveHostRef.current = liveHost;
  }, [liveHost]);

  // Mirror viewed-session messages into the cache on every change.
  useEffect(() => {
    messagesRef.current = messages;
    const id = session.sessionId;
    if (!id) return;
    messagesBySessionRef.current.set(id, messages);
  }, [messages, session.sessionId]);

  /** Apply a message reducer to the viewed session or only to the cache. */
  const patchSessionMessages = useCallback(
    (
      targetSessionId: string | undefined | null,
      reduce: (prev: ChatMessage[]) => ChatMessage[],
    ) => {
      if (!targetSessionId) return;
      if (viewingSessionIdRef.current === targetSessionId) {
        setMessages((prev) => {
          const next = reduce(prev);
          messagesBySessionRef.current.set(targetSessionId, next);
          return next;
        });
      } else {
        const prev = messagesBySessionRef.current.get(targetSessionId) ?? [];
        messagesBySessionRef.current.set(targetSessionId, reduce(prev));
      }
    },
    [],
  );

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
        const created = await api.automationCreate(input);
        automationSetupSessionsRef.current.delete(sessionId);
        setToast(
          tr("automations.createdToast", {
            title: created.title || input.title,
          }),
        );
        window.setTimeout(() => setToast(null), 4200);
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

  // Cold start once: if panes restored open and chat would be crushed, grow once.
  // Pane open/close is handled by openSidebarPane / openAsidePane only — do not
  // re-fit on every collapse toggle (that stacked with open handlers and flickered).
  useEffect(() => {
    if (phoneLayout || !api.isDesktopHost()) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (cancelled) return;
      const l = layoutRef.current;
      void fitWindowThenClampAside({
        sidebarCollapsed: l.sidebarCollapsed,
        sidebarWidth: l.sidebarWidth || SIDEBAR_DEFAULT_WIDTH,
        asideCollapsed: l.asideCollapsed,
        asideWidth: l.asideWidth,
      }).then((width) => {
        if (cancelled || l.asideCollapsed) return;
        setLayout((prev) => {
          if (prev.asideCollapsed || prev.asideWidth === width) return prev;
          const n = { ...prev, asideWidth: width };
          saveLayout(localStorage, n);
          return n;
        });
      });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only cold fit
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

  // Event listeners: StrictMode-safe (cleanup cancels pending + live unsubs)
  // Mirror clients subscribe via WebSocket (same payload shapes as desktop).
  useEffect(() => {
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
        const snap = await api.sessionGetState();
        if (!cancelled) {
          setLiveHost(snap);
          liveHostRef.current = snap;
          // Only bind the viewed session when Host already has a live row.
          if (snap.sessionId) {
            setSession((prev) => ({
              ...snap,
              state: reconcileSessionState(snap.state, prev.state),
            }));
            viewingSessionIdRef.current = snap.sessionId;
            setLiveMap((prev) =>
              projectHostIntoLiveMap(prev, {
                sessionId: snap.sessionId,
                state: snap.state,
                streamingMessageId: snap.streamingMessageId,
              }),
            );
          }
        }

        await track(
          api.listen<SessionSnapshot>("session://state", (s) => {
            if (cancelled) return;
            // Host focus slot (the process under the live cursor). Multi-session
            // busy demotions also emit session://runtime so liveMap stays honest.
            setLiveHost(s);
            liveHostRef.current = s;
            setLiveMap((prev) =>
              projectHostIntoLiveMap(prev, {
                sessionId: s.sessionId,
                state: s.state,
                streamingMessageId: s.streamingMessageId,
              }),
            );
            if (
              s.state !== "streaming" &&
              s.state !== "awaiting_permission" &&
              stopLatchRef.current.phase !== "idle"
            ) {
              const cleared = createStopLatchState();
              stopLatchRef.current = cleared;
              setStopLatch(cleared);
            }
            // Only update the workbench session when the user is viewing it.
            // Otherwise switching sessions would yank selection back to the live agent.
            if (
              s.sessionId &&
              s.sessionId === viewingSessionIdRef.current
            ) {
              setSession((prev) => ({
                ...s,
                state: reconcileSessionState(s.state, prev.state),
              }));
              // Clear retry chip / turn timer / stall banner when turn ends or errors out
              if (s.state !== "streaming" && s.state !== "awaiting_permission") {
                setRetryStatus(null);
                setStreamStall(null);
                setTurnStartedAt(null);
                // Ensure no assistant is left with streaming=true after the turn
                // (missed done chunk) — otherwise the next send can bind to it.
                setMessages((prev) => {
                  if (!prev.some((m) => m.streaming)) return prev;
                  const next = prev.map((m) =>
                    m.streaming ? { ...m, streaming: false } : m,
                  );
                  if (s.sessionId) {
                    messagesBySessionRef.current.set(s.sessionId, next);
                  }
                  return next;
                });
                if (
                  s.state === "ready" &&
                  shouldShowDesktopNotify(
                    "turn_done",
                    notifyPrefsRef.current,
                  )
                ) {
                  const turnSid = s.sessionId || null;
                  showDesktopNotification({
                    title: trRef.current("notify.turnDoneTitle"),
                    body: trRef.current("notify.turnDoneBody"),
                    tag: `turn-done-${turnSid || "x"}`,
                    sessionId: turnSid,
                  });
                }
              } else if (
                (s.state === "streaming" || s.state === "awaiting_permission") &&
                s.sessionId === viewingSessionIdRef.current
              ) {
                setTurnStartedAt((prev) => prev ?? Date.now());
              }
              // After a turn, resolve `images/N.jpg` short paths into image cards
              if (s.state === "ready") {
                const sid = s.sessionId;
                setMessages((prev) => {
                  const rels = collectSessionRelativeMediaRefs(prev);
                  if (!rels.length) return prev;
                  void api
                    .sessionResolveRelativeMedia(sid, rels)
                    .then((list) => {
                      if (
                        cancelled ||
                        !list.length ||
                        viewingSessionIdRef.current !== sid
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
                      setMessages((cur) =>
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
              if (viewingSessionIdRef.current === s.sessionId) {
                setRetryStatus(null);
              }
              // Backup apply path if stream `done` chunk was missed.
              if (s.sessionId) {
                void tryApplyAutomationFromSession(s.sessionId);
              }
            }
          }),
        );
        // Background / parked multi-session runtime (does not steal liveHost focus).
        await track(
          api.listen<SessionSnapshot>("session://runtime", (s) => {
            if (cancelled || !s.sessionId) return;
            setLiveMap((prev) =>
              projectHostIntoLiveMap(prev, {
                sessionId: s.sessionId,
                state: s.state,
                streamingMessageId: s.streamingMessageId,
              }),
            );
            // If user is viewing this demoted session, keep workbench state in sync.
            if (s.sessionId === viewingSessionIdRef.current) {
              setSession((prev) => ({
                ...prev,
                sessionId: s.sessionId,
                state: reconcileSessionState(s.state, prev.state),
                streamingMessageId: s.streamingMessageId,
                lastError: s.lastError ?? prev.lastError,
                title: s.title || prev.title,
              }));
              if (
                s.state !== "streaming" &&
                s.state !== "awaiting_permission"
              ) {
                setMessages((prev) => {
                  if (!prev.some((m) => m.streaming)) return prev;
                  const next = prev.map((m) =>
                    m.streaming ? { ...m, streaming: false } : m,
                  );
                  messagesBySessionRef.current.set(s.sessionId!, next);
                  return next;
                });
              }
            }
          }),
        );
        // Batch high-frequency stream tokens before React setState (long turns).
        const applyStreamToUi = (chunk: StreamPayload) => {
          if (cancelled) return;
          // Ignore empty terminal ticks that only flip done
          if (!chunk.text && !chunk.done) return;
          // Anti-replay: only drop when the *same* focused host session is idle.
          // Multi-session: background turns keep streaming after switch — never
          // gate on liveHost.state alone (that monopolizes the focused chat).
          const host = liveHostRef.current;
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
            chunk.sessionId === viewingSessionIdRef.current
          ) {
            setRetryStatus(null);
            // Progress clears stall banner (I06).
            setStreamStall(null);
          }
          // Multi-session busy projection for in-progress streams only.
          // Never re-promote a turn already settled to ready/idle (late/coalesced
          // tokens after host ready — issue #225 stuck sidebar spinner).
          if (chunk.sessionId && !chunk.done) {
            setLiveMap((prev) => {
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
            setLiveMap((prev) =>
              projectHostIntoLiveMap(prev, {
                sessionId: chunk.sessionId!,
                state: "ready",
                streamingMessageId: null,
              }),
            );
          }
          patchSessionMessages(chunk.sessionId, (prev) => {
            const next = applyStreamChunk(prev, chunk);
            // Keep cache in sync immediately so post-turn apply sees final text.
            if (chunk.sessionId) {
              messagesBySessionRef.current.set(chunk.sessionId, next);
            }
            return next;
          });
          if (chunk.sessionId && chunk.text) {
            setLiveMap((prev) =>
              markSawModelOutput(prev, chunk.sessionId!),
            );
          }
          // After a completed assistant stream, try silent automation create.
          if (chunk.done && chunk.sessionId) {
            void tryApplyAutomationFromSession(chunk.sessionId);
          }
        };
        const streamCoalescer = new StreamCoalescer({
          flushMs: 48,
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
        cleanups.push(() => streamCoalescer.dispose());
        await track(
          api.listen<StreamPayload>("session://stream", (chunk) => {
            if (cancelled) return;
            streamCoalescer.push(chunk);
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
              patchSessionMessages(payload.sessionId, (prev) =>
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
              patchSessionMessages(p.sessionId, (prev) =>
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
            patchSessionMessages(sid, (prev) => applyContextCompact(prev, p));
            if (sid === viewingSessionIdRef.current) {
              setContextUsage((prev) =>
                reduceContextUsage(prev, {
                  type: "compact",
                  trigger: p.trigger,
                  tokensBefore: p.tokensBefore,
                  tokensAfter: p.tokensAfter,
                  summaryPreview: p.summaryPreview,
                  note: p.note,
                  messageId: p.messageId,
                }),
              );
              const auto = (p.trigger || "auto").toLowerCase() !== "manual";
              setToast(
                auto
                  ? tr("compact.toastAuto")
                  : tr("compact.toastManual"),
              );
              window.setTimeout(() => setToast(null), 3200);
            }
          }),
        );
        await track(
          api.listen<{
            sessionId?: string;
            totalTokens?: number;
            inputTokens?: number;
            outputTokens?: number;
            source?: string;
          }>("session://usage", (p) => {
            if (cancelled || !p) return;
            const sid = p.sessionId;
            if (!sid || sid !== viewingSessionIdRef.current) return;
            setContextUsage((prev) =>
              reduceContextUsage(prev, {
                type: "usage",
                totalTokens: p.totalTokens,
                inputTokens: p.inputTokens,
                outputTokens: p.outputTokens,
                source: p.source,
              }),
            );
          }),
        );
        await track(
          api.listen<{
            sessionId?: string;
            toolCallId?: string;
            title?: string;
            kind?: string;
            status?: string;
            path?: string | null;
            detail?: string | null;
            before?: string | null;
            after?: string | null;
          }>("session://tool", (p) => {
            if (cancelled || !p?.toolCallId) return;
            const sid = p.sessionId || viewingSessionIdRef.current;
            if (!sid) return;
            patchSessionMessages(sid, (prev) => {
              const next = applyToolEvent(prev, p);
              setLiveMap((lm) => {
                let m = projectLiveToolFromMessages(lm, sid, next);
                m = markSawToolActivity(m, sid);
                return m;
              });
              return next;
            });
            // Track write/edit tools for the session Changes panel.
            setSessionChangesById((prev) => {
              const list = prev[sid] ?? [];
              const next = mergeSessionChange(list, {
                toolCallId: p.toolCallId,
                title: p.title,
                kind: p.kind,
                status: p.status,
                path: p.path,
                detail: p.detail,
                before: p.before,
                after: p.after,
              });
              if (next === list) return prev;
              return { ...prev, [sid]: next };
            });
            if (sid === viewingSessionIdRef.current) {
              setTurnStartedAt((t) => t ?? Date.now());
              // Tool activity counts as progress — clear stall banner (I06).
              setStreamStall(null);
            }
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
            patchSessionMessages(sid, (prev) => applyTurnMarker(prev, p));
            // Turn is over — any gate it raised can no longer be answered.
            clearPendingGatesRef.current(sid);
            if (sid === viewingSessionIdRef.current) {
              setTurnStartedAt(null);
              setStreamStall(null);
              if (p.marker === "turn_cancelled") {
                setToast(tr("activity.cancelledToast"));
                window.setTimeout(() => setToast(null), 2800);
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
                setLiveMap((prev) =>
                  settleStoppedSessionInLiveMap(prev, p.sessionId!),
                );
              }
              if (p.reason === "capacity") {
                // Housekeeping, NOT a failure: Host reclaimed an *idle parked*
                // chat so this spawn could proceed. Reporting it as "process
                // limit reached" made a successful connect look broken, and
                // claimed every slot was running a task when none was.
                setToast(tr("agent.capacityRecycledToast"));
                window.setTimeout(() => setToast(null), 4200);
                return;
              }
              // Toast when the focused (or unknown) session was idle-recycled.
              if (
                !p.sessionId ||
                p.sessionId === viewingSessionIdRef.current
              ) {
                setToast(tr("agent.idleRecycledToast"));
                window.setTimeout(() => setToast(null), 4200);
              }
            },
          ),
        );
        await track(
          api.listen<{ reason?: string; killed?: number }>(
            "session://agents_recycled",
            (p) => {
              if (cancelled || !p) return;
              // session_data_mode flip (and any future full recycle).
              if (
                p.reason === "session_data_mode" ||
                (p.killed != null && p.killed > 0)
              ) {
                setToast(tr("agent.dataModeRecycledToast"));
                window.setTimeout(() => setToast(null), 4800);
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
              setToast(tr("agent.softRespawnToast"));
              window.setTimeout(() => setToast(null), 3600);
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
              setLiveMap((prev) =>
                settleStoppedSessionInLiveMap(prev, p.sessionId!),
              );
              if (p.sessionId === viewingSessionIdRef.current) {
                setSession((prev) =>
                  settleStoppedSessionSnapshot(prev, p.sessionId!),
                );
                setLiveHost((prev) => {
                  const next = settleStoppedSessionSnapshot(prev, p.sessionId!);
                  liveHostRef.current = next;
                  return next;
                });
                setMessages((prev) => {
                  if (!prev.some((m) => m.streaming)) return prev;
                  const next = prev.map((m) =>
                    m.streaming ? { ...m, streaming: false } : m,
                  );
                  messagesBySessionRef.current.set(p.sessionId!, next);
                  return next;
                });
              }
            }
            if (
              p.sessionId &&
              p.sessionId !== viewingSessionIdRef.current
            ) {
              return;
            }
            setToast(tr("session.emptyRunToast"));
            window.setTimeout(() => setToast(null), 7200);
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
            setToast(tr("agent.processLimitToast"));
            window.setTimeout(() => setToast(null), 5200);
            if (
              !p.sessionId ||
              p.sessionId === viewingSessionIdRef.current
            ) {
              setLocalError(
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
              p.sessionId !== viewingSessionIdRef.current
            ) {
              return;
            }
            const secs =
              typeof p.stallSeconds === "number" && p.stallSeconds > 0
                ? Math.round(p.stallSeconds)
                : streamStallSeconds;
            // Merge journal evidence so we never show pre-token after a full answer.
            const sid = p.sessionId || viewingSessionIdRef.current || "";
            if (sid) {
              setLiveMap((prev) => {
                const msgs = messagesBySessionRef.current.get(sid) ?? [];
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
            setStreamStall({
              sessionId: p.sessionId,
              stallSeconds: secs,
              tier: p.tier,
              sawModelOutput: p.sawModelOutput,
              sawToolActivity: p.sawToolActivity,
            });
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
            setLiveMap((prev) => markSawToolActivity(prev, sid));
            if (sid === viewingSessionIdRef.current) {
              setStreamStall(null);
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
            setStreamStall(null);
            // Host force-ended the turn (runtime Ready already emitted). Settle
            // client projection so the sidebar cannot stay spinning if a late
            // stream token races after this event (issue #225).
            if (p.sessionId) {
              setLiveMap((prev) =>
                settleStoppedSessionInLiveMap(prev, p.sessionId!),
              );
              if (p.sessionId === viewingSessionIdRef.current) {
                setSession((prev) =>
                  settleStoppedSessionSnapshot(prev, p.sessionId!),
                );
                setLiveHost((prev) => {
                  const next = settleStoppedSessionSnapshot(prev, p.sessionId!);
                  liveHostRef.current = next;
                  return next;
                });
                setMessages((prev) => {
                  if (!prev.some((m) => m.streaming)) return prev;
                  return prev.map((m) =>
                    m.streaming ? { ...m, streaming: false } : m,
                  );
                });
              }
            }
            if (
              !p.sessionId ||
              p.sessionId === viewingSessionIdRef.current
            ) {
              setToast(tr("agent.streamStallHardEndToast"));
              window.setTimeout(() => setToast(null), 4200);
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
              p.sessionId !== viewingSessionIdRef.current
            ) {
              return;
            }
            if (
              liveHostRef.current.sessionId &&
              liveHostRef.current.sessionId !== viewingSessionIdRef.current
            ) {
              return;
            }
            const attempt = p.attempt ?? 0;
            const maxRetries = p.maxRetries ?? 12;
            const reason = (p.reason || "").trim();
            setRetryStatus({ attempt, maxRetries, reason });
          }),
        );
        await track(
          api.listen<TurnErrorPayload>("session://turn_error", (p) => {
            if (cancelled) return;
            clearPendingGatesRef.current(p.sessionId);
            if (p.sessionId === viewingSessionIdRef.current) {
              setRetryStatus(null);
            }
            patchSessionMessages(p.sessionId, (prev) =>
              applyTurnError(prev, p, localeRef.current),
            );
          }),
        );
        await track(
          api.listen<PermissionPayload>("session://permission", (p) => {
            if (cancelled) return;
            // Park it against its session so returning to that chat can answer.
            if (p.sessionId) {
              pendingPermBySessionRef.current.set(p.sessionId, p);
            }
            // Only surface the bar when viewing the session that needs it.
            if (
              p.sessionId &&
              p.sessionId !== viewingSessionIdRef.current
            ) {
              // Multi-session stream: another chat needs approval — nudge user.
              setToast(trRef.current("session.backgroundPermission"));
              window.setTimeout(() => setToast(null), 4200);
              if (
                shouldShowDesktopNotify(
                  "permission",
                  notifyPrefsRef.current,
                )
              ) {
                showDesktopNotification({
                  title: trRef.current("notify.permissionTitle"),
                  body: trRef.current("session.backgroundPermission"),
                  tag: `perm-bg-${p.sessionId || p.rpcId}`,
                  force: true,
                  sessionId: p.sessionId ?? null,
                });
              }
              return;
            }
            setPerm(p);
            if (
              shouldShowDesktopNotify("permission", notifyPrefsRef.current)
            ) {
              showDesktopNotification({
                title: trRef.current("notify.permissionTitle"),
                body: trRef.current("notify.permissionBody"),
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
              pendingAskUserBySessionRef.current.set(p.sessionId, p);
            }
            if (
              p.sessionId &&
              p.sessionId !== viewingSessionIdRef.current
            ) {
              // Background chat asked a question — answer it on reopen.
              setToast(trRef.current("session.backgroundPermission"));
              window.setTimeout(() => setToast(null), 4200);
              if (
                shouldShowDesktopNotify("ask_user", notifyPrefsRef.current)
              ) {
                showDesktopNotification({
                  title: trRef.current("notify.askUserTitle"),
                  body: trRef.current("notify.askUserBody"),
                  tag: `ask-bg-${p.sessionId || p.rpcId}`,
                  force: true,
                  sessionId: p.sessionId ?? null,
                });
              }
              return;
            }
            setAskUser(p);
            // Agent is blocked on an answer — same as permission bar.
            if (
              shouldShowDesktopNotify("ask_user", notifyPrefsRef.current)
            ) {
              showDesktopNotification({
                title: trRef.current("notify.askUserTitle"),
                body: trRef.current("notify.askUserBody"),
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
            const readyTitle = trRef.current("plan.ready");
            const composerMode = modeRef.current;
            const targetSid =
              (p.sessionId && p.sessionId.trim()) ||
              viewingSessionIdRef.current ||
              null;

            // Background session: keep plan cache warm without stealing the bar.
            if (
              p.sessionId &&
              p.sessionId !== viewingSessionIdRef.current
            ) {
              const prev =
                planBySessionRef.current.get(p.sessionId) ??
                emptySessionPlan(readyTitle);
              const next = mergePlanFromEvent(
                prev,
                p,
                readyTitle,
                composerMode,
              );
              planBySessionRef.current.set(p.sessionId, next);
              return;
            }

            setPlan((prev) => {
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
                // openAsidePane grows the window first, then clamps aside.
                queueMicrotask(() => {
                  planOpenedAsideRef.current = true;
                  openAsidePaneRef.current();
                  setPlanFocusKey((k) => k + 1);
                });
              }
              if (targetSid) {
                planBySessionRef.current.set(targetSid, next);
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
              setSessions((list) =>
                list.map((s) =>
                  s.id === p.sessionId ? { ...s, title: p.title! } : s,
                ),
              );
              setSession((prev) =>
                prev.sessionId === p.sessionId
                  ? { ...prev, title: p.title! }
                  : prev,
              );
              setLiveHost((prev) =>
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
                  setSessions(
                    list.map((s) => ({
                      id: s.id,
                      title: s.title,
                      projectId: normalizeProjectId(s.projectId),
                      updatedAt: s.updatedAt,
                      archived: !!s.archived,
                      pinned: !!s.pinned,
                      scheduled: !!s.scheduled,
                    })),
                  );
                  const sid = p?.sessionId;
                  if (
                    !sid ||
                    viewingSessionIdRef.current !== sid ||
                    openingSessionIdRef.current
                  ) {
                    return;
                  }
                  // Drop cache so preferSessionMessages cannot hide disk IM turns.
                  messagesBySessionRef.current.delete(sid);
                  const stored = await api.sessionMessages(sid);
                  if (cancelled || viewingSessionIdRef.current !== sid) return;
                  const mapped: ChatMessage[] = stored.map((m) => {
                    const parsed = parseAttachmentsFromContent(m.content);
                    const rawContent =
                      parsed.text ||
                      (parsed.attachments.length ? "" : m.content);
                    const content =
                      m.role === "user"
                        ? hydrateDisplayContent(rawContent)
                        : rawContent;
                    return {
                      id: m.id,
                      role: m.role as "user" | "assistant" | "tool",
                      content,
                      thought: m.thought ?? undefined,
                      isError: m.isError || undefined,
                      createdAt: m.createdAt || undefined,
                      streaming: false,
                    };
                  });
                  messagesBySessionRef.current.set(sid, mapped);
                  setMessages(mapped);
                } catch {
                  /* ignore */
                }
              })();
            },
          ),
        );
      } catch (e) {
        if (!cancelled) setLocalError(String(e));
      }
    })();

    return () => {
      cancelled = true;
      cleanups.forEach((u) => u());
    };
  }, [patchSessionMessages, tryApplyAutomationFromSession]);

  const toggleThemeBtn = () => {
    const nextPref = toggleThemePreference(themePreference, theme);
    saveThemePreference(localStorage, nextPref);
    setThemePreference(nextPref);
    void applyThemePreference(nextPref, {
      onResolved: (_resolved, system) => {
        setSystemTheme(system);
      },
    });
  };

  const applyThemeChoice = (next: ThemePreference) => {
    saveThemePreference(localStorage, next);
    setThemePreference(next);
    // System: unlock native → re-read OS → set data-theme immediately.
    // Light/dark: lock native + CSS to that value.
    void applyThemePreference(next, {
      onResolved: (resolved, system) => {
        // Always refresh systemTheme so resolveTheme("system", …) is current.
        setSystemTheme(next === "system" ? resolved : system);
      },
    });
  };

  const applySkinChoice = (next: ThemeSkinId) => {
    saveSkin(localStorage, next);
    applySkinToDocument(next);
    setSkin(next);
    const preferred = skinPreferredTheme(next);
    if (preferred && preferred !== theme) {
      applyThemeChoice(preferred);
    }
  };

  const applyWallpaperChoice = async (record: WallpaperRecord | null) => {
    if (!record) {
      try {
        await clearWallpaper();
      } catch (e) {
        showToast(String(e), 4000);
        return;
      }
      if (wallpaperUrlRef.current) {
        URL.revokeObjectURL(wallpaperUrlRef.current);
        wallpaperUrlRef.current = null;
      }
      setWallpaperRecord(null);
      setWallpaperUrl(null);
      return;
    }
    // New upload resets focus to cover-center unless the record already has one.
    const toSave: WallpaperRecord = {
      ...record,
      focus: record.focus ?? undefined,
    };
    try {
      await saveWallpaper(toSave);
    } catch (e) {
      showToast(String(e), 4000);
      return;
    }
    const url = URL.createObjectURL(toSave.blob);
    if (wallpaperUrlRef.current) URL.revokeObjectURL(wallpaperUrlRef.current);
    wallpaperUrlRef.current = url;
    setWallpaperRecord(toSave);
    setWallpaperUrl(url);
  };

  const applyWallpaperAdjustChoice = (patch: {
    focus: WallpaperFocus;
    clip: WallpaperClip | null;
    duration?: number;
  }) => {
    const meta = saveWallpaperAdjust({
      focus: patch.focus,
      clip: patch.clip,
      duration: patch.duration,
    });
    if (!meta) return;
    setWallpaperRecord((prev) => {
      if (!prev) return prev;
      const next: WallpaperRecord = {
        ...prev,
        focus: meta.focus,
        clip: meta.clip,
      };
      if (!meta.focus) delete next.focus;
      if (!meta.clip) delete next.clip;
      return next;
    });
  };

  /** Backfill width/height for wallpapers uploaded before size meta existed. */
  const applyWallpaperMediaSize = useCallback(
    (size: { w: number; h: number }) => {
      const meta = saveWallpaperMediaSize(size.w, size.h);
      if (!meta) return;
      setWallpaperRecord((prev) => {
        if (!prev) return prev;
        if (prev.width === meta.width && prev.height === meta.height) return prev;
        return {
          ...prev,
          width: meta.width,
          height: meta.height,
        };
      });
    },
    [],
  );

  const applyWallpaperScrimChoice = (value: number) => {
    saveWallpaperScrim(localStorage, value);
    applyWallpaperScrimToDocument(value);
    setWallpaperScrim(value);
  };

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

  // Hash route: #/settings[/section[/tab]] | #/automations | #/workbench
  // Explicit #/settings/{section}… deep links always win; bare #/settings uses last.
  useEffect(() => {
    const syncFromHash = () => {
      const raw = (window.location.hash || "").replace(/^#\/?/, "");
      if (raw.startsWith("settings")) {
        const parts = raw.split("/").filter(Boolean);
        // parts[0] === "settings"; parts[1] may be section
        const sectionPart = parts[1];
        const hasExplicitSection = isSettingsSectionId(sectionPart);
        if (hasExplicitSection) {
          const loc = parseSettingsHash(raw);
          if (loc) {
            setSettingsSection(loc.section);
            setSettingsTab(loc.tab ?? null);
            saveSettingsLastRoute(loc);
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
    if (viewingSessionIdRef.current == null) {
      saveComposerProjectDraft(projectDraftKey(activeProject?.id ?? null), {
        text: draft,
        attachments,
        goalMode,
      });
    }

    // User navigation: invalidate any in-flight work that wants the workbench.
    bumpViewEpoch();
    // Snapshot the outgoing thread so a mid-turn switch does not lose the user bubble.
    const leavingId = viewingSessionIdRef.current;
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
    // Swap plan chrome to this session (or hide if none / not yet streamed).
    setPlan(
      planBySessionRef.current.get(s.id) ??
        emptySessionPlan(trRef.current("plan.ready")),
    );
    setEditingUserMessageId(null);
    setEditAttachments([]);

    try {
      const stored = await api.sessionMessages(s.id);
      let mapped: ChatMessage[] = stored.map((m) => {
        const parsed = parseAttachmentsFromContent(m.content);
        const storedAtts: Attachment[] = (m.attachments ?? []).map((a) => ({
          path: a.path,
          name: a.name || a.path.split(/[/\\]/).pop() || a.path,
          isDir: !!a.isDir,
        }));
        // @path lines (user) + persisted image_gen cards + absolute paths in text
        const attachments = mergeMessageAttachments(
          mergeAttachments(parsed.attachments, storedAtts),
          m.content,
        );
        const rawContent =
          parsed.text || (parsed.attachments.length ? "" : m.content);
        // User turns: restore [[skill:]] chips from agent-form `/name` history.
        const content =
          m.role === "user" ? hydrateDisplayContent(rawContent) : rawContent;
        const rawMarker = (m as { marker?: string }).marker || undefined;
        const marker =
          rawMarker ||
          (m.role === "tool" && content.startsWith("context_compact")
            ? "context_compact"
            : m.role === "tool" && content.startsWith("tool_step|")
              ? "tool_step"
              : m.role === "tool" && content.startsWith("turn_cancelled")
                ? "turn_cancelled"
                : undefined);
        const compactMeta =
          marker === "context_compact"
            ? parseCompactContent(content) || undefined
            : undefined;
        const toolParsed =
          marker === "tool_step" ? parseToolStepContent(content) : null;
        const role = m.role as "user" | "assistant" | "tool";
        let displayContent = toolParsed?.title || content;
        // Never show silent automation fence to the user on reload.
        if (role === "assistant" && displayContent) {
          displayContent = extractAutomationPayload(displayContent).cleanText;
        }
        const thoughtPhases = splitThoughtPhases(m.thought);
        return {
          id: m.id,
          role,
          content: displayContent,
          thought: m.thought ?? undefined,
          thoughtPhases,
          // Reconstruct interleaved timeline for reload (first phase → body → rest).
          segments:
            role === "assistant"
              ? buildSegmentsFromLegacy(
                  displayContent,
                  m.thought,
                  thoughtPhases,
                )
              : undefined,
          isError: m.isError || undefined,
          attachments,
          createdAt: m.createdAt || undefined,
          marker,
          compactMeta: compactMeta ?? undefined,
          toolCallId: m.id.startsWith("tool-") ? m.id.slice(5) : undefined,
          toolKind: toolParsed?.kind,
          toolStatus: toolParsed?.status,
          toolDetail: toolParsed?.detail,
          toolPath: toolParsed?.path,
          streaming: false,
        };
      });
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
      const chosen = weaveToolsIntoAssistantSegments(
        preferSessionMessages(
          messagesBySessionRef.current.get(s.id),
          mapped,
        ),
      );
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
      setContextUsage(
        reduceContextUsage(INITIAL_CONTEXT_USAGE, {
          type: "hydrate",
          messages: stripped,
        }),
      );
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
      // Refine isDir via classify when possible
      const allPaths = chosen.flatMap((m) => m.attachments?.map((a) => a.path) ?? []);
      if (allPaths.length && api.isTauri()) {
        void api.pathsClassify(allPaths).then((list) => {
          if (viewingSessionIdRef.current !== s.id) return;
          const byPath = new Map(list.map((c) => [c.path, c]));
          setMessages((prev) =>
            prev.map((msg) => {
              if (!msg.attachments?.length) return msg;
              return {
                ...msg,
                attachments: msg.attachments.map((a) => {
                  const c = byPath.get(a.path);
                  return c
                    ? { path: c.path, name: c.name, isDir: c.isDir }
                    : a;
                }),
              };
            }),
          );
        });
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
      setContextUsage(
        reduceContextUsage(INITIAL_CONTEXT_USAGE, {
          type: "hydrate",
          messages: cached ?? [],
        }),
      );
    }
    if (viewingSessionIdRef.current !== s.id) {
      if (openingSessionIdRef.current === s.id) {
        openingSessionIdRef.current = null;
      }
      return;
    }
    // Orphan sessions clear project context; project sessions select their folder.
    setActiveProject(proj);
    // Existing session: clear composer UI (project buffer already saved above).
    // Follow-ups start empty; new-chat buffers stay in per-project storage.
    suppressProjectDraftPersistRef.current = true;
    setDraft("");
    setAttachments([]);
    requestAnimationFrame(() => {
      suppressProjectDraftPersistRef.current = false;
    });
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

    if (api.isTauri()) {
      setLastSessionId(s.id);
      void api
        .settingsRememberLastSession(s.id, proj?.id ?? null)
        .catch(() => {});
    }

    // Warm ACP: connect while the user reads history (trusted project or orphan).
    // Host serializes connect; first send no-ops if already ready.
    //
    // Multi-session: if *another* session is mid-turn, do NOT warm-connect here.
    // Spawning demotes the busy process; capacity reclaim must never kill it, but
    // deferring warm connect avoids demote/spawn churn while browsing other chats.
    // The next send on this chat will `ensureConnected` intentionally.
    // Skip when project folder is missing (D05) — user must relocate first.
    const foreignBusy =
      Object.entries(liveMap).some(
        ([id, snap]) =>
          id !== s.id &&
          (snap.state === "streaming" || snap.state === "awaiting_permission"),
      ) ||
      (!!live.sessionId &&
        live.sessionId !== s.id &&
        isSessionLiveStreaming(live.state));
    // Also defer while a send / connect is in flight: warm-connecting mid-send
    // used to steal the live slot from the turn being dispatched.
    if (
      api.isTauri() &&
      !foreignBusy &&
      !sendInFlightRef.current &&
      !connectingRef.current &&
      (!proj || (proj.trusted && !isProjectPathMissing(proj.pathOk))) &&
      !(live.sessionId === s.id && live.state === "ready")
    ) {
      const warmId = s.id;
      void (async () => {
        if (viewingSessionIdRef.current !== warmId) return;
        if (sendInFlightRef.current || connectingRef.current) return;
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
   */
  useEffect(() => {
    if (suppressProjectDraftPersistRef.current) return;
    // Real session follow-ups must not overwrite the new-task buffer.
    if (session.sessionId != null || viewingSessionIdRef.current != null) {
      return;
    }
    const key = projectDraftKey(activeProject?.id ?? null);
    const t = window.setTimeout(() => {
      if (suppressProjectDraftPersistRef.current) return;
      if (session.sessionId != null || viewingSessionIdRef.current != null) {
        return;
      }
      saveComposerProjectDraft(key, {
        text: draft,
        attachments,
        goalMode,
      });
    }, 280);
    return () => window.clearTimeout(t);
  }, [draft, attachments, goalMode, activeProject?.id, session.sessionId]);

  useEffect(() => {
    if (appGate !== "ready") return;
    if (didRestoreLastRef.current) return;
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
    reopenLastSession,
    lastSessionId,
    sessions,
    session.sessionId,
    activeProject?.id,
    applyComposerProjectDraft,
  ]);

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
        resizeComposer(el);
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
   * Composer text/attachments are restored from per-project memory so a
   * half-typed task survives switching to another chat and back.
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

    // Snapshot outgoing new-chat buffer under the *previous* project before switch.
    const prevKey = projectDraftKey(activeProject?.id ?? null);
    const wasDraftPage = viewingSessionIdRef.current == null;
    if (wasDraftPage) {
      saveComposerProjectDraft(prevKey, {
        text: draft,
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
    const leavingId = viewingSessionIdRef.current;
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
  };

  const sessionsForProject = (projectId: string) =>
    sessions.filter((s) => s.projectId === projectId && !s.archived);

  const orphanSessions = sessions.filter(
    (s) =>
      (!s.projectId || !projects.some((p) => p.id === s.projectId)) &&
      !s.archived,
  );

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
  }, [selectableSessionIds]);

  const exitSessionSelectMode = useCallback(() => {
    setSessionSelectMode(false);
    setSelectedSessionIds(new Set());
  }, []);

  const enterSessionSelectMode = useCallback(() => {
    setSessionSelectMode(true);
    setSelectedSessionIds(new Set());
  }, []);

  const toggleSessionSelected = useCallback((id: string) => {
    setSelectedSessionIds((prev) => toggleIdInSet(prev, id));
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

  /**
   * Multi-session busy ids (stream / permission) for sidebar spinner.
   * Uses liveMap projection + liveHost fallback. Excludes connecting.
   */
  const busyIds = useMemo(() => {
    const set = busySessionIds(liveMap);
    if (liveHost.sessionId && isSessionLiveStreaming(liveHost.state)) {
      set.add(liveHost.sessionId);
    }
    return set;
  }, [liveMap, liveHost.sessionId, liveHost.state]);
  const settleStoppedSessionUi = useCallback((sessionId: string) => {
    setLiveMap((prev) => {
      const next = settleStoppedSessionInLiveMap(prev, sessionId);
      liveMapRef.current = next;
      return next;
    });
    setLiveHost((prev) => {
      const next = settleStoppedSessionSnapshot(prev, sessionId);
      liveHostRef.current = next;
      return next;
    });
    setSession((prev) => settleStoppedSessionSnapshot(prev, sessionId));
  }, []);
  const stopGate = useMemo(
    () =>
      reconcileUiBusyGate({
        hostState: session.state,
        stopLatch,
      }),
    [session.state, stopLatch],
  );
  const effectiveCanSend = stopGate.sendable;
  const effectiveCanStop = canStopWithStopLatch(session.state, stopLatch);

  const refreshSessions = async () => {
    try {
      const list = await api.sessionsList();
      setSessions(
        list.map((s) => ({
          id: s.id,
          title: s.title,
          projectId: normalizeProjectId(s.projectId),
          updatedAt: s.updatedAt,
          archived: !!s.archived,
          pinned: !!s.pinned,
          scheduled: !!s.scheduled,
        })),
      );
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
      if (automationRunLock.current) return false;
      if (opts?.fromScheduler && (session.state === "streaming" || connecting)) {
        return false;
      }
      automationRunLock.current = true;
      let createdSessionId: string | null = null;
      try {
        const proj = auto.projectId
          ? projects.find((p) => p.id === auto.projectId) ?? null
          : null;
        if (proj && !proj.trusted) {
          setLocalError(tr("project.trustFirst", { name: proj.name }));
          return false;
        }
        if (proj && isProjectPathMissing(proj.pathOk)) {
          setLocalError(tr("project.pathMissing", { name: proj.name }));
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
        setToast(tr("automations.runningToast", { title: auto.title }));
        window.setTimeout(() => setToast(null), 3200);
        return true;
      } catch (e) {
        setLocalError(String(e));
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
      api.listen<{ title?: string; sessionId?: string }>(
        "automation://ran",
        (p) => {
          if (cancelled) return;
          const title = (p?.title || "").trim() || "automation";
          setToast(tr("automations.runningToast", { title }));
          window.setTimeout(() => setToast(null), 3200);
          void refreshSessions();
        },
      ),
    );
    void track(
      api.listen<{ title?: string; error?: string }>(
        "automation://error",
        (p) => {
          if (cancelled) return;
          const title = (p?.title || "").trim() || "automation";
          const err = (p?.error || "").trim() || "failed";
          setLocalError(
            tr("automations.hostRunFailed", { title, detail: err }),
          );
        },
      ),
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
    [tr],
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
      const msg = tr("project.relocateOk", {
        name: updated.name,
        path: updated.path,
      });
      setToast(msg);
      window.setTimeout(
        () => setToast((cur) => (cur === msg ? null : cur)),
        3200,
      );
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
        const msg = next
          ? tr("project.permissionSet", {
              name: proj.name,
              policy: tr(
                (
                  {
                    ask: "policy.short.ask",
                    accept_edits: "policy.short.accept_edits",
                    allow_for_session: "policy.short.allow_for_session",
                    dont_ask: "policy.short.dont_ask",
                    always_approve: "policy.short.always_approve",
                  } as const
                )[next],
              ),
            })
          : tr("project.permissionCleared", { name: proj.name });
        setToast(msg);
        window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2800);
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
          const ok = results.filter((r) => r.status === "fulfilled").length;
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

          if (ok > 0) {
            setToast(
              archived
                ? tr("sidebar.archivedToast", { n: String(ok) })
                : tr("sidebar.restoredToast", { n: String(ok) }),
            );
            window.setTimeout(() => setToast(null), 3200);
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
          if (n > 0) {
            setToast(tr("sidebar.deletedToast", { n: String(n) }));
            window.setTimeout(() => setToast(null), 3200);
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

  /** One-line muted relative updated time for sidebar session rows. */
  const renderSessionRelativeTime = (updatedAt: string | undefined) => {
    // Keep tick in the render graph so the shared 60s interval refreshes labels.
    void sidebarRelativeTick;
    if (!sidebarShowRelativeTime || !updatedAt) return null;
    const label = formatRelativeTime(updatedAt, locale);
    if (!label || label === "—") return null;
    const absolute = formatMessageTime(updatedAt, locale);
    return (
      <span className="tree-l3__time" title={absolute || undefined}>
        {label}
      </span>
    );
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
      ),
    [searchQuery, sessions, projects],
  );

  const mergedSessionHits = useMemo(
    () =>
      mergeSessionSearchHits(
        searchQuery,
        searchHits.matchedSessions,
        contentSearchHits,
      ),
    [searchQuery, searchHits.matchedSessions, contentSearchHits],
  );

  const paletteActionHits = useMemo(
    () => filterPaletteActions(searchQuery, defaultPaletteActions(), tr),
    [searchQuery, tr],
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
        // Bind draft messages cache to the new id (was under null / unkeyed).
        const draftMsgs = messagesBySessionRef.current.get("__draft__");
        if (draftMsgs?.length) {
          messagesBySessionRef.current.set(meta.id, draftMsgs);
          messagesBySessionRef.current.delete("__draft__");
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
   * `/compact [note]` — in-app prompt for optional keep-note (CLI supports a
   * context note of what to retain). Empty → `/compact`; non-empty → `/compact {note}`.
   * Never uses window.prompt (unreliable in Tauri WebView).
   */
  const openCompactWithNote = () => {
    setAppDialog({
      kind: "prompt",
      title: tr("slash.compact"),
      message: tr("slash.compactConfirm"),
      initial: "",
      placeholder: tr("slash.compactNote"),
      submitLabel: tr("slash.compactConfirmOk"),
      onSubmit: (value) => {
        void (async () => {
          const note = value.trim();
          const cmd = note ? `/compact ${note}` : "/compact";
          try {
            const sid = await ensureConnected();
            if (!sid) return;
            await api.sessionSend(cmd, null, sid);
          } catch (err) {
            setLocalError(String(err));
          }
        })();
      },
    });
  };

  const attachLabels = useMemo(
    () => ({
      open: tr("attach.open"),
      reveal: tr("attach.reveal"),
      copyPath: tr("attach.copyPath"),
      copyImage: tr("attach.copyImage"),
      addToComposer: tr("attach.addToComposer"),
      remove: tr("composer.attachRemove"),
      viewImage: tr("image.view"),
    }),
    [tr],
  );

  const lastUserMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "user") return messages[i]!.id;
    }
    return null;
  }, [messages]);

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
        await api.sessionSend(agentText, storedDisplay, sessionId);
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
        await api.sessionSend(agentText, storedDisplay, sessionId);
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
  }) => {
    setDraft("");
    promptHistoryIndexRef.current = null;
    setPromptHistoryIndex(null);
    setPromptHistoryOpen(false);
    setPromptHistoryFilter("");
    setPromptHistoryActive(0);
    setPromptHistoryFocusFilter(false);
    setSlashQuery(null);
    setAttachments([]);
    if (opts?.clearProjectDraft) {
      clearComposerProjectDraft(projectDraftKey(activeProject?.id ?? null));
    }
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(".composer__input");
      if (el) el.style.height = "auto";
    });
  };

  /**
   * Wipe the main composer (text + attachments). Also leaves inline edit mode
   * and drops the per-project new-chat buffer when on a draft page.
   */
  const applyClearComposerDraft = useCallback(() => {
    clearComposerAfterSubmit({
      clearProjectDraft:
        session.sessionId == null && viewingSessionIdRef.current == null,
    });
    if (!editSubmitting) {
      setEditingUserMessageId(null);
      setEditAttachments([]);
    }
    requestComposerFocus();
  }, [editSubmitting, requestComposerFocus, session.sessionId]);

  /** Clear immediately, or confirm first when the draft is long (>200 chars). */
  const requestClearComposerDraft = useCallback(() => {
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
  }, [applyClearComposerDraft, attachments.length, draft, tr]);

  /** Enqueue when agent is busy; otherwise send immediately. */
  const send = async () => {
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
    // Existing-session follow-ups must not wipe a half-typed new-task draft.
    const fromNewChatPage = session.sessionId == null;

    // Enqueue only when *this viewed chat* is busy/connecting (follow-ups).
    // Host mid-turn on another session → executeSend demotes + spawns concurrent
    // work. Never park a new-chat / other-session send into a fake local queue
    // (that showed “本会话队列” on empty welcome while the real turn ran elsewhere).
    if (shouldEnqueueSend(session.state, connecting)) {
      sendQueue.enqueue({
        storedDisplay,
        attachments: att,
        goalMode,
      });
      clearComposerAfterSubmit({ clearProjectDraft: fromNewChatPage });
      return;
    }

    clearComposerAfterSubmit({ clearProjectDraft: fromNewChatPage });
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
        setLocalError(String(e));
      }
    },
    [tr],
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
        setLocalError(tr("composer.attachPasteFailed"));
        return;
      }
      const intoEdit = !!editingUserMessageIdRef.current;
      const mergeInto = intoEdit ? setEditAttachments : setAttachments;
      try {
        let lastName = "";
        for (const f of withoutPath) {
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
          lastName = entry.name;
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
        setLocalError(null);
        if (lastName) {
          const msg = tr("composer.attachSaved", { name: lastName });
          setToast(msg);
          window.setTimeout(
            () => setToast((cur) => (cur === msg ? null : cur)),
            2200,
          );
        }
      } catch (e) {
        setLocalError(String(e) || tr("composer.attachPasteFailed"));
      }
    },
    [addAttachmentsFromPaths, tr],
  );

  /**
   * Native OS clipboard image (arboard) when WebView paste has no File objects.
   * Used for macOS screenshots / system image clipboard.
   */
  const pasteMediaFromNativeClipboard = useCallback(
    async (opts?: { expectMedia?: boolean }) => {
      if (!api.isTauri()) {
        if (opts?.expectMedia) {
          setLocalError(tr("composer.attachPasteFailed"));
        }
        return;
      }
      try {
        const entry = await api.clipboardPasteImage();
        if (!entry?.path) {
          if (opts?.expectMedia) {
            setLocalError(tr("composer.attachPasteFailed"));
          }
          return;
        }
        await addAttachmentsFromPaths([entry.path]);
        setLocalError(null);
        const msg = tr("composer.attachSaved", { name: entry.name });
        setToast(msg);
        window.setTimeout(
          () => setToast((cur) => (cur === msg ? null : cur)),
          2200,
        );
      } catch (e) {
        setLocalError(String(e) || tr("composer.attachPasteFailed"));
      }
    },
    [addAttachmentsFromPaths, tr],
  );

  const closeComposerMenu = useCallback(() => {
    const live = liveSlashRef.current;
    if (live.present) {
      slashDismissedSigRef.current = `${live.start}:${live.query}`;
    }
    setShowComposerPlus(false);
    setSlashQuery(null);
    const cleared = { present: false, query: "", start: 0, end: 0 };
    setLiveSlash(cleared);
    liveSlashRef.current = cleared;
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

  const pickComposerFiles = useCallback(async () => {
    closeComposerMenu();
    if (isMirrorClient()) {
      setToast(tr("mirror.desktopOnly"));
      window.setTimeout(() => setToast(null), 3200);
      return;
    }
    if (!api.isTauri()) {
      setLocalError(tr("composer.attachPasteFailed"));
      return;
    }
    try {
      const paths = await api.pickAttachFiles();
      if (!paths.length) {
        // Cancelled — no error.
        return;
      }
      await addAttachmentsFromPaths(paths);
      setLocalError(null);
      const label =
        paths.length === 1
          ? paths[0]!.split(/[/\\]/).pop() || paths[0]!
          : tr("composer.attachCount", { n: String(paths.length) });
      const msg =
        paths.length === 1
          ? tr("composer.attachSaved", { name: label })
          : tr("composer.attachSaved", { name: label });
      setToast(msg);
      window.setTimeout(
        () => setToast((cur) => (cur === msg ? null : cur)),
        2200,
      );
    } catch (e) {
      const code =
        e && typeof e === "object" && "code" in e
          ? String((e as { code?: string }).code)
          : "";
      if (code === "UNSUPPORTED") {
        setToast(tr("mirror.unsupported"));
        window.setTimeout(() => setToast(null), 3200);
      } else {
        setLocalError(String(e) || tr("composer.attachPasteFailed"));
      }
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
          setToast(tr("composer.projectAdded", { name: last.name }));
          window.setTimeout(() => setToast(null), 2500);
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

  // Drag-resize right resource pane (clamp only while dragging — grow once on up).
  useEffect(() => {
    if (!resizingAside) return;
    const onMove = (e: PointerEvent) => {
      if (isWindowFitSuppressed()) return;
      const desired = Math.round(window.innerWidth - e.clientX);
      const next = clampAsideWidth(desired, {
        ...asideClampOpts(),
        viewportWidth: window.innerWidth,
      });
      setLayout((l) => {
        if (l.asideWidth === next && !l.asideCollapsed) return l;
        return { ...l, asideWidth: next, asideCollapsed: false };
      });
    };
    const onUp = () => {
      setResizingAside(false);
      const cur = layoutRef.current;
      void fitWindowThenClampAside({
        sidebarCollapsed: cur.sidebarCollapsed,
        sidebarWidth: cur.sidebarWidth || SIDEBAR_DEFAULT_WIDTH,
        asideCollapsed: false,
        asideWidth: cur.asideWidth,
      }).then((width) => {
        setLayout((l) => {
          const n = {
            ...l,
            asideCollapsed: false,
            asideWidth: width,
          };
          saveLayout(localStorage, n);
          return n;
        });
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
  }, [asideClampOpts, fitWindowThenClampAside, resizingAside]);

  const resizeComposer = (el: HTMLElement) => {
    const line = 22; // ~line-height
    const min = line * 1;
    const max = line * 10;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, min), max)}px`;
  };

  /** Programmatic draft / layout changes: recompute height after paint. */
  const syncComposerHeight = useCallback(() => {
    // Double rAF: wait for React commit + layout after mainPane switch.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const node = composerInputRef.current;
        if (node) resizeComposer(node);
      });
    });
  }, []);

  /** Bumped when Extensions skill toggles change so slash palette refilters. */
  const [skillsReloadToken, setSkillsReloadToken] = useState(0);

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

  /** Shared filter for + menu and `/` slash — empty query = full catalog. */
  const slashFiltered = useMemo(
    () =>
      flattenFilteredCatalog(slashCatalog, slashFilterQuery, (item) => ({
        title: resolveSlashTitle(item),
        description: resolveSlashDescription(item),
      })),
    [
      slashCatalog,
      slashFilterQuery,
      resolveSlashTitle,
      resolveSlashDescription,
    ],
  );
  const showUploadInMenu = useMemo(
    () =>
      uploadMatchesQuery(slashFilterQuery, {
        title: tr("composer.addFiles"),
        hint: tr("composer.addFilesHint"),
      }),
    [slashFilterQuery, tr],
  );
  const composerMenuEntries = useMemo(
    () =>
      buildComposerPlusEntries({
        showUpload: showUploadInMenu,
        commands: slashFiltered.commands,
        skills: slashFiltered.skills,
      }),
    [showUploadInMenu, slashFiltered.commands, slashFiltered.skills],
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

  const sessionPromptHistory = useMemo(
    () => collectUserPromptHistory(messages),
    [messages],
  );
  const promptHistoryEntries = useMemo(
    () => filterPromptHistory(sessionPromptHistory, promptHistoryFilter),
    [sessionPromptHistory, promptHistoryFilter],
  );

  const closePromptHistory = useCallback(() => {
    setPromptHistoryOpen(false);
    setPromptHistoryFilter("");
    setPromptHistoryActive(0);
    setPromptHistoryFocusFilter(false);
  }, []);

  const applyPromptHistoryEntry = useCallback(
    (
      entry: PromptHistoryEntry,
      opts?: { close?: boolean; listIndex?: number },
    ) => {
      promptHistoryIndexRef.current = entry.historyIndex;
      setPromptHistoryIndex(entry.historyIndex);
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

  const { pos: promptHistoryPos, style: promptHistoryStyle } = useFloatingMenu({
    open: promptHistoryOpen,
    triggerRef: composerShellRef,
    panelRef: promptHistoryPanelRef,
    roots: [composerShellRef, composerInputRef, promptHistoryPanelRef],
    onClose: closePromptHistory,
    placement: "up",
    fitContent: false,
    matchTriggerWidth: true,
    minWidth: 280,
    estHeight: 280,
    gap: 8,
    deps: [promptHistoryFilter, promptHistoryEntries.length],
  });

  // Keep highlight in range when the filtered list shrinks; reset on filter text.
  const prevPromptHistoryFilterRef = useRef(promptHistoryFilter);
  useEffect(() => {
    if (!promptHistoryOpen) return;
    if (prevPromptHistoryFilterRef.current !== promptHistoryFilter) {
      prevPromptHistoryFilterRef.current = promptHistoryFilter;
      setPromptHistoryActive(0);
      return;
    }
    setPromptHistoryActive((i) => {
      if (promptHistoryEntries.length === 0) return 0;
      return i >= promptHistoryEntries.length
        ? promptHistoryEntries.length - 1
        : i;
    });
  }, [promptHistoryEntries.length, promptHistoryFilter, promptHistoryOpen]);

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

  const openMcpModal = useCallback(async () => {
    setShowMcpModal(true);
    setMcpLoading(true);
    setMcpError(null);
    try {
      const res = await api.inspectMcp(activeProject?.path ?? null);
      setMcpServers(res.servers ?? []);
      if (res.error) setMcpError(res.error);
    } catch (e) {
      setMcpServers([]);
      setMcpError(String(e));
    } finally {
      setMcpLoading(false);
    }
  }, [activeProject?.path]);

  const showToast = useCallback((msg: string, ms = 3200) => {
    setToast(msg);
    window.setTimeout(() => {
      setToast((cur) => (cur === msg ? null : cur));
    }, ms);
  }, []);

  /** Confirm then stop every stoppable busy session from the Tasks panel. */
  const stopAllBusySessions = useCallback(() => {
    const rows = stoppableActivitySessions(
      collectActivitySessions({
        liveMap: liveMapRef.current,
        sessions,
        currentSessionId: session.sessionId,
        untitledLabel: tr("session.untitled"),
      }),
    );
    if (!rows.length) return;
    const n = rows.length;
    const ids = rows.map((r) => r.sessionId);
    setAppDialog({
      kind: "confirm",
      title: tr("tasks.activity.stopAllTitle"),
      message: tr("tasks.activity.stopAllConfirm", { n: String(n) }),
      confirmLabel: tr("tasks.activity.stopAll"),
      danger: true,
      onConfirm: async () => {
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
          } else {
            fail += 1;
          }
        }
        if (fail === 0) {
          showToast(tr("tasks.activity.stopAllDone", { n: String(ok) }), 3200);
        } else {
          showToast(
            tr("tasks.activity.stopAllPartial", {
              ok: String(ok),
              fail: String(fail),
            }),
            4000,
          );
        }
      },
    });
  }, [
    sessions,
    session.sessionId,
    settleStoppedSessionUi,
    showToast,
    tr,
  ]);

  /**
   * Open current-session prompt history picker (Build `/history`).
   * @param focusFilter — true for slash `/history` (search box); false for empty ↑.
   * @param seedDraft — fill composer with the active row (empty ↑).
   */
  const openPromptHistory = useCallback(
    (opts?: { focusFilter?: boolean; seedDraft?: boolean }) => {
      const history = collectUserPromptHistory(messagesRef.current);
      if (history.length === 0) {
        showToast(tr("slash.historyEmpty"), 2400);
        return;
      }
      // Don't stack with slash/plus menu.
      setShowComposerPlus(false);
      setSlashQuery(null);
      setLiveSlash({ present: false, query: "", start: 0, end: 0 });
      liveSlashRef.current = { present: false, query: "", start: 0, end: 0 };

      setPromptHistoryFilter("");
      setPromptHistoryActive(0);
      setPromptHistoryFocusFilter(opts?.focusFilter === true);
      setPromptHistoryOpen(true);
      if (opts?.seedDraft !== false) {
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
    if (sid) planBySessionRef.current.set(sid, next);
    setPlan(next);
  }, []);

  const approvePlan = useCallback(async () => {
    try {
      await api.sessionResolvePlan({
        decision: "approved",
        rpcId: plan.rpcId,
        // Plan chrome is per-viewed-session; the gate may sit on a demoted turn.
        sessionId: viewingSessionIdRef.current,
      });
      writePlanForViewing({
        ...planRef.current,
        visible: false,
        waiting: false,
        rpcId: null,
        userClosed: false,
      });
      showToast(tr("plan.approvedToast"), 2500);
    } catch (e) {
      showToast(String(e), 4500);
    }
  }, [plan.rpcId, showToast, tr, writePlanForViewing]);

  const requestPlanChanges = useCallback(async () => {
    try {
      await api.sessionResolvePlan({
        decision: "cancelled",
        feedback: tr("plan.reviseFeedback"),
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
      showToast(tr("plan.reviseToast"), 2800);
    } catch (e) {
      showToast(String(e), 4500);
    }
  }, [plan.rpcId, showToast, tr, writePlanForViewing]);

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
        if (abandonedRpcId != null) {
          try {
            await api.sessionResolvePlan({
              decision: "abandoned",
              rpcId: abandonedRpcId,
              sessionId: viewingSessionIdRef.current,
            });
          } catch {
            /* clear UI anyway */
          }
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
  }, [tr, writePlanForViewing]);

  /** Open resource pane Plan review (replaces scroll-to-card “详情”). */
  const openPlanInResource = useCallback(() => {
    planOpenedAsideRef.current = true;
    openAsidePane();
    setPlanFocusKey((k) => k + 1);
  }, [openAsidePane]);

  const sendQueueLabels = useMemo(
    () => ({
      queued: tr("composer.queued"),
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

  const guideQueuedMessage = useCallback(
    async (item: QueuedSend) => {
      if (guidingQueueItemId || !canGuideQueuedMessage || !session.sessionId) {
        return;
      }
      const segments = parseStoredContent(item.storedDisplay);
      const agentBody = serializeForAgent(segments, { goalMode: item.goalMode });
      const agentText = buildAgentPrompt(agentBody, item.attachments);
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


  /**
   * Fork a session (full history or through a user-prompt index) and open it.
   */
  const runForkSession = useCallback(
    async (
      source: SessionRow,
      opts?: { throughUserPromptIndex?: number | null },
    ) => {
      if (!api.isTauri()) {
        showToast(tr("error.needTauri"));
        return;
      }
      try {
        const base = (source.title || tr("session.untitled")).trim();
        // Avoid double-prefix when forking a fork (any locale).
        const title = /^(fork of|分叉：|分叉:)\s*/i.test(base)
          ? base
          : tr("session.forkTitleOf", { name: base || "chat" });
        const meta = await api.sessionFork(source.id, {
          throughUserPromptIndex: opts?.throughUserPromptIndex ?? null,
          title,
        });
        await refreshSessions();
        const row: SessionRow = {
          id: meta.id,
          title: meta.title || title,
          projectId: meta.projectId ?? source.projectId,
          updatedAt: meta.updatedAt || new Date().toISOString(),
          archived: meta.archived,
          pinned: !!(meta as SessionRow).pinned,
          scheduled: meta.scheduled,
        };
        const proj = row.projectId
          ? projects.find((p) => p.id === row.projectId) ?? null
          : null;
        if (row.projectId) {
          setExpandedProjects((e) => ({ ...e, [row.projectId!]: true }));
        } else {
          setHistoryOpen(true);
        }
        await openSession(row, proj);
        showToast(tr("session.forkOk"), 2800);
      } catch (e) {
        showToast(tr("session.forkFailed") + ": " + String(e), 4500);
      }
    },
    // openSession / refreshSessions via closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects, showToast, tr],
  );

  const confirmForkSession = useCallback(
    (source: SessionRow, throughUserPromptIndex?: number | null) => {
      setCtxMenu(null);
      const partial =
        throughUserPromptIndex != null && throughUserPromptIndex !== undefined;
      setAppDialog({
        kind: "confirm",
        title: tr("session.forkTitle"),
        message: partial
          ? tr("session.forkConfirmPartial")
          : tr("session.forkConfirm"),
        confirmLabel: tr("session.fork"),
        onConfirm: () => {
          void runForkSession(source, {
            throughUserPromptIndex: throughUserPromptIndex ?? null,
          });
        },
      });
    },
    [runForkSession, tr],
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
          const mapped: ChatMessage[] = stored.map((m) => ({
            id: m.id,
            role: m.role as "user" | "assistant" | "tool",
            content: m.content,
            thought: m.thought ?? undefined,
            thoughtPhases: splitThoughtPhases(m.thought),
            isError: m.isError || undefined,
            marker: m.marker || undefined,
            createdAt: m.createdAt || undefined,
            attachments: (m.attachments ?? []).map((a) => ({
              path: a.path,
              name: a.name || a.path.split(/[/\\]/).pop() || a.path,
              isDir: !!a.isDir,
            })),
            streaming: false,
          }));
          const kept = truncateThroughUserPrompt(mapped, targetPromptIndex);
          const finalMsgs =
            kept.length || mapped.length <= result.keptCount
              ? kept.length
                ? kept
                : mapped
              : mapped.slice(0, result.keptCount);
          messagesBySessionRef.current.set(sessionId, finalMsgs);
          setMessages(finalMsgs);
        } else {
          messagesBySessionRef.current.delete(sessionId);
        }

        setRewindTimeline(null);
        setRewindConfirm(null);
        setRewindRestoreFiles(false);
        if (result.agentOk) {
          showToast(tr("session.rewindOk"), 2600);
        } else {
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
        showToast(tr("session.rewindNoop"));
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
    (next: PermissionPolicyId, opts?: { toastYoloToggle?: boolean }) => {
      if (!isValidPolicy(next)) return;

      const commit = () => {
        setPolicy(next);
        void api
          .sessionSetPolicy(next, {
            projectId: activeProject?.id ?? null,
            sessionId: session.sessionId ?? null,
          })
          .catch((e) => showToast(String(e), 4000));
        if (opts?.toastYoloToggle) {
          showToast(
            next === "always_approve"
              ? tr("slash.yoloOn")
              : tr("slash.yoloOff"),
            2500,
          );
        }
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
            applyPermissionPolicy(next, { toastYoloToggle: true });
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
  useEffect(() => {
    if (mainPane !== "chat") return;
    if (pendingComposerFocus.current) {
      requestComposerFocus();
      return;
    }
    syncComposerHeight();
  }, [draft, mainPane, session.sessionId, requestComposerFocus, syncComposerHeight]);

  /** Context usage chip label/state from compact events + message estimate. */
  const contextUsageDisplay = useMemo(
    () => resolveContextUsageDisplay(contextUsage, messages, locale),
    [contextUsage, messages, locale],
  );

  /** Char/word counts for the muted composer counter (hidden when empty). */
  const composerDraftStats = useMemo(
    () => computeDraftStats(draft),
    [draft],
  );

  const sessionTasks = useMemo(
    () => collectSessionTasks(messages),
    [messages],
  );
  const runningTaskCount = useMemo(
    () => countRunningTasks(sessionTasks),
    [sessionTasks],
  );

  /**
   * In-chat find matches — user + assistant bodies only.
   * Historical tool_step rows are not rendered in the transcript, so matching
   * them would land on invisible hits.
   */
  const chatFindMatches = useMemo((): ChatFindMatch[] => {
    if (!showChatFind) return [];
    return findChatMatches(
      chatFindQuery,
      messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          marker: m.marker,
        })),
    );
  }, [showChatFind, chatFindQuery, messages]);

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
      showToast(tr("message.copied"));
    } catch (e) {
      showToast(String(e), 4000);
    }
  }, [messages, showToast, tr]);

  /**
   * New empty draft only: lift composer and SuperGrok brand.
   * Existing sessions (even with empty journal) must not look like a fresh chat.
   */
  const welcomeSession =
    mainPane === "chat" &&
    !session.sessionId &&
    messages.length === 0 &&
    session.state !== "streaming";
  const emptyExistingSession =
    mainPane === "chat" &&
    !!session.sessionId &&
    messages.length === 0 &&
    session.state !== "streaming" &&
    session.state !== "connecting";
  // Live billing can take seconds (quota network). Cache last mark so the
  // welcome logo paints immediately — the SVG itself is inline, not a fetch.
  const [cachedBrandKind, setCachedBrandKind] =
    useState<SuperGrokBrandKind | null>(() => loadCachedSuperGrokBrand());
  /** Active inference channel: custom relay identity replaces official account chrome. */
  const [activeCustomProvider, setActiveCustomProvider] =
    useState<api.CustomProvider | null>(null);
  const customRouteActive = activeCustomProvider != null;
  const refreshProviderRoute = useCallback(async () => {
    if (!api.isTauri()) {
      setActiveCustomProvider(null);
      return;
    }
    try {
      const list = await api.providersList();
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
  // Re-evaluate composer mic when switching official ↔ custom provider.
  useEffect(() => {
    void refreshVoiceGate();
  }, [customRouteActive, refreshVoiceGate]);
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

  // Floating composer height → chat bottom pad so messages can scroll under it.
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
    draft,
    showComposerPlus,
    messages.length,
    welcomeSession,
    welcomeBrandKind,
  ]);

  const stop = async () => {
    const now = Date.now();
    // Stop belongs to the chat on screen. Preferring the live slot cancelled a
    // foreign turn whenever the viewed chat had been demoted to background.
    const sid =
      viewingSessionIdRef.current || liveHostRef.current.sessionId || null;
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
    async (proj: Project | null, opts?: { silent?: boolean }) => {
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
          if (!opts?.silent) {
            showToast(
              tr("composer.projectBound", {
                name: projectDisplayName(target, tr),
              }),
              2500,
            );
          }
        } else {
          setHistoryOpen(true);
          if (!opts?.silent) {
            showToast(tr("composer.projectCleared"), 2500);
          }
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
          showToast(tr("composer.projectAdded", { name: current.name }), 2500);
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
      const res = await api.gitWorktreeGc(
        activeProject.path,
        false,
        worktreeGcForce,
      );
      setWorktreeGcOpen(false);
      setWorktreeGcPreview(null);
      setWorktreeGcForce(false);
      await refreshGitWorktrees();
      const n = res.prunedCount ?? 0;
      showToast(
        n > 0
          ? tr("composer.worktreeGcDone", { n: String(n) })
          : tr("composer.worktreeGcDoneNone"),
        2800,
      );
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
          await bindSessionProject(existing, { silent: true });
          showToast(
            tr("composer.worktreeSwitched", {
              name: existing.name,
              branch: wt.branch || tr("composer.worktreeDetached"),
            }),
            2500,
          );
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
          await bindSessionProject(proj, { silent: true });
          showToast(
            tr("composer.worktreeSwitched", {
              name: proj.name,
              branch: wt.branch || tr("composer.worktreeDetached"),
            }),
            2500,
          );
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
      const name = worktreeLabel(wt);
      const wasCurrent = pathsEqual(wt.path, activeProject?.path);
      try {
        await api.gitWorktreeRemove({
          projectPath: mainPath,
          worktreePath: wt.path,
          force,
        });
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
        showToast(
          tr("composer.worktreeRemoveDone", { name }),
          2800,
        );
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
    setWorktreeCreateError(null);
    setWorktreeCreateBusy(false);
    setWorktreeCreateStartChat(!!opts?.startNewChat);
    setWorktreeCreateOpen(true);
  }, []);

  const worktreeCreatePreviewPath = (() => {
    try {
      const main = mainWorktreePath(gitWorktrees) || activeProject?.path || "";
      if (!main || !worktreeCreateName.trim()) return null;
      return buildWorktreeSiblingPath(main, worktreeCreateName.trim());
    } catch {
      return null;
    }
  })();

  /**
   * Create worktree → refresh list → add as project (trust inherited) →
   * either bind current session or start a draft chat on that path.
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
    setWorktreeCreateBusy(true);
    setWorktreeCreateError(null);
    try {
      const start = worktreeCreateRef.trim() || null;
      const created = await api.gitWorktreeAdd(
        activeProject.path,
        safeName,
        start,
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
        showToast(
          tr("composer.worktreeCreated", {
            name: created.name,
            branch,
          }),
          2800,
        );
        return;
      }

      if (startChat) {
        await newChat(target, { switchToChat: true });
        showToast(
          tr("composer.worktreeCreatedChat", {
            name: created.name,
            branch,
          }),
          2800,
        );
      } else {
        await bindSessionProject(target, { silent: true });
        showToast(
          tr("composer.worktreeCreated", {
            name: created.name,
            branch,
          }),
          2800,
        );
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
    newChat,
    projects,
    refreshGitWorktrees,
    showToast,
    tr,
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
      case "doctor":
        setShowDoctor(true);
        break;
      case "shortcuts-help":
        setShowShortcuts(true);
        break;
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
  };
  trayHandlersRef.current = {
    newChat: () => {
      void newChat();
    },
    openSessionById: (id: string) => {
      void (async () => {
        let row = sessions.find((s) => s.id === id) ?? null;
        if (!row) {
          try {
            const list = await api.sessionsList();
            const hit = list.find((s) => s.id === id);
            if (hit) {
              row = {
                id: hit.id,
                title: hit.title,
                projectId: hit.projectId,
                updatedAt: hit.updatedAt,
                archived: !!hit.archived,
                scheduled: !!hit.scheduled,
              };
              setSessions(
                list.map((s) => ({
                  id: s.id,
                  title: s.title,
                  projectId: s.projectId,
                  updatedAt: s.updatedAt,
                  archived: !!s.archived,
                  scheduled: !!s.scheduled,
                })),
              );
            }
          } catch {
            /* ignore */
          }
        }
        if (!row) return;
        const proj =
          projects.find((p) => p.id === row!.projectId) ?? null;
        await openSession(row, proj);
      })();
    },
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
  useEffect(() => {
    if (!api.isTauri()) return;
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
  }, []);

  const error = session.lastError;
  const errorBanner = useMemo(
    () => presentErrorBanner(error, localError, locale),
    [error, localError, locale],
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

  /** T04 deck buttons: reconnect / Doctor / Settings sections / dismiss. */
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
    [ensureConnected, navigateSettings, openDoctor, stop],
  );

  const refreshAccount = useCallback(
    async (opts?: { refreshBilling?: boolean }) => {
      if (!api.isTauri()) return;
      setAccountLoading(true);
      try {
        const st = await api.accountStatus({
          refreshBilling: opts?.refreshBilling ?? true,
          manualCliPath: manualCliPath || null,
        });
        setAccount(st);
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
      showToast(tr("account.importChatOk", { title: created.title }), 3200);
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

  /** Build markdown for a session; used by download + copy. */
  const buildSessionMarkdown = useCallback(
    async (
      sessionMeta: ExportMdTarget | undefined,
      options: { includeThoughts: boolean; includeToolSummary: boolean },
    ) => {
      const id = sessionMeta?.id ?? session.sessionId;
      if (!id) throw new Error(tr("session.exportFail"));
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
        msgs = (await api.sessionMessages(id)) as ChatMessage[];
      }
      const md = sessionToMarkdown({
        title,
        projectName: proj?.name,
        projectPath: proj?.path,
        sessionId: id,
        options: {
          includeThoughts: options.includeThoughts,
          includeToolSummary: options.includeToolSummary,
        },
        messages: msgs.map((m) => ({
          role: m.role,
          content: m.content,
          thought: m.thought,
          createdAt: m.createdAt,
          marker: m.marker,
        })),
      });
      return { id, title, md };
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

  /** Open export options (thoughts / tools / download / copy). */
  const openExportSessionMd = useCallback(
    (sessionMeta?: {
      id: string;
      title: string;
      projectId?: string | null;
    }) => {
      const id = sessionMeta?.id ?? session.sessionId;
      if (!id) {
        showToast(tr("session.exportFail"));
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

  const runExportSessionMd = useCallback(
    async (mode: "download" | "copy") => {
      if (!exportMdTarget) return;
      setExportMdBusy(true);
      try {
        const { id, title, md } = await buildSessionMarkdown(exportMdTarget, {
          includeThoughts: exportMdIncludeThoughts,
          includeToolSummary: exportMdIncludeTools,
        });
        if (mode === "copy") {
          await navigator.clipboard.writeText(md);
          showToast(tr("session.exportCopied"));
        } else {
          const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = sessionExportFilename(title, id);
          a.click();
          URL.revokeObjectURL(url);
          showToast(tr("session.exportDone"));
        }
        setExportMdTarget(null);
      } catch (e) {
        showToast(`${tr("session.exportFail")}: ${String(e)}`);
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
        showToast(tr("session.exportFail"));
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
          msgs = (await api.sessionMessages(id)) as ChatMessage[];
        }
        const json = sessionToJson({
          title,
          sessionId: id,
          // Clean re-import: omit thoughts/tools by default.
          options: { includeThoughts: false, includeToolSummary: false },
          messages: msgs.map((m) => ({
            role: m.role,
            content: m.content,
            thought: m.thought,
            createdAt: m.createdAt,
            marker: m.marker,
          })),
        });
        const blob = new Blob([json], {
          type: "application/json;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = sessionExportJsonFilename(title, id);
        a.click();
        URL.revokeObjectURL(url);
        showToast(tr("session.exportDone"));
      } catch (e) {
        showToast(`${tr("session.exportFail")}: ${String(e)}`);
      }
    },
    [
      session.sessionId,
      session.title,
      sessions,
      messages,
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
        if (res?.ok && res.path) {
          showToast(tr("session.exportBundleDone"), 4200);
        } else {
          showToast(tr("session.exportBundleFail"));
        }
      } catch (e) {
        showToast(`${tr("session.exportBundleFail")}: ${String(e)}`, 5000);
      }
    },
    [session.sessionId, showToast, tr],
  );

  /** Export Grok Build CLI session trace (`grok trace --local`). */
  const exportSessionTrace = useCallback(
    async (sessionId?: string | null) => {
      const id = sessionId || session.sessionId;
      if (!id) {
        showToast(tr("session.exportTraceFail"));
        return;
      }
      try {
        const res = await api.sessionTraceExport(id);
        if (res?.ok && res.path) {
          showToast(tr("session.exportTraceDone"), 4200);
        } else {
          showToast(tr("session.exportTraceFail"));
        }
      } catch (e) {
        const msg = String(e);
        if (/no agent session/i.test(msg)) {
          showToast(tr("session.exportTraceNoAgent"), 5000);
        } else {
          showToast(`${tr("session.exportTraceFail")}: ${msg}`, 5000);
        }
      }
    },
    [session.sessionId, showToast, tr],
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
      opts?: { onlyLastToastKey?: "message.editOnlyLast" | "message.regenerateOnlyLast"; busyToastKey?: "message.editBusy" | "message.regenerateBusy" },
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
      const agentText = buildAgentPrompt(agentBody, att);
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

        await api.sessionSend(agentText, storedDisplay, sessionId);
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
   */
  const regenerateLastAssistant = useCallback(
    async (message: ChatMessage) => {
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
      await resendLastUserTurn(userMsg, userMsg.content, att, {
        onlyLastToastKey: "message.regenerateOnlyLast",
        busyToastKey: "message.regenerateBusy",
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
          showToast(tr("account.loginOk"), 2800);
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
          showToast(
            [res.deviceUrl, res.deviceCode ? `code: ${res.deviceCode}` : ""]
              .filter(Boolean)
              .join(" · "),
            10000,
          );
        }
        await refreshAccount({ refreshBilling: true });
        await refreshSavedAccounts();
        // Drop live agent so next send re-spawns with synced auth.json in agent-home.
        if (res.ok && api.isTauri()) {
          try {
            await api.sessionDisconnect();
            setSession({ ...IDLE_SNAPSHOT });
          } catch {
            /* ignore */
          }
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

  const runSaveAccount = useCallback(async () => {
    if (!api.isTauri()) return;
    setAccountBusy(true);
    try {
      await api.accountSaveCurrent();
      await refreshSavedAccounts();
      showToast(tr("account.profileSaved"), 2500);
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
        showToast(tr("account.profileSaved"), 1800);
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
        try {
          await api.sessionDisconnect();
        } catch {
          /* ignore */
        }
        setSession({ ...IDLE_SNAPSHOT });
        showToast(tr("account.profileSwitched"), 2500);
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
            showToast(tr("account.profileRemoved"), 2200);
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
      try {
        await api.sessionDisconnect();
        setSession({ ...IDLE_SNAPSHOT });
      } catch {
        /* ignore */
      }
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
      "session.untitled",
      "settings.section.permissions",
      "settings.section.composer",
      "settings.section.general",
      "settings.language",
      "settings.languageDesc",
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
      "policy.dont_ask",
      "policy.always_approve",
      "settings.modeIndependent",
      "settings.modeShared",
      "settings.tabOfficial",
      "settings.tabProviders",
      "settings.tabOfficialHint",
      "settings.tabProvidersHint",
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
        showShortcuts ||
        showStatusModal ||
        showMcpModal ||
        showCompactModal ||
        exportMdTarget ||
        rewindConfirm ||
        worktreeCreateOpen ||
        projectRulesTarget,
    ),
    permOpen: !!perm,
    askUserOpen: !!askUser,
    chatFindOpen: showChatFind,
    slashOrMenuOpen:
      composerMenuOpen || phoneToolsOpen || !!ctxMenu || showUserMenu,
    promptHistoryOpen,
  };

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
          <div className="setup-gate__drag" data-tauri-drag-region />
          <div className="setup-gate__center">
            <div className="setup-hero">
              <div className="setup-logo setup-logo--spin">
                <GrokLogo size={44} />
              </div>
              <h1 className="setup-title">{tr("setup.title")}</h1>
              <p className="setup-subtitle">{tr("setup.detecting")}</p>
            </div>
          </div>
        </div>
      )}

      {appGate === "setup" && (
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
            setCliInfo({
              found: cli.found,
              path: cli.path,
              version: cli.version,
              source: cli.source,
              cliAuthPresent: cli.cliAuthPresent,
            });
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
      )}

      {appGate === "ready" && (appView === "settings" ? (
        <SettingsPage
          section={settingsSection}
          tab={settingsTab}
          onSection={(id, nextTab) => {
            navigateSettings(id, nextTab);
          }}
          onBack={navigateWorkbench}
          phoneLayout={phoneLayout}
          labels={settingsLabels}
          locale={locale}
          onLocale={(v) => {
            const next = resolveLocale(v);
            setLocale(next);
            void api.settingsGet().then(async (s) => {
              await api.settingsSet({ ...s, locale: next });
              // settings_set also refreshes tray; call again so UI stays in sync if invoke fails mid-way.
              void api.trayRefresh();
            });
          }}
          theme={theme}
          themePreference={themePreference}
          onTheme={applyThemeChoice}
          showMessageTimestamps={showMessageTimestamps}
          onShowMessageTimestamps={(v) => {
            saveMessageTimestampsPref(v, localStorage);
            setShowMessageTimestamps(v);
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
              setCliInfo({
                found: cli.found,
                path: cli.path,
                version: cli.version,
                source: cli.source || "",
                cliAuthPresent: !!cli.cliAuthPresent,
              });
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
          onAcpServerAddr={(v) => {
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
            setSandboxProfile(v);
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, sandboxProfile: v }),
            );
          }}
          preferredAgent={preferredAgent}
          onPreferredAgent={(v) => {
            setPreferredAgent(v);
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, preferredAgent: v }),
            );
          }}
          agentCatalog={agentCatalog}
          experimentalMemory={experimentalMemory}
          onExperimentalMemory={(v) => {
            setExperimentalMemory(v);
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, experimentalMemory: v }),
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
          planEnabled={planEnabled}
          onPlanEnabled={(v) => {
            setPlanEnabled(v);
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, planEnabled: v }),
            );
          }}
          disableWebSearch={disableWebSearch}
          onDisableWebSearch={(v) => {
            setDisableWebSearch(v);
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, disableWebSearch: v }),
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
          cliInfo={cliInfo}
          onDoctor={() => void openDoctor()}
          onOpenShortcutsHelp={() => setShowShortcuts(true)}
          versionFooter={tr("app.versionFooter")}
          account={account}
          accountLoading={accountLoading}
          accountBusy={accountBusy}
          loginHint={loginHint}
          savedAccounts={savedAccounts}
          activeAccountId={activeAccountId}
          onAccountLoginOauth={() => void runAccountLogin("oauth")}
          onAccountLoginDevice={() => void runAccountLogin("device")}
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
          projectPath={effectiveProjectPath}
          onSkillsPrefsChanged={() =>
            setSkillsReloadToken((n) => n + 1)
          }
          trustedProjects={projects
            .filter((p) => p.trusted)
            .map((p) => ({ id: p.id, name: p.name, path: p.path }))}
          onProviderActivated={() => {
            // Hot-reload Grok Build: drop live ACP so next send re-spawns with new GROK_HOME config.
            void (async () => {
              try {
                if (api.isTauri()) {
                  await api.sessionDisconnect();
                  setSession({ ...IDLE_SNAPSHOT });
                }
                await refreshProviderRoute();
                await refreshAccount({ refreshBilling: false });
                await refreshVoiceGate();
                setToast(tr("prov.switchedHotReload"));
                window.setTimeout(() => setToast(null), 3200);
              } catch (e) {
                setToast(String(e));
              }
            })();
          }}
        />
      ) : (
      <div className={"workbench" + (phoneLayout ? " workbench--phone" : "")}>
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
            (dragZone === "sidebar" ? " is-drop-target" : "") +
            (dragZone === "main" ? " is-drop-idle" : "") +
            (phoneLayout ? " sidebar--phone-drawer" : "")
          }
          aria-hidden={layout.sidebarCollapsed}
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
          {/* Row 1: traffic-light height — panel toggle sits just right of traffic lights */}
          <div
            className="sidebar-chrome"
            data-tauri-drag-region
            onDoubleClick={() => {
              if (useCustomWindowChrome) void toggleMaximizeFromTitlebar();
            }}
          >
            <Tip label={tr("main.leftPaneHide")}>
              <button
                type="button"
                className="chrome-btn chrome-btn--traffic main__pane-toggle is-on"
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
            <div className="sidebar-chrome__drag" data-tauri-drag-region />
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
                return (
                  <div key={proj.id} className="tree-project">
                    {/* L2 — project folder: expand/collapse only (not selectable) */}
                    <div
                      className={
                        "tree-l2" +
                        (isProjectPathMissing(proj.pathOk)
                          ? " tree-l2--path-missing"
                          : "")
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
                      <span className="tree-l2__actions">
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
                        {projSessions.length > 0 ? (
                          <VirtualList
                            className="tree-l3-list"
                            items={projSessions}
                            getKey={(s) => s.id}
                            rowHeight={sidebarRowMetrics.rowHeight}
                            gap={sidebarRowMetrics.gap}
                            scrollToKey={
                              session.sessionId &&
                              projSessions.some((x) => x.id === session.sessionId)
                                ? session.sessionId
                                : null
                            }
                            renderItem={(s) => {
                              const working = busyIds.has(s.id);
                              const checked = selectedSessionIds.has(s.id);
                              return (
                                <div
                                  className={
                                    "tree-l3" +
                                    (session.sessionId === s.id
                                      ? " tree-l3--active"
                                      : "") +
                                    (s.archived ? " tree-l3--archived" : "") +
                                    (working ? " tree-l3--working" : "") +
                                    (sessionSelectMode
                                      ? " tree-l3--select-mode"
                                      : "") +
                                    (checked ? " tree-l3--checked" : "")
                                  }
                                  role="button"
                                  tabIndex={0}
                                  aria-checked={
                                    sessionSelectMode ? checked : undefined
                                  }
                                  onClick={() => {
                                    if (sessionSelectMode) {
                                      toggleSessionSelected(s.id);
                                      return;
                                    }
                                    void openSession(s, proj);
                                  }}
                                  onContextMenu={(e) => openSessionMenu(e, s)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      if (sessionSelectMode) {
                                        e.preventDefault();
                                        toggleSessionSelected(s.id);
                                        return;
                                      }
                                      if (e.key === "Enter")
                                        void openSession(s, proj);
                                    }
                                  }}
                                >
                                  {sessionSelectMode ? (
                                    <span
                                      className={
                                        "tree-l3__check" +
                                        (checked ? " is-on" : "")
                                      }
                                      aria-hidden
                                    >
                                      {checked ? (
                                        <IconCheck size={11} stroke={2.4} />
                                      ) : null}
                                    </span>
                                  ) : null}
                                  <span className="tree-l3__title">
                                    {s.pinned ? (
                                      <span
                                        className="tree-l3__kind"
                                        title={tr("session.pinned")}
                                        aria-label={tr("session.pinned")}
                                      >
                                        <IconPin
                                          size={12}
                                          className="tree-l3__pin"
                                        />
                                      </span>
                                    ) : null}
                                    {s.scheduled ? (
                                      <span
                                        className="tree-l3__kind"
                                        title={tr("automations.msgTag")}
                                        aria-label={tr("automations.msgTag")}
                                      >
                                        <IconClock size={13} />
                                      </span>
                                    ) : null}
                                    <span className="tree-l3__name">
                                      {s.title || "Untitled"}
                                    </span>
                                  </span>
                                  {renderSessionRelativeTime(s.updatedAt)}
                                  {sessionSelectMode ? null : working ? (
                                    <Tip label={tr("sidebar.sessionWorking")}>
                                      <span
                                        className="tree-l3__status"
                                        aria-label={tr(
                                          "sidebar.sessionWorking",
                                        )}
                                      >
                                        <Spinner
                                          size={14}
                                          className="tree-l3__spinner"
                                        />
                                      </span>
                                    </Tip>
                                  ) : (
                                    <span className="tree-l3__actions tree-l3__actions--triple">
                                      <Tip
                                        label={
                                          s.pinned
                                            ? tr("session.unpin")
                                            : tr("session.pin")
                                        }
                                      >
                                        <button
                                          type="button"
                                          className="tree-icon-btn"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void pinSession(s, !s.pinned);
                                          }}
                                        >
                                          {s.pinned ? (
                                            <IconPinOff size={13} />
                                          ) : (
                                            <IconPin size={13} />
                                          )}
                                        </button>
                                      </Tip>
                                      <Tip
                                        label={
                                          s.archived
                                            ? tr("sidebar.unarchive")
                                            : tr("sidebar.archive")
                                        }
                                      >
                                        <button
                                          type="button"
                                          className="tree-icon-btn"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void archiveSession(
                                              s,
                                              !s.archived,
                                            );
                                          }}
                                        >
                                          <IconArchive size={13} />
                                        </button>
                                      </Tip>
                                      <Tip label={tr("sidebar.menu")}>
                                        <button
                                          type="button"
                                          className="tree-icon-btn"
                                          onClick={(e) =>
                                            openSessionMenu(e, s)
                                          }
                                        >
                                          <IconMore size={13} />
                                        </button>
                                      </Tip>
                                    </span>
                                  )}
                                </div>
                              );
                            }}
                          />
                        ) : null}
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
            </div>
            {historyOpen && orphanSessions.length > 0 ? (
              <VirtualList
                className="tree-orphan-list"
                items={orphanSessions}
                getKey={(s) => s.id}
                rowHeight={sidebarRowMetrics.rowHeight}
                gap={sidebarRowMetrics.gap}
                scrollToKey={
                  session.sessionId &&
                  orphanSessions.some((x) => x.id === session.sessionId)
                    ? session.sessionId
                    : null
                }
                renderItem={(s) => {
                  const working = busyIds.has(s.id);
                  const checked = selectedSessionIds.has(s.id);
                  return (
                    <div
                      className={
                        "tree-l3 tree-l3--orphan" +
                        (session.sessionId === s.id
                          ? " tree-l3--active"
                          : "") +
                        (working ? " tree-l3--working" : "") +
                        (sessionSelectMode
                          ? " tree-l3--select-mode"
                          : "") +
                        (checked ? " tree-l3--checked" : "")
                      }
                      role="button"
                      tabIndex={0}
                      aria-checked={
                        sessionSelectMode ? checked : undefined
                      }
                      onClick={() => {
                        if (sessionSelectMode) {
                          toggleSessionSelected(s.id);
                          return;
                        }
                        void openSession(s);
                      }}
                      onContextMenu={(e) => openSessionMenu(e, s)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          if (sessionSelectMode) {
                            e.preventDefault();
                            toggleSessionSelected(s.id);
                            return;
                          }
                          if (e.key === "Enter") void openSession(s);
                        }
                      }}
                    >
                      {sessionSelectMode ? (
                        <span
                          className={
                            "tree-l3__check" + (checked ? " is-on" : "")
                          }
                          aria-hidden
                        >
                          {checked ? (
                            <IconCheck size={11} stroke={2.4} />
                          ) : null}
                        </span>
                      ) : null}
                      <span className="tree-l3__title">
                        {s.pinned ? (
                          <span
                            className="tree-l3__kind"
                            title={tr("session.pinned")}
                            aria-label={tr("session.pinned")}
                          >
                            <IconPin
                              size={12}
                              className="tree-l3__pin"
                            />
                          </span>
                        ) : null}
                        {s.scheduled ? (
                          <span
                            className="tree-l3__kind"
                            title={tr("automations.msgTag")}
                            aria-label={tr("automations.msgTag")}
                          >
                            <IconClock size={13} />
                          </span>
                        ) : null}
                        <span className="tree-l3__name">
                          {s.title || "Untitled"}
                        </span>
                      </span>
                      {renderSessionRelativeTime(s.updatedAt)}
                      {sessionSelectMode ? null : working ? (
                        <Tip label={tr("sidebar.sessionWorking")}>
                          <span
                            className="tree-l3__status"
                            aria-label={tr("sidebar.sessionWorking")}
                          >
                            <Spinner
                              size={14}
                              className="tree-l3__spinner"
                            />
                          </span>
                        </Tip>
                      ) : (
                        <span className="tree-l3__actions tree-l3__actions--triple">
                          <Tip
                            label={
                              s.pinned
                                ? tr("session.unpin")
                                : tr("session.pin")
                            }
                          >
                            <button
                              type="button"
                              className="tree-icon-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                void pinSession(s, !s.pinned);
                              }}
                            >
                              {s.pinned ? (
                                <IconPinOff size={13} />
                              ) : (
                                <IconPin size={13} />
                              )}
                            </button>
                          </Tip>
                          <Tip label={tr("sidebar.archive")}>
                            <button
                              type="button"
                              className="tree-icon-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                void archiveSession(s, !s.archived);
                              }}
                            >
                              <IconArchive size={13} />
                            </button>
                          </Tip>
                          <button
                            type="button"
                            className="tree-icon-btn"
                            onClick={(e) => openSessionMenu(e, s)}
                          >
                            <IconMore size={13} />
                          </button>
                        </span>
                      )}
                    </div>
                  );
                }}
              />
            ) : null}
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
            account={account}
            activeProvider={activeCustomProvider}
            accountBusy={accountBusy}
            labels={{
              settings: tr("sidebar.settings"),
              theme: tr("user.theme"),
              themeLight: tr("user.themeLight"),
              themeDark: tr("user.themeDark"),
              local: tr("common.local"),
              signedIn: tr("account.signedIn"),
              signedOut: tr("account.signedOut"),
              login: tr("account.login"),
              logout: tr("account.logout"),
              remaining: tr("account.quotaRemaining"),
              customProvider: tr("prov.customProvider"),
              resetsAt: tr("account.resetsAt"),
            }}
            onSettings={() => navigateSettings()}
            onAccountSettings={() => navigateSettings("account")}
            onToggleTheme={toggleThemeBtn}
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
                }
              }}
            >
              <div className="user-avatar" aria-hidden>
                {activeCustomProvider
                  ? Array.from(
                      activeCustomProvider.name.trim() || activeCustomProvider.id,
                    )[0]?.toUpperCase() || "P"
                  : account?.profile
                    ? accountInitials(account.profile)
                    : "G"}
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
                  // Only show SuperGrok remaining when officially signed in.
                  if (customRouteActive || !account?.profile?.signedIn) return null;
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
            (dragZone === "sidebar" ? " is-drop-idle" : "")
          }
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
            onDoubleClick={() => {
              if (useCustomWindowChrome) void toggleMaximizeFromTitlebar();
            }}
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
                  {isMirrorClient() && (
                    <span
                      className={
                        "status-pill status-pill--" +
                        (mirrorLinkOk ? "ok" : "warn")
                      }
                      role="status"
                      title={
                        mirrorHostLabel
                          ? `${mirrorHostLabel} · ${
                              mirrorLinkOk
                                ? tr("mirror.chrome.connected")
                                : tr("mirror.chrome.reconnecting")
                            }`
                          : mirrorLinkOk
                            ? tr("mirror.chrome.connected")
                            : tr("mirror.chrome.reconnecting")
                      }
                    >
                      <span className="status-pill__dot" aria-hidden />
                      {mirrorLinkOk
                        ? mirrorHostLabel || tr("mirror.chrome.connected")
                        : tr("mirror.chrome.reconnecting")}
                    </span>
                  )}
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
                  {/* Retry progress only — connection is silent; thinking lives in chat */}
                  {retryStatus && (
                    <Tip
                      label={retryStatus.reason || tr("main.retrying", {
                        attempt: String(retryStatus.attempt),
                        max: String(retryStatus.maxRetries),
                      })}
                      disabled={!retryStatus.reason}
                    >
                      <span
                        className="main__sub main__sub--retry"
                        role="status"
                      >
                        {tr("main.retrying", {
                          attempt: String(retryStatus.attempt),
                          max: String(retryStatus.maxRetries),
                        })}
                      </span>
                    </Tip>
                  )}
                  {activeProject && mainPane === "chat" && !isMirrorClient() && (
                    <OpenLocationButton
                      path={activeProject.path}
                      target={defaultOpenTarget || "finder"}
                      onTargetChange={persistOpenTarget}
                      onOpenError={(e) => setLocalError(e)}
                      onCopied={() => {
                        setToast(tr("attach.copyPath") + " ✓");
                        window.setTimeout(() => setToast(null), 1600);
                      }}
                      platform={
                        platform === "win"
                          ? "win"
                          : platform === "mac"
                            ? "mac"
                            : "other"
                      }
                      labels={{
                        openLocation: tr("main.openLocation"),
                        openHint: tr("main.openLocationHint"),
                        openMenu: tr("main.openLocationMenu"),
                        finder:
                          platform === "win"
                            ? tr("main.openInExplorer")
                            : tr("main.openInFinder"),
                        systemDefault: tr("main.openSystemDefault"),
                        copyPath: tr("attach.copyPath"),
                      }}
                    />
                  )}
                  {mainPane === "chat" ? (
                    <Tip
                      label={
                        zenMode
                          ? tr("main.zenModeExit")
                          : tr("main.zenModeEnter")
                      }
                    >
                      <button
                        type="button"
                        className={
                          "chrome-btn main__pane-toggle" +
                          (zenMode ? " is-on" : "")
                        }
                        onClick={() => setZenModeEnabled(!zenMode)}
                        aria-pressed={zenMode}
                        aria-label={
                          zenMode
                            ? tr("main.zenModeExit")
                            : tr("main.zenModeEnter")
                        }
                        data-testid="zen-mode-toggle"
                      >
                        <IconZen size={16} />
                      </button>
                    </Tip>
                  ) : null}
                  {mainPane === "chat" && session.sessionId ? (
                    <Tip label={tr("session.collapseAllActivityHint")}>
                      <button
                        type="button"
                        className="chrome-btn main__pane-toggle"
                        onClick={() => dispatchCollapseAllActivity()}
                        aria-label={tr("session.collapseAllActivity")}
                        data-testid="collapse-all-activity"
                      >
                        <IconArrowsMinimize size={16} />
                      </button>
                    </Tip>
                  ) : null}
                  {mainPane === "chat" && session.sessionId ? (
                    <Tip
                      label={
                        tasksPanelOpen
                          ? tr("tasks.hidePanel")
                          : tr("tasks.showPanel")
                      }
                    >
                      <button
                        type="button"
                        className={
                          "chrome-btn main__pane-toggle" +
                          (tasksPanelOpen ? " is-on" : "")
                        }
                        onClick={() => setTasksPanelOpen((v) => !v)}
                        aria-pressed={tasksPanelOpen}
                        aria-label={
                          tasksPanelOpen
                            ? tr("tasks.hidePanel")
                            : tr("tasks.showPanel")
                        }
                      >
                        <IconList size={16} />
                        {runningTaskCount > 0 ? (
                          <span className="rp-chrome__badge" aria-hidden>
                            {Math.min(99, runningTaskCount)}
                          </span>
                        ) : null}
                      </button>
                    </Tip>
                  ) : null}
                  <Tip
                    label={
                      layout.asideCollapsed
                        ? tr("main.rightPaneShow")
                        : tr("main.rightPaneHide")
                    }
                  >
                    <button
                      type="button"
                      className={
                        "chrome-btn main__pane-toggle" +
                        (!layout.asideCollapsed ? " is-on" : "")
                      }
                      onClick={() => {
                        if (layout.asideCollapsed) {
                          openAsidePane();
                        } else {
                          setLayout((l) => {
                            const n = { ...l, asideCollapsed: true };
                            saveLayout(localStorage, n);
                            return n;
                          });
                        }
                      }}
                    >
                      <IconPanelRight size={16} />
                    </button>
                  </Tip>
                </>
              )}
            </div>
          </div>

          {mainPane === "automations" ? (
            <AutomationsPage
              t={(k, vars) =>
                tr(k as Parameters<typeof tr>[0], vars as Record<string, string | number>)
              }
              projects={projects.map((p) => ({ id: p.id, name: p.name }))}
              defaultModelId={modelId}
              defaultEffort={effort}
              models={availableModels}
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
            />
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
              entries={plan.entries}
              labels={{
                goal: tr("planBar.goal"),
                planMode: tr("planBar.planMode"),
                progress: tr("planBar.progress"),
                review: tr("planBar.review"),
                done: tr("planBar.done"),
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
              onRequestChanges={() => void requestPlanChanges()}
              onDismiss={() => void dismissPlan()}
              onClearGoal={() => setGoalMode(false)}
              onOpenDetails={() => openPlanInResource()}
            />
          )}

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
            <AgentTasksPanel
              messages={messages}
              t={(k, vars) => tr(k, vars)}
              onClose={() => setTasksPanelOpen(false)}
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
              onStopSession={(id) => {
                void (async () => {
                  try {
                    await api.sessionStop(id);
                    setLiveMap((lm) =>
                      settleStoppedSessionInLiveMap(lm, id),
                    );
                  } catch (e) {
                    showToast(String(e), 4000);
                  }
                })();
              }}
              onStopAllSessions={stopAllBusySessions}
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
          <ConversationThread
            locale={locale}
            messages={messages}
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
            onRegenerateAssistant={(msg) => {
              void regenerateLastAssistant(msg);
            }}
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
          />
          </UiErrorBoundary>

          <div
            ref={composerWrapRef}
            className={
              "composer-wrap composer-wrap--float" +
              (welcomeSession ? " composer-wrap--welcome" : "")
            }
          >
            {welcomeSession && welcomeBrandKind ? (
              <div className="composer-welcome-mark">
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
            <div
              className={
                "composer-stack" +
                (welcomeSession && !phoneLayout && activeProject
                  ? " composer-stack--with-context"
                  : "")
              }
            >
            {/* New session + project bound: project + branch/worktree above input.
                Hidden entirely when no project is selected. */}
            {welcomeSession && !phoneLayout && activeProject ? (
              <div
                className="composer__context-bar"
                aria-label={tr("composer.pickProject")}
              >
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
                      worktreeRemove: tr("composer.worktreeRemove"),
                      worktreeRemoveTip: tr("composer.worktreeRemoveTip"),
                    }}
                    onSwitch={(wt) => {
                      void switchToWorktree(wt);
                    }}
                    onCreate={() => openWorktreeCreate()}
                    onCreateAndChat={() =>
                      openWorktreeCreate({ startNewChat: true })
                    }
                    onGc={openWorktreeGc}
                    onRemove={confirmRemoveWorktree}
                    onOpen={refreshGitWorktrees}
                  />
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
              {sendQueue.activeQueue.length > 0 && (
                <div
                  className="composer__queue"
                  aria-label={tr("composer.queueCount", {
                    n: String(sendQueue.activeQueue.length),
                  })}
                >
                  <div className="composer__queue-head">
                    <IconClock size={14} aria-hidden />
                    <span className="composer__queue-title">
                      {tr("composer.queueCount", {
                        n: String(sendQueue.activeQueue.length),
                      })}
                    </span>
                    <button
                      type="button"
                      className="composer__queue-clear"
                      onClick={sendQueue.clearQueue}
                    >
                      {tr("composer.queueClear")}
                    </button>
                  </div>
                  {sendQueue.flushHold ? (
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
                    {sendQueue.activeQueue.map((item, idx) => (
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
                    ))}
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
                    skillsLoading={skillsLoading}
                    skillsError={skillsLoadError}
                    skillCount={slashCatalog.skills.length}
                    activeIndex={slashActiveIndex}
                    onActiveIndexChange={setSlashActiveIndex}
                    onSelectUpload={() => {
                      void pickComposerFiles();
                    }}
                    onSelectSlash={applySlashItem}
                    resolveTitle={resolveSlashTitle}
                    resolveDescription={resolveSlashDescription}
                    style={{
                      ...composerPlusStyle,
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
                    entries={promptHistoryEntries}
                    query={promptHistoryFilter}
                    activeIndex={promptHistoryActive}
                    focusFilter={promptHistoryFocusFilter}
                    labels={{
                      title: tr("promptHistory.title"),
                      placeholder: tr("promptHistory.placeholder"),
                      empty: tr("promptHistory.empty"),
                      emptyFilter: tr("promptHistory.emptyFilter"),
                      aria: tr("promptHistory.aria"),
                    }}
                    onQueryChange={setPromptHistoryFilter}
                    onActiveIndexChange={(i) => {
                      setPromptHistoryActive(i);
                      const entry = promptHistoryEntries[i];
                      if (entry && !promptHistoryFocusFilter) {
                        // Empty-↑ browse: mirror Build — each step lands in the input.
                        applyPromptHistoryEntry(entry, {
                          close: false,
                          listIndex: i,
                        });
                      }
                    }}
                    onSelect={(entry) => applyPromptHistoryEntry(entry)}
                    onClose={closePromptHistory}
                    style={{
                      ...promptHistoryStyle,
                      zIndex: 10050,
                    }}
                  />,
                  document.body,
                )}
              <ComposerEditor
                editorRef={composerInputRef}
                className="composer__input"
                value={draft}
                disabled={!canType(session.state)}
                spellCheck={composerSpellcheck}
                placeholder={
                  goalMode
                    ? tr("composer.goalPlaceholder")
                    : tr("composer.placeholder")
                }
                onChange={(next) => {
                  setDraft(next);
                  // Manual edit exits history browse; same text (DOM re-sync) keeps it.
                  const idx = promptHistoryIndexRef.current;
                  if (idx !== null) {
                    const hist = collectUserPromptHistory(messages);
                    if (next !== hist[idx]) {
                      promptHistoryIndexRef.current = null;
                      setPromptHistoryIndex(null);
                      // Keep the picker open so the user can re-pick; only leave browse index.
                    }
                  }
                }}
                onPasteFiles={(files) => {
                  void addAttachmentsFromFiles(files);
                }}
                onPasteMediaFallback={(opts) => {
                  void pasteMediaFromNativeClipboard(opts);
                }}
                onSlashQueryChange={onSlashQueryChange}
                onKeyDown={(e) => {
                  if (
                    e.nativeEvent.isComposing ||
                    (e.nativeEvent as KeyboardEvent).keyCode === 229
                  ) {
                    return;
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
                          Math.min(
                            Math.max(0, slashActiveIndex),
                            Math.max(0, n - 1),
                          )
                        ];
                      if (!entry) return;
                      if (entry.kind === "upload") void pickComposerFiles();
                      else applySlashItem(entry.item);
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
                        flat[
                          Math.min(
                            Math.max(0, slashActiveIndex),
                            n - 1,
                          )
                        ]!;
                      if (entry.kind === "upload") void pickComposerFiles();
                      else applySlashItem(entry.item);
                      return;
                    }
                  }
                  // Prompt history picker open: ↑/↓ move selection; Enter/Tab apply;
                  // Esc closes (Build `/history` + empty-↑).
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
                    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                      e.preventDefault();
                      if (promptHistoryEntries.length === 0) return;
                      if (e.key === "ArrowUp") {
                        const next = Math.min(
                          promptHistoryActive + 1,
                          promptHistoryEntries.length - 1,
                        );
                        setPromptHistoryActive(next);
                        const entry = promptHistoryEntries[next];
                        if (entry) {
                          applyPromptHistoryEntry(entry, {
                            close: false,
                            listIndex: next,
                          });
                        }
                        return;
                      }
                      // ArrowDown: newer; past newest closes like Build.
                      if (promptHistoryActive <= 0) {
                        promptHistoryIndexRef.current = null;
                        setPromptHistoryIndex(null);
                        setDraft("");
                        closePromptHistory();
                        return;
                      }
                      const next = promptHistoryActive - 1;
                      setPromptHistoryActive(next);
                      const entry = promptHistoryEntries[next];
                      if (entry) {
                        applyPromptHistoryEntry(entry, {
                          close: false,
                          listIndex: next,
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
                    const history = collectUserPromptHistory(messages);
                    const draftEmpty = isDraftEmpty(parseStoredContent(draft));
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
                    const hasBody =
                      !isDraftEmpty(parseStoredContent(draft)) ||
                      attachments.length > 0;
                    if (
                      hasBody &&
                      session.state !== "awaiting_permission"
                    ) {
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
                }}
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
                    <ComposerModelMenu
                      modelId={modelId}
                      effort={effort}
                      models={availableModels}
                      labels={{
                        model: tr("composer.model"),
                        effort: tr("composer.effort"),
                        effortHigh: tr("effort.high"),
                        effortMedium: tr("effort.medium"),
                        effortLow: tr("effort.low"),
                        modelSearchPlaceholder: tr(
                          "composer.modelSearchPlaceholder",
                        ),
                        modelSearchEmpty: tr("composer.modelSearchEmpty"),
                      }}
                      onModel={(v) => {
                        if (!isValidModelId(v, availableModels)) return;
                        setModelId(v);
                        void api
                          .composerPrefsSet({
                            projectId: activeProject?.id ?? null,
                            sessionId: session.sessionId ?? null,
                            modelId: v,
                          })
                          .catch((e) => showToast(String(e), 4000));
                      }}
                      onEffort={(v) => {
                        if (!isValidEffort(v)) return;
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
                        policyDontAsk: tr("policy.dont_ask"),
                        policyYolo: tr("policy.always_approve"),
                        policyAskDesc: tr("policy.askDesc"),
                        policyAcceptEditsDesc: tr("policy.accept_editsDesc"),
                        policySessionDesc: tr(
                          "policy.allow_for_sessionDesc",
                        ),
                        policyDontAskDesc: tr("policy.dont_askDesc"),
                        policyYoloDesc: tr("policy.always_approveDesc"),
                        policyShortAsk: tr("policy.short.ask"),
                        policyShortAccept: tr("policy.short.accept_edits"),
                        policyShortSession: tr(
                          "policy.short.allow_for_session",
                        ),
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
                        knownInput: tr("context.knownInput"),
                        knownOutput: tr("context.knownOutput"),
                        knownTotal: tr("context.knownTotal"),
                        knownFromAgent: tr("context.knownFromAgent"),
                      }}
                      onCompact={() => {
                        setCompactNote("");
                        setShowCompactModal(true);
                      }}
                    />
                  </>
                ) : null}
                {showComposerDraftStats &&
                !composerDraftStats.empty ? (
                  <span
                    className="composer__draft-stats"
                    aria-label={tr("composer.draftStatsAria", {
                      words: String(composerDraftStats.words),
                      chars: String(composerDraftStats.chars),
                    })}
                  >
                    {tr("composer.draftStats", {
                      words: String(composerDraftStats.words),
                      chars: String(composerDraftStats.chars),
                    })}
                  </span>
                ) : null}
                {!isDraftEmpty(parseStoredContent(draft)) ||
                attachments.length > 0 ? (
                  <Tip label={tr("composer.clearDraft")}>
                    <button
                      type="button"
                      className="icon-btn composer__clear-draft"
                      aria-label={tr("composer.clearDraft")}
                      onClick={() => requestClearComposerDraft()}
                    >
                      <IconClose size={14} />
                    </button>
                  </Tip>
                ) : null}
                <span className="composer__spacer" />
                {/* Dictation (mic) + Live Voice (headphones): official auth only. */}
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
                {voiceGate.available ? (
                  <Tip label={tr("voice.startLiveDesc")}>
                    <button
                      type="button"
                      className={
                        "icon-btn composer__voice composer__voice--live-mode" +
                        (liveVoiceOpen ? " composer__voice--live" : "")
                      }
                      disabled={liveVoiceOpen || voiceIsActive(voice.phase)}
                      aria-pressed={liveVoiceOpen}
                      aria-label={tr("voice.startLive")}
                      onClick={() => {
                        if (voiceIsActive(voice.phase)) {
                          cancelVoice();
                        }
                        setLiveVoiceOpen(true);
                      }}
                    >
                      <IconLiveVoice size={16} />
                    </button>
                  </Tip>
                ) : null}
                {effectiveCanStop ? (
                  <>
                    {sendQueue.canShowQueueButton(
                      session.state,
                      connecting,
                      !isDraftEmpty(parseStoredContent(draft)) ||
                        attachments.length > 0,
                    ) && (
                      <Tip label={tr("composer.queue")}>
                        <button
                          type="button"
                          className="icon-btn icon-btn--primary"
                          onClick={() => void send()}
                          aria-label={tr("composer.queue")}
                        >
                          <IconQueue size={16} />
                        </button>
                      </Tip>
                    )}
                    <Tip label={tr("composer.stop")}>
                      <button
                        type="button"
                        className="icon-btn icon-btn--danger"
                        onClick={() => void stop()}
                        aria-label={tr("composer.stop")}
                      >
                        <IconStop size={14} />
                      </button>
                    </Tip>
                  </>
                ) : (
                  <Tip label={tr("composer.send")}>
                    <button
                      type="button"
                      className="icon-btn icon-btn--primary"
                      disabled={
                        (!effectiveCanSend &&
                          !shouldEnqueueSend(session.state, connecting)) ||
                        (isDraftEmpty(parseStoredContent(draft)) &&
                          attachments.length === 0) ||
                        session.state === "awaiting_permission"
                      }
                      onClick={() => void send()}
                      aria-label={tr("composer.send")}
                    >
                      <IconSend size={16} />
                    </button>
                  </Tip>
                )}
              </div>
            </div>
            </div>
          </div>
          </div>
          </>
          )}
        </main>

        {/* RIGHT — session-linked project resource viewer (fully hideable + resizable) */}
        <aside
          className={
            (layout.asideCollapsed ? "aside aside--hidden" : "aside") +
            (resizingAside ? " is-resizing" : "") +
            (phoneLayout ? " aside--phone-overlay" : "")
          }
          aria-hidden={layout.asideCollapsed}
          style={
            !layout.asideCollapsed && !phoneLayout
              ? {
                  width: layout.asideWidth,
                  minWidth: layout.asideWidth,
                  maxWidth: layout.asideWidth,
                }
              : undefined
          }
        >
          {!layout.asideCollapsed && (
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
            <ResourceViewer
              projectPath={effectiveProjectPath}
              projectName={
                activeProject
                  ? projectDisplayName(activeProject, tr)
                  : tr("composer.noProject")
              }
              locale={locale}
              paneActive={!layout.asideCollapsed}
              openRequest={resourceOpenTarget}
              onOpenRequestConsumed={() => setResourceOpenTarget(null)}
              sessionChanges={
                sessionChangesById[session.sessionId || ""] ?? []
              }
              sessionMessages={messages}
              plan={plan}
              planFocusKey={planFocusKey}
              onApprovePlan={() => void approvePlan()}
              onRequestPlanChanges={() => void requestPlanChanges()}
              onDismissPlan={() => void dismissPlan()}
              onAsideLayoutHint={applyAsideLayoutHint}
              onClose={() => {
                // Manual close — do not treat as plan-owned pane on later dismiss.
                planOpenedAsideRef.current = false;
                setLayout((l) => {
                  const n = { ...l, asideCollapsed: true };
                  saveLayout(localStorage, n);
                  return n;
                });
              }}
            />
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
              policyAsk: tr("policy.ask"),
              policyAcceptEdits: tr("policy.accept_edits"),
              policySession: tr("policy.allow_for_session"),
              policyDontAsk: tr("policy.dont_ask"),
              policyYolo: tr("policy.always_approve"),
              effortHigh: tr("effort.high"),
              effortMedium: tr("effort.medium"),
              effortLow: tr("effort.low"),
              contextCurrent: tr("context.current"),
              contextUnknown: tr("phone.contextUnknown"),
              contextCompact: tr("context.compactAction"),
              sourceKnown: tr("context.sourceKnown"),
              sourceEstimated: tr("context.sourceEstimated"),
              sourceUnknown: tr("context.sourceUnknown"),
              back: tr("phone.toolsBack"),
            }}
            activeProject={activeProject}
            projects={projects}
            modelId={modelId}
            effort={effort}
            models={availableModels}
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
            onModel={(v) => {
              if (!isValidModelId(v, availableModels)) return;
              setModelId(v);
              void api
                .composerPrefsSet({
                  projectId: activeProject?.id ?? null,
                  sessionId: session.sessionId ?? null,
                  modelId: v,
                })
                .catch((e) => showToast(String(e), 4000));
            }}
            onEffort={(v) => {
              if (!isValidEffort(v)) return;
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
            }}
            hostLabel={mirrorHostLabel}
            linkOk={mirrorLinkOk}
            agentStatusLabel={tr(connPill.labelKey as MessageKey)}
            agentTone={connPill.tone}
            onOpenFiles={() => openAsidePane()}
          />
        </>
      ) : null}

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
      />
      <ProjectRulesModal
        open={!!projectRulesTarget}
        onClose={() => setProjectRulesTarget(null)}
        projectPath={projectRulesTarget?.path ?? null}
        projectName={projectRulesTarget?.name ?? null}
        locale={locale}
      />
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
          ).map((row) => (
            <li key={row.id} className="shortcuts-list__row">
              <span className="shortcuts-list__label">
                {tr(row.labelKey as MessageKey)}
              </span>
              <kbd className="shortcuts-list__keys">{row.keys}</kbd>
            </li>
          ))}
        </ul>
      </GlassModal>
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
        onClose={() => setLiveVoiceOpen(false)}
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
                  row = {
                    id: hit.id,
                    title: hit.title || tr("session.untitled"),
                    projectId: hit.projectId ?? null,
                  } as SessionRow;
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
      <AskUserModal
        payload={askUser}
        labels={{
          title: tr("askUser.title"),
          submit: tr("askUser.submit"),
          cancel: tr("askUser.cancel"),
          otherPlaceholder: tr("askUser.otherPlaceholder"),
          freeTextHint: tr("askUser.freeTextHint"),
          multiHint: tr("askUser.multiHint"),
          close: tr("common.close"),
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
      <McpStatusModal
        open={showMcpModal}
        locale={locale}
        servers={mcpServers}
        error={mcpError}
        loading={mcpLoading}
        onClose={() => setShowMcpModal(false)}
        onManage={() => navigateSettings("extensions")}
      />
      {rewindTimeline && (
        <div
          className="overlay"
          role="presentation"
          onClick={() => {
            if (!rewindBusy) setRewindTimeline(null);
          }}
        >
          <div
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
                        showToast(tr("session.rewindNoop"));
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
              disabled={exportMdBusy || !exportMdTarget}
              onClick={() => void runExportSessionMd("copy")}
            >
              {tr("session.exportMdCopy")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={exportMdBusy || !exportMdTarget}
              onClick={() => void runExportSessionMd("download")}
            >
              {exportMdBusy
                ? tr("session.exportMdWorking")
                : tr("session.exportMdDownload")}
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
          }}
        >
          <form
            className="modal compact-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="compact-modal-title"
            onSubmit={(e) => {
              e.preventDefault();
              const note = compactNote;
              setShowCompactModal(false);
              setCompactNote("");
              void (async () => {
                const cmd = note.trim()
                  ? `/compact ${note.trim()}`
                  : "/compact";
                try {
                  const sid = await ensureConnected();
                  if (!sid) return;
                  await api.sessionSend(cmd, null, sid);
                } catch (err) {
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
                }}
                aria-label={tr("common.close")}
              >
                <IconClose size={16} />
              </button>
            </header>
            <p className="compact-modal__msg">
              {tr("slash.compactConfirm")}
            </p>
            <input
              ref={compactNoteRef}
              className="compact-modal__field"
              value={compactNote}
              onChange={(e) => setCompactNote(e.target.value)}
              placeholder={tr("slash.compactNote")}
              autoFocus
              autoComplete="off"
            />
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  setShowCompactModal(false);
                  setCompactNote("");
                }}
              >
                {tr("slash.compactConfirmCancel")}
              </button>
              <button type="submit" className="btn btn--solid">
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
          onClick={() => setShowSearch(false)}
        >
          <div
            className="search-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={tr("sidebar.search")}
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
              {contentSearchLoading && searchQuery.trim()
                ? ` · ${tr("search.searchingContent")}`
                : null}
            </div>
            {mergedSessionHits.length === 0 && !contentSearchLoading && (
              <div className="sidebar-empty" style={{ padding: 12 }}>
                {tr("search.noMatches")}
              </div>
            )}
            {mergedSessionHits.map((hit, i) => {
              const s = sessions.find((x) => x.id === hit.id);
              // Content-only hits may lack a live row if the list is stale; still open by id.
              const row: SessionRow = s ?? {
                id: hit.id,
                title: hit.title,
                projectId: hit.projectId ?? null,
                updatedAt: "",
              };
              const proj = projects.find(
                (p) => p.id === (row.projectId ?? hit.projectId),
              );
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
                      {hit.title || s?.title || "Untitled"}
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
        if (ctxMenu?.kind === "project") {
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
                id: "reveal",
                label: tr("project.reveal"),
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
        } else if (ctxMenu?.kind === "session") {
          const s = sessions.find((x) => x.id === ctxMenu.id);
          if (s) {
            const isOpen =
              session.sessionId === s.id ||
              viewingSessionIdRef.current === s.id;
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
              {
                id: "rename",
                label: tr("session.rename"),
                icon: <IconRename size={16} />,
                onClick: () => renameSession(s),
              },
              {
                id: "fork",
                label: tr("session.fork"),
                icon: <IconFork size={16} />,
                onClick: () => confirmForkSession(s),
              },
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
              // Export group — not at top of menu (after edit/rename-style actions)
              {
                id: "export-md",
                label: tr("session.exportMd"),
                icon: <IconCopy size={16} />,
                onClick: () => {
                  openExportSessionMd({
                    id: s.id,
                    title: s.title,
                    projectId: s.projectId,
                  });
                },
              },
              {
                id: "export-json",
                label: tr("session.exportJson"),
                icon: <IconCopy size={16} />,
                onClick: () => {
                  void exportSessionJson({
                    id: s.id,
                    title: s.title,
                    projectId: s.projectId,
                  });
                },
              },
              {
                id: "export-trace",
                label: tr("session.exportTrace"),
                icon: <IconArchive size={16} />,
                onClick: () => {
                  void exportSessionTrace(s.id);
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
                id: "copy-id",
                label: tr("session.copyId"),
                icon: <IconCopy size={16} />,
                onClick: () => {
                  void copySessionId(s);
                },
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
          <ContextMenu
            open={!!ctxMenu && items.length > 0}
            x={ctxMenu?.x ?? 0}
            y={ctxMenu?.y ?? 0}
            onClose={() => setCtxMenu(null)}
            items={items}
            estimatedHeight={
              ctxMenu?.kind === "project-policy" ? 280 : 240
            }
          />
        );
      })()}

      <span hidden data-layout-default={JSON.stringify(DEFAULT_LAYOUT)} />
    </div>
    </ImageViewerProvider>
  );
}

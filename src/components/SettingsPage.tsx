/**
 * Full-page settings shell (ChatGPT-desktop style): left nav + content.
 * Back control returns to the workbench ("返回应用").
 * Section bodies live under `./settings/*` and consume SettingsModel context.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { nextIndex } from "@/lib/a11yFocus";
import {
  IconArrowLeft,
  IconChevronRight,
  IconSearch,
} from "@/components/icons";
import {
  listArchiveAgeOptionPreviews,
  hasAnyArchiveAgeMatches,
} from "@/lib/sessionArchiveAge";
import {
  loadThinkingExpandPref,
  type ThinkingExpandPref,
} from "@/lib/thinkingPref";
import type { ThemePreference } from "@/lib/theme";
import { DEFAULT_SANDBOX_PROFILE } from "@/lib/sandboxProfile";
import {
  deriveThemeScheduleHonesty,
  type ThemeScheduleConfig,
} from "@/lib/themeSchedule";
import {
  WallpaperPrepareError,
  prepareWallpaperFromFile,
} from "@/lib/themeSkin";
import {
  applyChatFontScale,
  loadChatFontScale,
  saveChatFontScale,
  type ChatFontScale,
} from "@/lib/chatFontScale";
import {
  applyCodeFontScale,
  loadCodeFontScale,
  saveCodeFontScale,
  type CodeFontScale,
} from "@/lib/codeFontScalePref";
import {
  applyUiFontFamily,
  loadUiFontFamily,
  saveUiFontFamily,
} from "@/lib/uiFontPref";
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  loadTerminalFontFamily,
  loadTerminalFontSize,
  saveTerminalFontFamily,
  saveTerminalFontSize,
} from "@/lib/terminalFontPref";
import {
  applyChatDensity,
  loadChatDensity,
  saveChatDensity,
  type ChatDensity,
} from "@/lib/chatDensity";
import {
  applyChatWidth,
  loadChatWidth,
  saveChatWidth,
  dispatchChatWidthChange,
  type ChatWidth,
} from "@/lib/chatWidthPref";
import {
  loadExportLogoPref,
  readImageFileAsDataUrl,
  saveExportLogoPref,
} from "@/lib/exportLogoPref";
import {
  applyComposerMinRows,
  loadComposerMinRows,
  saveComposerMinRows,
  type ComposerMinRows,
} from "@/lib/composerMinRows";
import {
  applySidebarDensity,
  loadSidebarDensity,
  saveSidebarDensity,
  type SidebarDensity,
} from "@/lib/sidebarDensity";
import type { WallpaperSourceTab } from "@/components/WallpaperSourceModal";
import { titlebarMaximizeHandlers } from "@/components/WindowControls";
import {
  loadComposerSendKeyPref,
  type ComposerSendKeyPref,
} from "@/lib/composerSendKey";
import {
  loadComposerDraftStatsPref,
} from "@/lib/draftStats";
import {
  loadComposerSpellcheck,
} from "@/lib/composerSpellcheck";
import type { DetectedEditor } from "@/lib/api";
import * as api from "@/lib/api";
import { GlassModal } from "@/components/GlassModal";
import {
  createT,
  resolveLocale,
  type MessageKey,
  type Vars,
} from "@/i18n";
import {
  loadCodeLineNumbersPref,
} from "@/lib/codeLineNumbersPref";
import {
  loadBackBottomAlwaysPref,
} from "@/lib/backBottomAlwaysPref";
import {
  loadSessionSearchRankPref,
} from "@/lib/sessionSearchRankPref";
import type { SessionSearchRankMode } from "@/lib/sessionSearch";
import {
  loadToolStepsAutoCollapsePref,
} from "@/lib/toolStepsAutoCollapsePref";
import {
  loadTranscriptFilterPref,
  type TranscriptFilterMode,
} from "@/lib/transcriptFilterPref";
import {
  loadCodeWrapPref,
} from "@/lib/codeWrapPref";
import {
  loadVoiceHotkeyEnabled,
} from "@/lib/voiceHotkeyPref";
import {
  loadConfirmExternalLinksPref,
} from "@/lib/externalLinkPref";
import {
  loadStopAllSkipConfirmPref,
} from "@/lib/stopAllSkipConfirmPref";
import {
  loadAlwaysQuitWithoutAskingPref,
} from "@/lib/confirmQuit";
import {
  loadNotifyQuietHoursPref,
  saveNotifyQuietHoursPref,
  type NotifyQuietHoursPref,
} from "@/lib/notifyQuietHours";
import {
  ensureNotifyPermission,
  refreshNotifyPermission,
  notificationSupport,
  takeLastNativeNotifyError,
} from "@/lib/desktopNotify";
import {
  deriveNotifyHonestySurface,
  deriveTrayBusyBadgeSurface,
  type NotifyOsPermission,
} from "@/lib/trayNotifyPro";
import {
  applyMessageActionsVisibility,
  loadMessageActionsVisibility,
  saveMessageActionsVisibility,
  type MessageActionsVisibility,
} from "@/lib/messageActionsPref";
import {
  SETTINGS_NAV,
  buildSettingsHash,
  defaultTabFor,
  getNavDef,
  resolveTab,
  searchSettingsEntries,
  type SettingsSectionId,
  type SettingsTabId,
} from "@/lib/settingsCatalog";
import { SettingsModelProvider } from "@/providers/SettingsModelContext";
import {
  NavIcon,
  formatSessionWhen,
  marqueeClientRect,
  rectsOverlap,
} from "@/components/settings/shared";
import type { MarqueeBox } from "@/components/settings/types";
import { GeneralSection } from "@/components/settings/GeneralSection";
import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { AccountSection } from "@/components/settings/AccountSection";
import { ArchivedSection } from "@/components/settings/ArchivedSection";
import { ExtensionsSection } from "@/components/settings/ExtensionsSection";
import { RemoteImSection } from "@/components/settings/RemoteImSection";
import { RuntimeSection } from "@/components/settings/RuntimeSection";
import { ShortcutsSection } from "@/components/settings/ShortcutsSection";
import { AboutSection } from "@/components/settings/AboutSection";

export type {
  SettingsSectionId,
  SettingsPageProps,
  ArchivedSessionRow,
  ArchivedProjectGroup,
} from "@/components/settings/types";
import type {
  SettingsPageProps,
  SettingsViewModel,
} from "@/components/settings/types";

export function SettingsPage({
  section: sectionGate,
  tab: tabGate,
  onSection: onSectionGate,
  onBack: onBackGate,
  phoneLayout: phoneLayoutGate,
  labels: labelsGate,
  locale: localeGate,
  focusAnchorId: focusAnchorIdGate,
  prHubHighlightPr: prHubHighlightPrGate,
  onFocusAnchorConsumed: onFocusAnchorConsumedGate,
  ...rest
}: SettingsPageProps) {
  const {


  section,
  tab: tabProp = null,
  onSection,
  onBack,
  phoneLayout = false,
  labels: _legacyLabels,
  locale,
  localePreference: localePreferenceProp,
  onLocale,
  theme,
  themePreference: themePreferenceProp,
  onTheme,
  themeSchedule: themeScheduleProp,
  onThemeSchedule,
  showMessageTimestamps = true,
  onShowMessageTimestamps,
  showReplyLength = false,
  onShowReplyLength,
  replaceProviderBrandLogo = false,
  onReplaceProviderBrandLogo,
  goalOrchUiEnabled = true,
  onGoalOrchUiEnabled,
  messageTimeFormat = "absolute",
  onMessageTimeFormat,
  sidebarShowRelativeTime = true,
  onSidebarShowRelativeTime,
  mutedSessionCount = 0,
  onClearAllSessionMutes,
  unreadSessionCount = 0,
  onClearAllSessionUnread,
  zenMode = false,
  onZenMode,
  skin = "default",
  onSkin,
  wallpaperUrl = null,
  wallpaperKind = null,
  wallpaperFocus = null,
  wallpaperClip = null,
  wallpaperMediaSize = null,
  wallpaperScrim = 100,
  onWallpaperScrim,
  onWallpaper,
  onWallpaperAdjust,
  onWallpaperMediaSize,
  sessionDataMode,
  onSessionDataMode,
  onCliSessionsImported,
  onOpenCliSession,
  policy,
  onPolicy,
  prefsScope = "global",
  onPrefsScope,
  availableModels = [],
  manualCliPath,
  onManualCliPath,
  onCliBlur,
  allowUnverifiedCliInstall = false,
  onAllowUnverifiedCliInstall,
  lastCliChecksumVerified = null,
  acpServerAddr,
  onAcpServerAddr,
  onAcpServerBlur,
  proxyMode = "system",
  onProxyMode,
  proxyUrl = "",
  onProxyUrl,
  proxyNoProxy = "",
  onProxyNoProxy,
  maxConcurrentAgents = 8,
  onMaxConcurrentAgents,
  lastProcessLimit = null,
  agentIdleMinutes = 30,
  onAgentIdleMinutes,
  streamStallSeconds = 600,
  onStreamStallSeconds,
  auditLedgerRetentionDays = 0,
  onAuditLedgerRetentionDays,
  includePartialMessages = false,
  onIncludePartialMessages,
  storeApiKeysInKeychain = false,
  onStoreApiKeysInKeychain,
  sandboxProfile = DEFAULT_SANDBOX_PROFILE,
  onSandboxProfile,
  onOpenSandboxWizard,
  maxAgentTurns = 0,
  onMaxAgentTurns,
  backgroundWaitPolicy = "wait",
  onBackgroundWaitPolicy,
  backgroundWaitTimeoutSec = 600,
  onBackgroundWaitTimeoutSec,
  preferredAgent = "",
  onPreferredAgent,
  agentProfilePath = "",
  onAgentProfilePath,
  onAgentProfilePathCommit,
  agentsJson = "",
  onAgentsJson,
  onAgentsJsonCommit,
  agentCatalog = [],
  experimentalMemory = false,
  onExperimentalMemory,
  compactionMode = "summary",
  onCompactionMode,
  compactionDetail = "verbose",
  onCompactionDetail,
  twoPassCompactionEnabled = false,
  onTwoPassCompactionEnabled,
  subagentsEnabled = true,
  onSubagentsEnabled,
  subagentWorktreeSnapshotEnabled = false,
  onSubagentWorktreeSnapshotEnabled,
  autoWakeEnabled = false,
  onAutoWakeEnabled,
  workflowsEnabled = false,
  onWorkflowsEnabled,
  planEnabled = true,
  onPlanEnabled,
  todoGateEnabled = false,
  onTodoGateEnabled,
  todoGateMaxFiresPerPrompt = 3,
  onTodoGateMaxFiresPerPrompt,
  todoGateFireSignal = null,
  disableWebSearch = false,
  onDisableWebSearch,
  noAskUser = false,
  onNoAskUser,
  disallowedTools = [],
  onDisallowedTools,
  allowedTools = [],
  onAllowedTools,
  useLeader = false,
  onUseLeader,
  voiceId = "eve",
  onVoiceId,
  voiceDictationAutoSend = false,
  onVoiceDictationAutoSend,
  voiceKeepAgentsOnEnd = true,
  onVoiceKeepAgentsOnEnd,
  reopenLastSession = true,
  onReopenLastSession,
  closeToTray = true,
  onCloseToTray,
  keepTrayForSchedules = true,
  onKeepTrayForSchedules,
  trayBusyBadge = true,
  onTrayBusyBadge,
  trayBusyCount = 0,
  launchAtLogin = false,
  onLaunchAtLogin,
  windowAlwaysOnTop = false,
  onWindowAlwaysOnTop,
  notifyOnTurnDone = true,
  onNotifyOnTurnDone,
  notifyOnPermission = true,
  onNotifyOnPermission,
  notifySound = false,
  onNotifySound,
  permissionTimeoutSec = 0,
  onPermissionTimeoutSec,
  askUserTimeoutSec = 0,
  onAskUserTimeoutSec,
  cliInfo,
  cliAgentSkewRepairing = false,
  onCliRepairAgentSidecar,
  onDoctor,
  onOpenReliability,
  onOpenBatchAgents,
  costRollupSessions = [],
  costRollupProjects = [],
  versionFooter,
  account,
  accountLoading,
  accountBusy,
  accountHeatmapError = null,
  accountProbeError = null,
  loginHint = null,
  savedAccounts = [],
  activeAccountId = null,
  onAccountLoginOauth,
  onAccountLoginDevice,
  onAccountLoginSubmitCode,
  onCancelLogin,
  onAccountLogout,
  onAccountRefresh,
  onAccountManageUsage,
  onAccountSubscribe,
  onSaveAccount,
  onAddAccount,
  onSwitchAccount,
  onRemoveAccount,
  onImportChat,
  defaultOpenTarget = "finder",
  onDefaultOpenTarget,
  onProvidersChanged,
  onProviderActivated,
  onProviderBalanceLoaded,
  archivedGroups = [],
  onRestoreArchivedSessions,
  onDeleteArchivedSessions,
  onArchiveOlderThan,
  archiveAgeSessions = [],
  projectPath = null,
  onOpenProjectFileInResources,
  focusAnchorId = null,
  prHubHighlightPr = null,
  onFocusAnchorConsumed,
  onSkillsPrefsChanged,
  onOpenShortcutsHelp,
  onOpenProductTutorial,
  trustedProjects = [],

  
  } = { section: sectionGate, tab: tabGate, onSection: onSectionGate, onBack: onBackGate, phoneLayout: phoneLayoutGate, labels: labelsGate, locale: localeGate, focusAnchorId: focusAnchorIdGate, prHubHighlightPr: prHubHighlightPrGate, onFocusAnchorConsumed: onFocusAnchorConsumedGate, ...rest } as SettingsPageProps;

  const [query, setQuery] = useState("");
  /** Client-side validation error for Agents JSON (invalid blocks save). */
  const [agentsJsonError, setAgentsJsonError] = useState<string | null>(null);
  const [agentsJsonSaving, setAgentsJsonSaving] = useState(false);
  /** Composer empty min-height (rows) — localStorage only (no AppSettings). */
  const [composerMinRows, setComposerMinRowsState] = useState<ComposerMinRows>(
    () => loadComposerMinRows(),
  );
  useEffect(() => {
    applyComposerMinRows(loadComposerMinRows());
  }, []);
  const onComposerMinRows = useCallback((next: ComposerMinRows) => {
    setComposerMinRowsState(next);
    saveComposerMinRows(next);
    applyComposerMinRows(next);
  }, []);
  /** Composer Enter vs ⌘/Ctrl+Enter — localStorage only (no Host settings). */
  const [composerSendKeyPref, setComposerSendKeyPref] =
    useState<ComposerSendKeyPref>(() => loadComposerSendKeyPref());
  /** Browser spellcheck on main composer — localStorage only. */
  const [composerSpellcheck, setComposerSpellcheck] = useState(() =>
    loadComposerSpellcheck(),
  );
  /** Show muted char/word count on non-empty drafts — localStorage only. */
  const [composerDraftStats, setComposerDraftStats] = useState(() =>
    loadComposerDraftStatsPref(),
  );
  /** Pending scroll target after search jump / deep link. */
  const pendingAnchorRef = useRef<string | null>(null);
  const [highlightAnchor, setHighlightAnchor] = useState<string | null>(null);

  // External focus (ship → PR hub): queue scroll when prop arrives.
  // Same-tab re-entry still works because the scroll effect also depends on
  // focusAnchorId (not only section/tab).
  useEffect(() => {
    const a = (focusAnchorId ?? "").trim();
    if (!a) return;
    pendingAnchorRef.current = a;
  }, [focusAnchorId]);
  /**
   * Phone drill-down: "index" = section list only; "detail" = one section full-width.
   * Always start on the index so opening 設定 never lands on a squeezed two-column pane.
   */
  const [phonePane, setPhonePane] = useState<"index" | "detail">("index");
  const [editors, setEditors] = useState<DetectedEditor[]>([]);
  const [clearMemoryOpen, setClearMemoryOpen] = useState(false);
  const [clearMemoryBusy, setClearMemoryBusy] = useState(false);
  /** Bump to remount MemoryBrowserPanel after clear-all. */
  const [memoryBrowserEpoch, setMemoryBrowserEpoch] = useState(0);
  const [settingsToast, setSettingsToast] = useState<string | null>(null);
  /** Phone-mirror stop / enable-write confirm (settings → remote control → mirror). */
  const [mirrorConfirm, setMirrorConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);
  /** Selected archived session ids (settings → archived multi-select). */
  const [archivedSelected, setArchivedSelected] = useState<Set<string>>(
    () => new Set(),
  );
  /** Rubber-band marquee (client coords) while dragging on the list surface. */
  const [marquee, setMarquee] = useState<MarqueeBox | null>(null);
  const archivedSurfaceRef = useRef<HTMLDivElement>(null);
  const wallpaperInputRef = useRef<HTMLInputElement>(null);
  const [wallpaperBusy, setWallpaperBusy] = useState(false);
  const [wallpaperError, setWallpaperError] = useState<string | null>(null);
  const [wallpaperFocusOpen, setWallpaperFocusOpen] = useState(false);
  const [wallpaperSourceOpen, setWallpaperSourceOpen] = useState(false);
  const [wallpaperSourceTab, setWallpaperSourceTab] =
    useState<WallpaperSourceTab>("x");
  /** Thinking block expand preference (localStorage; self-contained). */
  const [thinkingExpand, setThinkingExpand] = useState<ThinkingExpandPref>(
    () => loadThinkingExpandPref(),
  );
  /** Finished tool steps auto-collapse (localStorage; default on). */
  const [toolStepsAutoCollapse, setToolStepsAutoCollapse] = useState(() =>
    loadToolStepsAutoCollapsePref(),
  );
  /** Transcript paint filter — all activity vs conversation only. */
  const [transcriptFilter, setTranscriptFilter] =
    useState<TranscriptFilterMode>(() => loadTranscriptFilterPref());
  /** Chat transcript font scale — localStorage only (no AppSettings). */
  const [chatFontScale, setChatFontScaleState] = useState<ChatFontScale>(() =>
    loadChatFontScale(),
  );
  useEffect(() => {
    // Re-apply on mount so Settings preview / document stay consistent.
    applyChatFontScale(loadChatFontScale());
  }, []);
  const onChatFontScale = useCallback((next: ChatFontScale) => {
    setChatFontScaleState(next);
    saveChatFontScale(next);
    applyChatFontScale(next);
  }, []);
  /** Chat code-block font scale — localStorage only (no AppSettings). */
  const [codeFontScale, setCodeFontScaleState] = useState<CodeFontScale>(() =>
    loadCodeFontScale(),
  );
  useEffect(() => {
    applyCodeFontScale(loadCodeFontScale());
  }, []);
  const onCodeFontScale = useCallback((next: CodeFontScale) => {
    setCodeFontScaleState(next);
    saveCodeFontScale(next);
    applyCodeFontScale(next);
  }, []);
  /** UI / terminal font families — localStorage only (#553). */
  const [uiFontFamily, setUiFontFamilyState] = useState(() => loadUiFontFamily());
  const [terminalFontFamily, setTerminalFontFamilyState] = useState(() =>
    loadTerminalFontFamily(),
  );
  const [terminalFontSize, setTerminalFontSizeState] = useState(() =>
    loadTerminalFontSize(),
  );
  useEffect(() => {
    applyUiFontFamily(loadUiFontFamily());
  }, []);
  const onUiFontFamily = useCallback((next: string) => {
    setUiFontFamilyState(next);
    saveUiFontFamily(next);
    applyUiFontFamily(next);
  }, []);
  const onTerminalFontFamily = useCallback((next: string) => {
    setTerminalFontFamilyState(next);
    saveTerminalFontFamily(next);
  }, []);
  const onTerminalFontSize = useCallback((next: number) => {
    setTerminalFontSizeState(next);
    saveTerminalFontSize(next);
  }, []);
  const onResetTerminalFont = useCallback(() => {
    setTerminalFontFamilyState("");
    saveTerminalFontFamily("");
    setTerminalFontSizeState(DEFAULT_TERMINAL_FONT_SIZE);
    saveTerminalFontSize(DEFAULT_TERMINAL_FONT_SIZE);
  }, []);
  const onResetUiFont = useCallback(() => {
    setUiFontFamilyState("");
    saveUiFontFamily("");
    applyUiFontFamily("");
  }, []);
  /** Chat transcript density — localStorage only (no AppSettings). */
  const [chatDensity, setChatDensityState] = useState<ChatDensity>(() =>
    loadChatDensity(),
  );
  useEffect(() => {
    applyChatDensity(loadChatDensity());
  }, []);
  const onChatDensity = useCallback((next: ChatDensity) => {
    setChatDensityState(next);
    saveChatDensity(next);
    applyChatDensity(next);
  }, []);
  /** Chat transcript reading width — localStorage only (no AppSettings). */
  const [chatWidth, setChatWidthState] = useState<ChatWidth>(() =>
    loadChatWidth(),
  );
  useEffect(() => {
    applyChatWidth(loadChatWidth());
  }, []);
  const onChatWidth = useCallback((next: ChatWidth) => {
    setChatWidthState(next);
    saveChatWidth(next);
    applyChatWidth(next);
    dispatchChatWidthChange(next);
  }, []);
  /** Share-card export logo — localStorage data URL (no AppSettings). */
  const [exportLogo, setExportLogo] = useState<string | null>(() =>
    loadExportLogoPref(),
  );
  const exportLogoInputRef = useRef<HTMLInputElement | null>(null);
  /** Sidebar session list density — localStorage only (no AppSettings). */
  const [sidebarDensity, setSidebarDensityState] = useState<SidebarDensity>(
    () => loadSidebarDensity(),
  );
  useEffect(() => {
    applySidebarDensity(loadSidebarDensity());
  }, []);
  const onSidebarDensity = useCallback((next: SidebarDensity) => {
    setSidebarDensityState(next);
    saveSidebarDensity(next);
    applySidebarDensity(next);
  }, []);
  /** Chat code-block wrap default — frontend-only localStorage. */
  const [codeWrapDefault, setCodeWrapDefault] = useState(() =>
    loadCodeWrapPref(),
  );
  /** Chat code-block line numbers — frontend-only localStorage. */
  const [codeLineNumbers, setCodeLineNumbers] = useState(() =>
    loadCodeLineNumbersPref(),
  );
  /** Always-show back-to-bottom control — frontend-only localStorage. */
  const [backBottomAlways, setBackBottomAlways] = useState(() =>
    loadBackBottomAlwaysPref(),
  );
  /** Session search ranking (keyword vs local hybrid) — frontend-only. */
  const [sessionSearchRank, setSessionSearchRank] =
    useState<SessionSearchRankMode>(() => loadSessionSearchRankPref());
  /** Live Voice catalog hotkey on/off — frontend-only localStorage. */
  const [voiceHotkeyEnabled, setVoiceHotkeyEnabled] = useState(() =>
    loadVoiceHotkeyEnabled(),
  );
  const [confirmExternalLinks, setConfirmExternalLinks] = useState(() =>
    loadConfirmExternalLinksPref(),
  );
  /** Skip Stop-all confirm — frontend-only localStorage. */
  const [stopAllSkipConfirm, setStopAllSkipConfirm] = useState(() =>
    loadStopAllSkipConfirmPref(),
  );
  /** Skip busy-quit confirm — frontend-only localStorage. */
  const [alwaysQuitWithoutAsking, setAlwaysQuitWithoutAsking] = useState(() =>
    loadAlwaysQuitWithoutAskingPref(),
  );
  /** Desktop notification quiet hours — localStorage only. */
  const [notifyQuietHours, setNotifyQuietHours] =
    useState<NotifyQuietHoursPref>(() => loadNotifyQuietHoursPref());
  /** OS Notification.permission — refreshed after Request permission. */
  const [notifyOsPermission, setNotifyOsPermission] =
    useState<NotifyOsPermission>(() => notificationSupport());
  const [notifyPermBusy, setNotifyPermBusy] = useState(false);
  // Re-check quiet-hours "active now" about once a minute while Settings is open.
  const [notifyClockMs, setNotifyClockMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNotifyClockMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  // Re-probe OS permission when Settings mounts: Tauri's notification plugin
  // polyfill resolves async after load (starts default → granted on desktop).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await refreshNotifyPermission();
      if (!cancelled) setNotifyOsPermission(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const trayBusySurface = useMemo(
    () =>
      deriveTrayBusyBadgeSurface({
        enabled: !!trayBusyBadge,
        busyCount: trayBusyCount,
      }),
    [trayBusyBadge, trayBusyCount],
  );
  const notifyHonesty = useMemo(
    () =>
      deriveNotifyHonestySurface({
        permission: notifyOsPermission,
        prefs: {
          notifyOnTurnDone,
          notifyOnPermission,
        },
        soundEnabled: !!notifySound,
        quietHours: notifyQuietHours,
        now: new Date(notifyClockMs),
      }),
    [
      notifyOsPermission,
      notifyOnTurnDone,
      notifyOnPermission,
      notifySound,
      notifyQuietHours,
      notifyClockMs,
    ],
  );
  const requestNotifyPermission = useCallback(async () => {
    if (notifyPermBusy) return;
    setNotifyPermBusy(true);
    try {
      // ensureNotifyPermission re-requests under Tauri even if a bare WebView
      // previously cached "denied"; refresh re-probes the native plugin.
      await ensureNotifyPermission();
      const next = await refreshNotifyPermission();
      setNotifyOsPermission(next);
    } finally {
      setNotifyPermBusy(false);
    }
  }, [notifyPermBusy]);
  const [notifyTestBusy, setNotifyTestBusy] = useState(false);
  const onNotifyQuietHours = useCallback((next: NotifyQuietHoursPref) => {
    setNotifyQuietHours(next);
    saveNotifyQuietHoursPref(next);
  }, []);
  /** Message action buttons: hover vs always visible. */
  const [messageActionsVisibility, setMessageActionsVisibilityState] =
    useState<MessageActionsVisibility>(() => loadMessageActionsVisibility());
  useEffect(() => {
    applyMessageActionsVisibility(loadMessageActionsVisibility());
  }, []);
  const onMessageActionsVisibility = useCallback(
    (next: MessageActionsVisibility) => {
      setMessageActionsVisibilityState(next);
      saveMessageActionsVisibility(next);
      applyMessageActionsVisibility(next);
    },
    [],
  );

  const marqueeRef = useRef<{
    active: boolean;
    dragging: boolean;
    additive: boolean;
    base: Set<string>;
    box: MarqueeBox;
    pointerId: number;
  } | null>(null);
  // Full catalog via createT — do not depend on App's partial `labels` whitelist
  // (missing keys used to render raw "settings.acpServer" etc.).
  // `locale` is the resolved catalog locale (never "system").
  const tr = useMemo(() => createT(resolveLocale(locale)), [locale]);
  const t = useCallback(
    (k: string, vars?: Vars) => tr(k as MessageKey, vars),
    [tr],
  );
  /** Language Select: durable preference including "system". */
  const localePreference = localePreferenceProp ?? locale;
  /** Segment selection: prefer explicit preference; fall back to resolved theme. */
  const themePreference: ThemePreference =
    themePreferenceProp ?? theme;
  const themeSchedule: ThemeScheduleConfig = themeScheduleProp ?? {
    enabled: false,
    lightFrom: "07:00",
    darkFrom: "19:00",
  };
  /** Clock honesty for schedule soft-fail / next-switch preview (local wall clock). */
  const [themeScheduleClock, setThemeScheduleClock] = useState(
    () => new Date(),
  );
  useEffect(() => {
    if (!themeSchedule.enabled) return;
    setThemeScheduleClock(new Date());
    const id = window.setInterval(() => setThemeScheduleClock(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, [themeSchedule.enabled, themeSchedule.lightFrom, themeSchedule.darkFrom]);
  const themeScheduleHonesty = useMemo(
    () =>
      deriveThemeScheduleHonesty({
        preference: themePreference,
        schedule: themeSchedule,
        now: themeScheduleClock,
      }),
    [themePreference, themeSchedule, themeScheduleClock],
  );

  const workspaceCwd = (projectPath || "").trim() || null;
  const showSettingsToast = useCallback((msg: string, ms = 3500) => {
    setSettingsToast(msg);
    window.setTimeout(() => setSettingsToast(null), ms);
  }, []);
  const testDesktopNotification = useCallback(async () => {
    if (notifyTestBusy) return;
    setNotifyTestBusy(true);
    try {
      await ensureNotifyPermission();
      const next = await refreshNotifyPermission();
      setNotifyOsPermission(next);
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const path = await invoke<string>("desktop_notify_show", {
          title: t("settings.notify.honesty.test"),
          body: t("settings.notify.honesty.testOk"),
          sessionId: null,
        });
        // Honest path-specific copy: bare tauri dev → Script Editor; .app → Grok.
        if (path === "osascript") {
          showSettingsToast(t("settings.notify.honesty.testOk.osascript"), 8000);
        } else if (
          path === "unusernotification" ||
          path === "nsusernotification"
        ) {
          showSettingsToast(t("settings.notify.honesty.testOk.native"), 6000);
        } else {
          showSettingsToast(t("settings.notify.honesty.testOk"), 5000);
        }
      } catch (e) {
        const detail =
          takeLastNativeNotifyError() ||
          (e instanceof Error ? e.message : String(e));
        showSettingsToast(
          detail
            ? `${t("settings.notify.honesty.testFail")} (${detail})`
            : t("settings.notify.honesty.testFail"),
          7000,
        );
      }
    } finally {
      setNotifyTestBusy(false);
    }
  }, [notifyTestBusy, t, showSettingsToast]);
  const runClearWorkspaceMemory = useCallback(async () => {
    if (!workspaceCwd || clearMemoryBusy) return;
    setClearMemoryBusy(true);
    try {
      await api.memoryClear({ cwd: workspaceCwd, scope: "workspace" });
      setClearMemoryOpen(false);
      setMemoryBrowserEpoch((n) => n + 1);
    } catch (e) {
      showSettingsToast(String(e), 4500);
    } finally {
      setClearMemoryBusy(false);
    }
  }, [workspaceCwd, clearMemoryBusy, showSettingsToast, t]);

  const onExportLogoFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      try {
        const dataUrl = await readImageFileAsDataUrl(file);
        saveExportLogoPref(dataUrl);
        setExportLogo(dataUrl);
      } catch (e) {
        const msg = String(e);
        if (msg.includes("too-large")) {
          showSettingsToast(t("settings.exportLogoTooLarge"), 4000);
        } else {
          showSettingsToast(t("settings.exportLogoInvalid"), 4000);
        }
      } finally {
        if (exportLogoInputRef.current) exportLogoInputRef.current.value = "";
      }
    },
    [showSettingsToast, t],
  );
  const onClearExportLogo = useCallback(() => {
    saveExportLogoPref(null);
    setExportLogo(null);
    if (exportLogoInputRef.current) exportLogoInputRef.current.value = "";
  }, []);

  const wallpaperErrorMessage = useCallback(
    (err: unknown): string => {
      if (err instanceof WallpaperPrepareError) {
        const key = `settings.wallpaper.err.${err.code}` as MessageKey;
        const msg = t(key);
        return msg === key ? t("settings.wallpaper.err.generic") : msg;
      }
      return t("settings.wallpaper.err.generic");
    },
    [t],
  );

  const openWallpaperSource = useCallback((tab: WallpaperSourceTab) => {
    setWallpaperError(null);
    setWallpaperSourceTab(tab);
    setWallpaperSourceOpen(true);
  }, []);

  const onWallpaperFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file || !onWallpaper) return;
      setWallpaperBusy(true);
      setWallpaperError(null);
      try {
        const record = await prepareWallpaperFromFile(file);
        await onWallpaper(record);
      } catch (e) {
        setWallpaperError(wallpaperErrorMessage(e));
        // Re-throw so WallpaperSourceModal can show the same error inline
        // instead of closing as if apply succeeded.
        throw e;
      } finally {
        setWallpaperBusy(false);
        if (wallpaperInputRef.current) wallpaperInputRef.current.value = "";
      }
    },
    [onWallpaper, wallpaperErrorMessage],
  );

  useEffect(() => {
    if (!api.isTauri()) return;
    void api.editorsList().then((r) => setEditors(r.editors ?? [])).catch(() => {});
    let unlisten: (() => void) | undefined;
    void api
      .listen<api.EditorsListResult>("editors://updated", (payload) => {
        setEditors(payload.editors ?? []);
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      unlisten?.();
    };
  }, []);

  // Reset to index when leaving phone layout (e.g. rotate to desktop width).
  useEffect(() => {
    if (!phoneLayout) setPhonePane("index");
  }, [phoneLayout]);

  // Hardware / browser back: detail → index (cheap history entry on open).
  useEffect(() => {
    if (!phoneLayout) return;
    const onPopState = () => {
      setPhonePane((pane) => (pane === "detail" ? "index" : pane));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [phoneLayout]);

  /** Props → resolved tab (deep link / parent hash). */
  const tabFromProps = useMemo(
    () => resolveTab(section, tabProp),
    [section, tabProp],
  );
  /**
   * Local tab is the source of truth for in-page clicks so the strip reacts
   * immediately. Parent/hash stay in sync via onSection; props re-sync when
   * the section changes or a deep link arrives.
   */
  const [localTab, setLocalTab] = useState<SettingsTabId | null>(tabFromProps);
  useEffect(() => {
    setLocalTab(tabFromProps);
  }, [section, tabFromProps]);

  const activeTab = localTab ?? tabFromProps;
  const sectionNav = useMemo(() => getNavDef(section), [section]);

  const navigateTo = useCallback(
    (
      id: SettingsSectionId,
      nextTab?: string | null,
      anchorId?: string | null,
    ) => {
      if (anchorId) pendingAnchorRef.current = anchorId;
      const resolved = resolveTab(id, nextTab ?? defaultTabFor(id));
      // Optimistic: update strip/content before parent re-renders.
      if (id === section) {
        setLocalTab(resolved);
      } else {
        // Leaving section — next paint will sync from props; set optimistically.
        setLocalTab(resolved);
      }
      onSection(id, resolved);
      // Keep hash in sync even if the parent handler only stores section.
      if (typeof window !== "undefined") {
        const hash = buildSettingsHash({ section: id, tab: resolved });
        if (window.location.hash !== hash) {
          window.location.hash = hash;
        }
      }
      if (!phoneLayout) return;
      setPhonePane("detail");
      try {
        window.history.pushState(
          { settingsPhone: "detail", section: id },
          "",
          buildSettingsHash({ section: id, tab: resolved }),
        );
      } catch {
        /* ignore */
      }
    },
    [onSection, phoneLayout, section],
  );

  const openSection = useCallback(
    (id: SettingsSectionId) => {
      navigateTo(id, defaultTabFor(id));
    },
    [navigateTo],
  );

  const setSectionTab = useCallback(
    (next: SettingsTabId) => {
      // Always resolve against *current* section; never drop the tab arg.
      navigateTo(section, next);
    },
    [navigateTo, section],
  );

  // Scroll + brief highlight after tab/section paint or external focus.
  useEffect(() => {
    const anchor = pendingAnchorRef.current;
    if (!anchor) return;
    const timer = window.setTimeout(() => {
      const el = document.getElementById(anchor);
      if (!el) {
        // Content not painted yet — keep pending for the next section/tab paint.
        return;
      }
      pendingAnchorRef.current = null;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setHighlightAnchor(anchor);
      window.setTimeout(() => setHighlightAnchor(null), 1600);
      onFocusAnchorConsumed?.();
    }, 60);
    return () => window.clearTimeout(timer);
    // focusAnchorId: re-run when ship deep-link re-focuses the same tab.
  }, [section, activeTab, focusAnchorId, onFocusAnchorConsumed]);

  const backToPhoneIndex = useCallback(() => {
    if (!phoneLayout) return;
    if (phonePane === "detail") {
      // Prefer history.back so Android/browser back stack stays consistent.
      const st = window.history.state as { settingsPhone?: string } | null;
      if (st?.settingsPhone === "detail") {
        window.history.back();
        return;
      }
    }
    setPhonePane("index");
  }, [phoneLayout, phonePane]);

  const trimmedQuery = query.trim();

  /** English catalog: keeps "theme" / "permission" searchable in a zh UI too. */
  const tEn = useMemo(() => createT("en"), []);

  const searchHits = useMemo(
    () =>
      trimmedQuery
        ? searchSettingsEntries(
            trimmedQuery,
            (k) => t(k),
            (k) => tEn(k),
          )
        : [],
    [trimmedQuery, t, tEn],
  );

  const hitSections = useMemo(() => {
    if (!trimmedQuery) return null;
    return new Set(searchHits.map((h) => h.entry.section));
  }, [trimmedQuery, searchHits]);

  const nav = useMemo(() => {
    if (!hitSections) return [...SETTINGS_NAV];
    return SETTINGS_NAV.filter((n) => hitSections.has(n.id));
  }, [hitSections]);

  const personalNav = useMemo(
    () => nav.filter((n) => n.group === "personal"),
    [nav],
  );
  const systemNav = useMemo(
    () => nav.filter((n) => n.group === "system"),
    [nav],
  );

  const jumpToHit = useCallback(
    (sectionId: SettingsSectionId, tab?: SettingsTabId, anchorId?: string) => {
      setQuery("");
      navigateTo(sectionId, tab ?? defaultTabFor(sectionId), anchorId ?? null);
    },
    [navigateTo],
  );

  const rowHighlight = useCallback(
    (anchorId: string) =>
      highlightAnchor === anchorId ? " is-search-hit" : "",
    [highlightAnchor],
  );
  /** Searching with zero hits: show an explicit empty state, never bare headers. */
  const searchEmpty = trimmedQuery.length > 0 && nav.length === 0;

  const archivedAllIds = useMemo(
    () => archivedGroups.flatMap((g) => g.sessions.map((s) => s.id)),
    [archivedGroups],
  );

  const archivedTotal = archivedAllIds.length;

  /** Live preview counts for archive-by-age day chips (pure helpers). */
  const archiveAgePreviews = useMemo(
    () => listArchiveAgeOptionPreviews(archiveAgeSessions),
    [archiveAgeSessions],
  );
  const archiveAgeAnyMatch = useMemo(
    () => hasAnyArchiveAgeMatches(archiveAgeSessions),
    [archiveAgeSessions],
  );
  const archiveAgeMaxMatch = useMemo(
    () =>
      archiveAgePreviews.reduce(
        (max, p) => (p.count > max ? p.count : max),
        0,
      ),
    [archiveAgePreviews],
  );

  // Drop stale selection when list changes (restore/delete/refresh).
  useEffect(() => {
    setArchivedSelected((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(archivedAllIds);
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (live.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [archivedAllIds]);

  const archivedSelectedCount = archivedSelected.size;
  const archivedAllSelected =
    archivedTotal > 0 && archivedSelectedCount === archivedTotal;
  const archivedSomeSelected =
    archivedSelectedCount > 0 && !archivedAllSelected;

  const toggleArchivedId = (id: string) => {
    setArchivedSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleArchivedAll = () => {
    if (archivedAllSelected) {
      setArchivedSelected(new Set());
    } else {
      setArchivedSelected(new Set(archivedAllIds));
    }
  };

  const toggleArchivedGroup = (ids: string[]) => {
    setArchivedSelected((prev) => {
      const next = new Set(prev);
      const allOn = ids.length > 0 && ids.every((id) => next.has(id));
      if (allOn) {
        for (const id of ids) next.delete(id);
      } else {
        for (const id of ids) next.add(id);
      }
      return next;
    });
  };

  const collectMarqueeHits = useCallback((box: MarqueeBox): string[] => {
    const root = archivedSurfaceRef.current;
    if (!root) return [];
    const r = marqueeClientRect(box);
    // Ignore tiny jitter before true drag.
    if (r.width < 4 && r.height < 4) return [];
    const hits: string[] = [];
    root.querySelectorAll<HTMLElement>("[data-archived-id]").forEach((el) => {
      const id = el.dataset.archivedId;
      if (!id) return;
      if (rectsOverlap(r, el.getBoundingClientRect())) hits.push(id);
    });
    return hits;
  }, []);

  const applyMarqueeSelection = useCallback(
    (box: MarqueeBox, additive: boolean, base: Set<string>) => {
      const hits = collectMarqueeHits(box);
      if (hits.length === 0 && !additive) {
        // Still dragging — keep empty if not additive.
        setArchivedSelected(new Set());
        return;
      }
      if (additive) {
        const next = new Set(base);
        for (const id of hits) next.add(id);
        setArchivedSelected(next);
      } else {
        setArchivedSelected(new Set(hits));
      }
    },
    [collectMarqueeHits],
  );

  const onArchivedPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Don't start marquee from action controls / custom checks.
    if (
      target.closest("button") ||
      target.closest("a") ||
      target.closest(".ui-check") ||
      target.closest(".settings-archived-toolbar")
    ) {
      return;
    }
    const additive = e.metaKey || e.ctrlKey || e.shiftKey;
    const box: MarqueeBox = {
      x0: e.clientX,
      y0: e.clientY,
      x1: e.clientX,
      y1: e.clientY,
    };
    marqueeRef.current = {
      active: true,
      dragging: false,
      additive,
      base: new Set(archivedSelected),
      box,
      pointerId: e.pointerId,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onArchivedPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = marqueeRef.current;
    if (!st?.active || st.pointerId !== e.pointerId) return;
    const box: MarqueeBox = {
      ...st.box,
      x1: e.clientX,
      y1: e.clientY,
    };
    st.box = box;
    const r = marqueeClientRect(box);
    if (!st.dragging && (r.width > 5 || r.height > 5)) {
      st.dragging = true;
      setMarquee(box);
    }
    if (st.dragging) {
      setMarquee(box);
      applyMarqueeSelection(box, st.additive, st.base);
    }
  };

  const onArchivedPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = marqueeRef.current;
    if (!st?.active || st.pointerId !== e.pointerId) return;
    marqueeRef.current = null;
    setMarquee(null);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (st.dragging) {
      applyMarqueeSelection(st.box, st.additive, st.base);
      return;
    }
    // Click without drag: toggle row under pointer (if any).
    const el = (e.target as HTMLElement).closest<HTMLElement>(
      "[data-archived-id]",
    );
    const id = el?.dataset.archivedId;
    if (id) toggleArchivedId(id);
  };

  const onArchivedPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = marqueeRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    marqueeRef.current = null;
    setMarquee(null);
  };

  const title = sectionNav
    ? t(sectionNav.labelKey)
    : t("settings.nav.general");

  const phoneIndex = phoneLayout && phonePane === "index";
  const phoneDetail = phoneLayout && phonePane === "detail";
  /** Providers dual-pane: fill viewport; rail + detail scroll, page does not. */
  const providersPaneFill =
    section === "account" && activeTab === "providers";
  const pageClass =
    "settings-page" +
    (phoneIndex ? " settings-page--phone-index" : "") +
    (phoneDetail ? " settings-page--phone-detail" : "");

  const visibleNav = useMemo(
    () => [...personalNav, ...systemNav],
    [personalNav, systemNav],
  );

  const onNavKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLButtonElement>, id: string) => {
      if (
        e.key !== "ArrowDown" &&
        e.key !== "ArrowUp" &&
        e.key !== "Home" &&
        e.key !== "End"
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const ids = visibleNav.map((n) => n.id);
      if (ids.length === 0) return;
      const idx = ids.indexOf(id as (typeof ids)[number]);
      let nextIdx = idx;
      if (e.key === "ArrowDown") {
        nextIdx = nextIndex(ids.length, idx, "next");
      } else if (e.key === "ArrowUp") {
        nextIdx = nextIndex(ids.length, idx, "prev");
      } else if (e.key === "Home") {
        nextIdx = 0;
      } else {
        nextIdx = ids.length - 1;
      }
      if (nextIdx < 0 || nextIdx === idx) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      const nextId = ids[nextIdx];
      if (!nextId) return;
      const el = document.querySelector<HTMLElement>(
        `[data-settings-nav="${nextId}"]`,
      );
      el?.focus();
    },
    [visibleNav],
  );

  const renderNavItem = (n: (typeof SETTINGS_NAV)[number]) => (
    <button
      key={n.id}
      type="button"
      data-settings-nav={n.id}
      className={
        "settings-page__nav-item" +
        (section === n.id && !phoneIndex ? " is-active" : "")
      }
      aria-current={section === n.id && !phoneIndex ? "page" : undefined}
      onClick={() => openSection(n.id)}
      onKeyDown={(e) => onNavKeyDown(e, n.id)}
    >
      <NavIcon name={n.icon} />
      <span className="settings-page__nav-label">{t(n.labelKey)}</span>
      {phoneLayout ? (
        <IconChevronRight
          size={18}
          className="settings-page__nav-chevron"
          aria-hidden
        />
      ) : null}
    </button>
  );

  // View-model bag for section components (real SettingsModel context consumption).
  const settingsModel = {
    section,
    tab: tabProp,
    onSection,
    onBack,
    phoneLayout,
    labels: _legacyLabels,
    locale,
    localePreference,
    onLocale,
    theme,
    themePreference,
    onTheme,
    themeSchedule,
    onThemeSchedule,
    showMessageTimestamps,
    onShowMessageTimestamps,
    showReplyLength,
    onShowReplyLength,
    replaceProviderBrandLogo,
    onReplaceProviderBrandLogo,
    goalOrchUiEnabled,
    onGoalOrchUiEnabled,
    messageTimeFormat,
    onMessageTimeFormat,
    sidebarShowRelativeTime,
    onSidebarShowRelativeTime,
    mutedSessionCount,
    onClearAllSessionMutes,
    unreadSessionCount,
    onClearAllSessionUnread,
    zenMode,
    onZenMode,
    skin,
    onSkin,
    wallpaperUrl,
    wallpaperKind,
    wallpaperFocus,
    wallpaperClip,
    wallpaperMediaSize,
    onWallpaper,
    onWallpaperAdjust,
    onWallpaperMediaSize,
    wallpaperScrim,
    onWallpaperScrim,
    sessionDataMode,
    onSessionDataMode,
    onCliSessionsImported,
    onOpenCliSession,
    policy,
    onPolicy,
    prefsScope,
    onPrefsScope,
    availableModels,
    manualCliPath,
    onManualCliPath,
    onCliBlur,
    allowUnverifiedCliInstall,
    onAllowUnverifiedCliInstall,
    lastCliChecksumVerified,
    acpServerAddr,
    onAcpServerAddr,
    onAcpServerBlur,
    proxyMode,
    onProxyMode,
    proxyUrl,
    onProxyUrl,
    proxyNoProxy,
    onProxyNoProxy,
    maxConcurrentAgents,
    onMaxConcurrentAgents,
    lastProcessLimit,
    agentIdleMinutes,
    onAgentIdleMinutes,
    streamStallSeconds,
    onStreamStallSeconds,
    auditLedgerRetentionDays,
    onAuditLedgerRetentionDays,
    includePartialMessages,
    onIncludePartialMessages,
    storeApiKeysInKeychain,
    onStoreApiKeysInKeychain,
    sandboxProfile,
    onSandboxProfile,
    onOpenSandboxWizard,
    maxAgentTurns,
    onMaxAgentTurns,
    backgroundWaitPolicy,
    onBackgroundWaitPolicy,
    backgroundWaitTimeoutSec,
    onBackgroundWaitTimeoutSec,
    preferredAgent,
    onPreferredAgent,
    agentProfilePath,
    onAgentProfilePath,
    onAgentProfilePathCommit,
    agentsJson,
    onAgentsJson,
    onAgentsJsonCommit,
    agentCatalog,
    experimentalMemory,
    onExperimentalMemory,
    compactionMode,
    onCompactionMode,
    compactionDetail,
    onCompactionDetail,
    twoPassCompactionEnabled,
    onTwoPassCompactionEnabled,
    subagentsEnabled,
    onSubagentsEnabled,
    subagentWorktreeSnapshotEnabled,
    onSubagentWorktreeSnapshotEnabled,
    autoWakeEnabled,
    onAutoWakeEnabled,
    workflowsEnabled,
    onWorkflowsEnabled,
    planEnabled,
    onPlanEnabled,
    todoGateEnabled,
    onTodoGateEnabled,
    todoGateMaxFiresPerPrompt,
    onTodoGateMaxFiresPerPrompt,
    todoGateFireSignal,
    disableWebSearch,
    onDisableWebSearch,
    noAskUser,
    onNoAskUser,
    disallowedTools,
    onDisallowedTools,
    allowedTools,
    onAllowedTools,
    useLeader,
    onUseLeader,
    voiceId,
    onVoiceId,
    voiceDictationAutoSend,
    onVoiceDictationAutoSend,
    voiceKeepAgentsOnEnd,
    onVoiceKeepAgentsOnEnd,
    reopenLastSession,
    onReopenLastSession,
    closeToTray,
    onCloseToTray,
    keepTrayForSchedules,
    onKeepTrayForSchedules,
    trayBusyBadge,
    onTrayBusyBadge,
    trayBusyCount,
    launchAtLogin,
    onLaunchAtLogin,
    windowAlwaysOnTop,
    onWindowAlwaysOnTop,
    notifyOnTurnDone,
    onNotifyOnTurnDone,
    notifyOnPermission,
    onNotifyOnPermission,
    notifySound,
    onNotifySound,
    permissionTimeoutSec,
    onPermissionTimeoutSec,
    askUserTimeoutSec,
    onAskUserTimeoutSec,
    cliInfo,
    cliAgentSkewRepairing,
    onCliRepairAgentSidecar,
    onDoctor,
    onOpenReliability,
    onOpenBatchAgents,
    costRollupSessions,
    costRollupProjects,
    versionFooter,
    account,
    accountLoading,
    accountBusy,
    accountHeatmapError,
    accountProbeError,
    loginHint,
    savedAccounts,
    activeAccountId,
    onAccountLoginOauth,
    onAccountLoginDevice,
    onAccountLoginSubmitCode,
    onCancelLogin,
    onAccountLogout,
    onAccountRefresh,
    onAccountManageUsage,
    onAccountSubscribe,
    onSaveAccount,
    onAddAccount,
    onSwitchAccount,
    onRemoveAccount,
    onImportChat,
    defaultOpenTarget,
    onDefaultOpenTarget,
    onProvidersChanged,
    onProviderActivated,
    onProviderBalanceLoaded,
    archivedGroups,
    onRestoreArchivedSessions,
    onDeleteArchivedSessions,
    onArchiveOlderThan,
    archiveAgeSessions,
    projectPath,
    onOpenProjectFileInResources,
    focusAnchorId,
    prHubHighlightPr,
    onFocusAnchorConsumed,
    onSkillsPrefsChanged,
    onOpenShortcutsHelp,
    onOpenProductTutorial,
    trustedProjects,
    // shell + local UI
    t,
    activeTab,
    setSectionTab,
    navigateTo,
    rowHighlight,
    title,
    sectionNav,
    showSettingsToast,
    workspaceCwd,
    runClearWorkspaceMemory,
    formatSessionWhen,
    // local state used by sections
    agentsJsonError,
    setAgentsJsonError,
    agentsJsonSaving,
    setAgentsJsonSaving,
    composerMinRows,
    onComposerMinRows,
    composerSendKeyPref,
    setComposerSendKeyPref,
    composerSpellcheck,
    setComposerSpellcheck,
    composerDraftStats,
    setComposerDraftStats,
    editors,
    clearMemoryOpen,
    setClearMemoryOpen,
    clearMemoryBusy,
    memoryBrowserEpoch,
    setMemoryBrowserEpoch,
    mirrorConfirm,
    setMirrorConfirm,
    archivedSelected,
    setArchivedSelected,
    marquee,
    archivedSurfaceRef,
    wallpaperInputRef,
    wallpaperBusy,
    wallpaperError,
    setWallpaperError,
    wallpaperFocusOpen,
    setWallpaperFocusOpen,
    wallpaperSourceOpen,
    setWallpaperSourceOpen,
    wallpaperSourceTab,
    setWallpaperSourceTab,
    thinkingExpand,
    setThinkingExpand,
    toolStepsAutoCollapse,
    setToolStepsAutoCollapse,
    transcriptFilter,
    setTranscriptFilter,
    chatFontScale,
    onChatFontScale,
    codeFontScale,
    onCodeFontScale,
    uiFontFamily,
    onUiFontFamily,
    onResetUiFont,
    terminalFontFamily,
    onTerminalFontFamily,
    terminalFontSize,
    onTerminalFontSize,
    onResetTerminalFont,
    chatDensity,
    onChatDensity,
    chatWidth,
    onChatWidth,
    exportLogo,
    exportLogoInputRef,
    onExportLogoFile,
    onClearExportLogo,
    sidebarDensity,
    onSidebarDensity,
    codeWrapDefault,
    setCodeWrapDefault,
    codeLineNumbers,
    setCodeLineNumbers,
    backBottomAlways,
    setBackBottomAlways,
    sessionSearchRank,
    setSessionSearchRank,
    voiceHotkeyEnabled,
    setVoiceHotkeyEnabled,
    confirmExternalLinks,
    setConfirmExternalLinks,
    stopAllSkipConfirm,
    setStopAllSkipConfirm,
    alwaysQuitWithoutAsking,
    setAlwaysQuitWithoutAsking,
    notifyQuietHours,
    onNotifyQuietHours,
    notifyOsPermission,
    notifyPermBusy,
    notifyHonesty,
    trayBusySurface,
    requestNotifyPermission,
    testDesktopNotification,
    notifyTestBusy,
    messageActionsVisibility,
    onMessageActionsVisibility,
    themeScheduleHonesty,
    onWallpaperFile,
    openWallpaperSource,
    wallpaperErrorMessage,
    archiveAgePreviews,
    archiveAgeAnyMatch,
    archiveAgeMaxMatch,
    archivedAllIds,
    archivedTotal,
    archivedSelectedCount,
    archivedAllSelected,
    archivedSomeSelected,
    toggleArchivedId,
    toggleArchivedAll,
    toggleArchivedGroup,
    onArchivedPointerDown,
    onArchivedPointerMove,
    onArchivedPointerUp,
    onArchivedPointerCancel,
  } as SettingsViewModel & Record<string, unknown>;


  return (
    <SettingsModelProvider value={settingsModel}>
    <div
      className={pageClass}
      data-testid="settings-page"
      data-phone-pane={phoneLayout ? phonePane : undefined}
    >
      {/* Full-width overlay drag band (does not break glass nav continuity) */}
      <div
        className="settings-page__chrome"
        data-tauri-drag-region
        aria-hidden
        {...titlebarMaximizeHandlers()}
      />
      <aside
        className="settings-page__nav"
        hidden={phoneDetail || undefined}
        aria-hidden={phoneDetail || undefined}
        aria-label={t("a11y.settingsNav")}
      >
        <div className="settings-page__nav-inner">
        <button
          type="button"
          className="settings-page__back"
          onClick={onBack}
        >
          <IconArrowLeft size={16} />
          <span>{t("settings.backToApp")}</span>
        </button>

        <div className="settings-page__search">
          <IconSearch size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("settings.searchPlaceholder")}
            aria-label={t("settings.searchPlaceholder")}
          />
        </div>

        {personalNav.length > 0 ? (
          <>
            <div className="settings-page__group-label">
              {t("settings.group.personal")}
            </div>
            {personalNav.map(renderNavItem)}
          </>
        ) : null}

        {systemNav.length > 0 ? (
          <>
            <div className="settings-page__group-label">
              {t("settings.group.system")}
            </div>
            {systemNav.map(renderNavItem)}
          </>
        ) : null}

        {searchHits.length > 0 ? (
          <div className="settings-page__search-hits" role="listbox" aria-label={t("settings.searchResults")}>
            <div className="settings-page__group-label">
              {t("settings.searchResults")}
            </div>
            {searchHits.slice(0, 12).map((hit) => (
              <button
                key={hit.entry.id}
                type="button"
                role="option"
                className="settings-page__search-hit"
                onClick={() =>
                  jumpToHit(
                    hit.entry.section,
                    hit.entry.tab,
                    hit.entry.anchorId,
                  )
                }
              >
                <span className="settings-page__search-hit-label">
                  {t(hit.entry.labelKey)}
                </span>
                <span className="settings-page__search-hit-path">
                  {t(hit.sectionLabelKey)}
                  {hit.tabLabelKey ? ` · ${t(hit.tabLabelKey)}` : ""}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {searchEmpty ? (
          <div
            className="settings-page__nav-empty"
            role="status"
            data-testid="settings-search-empty"
          >
            <div className="settings-page__nav-empty-title">
              {t("settings.searchNoResults")}
            </div>
            <div className="settings-page__nav-empty-hint">
              {t("settings.searchNoResultsHint", { q: trimmedQuery })}
            </div>
          </div>
        ) : null}
        </div>
      </aside>

      <div
        className={
          "settings-page__content" +
          (providersPaneFill ? " settings-page__content--pane-fill" : "")
        }
        hidden={phoneIndex || undefined}
        aria-hidden={phoneIndex || undefined}
      >
      {phoneDetail ? (
        <div className="settings-page__phone-bar">
          <button
            type="button"
            className="settings-page__phone-back"
            onClick={backToPhoneIndex}
            aria-label={t("settings.backToIndex")}
          >
            <IconArrowLeft size={20} />
          </button>
          <h1 className="settings-page__phone-title">{title}</h1>
        </div>
      ) : null}
      <main
        className={
          "settings-page__main" +
          (providersPaneFill ? " settings-page__main--pane-fill" : "")
        }
      >
        {!phoneDetail ? (
          <h1 className="settings-page__title">{title}</h1>
        ) : null}

        {section === "general" && <GeneralSection />}
        {section === "appearance" && <AppearanceSection />}
        {section === "account" && <AccountSection />}
        {section === "archived" && <ArchivedSection />}
        {section === "extensions" && <ExtensionsSection />}
        {section === "remote_im" && <RemoteImSection />}
        {section === "runtime" && <RuntimeSection />}
        {section === "shortcuts" && <ShortcutsSection />}
        {section === "about" && <AboutSection />}
      </main>
      </div>

      {settingsToast ? (
        <div className="app-toast" role="status">
          {settingsToast}
        </div>
      ) : null}

      <GlassModal
        open={clearMemoryOpen}
        onClose={() => {
          if (!clearMemoryBusy) setClearMemoryOpen(false);
        }}
        title={t("settings.clearWorkspaceMemoryConfirmTitle")}
        size="sm"
        closeLabel={t("common.close")}
        closeOnOverlay={!clearMemoryBusy}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={clearMemoryBusy}
              onClick={() => setClearMemoryOpen(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={clearMemoryBusy || !workspaceCwd}
              onClick={() => void runClearWorkspaceMemory()}
            >
              {clearMemoryBusy
                ? t("settings.clearWorkspaceMemoryBusy")
                : t("settings.clearWorkspaceMemory")}
            </button>
          </>
        }
      >
        <p className="settings-row__desc" style={{ margin: 0 }}>
          {t("settings.clearWorkspaceMemoryConfirmMsg")}
        </p>
      </GlassModal>

      <GlassModal
        open={!!mirrorConfirm}
        onClose={() => setMirrorConfirm(null)}
        title={mirrorConfirm?.title ?? t("mirror.stopConfirmTitle")}
        size="sm"
        closeLabel={t("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setMirrorConfirm(null)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                const action = mirrorConfirm?.onConfirm;
                setMirrorConfirm(null);
                action?.();
              }}
            >
              {mirrorConfirm?.confirmLabel ?? t("mirror.stopConfirmOk")}
            </button>
          </>
        }
      >
        <p className="settings-row__desc" style={{ margin: 0 }}>
          {mirrorConfirm?.message ?? t("mirror.stopConfirmMessage")}
        </p>
      </GlassModal>
    </div>
    </SettingsModelProvider>
  );
}

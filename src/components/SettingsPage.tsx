/**
 * Full-page settings shell (ChatGPT-desktop style): left nav + content.
 * Back control returns to the workbench ("返回应用").
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { nextIndex } from "@/lib/a11yFocus";
import { Select } from "@/components/Select";
import {
  IconArchive,
  IconAppearance,
  IconArrowLeft,
  IconCheck,
  IconChat,
  IconChevronRight,
  IconCrop,
  IconDoctor,
  IconHelp,
  IconInfo,
  IconKeyboard,
  IconLanguage,
  IconMinimize,
  IconCopy,
  IconPuzzle,
  IconSearch,
  IconSettings,
  IconShield,
  IconTrash,
  IconUser,
} from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import {
  countUnlinkedCliSessions,
  filterCliSessions,
} from "@/lib/cliSessionsFilter";
import {
  listArchiveAgeOptionPreviews,
  hasAnyArchiveAgeMatches,
  type ArchiveAgeSessionLike,
} from "@/lib/sessionArchiveAge";
import { CostRollupPanel } from "@/components/CostRollupPanel";
import { StreamingMessagesJsonPanel } from "@/components/StreamingMessagesJsonPanel";
import { StreamingAcpNdjsonPanel } from "@/components/StreamingAcpNdjsonPanel";
import { WorkflowsDiscoveryBlock } from "@/components/WorkflowsSettingsBlock";
import type {
  CostRollupProjectMeta,
  CostRollupSessionMeta,
} from "@/lib/costRollup";
import {
  COMMON_DISALLOWED_TOOLS,
  isToolDisallowed,
  isWebSearchTool,
  normalizeDisallowedTools,
  parseDisallowedToolsInput,
  toggleDisallowedTool,
} from "@/lib/disallowedTools";
import { parseAgentsJson } from "@/lib/agentsJson";
import {
  COMMON_ALLOWED_TOOLS,
  bothToolListsSet,
  isToolAllowed,
  normalizeAllowedTools,
  parseAllowedToolsInput,
  toggleAllowedTool,
} from "@/lib/allowedTools";
import { detectAppPlatform } from "@/lib/appPlatform";
import {
  RECOMMENDED_SANDBOX_PROFILE,
  SANDBOX_MIN_CLI,
  childNetworkRestrictApplies,
  sandboxIsolationActive,
  sandboxProfileSelectOptions,
  sandboxProfileHelpKey,
  sandboxSoftFailKind,
  sandboxSoftFailMessageKey,
} from "@/lib/sandboxProfile";
import {
  DEFAULT_TODO_GATE_MAX_FIRES,
  MAX_TODO_GATE_MAX_FIRES,
  MIN_TODO_GATE_MAX_FIRES,
  TODO_GATE_MIN_CLI,
  describeTodoGateSettings,
  normalizeTodoGateMaxFires,
  type TodoGateFireSignal,
} from "@/lib/todoGate";
import {
  SHORTCUTS,
  detectShortcutPlatform,
  filterShortcutGroups,
  shortcutScope,
  shortcutsByGroup,
  type ShortcutGroup,
  type ShortcutId,
  type ShortcutScope,
} from "@/lib/shortcuts";
import {
  SHORTCUT_IGNORE_CROSS_SCOPE_CHANGED_EVENT,
  SHORTCUT_IGNORE_CROSS_SCOPE_STORAGE_KEY,
  SHORTCUT_REMAP_CHANGED_EVENT,
  SHORTCUT_REMAP_STORAGE_KEY,
  buildEffectiveChordMap,
  chordFromKeyboardEvent,
  clearAllShortcutRemaps,
  findChordConflict,
  findChordConflicts,
  formatChordDisplay,
  hasAnyShortcutRemaps,
  isRemappableShortcutId,
  loadIgnoreCrossScopeConflicts,
  loadShortcutRemaps,
  planResetAllShortcutRemaps,
  resetConflictingShortcutRemaps,
  saveIgnoreCrossScopeConflicts,
  setShortcutRecordingActive,
  setShortcutRemap,
  summarizeChordConflicts,
  type ChordConflictOpts,
  type ShortcutRemapMap,
} from "@/lib/shortcutRemap";
import type { Theme, ThemePreference } from "@/lib/theme";
import {
  deriveThemeScheduleHonesty,
  type ThemeScheduleConfig,
} from "@/lib/themeSchedule";
import {
  DEFAULT_WALLPAPER_FOCUS,
  THEME_SKINS,
  WALLPAPER_ACCEPT,
  WallpaperPrepareError,
  prepareWallpaperFromFile,
  type ThemeSkinId,
  type WallpaperClip,
  type WallpaperFocus,
  type WallpaperKind,
  type WallpaperRecord,
} from "@/lib/themeSkin";
import {
  CHAT_FONT_SCALES,
  applyChatFontScale,
  loadChatFontScale,
  saveChatFontScale,
  type ChatFontScale,
} from "@/lib/chatFontScale";
import {
  CODE_FONT_SCALES,
  applyCodeFontScale,
  loadCodeFontScale,
  saveCodeFontScale,
  type CodeFontScale,
} from "@/lib/codeFontScalePref";
import {
  CHAT_DENSITIES,
  applyChatDensity,
  loadChatDensity,
  saveChatDensity,
  type ChatDensity,
} from "@/lib/chatDensity";
import {
  CHAT_WIDTHS,
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
  COMPOSER_MIN_ROWS_OPTIONS,
  applyComposerMinRows,
  loadComposerMinRows,
  saveComposerMinRows,
  type ComposerMinRows,
} from "@/lib/composerMinRows";
import {
  SIDEBAR_DENSITIES,
  applySidebarDensity,
  loadSidebarDensity,
  saveSidebarDensity,
  type SidebarDensity,
} from "@/lib/sidebarDensity";
import {
  WallpaperFocusEditor,
  type WallpaperFocusApplyResult,
} from "@/components/WallpaperFocusEditor";
import { WallpaperMediaLayer } from "@/components/WallpaperMediaLayer";
import {
  WallpaperSourceModal,
  type WallpaperSourceTab,
} from "@/components/WallpaperSourceModal";
import type {
  ComposerPrefsScope,
  ModelOption,
  PermissionPolicyId,
} from "@/lib/grokCatalog";
import {
  COMPOSER_PREFS_SCOPES,
  PERMISSION_POLICIES,
} from "@/lib/grokCatalog";
import {
  CLI_PERMISSION_MODES,
  cliPermissionModeToPolicy,
  isPolicyCliOneToOne,
  policyToCliPermissionMode,
} from "@/lib/permissionModeMap";
import {
  COMPOSER_SEND_KEY_CHANGED_EVENT,
  loadComposerSendKeyPref,
  saveComposerSendKeyPref,
  type ComposerSendKeyPref,
} from "@/lib/composerSendKey";
import {
  loadComposerDraftStatsPref,
  saveComposerDraftStatsPref,
} from "@/lib/draftStats";
import {
  loadComposerSpellcheck,
  saveComposerSpellcheck,
} from "@/lib/composerSpellcheck";
import type { AccountStatus, DetectedEditor } from "@/lib/api";
import * as api from "@/lib/api";
import {
  classifyProbeResult,
  isValidProxyUrl,
  manualProxyUrlSoftFail,
  normalizeProxyMode,
  probeOutcomeMessageKey,
  probeTargetClassMessageKey,
  probeToneClass,
  proxyApplyHonestyScopes,
  proxyApplyMessageKey,
  proxySoftFailMessageKey,
  type ClassifiedProbeResult,
} from "@/lib/networkProxy";
import { AccountPanel } from "@/components/AccountPanel";
import { OfficialAuxPanel } from "@/components/OfficialAuxPanel";
import { ProvidersPanel } from "@/components/ProvidersPanel";
import { ExtensionsPanel } from "@/components/ExtensionsPanel";
import { ProjectInspectPanel } from "@/components/ProjectInspectPanel";
import { GitPrHubPanel } from "@/components/GitPrHubPanel";
import { PermissionRulesPanel } from "@/components/PermissionRulesPanel";
import { AgentConfigEditPanel } from "@/components/AgentConfigEditPanel";
import { PrivacyCenterPanel } from "@/components/PrivacyCenterPanel";
import { ManagedSetupPanel } from "@/components/ManagedSetupPanel";
import { TraceHistoryList } from "@/components/TraceHistoryList";
import { GlassModal } from "@/components/GlassModal";
import { MemoryBrowserPanel } from "@/components/MemoryBrowserPanel";
import { MemoryEmbedPanel } from "@/components/MemoryEmbedPanel";
import { CodebaseIndexingPanel } from "@/components/CodebaseIndexingPanel";
import { CodebaseSearchPanel } from "@/components/CodebaseSearchPanel";
import { AgentConfigTomlPanel } from "@/components/AgentConfigTomlPanel";
import { ProcessBudgetPanel } from "@/components/ProcessBudgetPanel";
import { RemoteImLayout } from "@/components/RemoteImLayout";
import { MirrorConnectPanel } from "@/components/MirrorConnectPanel";
import { LeaderServePanel } from "@/components/LeaderServePanel";
import { CliWorktreeDbPanel } from "@/components/CliWorktreeDbPanel";
import { SdkConnectWizard } from "@/components/SdkConnectWizard";
import { CliUpdateRow } from "@/components/CliUpdateRow";
import {
  createT,
  resolveLocale,
  type MessageKey,
  type Vars,
} from "@/i18n";
import { useUpdaterContext } from "@/hooks/UpdaterProvider";
import {
  loadCodeLineNumbersPref,
  saveCodeLineNumbersPref,
} from "@/lib/codeLineNumbersPref";
import {
  loadBackBottomAlwaysPref,
  saveBackBottomAlwaysPref,
} from "@/lib/backBottomAlwaysPref";
import {
  loadSessionSearchRankPref,
  saveSessionSearchRankPref,
} from "@/lib/sessionSearchRankPref";
import type { SessionSearchRankMode } from "@/lib/sessionSearch";
import {
  loadToolStepsAutoCollapsePref,
  saveToolStepsAutoCollapsePref,
} from "@/lib/toolStepsAutoCollapsePref";
import {
  loadTranscriptFilterPref,
  saveTranscriptFilterPref,
  type TranscriptFilterMode,
} from "@/lib/transcriptFilterPref";
import {
  loadCodeWrapPref,
  saveCodeWrapPref,
} from "@/lib/codeWrapPref";
import {
  SHORTCUT_KEYS_OFF,
  VOICE_HOTKEY_CHANGED_EVENT,
  VOICE_HOTKEY_STORAGE_KEY,
  loadVoiceHotkeyEnabled,
  saveVoiceHotkeyEnabled,
} from "@/lib/voiceHotkeyPref";
import {
  loadConfirmExternalLinksPref,
  saveConfirmExternalLinksPref,
} from "@/lib/externalLinkPref";
import {
  loadStopAllSkipConfirmPref,
  saveStopAllSkipConfirmPref,
} from "@/lib/stopAllSkipConfirmPref";
import {
  loadAlwaysQuitWithoutAskingPref,
  saveAlwaysQuitWithoutAskingPref,
} from "@/lib/confirmQuit";
import {
  loadNotifyQuietHoursPref,
  normalizeHHmm,
  saveNotifyQuietHoursPref,
  type NotifyQuietHoursPref,
} from "@/lib/notifyQuietHours";
import {
  ensureNotifyPermission,
  notificationSupport,
} from "@/lib/desktopNotify";
import {
  deriveNotifyHonestySurface,
  deriveTrayBusyBadgeSurface,
  type NotifyOsPermission,
} from "@/lib/trayNotifyPro";
import {
  MESSAGE_ACTIONS_VISIBILITIES,
  applyMessageActionsVisibility,
  loadMessageActionsVisibility,
  saveMessageActionsVisibility,
  type MessageActionsVisibility,
} from "@/lib/messageActionsPref";
import {
  MESSAGE_TIME_FORMATS,
  type MessageTimeFormat,
} from "@/lib/messageTimeFormatPref";
import {
  normalizeAcpServerAddrForSettings,
  parseAcpServerAddr,
} from "@/lib/acpServerAddr";
import {
  SETTINGS_NAV,
  buildSettingsHash,
  defaultTabFor,
  getNavDef,
  resolveTab,
  searchSettingsEntries,
  type SettingsNavIcon,
  type SettingsSectionId,
  type SettingsTabId,
} from "@/lib/settingsCatalog";
import {
  loadThinkingExpandPref,
  saveThinkingExpandPref,
  type ThinkingExpandPref,
} from "@/lib/thinkingPref";

export type { SettingsSectionId } from "@/lib/settingsCatalog";

export type ArchivedSessionRow = {
  id: string;
  title: string;
  projectId: string | null;
  updatedAt: string;
};

export type ArchivedProjectGroup = {
  id: string | null;
  name: string;
  sessions: ArchivedSessionRow[];
};

export interface SettingsPageProps {
  section: SettingsSectionId;
  /** Active page tab (from hash `#/settings/{section}/{tab}`). */
  tab?: string | null;
  /**
   * Navigate to a settings section (and optional tab / anchor).
   * Prefer this over bare section changes so deep links stay in sync.
   */
  onSection: (id: SettingsSectionId, tab?: string | null) => void;
  onBack: () => void;
  /**
   * Mirror phone chrome (≤820px). Enables single-column index/detail drill-down.
   * Desktop / wide viewports leave this false so the two-column layout is unchanged.
   */
  phoneLayout?: boolean;
  labels: Record<string, string>;
  /** Resolved catalog locale used for Settings copy (`en` | `zh` | `zh-TW`). */
  locale: string;
  /**
   * Durable language preference including `"system"`. When omitted, the Select
   * falls back to `locale` (explicit lock).
   */
  localePreference?: string;
  onLocale: (v: string) => void;
  /** Resolved light/dark currently applied (for display-only consumers). */
  theme: Theme;
  /** User preference including "system" (drives the appearance segment). */
  themePreference?: ThemePreference;
  onTheme: (v: ThemePreference) => void;
  /**
   * Optional light/dark-by-clock schedule (sub-option under System).
   * Only applies when preference is System — light/dark locks ignore it.
   */
  themeSchedule?: ThemeScheduleConfig;
  onThemeSchedule?: (v: ThemeScheduleConfig) => void;
  /** Show message timestamps in chat action rows (localStorage). */
  showMessageTimestamps?: boolean;
  onShowMessageTimestamps?: (v: boolean) => void;
  /** Show word/char count under finished assistant replies (localStorage). */
  showReplyLength?: boolean;
  onShowReplyLength?: (v: boolean) => void;
  /**
   * Show optional USD cost estimates in the context chip menu (localStorage).
   * Always labeled as an estimate when shown.
   */
  showUsageEstimates?: boolean;
  onShowUsageEstimates?: (v: boolean) => void;
  /**
   * Show Goal orchestration section in Reliability center (display only;
   * localStorage `goalOrchUiEnabled`, default on). Does not enable the CLI
   * goal harness — only hides/shows observed `goal_updated` events.
   */
  goalOrchUiEnabled?: boolean;
  onGoalOrchUiEnabled?: (v: boolean) => void;
  /** Absolute vs relative message time labels (localStorage). */
  messageTimeFormat?: MessageTimeFormat;
  onMessageTimeFormat?: (v: MessageTimeFormat) => void;
  /** Sidebar session-row relative updated time (localStorage). */
  sidebarShowRelativeTime?: boolean;
  onSidebarShowRelativeTime?: (v: boolean) => void;
  /**
   * Count of sessions muted for desktop notifications (localStorage).
   * Unread dots stay independent of mute.
   */
  mutedSessionCount?: number;
  onClearAllSessionMutes?: () => void;
  /** Count of sessions with unread markers (localStorage). */
  unreadSessionCount?: number;
  onClearAllSessionUnread?: () => void;
  /** Zen mode — hide left + right panes (localStorage `grok.zenMode`). */
  zenMode?: boolean;
  onZenMode?: (v: boolean) => void;
  /** Color skin pack on top of light/dark (optional for older callers). */
  skin?: ThemeSkinId;
  onSkin?: (v: ThemeSkinId) => void;
  /** Custom wallpaper blob: URL (null/undefined = none). */
  wallpaperUrl?: string | null;
  /** Kind of the current wallpaper, to pick <video> vs <img> in the preview. */
  wallpaperKind?: WallpaperKind | null;
  /** Pan/zoom focus for the wallpaper (window-aspect crop). */
  wallpaperFocus?: WallpaperFocus | null;
  /** Video in/out clip (seconds). */
  wallpaperClip?: WallpaperClip | null;
  /** Intrinsic media size from meta (avoids video preview flash). */
  wallpaperMediaSize?: { w: number; h: number } | null;
  onWallpaper?: (record: WallpaperRecord | null) => void | Promise<void>;
  /** Save focus crop + optional video clip (no blob rewrite). */
  onWallpaperAdjust?: (result: WallpaperFocusApplyResult) => void;
  /** Backfill intrinsic size once decoded. */
  onWallpaperMediaSize?: (size: { w: number; h: number }) => void;
  /** Wallpaper scrim strength 0–100 (only the dimming overlay; not chrome). */
  wallpaperScrim?: number;
  onWallpaperScrim?: (value: number) => void;
  sessionDataMode: string;
  onSessionDataMode: (v: string) => void;
  /** After importing CLI sessions — refresh sidebar. */
  onCliSessionsImported?: () => void;
  /** Open an app session (after import or when already linked). */
  onOpenCliSession?: (appSessionId: string) => void;
  policy: string;
  onPolicy: (v: PermissionPolicyId) => void;
  /** Where model / permission choices are remembered. */
  prefsScope?: ComposerPrefsScope | string;
  onPrefsScope?: (v: ComposerPrefsScope) => void;
  /** Live valid models (for display only in settings). */
  availableModels?: ModelOption[];
  manualCliPath: string;
  onManualCliPath: (v: string) => void;
  onCliBlur: (v: string) => void;
  /** Escape hatch: allow CLI install without published checksum (default off). */
  allowUnverifiedCliInstall?: boolean;
  onAllowUnverifiedCliInstall?: (v: boolean) => void;
  /** Last install checksum status from Host settings. */
  lastCliChecksumVerified?: boolean | null;
  /** API mode: remote ACP server `host:port` (empty = local CLI spawn). */
  acpServerAddr: string;
  onAcpServerAddr: (v: string) => void;
  /** Persist empty/valid address on blur (soft-respawn when it changes). */
  onAcpServerBlur: (v: string) => void;
  /** Outbound proxy: system | manual | none. */
  proxyMode?: string;
  onProxyMode?: (v: string) => void;
  proxyUrl?: string;
  onProxyUrl?: (v: string) => void;
  proxyNoProxy?: string;
  onProxyNoProxy?: (v: string) => void;
  /** Max warm/live agent processes (I02). */
  maxConcurrentAgents?: number;
  onMaxConcurrentAgents?: (v: number) => void;
  /**
   * Last `session://process_limit` event (ids/message only) for process-budget
   * honesty callout near the pool settings. Optional.
   */
  lastProcessLimit?: import("@/lib/processBudget").ProcessLimitEvent | null;
  /** Idle recycle minutes (I03). */
  agentIdleMinutes?: number;
  onAgentIdleMinutes?: (v: number) => void;
  /** Stream stall silence timeout seconds (I06). */
  streamStallSeconds?: number;
  onStreamStallSeconds?: (v: number) => void;
  /**
   * Tool audit ledger retention days: 7 | 30 | 90 | 0 (unlimited).
   * Host prunes on write/rotate and when this changes.
   */
  auditLedgerRetentionDays?: number;
  onAuditLedgerRetentionDays?: (v: number) => void;
  /**
   * Headless partial stream events (CLI 0.2.117+): when on, Remote IM /
   * diagnostics using streaming-messages-json also pass
   * `--include-partial-messages`. Soft-fails on older CLIs.
   */
  includePartialMessages?: boolean;
  onIncludePartialMessages?: (v: boolean) => void;
  /** Cap agent turns per process (`grok --max-turns`). 0/undefined = unlimited. */
  maxAgentTurns?: number;
  onMaxAgentTurns?: (v: number) => void;
  /**
   * Headless background-wait policy (CLI 0.2.117+): wait | no_wait | timeout.
   * Affects headless `-p` / Remote IM; top-level flags also soft-gated on ACP.
   */
  backgroundWaitPolicy?: string;
  onBackgroundWaitPolicy?: (v: string) => void;
  /** Seconds for timeout policy (1–3600). */
  backgroundWaitTimeoutSec?: number;
  onBackgroundWaitTimeoutSec?: (v: number) => void;
  /** Preferred agent definition name for spawn (`""` = CLI default). */
  preferredAgent?: string;
  onPreferredAgent?: (v: string) => void;
  /**
   * Optional agent profile file path for `grok agent --agent-profile`.
   * Empty = omit flag. Local edits via `onAgentProfilePath`; persist via
   * `onAgentProfilePathCommit` (blur / browse / clear) to avoid mid-type respawns.
   */
  agentProfilePath?: string;
  onAgentProfilePath?: (v: string) => void;
  onAgentProfilePathCommit?: (v: string) => void;
  /**
   * Optional inline agents JSON for top-level `grok --agents <JSON>`.
   * Empty = omit flag. Local draft via `onAgentsJson`; persist via
   * `onAgentsJsonCommit` after client-side validation (invalid blocks save).
   */
  agentsJson?: string;
  onAgentsJson?: (v: string) => void;
  onAgentsJsonCommit?: (v: string) => void | Promise<void>;
  /** Catalog rows for preferred-agent select. */
  agentCatalog?: Array<{ name: string; source: string }>;
  /** Cross-session memory toggle. */
  experimentalMemory?: boolean;
  onExperimentalMemory?: (v: boolean) => void;
  /**
   * Compaction mode (CLI 0.2.117+): summary | transcript | segments.
   * Maps to --compaction-mode / GROK_COMPACTION_MODE.
   */
  compactionMode?: string;
  onCompactionMode?: (v: string) => void;
  /**
   * Segments detail (CLI 0.2.117+): none | minimal | balanced | verbose.
   * Only when mode is segments.
   */
  compactionDetail?: string;
  onCompactionDetail?: (v: string) => void;
  /**
   * Prefire two-pass compaction (CLI 0.2.117+ config
   * two_pass_compaction_enabled + GROK_TWO_PASS_COMPACTION).
   */
  twoPassCompactionEnabled?: boolean;
  onTwoPassCompactionEnabled?: (v: boolean) => void;
  disableWebSearch?: boolean;
  onDisableWebSearch?: (v: boolean) => void;
  /**
   * Spawn with top-level `--no-ask-user` (CLI ≥ 0.2.117) to disable
   * ask-user questionnaires. Soft-respawns on change.
   */
  noAskUser?: boolean;
  onNoAskUser?: (v: boolean) => void;
  /** Built-in tool denylist (`--disallowed-tools`). */
  disallowedTools?: string[];
  onDisallowedTools?: (v: string[]) => void;
  /** Built-in tool allowlist (`--tools`). Empty = CLI default (all tools). */
  allowedTools?: string[];
  onAllowedTools?: (v: string[]) => void;
  reopenLastSession?: boolean;
  onReopenLastSession?: (v: boolean) => void;
  closeToTray?: boolean;
  onCloseToTray?: (v: boolean) => void;
  /**
   * When any scheduled task is enabled, still hide to tray on close so
   * automation_runner keeps ticking (default on). Not a daemon.
   */
  keepTrayForSchedules?: boolean;
  onKeepTrayForSchedules?: (v: boolean) => void;
  /** Show busy session count on dock badge / tray tooltip (localStorage; default on). */
  trayBusyBadge?: boolean;
  onTrayBusyBadge?: (v: boolean) => void;
  /**
   * Live busy session count for the tray badge status line (from liveMap).
   * Optional — when omitted, Settings shows idle/off only.
   */
  trayBusyCount?: number;
  /** Start app at OS login (default off). */
  launchAtLogin?: boolean;
  onLaunchAtLogin?: (v: boolean) => void;
  /** Keep main window above others (localStorage; default off). */
  windowAlwaysOnTop?: boolean;
  onWindowAlwaysOnTop?: (v: boolean) => void;
  /** Desktop notification when an agent turn finishes (default on). */
  notifyOnTurnDone?: boolean;
  onNotifyOnTurnDone?: (v: boolean) => void;
  /** Desktop notification when the agent requests permission (default on). */
  notifyOnPermission?: boolean;
  onNotifyOnPermission?: (v: boolean) => void;
  /** Play a short beep with desktop notifications (localStorage; default off). */
  notifySound?: boolean;
  onNotifySound?: (v: boolean) => void;
  /**
   * Auto-deny permission bar after N seconds (localStorage; 0 = off).
   * Presets: 0 / 30 / 60 / 120 / 300.
   */
  permissionTimeoutSec?: number;
  onPermissionTimeoutSec?: (v: number) => void;
  /**
   * Auto-cancel Ask User Question modal after N seconds (localStorage; 0 = off).
   * App-enforced; presets: 0 / 30 / 60 / 120 / 300.
   */
  askUserTimeoutSec?: number;
  onAskUserTimeoutSec?: (v: number) => void;
  planEnabled?: boolean;
  onPlanEnabled?: (v: boolean) => void;
  /** CLI TodoGate (turn-end nudge; `--todo-gate`, CLI 0.2.117+). */
  todoGateEnabled?: boolean;
  onTodoGateEnabled?: (v: boolean) => void;
  /** Max TodoGate fires per prompt (1–20). */
  todoGateMaxFiresPerPrompt?: number;
  onTodoGateMaxFiresPerPrompt?: (v: number) => void;
  /**
   * Optional host signal for TodoGate fire activity (Settings status line).
   * When omitted / null, UI shows honest N/A — App never invents fire counts.
   */
  todoGateFireSignal?: TodoGateFireSignal | null;
  subagentsEnabled?: boolean;
  onSubagentsEnabled?: (v: boolean) => void;
  /** CLI subagent worktree snapshot (config 0.2.117+). */
  subagentWorktreeSnapshotEnabled?: boolean;
  onSubagentWorktreeSnapshotEnabled?: (v: boolean) => void;
  /** CLI auto-wake (config `auto_wake_enabled`; CLI-side when supported). */
  autoWakeEnabled?: boolean;
  onAutoWakeEnabled?: (v: boolean) => void;
  /**
   * Grok Build workflows (`workflows_enabled`). Independent agent-home write;
   * list + soft-fail headless smoke/run via workflow tool (no visual editor).
   */
  workflowsEnabled?: boolean;
  onWorkflowsEnabled?: (v: boolean) => void;
  useLeader?: boolean;
  onUseLeader?: (v: boolean) => void;
  /** Live voice speaker id (xAI realtime), e.g. eve. */
  voiceId?: string;
  onVoiceId?: (v: string) => void;
  /** After dictation STT, send the prompt immediately. */
  voiceDictationAutoSend?: boolean;
  onVoiceDictationAutoSend?: (v: boolean) => void;
  /** Keep delegated agent sessions when Live Voice ends. */
  voiceKeepAgentsOnEnd?: boolean;
  onVoiceKeepAgentsOnEnd?: (v: boolean) => void;
  /** Store App API keys in OS keychain (default off → secrets.json). */
  storeApiKeysInKeychain?: boolean;
  onStoreApiKeysInKeychain?: (v: boolean) => void;
  /** OS sandbox for agent spawn: off | workspace | read-only | strict | devbox. */
  sandboxProfile?: string;
  onSandboxProfile?: (v: string) => void;
  cliInfo: {
    found: boolean;
    path: string | null;
    version: string | null;
    source: string;
    cliAuthPresent: boolean;
  };
  onDoctor: () => void;
  /** Open Reliability / Observability center (busy · stalls · error deck). */
  onOpenReliability?: () => void;
  /** Open multi-project batch agents dispatch. */
  onOpenBatchAgents?: () => void;
  /** Session index for cost rollup unknown-session counts (Settings → Runtime). */
  costRollupSessions?: readonly CostRollupSessionMeta[];
  /** Project names for cost rollup labels. */
  costRollupProjects?: readonly CostRollupProjectMeta[];
  versionFooter: string;
  /** Official Grok Build account (membership / usage). */
  account: AccountStatus | null;
  accountLoading: boolean;
  accountBusy: boolean;
  loginHint?: string | null;
  savedAccounts?: import("@/lib/api").SavedAccount[];
  activeAccountId?: string | null;
  onAccountLoginOauth: () => void;
  onAccountLoginDevice: () => void;
  onCancelLogin: () => void;
  onAccountLogout: () => void;
  onAccountRefresh: () => void;
  onAccountManageUsage: () => void;
  onAccountSubscribe: () => void;
  onSaveAccount?: () => void;
  /** Save current (if signed in) then start OAuth login for another account. */
  onAddAccount?: () => void;
  onSwitchAccount?: (id: string) => void;
  onRemoveAccount?: (id: string) => void;
  onImportChat?: () => void;
  /** Default open target: finder | editor id */
  defaultOpenTarget?: string;
  onDefaultOpenTarget?: (v: string) => void;
  /** After switching official/custom provider — reconnect Grok Build agent. */
  /** Provider catalog CRUD — refresh composer model groups. */
  onProvidersChanged?: () => void;
  onProviderActivated?: () => void;
  /** Archived chats grouped by project (settings → archived). */
  archivedGroups?: ArchivedProjectGroup[];
  /** Restore one or more archived sessions (ids). */
  onRestoreArchivedSessions?: (ids: string[]) => void;
  /** Delete one or more archived sessions after confirm (ids). */
  onDeleteArchivedSessions?: (ids: string[]) => void;
  /** Bulk-archive active chats older than N days (confirm lives in App). */
  onArchiveOlderThan?: (days: number) => void;
  /**
   * Live session rows for archive-by-age preview counts (Settings → Archived).
   * Filter / empty honesty are pure helpers; confirm GlassModal lives in App.
   */
  archiveAgeSessions?: readonly ArchiveAgeSessionLike[];
  /** Active project path for Skills/MCP inspect cwd. */
  projectPath?: string | null;
  /** Open a project file in Resources from codebase search results. */
  onOpenProjectFileInResources?: (opts: {
    path: string;
    relativePath: string;
    line?: number | null;
  }) => void;
  /**
   * Scroll + brief highlight target when opening Settings from outside
   * (e.g. ship → PR hub deep link). Cleared after apply via onFocusAnchorConsumed.
   */
  focusAnchorId?: string | null;
  /** Optional PR number to highlight in Git PR hub (`?pr=` / ship success). */
  prHubHighlightPr?: number | null;
  /** Called once after focusAnchorId is applied (parent can clear). */
  onFocusAnchorConsumed?: () => void;
  /** After skill enable toggle — refresh slash palette in App. */
  onSkillsPrefsChanged?: () => void;
  /** Open the same shortcuts help modal as ⌘/ / Ctrl+/. */
  onOpenShortcutsHelp?: () => void;
  /** Open optional product tour (replay). */
  onOpenProductTutorial?: () => void;
  /** Trusted projects for Remote IM project-scope chips (no free paths). */
  trustedProjects?: Array<{ id: string; name: string; path: string }>;
}

function NavIcon({
  name,
  size = 18,
}: {
  name: SettingsNavIcon;
  size?: number;
}) {
  if (name === "appearance") return <IconAppearance size={size} />;
  if (name === "user") return <IconUser size={size} />;
  if (name === "archive") return <IconArchive size={size} />;
  if (name === "keyboard") return <IconKeyboard size={size} />;
  if (name === "extensions") return <IconPuzzle size={size} />;
  if (name === "remote_im") return <IconChat size={size} />;
  if (name === "doctor") return <IconDoctor size={size} />;
  if (name === "info") return <IconInfo size={size} />;
  return <IconSettings size={size} />;
}

function formatSessionWhen(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Probe Grok endpoints through the effective proxy (path only, not auth). */
function NetworkProbeField({ t }: { t: (k: string, vars?: Vars) => string }) {
  const [testing, setTesting] = useState(false);
  const [classified, setClassified] = useState<ClassifiedProbeResult | null>(
    null,
  );

  const runTest = async () => {
    if (!api.isTauri()) {
      setClassified(classifyProbeResult(null, { available: false }));
      return;
    }
    setTesting(true);
    setClassified(null);
    try {
      const raw = await api.networkProbe();
      setClassified(classifyProbeResult(raw));
    } catch (e) {
      setClassified(
        classifyProbeResult(null, { invokeError: String(e) }),
      );
    } finally {
      setTesting(false);
    }
  };

  const summaryTone = classified ? probeToneClass(classified.tone) : "";

  return (
    <div className="settings-row settings-row--stack">
      <div className="settings-row__text">
        <div className="settings-row__label">{t("settings.netProbe")}</div>
        <div className="settings-row__desc">{t("settings.netProbeDesc")}</div>
      </div>
      <div className="settings-row__hint">{t("settings.netProbeHonesty")}</div>
      <div className="settings-netprobe">
        <div className="settings-netprobe__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={testing}
            onClick={() => void runTest()}
          >
            {testing ? t("settings.netProbeTesting") : t("settings.netProbeRun")}
          </button>
          {classified ? (
            <div
              className={"settings-acp-chip settings-netprobe__chip " + summaryTone}
              role="status"
            >
              <span className="settings-acp-chip__dot" aria-hidden />
              <span className="settings-acp-chip__label">
                {t(probeOutcomeMessageKey(classified.outcome) as MessageKey)}
              </span>
              {classified.targets.length > 0 ? (
                <span className="settings-acp-chip__meta">
                  {t("settings.netProbe.summaryCounts", {
                    ok: classified.okCount,
                    fail: classified.failCount,
                  })}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        {classified?.invokeError ? (
          <div className="settings-row__hint is-danger" role="alert">
            {classified.invokeError}
          </div>
        ) : null}
        {classified && classified.targets.length > 0 ? (
          <ul className="settings-netprobe__list" role="list">
            {classified.targets.map((tg) => (
              <li
                key={tg.key}
                className={
                  "settings-netprobe__item" + (tg.ok ? " is-ok" : " is-fail")
                }
              >
                <span className="settings-netprobe__mark" aria-hidden>
                  {tg.ok ? "✓" : "✗"}
                </span>
                <span className="settings-netprobe__key">{tg.key}</span>
                <span className="settings-netprobe__url">{tg.url}</span>
                <span
                  className={
                    "settings-acp-chip settings-netprobe__target-chip " +
                    (tg.ok ? "is-ok" : "is-fail")
                  }
                >
                  <span className="settings-acp-chip__dot" aria-hidden />
                  <span className="settings-acp-chip__label">
                    {t(probeTargetClassMessageKey(tg.klass) as MessageKey)}
                  </span>
                  <span className="settings-acp-chip__meta">
                    {tg.ok
                      ? `${tg.status ?? ""} · ${tg.millis}ms`
                      : tg.error || t("settings.netProbeFailed")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/**
 * ACP API-mode field: validate on blur, TCP health probe, status chip.
 * Empty = local CLI spawn; non-empty host:port = connect over TCP.
 */
function AcpServerField({
  value,
  onChange,
  onBlurCommit,
  onOpenAgentServe,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Persist after blur when empty or valid (normalized host:port). */
  onBlurCommit: (v: string) => void;
  /** Deep-link to Agent serve controls on the same Connection tab. */
  onOpenAgentServe?: () => void;
  t: (k: string, vars?: Vars) => string;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<api.AcpServerProbeResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const addr = value.trim();
  const parsed = parseAcpServerAddr(addr);
  const port = parsed.ok ? String(parsed.port) : "8799";
  const setupCmd = `socat TCP-LISTEN:${port},reuseaddr,fork EXEC:'grok agent --no-leader stdio'`;

  const errorLabel = (code: string): string => {
    switch (code) {
      case "empty_host":
        return t("settings.acpErrEmptyHost");
      case "missing_port":
        return t("settings.acpErrMissingPort");
      case "invalid_port":
        return t("settings.acpErrInvalidPort");
      case "invalid_host":
        return t("settings.acpErrInvalidHost");
      case "junk":
        return t("settings.acpErrJunk");
      default:
        return t("settings.acpErrJunk");
    }
  };

  const handleBlur = () => {
    const normalized = normalizeAcpServerAddrForSettings(value);
    if (!normalized.ok) {
      setValidationError(errorLabel(normalized.error));
      setResult(null);
      return;
    }
    setValidationError(null);
    const next = normalized.value ?? "";
    if (next !== value) onChange(next);
    onBlurCommit(next);
  };

  const runTest = async () => {
    if (!api.isTauri()) return;
    const check = parseAcpServerAddr(addr);
    if (!check.ok) {
      setValidationError(errorLabel(check.error === "empty" ? "missing_port" : check.error));
      setResult(null);
      return;
    }
    setValidationError(null);
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.acpServerProbe(check.normalized));
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    } finally {
      setTesting(false);
    }
  };
  const copyCmd = async () => {
    try {
      await navigator.clipboard.writeText(setupCmd);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className="settings-row settings-row--stack">
      <div className="settings-row__text">
        <div className="settings-row__label">{t("settings.acpServer")}</div>
        <div className="settings-row__desc">{t("settings.acpServerDesc")}</div>
      </div>
      <div className="settings-row__hint">{t("settings.acpServerModeHelp")}</div>
      <div className="settings-acp-field">
        <input
          className={
            "settings-input" + (validationError ? " is-invalid" : "")
          }
          value={value}
          placeholder="e.g. 127.0.0.1:8799"
          aria-invalid={validationError ? true : undefined}
          aria-describedby={
            validationError ? "settings-acp-validation" : undefined
          }
          onChange={(e) => {
            onChange(e.target.value);
            setValidationError(null);
            setResult(null);
          }}
          onBlur={handleBlur}
        />
        <button
          type="button"
          className="btn btn--ghost"
          disabled={!addr || testing || !!validationError}
          onClick={() => void runTest()}
        >
          {testing ? t("settings.acpTesting") : t("settings.acpTest")}
        </button>
      </div>
      {validationError ? (
        <div
          id="settings-acp-validation"
          className="settings-row__hint is-danger"
          role="alert"
        >
          {t("settings.acpInvalid", { error: validationError })}
        </div>
      ) : null}
      {result ? (
        <div
          className={
            "settings-acp-chip" + (result.ok ? " is-ok" : " is-fail")
          }
          role="status"
        >
          <span className="settings-acp-chip__dot" aria-hidden />
          <span className="settings-acp-chip__label">
            {result.ok ? t("settings.acpStatusOk") : t("settings.acpStatusFail")}
          </span>
          <span className="settings-acp-chip__meta">
            {result.ok
              ? t("settings.acpProbeOk", {
                  ms: result.latencyMs ?? 0,
                })
              : t("settings.acpProbeFail", {
                  error: result.error || "unknown",
                })}
          </span>
        </div>
      ) : null}
      {onOpenAgentServe ? (
        <div className="settings-row__hint">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onOpenAgentServe}
          >
            {t("settings.acpServerServeLink")}
          </button>
        </div>
      ) : null}
      {addr ? (
        <div className="settings-row__hint">
          <div>{t("settings.acpSetupHint")}</div>
          <code className="settings-acp-cmd">{setupCmd}</code>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void copyCmd()}
          >
            {copied ? t("message.copied") : t("message.copy")}
          </button>
        </div>
      ) : (
        <div className="settings-row__hint">{t("settings.acpServerLocalHint")}</div>
      )}
    </div>
  );
}

/** App-styled checkbox (no native OS control). */
function UiCheck({
  checked,
  indeterminate = false,
  onChange,
  label,
  ariaLabel,
  className = "",
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label?: ReactNode;
  ariaLabel?: string;
  className?: string;
}) {
  const on = indeterminate || checked;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={ariaLabel}
      className={
        "ui-check" +
        (checked && !indeterminate ? " is-on" : "") +
        (indeterminate ? " is-mixed" : "") +
        (className ? ` ${className}` : "")
      }
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onChange();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="ui-check__box" aria-hidden>
        {indeterminate ? (
          <IconMinimize size={12} stroke={2.4} />
        ) : on ? (
          <IconCheck size={12} stroke={2.4} />
        ) : null}
      </span>
      {label != null ? <span className="ui-check__label">{label}</span> : null}
    </button>
  );
}

type MarqueeBox = { x0: number; y0: number; x1: number; y1: number };

function marqueeClientRect(m: MarqueeBox) {
  const left = Math.min(m.x0, m.x1);
  const top = Math.min(m.y0, m.y1);
  const right = Math.max(m.x0, m.x1);
  const bottom = Math.max(m.y0, m.y1);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function rectsOverlap(
  a: { left: number; top: number; right: number; bottom: number },
  b: DOMRect,
): boolean {
  return !(
    a.right < b.left ||
    a.left > b.right ||
    a.bottom < b.top ||
    a.top > b.bottom
  );
}

/** In-page settings tab strip (reuses account tab chrome). */
function SettingsTabStrip({
  tabs,
  active,
  onChange,
  ariaLabel,
  t,
}: {
  tabs: readonly { id: SettingsTabId; labelKey: MessageKey }[];
  active: SettingsTabId | null;
  onChange: (id: SettingsTabId) => void;
  ariaLabel: string;
  t: (k: MessageKey) => string;
}) {
  if (tabs.length === 0) return null;
  return (
    <div className="settings-account-tabs settings-page__tabs" role="tablist" aria-label={ariaLabel}>
      <div className="settings-seg settings-seg--lg settings-page__tabs-seg" role="presentation">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className={
              "settings-seg__btn" + (active === tab.id ? " is-on" : "")
            }
            aria-selected={active === tab.id}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onChange(tab.id);
            }}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Module title + optional “?” help tip (description no longer inline under the label).
 */
function SettingsLabelWithTip({
  label,
  tip,
  leading,
}: {
  label: ReactNode;
  tip: string;
  leading?: ReactNode;
}) {
  return (
    <div className="settings-row__label">
      {leading}
      <span className="settings-row__label-text">{label}</span>
      {tip ? (
        <Tip label={tip} placement="top" className="ui-tip--wrap" delayMs={280}>
          <button
            type="button"
            className="settings-label-help"
            aria-label={tip}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <IconHelp size={14} stroke={1.75} />
          </button>
        </Tip>
      ) : null}
    </div>
  );
}

export function SettingsPage({
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
  showUsageEstimates = true,
  onShowUsageEstimates,
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
  streamStallSeconds = 180,
  onStreamStallSeconds,
  auditLedgerRetentionDays = 0,
  onAuditLedgerRetentionDays,
  includePartialMessages = false,
  onIncludePartialMessages,
  storeApiKeysInKeychain = false,
  onStoreApiKeysInKeychain,
  sandboxProfile = "off",
  onSandboxProfile,
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
  onDoctor,
  onOpenReliability,
  onOpenBatchAgents,
  costRollupSessions = [],
  costRollupProjects = [],
  versionFooter,
  account,
  accountLoading,
  accountBusy,
  loginHint = null,
  savedAccounts = [],
  activeAccountId = null,
  onAccountLoginOauth,
  onAccountLoginDevice,
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
}: SettingsPageProps) {
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
      const next = await ensureNotifyPermission();
      setNotifyOsPermission(next);
    } finally {
      setNotifyPermBusy(false);
    }
  }, [notifyPermBusy]);
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
  const runClearWorkspaceMemory = useCallback(async () => {
    if (!workspaceCwd || clearMemoryBusy) return;
    setClearMemoryBusy(true);
    try {
      await api.memoryClear({ cwd: workspaceCwd, scope: "workspace" });
      setClearMemoryOpen(false);
      setMemoryBrowserEpoch((n) => n + 1);
      showSettingsToast(t("settings.clearWorkspaceMemoryDone"), 3500);
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

  return (
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
        onDoubleClick={() => {
          void import("@tauri-apps/api/window")
            .then(({ getCurrentWindow }) => getCurrentWindow().toggleMaximize())
            .catch(() => {});
        }}
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


        {section === "general" && (
          <>
            <SettingsTabStrip
              tabs={sectionNav?.tabs ?? []}
              active={activeTab}
              onChange={setSectionTab}
              ariaLabel={title}
              t={(k) => t(k)}
            />
            {activeTab === "composer" && (
            <>
            <h2 className="settings-page__h2">{t("settings.section.composer")}</h2>
            <div className="settings-card" id="settings-anchor-composer">
              {onPrefsScope && (
                <div
                  className={"settings-row settings-row--stack" + rowHighlight("settings-anchor-prefsScope")}
                  id="settings-anchor-prefsScope"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.prefsScope")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.prefsScopeDesc")}
                    </div>
                  </div>
                  <Select
                    value={prefsScope}
                    onChange={(v) => onPrefsScope(v as ComposerPrefsScope)}
                    options={COMPOSER_PREFS_SCOPES.map((s) => ({
                      value: s,
                      label: t(
                        (
                          {
                            global: "settings.prefsScope.global",
                            project: "settings.prefsScope.project",
                            session: "settings.prefsScope.session",
                          } as const
                        )[s],
                      ),
                    }))}
                  />
                </div>
              )}
              <div
                className={"settings-row settings-row--stack" + rowHighlight("settings-anchor-availableModels")}
                id="settings-anchor-availableModels"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.availableModels")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.availableModelsDesc")}
                  </div>
                </div>
                <div className="settings-models-list" role="list">
                  {availableModels.length === 0 ? (
                    <span className="settings-row__desc">
                      {t("settings.availableModelsEmpty")}
                    </span>
                  ) : (
                    availableModels.map((m) => (
                      <div
                        key={m.id}
                        className="settings-models-list__item"
                        role="listitem"
                      >
                        <span className="settings-models-list__name">
                          {m.label}
                        </span>
                        <span className="settings-models-list__id">{m.id}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div
                className={
                  "settings-row" +
                  rowHighlight("settings-anchor-composerMinRows")
                }
                id="settings-anchor-composerMinRows"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.composerMinRows")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.composerMinRowsDesc")}
                  </div>
                </div>
                <div
                  className="settings-seg"
                  role="radiogroup"
                  aria-label={t("settings.composerMinRows")}
                >
                  {COMPOSER_MIN_ROWS_OPTIONS.map((rows) => (
                    <button
                      key={rows}
                      type="button"
                      role="radio"
                      aria-checked={composerMinRows === rows}
                      className={
                        "settings-seg__btn" +
                        (composerMinRows === rows ? " is-on" : "")
                      }
                      onClick={() => onComposerMinRows(rows)}
                    >
                      {t(`settings.composerMinRows.${rows}`)}
                    </button>
                  ))}
                </div>
              </div>
              <div
                className={
                  "settings-row settings-row--stack" +
                  rowHighlight("settings-anchor-composerSendKey")
                }
                id="settings-anchor-composerSendKey"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.composerSendKey")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.composerSendKeyDesc")}
                  </div>
                </div>
                <Select
                  value={composerSendKeyPref}
                  onChange={(v) => {
                    const next = v as ComposerSendKeyPref;
                    setComposerSendKeyPref(next);
                    saveComposerSendKeyPref(next);
                  }}
                  options={[
                    {
                      value: "enter",
                      label: t("settings.composerSendKey.enter"),
                    },
                    {
                      value: "mod-enter",
                      label: t("settings.composerSendKey.modEnter"),
                    },
                  ]}
                />
              </div>
              <div
                className={
                  "settings-row" +
                  rowHighlight("settings-anchor-composerSpellcheck")
                }
                id="settings-anchor-composerSpellcheck"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.composerSpellcheck")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.composerSpellcheckDesc")}
                  </div>
                </div>
                <UiCheck
                  checked={composerSpellcheck}
                  onChange={() => {
                    const next = !composerSpellcheck;
                    setComposerSpellcheck(next);
                    saveComposerSpellcheck(next);
                  }}
                  ariaLabel={t("settings.composerSpellcheck")}
                />
              </div>
              <div
                className={
                  "settings-row" +
                  rowHighlight("settings-anchor-composerDraftStats")
                }
                id="settings-anchor-composerDraftStats"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.composerDraftStats")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.composerDraftStatsDesc")}
                  </div>
                </div>
                <UiCheck
                  checked={composerDraftStats}
                  onChange={() => {
                    const next = !composerDraftStats;
                    setComposerDraftStats(next);
                    saveComposerDraftStatsPref(next);
                  }}
                  ariaLabel={t("settings.composerDraftStats")}
                />
              </div>
            </div>
            </>
            )}

            {activeTab === "permissions" && (
            <>
            <h2 className="settings-page__h2">{t("settings.section.permissions")}</h2>
            <div className="settings-card" id="settings-anchor-permissionRules">
              <div
                className={"settings-row settings-row--stack" + rowHighlight("settings-anchor-permissionPolicy")}
                id="settings-anchor-permissionPolicy"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    <IconShield size={16} />
                    {t("settings.permissionDeep")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.permissionDeepDesc")}
                  </div>
                </div>
                <Select
                  value={policy}
                  onChange={(v) => onPolicy(v as PermissionPolicyId)}
                  options={PERMISSION_POLICIES.map((p) => ({
                    value: p.id,
                    label: t(
                      (
                        {
                          ask: "policy.ask",
                          accept_edits: "policy.accept_edits",
                          allow_for_session: "policy.allow_for_session",
                          auto: "policy.auto",
                          dont_ask: "policy.dont_ask",
                          always_approve: "policy.always_approve",
                        } as const
                      )[p.id],
                    ),
                  }))}
                />
                <div
                  className="settings-row__desc"
                  style={{ marginTop: 8 }}
                  id="settings-anchor-cliPermissionMode"
                >
                  {t("settings.permissionCliMode", {
                    mode: policyToCliPermissionMode(policy),
                  })}
                  {!isPolicyCliOneToOne(policy) ? (
                    <>
                      {" "}
                      {t("settings.permissionCliModeNotOneToOne")}
                    </>
                  ) : null}
                </div>
              </div>
              <div
                className={
                  "settings-row settings-row--stack" +
                  rowHighlight("settings-anchor-cliPermissionModeAdvanced")
                }
                id="settings-anchor-cliPermissionModeAdvanced"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.permissionCliAdvanced")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.permissionCliAdvancedDesc")}
                  </div>
                </div>
                <Select
                  value={policyToCliPermissionMode(policy)}
                  onChange={(v) => {
                    if (v === "plan") {
                      // Plan is a product session mode, not a stored policy.
                      // Keep current policy; user switches Plan from the composer.
                      return;
                    }
                    onPolicy(cliPermissionModeToPolicy(v));
                  }}
                  options={CLI_PERMISSION_MODES.map((mode) => ({
                    value: mode,
                    label: t(
                      (
                        {
                          default: "cliPermission.default",
                          acceptEdits: "cliPermission.acceptEdits",
                          auto: "cliPermission.auto",
                          dontAsk: "cliPermission.dontAsk",
                          bypassPermissions: "cliPermission.bypassPermissions",
                          plan: "cliPermission.plan",
                        } as const
                      )[mode],
                    ),
                  }))}
                />
                <div className="settings-row__desc" style={{ marginTop: 8 }}>
                  {t("settings.permissionCliAdvancedHint", {
                    mode: policyToCliPermissionMode(policy),
                  })}
                </div>
              </div>
              {onSandboxProfile ? (
                <div
                  className={"settings-row settings-row--stack" + rowHighlight("settings-anchor-sandbox")}
                  id="settings-anchor-sandbox"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.sandboxProfile")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.sandboxProfileDesc")}
                    </div>
                  </div>
                  <Select
                    value={sandboxProfile || "off"}
                    onChange={(v) => onSandboxProfile(v)}
                    options={sandboxProfileSelectOptions().map((o) => ({
                      value: o.value,
                      label: t(o.labelKey),
                    }))}
                  />
                  <div className="settings-row__desc" style={{ marginTop: 8 }}>
                    {t(sandboxProfileHelpKey(sandboxProfile || "off"))}
                  </div>
                  {sandboxProfile === RECOMMENDED_SANDBOX_PROFILE ||
                  (sandboxProfile || "off") === "off" ? (
                    <div className="settings-row__hint" style={{ marginTop: 6 }}>
                      {t("settings.sandbox.recommendedNote")}
                    </div>
                  ) : null}
                  {(() => {
                    const platform = detectAppPlatform();
                    const soft = sandboxSoftFailKind({
                      profile: sandboxProfile,
                      cliFound: cliInfo.found,
                      cliVersion: cliInfo.version,
                      platform,
                    });
                    if (!soft) {
                      // Linux-only network note when isolation is on but soft-fail is clear.
                      if (
                        sandboxIsolationActive(sandboxProfile) &&
                        !childNetworkRestrictApplies(sandboxProfile, platform) &&
                        (sandboxProfile === "read-only" ||
                          sandboxProfile === "strict") &&
                        (platform === "mac" || platform === "other")
                      ) {
                        return (
                          <div
                            className="settings-row__hint"
                            style={{ marginTop: 6 }}
                          >
                            {t("settings.sandbox.networkLinuxOnly")}
                          </div>
                        );
                      }
                      return null;
                    }
                    return (
                      <div
                        className="settings-row__hint is-danger"
                        role="status"
                        style={{ marginTop: 6 }}
                      >
                        {t(sandboxSoftFailMessageKey(soft), {
                          min: SANDBOX_MIN_CLI,
                        })}
                      </div>
                    );
                  })()}
                </div>
              ) : null}
              {onPermissionTimeoutSec ? (
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-permissionTimeout")
                  }
                  id="settings-anchor-permissionTimeout"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.permissionTimeout")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.permissionTimeoutDesc")}
                    </div>
                  </div>
                  <Select
                    value={String(permissionTimeoutSec ?? 0)}
                    onChange={(v) => onPermissionTimeoutSec(Number(v))}
                    options={(() => {
                      const presets = [
                        {
                          value: "0",
                          label: t("settings.permissionTimeout.off"),
                        },
                        {
                          value: "30",
                          label: t("settings.permissionTimeout.30"),
                        },
                        {
                          value: "60",
                          label: t("settings.permissionTimeout.60"),
                        },
                        {
                          value: "120",
                          label: t("settings.permissionTimeout.120"),
                        },
                        {
                          value: "300",
                          label: t("settings.permissionTimeout.300"),
                        },
                      ];
                      const cur = Math.max(0, Math.round(permissionTimeoutSec ?? 0));
                      if (
                        cur > 0 &&
                        !presets.some((o) => o.value === String(cur))
                      ) {
                        return [
                          ...presets,
                          { value: String(cur), label: `${cur}s` },
                        ];
                      }
                      return presets;
                    })()}
                  />
                </div>
              ) : null}
              {onAskUserTimeoutSec ? (
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-askUserTimeout")
                  }
                  id="settings-anchor-askUserTimeout"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.askUserTimeout")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.askUserTimeoutDesc")}
                    </div>
                  </div>
                  <Select
                    value={String(askUserTimeoutSec ?? 0)}
                    onChange={(v) => onAskUserTimeoutSec(Number(v))}
                    options={(() => {
                      const presets = [
                        {
                          value: "0",
                          label: t("settings.askUserTimeout.off"),
                        },
                        {
                          value: "30",
                          label: t("settings.askUserTimeout.30"),
                        },
                        {
                          value: "60",
                          label: t("settings.askUserTimeout.60"),
                        },
                        {
                          value: "120",
                          label: t("settings.askUserTimeout.120"),
                        },
                        {
                          value: "300",
                          label: t("settings.askUserTimeout.300"),
                        },
                      ];
                      const cur = Math.max(0, Math.round(askUserTimeoutSec ?? 0));
                      if (
                        cur > 0 &&
                        !presets.some((o) => o.value === String(cur))
                      ) {
                        return [
                          ...presets,
                          { value: String(cur), label: `${cur}s` },
                        ];
                      }
                      return presets;
                    })()}
                  />
                </div>
              ) : null}
              <PermissionRulesPanel t={t} />
            </div>
            </>
            )}

            {activeTab === "agent" && (
            <>
            <h2 className="settings-page__h2">{t("settings.section.agent")}</h2>
            <div className="settings-card" id="settings-agent-card">
              {onMaxAgentTurns ? (
                <div
                  className={"settings-row settings-row--stack" + rowHighlight("settings-anchor-maxAgentTurns")}
                  id="settings-anchor-maxAgentTurns"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.maxAgentTurns")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.maxAgentTurnsDesc")}
                    </div>
                  </div>
                  <input
                    className="settings-input"
                    type="number"
                    min={0}
                    max={200}
                    step={1}
                    placeholder={t("settings.maxAgentTurnsPlaceholder")}
                    value={maxAgentTurns > 0 ? maxAgentTurns : ""}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      if (!raw) {
                        onMaxAgentTurns(0);
                        return;
                      }
                      const n = Number(raw);
                      if (!Number.isFinite(n)) return;
                      onMaxAgentTurns(Math.min(200, Math.max(0, Math.round(n))));
                    }}
                  />
                </div>
              ) : null}
              {onBackgroundWaitPolicy ? (
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-backgroundWait")
                  }
                  id="settings-anchor-backgroundWait"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.backgroundWaitPolicy")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.backgroundWaitPolicyDesc")}
                    </div>
                  </div>
                  <Select
                    value={
                      backgroundWaitPolicy === "no_wait" ||
                      backgroundWaitPolicy === "timeout"
                        ? backgroundWaitPolicy
                        : "wait"
                    }
                    onChange={(v) => onBackgroundWaitPolicy(v)}
                    options={[
                      {
                        value: "wait",
                        label: t("settings.backgroundWait.wait"),
                      },
                      {
                        value: "no_wait",
                        label: t("settings.backgroundWait.noWait"),
                      },
                      {
                        value: "timeout",
                        label: t("settings.backgroundWait.timeout"),
                      },
                    ]}
                    aria-label={t("settings.backgroundWaitPolicy")}
                  />
                  {backgroundWaitPolicy === "timeout" &&
                  onBackgroundWaitTimeoutSec ? (
                    <>
                      <div className="settings-row__text">
                        <div className="settings-row__label">
                          {t("settings.backgroundWaitTimeout")}
                        </div>
                        <div className="settings-row__desc">
                          {t("settings.backgroundWaitTimeoutDesc")}
                        </div>
                      </div>
                      <input
                        className="settings-input"
                        type="number"
                        min={1}
                        max={3600}
                        step={1}
                        value={
                          backgroundWaitTimeoutSec > 0
                            ? backgroundWaitTimeoutSec
                            : 600
                        }
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          const n = Number(raw);
                          if (!Number.isFinite(n)) return;
                          onBackgroundWaitTimeoutSec(
                            Math.min(3600, Math.max(1, Math.round(n))),
                          );
                        }}
                        aria-label={t("settings.backgroundWaitTimeout")}
                      />
                    </>
                  ) : null}
                </div>
              ) : null}
              {onPreferredAgent ? (
                <div
                  className={"settings-row settings-row--stack" + rowHighlight("settings-anchor-preferredAgent")}
                  id="settings-anchor-preferredAgent"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.preferredAgent")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.preferredAgentDesc")}
                    </div>
                  </div>
                  <Select
                    value={preferredAgent || ""}
                    onChange={(v) => onPreferredAgent(v)}
                    options={[
                      {
                        value: "",
                        label: t("settings.preferredAgent.default"),
                      },
                      ...agentCatalog.map((a) => {
                        const srcKey = (
                          {
                            builtin: "settings.preferredAgent.source.builtin",
                            bundled: "settings.preferredAgent.source.bundled",
                            user: "settings.preferredAgent.source.user",
                            project: "settings.preferredAgent.source.project",
                          } as const
                        )[a.source as "builtin" | "bundled" | "user" | "project"];
                        const srcLabel = srcKey ? t(srcKey) : a.source || "other";
                        return {
                          value: a.name,
                          label: `${a.name} · ${srcLabel}`,
                        };
                      }),
                    ]}
                  />
                </div>
              ) : null}
              {onAgentProfilePath ? (
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-agentProfilePath")
                  }
                  id="settings-anchor-agentProfilePath"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.agentProfilePath")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.agentProfilePathDesc")}
                    </div>
                  </div>
                  <input
                    className="settings-input"
                    value={agentProfilePath || ""}
                    placeholder={t("settings.agentProfilePathPlaceholder")}
                    onChange={(e) => onAgentProfilePath(e.target.value)}
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      onAgentProfilePath(next);
                      onAgentProfilePathCommit?.(next);
                    }}
                    spellCheck={false}
                    autoComplete="off"
                    aria-label={t("settings.agentProfilePath")}
                  />
                  <div
                    className="settings-row__actions"
                    style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                  >
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => {
                        void api.pickAgentProfile().then((path) => {
                          if (!path) return;
                          onAgentProfilePath(path);
                          onAgentProfilePathCommit?.(path);
                        });
                      }}
                    >
                      {t("settings.agentProfilePathBrowse")}
                    </button>
                    {agentProfilePath ? (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => {
                          onAgentProfilePath("");
                          onAgentProfilePathCommit?.("");
                        }}
                      >
                        {t("settings.agentProfilePathClear")}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <div
                className={rowHighlight("settings-anchor-configTomlView")}
              >
                <AgentConfigTomlPanel locale={resolveLocale(locale)} />
              </div>
              {onAgentsJson ? (
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-agentsJson")
                  }
                  id="settings-anchor-agentsJson"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.agentsJson")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.agentsJsonDesc")}
                    </div>
                  </div>
                  <textarea
                    className="settings-input settings-agents-json__textarea"
                    value={agentsJson || ""}
                    placeholder={t("settings.agentsJsonPlaceholder")}
                    onChange={(e) => {
                      setAgentsJsonError(null);
                      onAgentsJson(e.target.value);
                    }}
                    rows={6}
                    spellCheck={false}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    aria-label={t("settings.agentsJson")}
                    aria-invalid={agentsJsonError ? true : undefined}
                  />
                  {agentsJsonError ? (
                    <div
                      className="settings-row__desc"
                      role="alert"
                      style={{ color: "var(--danger, #e35)" }}
                    >
                      {agentsJsonError}
                    </div>
                  ) : null}
                  <div
                    className="settings-row__actions"
                    style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                  >
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={agentsJsonSaving}
                      onClick={() => {
                        const draft = agentsJson || "";
                        const parsed = parseAgentsJson(draft);
                        if (!parsed.ok) {
                          setAgentsJsonError(
                            t("settings.agentsJsonInvalid") +
                              (parsed.message ? ` ${parsed.message}` : ""),
                          );
                          return;
                        }
                        setAgentsJsonError(null);
                        const next = parsed.normalized;
                        onAgentsJson(next);
                        setAgentsJsonSaving(true);
                        void Promise.resolve(onAgentsJsonCommit?.(next))
                          .catch((e) => {
                            setAgentsJsonError(
                              String(e || t("settings.agentsJsonInvalid")),
                            );
                          })
                          .finally(() => setAgentsJsonSaving(false));
                      }}
                    >
                      {t("settings.agentsJsonApply")}
                    </button>
                    {agentsJson ? (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={agentsJsonSaving}
                        onClick={() => {
                          setAgentsJsonError(null);
                          onAgentsJson("");
                          setAgentsJsonSaving(true);
                          void Promise.resolve(onAgentsJsonCommit?.(""))
                            .catch((e) => {
                              setAgentsJsonError(String(e));
                            })
                            .finally(() => setAgentsJsonSaving(false));
                        }}
                      >
                        {t("settings.agentsJsonClear")}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {onExperimentalMemory ? (
                <div
                  className={"settings-row" + rowHighlight("settings-anchor-experimentalMemory")}
                  id="settings-anchor-experimentalMemory"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.experimentalMemory")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.experimentalMemoryDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!experimentalMemory}
                    onChange={() => onExperimentalMemory(!experimentalMemory)}
                    ariaLabel={t("settings.experimentalMemory")}
                  />
                </div>
              ) : null}
              {onCompactionMode ? (
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-compactionMode")
                  }
                  id="settings-anchor-compactionMode"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.compactionMode")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.compactionModeDesc")}
                    </div>
                  </div>
                  <Select
                    value={compactionMode || "summary"}
                    onChange={(v) => onCompactionMode(v)}
                    options={[
                      {
                        value: "summary",
                        label: t("settings.compactionMode.summary"),
                      },
                      {
                        value: "transcript",
                        label: t("settings.compactionMode.transcript"),
                      },
                      {
                        value: "segments",
                        label: t("settings.compactionMode.segments"),
                      },
                    ]}
                  />
                  <div className="settings-row__desc" style={{ marginTop: 8 }}>
                    {(() => {
                      const helpByMode: Record<string, string> = {
                        summary: "settings.compactionMode.summary.help",
                        transcript: "settings.compactionMode.transcript.help",
                        segments: "settings.compactionMode.segments.help",
                      };
                      return t(
                        helpByMode[compactionMode || "summary"] ??
                          "settings.compactionMode.summary.help",
                      );
                    })()}
                  </div>
                </div>
              ) : null}
              {onCompactionDetail ? (
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-compactionDetail")
                  }
                  id="settings-anchor-compactionDetail"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.compactionDetail")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.compactionDetailDesc")}
                    </div>
                  </div>
                  <Select
                    value={compactionDetail || "verbose"}
                    onChange={(v) => onCompactionDetail(v)}
                    disabled={(compactionMode || "summary") !== "segments"}
                    options={[
                      {
                        value: "none",
                        label: t("settings.compactionDetail.none"),
                      },
                      {
                        value: "minimal",
                        label: t("settings.compactionDetail.minimal"),
                      },
                      {
                        value: "balanced",
                        label: t("settings.compactionDetail.balanced"),
                      },
                      {
                        value: "verbose",
                        label: t("settings.compactionDetail.verbose"),
                      },
                    ]}
                  />
                  <div className="settings-row__desc" style={{ marginTop: 8 }}>
                    {t("settings.compactionDetail.help")}
                  </div>
                </div>
              ) : null}
              {onTwoPassCompactionEnabled ? (
                <div
                  className={
                    "settings-row" +
                    rowHighlight("settings-anchor-twoPassCompaction")
                  }
                  id="settings-anchor-twoPassCompaction"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.twoPassCompaction")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.twoPassCompactionDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!twoPassCompactionEnabled}
                    onChange={() =>
                      onTwoPassCompactionEnabled(!twoPassCompactionEnabled)
                    }
                    ariaLabel={t("settings.twoPassCompaction")}
                  />
                </div>
              ) : null}
              {onExperimentalMemory ? (
                <div
                  className={
                    "settings-memory-browser-wrap" +
                    rowHighlight("settings-anchor-memoryBrowser")
                  }
                >
                  <MemoryBrowserPanel
                    key={memoryBrowserEpoch}
                    locale={resolveLocale(locale)}
                    projectPath={workspaceCwd}
                    experimentalMemory={!!experimentalMemory}
                    onClearAll={
                      workspaceCwd
                        ? () => setClearMemoryOpen(true)
                        : undefined
                    }
                    clearAllBusy={clearMemoryBusy}
                  />
                </div>
              ) : null}
              <div
                className={
                  "settings-memory-embed-wrap" +
                  rowHighlight("settings-anchor-memoryEmbed")
                }
              >
                <MemoryEmbedPanel
                  locale={resolveLocale(locale)}
                  onSaved={() =>
                    showSettingsToast(t("settings.memoryEmbed.saved"), 2200)
                  }
                  onError={(msg) => showSettingsToast(msg, 3200)}
                />
              </div>
              <div
                className={
                  "settings-codebase-indexing-wrap" +
                  rowHighlight("settings-anchor-codebaseIndexing")
                }
              >
                <CodebaseIndexingPanel
                  locale={resolveLocale(locale)}
                  cliVersion={cliInfo.version}
                  onSaved={() =>
                    showSettingsToast(
                      t("settings.codebaseIndexing.saved"),
                      2200,
                    )
                  }
                  onError={(msg) => showSettingsToast(msg, 3200)}
                />
              </div>
              <div
                className={
                  "settings-codebase-search-wrap" +
                  rowHighlight("settings-anchor-codebaseSearch")
                }
              >
                <CodebaseSearchPanel
                  locale={resolveLocale(locale)}
                  projectPath={workspaceCwd}
                  onOpenInResources={onOpenProjectFileInResources}
                />
              </div>
              {onSubagentsEnabled ? (
                <div
                  className={"settings-row" + rowHighlight("settings-anchor-subagents")}
                  id="settings-anchor-subagents"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.subagentsEnabled")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.subagentsEnabledDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!subagentsEnabled}
                    onChange={() => onSubagentsEnabled(!subagentsEnabled)}
                    ariaLabel={t("settings.subagentsEnabled")}
                  />
                </div>
              ) : null}
              {onSubagentWorktreeSnapshotEnabled ? (
                <div
                  className={
                    "settings-row" +
                    rowHighlight("settings-anchor-subagentWtSnap")
                  }
                  id="settings-anchor-subagentWtSnap"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.subagentWorktreeSnapshot")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.subagentWorktreeSnapshotDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!subagentWorktreeSnapshotEnabled}
                    onChange={() =>
                      onSubagentWorktreeSnapshotEnabled(
                        !subagentWorktreeSnapshotEnabled,
                      )
                    }
                    ariaLabel={t("settings.subagentWorktreeSnapshot")}
                  />
                </div>
              ) : null}
              {onAutoWakeEnabled ? (
                <div
                  className={
                    "settings-row" + rowHighlight("settings-anchor-autoWake")
                  }
                  id="settings-anchor-autoWake"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.autoWake")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.autoWakeDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!autoWakeEnabled}
                    onChange={() => onAutoWakeEnabled(!autoWakeEnabled)}
                    ariaLabel={t("settings.autoWake")}
                  />
                </div>
              ) : null}
              {onPlanEnabled ? (
                <div
                  className={"settings-row" + rowHighlight("settings-anchor-planEnabled")}
                  id="settings-anchor-planEnabled"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.planEnabled")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.planEnabledDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!planEnabled}
                    onChange={() => onPlanEnabled(!planEnabled)}
                    ariaLabel={t("settings.planEnabled")}
                  />
                </div>
              ) : null}
              {onTodoGateEnabled ? (
                (() => {
                  const todoGateView = describeTodoGateSettings({
                    enabled: todoGateEnabled,
                    maxFires: todoGateMaxFiresPerPrompt,
                    maxFiresRaw: todoGateMaxFiresPerPrompt,
                    sessionDataMode,
                    cliVersion: cliInfo.version,
                    fireSignal: todoGateFireSignal,
                  });
                  return (
                    <>
                      <div
                        className={
                          "settings-row settings-row--stack" +
                          rowHighlight("settings-anchor-todoGate")
                        }
                        id="settings-anchor-todoGate"
                      >
                        <div className="settings-row__text">
                          <div className="settings-row__label">
                            {t("settings.todoGate")}
                          </div>
                          <div className="settings-row__desc">
                            {t("settings.todoGateDesc")}
                          </div>
                        </div>
                        <UiCheck
                          checked={!!todoGateEnabled}
                          onChange={() => onTodoGateEnabled(!todoGateEnabled)}
                          ariaLabel={t("settings.todoGate")}
                        />
                        <div
                          className="settings-row__hint"
                          role="status"
                          style={{ marginTop: 6 }}
                        >
                          {t(todoGateView.softRespawnKey)}
                        </div>
                        {todoGateView.cliSoftFailKey ? (
                          <div
                            className="settings-row__hint is-danger"
                            role="status"
                            style={{ marginTop: 4 }}
                          >
                            {t(todoGateView.cliSoftFailKey, {
                              min: TODO_GATE_MIN_CLI,
                            })}
                          </div>
                        ) : null}
                        <div
                          className={
                            "settings-row__hint" +
                            (todoGateView.activity.tone === "warn"
                              ? " is-danger"
                              : "")
                          }
                          role="status"
                          style={{ marginTop: 4 }}
                          data-todo-gate-activity={todoGateView.activity.kind}
                        >
                          {t(
                            todoGateView.activity.messageKey,
                            todoGateView.activity.vars,
                          )}
                        </div>
                      </div>
                      {onTodoGateMaxFiresPerPrompt ? (
                        <div
                          className={
                            "settings-row settings-row--stack" +
                            rowHighlight("settings-anchor-todoGate")
                          }
                          id="settings-anchor-todoGateMaxFires"
                        >
                          <div className="settings-row__text">
                            <div className="settings-row__label">
                              {t("settings.todoGateMaxFires")}
                            </div>
                            <div className="settings-row__desc">
                              {t("settings.todoGateMaxFiresDesc")}
                            </div>
                          </div>
                          <input
                            className="settings-input"
                            type="number"
                            min={MIN_TODO_GATE_MAX_FIRES}
                            max={MAX_TODO_GATE_MAX_FIRES}
                            step={1}
                            disabled={!todoGateEnabled}
                            value={todoGateView.maxFires}
                            onChange={(e) => {
                              const raw = e.target.value.trim();
                              if (!raw) {
                                onTodoGateMaxFiresPerPrompt(
                                  DEFAULT_TODO_GATE_MAX_FIRES,
                                );
                                return;
                              }
                              const n = Number(raw);
                              if (!Number.isFinite(n)) return;
                              onTodoGateMaxFiresPerPrompt(
                                normalizeTodoGateMaxFires(n),
                              );
                            }}
                            aria-label={t("settings.todoGateMaxFires")}
                          />
                          <div
                            className="settings-row__hint"
                            role="status"
                            style={{ marginTop: 6 }}
                          >
                            {t(todoGateView.effectiveKey, {
                              n: todoGateView.maxFires,
                              min: MIN_TODO_GATE_MAX_FIRES,
                              max: MAX_TODO_GATE_MAX_FIRES,
                              default: DEFAULT_TODO_GATE_MAX_FIRES,
                            })}
                          </div>
                          <div
                            className={
                              "settings-row__hint" +
                              (todoGateView.applyPath === "shared_app_only"
                                ? " is-danger"
                                : "")
                            }
                            role="status"
                            style={{ marginTop: 4 }}
                          >
                            {t(todoGateView.applyPathKey)}
                          </div>
                          {todoGateView.clampedKey ? (
                            <div
                              className="settings-row__hint"
                              role="status"
                              style={{ marginTop: 4 }}
                            >
                              {t(todoGateView.clampedKey, {
                                min: MIN_TODO_GATE_MAX_FIRES,
                                max: MAX_TODO_GATE_MAX_FIRES,
                                default: DEFAULT_TODO_GATE_MAX_FIRES,
                              })}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  );
                })()
              ) : null}
              {onDisableWebSearch ? (
                <div
                  className={"settings-row" + rowHighlight("settings-anchor-disableWebSearch")}
                  id="settings-anchor-disableWebSearch"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.disableWebSearch")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.disableWebSearchDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!disableWebSearch}
                    onChange={() => onDisableWebSearch(!disableWebSearch)}
                    ariaLabel={t("settings.disableWebSearch")}
                  />
                </div>
              ) : null}
              {onNoAskUser ? (
                <div
                  className={"settings-row" + rowHighlight("settings-anchor-noAskUser")}
                  id="settings-anchor-noAskUser"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.noAskUser")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.noAskUserDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!noAskUser}
                    onChange={() => onNoAskUser(!noAskUser)}
                    ariaLabel={t("settings.noAskUser")}
                  />
                </div>
              ) : null}
              {onAllowedTools ? (
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-allowedTools")
                  }
                  id="settings-anchor-allowedTools"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.allowedTools")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.allowedToolsDesc")}
                    </div>
                    {bothToolListsSet(allowedTools, disallowedTools) ? (
                      <div className="settings-row__hint">
                        {t("settings.allowedTools.bothSet")}
                      </div>
                    ) : null}
                  </div>
                  <div
                    className="settings-tool-deny__chips"
                    role="group"
                    aria-label={t("settings.allowedTools")}
                  >
                    {COMMON_ALLOWED_TOOLS.map((tool) => {
                      const selected = isToolAllowed(allowedTools, tool.id);
                      return (
                        <button
                          key={tool.id}
                          type="button"
                          className={
                            "settings-tool-deny__chip" +
                            (selected ? " is-on" : "") +
                            (tool.caution ? " is-caution" : "")
                          }
                          aria-pressed={selected}
                          title={
                            tool.caution
                              ? t("settings.allowedTools.caution")
                              : tool.id
                          }
                          onClick={() => {
                            onAllowedTools(
                              toggleAllowedTool(allowedTools, tool.id),
                            );
                          }}
                        >
                          {tool.id}
                        </button>
                      );
                    })}
                  </div>
                  <div className="settings-tool-deny__row">
                    <input
                      type="text"
                      className="settings-input settings-tool-deny__input"
                      placeholder={t("settings.allowedToolsPlaceholder")}
                      defaultValue={normalizeAllowedTools(allowedTools)
                        .filter(
                          (id) =>
                            !COMMON_ALLOWED_TOOLS.some(
                              (c) => c.id.toLowerCase() === id.toLowerCase(),
                            ),
                        )
                        .join(", ")}
                      key={normalizeAllowedTools(allowedTools)
                        .filter(
                          (id) =>
                            !COMMON_ALLOWED_TOOLS.some(
                              (c) => c.id.toLowerCase() === id.toLowerCase(),
                            ),
                        )
                        .join(",")}
                      onBlur={(e) => {
                        const custom = parseAllowedToolsInput(e.target.value);
                        const keptCommon = normalizeAllowedTools(
                          allowedTools,
                        ).filter((id) =>
                          COMMON_ALLOWED_TOOLS.some(
                            (c) => c.id.toLowerCase() === id.toLowerCase(),
                          ),
                        );
                        onAllowedTools(
                          normalizeAllowedTools([...keptCommon, ...custom]),
                        );
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                    />
                    {normalizeAllowedTools(allowedTools).length > 0 ? (
                      <button
                        type="button"
                        className="btn btn--sm settings-tool-deny__clear"
                        onClick={() => onAllowedTools([])}
                      >
                        {t("settings.allowedTools.clear")}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {onDisallowedTools ? (
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-disallowedTools")
                  }
                  id="settings-anchor-disallowedTools"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.disallowedTools")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.disallowedToolsDesc")}
                    </div>
                    {disableWebSearch ? (
                      <div className="settings-row__hint">
                        {t("settings.disallowedTools.webCovered")}
                      </div>
                    ) : null}
                    {bothToolListsSet(allowedTools, disallowedTools) ? (
                      <div className="settings-row__hint">
                        {t("settings.allowedTools.bothSet")}
                      </div>
                    ) : null}
                  </div>
                  <div
                    className="settings-tool-deny__chips"
                    role="group"
                    aria-label={t("settings.disallowedTools")}
                  >
                    {COMMON_DISALLOWED_TOOLS.map((tool) => {
                      const selected =
                        isToolDisallowed(disallowedTools, tool.id) ||
                        (!!disableWebSearch && isWebSearchTool(tool.id));
                      const coveredByWeb =
                        !!disableWebSearch && isWebSearchTool(tool.id);
                      return (
                        <button
                          key={tool.id}
                          type="button"
                          className={
                            "settings-tool-deny__chip" +
                            (selected ? " is-on" : "") +
                            (tool.caution ? " is-caution" : "") +
                            (coveredByWeb ? " is-covered" : "")
                          }
                          aria-pressed={selected}
                          title={
                            tool.caution
                              ? t("settings.disallowedTools.caution")
                              : coveredByWeb
                                ? t("settings.disallowedTools.webCovered")
                                : tool.id
                          }
                          onClick={() => {
                            if (coveredByWeb) return;
                            onDisallowedTools(
                              toggleDisallowedTool(disallowedTools, tool.id),
                            );
                          }}
                        >
                          {tool.id}
                        </button>
                      );
                    })}
                  </div>
                  <div className="settings-tool-deny__row">
                    <input
                      type="text"
                      className="settings-input settings-tool-deny__input"
                      placeholder={t("settings.disallowedToolsPlaceholder")}
                      defaultValue={normalizeDisallowedTools(disallowedTools)
                        .filter(
                          (id) =>
                            !COMMON_DISALLOWED_TOOLS.some(
                              (c) => c.id.toLowerCase() === id.toLowerCase(),
                            ),
                        )
                        .join(", ")}
                      key={normalizeDisallowedTools(disallowedTools)
                        .filter(
                          (id) =>
                            !COMMON_DISALLOWED_TOOLS.some(
                              (c) => c.id.toLowerCase() === id.toLowerCase(),
                            ),
                        )
                        .join(",")}
                      onBlur={(e) => {
                        const custom = parseDisallowedToolsInput(e.target.value);
                        const keptCommon = normalizeDisallowedTools(
                          disallowedTools,
                        ).filter((id) =>
                          COMMON_DISALLOWED_TOOLS.some(
                            (c) => c.id.toLowerCase() === id.toLowerCase(),
                          ),
                        );
                        onDisallowedTools(
                          normalizeDisallowedTools([...keptCommon, ...custom]),
                        );
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                    />
                    {normalizeDisallowedTools(disallowedTools).length > 0 ? (
                      <button
                        type="button"
                        className="btn btn--sm settings-tool-deny__clear"
                        onClick={() => onDisallowedTools([])}
                      >
                        {t("settings.disallowedTools.clear")}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {onUseLeader ? (
                <div
                  className={"settings-row" + rowHighlight("settings-anchor-useLeader")}
                  id="settings-anchor-useLeader"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.useLeader")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.useLeaderDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!useLeader}
                    onChange={() => onUseLeader(!useLeader)}
                    ariaLabel={t("settings.useLeader")}
                  />
                </div>
              ) : null}
              <div className={rowHighlight("settings-anchor-configTomlEdit")}>
                <AgentConfigEditPanel locale={resolveLocale(locale)} />
              </div>
            </div>
            </>
            )}

            {activeTab === "app" && (
            <>
            <h2 className="settings-page__h2">{t("settings.section.voice")}</h2>
            <div className="settings-card" id="settings-voice-card">
              <div
                className={
                  "settings-row" +
                  rowHighlight("settings-anchor-voiceHotkeyEnabled")
                }
                id="settings-anchor-voiceHotkeyEnabled"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.voiceHotkeyEnabled")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.voiceHotkeyEnabledDesc")}
                  </div>
                </div>
                <UiCheck
                  checked={voiceHotkeyEnabled}
                  onChange={() => {
                    const next = !voiceHotkeyEnabled;
                    setVoiceHotkeyEnabled(next);
                    saveVoiceHotkeyEnabled(next);
                  }}
                  ariaLabel={t("settings.voiceHotkeyEnabled")}
                />
              </div>
              {onVoiceId ? (
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-voiceId")
                  }
                  id="settings-anchor-voiceId"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.voiceId")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.voiceIdDesc")}
                    </div>
                  </div>
                  <Select
                    value={voiceId || "eve"}
                    onChange={(v) => onVoiceId(v)}
                    options={[
                      { value: "eve", label: "Eve" },
                      { value: "ara", label: "Ara" },
                      { value: "rex", label: "Rex" },
                      { value: "sal", label: "Sal" },
                      { value: "leo", label: "Leo" },
                      ...(voiceId &&
                      !["eve", "ara", "rex", "sal", "leo"].includes(voiceId)
                        ? [{ value: voiceId, label: voiceId }]
                        : []),
                    ]}
                  />
                </div>
              ) : null}
              {onVoiceDictationAutoSend ? (
                <div
                  className={
                    "settings-row" +
                    rowHighlight("settings-anchor-voiceDictationAutoSend")
                  }
                  id="settings-anchor-voiceDictationAutoSend"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.voiceDictationAutoSend")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.voiceDictationAutoSendDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!voiceDictationAutoSend}
                    onChange={() =>
                      onVoiceDictationAutoSend(!voiceDictationAutoSend)
                    }
                    ariaLabel={t("settings.voiceDictationAutoSend")}
                  />
                </div>
              ) : null}
              {onVoiceKeepAgentsOnEnd ? (
                <div
                  className={
                    "settings-row" +
                    rowHighlight("settings-anchor-voiceKeepAgentsOnEnd")
                  }
                  id="settings-anchor-voiceKeepAgentsOnEnd"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.voiceKeepAgentsOnEnd")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.voiceKeepAgentsOnEndDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!voiceKeepAgentsOnEnd}
                    onChange={() =>
                      onVoiceKeepAgentsOnEnd(!voiceKeepAgentsOnEnd)
                    }
                    ariaLabel={t("settings.voiceKeepAgentsOnEnd")}
                  />
                </div>
              ) : null}
            </div>

            <h2 className="settings-page__h2">{t("settings.section.general")}</h2>
            <div className="settings-card">
              <div
                className={"settings-row" + rowHighlight("settings-anchor-language")}
                id="settings-anchor-language"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    <IconLanguage size={16} />
                    {t("settings.language")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.languageDesc")}
                  </div>
                </div>
                <Select
                  value={localePreference}
                  onChange={onLocale}
                  options={[
                    { value: "system", label: t("settings.languageSystem") },
                    { value: "en", label: "English" },
                    { value: "zh", label: "简体中文" },
                    { value: "zh-TW", label: "繁體中文" },
                  ]}
                />
              </div>
              <div
                className={
                  "settings-row" + rowHighlight("settings-anchor-sessionDataMode")
                }
                id="settings-anchor-sessionDataMode"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.sessionDataMode")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.sessionDataModeDesc")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.sessionModeHelp")}
                  </div>
                </div>
                <Select
                  value={sessionDataMode}
                  onChange={onSessionDataMode}
                  options={[
                    {
                      value: "independent",
                      label: t("settings.modeIndependent"),
                    },
                    { value: "shared", label: t("settings.modeShared") },
                  ]}
                />
              </div>
              <CliSessionsPanel
                t={t}
                sessionDataMode={sessionDataMode}
                onImported={onCliSessionsImported}
                onOpenSession={onOpenCliSession}
              />
              {onStoreApiKeysInKeychain ? (
                <div
                  className={
                    "settings-row" + rowHighlight("settings-anchor-keychain")
                  }
                  id="settings-anchor-keychain"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.storeApiKeysInKeychain")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.storeApiKeysInKeychainDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={storeApiKeysInKeychain}
                    onChange={() =>
                      onStoreApiKeysInKeychain(!storeApiKeysInKeychain)
                    }
                    ariaLabel={t("settings.storeApiKeysInKeychain")}
                  />
                </div>
              ) : null}
              {workspaceCwd ? (
                <div
                  className={"settings-row" + rowHighlight("settings-anchor-clearMemory")}
                  id="settings-anchor-clearMemory"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.clearWorkspaceMemory")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.clearWorkspaceMemoryDesc")}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn--ghost btn--danger settings-row__action"
                    disabled={clearMemoryBusy}
                    onClick={() => setClearMemoryOpen(true)}
                  >
                    {clearMemoryBusy
                      ? t("settings.clearWorkspaceMemoryBusy")
                      : t("settings.clearWorkspaceMemory")}
                  </button>
                </div>
              ) : null}
              {onReopenLastSession ? (
                <div
                  className={"settings-row" + rowHighlight("settings-anchor-reopenLastSession")}
                  id="settings-anchor-reopenLastSession"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.reopenLastSession")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.reopenLastSessionDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!reopenLastSession}
                    onChange={() => onReopenLastSession(!reopenLastSession)}
                    ariaLabel={t("settings.reopenLastSession")}
                  />
                </div>
              ) : null}
              {onCloseToTray ? (
                <div
                  className={
                    "settings-row" + rowHighlight("settings-anchor-closeToTray")
                  }
                  id="settings-anchor-closeToTray"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.closeToTray")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.closeToTrayDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!closeToTray}
                    onChange={() => onCloseToTray(!closeToTray)}
                    ariaLabel={t("settings.closeToTray")}
                  />
                </div>
              ) : null}
              {onKeepTrayForSchedules ? (
                <div
                  className={
                    "settings-row" +
                    rowHighlight("settings-anchor-keepTrayForSchedules")
                  }
                  id="settings-anchor-keepTrayForSchedules"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.keepTrayForSchedules")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.keepTrayForSchedulesDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!keepTrayForSchedules}
                    onChange={() =>
                      onKeepTrayForSchedules(!keepTrayForSchedules)
                    }
                    ariaLabel={t("settings.keepTrayForSchedules")}
                  />
                </div>
              ) : null}
              {onTrayBusyBadge ? (
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-trayBusyBadge")
                  }
                  id="settings-anchor-trayBusyBadge"
                >
                  <div className="settings-tray-notify__row-main">
                    <div className="settings-row__text">
                      <div className="settings-row__label">
                        {t("settings.trayBusyBadge")}
                      </div>
                      <div className="settings-row__desc">
                        {t("settings.trayBusyBadgeDesc")}
                      </div>
                    </div>
                    <UiCheck
                      checked={!!trayBusyBadge}
                      onChange={() => onTrayBusyBadge(!trayBusyBadge)}
                      ariaLabel={t("settings.trayBusyBadge")}
                    />
                  </div>
                  <div
                    className={
                      "settings-tray-notify__status" +
                      (trayBusySurface.severity === "info"
                        ? " is-info"
                        : "")
                    }
                    role="status"
                  >
                    {t(trayBusySurface.statusKey, {
                      n: trayBusySurface.displayCount,
                      cap: trayBusySurface.displayCount,
                    })}
                  </div>
                </div>
              ) : null}
              {onLaunchAtLogin ? (
                <div
                  className={
                    "settings-row" +
                    rowHighlight("settings-anchor-launchAtLogin")
                  }
                  id="settings-anchor-launchAtLogin"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.launchAtLogin")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.launchAtLoginDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!launchAtLogin}
                    onChange={() => onLaunchAtLogin(!launchAtLogin)}
                    ariaLabel={t("settings.launchAtLogin")}
                  />
                </div>
              ) : null}
              {onWindowAlwaysOnTop ? (
                <div
                  className={
                    "settings-row" +
                    rowHighlight("settings-anchor-windowAlwaysOnTop")
                  }
                  id="settings-anchor-windowAlwaysOnTop"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.windowAlwaysOnTop")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.windowAlwaysOnTopDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!windowAlwaysOnTop}
                    onChange={() => onWindowAlwaysOnTop(!windowAlwaysOnTop)}
                    ariaLabel={t("settings.windowAlwaysOnTop")}
                  />
                </div>
              ) : null}
              {onNotifyOnTurnDone || onNotifyOnPermission || onNotifySound ? (
                <div
                  className={
                    "settings-row settings-row--stack settings-tray-notify__honesty" +
                    rowHighlight("settings-anchor-notifyHonesty")
                  }
                  id="settings-anchor-notifyHonesty"
                >
                  <div className="settings-tray-notify__honesty-head">
                    <div className="settings-row__text">
                      <div className="settings-row__label">
                        {t("settings.notify.honesty.title")}
                      </div>
                      <div className="settings-row__desc">
                        {t("settings.notify.honesty.desc")}
                      </div>
                    </div>
                  </div>
                  <div className="settings-tray-notify__honesty-body">
                    <span
                      className={
                        "settings-acp-chip settings-tray-notify__perm-chip" +
                        (notifyHonesty.severity === "warn"
                          ? " is-fail"
                          : notifyHonesty.canFireDesktop
                            ? " is-ok"
                            : "")
                      }
                      role="status"
                    >
                      <span className="settings-acp-chip__dot" aria-hidden />
                      <span className="settings-acp-chip__label">
                        {t(notifyHonesty.permissionLabelKey)}
                      </span>
                    </span>
                    {notifyHonesty.canRequestPermission ? (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={notifyPermBusy}
                        onClick={() => void requestNotifyPermission()}
                      >
                        {notifyPermBusy
                          ? t("settings.notify.honesty.requesting")
                          : t("settings.notify.honesty.request")}
                      </button>
                    ) : null}
                  </div>
                  <div
                    className={
                      "settings-tray-notify__status" +
                      (notifyHonesty.severity === "warn"
                        ? " is-warn"
                        : notifyHonesty.severity === "info"
                          ? " is-info"
                          : "")
                    }
                    role="status"
                  >
                    {t(notifyHonesty.blockReasonKey)}
                  </div>
                </div>
              ) : null}
              {onNotifyOnTurnDone ? (
                <div
                  className={
                    "settings-row" +
                    rowHighlight("settings-anchor-notifyOnTurnDone")
                  }
                  id="settings-anchor-notifyOnTurnDone"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.notifyOnTurnDone")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.notifyOnTurnDoneDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!notifyOnTurnDone}
                    onChange={() => onNotifyOnTurnDone(!notifyOnTurnDone)}
                    ariaLabel={t("settings.notifyOnTurnDone")}
                  />
                </div>
              ) : null}
              {onNotifyOnPermission ? (
                <div
                  className={
                    "settings-row" +
                    rowHighlight("settings-anchor-notifyOnPermission")
                  }
                  id="settings-anchor-notifyOnPermission"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.notifyOnPermission")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.notifyOnPermissionDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!notifyOnPermission}
                    onChange={() => onNotifyOnPermission(!notifyOnPermission)}
                    ariaLabel={t("settings.notifyOnPermission")}
                  />
                </div>
              ) : null}
              {onNotifySound ? (
                <div
                  className={
                    "settings-row" +
                    rowHighlight("settings-anchor-notifySound")
                  }
                  id="settings-anchor-notifySound"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.notifySound")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.notifySoundDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!notifySound}
                    onChange={() => onNotifySound(!notifySound)}
                    ariaLabel={t("settings.notifySound")}
                  />
                </div>
              ) : null}
              <div
                className={
                  "settings-row" +
                  rowHighlight("settings-anchor-notifyQuietHours")
                }
                id="settings-anchor-notifyQuietHours"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.notifyQuietHours")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.notifyQuietHoursDesc")}
                  </div>
                </div>
                <UiCheck
                  checked={!!notifyQuietHours.enabled}
                  onChange={() =>
                    onNotifyQuietHours({
                      ...notifyQuietHours,
                      enabled: !notifyQuietHours.enabled,
                    })
                  }
                  ariaLabel={t("settings.notifyQuietHours")}
                />
              </div>
              {notifyQuietHours.enabled ? (
                <div className="settings-row settings-row--stack settings-quiet-hours">
                  {notifyHonesty.quietHoursActive ? (
                    <div
                      className="settings-tray-notify__status is-info"
                      role="status"
                    >
                      {t("settings.notifyQuietHours.activeNow")}
                    </div>
                  ) : null}
                  <div className="settings-quiet-hours__times">
                    <label className="settings-quiet-hours__field">
                      <span className="settings-quiet-hours__label">
                        {t("settings.notifyQuietHoursStart")}
                      </span>
                      <input
                        type="time"
                        className="settings-input settings-quiet-hours__input"
                        value={notifyQuietHours.start}
                        onChange={(e) => {
                          const next =
                            normalizeHHmm(e.target.value) ??
                            notifyQuietHours.start;
                          onNotifyQuietHours({
                            ...notifyQuietHours,
                            start: next,
                          });
                        }}
                        aria-label={t("settings.notifyQuietHoursStart")}
                      />
                    </label>
                    <label className="settings-quiet-hours__field">
                      <span className="settings-quiet-hours__label">
                        {t("settings.notifyQuietHoursEnd")}
                      </span>
                      <input
                        type="time"
                        className="settings-input settings-quiet-hours__input"
                        value={notifyQuietHours.end}
                        onChange={(e) => {
                          const next =
                            normalizeHHmm(e.target.value) ??
                            notifyQuietHours.end;
                          onNotifyQuietHours({
                            ...notifyQuietHours,
                            end: next,
                          });
                        }}
                        aria-label={t("settings.notifyQuietHoursEnd")}
                      />
                    </label>
                  </div>
                </div>
              ) : null}
              <div
                className={
                  "settings-row" +
                  rowHighlight("settings-anchor-stopAllSkipConfirm")
                }
                id="settings-anchor-stopAllSkipConfirm"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.stopAllSkipConfirm")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.stopAllSkipConfirmDesc")}
                  </div>
                </div>
                <UiCheck
                  checked={stopAllSkipConfirm}
                  onChange={() => {
                    const next = !stopAllSkipConfirm;
                    setStopAllSkipConfirm(next);
                    saveStopAllSkipConfirmPref(next);
                  }}
                  ariaLabel={t("settings.stopAllSkipConfirm")}
                />
              </div>
              <div
                className={
                  "settings-row" +
                  rowHighlight("settings-anchor-alwaysQuitWithoutAsking")
                }
                id="settings-anchor-alwaysQuitWithoutAsking"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.alwaysQuitWithoutAsking")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.alwaysQuitWithoutAskingDesc")}
                  </div>
                </div>
                <UiCheck
                  checked={alwaysQuitWithoutAsking}
                  onChange={() => {
                    const next = !alwaysQuitWithoutAsking;
                    setAlwaysQuitWithoutAsking(next);
                    saveAlwaysQuitWithoutAskingPref(next);
                  }}
                  ariaLabel={t("settings.alwaysQuitWithoutAsking")}
                />
              </div>
              {onDefaultOpenTarget && (
                <div
                  className={"settings-row" + rowHighlight("settings-anchor-openTarget")}
                  id="settings-anchor-openTarget"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.openTarget")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.openTargetDesc")}
                    </div>
                  </div>
                  <Select
                    value={defaultOpenTarget}
                    onChange={onDefaultOpenTarget}
                    options={[
                      { value: "finder", label: t("settings.openFinder") },
                      ...editors.map((e) => ({
                        value: e.id,
                        label: e.label,
                      })),
                    ]}
                  />
                </div>
              )}
            </div>
            </>
            )}
          </>
        )}

        {section === "appearance" && (
          <>
            <SettingsTabStrip
              tabs={sectionNav?.tabs ?? []}
              active={activeTab}
              onChange={setSectionTab}
              ariaLabel={title}
              t={(k) => t(k)}
            />

            {(activeTab === "theme" || activeTab == null) && (
              <>
                <h2 className="settings-page__h2">
                  {t("settings.tab.theme")}
                </h2>
                <div
                  className={
                    "settings-card" + rowHighlight("settings-anchor-theme")
                  }
                  id="settings-anchor-theme"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        leading={<IconAppearance size={16} />}
                        label={t("settings.theme")}
                        tip={t("settings.themeDesc")}
                      />
                    </div>
                    <div
                      className="settings-seg"
                      role="radiogroup"
                      aria-label={t("settings.theme")}
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={themePreference === "system"}
                        className={
                          "settings-seg__btn" +
                          (themePreference === "system" ? " is-on" : "")
                        }
                        onClick={() => onTheme("system")}
                      >
                        {t("settings.themeSystem")}
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={themePreference === "light"}
                        className={
                          "settings-seg__btn" +
                          (themePreference === "light" ? " is-on" : "")
                        }
                        onClick={() => onTheme("light")}
                      >
                        {t("settings.themeLight")}
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={themePreference === "dark"}
                        className={
                          "settings-seg__btn" +
                          (themePreference === "dark" ? " is-on" : "")
                        }
                        onClick={() => onTheme("dark")}
                      >
                        {t("settings.themeDark")}
                      </button>
                    </div>
                  </div>
                  {onThemeSchedule ? (
                    <>
                      <div
                        className={
                          "settings-row" +
                          rowHighlight("settings-anchor-themeSchedule")
                        }
                        id="settings-anchor-themeSchedule"
                      >
                        <div className="settings-row__text">
                          <SettingsLabelWithTip
                            label={t("settings.themeSchedule")}
                            tip={t("settings.themeScheduleDesc")}
                          />
                        </div>
                        <UiCheck
                          checked={!!themeSchedule.enabled}
                          onChange={() =>
                            onThemeSchedule({
                              ...themeSchedule,
                              enabled: !themeSchedule.enabled,
                            })
                          }
                          ariaLabel={t("settings.themeSchedule")}
                        />
                      </div>
                      {themeSchedule.enabled ? (
                        <div className="settings-row settings-row--stack settings-quiet-hours">
                          <div className="settings-quiet-hours__times">
                            <label className="settings-quiet-hours__field">
                              <span className="settings-quiet-hours__label">
                                {t("settings.themeScheduleLightFrom")}
                              </span>
                              <input
                                type="time"
                                className="settings-input settings-quiet-hours__input"
                                value={themeSchedule.lightFrom}
                                onChange={(e) => {
                                  const next =
                                    normalizeHHmm(e.target.value) ??
                                    themeSchedule.lightFrom;
                                  onThemeSchedule({
                                    ...themeSchedule,
                                    lightFrom: next,
                                  });
                                }}
                                aria-label={t(
                                  "settings.themeScheduleLightFrom",
                                )}
                              />
                            </label>
                            <label className="settings-quiet-hours__field">
                              <span className="settings-quiet-hours__label">
                                {t("settings.themeScheduleDarkFrom")}
                              </span>
                              <input
                                type="time"
                                className="settings-input settings-quiet-hours__input"
                                value={themeSchedule.darkFrom}
                                onChange={(e) => {
                                  const next =
                                    normalizeHHmm(e.target.value) ??
                                    themeSchedule.darkFrom;
                                  onThemeSchedule({
                                    ...themeSchedule,
                                    darkFrom: next,
                                  });
                                }}
                                aria-label={t(
                                  "settings.themeScheduleDarkFrom",
                                )}
                              />
                            </label>
                          </div>
                          {themeScheduleHonesty.statusKey ? (
                            <div
                              className={
                                "settings-tray-notify__status" +
                                (themeScheduleHonesty.severity === "warn"
                                  ? " is-warn"
                                  : themeScheduleHonesty.severity === "info"
                                    ? " is-info"
                                    : "")
                              }
                              role="status"
                            >
                              {themeScheduleHonesty.next &&
                              (themeScheduleHonesty.statusKey ===
                                "settings.themeSchedule.nextSwitch" ||
                                themeScheduleHonesty.statusKey ===
                                  "settings.themeSchedule.nextSwitchTomorrow")
                                ? t(themeScheduleHonesty.statusKey, {
                                    time: themeScheduleHonesty.next.atHHmm,
                                    theme:
                                      themeScheduleHonesty.next.toTheme ===
                                      "light"
                                        ? t("settings.themeLight")
                                        : t("settings.themeDark"),
                                  })
                                : t(themeScheduleHonesty.statusKey)}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
                {onSkin || onWallpaper ? (
                  <div className="settings-appearance-duo">
                    {onSkin ? (
                      <div
                        className={
                          "settings-card settings-card--appearance-col" +
                          rowHighlight("settings-anchor-skin")
                        }
                        id="settings-anchor-skin"
                      >
                        <div className="settings-row settings-row--stack">
                          <div className="settings-row__text">
                            <SettingsLabelWithTip
                              label={t("settings.skin")}
                              tip={t("settings.skinDesc")}
                            />
                          </div>
                          <div
                            className="settings-skin-grid"
                            role="listbox"
                            aria-label={t("settings.skin")}
                          >
                            {THEME_SKINS.map((pack) => {
                              const selected = skin === pack.id;
                              const label = t(
                                `settings.skin.${pack.id}` as "settings.skin.default",
                              );
                              return (
                                <button
                                  key={pack.id}
                                  type="button"
                                  role="option"
                                  aria-selected={selected}
                                  className={
                                    "settings-skin-card" +
                                    (selected ? " is-on" : "")
                                  }
                                  onClick={() => onSkin(pack.id)}
                                >
                                  <span
                                    className="settings-skin-card__swatch"
                                    style={{
                                      background: `linear-gradient(135deg, ${pack.swatch} 0%, ${pack.swatchAlt} 100%)`,
                                    }}
                                    aria-hidden
                                  />
                                  <span className="settings-skin-card__name">
                                    {label}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ) : null}
                    {onWallpaper ? (
                      <div
                        className={
                          "settings-card settings-card--appearance-col" +
                          rowHighlight("settings-anchor-wallpaper")
                        }
                        id="settings-anchor-wallpaper"
                      >
                        <div className="settings-row settings-row--stack">
                          <div className="settings-row__text">
                            <SettingsLabelWithTip
                              label={t("settings.wallpaper")}
                              tip={t("settings.wallpaperDesc")}
                            />
                          </div>
                          <div className="settings-wallpaper">
                            <input
                              ref={wallpaperInputRef}
                              type="file"
                              accept={WALLPAPER_ACCEPT}
                              hidden
                              onChange={(e) => {
                                void onWallpaperFile(e.target.files?.[0]).catch(
                                  () => {
                                    /* error already surfaced via wallpaperError */
                                  },
                                );
                              }}
                            />
                            <div className="settings-wallpaper__preview-wrap">
                              {wallpaperUrl ? (
                                <div
                                  className={
                                    "settings-wallpaper__preview settings-wallpaper__preview--set" +
                                    (wallpaperBusy
                                      ? " settings-wallpaper__preview--busy"
                                      : "")
                                  }
                                >
                                  <WallpaperMediaLayer
                                    url={wallpaperUrl}
                                    kind={wallpaperKind ?? "image"}
                                    focus={
                                      wallpaperFocus ?? DEFAULT_WALLPAPER_FOCUS
                                    }
                                    clip={wallpaperClip}
                                    intrinsicSize={wallpaperMediaSize}
                                    onIntrinsicSize={onWallpaperMediaSize}
                                    className="settings-wallpaper__media"
                                    mediaClassName="settings-wallpaper__media-el"
                                  />
                                  {wallpaperBusy ? (
                                    <span
                                      className="settings-wallpaper__busy"
                                      aria-hidden
                                    >
                                      {t("settings.wallpaperWorking")}
                                    </span>
                                  ) : null}
                                  <div className="settings-wallpaper__hover">
                                    <button
                                      type="button"
                                      className="btn btn--solid btn--sm"
                                      disabled={wallpaperBusy}
                                      onClick={() =>
                                        wallpaperInputRef.current?.click()
                                      }
                                    >
                                      {t("settings.wallpaperReplace")}
                                    </button>
                                    {onWallpaperAdjust ? (
                                      <button
                                        type="button"
                                        className="btn btn--solid btn--sm"
                                        disabled={wallpaperBusy}
                                        onClick={() =>
                                          setWallpaperFocusOpen(true)
                                        }
                                      >
                                        <IconCrop size={14} />
                                        {t("settings.wallpaperFocus")}
                                      </button>
                                    ) : null}
                                  </div>
                                  <button
                                    type="button"
                                    className="settings-wallpaper__clear btn btn--ghost btn--sm"
                                    disabled={wallpaperBusy}
                                    onClick={() => {
                                      setWallpaperError(null);
                                      setWallpaperFocusOpen(false);
                                      void onWallpaper(null);
                                    }}
                                  >
                                    {t("settings.wallpaperClear")}
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className={
                                    "settings-wallpaper__preview" +
                                    (wallpaperBusy
                                      ? " settings-wallpaper__preview--busy"
                                      : "")
                                  }
                                  disabled={wallpaperBusy}
                                  aria-label={
                                    wallpaperBusy
                                      ? t("settings.wallpaperWorking")
                                      : t("settings.wallpaperUpload")
                                  }
                                  onClick={() =>
                                    wallpaperInputRef.current?.click()
                                  }
                                >
                                  <span className="settings-wallpaper__preview-empty">
                                    {wallpaperBusy
                                      ? t("settings.wallpaperWorking")
                                      : t("settings.wallpaperEmpty")}
                                  </span>
                                </button>
                              )}
                            </div>
                            <div className="settings-wallpaper__actions">
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                disabled={wallpaperBusy}
                                onClick={() =>
                                  wallpaperInputRef.current?.click()
                                }
                              >
                                {wallpaperUrl
                                  ? t("settings.wallpaperReplace")
                                  : t("settings.wallpaperUpload")}
                              </button>
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                disabled={wallpaperBusy}
                                onClick={() => openWallpaperSource("x")}
                              >
                                {t("settings.wallpaperFromX")}
                              </button>
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                disabled={wallpaperBusy}
                                onClick={() => openWallpaperSource("imagine")}
                              >
                                {t("settings.wallpaperImagine")}
                              </button>
                            </div>
                            <WallpaperSourceModal
                              open={wallpaperSourceOpen}
                              onClose={() => setWallpaperSourceOpen(false)}
                              initialTab={wallpaperSourceTab}
                              t={t}
                              onPickFile={(file) => onWallpaperFile(file)}
                              onRequestLogin={() => {
                                setWallpaperSourceOpen(false);
                                onSection("account");
                              }}
                            />
                            {wallpaperUrl && onWallpaperAdjust ? (
                              <WallpaperFocusEditor
                                open={wallpaperFocusOpen}
                                onClose={() => setWallpaperFocusOpen(false)}
                                onApply={(result) => onWallpaperAdjust(result)}
                                mediaUrl={wallpaperUrl}
                                kind={wallpaperKind ?? "image"}
                                initialFocus={
                                  wallpaperFocus ?? DEFAULT_WALLPAPER_FOCUS
                                }
                                initialClip={wallpaperClip}
                                labels={{
                                  title: t("settings.wallpaperFocusTitle"),
                                  hint: t("settings.wallpaperFocusHint"),
                                  hintVideo: t(
                                    "settings.wallpaperFocusHintVideo",
                                  ),
                                  zoom: t("settings.wallpaperFocusZoom"),
                                  clip: t("settings.wallpaperClip"),
                                  clipStart: t("settings.wallpaperClipStart"),
                                  clipEnd: t("settings.wallpaperClipEnd"),
                                  reset: t("settings.wallpaperFocusReset"),
                                  cancel: t("common.cancel"),
                                  apply: t("settings.wallpaperFocusApply"),
                                  close: t("common.close"),
                                }}
                              />
                            ) : null}
                            {wallpaperUrl && onWallpaperScrim ? (
                              <div className="settings-wallpaper__scrim">
                                <div className="settings-wallpaper__scrim-head">
                                  <label
                                    className="settings-wallpaper__scrim-label"
                                    htmlFor="settings-wallpaper-scrim"
                                  >
                                    <span>{t("settings.wallpaperScrim")}</span>
                                    <Tip
                                      label={t("settings.wallpaperScrimDesc")}
                                      placement="top"
                                      className="ui-tip--wrap"
                                      delayMs={280}
                                    >
                                      <button
                                        type="button"
                                        className="settings-label-help"
                                        aria-label={t(
                                          "settings.wallpaperScrimDesc",
                                        )}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                        }}
                                      >
                                        <IconHelp size={14} stroke={1.75} />
                                      </button>
                                    </Tip>
                                  </label>
                                  <span
                                    className="settings-wallpaper__scrim-value"
                                    aria-hidden
                                  >
                                    {Math.round(wallpaperScrim)}%
                                  </span>
                                </div>
                                <input
                                  id="settings-wallpaper-scrim"
                                  type="range"
                                  className="settings-wallpaper__scrim-range"
                                  min={0}
                                  max={100}
                                  step={1}
                                  value={wallpaperScrim}
                                  aria-valuemin={0}
                                  aria-valuemax={100}
                                  aria-valuenow={Math.round(wallpaperScrim)}
                                  aria-label={t("settings.wallpaperScrim")}
                                  onChange={(e) => {
                                    onWallpaperScrim(Number(e.target.value));
                                  }}
                                />
                              </div>
                            ) : null}
                            {wallpaperError ? (
                              <p
                                className="settings-wallpaper__error"
                                role="alert"
                              >
                                {wallpaperError}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}

            {activeTab === "interface" && (
              <>
                <h2 className="settings-page__h2">
                  {t("settings.tab.interface")}
                </h2>
                {onZenMode ? (
                  <div
                    className={
                      "settings-card" + rowHighlight("settings-anchor-zenMode")
                    }
                    id="settings-anchor-zenMode"
                  >
                    <div className="settings-row">
                      <div className="settings-row__text">
                        <SettingsLabelWithTip
                          label={t("settings.zenMode")}
                          tip={t("settings.zenModeDesc")}
                        />
                      </div>
                      <UiCheck
                        checked={!!zenMode}
                        onChange={() => onZenMode(!zenMode)}
                        ariaLabel={t("settings.zenMode")}
                      />
                    </div>
                  </div>
                ) : null}
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-thinkingExpand")
                  }
                  id="settings-anchor-thinkingExpand"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.thinkingExpand")}
                        tip={t("settings.thinkingExpandDesc")}
                      />
                    </div>
                    <Select
                      value={thinkingExpand}
                      aria-label={t("settings.thinkingExpand")}
                      onChange={(v) => {
                        const pref: ThinkingExpandPref =
                          v === "keep-open" ? "keep-open" : "auto-collapse";
                        saveThinkingExpandPref(pref);
                        setThinkingExpand(pref);
                      }}
                      options={[
                        {
                          value: "auto-collapse",
                          label: t("settings.thinkingExpand.autoCollapse"),
                        },
                        {
                          value: "keep-open",
                          label: t("settings.thinkingExpand.keepOpen"),
                        },
                      ]}
                    />
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-toolStepsAutoCollapse")
                  }
                  id="settings-anchor-toolStepsAutoCollapse"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.toolStepsAutoCollapse")}
                        tip={t("settings.toolStepsAutoCollapseDesc")}
                      />
                    </div>
                    <UiCheck
                      checked={toolStepsAutoCollapse}
                      onChange={() => {
                        const next = !toolStepsAutoCollapse;
                        setToolStepsAutoCollapse(next);
                        saveToolStepsAutoCollapsePref(next);
                      }}
                      ariaLabel={t("settings.toolStepsAutoCollapse")}
                    />
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-transcriptFilter")
                  }
                  id="settings-anchor-transcriptFilter"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.transcriptFilter")}
                        tip={t("settings.transcriptFilterDesc")}
                      />
                    </div>
                    <Select
                      value={transcriptFilter}
                      aria-label={t("settings.transcriptFilter")}
                      onChange={(v) => {
                        const next: TranscriptFilterMode =
                          v === "conversation" ? "conversation" : "all";
                        saveTranscriptFilterPref(next);
                        setTranscriptFilter(next);
                      }}
                      options={[
                        {
                          value: "all",
                          label: t("settings.transcriptFilter.all"),
                        },
                        {
                          value: "conversation",
                          label: t("settings.transcriptFilter.conversation"),
                        },
                      ]}
                    />
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-chatFontScale")
                  }
                  id="settings-anchor-chatFontScale"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.chatFontScale")}
                        tip={t("settings.chatFontScaleDesc")}
                      />
                    </div>
                    <div
                      className="settings-seg"
                      role="radiogroup"
                      aria-label={t("settings.chatFontScale")}
                    >
                      {CHAT_FONT_SCALES.map((scale) => (
                        <button
                          key={scale}
                          type="button"
                          role="radio"
                          aria-checked={chatFontScale === scale}
                          className={
                            "settings-seg__btn" +
                            (chatFontScale === scale ? " is-on" : "")
                          }
                          onClick={() => onChatFontScale(scale)}
                        >
                          {t(`settings.chatFontScale.${scale}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-codeFontScale")
                  }
                  id="settings-anchor-codeFontScale"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.codeFontScale")}
                        tip={t("settings.codeFontScaleDesc")}
                      />
                    </div>
                    <div
                      className="settings-seg"
                      role="radiogroup"
                      aria-label={t("settings.codeFontScale")}
                    >
                      {CODE_FONT_SCALES.map((scale) => (
                        <button
                          key={scale}
                          type="button"
                          role="radio"
                          aria-checked={codeFontScale === scale}
                          className={
                            "settings-seg__btn" +
                            (codeFontScale === scale ? " is-on" : "")
                          }
                          onClick={() => onCodeFontScale(scale)}
                        >
                          {t(`settings.codeFontScale.${scale}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-chatDensity")
                  }
                  id="settings-anchor-chatDensity"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.chatDensity")}
                        tip={t("settings.chatDensityDesc")}
                      />
                    </div>
                    <div
                      className="settings-seg"
                      role="radiogroup"
                      aria-label={t("settings.chatDensity")}
                    >
                      {CHAT_DENSITIES.map((density) => (
                        <button
                          key={density}
                          type="button"
                          role="radio"
                          aria-checked={chatDensity === density}
                          className={
                            "settings-seg__btn" +
                            (chatDensity === density ? " is-on" : "")
                          }
                          onClick={() => onChatDensity(density)}
                        >
                          {t(`settings.chatDensity.${density}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-chatWidth")
                  }
                  id="settings-anchor-chatWidth"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.chatWidth")}
                        tip={t("settings.chatWidthDesc")}
                      />
                    </div>
                    <div
                      className="settings-seg"
                      role="radiogroup"
                      aria-label={t("settings.chatWidth")}
                    >
                      {CHAT_WIDTHS.map((width) => (
                        <button
                          key={width}
                          type="button"
                          role="radio"
                          aria-checked={chatWidth === width}
                          className={
                            "settings-seg__btn" +
                            (chatWidth === width ? " is-on" : "")
                          }
                          onClick={() => onChatWidth(width)}
                        >
                          {t(`settings.chatWidth.${width}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-sidebarDensity")
                  }
                  id="settings-anchor-sidebarDensity"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.sidebarDensity")}
                        tip={t("settings.sidebarDensityDesc")}
                      />
                    </div>
                    <div
                      className="settings-seg"
                      role="radiogroup"
                      aria-label={t("settings.sidebarDensity")}
                    >
                      {SIDEBAR_DENSITIES.map((density) => (
                        <button
                          key={density}
                          type="button"
                          role="radio"
                          aria-checked={sidebarDensity === density}
                          className={
                            "settings-seg__btn" +
                            (sidebarDensity === density ? " is-on" : "")
                          }
                          onClick={() => onSidebarDensity(density)}
                        >
                          {t(`settings.sidebarDensity.${density}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-messageActions")
                  }
                  id="settings-anchor-messageActions"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.messageActions")}
                        tip={t("settings.messageActionsDesc")}
                      />
                    </div>
                    <div
                      className="settings-seg"
                      role="radiogroup"
                      aria-label={t("settings.messageActions")}
                    >
                      {MESSAGE_ACTIONS_VISIBILITIES.map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          role="radio"
                          aria-checked={messageActionsVisibility === mode}
                          className={
                            "settings-seg__btn" +
                            (messageActionsVisibility === mode ? " is-on" : "")
                          }
                          onClick={() => onMessageActionsVisibility(mode)}
                        >
                          {t(`settings.messageActions.${mode}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-codeWrapDefault")
                  }
                  id="settings-anchor-codeWrapDefault"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.codeWrapDefault")}
                        tip={t("settings.codeWrapDefaultDesc")}
                      />
                    </div>
                    <UiCheck
                      checked={codeWrapDefault}
                      onChange={() => {
                        const next = !codeWrapDefault;
                        setCodeWrapDefault(next);
                        saveCodeWrapPref(next);
                      }}
                      ariaLabel={t("settings.codeWrapDefault")}
                    />
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-codeLineNumbers")
                  }
                  id="settings-anchor-codeLineNumbers"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.codeLineNumbers")}
                        tip={t("settings.codeLineNumbersDesc")}
                      />
                    </div>
                    <UiCheck
                      checked={codeLineNumbers}
                      onChange={() => {
                        const next = !codeLineNumbers;
                        setCodeLineNumbers(next);
                        saveCodeLineNumbersPref(next);
                      }}
                      ariaLabel={t("settings.codeLineNumbers")}
                    />
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-backBottomAlways")
                  }
                  id="settings-anchor-backBottomAlways"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.backBottomAlways")}
                        tip={t("settings.backBottomAlwaysDesc")}
                      />
                    </div>
                    <UiCheck
                      checked={backBottomAlways}
                      onChange={() => {
                        const next = !backBottomAlways;
                        setBackBottomAlways(next);
                        saveBackBottomAlwaysPref(next);
                      }}
                      ariaLabel={t("settings.backBottomAlways")}
                    />
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-sessionSearchRank")
                  }
                  id="settings-anchor-sessionSearchRank"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.sessionSearchRank")}
                        tip={t("settings.sessionSearchRankDesc")}
                      />
                    </div>
                    <Select
                      value={sessionSearchRank}
                      aria-label={t("settings.sessionSearchRank")}
                      onChange={(v) => {
                        const next: SessionSearchRankMode =
                          v === "hybrid" ? "hybrid" : "keyword";
                        setSessionSearchRank(next);
                        saveSessionSearchRankPref(next);
                      }}
                      options={[
                        {
                          value: "keyword",
                          label: t("settings.sessionSearchRank.keyword"),
                        },
                        {
                          value: "hybrid",
                          label: t("settings.sessionSearchRank.hybrid"),
                        },
                      ]}
                    />
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-confirmExternalLinks")
                  }
                  id="settings-anchor-confirmExternalLinks"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.confirmExternalLinks")}
                        tip={t("settings.confirmExternalLinksDesc")}
                      />
                    </div>
                    <UiCheck
                      checked={confirmExternalLinks}
                      onChange={() => {
                        const next = !confirmExternalLinks;
                        setConfirmExternalLinks(next);
                        saveConfirmExternalLinksPref(next);
                      }}
                      ariaLabel={t("settings.confirmExternalLinks")}
                    />
                  </div>
                </div>
                {onShowMessageTimestamps ? (
                  <div
                    className={
                      "settings-card" +
                      rowHighlight("settings-anchor-messageTimestamps")
                    }
                    id="settings-anchor-messageTimestamps"
                  >
                    <div className="settings-row">
                      <div className="settings-row__text">
                        <SettingsLabelWithTip
                          label={t("settings.messageTimestamps")}
                          tip={t("settings.messageTimestampsDesc")}
                        />
                      </div>
                      <UiCheck
                        checked={!!showMessageTimestamps}
                        onChange={() =>
                          onShowMessageTimestamps(!showMessageTimestamps)
                        }
                        ariaLabel={t("settings.messageTimestamps")}
                      />
                    </div>
                  </div>
                ) : null}
                {onShowUsageEstimates ? (
                  <div
                    className={
                      "settings-card" +
                      rowHighlight("settings-anchor-showUsageEstimates")
                    }
                    id="settings-anchor-showUsageEstimates"
                  >
                    <div className="settings-row">
                      <div className="settings-row__text">
                        <SettingsLabelWithTip
                          label={t("settings.showUsageEstimates")}
                          tip={t("settings.showUsageEstimatesDesc")}
                        />
                      </div>
                      <UiCheck
                        checked={!!showUsageEstimates}
                        onChange={() =>
                          onShowUsageEstimates(!showUsageEstimates)
                        }
                        ariaLabel={t("settings.showUsageEstimates")}
                      />
                    </div>
                  </div>
                ) : null}
                {onGoalOrchUiEnabled ? (
                  <div
                    className={
                      "settings-card" +
                      rowHighlight("settings-anchor-goalOrchUi")
                    }
                    id="settings-anchor-goalOrchUi"
                  >
                    <div className="settings-row">
                      <div className="settings-row__text">
                        <SettingsLabelWithTip
                          label={t("settings.goalOrchUi")}
                          tip={t("settings.goalOrchUiDesc")}
                        />
                      </div>
                      <UiCheck
                        checked={!!goalOrchUiEnabled}
                        onChange={() =>
                          onGoalOrchUiEnabled(!goalOrchUiEnabled)
                        }
                        ariaLabel={t("settings.goalOrchUi")}
                      />
                    </div>
                  </div>
                ) : null}
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-exportLogo")
                  }
                  id="settings-anchor-exportLogo"
                >
                  <div className="settings-row settings-row--stack">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.exportLogo")}
                        tip={t("settings.exportLogoDesc")}
                      />
                    </div>
                    <div
                      className="settings-export-logo"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        flexWrap: "wrap",
                        marginTop: 8,
                      }}
                    >
                      <div
                        className="settings-export-logo__preview"
                        aria-label={t("settings.exportLogoPreview")}
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 10,
                          overflow: "hidden",
                          background: "var(--bg-elevated, #18181b)",
                          border: "1px solid var(--border, #27272a)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 700,
                          flexShrink: 0,
                        }}
                      >
                        {exportLogo ? (
                          <img
                            src={exportLogo}
                            alt=""
                            width={40}
                            height={40}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                            }}
                          />
                        ) : (
                          <span aria-hidden>G</span>
                        )}
                      </div>
                      <input
                        ref={exportLogoInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        hidden
                        onChange={(e) => {
                          const f = e.target.files?.[0] ?? null;
                          void onExportLogoFile(f);
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => exportLogoInputRef.current?.click()}
                      >
                        {t("settings.exportLogoUpload")}
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        disabled={!exportLogo}
                        onClick={onClearExportLogo}
                      >
                        {t("settings.exportLogoClear")}
                      </button>
                    </div>
                  </div>
                </div>
                {onShowReplyLength ? (
                  <div
                    className={
                      "settings-card" +
                      rowHighlight("settings-anchor-showReplyLength")
                    }
                    id="settings-anchor-showReplyLength"
                  >
                    <div className="settings-row">
                      <div className="settings-row__text">
                        <SettingsLabelWithTip
                          label={t("settings.showReplyLength")}
                          tip={t("settings.showReplyLengthDesc")}
                        />
                      </div>
                      <UiCheck
                        checked={!!showReplyLength}
                        onChange={() => onShowReplyLength(!showReplyLength)}
                        ariaLabel={t("settings.showReplyLength")}
                      />
                    </div>
                  </div>
                ) : null}
                {onMessageTimeFormat ? (
                  <div
                    className={
                      "settings-card" +
                      rowHighlight("settings-anchor-messageTimeFormat")
                    }
                    id="settings-anchor-messageTimeFormat"
                  >
                    <div className="settings-row">
                      <div className="settings-row__text">
                        <SettingsLabelWithTip
                          label={t("settings.messageTimeFormat")}
                          tip={t("settings.messageTimeFormatDesc")}
                        />
                      </div>
                      <div
                        className="settings-seg"
                        role="radiogroup"
                        aria-label={t("settings.messageTimeFormat")}
                      >
                        {MESSAGE_TIME_FORMATS.map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            role="radio"
                            aria-checked={messageTimeFormat === mode}
                            className={
                              "settings-seg__btn" +
                              (messageTimeFormat === mode ? " is-on" : "")
                            }
                            onClick={() => onMessageTimeFormat(mode)}
                          >
                            {t(`settings.messageTimeFormat.${mode}`)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
                {onSidebarShowRelativeTime ? (
                  <div
                    className={
                      "settings-card" +
                      rowHighlight("settings-anchor-sidebarShowRelativeTime")
                    }
                    id="settings-anchor-sidebarShowRelativeTime"
                  >
                    <div className="settings-row">
                      <div className="settings-row__text">
                        <SettingsLabelWithTip
                          label={t("settings.sidebarShowRelativeTime")}
                          tip={t("settings.sidebarShowRelativeTimeDesc")}
                        />
                      </div>
                      <UiCheck
                        checked={!!sidebarShowRelativeTime}
                        onChange={() =>
                          onSidebarShowRelativeTime(!sidebarShowRelativeTime)
                        }
                        ariaLabel={t("settings.sidebarShowRelativeTime")}
                      />
                    </div>
                  </div>
                ) : null}
                {onClearAllSessionMutes ? (
                  <div
                    className={
                      "settings-card" +
                      rowHighlight("settings-anchor-sessionMuteSummary")
                    }
                    id="settings-anchor-sessionMuteSummary"
                  >
                    <div className="settings-row">
                      <div className="settings-row__text">
                        <SettingsLabelWithTip
                          label={t("settings.sessionMuteSummary")}
                          tip={t("settings.sessionMuteSummaryDesc")}
                        />
                        <div className="settings-row__desc" style={{ marginTop: 6 }}>
                          {mutedSessionCount > 0
                            ? t("settings.sessionMuteCount", {
                                n: String(mutedSessionCount),
                              })
                            : t("settings.sessionMuteCountZero")}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={mutedSessionCount <= 0}
                        onClick={() => onClearAllSessionMutes()}
                      >
                        {t("settings.sessionMuteClear")}
                      </button>
                    </div>
                  </div>
                ) : null}
                {onClearAllSessionUnread ? (
                  <div
                    className={
                      "settings-card" +
                      rowHighlight("settings-anchor-sessionUnreadSummary")
                    }
                    id="settings-anchor-sessionUnreadSummary"
                  >
                    <div className="settings-row">
                      <div className="settings-row__text">
                        <SettingsLabelWithTip
                          label={t("settings.sessionUnreadSummary")}
                          tip={t("settings.sessionUnreadSummaryDesc")}
                        />
                        <div className="settings-row__desc" style={{ marginTop: 6 }}>
                          {unreadSessionCount > 0
                            ? t("settings.sessionUnreadCount", {
                                n: String(unreadSessionCount),
                              })
                            : t("settings.sessionUnreadCountZero")}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={unreadSessionCount <= 0}
                        onClick={() => onClearAllSessionUnread()}
                      >
                        {t("settings.sessionUnreadClear")}
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </>
        )}

        {section === "account" && (
          <>
            <div
              className="settings-account-tabs"
              role="tablist"
              id={
                activeTab === "providers"
                  ? "settings-anchor-account-providers"
                  : activeTab === "extras"
                    ? "settings-anchor-account-extras"
                    : "settings-anchor-account-official"
              }
            >
              <div className="settings-seg settings-seg--lg" role="presentation">
                <button
                  type="button"
                  role="tab"
                  className={
                    "settings-seg__btn" +
                    (activeTab === "official" || activeTab == null
                      ? " is-on"
                      : "")
                  }
                  aria-selected={activeTab === "official" || activeTab == null}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSectionTab("official");
                  }}
                >
                  {t("settings.tabOfficial")}
                </button>
                <button
                  type="button"
                  role="tab"
                  className={
                    "settings-seg__btn" +
                    (activeTab === "providers" ? " is-on" : "")
                  }
                  aria-selected={activeTab === "providers"}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSectionTab("providers");
                  }}
                >
                  {t("settings.tabProviders")}
                </button>
                <button
                  type="button"
                  role="tab"
                  className={
                    "settings-seg__btn" +
                    (activeTab === "extras" ? " is-on" : "")
                  }
                  aria-selected={activeTab === "extras"}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSectionTab("extras");
                  }}
                >
                  {t("settings.tabExtras")}
                </button>
              </div>
              {activeTab === "providers" ? (
                <p className="settings-account-tabs__hint">
                  {t("settings.tabProvidersHint")}
                </p>
              ) : activeTab === "extras" ? (
                <p className="settings-account-tabs__hint">
                  {t("settings.tabExtrasHint")}
                </p>
              ) : (
                <p className="settings-account-tabs__hint">
                  {t("settings.tabOfficialHint")}
                </p>
              )}
            </div>
            {activeTab === "providers" ? (
              <ProvidersPanel
                locale={resolveLocale(locale)}
                officialAvailable={
                  !!(
                    account?.profile?.signedIn ||
                    account?.cliAuthPresent ||
                    account?.hasOfficialKey
                  )
                }
                onProvidersChanged={onProvidersChanged}
                onProviderActivated={onProviderActivated}
                onToast={(msg, ms) => showSettingsToast(msg, ms ?? 2800)}
              />
            ) : activeTab === "extras" ? (
              <OfficialAuxPanel
                locale={resolveLocale(locale)}
                officialAvailable={
                  !!(
                    account?.profile?.signedIn ||
                    account?.cliAuthPresent ||
                    account?.hasOfficialKey
                  )
                }
                onProviderActivated={onProviderActivated}
                onToast={(msg, ms) => showSettingsToast(msg, ms ?? 2800)}
              />
            ) : (
          <AccountPanel
            status={account}
            loading={accountLoading}
            busy={accountBusy}
            locale={locale}
            t={t}
            labels={{
              signedIn: t("account.signedIn"),
              signedOut: t("account.signedOut"),
              loginOauth: t("account.loginOauth"),
              loginDevice: t("account.loginDevice"),
              logout: t("account.logout"),
              refresh: t("account.refresh"),
              refreshing: t("account.refreshing"),
              manageUsage: t("account.manageUsage"),
              subscribe: t("account.subscribe"),
              channel: t("account.channel"),
              subscription: t("account.subscription"),
              quota: t("account.quota"),
              quotaRemaining: t("account.quotaRemaining"),
              quotaUsed: t("account.quotaUsed"),
              quotaUnknown: t("account.quotaUnknown"),
              period: t("account.period"),
              prepaid: t("account.prepaid"),
              onDemand: t("account.onDemand"),
              heatmap: t("account.heatmap"),
              heatmapHint: t("account.heatmapHint"),
              callLogs: t("account.callLogs"),
              callLogsEmpty: t("account.callLogsEmpty"),
              colSession: t("account.col.session"),
              colModel: t("account.col.model"),
              colTurns: t("account.col.turns"),
              colTokens: t("account.col.tokens"),
              colDuration: t("account.col.duration"),
              colWhen: t("account.col.when"),
              less: t("account.heatmap.less"),
              more: t("account.heatmap.more"),
              expired: t("account.expired"),
              team: t("account.team"),
              billingUnavailable: t("account.billingUnavailable"),
              loginBusy: t("account.loginBusy"),
              loginCancel: t("account.loginCancel"),
              resetsAt: t("account.resetsAt"),
              fetchedAt: t("account.fetchedAt"),
              products: t("account.products"),
              heatmapNoData: t("account.heatmap.noData"),
              heatmapAria: t("account.heatmap.aria"),
              heatmapRequests: t("account.heatmap.requests"),
              heatmapTokens: t("account.heatmap.tokens"),
              callLogsDayFilter: t("account.callLogs.dayFilter"),
              callLogsWeekFilter: t("account.callLogs.weekFilter"),
              callLogsClearDay: t("account.callLogs.clearDay"),
              callLogsDayEmpty: t("account.callLogs.dayEmpty"),
              heatmapDay: t("account.heatmap.day"),
              heatmapWeek: t("account.heatmap.week"),
              heatmapTotalTokens: t("account.heatmap.totalTokens"),
              weeklyTitle: t("account.weeklyTitle"),
              loginHelpTitle: t("account.loginHelpTitle"),
              loginHelpBody: t("account.loginHelpBody"),
              loginTryDevice: t("account.loginTryDevice"),
              profiles: t("account.profiles"),
              profilesHint: t("account.profilesHint"),
              profilesEmpty: t("account.profilesEmpty"),
              profileSave: t("account.profileSave"),
              profileSwitch: t("account.profileSwitch"),
              profileRemove: t("account.profileRemove"),
              profileActive: t("account.profileActive"),
              manageAccounts: t("account.manageAccounts"),
              addAccount: t("account.addAccount"),
              importChat: t("account.importChat"),
              importChatHint: t("account.importChatHint"),
              importChatBtn: t("account.importChatBtn"),
              close: t("common.close"),
            }}
            loginHint={loginHint}
            savedAccounts={savedAccounts}
            activeAccountId={activeAccountId}
            onLoginOauth={onAccountLoginOauth}
            onLoginDevice={onAccountLoginDevice}
            onCancelLogin={onCancelLogin}
            onLogout={onAccountLogout}
            onRefresh={onAccountRefresh}
            onManageUsage={onAccountManageUsage}
            onSubscribe={onAccountSubscribe}
            onSaveAccount={onSaveAccount}
            onAddAccount={onAddAccount}
            onSwitchAccount={onSwitchAccount}
            onRemoveAccount={onRemoveAccount}
            onImportChat={onImportChat}
          />
            )}
          </>
        )}

        {section === "archived" && (
          <div id="settings-anchor-archived">
            <p className="settings-page__lead">
              {t("settings.archived.desc")}
            </p>
            {onArchiveOlderThan ? (
              <div
                className="settings-card settings-archived-age"
                id="settings-anchor-archive-older"
              >
                <div className="settings-row settings-row--stack">
                  <div className="settings-row__meta">
                    <div className="settings-row__label">
                      {t("settings.archived.archiveOlder")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.archived.archiveOlderDesc")}
                    </div>
                  </div>
                  <div
                    className="settings-archived-age__actions"
                    role="group"
                    aria-label={t("settings.archived.archiveOlder")}
                  >
                    {archiveAgePreviews.map(({ days, count }) => (
                      <button
                        key={days}
                        type="button"
                        className={
                          "btn btn--ghost btn--sm" +
                          (count === 0
                            ? " settings-archived-age__btn--empty"
                            : "")
                        }
                        onClick={() => onArchiveOlderThan(days)}
                        data-count={count}
                      >
                        {count > 0
                          ? t("settings.archived.archiveOlderDaysCount", {
                              days: String(days),
                              n: String(count),
                            })
                          : t("settings.archived.archiveOlderDays", {
                              days: String(days),
                            })}
                      </button>
                    ))}
                  </div>
                  <div
                    className={
                      "settings-archived-age__hint" +
                      (archiveAgeAnyMatch
                        ? ""
                        : " settings-archived-age__hint--empty")
                    }
                    role="status"
                  >
                    {archiveAgeAnyMatch
                      ? t("settings.archived.archiveOlderMatchHint", {
                          n: String(archiveAgeMaxMatch),
                        })
                      : t("settings.archived.archiveOlderNoneHint")}
                  </div>
                </div>
              </div>
            ) : null}
            {archivedTotal === 0 ? (
              <div className="settings-card">
                <div className="settings-archived-empty">
                  {t("settings.archived.empty")}
                </div>
              </div>
            ) : (
              <>
                <div className="settings-archived-toolbar">
                  <UiCheck
                    className="ui-check--all"
                    checked={archivedAllSelected}
                    indeterminate={archivedSomeSelected}
                    onChange={toggleArchivedAll}
                    ariaLabel={t("settings.archived.selectAll")}
                    label={
                      archivedAllSelected
                        ? t("settings.archived.deselectAll")
                        : t("settings.archived.selectAll")
                    }
                  />
                  <span className="settings-archived-toolbar__count">
                    {archivedSelectedCount > 0
                      ? t("settings.archived.selectedCount", {
                          n: archivedSelectedCount,
                        })
                      : t("settings.archived.totalCount", {
                          n: archivedTotal,
                        })}
                  </span>
                  <div className="settings-archived-toolbar__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={archivedSelectedCount === 0}
                      onClick={() => {
                        const ids = [...archivedSelected];
                        if (!ids.length) return;
                        onRestoreArchivedSessions?.(ids);
                        setArchivedSelected(new Set());
                      }}
                    >
                      {t("settings.archived.restore")}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm btn--danger"
                      disabled={archivedSelectedCount === 0}
                      onClick={() => {
                        const ids = [...archivedSelected];
                        if (!ids.length) return;
                        onDeleteArchivedSessions?.(ids);
                      }}
                    >
                      <IconTrash size={14} />
                      {t("settings.archived.delete")}
                    </button>
                  </div>
                </div>
                <div
                  ref={archivedSurfaceRef}
                  className={
                    "settings-archived-surface" +
                    (marquee ? " is-marqueeing" : "")
                  }
                  onPointerDown={onArchivedPointerDown}
                  onPointerMove={onArchivedPointerMove}
                  onPointerUp={onArchivedPointerUp}
                  onPointerCancel={onArchivedPointerCancel}
                >
                  {marquee
                    ? (() => {
                        const r = marqueeClientRect(marquee);
                        if (r.width < 2 && r.height < 2) return null;
                        return (
                          <div
                            className="settings-archived-marquee"
                            style={{
                              left: r.left,
                              top: r.top,
                              width: r.width,
                              height: r.height,
                            }}
                            aria-hidden
                          />
                        );
                      })()
                    : null}
                  {archivedGroups.map((group) => {
                    const groupIds = group.sessions.map((s) => s.id);
                    const groupAll =
                      groupIds.length > 0 &&
                      groupIds.every((id) => archivedSelected.has(id));
                    const groupSome =
                      !groupAll &&
                      groupIds.some((id) => archivedSelected.has(id));
                    return (
                      <div
                        key={group.id ?? "__orphan__"}
                        className="settings-archived-group"
                      >
                        <h2 className="settings-page__h2">
                          <UiCheck
                            className="ui-check--group"
                            checked={groupAll}
                            indeterminate={groupSome}
                            onChange={() => toggleArchivedGroup(groupIds)}
                            ariaLabel={group.name}
                          />
                          <IconArchive size={15} />
                          <span>{group.name}</span>
                          <span className="settings-archived-group__count">
                            {group.sessions.length}
                          </span>
                        </h2>
                        <div className="settings-card settings-card--flush">
                          {group.sessions.map((s) => {
                            const selected = archivedSelected.has(s.id);
                            return (
                              <div
                                key={s.id}
                                data-archived-id={s.id}
                                className={
                                  "settings-archived-row" +
                                  (selected ? " is-selected" : "")
                                }
                              >
                                <UiCheck
                                  checked={selected}
                                  onChange={() => toggleArchivedId(s.id)}
                                  ariaLabel={
                                    s.title || t("session.untitled")
                                  }
                                />
                                <div className="settings-archived-row__text">
                                  <div className="settings-archived-row__title">
                                    {s.title || t("session.untitled")}
                                  </div>
                                  <div className="settings-archived-row__meta">
                                    {formatSessionWhen(s.updatedAt, locale)}
                                  </div>
                                </div>
                                <div className="settings-archived-row__actions">
                                  <button
                                    type="button"
                                    className="btn btn--ghost btn--sm"
                                    onClick={() =>
                                      onRestoreArchivedSessions?.([s.id])
                                    }
                                  >
                                    {t("settings.archived.restore")}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn--ghost btn--sm btn--danger"
                                    onClick={() =>
                                      onDeleteArchivedSessions?.([s.id])
                                    }
                                  >
                                    <IconTrash size={14} />
                                    {t("settings.archived.delete")}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {section === "extensions" && (
          <ExtensionsPanel
            locale={resolveLocale(locale)}
            projectPath={projectPath}
            cliFound={cliInfo.found}
            activeTab={
              (activeTab as
                | "plugins"
                | "skills"
                | "mcp"
                | "agents"
                | "hooks"
                | "market"
                | null) ?? "plugins"
            }
            onTabChange={(next) => setSectionTab(next)}
            onOpenRuntime={() => navigateTo("runtime", "cli")}
            onSkillsPrefsChanged={onSkillsPrefsChanged}
          />
        )}

        {section === "remote_im" && (
          <>
            <SettingsTabStrip
              tabs={sectionNav?.tabs ?? []}
              active={activeTab}
              onChange={setSectionTab}
              ariaLabel={title}
              t={(k) => t(k)}
            />
            {activeTab === "im" && (
              <div
                className="settings-card settings-card--rim"
                id="settings-anchor-remote-im"
              >
                <RemoteImLayout
                  locale={locale}
                  trustedProjects={trustedProjects}
                />
              </div>
            )}
            {activeTab === "mirror" && (
              <div
                className="settings-card"
                id="settings-anchor-phone-mirror"
              >
                {api.isDesktopHost() ? (
                  <MirrorConnectPanel
                    variant="inline"
                    open
                    labels={{
                      title: t("mirror.connectTitle"),
                      close: t("common.close"),
                      start: t("mirror.start"),
                      stop: t("mirror.stop"),
                      stopConfirmTitle: t("mirror.stopConfirmTitle"),
                      stopConfirmMessage: t("mirror.stopConfirmMessage"),
                      stopConfirmOk: t("mirror.stopConfirmOk"),
                      cancel: t("common.cancel"),
                      copyLink: t("mirror.copyLink"),
                      copied: t("mirror.copied"),
                      clients: t("mirror.clients"),
                      phaseStopped: t("mirror.phase.stopped"),
                      phaseStarting: t("mirror.phase.starting"),
                      phaseLocal: t("mirror.phase.local"),
                      phaseWaitingTunnel: t("mirror.phase.waiting_tunnel"),
                      phaseLive: t("mirror.phase.live"),
                      phaseTunnelDead: t("mirror.phase.tunnel_dead"),
                      phaseError: t("mirror.phase.error"),
                      phaseSoftLocal: t("mirror.phase.softLocal"),
                      hint: t("mirror.connectHint"),
                      warningToken: t("mirror.warningToken"),
                      missingCloudflared: t("mirror.missingCloudflared"),
                      errorGeneric: t("mirror.errorGeneric"),
                      qrAlt: t("mirror.qrAlt"),
                      linkLabel: t("mirror.linkLabel"),
                      linkLabelLocal: t("mirror.linkLabelLocal"),
                      rotate: t("mirror.rotate"),
                      rotateDone: t("mirror.rotateDone"),
                      rotateConfirmTitle: t("mirror.rotateConfirmTitle"),
                      rotateConfirmMessage: t("mirror.rotateConfirmMessage"),
                      rotateConfirmMessageClients: t(
                        "mirror.rotateConfirmMessageClients",
                      ),
                      rotateConfirmOk: t("mirror.rotateConfirmOk"),
                      allowWrite: t("mirror.allowWrite"),
                      readOnlyOn: t("mirror.readOnlyOn"),
                      readOnlyHint: t("mirror.readOnlyHint"),
                      writeConfirmTitle: t("mirror.writeConfirmTitle"),
                      writeConfirmMessage: t("mirror.writeConfirmMessage"),
                      writeConfirmOk: t("mirror.writeConfirmOk"),
                      writeEnabledBanner: t("mirror.writeEnabledBanner"),
                      softLocalBanner: t("mirror.softLocalBanner"),
                      softTunnelDeadBanner: t("mirror.softTunnelDeadBanner"),
                      writeCategoriesTitle: t("mirror.write.categoriesTitle"),
                      writeCategoriesHint: t("mirror.write.categoriesHint"),
                      writeBroadWarn: t("mirror.write.broadWarn"),
                      writeCategorySend: t("mirror.write.category.send"),
                      writeCategoryStop: t("mirror.write.category.stop"),
                      writeCategorySessions: t(
                        "mirror.write.category.sessions",
                      ),
                      writeCategoryPermissions: t(
                        "mirror.write.category.permissions",
                      ),
                      writeCategoryAskUser: t(
                        "mirror.write.category.askUser",
                      ),
                      writeCategoryPlan: t("mirror.write.category.plan"),
                      writeCategoryDelete: t("mirror.write.category.delete"),
                      writeCategoryRename: t("mirror.write.category.rename"),
                      maxClientsLabel: t("mirror.maxClients"),
                      maxClientsHint: t("mirror.maxClientsHint"),
                      maxClientsValue: t("mirror.maxClientsValue"),
                      auditTitle: t("mirror.audit.title"),
                      auditEmpty: t("mirror.audit.empty"),
                      auditClear: t("mirror.audit.clear"),
                      auditClearConfirmTitle: t("mirror.audit.clearConfirmTitle"),
                      auditClearConfirmMessage: t(
                        "mirror.audit.clearConfirmMessage",
                      ),
                      auditClearConfirmOk: t("mirror.audit.clearConfirmOk"),
                      auditTypeWriteEnabled: t(
                        "mirror.audit.type.write_enabled",
                      ),
                      auditTypeWriteDisabled: t(
                        "mirror.audit.type.write_disabled",
                      ),
                      auditTypeTokenRotated: t(
                        "mirror.audit.type.token_rotated",
                      ),
                      auditTypeHostStarted: t(
                        "mirror.audit.type.host_started",
                      ),
                      auditTypeHostStopped: t(
                        "mirror.audit.type.host_stopped",
                      ),
                      errCloudflaredMissing: t("mirror.err.cloudflaredMissing"),
                      errTunnelTimeout: t("mirror.err.tunnelTimeout"),
                      errTunnelSpawn: t("mirror.err.tunnelSpawn"),
                      errTunnelNotRegistered: t("mirror.err.tunnelNotRegistered"),
                      errTunnelDead: t("mirror.err.tunnelDead"),
                      errPortBind: t("mirror.err.portBind"),
                      errDesktopOnly: t("mirror.err.desktopOnly"),
                      errWsClosed: t("mirror.err.wsClosed"),
                      errWsTimeout: t("mirror.err.wsTimeout"),
                      errRpcTimeout: t("mirror.err.rpcTimeout"),
                      errRpcUnsupported: t("mirror.err.rpcUnsupported"),
                      errNotConnected: t("mirror.err.notConnected"),
                      errClientsFull: t("mirror.err.clientsFull"),
                      errOther: t("mirror.err.other"),
                      hintCloudflaredMissing: t("mirror.hint.cloudflaredMissing"),
                      hintTunnelTimeout: t("mirror.hint.tunnelTimeout"),
                      hintTunnelSpawn: t("mirror.hint.tunnelSpawn"),
                      hintTunnelNotRegistered: t("mirror.hint.tunnelNotRegistered"),
                      hintTunnelDead: t("mirror.hint.tunnelDead"),
                      hintPortBind: t("mirror.hint.portBind"),
                      hintDesktopOnly: t("mirror.hint.desktopOnly"),
                      hintWsClosed: t("mirror.hint.wsClosed"),
                      hintWsTimeout: t("mirror.hint.wsTimeout"),
                      hintRpcTimeout: t("mirror.hint.rpcTimeout"),
                      hintRpcUnsupported: t("mirror.hint.rpcUnsupported"),
                      hintNotConnected: t("mirror.hint.notConnected"),
                      hintClientsFull: t("mirror.hint.clientsFull"),
                      hintOther: t("mirror.hint.other"),
                    }}
                    onRequestConfirm={(opts) => setMirrorConfirm(opts)}
                    showToast={showSettingsToast}
                  />
                ) : (
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <div className="settings-row__desc">
                        {t("mirror.desktopOnly")}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {section === "runtime" && (
          <>
            <SettingsTabStrip
              tabs={sectionNav?.tabs ?? []}
              active={activeTab}
              onChange={setSectionTab}
              ariaLabel={title}
              t={(k) => t(k)}
            />
            {activeTab === "cli" && (
              <div
                className={"settings-card" + rowHighlight("settings-anchor-cliPath")}
                id="settings-anchor-cliPath"
              >
                <div className="settings-row settings-row--stack">
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.cliPath")}{" "}
                      {cliInfo.found
                        ? `(${cliInfo.source || "ok"})`
                        : t("settings.cliNotFound")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.cliPathDesc")}
                    </div>
                  </div>
                  <input
                    className="settings-input"
                    value={manualCliPath}
                    placeholder={cliInfo.path || "e.g. ~/.grok/bin/grok"}
                    onChange={(e) => onManualCliPath(e.target.value)}
                    onBlur={(e) => onCliBlur(e.target.value.trim())}
                  />
                  {cliInfo.version && (
                    <div className="settings-row__hint">
                      {cliInfo.version}
                      {cliInfo.path ? ` · ${cliInfo.path}` : ""}
                      {cliInfo.cliAuthPresent
                        ? ` · ${t("account.cliAuthOk")}`
                        : ` · ${t("account.cliAuthMissing")}`}
                      {lastCliChecksumVerified === true
                        ? ` · ${t("settings.cliChecksumVerified")}`
                        : lastCliChecksumVerified === false
                          ? ` · ${t("settings.cliChecksumUnverified")}`
                          : ""}
                    </div>
                  )}
                </div>
                {onAllowUnverifiedCliInstall ? (
                  <div
                    className={
                      "settings-row" +
                      rowHighlight("settings-anchor-allowUnverifiedCli")
                    }
                    id="settings-anchor-allowUnverifiedCli"
                  >
                    <div className="settings-row__text">
                      <div className="settings-row__label">
                        {t("settings.allowUnverifiedCli")}
                      </div>
                      <div className="settings-row__desc">
                        {t("settings.allowUnverifiedCliDesc")}
                      </div>
                    </div>
                    <UiCheck
                      checked={!!allowUnverifiedCliInstall}
                      onChange={() =>
                        onAllowUnverifiedCliInstall(!allowUnverifiedCliInstall)
                      }
                      ariaLabel={t("settings.allowUnverifiedCli")}
                    />
                  </div>
                ) : null}
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-cliUpdate")
                  }
                  id="settings-anchor-cliUpdate"
                >
                  <CliUpdateRow
                    t={t}
                    cliFound={cliInfo.found}
                    autoCheck
                  />
                </div>
              </div>
            )}
            {activeTab === "cli" && (
              <div
                className={rowHighlight("settings-anchor-cliWorktreeDb")}
                style={{ marginTop: 12 }}
              >
                <CliWorktreeDbPanel t={t} />
              </div>
            )}
            {activeTab === "connection" && (
              <>
                <div
                  className={"settings-card" + rowHighlight("settings-anchor-acpServer")}
                  id="settings-anchor-acpServer"
                >
                  <AcpServerField
                    value={acpServerAddr}
                    onChange={onAcpServerAddr}
                    onBlurCommit={onAcpServerBlur}
                    onOpenAgentServe={() =>
                      navigateTo(
                        "runtime",
                        "connection",
                        "settings-anchor-agentServe",
                      )
                    }
                    t={t}
                  />
                </div>
                <h2 className="settings-page__h2">{t("settings.leader.title")}</h2>
                <div className={rowHighlight("settings-anchor-leaderServe")}>
                  <LeaderServePanel
                    t={t}
                    useLeader={!!useLeader}
                    onOpenUseLeader={() =>
                      navigateTo("general", "agent", "settings-anchor-useLeader")
                    }
                  />
                </div>
                <h2 className="settings-page__h2">{t("settings.sdkConnect.title")}</h2>
                <div
                  className={
                    rowHighlight("settings-anchor-sdkConnect") +
                    " " +
                    rowHighlight("settings-anchor-agentServe")
                  }
                >
                  <SdkConnectWizard t={t} />
                </div>
              </>
            )}
            {activeTab === "network" && (
              <div
                className={
                  "settings-card" + rowHighlight("settings-anchor-proxy")
                }
                id="settings-anchor-proxy"
              >
                <div className="settings-row settings-row--stack">
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.proxyMode")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.proxyModeDesc")}
                    </div>
                  </div>
                  <Select
                    className="settings-select"
                    aria-label={t("settings.proxyMode")}
                    value={normalizeProxyMode(proxyMode)}
                    onChange={(v) => onProxyMode?.(normalizeProxyMode(v))}
                    options={[
                      {
                        value: "system",
                        label: t("settings.proxyModeSystem"),
                      },
                      {
                        value: "manual",
                        label: t("settings.proxyModeManual"),
                      },
                      {
                        value: "none",
                        label: t("settings.proxyModeNone"),
                      },
                    ]}
                  />
                  <ul className="settings-proxy-apply" role="list">
                    {proxyApplyHonestyScopes(proxyMode, proxyUrl).map(
                      (scope) => (
                        <li
                          key={scope}
                          className={
                            "settings-row__hint" +
                            (scope === "manual_invalid_inherit"
                              ? " is-danger"
                              : "")
                          }
                        >
                          {t(proxyApplyMessageKey(scope) as MessageKey)}
                        </li>
                      ),
                    )}
                  </ul>
                </div>
                {normalizeProxyMode(proxyMode) === "manual" && (
                  <>
                    <div className="settings-row settings-row--stack">
                      <div className="settings-row__text">
                        <div className="settings-row__label">
                          {t("settings.proxyUrl")}
                        </div>
                        <div className="settings-row__desc">
                          {t("settings.proxyUrlDesc")}
                        </div>
                      </div>
                      {(() => {
                        const urlSoft = manualProxyUrlSoftFail(
                          proxyMode,
                          proxyUrl,
                        );
                        const softKey = proxySoftFailMessageKey(
                          proxyMode,
                          proxyUrl,
                        );
                        const showInvalid =
                          proxyUrl.trim() !== "" && !isValidProxyUrl(proxyUrl);
                        const showEmptyManual =
                          proxyUrl.trim() === "" && urlSoft === "empty";
                        return (
                          <>
                            <input
                              className={
                                "settings-input" +
                                (showInvalid || showEmptyManual
                                  ? " is-invalid"
                                  : "")
                              }
                              value={proxyUrl}
                              placeholder="http://127.0.0.1:7890"
                              autoComplete="off"
                              spellCheck={false}
                              aria-invalid={
                                showInvalid || showEmptyManual
                                  ? true
                                  : undefined
                              }
                              aria-describedby={
                                softKey
                                  ? "settings-proxy-url-softfail"
                                  : undefined
                              }
                              onChange={(e) => onProxyUrl?.(e.target.value)}
                            />
                            {softKey ? (
                              <div
                                id="settings-proxy-url-softfail"
                                className="settings-row__hint is-danger"
                                role="alert"
                              >
                                {t(softKey as MessageKey)}
                              </div>
                            ) : null}
                          </>
                        );
                      })()}
                    </div>
                    <div className="settings-row settings-row--stack">
                      <div className="settings-row__text">
                        <div className="settings-row__label">
                          {t("settings.proxyNoProxy")}
                        </div>
                        <div className="settings-row__desc">
                          {t("settings.proxyNoProxyDesc")}
                        </div>
                      </div>
                      <input
                        className="settings-input"
                        value={proxyNoProxy}
                        placeholder="internal.example.com,10.0.0.0/8"
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(e) => onProxyNoProxy?.(e.target.value)}
                      />
                    </div>
                  </>
                )}
                <NetworkProbeField t={t} />
              </div>
            )}
            {activeTab === "pool" && (
              <div className="settings-card">
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-maxConcurrentAgents")
                  }
                  id="settings-anchor-maxConcurrentAgents"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.maxConcurrentAgents")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.maxConcurrentAgentsDesc")}
                    </div>
                  </div>
                  <input
                    className="settings-input"
                    type="number"
                    min={1}
                    max={32}
                    step={1}
                    value={maxConcurrentAgents}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isFinite(n)) return;
                      onMaxConcurrentAgents?.(
                        Math.min(32, Math.max(1, Math.round(n))),
                      );
                    }}
                  />
                </div>
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-processBudget")
                  }
                  id="settings-anchor-processBudget"
                >
                  <ProcessBudgetPanel
                    locale={resolveLocale(locale)}
                    active={activeTab === "pool"}
                    variant="settings"
                    lastProcessLimit={lastProcessLimit}
                    id="settings-process-budget"
                  />
                </div>
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-agentIdleMinutes")
                  }
                  id="settings-anchor-agentIdleMinutes"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.agentIdleMinutes")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.agentIdleMinutesDesc")}
                    </div>
                  </div>
                  <input
                    className="settings-input"
                    type="number"
                    min={1}
                    max={1440}
                    step={1}
                    value={agentIdleMinutes}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isFinite(n)) return;
                      onAgentIdleMinutes?.(
                        Math.min(1440, Math.max(1, Math.round(n))),
                      );
                    }}
                  />
                </div>
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-streamStallSeconds")
                  }
                  id="settings-anchor-streamStallSeconds"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.streamStallSeconds")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.streamStallSecondsDesc")}
                    </div>
                  </div>
                  <input
                    className="settings-input"
                    type="number"
                    min={15}
                    max={900}
                    step={15}
                    value={streamStallSeconds}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isFinite(n)) return;
                      onStreamStallSeconds?.(
                        Math.min(900, Math.max(15, Math.round(n))),
                      );
                    }}
                  />
                </div>
                {onIncludePartialMessages ? (
                  <div
                    className={
                      "settings-row" +
                      rowHighlight("settings-anchor-includePartialMessages")
                    }
                    id="settings-anchor-includePartialMessages"
                  >
                    <div className="settings-row__text">
                      <div className="settings-row__label">
                        {t("settings.includePartialMessages")}
                      </div>
                      <div className="settings-row__desc">
                        {t("settings.includePartialMessagesDesc")}
                      </div>
                    </div>
                    <UiCheck
                      checked={!!includePartialMessages}
                      onChange={() =>
                        onIncludePartialMessages(!includePartialMessages)
                      }
                      ariaLabel={t("settings.includePartialMessages")}
                    />
                  </div>
                ) : null}
              </div>
            )}
            {activeTab === "tools" && (
              <>
                {onWorkflowsEnabled ? (
                  <div
                    className={
                      "settings-card" +
                      rowHighlight("settings-anchor-workflows")
                    }
                    id="settings-anchor-workflows"
                  >
                    <div className="settings-row">
                      <div className="settings-row__text">
                        <div className="settings-row__label">
                          {t("settings.workflows")}
                        </div>
                        <div className="settings-row__desc">
                          {t("settings.workflowsDesc")}
                        </div>
                      </div>
                      <UiCheck
                        checked={!!workflowsEnabled}
                        onChange={() => onWorkflowsEnabled(!workflowsEnabled)}
                        ariaLabel={t("settings.workflows")}
                      />
                    </div>
                    <div className="settings-row settings-row--stack">
                      <div className="settings-row__text">
                        <div className="settings-row__desc">
                          {t("settings.workflowsHonesty")}
                        </div>
                      </div>
                      <WorkflowsDiscoveryBlock
                        locale={resolveLocale(locale)}
                        projectPath={projectPath}
                        showToast={showSettingsToast}
                      />
                    </div>
                  </div>
                ) : null}
                <div
                  className={"settings-card" + rowHighlight("settings-anchor-doctor")}
                  id="settings-anchor-doctor"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <div className="settings-row__label">
                        <IconDoctor size={16} />
                        {t("doctor.title")}
                      </div>
                      <div className="settings-row__desc">
                        {t("settings.doctorDesc")}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn--ghost settings-row__action"
                      onClick={onDoctor}
                    >
                      {t("settings.runDoctor")}
                    </button>
                  </div>
                </div>
                <div
                  className={
                    "settings-card" + rowHighlight("settings-anchor-traces")
                  }
                  id="settings-anchor-traces"
                >
                  <div className="settings-row settings-row--stack">
                    <div className="settings-row__text">
                      <div className="settings-row__label">
                        <IconArchive size={16} />
                        {t("session.tracesTitle")}
                      </div>
                      <div className="settings-row__desc">
                        {t("session.tracesDesc")}
                      </div>
                    </div>
                  </div>
                  <div className="trace-history-settings">
                    <TraceHistoryList
                      labels={{
                        empty: t("session.tracesEmpty"),
                        emptyHint: t("session.tracesEmptyHint"),
                        emptyFilter: t("session.tracesEmptyFilter"),
                        emptyFilterHint: t("session.tracesEmptyFilterHint"),
                        clearFilters: t("session.tracesClearFilters"),
                        reveal: t("session.tracesReveal"),
                        copyPath: t("session.tracesCopyPath"),
                        copied: t("session.tracesCopied"),
                        remove: t("session.tracesRemove"),
                        clearAll: t("session.tracesClearAll"),
                        clearConfirmTitle: t("session.tracesClearConfirmTitle"),
                        // Leave {count} for TraceHistoryList (planClearTraceHistory).
                        clearConfirmMessage: t(
                          "session.tracesClearConfirmMessage",
                        ),
                        clearConfirmAction: t(
                          "session.tracesClearConfirmAction",
                        ),
                        cancel: t("common.cancel"),
                        closeLabel: t("common.close"),
                        searchPlaceholder: t("session.tracesSearch"),
                        listAria: t("session.tracesTitle"),
                        uploadedBadge: t("session.tracesUploadedBadge"),
                        uploadedBadgeTitle: t(
                          "session.tracesUploadedBadgeTitle",
                        ),
                        filterAll: t("session.tracesFilter.all"),
                        filterLocal: t("session.tracesFilter.local"),
                        filterUploaded: t("session.tracesFilter.uploaded"),
                        filterAria: t("session.tracesFilterAria"),
                      }}
                      onCopied={() =>
                        showSettingsToast(t("session.tracesCopied"), 2000)
                      }
                    />
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-reliability")
                  }
                  id="settings-anchor-reliability"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <div className="settings-row__label">
                        {t("reliability.title")}
                      </div>
                      <div className="settings-row__desc">
                        {t("reliability.settingsDesc")}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn--ghost settings-row__action"
                      onClick={() => onOpenReliability?.()}
                      disabled={!onOpenReliability}
                    >
                      {t("reliability.openFromSettings")}
                    </button>
                  </div>
                </div>
                {onAuditLedgerRetentionDays ? (
                  <div
                    className={
                      "settings-card" +
                      rowHighlight("settings-anchor-auditRetention")
                    }
                    id="settings-anchor-auditRetention"
                  >
                    <div className="settings-row settings-row--stack">
                      <div className="settings-row__text">
                        <div className="settings-row__label">
                          {t("reliability.audit.retention")}
                        </div>
                        <div className="settings-row__desc">
                          {t("reliability.audit.retentionDesc")}
                        </div>
                      </div>
                      <div
                        className="settings-seg"
                        role="radiogroup"
                        aria-label={t("reliability.audit.retentionAria")}
                        data-testid="settings-audit-retention"
                      >
                        {(
                          [
                            { days: 7, key: "reliability.audit.retention.7" as const },
                            { days: 30, key: "reliability.audit.retention.30" as const },
                            { days: 90, key: "reliability.audit.retention.90" as const },
                            {
                              days: 0,
                              key: "reliability.audit.retention.unlimited" as const,
                            },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.days}
                            type="button"
                            role="radio"
                            aria-checked={
                              (auditLedgerRetentionDays === 7 ||
                              auditLedgerRetentionDays === 30 ||
                              auditLedgerRetentionDays === 90
                                ? auditLedgerRetentionDays
                                : 0) === opt.days
                            }
                            className={
                              "settings-seg__btn" +
                              ((auditLedgerRetentionDays === 7 ||
                              auditLedgerRetentionDays === 30 ||
                              auditLedgerRetentionDays === 90
                                ? auditLedgerRetentionDays
                                : 0) === opt.days
                                ? " is-on"
                                : "")
                            }
                            data-testid={`settings-audit-retention-${opt.days}`}
                            onClick={() => onAuditLedgerRetentionDays(opt.days)}
                          >
                            {t(opt.key)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-batch-agents")
                  }
                  id="settings-anchor-batch-agents"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <div className="settings-row__label">
                        {t("batchAgents.title")}
                      </div>
                      <div className="settings-row__desc">
                        {t("batchAgents.settingsDesc")}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn--ghost settings-row__action"
                      onClick={() => onOpenBatchAgents?.()}
                      disabled={!onOpenBatchAgents}
                    >
                      {t("batchAgents.openFromSettings")}
                    </button>
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-cost-rollup")
                  }
                  id="settings-anchor-cost-rollup"
                >
                  <div className="settings-row settings-row--stack">
                    <div className="settings-row__text">
                      <div className="settings-row__label">
                        {t("costRollup.title")}
                      </div>
                      <div className="settings-row__desc">
                        {t("costRollup.settingsDesc")}
                      </div>
                    </div>
                  </div>
                  <CostRollupPanel
                    locale={resolveLocale(locale)}
                    sessions={costRollupSessions}
                    projects={costRollupProjects}
                    embedded
                    onToast={(msg, ms) => showSettingsToast(msg, ms ?? 2000)}
                  />
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-smj")
                  }
                  id="settings-anchor-smj"
                >
                  <div className="settings-row settings-row--stack">
                    <div className="settings-row__text">
                      <div className="settings-row__label">
                        {t("smj.title")}
                      </div>
                      <div className="settings-row__desc">
                        {t("smj.settingsDesc")}
                      </div>
                    </div>
                  </div>
                  <StreamingMessagesJsonPanel
                    locale={resolveLocale(locale)}
                    cliVersion={cliInfo.version}
                    onToast={(msg, ms) => showSettingsToast(msg, ms ?? 2000)}
                  />
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-stream-acp-ndjson")
                  }
                  id="settings-anchor-stream-acp-ndjson"
                >
                  <div className="settings-row settings-row--stack">
                    <div className="settings-row__text">
                      <div className="settings-row__label">
                        {t("streamAcpNdjson.title")}
                      </div>
                      <div className="settings-row__desc">
                        {t("streamAcpNdjson.settingsDesc")}
                      </div>
                    </div>
                  </div>
                  <StreamingAcpNdjsonPanel
                    locale={resolveLocale(locale)}
                    manualCliPath={manualCliPath}
                    projectPath={projectPath}
                    showToast={showSettingsToast}
                  />
                </div>
                <div
                  className={
                    "settings-card pi-settings-block" +
                    rowHighlight("settings-anchor-inspect")
                  }
                  id="settings-anchor-inspect"
                >
                  <div className="settings-row settings-row--stack">
                    <div className="settings-row__text">
                      <div className="settings-row__label">
                        {t("inspect.title")}
                      </div>
                      <div className="settings-row__desc">
                        {t("inspect.desc")}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn--ghost settings-row__action"
                      onClick={() => navigateTo("extensions", "plugins")}
                    >
                      {t("settings.inspect.manageInExtensions")}
                    </button>
                  </div>
                  {/* Flat body — no nested settings-card */}
                  <div className="pi-settings-body">
                    <ProjectInspectPanel
                      locale={resolveLocale(locale)}
                      projectPath={projectPath}
                      cliFound={cliInfo.found}
                      hideHeader
                    />
                  </div>
                </div>
                <div
                  className={
                    "settings-card pi-settings-block" +
                    rowHighlight("settings-anchor-prHub")
                  }
                  id="settings-anchor-prHub"
                >
                  <div className="settings-row settings-row--stack">
                    <div className="settings-row__text">
                      <div className="settings-row__label">
                        {t("prHub.title")}
                      </div>
                      <div className="settings-row__desc">
                        {t("prHub.desc")}
                      </div>
                    </div>
                  </div>
                  <div className="pi-settings-body">
                    <GitPrHubPanel
                      locale={resolveLocale(locale)}
                      projectPath={projectPath}
                      hideHeader
                      highlightPrNumber={prHubHighlightPr}
                    />
                  </div>
                </div>
                <div
                  className={
                    "settings-card pi-settings-block" +
                    rowHighlight("settings-anchor-managedSetup")
                  }
                  id="settings-anchor-managedSetup"
                >
                  <ManagedSetupPanel
                    locale={resolveLocale(locale)}
                    cliFound={cliInfo.found}
                    onOpenAccount={() => navigateTo("account", "official")}
                  />
                </div>
              </>
            )}
            {activeTab === "privacy" && (
              <div
                className={
                  "settings-card" + rowHighlight("settings-anchor-privacy")
                }
                id="settings-anchor-privacy-card"
              >
                <PrivacyCenterPanel
                  locale={resolveLocale(locale)}
                  onError={(msg) => showSettingsToast(msg, 4000)}
                  onSaved={() =>
                    showSettingsToast(t("settings.privacy.saved"), 2200)
                  }
                />
              </div>
            )}
          </>
        )}

        {section === "shortcuts" && (
          <div id="settings-anchor-shortcuts">
            <ShortcutsSettingsPanel
              t={t}
              onOpenHelp={onOpenShortcutsHelp}
            />
          </div>
        )}

        {section === "about" && (
          <>
            <div
              className={"settings-card" + rowHighlight("settings-anchor-about")}
              id="settings-anchor-about"
            >
              <div className="settings-row settings-row--stack">
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    <IconInfo size={16} />
                    {t("settings.aboutApp")}
                  </div>
                  <div className="settings-row__desc">{versionFooter}</div>
                </div>
              </div>
              <AboutUpdateRow t={t} />
              <div
                className={
                  "settings-row settings-row--stack" +
                  rowHighlight("settings-anchor-aboutCli")
                }
                id="settings-anchor-aboutCli"
              >
                <CliUpdateRow t={t} cliFound={cliInfo.found} autoCheck />
              </div>
            </div>
            {onOpenProductTutorial ? (
              <div
                className={
                  "settings-card" + rowHighlight("settings-anchor-tutorial")
                }
                id="settings-anchor-tutorial"
              >
                <div className="settings-row">
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      <IconHelp size={16} />
                      {t("tutorial.replay")}
                    </div>
                    <div className="settings-row__desc">
                      {t("tutorial.replayDesc")}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => onOpenProductTutorial()}
                  >
                    {t("tutorial.menu")}
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
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
  );
}

function ShortcutsSettingsPanel({
  t,
  onOpenHelp,
}: {
  t: (key: MessageKey, vars?: Vars) => string;
  onOpenHelp?: () => void;
}) {
  const [filterQuery, setFilterQuery] = useState("");
  const platform = useMemo(() => detectShortcutPlatform(), []);
  /** Live send chord from Composer pref (same-tab + storage). */
  const [sendPref, setSendPref] = useState<ComposerSendKeyPref>(() =>
    loadComposerSendKeyPref(),
  );
  const [remaps, setRemaps] = useState<ShortcutRemapMap>(() =>
    loadShortcutRemaps(),
  );
  const [voiceHotkeyEnabled, setVoiceHotkeyEnabled] = useState(() =>
    loadVoiceHotkeyEnabled(),
  );
  const [ignoreCrossScope, setIgnoreCrossScope] = useState(() =>
    loadIgnoreCrossScopeConflicts(),
  );
  const [recordingId, setRecordingId] = useState<ShortcutId | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  /** GlassModal confirm for Reset all remaps (never window.confirm). */
  const [resetAllOpen, setResetAllOpen] = useState(false);

  const conflictOpts = useMemo<ChordConflictOpts>(
    () => ({
      ignoreCrossScope,
      scopeOf: shortcutScope,
    }),
    [ignoreCrossScope],
  );

  useEffect(() => {
    const reloadSend = () => setSendPref(loadComposerSendKeyPref());
    const reloadRemaps = () => setRemaps(loadShortcutRemaps());
    const reloadVoiceHotkey = () =>
      setVoiceHotkeyEnabled(loadVoiceHotkeyEnabled());
    const reloadIgnoreCross = () =>
      setIgnoreCrossScope(loadIgnoreCrossScopeConflicts());
    window.addEventListener(COMPOSER_SEND_KEY_CHANGED_EVENT, reloadSend);
    window.addEventListener(SHORTCUT_REMAP_CHANGED_EVENT, reloadRemaps);
    window.addEventListener(VOICE_HOTKEY_CHANGED_EVENT, reloadVoiceHotkey);
    window.addEventListener(
      SHORTCUT_IGNORE_CROSS_SCOPE_CHANGED_EVENT,
      reloadIgnoreCross,
    );
    const onStorage = (e: StorageEvent) => {
      if (e.key === "grok.composerSendKey" || e.key === null) reloadSend();
      if (e.key === SHORTCUT_REMAP_STORAGE_KEY || e.key === null) {
        reloadRemaps();
      }
      if (e.key === VOICE_HOTKEY_STORAGE_KEY || e.key === null) {
        reloadVoiceHotkey();
      }
      if (
        e.key === SHORTCUT_IGNORE_CROSS_SCOPE_STORAGE_KEY ||
        e.key === null
      ) {
        reloadIgnoreCross();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(COMPOSER_SEND_KEY_CHANGED_EVENT, reloadSend);
      window.removeEventListener(SHORTCUT_REMAP_CHANGED_EVENT, reloadRemaps);
      window.removeEventListener(VOICE_HOTKEY_CHANGED_EVENT, reloadVoiceHotkey);
      window.removeEventListener(
        SHORTCUT_IGNORE_CROSS_SCOPE_CHANGED_EVENT,
        reloadIgnoreCross,
      );
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Capture chord while recording; cancel with Escape.
  useEffect(() => {
    if (!recordingId) {
      setShortcutRecordingActive(false);
      return;
    }
    setShortcutRecordingActive(true);
    setRecordError(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      // Escape cancels recording (does not bind Escape unless already escape chord via other path).
      if (e.key === "Escape") {
        setRecordingId(null);
        setRecordError(null);
        return;
      }
      const chord = chordFromKeyboardEvent(e);
      if (!chord) return;
      const effective = buildEffectiveChordMap(remaps);
      const conflict = findChordConflict(
        recordingId,
        chord,
        effective,
        conflictOpts,
      );
      if (conflict) {
        const conflictRow = SHORTCUTS.find((s) => s.id === conflict);
        const action = conflictRow
          ? t(conflictRow.labelKey as MessageKey)
          : conflict;
        setRecordError(
          t("settings.shortcuts.conflict", {
            action,
          }),
        );
        return;
      }
      const next = setShortcutRemap(recordingId, chord);
      setRemaps(next);
      setRecordingId(null);
      setRecordError(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      setShortcutRecordingActive(false);
    };
  }, [recordingId, remaps, t, conflictOpts]);

  const groups = useMemo(
    () => shortcutsByGroup(sendPref, remaps, voiceHotkeyEnabled),
    [sendPref, remaps, voiceHotkeyEnabled],
  );
  const filteredGroups = useMemo(
    () =>
      filterShortcutGroups(filterQuery, groups, (key) =>
        t(key as MessageKey),
      ),
    [filterQuery, groups, t],
  );

  const conflictGroups = useMemo(
    () => findChordConflicts(remaps, undefined, conflictOpts),
    [remaps, conflictOpts],
  );
  const conflictSummary = useMemo(
    () => summarizeChordConflicts(conflictGroups, remaps),
    [conflictGroups, remaps],
  );
  const conflictIdSet = useMemo(() => {
    const s = new Set<ShortcutId>();
    for (const g of conflictGroups) {
      for (const id of g.ids) s.add(id);
    }
    return s;
  }, [conflictGroups]);

  const resetAllPlan = useMemo(
    () => planResetAllShortcutRemaps(remaps),
    [remaps],
  );

  const shortcutLabel = (id: ShortcutId): string => {
    const row = SHORTCUTS.find((s) => s.id === id);
    return row ? t(row.labelKey as MessageKey) : id;
  };

  const scopeLabel = (scope: ShortcutScope) =>
    scope === "chat-focus"
      ? t("settings.shortcuts.scope.chatFocus")
      : t("settings.shortcuts.scope.global");

  const groupLabel = (g: ShortcutGroup) =>
    t(`settings.shortcuts.group.${g}` as MessageKey);

  const canResetAll = hasAnyShortcutRemaps(remaps) && resetAllPlan.hasAny;

  const startRecord = (id: ShortcutId) => {
    if (!isRemappableShortcutId(id)) return;
    setRecordError(null);
    setRecordingId((cur) => (cur === id ? null : id));
  };

  const resetOne = (id: ShortcutId) => {
    if (!isRemappableShortcutId(id)) return;
    setRemaps(setShortcutRemap(id, null));
    if (recordingId === id) setRecordingId(null);
    setRecordError(null);
  };

  const confirmResetAll = () => {
    setRemaps(clearAllShortcutRemaps());
    setRecordingId(null);
    setRecordError(null);
    setResetAllOpen(false);
  };

  const resetConflicting = () => {
    setRemaps(resetConflictingShortcutRemaps(remaps, localStorage, conflictOpts));
    setRecordingId(null);
    setRecordError(null);
  };

  return (
    <div className="settings-card">
      <div className="settings-row settings-row--stack">
        <div className="settings-row__text">
          <div className="settings-row__label">
            <IconKeyboard size={16} />
            {t("settings.shortcuts.title")}
          </div>
          <div className="settings-row__desc">{t("settings.shortcuts.desc")}</div>
        </div>
        <div className="settings-shortcuts-header-actions">
          {onOpenHelp ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => onOpenHelp()}
            >
              {t("settings.shortcuts.openHelp")}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost"
            disabled={!canResetAll || !!recordingId}
            onClick={() => setResetAllOpen(true)}
          >
            {t("settings.shortcuts.resetAll")}
            {canResetAll ? (
              <span className="settings-shortcuts-reset-count">
                {t("settings.shortcuts.customCount", {
                  n: resetAllPlan.count,
                })}
              </span>
            ) : null}
          </button>
        </div>
      </div>
      <div className="settings-row settings-shortcuts-scope-pref">
        <div className="settings-row__text">
          <div className="settings-row__label">
            {t("settings.shortcuts.ignoreCrossScope")}
          </div>
          <div className="settings-row__desc">
            {t("settings.shortcuts.ignoreCrossScopeDesc")}
          </div>
        </div>
        <UiCheck
          checked={ignoreCrossScope}
          onChange={() => {
            const next = !ignoreCrossScope;
            setIgnoreCrossScope(next);
            saveIgnoreCrossScopeConflicts(next);
          }}
          ariaLabel={t("settings.shortcuts.ignoreCrossScope")}
        />
      </div>
      <div className="settings-shortcuts-filter">
        <IconSearch size={14} />
        <input
          type="search"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder={t("settings.shortcuts.filterPlaceholder")}
          aria-label={t("settings.shortcuts.filterPlaceholder")}
          disabled={!!recordingId}
        />
      </div>
      {conflictGroups.length > 0 ? (
        <div
          className="settings-shortcuts-conflicts"
          role="region"
          aria-label={t("settings.shortcuts.conflictsTitle")}
        >
          <div className="settings-shortcuts-conflicts__header">
            <div className="settings-shortcuts-conflicts__text">
              <div className="settings-shortcuts-conflicts__title">
                {t("settings.shortcuts.conflictsTitle")}
                <span className="settings-shortcuts-conflicts__badge">
                  {t("settings.shortcuts.conflictsSummary", {
                    groups: conflictSummary.groupCount,
                    actions: conflictSummary.idCount,
                  })}
                </span>
              </div>
              <div className="settings-shortcuts-conflicts__desc">
                {t("settings.shortcuts.conflictsDesc")}
                {conflictSummary.remappedCount > 0
                  ? ` ${t("settings.shortcuts.conflictsRemappedHint", {
                      n: conflictSummary.remappedCount,
                    })}`
                  : null}
              </div>
            </div>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={!!recordingId || conflictSummary.remappedCount === 0}
              onClick={() => resetConflicting()}
            >
              {t("settings.shortcuts.conflictsReset")}
            </button>
          </div>
          <ul className="settings-shortcuts-conflicts__list">
            {conflictGroups.map((group) => (
              <li
                key={`${group.chord}:${group.ids.join(",")}`}
                className="settings-shortcuts-conflicts__item"
              >
                <kbd className="settings-shortcuts-kbd is-conflict">
                  {formatChordDisplay(
                    group.chord,
                    platform === "mac" ? "mac" : "win",
                  )}
                </kbd>
                <span className="settings-shortcuts-conflicts__actions">
                  {group.ids.map((id) => shortcutLabel(id)).join(" · ")}
                </span>
                <span className="settings-shortcuts-conflicts__meta">
                  {t("settings.shortcuts.conflictsGroupMeta", {
                    n: group.ids.length,
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {recordError ? (
        <p className="settings-shortcuts-error" role="alert">
          {recordError}
        </p>
      ) : recordingId ? (
        <p className="settings-shortcuts-recording-hint" role="status">
          {t("settings.shortcuts.recordingHint")}
        </p>
      ) : null}
      {filteredGroups.length === 0 ? (
        <p className="settings-shortcuts-empty" role="status">
          {t("settings.shortcuts.filterEmpty")}
        </p>
      ) : (
        filteredGroups.map(({ group, rows }) => (
          <div key={group} className="settings-shortcuts-group">
            <div className="settings-shortcuts-group__title">
              {groupLabel(group)}
            </div>
            <table className="settings-shortcuts-table">
              <thead>
                <tr>
                  <th scope="col">{t("settings.shortcuts.colAction")}</th>
                  <th scope="col">{t("settings.shortcuts.colScope")}</th>
                  <th
                    scope="col"
                    className={
                      platform === "mac" ? "is-platform-active" : undefined
                    }
                  >
                    {t("settings.shortcuts.colMac")}
                  </th>
                  <th
                    scope="col"
                    className={
                      platform === "win" || platform === "other"
                        ? "is-platform-active"
                        : undefined
                    }
                  >
                    {t("settings.shortcuts.colWin")}
                  </th>
                  <th scope="col" className="settings-shortcuts-col-actions">
                    {t("settings.shortcuts.colEdit")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const remappable = isRemappableShortcutId(row.id);
                  const isCustom = remappable && !!remaps[row.id];
                  const isRecording = recordingId === row.id;
                  const isConflict = conflictIdSet.has(row.id);
                  const rowClass = [
                    isRecording ? "settings-shortcuts-row--recording" : "",
                    isCustom ? "settings-shortcuts-row--custom" : "",
                    isConflict ? "settings-shortcuts-row--conflict" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <tr
                      key={row.id}
                      className={rowClass || undefined}
                    >
                      <td>
                        {t(row.labelKey as MessageKey)}
                        {isCustom ? (
                          <span className="settings-shortcuts-custom-dot" title={t("settings.shortcuts.customBadge")}>
                            ·
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <span
                          className={
                            "settings-shortcuts-scope" +
                            (row.scope === "chat-focus"
                              ? " settings-shortcuts-scope--chat"
                              : " settings-shortcuts-scope--global")
                          }
                          title={
                            row.scope === "chat-focus"
                              ? t("settings.shortcuts.scope.chatFocusHint")
                              : t("settings.shortcuts.scope.globalHint")
                          }
                        >
                          {scopeLabel(row.scope)}
                        </span>
                      </td>
                      <td>
                        <kbd
                          className={
                            "settings-shortcuts-kbd" +
                            (isRecording ? " is-recording" : "") +
                            (isConflict && !isRecording ? " is-conflict" : "")
                          }
                        >
                          {isRecording
                            ? t("settings.shortcuts.pressKeys")
                            : row.mac === SHORTCUT_KEYS_OFF
                              ? t("shortcuts.off")
                              : row.mac}
                        </kbd>
                      </td>
                      <td>
                        <kbd
                          className={
                            "settings-shortcuts-kbd" +
                            (isRecording ? " is-recording" : "") +
                            (isConflict && !isRecording ? " is-conflict" : "")
                          }
                        >
                          {isRecording
                            ? t("settings.shortcuts.pressKeys")
                            : row.win === SHORTCUT_KEYS_OFF
                              ? t("shortcuts.off")
                              : row.win}
                        </kbd>
                      </td>
                      <td className="settings-shortcuts-col-actions">
                        <div className="settings-shortcuts-actions">
                          {remappable ? (
                            <>
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                aria-pressed={isRecording}
                                onClick={() => startRecord(row.id)}
                              >
                                {isRecording
                                  ? t("settings.shortcuts.cancelRecord")
                                  : t("settings.shortcuts.record")}
                              </button>
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                disabled={!isCustom || isRecording}
                                onClick={() => resetOne(row.id)}
                              >
                                {t("settings.shortcuts.reset")}
                              </button>
                            </>
                          ) : (
                            <span className="settings-shortcuts-fixed">
                              {row.id === "send"
                                ? t("settings.shortcuts.fixedSend")
                                : t("settings.shortcuts.fixed")}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      )}
      <p className="settings-shortcuts-note">{t("settings.shortcuts.note")}</p>

      <GlassModal
        open={resetAllOpen}
        onClose={() => setResetAllOpen(false)}
        title={t("settings.shortcuts.resetAllTitle")}
        size="sm"
        closeLabel={t("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setResetAllOpen(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={!resetAllPlan.hasAny}
              onClick={() => confirmResetAll()}
            >
              {t("settings.shortcuts.resetAllConfirm")}
            </button>
          </>
        }
      >
        <p className="settings-row__desc" style={{ margin: 0 }}>
          {t("settings.shortcuts.resetAllMsg", { n: resetAllPlan.count })}
        </p>
      </GlassModal>
    </div>
  );
}

/** List / import / open / delete Grok Build CLI sessions from active GROK_HOME. */
function CliSessionsPanel({
  t,
  sessionDataMode,
  onImported,
  onOpenSession,
}: {
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  sessionDataMode: string;
  onImported?: () => void;
  onOpenSession?: (appSessionId: string) => void;
}) {
  const [rows, setRows] = useState<api.CliSessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  /** Host CLI search results when query is non-empty; null = show local list/filter. */
  const [searchHits, setSearchHits] = useState<api.CliSessionSearchHit[] | null>(
    null,
  );
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<
    | null
    | { kind: "one"; row: api.CliSessionSummary }
    | { kind: "unlinked"; count: number }
  >(null);
  const searchSeq = useRef(0);
  /** Bumps after list refresh so active CLI search re-enriches linked state. */
  const [listEpoch, setListEpoch] = useState(0);
  const isIndependent = sessionDataMode !== "shared";

  const refresh = useCallback(async () => {
    if (!api.isTauri()) return;
    setLoading(true);
    setError(null);
    try {
      const list = await api.cliSessionsList();
      setRows(list);
      setListEpoch((n) => n + 1);
    } catch (e) {
      setError(String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, sessionDataMode]);

  // When the search box is non-empty, call host `cli_sessions_search`
  // (`grok sessions search` + local first-prompt fallback). Debounced.
  useEffect(() => {
    const q = filterQuery.trim();
    if (!q) {
      setSearchHits(null);
      setSearching(false);
      setSearchNote(null);
      return;
    }
    if (!api.isTauri()) {
      setSearchHits(null);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const hits = await api.cliSessionsSearch(q, 40);
          if (searchSeq.current !== seq) return;
          setSearchHits(hits);
          const viaCli = hits.some((h) => h.source === "cli");
          setSearchNote(
            viaCli
              ? t("settings.cliSessionsSearchViaCli")
              : t("settings.cliSessionsSearchViaLocal"),
          );
        } catch {
          if (searchSeq.current !== seq) return;
          // Host failed — fall back to client-side title/id/cwd/firstPrompt filter.
          setSearchHits(null);
          setSearchNote(t("settings.cliSessionsSearchFallback"));
        } finally {
          if (searchSeq.current === seq) setSearching(false);
        }
      })();
    }, 280);
    return () => {
      window.clearTimeout(timer);
    };
  }, [filterQuery, sessionDataMode, listEpoch, t]);

  const filtered = useMemo(() => {
    const q = filterQuery.trim();
    if (!q) return rows;
    if (searchHits) return searchHits;
    // Host still loading or failed → local filter (incl. firstPrompt when present).
    return filterCliSessions(rows, q);
  }, [rows, filterQuery, searchHits]);
  /** Bulk import / delete unlinked always targets the full list (not the filter). */
  const pending = countUnlinkedCliSessions(rows);
  const sourceHome =
    rows.find((r) => r.sourceHome)?.sourceHome ??
    (isIndependent ? "~/.grok-app/agent-home" : "~/.grok");

  const copyAgentId = async (agentSessionId: string) => {
    try {
      await navigator.clipboard.writeText(agentSessionId);
      setCopiedId(agentSessionId);
      window.setTimeout(() => {
        setCopiedId((cur) => (cur === agentSessionId ? null : cur));
      }, 1500);
    } catch (e) {
      setError(String(e));
    }
  };

  const openAppSession = (appSessionId: string) => {
    onOpenSession?.(appSessionId);
  };

  /** Import if needed, then open the app session (skip re-import when linked). */
  const resumeOrImportOpen = async (row: api.CliSessionSummary) => {
    setBusyId(row.agentSessionId);
    setError(null);
    setStatus(null);
    try {
      if (row.alreadyLinked && row.appSessionId) {
        setStatus(t("settings.cliSessionsOpened", { title: row.title }));
        openAppSession(row.appSessionId);
        return;
      }
      const meta = await api.cliSessionImport(row.agentSessionId, {
        dir: row.dir,
      });
      setStatus(
        t("settings.cliSessionsImportedOpen", { title: row.title }),
      );
      await refresh();
      onImported?.();
      if (meta?.id) openAppSession(meta.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const importAll = async () => {
    setBusyId("__all__");
    setError(null);
    setStatus(null);
    try {
      const imported = await api.cliSessionsImportAll(50);
      setStatus(
        t("settings.cliSessionsImportedN", { n: String(imported.length) }),
      );
      await refresh();
      onImported?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const runDeleteOne = async (row: api.CliSessionSummary) => {
    setBusyId(row.agentSessionId);
    setError(null);
    setStatus(null);
    try {
      await api.cliSessionDelete(row.agentSessionId, { dir: row.dir });
      setDeleteConfirm(null);
      setStatus(t("settings.cliSessionsDeleted", { title: row.title }));
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const runDeleteUnlinked = async () => {
    const targets = rows.filter((r) => !r.alreadyLinked);
    if (targets.length === 0) {
      setDeleteConfirm(null);
      return;
    }
    setBusyId("__delete_unlinked__");
    setError(null);
    setStatus(null);
    let deleted = 0;
    const errors: string[] = [];
    try {
      for (const row of targets) {
        try {
          await api.cliSessionDelete(row.agentSessionId, { dir: row.dir });
          deleted += 1;
        } catch (e) {
          errors.push(`${row.agentSessionId}: ${String(e)}`);
        }
      }
      setDeleteConfirm(null);
      setStatus(
        t("settings.cliSessionsDeletedN", { n: String(deleted) }),
      );
      if (errors.length > 0) {
        setError(errors.slice(0, 3).join("; "));
      }
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const deleteBusy =
    busyId === "__delete_unlinked__" ||
    (deleteConfirm?.kind === "one" &&
      busyId === deleteConfirm.row.agentSessionId);

  return (
    <div
      className="settings-row settings-row--stack"
      id="settings-anchor-cliSessions"
    >
      <div className="settings-row__text">
        <div className="settings-row__label">{t("settings.cliSessions")}</div>
        <div className="settings-row__desc">{t("settings.cliSessionsDesc")}</div>
      </div>
      <div className="settings-cli-sessions">
        {isIndependent ? (
          <div className="settings-cli-sessions__note" role="note">
            {t("settings.cliSessionsIndependentNote")}
          </div>
        ) : null}
        <div className="settings-cli-sessions__path" title={sourceHome}>
          {t("settings.cliSessionsSource", { path: sourceHome })}
        </div>
        <div className="settings-cli-sessions__actions">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={loading || !!busyId}
            onClick={() => void refresh()}
          >
            {t("resources.refresh")}
          </button>
          <button
            type="button"
            className="btn btn--solid"
            disabled={loading || !!busyId || pending === 0}
            onClick={() => void importAll()}
          >
            {busyId === "__all__"
              ? t("settings.cliSessionsImporting")
              : t("settings.cliSessionsImportAll", { n: String(pending) })}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--danger"
            disabled={loading || !!busyId || pending === 0}
            onClick={() =>
              setDeleteConfirm({ kind: "unlinked", count: pending })
            }
          >
            {busyId === "__delete_unlinked__"
              ? t("settings.cliSessionsDeleting")
              : t("settings.cliSessionsDeleteUnlinked", {
                  n: String(pending),
                })}
          </button>
        </div>
        <div className="settings-cli-sessions__filter">
          <IconSearch size={14} />
          <input
            type="search"
            value={filterQuery}
            onChange={(e) => {
              setFilterQuery(e.target.value);
              // Clear stale host error when the user edits the query.
              if (error) setError(null);
            }}
            placeholder={t("settings.cliSessionsFilterPlaceholder")}
            aria-label={t("settings.cliSessionsFilterPlaceholder")}
          />
        </div>
        {searchNote && filterQuery.trim() ? (
          <div className="settings-cli-sessions__search-note" role="status">
            {searching
              ? t("settings.cliSessionsSearching")
              : searchNote}
          </div>
        ) : searching && filterQuery.trim() ? (
          <div className="settings-cli-sessions__search-note" role="status">
            {t("settings.cliSessionsSearching")}
          </div>
        ) : null}
        {error ? (
          <div className="settings-cli-sessions__err" role="alert">
            {error}
          </div>
        ) : null}
        {status ? (
          <div className="settings-cli-sessions__ok" role="status">
            {status}
          </div>
        ) : null}
        {loading && rows.length === 0 && !filterQuery.trim() ? (
          <div className="settings-cli-sessions__empty">
            {t("settings.cliSessionsLoading")}
          </div>
        ) : rows.length === 0 && !filterQuery.trim() ? (
          <div className="settings-cli-sessions__empty">
            {t("settings.cliSessionsEmpty")}
          </div>
        ) : searching && filtered.length === 0 ? (
          <div className="settings-cli-sessions__empty">
            {t("settings.cliSessionsSearching")}
          </div>
        ) : filtered.length === 0 ? (
          <div className="settings-cli-sessions__empty">
            {filterQuery.trim()
              ? t("settings.cliSessionsSearchEmpty")
              : t("settings.cliSessionsFilterEmpty")}
          </div>
        ) : (
          <ul className="settings-cli-sessions__list">
            {filtered.slice(0, 40).map((r) => {
              const busy = busyId === r.agentSessionId;
              const shortId =
                r.agentSessionId.length > 14
                  ? `${r.agentSessionId.slice(0, 8)}…${r.agentSessionId.slice(-4)}`
                  : r.agentSessionId;
              const firstPrompt =
                "firstPrompt" in r
                  ? (r as { firstPrompt?: string | null }).firstPrompt
                  : undefined;
              const remoteOnly = !r.dir;
              return (
                <li
                  key={r.agentSessionId}
                  className={
                    "settings-cli-sessions__item" +
                    (r.alreadyLinked
                      ? " settings-cli-sessions__item--linked"
                      : "")
                  }
                >
                  <div className="settings-cli-sessions__meta">
                    <div className="settings-cli-sessions__title-row">
                      <div className="settings-cli-sessions__title">
                        {r.title}
                      </div>
                      {r.alreadyLinked ? (
                        <span className="settings-cli-sessions__badge">
                          {t("settings.cliSessionsLinked")}
                        </span>
                      ) : null}
                    </div>
                    {firstPrompt ? (
                      <div
                        className="settings-cli-sessions__prompt"
                        title={firstPrompt}
                      >
                        {firstPrompt}
                      </div>
                    ) : null}
                    <div className="settings-cli-sessions__sub">
                      {r.cwd ? `${r.cwd} · ` : ""}
                      {r.numMessages
                        ? t("settings.cliSessionsMsgs", {
                            n: String(r.numMessages),
                          })
                        : null}
                    </div>
                    <div className="settings-cli-sessions__id-row">
                      <span
                        className="settings-cli-sessions__id"
                        title={r.agentSessionId}
                      >
                        {t("settings.cliSessionsAgentId", { id: shortId })}
                      </span>
                      <button
                        type="button"
                        className="settings-cli-sessions__copy"
                        title={t("settings.cliSessionsCopyId")}
                        aria-label={t("settings.cliSessionsCopyId")}
                        onClick={() => void copyAgentId(r.agentSessionId)}
                      >
                        <IconCopy size={12} />
                        <span>
                          {copiedId === r.agentSessionId
                            ? t("settings.cliSessionsCopied")
                            : t("settings.cliSessionsCopyId")}
                        </span>
                      </button>
                    </div>
                  </div>
                  <div className="settings-cli-sessions__row-actions">
                    {r.alreadyLinked ? (
                      <button
                        type="button"
                        className="btn btn--solid"
                        disabled={!!busyId || !r.appSessionId}
                        onClick={() => void resumeOrImportOpen(r)}
                      >
                        {busy
                          ? t("settings.cliSessionsImporting")
                          : t("settings.cliSessionsOpen")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--solid"
                        disabled={!!busyId}
                        onClick={() => void resumeOrImportOpen(r)}
                      >
                        {busy
                          ? t("settings.cliSessionsImporting")
                          : t("settings.cliSessionsImportOpen")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm btn--danger"
                      disabled={!!busyId || remoteOnly}
                      title={
                        remoteOnly
                          ? t("settings.cliSessionsDeleteRemoteOnly")
                          : t("settings.cliSessionsDeleteConfirmMsg", {
                              title: r.title,
                            })
                      }
                      aria-label={t("settings.cliSessionsDelete")}
                      onClick={() =>
                        setDeleteConfirm({ kind: "one", row: r })
                      }
                    >
                      <IconTrash size={13} />
                      <span>
                        {busy
                          ? t("settings.cliSessionsDeleting")
                          : t("settings.cliSessionsDelete")}
                      </span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <GlassModal
        open={!!deleteConfirm}
        onClose={() => {
          if (!deleteBusy) setDeleteConfirm(null);
        }}
        title={
          deleteConfirm?.kind === "unlinked"
            ? t("settings.cliSessionsDeleteUnlinkedConfirmTitle")
            : t("settings.cliSessionsDeleteConfirmTitle")
        }
        size="sm"
        closeLabel={t("common.close")}
        closeOnOverlay={!deleteBusy}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={deleteBusy}
              onClick={() => setDeleteConfirm(null)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={deleteBusy || !deleteConfirm}
              onClick={() => {
                if (!deleteConfirm) return;
                if (deleteConfirm.kind === "unlinked") {
                  void runDeleteUnlinked();
                } else {
                  void runDeleteOne(deleteConfirm.row);
                }
              }}
            >
              {deleteBusy
                ? t("settings.cliSessionsDeleting")
                : t("settings.cliSessionsDelete")}
            </button>
          </>
        }
      >
        <p className="settings-row__desc" style={{ margin: 0 }}>
          {deleteConfirm?.kind === "unlinked"
            ? t("settings.cliSessionsDeleteUnlinkedConfirmMsg", {
                n: String(deleteConfirm.count),
              })
            : t("settings.cliSessionsDeleteConfirmMsg", {
                title: deleteConfirm?.row.title ?? "",
              })}
        </p>
      </GlassModal>
    </div>
  );
}

function AboutUpdateRow({
  t,
}: {
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}) {
  // Single authority: useUpdater (plugin path or GitHub fallback).
  const {
    status,
    channelInfo,
    checkForUpdate,
    installAndRelaunch,
    githubReleasesUrl,
  } = useUpdaterContext();
  const [openError, setOpenError] = useState<string | null>(null);

  const openRelease = async (url: string) => {
    try {
      setOpenError(null);
      await api.openExternalUrl(url);
    } catch (e) {
      setOpenError(String(e));
    }
  };

  const statusText = (() => {
    switch (status.state) {
      case "checking":
        return t("settings.autoUpdateChecking");
      case "up-to-date":
        return status.version
          ? t("settings.checkUpdateLatest", { version: status.version })
          : t("settings.autoUpdateUpToDate");
      case "available":
        return t("settings.autoUpdateAvailable", { version: status.version });
      case "downloading":
        return t("settings.autoUpdateDownloading");
      case "ready":
        return t("settings.autoUpdateReady");
      case "installing":
        return t("settings.autoUpdateInstalling");
      case "manual-required":
        return t("settings.autoUpdateManualRequired", {
          version: status.version,
        });
      case "error":
        return null;
      default:
        return null;
    }
  })();

  const busy =
    status.state === "checking" ||
    status.state === "downloading" ||
    status.state === "installing";

  // Only show install when download finished (ready), never on available.
  const showInstall = status.state === "ready";
  const showInstalling = status.state === "installing";
  const showOpenRelease = status.state === "manual-required";
  const releaseUrl =
    status.state === "manual-required" ? status.releaseUrl : githubReleasesUrl;
  const downloadUrl =
    status.state === "manual-required" ? status.downloadUrl : null;
  const assetNames =
    status.state === "manual-required" ? status.assetNames : undefined;
  const highlight =
    status.state === "available" ||
    status.state === "ready" ||
    status.state === "downloading" ||
    status.state === "manual-required";

  return (
    <div className="settings-row settings-row--stack">
      <div className="settings-row__text">
        <div className="settings-row__label">{t("settings.checkUpdate")}</div>
        <div className="settings-row__desc">{t("settings.checkUpdateDesc")}</div>
        <div className="settings-row__hint" data-updater-channel={channelInfo.channel}>
          {channelInfo.channel === "silent"
            ? t("settings.autoUpdateChannelSilent")
            : t("settings.autoUpdateChannelManual")}
          {channelInfo.endpoint
            ? ` · ${channelInfo.endpoint.replace(/^https:\/\//, "")}`
            : ""}
        </div>
      </div>
      <div className="settings-about-update">
        <div className="settings-about-update__actions">
          <button
            type="button"
            className="btn btn--solid"
            disabled={busy}
            onClick={() => void checkForUpdate()}
          >
            {busy
              ? t("settings.checkUpdateChecking")
              : t("settings.checkUpdate")}
          </button>
          {showInstalling ? (
            <button type="button" className="btn btn--solid" disabled>
              {t("settings.autoUpdateInstalling")}
            </button>
          ) : showInstall ? (
            <button
              type="button"
              className="btn btn--solid"
              disabled={busy}
              onClick={() => void installAndRelaunch()}
            >
              {t("settings.autoUpdateInstall")}
            </button>
          ) : null}
          {showOpenRelease && downloadUrl ? (
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => void openRelease(downloadUrl)}
            >
              {t("settings.checkUpdateDownload")}
            </button>
          ) : null}
          {showOpenRelease ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => void openRelease(releaseUrl)}
            >
              {t("settings.checkUpdateOpen")}
            </button>
          ) : null}
        </div>
        {statusText ? (
          <div
            className={
              "settings-about-update__status" + (highlight ? " is-available" : "")
            }
            role="status"
          >
            {statusText}
          </div>
        ) : null}
        {status.state === "error" ? (
          <div className="settings-about-update__err" role="alert">
            {t("settings.autoUpdateError", { error: status.message })}
          </div>
        ) : null}
        {openError ? (
          <div className="settings-about-update__err" role="alert">
            {t("settings.checkUpdateFailed", { error: openError })}
          </div>
        ) : null}
        {assetNames && assetNames.length > 0 ? (
          <div className="settings-about-update__assets">
            {assetNames.slice(0, 6).join(" · ")}
          </div>
        ) : null}
      </div>
    </div>
  );
}

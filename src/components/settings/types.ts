/**
 * Settings page types + view-model bag for section components.
 * SettingsPageProps remains the public AppWorkbench contract (re-exported).
 */
import type { SettingsSectionId, SettingsTabId } from "@/lib/settingsCatalog";
import type { Theme, ThemePreference } from "@/lib/theme";
import type { ThemeScheduleConfig } from "@/lib/themeSchedule";
import type { ArchiveAgeOptionPreview } from "@/lib/sessionArchiveAge";
import type { ChatDensity } from "@/lib/chatDensity";
import type { ChatFontScale } from "@/lib/chatFontScale";
import type { ChatWidth } from "@/lib/chatWidthPref";
import type { CodeFontScale } from "@/lib/codeFontScalePref";
import type { ComposerMinRows } from "@/lib/composerMinRows";
import type { ComposerSendKeyPref } from "@/lib/composerSendKey";
import type { DetectedEditor } from "@/lib/api/providers";
import type { MessageActionsVisibility } from "@/lib/messageActionsPref";
import type { MsgRailSide } from "@/lib/msgRailSidePref";
import type {
  NotifyHonestySurface,
  TrayBusyBadgeSurface,
} from "@/lib/trayNotifyPro";
import type { NotifyQuietHoursPref } from "@/lib/notifyQuietHours";
import type { SessionSearchRankMode } from "@/lib/sessionSearch";
import type { SidebarDensity } from "@/lib/sidebarDensity";
import type { ThemeScheduleHonesty } from "@/lib/themeSchedule";
import type { ThinkingExpandPref } from "@/lib/thinkingPref";
import type { TranscriptFilterMode } from "@/lib/transcriptFilterPref";
import type { WallpaperSourceKind } from "@/lib/wallpaperSource";
import type {
  Dispatch,
  PointerEvent as ReactPointerEvent,
  RefObject,
  SetStateAction,
} from "react";
import type { MessageTimeFormat } from "@/lib/messageTimeFormatPref";
import type { ThemeSkinId, WallpaperClip, WallpaperFocus, WallpaperKind, WallpaperRecord } from "@/lib/themeSkin";
import type { WallpaperFocusApplyResult } from "@/components/WallpaperFocusEditor";
import type { ComposerPrefsScope, ModelOption, PermissionPolicyId } from "@/lib/grokCatalog";
import type { AccountStatus } from "@/lib/api";
import type { CostRollupProjectMeta, CostRollupSessionMeta } from "@/lib/costRollup";
import type { ArchiveAgeSessionLike } from "@/lib/sessionArchiveAge";
import type { TodoGateFireSignal } from "@/lib/todoGate";
import type { Vars } from "@/i18n";

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

export type MarqueeBox = { x0: number; y0: number; x1: number; y1: number };

/**
 * Public props for SettingsPage (AppWorkbench call site).
 * Kept wide for backward compatibility; routing gate uses ≤40 destructured keys.
 */
export interface SettingsPageProps {
  section: SettingsSectionId;
  tab?: string | null;
  onSection: (id: SettingsSectionId, tab?: string | null) => void;
  onBack: () => void;
  phoneLayout?: boolean;
  labels: Record<string, string>;
  locale: string;
  localePreference?: string;
  onLocale: (v: string) => void;
  theme: Theme;
  themePreference?: ThemePreference;
  onTheme: (v: ThemePreference) => void;
  themeSchedule?: ThemeScheduleConfig;
  onThemeSchedule?: (v: ThemeScheduleConfig) => void;
  showMessageTimestamps?: boolean;
  onShowMessageTimestamps?: (v: boolean) => void;
  showReplyLength?: boolean;
  onShowReplyLength?: (v: boolean) => void;
  /** When true, sidebar top-left Grok mark follows the active branded provider. */
  replaceProviderBrandLogo?: boolean;
  onReplaceProviderBrandLogo?: (v: boolean) => void;
  welcomeMotionEnabled?: boolean;
  onWelcomeMotionEnabled?: (v: boolean) => void;
  goalOrchUiEnabled?: boolean;
  onGoalOrchUiEnabled?: (v: boolean) => void;
  messageTimeFormat?: MessageTimeFormat;
  onMessageTimeFormat?: (v: MessageTimeFormat) => void;
  sidebarShowRelativeTime?: boolean;
  onSidebarShowRelativeTime?: (v: boolean) => void;
  mutedSessionCount?: number;
  onClearAllSessionMutes?: () => void;
  unreadSessionCount?: number;
  onClearAllSessionUnread?: () => void;
  zenMode?: boolean;
  onZenMode?: (v: boolean) => void;
  skin?: ThemeSkinId;
  onSkin?: (v: ThemeSkinId) => void;
  wallpaperUrl?: string | null;
  wallpaperKind?: WallpaperKind | null;
  wallpaperFocus?: WallpaperFocus | null;
  wallpaperClip?: WallpaperClip | null;
  wallpaperMediaSize?: { w: number; h: number } | null;
  onWallpaper?: (record: WallpaperRecord | null) => void | Promise<void>;
  onWallpaperAdjust?: (result: WallpaperFocusApplyResult) => void;
  onWallpaperMediaSize?: (size: { w: number; h: number }) => void;
  wallpaperScrim?: number;
  onWallpaperScrim?: (value: number) => void;
  wallpaperBlur?: number;
  onWallpaperBlur?: (value: number) => void;
  sessionDataMode: string;
  onSessionDataMode: (v: string) => void;
  onCliSessionsImported?: () => void;
  onOpenCliSession?: (appSessionId: string) => void;
  policy: string;
  onPolicy: (v: PermissionPolicyId) => void;
  prefsScope?: ComposerPrefsScope | string;
  onPrefsScope?: (v: ComposerPrefsScope) => void;
  availableModels?: ModelOption[];
  manualCliPath: string;
  onManualCliPath: (v: string) => void;
  onCliBlur: (v: string) => void;
  /** Refresh CLI probe card after WSL backend / path changes. */
  onCliInfoRefresh?: (cli: import("@/lib/api").CliProbeInfo) => void;
  allowUnverifiedCliInstall?: boolean;
  onAllowUnverifiedCliInstall?: (v: boolean) => void;
  lastCliChecksumVerified?: boolean | null;
  acpServerAddr: string;
  onAcpServerAddr: (v: string) => void;
  onAcpServerBlur: (v: string) => void;
  proxyMode?: string;
  onProxyMode?: (v: string) => void;
  proxyUrl?: string;
  onProxyUrl?: (v: string) => void;
  proxyNoProxy?: string;
  onProxyNoProxy?: (v: string) => void;
  maxConcurrentAgents?: number;
  onMaxConcurrentAgents?: (v: number) => void;
  lastProcessLimit?: import("@/lib/processBudget").ProcessLimitEvent | null;
  agentIdleMinutes?: number;
  onAgentIdleMinutes?: (v: number) => void;
  streamStallSeconds?: number;
  onStreamStallSeconds?: (v: number) => void;
  auditLedgerRetentionDays?: number;
  onAuditLedgerRetentionDays?: (v: number) => void;
  includePartialMessages?: boolean;
  onIncludePartialMessages?: (v: boolean) => void;
  maxAgentTurns?: number;
  onMaxAgentTurns?: (v: number) => void;
  backgroundWaitPolicy?: string;
  onBackgroundWaitPolicy?: (v: string) => void;
  backgroundWaitTimeoutSec?: number;
  onBackgroundWaitTimeoutSec?: (v: number) => void;
  preferredAgent?: string;
  onPreferredAgent?: (v: string) => void;
  agentProfilePath?: string;
  onAgentProfilePath?: (v: string) => void;
  onAgentProfilePathCommit?: (v: string) => void;
  agentsJson?: string;
  onAgentsJson?: (v: string) => void;
  onAgentsJsonCommit?: (v: string) => void | Promise<void>;
  agentCatalog?: Array<{ name: string; source: string }>;
  experimentalMemory?: boolean;
  onExperimentalMemory?: (v: boolean) => void;
  compactionMode?: string;
  onCompactionMode?: (v: string) => void;
  compactionDetail?: string;
  onCompactionDetail?: (v: string) => void;
  twoPassCompactionEnabled?: boolean;
  onTwoPassCompactionEnabled?: (v: boolean) => void;
  disableWebSearch?: boolean;
  onDisableWebSearch?: (v: boolean) => void;
  noAskUser?: boolean;
  onNoAskUser?: (v: boolean) => void;
  disallowedTools?: string[];
  onDisallowedTools?: (v: string[]) => void;
  allowedTools?: string[];
  onAllowedTools?: (v: string[]) => void;
  reopenLastSession?: boolean;
  onReopenLastSession?: (v: boolean) => void;
  closeToTray?: boolean;
  onCloseToTray?: (v: boolean) => void;
  keepTrayForSchedules?: boolean;
  onKeepTrayForSchedules?: (v: boolean) => void;
  /** Dock/tray badge pref (product: unread after background turn end). */
  trayBusyBadge?: boolean;
  onTrayBusyBadge?: (v: boolean) => void;
  /** Current badge count for settings status (unread session count). */
  trayBusyCount?: number;
  /** Windows taskbar button overlay (opt-in, default off). Independent of trayBusyBadge. */
  winTaskbarOverlay?: boolean;
  onWinTaskbarOverlay?: (v: boolean) => void;
  launchAtLogin?: boolean;
  onLaunchAtLogin?: (v: boolean) => void;
  windowAlwaysOnTop?: boolean;
  onWindowAlwaysOnTop?: (v: boolean) => void;
  notifyOnTurnDone?: boolean;
  onNotifyOnTurnDone?: (v: boolean) => void;
  notifyOnPermission?: boolean;
  onNotifyOnPermission?: (v: boolean) => void;
  notifySound?: boolean;
  onNotifySound?: (v: boolean) => void;
  permissionTimeoutSec?: number;
  onPermissionTimeoutSec?: (v: number) => void;
  askUserTimeoutSec?: number;
  onAskUserTimeoutSec?: (v: number) => void;
  planEnabled?: boolean;
  onPlanEnabled?: (v: boolean) => void;
  todoGateEnabled?: boolean;
  onTodoGateEnabled?: (v: boolean) => void;
  todoGateMaxFiresPerPrompt?: number;
  onTodoGateMaxFiresPerPrompt?: (v: number) => void;
  todoGateFireSignal?: TodoGateFireSignal | null;
  subagentsEnabled?: boolean;
  onSubagentsEnabled?: (v: boolean) => void;
  subagentWorktreeSnapshotEnabled?: boolean;
  onSubagentWorktreeSnapshotEnabled?: (v: boolean) => void;
  autoWakeEnabled?: boolean;
  onAutoWakeEnabled?: (v: boolean) => void;
  workflowsEnabled?: boolean;
  onWorkflowsEnabled?: (v: boolean) => void;
  useLeader?: boolean;
  onUseLeader?: (v: boolean) => void;
  voiceId?: string;
  onVoiceId?: (v: string) => void;
  voiceDictationAutoSend?: boolean;
  onVoiceDictationAutoSend?: (v: boolean) => void;
  voiceKeepAgentsOnEnd?: boolean;
  sttEngine?: string;
  onSttEngine?: (v: string) => void;
  sttCustomBaseUrl?: string;
  onSttCustomBaseUrl?: (v: string) => void;
  sttCustomModel?: string;
  onSttCustomModel?: (v: string) => void;
  sttCustomLanguage?: string;
  onSttCustomLanguage?: (v: string) => void;
  /**
   * Chinese output script for dictation on Whisper-family custom endpoints:
   * `auto` (follow app UI locale) | `simplified` | `traditional`.
   */
  sttZhScript?: string;
  onSttZhScript?: (v: string) => void;
  onVoiceKeepAgentsOnEnd?: (v: boolean) => void;
  storeApiKeysInKeychain?: boolean;
  onStoreApiKeysInKeychain?: (v: boolean) => void;
  sandboxProfile?: string;
  onSandboxProfile?: (v: string) => void;
  /** Open SandboxWizard in info mode (Settings guide CTA). */
  onOpenSandboxWizard?: () => void;
  cliInfo: {
    found: boolean;
    path: string | null;
    version: string | null;
    source: string;
    cliAuthPresent: boolean;
    versionSupported?: boolean | null;
    minVersion?: string | null;
    recommendedVersion?: string | null;
    meetsRecommended?: boolean | null;
    agentBinarySkew?: boolean;
    agentVersion?: string | null;
    agentPath?: string | null;
    acpAgentVersion?: string | null;
    acpAgentVersionSkew?: boolean;
  };
  /** Returns outcome so Settings can toast without inventing host results. */
  onCliRepairAgentSidecar?: () =>
    | void
    | Promise<{
        ok: boolean;
        agentVersion?: string | null;
        error?: string | null;
      } | void>;
  cliAgentSkewRepairing?: boolean;
  onDoctor: () => void;
  onOpenReliability?: () => void;
  onOpenBatchAgents?: () => void;
  costRollupSessions?: readonly CostRollupSessionMeta[];
  costRollupProjects?: readonly CostRollupProjectMeta[];
  versionFooter: string;
  account: AccountStatus | null;
  accountLoading: boolean;
  accountBusy: boolean;
  accountHeatmapError?: unknown;
  accountProbeError?: unknown;
  loginHint?: string | null;
  savedAccounts?: import("@/lib/api").SavedAccount[];
  activeAccountId?: string | null;
  onAccountLoginOauth: () => void;
  onAccountLoginDevice: () => void;
  /** Paste browser verification code into running grok login. */
  onAccountLoginSubmitCode?: (code: string) => void;
  onCancelLogin: () => void;
  onAccountLogout: () => void;
  onAccountRefresh: () => void;
  onAccountManageUsage: () => void;
  onAccountSubscribe: () => void;
  onSaveAccount?: () => void;
  onAddAccount?: () => void;
  onSwitchAccount?: (id: string) => void;
  onRemoveAccount?: (id: string) => void;
  onImportChat?: () => void;
  defaultOpenTarget?: string;
  onDefaultOpenTarget?: (v: string) => void;
  onProvidersChanged?: () => void;
  onProviderActivated?: () => void;
  /** DeepSeek (etc.) balance probe from ProvidersPanel → sidebar cache. */
  onProviderBalanceLoaded?: (
    providerId: string,
    result: import("@/lib/api").ProviderBalanceResult,
  ) => void;
  archivedGroups?: ArchivedProjectGroup[];
  onRestoreArchivedSessions?: (ids: string[]) => void;
  onDeleteArchivedSessions?: (ids: string[]) => void;
  onArchiveOlderThan?: (days: number) => void;
  archiveAgeSessions?: readonly ArchiveAgeSessionLike[];
  projectPath?: string | null;
  onOpenProjectFileInResources?: (opts: {
    path: string;
    relativePath: string;
    line?: number | null;
  }) => void;
  focusAnchorId?: string | null;
  prHubHighlightPr?: number | null;
  onFocusAnchorConsumed?: () => void;
  onSkillsPrefsChanged?: () => void;
  onOpenShortcutsHelp?: () => void;
  onOpenProductTutorial?: () => void;
  trustedProjects?: Array<{ id: string; name: string; path: string }>;
}

/**
 * Runtime bag provided via SettingsModelProvider.
 * Includes resolved props, local UI state, and shell helpers.
 * Index signature allows sections to grow without constant type churn.
 */
export type SettingsViewModel = SettingsPageProps & {
  t: (k: string, vars?: Vars) => string;
  activeTab: SettingsTabId | null;
  setSectionTab: (tab: SettingsTabId) => void;
  navigateTo: (
    id: SettingsSectionId,
    nextTab?: string | null,
    anchorId?: string | null,
  ) => void;
  rowHighlight: (anchorId: string) => string;
  title: string;
  sectionNav: ReturnType<typeof import("@/lib/settingsCatalog").getNavDef>;
  showSettingsToast: (msg: string, ms?: number) => void;
  workspaceCwd: string | null;
  agentsJsonError: string | null;
  agentsJsonSaving: boolean;
  alwaysQuitWithoutAsking: boolean;
  archiveAgeAnyMatch: boolean;
  archiveAgeMaxMatch: number;
  archiveAgePreviews: ArchiveAgeOptionPreview[];
  archivedAllSelected: boolean;
  archivedSelected: Set<string>;
  archivedSelectedCount: number;
  archivedSomeSelected: boolean;
  archivedSurfaceRef: RefObject<HTMLDivElement | null>;
  archivedTotal: number;
  backBottomAlways: boolean;
  chatDensity: ChatDensity;
  chatFontScale: ChatFontScale;
  chatWidth: ChatWidth;
  clearMemoryBusy: boolean;
  codeFontScale: CodeFontScale;
  codeLineNumbers: boolean;
  codeWrapDefault: boolean;
  composerDraftStats: boolean;
  composerMinRows: ComposerMinRows;
  composerSendKeyPref: ComposerSendKeyPref;
  composerSpellcheck: boolean;
  confirmExternalLinks: boolean;
  editors: DetectedEditor[];
  exportLogo: string | null;
  exportLogoInputRef: RefObject<HTMLInputElement | null>;
  formatSessionWhen: (iso: string, locale: string) => string;
  marquee: MarqueeBox | null;
  memoryBrowserEpoch: number;
  messageActionsVisibility: MessageActionsVisibility;
  msgRailSide: MsgRailSide;
  notifyHonesty: NotifyHonestySurface;
  notifyPermBusy: boolean;
  notifyQuietHours: NotifyQuietHoursPref;
  notifyTestBusy: boolean;
  onArchivedPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onArchivedPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onArchivedPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onArchivedPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onChatDensity: (next: ChatDensity) => void;
  onChatFontScale: (next: ChatFontScale) => void;
  onChatWidth: (next: ChatWidth) => void;
  onClearExportLogo: () => void;
  onCodeFontScale: (next: CodeFontScale) => void;
  onComposerMinRows: (next: ComposerMinRows) => void;
  onExportLogoFile: (file: File | null) => Promise<void>;
  onMessageActionsVisibility: (next: MessageActionsVisibility) => void;
  onMsgRailSide: (next: MsgRailSide) => void;
  onNotifyQuietHours: (next: NotifyQuietHoursPref) => void;
  onResetTerminalFont: () => void;
  onResetUiFont: () => void;
  onSidebarDensity: (next: SidebarDensity) => void;
  onTerminalFontFamily: (next: string) => void;
  onTerminalFontSize: (next: number) => void;
  onUiFontFamily: (next: string) => void;
  onWallpaperFile: (file: File | null | undefined) => Promise<void>;
  openWallpaperSource: (tab: WallpaperSourceKind) => void;
  requestNotifyPermission: () => Promise<void>;
  selectionToolbar: boolean;
  sessionSearchRank: SessionSearchRankMode;
  setAgentsJsonError: Dispatch<SetStateAction<string | null>>;
  setAgentsJsonSaving: Dispatch<SetStateAction<boolean>>;
  setAlwaysQuitWithoutAsking: Dispatch<SetStateAction<boolean>>;
  setArchivedSelected: Dispatch<SetStateAction<Set<string>>>;
  setBackBottomAlways: Dispatch<SetStateAction<boolean>>;
  setClearMemoryOpen: Dispatch<SetStateAction<boolean>>;
  setCodeLineNumbers: Dispatch<SetStateAction<boolean>>;
  setCodeWrapDefault: Dispatch<SetStateAction<boolean>>;
  setComposerDraftStats: Dispatch<SetStateAction<boolean>>;
  setComposerSendKeyPref: Dispatch<SetStateAction<ComposerSendKeyPref>>;
  setComposerSpellcheck: Dispatch<SetStateAction<boolean>>;
  setConfirmExternalLinks: Dispatch<SetStateAction<boolean>>;
  setMemoryBrowserEpoch: Dispatch<SetStateAction<number>>;
  setMirrorConfirm: Dispatch<SetStateAction<{ title: string; message: string; confirmLabel: string; onConfirm: () => void; } | null>>;
  setSelectionToolbar: Dispatch<SetStateAction<boolean>>;
  setSessionSearchRank: Dispatch<SetStateAction<SessionSearchRankMode>>;
  setStopAllSkipConfirm: Dispatch<SetStateAction<boolean>>;
  setThinkingExpand: Dispatch<SetStateAction<ThinkingExpandPref>>;
  setToolStepsAutoCollapse: Dispatch<SetStateAction<boolean>>;
  setChatVirtualScroll: Dispatch<SetStateAction<boolean>>;
  setTranscriptFilter: Dispatch<SetStateAction<TranscriptFilterMode>>;
  setVoiceHotkeyEnabled: Dispatch<SetStateAction<boolean>>;
  setWallpaperError: Dispatch<SetStateAction<string | null>>;
  setWallpaperFocusOpen: Dispatch<SetStateAction<boolean>>;
  setWallpaperSourceOpen: Dispatch<SetStateAction<boolean>>;
  sidebarDensity: SidebarDensity;
  stopAllSkipConfirm: boolean;
  terminalFontFamily: string;
  terminalFontSize: number;
  testDesktopNotification: () => Promise<void>;
  themeScheduleHonesty: ThemeScheduleHonesty;
  thinkingExpand: ThinkingExpandPref;
  toggleArchivedAll: () => void;
  toggleArchivedGroup: (ids: string[]) => void;
  toggleArchivedId: (id: string) => void;
  toolStepsAutoCollapse: boolean;
  chatVirtualScroll: boolean;
  transcriptFilter: TranscriptFilterMode;
  trayBusySurface: TrayBusyBadgeSurface;
  uiFontFamily: string;
  voiceHotkeyEnabled: boolean;
  wallpaperBusy: boolean;
  wallpaperError: string | null;
  wallpaperFocusOpen: boolean;
  wallpaperInputRef: RefObject<HTMLInputElement | null>;
  wallpaperSourceOpen: boolean;
  wallpaperSourceTab: WallpaperSourceKind;
  /** Catch-all for local state / setters section components consume. */
  [key: string]: unknown;
};

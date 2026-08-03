/**
 * Settings page types + view-model bag for section components.
 * SettingsPageProps remains the public AppWorkbench contract (re-exported).
 */
import type { SettingsSectionId, SettingsTabId } from "@/lib/settingsCatalog";
import type { Theme, ThemePreference } from "@/lib/theme";
import type { ThemeScheduleConfig } from "@/lib/themeSchedule";
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
  trayBusyBadge?: boolean;
  onTrayBusyBadge?: (v: boolean) => void;
  trayBusyCount?: number;
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
  onVoiceKeepAgentsOnEnd?: (v: boolean) => void;
  storeApiKeysInKeychain?: boolean;
  onStoreApiKeysInKeychain?: (v: boolean) => void;
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
  /** Catch-all for local state / setters section components consume. */
  [key: string]: unknown;
};

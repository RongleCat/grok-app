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
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
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
  IconPuzzle,
  IconSearch,
  IconSettings,
  IconShield,
  IconTrash,
  IconUser,
} from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import {
  detectShortcutPlatform,
  shortcutsByGroup,
  type ShortcutGroup,
} from "@/lib/shortcuts";
import type { Theme, ThemePreference } from "@/lib/theme";
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
  CHAT_DENSITIES,
  applyChatDensity,
  loadChatDensity,
  saveChatDensity,
  type ChatDensity,
} from "@/lib/chatDensity";
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
import { AccountPanel } from "@/components/AccountPanel";
import { ProvidersPanel } from "@/components/ProvidersPanel";
import { ExtensionsPanel } from "@/components/ExtensionsPanel";
import { ProjectInspectPanel } from "@/components/ProjectInspectPanel";
import { PermissionRulesPanel } from "@/components/PermissionRulesPanel";
import { ManagedSetupPanel } from "@/components/ManagedSetupPanel";
import { GlassModal } from "@/components/GlassModal";
import { RemoteImLayout } from "@/components/RemoteImLayout";
import { MirrorConnectPanel } from "@/components/MirrorConnectPanel";
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
  loadCodeWrapPref,
  saveCodeWrapPref,
} from "@/lib/codeWrapPref";
import {
  loadConfirmExternalLinksPref,
  saveConfirmExternalLinksPref,
} from "@/lib/externalLinkPref";
import {
  loadNotifyQuietHoursPref,
  normalizeHHmm,
  saveNotifyQuietHoursPref,
  type NotifyQuietHoursPref,
} from "@/lib/notifyQuietHours";
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
  locale: string;
  onLocale: (v: string) => void;
  /** Resolved light/dark currently applied (for display-only consumers). */
  theme: Theme;
  /** User preference including "system" (drives the appearance segment). */
  themePreference?: ThemePreference;
  onTheme: (v: ThemePreference) => void;
  /** Show message timestamps in chat action rows (localStorage). */
  showMessageTimestamps?: boolean;
  onShowMessageTimestamps?: (v: boolean) => void;
  /** Absolute vs relative message time labels (localStorage). */
  messageTimeFormat?: MessageTimeFormat;
  onMessageTimeFormat?: (v: MessageTimeFormat) => void;
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
  /** After importing CLI sessions (shared mode) — refresh sidebar. */
  onCliSessionsImported?: () => void;
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
  /** Idle recycle minutes (I03). */
  agentIdleMinutes?: number;
  onAgentIdleMinutes?: (v: number) => void;
  /** Stream stall silence timeout seconds (I06). */
  streamStallSeconds?: number;
  onStreamStallSeconds?: (v: number) => void;
  /** Cap agent turns per process (`grok --max-turns`). 0/undefined = unlimited. */
  maxAgentTurns?: number;
  onMaxAgentTurns?: (v: number) => void;
  /** Preferred agent definition name for spawn (`""` = CLI default). */
  preferredAgent?: string;
  onPreferredAgent?: (v: string) => void;
  /** Catalog rows for preferred-agent select. */
  agentCatalog?: Array<{ name: string; source: string }>;
  /** Cross-session memory toggle. */
  experimentalMemory?: boolean;
  onExperimentalMemory?: (v: boolean) => void;
  disableWebSearch?: boolean;
  onDisableWebSearch?: (v: boolean) => void;
  reopenLastSession?: boolean;
  onReopenLastSession?: (v: boolean) => void;
  closeToTray?: boolean;
  onCloseToTray?: (v: boolean) => void;
  /** Desktop notification when an agent turn finishes (default on). */
  notifyOnTurnDone?: boolean;
  onNotifyOnTurnDone?: (v: boolean) => void;
  /** Desktop notification when the agent requests permission (default on). */
  notifyOnPermission?: boolean;
  onNotifyOnPermission?: (v: boolean) => void;
  planEnabled?: boolean;
  onPlanEnabled?: (v: boolean) => void;
  subagentsEnabled?: boolean;
  onSubagentsEnabled?: (v: boolean) => void;
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
  onProviderActivated?: () => void;
  /** Archived chats grouped by project (settings → archived). */
  archivedGroups?: ArchivedProjectGroup[];
  /** Restore one or more archived sessions (ids). */
  onRestoreArchivedSessions?: (ids: string[]) => void;
  /** Delete one or more archived sessions after confirm (ids). */
  onDeleteArchivedSessions?: (ids: string[]) => void;
  /** Active project path for Skills/MCP inspect cwd. */
  projectPath?: string | null;
  /** After skill enable toggle — refresh slash palette in App. */
  onSkillsPrefsChanged?: () => void;
  /** Open the same shortcuts help modal as ⌘/ / Ctrl+/. */
  onOpenShortcutsHelp?: () => void;
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
  const [result, setResult] = useState<api.NetworkProbeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runTest = async () => {
    if (!api.isTauri()) return;
    setTesting(true);
    setResult(null);
    setError(null);
    try {
      setResult(await api.networkProbe());
    } catch (e) {
      setError(String(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="settings-row settings-row--stack">
      <div className="settings-row__text">
        <div className="settings-row__label">{t("settings.netProbe")}</div>
        <div className="settings-row__desc">{t("settings.netProbeDesc")}</div>
      </div>
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
        </div>
        {error ? (
          <div className="settings-row__hint is-danger" role="alert">
            {error}
          </div>
        ) : null}
        {result ? (
          <ul className="settings-netprobe__list" role="list">
            {result.targets.map((tg) => (
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
                <span className="settings-netprobe__meta">
                  {tg.ok
                    ? `${tg.status ?? ""} · ${tg.millis}ms`
                    : tg.error || t("settings.netProbeFailed")}
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
 * ACP API-mode field with Test + server-side setup one-liner (from PR #23).
 * Remote agents may run anywhere — verify reachability instead of auto-start.
 */
function AcpServerField({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  t: (k: string, vars?: Vars) => string;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<api.AcpProbeResult | null>(null);
  const [copied, setCopied] = useState(false);
  const addr = value.trim();
  const port = (addr.split(":")[1] || "").replace(/[^0-9]/g, "") || "8799";
  const setupCmd = `socat TCP-LISTEN:${port},reuseaddr,fork EXEC:'grok agent --no-leader stdio'`;

  const runTest = async () => {
    if (!addr || !api.isTauri()) return;
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.acpTestConnection(addr));
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
      <div className="settings-acp-field">
        <input
          className="settings-input"
          value={value}
          placeholder="e.g. 127.0.0.1:8799"
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="btn btn--ghost"
          disabled={!addr || testing}
          onClick={() => void runTest()}
        >
          {testing ? t("settings.acpTesting") : t("settings.acpTest")}
        </button>
      </div>
      {result ? (
        <div
          className={
            "settings-row__hint" + (result.ok ? "" : " is-danger")
          }
        >
          {result.ok
            ? t("settings.acpTestOk", {
                version: result.agentVersion || "?",
                model: result.model || "?",
              })
            : t("settings.acpTestFail", {
                error: result.error || "unknown",
              })}
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
      ) : null}
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
  onLocale,
  theme,
  themePreference: themePreferenceProp,
  onTheme,
  showMessageTimestamps = true,
  onShowMessageTimestamps,
  messageTimeFormat = "absolute",
  onMessageTimeFormat,
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
  proxyMode = "system",
  onProxyMode,
  proxyUrl = "",
  onProxyUrl,
  proxyNoProxy = "",
  onProxyNoProxy,
  maxConcurrentAgents = 8,
  onMaxConcurrentAgents,
  agentIdleMinutes = 30,
  onAgentIdleMinutes,
  streamStallSeconds = 180,
  onStreamStallSeconds,
  storeApiKeysInKeychain = false,
  onStoreApiKeysInKeychain,
  sandboxProfile = "off",
  onSandboxProfile,
  maxAgentTurns = 0,
  onMaxAgentTurns,
  preferredAgent = "",
  onPreferredAgent,
  agentCatalog = [],
  experimentalMemory = false,
  onExperimentalMemory,
  subagentsEnabled = true,
  onSubagentsEnabled,
  planEnabled = true,
  onPlanEnabled,
  disableWebSearch = false,
  onDisableWebSearch,
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
  notifyOnTurnDone = true,
  onNotifyOnTurnDone,
  notifyOnPermission = true,
  onNotifyOnPermission,
  cliInfo,
  onDoctor,
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
  onProviderActivated,
  archivedGroups = [],
  onRestoreArchivedSessions,
  onDeleteArchivedSessions,
  projectPath = null,
  onSkillsPrefsChanged,
  onOpenShortcutsHelp,
  trustedProjects = [],
}: SettingsPageProps) {
  const [query, setQuery] = useState("");
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
  /**
   * Phone drill-down: "index" = section list only; "detail" = one section full-width.
   * Always start on the index so opening 設定 never lands on a squeezed two-column pane.
   */
  const [phonePane, setPhonePane] = useState<"index" | "detail">("index");
  const [editors, setEditors] = useState<DetectedEditor[]>([]);
  const [clearMemoryOpen, setClearMemoryOpen] = useState(false);
  const [clearMemoryBusy, setClearMemoryBusy] = useState(false);
  const [settingsToast, setSettingsToast] = useState<string | null>(null);
  /** Phone-mirror stop confirm (settings → remote control → mirror tab). */
  const [mirrorStopConfirm, setMirrorStopConfirm] = useState<{
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
  /** Chat code-block wrap default — frontend-only localStorage. */
  const [codeWrapDefault, setCodeWrapDefault] = useState(() =>
    loadCodeWrapPref(),
  );
  /** Chat code-block line numbers — frontend-only localStorage. */
  const [codeLineNumbers, setCodeLineNumbers] = useState(() =>
    loadCodeLineNumbersPref(),
  );
  const [confirmExternalLinks, setConfirmExternalLinks] = useState(() =>
    loadConfirmExternalLinksPref(),
  );
  /** Desktop notification quiet hours — localStorage only. */
  const [notifyQuietHours, setNotifyQuietHours] =
    useState<NotifyQuietHoursPref>(() => loadNotifyQuietHoursPref());
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
  const tr = useMemo(() => createT(resolveLocale(locale)), [locale]);
  const t = useCallback(
    (k: string, vars?: Vars) => tr(k as MessageKey, vars),
    [tr],
  );
  /** Segment selection: prefer explicit preference; fall back to resolved theme. */
  const themePreference: ThemePreference =
    themePreferenceProp ?? theme;

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
      showSettingsToast(t("settings.clearWorkspaceMemoryDone"), 3500);
    } catch (e) {
      showSettingsToast(String(e), 4500);
    } finally {
      setClearMemoryBusy(false);
    }
  }, [workspaceCwd, clearMemoryBusy, showSettingsToast, t]);

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

  // Scroll + brief highlight after tab/section paint.
  useEffect(() => {
    const anchor = pendingAnchorRef.current;
    if (!anchor) return;
    pendingAnchorRef.current = null;
    const timer = window.setTimeout(() => {
      const el = document.getElementById(anchor);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setHighlightAnchor(anchor);
      window.setTimeout(() => setHighlightAnchor(null), 1600);
    }, 60);
    return () => window.clearTimeout(timer);
  }, [section, activeTab]);

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
  const pageClass =
    "settings-page" +
    (phoneIndex ? " settings-page--phone-index" : "") +
    (phoneDetail ? " settings-page--phone-detail" : "");

  const renderNavItem = (n: (typeof SETTINGS_NAV)[number]) => (
    <button
      key={n.id}
      type="button"
      className={
        "settings-page__nav-item" +
        (section === n.id && !phoneIndex ? " is-active" : "")
      }
      onClick={() => openSection(n.id)}
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
        className="settings-page__content"
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
      <main className="settings-page__main">
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
                          dont_ask: "policy.dont_ask",
                          always_approve: "policy.always_approve",
                        } as const
                      )[p.id],
                    ),
                  }))}
                />
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
                    options={[
                      {
                        value: "off",
                        label: t("settings.sandbox.off"),
                      },
                      {
                        value: "workspace",
                        label: t("settings.sandbox.workspace"),
                      },
                      {
                        value: "read-only",
                        label: t("settings.sandbox.readOnly"),
                      },
                      {
                        value: "strict",
                        label: t("settings.sandbox.strict"),
                      },
                      {
                        value: "devbox",
                        label: t("settings.sandbox.devbox"),
                      },
                    ]}
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
            </div>
            </>
            )}

            {activeTab === "app" && (
            <>
            <h2 className="settings-page__h2">{t("settings.section.voice")}</h2>
            <div className="settings-card" id="settings-voice-card">
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
                  value={locale}
                  onChange={onLocale}
                  options={[
                    { value: "zh", label: "简体中文" },
                    { value: "zh-TW", label: "繁體中文" },
                    { value: "en", label: "English" },
                  ]}
                />
              </div>
              <div
                className={"settings-row" + rowHighlight("settings-anchor-sessionDataMode")}
                id="settings-anchor-sessionDataMode"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.sessionDataMode")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.sessionDataModeDesc")}
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
              <p className="settings-page__hint">{t("settings.sessionModeHelp")}</p>
              {sessionDataMode === "shared" ? (
                <CliSessionsPanel
                  t={t}
                  onImported={onCliSessionsImported}
                />
              ) : null}
              {onStoreApiKeysInKeychain ? (
                <div
                  className={"settings-row" + rowHighlight("settings-anchor-keychain")}
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
                <div className="settings-row">
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
                                void onWallpaperFile(e.target.files?.[0]);
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
              </div>
              {activeTab === "providers" ? (
                <p className="settings-account-tabs__hint">
                  {t("settings.tabProvidersHint")}
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
                onProviderActivated={onProviderActivated}
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
                      hint: t("mirror.connectHint"),
                      warningToken: t("mirror.warningToken"),
                      missingCloudflared: t("mirror.missingCloudflared"),
                      errorGeneric: t("mirror.errorGeneric"),
                      qrAlt: t("mirror.qrAlt"),
                      linkLabel: t("mirror.linkLabel"),
                      rotate: t("mirror.rotate"),
                      rotateDone: t("mirror.rotateDone"),
                      allowWrite: t("mirror.allowWrite"),
                      readOnlyOn: t("mirror.readOnlyOn"),
                      readOnlyHint: t("mirror.readOnlyHint"),
                    }}
                    onConfirmStop={(opts) => setMirrorStopConfirm(opts)}
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
              </div>
            )}
            {activeTab === "connection" && (
              <div
                className={"settings-card" + rowHighlight("settings-anchor-acpServer")}
                id="settings-anchor-acpServer"
              >
                <AcpServerField
                  value={acpServerAddr}
                  onChange={onAcpServerAddr}
                  t={t}
                />
              </div>
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
                    value={proxyMode}
                    onChange={(v) => onProxyMode?.(v)}
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
                  <div className="settings-row__hint">
                    {t("settings.proxyRestartHint")}
                  </div>
                </div>
                {proxyMode === "manual" && (
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
                      <input
                        className="settings-input"
                        value={proxyUrl}
                        placeholder="http://127.0.0.1:7890"
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(e) => onProxyUrl?.(e.target.value)}
                      />
                      {proxyUrl.trim() !== "" &&
                        !/^(https?|socks5h?):\/\/[^\s]+$/i.test(
                          proxyUrl.trim(),
                        ) && (
                          <div
                            className="settings-row__hint is-danger"
                            role="alert"
                          >
                            {t("settings.proxyUrlInvalid")}
                          </div>
                        )}
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
              </div>
            )}
            {activeTab === "tools" && (
              <>
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
          </div>
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
        open={!!mirrorStopConfirm}
        onClose={() => setMirrorStopConfirm(null)}
        title={mirrorStopConfirm?.title ?? t("mirror.stopConfirmTitle")}
        size="sm"
        closeLabel={t("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setMirrorStopConfirm(null)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                const action = mirrorStopConfirm?.onConfirm;
                setMirrorStopConfirm(null);
                action?.();
              }}
            >
              {mirrorStopConfirm?.confirmLabel ?? t("mirror.stopConfirmOk")}
            </button>
          </>
        }
      >
        <p className="settings-row__desc" style={{ margin: 0 }}>
          {mirrorStopConfirm?.message ?? t("mirror.stopConfirmMessage")}
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
  const platform = useMemo(() => detectShortcutPlatform(), []);
  const groups = useMemo(() => shortcutsByGroup(), []);

  const groupLabel = (g: ShortcutGroup) =>
    t(`settings.shortcuts.group.${g}` as MessageKey);

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
        {onOpenHelp ? (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => onOpenHelp()}
          >
            {t("settings.shortcuts.openHelp")}
          </button>
        ) : null}
      </div>
      {groups.map(({ group, rows }) => (
        <div key={group} className="settings-shortcuts-group">
          <div className="settings-shortcuts-group__title">{groupLabel(group)}</div>
          <table className="settings-shortcuts-table">
            <thead>
              <tr>
                <th scope="col">{t("settings.shortcuts.colAction")}</th>
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
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{t(row.labelKey as MessageKey)}</td>
                  <td>
                    <kbd className="settings-shortcuts-kbd">{row.mac}</kbd>
                  </td>
                  <td>
                    <kbd className="settings-shortcuts-kbd">{row.win}</kbd>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <p className="settings-shortcuts-note">{t("settings.shortcuts.note")}</p>
    </div>
  );
}

/** Shared-mode: list / import Grok Build CLI sessions from GROK_HOME. */
function CliSessionsPanel({
  t,
  onImported,
}: {
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  onImported?: () => void;
}) {
  const [rows, setRows] = useState<api.CliSessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!api.isTauri()) return;
    setLoading(true);
    setError(null);
    try {
      const list = await api.cliSessionsList();
      setRows(list);
    } catch (e) {
      setError(String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const importOne = async (row: api.CliSessionSummary) => {
    setBusyId(row.agentSessionId);
    setError(null);
    setStatus(null);
    try {
      await api.cliSessionImport(row.agentSessionId, { dir: row.dir });
      setStatus(t("settings.cliSessionsImportedOne", { title: row.title }));
      await refresh();
      onImported?.();
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

  const pending = rows.filter((r) => !r.alreadyLinked).length;

  return (
    <div className="settings-row settings-row--stack">
      <div className="settings-row__text">
        <div className="settings-row__label">{t("settings.cliSessions")}</div>
        <div className="settings-row__desc">{t("settings.cliSessionsDesc")}</div>
      </div>
      <div className="settings-cli-sessions">
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
        </div>
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
        {loading && rows.length === 0 ? (
          <div className="settings-cli-sessions__empty">
            {t("settings.cliSessionsLoading")}
          </div>
        ) : rows.length === 0 ? (
          <div className="settings-cli-sessions__empty">
            {t("settings.cliSessionsEmpty")}
          </div>
        ) : (
          <ul className="settings-cli-sessions__list">
            {rows.slice(0, 40).map((r) => (
              <li key={r.agentSessionId} className="settings-cli-sessions__item">
                <div className="settings-cli-sessions__meta">
                  <div className="settings-cli-sessions__title">{r.title}</div>
                  <div className="settings-cli-sessions__sub">
                    {r.cwd || r.agentSessionId.slice(0, 12)}
                    {r.numMessages
                      ? ` · ${t("settings.cliSessionsMsgs", { n: String(r.numMessages) })}`
                      : ""}
                  </div>
                </div>
                {r.alreadyLinked ? (
                  <span className="settings-cli-sessions__badge">
                    {t("settings.cliSessionsLinked")}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={!!busyId}
                    onClick={() => void importOne(r)}
                  >
                    {busyId === r.agentSessionId
                      ? t("settings.cliSessionsImporting")
                      : t("settings.cliSessionsImport")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
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

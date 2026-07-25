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
  IconDoctor,
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
import {
  detectShortcutPlatform,
  shortcutsByGroup,
  type ShortcutGroup,
} from "@/lib/shortcuts";
import type { Theme } from "@/lib/theme";
import {
  THEME_SKINS,
  WALLPAPER_ACCEPT,
  WallpaperPrepareError,
  prepareWallpaperFromFile,
  type ThemeSkinId,
  type WallpaperKind,
  type WallpaperRecord,
} from "@/lib/themeSkin";
import type {
  ComposerPrefsScope,
  ModelOption,
  PermissionPolicyId,
} from "@/lib/grokCatalog";
import {
  COMPOSER_PREFS_SCOPES,
  PERMISSION_POLICIES,
} from "@/lib/grokCatalog";
import type { AccountStatus, DetectedEditor } from "@/lib/api";
import * as api from "@/lib/api";
import { AccountPanel } from "@/components/AccountPanel";
import { ProvidersPanel } from "@/components/ProvidersPanel";
import { ExtensionsPanel } from "@/components/ExtensionsPanel";
import { ProjectInspectPanel } from "@/components/ProjectInspectPanel";
import { RemoteImLayout } from "@/components/RemoteImLayout";
import {
  createT,
  resolveLocale,
  type MessageKey,
  type Vars,
} from "@/i18n";

export type SettingsSectionId =
  | "general"
  | "appearance"
  | "account"
  | "archived"
  | "extensions"
  | "remote_im"
  | "runtime"
  | "shortcuts"
  | "about";

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
  onSection: (id: SettingsSectionId) => void;
  onBack: () => void;
  labels: Record<string, string>;
  locale: string;
  onLocale: (v: string) => void;
  theme: Theme;
  onTheme: (v: Theme) => void;
  /** Color skin pack on top of light/dark (optional for older callers). */
  skin?: ThemeSkinId;
  onSkin?: (v: ThemeSkinId) => void;
  /** Custom wallpaper blob: URL (null/undefined = none). */
  wallpaperUrl?: string | null;
  /** Kind of the current wallpaper, to pick <video> vs <img> in the preview. */
  wallpaperKind?: WallpaperKind | null;
  onWallpaper?: (record: WallpaperRecord | null) => void | Promise<void>;
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
  /** API mode: remote ACP server `host:port` (empty = local CLI spawn). */
  acpServerAddr: string;
  onAcpServerAddr: (v: string) => void;
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
  planEnabled?: boolean;
  onPlanEnabled?: (v: boolean) => void;
  subagentsEnabled?: boolean;
  onSubagentsEnabled?: (v: boolean) => void;
  useLeader?: boolean;
  onUseLeader?: (v: boolean) => void;
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

const NAV: {
  id: SettingsSectionId;
  icon:
    | "settings"
    | "appearance"
    | "user"
    | "archive"
    | "extensions"
    | "remote_im"
    | "doctor"
    | "keyboard"
    | "info";
  labelKey: string;
  group: "personal" | "system";
}[] = [
  { id: "general", icon: "settings", labelKey: "settings.nav.general", group: "personal" },
  { id: "appearance", icon: "appearance", labelKey: "settings.nav.appearance", group: "personal" },
  { id: "account", icon: "user", labelKey: "settings.nav.account", group: "personal" },
  { id: "archived", icon: "archive", labelKey: "settings.nav.archived", group: "personal" },
  {
    id: "extensions",
    icon: "extensions",
    labelKey: "settings.nav.extensions",
    group: "system",
  },
  {
    id: "remote_im",
    icon: "remote_im",
    labelKey: "settings.nav.remoteIm",
    group: "system",
  },
  { id: "runtime", icon: "doctor", labelKey: "settings.nav.runtime", group: "system" },
  {
    id: "shortcuts",
    icon: "keyboard",
    labelKey: "settings.nav.shortcuts",
    group: "system",
  },
  { id: "about", icon: "info", labelKey: "settings.nav.about", group: "system" },
];

function NavIcon({
  name,
  size = 18,
}: {
  name: (typeof NAV)[number]["icon"];
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

export function SettingsPage({
  section,
  onSection,
  onBack,
  labels: _legacyLabels,
  locale,
  onLocale,
  theme,
  onTheme,
  skin = "default",
  onSkin,
  wallpaperUrl = null,
  wallpaperKind = null,
  wallpaperScrim = 100,
  onWallpaperScrim,
  onWallpaper,
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
  acpServerAddr,
  onAcpServerAddr,
  maxConcurrentAgents = 3,
  onMaxConcurrentAgents,
  agentIdleMinutes = 30,
  onAgentIdleMinutes,
  streamStallSeconds = 120,
  onStreamStallSeconds,
  storeApiKeysInKeychain = false,
  onStoreApiKeysInKeychain,
  sandboxProfile = "off",
  onSandboxProfile,
  planEnabled = true,
  onPlanEnabled,
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
  const [accountTab, setAccountTab] = useState<"official" | "providers">(
    "official",
  );
  const [editors, setEditors] = useState<DetectedEditor[]>([]);
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

  const nav = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NAV;
    return NAV.filter((n) => t(n.labelKey).toLowerCase().includes(q));
  }, [query, t]);

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

  const title =
    section === "general"
      ? t("settings.nav.general")
      : section === "appearance"
        ? t("settings.nav.appearance")
        : section === "account"
          ? t("settings.nav.account")
          : section === "archived"
            ? t("settings.nav.archived")
            : section === "extensions"
              ? t("settings.nav.extensions")
              : section === "remote_im"
                ? t("settings.nav.remoteIm")
                : section === "runtime"
                  ? t("settings.nav.runtime")
                  : section === "shortcuts"
                    ? t("settings.nav.shortcuts")
                    : t("settings.nav.about");

  return (
    <div className="settings-page" data-testid="settings-page">
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
      <aside className="settings-page__nav">
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
          />
        </div>

        <div className="settings-page__group-label">
          {t("settings.group.personal")}
        </div>
        {nav
          .filter((n) => n.group === "personal")
          .map((n) => (
            <button
              key={n.id}
              type="button"
              className={
                "settings-page__nav-item" +
                (section === n.id ? " is-active" : "")
              }
              onClick={() => onSection(n.id)}
            >
              <NavIcon name={n.icon} />
              <span>{t(n.labelKey)}</span>
            </button>
          ))}

        <div className="settings-page__group-label">
          {t("settings.group.system")}
        </div>
        {nav
          .filter((n) => n.group === "system")
          .map((n) => (
            <button
              key={n.id}
              type="button"
              className={
                "settings-page__nav-item" +
                (section === n.id ? " is-active" : "")
              }
              onClick={() => onSection(n.id)}
            >
              <NavIcon name={n.icon} />
              <span>{t(n.labelKey)}</span>
            </button>
          ))}
        </div>
      </aside>

      <div className="settings-page__content">
      <main
        className={
          "settings-page__main" +
          (section === "remote_im" ? " settings-page__main--remote-im" : "")
        }
      >
        <h1 className="settings-page__title">{title}</h1>

        {section === "general" && (
          <>
            <h2 className="settings-page__h2">{t("settings.section.composer")}</h2>
            <div className="settings-card">
              {onPrefsScope && (
                <div className="settings-row settings-row--stack">
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
              <div className="settings-row settings-row--stack">
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
            </div>

            <h2 className="settings-page__h2">{t("settings.section.permissions")}</h2>
            <div className="settings-card">
              <div className="settings-row settings-row--stack">
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
                <div className="settings-row settings-row--stack">
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
            </div>

                        <h2 className="settings-page__h2">{t("settings.section.agent")}</h2>
            <div className="settings-card" id="settings-agent-card">
              {onPlanEnabled ? (
                <div className="settings-row">
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
            </div>

<h2 className="settings-page__h2">{t("settings.section.general")}</h2>
            <div className="settings-card">
              <div className="settings-row">
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
              <div className="settings-row">
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
              {sessionDataMode === "shared" ? (
                <CliSessionsPanel
                  t={t}
                  onImported={onCliSessionsImported}
                />
              ) : null}
              {onStoreApiKeysInKeychain ? (
                <div className="settings-row">
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
              {onDefaultOpenTarget && (
                <div className="settings-row">
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

        {section === "appearance" && (
          <>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    <IconAppearance size={16} />
                    {t("settings.theme")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.themeDesc")}
                  </div>
                </div>
                <div className="settings-seg">
                  <button
                    type="button"
                    className={
                      "settings-seg__btn" + (theme === "light" ? " is-on" : "")
                    }
                    onClick={() => onTheme("light")}
                  >
                    {t("settings.themeLight")}
                  </button>
                  <button
                    type="button"
                    className={
                      "settings-seg__btn" + (theme === "dark" ? " is-on" : "")
                    }
                    onClick={() => onTheme("dark")}
                  >
                    {t("settings.themeDark")}
                  </button>
                </div>
              </div>
            </div>
            {onSkin ? (
              <div className="settings-card">
                <div className="settings-row settings-row--stack">
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.skin")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.skinDesc")}
                    </div>
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
                            "settings-skin-card" + (selected ? " is-on" : "")
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
              <div className="settings-card">
                <div className="settings-row settings-row--stack">
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.wallpaper")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.wallpaperDesc")}
                    </div>
                  </div>
                  <div className="settings-wallpaper">
                    <div className="settings-wallpaper__preview">
                      {wallpaperUrl ? (
                        wallpaperKind === "video" ? (
                          <video
                            src={wallpaperUrl}
                            muted
                            loop
                            autoPlay
                            playsInline
                            preload="metadata"
                          />
                        ) : (
                          <img src={wallpaperUrl} alt="" />
                        )
                      ) : (
                        <div className="settings-wallpaper__preview-empty">
                          {t("settings.wallpaperEmpty")}
                        </div>
                      )}
                    </div>
                    <div className="settings-wallpaper__actions">
                      <input
                        ref={wallpaperInputRef}
                        type="file"
                        accept={WALLPAPER_ACCEPT}
                        hidden
                        onChange={(e) => {
                          void onWallpaperFile(e.target.files?.[0]);
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn--solid btn--sm"
                        disabled={wallpaperBusy}
                        onClick={() => wallpaperInputRef.current?.click()}
                      >
                        {wallpaperBusy
                          ? t("settings.wallpaperWorking")
                          : wallpaperUrl
                            ? t("settings.wallpaperReplace")
                            : t("settings.wallpaperUpload")}
                      </button>
                      <button
                        type="button"
                        className="btn btn--solid btn--sm"
                        onClick={() => {
                          void (async () => {
                            try {
                              if (api.isTauri()) {
                                await api.openExternalUrl(
                                  "https://haowallpaper.com/",
                                );
                                return;
                              }
                            } catch {
                              /* fall through */
                            }
                            window.open(
                              "https://haowallpaper.com/",
                              "_blank",
                              "noopener,noreferrer",
                            );
                          })();
                        }}
                      >
                        {t("settings.wallpaperFind")}
                      </button>
                      {wallpaperUrl ? (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={wallpaperBusy}
                          onClick={() => {
                            setWallpaperError(null);
                            void onWallpaper(null);
                          }}
                        >
                          {t("settings.wallpaperClear")}
                        </button>
                      ) : null}
                    </div>
                    {wallpaperUrl && onWallpaperScrim ? (
                      <div className="settings-wallpaper__scrim">
                        <div className="settings-wallpaper__scrim-head">
                          <label
                            className="settings-wallpaper__scrim-label"
                            htmlFor="settings-wallpaper-scrim"
                          >
                            {t("settings.wallpaperScrim")}
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
                        <p className="settings-wallpaper__scrim-hint">
                          {t("settings.wallpaperScrimDesc")}
                        </p>
                      </div>
                    ) : null}
                    {wallpaperError ? (
                      <p className="settings-wallpaper__error" role="alert">
                        {wallpaperError}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}

        {section === "account" && (
          <>
            <div className="settings-account-tabs" role="tablist">
              <div className="settings-seg settings-seg--lg" role="presentation">
                <button
                  type="button"
                  role="tab"
                  className={
                    "settings-seg__btn" +
                    (accountTab === "official" ? " is-on" : "")
                  }
                  aria-selected={accountTab === "official"}
                  onClick={() => setAccountTab("official")}
                >
                  {t("settings.tabOfficial")}
                </button>
                <button
                  type="button"
                  role="tab"
                  className={
                    "settings-seg__btn" +
                    (accountTab === "providers" ? " is-on" : "")
                  }
                  aria-selected={accountTab === "providers"}
                  onClick={() => setAccountTab("providers")}
                >
                  {t("settings.tabProviders")}
                </button>
              </div>
              {accountTab === "official" ? (
                <p className="settings-account-tabs__hint">
                  {t("settings.tabOfficialHint")}
                </p>
              ) : null}
            </div>
            {accountTab === "providers" ? (
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
          <>
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
          </>
        )}

        {section === "extensions" && (
          <ExtensionsPanel
            locale={resolveLocale(locale)}
            projectPath={projectPath}
            cliFound={cliInfo.found}
            onOpenRuntime={() => onSection("runtime")}
            onSkillsPrefsChanged={onSkillsPrefsChanged}
          />
        )}

        {section === "remote_im" && (
          <div className="settings-remote-im-shell">
            <RemoteImLayout
              locale={locale}
              trustedProjects={trustedProjects}
            />
          </div>
        )}

        {section === "runtime" && (
          <div className="settings-card">
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
                </div>
              )}
            </div>
            <AcpServerField
              value={acpServerAddr}
              onChange={onAcpServerAddr}
              t={t}
            />
            <div className="settings-row settings-row--stack">
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
                max={8}
                step={1}
                value={maxConcurrentAgents}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return;
                  onMaxConcurrentAgents?.(Math.min(8, Math.max(1, Math.round(n))));
                }}
              />
            </div>
            <div className="settings-row settings-row--stack">
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
            <div className="settings-row settings-row--stack">
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
            <div className="settings-card settings-card--nested pi-settings-block">
              <ProjectInspectPanel
                locale={resolveLocale(locale)}
                projectPath={projectPath}
                cliFound={cliInfo.found}
              />
            </div>
          </div>
        )}

        {section === "shortcuts" && (
          <ShortcutsSettingsPanel
            t={t}
            onOpenHelp={onOpenShortcutsHelp}
          />
        )}

        {section === "about" && (
          <div className="settings-card">
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<api.AppUpdateCheck | null>(null);

  const check = async () => {
    if (!api.isTauri()) {
      setError("not in Tauri");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.appCheckUpdate();
      setResult(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const openRelease = async (url: string) => {
    try {
      await api.openExternalUrl(url);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="settings-row settings-row--stack">
      <div className="settings-row__text">
        <div className="settings-row__label">{t("settings.checkUpdate")}</div>
        <div className="settings-row__desc">{t("settings.checkUpdateDesc")}</div>
      </div>
      <div className="settings-about-update">
        <div className="settings-about-update__actions">
          <button
            type="button"
            className="btn btn--solid"
            disabled={busy}
            onClick={() => void check()}
          >
            {busy
              ? t("settings.checkUpdateChecking")
              : t("settings.checkUpdate")}
          </button>
          {result?.updateAvailable ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => void openRelease(result.htmlUrl)}
            >
              {t("settings.checkUpdateOpen")}
            </button>
          ) : null}
        </div>
        {error ? (
          <div className="settings-about-update__err" role="alert">
            {t("settings.checkUpdateFailed", { error })}
          </div>
        ) : null}
        {result && !error ? (
          <div
            className={
              "settings-about-update__status" +
              (result.updateAvailable ? " is-available" : "")
            }
            role="status"
          >
            {result.updateAvailable
              ? t("settings.checkUpdateAvailable", {
                  latest: result.latestVersion,
                  current: result.currentVersion,
                })
              : t("settings.checkUpdateLatest", {
                  version: result.currentVersion,
                })}
          </div>
        ) : null}
        {result?.updateAvailable && result.assetNames.length > 0 ? (
          <div className="settings-about-update__assets">
            {result.assetNames.slice(0, 6).join(" · ")}
          </div>
        ) : null}
      </div>
    </div>
  );
}

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
  IconDoctor,
  IconInfo,
  IconLanguage,
  IconMinimize,
  IconPuzzle,
  IconSearch,
  IconSettings,
  IconShield,
  IconTrash,
  IconUser,
} from "@/components/icons";
import type { Theme } from "@/lib/theme";
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
import { resolveLocale } from "@/i18n";

export type SettingsSectionId =
  | "general"
  | "appearance"
  | "account"
  | "archived"
  | "extensions"
  | "runtime"
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
  sessionDataMode: string;
  onSessionDataMode: (v: string) => void;
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
}

const NAV: {
  id: SettingsSectionId;
  icon:
    | "settings"
    | "appearance"
    | "user"
    | "archive"
    | "extensions"
    | "doctor"
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
  { id: "runtime", icon: "doctor", labelKey: "settings.nav.runtime", group: "system" },
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
  if (name === "extensions") return <IconPuzzle size={size} />;
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
  labels,
  locale,
  onLocale,
  theme,
  onTheme,
  sessionDataMode,
  onSessionDataMode,
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
  const marqueeRef = useRef<{
    active: boolean;
    dragging: boolean;
    additive: boolean;
    base: Set<string>;
    box: MarqueeBox;
    pointerId: number;
  } | null>(null);
  const t = (k: string) => labels[k] ?? k;

  useEffect(() => {
    if (!api.isTauri()) return;
    void api.editorsList().then((r) => setEditors(r.editors ?? [])).catch(() => {});
  }, []);

  const nav = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NAV;
    return NAV.filter((n) => t(n.labelKey).toLowerCase().includes(q));
  }, [query, labels]);

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
              : section === "runtime"
                ? t("settings.nav.runtime")
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
      <main className="settings-page__main">
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
              importChat: t("account.importChat"),
              importChatHint: t("account.importChatHint"),
              importChatBtn: t("account.importChatBtn"),
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
            // Multi-account / import UI gated in AccountPanel (SHOW_ACCOUNT_EXTRAS).
            onSaveAccount={onSaveAccount}
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
                      ? t("settings.archived.selectedCount").replace(
                          "{n}",
                          String(archivedSelectedCount),
                        )
                      : t("settings.archived.totalCount").replace(
                          "{n}",
                          String(archivedTotal),
                        )}
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
          />
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
            <div className="settings-row settings-row--stack">
              <div className="settings-row__text">
                <div className="settings-row__label">
                  {t("settings.acpServer")}
                </div>
                <div className="settings-row__desc">
                  {t("settings.acpServerDesc")}
                </div>
              </div>
              <input
                className="settings-input"
                value={acpServerAddr}
                placeholder="e.g. 127.0.0.1:8799"
                onChange={(e) => onAcpServerAddr(e.target.value)}
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
          </div>
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
          </div>
        )}
      </main>
      </div>
    </div>
  );
}

/**
 * Settings → Extensions: Skills + MCP + Plugins.
 * Skills/MCP from `grok inspect` with enable toggles (extensions.json / ACP inject).
 * Plugins from `grok plugin list/install/update/…` (config.toml disabled list).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import { createT, type Locale, type MessageKey } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import {
  IconDoctor,
  IconExternalLink,
  IconFolder,
  IconPlus,
  IconPlug,
  IconPuzzle,
  IconRefresh,
  IconSkills,
  IconTrash,
} from "@/components/icons";
import {
  filterPluginsByLoadState,
  isCliMissingError,
  isExtensionEnabled,
  mcpMetaLine,
  mergeInspectErrors,
  normalizePluginInstallSource,
  pluginMetaLine,
  pluginProvidesLine,
  pluginRowKey,
  pluginStatusTone,
  shortPathLabel,
  skillMetaLine,
  skillSourceTone,
  sortMcpByName,
  sortPluginsByName,
  sortSkillsByName,
  type PluginFilter,
} from "@/lib/extensionsUi";
import {
  indexDoctorServerStatuses,
  lookupServerStatus,
  mcpAuthGuidanceKey,
  mcpStatusBadgeMod,
  mcpStatusLabelKey,
  redactMcpText,
  type McpServerStatus,
  type McpStatusIndex,
} from "@/lib/mcpStatus";
import { ExtensionsBuildExtras } from "@/components/ExtensionsBuildExtras";

export type ExtensionsTabId =
  | "plugins"
  | "skills"
  | "mcp"
  | "hooks"
  | "market";

export interface ExtensionsPanelProps {
  locale: Locale;
  /** Active workbench project path (inspect cwd). */
  projectPath?: string | null;
  /** Whether CLI probe found a binary (for empty-state copy). */
  cliFound?: boolean;
  /** Page tab from settings hash (`#/settings/extensions/{tab}`). */
  activeTab?: ExtensionsTabId;
  onTabChange?: (tab: ExtensionsTabId) => void;
  /** Navigate to Settings → Runtime when CLI is missing. */
  onOpenRuntime?: () => void;
  /** Fired after skill enable prefs change so slash palette can refresh. */
  onSkillsPrefsChanged?: () => void;
}

export function ExtensionsPanel({
  locale,
  projectPath = null,
  cliFound = true,
  activeTab = "plugins",
  onTabChange,
  onOpenRuntime,
  onSkillsPrefsChanged,
}: ExtensionsPanelProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [skills, setSkills] = useState<api.SkillDto[]>([]);
  const [servers, setServers] = useState<api.McpDto[]>([]);
  const [plugins, setPlugins] = useState<api.PluginDto[]>([]);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [pluginsError, setPluginsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [agentHome, setAgentHome] = useState<string | null>(null);
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [pathHint, setPathHint] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionErrorSource, setActionErrorSource] = useState<
    "plugin" | "mcp" | null
  >(null);
  const [uninstallTarget, setUninstallTarget] = useState<api.PluginDto | null>(
    null,
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsTitle, setDetailsTitle] = useState("");
  const [detailsBody, setDetailsBody] = useState("");
  const [detailsLoading, setDetailsLoading] = useState(false);
  /** Grok Build Plugins tab filter: all | enabled | disabled */
  const [pluginFilter, setPluginFilter] = useState<PluginFilter>("all");
  const [installSource, setInstallSource] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCommand, setAddCommand] = useState("");
  const [addArgs, setAddArgs] = useState("");
  const [addEnv, setAddEnv] = useState("");
  const [removeTarget, setRemoveTarget] = useState<api.McpDto | null>(null);
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [doctorLoading, setDoctorLoading] = useState(false);
  const [doctorReport, setDoctorReport] =
    useState<any>(null);
  const [doctorError, setDoctorError] = useState<string | null>(null);
  const [doctorFocus, setDoctorFocus] = useState<string | null>(null);
  /** Last successful doctor run (ms) — shown as lightweight timestamp. */
  const [doctorLastAt, setDoctorLastAt] = useState<number | null>(null);
  /**
   * Cumulative per-server status from doctor runs.
   * Focused doctor re-runs merge in so other servers keep their last tone.
   */
  const [doctorStatusIndex, setDoctorStatusIndex] = useState<McpStatusIndex>(
    () => new Map(),
  );
  /** In-app “How to refresh” guidance for auth-expired / auth-required. */
  const [authHelpTarget, setAuthHelpTarget] = useState<{
    name: string;
    status: McpServerStatus;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!api.isTauri()) {
      setSkills([]);
      setServers([]);
      setPlugins([]);
      setSkillsError(tr("ext.needTauri"));
      setMcpError(null);
      setPluginsError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setSkillsError(null);
    setMcpError(null);
    setPluginsError(null);
    setPathHint(null);
    const cwd = projectPath?.trim() || null;
    const [skillsRes, mcpRes, pluginsRes, providersRes] = await Promise.all([
      api.skillsList(cwd).catch((e) => ({
        skills: [] as api.SkillDto[],
        error: String(e),
      })),
      api.inspectMcp(cwd).catch((e) => ({
        servers: [] as api.McpDto[],
        error: String(e),
      })),
      api.pluginsList().catch((e) => ({
        plugins: [] as api.PluginDto[],
        error: String(e),
      })),
      api.providersList().catch(() => null),
    ]);
    setSkills(sortSkillsByName(skillsRes.skills ?? []));
    setServers(sortMcpByName(mcpRes.servers ?? []));
    setPlugins(sortPluginsByName(pluginsRes.plugins ?? []));
    setSkillsError(skillsRes.error?.trim() ? skillsRes.error : null);
    setMcpError(mcpRes.error?.trim() ? mcpRes.error : null);
    setPluginsError(pluginsRes.error?.trim() ? pluginsRes.error : null);
    if (providersRes) {
      setAgentHome(providersRes.agentHome?.trim() || null);
      setConfigPath(providersRes.configPath?.trim() || null);
    }
    setLoading(false);
  }, [projectPath, tr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const bannerError = useMemo(
    () => mergeInspectErrors(skillsError, mcpError, pluginsError),
    [skillsError, mcpError, pluginsError],
  );
  const cliMissing =
    !cliFound ||
    isCliMissingError(skillsError) ||
    isCliMissingError(mcpError) ||
    isCliMissingError(pluginsError);

  const scopeLabel = projectPath?.trim()
    ? tr("ext.scope.project")
    : tr("ext.scope.global");
  const scopePath = projectPath?.trim() || null;

  const mcpOffCount = useMemo(
    () => servers.filter((s) => !isExtensionEnabled(s.enabled)).length,
    [servers],
  );
  const skillsOffCount = useMemo(
    () => skills.filter((s) => !isExtensionEnabled(s.enabled)).length,
    [skills],
  );

  const reveal = async (path: string | null | undefined) => {
    const p = (path ?? "").trim();
    if (!p || !api.isTauri()) return;
    try {
      await api.pathReveal(p);
      setPathHint(null);
    } catch (e) {
      setPathHint(String(e));
    }
  };

  const toggleMcp = async (name: string, next: boolean) => {
    if (!api.isTauri() || busyKey) return;
    setBusyKey(`mcp:${name}`);
    setServers((prev) =>
      prev.map((s) => (s.name === name ? { ...s, enabled: next } : s)),
    );
    try {
      await api.extensionsSetMcp(name, next);
    } catch (e) {
      setPathHint(String(e));
      setServers((prev) =>
        prev.map((s) => (s.name === name ? { ...s, enabled: !next } : s)),
      );
    } finally {
      setBusyKey(null);
    }
  };

  const toggleSkill = async (name: string, next: boolean) => {
    if (!api.isTauri() || busyKey) return;
    setBusyKey(`skill:${name}`);
    setSkills((prev) =>
      prev.map((s) => (s.name === name ? { ...s, enabled: next } : s)),
    );
    try {
      await api.extensionsSetSkill(name, next);
      onSkillsPrefsChanged?.();
    } catch (e) {
      setPathHint(String(e));
      setSkills((prev) =>
        prev.map((s) => (s.name === name ? { ...s, enabled: !next } : s)),
      );
    } finally {
      setBusyKey(null);
    }
  };

  const enableAllMcp = async () => {
    if (!api.isTauri() || busyKey || servers.length === 0) return;
    setBusyKey("mcp:all");
    const names = servers.map((s) => s.name);
    setServers((prev) => prev.map((s) => ({ ...s, enabled: true })));
    try {
      await api.extensionsEnableAllMcp(names);
    } catch (e) {
      setPathHint(String(e));
      await refresh();
    } finally {
      setBusyKey(null);
    }
  };

  const enableAllSkills = async () => {
    if (!api.isTauri() || busyKey || skills.length === 0) return;
    setBusyKey("skill:all");
    const names = skills.map((s) => s.name);
    setSkills((prev) => prev.map((s) => ({ ...s, enabled: true })));
    try {
      await api.extensionsEnableAllSkills(names);
      onSkillsPrefsChanged?.();
    } catch (e) {
      setPathHint(String(e));
      await refresh();
    } finally {
      setBusyKey(null);
    }
  };

  const runPluginAction = async (
    key: string,
    action: () => Promise<unknown>,
  ) => {
    setActionBusy(key);
    setActionError(null);
    setActionErrorSource(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setActionError(String(e));
      setActionErrorSource("plugin");
    } finally {
      setActionBusy(null);
    }
  };

  const togglePlugin = (p: api.PluginDto) => {
    const key = pluginRowKey(p);
    void runPluginAction(key, async () => {
      if (p.enabled) {
        await api.pluginDisable(p.name);
      } else {
        await api.pluginEnable(p.name);
      }
    });
  };

  const confirmUninstall = async () => {
    const target = uninstallTarget;
    if (!target) return;
    const key = pluginRowKey(target);
    setUninstallTarget(null);
    await runPluginAction(key, async () => {
      await api.pluginUninstall(target.name);
    });
  };

  const installPlugin = async () => {
    if (!api.isTauri() || actionBusy || cliMissing) return;
    const source = normalizePluginInstallSource(installSource);
    if (!source) {
      setActionError(tr("ext.plugins.installEmpty"));
      return;
    }
    await runPluginAction("install", async () => {
      await api.pluginInstall(source);
      setInstallSource("");
    });
  };

  const updatePlugin = (p: api.PluginDto) => {
    const key = `update:${pluginRowKey(p)}`;
    void runPluginAction(key, async () => {
      await api.pluginUpdate(p.name);
    });
  };

  const updateAllPlugins = () => {
    if (!api.isTauri() || actionBusy || cliMissing || plugins.length === 0) {
      return;
    }
    void runPluginAction("update:all", async () => {
      await api.pluginUpdate(null);
    });
  };

  const showDetails = async (p: api.PluginDto) => {
    setDetailsTitle(p.name);
    setDetailsBody("");
    setDetailsOpen(true);
    setDetailsLoading(true);
    setActionError(null);
    try {
      const res = await api.pluginDetails(p.name);
      setDetailsBody(res.details?.trim() || tr("ext.plugins.detailsEmpty"));
    } catch (e) {
      setDetailsBody(String(e));
    } finally {
      setDetailsLoading(false);
    }
  };

  const resetAddForm = () => {
    setAddName("");
    setAddCommand("");
    setAddArgs("");
    setAddEnv("");
  };

  const openAdd = () => {
    resetAddForm();
    setActionError(null);
    setAddOpen(true);
  };

  const submitAdd = async () => {
    if (!api.isTauri() || actionBusy) return;
    const name = addName.trim();
    const command = addCommand.trim();
    if (!name || !command) return;
    const args = splitArgs(addArgs);
    const env = parseEnvLines(addEnv);
    setActionBusy("mcp:add");
    setActionError(null);
    setActionErrorSource(null);
    try {
      await api.mcpAdd({
        name,
        command,
        args,
        env: Object.keys(env).length ? env : undefined,
      });
      setAddOpen(false);
      resetAddForm();
      await refresh();
    } catch (e) {
      setActionError(String(e));
      setActionErrorSource("mcp");
    } finally {
      setActionBusy(null);
    }
  };

  const confirmRemoveMcp = async () => {
    const target = removeTarget;
    if (!target || !api.isTauri()) return;
    setRemoveTarget(null);
    setActionBusy(`mcp:rm:${target.name}`);
    setActionError(null);
    setActionErrorSource(null);
    try {
      await api.mcpRemove(target.name);
      await refresh();
    } catch (e) {
      setActionError(String(e));
      setActionErrorSource("mcp");
    } finally {
      setActionBusy(null);
    }
  };

  const runDoctor = useCallback(
    async (focusName?: string | null) => {
      if (!api.isTauri()) return;
      setDoctorOpen(true);
      setDoctorLoading(true);
      setDoctorError(null);
      setDoctorFocus(focusName?.trim() || null);
      try {
        const report = await api.mcpDoctor(focusName?.trim() || null);
        setDoctorReport(report);
        setDoctorLastAt(Date.now());
        const next = indexDoctorServerStatuses(report);
        setDoctorStatusIndex((prev) => {
          // Full doctor (no focus): replace. Focused: merge into previous.
          if (!focusName?.trim()) return next;
          const merged = new Map(prev);
          for (const [k, v] of next) merged.set(k, v);
          return merged;
        });
      } catch (e) {
        setDoctorReport(null);
        setDoctorError(String(e));
      } finally {
        setDoctorLoading(false);
      }
    },
    [],
  );

  /** Live index for the open doctor modal (may be a focused subset). */
  const doctorReportStatusIndex = useMemo(
    () => indexDoctorServerStatuses(doctorReport),
    [doctorReport],
  );

  const doctorLastLabel = useMemo(() => {
    if (!doctorLastAt) return null;
    try {
      return new Date(doctorLastAt).toLocaleString();
    } catch {
      return null;
    }
  }, [doctorLastAt]);

  const visiblePlugins = useMemo(
    () => filterPluginsByLoadState(plugins, pluginFilter),
    [plugins, pluginFilter],
  );

  const tab = activeTab;

  return (
    <div className="ext-panel" data-testid="extensions-panel">
      <p className="settings-page__lead">{tr("ext.lead")}</p>

      {onTabChange ? (
        <div
          className="settings-account-tabs settings-page__tabs"
          role="tablist"
          aria-label={tr("settings.nav.extensions")}
        >
          <div
            className="settings-seg settings-seg--lg settings-page__tabs-seg"
            role="presentation"
          >
            {(
              [
                ["plugins", "ext.plugins.title"],
                ["skills", "ext.skills.title"],
                ["mcp", "ext.mcp.title"],
                ["hooks", "ext.hooks.title"],
                ["market", "ext.market.title"],
              ] as const
            ).map(([id, key]) => (
              <button
                key={id}
                type="button"
                role="tab"
                className={"settings-seg__btn" + (tab === id ? " is-on" : "")}
                aria-selected={tab === id}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onTabChange(id);
                }}
              >
                {tr(key)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="ext-toolbar">
        <div className="ext-toolbar__scope">
          <span className="ext-badge ext-badge--scope">{scopeLabel}</span>
          {scopePath ? (
            <button
              type="button"
              className="ext-path-btn"
              title={scopePath}
              onClick={() => void reveal(scopePath)}
            >
              <IconFolder size={14} />
              <span>{shortPathLabel(scopePath, 48)}</span>
            </button>
          ) : (
            <span className="ext-toolbar__hint">{tr("ext.scope.globalHint")}</span>
          )}
        </div>
        <div className="ext-toolbar__actions">
          {(agentHome || configPath) && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => void reveal(configPath || agentHome)}
              title={configPath || agentHome || undefined}
            >
              <IconExternalLink size={14} />
              <span>{tr("ext.openAgentHome")}</span>
            </button>
          )}
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => void refresh()}
            disabled={loading || !!actionBusy || !!busyKey}
          >
            <IconRefresh size={14} />
            <span>{loading ? tr("ext.refreshing") : tr("ext.refresh")}</span>
          </button>
        </div>
      </div>

      {pathHint && (
        <p className="ext-alert ext-alert--warn" role="status">
          {pathHint}
        </p>
      )}

      {actionError && (
        <div className="ext-alert ext-alert--error" role="alert">
          <div className="ext-alert__title">
            {actionErrorSource === "mcp"
              ? tr("ext.mcp.actionError")
              : tr("ext.plugins.actionError")}
          </div>
          <p className="ext-alert__body">{actionError}</p>
          <button
            type="button"
            className="btn btn--ghost ext-alert__cta"
            onClick={() => {
              setActionError(null);
              setActionErrorSource(null);
            }}
          >
            {tr("common.close")}
          </button>
        </div>
      )}

      {bannerError && (
        <div
          className={
            "ext-alert" + (cliMissing ? " ext-alert--error" : " ext-alert--warn")
          }
          role="alert"
        >
          <div className="ext-alert__title">
            {cliMissing ? tr("ext.error.cliTitle") : tr("ext.error.title")}
          </div>
          <p className="ext-alert__body">
            {cliMissing ? tr("ext.error.cliBody") : bannerError}
          </p>
          {cliMissing && onOpenRuntime ? (
            <button
              type="button"
              className="btn btn--solid ext-alert__cta"
              onClick={onOpenRuntime}
            >
              {tr("ext.error.openRuntime")}
            </button>
          ) : null}
          {cliMissing && bannerError && !isCliMissingError(bannerError) ? (
            <p className="ext-alert__detail">{bannerError}</p>
          ) : null}
          {cliMissing && isCliMissingError(bannerError) ? (
            <p className="ext-alert__detail">{bannerError}</p>
          ) : null}
        </div>
      )}

      {/* Plugins — same inventory as Grok Build `plugin list` / Plugins tab */}
      {tab === "plugins" && (
      <>
      <h2 className="settings-page__h2" id="settings-anchor-ext-plugins">
        <IconPuzzle size={15} />
        {tr("ext.plugins.title")}
        {!loading ? (
          <span className="ext-count">{plugins.length}</span>
        ) : null}
        {!loading && plugins.length > 0 ? (
          <button
            type="button"
            className="btn btn--ghost ext-bulk-btn"
            disabled={!!actionBusy || !!busyKey || cliMissing}
            onClick={() => updateAllPlugins()}
          >
            {actionBusy === "update:all"
              ? tr("ext.plugins.updating")
              : tr("ext.plugins.updateAll")}
          </button>
        ) : null}
      </h2>
      <div className="settings-card ext-card">
        {!loading && plugins.length > 0 ? (
          <div
            className="ext-plugin-filters"
            role="tablist"
            aria-label={tr("ext.plugins.filterLabel")}
          >
            {(
              [
                ["all", "ext.plugins.filter.all"],
                ["enabled", "ext.plugins.filter.enabled"],
                ["disabled", "ext.plugins.filter.disabled"],
              ] as const
            ).map(([id, key]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={pluginFilter === id}
                className={
                  "ext-plugin-filter" + (pluginFilter === id ? " is-active" : "")
                }
                onClick={() => setPluginFilter(id)}
              >
                {tr(key)}
              </button>
            ))}
          </div>
        ) : null}
        {loading && <p className="ext-empty">{tr("ext.plugins.loading")}</p>}
        {!loading && plugins.length === 0 && (
          <div className="ext-empty-cta">
            <p className="ext-empty-cta__text">
              {cliMissing ? tr("ext.plugins.emptyCli") : tr("ext.plugins.empty")}
            </p>
            {!cliMissing && onTabChange ? (
              <button
                type="button"
                className="btn btn--solid btn--sm"
                onClick={() => onTabChange("market")}
              >
                <IconPuzzle size={14} />
                <span>{tr("ext.plugins.browseOfficial")}</span>
              </button>
            ) : null}
          </div>
        )}
        {!loading && plugins.length > 0 && visiblePlugins.length === 0 && (
          <p className="ext-empty">{tr("ext.plugins.filterEmpty")}</p>
        )}
        {!loading && visiblePlugins.length > 0 && (
          <ul className="ext-list">
            {visiblePlugins.map((p) => {
              const key = pluginRowKey(p);
              const rowBusy = actionBusy === key;
              const updating = actionBusy === `update:${key}`;
              const busy = rowBusy || updating;
              const tone = pluginStatusTone(p.status, p.enabled);
              const meta = pluginMetaLine(p);
              const provides = pluginProvidesLine(p);
              return (
                <li
                  key={key}
                  className={
                    "ext-item" + (p.enabled ? "" : " ext-item--disabled")
                  }
                >
                  <div className="ext-item__head">
                    <strong className="ext-item__name">{p.name}</strong>
                    <span className={`ext-badge ext-badge--plugin-${tone}`}>
                      {p.enabled
                        ? tr("ext.plugins.status.enabled")
                        : tr("ext.plugins.status.disabled")}
                    </span>
                    {p.scope ? (
                      <span className="ext-badge ext-badge--muted">{p.scope}</span>
                    ) : null}
                    {p.version ? (
                      <span className="ext-badge ext-badge--muted">
                        v{String(p.version).replace(/^v/i, "")}
                      </span>
                    ) : null}
                  </div>
                  {meta ? <p className="ext-item__desc">{meta}</p> : null}
                  {provides ? (
                    <p className="ext-item__desc ext-item__provides">{provides}</p>
                  ) : null}
                  <div className="ext-item__meta">
                    {p.marketplace ? (
                      <span>
                        {tr("ext.plugins.marketplace")}: {p.marketplace}
                      </span>
                    ) : null}
                    {p.path ? (
                      <button
                        type="button"
                        className="ext-path-btn"
                        title={p.path}
                        onClick={() => void reveal(p.path)}
                      >
                        <IconFolder size={13} />
                        <span>{shortPathLabel(p.path, 42)}</span>
                      </button>
                    ) : null}
                  </div>
                  <div className="ext-item__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={busy || !!actionBusy}
                      onClick={() => togglePlugin(p)}
                    >
                      {rowBusy
                        ? tr("ext.plugins.working")
                        : p.enabled
                          ? tr("ext.plugins.disable")
                          : tr("ext.plugins.enable")}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={busy || !!actionBusy || cliMissing}
                      onClick={() => updatePlugin(p)}
                    >
                      {updating
                        ? tr("ext.plugins.updating")
                        : tr("ext.plugins.update")}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={busy || !!actionBusy}
                      onClick={() => void showDetails(p)}
                    >
                      {tr("ext.plugins.details")}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm ext-item__danger"
                      disabled={busy || !!actionBusy}
                      onClick={() => setUninstallTarget(p)}
                    >
                      <IconTrash size={13} />
                      <span>{tr("ext.plugins.uninstall")}</span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {!cliMissing ? (
          <details className="ext-market-sources">
            <summary className="ext-market-sources__summary">
              {tr("ext.plugins.advancedInstall")}
            </summary>
            <div className="ext-plugin-install">
              <label
                className="ext-plugin-install__label"
                htmlFor="ext-plugin-source"
              >
                {tr("ext.plugins.installLabel")}
              </label>
              <div className="ext-plugin-install__row">
                <input
                  id="ext-plugin-source"
                  type="text"
                  className="settings-input ext-plugin-install__input"
                  value={installSource}
                  placeholder={tr("ext.plugins.installPlaceholder")}
                  disabled={!!actionBusy || cliMissing}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setInstallSource(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void installPlugin();
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn--solid btn--sm"
                  disabled={
                    !!actionBusy ||
                    cliMissing ||
                    !normalizePluginInstallSource(installSource)
                  }
                  onClick={() => void installPlugin()}
                >
                  {actionBusy === "install"
                    ? tr("ext.plugins.installing")
                    : tr("ext.plugins.install")}
                </button>
              </div>
            </div>
          </details>
        ) : null}
      </div>
      </>
      )}

      {/* Skills */}
      {tab === "skills" && (
      <>
      <h2 className="settings-page__h2" id="settings-anchor-ext-skills">
        <IconSkills size={15} />
        {tr("ext.skills.title")}
        {!loading ? (
          <span className="ext-count">{skills.length}</span>
        ) : null}
        {!loading && skills.length > 0 && skillsOffCount > 0 ? (
          <button
            type="button"
            className="btn btn--ghost ext-bulk-btn"
            disabled={!!busyKey}
            onClick={() => void enableAllSkills()}
          >
            {tr("ext.enableAll")}
          </button>
        ) : null}
      </h2>
      <div className="settings-card ext-card">
        {loading && (
          <p className="ext-empty">{tr("ext.skills.loading")}</p>
        )}
        {!loading && skills.length === 0 && (
          <p className="ext-empty">
            {cliMissing ? tr("ext.skills.emptyCli") : tr("ext.skills.empty")}
          </p>
        )}
        {!loading && skills.length > 0 && (
          <ul className="ext-list">
            {skills.map((s) => {
              const tone = skillSourceTone(s.source);
              const on = isExtensionEnabled(s.enabled);
              return (
                <li
                  key={`${s.source}:${s.name}:${s.path ?? ""}`}
                  className={"ext-item" + (on ? "" : " ext-item--off")}
                >
                  <div className="ext-item__head">
                    <strong className="ext-item__name">{s.name}</strong>
                    <span className={`ext-badge ext-badge--${tone}`}>
                      {normalizeSourceLabel(s.source)}
                    </span>
                    {s.userInvocable ? (
                      <span className="ext-badge ext-badge--invocable">
                        {tr("ext.skills.invocable")}
                      </span>
                    ) : null}
                    <ExtensionToggle
                      checked={on}
                      disabled={!!busyKey}
                      label={on ? tr("ext.enabled") : tr("ext.disabled")}
                      onChange={(next) => void toggleSkill(s.name, next)}
                    />
                  </div>
                  {s.description ? (
                    <p className="ext-item__desc">{s.description}</p>
                  ) : null}
                  <div className="ext-item__meta">
                    <span>{skillMetaLine(s)}</span>
                    {s.path ? (
                      <button
                        type="button"
                        className="ext-path-btn"
                        title={s.path}
                        onClick={() => void reveal(s.path)}
                      >
                        <IconFolder size={13} />
                        <span>{shortPathLabel(s.path, 42)}</span>
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      </>
      )}

      {/* MCP */}
      {tab === "mcp" && (
      <>
      <h2 className="settings-page__h2" id="settings-anchor-ext-mcp">
        <IconPlug size={15} />
        {tr("ext.mcp.title")}
        {!loading ? (
          <span className="ext-count">{servers.length}</span>
        ) : null}
        <span className="ext-h2-actions">
          <button
            type="button"
            className="btn btn--ghost ext-bulk-btn"
            disabled={!!actionBusy || !!busyKey || cliMissing}
            onClick={() => void runDoctor(null)}
          >
            <IconDoctor size={14} />
            <span>{tr("ext.mcp.doctor")}</span>
          </button>
          <button
            type="button"
            className="btn btn--ghost ext-bulk-btn"
            disabled={!!actionBusy || !!busyKey || !api.isTauri()}
            onClick={openAdd}
          >
            <IconPlus size={14} />
            <span>{tr("ext.mcp.add")}</span>
          </button>
          {!loading && servers.length > 0 && mcpOffCount > 0 ? (
            <button
              type="button"
              className="btn btn--ghost ext-bulk-btn"
              disabled={!!busyKey || !!actionBusy}
              onClick={() => void enableAllMcp()}
            >
              {tr("ext.enableAll")}
            </button>
          ) : null}
        </span>
      </h2>
      <div className="settings-card ext-card">
        {doctorLastLabel ? (
          <p className="ext-mcp-last-doctor" role="status">
            {tr("ext.mcp.doctorLastAt", { time: doctorLastLabel })}
          </p>
        ) : null}
        {loading && <p className="ext-empty">{tr("ext.mcp.loading")}</p>}
        {!loading && servers.length === 0 && (
          <p className="ext-empty">
            {cliMissing ? tr("ext.mcp.emptyCli") : tr("ext.mcp.empty")}
          </p>
        )}
        {!loading && servers.length > 0 && (
          <ul className="ext-list">
            {servers.map((s) => {
              const meta = mcpMetaLine(s);
              const on = isExtensionEnabled(s.enabled);
              const rmBusy = actionBusy === `mcp:rm:${s.name}`;
              const st = lookupServerStatus(doctorStatusIndex, s.name);
              const badgeMod = st ? mcpStatusBadgeMod(st.tone) : null;
              const guidanceKey = st ? mcpAuthGuidanceKey(st.tone) : null;
              return (
                <li
                  key={s.name}
                  className={"ext-item" + (on ? "" : " ext-item--off")}
                >
                  <div className="ext-item__head">
                    <strong className="ext-item__name">{s.name}</strong>
                    {st && badgeMod ? (
                      <span
                        className={
                          "ext-mcp-status ext-mcp-status--" + badgeMod
                        }
                        title={st.reason ?? undefined}
                      >
                        <span
                          className="ext-mcp-status__lamp"
                          aria-hidden
                        />
                        <span
                          className={"ext-badge ext-badge--" + badgeMod}
                        >
                          {tr(mcpStatusLabelKey(st.tone) as MessageKey)}
                        </span>
                      </span>
                    ) : null}
                    {s.transport ? (
                      <span className="ext-badge ext-badge--muted">
                        {s.transport}
                      </span>
                    ) : null}
                    {s.compatibilityStatus ? (
                      <span className="ext-badge ext-badge--compat">
                        {s.compatibilityStatus}
                      </span>
                    ) : null}
                    <ExtensionToggle
                      checked={on}
                      disabled={!!busyKey || !!actionBusy}
                      label={on ? tr("ext.enabled") : tr("ext.disabled")}
                      onChange={(next) => void toggleMcp(s.name, next)}
                    />
                  </div>
                  {meta ? <p className="ext-item__desc">{meta}</p> : null}
                  {st?.reason && st.tone !== "ok" ? (
                    <p className="ext-item__desc ext-mcp-status-reason">
                      {redactMcpText(st.reason)}
                    </p>
                  ) : null}
                  {st?.needsAuthRefresh && guidanceKey ? (
                    <div className="ext-mcp-auth-row">
                      <p className="ext-mcp-auth-hint">
                        {tr(guidanceKey as MessageKey)}
                      </p>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() =>
                          setAuthHelpTarget({ name: s.name, status: st })
                        }
                      >
                        {tr("ext.mcp.auth.howToRefresh")}
                      </button>
                    </div>
                  ) : null}
                  {s.target ? (
                    <div className="ext-item__meta">
                      <em className="ext-item__target" title={s.target}>
                        {shortPathLabel(s.target, 64) || s.target}
                      </em>
                      {looksLikePath(s.target) ? (
                        <button
                          type="button"
                          className="ext-path-btn"
                          title={s.target}
                          onClick={() => void reveal(s.target)}
                        >
                          <IconFolder size={13} />
                          <span>{tr("ext.reveal")}</span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {s.vendor ? (
                    <div className="ext-item__meta">
                      <span>
                        {tr("ext.mcp.vendor")}: {s.vendor}
                      </span>
                    </div>
                  ) : null}
                  <div className="ext-item__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={!!actionBusy || doctorLoading || cliMissing}
                      onClick={() => void runDoctor(s.name)}
                    >
                      <IconDoctor size={13} />
                      <span>{tr("ext.mcp.doctor")}</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm ext-item__danger"
                      disabled={rmBusy || !!actionBusy}
                      onClick={() => setRemoveTarget(s)}
                    >
                      <IconTrash size={13} />
                      <span>
                        {rmBusy
                          ? tr("ext.plugins.working")
                          : tr("ext.mcp.remove")}
                      </span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      </>
      )}

      {(tab === "hooks" || tab === "market") && (
        <ExtensionsBuildExtras
          locale={locale}
          projectPath={projectPath}
          cliFound={cliFound && !cliMissing}
          mode={tab === "hooks" ? "hooks" : "market"}
          onPluginsChanged={() => {
            void refresh();
          }}
        />
      )}

      <GlassModal
        open={!!uninstallTarget}
        onClose={() => {
          if (!actionBusy) setUninstallTarget(null);
        }}
        title={tr("ext.plugins.uninstallTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={!!actionBusy}
              onClick={() => setUninstallTarget(null)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={!!actionBusy}
              onClick={() => void confirmUninstall()}
            >
              {tr("ext.plugins.uninstall")}
            </button>
          </>
        }
      >
        <p className="app-dialog__msg">
          {tr("ext.plugins.uninstallConfirm", {
            name: uninstallTarget?.name ?? "",
          })}
        </p>
      </GlassModal>

      <GlassModal
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title={tr("ext.plugins.detailsTitle", { name: detailsTitle })}
        size="lg"
        closeLabel={tr("common.close")}
        wrapBody
        footer={
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setDetailsOpen(false)}
          >
            {tr("common.close")}
          </button>
        }
      >
        {detailsLoading ? (
          <p className="ext-empty">{tr("ext.plugins.detailsLoading")}</p>
        ) : (
          <pre className="ext-details-pre">{detailsBody}</pre>
        )}
      </GlassModal>

      <GlassModal
        open={addOpen}
        onClose={() => {
          if (actionBusy !== "mcp:add") setAddOpen(false);
        }}
        title={tr("ext.mcp.addTitle")}
        size="md"
        closeLabel={tr("common.close")}
        wrapBody
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={actionBusy === "mcp:add"}
              onClick={() => setAddOpen(false)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={
                actionBusy === "mcp:add" ||
                !addName.trim() ||
                !addCommand.trim()
              }
              onClick={() => void submitAdd()}
            >
              {actionBusy === "mcp:add"
                ? tr("ext.mcp.addWorking")
                : tr("ext.mcp.addSubmit")}
            </button>
          </>
        }
      >
        <form
          className="app-dialog__form"
          onSubmit={(e) => {
            e.preventDefault();
            void submitAdd();
          }}
        >
          <label className="field">
            <span>{tr("ext.mcp.name")}</span>
            <input
              className="app-dialog__input"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder={tr("ext.mcp.namePlaceholder")}
              autoComplete="off"
              spellCheck={false}
              disabled={actionBusy === "mcp:add"}
            />
          </label>
          <label className="field">
            <span>{tr("ext.mcp.command")}</span>
            <input
              className="app-dialog__input"
              value={addCommand}
              onChange={(e) => setAddCommand(e.target.value)}
              placeholder={tr("ext.mcp.commandPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              disabled={actionBusy === "mcp:add"}
            />
          </label>
          <label className="field">
            <span>{tr("ext.mcp.args")}</span>
            <input
              className="app-dialog__input"
              value={addArgs}
              onChange={(e) => setAddArgs(e.target.value)}
              placeholder={tr("ext.mcp.argsPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              disabled={actionBusy === "mcp:add"}
            />
            <span className="ext-field-hint">{tr("ext.mcp.argsHint")}</span>
          </label>
          <label className="field">
            <span>{tr("ext.mcp.env")}</span>
            <textarea
              className="app-dialog__input ext-env-textarea"
              value={addEnv}
              onChange={(e) => setAddEnv(e.target.value)}
              placeholder={tr("ext.mcp.envPlaceholder")}
              rows={3}
              spellCheck={false}
              disabled={actionBusy === "mcp:add"}
            />
            <span className="ext-field-hint">{tr("ext.mcp.envHint")}</span>
          </label>
        </form>
      </GlassModal>

      <GlassModal
        open={!!removeTarget}
        onClose={() => {
          if (!actionBusy) setRemoveTarget(null);
        }}
        title={tr("ext.mcp.removeTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={!!actionBusy}
              onClick={() => setRemoveTarget(null)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={!!actionBusy}
              onClick={() => void confirmRemoveMcp()}
            >
              {tr("ext.mcp.remove")}
            </button>
          </>
        }
      >
        <p className="app-dialog__msg">
          {tr("ext.mcp.removeConfirm", {
            name: removeTarget?.name ?? "",
          })}
        </p>
      </GlassModal>

      <GlassModal
        open={doctorOpen}
        onClose={() => {
          if (!doctorLoading) setDoctorOpen(false);
        }}
        title={
          doctorFocus
            ? `${tr("ext.mcp.doctorTitle")} · ${doctorFocus}`
            : tr("ext.mcp.doctorTitle")
        }
        size="lg"
        closeLabel={tr("common.close")}
        wrapBody
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={doctorLoading}
              onClick={() => void runDoctor(doctorFocus)}
            >
              <IconRefresh size={14} />
              <span>{tr("ext.mcp.doctorRerun")}</span>
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={doctorLoading}
              onClick={() => setDoctorOpen(false)}
            >
              {tr("common.close")}
            </button>
          </>
        }
      >
        {doctorLoading && (
          <p className="ext-empty">{tr("ext.mcp.doctorRunning")}</p>
        )}
        {!doctorLoading && doctorError && (
          <div className="ext-alert ext-alert--error" role="alert">
            <p className="ext-alert__body">{doctorError}</p>
          </div>
        )}
        {!doctorLoading && doctorReport && (
          <div className="ext-doctor">
            <p className="ext-doctor__summary">
              {tr("ext.mcp.doctorSummary", {
                healthy: doctorReport.summary.healthy,
                unhealthy: doctorReport.summary.unhealthy,
                total: doctorReport.summary.total,
              })}
            </p>
            {(doctorReport.sources?.length ?? 0) > 0 ? (
              <div className="ext-doctor__sources">
                <div className="ext-doctor__section-title">
                  {tr("ext.mcp.doctorSources")}
                </div>
                <ul className="ext-doctor__source-list">
                  {doctorReport.sources.map((src: any) => (
                    <li key={src.path}>
                      <code>{src.path}</code>
                      <span className="ext-badge ext-badge--muted">
                        {src.status}
                        {src.serverCount != null
                          ? ` · ${src.serverCount}`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {(doctorReport.servers?.length ?? 0) === 0 ? (
              <p className="ext-empty">
                {redactMcpText(doctorReport.rawText)?.trim() ||
                  tr("ext.mcp.doctorEmpty")}
              </p>
            ) : (
              <ul className="ext-list ext-doctor__servers">
                {doctorReport.servers.map((s: any) => {
                  const st =
                    lookupServerStatus(doctorReportStatusIndex, s.name) ??
                    lookupServerStatus(doctorStatusIndex, s.name);
                  const badgeMod = st
                    ? mcpStatusBadgeMod(st.tone)
                    : s.healthy
                      ? "ok"
                      : "fail";
                  const label = st
                    ? tr(mcpStatusLabelKey(st.tone) as MessageKey)
                    : s.healthy
                      ? tr("ext.mcp.doctorHealthy")
                      : tr("ext.mcp.doctorUnhealthy");
                  const guidanceKey = st
                    ? mcpAuthGuidanceKey(st.tone)
                    : null;
                  return (
                    <li
                      key={s.name}
                      className={
                        "ext-item" + (s.healthy ? "" : " ext-item--off")
                      }
                    >
                      <div className="ext-item__head">
                        <strong className="ext-item__name">{s.name}</strong>
                        <span
                          className={
                            "ext-mcp-status ext-mcp-status--" + badgeMod
                          }
                        >
                          <span
                            className="ext-mcp-status__lamp"
                            aria-hidden
                          />
                          <span
                            className={"ext-badge ext-badge--" + badgeMod}
                          >
                            {label}
                          </span>
                        </span>
                        {s.transport ? (
                          <span className="ext-badge ext-badge--muted">
                            {s.transport}
                          </span>
                        ) : null}
                      </div>
                      {s.target ? (
                        <p className="ext-item__desc" title={s.target}>
                          {shortPathLabel(s.target, 72) || s.target}
                        </p>
                      ) : null}
                      {st?.needsAuthRefresh && guidanceKey ? (
                        <div className="ext-mcp-auth-row">
                          <p className="ext-mcp-auth-hint">
                            {tr(guidanceKey as MessageKey)}
                          </p>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() =>
                              setAuthHelpTarget({
                                name: s.name,
                                status: st,
                              })
                            }
                          >
                            {tr("ext.mcp.auth.howToRefresh")}
                          </button>
                        </div>
                      ) : null}
                      {Array.isArray(s.checks) && s.checks.length > 0 ? (
                        <ul className="ext-doctor__checks">
                          {s.checks.map((c: any, i: any) => (
                            <li
                              key={`${s.name}:${c.label}:${i}`}
                              className={
                                "ext-doctor__check" +
                                (c.passed ? " is-pass" : " is-fail")
                              }
                            >
                              <span className="ext-doctor__check-label">
                                {c.passed ? "✓" : "✗"} {c.label}
                              </span>
                              {c.detail ? (
                                <span className="ext-doctor__check-detail">
                                  {redactMcpText(c.detail)}
                                </span>
                              ) : null}
                              {c.hint ? (
                                <span className="ext-doctor__check-hint">
                                  {tr("ext.mcp.doctorHint", {
                                    hint: redactMcpText(c.hint),
                                  })}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {doctorReport.rawText ? (
              <pre className="ext-details-pre">
                {redactMcpText(doctorReport.rawText)}
              </pre>
            ) : null}
          </div>
        )}
      </GlassModal>

      <GlassModal
        open={!!authHelpTarget}
        onClose={() => setAuthHelpTarget(null)}
        title={tr("ext.mcp.auth.refreshTitle", {
          name: authHelpTarget?.name ?? "",
        })}
        size="md"
        closeLabel={tr("common.close")}
        wrapBody
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={doctorLoading || cliMissing}
              onClick={() => {
                const name = authHelpTarget?.name;
                setAuthHelpTarget(null);
                if (name) void runDoctor(name);
              }}
            >
              <IconDoctor size={14} />
              <span>{tr("ext.mcp.doctorRerun")}</span>
            </button>
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => setAuthHelpTarget(null)}
            >
              {tr("common.close")}
            </button>
          </>
        }
      >
        <p className="app-dialog__msg">
          {authHelpTarget?.status.tone === "auth_expired"
            ? tr("ext.mcp.auth.refreshLeadExpired")
            : tr("ext.mcp.auth.refreshLeadRequired")}
        </p>
        {authHelpTarget?.status.reason ? (
          <p className="ext-mcp-status-reason">
            {redactMcpText(authHelpTarget.status.reason)}
          </p>
        ) : null}
        <ol className="ext-mcp-auth-steps">
          <li>{tr("ext.mcp.auth.stepReauth")}</li>
          <li>{tr("ext.mcp.auth.stepReadd")}</li>
          <li>{tr("ext.mcp.auth.stepRemoteUrl")}</li>
          <li>{tr("ext.mcp.auth.stepDoctor")}</li>
        </ol>
        <p className="ext-field-hint">{tr("ext.mcp.auth.noAutoRefresh")}</p>
      </GlassModal>
    </div>
  );
}

/** Space-separated args; keeps simple tokens (no shell quoting). */
function splitArgs(raw: string): string[] {
  return raw
    .trim()
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parse KEY=value lines into a map. Skips blanks and `#` comments. */
function parseEnvLines(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function ExtensionToggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={"ext-switch" + (checked ? " is-on" : "")}
      onClick={() => onChange(!checked)}
    >
      <span className="ext-switch__thumb" aria-hidden />
    </button>
  );
}

function normalizeSourceLabel(source: string): string {
  const s = (source ?? "").trim();
  return s || "unknown";
}

function looksLikePath(target: string): boolean {
  const t = target.trim();
  if (!t) return false;
  if (t.startsWith("/") || /^[A-Za-z]:[\\/]/.test(t)) return true;
  if (t.startsWith("~")) return true;
  if (/\s/.test(t) || t.startsWith("http://") || t.startsWith("https://")) {
    return false;
  }
  return t.includes("/") || t.includes("\\");
}

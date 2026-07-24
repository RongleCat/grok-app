/**
 * Settings → Extensions: Skills + MCP + Plugins.
 * Skills/MCP from `grok inspect --json`; plugins from `grok plugin list/enable/…`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import { createT, type Locale } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import {
  IconExternalLink,
  IconFolder,
  IconPlug,
  IconPuzzle,
  IconRefresh,
  IconSkills,
  IconTrash,
} from "@/components/icons";
import {
  filterPluginsByLoadState,
  isCliMissingError,
  mcpMetaLine,
  mergeInspectErrors,
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

export interface ExtensionsPanelProps {
  locale: Locale;
  /** Active workbench project path (inspect cwd). */
  projectPath?: string | null;
  /** Whether CLI probe found a binary (for empty-state copy). */
  cliFound?: boolean;
  /** Navigate to Settings → Runtime when CLI is missing. */
  onOpenRuntime?: () => void;
}

export function ExtensionsPanel({
  locale,
  projectPath = null,
  cliFound = true,
  onOpenRuntime,
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
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<api.PluginDto | null>(
    null,
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsTitle, setDetailsTitle] = useState("");
  const [detailsBody, setDetailsBody] = useState("");
  const [detailsLoading, setDetailsLoading] = useState(false);
  /** Grok Build Plugins tab filter: all | enabled | disabled */
  const [pluginFilter, setPluginFilter] = useState<PluginFilter>("all");

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

  const runPluginAction = async (
    key: string,
    action: () => Promise<unknown>,
  ) => {
    setActionBusy(key);
    setActionError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setActionError(String(e));
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

  const visiblePlugins = useMemo(
    () => filterPluginsByLoadState(plugins, pluginFilter),
    [plugins, pluginFilter],
  );

  return (
    <div className="ext-panel" data-testid="extensions-panel">
      <p className="settings-page__lead">{tr("ext.lead")}</p>

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
            disabled={loading || !!actionBusy}
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
          <div className="ext-alert__title">{tr("ext.plugins.actionError")}</div>
          <p className="ext-alert__body">{actionError}</p>
          <button
            type="button"
            className="btn btn--ghost ext-alert__cta"
            onClick={() => setActionError(null)}
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
      <h2 className="settings-page__h2">
        <IconPuzzle size={15} />
        {tr("ext.plugins.title")}
        {!loading ? (
          <span className="ext-count">{plugins.length}</span>
        ) : null}
      </h2>
      <div className="settings-card ext-card">
        {!loading && plugins.length > 0 ? (
          <div className="ext-plugin-filters" role="tablist" aria-label={tr("ext.plugins.filterLabel")}>
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
          <p className="ext-empty">
            {cliMissing ? tr("ext.plugins.emptyCli") : tr("ext.plugins.empty")}
          </p>
        )}
        {!loading && plugins.length > 0 && visiblePlugins.length === 0 && (
          <p className="ext-empty">{tr("ext.plugins.filterEmpty")}</p>
        )}
        {!loading && visiblePlugins.length > 0 && (
          <ul className="ext-list">
            {visiblePlugins.map((p) => {
              const key = pluginRowKey(p);
              const busy = actionBusy === key;
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
                      {busy
                        ? tr("ext.plugins.working")
                        : p.enabled
                          ? tr("ext.plugins.disable")
                          : tr("ext.plugins.enable")}
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
        {!loading && plugins.length > 0 ? (
          <p className="ext-section-note">{tr("ext.plugins.note")}</p>
        ) : null}
      </div>

      {/* Skills */}
      <h2 className="settings-page__h2">
        <IconSkills size={15} />
        {tr("ext.skills.title")}
        {!loading ? (
          <span className="ext-count">{skills.length}</span>
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
              return (
                <li key={`${s.source}:${s.name}:${s.path ?? ""}`} className="ext-item">
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

      {/* MCP */}
      <h2 className="settings-page__h2">
        <IconPlug size={15} />
        {tr("ext.mcp.title")}
        {!loading ? (
          <span className="ext-count">{servers.length}</span>
        ) : null}
      </h2>
      <div className="settings-card ext-card">
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
              return (
                <li key={s.name} className="ext-item">
                  <div className="ext-item__head">
                    <strong className="ext-item__name">{s.name}</strong>
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
                  </div>
                  {meta ? <p className="ext-item__desc">{meta}</p> : null}
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
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="ext-footnote">
        <IconPuzzle size={13} />
        <span>{tr("ext.footnote")}</span>
      </p>

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
    </div>
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
  // npx / command-style targets are not filesystem paths
  if (/\s/.test(t) || t.startsWith("http://") || t.startsWith("https://")) {
    return false;
  }
  return t.includes("/") || t.includes("\\");
}

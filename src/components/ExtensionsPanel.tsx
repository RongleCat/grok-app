/**
 * Settings → Extensions: Skills + MCP servers from `grok inspect --json`.
 * Full card layout (not a modal stub). Project cwd when available.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import { createT, type Locale } from "@/i18n";
import {
  IconExternalLink,
  IconFolder,
  IconPlug,
  IconPuzzle,
  IconRefresh,
  IconSkills,
} from "@/components/icons";
import {
  isCliMissingError,
  mcpMetaLine,
  mergeInspectErrors,
  shortPathLabel,
  skillMetaLine,
  skillSourceTone,
  sortMcpByName,
  sortSkillsByName,
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
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [agentHome, setAgentHome] = useState<string | null>(null);
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [pathHint, setPathHint] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!api.isTauri()) {
      setSkills([]);
      setServers([]);
      setSkillsError(tr("ext.needTauri"));
      setMcpError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setSkillsError(null);
    setMcpError(null);
    setPathHint(null);
    const cwd = projectPath?.trim() || null;
    const [skillsRes, mcpRes, providersRes] = await Promise.all([
      api.skillsList(cwd).catch((e) => ({
        skills: [] as api.SkillDto[],
        error: String(e),
      })),
      api.inspectMcp(cwd).catch((e) => ({
        servers: [] as api.McpDto[],
        error: String(e),
      })),
      api.providersList().catch(() => null),
    ]);
    setSkills(sortSkillsByName(skillsRes.skills ?? []));
    setServers(sortMcpByName(mcpRes.servers ?? []));
    setSkillsError(skillsRes.error?.trim() ? skillsRes.error : null);
    setMcpError(mcpRes.error?.trim() ? mcpRes.error : null);
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
    () => mergeInspectErrors(skillsError, mcpError),
    [skillsError, mcpError],
  );
  const cliMissing =
    !cliFound || isCliMissingError(skillsError) || isCliMissingError(mcpError);

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
            disabled={loading}
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

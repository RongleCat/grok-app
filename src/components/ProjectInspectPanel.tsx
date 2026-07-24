/**
 * Settings → Runtime: inspect active project via `grok inspect --json`.
 * Shows key facts, refresh, copy redacted JSON, open project `.grok` if present.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as api from "@/lib/api";
import { createT, type Locale } from "@/i18n";
import {
  formatInspectJsonForCopy,
  inspectCountsLine,
  type ProjectInspectSummary,
} from "@/lib/projectInspect";
import { isCliMissingError, shortPathLabel } from "@/lib/extensionsUi";
import {
  IconCopy,
  IconFolder,
  IconRefresh,
} from "@/components/icons";

export interface ProjectInspectPanelProps {
  locale: Locale;
  /** Active workbench project path (inspect cwd). */
  projectPath?: string | null;
  cliFound?: boolean;
  onOpenRuntime?: () => void;
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="pi-fact">
      <div className="pi-fact__label">{label}</div>
      <div className="pi-fact__value">{children}</div>
    </div>
  );
}

export function ProjectInspectPanel({
  locale,
  projectPath = null,
  cliFound = true,
}: ProjectInspectPanelProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const cwd = projectPath?.trim() || null;

  const [summary, setSummary] = useState<ProjectInspectSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    if (!cwd) {
      setSummary(null);
      setError(null);
      setLoading(false);
      return;
    }
    if (!api.isTauri()) {
      setSummary(null);
      setError(tr("inspect.needTauri"));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setHint(null);
    try {
      const res = await api.projectInspect(cwd);
      setSummary(res);
      if (res.error?.trim()) {
        setError(res.error.trim());
      }
    } catch (e) {
      setSummary(null);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [cwd, tr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const counts = summary ? inspectCountsLine(summary) : null;
  const cliMissing =
    !cliFound || isCliMissingError(error) || isCliMissingError(summary?.error);

  const copyJson = async () => {
    if (!summary) return;
    const text = formatInspectJsonForCopy(summary);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setHint(tr("inspect.copied"));
      window.setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      setHint(String(e));
    }
  };

  const openGrokDir = async () => {
    const p = summary?.projectGrokPath?.trim();
    if (!p || !summary?.hasProjectGrokDir || !api.isTauri()) return;
    try {
      await api.pathReveal(p);
      setHint(null);
    } catch (e) {
      setHint(String(e));
    }
  };

  const revealPath = async (path: string | null | undefined) => {
    const p = (path ?? "").trim();
    if (!p || !api.isTauri()) return;
    try {
      await api.pathReveal(p);
      setHint(null);
    } catch (e) {
      setHint(String(e));
    }
  };

  return (
    <div className="pi-panel" data-testid="project-inspect-panel">
      <div className="settings-row settings-row--stack" style={{ borderBottom: "none", paddingBottom: 0 }}>
        <div className="settings-row__text">
          <div className="settings-row__label">{tr("inspect.title")}</div>
          <div className="settings-row__desc">{tr("inspect.desc")}</div>
        </div>
      </div>

      {!cwd && (
        <div className="pi-empty" role="status">
          <p className="pi-empty__title">{tr("inspect.needProject")}</p>
          <p className="pi-empty__body">{tr("inspect.needProjectBody")}</p>
        </div>
      )}

      {cwd && (
        <>
          <div className="ext-toolbar pi-toolbar">
            <div className="ext-toolbar__scope">
              <span className="ext-badge ext-badge--scope">
                {tr("inspect.scope.project")}
              </span>
              <button
                type="button"
                className="ext-path-btn"
                title={cwd}
                onClick={() => void revealPath(cwd)}
              >
                <IconFolder size={14} />
                <span>{shortPathLabel(cwd, 48)}</span>
              </button>
            </div>
            <div className="ext-toolbar__actions">
              {summary?.hasProjectGrokDir && summary.projectGrokPath && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => void openGrokDir()}
                  title={summary.projectGrokPath}
                >
                  <IconFolder size={14} />
                  <span>{tr("inspect.openGrok")}</span>
                </button>
              )}
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => void copyJson()}
                disabled={!summary || loading}
              >
                <IconCopy size={14} />
                <span>
                  {copied ? tr("inspect.copied") : tr("inspect.copyJson")}
                </span>
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => void refresh()}
                disabled={loading}
              >
                <IconRefresh size={14} />
                <span>
                  {loading ? tr("inspect.refreshing") : tr("inspect.refresh")}
                </span>
              </button>
            </div>
          </div>

          {hint && (
            <p className="ext-alert ext-alert--warn" role="status">
              {hint}
            </p>
          )}

          {cliMissing && (
            <div className="ext-alert ext-alert--error" role="alert">
              <div className="ext-alert__title">{tr("inspect.error.cliTitle")}</div>
              <p className="ext-alert__body">{tr("inspect.error.cliBody")}</p>
            </div>
          )}

          {!cliMissing && error && (
            <div className="ext-alert ext-alert--error" role="alert">
              <div className="ext-alert__title">{tr("inspect.error.title")}</div>
              <p className="ext-alert__body">{error}</p>
            </div>
          )}

          {loading && !summary && (
            <p className="pi-loading">{tr("inspect.loading")}</p>
          )}

          {summary && !cliMissing && (
            <div className="pi-body">
              <div className="pi-facts">
                <Fact label={tr("inspect.fact.version")}>
                  {summary.grokVersion || "—"}
                  {summary.channel ? ` · ${summary.channel}` : ""}
                </Fact>
                <Fact label={tr("inspect.fact.root")}>
                  {summary.projectRoot || summary.cwd || cwd || "—"}
                </Fact>
                <Fact label={tr("inspect.fact.trusted")}>
                  {summary.projectTrusted == null
                    ? "—"
                    : summary.projectTrusted
                      ? tr("inspect.trusted.yes")
                      : tr("inspect.trusted.no")}
                </Fact>
                <Fact label={tr("inspect.fact.counts")}>
                  {counts
                    ? tr("inspect.counts", {
                        plugins: counts.plugins,
                        skills: counts.skills,
                        mcp: counts.mcp,
                        rules: counts.rules,
                      })
                    : "—"}
                </Fact>
              </div>

              {summary.modelsHints.length > 0 && (
                <div className="pi-section">
                  <div className="pi-section__title">
                    {tr("inspect.section.models")}
                  </div>
                  <div className="pi-chips">
                    {summary.modelsHints.map((m) => (
                      <span key={m} className="ext-badge">
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {summary.rules.length > 0 && (
                <div className="pi-section">
                  <div className="pi-section__title">
                    {tr("inspect.section.rules")}
                  </div>
                  <ul className="pi-list">
                    {summary.rules.map((r) => (
                      <li key={r.path} className="pi-list__row">
                        <button
                          type="button"
                          className="ext-path-btn"
                          title={r.path}
                          onClick={() => void revealPath(r.path)}
                        >
                          <IconFolder size={14} />
                          <span>
                            {shortPathLabel(r.path, 56)}
                            {r.fileType ? ` · ${r.fileType}` : ""}
                            {r.scope ? ` · ${r.scope}` : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {summary.plugins.length > 0 && (
                <div className="pi-section">
                  <div className="pi-section__title">
                    {tr("inspect.section.plugins", {
                      n: summary.plugins.length,
                    })}
                  </div>
                  <ul className="pi-list">
                    {summary.plugins.map((p) => (
                      <li key={`${p.name}:${p.path ?? ""}`} className="pi-list__row">
                        <span className="pi-list__name">{p.name}</span>
                        {p.scope && (
                          <span className="ext-badge ext-badge--muted">
                            {p.scope}
                          </span>
                        )}
                        {p.enabled === false && (
                          <span className="ext-badge">
                            {tr("inspect.plugin.disabled")}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {summary.mcp.length > 0 && (
                <div className="pi-section">
                  <div className="pi-section__title">
                    {tr("inspect.section.mcp", { n: summary.mcp.length })}
                  </div>
                  <ul className="pi-list">
                    {summary.mcp.map((m) => (
                      <li key={m.name} className="pi-list__row">
                        <span className="pi-list__name">{m.name}</span>
                        {m.transport && (
                          <span className="ext-badge ext-badge--muted">
                            {m.transport}
                          </span>
                        )}
                        {m.target && (
                          <span className="pi-list__meta" title={m.target}>
                            {shortPathLabel(m.target, 36)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {summary.skills.total > 0 && (
                <div className="pi-section">
                  <div className="pi-section__title">
                    {tr("inspect.section.skills", {
                      total: summary.skills.total,
                      invocable: summary.skills.userInvocable,
                    })}
                  </div>
                  {Object.keys(summary.skills.bySource).length > 0 && (
                    <div className="pi-chips">
                      {Object.entries(summary.skills.bySource)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([src, n]) => (
                          <span key={src} className="ext-badge">
                            {src}: {n}
                          </span>
                        ))}
                    </div>
                  )}
                  {summary.skills.sample.length > 0 && (
                    <p className="pi-sample">
                      {tr("inspect.skills.sample", {
                        names: summary.skills.sample.join(", "),
                      })}
                    </p>
                  )}
                </div>
              )}

              {summary.agents.length > 0 && (
                <div className="pi-section">
                  <div className="pi-section__title">
                    {tr("inspect.section.agents", {
                      n: summary.agents.length,
                    })}
                  </div>
                  <div className="pi-chips">
                    {summary.agents.map((a) => (
                      <span key={a.name} className="ext-badge">
                        {a.name}
                        {a.source ? ` (${a.source})` : ""}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {summary.configLayers.length > 0 && (
                <div className="pi-section">
                  <div className="pi-section__title">
                    {tr("inspect.section.config")}
                  </div>
                  <ul className="pi-list">
                    {summary.configLayers.map((c, i) => (
                      <li
                        key={`${c.role ?? ""}:${c.path ?? i}`}
                        className="pi-list__row"
                      >
                        {c.role && (
                          <span className="ext-badge ext-badge--muted">
                            {c.role}
                          </span>
                        )}
                        {c.path ? (
                          <button
                            type="button"
                            className="ext-path-btn"
                            title={c.path}
                            onClick={() => void revealPath(c.path)}
                          >
                            <span>{shortPathLabel(c.path, 52)}</span>
                          </button>
                        ) : (
                          <span className="pi-list__meta">—</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!summary.hasProjectGrokDir && (
                <p className="pi-footnote">{tr("inspect.noGrokDir")}</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

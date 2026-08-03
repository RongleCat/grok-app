/**
 * Settings → Runtime: inspect active project via `grok inspect --json`.
 * Section chips, expand lists, copy section JSON/path, reveal paths.
 * Secrets are stripped by the host DTO / pure helpers.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as api from "@/lib/api";
import { createT, type Locale, type MessageKey } from "@/i18n";
import {
  filterInspectSections,
  formatInspectJsonForCopy,
  formatInspectSectionJson,
  inspectCountsLine,
  inspectSectionCounts,
  inspectSectionDocsUrl,
  inspectSectionPaths,
  normalizeProjectInspectSummary,
  sliceInspectList,
  type InspectSectionId,
  type ProjectInspectSummary,
  INSPECT_SECTION_IDS,
} from "@/lib/projectInspect";
import { isCliMissingError, shortPathLabel } from "@/lib/extensionsUi";
import {
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconExternalLink,
  IconFolder,
  IconRefresh,
} from "@/components/icons";

export interface ProjectInspectPanelProps {
  locale: Locale;
  /** Active workbench project path (inspect cwd). */
  projectPath?: string | null;
  cliFound?: boolean;
  onOpenRuntime?: () => void;
  /** When true, omit title/desc (parent card already shows them). */
  hideHeader?: boolean;
}

const LIST_PREVIEW = 8;

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

function sectionChipLabel(
  id: InspectSectionId,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): string {
  switch (id) {
    case "all":
      return t("inspect.chip.all");
    case "plugins":
      return t("inspect.chip.plugins");
    case "skills":
      return t("inspect.chip.skills");
    case "mcp":
      return t("inspect.chip.mcp");
    case "hooks":
      return t("inspect.chip.hooks");
    case "agents":
      return t("inspect.chip.agents");
    case "rules":
      return t("inspect.chip.rules");
    case "config":
      return t("inspect.chip.config");
    case "models":
      return t("inspect.chip.models");
    case "permissions":
      return t("inspect.chip.permissions");
    default:
      return id;
  }
}

export function ProjectInspectPanel({
  locale,
  projectPath = null,
  cliFound = true,
  hideHeader = false,
}: ProjectInspectPanelProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const cwd = projectPath?.trim() || null;

  const [summary, setSummary] = useState<ProjectInspectSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [sectionFilter, setSectionFilter] = useState<InspectSectionId>("all");
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({});

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
      setSummary(normalizeProjectInspectSummary(res));
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

  // Reset filter when project changes.
  useEffect(() => {
    setSectionFilter("all");
    setExpandedSections({});
  }, [cwd]);

  const counts = summary ? inspectCountsLine(summary) : null;
  const sectionCounts = summary ? inspectSectionCounts(summary) : null;
  const visibleSections = summary
    ? filterInspectSections(summary, sectionFilter)
    : [];
  const cliMissing =
    !cliFound || isCliMissingError(error) || isCliMissingError(summary?.error);

  const flashCopy = (key: string) => {
    setCopiedSection(key);
    window.setTimeout(() => {
      setCopiedSection((cur) => (cur === key ? null : cur));
    }, 1600);
  };

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

  const copySection = async (id: InspectSectionId) => {
    if (!summary) return;
    const text = formatInspectSectionJson(summary, id);
    try {
      await navigator.clipboard.writeText(text);
      flashCopy(`section:${id}`);
      setHint(tr("inspect.copied"));
    } catch (e) {
      setHint(String(e));
    }
  };

  const copyPath = async (path: string, key: string) => {
    const p = path.trim();
    if (!p) return;
    try {
      await navigator.clipboard.writeText(p);
      flashCopy(key);
      setHint(tr("inspect.copied"));
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

  const openDocs = async (url: string) => {
    const u = url.trim();
    if (!u) return;
    try {
      if (api.isTauri()) {
        await api.openExternalUrl(u);
      } else {
        window.open(u, "_blank", "noopener,noreferrer");
      }
      setHint(null);
    } catch (e) {
      setHint(String(e));
    }
  };

  const isExpanded = (id: string) => Boolean(expandedSections[id]);
  const toggleExpanded = (id: string) => {
    setExpandedSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const renderSectionActions = (id: InspectSectionId) => {
    if (!summary) return null;
    const paths = inspectSectionPaths(summary, id);
    const docs = inspectSectionDocsUrl(summary, id);
    const copyKey = `section:${id}`;
    const pathKey = `path:${id}`;
    return (
      <div className="pi-section__actions">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => void copySection(id)}
          title={tr("inspect.copySection")}
          aria-label={tr("inspect.copySection")}
        >
          <IconCopy size={13} />
          <span>
            {copiedSection === copyKey
              ? tr("inspect.copied")
              : tr("inspect.copySection")}
          </span>
        </button>
        {paths[0] ? (
          <>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => void copyPath(paths[0]!, pathKey)}
              title={paths[0]}
              aria-label={tr("inspect.copyPath")}
            >
              <IconCopy size={13} />
              <span>
                {copiedSection === pathKey
                  ? tr("inspect.copied")
                  : tr("inspect.copyPath")}
              </span>
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => void revealPath(paths[0])}
              title={paths[0]}
              aria-label={tr("inspect.revealPath")}
            >
              <IconFolder size={13} />
              <span>{tr("inspect.revealPath")}</span>
            </button>
          </>
        ) : null}
        {docs ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void openDocs(docs)}
            title={docs}
            aria-label={tr("inspect.openDocs")}
          >
            <IconExternalLink size={13} />
            <span>{tr("inspect.openDocs")}</span>
          </button>
        ) : null}
      </div>
    );
  };

  const renderExpandToggle = (sectionId: string, hidden: number) => {
    if (hidden <= 0 && !isExpanded(sectionId)) return null;
    const expanded = isExpanded(sectionId);
    return (
      <button
        type="button"
        className="btn btn--ghost btn--sm pi-expand"
        onClick={() => toggleExpanded(sectionId)}
      >
        {expanded ? (
          <IconChevronDown size={14} />
        ) : (
          <IconChevronRight size={14} />
        )}
        <span>
          {expanded
            ? tr("inspect.collapse")
            : tr("inspect.expandMore", { n: hidden })}
        </span>
      </button>
    );
  };

  return (
    <div className="pi-panel" data-testid="project-inspect-panel">
      {!hideHeader ? (
        <div
          className="settings-row settings-row--stack"
          style={{ borderBottom: "none", paddingBottom: 0 }}
        >
          <div className="settings-row__text">
            <div className="settings-row__label">{tr("inspect.title")}</div>
            <div className="settings-row__desc">{tr("inspect.desc")}</div>
          </div>
        </div>
      ) : null}

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
                        agents: counts.agents,
                        hooks: counts.hooks,
                      })
                    : "—"}
                </Fact>
              </div>

              {sectionCounts && sectionCounts.all > 0 && (
                <div
                  className="pi-section-chips"
                  role="tablist"
                  aria-label={tr("inspect.chipsLabel")}
                >
                  {INSPECT_SECTION_IDS.map((id) => {
                    const n = sectionCounts[id];
                    // Hide zero-count chips except "all" and the active selection.
                    if (id !== "all" && n === 0 && sectionFilter !== id) {
                      return null;
                    }
                    return (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={sectionFilter === id}
                        className={
                          "pi-section-chip" +
                          (sectionFilter === id ? " is-active" : "")
                        }
                        onClick={() => setSectionFilter(id)}
                      >
                        <span>{sectionChipLabel(id, tr)}</span>
                        <span className="pi-section-chip__count">{n}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {sectionFilter !== "all" && visibleSections.length === 0 && (
                <div className="pi-empty-filter" role="status">
                  <p className="pi-empty__body">{tr("inspect.filterEmpty")}</p>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setSectionFilter("all")}
                  >
                    {tr("inspect.clearFilter")}
                  </button>
                </div>
              )}

              {visibleSections.includes("models") &&
                summary.modelsHints.length > 0 && (
                  <div className="pi-section" data-section="models">
                    <div className="pi-section__head">
                      <div className="pi-section__title">
                        {tr("inspect.section.models")}
                      </div>
                      {renderSectionActions("models")}
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

              {visibleSections.includes("rules") && summary.rules.length > 0 && (
                <div className="pi-section" data-section="rules">
                  <div className="pi-section__head">
                    <div className="pi-section__title">
                      {tr("inspect.section.rules")}
                    </div>
                    {renderSectionActions("rules")}
                  </div>
                  {(() => {
                    const win = sliceInspectList(summary.rules, {
                      limit: LIST_PREVIEW,
                      expanded: isExpanded("rules"),
                    });
                    return (
                      <>
                        <ul className="pi-list">
                          {win.visible.map((r) => (
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
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                onClick={() =>
                                  void copyPath(r.path, `rule:${r.path}`)
                                }
                                title={tr("inspect.copyPath")}
                                aria-label={tr("inspect.copyPath")}
                              >
                                <IconCopy size={13} />
                              </button>
                            </li>
                          ))}
                        </ul>
                        {renderExpandToggle("rules", win.hidden)}
                      </>
                    );
                  })()}
                </div>
              )}

              {visibleSections.includes("plugins") &&
                summary.plugins.length > 0 && (
                  <div className="pi-section" data-section="plugins">
                    <div className="pi-section__head">
                      <div className="pi-section__title">
                        {tr("inspect.section.plugins", {
                          n: summary.plugins.length,
                        })}
                      </div>
                      {renderSectionActions("plugins")}
                    </div>
                    {(() => {
                      const win = sliceInspectList(summary.plugins, {
                        limit: LIST_PREVIEW,
                        expanded: isExpanded("plugins"),
                      });
                      return (
                        <>
                          <ul className="pi-list">
                            {win.visible.map((p) => (
                              <li
                                key={`${p.name}:${p.path ?? ""}`}
                                className="pi-list__row"
                              >
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
                                {p.provides && (
                                  <span className="pi-list__meta">
                                    {tr("inspect.plugin.provides", {
                                      skills: p.provides.skills,
                                      agents: p.provides.agents,
                                      mcp: p.provides.mcpServers,
                                      hooks: p.provides.hooks
                                        ? tr("inspect.yes")
                                        : tr("inspect.no"),
                                    })}
                                  </span>
                                )}
                                {p.path && (
                                  <button
                                    type="button"
                                    className="btn btn--ghost btn--sm"
                                    title={p.path}
                                    onClick={() => void revealPath(p.path)}
                                    aria-label={tr("inspect.revealPath")}
                                  >
                                    <IconFolder size={13} />
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                          {renderExpandToggle("plugins", win.hidden)}
                        </>
                      );
                    })()}
                  </div>
                )}

              {visibleSections.includes("mcp") && summary.mcp.length > 0 && (
                <div className="pi-section" data-section="mcp">
                  <div className="pi-section__head">
                    <div className="pi-section__title">
                      {tr("inspect.section.mcp", { n: summary.mcp.length })}
                    </div>
                    {renderSectionActions("mcp")}
                  </div>
                  {(() => {
                    const win = sliceInspectList(summary.mcp, {
                      limit: LIST_PREVIEW,
                      expanded: isExpanded("mcp"),
                    });
                    return (
                      <>
                        <ul className="pi-list">
                          {win.visible.map((m) => (
                            <li key={m.name} className="pi-list__row">
                              <span className="pi-list__name">{m.name}</span>
                              {m.transport && (
                                <span className="ext-badge ext-badge--muted">
                                  {m.transport}
                                </span>
                              )}
                              {m.source && (
                                <span className="ext-badge ext-badge--muted">
                                  {m.source}
                                </span>
                              )}
                              {m.target && (
                                <span
                                  className="pi-list__meta"
                                  title={m.target}
                                >
                                  {shortPathLabel(m.target, 36)}
                                </span>
                              )}
                              {m.target &&
                                (m.target.includes("/") ||
                                  m.target.includes("\\")) &&
                                !/^https?:\/\//i.test(m.target) && (
                                  <button
                                    type="button"
                                    className="btn btn--ghost btn--sm"
                                    title={m.target}
                                    onClick={() => void revealPath(m.target)}
                                    aria-label={tr("inspect.revealPath")}
                                  >
                                    <IconFolder size={13} />
                                  </button>
                                )}
                            </li>
                          ))}
                        </ul>
                        {renderExpandToggle("mcp", win.hidden)}
                      </>
                    );
                  })()}
                </div>
              )}

              {visibleSections.includes("skills") &&
                summary.skills.total > 0 && (
                  <div className="pi-section" data-section="skills">
                    <div className="pi-section__head">
                      <div className="pi-section__title">
                        {tr("inspect.section.skills", {
                          total: summary.skills.total,
                          invocable: summary.skills.userInvocable,
                        })}
                      </div>
                      {renderSectionActions("skills")}
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
                    {(() => {
                      const names =
                        summary.skills.names.length > 0
                          ? summary.skills.names
                          : summary.skills.sample;
                      const win = sliceInspectList(names, {
                        limit: LIST_PREVIEW,
                        expanded: isExpanded("skills"),
                      });
                      return (
                        <>
                          {win.visible.length > 0 && (
                            <div className="pi-chips pi-chips--names">
                              {win.visible.map((name) => (
                                <span key={name} className="ext-badge">
                                  {name}
                                </span>
                              ))}
                            </div>
                          )}
                          {renderExpandToggle("skills", win.hidden)}
                        </>
                      );
                    })()}
                  </div>
                )}

              {visibleSections.includes("hooks") &&
                (summary.hooks.length > 0 || summary.hooksCount > 0) && (
                  <div className="pi-section" data-section="hooks">
                    <div className="pi-section__head">
                      <div className="pi-section__title">
                        {tr("inspect.section.hooks", {
                          n: summary.hooksCount || summary.hooks.length,
                        })}
                      </div>
                      {renderSectionActions("hooks")}
                    </div>
                    {summary.hooks.length === 0 ? (
                      <p className="pi-sample">
                        {tr("inspect.hooks.countOnly", {
                          n: summary.hooksCount,
                        })}
                      </p>
                    ) : (
                      (() => {
                        const win = sliceInspectList(summary.hooks, {
                          limit: LIST_PREVIEW,
                          expanded: isExpanded("hooks"),
                        });
                        return (
                          <>
                            <ul className="pi-list">
                              {win.visible.map((h, i) => (
                                <li
                                  key={`${h.event ?? ""}:${h.target ?? i}`}
                                  className="pi-list__row"
                                >
                                  <span className="pi-list__name">
                                    {h.event || h.hookType || "hook"}
                                  </span>
                                  {h.hookType && h.event && (
                                    <span className="ext-badge ext-badge--muted">
                                      {h.hookType}
                                    </span>
                                  )}
                                  {h.source && (
                                    <span className="ext-badge ext-badge--muted">
                                      {h.source}
                                    </span>
                                  )}
                                  {h.matcher && (
                                    <span className="pi-list__meta">
                                      {h.matcher}
                                    </span>
                                  )}
                                  {h.target && (
                                    <>
                                      <span
                                        className="pi-list__meta"
                                        title={h.target}
                                      >
                                        {shortPathLabel(h.target, 40)}
                                      </span>
                                      {(h.target.includes("/") ||
                                        h.target.includes("\\")) &&
                                        !/^https?:\/\//i.test(h.target) && (
                                          <button
                                            type="button"
                                            className="btn btn--ghost btn--sm"
                                            title={h.target}
                                            onClick={() =>
                                              void revealPath(h.target)
                                            }
                                            aria-label={tr("inspect.revealPath")}
                                          >
                                            <IconFolder size={13} />
                                          </button>
                                        )}
                                    </>
                                  )}
                                </li>
                              ))}
                            </ul>
                            {renderExpandToggle("hooks", win.hidden)}
                          </>
                        );
                      })()
                    )}
                  </div>
                )}

              {visibleSections.includes("agents") &&
                summary.agents.length > 0 && (
                  <div className="pi-section" data-section="agents">
                    <div className="pi-section__head">
                      <div className="pi-section__title">
                        {tr("inspect.section.agents", {
                          n: summary.agents.length,
                        })}
                      </div>
                      {renderSectionActions("agents")}
                    </div>
                    {(() => {
                      const win = sliceInspectList(summary.agents, {
                        limit: LIST_PREVIEW,
                        expanded: isExpanded("agents"),
                      });
                      return (
                        <>
                          <div className="pi-chips">
                            {win.visible.map((a) => (
                              <span key={a.name} className="ext-badge">
                                {a.name}
                                {a.source ? ` (${a.source})` : ""}
                              </span>
                            ))}
                          </div>
                          {renderExpandToggle("agents", win.hidden)}
                        </>
                      );
                    })()}
                  </div>
                )}

              {visibleSections.includes("config") &&
                summary.configLayers.length > 0 && (
                  <div className="pi-section" data-section="config">
                    <div className="pi-section__head">
                      <div className="pi-section__title">
                        {tr("inspect.section.config")}
                      </div>
                      {renderSectionActions("config")}
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
                            <>
                              <button
                                type="button"
                                className="ext-path-btn"
                                title={c.path}
                                onClick={() => void revealPath(c.path)}
                              >
                                <span>{shortPathLabel(c.path, 52)}</span>
                              </button>
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                onClick={() =>
                                  void copyPath(c.path!, `cfg:${c.path}`)
                                }
                                title={tr("inspect.copyPath")}
                                aria-label={tr("inspect.copyPath")}
                              >
                                <IconCopy size={13} />
                              </button>
                            </>
                          ) : (
                            <span className="pi-list__meta">—</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

              {visibleSections.includes("permissions") &&
                (summary.permissions.loaded > 0 ||
                  summary.permissions.sourcesCount > 0 ||
                  summary.permissions.managedSettingsActive) && (
                  <div className="pi-section" data-section="permissions">
                    <div className="pi-section__head">
                      <div className="pi-section__title">
                        {tr("inspect.section.permissions")}
                      </div>
                      {renderSectionActions("permissions")}
                    </div>
                    <div className="pi-chips">
                      <span className="ext-badge">
                        {tr("inspect.permissions.loaded", {
                          n: summary.permissions.loaded,
                        })}
                      </span>
                      <span className="ext-badge">
                        {tr("inspect.permissions.sources", {
                          n: summary.permissions.sourcesCount,
                        })}
                      </span>
                      {summary.permissions.managedSettingsActive && (
                        <span className="ext-badge">
                          {tr("inspect.permissions.managed")}
                        </span>
                      )}
                    </div>
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

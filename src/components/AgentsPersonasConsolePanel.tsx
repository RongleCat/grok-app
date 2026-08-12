/**
 * Settings → General → Agent: Agents & Personas console.
 * Lists built-in + user + project agents and discovered personas only
 * (CLI `/config-agents` honesty — never invents personas).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import { createT, type Locale, type MessageKey } from "@/i18n";
import {
  IconExternalLink,
  IconFolder,
  IconRefresh,
  IconRobot,
} from "@/components/icons";
import { shortPathLabel } from "@/lib/extensionsUi";
import {
  buildAgentsConsoleEntries,
  buildPersonasConsoleEntries,
  filterAgentCatalog,
  filterPersonaCatalog,
  groupAgentCatalog,
  resolveAgentsConsoleEmptyState,
  resolvePreferredAgentLabel,
  type AgentsConsoleEmptyKind,
  type AgentsConsoleEntry,
  type AgentsConsoleGroup,
  type PersonasConsoleEntry,
} from "@/lib/agentsPersonasConsole";
import {
  classifyPreferredAgentSoftFail,
  preferredAgentApplyNoteKey,
  preferredAgentSoftFailMessageKey,
} from "@/lib/preferredAgentApply";

export type AgentsPersonasConsolePanelProps = {
  locale: Locale;
  projectPath?: string | null;
  /** Preferred agent setting (spawn `--agent`). */
  preferredAgent?: string;
  onPreferredAgent?: (v: string) => void;
  /** Catalog from host `agents_catalog` (built-in + files). */
  agentCatalog?: Array<{ name: string; source: string; path?: string | null }>;
};

type ConsoleTab = "agents" | "personas";

function sourceLabelKey(source: AgentsConsoleGroup | string): MessageKey {
  switch ((source ?? "").trim().toLowerCase()) {
    case "project":
      return "settings.preferredAgent.source.project";
    case "user":
      return "settings.preferredAgent.source.user";
    case "bundled":
      return "settings.preferredAgent.source.bundled";
    case "builtin":
    case "built-in":
    default:
      return "settings.preferredAgent.source.builtin";
  }
}

function sourceTone(
  source: string | null | undefined,
): "user" | "project" | "plugin" | "muted" {
  switch ((source ?? "").trim().toLowerCase()) {
    case "user":
      return "user";
    case "project":
      return "project";
    case "bundled":
    case "builtin":
    case "built-in":
      return "plugin";
    default:
      return "muted";
  }
}

function emptyTitleKey(kind: AgentsConsoleEmptyKind, tab: ConsoleTab): MessageKey {
  if (kind === "host_only") return "settings.agentsPersonas.hostOnly";
  if (kind === "filter") return "settings.agentsPersonas.filterEmpty";
  if (kind === "no_project") return "settings.agentsPersonas.noProject";
  return tab === "personas"
    ? "settings.agentsPersonas.personasEmpty"
    : "settings.agentsPersonas.agentsEmpty";
}

function emptyHintKey(
  kind: AgentsConsoleEmptyKind,
  tab: ConsoleTab,
): MessageKey | null {
  if (kind === "host_only") return "settings.agentsPersonas.hostOnlyHint";
  if (kind === "filter") return "settings.agentsPersonas.filterEmptyHint";
  if (kind === "no_project") return "settings.agentsPersonas.noProjectHint";
  return tab === "personas"
    ? "settings.agentsPersonas.personasEmptyHint"
    : "settings.agentsPersonas.agentsEmptyHint";
}

export function AgentsPersonasConsolePanel({
  locale,
  projectPath = null,
  preferredAgent = "",
  onPreferredAgent,
  agentCatalog = [],
}: AgentsPersonasConsolePanelProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const t = useCallback(
    (k: MessageKey, vars?: Record<string, string | number>) => tr(k, vars),
    [tr],
  );

  const [tab, setTab] = useState<ConsoleTab>("agents");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentsConsoleEntry[]>([]);
  const [personas, setPersonas] = useState<PersonasConsoleEntry[]>([]);
  const [dirs, setDirs] = useState<{
    userAgents: string;
    projectAgents: string | null;
    userPersonas: string;
    projectPersonas: string | null;
  }>({
    userAgents: "",
    projectAgents: null,
    userPersonas: "",
    projectPersonas: null,
  });
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const cwd = (projectPath || "").trim() || null;
  const isTauri = api.isTauri();

  const catalogEntries = useMemo(
    () =>
      (agentCatalog ?? []).map((a) => ({
        name: a.name,
        source: a.source,
        path: a.path ?? null,
      })),
    [agentCatalog],
  );

  const load = useCallback(async () => {
    if (!isTauri) {
      // Soft host_only: still surface built-ins from catalog for preferred select honesty.
      setAgents(buildAgentsConsoleEntries({ catalog: catalogEntries }));
      setPersonas([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.agentsList(cwd);
      setAgents(
        buildAgentsConsoleEntries({
          catalog: catalogEntries,
          discovered: (res.agents ?? []).map((a) => ({
            name: a.name,
            scope: a.scope,
            path: a.path,
            description: a.description ?? null,
          })),
        }),
      );
      setPersonas(
        buildPersonasConsoleEntries(
          (res.personas ?? []).map((p) => ({
            name: p.name,
            scope: p.scope,
            path: p.path,
          })),
        ),
      );
      setDirs({
        userAgents: res.userAgentsDir || "",
        projectAgents: res.projectAgentsDir ?? null,
        userPersonas: res.userPersonasDir || "",
        projectPersonas: res.projectPersonasDir ?? null,
      });
    } catch (e) {
      setAgents(buildAgentsConsoleEntries({ catalog: catalogEntries }));
      setPersonas([]);
      setError(String(e || t("settings.agentsPersonas.error")));
    } finally {
      setLoading(false);
    }
  }, [catalogEntries, cwd, isTauri, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const preferredLabel = useMemo(
    () => resolvePreferredAgentLabel(preferredAgent, agents),
    [preferredAgent, agents],
  );

  const preferredSoftFail = useMemo(
    () => classifyPreferredAgentSoftFail(preferredAgent, agents),
    [preferredAgent, agents],
  );

  const filteredAgents = useMemo(
    () => filterAgentCatalog(agents, query),
    [agents, query],
  );
  const filteredPersonas = useMemo(
    () => filterPersonaCatalog(personas, query),
    [personas, query],
  );

  const grouped = useMemo(
    () => groupAgentCatalog(filteredAgents),
    [filteredAgents],
  );

  const agentsEmpty = useMemo(
    () =>
      resolveAgentsConsoleEmptyState({
        hostAvailable: isTauri,
        totalCount: agents.length,
        filteredCount: filteredAgents.length,
        query,
      }),
    [agents.length, filteredAgents.length, isTauri, query],
  );

  const personasEmpty = useMemo(
    () =>
      resolveAgentsConsoleEmptyState({
        hostAvailable: isTauri,
        totalCount: personas.length,
        filteredCount: filteredPersonas.length,
        query,
      }),
    [filteredPersonas.length, isTauri, personas.length, query],
  );

  const reveal = useCallback(async (path: string | null | undefined) => {
    const p = (path ?? "").trim();
    if (!p || !api.isTauri()) return;
    setActionBusy(p);
    try {
      await api.pathReveal(p);
    } catch (e) {
      setError(String(e));
    } finally {
      setActionBusy(null);
    }
  }, []);

  const openFile = useCallback(async (path: string | null | undefined) => {
    const p = (path ?? "").trim();
    if (!p || !api.isTauri()) return;
    setActionBusy(p);
    try {
      await api.openInEditor({ path: p });
    } catch {
      try {
        await api.pathReveal(p);
      } catch (e2) {
        setError(String(e2));
      }
    } finally {
      setActionBusy(null);
    }
  }, []);

  const renderAgentRows = (rows: AgentsConsoleEntry[]) => (
    <ul className="ext-list settings-agents-personas__list">
      {rows.map((a) => {
        const tone = sourceTone(a.rawSource ?? a.source);
        const key = `${a.source}:${a.name}:${a.path ?? ""}`;
        const isPreferred =
          preferredLabel.kind === "matched" &&
          preferredLabel.name?.toLowerCase() === a.name.toLowerCase();
        return (
          <li key={key} className="ext-item">
            <div className="ext-item__head">
              <strong className="ext-item__name">{a.name}</strong>
              <span className={`ext-badge ext-badge--${tone}`}>
                {t(sourceLabelKey(a.rawSource ?? a.source))}
              </span>
              {isPreferred ? (
                <span className="ext-badge ext-badge--user">
                  {t("settings.agentsPersonas.preferredBadge")}
                </span>
              ) : null}
            </div>
            {a.description ? (
              <p className="ext-item__desc">{a.description}</p>
            ) : null}
            <div className="ext-item__meta">
              {a.path ? (
                <button
                  type="button"
                  className="ext-path-btn"
                  title={a.path}
                  disabled={!!actionBusy}
                  onClick={() => void reveal(a.path)}
                >
                  <IconFolder size={13} />
                  <span>{shortPathLabel(a.path, 42)}</span>
                </button>
              ) : (
                <span className="ext-field-hint">
                  {t("settings.agentsPersonas.builtinNoPath")}
                </span>
              )}
            </div>
            <div className="ext-item__actions">
              {a.path ? (
                <>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={!!actionBusy}
                    onClick={() => void openFile(a.path)}
                  >
                    <IconExternalLink size={13} />
                    <span>{t("settings.agentsPersonas.open")}</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={!!actionBusy}
                    onClick={() => void reveal(a.path)}
                  >
                    <IconFolder size={13} />
                    <span>{t("settings.agentsPersonas.reveal")}</span>
                  </button>
                </>
              ) : null}
              {onPreferredAgent ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={!!actionBusy || isPreferred}
                  onClick={() => onPreferredAgent(a.name)}
                >
                  {isPreferred
                    ? t("settings.agentsPersonas.preferredBadge")
                    : t("settings.agentsPersonas.setPreferred")}
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );

  const emptyKind = tab === "agents" ? agentsEmpty : personasEmpty;
  const showEmpty = !loading && emptyKind != null;

  return (
    <div
      className="settings-agents-personas"
      id="settings-anchor-agentsPersonas"
    >
      <div className="settings-row__text" style={{ marginBottom: 8 }}>
        <div className="settings-row__label">
          <span style={{ marginRight: 6, verticalAlign: -2, display: "inline-flex" }}>
            <IconRobot size={15} />
          </span>
          {t("settings.agentsPersonas.title")}
        </div>
        <div className="settings-row__desc">
          {t("settings.agentsPersonas.desc")}
        </div>
      </div>

      {preferredSoftFail.kind === "invalid_chars" ? (
        <div className="ext-alert ext-alert--error" role="status">
          <div className="ext-alert__title">
            {t(
              preferredAgentSoftFailMessageKey("invalid_chars") as MessageKey,
            )}
          </div>
        </div>
      ) : preferredLabel.kind === "missing" ? (
        <div className="ext-alert ext-alert--error" role="status">
          <div className="ext-alert__title">
            {t("settings.agentsPersonas.preferredMissing", {
              name: preferredLabel.name ?? preferredSoftFail.name ?? "",
            })}
          </div>
          <p className="ext-alert__body">
            {t("settings.agentsPersonas.preferredMissingHint")}
          </p>
        </div>
      ) : preferredLabel.kind === "matched" ? (
        <p className="ext-section-note ext-section-note--top" role="status">
          {t("settings.agentsPersonas.preferredCurrent", {
            name: preferredLabel.name ?? "",
            source: preferredLabel.source
              ? t(sourceLabelKey(preferredLabel.source))
              : t("settings.preferredAgent.source.builtin"),
          })}
        </p>
      ) : (
        <p className="ext-section-note ext-section-note--top" role="status">
          {t("settings.agentsPersonas.preferredDefault")}
        </p>
      )}
      <p className="ext-field-hint" role="note">
        {t(preferredAgentApplyNoteKey() as MessageKey)}
      </p>

      <div
        className="settings-agents-personas__tabs"
        role="tablist"
        aria-label={t("settings.agentsPersonas.title")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "agents"}
          className={
            "settings-agents-personas__tab" +
            (tab === "agents" ? " is-active" : "")
          }
          onClick={() => setTab("agents")}
        >
          {t("settings.agentsPersonas.tab.agents")}
          {!loading ? (
            <span className="ext-count">{agents.length}</span>
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "personas"}
          className={
            "settings-agents-personas__tab" +
            (tab === "personas" ? " is-active" : "")
          }
          onClick={() => setTab("personas")}
        >
          {t("settings.agentsPersonas.tab.personas")}
          {!loading ? (
            <span className="ext-count">{personas.length}</span>
          ) : null}
        </button>
      </div>

      <div className="settings-agents-personas__toolbar">
        <input
          className="settings-input settings-agents-personas__search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("settings.agentsPersonas.searchPlaceholder")}
          aria-label={t("settings.agentsPersonas.searchPlaceholder")}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="settings-agents-personas__actions">
          {query.trim() ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setQuery("")}
            >
              {t("settings.agentsPersonas.clearFilter")}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={loading || !!actionBusy}
            onClick={() => void load()}
          >
            <IconRefresh size={13} />
            <span>
              {loading
                ? t("settings.agentsPersonas.loading")
                : t("settings.agentsPersonas.refresh")}
            </span>
          </button>
        </div>
      </div>

      <div className="ext-folder-actions">
        {tab === "agents" ? (
          <>
            {dirs.userAgents ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={!!actionBusy}
                title={dirs.userAgents}
                onClick={() => void reveal(dirs.userAgents)}
              >
                <IconFolder size={13} />
                <span>{t("settings.agentsPersonas.openUserAgents")}</span>
              </button>
            ) : null}
            {cwd && dirs.projectAgents ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={!!actionBusy}
                title={dirs.projectAgents}
                onClick={() => void reveal(dirs.projectAgents)}
              >
                <IconFolder size={13} />
                <span>{t("settings.agentsPersonas.openProjectAgents")}</span>
              </button>
            ) : (
              <span className="ext-field-hint">
                {t("settings.agentsPersonas.needProjectHint")}
              </span>
            )}
          </>
        ) : (
          <>
            {dirs.userPersonas ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={!!actionBusy}
                title={dirs.userPersonas}
                onClick={() => void reveal(dirs.userPersonas)}
              >
                <IconFolder size={13} />
                <span>{t("settings.agentsPersonas.openUserPersonas")}</span>
              </button>
            ) : isTauri ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={!!actionBusy}
                onClick={() => void load()}
              >
                <IconFolder size={13} />
                <span>{t("settings.agentsPersonas.browsePersonas")}</span>
              </button>
            ) : null}
            {cwd && dirs.projectPersonas ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={!!actionBusy}
                title={dirs.projectPersonas}
                onClick={() => void reveal(dirs.projectPersonas)}
              >
                <IconFolder size={13} />
                <span>{t("settings.agentsPersonas.openProjectPersonas")}</span>
              </button>
            ) : (
              <span className="ext-field-hint">
                {t("settings.agentsPersonas.needProjectHint")}
              </span>
            )}
          </>
        )}
      </div>

      {error ? (
        <div className="ext-alert ext-alert--error" role="alert">
          <div className="ext-alert__title">
            {t("settings.agentsPersonas.error")}
          </div>
          <p className="ext-alert__body">{error}</p>
        </div>
      ) : null}

      {loading ? (
        <p className="ext-empty">{t("settings.agentsPersonas.loading")}</p>
      ) : showEmpty && emptyKind ? (
        <div className="settings-agents-personas__empty" role="status">
          <div className="settings-agents-personas__empty-title">
            {t(emptyTitleKey(emptyKind, tab))}
          </div>
          {emptyHintKey(emptyKind, tab) ? (
            <p className="ext-field-hint">{t(emptyHintKey(emptyKind, tab)!)}</p>
          ) : null}
          {emptyKind === "filter" ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setQuery("")}
            >
              {t("settings.agentsPersonas.clearFilter")}
            </button>
          ) : null}
        </div>
      ) : tab === "agents" ? (
        <div className="settings-agents-personas__groups">
          {grouped.project.length > 0 ? (
            <section>
              <h3 className="settings-agents-personas__group-title">
                {t("settings.preferredAgent.source.project")}
              </h3>
              {renderAgentRows(grouped.project)}
            </section>
          ) : null}
          {grouped.user.length > 0 ? (
            <section>
              <h3 className="settings-agents-personas__group-title">
                {t("settings.preferredAgent.source.user")}
              </h3>
              {renderAgentRows(grouped.user)}
            </section>
          ) : null}
          {grouped.builtin.length > 0 ? (
            <section>
              <h3 className="settings-agents-personas__group-title">
                {t("settings.preferredAgent.source.builtin")}
              </h3>
              {renderAgentRows(grouped.builtin)}
            </section>
          ) : null}
        </div>
      ) : (
        <ul className="ext-list settings-agents-personas__list">
          {filteredPersonas.map((p) => {
            const tone = sourceTone(p.rawSource ?? p.source);
            return (
              <li
                key={`${p.source}:${p.name}:${p.path ?? ""}`}
                className="ext-item"
              >
                <div className="ext-item__head">
                  <strong className="ext-item__name">{p.name}</strong>
                  <span className={`ext-badge ext-badge--${tone}`}>
                    {t(sourceLabelKey(p.rawSource ?? p.source))}
                  </span>
                </div>
                <div className="ext-item__meta">
                  {p.path ? (
                    <button
                      type="button"
                      className="ext-path-btn"
                      title={p.path}
                      disabled={!!actionBusy}
                      onClick={() => void reveal(p.path)}
                    >
                      <IconFolder size={13} />
                      <span>{shortPathLabel(p.path, 42)}</span>
                    </button>
                  ) : null}
                </div>
                {p.path ? (
                  <div className="ext-item__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={!!actionBusy}
                      onClick={() => void openFile(p.path)}
                    >
                      <IconExternalLink size={13} />
                      <span>{t("settings.agentsPersonas.open")}</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={!!actionBusy}
                      onClick={() => void reveal(p.path)}
                    >
                      <IconFolder size={13} />
                      <span>{t("settings.agentsPersonas.reveal")}</span>
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

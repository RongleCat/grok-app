/**
 * Agent-run Kanban page — Orca-style Needs You / Working / Done.
 * Full workbench pane (sidebar → main), not a floating modal.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Locale, MessageKey } from "@/i18n";
import { createT } from "@/i18n";
import { formatRelativeTime } from "@/lib/accountUi";
import { useLiveMap } from "@/hooks/useSessionLiveMap";
import type {
  AgentDashboardProjectInput,
  AgentDashboardSessionInput,
} from "@/lib/agentDashboard";
import type { SessionLiveMap } from "@/lib/sessionLiveStore";
import {
  getFinishedTurns,
  subscribeFinishedTurns,
} from "@/lib/sessionFinishedTurns";
import {
  buildAgentKanban,
  countAgentKanbanCards,
  filterAgentKanban,
  groupAgentKanbanByProject,
  loadAgentKanbanPrefs,
  mergeKanbanLiveMaps,
  saveAgentKanbanPrefs,
  visibleAgentKanbanColumns,
  type AgentKanbanCard,
  type AgentKanbanColumnId,
  type AgentKanbanPrefs,
  type AgentKanbanStorage,
} from "@/lib/kanbanBoard";

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

const COLUMN_LABEL_KEY: Record<AgentKanbanColumnId, MessageKey> = {
  needs_you: "kanban.column.needsYou",
  working: "kanban.column.working",
  done: "kanban.column.done",
  idle: "kanban.column.idle",
};

function columnToneClass(col: AgentKanbanColumnId): string {
  switch (col) {
    case "needs_you":
      return "agent-kanban__col--needs";
    case "working":
      return "agent-kanban__col--working";
    case "done":
      return "agent-kanban__col--done";
    default:
      return "agent-kanban__col--idle";
  }
}

function AgentKanbanCardView({
  card,
  t,
  locale,
  onSelect,
}: {
  card: AgentKanbanCard;
  t: TFn;
  locale: Locale;
  onSelect?: (sessionId: string) => void;
}) {
  const metaParts: string[] = [];
  if (card.projectName) metaParts.push(card.projectName);
  else if (card.projectPath) metaParts.push(card.projectPath);
  const activity =
    card.lastActivityAt > 0
      ? formatRelativeTime(new Date(card.lastActivityAt).toISOString(), locale)
      : null;
  const toolTitle = card.liveToolTitle?.trim() || null;

  return (
    <li
      className={
        "agent-kanban__card" +
        (card.isCurrent ? " is-current" : "") +
        (card.kanbanColumn === "needs_you" ? " is-needs" : "") +
        (card.kanbanColumn === "done" ? " is-done" : "")
      }
    >
      <button
        type="button"
        className="agent-kanban__card-btn"
        onClick={() => onSelect?.(card.sessionId)}
        title={t("dashboard.openSession")}
      >
        <span className="agent-kanban__card-title" title={card.title}>
          {card.title}
        </span>
        {card.isCurrent ? (
          <span className="agent-kanban__card-current">
            {t("dashboard.current")}
          </span>
        ) : null}
        {toolTitle ? (
          <span className="agent-kanban__card-tool" title={toolTitle}>
            {toolTitle}
          </span>
        ) : null}
        {metaParts.length > 0 ? (
          <span className="agent-kanban__card-meta" title={metaParts.join(" · ")}>
            {metaParts.join(" · ")}
          </span>
        ) : null}
        {activity ? (
          <span className="agent-kanban__card-age">
            {t("dashboard.lastActivity", { time: activity })}
          </span>
        ) : null}
      </button>
    </li>
  );
}

export type KanbanBoardPageProps = {
  locale: Locale;
  sessions: AgentDashboardSessionInput[];
  projects: AgentDashboardProjectInput[];
  liveMap: SessionLiveMap;
  currentSessionId?: string | null;
  untitledLabel?: string;
  generalWorkspacePath?: string | null;
  unboundProjectLabel?: string | null;
  onSelectSession?: (sessionId: string) => void;
  storage?: AgentKanbanStorage;
};

export function KanbanBoardPage({
  locale,
  sessions,
  projects,
  liveMap: liveMapProp,
  currentSessionId,
  untitledLabel,
  generalWorkspacePath,
  unboundProjectLabel,
  onSelectSession,
  storage,
}: KanbanBoardPageProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const tFn: TFn = (k, vars) => tr(k, vars);
  // Sidebar busy uses the live-map store. The workbench only feeds liveMap
  // while certain chrome is open — always subscribe here so Working updates.
  const storeLiveMap = useLiveMap();
  const liveMap = mergeKanbanLiveMaps(storeLiveMap, liveMapProp);
  const recentDoneAt = useSyncExternalStore(
    subscribeFinishedTurns,
    getFinishedTurns,
    getFinishedTurns,
  );
  const [prefs, setPrefs] = useState<AgentKanbanPrefs>(() =>
    loadAgentKanbanPrefs(storage),
  );
  const [query, setQuery] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [view, setView] = useState<"dashboard" | "map">("dashboard");

  useEffect(() => {
    setPrefs(loadAgentKanbanPrefs(storage));
  }, [storage]);

  const commitPrefs = (next: AgentKanbanPrefs) => {
    saveAgentKanbanPrefs(next, storage);
    setPrefs(next);
  };

  const board = useMemo(
    () =>
      buildAgentKanban({
        sessions,
        projects,
        liveMap,
        currentSessionId,
        untitledLabel,
        generalWorkspacePath,
        unboundProjectLabel,
        recentDoneAt,
      }),
    [
      sessions,
      projects,
      liveMap,
      currentSessionId,
      untitledLabel,
      generalWorkspacePath,
      unboundProjectLabel,
      recentDoneAt,
    ],
  );

  const columns = visibleAgentKanbanColumns(prefs.showIdle);
  const filtered = useMemo(
    () => filterAgentKanban(board, { query, projectQuery }),
    [board, query, projectQuery],
  );
  const total = countAgentKanbanCards(board, columns);
  const visibleCount = countAgentKanbanCards(filtered, columns);
  const hasFilters =
    query.trim().length > 0 ||
    projectQuery.trim().length > 0 ||
    prefs.showIdle;
  const mapGroups = useMemo(
    () => groupAgentKanbanByProject(filtered, columns),
    [filtered, columns],
  );

  const onOpenCard = (sessionId: string) => {
    onSelectSession?.(sessionId);
  };

  return (
    <div className="auto-page agent-kanban-page">
      <div className="auto-page__head agent-kanban-page__head">
        <div className="auto-page__titles">
          <h1 className="auto-page__title">{tr("kanban.title")}</h1>
          <p className="auto-page__subtitle">
            {tr("kanban.total", { n: total })}
            {" · "}
            {tr("kanban.hint")}
          </p>
        </div>
        <div className="agent-kanban__views" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={view === "dashboard"}
            className={
              "agent-kanban__view-tab" +
              (view === "dashboard" ? " is-active" : "")
            }
            onClick={() => setView("dashboard")}
          >
            {tr("kanban.view.dashboard")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "map"}
            className={
              "agent-kanban__view-tab" + (view === "map" ? " is-active" : "")
            }
            onClick={() => setView("map")}
          >
            {tr("kanban.view.map")}
          </button>
        </div>
      </div>

      <div className="agent-kanban-page__body">
        <div className="agent-kanban__toolbar">
          <input
            type="search"
            className="settings-input agent-kanban__search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("kanban.searchPlaceholder")}
            autoComplete="off"
            spellCheck={false}
            aria-label={tr("kanban.searchPlaceholder")}
          />
          <button
            type="button"
            className={
              "task-board__chip agent-kanban__filter-btn" +
              (filterOpen || hasFilters ? " is-active" : "")
            }
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((v) => !v)}
          >
            {tr("kanban.filter")}
          </button>
        </div>

        {filterOpen ? (
          <div className="agent-kanban__filters" role="group">
            <p className="agent-kanban__filters-title">
              {tr("kanban.filterTitle")}
            </p>
            <input
              type="search"
              className="settings-input"
              value={projectQuery}
              onChange={(e) => setProjectQuery(e.target.value)}
              placeholder={tr("taskBoard.projectSearchPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              aria-label={tr("taskBoard.projectSearchPlaceholder")}
            />
            <button
              type="button"
              role="switch"
              aria-checked={prefs.showIdle}
              className={
                "task-board__chip" + (prefs.showIdle ? " is-active" : "")
              }
              onClick={() =>
                commitPrefs({ ...prefs, showIdle: !prefs.showIdle })
              }
            >
              {tr("kanban.showIdle")}
            </button>
            {hasFilters ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  setQuery("");
                  setProjectQuery("");
                  commitPrefs({ ...prefs, showIdle: false });
                }}
              >
                {tr("kanban.clearFilters")}
              </button>
            ) : null}
          </div>
        ) : null}

        {visibleCount === 0 && (query.trim() || projectQuery.trim()) ? (
          <div className="task-board__empty">
            <p className="task-board__empty-title">
              {tr("kanban.filterEmpty")}
            </p>
            <p className="task-board__empty-hint">
              {tr("kanban.filterEmptyHint")}
            </p>
          </div>
        ) : view === "map" ? (
          <div className="agent-kanban__map" aria-label={tr("kanban.view.map")}>
            {mapGroups.length === 0 ? (
              <p className="task-board__col-empty">{tr("kanban.mapEmpty")}</p>
            ) : (
              mapGroups.map((group) => (
                <section key={group.key} className="agent-kanban__map-group">
                  <header className="agent-kanban__map-head">
                    <span className="agent-kanban__map-name">
                      {group.name || tr("kanban.unboundProject")}
                    </span>
                    <span className="agent-kanban__col-count">
                      {group.cards.length}
                    </span>
                  </header>
                  <ul className="agent-kanban__cards" role="list">
                    {group.cards.map((card) => (
                      <AgentKanbanCardView
                        key={card.sessionId}
                        card={card}
                        t={tFn}
                        locale={locale}
                        onSelect={onOpenCard}
                      />
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
        ) : (
          <div
            className="agent-kanban__columns"
            role="list"
            aria-label={tr("kanban.columnsLabel")}
          >
            {columns.map((colId) => {
              const cards = filtered[colId];
              const label = tr(COLUMN_LABEL_KEY[colId]);
              return (
                <section
                  key={colId}
                  className={"agent-kanban__col " + columnToneClass(colId)}
                  role="listitem"
                  aria-label={label}
                >
                  <header className="agent-kanban__col-head">
                    <span className="agent-kanban__col-title">{label}</span>
                    <span className="agent-kanban__col-count">
                      {cards.length}
                    </span>
                  </header>
                  {cards.length === 0 ? (
                    <p className="agent-kanban__none">{tr("kanban.none")}</p>
                  ) : (
                    <ul className="agent-kanban__cards" role="list">
                      {cards.map((card) => (
                        <AgentKanbanCardView
                          key={card.sessionId}
                          card={card}
                          t={tFn}
                          locale={locale}
                          onSelect={onOpenCard}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

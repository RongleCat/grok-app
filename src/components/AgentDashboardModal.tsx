/**
 * Cross-session Agent Dashboard — status of active/recent App sessions.
 * Distinct from AgentTasksPanel (per-turn tools for the focused chat).
 */

import { useEffect, useMemo, useState } from "react";
import type { Locale, MessageKey } from "@/i18n";
import { createT } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import { Select } from "@/components/Select";
import { xEvidenceStats, type XEvidenceStats } from "@/lib/api";
import {
  AGENT_DASHBOARD_STATUS_FILTERS,
  buildDashboardPeekModel,
  countBusyDashboardRows,
  countDashboardRowsByStatus,
  filterAgentDashboardRows,
  filterStoppableAmongSelection,
  planDashboardDispatch,
  stoppableDashboardRows,
  stoppableSelectedSessionIds,
  trustedDashboardDispatchProjects,
  type AgentDashboardRow,
  type AgentDashboardStatus,
  type AgentDashboardStatusFilter,
  type DashboardDispatchProject,
  type DashboardPeekModel,
} from "@/lib/agentDashboard";
import { formatRelativeTime } from "@/lib/accountUi";
import { pruneSelectedIds, toggleIdInSet } from "@/lib/sessionSelect";

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

function statusLabel(status: AgentDashboardStatus, t: TFn): string {
  switch (status) {
    case "busy":
      return t("dashboard.status.busy");
    case "permission":
      return t("dashboard.status.permission");
    case "connecting":
      return t("dashboard.status.connecting");
    case "error":
      return t("dashboard.status.error");
    default:
      return t("dashboard.status.idle");
  }
}

function statusFilterLabel(
  filter: AgentDashboardStatusFilter,
  t: TFn,
): string {
  if (filter === "all") return t("dashboard.filter.all");
  return statusLabel(filter, t);
}

function statusDotClass(status: AgentDashboardStatus): string {
  switch (status) {
    case "busy":
    case "connecting":
      return "agent-dash__dot--busy";
    case "permission":
      return "agent-dash__dot--perm";
    case "error":
      return "agent-dash__dot--error";
    default:
      return "agent-dash__dot--idle";
  }
}

function statusBadgeClass(status: AgentDashboardStatus): string {
  switch (status) {
    case "busy":
      return "agent-dash__status-badge--busy";
    case "permission":
      return "agent-dash__status-badge--perm";
    case "connecting":
      return "agent-dash__status-badge--connecting";
    case "error":
      return "agent-dash__status-badge--error";
    default:
      return "agent-dash__status-badge--idle";
  }
}

function PeekCard({
  peek,
  t,
  locale,
  onOpen,
}: {
  peek: DashboardPeekModel;
  t: TFn;
  locale: Locale;
  onOpen?: () => void;
}) {
  const activity =
    peek.lastActivityAt > 0
      ? formatRelativeTime(new Date(peek.lastActivityAt).toISOString(), locale)
      : null;

  return (
    <div className="agent-dash__peek" role="region" aria-label={t("dashboard.peek.label")}>
      <div className="agent-dash__peek-grid">
        <div className="agent-dash__peek-row">
          <span className="agent-dash__peek-k">{t("dashboard.peek.status")}</span>
          <span className="agent-dash__peek-v">
            <span
              className={
                "agent-dash__status-badge " + statusBadgeClass(peek.status)
              }
            >
              {statusLabel(peek.status, t)}
            </span>
          </span>
        </div>
        <div className="agent-dash__peek-row">
          <span className="agent-dash__peek-k">{t("dashboard.peek.tool")}</span>
          <span className="agent-dash__peek-v" title={peek.toolTitle || undefined}>
            {peek.toolTitle || t("dashboard.peek.noTool")}
          </span>
        </div>
        {peek.projectName || peek.projectPath ? (
          <div className="agent-dash__peek-row">
            <span className="agent-dash__peek-k">
              {t("dashboard.peek.project")}
            </span>
            <span
              className="agent-dash__peek-v"
              title={peek.projectPath || peek.projectName || undefined}
            >
              {peek.projectName || peek.projectPath}
              {peek.projectName && peek.projectPath ? (
                <span className="agent-dash__peek-path">{peek.projectPath}</span>
              ) : null}
            </span>
          </div>
        ) : null}
        {peek.modelId ? (
          <div className="agent-dash__peek-row">
            <span className="agent-dash__peek-k">{t("dashboard.peek.model")}</span>
            <span className="agent-dash__peek-v">
              {peek.modelId}
              {peek.effort ? ` · ${peek.effort}` : ""}
            </span>
          </div>
        ) : null}
        {activity ? (
          <div className="agent-dash__peek-row">
            <span className="agent-dash__peek-k">
              {t("dashboard.peek.activity")}
            </span>
            <span className="agent-dash__peek-v">{activity}</span>
          </div>
        ) : null}
      </div>
      {peek.canOpen && onOpen ? (
        <div className="agent-dash__peek-actions">
          <button
            type="button"
            className="btn btn--solid btn--sm"
            onClick={onOpen}
          >
            {t("dashboard.peek.openChat")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DashboardRow({
  row,
  t,
  locale,
  selected,
  expanded,
  onToggleSelect,
  onTogglePeek,
  onSelect,
}: {
  row: AgentDashboardRow;
  t: TFn;
  locale: Locale;
  selected: boolean;
  expanded: boolean;
  onToggleSelect: (sessionId: string) => void;
  onTogglePeek: (sessionId: string) => void;
  onSelect?: (sessionId: string) => void;
}) {
  const metaParts: string[] = [];
  if (row.projectName) metaParts.push(row.projectName);
  else if (row.projectPath) metaParts.push(row.projectPath);
  if (row.modelId) metaParts.push(row.modelId);
  if (row.effort) metaParts.push(row.effort);

  const activity =
    row.lastActivityAt > 0
      ? formatRelativeTime(new Date(row.lastActivityAt).toISOString(), locale)
      : null;

  const cwd = row.projectPath || null;
  const toolTitle = row.liveToolTitle?.trim() || null;
  const peek = expanded ? buildDashboardPeekModel(row) : null;

  return (
    <li
      className={
        "agent-dash__row" +
        (row.isCurrent ? " is-current" : "") +
        (row.stoppable ? " is-busy" : "") +
        (selected ? " is-selected" : "") +
        (expanded ? " is-expanded" : "") +
        (row.status === "permission" ? " is-permission" : "")
      }
    >
      <div className="agent-dash__row-inner">
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          className={
            "agent-dash__check" + (selected ? " is-on" : "")
          }
          aria-label={
            selected
              ? t("dashboard.deselectRow", { title: row.title })
              : t("dashboard.selectRow", { title: row.title })
          }
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(row.sessionId);
          }}
        >
          <span className="agent-dash__check-box" aria-hidden>
            {selected ? "✓" : ""}
          </span>
        </button>
        <button
          type="button"
          className="agent-dash__row-main"
          onClick={() => onSelect?.(row.sessionId)}
          title={t("dashboard.openSession")}
        >
          <span
            className={`agent-dash__dot ${statusDotClass(row.status)}`}
            aria-hidden
          />
          <span className="agent-dash__body">
            <span className="agent-dash__title-line">
              <span className="agent-dash__title" title={row.title}>
                {row.title}
              </span>
              {row.isCurrent ? (
                <span className="agent-dash__current">
                  {t("dashboard.current")}
                </span>
              ) : null}
              <span
                className={
                  "agent-dash__status-badge " + statusBadgeClass(row.status)
                }
              >
                {statusLabel(row.status, t)}
              </span>
            </span>
            {toolTitle ? (
              <span className="agent-dash__tool is-live" title={toolTitle}>
                <span className="agent-dash__tool-label">
                  {t("dashboard.toolLabel")}
                </span>
                <span className="agent-dash__tool-name">{toolTitle}</span>
              </span>
            ) : null}
            {metaParts.length > 0 ? (
              <span className="agent-dash__meta" title={metaParts.join(" · ")}>
                {metaParts.join(" · ")}
              </span>
            ) : null}
            {cwd ? (
              <span className="agent-dash__cwd" title={cwd}>
                {cwd}
              </span>
            ) : null}
            {activity ? (
              <span className="agent-dash__activity">
                {t("dashboard.lastActivity", { time: activity })}
              </span>
            ) : null}
          </span>
        </button>
        <button
          type="button"
          className={
            "agent-dash__peek-toggle" + (expanded ? " is-open" : "")
          }
          aria-expanded={expanded}
          aria-label={
            expanded
              ? t("dashboard.peek.collapse", { title: row.title })
              : t("dashboard.peek.expand", { title: row.title })
          }
          title={
            expanded
              ? t("dashboard.peek.collapse", { title: row.title })
              : t("dashboard.peek.expand", { title: row.title })
          }
          onClick={(e) => {
            e.stopPropagation();
            onTogglePeek(row.sessionId);
          }}
        >
          <span className="agent-dash__peek-chevron" aria-hidden>
            {expanded ? "▾" : "▸"}
          </span>
        </button>
      </div>
      {peek ? (
        <PeekCard
          peek={peek}
          t={t}
          locale={locale}
          onOpen={
            peek.canOpen
              ? () => onSelect?.(row.sessionId)
              : undefined
          }
        />
      ) : null}
    </li>
  );
}

export type AgentDashboardModalProps = {
  open: boolean;
  locale: Locale;
  rows: AgentDashboardRow[];
  /** Trusted-project catalog for single dispatch (optional). */
  projects?: readonly DashboardDispatchProject[];
  onClose: () => void;
  onSelectSession?: (sessionId: string) => void;
  /**
   * Reuse App stop-all (confirm lives in App).
   * Stops **all** busy sessions globally — not only the currently filtered list.
   */
  onStopAllBusy?: () => void;
  /**
   * Stop the given session ids (already filtered to stoppable).
   * Confirm / toast lives in App.
   */
  onStopSessions?: (sessionIds: string[]) => void;
  /** Open multi-project batch agents dispatch. */
  onOpenBatchAgents?: () => void;
  /**
   * Single-project dispatch: App creates/opens a chat and fills the composer.
   * Soft-fail toasts live in App.
   */
  onDispatchAgent?: (opts: { projectId: string; prompt: string }) => void;
  /** Open session task board (status columns). */
  onOpenTaskBoard?: () => void;
};

export function AgentDashboardModal({
  open,
  locale,
  rows,
  projects = [],
  onClose,
  onSelectSession,
  onStopAllBusy,
  onStopSessions,
  onOpenBatchAgents,
  onDispatchAgent,
  onOpenTaskBoard,
}: AgentDashboardModalProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [query, setQuery] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<AgentDashboardStatusFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [peekedId, setPeekedId] = useState<string | null>(null);
  const [dispatchProjectId, setDispatchProjectId] = useState("");
  const [dispatchPrompt, setDispatchPrompt] = useState("");
  const [dispatchHint, setDispatchHint] = useState<MessageKey | null>(null);
  // X Evidence Rail counters (today's new evidence / this week's quote packs).
  // Absent backend (mock mode) or empty store → hide the block silently.
  const [evidence, setEvidence] = useState<XEvidenceStats | null>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    xEvidenceStats()
      .then((s) => {
        if (!cancelled) setEvidence(s);
      })
      .catch(() => {
        if (!cancelled) setEvidence(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const trustedProjects = useMemo(
    () => trustedDashboardDispatchProjects(projects),
    [projects],
  );

  // Default dispatch project to first trusted when catalog changes / opens.
  useEffect(() => {
    if (!open) return;
    setDispatchProjectId((prev) => {
      if (prev && trustedProjects.some((p) => p.id === prev)) return prev;
      return trustedProjects[0]?.id ?? "";
    });
  }, [open, trustedProjects]);

  const filtered = useMemo(
    () =>
      filterAgentDashboardRows(rows, {
        query,
        projectQuery,
        status: statusFilter,
      }),
    [rows, query, projectQuery, statusFilter],
  );
  const statusCounts = useMemo(() => countDashboardRowsByStatus(rows), [rows]);
  const busyCount = useMemo(() => countBusyDashboardRows(rows), [rows]);
  // Stop-all targets every stoppable row in the dashboard, not only the filter.
  const stoppable = useMemo(() => stoppableDashboardRows(rows), [rows]);
  const showStopAll = !!onStopAllBusy && stoppable.length > 0;

  const filteredIds = useMemo(
    () => new Set(filtered.map((r) => r.sessionId)),
    [filtered],
  );

  // Drop selections that left the catalog (session ended / archived idle).
  useEffect(() => {
    const live = new Set(rows.map((r) => r.sessionId));
    setSelectedIds((prev) => pruneSelectedIds(prev, live));
    setPeekedId((prev) => (prev && live.has(prev) ? prev : null));
  }, [rows]);

  // Clear multi-select / peek / dispatch draft when the modal closes.
  useEffect(() => {
    if (!open) {
      setSelectedIds(new Set());
      setPeekedId(null);
      setDispatchPrompt("");
      setDispatchHint(null);
    }
  }, [open]);

  const selectedStoppable = useMemo(
    () => filterStoppableAmongSelection(rows, selectedIds),
    [rows, selectedIds],
  );
  const selectedStoppableCount = selectedStoppable.length;
  const showStopSelected =
    !!onStopSessions && selectedStoppableCount > 0;

  const visibleSelectedCount = useMemo(() => {
    let n = 0;
    for (const id of selectedIds) {
      if (filteredIds.has(id)) n += 1;
    }
    return n;
  }, [selectedIds, filteredIds]);

  const allVisibleSelected =
    filtered.length > 0 && visibleSelectedCount === filtered.length;
  const someVisibleSelected =
    visibleSelectedCount > 0 && !allVisibleSelected;

  const hasActiveFilters =
    statusFilter !== "all" ||
    query.trim().length > 0 ||
    projectQuery.trim().length > 0;
  const isEmptyCatalog = rows.length === 0;
  const isEmptyFilter = !isEmptyCatalog && filtered.length === 0;

  const toggleRow = (sessionId: string) => {
    setSelectedIds((prev) => toggleIdInSet(prev, sessionId));
  };

  const togglePeek = (sessionId: string) => {
    setPeekedId((prev) => (prev === sessionId ? null : sessionId));
  };

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      if (allVisibleSelected) {
        // Deselect only currently visible rows.
        const next = new Set(prev);
        for (const id of filteredIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of filteredIds) next.add(id);
      return next;
    });
  };

  const handleStopSelected = () => {
    if (!onStopSessions) return;
    const ids = stoppableSelectedSessionIds(rows, selectedIds);
    if (!ids.length) return;
    onStopSessions(ids);
    // Clear selection after dispatch so the footer doesn't stale-count.
    setSelectedIds(new Set());
  };

  const handleDispatch = () => {
    if (!onDispatchAgent) return;
    const plan = planDashboardDispatch({
      projectId: dispatchProjectId,
      prompt: dispatchPrompt,
      projects,
    });
    if (!plan.ok) {
      const key: MessageKey =
        plan.reason === "empty_prompt"
          ? "dashboard.dispatch.emptyPrompt"
          : plan.reason === "untrusted"
            ? "dashboard.dispatch.untrusted"
            : plan.reason === "no_trusted_project"
              ? "dashboard.dispatch.noTrusted"
              : "dashboard.dispatch.noProject";
      setDispatchHint(key);
      return;
    }
    setDispatchHint(null);
    onDispatchAgent({ projectId: plan.project.id, prompt: plan.prompt });
    setDispatchPrompt("");
  };

  const showDispatch = !!onDispatchAgent;

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      title={tr("dashboard.title")}
      titleId="agent-dashboard-title"
      closeLabel={tr("common.close")}
      size="lg"
      className="agent-dash-modal"
      wrapBody
      bodyClassName="agent-dash-modal__body"
      footer={
        <div className="agent-dash-modal__footer">
          <div className="agent-dash-modal__footer-actions">
            {onOpenTaskBoard ? (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={onOpenTaskBoard}
                title={tr("dashboard.openBoardTitle")}
              >
                {tr("dashboard.openBoard")}
              </button>
            ) : null}
            {onOpenBatchAgents ? (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={onOpenBatchAgents}
                title={tr("dashboard.batchAgentsTitle")}
              >
                {tr("dashboard.batchAgents")}
              </button>
            ) : null}
            {showStopSelected ? (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={handleStopSelected}
                title={tr("dashboard.stopSelectedTitle", {
                  n: selectedStoppableCount,
                })}
              >
                {tr("dashboard.stopSelected", { n: selectedStoppableCount })}
              </button>
            ) : null}
            {showStopAll ? (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={onStopAllBusy}
                title={tr("dashboard.stopAllTitle")}
              >
                {tr("dashboard.stopAll")}
              </button>
            ) : null}
          </div>
          <button type="button" className="btn btn--solid" onClick={onClose}>
            {tr("common.close")}
          </button>
        </div>
      }
    >
      <p className="agent-dash__hint">{tr("dashboard.hint")}</p>
      {showDispatch ? (
        <div className="agent-dash__dispatch" aria-label={tr("dashboard.dispatch.title")}>
          <div className="agent-dash__dispatch-head">
            <span className="agent-dash__dispatch-title">
              {tr("dashboard.dispatch.title")}
            </span>
          </div>
          {trustedProjects.length === 0 ? (
            <p className="agent-dash__dispatch-empty">
              {tr("dashboard.dispatch.noTrusted")}
            </p>
          ) : (
            <>
              <div className="agent-dash__dispatch-row">
                <span className="agent-dash__dispatch-label" id="agent-dash-dispatch-project-label">
                  {tr("dashboard.dispatch.projectLabel")}
                </span>
                <Select
                  value={dispatchProjectId}
                  options={trustedProjects.map((p) => ({
                    value: p.id,
                    label: p.name || p.path || p.id,
                  }))}
                  onChange={(v) => {
                    setDispatchProjectId(v);
                    setDispatchHint(null);
                  }}
                  aria-label={tr("dashboard.dispatch.projectLabel")}
                  className="agent-dash__dispatch-select"
                />
              </div>
              <textarea
                className="settings-input agent-dash__dispatch-prompt"
                value={dispatchPrompt}
                onChange={(e) => {
                  setDispatchPrompt(e.target.value);
                  setDispatchHint(null);
                }}
                placeholder={tr("dashboard.dispatch.promptPlaceholder")}
                rows={2}
                spellCheck={false}
                aria-label={tr("dashboard.dispatch.promptPlaceholder")}
              />
              <div className="agent-dash__dispatch-actions">
                <button
                  type="button"
                  className="btn btn--solid btn--sm"
                  onClick={handleDispatch}
                  disabled={!dispatchPrompt.trim()}
                  title={tr("dashboard.dispatch.buttonTitle")}
                >
                  {tr("dashboard.dispatch.button")}
                </button>
                {dispatchHint ? (
                  <span className="agent-dash__dispatch-hint" role="status">
                    {tr(dispatchHint)}
                  </span>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}
      {evidence && evidence.total > 0 ? (
        <div
          className="agent-dash__evidence"
          title={tr("dashboard.evidence.hint")}
        >
          <span className="agent-dash__evidence-title">
            {tr("dashboard.evidence.title")}
          </span>
          <span className="agent-dash__evidence-stat">
            {tr("dashboard.evidence.todayNew", { n: evidence.todayNew })}
          </span>
          <span className="agent-dash__evidence-stat">
            {tr("dashboard.evidence.weekPacks", { n: evidence.weekPacks })}
          </span>
          <span className="agent-dash__evidence-stat agent-dash__evidence-stat--dim">
            {tr("dashboard.evidence.total", { n: evidence.total })}
          </span>
        </div>
      ) : null}
      <div
        className="agent-dash__chips"
        role="tablist"
        aria-label={tr("dashboard.filter.statusLabel")}
      >
        {AGENT_DASHBOARD_STATUS_FILTERS.map((id) => {
          const n = statusCounts[id];
          // Hide zero-count status chips except "all" and the active selection.
          if (id !== "all" && n === 0 && statusFilter !== id) return null;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={statusFilter === id}
              className={
                "agent-dash__chip" + (statusFilter === id ? " is-active" : "")
              }
              onClick={() => setStatusFilter(id)}
            >
              <span>{statusFilterLabel(id, (k, vars) => tr(k, vars))}</span>
              <span className="agent-dash__chip-count">{n}</span>
            </button>
          );
        })}
      </div>
      <div className="agent-dash__toolbar">
        <input
          type="search"
          className="settings-input agent-dash__search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr("dashboard.searchPlaceholder")}
          autoComplete="off"
          spellCheck={false}
          aria-label={tr("dashboard.searchPlaceholder")}
        />
        <input
          type="search"
          className="settings-input agent-dash__search agent-dash__search--project"
          value={projectQuery}
          onChange={(e) => setProjectQuery(e.target.value)}
          placeholder={tr("dashboard.projectSearchPlaceholder")}
          autoComplete="off"
          spellCheck={false}
          aria-label={tr("dashboard.projectSearchPlaceholder")}
        />
        {busyCount > 0 ? (
          <span className="agent-dash__badge">
            {tr("dashboard.busyCount", { n: busyCount })}
          </span>
        ) : null}
      </div>
      {isEmptyCatalog ? (
        <div className="agent-dash__empty">
          <p className="agent-dash__empty-title">{tr("dashboard.empty")}</p>
          <p className="agent-dash__empty-hint">{tr("dashboard.emptyHint")}</p>
        </div>
      ) : isEmptyFilter ? (
        <div className="agent-dash__empty">
          <p className="agent-dash__empty-title">
            {tr("dashboard.filterEmpty")}
          </p>
          <p className="agent-dash__empty-hint">
            {tr("dashboard.filterEmptyHint")}
          </p>
          {hasActiveFilters ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm agent-dash__clear-filters"
              onClick={() => {
                setQuery("");
                setProjectQuery("");
                setStatusFilter("all");
              }}
            >
              {tr("dashboard.clearFilters")}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="agent-dash__select-bar">
            <button
              type="button"
              role="checkbox"
              aria-checked={
                allVisibleSelected
                  ? true
                  : someVisibleSelected
                    ? "mixed"
                    : false
              }
              className={
                "agent-dash__check agent-dash__check--all" +
                (allVisibleSelected ? " is-on" : "") +
                (someVisibleSelected ? " is-mixed" : "")
              }
              onClick={toggleSelectAllVisible}
              aria-label={
                allVisibleSelected
                  ? tr("dashboard.deselectAllVisible")
                  : tr("dashboard.selectAllVisible")
              }
            >
              <span className="agent-dash__check-box" aria-hidden>
                {allVisibleSelected ? "✓" : someVisibleSelected ? "–" : ""}
              </span>
              <span className="agent-dash__select-label">
                {allVisibleSelected
                  ? tr("dashboard.deselectAllVisible")
                  : tr("dashboard.selectAllVisible")}
              </span>
            </button>
            {selectedIds.size > 0 ? (
              <span className="agent-dash__select-count">
                {tr("dashboard.selectedCount", {
                  n: selectedIds.size,
                  stoppable: selectedStoppableCount,
                })}
              </span>
            ) : null}
          </div>
          <ul className="agent-dash__list" role="list">
            {filtered.map((row) => (
              <DashboardRow
                key={row.sessionId}
                row={row}
                t={(k, vars) => tr(k, vars)}
                locale={locale}
                selected={selectedIds.has(row.sessionId)}
                expanded={peekedId === row.sessionId}
                onToggleSelect={toggleRow}
                onTogglePeek={togglePeek}
                onSelect={(id) => {
                  onSelectSession?.(id);
                  onClose();
                }}
              />
            ))}
          </ul>
        </>
      )}
    </GlassModal>
  );
}

/**
 * Cross-session Agent Dashboard — status of active/recent App sessions.
 * Distinct from AgentTasksPanel (per-turn tools for the focused chat).
 */

import { useMemo, useState } from "react";
import type { Locale, MessageKey } from "@/i18n";
import { createT } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import {
  countBusyDashboardRows,
  filterAgentDashboardRows,
  stoppableDashboardRows,
  type AgentDashboardRow,
  type AgentDashboardStatus,
} from "@/lib/agentDashboard";
import { formatRelativeTime } from "@/lib/accountUi";

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

function DashboardRow({
  row,
  t,
  locale,
  onSelect,
}: {
  row: AgentDashboardRow;
  t: TFn;
  locale: Locale;
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

  return (
    <li
      className={
        "agent-dash__row" +
        (row.isCurrent ? " is-current" : "") +
        (row.stoppable ? " is-busy" : "")
      }
    >
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
            <span className="agent-dash__status">
              {statusLabel(row.status, t)}
            </span>
          </span>
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
          {row.liveToolTitle ? (
            <span className="agent-dash__tool" title={row.liveToolTitle}>
              {t("dashboard.tool", { name: row.liveToolTitle })}
            </span>
          ) : null}
          {activity ? (
            <span className="agent-dash__activity">
              {t("dashboard.lastActivity", { time: activity })}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

export type AgentDashboardModalProps = {
  open: boolean;
  locale: Locale;
  rows: AgentDashboardRow[];
  onClose: () => void;
  onSelectSession?: (sessionId: string) => void;
  /** Reuse App stop-all (confirm lives in App). */
  onStopAllBusy?: () => void;
};

export function AgentDashboardModal({
  open,
  locale,
  rows,
  onClose,
  onSelectSession,
  onStopAllBusy,
}: AgentDashboardModalProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => filterAgentDashboardRows(rows, query),
    [rows, query],
  );
  const busyCount = useMemo(() => countBusyDashboardRows(rows), [rows]);
  const stoppable = useMemo(() => stoppableDashboardRows(rows), [rows]);
  const showStopAll = !!onStopAllBusy && stoppable.length > 0;

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
          {showStopAll ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onStopAllBusy}
            >
              {tr("dashboard.stopAll")}
            </button>
          ) : null}
          <button type="button" className="btn btn--solid" onClick={onClose}>
            {tr("common.close")}
          </button>
        </div>
      }
    >
      <p className="agent-dash__hint">{tr("dashboard.hint")}</p>
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
        {busyCount > 0 ? (
          <span className="agent-dash__badge">
            {tr("dashboard.busyCount", { n: busyCount })}
          </span>
        ) : null}
      </div>
      {filtered.length === 0 ? (
        <div className="agent-dash__empty">
          <p className="agent-dash__empty-title">{tr("dashboard.empty")}</p>
          <p className="agent-dash__empty-hint">{tr("dashboard.emptyHint")}</p>
        </div>
      ) : (
        <ul className="agent-dash__list" role="list">
          {filtered.map((row) => (
            <DashboardRow
              key={row.sessionId}
              row={row}
              t={(k, vars) => tr(k, vars)}
              locale={locale}
              onSelect={(id) => {
                onSelectSession?.(id);
                onClose();
              }}
            />
          ))}
        </ul>
      )}
    </GlassModal>
  );
}

/**
 * Session agent tasks — active + recent tool steps from the live transcript,
 * plus cross-session busy activity from liveMap.
 *
 * No separate ACP task API; tools via collectSessionTasks / turnActivity.
 * Cross-session rows are UI projections only (jump / stop).
 */

import { useMemo, useState } from "react";
import type { MessageKey } from "@/i18n";
import type { ChatMessage } from "@/lib/session";
import {
  collectSessionTasks,
  countRunningTasks,
  filterSessionTasks,
  taskStatusMessageKey,
  type AgentTask,
} from "@/lib/sessionTasks";
import {
  buildTurnActivity,
  tasksFromTurnActivity,
} from "@/lib/turnActivity";
import {
  stoppableActivitySessions,
  type ActivitySessionRow,
} from "@/lib/agentActivity";
import { IconClose, IconList } from "@/components/icons";

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

export type AgentTasksPanelProps = {
  messages: ChatMessage[];
  t: TFn;
  onClose?: () => void;
  /** Bump to force re-derive (optional; messages already drive updates). */
  refreshKey?: number;
  /** Other sessions that are busy / waiting (from liveMap). */
  activitySessions?: ActivitySessionRow[];
  onSelectSession?: (sessionId: string) => void;
  onStopSession?: (sessionId: string) => void;
  /** Stop every stoppable busy session (confirm lives in App). */
  onStopAllSessions?: () => void;
  /** Open the cross-session Agent dashboard (distinct from this tools panel). */
  onOpenDashboard?: () => void;
};

function TaskRow({
  task,
  t,
}: {
  task: AgentTask;
  t: TFn;
}) {
  const [open, setOpen] = useState(false);
  const statusKey = taskStatusMessageKey(task.status);
  return (
    <li
      className={
        "agent-tasks__row" +
        (task.status === "running" ? " is-running" : "") +
        (task.longRunning ? " is-long" : "")
      }
    >
      <button
        type="button"
        className="agent-tasks__row-main"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? t("tasks.collapse") : t("tasks.expand")}
      >
        <span
          className={`agent-tasks__dot agent-tasks__dot--${task.status}`}
          aria-hidden
        />
        <span className="agent-tasks__name" title={task.name}>
          {task.name}
        </span>
        <span className="agent-tasks__status">{t(statusKey)}</span>
      </button>
      {open ? (
        <div className="agent-tasks__detail">
          {task.kind ? (
            <div className="agent-tasks__meta">
              <span className="agent-tasks__meta-k">{t("tasks.kind")}</span>
              <code className="agent-tasks__meta-v">{task.kind}</code>
            </div>
          ) : null}
          {task.detail ? (
            <div className="agent-tasks__meta">
              <span className="agent-tasks__meta-k">{t("tasks.detail")}</span>
              <span className="agent-tasks__meta-v" title={task.detail}>
                {task.detail}
              </span>
            </div>
          ) : null}
          {task.path ? (
            <div className="agent-tasks__meta">
              <span className="agent-tasks__meta-k">{t("tasks.path")}</span>
              <code className="agent-tasks__meta-v" title={task.path}>
                {task.path}
              </code>
            </div>
          ) : null}
          <div className="agent-tasks__meta">
            <span className="agent-tasks__meta-k">{t("tasks.id")}</span>
            <code className="agent-tasks__meta-v">{task.id}</code>
          </div>
          {task.longRunning ? (
            <p className="agent-tasks__hint">{t("tasks.longRunning")}</p>
          ) : null}
          {task.status === "running" ? (
            <p className="agent-tasks__hint">{t("tasks.noKill")}</p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function activityStatusLabel(row: ActivitySessionRow, t: TFn): string {
  switch (row.status) {
    case "streaming":
      return t("tasks.activity.streaming");
    case "awaiting_permission":
      return t("tasks.activity.permission");
    case "connecting":
      return t("tasks.activity.connecting");
    default:
      return t("tasks.activity.other");
  }
}

function ActivityRow({
  row,
  t,
  onSelect,
  onStop,
}: {
  row: ActivitySessionRow;
  t: TFn;
  onSelect?: (sessionId: string) => void;
  onStop?: (sessionId: string) => void;
}) {
  return (
    <li
      className={
        "agent-tasks__row agent-tasks__row--session" +
        (row.isCurrent ? " is-current" : "")
      }
    >
      <div className="agent-tasks__row-main agent-tasks__row-main--static">
        <span
          className={`agent-tasks__dot agent-tasks__dot--${
            row.status === "awaiting_permission" ? "failed" : "running"
          }`}
          aria-hidden
        />
        <span className="agent-tasks__name" title={row.title}>
          {row.title}
          {row.isCurrent ? (
            <span className="agent-tasks__current-tag">
              {" "}
              {t("tasks.activity.current")}
            </span>
          ) : null}
        </span>
        <span className="agent-tasks__status">{activityStatusLabel(row, t)}</span>
      </div>
      {row.liveToolTitle ? (
        <div className="agent-tasks__detail">
          <div className="agent-tasks__meta">
            <span className="agent-tasks__meta-k">{t("tasks.kind")}</span>
            <span className="agent-tasks__meta-v" title={row.liveToolTitle}>
              {row.liveToolTitle}
            </span>
          </div>
        </div>
      ) : null}
      <div className="agent-tasks__session-actions">
        {!row.isCurrent && onSelect ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => onSelect(row.sessionId)}
          >
            {t("tasks.activity.open")}
          </button>
        ) : null}
        {onStop ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => onStop(row.sessionId)}
          >
            {t("tasks.activity.stop")}
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function AgentTasksPanel({
  messages,
  t,
  onClose,
  activitySessions = [],
  onSelectSession,
  onStopSession,
  onStopAllSessions,
  onOpenDashboard,
}: AgentTasksPanelProps) {
  const [query, setQuery] = useState("");
  const tasks = useMemo(() => {
    const act = buildTurnActivity(messages);
    const fromTurn = tasksFromTurnActivity(act);
    const ids = new Set(fromTurn.map((x) => x.id));
    const extraRunning = collectSessionTasks(messages).filter(
      (x) => x.status === "running" && !ids.has(x.id),
    );
    return [...extraRunning, ...fromTurn];
  }, [messages]);
  const filtered = useMemo(
    () => filterSessionTasks(tasks, query),
    [tasks, query],
  );
  const running = useMemo(() => countRunningTasks(filtered), [filtered]);
  const active = filtered.filter((x) => x.status === "running");
  const recent = filtered.filter((x) => x.status !== "running");
  const otherSessions = useMemo(
    () => activitySessions.filter((r) => !r.isCurrent),
    [activitySessions],
  );
  const stoppableSessions = useMemo(
    () => stoppableActivitySessions(activitySessions),
    [activitySessions],
  );
  const totalBusy = running + otherSessions.length;
  const showStopAll =
    !!onStopAllSessions && stoppableSessions.length > 0;

  return (
    <section className="agent-tasks" aria-label={t("tasks.title")}>
      <header className="agent-tasks__head">
        <div className="agent-tasks__title-row">
          <IconList size={15} />
          <h2 className="agent-tasks__title">{t("tasks.title")}</h2>
          {totalBusy > 0 ? (
            <span className="agent-tasks__badge">
              {t("tasks.runningCount", { n: totalBusy })}
            </span>
          ) : null}
        </div>
        <div className="agent-tasks__head-actions">
          {onOpenDashboard ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={onOpenDashboard}
              title={t("tasks.openDashboard")}
            >
              {t("tasks.openDashboard")}
            </button>
          ) : null}
          {showStopAll ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={onStopAllSessions}
              title={t("tasks.activity.stopAll")}
            >
              {t("tasks.activity.stopAll")}
            </button>
          ) : null}
          {onClose ? (
            <button
              type="button"
              className="chrome-btn"
              title={t("tasks.hidePanel")}
              aria-label={t("tasks.hidePanel")}
              onClick={onClose}
            >
              <IconClose size={14} />
            </button>
          ) : null}
        </div>
      </header>

      <div className="agent-tasks__search">
        <input
          type="search"
          className="settings-input agent-tasks__search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("tasks.searchPlaceholder")}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {filtered.length === 0 && otherSessions.length === 0 ? (
        <div className="agent-tasks__empty">
          <p className="agent-tasks__empty-title">{t("tasks.empty")}</p>
          <p className="agent-tasks__empty-hint">{t("tasks.emptyHint")}</p>
        </div>
      ) : (
        <div className="agent-tasks__body">
          {otherSessions.length > 0 ? (
            <div className="agent-tasks__section">
              <h3 className="agent-tasks__section-title">
                {t("tasks.section.otherSessions")}
              </h3>
              <ul className="agent-tasks__list">
                {otherSessions.map((row) => (
                  <ActivityRow
                    key={row.sessionId}
                    row={row}
                    t={t}
                    onSelect={onSelectSession}
                    onStop={onStopSession}
                  />
                ))}
              </ul>
            </div>
          ) : null}
          {active.length > 0 ? (
            <div className="agent-tasks__section">
              <h3 className="agent-tasks__section-title">
                {t("tasks.section.active")}
              </h3>
              <ul className="agent-tasks__list">
                {active.map((task) => (
                  <TaskRow key={task.id} task={task} t={t} />
                ))}
              </ul>
            </div>
          ) : null}
          {recent.length > 0 ? (
            <div className="agent-tasks__section">
              <h3 className="agent-tasks__section-title">
                {t("tasks.section.recent")}
              </h3>
              <ul className="agent-tasks__list">
                {recent.map((task) => (
                  <TaskRow key={task.id} task={task} t={t} />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

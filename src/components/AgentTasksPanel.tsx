/**
 * Session agent tasks — active + recent tool steps from the live transcript.
 * No separate ACP task API; derived via collectSessionTasks.
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
import { IconClose, IconList } from "@/components/icons";

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

export type AgentTasksPanelProps = {
  messages: ChatMessage[];
  t: TFn;
  onClose?: () => void;
  /** Bump to force re-derive (optional; messages already drive updates). */
  refreshKey?: number;
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

export function AgentTasksPanel({
  messages,
  t,
  onClose,
}: AgentTasksPanelProps) {
  const [query, setQuery] = useState("");
  const tasks = useMemo(() => collectSessionTasks(messages), [messages]);
  const filtered = useMemo(
    () => filterSessionTasks(tasks, query),
    [tasks, query],
  );
  const running = useMemo(() => countRunningTasks(filtered), [filtered]);
  const active = filtered.filter((x) => x.status === "running");
  const recent = filtered.filter((x) => x.status !== "running");

  return (
    <section className="agent-tasks" aria-label={t("tasks.title")}>
      <header className="agent-tasks__head">
        <div className="agent-tasks__title-row">
          <IconList size={15} />
          <h2 className="agent-tasks__title">{t("tasks.title")}</h2>
          {running > 0 ? (
            <span className="agent-tasks__badge">
              {t("tasks.runningCount", { n: running })}
            </span>
          ) : null}
        </div>
        <div className="agent-tasks__head-actions">
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

      {filtered.length === 0 ? (
        <div className="agent-tasks__empty">
          <p className="agent-tasks__empty-title">{t("tasks.empty")}</p>
          <p className="agent-tasks__empty-hint">{t("tasks.emptyHint")}</p>
        </div>
      ) : (
        <div className="agent-tasks__body">
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

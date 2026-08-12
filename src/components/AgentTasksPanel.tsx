/**
 * Session agent tasks — active + recent tool steps from the live transcript,
 * plus cross-session busy activity from liveMap.
 *
 * No separate ACP task API; tools via collectSessionTasks / turnActivity.
 * Cross-session rows are UI projections only (jump / stop).
 * Nested tools under spawn_subagent render as an indented tree when parent
 * linkage (explicit or inferred) is available.
 * Subagent cwd / worktree paths surface as a compact WT badge when present
 * in tool_step data — open as chat cwd, reveal, or copy (UI-only).
 *
 * Pro: running / done / all chips, honest empty (no tasks · filter empty),
 * snapshot-mode banner, soft-fail stop / bind-cwd classification.
 */

import { useCallback, useMemo, useState, type MouseEvent } from "react";
import type { MessageKey } from "@/i18n";
import type { ChatMessage } from "@/lib/session";
import * as api from "@/lib/api";
import { pathsEqual } from "@/lib/gitWorktree";
import {
  buildTaskTree,
  collectSessionTasks,
  countRunningTasks,
  formatTaskCwdLabel,
  taskStatusMessageKey,
  taskTreeHasRunning,
  type AgentTask,
  type TaskTreeNode,
} from "@/lib/sessionTasks";
import { shouldShowTaskTreeChrome } from "@/lib/taskTreeHonesty";
import {
  stopAllButtonLabelKey,
  stopAllButtonTitleKey,
} from "@/lib/stopAllHonesty";
import {
  buildTurnActivity,
  tasksFromTurnActivity,
} from "@/lib/turnActivity";
import {
  stoppableActivitySessions,
  type ActivitySessionRow,
} from "@/lib/agentActivity";
import {
  TASKS_PANEL_STATUS_FILTERS,
  classifyTasksBindCwdError,
  classifyTasksStopError,
  countTasksByStatusFilter,
  filterTaskTreePanel,
  filterTasksPanelList,
  normalizeTasksBindCwdResult,
  resolveTasksPanelEmptyState,
  tasksPanelHasActiveFilters,
  tasksPanelSnapshotBannerKey,
  tasksPanelStatusFilterLabelKey,
  type TasksBindCwdResult,
  type TasksPanelStatusFilter,
} from "@/lib/tasksPanelPro";
import { resolveAgentsRailEmptyState } from "@/lib/agentsRail";
import {
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconCopy,
  IconFolder,
  IconFolderPlus,
  IconList,
} from "@/components/icons";

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

export type AgentTasksPanelVariant = "default" | "rail";

export type AgentTasksPanelProps = {
  messages: ChatMessage[];
  t: TFn;
  onClose?: () => void;
  /** Bump to force re-derive (optional; messages already drive updates). */
  refreshKey?: number;
  /** Other sessions that are busy / waiting (from liveMap). */
  activitySessions?: ActivitySessionRow[];
  onSelectSession?: (sessionId: string) => void;
  /**
   * Stop a busy session. May throw or return a rejected promise — panel
   * classifies soft-fail and surfaces an inline hint (no window.confirm).
   */
  onStopSession?: (sessionId: string) => void | Promise<void>;
  /** Stop every stoppable busy session (confirm lives in App). */
  onStopAllSessions?: () => void;
  /** Open the cross-session Agent dashboard (distinct from this tools panel). */
  onOpenDashboard?: () => void;
  /**
   * Bind this chat to a subagent cwd / worktree path (agent project cwd).
   * Parent owns project_add / session bind / toast.
   * May return {@link TasksBindCwdResult} for soft-fail honesty.
   */
  onOpenCwd?: (
    cwd: string,
  ) => void | TasksBindCwdResult | Promise<void | TasksBindCwdResult>;
  /** Current chat project path — used to mark cwd as already active. */
  activeCwd?: string | null;
  /**
   * When true, CLI subagent worktree snapshot mode is on
   * (`subagent_worktree_snapshot_enabled`, CLI 0.2.117+). Shows a short note.
   */
  subagentWorktreeSnapshotEnabled?: boolean;
  /**
   * `rail` = compact embed for Resources → Agents (no close chrome;
   * session-local empty honesty via agentsRail helpers).
   */
  variant?: AgentTasksPanelVariant;
  /**
   * Whether the current session is streaming / busy (rail empty idle_hint).
   * Ignored for the default floating panel.
   */
  sessionBusy?: boolean;
};

async function revealOrCopyCwd(cwd: string): Promise<"revealed" | "copied"> {
  if (api.isTauri()) {
    try {
      await api.pathReveal(cwd);
      return "revealed";
    } catch {
      // Fall through to copy when reveal fails (missing path, etc.).
    }
  }
  await navigator.clipboard.writeText(cwd);
  return "copied";
}

function TaskRow({
  task,
  t,
  depth = 0,
  hasChildren = false,
  childrenOpen = true,
  onToggleChildren,
  showTreeChrome = false,
  onOpenCwd,
  activeCwd,
}: {
  task: AgentTask;
  t: TFn;
  depth?: number;
  hasChildren?: boolean;
  childrenOpen?: boolean;
  onToggleChildren?: () => void;
  /** When false, omit tree toggle/spacer so flat lists match pre-tree layout. */
  showTreeChrome?: boolean;
  onOpenCwd?: AgentTasksPanelProps["onOpenCwd"];
  activeCwd?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [cwdActionHint, setCwdActionHint] = useState<string | null>(null);
  const statusKey = taskStatusMessageKey(task.status);
  const pad =
    showTreeChrome && depth > 0
      ? { paddingLeft: 8 + depth * 14 }
      : undefined;
  const cwdIsActive = !!(
    task.cwd &&
    activeCwd &&
    pathsEqual(task.cwd, activeCwd)
  );
  const canOpenCwd = !!onOpenCwd && !!task.cwd;

  const onRevealCwd = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (!task.cwd) return;
      void revealOrCopyCwd(task.cwd)
        .then((mode) => {
          setCwdActionHint(
            mode === "revealed"
              ? t("tasks.cwdRevealed")
              : t("tasks.cwdCopied"),
          );
        })
        .catch(() => {
          setCwdActionHint(t("tasks.cwdRevealFailed"));
        });
    },
    [task.cwd, t],
  );

  const onCopyCwd = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (!task.cwd) return;
      void navigator.clipboard
        .writeText(task.cwd)
        .then(() => setCwdActionHint(t("tasks.cwdCopied")))
        .catch(() => setCwdActionHint(t("tasks.cwdRevealFailed")));
    },
    [task.cwd, t],
  );

  const onUseCwd = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (!task.cwd || !onOpenCwd) return;
      if (cwdIsActive) {
        const view = classifyTasksBindCwdError(null, { alreadyActive: true });
        setCwdActionHint(t(view.titleKey as MessageKey));
        return;
      }
      if (!task.cwd.trim()) {
        const view = classifyTasksBindCwdError(null, { emptyPath: true });
        setCwdActionHint(t(view.titleKey as MessageKey));
        return;
      }
      void (async () => {
        try {
          const raw = await onOpenCwd(task.cwd!);
          const result = normalizeTasksBindCwdResult(raw);
          if (result.ok) {
            setCwdActionHint(t("tasks.cwdOpened"));
            return;
          }
          const view = classifyTasksBindCwdError(result.detail ?? result.kind, {
            alreadyActive: result.kind === "already_active",
            emptyPath: result.kind === "empty_path",
          });
          // Prefer classified kind from result when detail is just a token.
          if (result.kind && result.kind !== "other") {
            setCwdActionHint(
              t(`tasks.cwdBindErr.${result.kind}` as MessageKey),
            );
            return;
          }
          setCwdActionHint(t(view.titleKey as MessageKey));
        } catch (err) {
          const view = classifyTasksBindCwdError(err);
          setCwdActionHint(t(view.titleKey as MessageKey));
        }
      })();
    },
    [cwdIsActive, onOpenCwd, t, task.cwd],
  );

  /** Badge: prefer open-as-cwd when wired; otherwise reveal. */
  const onBadgeCwd = useCallback(
    (e: MouseEvent) => {
      if (canOpenCwd) {
        onUseCwd(e);
        return;
      }
      onRevealCwd(e);
    },
    [canOpenCwd, onRevealCwd, onUseCwd],
  );

  const cwdLabel = task.cwd ? formatTaskCwdLabel(task.cwd) : null;

  return (
    <li
      className={
        "agent-tasks__row" +
        (task.status === "running" ? " is-running" : "") +
        (task.longRunning ? " is-long" : "") +
        (showTreeChrome && depth > 0 ? " is-child" : "")
      }
      style={pad}
    >
      <div className="agent-tasks__row-line">
        {showTreeChrome ? (
          hasChildren ? (
            <button
              type="button"
              className="agent-tasks__tree-toggle"
              onClick={(e) => {
                e.stopPropagation();
                onToggleChildren?.();
              }}
              aria-expanded={childrenOpen}
              aria-label={
                childrenOpen
                  ? t("tasks.collapseChildren")
                  : t("tasks.expandChildren")
              }
              title={
                childrenOpen
                  ? t("tasks.collapseChildren")
                  : t("tasks.expandChildren")
              }
            >
              {childrenOpen ? (
                <IconChevronDown size={14} />
              ) : (
                <IconChevronRight size={14} />
              )}
            </button>
          ) : (
            <span className="agent-tasks__tree-spacer" aria-hidden />
          )
        ) : null}
        <div
          className={
            "agent-tasks__row-main" +
            (showTreeChrome ? "" : " agent-tasks__row-main--flat")
          }
        >
          <button
            type="button"
            className="agent-tasks__row-toggle"
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
          </button>
          {task.cwd && cwdLabel ? (
            <button
              type="button"
              className={
                "agent-tasks__wt" + (cwdIsActive ? " is-active" : "")
              }
              title={
                canOpenCwd
                  ? t("tasks.cwdBadgeOpenTitle", { path: task.cwd })
                  : t("tasks.cwdBadgeTitle", { path: task.cwd })
              }
              aria-label={
                canOpenCwd ? t("tasks.openCwd") : t("tasks.revealCwd")
              }
              onClick={onBadgeCwd}
            >
              {cwdLabel}
            </button>
          ) : null}
          <span className="agent-tasks__status">{t(statusKey)}</span>
        </div>
      </div>
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
          {task.cwd ? (
            <>
              <div className="agent-tasks__meta">
                <span className="agent-tasks__meta-k">{t("tasks.cwd")}</span>
                <code className="agent-tasks__meta-v" title={task.cwd}>
                  {task.cwd}
                </code>
              </div>
              <div className="agent-tasks__cwd-actions">
                {canOpenCwd ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={onUseCwd}
                    title={t("tasks.openCwd")}
                    disabled={cwdIsActive}
                  >
                    <IconFolderPlus size={13} />
                    {t("tasks.openCwd")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={onRevealCwd}
                  title={t("tasks.revealCwd")}
                >
                  <IconFolder size={13} />
                  {t("tasks.revealCwd")}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={onCopyCwd}
                  title={t("tasks.copyCwd")}
                >
                  <IconCopy size={13} />
                  {t("tasks.copyCwd")}
                </button>
              </div>
              {cwdActionHint ? (
                <p className="agent-tasks__hint">{cwdActionHint}</p>
              ) : null}
            </>
          ) : null}
          {task.parentId ? (
            <div className="agent-tasks__meta">
              <span className="agent-tasks__meta-k">{t("tasks.parent")}</span>
              <code className="agent-tasks__meta-v" title={task.parentId}>
                {task.parentId}
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

function TaskTreeItem({
  node,
  t,
  depth = 0,
  showTreeChrome = false,
  onOpenCwd,
  activeCwd,
}: {
  node: TaskTreeNode;
  t: TFn;
  depth?: number;
  showTreeChrome?: boolean;
  onOpenCwd?: AgentTasksPanelProps["onOpenCwd"];
  activeCwd?: string | null;
}) {
  const hasChildren = node.children.length > 0;
  const [childrenOpen, setChildrenOpen] = useState(true);
  return (
    <>
      <TaskRow
        task={node.task}
        t={t}
        depth={depth}
        hasChildren={hasChildren}
        childrenOpen={childrenOpen}
        onToggleChildren={() => setChildrenOpen((v) => !v)}
        showTreeChrome={showTreeChrome}
        onOpenCwd={onOpenCwd}
        activeCwd={activeCwd}
      />
      {hasChildren && childrenOpen
        ? node.children.map((child) => (
            <TaskTreeItem
              key={child.task.id}
              node={child}
              t={t}
              depth={depth + 1}
              showTreeChrome={showTreeChrome}
              onOpenCwd={onOpenCwd}
              activeCwd={activeCwd}
            />
          ))
        : null}
    </>
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
  stopHint,
}: {
  row: ActivitySessionRow;
  t: TFn;
  onSelect?: (sessionId: string) => void;
  onStop?: (sessionId: string) => void | Promise<void>;
  stopHint?: string | null;
}) {
  const [localHint, setLocalHint] = useState<string | null>(null);
  const hint = localHint ?? stopHint ?? null;

  const handleStop = useCallback(() => {
    if (!onStop) return;
    setLocalHint(null);
    void (async () => {
      try {
        await onStop(row.sessionId);
      } catch (err) {
        const view = classifyTasksStopError(err);
        setLocalHint(t(view.titleKey as MessageKey));
      }
    })();
  }, [onStop, row.sessionId, t]);

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
            onClick={handleStop}
          >
            {t("tasks.activity.stop")}
          </button>
        ) : null}
      </div>
      {hint ? <p className="agent-tasks__hint agent-tasks__hint--soft">{hint}</p> : null}
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
  onOpenCwd,
  activeCwd = null,
  subagentWorktreeSnapshotEnabled = false,
  variant = "default",
  sessionBusy = false,
}: AgentTasksPanelProps) {
  const isRail = variant === "rail";
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<TasksPanelStatusFilter>("all");

  const tasks = useMemo(() => {
    const act = buildTurnActivity(messages);
    const fromTurn = tasksFromTurnActivity(act);
    const ids = new Set(fromTurn.map((x) => x.id));
    const extraRunning = collectSessionTasks(messages).filter(
      (x) => x.status === "running" && !ids.has(x.id),
    );
    return [...extraRunning, ...fromTurn];
  }, [messages]);

  const statusCounts = useMemo(
    () => countTasksByStatusFilter(tasks),
    [tasks],
  );

  const listFilter = useMemo(
    () => ({ query, status: statusFilter }),
    [query, statusFilter],
  );

  const hasFilters = tasksPanelHasActiveFilters(listFilter);

  const filteredFlat = useMemo(
    () => filterTasksPanelList(tasks, listFilter),
    [tasks, listFilter],
  );

  const tree = useMemo(() => {
    // Build from full list so parent linkage survives filter, then filter tree.
    const full = buildTaskTree(tasks);
    return filterTaskTreePanel(full, listFilter);
  }, [tasks, listFilter]);

  const running = useMemo(
    () => countRunningTasks(filteredFlat),
    [filteredFlat],
  );
  const activeTree = useMemo(
    () => tree.filter((n) => taskTreeHasRunning(n)),
    [tree],
  );
  const recentTree = useMemo(
    () => tree.filter((n) => !taskTreeHasRunning(n)),
    [tree],
  );
  // Rail is session-local: hide cross-session activity rows.
  const otherSessions = useMemo(
    () =>
      isRail ? [] : activitySessions.filter((r) => !r.isCurrent),
    [activitySessions, isRail],
  );
  const stoppableSessions = useMemo(
    () => (isRail ? [] : stoppableActivitySessions(activitySessions)),
    [activitySessions, isRail],
  );
  const totalBusy = running + otherSessions.length;
  const showStopAll =
    !isRail && !!onStopAllSessions && stoppableSessions.length > 0;
  const hasTaskRows = activeTree.length > 0 || recentTree.length > 0;
  // Tree chrome only when nesting data exists — never fake indent without parents.
  const showTreeChrome = shouldShowTaskTreeChrome(tree);

  const emptyState = useMemo(() => {
    if (isRail) {
      return resolveAgentsRailEmptyState({
        hasTasks: hasTaskRows || filteredFlat.length > 0,
        filterActive: hasFilters,
        sessionBusy,
      });
    }
    return resolveTasksPanelEmptyState({
      totalTasks: tasks.length,
      filteredTasks: filteredFlat.length,
      otherSessions: otherSessions.length,
      hasFilters,
    });
  }, [
    isRail,
    hasTaskRows,
    filteredFlat.length,
    hasFilters,
    sessionBusy,
    tasks.length,
    otherSessions.length,
  ]);

  const snapshotNoteKey = tasksPanelSnapshotBannerKey(
    subagentWorktreeSnapshotEnabled,
  );

  const clearFilters = useCallback(() => {
    setQuery("");
    setStatusFilter("all");
  }, []);

  const showFullEmpty =
    !!emptyState && otherSessions.length === 0 && !hasTaskRows;
  const showFilterEmptyInBody =
    !!emptyState &&
    emptyState.kind === "filter_empty" &&
    !hasTaskRows &&
    otherSessions.length > 0;

  const titleLabel = isRail ? t("resources.agents") : t("tasks.title");

  return (
    <section
      className={"agent-tasks" + (isRail ? " agent-tasks--rail" : "")}
      aria-label={titleLabel}
      data-variant={variant}
    >
      <header className="agent-tasks__head">
        <div className="agent-tasks__title-row">
          <IconList size={15} />
          <h2 className="agent-tasks__title">{titleLabel}</h2>
          {totalBusy > 0 ? (
            <span className="agent-tasks__badge">
              {t("tasks.runningCount", { n: totalBusy })}
            </span>
          ) : null}
        </div>
        <div className="agent-tasks__head-actions">
          {!isRail && onOpenDashboard ? (
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
              title={t(stopAllButtonTitleKey("tasks") as MessageKey)}
            >
              {t(stopAllButtonLabelKey("tasks") as MessageKey)}
            </button>
          ) : null}
          {!isRail && onClose ? (
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

      {snapshotNoteKey ? (
        <p className="agent-tasks__snap-note" role="note">
          {t(snapshotNoteKey)}
        </p>
      ) : null}

      <div className="agent-tasks__filters">
        <div
          className="agent-tasks__chips"
          role="toolbar"
          aria-label={t("tasks.filter.statusLabel")}
        >
          {TASKS_PANEL_STATUS_FILTERS.map((id) => {
            const n = statusCounts[id];
            // Hide zero-count chips except "all" and the active selection.
            if (id !== "all" && n === 0 && statusFilter !== id) return null;
            return (
              <button
                key={id}
                type="button"
                className={
                  "agent-tasks__chip" + (statusFilter === id ? " is-active" : "")
                }
                aria-pressed={statusFilter === id}
                onClick={() => setStatusFilter(id)}
              >
                <span>
                  {t(tasksPanelStatusFilterLabelKey(id) as MessageKey)}
                </span>
                <span className="agent-tasks__chip-count">{n}</span>
              </button>
            );
          })}
        </div>
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
      </div>

      {showFullEmpty && emptyState ? (
        <div
          className={
            "agent-tasks__empty" +
            (emptyState.kind === "filter_empty"
              ? " agent-tasks__empty--filter"
              : "")
          }
        >
          <p className="agent-tasks__empty-title">
            {t(emptyState.titleKey as MessageKey)}
          </p>
          {emptyState.hintKey ? (
            <p className="agent-tasks__empty-hint">
              {t(emptyState.hintKey as MessageKey)}
            </p>
          ) : null}
          {emptyState.showClearFilters ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={clearFilters}
            >
              {t("tasks.clearFilters")}
            </button>
          ) : null}
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
          {showFilterEmptyInBody && emptyState ? (
            <div className="agent-tasks__empty agent-tasks__empty--filter">
              <p className="agent-tasks__empty-title">
                {t(emptyState.titleKey as MessageKey)}
              </p>
              {emptyState.hintKey ? (
                <p className="agent-tasks__empty-hint">
                  {t(emptyState.hintKey as MessageKey)}
                </p>
              ) : null}
              {emptyState.showClearFilters ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={clearFilters}
                >
                  {t("tasks.clearFilters")}
                </button>
              ) : null}
            </div>
          ) : null}
          {activeTree.length > 0 ? (
            <div className="agent-tasks__section">
              <h3 className="agent-tasks__section-title">
                {t("tasks.section.active")}
              </h3>
              <ul className="agent-tasks__list">
                {activeTree.map((node) => (
                  <TaskTreeItem
                    key={node.task.id}
                    node={node}
                    t={t}
                    showTreeChrome={showTreeChrome}
                    onOpenCwd={onOpenCwd}
                    activeCwd={activeCwd}
                  />
                ))}
              </ul>
            </div>
          ) : null}
          {recentTree.length > 0 ? (
            <div className="agent-tasks__section">
              <h3 className="agent-tasks__section-title">
                {t("tasks.section.recent")}
              </h3>
              <ul className="agent-tasks__list">
                {recentTree.map((node) => (
                  <TaskTreeItem
                    key={node.task.id}
                    node={node}
                    t={t}
                    showTreeChrome={showTreeChrome}
                    onOpenCwd={onOpenCwd}
                    activeCwd={activeCwd}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

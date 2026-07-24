/**
 * Active / recent agent tool tasks for the session Tasks panel (L05).
 *
 * Source of truth: live + journal `tool_step` rows already produced from ACP
 * `session://tool` events (toolCallId, title, kind, status, path, detail).
 * There is no separate ACP "task list" API — do not invent one.
 */

import type { ChatMessage } from "./session";
import {
  isToolStepMessage,
  parseToolStepContent,
  toolStepDisplayTitle,
} from "./session";

/** Normalized UI status for a tool task row. */
export type AgentTaskStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentTask {
  /** Stable tool call id from ACP / host. */
  id: string;
  /** Human label (title / command / path). */
  name: string;
  /** Raw tool kind when known (spawn_subagent, run_terminal_command, …). */
  kind: string;
  status: AgentTaskStatus;
  /** Optional command / query snippet. */
  detail?: string;
  /** Optional path from tool payload. */
  path?: string;
  /** ISO timestamp of last update when available. */
  updatedAt?: string;
  /**
   * Tools that often outlive a single stream tick (subagents, background shell,
   * monitors). Used only for grouping / badge — not a separate protocol type.
   */
  longRunning: boolean;
}

/** Max completed/failed/cancelled rows kept after the active ones. */
export const SESSION_TASKS_RECENT_LIMIT = 24;

const RUNNING_STATUSES = new Set([
  "in_progress",
  "pending",
  "running",
  "",
]);

const FAILED_STATUSES = new Set(["failed", "error", "rejected"]);

const CANCELLED_STATUSES = new Set(["cancelled", "canceled"]);

/**
 * Tool kinds that commonly represent multi-step / background work in Grok Build.
 * Matching is advisory for UI emphasis; every tool_step can still appear as a task.
 */
const LONG_RUNNING_KINDS = new Set([
  "spawn_subagent",
  "subagent",
  "agent",
  "run_terminal_command",
  "run_terminal_cmd",
  "bash",
  "shell",
  "monitor",
  "get_command_or_subagent_output",
  "kill_command_or_subagent",
  "wait_commands_or_subagents",
  "workflow",
  "scheduler_create",
]);

export function isRunningToolStatus(status: string | null | undefined): boolean {
  const s = (status || "").toLowerCase().trim();
  return RUNNING_STATUSES.has(s);
}

export function normalizeTaskStatus(
  status: string | null | undefined,
  streaming?: boolean,
): AgentTaskStatus {
  if (streaming) return "running";
  const s = (status || "").toLowerCase().trim();
  if (!s || RUNNING_STATUSES.has(s)) return "running";
  if (FAILED_STATUSES.has(s)) return "failed";
  if (CANCELLED_STATUSES.has(s)) return "cancelled";
  if (
    s === "completed" ||
    s === "complete" ||
    s === "done" ||
    s === "success"
  ) {
    return "completed";
  }
  // Unknown terminal-ish labels → treat as completed for display.
  return "completed";
}

export function isLongRunningToolKind(kind: string | null | undefined): boolean {
  const k = (kind || "").toLowerCase().trim().replace(/-/g, "_");
  if (!k) return false;
  if (LONG_RUNNING_KINDS.has(k)) return true;
  if (k.includes("subagent") || k.includes("spawn_agent")) return true;
  if (k.includes("monitor")) return true;
  if (k.includes("background")) return true;
  return false;
}

function resolveKind(m: ChatMessage): string {
  if (m.toolKind?.trim()) return m.toolKind.trim();
  if (m.content?.startsWith("tool_step|")) {
    return parseToolStepContent(m.content)?.kind?.trim() || "";
  }
  return "";
}

function resolveStatusRaw(m: ChatMessage): string {
  if (m.toolStatus?.trim()) return m.toolStatus.trim();
  if (m.content?.startsWith("tool_step|")) {
    return parseToolStepContent(m.content)?.status?.trim() || "";
  }
  return m.streaming ? "in_progress" : "completed";
}

function resolveDetail(m: ChatMessage): string | undefined {
  if (m.toolDetail?.trim()) return m.toolDetail.trim();
  if (m.content?.startsWith("tool_step|")) {
    return parseToolStepContent(m.content)?.detail?.trim() || undefined;
  }
  return undefined;
}

function resolvePath(m: ChatMessage): string | undefined {
  if (m.toolPath?.trim()) return m.toolPath.trim();
  if (m.content?.startsWith("tool_step|")) {
    return parseToolStepContent(m.content)?.path?.trim() || undefined;
  }
  return undefined;
}

function resolveId(m: ChatMessage): string {
  if (m.toolCallId?.trim()) return m.toolCallId.trim();
  if (m.id.startsWith("tool-")) return m.id.slice(5);
  return m.id;
}

/** Build one task row from a tool_step chat message. */
export function taskFromToolMessage(m: ChatMessage): AgentTask | null {
  if (!isToolStepMessage(m)) return null;
  const id = resolveId(m);
  if (!id) return null;
  const kind = resolveKind(m);
  const statusRaw = resolveStatusRaw(m);
  const status = normalizeTaskStatus(statusRaw, m.streaming);
  const name = toolStepDisplayTitle(m) || kind.replace(/_/g, " ") || id;
  return {
    id,
    name,
    kind,
    status,
    detail: resolveDetail(m),
    path: resolvePath(m),
    updatedAt: m.createdAt,
    longRunning: isLongRunningToolKind(kind),
  };
}

export interface CollectSessionTasksOptions {
  /** Cap on non-running rows (default SESSION_TASKS_RECENT_LIMIT). */
  recentLimit?: number;
  /**
   * When true (default), prefer tools after the last user message.
   * Still-running tools from earlier in the list are always kept.
   */
  currentTurnOnly?: boolean;
}

/**
 * Derive active + recent tool tasks from session messages.
 * Running first (stream order), then recent terminal rows (newest first).
 */
export function collectSessionTasks(
  messages: ChatMessage[],
  options: CollectSessionTasksOptions = {},
): AgentTask[] {
  const recentLimit = options.recentLimit ?? SESSION_TASKS_RECENT_LIMIT;
  const currentTurnOnly = options.currentTurnOnly !== false;

  let from = 0;
  if (currentTurnOnly) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === "user") {
        from = i + 1;
        break;
      }
    }
  }

  const byId = new Map<string, AgentTask>();
  // Always scan full list for still-running tools (turn boundary can lag).
  for (const m of messages) {
    const task = taskFromToolMessage(m);
    if (!task) continue;
    if (task.status === "running") {
      byId.set(task.id, task);
    }
  }
  // Current-turn (or full) scan for terminal rows — last write wins.
  for (let i = from; i < messages.length; i++) {
    const task = taskFromToolMessage(messages[i]!);
    if (!task) continue;
    if (task.status === "running") {
      byId.set(task.id, task);
      continue;
    }
    const prev = byId.get(task.id);
    if (prev?.status === "running") continue;
    byId.set(task.id, task);
  }

  const all = Array.from(byId.values());
  const running = all.filter((t) => t.status === "running");
  const done = all
    .filter((t) => t.status !== "running")
    .sort((a, b) => {
      const ta = a.updatedAt || "";
      const tb = b.updatedAt || "";
      return tb.localeCompare(ta);
    })
    .slice(0, Math.max(0, recentLimit));

  return [...running, ...done];
}

export function countRunningTasks(tasks: AgentTask[]): number {
  return tasks.reduce((n, t) => (t.status === "running" ? n + 1 : n), 0);
}

export function filterSessionTasks(
  tasks: AgentTask[],
  query: string,
): AgentTask[] {
  const q = query.trim().toLowerCase();
  if (!q) return tasks;
  return tasks.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.kind.toLowerCase().includes(q) ||
      (t.detail || "").toLowerCase().includes(q) ||
      (t.path || "").toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q),
  );
}

/** Status message keys under activity.* for existing i18n. */
export function taskStatusMessageKey(
  status: AgentTaskStatus,
):
  | "activity.running"
  | "activity.done"
  | "activity.failed"
  | "activity.cancelled" {
  switch (status) {
    case "running":
      return "activity.running";
    case "failed":
      return "activity.failed";
    case "cancelled":
      return "activity.cancelled";
    default:
      return "activity.done";
  }
}

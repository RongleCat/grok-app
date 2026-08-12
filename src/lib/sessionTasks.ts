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
import { isAbsoluteFsPath } from "./pathRefs";

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
  /**
   * Optional working directory / worktree path for spawn_subagent / Agent /
   * subagent kinds. Best-effort parse from title/detail/path/content — never
   * invented when absent from tool_step data.
   */
  cwd?: string;
  /** ISO timestamp of last update when available. */
  updatedAt?: string;
  /**
   * Tools that often outlive a single stream tick (subagents, background shell,
   * monitors). Used only for grouping / badge — not a separate protocol type.
   */
  longRunning: boolean;
  /**
   * Parent tool call id when this tool is nested (e.g. under spawn_subagent).
   * Prefer explicit payload / message metadata (`toolParentId`); when ACP omits
   * parent, {@link buildTaskTree} may infer under the last long-running
   * spawn_subagent (honest best-effort — see that helper).
   */
  parentId?: string;
}

/** Fields scanned when extracting a subagent cwd / worktree path. */
export interface SubagentCwdSource {
  kind?: string | null;
  title?: string | null;
  detail?: string | null;
  path?: string | null;
  /** Full tool_step journal content (optional). */
  content?: string | null;
}

/** Keys often used for working directory / worktree in tool payloads. */
const CWD_JSON_KEYS = [
  "cwd",
  "worktree",
  "worktree_path",
  "worktreePath",
  "working_directory",
  "workingDirectory",
  "work_dir",
  "workDir",
  "working_dir",
  "workingDir",
] as const;

/**
 * Normalize a candidate path token: strip quotes/trailing punctuation, require
 * absolute (or `~/…`) form. Returns undefined when not a real path.
 */
export function normalizeExtractedCwdPath(
  raw: string | null | undefined,
): string | undefined {
  if (raw == null) return undefined;
  let s = String(raw).trim();
  if (!s) return undefined;
  // Strip wrapping quotes.
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  // Drop trailing sentence punctuation common in prose titles.
  s = s.replace(/[,;.)\]}]+$/g, "").trim();
  if (!s || !isAbsoluteFsPath(s)) return undefined;
  // Reject obvious multi-token garbage after strip (spaces in mid-path ok on
  // Unix rarely; keep single-token-ish except drive paths).
  if (/\n|\r|\t/.test(s)) return undefined;
  return s;
}

/**
 * Pull labeled cwd / worktree values from free-form text (JSON keys, `cwd:`,
 * `--cwd`, etc.). Best-effort; first match wins per blob.
 */
function extractCwdFromText(text: string | null | undefined): string | undefined {
  const blob = (text || "").trim();
  if (!blob) return undefined;

  // Whole blob is a path (common when detail/path is only the worktree).
  const asWhole = normalizeExtractedCwdPath(blob);
  if (asWhole && !/[\n\r]/.test(blob) && blob.length < 512) {
    // Only accept whole-blob when it looks path-only (no spaces around prose).
    const stripped = blob
      .replace(/^["']|["']$/g, "")
      .replace(/[,;.)\]}]+$/g, "")
      .trim();
    if (stripped === asWhole || stripped.replace(/\\/g, "/") === asWhole) {
      return asWhole;
    }
  }

  // Try JSON object (full blob or first `{…}` slice).
  const jsonTry = tryExtractCwdFromJson(blob);
  if (jsonTry) return jsonTry;

  // Labeled forms: cwd: /path, worktree=/path, "cwd": "/path"
  const labelRe =
    /(?:^|[\s,{["'])(?:cwd|worktree(?:[_-]?path)?|working[_-]?dir(?:ectory)?|work[_-]?dir)\s*[:=]\s*("([^"\n]+)"|'([^'\n]+)'|([^\s,"'}\]]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(blob)) !== null) {
    const cand = m[2] || m[3] || m[4] || m[1];
    const hit = normalizeExtractedCwdPath(cand);
    if (hit) return hit;
  }

  // CLI flags: --cwd /path, --worktree=/path, -C /path
  const flagRe =
    /(?:--cwd|--worktree|-C)\s*(?:=|\s+)\s*("([^"\n]+)"|'([^'\n]+)'|([^\s"']+))/gi;
  while ((m = flagRe.exec(blob)) !== null) {
    const cand = m[2] || m[3] || m[4] || m[1];
    const hit = normalizeExtractedCwdPath(cand);
    if (hit) return hit;
  }

  return undefined;
}

function tryExtractCwdFromJson(blob: string): string | undefined {
  const tryParse = (raw: string): string | undefined => {
    try {
      const v = JSON.parse(raw) as unknown;
      if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
      const obj = v as Record<string, unknown>;
      for (const key of CWD_JSON_KEYS) {
        const val = obj[key];
        if (typeof val === "string") {
          const hit = normalizeExtractedCwdPath(val);
          if (hit) return hit;
        }
      }
    } catch {
      /* not JSON */
    }
    return undefined;
  };

  const full = tryParse(blob);
  if (full) return full;

  const start = blob.indexOf("{");
  const end = blob.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return tryParse(blob.slice(start, end + 1));
  }
  return undefined;
}

/**
 * Best-effort extract of a subagent working directory / worktree path from
 * tool_step fields. Only for spawn_subagent / Agent / subagent kinds.
 * Never invents a path when none is present in the source data.
 */
export function extractSubagentCwd(
  source: SubagentCwdSource,
): string | undefined {
  if (!isSubagentSpawnKind(source.kind)) return undefined;

  // Prefer structured path field when it is already an absolute directory path.
  const fromPath = normalizeExtractedCwdPath(source.path);
  if (fromPath) return fromPath;

  // Labeled / JSON / flag patterns in detail (richest), then title, then body.
  for (const field of [source.detail, source.title, source.content]) {
    const hit = extractCwdFromText(field);
    if (hit) return hit;
  }

  return undefined;
}

/**
 * Compact Tasks-panel badge label for a cwd: short path when it fits, else "WT".
 */
export function formatTaskCwdLabel(cwd: string, maxLen = 18): string {
  const p = (cwd || "").trim();
  if (!p) return "WT";
  if (p.length <= maxLen) return p;
  const sep = p.includes("\\") && !p.includes("/") ? "\\" : "/";
  const parts = p.split(/[/\\]/).filter(Boolean);
  const base = parts[parts.length - 1] || p;
  if (base.length > 0 && base.length <= maxLen) return base;
  if (parts.length >= 2) {
    const tail = parts.slice(-2).join(sep);
    if (tail.length <= maxLen) return tail;
  }
  return "WT";
}

/** Tree node for nested task display (Tasks panel). */
export interface TaskTreeNode {
  task: AgentTask;
  children: TaskTreeNode[];
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

/**
 * Tool kinds that open a subagent / nested agent session and can own child tools.
 */
export function isSubagentSpawnKind(kind: string | null | undefined): boolean {
  const k = (kind || "").toLowerCase().trim().replace(/-/g, "_");
  if (!k) return false;
  if (
    k === "spawn_subagent" ||
    k === "subagent" ||
    k === "agent" ||
    k === "spawn_agent"
  ) {
    return true;
  }
  if (k.includes("spawn_subagent") || k.includes("spawn_agent")) return true;
  // Bare "subagent*" but not get_command_or_subagent_output / kill_…
  if (k.startsWith("subagent")) return true;
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

function resolveParentId(m: ChatMessage): string | undefined {
  const fromField = (m.toolParentId || "").trim();
  if (fromField) return fromField;
  return undefined;
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
  const parentId = resolveParentId(m);
  const detail = resolveDetail(m);
  const path = resolvePath(m);
  const cwd = extractSubagentCwd({
    kind,
    title: name,
    detail,
    path,
    content: m.content,
  });
  return {
    id,
    name,
    kind,
    status,
    detail,
    path,
    updatedAt: m.createdAt,
    longRunning: isLongRunningToolKind(kind),
    ...(parentId ? { parentId } : {}),
    ...(cwd ? { cwd } : {}),
  };
}

/**
 * Fill missing parentId via stream-order inference.
 *
 * Honesty rules:
 * - Never invent tool / subagent **rows** — only optional parent links.
 * - Explicit `parentId` is kept when that parent exists in the list.
 * - Inference only under a long-running **spawn_subagent** (CLI/tool signal),
 *   for tools after that spawn until the next top-level spawn. Non-spawn
 *   long-running tools (shell, monitor) do **not** open a nest.
 * - ACP often omits parent linkage — inference is best-effort UI, not protocol.
 *
 * Pure; does not mutate input. Returns the same array reference when nothing changes.
 */
export function assignInferredParentIds(tasks: AgentTask[]): AgentTask[] {
  if (tasks.length === 0) return tasks;
  const idSet = new Set(tasks.map((t) => t.id));
  let openSpawnId: string | null = null;
  let changed = false;
  const out: AgentTask[] = new Array(tasks.length);

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]!;
    const explicit =
      task.parentId &&
      task.parentId !== task.id &&
      idSet.has(task.parentId)
        ? task.parentId
        : undefined;

    let parentId = explicit;
    // Only spawn_subagent (and spawn-like kinds) open a nest — never shell/monitor alone.
    const isSpawn = isSubagentSpawnKind(task.kind) && task.longRunning;

    if (!parentId && openSpawnId && task.id !== openSpawnId && !isSpawn) {
      parentId = openSpawnId;
    }

    // New top-level long-running spawn: never nest under previous spawn.
    if (isSpawn) {
      parentId = explicit; // only keep if explicitly linked; else top-level
      openSpawnId = task.id;
    }

    if (parentId !== task.parentId) {
      changed = true;
      out[i] = parentId
        ? { ...task, parentId }
        : (() => {
            const { parentId: _drop, ...rest } = task;
            return rest;
          })();
    } else {
      out[i] = task;
    }
  }

  return changed ? out : tasks;
}

/**
 * Build a forest of task trees for the Tasks panel.
 *
 * - Uses explicit `parentId` when the parent is present in `tasks`.
 * - Otherwise applies {@link assignInferredParentIds} (spawn_subagent heuristic).
 * - Cycles / missing parents → treated as roots.
 * - When no nesting applies, one root per task in input order (flat; no chrome).
 *
 * Children preserve first-seen order among siblings; roots preserve input order
 * among tasks that are roots after linking.
 */
export function buildTaskTree(tasks: AgentTask[]): TaskTreeNode[] {
  if (tasks.length === 0) return [];

  const linked = assignInferredParentIds(tasks);
  const byId = new Map<string, TaskTreeNode>();
  const order: string[] = [];

  for (const task of linked) {
    if (byId.has(task.id)) {
      // Last write wins for task payload; keep first order slot.
      byId.get(task.id)!.task = task;
      continue;
    }
    byId.set(task.id, { task, children: [] });
    order.push(task.id);
  }

  const childIds = new Set<string>();
  for (const id of order) {
    const node = byId.get(id)!;
    const pid = node.task.parentId;
    if (!pid || pid === id || !byId.has(pid)) continue;
    // Cycle guard: walk ancestors; if we hit self, skip link.
    let walk: string | undefined = pid;
    let cyclic = false;
    const seen = new Set<string>([id]);
    while (walk) {
      if (seen.has(walk)) {
        cyclic = true;
        break;
      }
      seen.add(walk);
      walk = byId.get(walk)?.task.parentId;
      if (walk && !byId.has(walk)) break;
    }
    if (cyclic) continue;
    byId.get(pid)!.children.push(node);
    childIds.add(id);
  }

  return order
    .filter((id) => !childIds.has(id))
    .map((id) => byId.get(id)!);
}

/** True when any node in the forest has children (tree chrome useful). */
export function taskTreeHasNesting(nodes: TaskTreeNode[]): boolean {
  return nodes.some((n) => n.children.length > 0);
}

/** Whether this subtree has a running task (for Active vs Recent section). */
export function taskTreeHasRunning(node: TaskTreeNode): boolean {
  if (node.task.status === "running") return true;
  return node.children.some(taskTreeHasRunning);
}

/**
 * Filter a task forest by query; keeps ancestors of matches.
 * Empty query returns nodes unchanged.
 */
export function filterTaskTree(
  nodes: TaskTreeNode[],
  query: string,
): TaskTreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;

  const matches = (t: AgentTask): boolean =>
    t.name.toLowerCase().includes(q) ||
    t.kind.toLowerCase().includes(q) ||
    (t.detail || "").toLowerCase().includes(q) ||
    (t.path || "").toLowerCase().includes(q) ||
    (t.cwd || "").toLowerCase().includes(q) ||
    t.id.toLowerCase().includes(q);

  const walk = (node: TaskTreeNode): TaskTreeNode | null => {
    const kids = node.children
      .map(walk)
      .filter((n): n is TaskTreeNode => n != null);
    if (matches(node.task) || kids.length > 0) {
      return { task: node.task, children: kids };
    }
    return null;
  };

  return nodes.map(walk).filter((n): n is TaskTreeNode => n != null);
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
      (t.cwd || "").toLowerCase().includes(q) ||
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

/**
 * Background fleet for the open chat.
 *
 * Roots are workflow tool calls, spawn_subagent tool calls, and background
 * shell / monitor rows. Children are keyed only by an explicit id (task id,
 * tool call id, or a full subagent uuid already parsed from tool text).
 * A tool with no such link stays out of this list. The Tasks panel still
 * infers nests; this module does not.
 *
 * Counts, phases, models, and tokens are copied only when a field is present.
 */
import type { ChatMessage, FleetToolHint, MessageToolSegment } from "./session/types";

export type FleetKind = "workflow" | "agent" | "shell";

export interface FleetWireEvent {
  kind: string;
  body: unknown;
}

export interface FleetRow {
  id: string;
  kind: FleetKind;
  running: boolean;
  title: string;
  /** One line: prompt, args, or command. */
  summary?: string;
  /** Full spawn prompt when the host forwarded it. */
  prompt?: string;
  /** Completion text that returned to the parent. */
  completion?: string;
  /** Model string from the spawn payload. Absent means "inherits parent". */
  model?: string;
  startedAtMs?: number;
  endedAtMs?: number;
  /** `subagent_meta` duration_ms, when that tag has arrived. */
  durationMs?: number;
  /** `subagent_meta` tool_calls, else mirrored-title count. Absent until known. */
  toolCount?: number;
  /** Only when an event carries `agent_count`. `agent_budget` is not a count. */
  agentCount?: number;
  /** Only when both a done index and a total are on the event. */
  phase?: { done: number; total: number };
  activity?: string;
  lastLine?: string;
  outputFile?: string;
  /** Full child session uuid. A short title prefix is not enough. */
  childSessionId?: string;
  exitCode?: number;
  /** Wire `kind` when it is bash, monitor, or loop. */
  shellKind?: string;
  /** Per-child tokens. Absent unless that child reported a number. */
  tokens?: number;
  toolCallId?: string;
}

export interface BackgroundFleet {
  rows: FleetRow[];
  /** Parent-turn billing total. Not a sum of child rows. */
  sessionBillTokens?: number;
}

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SUBAGENT_ID_RE = new RegExp(`subagent_id:\\s*(${UUID_RE.source})`, "i");
const META_RE = /<subagent_meta>([^<]*)<\/subagent_meta>/i;
const RESULT_RE = /<subagent_result>([\s\S]*?)<\/subagent_result>/i;
const MIRROR_RE =
  /^\[subagent:([^\]]+)\]\s*(.*?)\s*\(([0-9a-f]{6,})\)\s*$/i;

const RUNNING = new Set(["", "running", "in_progress", "pending", "backgrounded"]);
const FINISHED = new Set([
  "completed",
  "complete",
  "done",
  "success",
  "succeeded",
  "failed",
  "error",
  "cancelled",
  "canceled",
  "interrupted",
]);

interface MutableRow extends FleetRow {
  seq: number;
  toolCountFromMeta: boolean;
}

function oneLine(raw: string | undefined, max = 160): string | undefined {
  if (!raw) return undefined;
  const line = raw
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (!line) return undefined;
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1)}…`;
}

function lastNonEmptyLine(raw: string | undefined, max = 400): string | undefined {
  if (!raw) return undefined;
  const lines = raw
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const line = lines[lines.length - 1];
  if (!line) return undefined;
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1)}…`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function field(obj: Record<string, unknown> | null, ...keys: string[]): unknown {
  if (!obj) return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  }
  return undefined;
}

function str(obj: Record<string, unknown> | null, ...keys: string[]): string | undefined {
  const value = field(obj, ...keys);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function num(obj: Record<string, unknown> | null, ...keys: string[]): number | undefined {
  const value = field(obj, ...keys);
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function clockMs(value: unknown): number | undefined {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  const obj = asRecord(value);
  const secs = num(obj, "secs_since_epoch", "secsSinceEpoch");
  if (secs == null) return undefined;
  return secs * 1000;
}

function runningStatus(status: string | undefined, streaming?: boolean): boolean {
  const key = (status || "").toLowerCase().trim();
  // A finished tool stays finished even if the parent turn is still streaming.
  if (FINISHED.has(key)) return false;
  if (streaming) return true;
  return RUNNING.has(key);
}

/** Display name from `Workflow 'phase-demo' started…` when the tool hint has none. */
function workflowNameFromOutput(output: string | undefined): string | undefined {
  const named = /workflow\s+'([^']+)'/i.exec(output || "");
  const name = named?.[1]?.trim();
  return name || undefined;
}

function shellKindOf(kind: string | undefined): string | undefined {
  const key = (kind || "").toLowerCase().trim();
  if (key === "bash" || key === "monitor" || key === "loop") return key;
  if (key === "scheduler" || key === "scheduler_create") return "loop";
  return undefined;
}

function parseSubagent(output: string | undefined): {
  id?: string;
  toolCalls?: number;
  durationMs?: number;
  completion?: string;
} {
  if (!output) return {};
  const id = SUBAGENT_ID_RE.exec(output)?.[1];
  const meta = META_RE.exec(output)?.[1] ?? "";
  const toolCalls = /tool_calls=(\d+)/.exec(meta);
  const duration = /duration_ms=(\d+)/.exec(meta);
  const metaId = new RegExp(`\\bid=(${UUID_RE.source})`, "i").exec(meta)?.[1];
  const completion = RESULT_RE.exec(output)?.[1]?.trim();
  return {
    id: id || metaId,
    toolCalls: toolCalls ? Number(toolCalls[1]) : undefined,
    durationMs: duration ? Number(duration[1]) : undefined,
    completion: completion || undefined,
  };
}

function isSpawnName(name: string): boolean {
  const key = name.toLowerCase().replace(/-/g, "_");
  return key === "spawn_subagent" || key.includes("spawn_subagent");
}

function isWorkflowName(name: string, title: string): boolean {
  if (name.toLowerCase() === "workflow") return true;
  return title.trim().toLowerCase().startsWith("workflow:");
}

function isLoopName(name: string): boolean {
  const key = name.toLowerCase().replace(/-/g, "_");
  return key === "loop" || key === "scheduler_create" || key === "scheduler";
}

function isMonitorName(name: string, title: string): boolean {
  const key = name.toLowerCase();
  return key === "monitor" || /^\[monitor\]/i.test(title.trim());
}

function markedBackground(title: string, hint: FleetToolHint | undefined): boolean {
  if (hint?.background === true) return true;
  if (hint?.blockUntilMs === 0) return true;
  return /^\[bg\]/i.test(title.trim()) || /^\[monitor\]/i.test(title.trim());
}

function isBackgroundShellTool(name: string, title: string, hint: FleetToolHint | undefined): boolean {
  if (isLoopName(name) || isMonitorName(name, title)) return true;
  const key = name.toLowerCase().replace(/-/g, "_");
  const shell =
    key === "run_terminal_command" ||
    key === "bash" ||
    key === "shell";
  return shell && markedBackground(title, hint);
}

export interface FleetToolInput {
  id: string;
  name: string;
  title: string;
  status?: string;
  input?: string;
  output?: string;
  createdAt?: string;
  streaming?: boolean;
  hint?: FleetToolHint;
}

function fromSegment(seg: MessageToolSegment): FleetToolInput {
  return {
    id: seg.toolCallId,
    name: seg.toolKind || "",
    title: seg.title || "",
    status: seg.status,
    input: seg.input,
    output: seg.output,
    createdAt: seg.createdAt,
    streaming: seg.streaming,
    hint: seg.fleetHint,
  };
}

function fromMessage(message: ChatMessage): FleetToolInput | null {
  const id = (message.toolCallId || "").trim() ||
    (message.id.startsWith("tool-") ? message.id.slice(5) : "");
  if (!id) return null;
  if (message.role !== "tool" && message.marker !== "tool_step") return null;
  return {
    id,
    name: message.toolKind || "",
    title: message.content || "",
    status: message.toolStatus,
    input: message.toolInput,
    output: message.toolOutput,
    createdAt: message.createdAt,
    streaming: message.streaming,
    hint: message.fleetHint,
  };
}

function mergeRec(prev: FleetToolInput, next: FleetToolInput): FleetToolInput {
  return {
    id: prev.id,
    name: next.name || prev.name,
    title: next.title || prev.title,
    status: next.status || prev.status,
    input: next.input || prev.input,
    output: (next.output || "").length >= (prev.output || "").length ? next.output || prev.output : prev.output,
    createdAt: prev.createdAt || next.createdAt,
    streaming: next.streaming ?? prev.streaming,
    hint: { ...prev.hint, ...stripEmptyHint(next.hint) },
  };
}

function stripEmptyHint(hint: FleetToolHint | undefined): FleetToolHint {
  if (!hint) return {};
  const out: FleetToolHint = {};
  if (hint.model?.trim()) out.model = hint.model.trim();
  if (hint.background === true) out.background = true;
  if (typeof hint.blockUntilMs === "number") out.blockUntilMs = hint.blockUntilMs;
  if (hint.prompt?.trim()) out.prompt = hint.prompt;
  if (hint.argsLine?.trim()) out.argsLine = hint.argsLine.trim();
  if (hint.sourceName?.trim()) out.sourceName = hint.sourceName.trim();
  if (typeof hint.agentBudget === "number") out.agentBudget = hint.agentBudget;
  if (typeof hint.phaseIndex === "number") out.phaseIndex = hint.phaseIndex;
  if (typeof hint.phaseTotal === "number") out.phaseTotal = hint.phaseTotal;
  if (typeof hint.agentCount === "number") out.agentCount = hint.agentCount;
  if (typeof hint.tokens === "number") out.tokens = hint.tokens;
  if (hint.isolation?.trim()) out.isolation = hint.isolation.trim();
  return out;
}

export function fleetToolsFromMessages(messages: readonly ChatMessage[]): FleetToolInput[] {
  const byId = new Map<string, FleetToolInput>();
  const order: string[] = [];
  const put = (rec: FleetToolInput | null) => {
    if (!rec?.id) return;
    const prev = byId.get(rec.id);
    if (!prev) {
      byId.set(rec.id, rec);
      order.push(rec.id);
      return;
    }
    byId.set(rec.id, mergeRec(prev, rec));
  };
  for (const message of messages) {
    put(fromMessage(message));
    if (message.role !== "assistant" || !message.segments) continue;
    for (const seg of message.segments) {
      if (seg.kind === "tool") put(fromSegment(seg));
    }
  }
  return order.map((id) => byId.get(id)!);
}

function phaseFrom(hint: FleetToolHint | undefined, obj: Record<string, unknown> | null): FleetRow["phase"] {
  const done = hint?.phaseIndex ?? num(obj, "phase_index", "phaseIndex", "phase_done", "phaseDone");
  const total = hint?.phaseTotal ?? num(obj, "phase_total", "phaseTotal");
  if (done == null || total == null) return undefined;
  return { done, total };
}

function tokensFrom(hint: FleetToolHint | undefined, obj: Record<string, unknown> | null): number | undefined {
  return hint?.tokens ?? num(obj, "tokens", "total_tokens", "totalTokens");
}

function agentCountFrom(hint: FleetToolHint | undefined, obj: Record<string, unknown> | null): number | undefined {
  return hint?.agentCount ?? num(obj, "agent_count", "agentCount");
}

export function buildBackgroundFleet(input: {
  messages?: readonly ChatMessage[];
  tools?: readonly FleetToolInput[];
  events?: readonly FleetWireEvent[];
  sessionBillTokens?: number;
}): BackgroundFleet {
  const tools = input.tools ?? fleetToolsFromMessages(input.messages ?? []);
  const rows = new Map<string, MutableRow>();
  let seq = 0;

  const upsert = (id: string, kind: FleetKind, patch: Partial<MutableRow>): MutableRow => {
    const prev = rows.get(id);
    if (!prev) {
      const row: MutableRow = {
        ...patch,
        id,
        kind,
        running: patch.running ?? true,
        title: patch.title || id,
        seq: seq++,
        toolCountFromMeta: patch.toolCountFromMeta ?? false,
      };
      rows.set(id, row);
      return row;
    }
    const next: MutableRow = {
      ...prev,
      ...dropUndefined(patch),
      id: prev.id,
      kind: patch.kind ?? prev.kind,
      seq: prev.seq,
      toolCountFromMeta: patch.toolCountFromMeta ?? prev.toolCountFromMeta,
    };
    if (patch.toolCount == null && prev.toolCount != null && patch.toolCountFromMeta !== true) {
      next.toolCount = prev.toolCount;
    }
    rows.set(id, next);
    return next;
  };

  for (const tool of tools) {
    const hint = stripEmptyHint(tool.hint);
    const started = tool.createdAt ? Date.parse(tool.createdAt) : undefined;
    const startedAtMs = started != null && Number.isFinite(started) ? started : undefined;
    if (isSpawnName(tool.name) || /subagent started in background/i.test(tool.output || "")) {
      const parsed = parseSubagent(tool.output);
      const childDone = parsed.durationMs != null || Boolean(parsed.completion);
      const row = upsert(tool.id, "agent", {
        running: childDone ? false : runningStatus(tool.status, tool.streaming),
        title: oneLine(tool.input, 120) || oneLine(tool.title, 120) || "Agent",
        summary: oneLine(tool.input),
        prompt: hint.prompt,
        model: hint.model,
        startedAtMs,
        tokens: tokensFrom(hint, null),
        agentCount: agentCountFrom(hint, null),
        phase: phaseFrom(hint, null),
        toolCallId: tool.id,
        childSessionId: parsed.id,
        completion: parsed.completion,
        durationMs: parsed.durationMs,
        toolCount: parsed.toolCalls,
        toolCountFromMeta: parsed.toolCalls != null,
      });
      if (parsed.toolCalls != null) {
        row.toolCount = parsed.toolCalls;
        row.toolCountFromMeta = true;
      }
      continue;
    }
    if (isWorkflowName(tool.name, tool.title)) {
      const name =
        hint.sourceName ||
        workflowNameFromOutput(tool.output) ||
        tool.title.replace(/^workflow:\s*/i, "").trim() ||
        tool.title ||
        "Workflow";
      upsert(tool.id, "workflow", {
        running: runningStatus(tool.status, tool.streaming),
        title: name,
        summary: oneLine(hint.argsLine || hint.prompt || tool.input),
        prompt: hint.prompt,
        startedAtMs,
        tokens: tokensFrom(hint, null),
        agentCount: agentCountFrom(hint, null),
        phase: phaseFrom(hint, null),
        toolCallId: tool.id,
      });
      continue;
    }
    if (isBackgroundShellTool(tool.name, tool.title, hint)) {
      const command = oneLine(tool.input || tool.title.replace(/^\[(?:bg|monitor)\]\s*/i, ""));
      upsert(tool.id, "shell", {
        running: runningStatus(tool.status, tool.streaming),
        title: command || tool.title || "Shell",
        summary: command,
        startedAtMs,
        shellKind: isLoopName(tool.name) ? "loop" : isMonitorName(tool.name, tool.title) ? "monitor" : "bash",
        tokens: tokensFrom(hint, null),
        toolCallId: tool.id,
        outputFile: undefined,
      });
    }
  }

  for (const event of input.events ?? []) {
    applyWireEvent(rows, event, () => seq++);
  }

  applyMirrors(rows, tools);

  const list = [...rows.values()].sort((a, b) => {
    if (a.running !== b.running) return a.running ? -1 : 1;
    return a.seq - b.seq;
  });
  const bill = input.sessionBillTokens;
  return {
    rows: list.map(stripMutable),
    ...(typeof bill === "number" && Number.isFinite(bill) ? { sessionBillTokens: bill } : {}),
  };
}

function dropUndefined<T extends object>(patch: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(patch) as (keyof T)[]) {
    if (patch[key] !== undefined) out[key] = patch[key];
  }
  return out;
}

function stripMutable(row: MutableRow): FleetRow {
  const { seq: _seq, toolCountFromMeta: _meta, ...rest } = row;
  const out = {} as FleetRow;
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) {
      (out as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

/** Move a transcript shell row onto the wire task id when both ids are present. */
function adoptTaskId(
  rows: Map<string, MutableRow>,
  toolCallId: string | undefined,
  taskId: string | undefined,
) {
  if (!taskId || !toolCallId || taskId === toolCallId) return;
  const from = rows.get(toolCallId);
  if (!from) return;
  const existing = rows.get(taskId);
  rows.delete(toolCallId);
  if (existing && existing !== from) {
    existing.toolCallId = existing.toolCallId || toolCallId;
    if (!existing.title || existing.title === existing.id) existing.title = from.title;
    existing.summary = existing.summary || from.summary;
    existing.startedAtMs = existing.startedAtMs ?? from.startedAtMs;
    existing.shellKind = existing.shellKind || from.shellKind;
    return;
  }
  from.id = taskId;
  from.toolCallId = from.toolCallId || toolCallId;
  rows.set(taskId, from);
}

function shellLink(obj: Record<string, unknown> | null, extra?: Record<string, unknown> | null) {
  const taskId = str(obj, "task_id", "taskId") || str(extra ?? null, "task_id", "taskId");
  const toolCallId =
    str(obj, "tool_call_id", "toolCallId") || str(extra ?? null, "tool_call_id", "toolCallId");
  return { taskId, toolCallId, id: taskId || toolCallId };
}

function applyWireEvent(
  rows: Map<string, MutableRow>,
  event: FleetWireEvent,
  nextSeq: () => number,
) {
  const body = asRecord(event.body);
  if (!body) return;
  if (event.kind === "background_tasks") {
    const tasks = body.tasks;
    if (!Array.isArray(tasks)) return;
    for (const item of tasks) {
      const task = asRecord(item);
      if (!task) continue;
      const link = shellLink(task);
      if (!link.id) continue;
      adoptTaskId(rows, link.toolCallId, link.taskId);
      putShell(rows, link.id, task, nextSeq, str(task, "status"));
    }
    return;
  }
  if (event.kind === "task_backgrounded") {
    const link = shellLink(body);
    if (!link.id) return;
    adoptTaskId(rows, link.toolCallId, link.taskId);
    putShell(rows, link.id, body, nextSeq, "running");
    return;
  }
  if (event.kind === "task_completed") {
    const snap = asRecord(field(body, "task_snapshot", "taskSnapshot")) ?? body;
    const link = shellLink(snap, body);
    if (!link.id) return;
    adoptTaskId(rows, link.toolCallId, link.taskId);
    putShell(rows, link.id, snap, nextSeq, "completed");
  }
}

function putShell(
  rows: Map<string, MutableRow>,
  id: string,
  obj: Record<string, unknown>,
  nextSeq: () => number,
  status: string | undefined,
) {
  const command = str(obj, "display_command", "displayCommand", "command", "description");
  const kind = shellKindOf(str(obj, "kind"));
  const output = str(obj, "output");
  const prev = rows.get(id);
  const running = runningStatus(status);
  const row: MutableRow = {
    id,
    kind: "shell",
    running: status ? running : (prev?.running ?? true),
    title: command || prev?.title || id,
    summary: oneLine(command) || prev?.summary,
    startedAtMs:
      clockMs(field(obj, "started_at", "startedAt")) ??
      clockMs(field(obj, "start_time", "startTime")) ??
      prev?.startedAtMs,
    endedAtMs:
      clockMs(field(obj, "ended_at", "endedAt")) ??
      clockMs(field(obj, "end_time", "endTime")) ??
      prev?.endedAtMs,
    lastLine: output ? lastNonEmptyLine(output, 400) : prev?.lastLine,
    outputFile: str(obj, "output_file", "outputFile") || prev?.outputFile,
    exitCode: num(obj, "exit_code", "exitCode") ?? prev?.exitCode,
    shellKind: kind || prev?.shellKind,
    tokens: num(obj, "tokens", "total_tokens", "totalTokens") ?? prev?.tokens,
    toolCallId: str(obj, "tool_call_id", "toolCallId") || prev?.toolCallId,
    seq: prev?.seq ?? nextSeq(),
    toolCountFromMeta: prev?.toolCountFromMeta ?? false,
    model: prev?.model,
    toolCount: prev?.toolCount,
  };
  if (status && !running) row.running = false;
  rows.set(id, row);
}

function applyMirrors(rows: Map<string, MutableRow>, tools: readonly FleetToolInput[]) {
  const agents = [...rows.values()].filter((row) => row.kind === "agent" && row.childSessionId);
  if (!agents.length) return;
  for (const tool of tools) {
    const match = MIRROR_RE.exec((tool.title || "").trim());
    if (!match) continue;
    const prefix = match[3]!.toLowerCase();
    const activity = match[2]!.trim() || tool.title;
    const agent = agents.find((row) => row.childSessionId!.toLowerCase().startsWith(prefix));
    if (!agent) continue;
    agent.activity = activity;
    if (!agent.toolCountFromMeta) {
      agent.toolCount = (agent.toolCount ?? 0) + 1;
    }
  }
}

/** True when an agent row has no model on the spawn payload. */
export function fleetInheritsParentModel(row: FleetRow): boolean {
  return row.kind === "agent" && !row.model;
}

export function fleetElapsedMs(row: FleetRow, nowMs: number): number | undefined {
  if (row.startedAtMs != null) {
    const end = row.endedAtMs ?? (row.running ? nowMs : undefined);
    if (end == null) {
      return row.durationMs;
    }
    return Math.max(0, end - row.startedAtMs);
  }
  return row.durationMs;
}

export type FleetStopPlan =
  | { kind: "interject"; text: string }
  | { kind: "unavailable"; messageKey: "fleet.stopUnavailable" };

/**
 * Stop never claims a SIGKILL. While a turn is streaming, ask that turn to
 * stop the task. Otherwise keep the honest no-kill copy.
 */
/** Collapse a parent transcript row only when the host marked it as fleet work. */
export function fleetChipKind(input: {
  name?: string;
  title?: string;
  hint?: FleetToolHint;
}): FleetKind | null {
  const name = input.name || "";
  const title = input.title || "";
  const hint = input.hint;
  if (isSpawnName(name)) return "agent";
  if (isWorkflowName(name, title)) return "workflow";
  if (isBackgroundShellTool(name, title, hint)) return "shell";
  return null;
}

export function fleetStopPlan(input: {
  taskId: string;
  streaming: boolean;
  interjectAvailable: boolean;
}): FleetStopPlan {
  const id = input.taskId.trim();
  if (!id || !input.streaming || !input.interjectAvailable) {
    return { kind: "unavailable", messageKey: "fleet.stopUnavailable" };
  }
  return { kind: "interject", text: `stop task ${id}` };
}

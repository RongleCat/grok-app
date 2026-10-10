/**
 * Subagent telemetry merge.
 *
 * The CLI emits `subagent_spawned` / `subagent_progress` / `subagent_finished`
 * notifications; the Rust host decodes them and broadcasts `session://subagent`
 * with a normalized payload. This module merges those pushes into one
 * {@link SubagentRun} per `subagentId`, keeping spawn order.
 *
 * Pure so it can be unit-tested: it renders nothing and performs no I/O.
 * Missing fields stay `undefined` — never fabricated (honesty convention, see
 * {@link ./taskTreeHonesty}).
 *
 * Only the fields the Tasks panel actually renders are carried. The CLI sends
 * more (`parent_session_id`, `model`, `tools_used`, …) and the golden fixture
 * keeps pinning that wire shape, but a field nothing reads is dead weight in
 * the payload, the merge and the type.
 */

import {
  contextPercentCliStyle,
  formatTokenCount,
} from "@/lib/contextUsage";

/** Which lifecycle update a payload carries. */
export type SubagentPhase = "spawned" | "progress" | "finished";

/**
 * Raw `session://subagent` payload. Fields are optional because the host
 * serializes absent values to `null`; treat every field as untrusted and narrow
 * before use.
 */
export type SubagentEventPayload = {
  sessionId?: string | null;
  phase?: string | null;
  subagentId?: string | null;
  subagentType?: string | null;
  description?: string | null;
  status?: string | null;
  durationMs?: number | null;
  turnCount?: number | null;
  toolCallCount?: number | null;
  tokensUsed?: number | null;
  contextWindowTokens?: number | null;
  output?: string | null;
};

/** Merged view of one subagent across its lifecycle updates. */
export type SubagentRun = {
  subagentId: string;
  /** True once a `finished` update landed (terminal; later pushes don't reset). */
  finished: boolean;
  subagentType: string | null;
  description: string | null;
  status: string | null;
  durationMs?: number;
  turnCount?: number;
  toolCallCount?: number;
  tokensUsed?: number;
  contextWindowTokens?: number;
  output: string | null;
};

/** Coarse status the panel renders; derived from `finished` + `status`. */
export type SubagentDisplayStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "finished";

function asText(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function asPhase(v: unknown): SubagentPhase | null {
  return v === "spawned" || v === "progress" || v === "finished" ? v : null;
}

function newRun(id: string, payload: SubagentEventPayload): SubagentRun {
  return {
    subagentId: id,
    finished: asPhase(payload.phase) === "finished",
    subagentType: asText(payload.subagentType),
    description: asText(payload.description),
    status: asText(payload.status),
    durationMs: asNumber(payload.durationMs),
    turnCount: asNumber(payload.turnCount),
    toolCallCount: asNumber(payload.toolCallCount),
    tokensUsed: asNumber(payload.tokensUsed),
    contextWindowTokens: asNumber(payload.contextWindowTokens),
    output: asText(payload.output),
  };
}

/** Apply one payload onto an existing row; absent fields leave it untouched. */
function mergeRun(
  prev: SubagentRun,
  payload: SubagentEventPayload,
): SubagentRun {
  const next: SubagentRun = { ...prev };
  // `finished` is terminal — a stray progress push must not downgrade it.
  if (asPhase(payload.phase) === "finished") next.finished = true;

  next.subagentType = asText(payload.subagentType) ?? prev.subagentType;
  next.description = asText(payload.description) ?? prev.description;
  next.status = asText(payload.status) ?? prev.status;
  next.output = asText(payload.output) ?? prev.output;

  next.durationMs = asNumber(payload.durationMs) ?? prev.durationMs;
  next.turnCount = asNumber(payload.turnCount) ?? prev.turnCount;
  next.toolCallCount = asNumber(payload.toolCallCount) ?? prev.toolCallCount;
  next.tokensUsed = asNumber(payload.tokensUsed) ?? prev.tokensUsed;
  next.contextWindowTokens =
    asNumber(payload.contextWindowTokens) ?? prev.contextWindowTokens;
  return next;
}

/**
 * Fold one `session://subagent` payload into the run list for its session.
 * Insertion order is spawn order; a repeated id updates in place rather than
 * appending a second row. Payloads without a `subagentId` are ignored (returns
 * the same reference).
 */
export function applySubagentEvent(
  prev: readonly SubagentRun[],
  payload: SubagentEventPayload,
): SubagentRun[] {
  const id = asText(payload.subagentId);
  if (!id) return prev as SubagentRun[];
  const idx = prev.findIndex((r) => r.subagentId === id);
  if (idx === -1) return [...prev, newRun(id, payload)];
  const merged = mergeRun(prev[idx]!, payload);
  const next = prev.slice();
  next[idx] = merged;
  return next;
}

/**
 * Coarse panel status. Anything other than a recognised terminal status stays
 * `finished` — a cancelled run is not a failure, and an outcome the CLI never
 * reported must not be invented.
 */
export function subagentDisplayStatus(
  run: SubagentRun,
): SubagentDisplayStatus {
  if (!run.finished) return "running";
  switch (run.status) {
    case "completed":
    case "complete":
    case "success":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    case "cancelled":
    case "canceled":
    case "killed":
      return "cancelled";
    default:
      return "finished";
  }
}

/**
 * Row title: description, else subagent type, else a shortened id. Never
 * fabricates text for a run that has none.
 */
export function subagentDisplayLabel(run: SubagentRun): string {
  if (run.description) return run.description;
  if (run.subagentType) return run.subagentType;
  return run.subagentId.length > 8
    ? `${run.subagentId.slice(0, 8)}…`
    : run.subagentId;
}

/**
 * Human-readable duration for the meta line. `undefined` → `—` (unknown), never
 * a fabricated zero. Units match the existing `accountUi.formatDuration` style.
 */
export function formatSubagentDuration(ms: number | undefined): string {
  if (ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

/** How full a run's context window is, with both sides known. */
export type SubagentContextOccupancy = {
  used: number;
  window: number;
  /** Integer percent, CLI style. */
  percent: number;
};

/**
 * Context-window occupancy for one run, or `null` when the CLI reported only
 * one side. The percentage reuses {@link contextPercentCliStyle} — the same
 * `round(tokens_used / context_window * 100)` the CLI computes for its own
 * `context_usage_pct` — instead of a second formula of our own.
 */
export function subagentContextOccupancy(
  run: SubagentRun,
): SubagentContextOccupancy | null {
  const { tokensUsed: used, contextWindowTokens: window } = run;
  if (used === undefined || window === undefined) return null;
  const percent = contextPercentCliStyle(used, window);
  if (percent === null) return null;
  return { used, window, percent };
}

/** Counts render as-is; a genuinely absent counter stays an honest unknown. */
export function formatSubagentCount(n: number | undefined): string {
  return n === undefined ? "—" : String(n);
}

/**
 * Token term for the meta line. With a reported window this is the occupancy
 * `used / window (pct)`; without one it falls back to the token count the CLI
 * did report, so a run it never gave a denominator for (a subagent that died
 * before its first turn sends no progress frame) still shows what it spent
 * rather than a dash. Unknown on both counts stays `—`.
 */
export function formatSubagentTokens(
  run: SubagentRun,
  locale: string,
): string {
  const occupancy = subagentContextOccupancy(run);
  if (!occupancy) return formatSubagentCount(run.tokensUsed);
  const used = formatTokenCount(occupancy.used, locale);
  const window = formatTokenCount(occupancy.window, locale);
  return `${used} / ${window} (${occupancy.percent}%)`;
}

/**
 * Turn-process summary — DSH-inspired compact control bar model.
 *
 * Pure counts derived from the assistant timeline (tools + body), so the UI
 * can collapse a long pre-answer work burst behind `Tool N · Reply M` instead
 * of painting every row. No i18n here; components localize via existing
 * `chat.*` keys (`chat.ranTools`, `chat.workedFor`, …).
 */

import type { MessageToolSegment } from "./session";
import { classifyToolKind } from "./toolDisplay";
import type { TimelineUnit } from "./timelinePhases";

export interface TurnProcessSummary {
  toolCount: number;
  searchCount: number;
  readCount: number;
  editCount: number;
  bashCount: number;
  browseCount: number;
  subagentCount: number;
  errorCount: number;
  runningCount: number;
  /** Non-empty assistant body fragments (final-answer candidates). */
  replyCount: number;
  /** True when the turn already shows a visible final answer. */
  hasFinalAnswer: boolean;
}

function toolFailed(t: MessageToolSegment): boolean {
  if (t.isError) return true;
  const s = (t.status || "").toLowerCase();
  return s === "failed" || s === "error" || s === "rejected" || s === "denied";
}

function toolRunning(t: MessageToolSegment): boolean {
  if (t.streaming) return true;
  const s = (t.status || "").toLowerCase().trim();
  if (!s) return false;
  return s === "in_progress" || s === "pending" || s === "running";
}

/** Summarize one assistant message's timeline units (phase-aware). */
export function buildTurnProcessSummary(units: TimelineUnit[]): TurnProcessSummary {
  const summary: TurnProcessSummary = {
    toolCount: 0,
    searchCount: 0,
    readCount: 0,
    editCount: 0,
    bashCount: 0,
    browseCount: 0,
    subagentCount: 0,
    errorCount: 0,
    runningCount: 0,
    replyCount: 0,
    hasFinalAnswer: false,
  };
  const seenTools = new Set<string>();
  const countTool = (t: MessageToolSegment) => {
    const key = t.toolCallId || `${t.toolKind}:${t.title}`;
    if (seenTools.has(key)) return;
    seenTools.add(key);
    summary.toolCount += 1;
    const bucket = classifyToolKind(t.toolKind, t.title, t.toolCallId);
    if (bucket === "search") summary.searchCount += 1;
    else if (bucket === "read") summary.readCount += 1;
    else if (bucket === "edit") summary.editCount += 1;
    else if (bucket === "bash") summary.bashCount += 1;
    else if (bucket === "browse") summary.browseCount += 1;
    else if (bucket === "subagent") summary.subagentCount += 1;
    if (toolFailed(t)) summary.errorCount += 1;
    if (toolRunning(t)) summary.runningCount += 1;
  };
  for (const u of units) {
    if (u.kind === "phase") {
      for (const t of u.tools) countTool(t);
    } else if (u.kind === "tool") {
      countTool(u.tool);
    } else if (u.kind === "content") {
      if (u.text.trim()) {
        summary.replyCount += 1;
        summary.hasFinalAnswer = true;
      }
    }
  }
  return summary;
}

/**
 * Whether the compact control bar is worthwhile (vs the full Worked-for rail).
 * Matches DSH Compact: collapse pre-answer work when there is real work and a
 * visible answer; keep full rail for tool-only / thinking-only turns.
 */
export function shouldCompactTurnProcess(summary: TurnProcessSummary): boolean {
  if (!summary.hasFinalAnswer) return false;
  return summary.toolCount >= 2;
}

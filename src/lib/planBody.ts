/**
 * Plan body helpers — markdown for resource review + entry fallbacks.
 */

import {
  parsePlanEntries,
  type PlanEntry,
  type PlanEntryStatus,
} from "@/lib/planStatus";

/** Shared plan snapshot shape (App + ResourceViewer + thread). */
export type PlanReviewState = {
  visible: boolean;
  waiting: boolean;
  title: string;
  body: string;
  entries: unknown[];
  rpcId?: number | null;
  toolCallId?: string | null;
};

/** Checkbox-style prefix for markdown step lists. */
function statusMdMarker(status: PlanEntryStatus): string {
  if (status === "completed") return "[x]";
  if (status === "cancelled") return "[-]";
  if (status === "in_progress") return "[~]";
  return "[ ]";
}

/** Build a markdown steps section from parsed entries. */
export function planEntriesToMarkdown(entries: PlanEntry[]): string {
  if (!entries.length) return "";
  const lines = entries.map((e, i) => {
    const mark = statusMdMarker(e.status);
    const pri = e.priority ? ` *(${e.priority})*` : "";
    return `${i + 1}. ${mark} ${e.content}${pri}`;
  });
  return lines.join("\n");
}

/**
 * Prefer ACP planContent body; if empty, synthesize a readable markdown list
 * from plan entries so the review panel is never blank when steps exist.
 */
export function planDisplayMarkdown(
  body: string | null | undefined,
  entries: unknown[] | null | undefined,
): string {
  const trimmed = (body ?? "").trim();
  if (trimmed) return trimmed;
  const parsed = parsePlanEntries(entries ?? []);
  if (!parsed.length) return "";
  return planEntriesToMarkdown(parsed);
}

/** True when approve / request-changes should be enabled (exit_plan_mode gate). */
export function planActionsEnabled(plan: Pick<PlanReviewState, "rpcId">): boolean {
  return plan.rpcId != null;
}

/** Review gate ready for user decision. */
export function planIsAwaitingReview(
  plan: Pick<PlanReviewState, "visible" | "rpcId">,
): boolean {
  return plan.visible && plan.rpcId != null;
}

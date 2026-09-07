/**
 * Failed-tool excerpt under a folded Worked-for header.
 *
 * History keeps the activity rail collapsed. Failures stay visible as
 * one-line leaves (not the whole step list, not a group label).
 */

import {
  buildGrokActivitySteps,
  toolFailed,
  type GrokActivityStep,
  type GrokPhaseItem,
} from "./grokActivitySteps";
import { GROK_ACTIVITY_STEP_ROW_PX } from "./grokActivityVirtualize";
import type { MessageToolSegment } from "./session";

/** Visible failed rows under a folded header. Overflow is a single extra row. */
export const PHASE_ERROR_EXCERPT_CAP = 5;

export type PhaseErrorExcerpt = {
  rows: GrokActivityStep[];
  overflow: number;
};

const emptyExcerpt: PhaseErrorExcerpt = { rows: [], overflow: 0 };

function failedToolItems(
  items: readonly GrokPhaseItem[],
): Extract<GrokPhaseItem, { kind: "tool" }>[] {
  const out: Extract<GrokPhaseItem, { kind: "tool" }>[] = [];
  for (const it of items) {
    if (it.kind !== "tool") continue;
    if (!toolFailed(it.tool)) continue;
    out.push(it);
  }
  return out;
}

/**
 * Failed leaves from stream-ordered phase items.
 * Builds one tool at a time so bash/explore grouping cannot swallow a
 * failure into “Ran N commands”.
 */
export function collectPhaseErrorExcerpt(
  items: readonly GrokPhaseItem[],
  cap: number = PHASE_ERROR_EXCERPT_CAP,
): PhaseErrorExcerpt {
  const limit = Math.max(0, Math.floor(cap));
  const failed = failedToolItems(items);
  if (failed.length === 0 || limit === 0) {
    return failed.length === 0
      ? emptyExcerpt
      : { rows: [], overflow: failed.length };
  }
  const overflow = Math.max(0, failed.length - limit);
  const rows: GrokActivityStep[] = [];
  for (const it of failed.slice(0, limit)) {
    const built = buildGrokActivitySteps([it], {
      live: false,
      messageStreaming: false,
    });
    for (const step of built) {
      if (step.type === "thought" || step.type === "speech") continue;
      rows.push(step);
    }
  }
  return { rows, overflow };
}

export function countFailedToolSegments(
  tools: readonly Pick<MessageToolSegment, "isError" | "status">[],
): number {
  let n = 0;
  for (const t of tools) {
    if (toolFailed(t as MessageToolSegment)) n += 1;
  }
  return n;
}

/** Extra px under a folded Worked-for header (failed rows + optional overflow). */
export function phaseErrorExcerptHeightPx(
  failedCount: number,
  cap: number = PHASE_ERROR_EXCERPT_CAP,
  rowPx: number = GROK_ACTIVITY_STEP_ROW_PX,
): number {
  const n = Math.max(0, Math.floor(failedCount));
  if (n <= 0) return 0;
  const shown = Math.min(n, Math.max(0, Math.floor(cap)));
  const overflowRow = n > cap ? 1 : 0;
  return (shown + overflowRow) * rowPx;
}

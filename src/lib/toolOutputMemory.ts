/**
 * Keep completed tool stdout small in React / WebContent heap (#1029).
 *
 * Host already caps each tool at ~20k chars, but live state often holds that
 * twice (standalone `tool_step.toolOutput` + assistant `segments[].output`).
 * Expand UI only ever paints {@link toolOutputBody} (≤400 lines), so storing
 * anything larger than that elided form wastes RAM without changing expand UX.
 *
 * Running tools keep the growing raw buffer; we compact only on terminal
 * status so a mid-run expand still sees the latest chunks.
 */

import { toolOutputBody } from "@/lib/toolDisplay";

/** Line budget — same as expand body so compact ≡ what the user already sees. */
export const TOOL_OUTPUT_MEMORY_MAX_LINES = 400;

/**
 * Hard char ceiling after line elide (very long lines can still bloat 400 rows).
 * Head-heavy so errors / file headers stay visible.
 */
export const TOOL_OUTPUT_MEMORY_MAX_CHARS = 8_000;

/** Compact stdout for in-memory chat state (idempotent). */
export function compactToolOutputForMemory(
  output: string,
  maxLines: number = TOOL_OUTPUT_MEMORY_MAX_LINES,
  maxChars: number = TOOL_OUTPUT_MEMORY_MAX_CHARS,
): string {
  const byLines = toolOutputBody(output, maxLines);
  if (byLines.length <= maxChars) return byLines;
  const marker = "\n…\n";
  const budget = maxChars - marker.length;
  if (budget < 64) return byLines.slice(0, maxChars);
  const head = Math.ceil(budget * 0.7);
  const tail = budget - head;
  return byLines.slice(0, head).trimEnd() + marker + byLines.slice(-tail).trimStart();
}

/** True when compacting would shrink the string (skip no-ops). */
export function shouldCompactToolOutputForMemory(
  output: string | null | undefined,
): boolean {
  if (!output) return false;
  return compactToolOutputForMemory(output) !== output;
}

/**
 * Apply memory compact when the tool is no longer running.
 * Returns `output` unchanged while pending / in_progress.
 */
export function maybeCompactToolOutputForMemory(
  output: string | null | undefined,
  running: boolean,
): string | undefined {
  if (!output) return output || undefined;
  if (running) return output;
  return compactToolOutputForMemory(output);
}

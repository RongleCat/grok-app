/** Build the agent-facing continue prompt after a host/agent interrupt. */

import {
  endOfTurnChipShowsContinue,
  mapEndOfTurnReason,
  parseEndOfTurnContent,
} from "./endOfTurn";

export interface ContinueInterruptContext {
  command?: string | null;
  title?: string | null;
  toolName?: string | null;
}

export const CONTINUE_JOURNAL_PHRASE_KEY = "endOfTurn.continuePrompt" as const;

export function buildContinueAgentPrompt(
  ctx: ContinueInterruptContext | null | undefined,
): string {
  const command = ctx?.command?.trim() ?? "";
  const title = ctx?.title?.trim() ?? "";
  const toolName = ctx?.toolName?.trim() ?? "";
  const lines = [
    "The previous turn was interrupted when the app host process restarted.",
    "Do not redo steps that already succeeded. Continue the user's last request from the interrupted tool call.",
    "Do not assume a previous permission prompt is still open — request approval again if you need to run a command.",
  ];
  if (toolName) {
    lines.push(`Interrupted tool: ${toolName}`);
  }
  if (title) {
    lines.push(`Tool title: ${title}`);
  }
  if (command) {
    lines.push("Unfinished command:");
    lines.push("```");
    lines.push(command);
    lines.push("```");
  } else {
    lines.push(
      "The unfinished command is not available. Use the conversation history to resume from the last incomplete step.",
    );
  }
  return lines.join("\n");
}

/** User ended a turn whose model stream was cut off. Not a host restart. */
export function buildContinueAfterStopPrompt(): string {
  return [
    "The previous turn was ended by the user because the model stream was cut off.",
    "Do not redo steps that already succeeded.",
    "Check the plan and what is actually on disk.",
    "Continue from the first unfinished step.",
  ].join("\n");
}

/**
 * Same continuable set as the end-of-turn chip.
 * Aliases such as `process_exit` and `host` map before the check.
 */
export function isContinuableEndReason(reason: string | null | undefined): boolean {
  return endOfTurnChipShowsContinue(mapEndOfTurnReason(reason).reason);
}

/** Last continuable end chip after the last user prompt (or null). */
export function latestContinuableEndMessageId(
  messages: Array<{
    id: string;
    role?: string;
    marker?: string | null;
    content?: string | null;
    toolStatus?: string | null;
  }>,
): string | null {
  let lastUser = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === "user") lastUser = i;
  }
  const start = lastUser + 1;
  for (let i = messages.length - 1; i >= start; i--) {
    const m = messages[i];
    if (!m) continue;
    const marker = (m.marker || "").toLowerCase();
    const isEnd =
      marker === "turn_cancelled" ||
      marker === "turn_end" ||
      marker === "end_of_turn" ||
      (m.role === "tool" &&
        (m.content?.startsWith("turn_cancelled") ||
          m.content?.startsWith("turn_end|")));
    if (!isEnd) continue;
    // Journal content wins, matching EndOfTurnChip. toolStatus on a
    // reloaded row is often a generic `cancelled` while the body still
    // says `turn_cancelled|user_stop`.
    const fromContent = parseEndOfTurnContent(m.content);
    if (fromContent) {
      if (isContinuableEndReason(fromContent)) return m.id;
      continue;
    }
    if (isContinuableEndReason(m.toolStatus)) return m.id;
  }
  return null;
}

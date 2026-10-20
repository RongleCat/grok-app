/**
 * Per-session director steering.
 *
 * App Settings → Director mode turns this on for every chat. The same
 * paragraph is sent as ACP `_meta.rules` on the next `session/new`
 * (see `src-tauri/src/director.rs`). An already-open session is steered by
 * wrapping the next send. This module does not write `~/.grok`.
 */

export const DIRECTOR_RULE =
  "Do lane work with a background workflow or background subagents. Keep this transcript to decisions, blockers, and a short status. Put file lists, diffs, and command output in the child prompt. Name the task ids started. Ask before two writers share one tree.";

export type DirectorIntent = "review" | "fanout";

const INHERITANCE_NOTE =
  "Subagent model inheritance is on. The CLI will reject a per-child model. Do not set a model on spawn_subagent.";

export function wrapDirectorSend(input: {
  userText: string;
  directorOn: boolean;
  intent?: DirectorIntent | null;
  childModel?: string | null;
  inheritanceOn: boolean;
}): string {
  const model = (input.childModel || "").trim();
  const parts: string[] = [];
  if (input.intent === "review") {
    parts.push(
      "Review this in the background. Start a background subagent or workflow. Keep this transcript to the decision and the task id.",
    );
  } else if (input.intent === "fanout") {
    parts.push(
      "Fan the fixes out in the background. Use a background workflow when the work has phases, or background subagents with isolation worktree when they write files. Ask before two writers share one tree. Name the task ids you start. Keep this transcript to decisions, blockers, and a short status.",
    );
  } else if (input.directorOn) {
    parts.push(DIRECTOR_RULE);
  }
  if (model && input.inheritanceOn && (input.intent || input.directorOn)) {
    parts.push(INHERITANCE_NOTE);
  } else if (model && (input.intent || input.directorOn)) {
    parts.push(`Child model: ${model}`);
  }
  if (!parts.length) return input.userText;
  return `${parts.join("\n\n")}\n\nUser request:\n${input.userText.trim()}`;
}

export function directorChildModelRejected(inheritanceOn: boolean, childModel: string): boolean {
  return inheritanceOn && childModel.trim().length > 0;
}

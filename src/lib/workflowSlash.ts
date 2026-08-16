/**
 * Composer `/workflow` · `/workflows` — App stand-in for Grok Build TUI commands.
 *
 * The CLI TUI intercepts these as shell builtins (`/workflows` is fullscreen-only).
 * This App has no TUI dashboard; the Settings workflows card is the host surface.
 * `/workflow <args>` is passed through as a session turn so the agent / CLI host
 * can launch, pause, resume, stop, or save a run.
 */

export type WorkflowSlashKind = "dashboard" | "session";

export type WorkflowSlashMatch = {
  kind: WorkflowSlashKind;
  /** Canonical command when `kind` is `session`, e.g. `/workflow review-changes`. */
  command?: string;
};

/**
 * Classify a slash query (no leading `/`), e.g. `workflow review-changes`.
 * The live slash token itself never includes spaces (`[^\s]*`), so args usually
 * arrive via leftover draft text after `/workflow`.
 */
export function classifyWorkflowSlashQuery(
  query: string | null | undefined,
): WorkflowSlashMatch | null {
  const q = (query ?? "").trim();
  if (!q) return null;
  const m = /^(workflow|workflows)(?:\s+(.*))?$/i.exec(q);
  if (!m) return null;
  const name = m[1]!.toLowerCase();
  const args = (m[2] ?? "").trim();
  if (name === "workflows") return { kind: "dashboard" };
  if (!args) return { kind: "dashboard" };
  return { kind: "session", command: `/workflow ${args}` };
}

/**
 * Classify a full composer draft / first line.
 * Returns null when this is not a lone workflow slash command (other paragraphs
 * or a non-workflow `/` stay a normal send).
 */
export function classifyWorkflowSlashLine(
  text: string | null | undefined,
): WorkflowSlashMatch | null {
  const raw = String(text ?? "")
    .replace(/^\uFEFF/, "")
    .trim();
  if (!raw.startsWith("/")) return null;
  const nl = raw.search(/[\r\n]/);
  const first = (nl === -1 ? raw : raw.slice(0, nl)).trim();
  const rest = nl === -1 ? "" : raw.slice(nl).trim();
  if (rest) return null;
  if (!first.startsWith("/")) return null;
  return classifyWorkflowSlashQuery(first.slice(1));
}

/** Text on the same line after the `/workflow` token (exclusive `slashEnd`). */
export function leftoverWorkflowArgs(stored: string, slashEnd: number): string {
  const after = String(stored ?? "").slice(Math.max(0, slashEnd));
  const line = after.split(/\r?\n/, 1)[0] ?? "";
  return line.trim();
}

/**
 * Drop `/workflow` (or `/workflows`) plus same-line leftover args.
 * Keeps later paragraphs. Used when the palette pick consumes the command.
 */
export function stripWorkflowSlashFromDraft(
  stored: string,
  slashStart: number,
  slashEnd: number,
): string {
  const s = String(stored ?? "");
  const start = Math.max(0, slashStart);
  const end = Math.max(start, slashEnd);
  const after = s.slice(end);
  const nl = after.search(/[\r\n]/);
  const keep = nl === -1 ? "" : after.slice(nl).replace(/^\r?\n/, "");
  return (s.slice(0, start) + keep).replace(/[ \t]+$/u, "");
}

/**
 * If leftover args exist, treat as a session `/workflow <args>` launch.
 * Otherwise keep the query classification (usually dashboard).
 */
export function resolveWorkflowSlashAction(input: {
  query?: string | null;
  leftoverArgs?: string | null;
  /** Force dashboard (`/workflows` item) even when leftover text exists. */
  forceDashboard?: boolean;
}): WorkflowSlashMatch {
  if (input.forceDashboard) return { kind: "dashboard" };
  const leftover = (input.leftoverArgs ?? "").trim();
  if (leftover) {
    return { kind: "session", command: `/workflow ${leftover}` };
  }
  return classifyWorkflowSlashQuery(input.query) ?? { kind: "dashboard" };
}

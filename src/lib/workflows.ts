/**
 * Grok Build workflows — pure helpers (enable config + discovery + run).
 *
 * Workflows are deterministic Rhai scripts that orchestrate subagents via the
 * Grok Build **`workflow` tool** (agent tool; not a top-level `grok workflow`
 * CLI subcommand as of 0.2.117). Files live under:
 * - User: `~/.grok/workflows/<name>.rhai`
 * - Project: `<repo>/.grok/workflows/<name>.rhai`
 *
 * App surfaces:
 * - `workflows_enabled` AppSettings → independent agent-home `config.toml`
 * - Soft-fail name discovery
 * - Soft-fail **headless smoke/run** via short `grok -p` that must call the
 *   `workflow` tool by registered name (Settings result panel; no visual editor)
 *
 * Docs honesty: author via `/create-workflow`; interactive full runs via
 * `/workflow <name>` or the `/workflows` dashboard — App does not invent a
 * visual workflow graph editor.
 */

/** Top-level config.toml key. */
export const WORKFLOWS_ENABLED_CONFIG_KEY = "workflows_enabled";

/** Relative dir under GROK home / project `.grok`. */
export const WORKFLOWS_DIR_NAME = "workflows";

/** Bundled skill that documents authoring (relative under `~/.grok`). */
export const CREATE_WORKFLOW_SKILL_SEGMENTS = [
  "bundled",
  "skills",
  "create-workflow",
  "SKILL.md",
] as const;

export type WorkflowScope = "project" | "user" | "agent_home";

export type WorkflowDefLike = {
  name: string;
  path: string;
  scope: WorkflowScope;
};

/**
 * Normalize the enable toggle.
 * null / undefined → false (App + CLI-aligned opt-in default).
 */
export function normalizeWorkflowsEnabled(
  raw: boolean | null | undefined,
): boolean {
  return raw === true;
}

/** True when two raw toggles normalize equal. */
export function workflowsEnabledEqual(
  a: boolean | null | undefined,
  b: boolean | null | undefined,
): boolean {
  return normalizeWorkflowsEnabled(a) === normalizeWorkflowsEnabled(b);
}

/** `~/.grok` style root from a user home directory. */
export function grokHomeFromUserHome(userHome: string): string {
  const home = (userHome ?? "").trim().replace(/[/\\]+$/g, "");
  if (!home) return ".grok";
  const sep = home.includes("\\") && !home.includes("/") ? "\\" : "/";
  return `${home}${sep}.grok`;
}

function joinPath(...parts: string[]): string {
  const cleaned = parts
    .map((p) => p.replace(/[/\\]+$/g, ""))
    .filter((p, i) => (i === 0 ? p.length > 0 : p.length > 0));
  if (cleaned.length === 0) return "";
  const first = cleaned[0];
  const sep = first.includes("\\") && !first.includes("/") ? "\\" : "/";
  const isAbsUnix = first.startsWith("/");
  const isAbsWin = /^[A-Za-z]:/.test(first);
  const segs: string[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const piece = cleaned[i].replace(/\\/g, "/");
    for (const s of piece.split("/").filter(Boolean)) segs.push(s);
  }
  if (isAbsWin) {
    const drive = cleaned[0].slice(0, 2);
    const afterDrive = segs[0]?.includes(":") ? segs.slice(1) : segs.slice(1);
    return `${drive}\\${afterDrive.join("\\")}`;
  }
  if (isAbsUnix) return `/${segs.join("/")}`;
  return segs.join(sep);
}

/**
 * Absolute directories where workflow `.rhai` files are discovered.
 * `projectPath` is the workbench project root (not GROK_HOME).
 */
export function resolveWorkflowDirs(
  userHome: string,
  projectPath?: string | null,
): {
  user: string;
  project: string | null;
  skillDoc: string;
} {
  const grok = grokHomeFromUserHome(userHome);
  const user = joinPath(grok, WORKFLOWS_DIR_NAME);
  const skillDoc = joinPath(grok, ...CREATE_WORKFLOW_SKILL_SEGMENTS);
  const proj = (projectPath ?? "").trim().replace(/[/\\]+$/g, "");
  const project = proj
    ? joinPath(proj, ".grok", WORKFLOWS_DIR_NAME)
    : null;
  return { user, project, skillDoc };
}

const RHAI_RE = /\.rhai$/i;

/**
 * Definition name = file stem (`review-changes.rhai` → `review-changes`).
 * Rejects empty, dotfiles, README.
 */
export function workflowNameFromFileName(
  fileName: string | null | undefined,
): string | null {
  const base = (fileName ?? "").trim().replace(/^.*[/\\]/, "");
  if (!base || base.startsWith(".")) return null;
  if (!RHAI_RE.test(base)) return null;
  const stem = base.replace(RHAI_RE, "").trim();
  if (!stem || stem.toLowerCase() === "readme") return null;
  return stem;
}

/** True when a file name is a Grok workflow script. */
export function isWorkflowDefinitionFileName(
  fileName: string | null | undefined,
): boolean {
  return workflowNameFromFileName(fileName) != null;
}

/** Collect workflow names from bare file basenames in a directory listing. */
export function workflowNamesFromFileList(fileNames: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of fileNames) {
    const name = workflowNameFromFileName(f);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return out;
}

function scopeRank(scope: WorkflowScope): number {
  switch (scope) {
    case "project":
      return 0;
    case "user":
      return 1;
    case "agent_home":
      return 2;
    default:
      return 9;
  }
}

/**
 * Merge project + user (+ optional agent-home) workflow file lists into
 * de-duplicated defs. Same name: project > user > agent_home.
 */
export function collectWorkflowDefs(input: {
  userFiles?: string[];
  projectFiles?: string[];
  agentHomeFiles?: string[];
  userDir?: string;
  projectDir?: string | null;
  agentHomeDir?: string | null;
}): WorkflowDefLike[] {
  const rows: WorkflowDefLike[] = [];
  const push = (
    files: string[] | undefined,
    scope: WorkflowScope,
    dir: string | null | undefined,
  ) => {
    if (!files?.length) return;
    const base = (dir ?? "").replace(/[/\\]+$/g, "");
    for (const f of files) {
      const name = workflowNameFromFileName(f);
      if (!name) continue;
      const fileBase = f.replace(/^.*[/\\]/, "");
      const path = base
        ? `${base}${base.includes("\\") ? "\\" : "/"}${fileBase}`
        : fileBase;
      rows.push({ name, path, scope });
    }
  };
  push(input.projectFiles, "project", input.projectDir);
  push(input.userFiles, "user", input.userDir);
  push(input.agentHomeFiles, "agent_home", input.agentHomeDir);

  rows.sort((a, b) => {
    const r = scopeRank(a.scope) - scopeRank(b.scope);
    if (r !== 0) return r;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  const seen = new Set<string>();
  const out: WorkflowDefLike[] = [];
  for (const w of rows) {
    const key = w.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

/** Short meta line for list UI. */
export function workflowMetaLine(
  w: Pick<WorkflowDefLike, "name" | "scope">,
  labels?: Partial<Record<WorkflowScope, string>>,
): string {
  const scopeLabel =
    labels?.[w.scope] ??
    (w.scope === "project"
      ? "project"
      : w.scope === "agent_home"
        ? "agent-home"
        : "user");
  return `${w.name} · ${scopeLabel}`;
}

/** Format a short discovered-names summary (empty → null for honesty empty state). */
export function formatDiscoveredWorkflowNames(
  workflows: ReadonlyArray<Pick<WorkflowDefLike, "name">>,
  max = 12,
): string | null {
  if (!workflows.length) return null;
  const names = workflows.map((w) => w.name);
  if (names.length <= max) return names.join(", ");
  const head = names.slice(0, max).join(", ");
  return `${head} (+${names.length - max})`;
}

// ── Run (headless workflow tool) ───────────────────────────────────────────

/** Settings / host run modes. */
export type WorkflowRunMode = "validate" | "launch";

/**
 * Host soft-fail reason codes for `workflows_run`.
 * Keep in sync with `agent_workflows` Rust module.
 */
export type WorkflowRunReason =
  | "ok"
  | "invalid_name"
  | "cli_missing"
  | "timeout"
  | "spawn_failed"
  | "empty"
  | "nonzero_exit"
  | "soft_fail";

export type WorkflowRunResultLike = {
  ok: boolean;
  reason: string;
  workflowName?: string | null;
  mode?: WorkflowRunMode | string | null;
  log?: string | null;
  durationMs?: number | null;
  truncated?: boolean | null;
  cliPath?: string | null;
  cliVersion?: string | null;
};

/** Max characters kept for the result log surface (FE + host align). */
export const WORKFLOW_RUN_LOG_MAX_CHARS = 4_000;

/** Host event for progressive headless workflow output. */
export const WORKFLOW_RUN_PROGRESS_EVENT = "workflows://run-progress";

export type WorkflowRunProgressPayload = {
  workflowName?: string | null;
  mode?: string | null;
  kind?: "stdout" | "stderr" | "status" | string | null;
  line?: string | null;
  elapsedMs?: number | null;
};

/**
 * Append a progress line to the live log buffer (soft cap).
 * Status lines are prefixed; empty lines ignored.
 */
export function appendWorkflowRunLiveLog(
  prev: string,
  payload: WorkflowRunProgressPayload | null | undefined,
  maxChars: number = WORKFLOW_RUN_LOG_MAX_CHARS,
): string {
  if (!payload) return prev;
  const kind = String(payload.kind ?? "stdout").trim().toLowerCase();
  let line = String(payload.line ?? "").replace(/\r/g, "").trimEnd();
  if (!line && kind !== "status") return prev;
  if (kind === "status") {
    line = line ? `· ${line}` : "· …";
  } else if (kind === "stderr") {
    line = line.startsWith("[stderr]") ? line : `[stderr] ${line}`;
  }
  const next = prev ? `${prev}\n${line}` : line;
  if (next.length <= maxChars) return next;
  return `…${next.slice(-(maxChars - 1))}`;
}

/** Format elapsed ms for the busy panel (e.g. 12s, 1m 05s). */
export function formatWorkflowRunElapsed(ms: number | null | undefined): string {
  const n = Math.max(0, Math.floor(Number(ms) || 0));
  const sec = Math.floor(n / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/** Soft cap on workflow definition names accepted for run. */
export const WORKFLOW_NAME_MAX_LEN = 96;

const WORKFLOW_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * True when a discovered / typed workflow name is safe for host spawn argv
 * and the workflow tool `name` field.
 */
export function isValidWorkflowName(
  name: string | null | undefined,
): boolean {
  const n = (name ?? "").trim();
  if (!n || n.length > WORKFLOW_NAME_MAX_LEN) return false;
  if (n.includes("..") || n.includes("/") || n.includes("\\")) return false;
  return WORKFLOW_NAME_RE.test(n);
}

/** Normalize mode; unknown / empty → `validate` (safest Settings path). */
export function normalizeWorkflowRunMode(
  raw: string | null | undefined,
): WorkflowRunMode {
  const m = (raw ?? "").trim().toLowerCase();
  if (m === "launch" || m === "run" || m === "start") return "launch";
  return "validate";
}

/**
 * Headless prompt that forces a single `workflow` tool call.
 * There is no `grok workflow` CLI subcommand — this is the safest App path.
 */
export function buildWorkflowRunPrompt(
  name: string,
  mode: WorkflowRunMode | string | null | undefined = "validate",
): string {
  const safe = (name ?? "").trim();
  const m = normalizeWorkflowRunMode(mode);
  if (m === "launch") {
    return [
      "Call the workflow tool exactly once with these parameters, then stop:",
      `- name: "${safe}"`,
      "- agent_budget: 8",
      "Do not invent script or script_path. Do not call other tools first.",
      "After the tool returns, reply with only a short summary of success or error (no secrets, no full script).",
    ].join("\n");
  }
  return [
    "Call the workflow tool exactly once with these parameters, then stop:",
    `- name: "${safe}"`,
    "- validate_only: true",
    "- agent_budget: 1",
    "Do not invent script or script_path. Do not call other tools first.",
    "This is a path-specific smoke check only — not a live multi-agent run.",
    "After the tool returns, reply with only a short summary of success or error (no secrets, no full script).",
  ].join("\n");
}

const SENSITIVE_LOG =
  /\b(sk-[A-Za-z0-9]{10,}|xai-[A-Za-z0-9]{10,}|Bearer\s+[A-Za-z0-9\-._~+/]+=*|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,})\b/gi;

/** Redact likely secrets in a workflow run log line/blob. */
export function redactWorkflowRunLog(
  text: string | null | undefined,
): string {
  if (text == null) return "";
  return String(text).replace(SENSITIVE_LOG, "[REDACTED]");
}

/** Truncate log for UI (character-based; appends ellipsis). */
export function truncateWorkflowRunLog(
  text: string | null | undefined,
  max = WORKFLOW_RUN_LOG_MAX_CHARS,
): { text: string; truncated: boolean } {
  const raw = (text ?? "").trim();
  if (!raw) return { text: "", truncated: false };
  if (raw.length <= max) return { text: raw, truncated: false };
  const clipped = raw.slice(0, Math.max(0, max - 1));
  return { text: `${clipped}…`, truncated: true };
}

/** Redact + truncate for the Settings result panel. */
export function prepareWorkflowRunLogForDisplay(
  text: string | null | undefined,
  max = WORKFLOW_RUN_LOG_MAX_CHARS,
): { text: string; truncated: boolean } {
  return truncateWorkflowRunLog(redactWorkflowRunLog(text), max);
}

/** Map host reason → stable UI key segment (after `settings.workflows.run.reason.`). */
export function workflowRunReasonKey(
  reason: string | null | undefined,
): string {
  const r = (reason ?? "").trim().toLowerCase() || "soft_fail";
  switch (r) {
    case "ok":
    case "invalid_name":
    case "cli_missing":
    case "timeout":
    case "spawn_failed":
    case "empty":
    case "nonzero_exit":
    case "soft_fail":
      return r;
    default:
      return "soft_fail";
  }
}

/** True when a run result should be treated as success for green status. */
export function isWorkflowRunOk(
  result: Pick<WorkflowRunResultLike, "ok" | "reason"> | null | undefined,
): boolean {
  if (!result) return false;
  if (result.ok) return true;
  return workflowRunReasonKey(result.reason) === "ok";
}

/** One-line status for the result chrome. */
export function formatWorkflowRunStatusLine(
  result: Pick<WorkflowRunResultLike, "ok" | "reason" | "durationMs"> | null | undefined,
  labels?: {
    ok?: string;
    softFail?: string;
    reason?: string;
  },
): string {
  if (!result) return "";
  const okLabel = labels?.ok ?? "ok";
  const soft = labels?.softFail ?? "soft-fail";
  const reasonLabel = labels?.reason ?? result.reason ?? "soft_fail";
  const base = isWorkflowRunOk(result) ? okLabel : `${soft}: ${reasonLabel}`;
  const ms = result.durationMs;
  if (typeof ms === "number" && Number.isFinite(ms) && ms >= 0) {
    const sec = ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
    return `${base} · ${sec}`;
  }
  return base;
}

/**
 * How Settings received the headless log.
 * Never claim "live" unless progressive host events actually arrived.
 */
export type WorkflowRunLogDelivery =
  | "awaiting"
  | "live"
  | "batch"
  | "none";

function hasLogText(text: string | null | undefined): boolean {
  return !!(text && String(text).trim());
}

/**
 * Resolve progressive vs batch log honesty for the Settings run panel.
 *
 * | busy | sawProgress | final/live log | delivery |
 * | true | false       | *              | awaiting |
 * | true | true        | *              | live     |
 * | false| true        | *              | live     |
 * | false| false       | has final log  | batch    |
 * | false| false       | empty          | none     |
 */
export function resolveWorkflowRunLogDelivery(input: {
  busy: boolean;
  /** True when ≥1 host `workflows://run-progress` event was applied. */
  sawProgress: boolean;
  liveLog?: string | null;
  finalLog?: string | null;
}): WorkflowRunLogDelivery {
  if (input.busy) {
    return input.sawProgress ? "live" : "awaiting";
  }
  if (input.sawProgress) return "live";
  if (hasLogText(input.finalLog) || hasLogText(input.liveLog)) return "batch";
  return "none";
}

/** i18n key for the log delivery label (after `t()`). */
export function workflowRunLogDeliveryMessageKey(
  delivery: WorkflowRunLogDelivery,
): string {
  switch (delivery) {
    case "awaiting":
      return "settings.workflows.run.logAwaiting";
    case "live":
      return "settings.workflows.run.liveLogHint";
    case "batch":
      return "settings.workflows.run.batchLogHint";
    case "none":
      return "settings.workflows.run.noLog";
  }
}

/** Extra soft-fail honesty beyond the short reason chip. */
export type WorkflowRunHonestyNoteKind =
  | "none"
  | "empty_log"
  | "cli_missing"
  | "shared_mode_no_rewrite";

export type WorkflowRunHonestyNote = {
  kind: WorkflowRunHonestyNoteKind;
  /** i18n key; null when kind is `none`. */
  messageKey: string | null;
};

/**
 * Soft-fail empty log / CLI missing / shared-mode rewrite refusal notes.
 * Pure — UI translates `messageKey` via `t()`.
 *
 * Priority: cli_missing → empty (reason or missing capture) → shared rewrite
 * (soft-fail only). Success / covered by status line → none.
 */
export function resolveWorkflowRunHonestyNote(input: {
  busy: boolean;
  ok?: boolean | null;
  reason?: string | null;
  hasLog?: boolean | null;
  /** App `session_data_mode`: shared never rewrites `~/.grok`. */
  sessionDataMode?: string | null;
}): WorkflowRunHonestyNote {
  if (input.busy) {
    return { kind: "none", messageKey: null };
  }
  const reason = workflowRunReasonKey(input.reason);
  const ok = input.ok === true || reason === "ok";
  if (ok) {
    return { kind: "none", messageKey: null };
  }
  const hasLog = !!input.hasLog;
  const shared =
    String(input.sessionDataMode ?? "")
      .trim()
      .toLowerCase() === "shared";

  if (reason === "cli_missing") {
    return {
      kind: "cli_missing",
      messageKey: "settings.workflows.run.honesty.cliMissing",
    };
  }
  if (reason === "empty" || (!hasLog && reason !== "invalid_name")) {
    return {
      kind: "empty_log",
      messageKey: "settings.workflows.run.honesty.emptyLog",
    };
  }
  if (shared) {
    return {
      kind: "shared_mode_no_rewrite",
      messageKey: "settings.workflows.run.honesty.sharedNoRewrite",
    };
  }
  return { kind: "none", messageKey: null };
}

/**
 * Prefer progressive buffer when live events arrived; else final host blob.
 * Returns redacted+truncated text for copy / display.
 */
export function resolveWorkflowRunCopyText(input: {
  sawProgress: boolean;
  liveLog?: string | null;
  finalLog?: string | null;
  max?: number;
}): string {
  const raw =
    input.sawProgress && hasLogText(input.liveLog)
      ? String(input.liveLog)
      : hasLogText(input.finalLog)
        ? String(input.finalLog)
        : hasLogText(input.liveLog)
          ? String(input.liveLog)
          : "";
  if (!raw.trim()) return "";
  return prepareWorkflowRunLogForDisplay(raw, input.max).text;
}

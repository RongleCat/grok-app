/**
 * SESSION-FORK-PRO — pure helpers for chat fork + optional restore-code
 * (git worktree bind) and CLI `--fork-session` (new agent session id)
 * semantics.
 *
 * Host `session_fork` clones the App journal; worktree + project bind run in UI.
 * When the user opts into CLI fork, Host sets `forkAgentSession` and on next
 * connect uses ACP `session/fork` (CLI `--fork-session` semantics) so the
 * child agent session gets a **new** id with the parent’s context, leaving
 * the source agent session unchanged.
 *
 * Pro layer: fork-agent checkbox honesty (never claim available/checked without
 * a linked agent id), classified dirty/worktree soft-fail (no raw Error dumps
 * as primary copy), success toast keys that match actual outcomes.
 *
 * No DOM / Tauri side effects. Callers own toasts and dialogs (no window.confirm).
 */

import { sanitizeWorktreeName } from "@/lib/gitWorktree";

/** Minimal git-status shape used for dirty / availability checks. */
export type ForkGitStatusSnapshot = {
  available?: boolean | null;
  files?: readonly unknown[] | null;
  reason?: string | null;
};

/**
 * CLI top-level flag: `grok --fork-session` (requires `--resume` / `--continue`
 * in the TUI). Host ACP path implements the same semantics via `session/fork`.
 */
export const FORK_SESSION_CLI_FLAG = "--fork-session";

/**
 * Top-level CLI args for fork-session: `["--fork-session"]` or `[]`.
 * Host spawn for `agent stdio` does **not** pass this alone (CLI requires
 * `--resume`/`--continue`); use for docs / parity tests. Runtime uses ACP.
 */
export function forkSessionSpawnArgs(enabled: boolean): string[] {
  return enabled ? [FORK_SESSION_CLI_FLAG] : [];
}

/**
 * Whether the UI should offer “fork CLI agent session” (new agent id).
 * Needs a non-empty source agent session id to fork from.
 */
export function canOfferForkAgentSession(
  agentSessionId: string | null | undefined,
): boolean {
  return (agentSessionId ?? "").trim().length > 0;
}

/** Fork-from-here on a completed idle assistant that belongs to a user turn. */
export function shouldOfferAssistantFork(input: {
  streaming?: boolean | null;
  turnLive?: boolean | null;
  canRewindSession?: boolean | null;
  parentPromptIndex: number;
}): boolean {
  return (
    !input.streaming &&
    !input.turnLive &&
    !!input.canRewindSession &&
    input.parentPromptIndex >= 0
  );
}

/** CLI `--fork-session` checkbox is only for full (uncut) forks. */
export function shouldShowForkCliCheckbox(
  throughUserPromptIndex: number | null | undefined,
): boolean {
  return throughUserPromptIndex == null;
}

/**
 * Effective CLI-fork flag for `session_fork`.
 * Partial forks auto-arm when a source agent id exists (no checkbox).
 */
export function resolveForkCliOnConfirm(input: {
  throughUserPromptIndex?: number | null;
  checkboxChecked?: boolean | null;
  agentSessionId?: string | null;
}): boolean {
  if (!canOfferForkAgentSession(input.agentSessionId)) return false;
  if (input.throughUserPromptIndex != null) return true;
  return !!input.checkboxChecked;
}

/**
 * Resolve whether connect should fork the agent session.
 * `wantFork` is the UI checkbox; `agentSessionId` is the source to fork.
 * Never returns `fork: true` without a non-empty source id (checkbox honesty).
 */
export function resolveForkAgentSession(input: {
  wantFork?: boolean | null;
  agentSessionId?: string | null;
}): { fork: boolean; sourceAgentId: string | null } {
  const source = (input.agentSessionId ?? "").trim();
  if (!source) return { fork: false, sourceAgentId: null };
  if (!input.wantFork) return { fork: false, sourceAgentId: source };
  return { fork: true, sourceAgentId: source };
}

// ── Fork-agent checkbox honesty ──────────────────────────────────────────────

/** Which dialog owns the fork-agent checkbox. */
export type ForkAgentCheckboxContext = "fork" | "resume";

/**
 * Honest presentation for the CLI `--fork-session` checkbox.
 * Never reports available/checked when there is no agent session to fork from.
 */
export type ForkAgentCheckboxState = {
  /** True when a non-empty source agent session id exists. */
  available: boolean;
  /** Recommended initial checked state for this context when available. */
  defaultChecked: boolean;
  /**
   * Effective checked value for controlled inputs.
   * Always false when unavailable (even if the user previously checked).
   */
  checked: boolean;
  /** Disable the checkbox when no agent session is linked. */
  disabled: boolean;
  /** i18n key explaining unavailability; null when available. */
  unavailableReasonKey: string | null;
  /** i18n key for the help line under the checkbox. */
  hintKey: string;
};

/**
 * Default checked state when opening a fork / resume dialog.
 * - fork: on when an agent session is linked (full context isolation)
 * - resume: off (reuse agent id unless the user opts in)
 * Always false when no agent session is linked.
 */
export function defaultForkAgentChecked(
  agentSessionId: string | null | undefined,
  context: ForkAgentCheckboxContext = "fork",
): boolean {
  if (!canOfferForkAgentSession(agentSessionId)) return false;
  return context === "fork";
}

/**
 * Honest fork-agent checkbox presentation for Fork / Resume modals.
 *
 * @param agentSessionId source agent session id (linked or live snapshot)
 * @param context which dialog (fork defaults on; resume defaults off)
 * @param wantChecked optional live checkbox value; forced off when unavailable
 */
export function resolveForkAgentCheckbox(
  agentSessionId: string | null | undefined,
  context: ForkAgentCheckboxContext = "fork",
  wantChecked?: boolean | null,
): ForkAgentCheckboxState {
  const available = canOfferForkAgentSession(agentSessionId);
  const defaultChecked = defaultForkAgentChecked(agentSessionId, context);
  const desired =
    wantChecked == null || wantChecked === undefined
      ? defaultChecked
      : !!wantChecked;
  const checked = available && desired;
  if (!available) {
    return {
      available: false,
      defaultChecked: false,
      checked: false,
      disabled: true,
      unavailableReasonKey: "session.forkCliSessionNoAgent",
      hintKey: "session.forkCliSessionNoAgentHint",
    };
  }
  return {
    available: true,
    defaultChecked,
    checked,
    disabled: false,
    unavailableReasonKey: null,
    hintKey:
      context === "resume"
        ? "session.resumeForkCliSessionHint"
        : "session.forkCliSessionHint",
  };
}

/**
 * True when porcelain lists any changed / untracked paths.
 * Unavailable status is not dirty (caller handles missing git separately).
 */
export function isGitWorkingTreeDirty(
  status: ForkGitStatusSnapshot | null | undefined,
): boolean {
  if (!status?.available) return false;
  return (status.files?.length ?? 0) > 0;
}

export type ForkRestoreCodeGate =
  | { ok: true }
  | { ok: false; reason: "no_project" | "unavailable" | "dirty" };

/**
 * Gate for optional restore-code on fork.
 * - no_project: source chat has no bound folder
 * - unavailable: not a git work tree / git missing
 * - dirty: uncommitted changes — never force checkout / destroy work
 */
export function canRestoreCodeOnFork(
  projectPath: string | null | undefined,
  status: ForkGitStatusSnapshot | null | undefined,
): ForkRestoreCodeGate {
  const path = (projectPath ?? "").trim();
  if (!path) return { ok: false, reason: "no_project" };
  if (!status?.available) return { ok: false, reason: "unavailable" };
  if (isGitWorkingTreeDirty(status)) return { ok: false, reason: "dirty" };
  return { ok: true };
}

/**
 * Sanitize a short fragment from a session id for worktree branch names.
 * Keeps letters, digits, `.` `_` `-` only; empty → `"chat"`.
 */
export function sanitizeForkNameFragment(
  raw: string | null | undefined,
  maxLen = 8,
): string {
  const cleaned = (raw ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, "")
    .replace(/^-+/, "");
  const slice = cleaned.slice(0, Math.max(1, maxLen));
  return slice || "chat";
}

/**
 * Unique-ish worktree / branch name for a fork restore:
 *   `fork-<sessionFrag>-<base36time>[-<attempt>]`
 *
 * Safe for `git worktree add -b` via {@link sanitizeWorktreeName}.
 */
export function buildForkWorktreeName(
  sourceSessionId: string | null | undefined,
  opts?: { attempt?: number; now?: number },
): string {
  const frag = sanitizeForkNameFragment(sourceSessionId, 8);
  const now = opts?.now ?? Date.now();
  const attempt = Math.max(0, opts?.attempt ?? 0);
  const time = Math.abs(now).toString(36);
  let candidate =
    attempt > 0 ? `fork-${frag}-${time}-${attempt}` : `fork-${frag}-${time}`;
  // hard cap before sanitize (64 max inside sanitizeWorktreeName)
  if (candidate.length > 64) {
    candidate = candidate.slice(0, 64).replace(/-+$/, "") || `fork-${time}`;
  }
  // Must not start with '-' after truncation edge cases
  if (candidate.startsWith("-")) {
    candidate = `fork${candidate}`;
  }
  return sanitizeWorktreeName(candidate);
}

// ── Dirty / worktree soft-fail ───────────────────────────────────────────────

/**
 * Stable soft-fail kinds for fork chat + resume-with-code restore paths.
 * Prefer these over raw `Error:` toasts.
 */
export type SessionForkSoftFailKind =
  | "need_tauri"
  | "busy"
  | "dirty"
  | "no_project"
  | "unavailable"
  | "worktree_collision"
  | "worktree_failed"
  | "bind_failed"
  | "fork_failed"
  | "cli_arm_failed"
  | "cancelled"
  | "other";

/** Which user action produced the soft-fail. */
export type SessionForkOp = "fork" | "resume_restore";

function errText(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const code =
      typeof (err as Error & { code?: unknown }).code === "string"
        ? String((err as Error & { code?: string }).code)
        : "";
    return `${code} ${err.message} ${err.name}`.trim();
  }
  if (typeof err === "object") {
    const o = err as {
      code?: unknown;
      message?: unknown;
      reason?: unknown;
      error?: unknown;
    };
    const parts = [o.code, o.message, o.reason, o.error]
      .filter((x) => x != null && String(x).trim())
      .map(String);
    if (parts.length) return parts.join(" ");
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

function errCode(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const o = err as { code?: unknown; reason?: unknown };
    if (typeof o.code === "string" && o.code.trim()) {
      return o.code.trim().toLowerCase().replace(/-/g, "_");
    }
    if (typeof o.reason === "string" && o.reason.trim()) {
      return o.reason.trim().toLowerCase().replace(/-/g, "_");
    }
  }
  return "";
}

/** Soft-fail kind from a failed restore-code gate (null when gate is ok). */
export function softFailKindFromRestoreGate(
  gate: ForkRestoreCodeGate,
): Exclude<SessionForkSoftFailKind, "need_tauri" | "busy" | "other"> | null {
  if (gate.ok) return null;
  return gate.reason;
}

/** i18n key for a restore-code gate failure (fork dialog). */
export function forkRestoreGateMessageKey(
  reason: "no_project" | "unavailable" | "dirty",
): string {
  switch (reason) {
    case "dirty":
      return "session.forkRestoreDirty";
    case "no_project":
      return "session.forkRestoreNoProject";
    case "unavailable":
      return "session.forkRestoreUnavailable";
  }
}

/** i18n key for a restore-code gate failure (resume-with-code dialog). */
export function resumeRestoreGateMessageKey(
  reason: "no_project" | "unavailable" | "dirty",
): string {
  switch (reason) {
    case "dirty":
      return "session.resumeRestoreDirty";
    case "no_project":
      return "session.resumeRestoreNoProject";
    case "unavailable":
      return "session.resumeRestoreUnavailable";
  }
}

/**
 * True when a worktree add failure looks like a path/branch name collision
 * (safe to retry with a new name).
 */
export function isWorktreeNameCollisionError(err: unknown): boolean {
  const s = errText(err).toLowerCase();
  if (!s.trim()) return false;
  return (
    s.includes("already exists") ||
    s.includes("already registered") ||
    s.includes("already checked out") ||
    s.includes("is already used by worktree") ||
    s.includes("duplicate") ||
    /\bcollision\b/.test(s)
  );
}

/**
 * Classify a thrown value / host error into a stable soft-fail kind.
 * Prefer explicit `code` over free-form text. Never invents success.
 */
export function classifySessionForkError(
  err: unknown,
  opts?: { op?: SessionForkOp; preferredKind?: SessionForkSoftFailKind | null },
): SessionForkSoftFailKind {
  if (opts?.preferredKind) return opts.preferredKind;
  if (err == null || err === "") return "other";

  const code = errCode(err);
  if (
    code === "need_tauri" ||
    code === "not_tauri" ||
    code === "host_only" ||
    code === "desktop_only"
  ) {
    return "need_tauri";
  }
  if (code === "busy" || code === "session_busy" || code === "in_flight") {
    return "busy";
  }
  if (code === "dirty" || code === "working_tree_dirty" || code === "wt_dirty") {
    return "dirty";
  }
  if (
    code === "no_project" ||
    code === "no_project_path" ||
    code === "missing_project"
  ) {
    return "no_project";
  }
  if (
    code === "unavailable" ||
    code === "not_git" ||
    code === "git_unavailable" ||
    code === "not_a_repository"
  ) {
    return "unavailable";
  }
  if (
    code === "worktree_collision" ||
    code === "wt_collision" ||
    code === "name_collision"
  ) {
    return "worktree_collision";
  }
  if (
    code === "worktree_failed" ||
    code === "worktree_create_failed" ||
    code === "wt_failed"
  ) {
    return "worktree_failed";
  }
  if (
    code === "bind_failed" ||
    code === "project_bind_failed" ||
    code === "session_set_project_failed"
  ) {
    return "bind_failed";
  }
  if (
    code === "fork_failed" ||
    code === "session_fork_failed" ||
    code === "fork_error"
  ) {
    return "fork_failed";
  }
  if (
    code === "cli_arm_failed" ||
    code === "fork_agent_failed" ||
    code === "fork_cli_failed"
  ) {
    return "cli_arm_failed";
  }
  if (code === "cancelled" || code === "cancel" || code === "user_cancelled") {
    return "cancelled";
  }

  const s = errText(err).toLowerCase();
  if (!s.trim()) return "other";

  if (
    /\bcancel(led)?\b/.test(s) ||
    s.includes("user cancelled") ||
    s.includes("user canceled") ||
    s.includes("dismissed")
  ) {
    return "cancelled";
  }

  if (
    s.includes("need tauri") ||
    s.includes("desktop only") ||
    s.includes("host only") ||
    s.includes("not available in browser")
  ) {
    return "need_tauri";
  }

  if (
    s.includes("session busy") ||
    s.includes("turn in progress") ||
    s.includes("still running") ||
    s.includes("cannot rewind")
  ) {
    return "busy";
  }

  if (
    s.includes("uncommitted") ||
    s.includes("working tree dirty") ||
    s.includes("dirty worktree") ||
    s.includes("dirty working tree") ||
    (s.includes("dirty") && (s.includes("tree") || s.includes("work")))
  ) {
    return "dirty";
  }

  if (
    s.includes("no project") ||
    s.includes("no folder") ||
    s.includes("bound project") ||
    s.includes("project folder")
  ) {
    return "no_project";
  }

  if (
    s.includes("not a git") ||
    s.includes("not a repository") ||
    s.includes("git missing") ||
    s.includes("git not found") ||
    (s.includes("not available") && s.includes("git"))
  ) {
    return "unavailable";
  }

  if (isWorktreeNameCollisionError(err)) {
    return "worktree_collision";
  }

  if (
    s.includes("worktree") &&
    (s.includes("failed") ||
      s.includes("error") ||
      s.includes("could not") ||
      s.includes("unable") ||
      s.includes("create"))
  ) {
    return "worktree_failed";
  }

  if (
    s.includes("bind") &&
    (s.includes("failed") || s.includes("could not") || s.includes("unable"))
  ) {
    return "bind_failed";
  }

  if (
    s.includes("fork agent") ||
    s.includes("fork-session") ||
    s.includes("fork_agent") ||
    (s.includes("arm") && s.includes("fork"))
  ) {
    return "cli_arm_failed";
  }

  if (
    s.includes("fork") &&
    (s.includes("failed") || s.includes("could not") || s.includes("error"))
  ) {
    return "fork_failed";
  }

  // Resume-specific fallbacks still map to worktree / bind when obvious.
  if (opts?.op === "resume_restore" && s.includes("resume")) {
    if (s.includes("create") || s.includes("worktree")) return "worktree_failed";
    if (s.includes("bind")) return "bind_failed";
  }

  return "other";
}

/**
 * i18n message key for a classified soft-fail.
 * Fork vs resume pick op-specific dirty/no_project/unavailable copy when set.
 */
export function sessionForkSoftFailMessageKey(
  kind: SessionForkSoftFailKind,
  op: SessionForkOp = "fork",
): string {
  const resume = op === "resume_restore";
  switch (kind) {
    case "need_tauri":
      return "error.needTauri";
    case "busy":
      return resume
        ? "session.resumeRestoreBusy"
        : "session.forkFailed";
    case "dirty":
      return resume
        ? "session.resumeRestoreDirty"
        : "session.forkRestoreDirty";
    case "no_project":
      return resume
        ? "session.resumeRestoreNoProject"
        : "session.forkRestoreNoProject";
    case "unavailable":
      return resume
        ? "session.resumeRestoreUnavailable"
        : "session.forkRestoreUnavailable";
    case "worktree_collision":
      return "session.forkWorktreeCollision";
    case "worktree_failed":
      return resume
        ? "session.resumeRestoreCreateFailed"
        : "session.forkRestoreFailed";
    case "bind_failed":
      return resume
        ? "session.resumeRestoreBindFailed"
        : "session.forkRestoreBindFailed";
    case "fork_failed":
      return "session.forkFailed";
    case "cli_arm_failed":
      return "session.forkCliFailed";
    case "cancelled":
      return "session.forkCancelled";
    case "other":
    default:
      return resume
        ? "session.resumeRestoreFailed"
        : "session.forkFailed";
  }
}

/** Cancelled / dismissed paths should not toast as a failure. */
export function sessionForkSoftFailSilent(
  kind: SessionForkSoftFailKind,
): boolean {
  return kind === "cancelled";
}

/**
 * Whether the fork / resume confirm dialog should stay open after this soft-fail
 * so the user can uncheck restore-code or adjust options.
 */
export function keepForkDialogOpenOnSoftFail(
  kind: SessionForkSoftFailKind,
): boolean {
  return (
    kind === "dirty" ||
    kind === "no_project" ||
    kind === "unavailable" ||
    kind === "worktree_collision" ||
    kind === "worktree_failed"
  );
}

/**
 * Resolve user-facing soft-fail copy from a thrown value or preferred kind.
 * Returns message key + whether to stay silent + optional short detail.
 */
export function resolveSessionForkSoftFail(
  err: unknown,
  opts?: {
    op?: SessionForkOp;
    preferredKind?: SessionForkSoftFailKind | null;
  },
): {
  kind: SessionForkSoftFailKind;
  messageKey: string;
  silent: boolean;
  /** Short technical detail for debug suffix (empty when not useful). */
  detail: string;
  /** Keep confirm dialog open so the user can adjust options. */
  keepDialogOpen: boolean;
} {
  const op = opts?.op ?? "fork";
  const kind = classifySessionForkError(err, {
    op,
    preferredKind: opts?.preferredKind,
  });
  const messageKey = sessionForkSoftFailMessageKey(kind, op);
  const silent = sessionForkSoftFailSilent(kind);
  const raw = errText(err).trim();
  let detail = "";
  // Append short detail for opaque / host errors; skip for well-known gates.
  const skipDetail =
    kind === "dirty" ||
    kind === "no_project" ||
    kind === "unavailable" ||
    kind === "need_tauri" ||
    kind === "busy" ||
    kind === "cancelled";
  if (
    !skipDetail &&
    raw &&
    !/^error:\s*$/i.test(raw) &&
    raw.length < 200
  ) {
    detail = raw.replace(/^Error:\s*/i, "").trim();
  }
  return {
    kind,
    messageKey,
    silent,
    detail,
    keepDialogOpen: keepForkDialogOpenOnSoftFail(kind),
  };
}

/**
 * Success toast key that matches actual fork outcomes.
 * Never claims “new agent session” or “clean worktree” without those flags.
 */
export function forkSuccessToastKey(input: {
  restoredWorktree?: boolean | null;
  forkedAgent?: boolean | null;
}): string {
  const restored = !!input.restoredWorktree;
  const forked = !!input.forkedAgent;
  if (restored && forked) return "session.forkOkRestoreCli";
  if (restored) return "session.forkOkRestore";
  if (forked) return "session.forkOkCli";
  return "session.forkOk";
}

/**
 * Follow-up toast after Host finishes child rewind / bootstrap.
 * Rewound is silent (immediate fork toast already opened the chat).
 */
export function forkTrimmedToastKey(
  outcome: string | null | undefined,
): "session.forkOkBootstrap" | null {
  return outcome === "bootstrap" ? "session.forkOkBootstrap" : null;
}

export type ForkTrimmedFollowUp = {
  /** Child App session to reload from disk; null skips the reload. */
  sessionId: string | null;
  toastKey: "session.forkOkBootstrap" | null;
};

/**
 * `session://fork_trimmed` follow-up.
 *
 * Partial forks already cut the child journal on disk. The UI must reload
 * that cut copy — a toast-only handler leaves the parent's later turns
 * painted from the in-memory cache.
 */
export function planForkTrimmedFollowUp(
  payload:
    | {
        sessionId?: string | null;
        outcome?: string | null;
      }
    | null
    | undefined,
): ForkTrimmedFollowUp {
  const raw = payload?.sessionId;
  const sessionId =
    typeof raw === "string" && raw.trim() ? raw.trim() : null;
  return {
    sessionId,
    toastKey: forkTrimmedToastKey(payload?.outcome),
  };
}

/**
 * Success toast key for resume-with-code restore.
 * Never claims “new agent session” without the fork flag.
 */
export function resumeRestoreSuccessToastKey(input: {
  forkedAgent?: boolean | null;
}): string {
  return input.forkedAgent
    ? "session.resumeRestoreOkCli"
    : "session.resumeRestoreOk";
}

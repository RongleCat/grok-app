/** API domain: session */

import {
  invoke,
  isTauri,
  isMirrorClient,
} from "./host";
import type { PermissionPayload, SessionSnapshot } from "../session";
import { IDLE_SNAPSHOT } from "../session";
import {
  SESSION_CONNECT_CLIENT_TIMEOUT_MS,
  sessionConnectTimeoutError,
  withDeadline,
} from "../sessionConnectTimeout";

export async function sessionGetState(): Promise<SessionSnapshot> {
  if (isMirrorClient()) return invoke("session_get_state");
  if (!isTauri()) return { ...IDLE_SNAPSHOT, backend: "browser" };
  return invoke("session_get_state");
}

export async function sessionConnect(opts?: {
  projectPath?: string;
  sessionId?: string;
  mode?: string;
}): Promise<SessionSnapshot> {
  if (isMirrorClient()) {
    return withDeadline(
      invoke("session_connect", {
        projectPath: opts?.projectPath ?? null,
        sessionId: opts?.sessionId ?? null,
        mode: opts?.mode ?? null,
      }),
      SESSION_CONNECT_CLIENT_TIMEOUT_MS,
      () => sessionConnectTimeoutError(),
    );
  }
  if (!isTauri()) {
    return {
      ...IDLE_SNAPSHOT,
      sessionId: "browser",
      state: "ready",
      backend: "browser",
      title: "Browser preview",
    };
  }
  return withDeadline(
    invoke("session_connect", {
      projectPath: opts?.projectPath ?? null,
      sessionId: opts?.sessionId ?? null,
      mode: opts?.mode ?? null,
    }),
    SESSION_CONNECT_CLIENT_TIMEOUT_MS,
    () => sessionConnectTimeoutError(),
  );
}

/**
 * Fire-and-forget: prewarm a CLI process while the user composes a new chat
 * (spawn + initialize + auth, no session). The first send then reuses the warm
 * process — no cold spawn / auth wait. Never awaited by the UI.
 */
export function sessionPrewarm(): void {
  if (!isTauri() || isMirrorClient()) return;
  void invoke("session_prewarm", {}).catch(() => {
    /* best-effort — connect still works via cold spawn */
  });
}

/**
 * Send a turn to the agent.
 * @param text Agent prompt (skills as `/name`, attachments as `@path`, etc.)
 * @param displayText Optional user-bubble text for journal (e.g. `[[skill:name]]` chips).
 *                    When omitted, journal stores `text`.
 * @param sessionId Chat this turn belongs to. Always pass it in multi-session
 *   flows: Host re-focuses that chat (background/parked → live) before
 *   prompting, so a concurrent connect cannot deliver the turn to another chat.
 *   Fails with `CONNECT_FAILED` when the chat has no warm agent process.
 * @param attachments Optional local file/image cards persisted on the user journal
 *   row so history reloads AttachmentCard UI (agent text still includes `@path`).
 */
export async function sessionSend(
  text: string,
  displayText?: string | null,
  sessionId?: string | null,
  attachments?: { path: string; name: string; isDir?: boolean }[] | null,
): Promise<SessionSnapshot> {
  return invoke("session_send", {
    text,
    displayText: displayText ?? null,
    sessionId: sessionId ?? null,
    attachments: attachments?.length ? attachments : null,
  });
}

/**
 * Inject guidance into the active turn without cancelling the running prompt.
 * Grok Build soft-steer (`x.ai/interject`, with Host fallback to `_x.ai/interject`).
 * Pass `sessionId` so multi-session routing stays correct.
 */
export async function sessionInterject(
  text: string,
  displayText?: string | null,
  attachments?: { path: string; name: string; isDir?: boolean }[] | null,
  sessionId?: string | null,
): Promise<SessionSnapshot> {
  return invoke("session_interject", {
    text,
    displayText: displayText ?? null,
    attachments: attachments?.length ? attachments : null,
    sessionId: sessionId ?? null,
  });
}

/**
 * Drop last user turn (agent rewind + local journal) before edit-resend.
 * Pass `sessionId` so a concurrent connect cannot truncate another chat.
 */
export async function sessionRewindDropLastUser(
  sessionId?: string | null,
): Promise<SessionSnapshot> {
  return invoke("session_rewind_drop_last_user", {
    sessionId: sessionId ?? null,
  });
}

/** One user-prompt checkpoint on the rewind timeline. */
export interface RewindPoint {
  promptIndex: number;
  messageId?: string | null;
  preview: string;
}

/** Result of rewinding to a prompt index (local journal always applies). */
export interface RewindExecuteResult {
  snapshot: SessionSnapshot;
  /** False when agent rewind failed / unsupported / disconnected. */
  agentOk: boolean;
  agentError?: string | null;
  localOk: boolean;
  keptCount: number;
}

/** List rewind points for a session journal (live session when `sessionId` omitted). */
export async function sessionRewindPoints(
  sessionId?: string | null,
): Promise<RewindPoint[]> {
  return invoke("session_rewind_points", {
    sessionId: sessionId ?? null,
  });
}

/**
 * Rewind to a 0-based user-prompt index (keep that turn, drop after).
 * Local journal is always truncated; agent extension is best-effort when live.
 */
export async function sessionRewindExecute(
  targetPromptIndex: number,
  opts?: { restoreFiles?: boolean; sessionId?: string | null },
): Promise<RewindExecuteResult> {
  return invoke("session_rewind_execute", {
    targetPromptIndex,
    restoreFiles: opts?.restoreFiles ?? false,
    sessionId: opts?.sessionId ?? null,
  });
}

/** Fork a session into a new chat (same project; optional cut through user turn). */
export async function sessionFork(
  sourceId: string,
  opts?: {
    throughUserPromptIndex?: number | null;
    title?: string | null;
    /** CLI `--fork-session`: new agent id with parent context on next connect. */
    forkAgentSession?: boolean | null;
  },
) {
  return invoke<{
    id: string;
    projectId: string | null;
    title: string;
    updatedAt: string;
    modelId: string | null;
    archived?: boolean;
    scheduled?: boolean;
    agentSessionId?: string | null;
    forkAgentSession?: boolean;
  }>("session_fork", {
    sourceId,
    throughUserPromptIndex: opts?.throughUserPromptIndex ?? null,
    title: opts?.title ?? null,
    forkAgentSession: opts?.forkAgentSession ?? false,
  });
}

/**
 * Arm or clear the one-shot CLI `--fork-session` flag on a session.
 * Soft-respawns the live agent when arming so the next connect can fork.
 */
export async function sessionSetForkAgentSession(
  id: string,
  forkAgentSession: boolean,
) {
  return invoke<{
    id: string;
    agentSessionId?: string | null;
    forkAgentSession?: boolean;
  }>("session_set_fork_agent_session", {
    id,
    forkAgentSession,
  });
}

/** Stop a turn. Pass `sessionId` to stop a demoted (background) chat. */
export async function sessionStop(
  sessionId?: string | null,
): Promise<SessionSnapshot> {
  return invoke("session_stop", { sessionId: sessionId ?? null });
}

export async function sessionDisconnect(): Promise<SessionSnapshot> {
  return invoke("session_disconnect");
}

export async function sessionReattach(): Promise<SessionSnapshot> {
  return invoke("session_reattach");
}

/**
 * Answer a tool permission prompt.
 * @param sessionId Chat that raised it (`session://permission.sessionId`).
 *   Required for background turns — their rpc id belongs to their own ACP
 *   child, so answering against the live slot leaves them waiting forever.
 */
export async function sessionResolvePermission(args: {
  rpcId: number;
  decision: string;
  optionId?: string;
  scopeKey?: string;
  sessionId?: string | null;
  /** Same options list as the permission bar — helps Host coerce wire ids (#542). */
  options?: unknown;
  /** Tool name from the permission payload (shell → allow-always-command, #542). */
  toolName?: string | null;
}): Promise<SessionSnapshot> {
  return invoke("session_resolve_permission", {
    rpcId: args.rpcId,
    decision: args.decision,
    optionId: args.optionId ?? null,
    scopeKey: args.scopeKey ?? null,
    sessionId: args.sessionId ?? null,
    options: args.options ?? null,
    toolName: args.toolName ?? null,
  });
}

/**
 * Still-pending permission card for a chat, if any. Recovers an approval bar
 * whose one-shot `session://permission` event was missed (WebView reload /
 * window remount) — otherwise the turn looks stuck "thinking" forever.
 */
export async function sessionPendingPermission(
  sessionId: string,
): Promise<PermissionPayload | null> {
  return invoke("session_pending_permission", { sessionId });
}

/** Approve / revise / abandon pending `_x.ai/exit_plan_mode`. */
export async function sessionResolvePlan(args: {
  decision: "approved" | "cancelled" | "abandoned" | string;
  feedback?: string | null;
  rpcId?: number | null;
  sessionId?: string | null;
}): Promise<SessionSnapshot> {
  return invoke("session_resolve_plan", {
    decision: args.decision,
    feedback: args.feedback ?? null,
    rpcId: args.rpcId ?? null,
    sessionId: args.sessionId ?? null,
  });
}

/** Host-persisted plan chrome for an app session (survives restart). */
export async function sessionPlanChromeGet(
  sessionId: string,
): Promise<import("@/lib/planSession").PlanChromeStored | null> {
  if (!sessionId?.trim()) return null;
  if (!isTauri() && !isMirrorClient()) return null;
  return invoke("session_plan_chrome_get", { sessionId });
}

/** Save plan chrome from the UI (dismiss / soft hide). */
export async function sessionPlanChromeSet(
  sessionId: string,
  chrome: import("@/lib/planSession").PlanChromeStored,
): Promise<void> {
  if (!sessionId?.trim()) return;
  if (!isTauri() && !isMirrorClient()) return;
  await invoke("session_plan_chrome_set", { sessionId, chrome });
}

/** Agent plan_mode.json + plan.md snapshot for resume UI. */
export async function sessionAgentPlanSnapshot(
  sessionId: string,
): Promise<import("@/lib/planSession").AgentPlanSnapshot> {
  if (!sessionId?.trim()) {
    return { found: false };
  }
  if (!isTauri() && !isMirrorClient()) {
    return { found: false };
  }
  return invoke("session_agent_plan_snapshot", { sessionId });
}

/** Answer or dismiss pending `_x.ai/ask_user_question`. */
export async function sessionResolveAskUser(args: {
  decision: "accepted" | "cancelled" | string;
  answers?: Record<string, string> | null;
  rpcId?: number | null;
  sessionId?: string | null;
}): Promise<SessionSnapshot> {
  return invoke("session_resolve_ask_user", {
    decision: args.decision,
    answers: args.answers ?? null,
    rpcId: args.rpcId ?? null,
    sessionId: args.sessionId ?? null,
  });
}
export async function sessionsList() {
  return invoke<
    Array<{
      id: string;
      projectId: string | null;
      title: string;
      updatedAt: string;
      modelId: string | null;
      /** Per-session reasoning effort when stored on meta. */
      effort?: string | null;
      archived?: boolean;
      /** Pinned chats float to the top of the sidebar */
      pinned?: boolean;
      /** Shell automation run */
      scheduled?: boolean;
      /** Linked worktree path when this chat is worktree-bound */
      worktreePath?: string | null;
      worktreeBranch?: string | null;
      isWorktreeSession?: boolean;
      /** Optional JSON Schema for structured model output */
      jsonSchema?: string | null;
      /** Session-only plugin dirs (`--plugin-dir`); empty/omit = none */
      pluginDirs?: string[];
      /** Per-session extra rules (`--rules`); empty/omit = none */
      extraRules?: string | null;
      /** Per-session max agent turns (`--max-turns`); null/omit = inherit global */
      maxAgentTurns?: number | null;
      /** Per-session system prompt override (`--system-prompt-override`); empty/omit = none */
      systemPromptOverride?: string | null;
      /** Per-session `--no-ask-user` override; null/omit = inherit global */
      noAskUser?: boolean | null;
    }>
  >("sessions_list");
}

/** Set or clear per-session extra rules (`grok --rules`). Empty clears. */
export async function sessionSetExtraRules(
  id: string,
  extraRules: string | null,
) {
  return invoke<{
    id: string;
    title: string;
    extraRules?: string | null;
  }>("session_set_extra_rules", {
    id,
    extraRules: extraRules && extraRules.trim() ? extraRules : null,
  });
}

/**
 * Set or clear per-session max agent turns (`grok --max-turns`).
 * Pass `null` / `0` to inherit global Settings. Soft-respawns live agent.
 */
export async function sessionSetMaxAgentTurns(
  id: string,
  maxAgentTurns: number | null,
) {
  const n =
    typeof maxAgentTurns === "number" && maxAgentTurns > 0
      ? Math.min(200, Math.max(1, Math.round(maxAgentTurns)))
      : null;
  return invoke<{
    id: string;
    title: string;
    maxAgentTurns?: number | null;
  }>("session_set_max_agent_turns", {
    id,
    maxAgentTurns: n,
  });
}

/**
 * Set or clear per-session system prompt override (`grok --system-prompt-override`).
 * Empty clears. Soft-respawns live agent. Do not log the prompt body.
 */
export async function sessionSetSystemPromptOverride(
  id: string,
  systemPromptOverride: string | null,
) {
  return invoke<{
    id: string;
    title: string;
    systemPromptOverride?: string | null;
  }>("session_set_system_prompt_override", {
    id,
    systemPromptOverride:
      systemPromptOverride && systemPromptOverride.trim()
        ? systemPromptOverride
        : null,
  });
}

/**
 * Set or clear per-session `--no-ask-user` override (CLI ≥ 0.2.117).
 * Pass `null` to inherit global Settings. Soft-respawns live agent.
 */
export async function sessionSetNoAskUser(
  id: string,
  noAskUser: boolean | null,
) {
  return invoke<{
    id: string;
    title: string;
    noAskUser?: boolean | null;
  }>("session_set_no_ask_user", {
    id,
    noAskUser: typeof noAskUser === "boolean" ? noAskUser : null,
  });
}

/** Set or clear per-session JSON Schema structured output. */
export async function sessionSetJsonSchema(
  id: string,
  jsonSchema: string | null,
) {
  return invoke<{
    id: string;
    title: string;
    jsonSchema?: string | null;
  }>("session_set_json_schema", {
    id,
    jsonSchema: jsonSchema && jsonSchema.trim() ? jsonSchema : null,
  });
}

/** Journal content hit from `sessions_search`. */
export type SessionContentSearchHit = {
  id: string;
  title: string;
  projectId?: string | null;
  snippet: string;
  matchCount: number;
  updatedAt: string;
  archived?: boolean;
};

/**
 * Scan App session journals for case-insensitive content matches.
 * Empty query returns []. Caps scan work on the host.
 */
export async function sessionsSearch(query: string, limit = 20) {
  if (!query.trim()) return [] as SessionContentSearchHit[];
  if (!isTauri()) return [] as SessionContentSearchHit[];
  return invoke<SessionContentSearchHit[]>("sessions_search", {
    query,
    limit,
  });
}

/** CLI sessions under GROK_HOME (session_data_mode discovery). */
export type CliSessionSummary = {
  agentSessionId: string;
  title: string;
  cwd: string | null;
  updatedAt: string;
  dir: string;
  numMessages: number;
  alreadyLinked: boolean;
  /** App session id when already linked (one-click open). */
  appSessionId?: string | null;
  /** GROK_HOME used for discovery (path clarity). */
  sourceHome?: string;
  /** First user prompt when known (search / enriched). */
  firstPrompt?: string | null;
};

/** Hit from `grok sessions search` (or local first-prompt fallback). */
export type CliSessionSearchHit = CliSessionSummary & {
  /** CLI status token: local | remote. */
  status?: string | null;
  /** `"cli"` from `grok sessions search`, `"local"` for disk fallback. */
  source: "cli" | "local" | string;
};

export async function cliSessionsList() {
  return invoke<CliSessionSummary[]>("cli_sessions_list");
}

/**
 * Search CLI sessions (summaries + first prompts) via host
 * `grok sessions search`. Falls back to local disk filter when CLI fails.
 */
export async function cliSessionsSearch(query: string, limit?: number) {
  return invoke<CliSessionSearchHit[]>("cli_sessions_search", {
    query,
    limit: limit ?? 40,
  });
}

export async function cliSessionImport(
  agentSessionId: string,
  opts?: { dir?: string | null; projectId?: string | null },
) {
  return invoke<{
    id: string;
    title: string;
    projectId: string | null;
    updatedAt: string;
  }>("cli_session_import", {
    agentSessionId,
    dir: opts?.dir ?? null,
    projectId: opts?.projectId ?? null,
  });
}

/**
 * Find the most recent CLI agent session for a project path
 * (CLI `grok -c/--continue`). Soft-fails → null when none exist.
 */
export async function cliSessionFindLatestForCwd(projectPath: string) {
  if (!isTauri()) return null;
  const path = projectPath.trim();
  if (!path) return null;
  return invoke<CliSessionSummary | null>("cli_session_find_latest_for_cwd", {
    projectPath: path,
  });
}

/**
 * CLI `-c/--continue`: find latest agent session for project path and
 * open/import it as an App session. Soft-fails → null when none exist.
 */
export async function cliSessionContinueCwd(
  projectPath: string,
  opts?: { projectId?: string | null },
) {
  if (!isTauri()) return null;
  const path = projectPath.trim();
  if (!path) return null;
  return invoke<{
    id: string;
    title: string;
    projectId: string | null;
    updatedAt: string;
    agentSessionId?: string | null;
  } | null>("cli_session_continue_cwd", {
    projectPath: path,
    projectId: opts?.projectId ?? null,
  });
}

export async function cliSessionsImportAll(limit?: number) {
  return invoke<
    Array<{
      id: string;
      title: string;
      projectId: string | null;
      updatedAt: string;
    }>
  >("cli_sessions_import_all", { limit: limit ?? 50 });
}

/**
 * Delete one on-disk CLI session under active GROK_HOME.
 * Prefer passing `dir` from list. Does not delete App chats.
 */
export async function cliSessionDelete(
  agentSessionId: string,
  opts?: { dir?: string | null },
) {
  return invoke<void>("cli_sessions_delete", {
    agentSessionId,
    dir: opts?.dir ?? null,
  });
}

export async function sessionCreate(
  projectId?: string,
  title?: string,
  opts?: { scheduled?: boolean },
) {
  return invoke("session_create", {
    projectId: projectId ?? null,
    title: title ?? null,
    scheduled: opts?.scheduled ?? false,
  });
}

export async function sessionSetScheduled(id: string, scheduled: boolean) {
  return invoke<{
    id: string;
    title: string;
    scheduled?: boolean;
  }>("session_set_scheduled", { id, scheduled });
}

export async function sessionRename(id: string, title: string) {
  return invoke("session_rename", { id, title });
}

export async function sessionSetArchived(id: string, archived: boolean) {
  return invoke("session_set_archived", { id, archived });
}

export async function sessionSetPinned(id: string, pinned: boolean) {
  return invoke("session_set_pinned", { id, pinned });
}

/**
 * Attach or clear worktree linkage on a session (path/branch + WT badge flag).
 * Pass empty/null path to clear.
 */
export async function sessionSetWorktree(
  id: string,
  opts?: {
    worktreePath?: string | null;
    worktreeBranch?: string | null;
  },
) {
  return invoke<{
    id: string;
    title: string;
    worktreePath?: string | null;
    worktreeBranch?: string | null;
    isWorktreeSession?: boolean;
  }>("session_set_worktree", {
    id,
    worktreePath: opts?.worktreePath ?? null,
    worktreeBranch: opts?.worktreeBranch ?? null,
  });
}

/** Bind session to a project, or clear (`projectId: null`) for orphan / 其他会话. */
export async function sessionSetProject(
  id: string,
  projectId: string | null,
) {
  return invoke<{
    id: string;
    projectId: string | null;
    title: string;
  }>("session_set_project", { id, projectId });
}

/**
 * User-facing move: new cwd, drop previous agent/worktree identity.
 * Host refuses mid-turn, untrusted, or missing folders.
 */
export async function sessionMoveToProject(
  id: string,
  projectId: string | null,
) {
  return invoke<{
    id: string;
    projectId: string | null;
    title: string;
    agentSessionId?: string | null;
    worktreePath?: string | null;
    worktreeBranch?: string | null;
    isWorktreeSession?: boolean;
  }>("session_move_to_project", { id, projectId });
}

/**
 * Set session-only plugin directories for spawn (`--plugin-dir`).
 * Pass `[]` to clear. Does not change global Extensions plugins.
 * Soft-respawns when this chat is the live agent.
 */
export async function sessionSetPluginDirs(id: string, pluginDirs: string[]) {
  return invoke<{
    id: string;
    title: string;
    pluginDirs?: string[];
  }>("session_set_plugin_dirs", { id, pluginDirs });
}


export async function sessionDelete(id: string) {
  return invoke("session_delete", { id });
}

/**
 * Load App journal messages.
 * @param opts.reconcile When true (default), Host merges missing rows from the
 *   linked agent chat_history. Session **switch** should pass `false` and
 *   optionally re-request with reconcile after the user settles.
 */
export async function sessionMessages(
  id: string,
  opts?: { reconcile?: boolean },
) {
  return invoke<
    Array<{
      id: string;
      role: string;
      content: string;
      thought?: string | null;
      createdAt: string;
      isError?: boolean;
      marker?: string | null;
      attachments?: Array<{
        path: string;
        name: string;
        isDir?: boolean;
      }> | null;
    }>
  >("session_messages", {
    id,
    reconcile: opts?.reconcile ?? true,
  });
}

/** Agent session folder under GROK_HOME (contains images/, etc.). */
export async function sessionMediaRoot(id: string) {
  return invoke<string | null>("session_media_root", { id });
}

/** Loopback media HTTP base + token (token-gated Range streaming of local files). */
export async function mediaServerEndpoint() {
  return invoke<{ baseUrl: string; token: string }>("media_server_endpoint");
}

/**
 * Resolve short session-relative paths (`images/1.jpg`) to absolute files
 * that exist under the agent session directory.
 */
export async function sessionResolveRelativeMedia(
  id: string,
  relatives: string[],
) {
  if (!relatives.length) return [];
  return invoke<
    Array<{ path: string; name: string; isDir?: boolean }>
  >("session_resolve_relative_media", { id, relatives });
}


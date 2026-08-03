/** API domain: settings */

import {
  invoke,
  isTauri,
} from "./host";

export type ComposerPrefsScope = "global" | "project" | "session";

export interface AppSettings {
  theme: string;
  locale: string;
  sessionDataMode: string;
  manualCliPath: string | null;
  permissionPolicy: string;
  modelId: string | null;
  effort: string | null;
  mode: string;
  onboardingDone: boolean;
  setupSkipped: boolean;
  /** First-run wizard finished (CLI gate + optional auth). */
  setupWizardCompleted?: boolean;
  /** User skipped account/provider step during setup. */
  authSetupDeferred?: boolean;
  defaultOpenTarget?: string;
  /** global | project | session — where model/permission chips are remembered */
  composerPrefsScope?: ComposerPrefsScope | string;
  /** API mode: `host:port` of a remote ACP server. When set, sessions connect
   *  over TCP instead of spawning the local CLI. Empty/unset = local spawn. */
  acpServerAddr?: string | null;
  /** Max warm/live agent processes (default 3). */
  maxConcurrentAgents?: number;
  /** Recycle idle agent processes after N minutes (default 30). */
  agentIdleMinutes?: number;
  /** Pure stream silence before cancel prompt, seconds (default 120). */
  streamStallSeconds?: number;
  /**
   * When true, headless paths that use `--output-format streaming-messages-json`
   * also pass `--include-partial-messages` (CLI 0.2.117+) for incremental
   * `stream_event` deltas. Default false. Soft-fails on older CLIs.
   * Only valid with streaming-messages-json (Remote IM upgrades format when on).
   */
  includePartialMessages?: boolean;
  /**
   * When true, App API keys go in the OS keychain.
   * Default false: keys stay in secrets.json (0600). Official login uses auth.json.
   */
  storeApiKeysInKeychain?: boolean;
  /**
   * OS-level sandbox for spawned agents: off | workspace | read-only | strict | devbox.
   * Default "off". Passed as `grok --sandbox <profile>` / GROK_SANDBOX on spawn.
   */
  sandboxProfile?: string;

  maxAgentTurns?: number | null;
  /**
   * Headless background-wait after first turn: `wait` | `no_wait` | `timeout`.
   * CLI 0.2.117+ (`--no-wait-for-background` / `--background-wait-timeout`).
   * Default `wait` (omit flags). Soft-fails on older CLIs.
   */
  backgroundWaitPolicy?: string;
  /**
   * Seconds for `--background-wait-timeout` when policy is `timeout` (1–3600).
   * Default 600.
   */
  backgroundWaitTimeoutSec?: number;
  preferredAgent?: string;
  /**
   * Optional path for `grok agent --agent-profile <PATH>`.
   * Empty = omit flag (CLI default). Soft-respawns on change.
   */
  agentProfilePath?: string;
  /**
   * Optional inline subagent definitions JSON for top-level `grok --agents <JSON>`.
   * Empty = omit flag. Must be a JSON object map when set; invalid values reject save.
   * Soft-respawns on change. Does not write into shared ~/.grok.
   */
  agentsJson?: string;
  experimentalMemory?: boolean;
  /**
   * Enable CLI TodoGate (turn-end nudge when todos still pending / in_progress).
   * Default false. Spawns with top-level `--todo-gate` (CLI 0.2.117+). Soft-respawns.
   */
  todoGateEnabled?: boolean;
  /**
   * Max TodoGate fires per prompt (1–20, default 3). Config-only key
   * `todo_gate_max_fires_per_prompt` (no CLI flag). Independent agent-home
   * writes apply; shared mode stores the App setting only (never rewrites
   * `~/.grok`). Soft-respawns on change.
   */
  todoGateMaxFiresPerPrompt?: number;
  /**
   * Compaction mode for spawned agents (CLI 0.2.117+):
   * summary | transcript | segments. Maps to `--compaction-mode` /
   * GROK_COMPACTION_MODE. Default "summary". Soft-respawns on change.
   */
  compactionMode?: string;
  /**
   * Segments detail (CLI 0.2.117+): none | minimal | balanced | verbose.
   * Only affects segments mode (`--compaction-detail` / GROK_COMPACTION_DETAIL).
   * Default "verbose". Soft-respawns on change.
   */
  compactionDetail?: string;
  /**
   * Prefire two-pass compaction (CLI 0.2.117+).
   * Default false. Writes agent-home `two_pass_compaction_enabled` in
   * independent mode; spawn sets `GROK_TWO_PASS_COMPACTION`. Soft-respawns.
   */
  twoPassCompactionEnabled?: boolean;
  disableWebSearch?: boolean;
  /**
   * Inject MCP official-aux (isolated grok -p + official auth): web_search,
   * all x_* tools, vision_describe. Default true. Requires CLI login or
   * official API key; UI disables when unavailable. Soft-respawns.
   */
  /** Inject official-aux MCP on **custom** main route only (never official Grok). */
  officialAuxInject?: boolean;
  /** With inject on: also load user extension MCPs (default false — keeps official-aux fast). */
  officialAuxWithUserMcp?: boolean;
  /**
   * When true, spawn with top-level `--no-ask-user` (CLI ≥ 0.2.117) so the
   * agent does not emit ask-user questionnaires. Default false. Soft-respawns.
   * Per-session override: `SessionMeta.noAskUser`.
   */
  noAskUser?: boolean;
  /**
   * Built-in tool ids denied via CLI `--disallowed-tools a,b`.
   * Default empty. Coexists with `disableWebSearch`; changes soft-respawn.
   */
  disallowedTools?: string[];
  /**
   * Built-in tool ids allowlisted via CLI `--tools a,b`.
   * Default empty = omit flag (CLI default all tools). When non-empty,
   * restricts the agent to listed tools. Coexists with `disallowedTools`
   * (allowlist restricts; denylist still applies). Changes soft-respawn.
   */
  allowedTools?: string[];
  planEnabled?: boolean;
  subagentsEnabled?: boolean;
  /**
   * Enable CLI subagent worktree snapshot (CLI 0.2.117+).
   * Default false. Writes agent-home `subagent_worktree_snapshot_enabled` in
   * independent mode; spawn sets `GROK_SUBAGENT_WORKTREE_SNAPSHOT`. Soft-respawns.
   */
  subagentWorktreeSnapshotEnabled?: boolean;
  /**
   * Enable CLI auto-wake (config `auto_wake_enabled`). Default false (opt-in).
   * When on, Grok Build may inject a synthetic turn after background work
   * completes (CLI-side). Independent mode writes agent-home `auto_wake_enabled`
   * only — no invented env override. Soft-respawns on change.
   */
  autoWakeEnabled?: boolean;
  /**
   * Enable Grok Build workflows (`workflows_enabled` in agent-home config).
   * Default false. Independent mode writes the top-level key; soft-respawns.
   * No in-app runner — scripts run via CLI / Rhai `workflow` tool.
   */
  workflowsEnabled?: boolean;
  useLeader?: boolean;
  /** Reopen last active chat once after launch (default false → draft new chat). */
  reopenLastSession?: boolean;
  /** Last successfully opened session id (startup restore). */
  lastSessionId?: string | null;
  /** Project of lastSessionId when it belonged to one (hint only). */
  lastProjectId?: string | null;
  /** Sidebar project folder ids the user collapsed (missing ⇒ expanded). */
  sidebarCollapsedProjectIds?: string[];
  voiceId?: string;
  voiceDictationAutoSend?: boolean;
  voiceKeepAgentsOnEnd?: boolean;
  /** Window close hides to tray when true (default). */
  closeToTray?: boolean;
  /**
   * When true (default), closing the window still hides to tray if any
   * scheduled task is enabled — so host automation_runner keeps ticking.
   * Not a daemon; full quit still pauses schedules.
   */
  keepTrayForSchedules?: boolean;
  /**
   * macOS: optional LaunchAgent helper that starts the full app at login /
   * after crash. Default false. Not a headless scheduler.
   */
  schedulesLaunchAgent?: boolean;
  /** Start the app when the user logs into the OS (default false). */
  launchAtLogin?: boolean;
  /** Desktop notification when an agent turn finishes (default true). */
  notifyOnTurnDone?: boolean;
  /** Desktop notification when the agent requests permission (default true). */
  notifyOnPermission?: boolean;
  /**
   * Allow CLI install when the mirror has no published SHA-256 (default false).
   * Mismatch always fails. Prefer fixing the mirror over enabling this.
   */
  allowUnverifiedCliInstall?: boolean;
  /** Last App-managed CLI install checksum result (`true` = verified). */
  lastCliChecksumVerified?: boolean | null;
  /**
   * Tool audit ledger retention days: `7` | `30` | `90` | `0` (unlimited).
   * Applied on write/rotate and explicit prune. Default 0.
   */
  auditLedgerRetentionDays?: number;
}

export interface ReasoningEffort {
  id: string;
  value: string;
  label: string;
  description?: string;
  isDefault?: boolean;
}

export interface AvailableModel {
  id: string;
  label: string;
  source: string;
  isDefault?: boolean;
  /** Per-model efforts from CLI models_cache; omit/empty → static fallback. */
  reasoningEfforts?: ReasoningEffort[];
  /** Model context window in tokens (live-merged from `initialize` first). */
  contextWindow?: number | null;
}

export interface AvailableModelsResult {
  models: AvailableModel[];
  defaultModelId: string;
  origin?: string | null;
  fetchedAt?: string | null;
}

export interface ComposerPrefs {
  modelId: string;
  effort: string;
  mode: string;
  permissionPolicy: string;
  scope: string;
  source: string;
}

export async function settingsGet() {
  return invoke<AppSettings>("settings_get");
}

/** Path of a store JSON file quarantined after corrupt parse (one-shot). */
export async function storeTakeQuarantine() {
  return invoke<string | null>("store_take_quarantine");
}

export async function modelsListAvailable() {
  return invoke<AvailableModelsResult>("models_list_available");
}

export async function composerPrefsResolve(opts?: {
  projectId?: string | null;
  sessionId?: string | null;
}) {
  return invoke<ComposerPrefs>("composer_prefs_resolve", {
    projectId: opts?.projectId ?? null,
    sessionId: opts?.sessionId ?? null,
  });
}

export async function composerPrefsSet(body: {
  projectId?: string | null;
  sessionId?: string | null;
  modelId?: string | null;
  effort?: string | null;
  mode?: string | null;
  permissionPolicy?: string | null;
}) {
  return invoke<ComposerPrefs>("composer_prefs_set", {
    projectId: body.projectId ?? null,
    sessionId: body.sessionId ?? null,
    modelId: body.modelId ?? null,
    effort: body.effort ?? null,
    mode: body.mode ?? null,
    permissionPolicy: body.permissionPolicy ?? null,
  });
}

export async function settingsSet(settings: Record<string, unknown>) {
  return invoke("settings_set", { settings });
}

/** Update live Host permission policy + persist at configured prefs scope. */
export async function sessionSetPolicy(
  policy: string,
  opts?: { projectId?: string | null; sessionId?: string | null },
) {
  if (!isTauri()) return null;
  return invoke<ComposerPrefs>("session_set_policy", {
    policy,
    projectId: opts?.projectId ?? null,
    sessionId: opts?.sessionId ?? null,
  });
}

/** Switch live agent model + persist at configured prefs scope. */
export async function sessionSetModel(
  modelId: string,
  opts?: { projectId?: string | null; sessionId?: string | null },
) {
  if (!isTauri()) return null;
  return invoke<ComposerPrefs>("session_set_model", {
    modelId,
    projectId: opts?.projectId ?? null,
    sessionId: opts?.sessionId ?? null,
  });
}

export async function secretsGetMasked() {
  return invoke<{
    hasOfficialKey: boolean;
    hasRelayKey: boolean;
    relayBaseUrl: string | null;
    defaultModel: string | null;
  }>("secrets_get_masked");
}

export async function secretsSet(body: {
  officialApiKey?: string;
  relayBaseUrl?: string;
  relayApiKey?: string;
  defaultModel?: string;
}) {
  return invoke("secrets_set", {
    officialApiKey: body.officialApiKey ?? null,
    relayBaseUrl: body.relayBaseUrl ?? null,
    relayApiKey: body.relayApiKey ?? null,
    defaultModel: body.defaultModel ?? null,
  });
}

export async function providerPing() {
  return invoke<{ ok: boolean; class: string; message: string }>("provider_ping");
}

export async function importGrokCli() {
  return invoke("import_grok_cli_config");
}

export async function importGrokGo() {
  return invoke("import_grok_go_config");
}


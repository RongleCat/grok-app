/** API domain: extensions */

import {
  invoke,
  isTauri,
} from "./host";

// ── Doctor / skills / MCP ───────────────────────────────────────────────────

export type DoctorLevel = "ok" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  level: DoctorLevel;
  title: string;
  detail: string;
  meta?: Record<string, unknown>;
}

export interface DoctorSummary {
  ok: number;
  warn: number;
  fail: number;
}

/**
 * Host envelope for `grok doctor --json` (see `parseCliDoctorEnvelope`).
 * `report` is the raw CLI JSON blob when available.
 */
export interface CliDoctorPayload {
  available: boolean;
  error?: string | null;
  report?: Record<string, unknown> | null;
  exitOk?: boolean;
  stdoutPreview?: string;
}

export interface DoctorReport {
  generatedAt: string;
  summary: DoctorSummary;
  checks: DoctorCheck[];
  /** Flat snapshot for copy/export (no secrets). */
  raw: Record<string, unknown>;
  /** Grok Build CLI `doctor --json` envelope (optional for older hosts). */
  cliDoctor?: CliDoctorPayload | null;
}

export interface SkillDto {
  name: string;
  description: string;
  /** Normalized source type (e.g. user, project, plugin). */
  source: string;
  path?: string | null;
  userInvocable: boolean;
  /** App Extensions enable flag (default true when omitted). */
  enabled?: boolean;
}

export interface McpDto {
  name: string;
  transport?: string | null;
  target?: string | null;
  vendor?: string | null;
  compatibilityStatus?: string | null;
  /** App Extensions enable flag (default true when omitted). */
  enabled?: boolean;
}

export interface SkillsListResult {
  skills: SkillDto[];
  /** Absolute allowlisted skill roots for in-app SKILL.md editing. */
  skillRoots?: string[];
  error?: string;
}

/** Result of Host `skill_read` (allowlisted SKILL.md only). */
export interface SkillReadResult {
  path: string;
  name: string;
  content: string;
  size: number;
  mtimeMs: number;
  truncated: boolean;
}

/** Result of Host `skill_write`. */
export interface SkillWriteResult {
  path: string;
  size: number;
  mtimeMs: number;
}

/** Result of Host `skill_create` (scaffold folder + SKILL.md). */
export interface SkillCreateResult {
  path: string;
  name: string;
  root: string;
  created: boolean;
  alreadyExisted: boolean;
}

export interface InspectMcpResult {
  servers: McpDto[];
  error?: string;
}

/** App MCP/Skills enable prefs (`extensions.json`). Missing name = enabled. */
export interface ExtensionsPrefs {
  mcp: Record<string, boolean>;
  skills: Record<string, boolean>;
}

export async function extensionsGet() {
  return invoke<ExtensionsPrefs>("extensions_get");
}

/** Toggle one MCP server; Host persists + injects on next session + soft-respawns. */
export async function extensionsSetMcp(name: string, enabled: boolean) {
  return invoke<ExtensionsPrefs>("extensions_set_mcp", { name, enabled });
}

/** Toggle one skill (slash palette filter). */
export async function extensionsSetSkill(name: string, enabled: boolean) {
  return invoke<ExtensionsPrefs>("extensions_set_skill", { name, enabled });
}

/** Bulk-enable all listed MCP servers. */
export async function extensionsEnableAllMcp(names: string[]) {
  return invoke<ExtensionsPrefs>("extensions_enable_all_mcp", { names });
}

/** Bulk-enable all listed skills. */
export async function extensionsEnableAllSkills(names: string[]) {
  return invoke<ExtensionsPrefs>("extensions_enable_all_skills", { names });
}

export async function doctorReport() {
  return invoke<DoctorReport>("doctor_report");
}

/** Result of `grok doctor fix <id> --yes` (stdout/stderr already redacted). */
export interface CliDoctorFixResult {
  ok: boolean;
  id: string;
  stdout: string;
  stderr: string;
  exitOk?: boolean;
  error?: string;
}

/**
 * Apply a CLI automatic remediation (`doctor fix <id> --yes`).
 * Prefer confirm in UI for destructive fixes first.
 */
export async function cliDoctorFix(id: string) {
  return invoke<CliDoctorFixResult>("cli_doctor_fix", { id });
}

export interface SupportBundleResult {
  ok: boolean;
  path: string;
  /** Optional file size in bytes (cheap host `stat` after save). */
  sizeBytes?: number;
}

/**
 * Result of `session_trace_export`.
 * History may record `uploaded` when the CLI reported a remote upload —
 * never secrets or remote URLs.
 */
export interface SessionTraceExportResult extends SupportBundleResult {
  /** Host default is true (`grok trace --local`). */
  localOnly?: boolean;
  /** True only when export allowed network upload and CLI reported remote info. */
  uploaded?: boolean;
}

/**
 * Build a redacted support zip (Doctor + logs + optional stall timeline)
 * and save via native dialog.
 *
 * `stallTimelineJson` is optional Reliability-center snapshot JSON
 * (structured stall signals only; host redacts secrets).
 */
export async function exportSupportBundle(
  doctorJson?: string | null,
  stallTimelineJson?: string | null,
) {
  return invoke<SupportBundleResult>("export_support_bundle", {
    doctorJson: doctorJson ?? null,
    stallTimelineJson: stallTimelineJson ?? null,
  });
}

/** One host audit ledger row (camelCase). */
export type AuditLedgerHostEntry = {
  ts: string;
  sessionId?: string | null;
  projectPath?: string | null;
  toolName: string;
  event: string;
  permission?: string | null;
  outcome?: string | null;
  summary?: string | null;
};

/** Host process-budget occupancy (live / background / parked). Soft-fail → null. */
export type ProcessBudgetHostSnapshot = {
  live?: number;
  background?: number;
  parked?: number;
  totalWarm?: number;
  busy?: number;
  maxConcurrent?: number;
  idleMinutes?: number;
  liveSessionIds?: string[];
  backgroundSessionIds?: string[];
  parkedSessionIds?: string[];
  available?: boolean;
};

/**
 * Live agent process occupancy vs `maxConcurrentAgents`.
 * Soft-fail: returns null when not in Tauri or the command errors
 * (UI maps null → unavailable empty snapshot).
 */
export async function processBudgetSnapshot(): Promise<ProcessBudgetHostSnapshot | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<ProcessBudgetHostSnapshot>("process_budget_snapshot");
  } catch {
    return null;
  }
}

/** Recent cross-session tool/permission audit rows (newest first). Soft-fail → []. */
export async function auditLedgerList(limit?: number | null) {
  if (!isTauri()) return [] as AuditLedgerHostEntry[];
  try {
    return await invoke<AuditLedgerHostEntry[]>("audit_ledger_list", {
      limit: limit ?? null,
    });
  } catch {
    return [];
  }
}

/** Clear on-disk audit ledger. */
export async function auditLedgerClear() {
  return invoke<{ ok: boolean }>("audit_ledger_clear");
}

/** Prune ledger by retention days (`null` → current AppSettings). Soft-fail. */
export async function auditLedgerPrune(retentionDays?: number | null) {
  return invoke<{ ok: boolean; dropped: number }>("audit_ledger_prune", {
    retentionDays: retentionDays ?? null,
  });
}

/** Export filter for host redacted JSONL (camelCase). */
export type AuditLedgerExportFilterArg = {
  event?: string | null;
  sessionId?: string | null;
  fromTs?: string | null;
  toTs?: string | null;
};

/** Export redacted JSONL via native save dialog (optional event/session/range). */
export async function auditLedgerExport(filter?: AuditLedgerExportFilterArg | null) {
  return invoke<SupportBundleResult>("audit_ledger_export", {
    filter: filter ?? null,
  });
}

/**
 * Full session diagnostic zip for bug reports: messages, meta, settings,
 * CLI probe, agent trail (events/history/terminal logs), optional runtime snapshot.
 * Secrets are redacted. Opens a native save dialog.
 */
export async function exportSessionBundle(sessionId: string) {
  return invoke<SupportBundleResult>("export_session_bundle", {
    sessionId,
  });
}

export interface ExportBytesSaveResult {
  ok: boolean;
  cancelled?: boolean;
  path?: string | null;
}

/**
 * Save raw bytes (base64, no data: prefix) via native save dialog.
 * Used for share-card PNG so Tauri WebView does not depend on `<a download>`.
 */
export async function exportBytesSave(opts: {
  bytesBase64: string;
  defaultName: string;
  dialogTitle?: string;
  filterName?: string;
  extensions?: string[];
}) {
  return invoke<ExportBytesSaveResult>("export_bytes_save", {
    bytesBase64: opts.bytesBase64,
    defaultName: opts.defaultName,
    dialogTitle: opts.dialogTitle ?? null,
    filterName: opts.filterName ?? null,
    extensions: opts.extensions ?? null,
  });
}

/** Put a PNG (base64, no data: prefix) on the OS clipboard via arboard. */
export async function clipboardWriteImage(bytesBase64: string) {
  return invoke<void>("clipboard_write_image", { bytesBase64 });
}

/**
 * Put a local image file on the OS clipboard via arboard (Host reads the path).
 * Prefer this for chat cards with a known absolute path — avoids WebView fetch.
 */
export async function clipboardWriteImagePath(path: string) {
  return invoke<void>("clipboard_write_image_path", { path });
}

/**
 * Export Grok Build CLI session trace via `grok trace <agentSessionId>`.
 * Export Grok Build CLI session transcript via `grok export <agentSessionId> [OUTPUT]`.
 * Requires a linked agent session id. Returns markdown text for blob download.
 * Callers should soft-fail to the local App journal when this rejects.
 */
export type SessionCliExportResult = {
  ok: boolean;
  markdown?: string;
  agentSessionId?: string;
  source?: string;
};

export async function sessionCliExport(sessionId: string) {
  return invoke<SessionCliExportResult>("session_cli_export", {
    sessionId,
  });
}

/**
 * Export Grok Build CLI session trace via `grok trace <agentSessionId> --local`.
 * Requires a linked agent session id. Opens a native save dialog for the `.tar.gz`.
 *
 * @param localOnly default **true** (safe): pass `--local`. Set false to omit
 *   `--local` so the CLI may upload over the network.
 */
export async function sessionTraceExport(
  sessionId: string,
  opts?: { localOnly?: boolean },
) {
  return invoke<SessionTraceExportResult>("session_trace_export", {
    sessionId,
    localOnly: opts?.localOnly ?? true,
  });
}

export interface ResetAppDataResult {
  ok: boolean;
  dataRoot: string;
  removed: string[];
  keptSecrets: boolean;
}

/**
 * Wipe App data under the data root.
 * Does not touch ~/.grok. Confirm twice in the UI before calling.
 */
export async function resetAppData(keepSecrets = true) {
  return invoke<ResetAppDataResult>("reset_app_data", {
    keepSecrets,
  });
}

/** List skills via `grok inspect --json` (optional project cwd). */
export async function skillsList(projectPath?: string | null) {
  return invoke<SkillsListResult>("skills_list", {
    projectPath: projectPath ?? null,
  });
}

/** Absolute allowlisted skill roots (user / agent-home / project). */
export async function skillRoots(projectPath?: string | null) {
  return invoke<string[]>("skill_roots", {
    projectPath: projectPath ?? null,
  });
}

/** Read a user-editable SKILL.md (path must sit under known skills roots). */
export async function skillRead(path: string, projectPath?: string | null) {
  return invoke<SkillReadResult>("skill_read", {
    path,
    projectPath: projectPath ?? null,
  });
}

/** Write a user-editable SKILL.md (path must sit under known skills roots). */
export async function skillWrite(
  path: string,
  content: string,
  expectedMtimeMs?: number | null,
  projectPath?: string | null,
) {
  return invoke<SkillWriteResult>("skill_write", {
    path,
    content,
    expectedMtimeMs: expectedMtimeMs ?? null,
    projectPath: projectPath ?? null,
  });
}

/**
 * Scaffold a new skill (`{root}/{name}/SKILL.md`).
 * @param scope `"user"` (path-scoped GROK_HOME skills) or `"project"` (requires projectPath).
 * Does not overwrite an existing SKILL.md.
 */
export async function skillCreate(opts: {
  name: string;
  description?: string | null;
  projectPath?: string | null;
  scope?: "user" | "project" | null;
}) {
  return invoke<SkillCreateResult>("skill_create", {
    name: opts.name,
    description: opts.description ?? null,
    projectPath: opts.projectPath ?? null,
    scope: opts.scope ?? "user",
  });
}

/** List MCP servers via `grok inspect --json` (optional project cwd). */
export async function inspectMcp(projectPath?: string | null) {
  return invoke<InspectMcpResult>("inspect_mcp", {
    projectPath: projectPath ?? null,
  });
}

// ── Project inspect summary (`grok inspect --json`, secret-safe DTO) ────────

export type {
  ProjectInspectSummary,
  ProjectInspectPlugin,
  ProjectInspectMcp,
  ProjectInspectRule,
  ProjectInspectAgent,
  ProjectInspectHook,
  ProjectInspectSkills,
  ProjectInspectPermissions,
  InspectSectionId,
} from "../projectInspect";

/**
 * Sanitized project inspect summary for Settings → Runtime.
 * Optional `projectPath` is used as CLI cwd; secrets never leave the host.
 */
export async function projectInspect(projectPath?: string | null) {
  return invoke<import("../projectInspect").ProjectInspectSummary>("project_inspect", {
    projectPath: projectPath ?? null,
  });
}

// ── Plugins via `grok plugin …` ─────────────────────────────────────────────

/** Component counts from `grok inspect` plugins[].provides — Grok Build shape. */
export interface PluginProvidesDto {
  skills: number;
  agents: number;
  hooks: boolean;
  mcpServers: number;
}

export interface PluginDto {
  name: string;
  version?: string | null;
  source?: string | null;
  marketplace?: string | null;
  path?: string | null;
  /** Install status from `plugin list --json` (usually "installed"). */
  status: string;
  /** Load state from Grok Build config / enable|disable CLI. */
  enabled: boolean;
  repoKey?: string | null;
  /** Grok Build scope: user / project / cli / marketplace name. */
  scope?: string | null;
  provides?: PluginProvidesDto | null;
}

export interface PluginsListResult {
  plugins: PluginDto[];
  error?: string;
}

export interface PluginActionResult {
  ok: boolean;
  name: string;
  message?: string;
}

export interface PluginDetailsResult {
  name: string;
  details: string;
}

/** List installed plugins via `grok plugin list --json`. */
export async function pluginsList() {
  return invoke<PluginsListResult>("plugins_list");
}

/** Enable plugin (`grok plugin enable`) and soft-respawn agent. */
export async function pluginEnable(name: string) {
  return invoke<PluginActionResult>("plugin_enable", { name });
}

/** Disable plugin (`grok plugin disable`) and soft-respawn agent. */
export async function pluginDisable(name: string) {
  return invoke<PluginActionResult>("plugin_disable", { name });
}

/** Uninstall plugin (`grok plugin uninstall --confirm`) and soft-respawn agent. */
export async function pluginUninstall(name: string) {
  return invoke<PluginActionResult>("plugin_uninstall", { name });
}

/** Plugin component inventory text (`grok plugin details`). */
export async function pluginDetails(name: string) {
  return invoke<PluginDetailsResult>("plugin_details", { name });
}

/**
 * Install from path, git URL, or GitHub shorthand (`grok plugin install --trust`).
 * Soft-respawns agent on success.
 */
export async function pluginInstall(source: string) {
  return invoke<PluginActionResult>("plugin_install", { source });
}

/**
 * Update one plugin by name, or all when name is omitted/null/empty.
 * Soft-respawns agent on success.
 */
export async function pluginUpdate(name?: string | null) {
  const n = (name ?? "").trim();
  return invoke<PluginActionResult>("plugin_update", {
    name: n ? n : null,
  });
}

/** Result of `grok plugin validate` (host always returns envelope; soft-fail when CLI too old). */
export interface PluginValidateResult {
  ok: boolean;
  messages: string[];
  path?: string | null;
  /** e.g. `cli_too_old` when the probed CLI lacks `plugin validate`. */
  reason?: string | null;
}

/**
 * Validate a plugin manifest via `grok plugin validate [path|name]`.
 * Pass an installed plugin path/name, or a local path before install.
 * Soft-fails (ok:false + reason) when CLI is too old — does not throw for that case.
 */
export async function pluginValidate(pathOrName?: string | null) {
  const raw = (pathOrName ?? "").trim();
  return invoke<PluginValidateResult>("plugin_validate", {
    pathOrName: raw ? raw : null,
  });
}


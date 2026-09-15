/** API domain: memory */

import {
  invoke,
} from "./host";

export async function settingsRememberLastSession(
  sessionId?: string | null,
  projectId?: string | null,
) {
  return invoke<void>("settings_remember_last_session", {
    sessionId: sessionId ?? null,
    projectId: projectId ?? null,
  });
}

export async function memoryClear(opts?: {
  cwd?: string | null;
  scope?: "workspace" | "global" | "all";
}) {
  return invoke<{
    ok: boolean;
    stdout: string;
    stderr: string;
    cwd: string;
  }>("memory_clear", {
    cwd: opts?.cwd ?? null,
    scope: opts?.scope ?? "workspace",
  });
}

/** On-disk Grok Build memory artifact under `{GROK_HOME}/memory`. */
export type MemoryFileEntry = {
  path: string;
  name: string;
  relativePath: string;
  size: number;
  mtimeMs: number;
  preview: string;
  /** global | workspace | session | index | other */
  kind: string;
  workspaceSlug?: string | null;
  matched: boolean;
};

export type MemoryListResult = {
  entries: MemoryFileEntry[];
  memoryRoot: string;
  memoryRootExists: boolean;
  grokHome: string;
  cwd?: string | null;
  workspaceSlugs: string[];
};

/** List workspace (+ global) memory files for a project cwd. */
export async function memoryList(opts?: { cwd?: string | null }) {
  return invoke<MemoryListResult>("memory_list", {
    cwd: opts?.cwd ?? null,
  });
}

/** Delete a single memory file (host enforces path under memory root). */
export async function memoryDeleteFile(path: string) {
  return invoke<{ ok: boolean; path: string }>("memory_delete_file", {
    path,
  });
}

/** Redacted agent `config.toml` for the active session data mode. */
export type AgentConfigTomlReadResult = {
  path: string;
  exists: boolean;
  /** independent | shared */
  mode: string;
  grokHome: string;
  /** Secrets redacted by host. */
  text: string;
  /** `[table]` headers in document order. */
  sections: string[];
  truncated: boolean;
};

/** Read agent config.toml (path + redacted text). View-only. */
export async function agentConfigTomlRead() {
  return invoke<AgentConfigTomlReadResult>("agent_config_toml_read");
}

/** Content/name hit under `{GROK_HOME}/memory` (host-capped, redacted snippet). */
export type MemorySearchHit = {
  path: string;
  name: string;
  relativePath: string;
  kind: string;
  workspaceSlug?: string | null;
  size: number;
  mtimeMs: number;
  /** Redacted excerpt; empty for name-only matches. */
  snippet: string;
  contentMatch: boolean;
  matched: boolean;
};

export type MemorySearchResult = {
  hits: MemorySearchHit[];
  memoryRoot: string;
  memoryRootExists: boolean;
  grokHome: string;
  cwd?: string | null;
  query: string;
  limit: number;
  truncated: boolean;
  /**
   * App search path honesty: `keyword` | `hybrid_unavailable` | `hybrid`.
   * Always keyword-family today (no host-invocable hybrid CLI as of 0.2.117).
   * Soft-fail missing → treat as keyword.
   */
  searchKind?: string;
};

/**
 * Search path-scoped memory files (name + body) under agent GROK_HOME/memory.
 * Host enforces read/hit caps and redacts snippets.
 * Always keyword / file-body scan — never invents embeddings client-side.
 * When embedding.model is set but no host hybrid CLI exists, `searchKind` is
 * `hybrid_unavailable`. Agent-tool hybrid is configured via memoryEmbedConfig*.
 */
export async function memorySearch(opts: {
  query: string;
  cwd?: string | null;
  limit?: number;
}) {
  return invoke<MemorySearchResult>("memory_search", {
    query: opts.query,
    cwd: opts.cwd ?? null,
    limit: opts.limit ?? null,
  });
}

/**
 * Memory embedding config — allowlisted Grok Build 0.2.117 `[memory.*]` keys
 * from active GROK_HOME config.toml. Missing keys are null (soft-fail).
 * Writes only in independent agent-home mode.
 */
export type MemoryEmbedConfigSnapshot = {
  path: string;
  grokHome: string;
  mode: string;
  writable: boolean;
  fileExists: boolean;
  embeddingConfigured: boolean;
  /** Always `"keyword"` for App host browser search. */
  appSearchMode: string;
  /** `"hybrid"` when embedding.model set; else `"keyword"`. */
  cliSearchMode: string;
  embeddingModel?: string | null;
  embeddingDimensions?: number | null;
  embeddingProvider?: string | null;
  embeddingBaseUrl?: string | null;
  hasEmbeddingApiKey?: boolean | null;
  searchMaxResults?: number | null;
  searchMinScore?: number | null;
  searchVectorWeight?: number | null;
  searchTextWeight?: number | null;
  mmrEnabled?: boolean | null;
  mmrLambda?: number | null;
  temporalDecayEnabled?: boolean | null;
  temporalDecayHalfLifeDays?: number | null;
  dreamEnabled?: boolean | null;
  dreamMinHours?: number | null;
  dreamMinSessions?: number | null;
  dreamCheckIntervalSecs?: number | null;
  watcherEnabled?: boolean | null;
  initialInjectionEnabled?: boolean | null;
  initialInjectionMinScore?: number | null;
  redactedPreview: string;
};

export type MemoryEmbedConfigPatch = {
  embeddingModel?: string | null;
  clearEmbeddingModel?: boolean | null;
  embeddingDimensions?: number | null;
  embeddingProvider?: string | null;
  embeddingBaseUrl?: string | null;
  clearEmbeddingBaseUrl?: boolean | null;
  embeddingApiKey?: string | null;
  clearEmbeddingApiKey?: boolean | null;
  searchMaxResults?: number | null;
  searchMinScore?: number | null;
  searchVectorWeight?: number | null;
  searchTextWeight?: number | null;
  mmrEnabled?: boolean | null;
  mmrLambda?: number | null;
  temporalDecayEnabled?: boolean | null;
  temporalDecayHalfLifeDays?: number | null;
  dreamEnabled?: boolean | null;
  dreamMinHours?: number | null;
  dreamMinSessions?: number | null;
  dreamCheckIntervalSecs?: number | null;
  watcherEnabled?: boolean | null;
  initialInjectionEnabled?: boolean | null;
  initialInjectionMinScore?: number | null;
};

export async function memoryEmbedConfigGet(): Promise<MemoryEmbedConfigSnapshot> {
  return invoke<MemoryEmbedConfigSnapshot>("memory_embed_config_get");
}

export async function memoryEmbedConfigSet(
  patch: MemoryEmbedConfigPatch,
): Promise<MemoryEmbedConfigSnapshot> {
  // Tauri maps camelCase invoke keys → snake_case command args.
  return invoke<MemoryEmbedConfigSnapshot>("memory_embed_config_set", {
    embeddingModel: patch.embeddingModel ?? null,
    clearEmbeddingModel: patch.clearEmbeddingModel ?? null,
    embeddingDimensions: patch.embeddingDimensions ?? null,
    embeddingProvider: patch.embeddingProvider ?? null,
    embeddingBaseUrl: patch.embeddingBaseUrl ?? null,
    clearEmbeddingBaseUrl: patch.clearEmbeddingBaseUrl ?? null,
    embeddingApiKey: patch.embeddingApiKey ?? null,
    clearEmbeddingApiKey: patch.clearEmbeddingApiKey ?? null,
    searchMaxResults: patch.searchMaxResults ?? null,
    searchMinScore: patch.searchMinScore ?? null,
    searchVectorWeight: patch.searchVectorWeight ?? null,
    searchTextWeight: patch.searchTextWeight ?? null,
    mmrEnabled: patch.mmrEnabled ?? null,
    mmrLambda: patch.mmrLambda ?? null,
    temporalDecayEnabled: patch.temporalDecayEnabled ?? null,
    temporalDecayHalfLifeDays: patch.temporalDecayHalfLifeDays ?? null,
    dreamEnabled: patch.dreamEnabled ?? null,
    dreamMinHours: patch.dreamMinHours ?? null,
    dreamMinSessions: patch.dreamMinSessions ?? null,
    dreamCheckIntervalSecs: patch.dreamCheckIntervalSecs ?? null,
    watcherEnabled: patch.watcherEnabled ?? null,
    initialInjectionEnabled: patch.initialInjectionEnabled ?? null,
    initialInjectionMinScore: patch.initialInjectionMinScore ?? null,
  });
}

export type HookDto = {
  name: string;
  path: string;
  scope: string;
  kind: string;
  ext?: string;
  size: number;
  mtimeMs: number;
};

export type HooksListResult = {
  hooks: HookDto[];
  userDir: string;
  userDirExists: boolean;
  projectDir?: string | null;
  projectDirExists?: boolean | null;
  docsPath?: string | null;
};

export async function hooksList(projectPath?: string | null) {
  return invoke<HooksListResult>("hooks_list", {
    projectPath: projectPath ?? null,
  });
}

export async function hooksReveal(path: string) {
  return invoke<void>("hooks_reveal", { path });
}

export async function hooksOpenDir(opts?: {
  scope?: "user" | "project" | string;
  projectPath?: string | null;
  create?: boolean;
}) {
  return invoke<{ path: string; scope: string }>("hooks_open_dir", {
    scope: opts?.scope ?? "user",
    projectPath: opts?.projectPath ?? null,
    create: opts?.create ?? false,
  });
}

export async function hooksEnsureDir(opts?: {
  scope?: "user" | "project" | string;
  projectPath?: string | null;
}) {
  return invoke<{ path: string }>("hooks_ensure_dir", {
    scope: opts?.scope ?? "user",
    projectPath: opts?.projectPath ?? null,
  });
}

/** Result of host `hooks_try_run` — real process; never invents success. */
export type HooksTryRunResult = {
  ok: boolean;
  refused: boolean;
  timedOut: boolean;
  exitCode?: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  path: string;
  scope: string;
  timeoutSecs: number;
  reason?: string | null;
  message?: string | null;
};

/**
 * Real try-run of a hook script under user/project hooks dirs only.
 * Optional JSON stdin; host redacts stdout/stderr and enforces timeout.
 */
export async function hooksTryRun(opts: {
  path: string;
  projectPath?: string | null;
  stdinJson?: string | null;
  timeoutSecs?: number | null;
}) {
  return invoke<HooksTryRunResult>("hooks_try_run", {
    path: opts.path,
    projectPath: opts.projectPath ?? null,
    stdinJson: opts.stdinJson ?? null,
    timeoutSecs: opts.timeoutSecs ?? null,
  });
}


export type SetupPreviewResult = {
  ok: boolean;
  payload?: unknown;
  message?: string | null;
  error?: string | null;
  errorKind?: string | null;
};

export type SetupInstallResult = {
  ok: boolean;
  message?: string | null;
  error?: string | null;
  errorKind?: string | null;
};

/** Soft-fail local managed-config / signature artifact probe. */
export type ManagedSetupStatusResult = {
  ok: boolean;
  cliFound: boolean;
  grokHome?: string | null;
  managedConfigPresent: boolean;
  requirementsPresent: boolean;
  configSignaturePresent: boolean;
  identitySignaturePresent: boolean;
  systemManagedConfigPresent: boolean;
  managedSettingsActive?: boolean | null;
  managedSettingsExists?: boolean | null;
  managedSettingsPath?: string | null;
  /**
   * Explicit CLI/inspect/doctor signature verification when reported.
   * Null/undefined = not reported (App never invents verified).
   */
  signatureVerified?: boolean | null;
  /** `inspect` | `doctor` when verification claim is present. */
  signatureVerifySource?: string | null;
  /** True when status is path/inspect presence only (App did not crypto-verify). */
  presenceOnly?: boolean;
  reason?: string | null;
};

export async function setupPreview() {
  return invoke<SetupPreviewResult>("setup_preview");
}

export async function setupInstall() {
  return invoke<SetupInstallResult>("setup_install");
}

/** Soft-fail: local managed files + optional inspect managed-settings flags. */
export async function managedSetupStatus() {
  return invoke<ManagedSetupStatusResult>("managed_setup_status");
}

export type MarketplaceListResult = {
  sources: Array<Record<string, unknown>>;
  error?: string | null;
};

export type MarketplaceAvailableResult = {
  plugins: Array<Record<string, unknown>>;
  error?: string | null;
};

export type MarketplaceActionResult = {
  ok: boolean;
  name?: string;
  message?: string;
  removed?: string;
  error?: string;
};

export async function marketplaceList() {
  return invoke<MarketplaceListResult>("marketplace_list");
}

export async function marketplaceAvailable() {
  return invoke<MarketplaceAvailableResult>("marketplace_available");
}

/** On-disk marketplace-cache plugin.json + logo paths (for Settings cards). */
export type MarketplacePluginMeta = {
  name: string;
  displayName?: string | null;
  description?: string | null;
  longDescription?: string | null;
  version?: string | null;
  category?: string | null;
  author?: string | null;
  homepage?: string | null;
  repository?: string | null;
  license?: string | null;
  logoPath?: string | null;
  rootPath?: string | null;
  keywords?: string[];
};

export type MarketplacePluginMetaIndexResult = {
  plugins: MarketplacePluginMeta[];
};

export async function marketplacePluginMetaIndex() {
  return invoke<MarketplacePluginMetaIndexResult>("marketplace_plugin_meta_index");
}

export async function marketplaceAdd(source: string) {
  return invoke<MarketplaceActionResult>("marketplace_add", { source });
}

export async function marketplaceRemove(nameOrUrl: string) {
  return invoke<MarketplaceActionResult>("marketplace_remove", { nameOrUrl });
}

export async function marketplaceUpdate(name?: string | null) {
  return invoke<MarketplaceActionResult>("marketplace_update", {
    name: name ?? null,
  });
}

export type PermissionRules = {
  path?: string;
  configPath?: string;
  allow: string[];
  deny: string[];
  ask: string[];
};

export async function permissionRulesGet() {
  return invoke<PermissionRules>("permission_rules_get");
}

export async function permissionRulesSet(rules: PermissionRules) {
  return invoke<PermissionRules>("permission_rules_set", { rules });
}

/** Allowlisted agent-home config.toml section edit (independent GROK_HOME only). */
export type AgentConfigEditSnapshot = {
  path: string;
  grokHome: string;
  mode: string;
  writable: boolean;
  fileExists: boolean;
  permissionMode?: string | null;
  yolo?: boolean | null;
  subagentsEnabled?: boolean | null;
  memoryEnabled?: boolean | null;
  /** `[workflows].enabled` — background workflows / goal driver. */
  workflowsEnabled?: boolean | null;
  /** `[features].auto_wake` — wake after background tasks. */
  autoWakeEnabled?: boolean | null;
  /** `[features].two_pass_compaction` — opt-in prefire two-pass. */
  twoPassCompactionEnabled?: boolean | null;
  /** `[features].lsp_tools`. */
  lspToolsEnabled?: boolean | null;
  /** `[features].codebase_indexing`. */
  codebaseIndexing?: boolean | null;
  /** `[features].remote_fetch` — online model-catalog fetches. */
  remoteFetch?: boolean | null;
  redactedPreview: string;
};

export type AgentConfigEditPatch = {
  permissionMode?: string | null;
  yolo?: boolean | null;
  subagentsEnabled?: boolean | null;
  memoryEnabled?: boolean | null;
  workflowsEnabled?: boolean | null;
  autoWakeEnabled?: boolean | null;
  twoPassCompactionEnabled?: boolean | null;
  lspToolsEnabled?: boolean | null;
  codebaseIndexing?: boolean | null;
  remoteFetch?: boolean | null;
};

export async function agentConfigEditGet(): Promise<AgentConfigEditSnapshot> {
  return invoke<AgentConfigEditSnapshot>("agent_config_edit_get");
}

export async function agentConfigEditSet(
  patch: AgentConfigEditPatch,
): Promise<AgentConfigEditSnapshot> {
  return invoke<AgentConfigEditSnapshot>("agent_config_edit_set", {
    permissionMode: patch.permissionMode ?? null,
    yolo: patch.yolo ?? null,
    subagentsEnabled: patch.subagentsEnabled ?? null,
    memoryEnabled: patch.memoryEnabled ?? null,
    workflowsEnabled: patch.workflowsEnabled ?? null,
    autoWakeEnabled: patch.autoWakeEnabled ?? null,
    twoPassCompactionEnabled: patch.twoPassCompactionEnabled ?? null,
    lspToolsEnabled: patch.lspToolsEnabled ?? null,
    codebaseIndexing: patch.codebaseIndexing ?? null,
    remoteFetch: patch.remoteFetch ?? null,
  });
}

/**
 * Privacy center — allowlisted Grok Build 0.2.117 privacy keys from active
 * GROK_HOME config.toml. Missing keys are null (soft-fail). Writes only in
 * independent agent-home mode.
 */
export type PrivacyConfigSnapshot = {
  path: string;
  grokHome: string;
  mode: string;
  writable: boolean;
  fileExists: boolean;
  telemetry?: boolean | null;
  traceUpload?: boolean | null;
  mixpanelEnabled?: boolean | null;
  disableCodebaseUpload?: boolean | null;
  disableWorkspaceTeleport?: boolean | null;
  redactedPreview: string;
  cliPrivacyCommand: string;
};

export type PrivacyConfigPatch = {
  telemetry?: boolean | null;
  traceUpload?: boolean | null;
  mixpanelEnabled?: boolean | null;
  disableCodebaseUpload?: boolean | null;
  disableWorkspaceTeleport?: boolean | null;
};

export async function privacyConfigGet(): Promise<PrivacyConfigSnapshot> {
  return invoke<PrivacyConfigSnapshot>("privacy_config_get");
}

export async function privacyConfigSet(
  patch: PrivacyConfigPatch,
): Promise<PrivacyConfigSnapshot> {
  // Tauri maps camelCase invoke keys → snake_case command args.
  return invoke<PrivacyConfigSnapshot>("privacy_config_set", {
    telemetry: patch.telemetry ?? null,
    traceUpload: patch.traceUpload ?? null,
    mixpanelEnabled: patch.mixpanelEnabled ?? null,
    disableCodebaseUpload: patch.disableCodebaseUpload ?? null,
    disableWorkspaceTeleport: patch.disableWorkspaceTeleport ?? null,
  });
}

/**
 * Codebase indexing — `[features].codebase_indexing` (code graph, not embeddings).
 * Missing key is unset (CLI default on). Writes only in independent agent-home.
 */
export type CodebaseIndexingSnapshot = {
  path: string;
  grokHome: string;
  mode: string;
  writable: boolean;
  fileExists: boolean;
  /** `unset` | `bool` | `custom` */
  kind: string;
  enabled?: boolean | null;
  customRaw?: string | null;
  cliDefault: boolean;
  effectiveEnabled: boolean;
  redactedPreview: string;
  /** Always false — App never invents embeddings for this surface. */
  inventsEmbeddings: boolean;
};

export type CodebaseIndexingPatch = {
  enabled?: boolean | null;
};

export async function codebaseIndexingGet(): Promise<CodebaseIndexingSnapshot> {
  return invoke<CodebaseIndexingSnapshot>("codebase_indexing_get");
}

export async function codebaseIndexingSet(
  patch: CodebaseIndexingPatch,
): Promise<CodebaseIndexingSnapshot> {
  return invoke<CodebaseIndexingSnapshot>("codebase_indexing_set", {
    enabled: patch.enabled ?? null,
  });
}


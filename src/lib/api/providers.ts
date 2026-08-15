/** API domain: providers */

import {
  invoke,
} from "./host";

// ── Custom providers (agent-home config.toml) ───────────────────────────────

export interface ProviderModelEntry {
  /** Upstream request body model id. */
  id: string;
  /** Composer chip / menu display label. */
  name: string;
}

export interface ProviderEffortEntry {
  /** Value for `--reasoning-effort` / upstream `reasoning_effort`. */
  id: string;
  /** Composer display label (optional; falls back to id). */
  name?: string;
  isDefault?: boolean;
}

export interface CustomProvider {
  id: string;
  model: string;
  baseUrl: string;
  name: string;
  hasApiKey: boolean;
  apiBackend: string;
  /** Explicit relay semantics. Host never infers this from the URL. */
  providerMode: "generic" | "grok_build_proxy" | string;
  isDefault: boolean;
  /** Selectable models for this channel (App-managed catalog). */
  models?: ProviderModelEntry[];
  /** Reasoning efforts for this channel (App-managed). Empty → Grok 3-tier fallback. */
  efforts?: ProviderEffortEntry[];
  /** Per-channel context window (tokens). None → catalog window, then default. */
  contextWindow?: number | null;
  /**
   * When true, host does not auto-append `/v1` to baseUrl (full path mode).
   * Default false keeps legacy OpenAI-compatible `/v1` normalization.
   */
  baseUrlFullPath?: boolean;
  /**
   * Extra instructions appended to the system prompt on this channel.
   * Rides the CLI `--rules` flag, so the agent keeps its built-in prompt.
   */
  appendPrompt?: string | null;
  /**
   * Explicit: this relay accepts image pixels. Combined with name/model
   * heuristics so Grok / gpt-4o / claude channels are vision even when off.
   */
  supportsVision?: boolean;
}

export interface ProvidersListResult {
  providers: CustomProvider[];
  defaultModel: string | null;
  /** `official` | `custom` */
  activeSource: string;
  activeProviderId: string | null;
  configPath: string;
  agentHome: string;
  /**
   * Host forced session_data_mode shared → independent so custom agent-home
   * config is live (#557). UI should refresh mode + toast when true.
   */
  switchedToIndependent?: boolean;
}

export async function providersList() {
  return invoke<ProvidersListResult>("providers_list");
}

/** CC Switch Grok Build provider preview (no full API key). */
export interface CcSwitchProviderPreview {
  sourceId: string;
  name: string;
  websiteUrl?: string | null;
  category?: string | null;
  isCurrent: boolean;
  suggestedId: string;
  model: string;
  baseUrl: string;
  apiBackend: string;
  hasApiKey: boolean;
  keyHint?: string | null;
  /** importable | official | missing_key | proxy_managed | invalid | exists */
  status: string;
  statusDetail?: string | null;
}

export interface CcSwitchScanResult {
  status: "ok" | "not_found" | "error" | string;
  dbPath?: string | null;
  triedPaths: string[];
  items: CcSwitchProviderPreview[];
  error?: string | null;
}

export interface CcSwitchImportResult {
  imported: number;
  skipped: number;
  failed: Array<{ sourceId: string; reason: string }>;
  providers?: ProvidersListResult | null;
}

/** Read-only scan of local CC Switch `cc-switch.db` (Grok Build tab). */
export async function providersCcSwitchScan() {
  return invoke<CcSwitchScanResult>("providers_cc_switch_scan");
}

/** Import selected CC Switch providers into agent-home config.toml. */
export async function providersCcSwitchImport(body: {
  sourceIds: string[];
  /** Default overwrite — same id updates key/base_url. */
  onConflict?: "skip" | "overwrite" | "rename";
  activateId?: string | null;
}) {
  return invoke<CcSwitchImportResult>("providers_cc_switch_import", {
    body: {
      sourceIds: body.sourceIds,
      onConflict: body.onConflict ?? "overwrite",
      activateId: body.activateId ?? null,
    },
  });
}

/** Switch to official Grok Build or a custom provider (writes config.toml default). */
export async function providersActivate(
  source: "official" | "custom",
  providerId?: string | null,
) {
  return invoke<ProvidersListResult>("providers_activate", {
    source,
    providerId: providerId ?? null,
  });
}

// ── Model auxiliary routing (`[models]` side-task slots) ─────────────────────

export interface ModelsAuxSlots {
  imageDescription: string;
  webSearch: string;
  sessionSummary: string;
  promptSuggestion: string;
}

export interface ModelsAuxOption {
  id: string;
  label: string;
  source: string;
  hint?: string;
}

export interface ModelsAuxState {
  slots: ModelsAuxSlots;
  options: ModelsAuxOption[];
  sessionDataMode: string;
  writable: boolean;
  configPath: string;
  mainDefault: string;
  activeSource: string;
  saveGrokTarget?: string | null;
  saveGrokLabel?: string | null;
  saveGrokReason: string;
  /**
   * Stable health code for i18n (empty = ok):
   * `official_aux_incomplete` | `text_only_no_vision`
   */
  healthCode?: string;
  visionReady?: boolean;
  mainTextOnly?: boolean;
  hasOfficialApiKey?: boolean;
}

export interface ModelsAuxSetInput {
  imageDescription?: string | null;
  webSearch?: string | null;
  sessionSummary?: string | null;
  promptSuggestion?: string | null;
}

export async function modelsAuxGet() {
  return invoke<ModelsAuxState>("models_aux_get");
}

export async function modelsAuxSet(body: ModelsAuxSetInput) {
  return invoke<ModelsAuxState>("models_aux_set", {
    imageDescription: body.imageDescription ?? null,
    webSearch: body.webSearch ?? null,
    sessionSummary: body.sessionSummary ?? null,
    promptSuggestion: body.promptSuggestion ?? null,
  });
}

export async function modelsAuxApplySaveGrok() {
  return invoke<ModelsAuxState>("models_aux_apply_save_grok");
}

export async function modelsAuxResetDefaults() {
  return invoke<ModelsAuxState>("models_aux_reset_defaults");
}

/** Independent `grok -p -m <modelId>` under agent-home (not the live session model). */
export async function modelsAuxHeadless(body: {
  modelId: string;
  prompt: string;
  maxTurns?: number;
}) {
  return invoke<string>("models_aux_headless", {
    modelId: body.modelId,
    prompt: body.prompt,
    maxTurns: body.maxTurns ?? null,
  });
}

/** Host web search via configured web_search aux model (headless). */
export async function modelsAuxWebSearch(query: string) {
  return invoke<string>("models_aux_web_search", { query });
}

// ── Official aux (isolated GROK_HOME + grok -p) ─────────────────────────────

export interface OfficialAuxStatus {
  available: boolean;
  home: string;
  model: string;
  hasCliAuth: boolean;
  hasApiKey: boolean;
  reason: string;
}

export async function officialAuxStatus() {
  return invoke<OfficialAuxStatus>("official_aux_status");
}

export async function officialAuxEnsureHome() {
  return invoke<string>("official_aux_ensure_home");
}

export async function officialAuxDispatch(tool: string, args: Record<string, unknown>) {
  return invoke<string>("official_aux_dispatch", { tool, args });
}

export async function officialAuxWebSearch(query: string) {
  return invoke<string>("official_aux_web_search", { query });
}

export async function officialAuxXKeywordSearch(body: {
  query: string;
  limit?: number;
  minFaves?: number;
}) {
  return invoke<string>("official_aux_x_keyword_search", {
    query: body.query,
    limit: body.limit ?? null,
    minFaves: body.minFaves ?? null,
  });
}

export async function officialAuxXSemanticSearch(query: string, limit?: number) {
  return invoke<string>("official_aux_x_semantic_search", {
    query,
    limit: limit ?? null,
  });
}

export async function officialAuxXUserSearch(query: string, count?: number) {
  return invoke<string>("official_aux_x_user_search", {
    query,
    count: count ?? null,
  });
}

export async function officialAuxXThreadFetch(postIdOrUrl: string) {
  return invoke<string>("official_aux_x_thread_fetch", {
    postIdOrUrl,
  });
}

export async function officialAuxVisionDescribe(paths: string[], question?: string) {
  return invoke<string>("official_aux_vision_describe", {
    paths,
    question: question ?? null,
  });
}

export async function providersUpsert(body: {
  id: string;
  model: string;
  baseUrl: string;
  name?: string;
  apiKey?: string;
  apiBackend?: string;
  providerMode?: "generic" | "grok_build_proxy" | string;
  setAsDefault?: boolean;
  createOnly?: boolean;
  models?: ProviderModelEntry[];
  efforts?: ProviderEffortEntry[];
  contextWindow?: number | null;
  /** Full-path base URL — do not auto-append `/v1`. */
  baseUrlFullPath?: boolean;
  /** Channel rules appended to the system prompt. `""` clears; omit to keep. */
  appendPrompt?: string | null;
  /** Persist vision capability. Omit to keep the existing flag on edit. */
  supportsVision?: boolean;
}) {
  return invoke<ProvidersListResult>("providers_upsert", {
    id: body.id,
    model: body.model,
    baseUrl: body.baseUrl,
    name: body.name ?? null,
    apiKey: body.apiKey ?? null,
    apiBackend: body.apiBackend ?? null,
    providerMode: body.providerMode ?? null,
    setAsDefault: body.setAsDefault ?? null,
    createOnly: body.createOnly ?? null,
    models: body.models ?? null,
    efforts: body.efforts ?? null,
    contextWindow: body.contextWindow ?? null,
    baseUrlFullPath: body.baseUrlFullPath ?? null,
    appendPrompt: body.appendPrompt ?? null,
    supportsVision: body.supportsVision ?? null,
  });
}

export async function providersRemove(id: string) {
  return invoke<ProvidersListResult>("providers_remove", { id });
}

export async function providersSetDefault(modelId: string) {
  return invoke<ProvidersListResult>("providers_set_default", { modelId });
}

export async function providersPing(opts?: {
  baseUrl?: string;
  apiKey?: string;
  providerId?: string;
}) {
  return invoke<{
    ok: boolean;
    latencyMs: number;
    endpoint: string;
    status?: number;
    error?: string;
  }>("providers_ping", {
    baseUrl: opts?.baseUrl ?? null,
    apiKey: opts?.apiKey ?? null,
    providerId: opts?.providerId ?? null,
  });
}

export async function providersListModels(opts: {
  baseUrl: string;
  apiKey?: string;
  providerId?: string;
}) {
  return invoke<{
    endpoint: string;
    models: Array<{
      id: string;
      ownedBy?: string;
      supportsBackendSearch?: boolean;
    }>;
  }>("providers_list_models", {
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey ?? null,
    providerId: opts.providerId ?? null,
  });
}

/** Per-model connection probe result (success = HTTP 2xx). */
export interface ProviderTestResult {
  ok: boolean;
  latencyMs: number;
  endpoint: string;
  status?: number;
  errorKind?:
    | "auth"
    | "model_not_found"
    | "rate_limit"
    | "server"
    | "network"
    | "timeout"
    | "unknown"
    | string;
  error?: string;
}

/**
 * Test whether a specific model id is usable on a custom provider by sending
 * one tiny non-streaming inference request. Mirrors ZCode's "测试模型" probe.
 */
export async function providersTestModel(opts: {
  model: string;
  baseUrl?: string;
  apiKey?: string;
  providerId?: string;
  apiBackend?: string;
  baseUrlFullPath?: boolean;
}) {
  return invoke<ProviderTestResult>("providers_test_model", {
    baseUrl: opts.baseUrl ?? null,
    apiKey: opts.apiKey ?? null,
    providerId: opts.providerId ?? null,
    model: opts.model,
    apiBackend: opts.apiBackend ?? null,
    baseUrlFullPath: opts.baseUrlFullPath ?? null,
  });
}

/** One currency row from a provider balance probe (amounts stay strings). */
export interface ProviderBalanceLine {
  currency: string;
  totalBalance: string;
  grantedBalance: string;
  toppedUpBalance: string;
}

/** Normalized balance / plan probe (DeepSeek first; plan reserved). */
export interface ProviderBalanceResult {
  kind: "balance" | "plan" | "unsupported" | string;
  provider: string;
  endpoint: string;
  ok: boolean;
  latencyMs: number;
  status?: number;
  error?: string;
  errorKind?: "auth" | "network" | "timeout" | "unsupported" | "other" | string;
  isAvailable?: boolean;
  balances?: ProviderBalanceLine[];
}

/** Probe account balance (Phase 1: DeepSeek `GET /user/balance` only). */
export async function providersBalance(opts?: {
  baseUrl?: string;
  apiKey?: string;
  providerId?: string;
}) {
  return invoke<ProviderBalanceResult>("providers_balance", {
    baseUrl: opts?.baseUrl ?? null,
    apiKey: opts?.apiKey ?? null,
    providerId: opts?.providerId ?? null,
  });
}

// ── Editors ─────────────────────────────────────────────────────────────────

export interface DetectedEditor {
  id: string;
  label: string;
  command: string;
  available: boolean;
  /** `data:image/png;base64,...` from host-extracted app icon when available. */
  iconDataUrl?: string | null;
}

export interface EditorsListResult {
  editors: DetectedEditor[];
  finderIcon?: string | null;
  systemIcon?: string | null;
  /** Host scan timestamp (ms), when present. */
  scannedAt?: number | null;
}

export async function editorsList() {
  return invoke<EditorsListResult>("editors_list");
}

export async function openInEditor(opts: {
  path: string;
  line?: number;
  editor?: string;
}) {
  return invoke<void>("open_in_editor", {
    path: opts.path,
    line: opts.line ?? null,
    editor: opts.editor ?? null,
  });
}

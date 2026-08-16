/** API domain: runtime */

import {
  invoke,
} from "./host";

export type CliUpdateCheck = {
  ok?: boolean;
  current?: string | null;
  latest?: string | null;
  currentVersion?: string | null;
  latestVersion?: string | null;
  version?: string | null;
  /** Raw channel from CLI when known (`stable` / `alpha`); omit/null = unknown. */
  channel?: string | null;
  updateAvailable?: boolean;
  message?: string | null;
  error?: string | null;
  cliPath?: string | null;
  [key: string]: unknown;
};

export type CliUpdateInstallOpts = {
  /** Switch to `stable` or `alpha` (`grok update --stable|--alpha`). */
  channel?: string | null;
  /** Pin a specific version (`grok update --version <V>`). */
  version?: string | null;
  /** Pass `--force-reinstall`. */
  force?: boolean | null;
};

export async function cliUpdateCheck() {
  return invoke<CliUpdateCheck>("cli_update_check");
}

/**
 * Install / switch / pin CLI via host `cli_update_install`.
 * Plain call = current-channel update (App trust-chain fallback).
 * Channel/version soft-fail without inventing channels.
 */
export async function cliUpdateInstall(opts?: CliUpdateInstallOpts | null) {
  return invoke<CliUpdateCheck>("cli_update_install", {
    channel: opts?.channel ?? null,
    version: opts?.version ?? null,
    force: opts?.force ?? null,
  });
}

/** Recycle all warm agent processes (e.g. after CLI upgrade). */
export async function agentsRecycleAll() {
  return invoke<void>("agents_recycle_all");
}

/**
 * Host `mcp_doctor` report — `grok mcp doctor --json [NAME]`.
 * Shape matches `extensions::McpDoctorReport` (camelCase). Pure TS helpers
 * accept this loosely via `McpDoctorReportLike`.
 */
export type McpDoctorReport = {
  ok: boolean;
  servers?: Array<Record<string, any>>;
  sources?: Array<Record<string, any>>;
  issues?: Array<Record<string, any> | string>;
  summary?: {
    total?: number;
    healthy?: number;
    unhealthy?: number;
    [key: string]: unknown;
  };
  rawText?: string | null;
  message?: string | null;
  error?: string | null;
  [key: string]: unknown;
};

export async function mcpAdd(opts: {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}) {
  return invoke<{ ok: boolean; error?: string }>("mcp_add", opts);
}

export async function mcpRemove(name: string) {
  return invoke<{ ok: boolean; error?: string }>("mcp_remove", { name });
}

/**
 * Run `grok mcp doctor --json [name]` under the active GROK_HOME.
 * Optional `name` filters to one configured server — never invents servers.
 */
export async function mcpDoctor(name?: string | null) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return invoke<McpDoctorReport>("mcp_doctor", {
    name: trimmed || null,
  });
}

/** Host MCP OAuth start — returns authorize URL; host waits for loopback callback. */
export type McpOauthStartResult = {
  ok: boolean;
  server: string;
  authUrl: string;
  redirectUri?: string;
  message?: string;
};

export type McpOauthStatusResult = {
  ok: boolean;
  server: string;
  phase: "idle" | "pending" | "success" | "error" | string;
  message: string;
  error?: string | null;
};

export async function mcpOauthStart(name: string) {
  return invoke<McpOauthStartResult>("mcp_oauth_start", {
    name: name.trim(),
  });
}

export async function mcpOauthStatus(name: string) {
  return invoke<McpOauthStatusResult>("mcp_oauth_status", {
    name: name.trim(),
  });
}

export type ProjectRuleEntry = {
  path?: string;
  name?: string;
  scope?: string;
  exists?: boolean;
  relativePath?: string;
  absolutePath?: string;
  kind?: string;
  created?: boolean;
  [key: string]: unknown;
};

export type ProjectRulesListResult = {
  rules?: ProjectRuleEntry[];
  hasAgentsMd?: boolean;
  [key: string]: unknown;
};

export async function projectRulesList(projectPath: string) {
  return invoke<ProjectRulesListResult | ProjectRuleEntry[]>("project_rules_list", { projectPath });
}

export async function projectRulesEnsureTemplate(projectPath: string) {
  return invoke<ProjectRuleEntry>("project_rules_ensure_template", {
    projectPath,
  });
}

// ── Agent leader / serve (Runtime) ──────────────────────────────────────────

export type LeaderProcess = {
  pid?: number | null;
  socketPath?: string | null;
  version?: string | null;
  classification?: string | null;
  lockPath?: string | null;
  wsUrlSuffix?: string | null;
  raw?: unknown;
};

export type LeaderStatus = {
  state: "stopped" | "running" | "error" | "unsupported" | string;
  socketPath: string;
  socketExists: boolean;
  socketAgeSecs?: number | null;
  pid?: number | null;
  version?: string | null;
  classification?: string | null;
  trackedPid?: number | null;
  cliFound: boolean;
  cliSupportsLeader: boolean;
  message?: string | null;
  leaders?: LeaderProcess[];
  serveHint?: string | null;
};

/** `grok leader info --json` DTO (soft-fail: unsupported/error without throw). */
export type LeaderInfo = {
  pid?: number | null;
  socketPath?: string | null;
  lockPath?: string | null;
  version?: string | null;
  protocolVersion?: string | null;
  classification?: string | null;
  uptimeMs?: number | null;
  activeToolCalls?: number | null;
  wsUrlSuffix?: string | null;
  unsupported?: boolean;
  error?: string | null;
  raw?: unknown;
};

export async function leaderStatus(): Promise<LeaderStatus> {
  return invoke<LeaderStatus>("leader_status");
}

export async function leaderStart(): Promise<LeaderStatus> {
  return invoke<LeaderStatus>("leader_start");
}

export async function leaderStop(): Promise<LeaderStatus> {
  return invoke<LeaderStatus>("leader_stop");
}

export async function leaderList(): Promise<{
  leaders: LeaderProcess[];
  error?: string;
}> {
  return invoke("leader_list");
}

/** Details for a leader (`grok leader info --json`); optional pid from list. Soft-fails. */
export async function leaderInfo(pid?: number | null): Promise<LeaderInfo> {
  return invoke<LeaderInfo>("leader_info", {
    pid: pid == null ? null : pid,
  });
}

/** Alias for stop-all (`grok leader kill`); soft-respawns when useLeader. */
export async function leaderKillAll(): Promise<{
  ok: boolean;
  state?: string;
  message?: string | null;
}> {
  return invoke("leader_kill_all");
}

// ── Agent serve (Runtime WebSocket server) ──────────────────────────────────

export type ServeStatus = {
  state: "stopped" | "running" | "error" | "unsupported" | string;
  bind: string;
  /** Optional proxy-mode upstream URL when started with `--remote`. */
  remote?: string | null;
  /** Masked secret (`••••` + last 4); never the full token. */
  secretMasked?: string | null;
  /** Last 4 chars of secret when known. */
  secretLast4?: string | null;
  /**
   * Full connection URL with secret — only present on `serve_start` response
   * (one-time copy). Status polls omit this.
   */
  connectionUrl?: string | null;
  /**
   * Full client CLI string (`grok --remote ws://…/ws --secret …`) — only on start.
   */
  connectionCli?: string | null;
  /** Masked CLI template for status polls (secret last-4 only). */
  connectionCliMasked?: string | null;
  pid?: number | null;
  trackedPid?: number | null;
  /** Local bind TCP probe only — does not check optional `--remote` upstream. */
  portOpen: boolean;
  cliFound: boolean;
  cliSupportsServe: boolean;
  /** CLI exposes `agent serve --remote` (proxy mode). */
  cliSupportsRemote?: boolean;
  message?: string | null;
};

export async function serveStatus(): Promise<ServeStatus> {
  return invoke<ServeStatus>("serve_status");
}

/**
 * Start serve; response may include one-time `connectionUrl` / `connectionCli`.
 * Optional `remote` → `grok agent serve --remote <URL>` (proxy mode).
 */
export async function serveStart(
  bind?: string | null,
  remote?: string | null,
): Promise<ServeStatus> {
  return invoke<ServeStatus>("serve_start", {
    bind: bind ?? null,
    remote: remote ?? null,
  });
}

export async function serveStop(): Promise<ServeStatus> {
  return invoke<ServeStatus>("serve_stop");
}

/**
 * TCP-only health probe for agent serve / remote bind (`host:port`, ~2s).
 * No secrets, no WebSocket handshake. Frontend must strip secrets from pasted URLs.
 */
export type ServeTcpProbeResult = {
  ok: boolean;
  latencyMs?: number | null;
  error?: string | null;
  /** Bare host:port that was probed. */
  target: string;
};

export async function serveTcpProbe(addr: string): Promise<ServeTcpProbeResult> {
  return invoke<ServeTcpProbeResult>("serve_tcp_probe", { addr });
}

/** Loopback session list + continue-by-id (#626 first slice). Token is never returned. */
export type SessionApiStatus = {
  listening: boolean;
  url: string | null;
  tokenFile: string;
};

export async function sessionApiStatus(): Promise<SessionApiStatus> {
  return invoke<SessionApiStatus>("session_api_status");
}

/** Reveal `session-api.json` (url + token, mode 0600) in the file manager. */
export async function sessionApiRevealTokenFile(): Promise<string> {
  return invoke<string>("session_api_reveal_token_file");
}


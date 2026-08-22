/** API domain: system */

import {
  invoke,
  isTauri,
  isDesktopHost,
} from "./host";

/** Paths that exist among candidates (desktop host path probe). */
export type PathExistsResult = {
  existing: string[];
};

export async function pathExistsMany(paths: string[]) {
  return invoke<PathExistsResult>("path_exists_many", { paths });
}

/** Installed font-family names (Settings → Appearance). Desktop host only. */
export async function listSystemFontFamilies() {
  if (!isDesktopHost()) return [] as string[];
  return invoke<string[]>("list_system_font_families");
}

/** Interactive PTY terminal (VS Code-style). Desktop-only. */
export type TerminalPtySpawnResult = {
  sessionId: string;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
};

export type TerminalPtyDataEvent = {
  sessionId: string;
  data: string;
};

export type TerminalPtyExitEvent = {
  sessionId: string;
  code: number | null;
};

export async function terminalPtySpawn(opts: {
  sessionId?: string | null;
  projectPath?: string | null;
  cols?: number;
  rows?: number;
}) {
  return invoke<TerminalPtySpawnResult>("terminal_pty_spawn", {
    sessionId: opts.sessionId ?? null,
    projectPath: opts.projectPath ?? null,
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
  });
}

export async function terminalPtyWrite(sessionId: string, data: string) {
  return invoke<void>("terminal_pty_write", { sessionId, data });
}

export async function terminalPtyResize(
  sessionId: string,
  cols: number,
  rows: number,
) {
  return invoke<void>("terminal_pty_resize", { sessionId, cols, rows });
}

export async function terminalPtyKill(sessionId: string) {
  return invoke<void>("terminal_pty_kill", { sessionId });
}

/**
 * Embedded side-browser automation (in-app Tauri Webview only).
 * Label scheme: `resource-browser` or `resource-browser-<tabId>`.
 *
 * Create via `sideBrowserCreate` (not frontend `new Webview`) so downloads
 * get a native save dialog through host `on_download`.
 */
export type SideBrowserInfo = {
  label: string;
  url?: string | null;
};

/** Host event `side-browser://download` payload. */
export type SideBrowserDownloadEvent = {
  phase: "requested" | "finished" | "cancelled" | string;
  label: string;
  url: string;
  path?: string | null;
  success?: boolean | null;
  fileName?: string | null;
};

/** Host event `side-browser://page-load` payload (loading bar UX). */
export type SideBrowserPageLoadEvent = {
  phase: "started" | "finished" | string;
  label: string;
  url: string;
};

export async function sideBrowserCreate(opts: {
  label: string;
  url: string;
  windowLabel: string;
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return invoke<void>("side_browser_create", {
    label: opts.label,
    url: opts.url,
    windowLabel: opts.windowLabel,
    x: opts.x,
    y: opts.y,
    width: opts.width,
    height: opts.height,
  });
}

export async function sideBrowserClose(label: string) {
  return invoke<void>("side_browser_close", { label });
}

export async function sideBrowserList() {
  return invoke<SideBrowserInfo[]>("side_browser_list");
}

export async function sideBrowserNavigate(label: string, url: string) {
  return invoke<void>("side_browser_navigate", { label, url });
}

export async function sideBrowserReload(label: string) {
  return invoke<void>("side_browser_reload", { label });
}

export async function sideBrowserUrl(label: string) {
  return invoke<string>("side_browser_url", { label });
}

export async function sideBrowserEval(label: string, script: string) {
  return invoke<string>("side_browser_eval", { label, script });
}

export async function sideBrowserSnapshot(label: string) {
  return invoke<string>("side_browser_snapshot", { label });
}

/** Re-inject blob-download polyfill into an embedded side browser (idempotent). */
export async function sideBrowserInstallDownloadHook(label: string) {
  return invoke<void>("side_browser_install_download_hook", { label });
}

export interface NetworkProbeTarget {
  key: string;
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
  millis: number;
}

/** Redacted effective proxy from Host `proxy::effective_snapshot`. */
export interface NetworkProbeEffective {
  decision?: string;
  source?: string;
  url?: string | null;
}

export interface NetworkProbeResult {
  allOk: boolean;
  targets: NetworkProbeTarget[];
  /** What proxy path Host actually used for this probe (credentials redacted). */
  effective?: NetworkProbeEffective;
}

/** Probe Grok endpoints through the effective proxy. */
export async function networkProbe() {
  return invoke<NetworkProbeResult>("network_probe");
}

/**
 * Headless probe for ACP-shaped NDJSON (`--output-format streaming-json`,
 * CLI ≥ 0.2.117). Soft-gated on the Host — older CLIs return supported=false.
 * Distinct from `streaming-messages-json`.
 */
export type StreamingAcpNdjsonProbeResult = {
  ok: boolean;
  supported: boolean | null;
  version: string | null;
  minVersion: string;
  binary: string | null;
  args: string[];
  usedStreamingJson: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error: string | null;
  durationMs: number;
};

export async function probeStreamingAcpNdjson(opts?: {
  prompt?: string;
  manualPath?: string;
  cwd?: string;
}): Promise<StreamingAcpNdjsonProbeResult> {
  return invoke<StreamingAcpNdjsonProbeResult>("probe_streaming_acp_ndjson", {
    prompt: opts?.prompt ?? null,
    manualPath: opts?.manualPath ?? null,
    cwd: opts?.cwd ?? null,
  });
}

export type CliProbeInfo = {
  found: boolean;
  path: string | null;
  version: string | null;
  source: string;
  cliAuthPresent?: boolean;
  candidatesTried?: string[];
  /** false ⇒ CLI older than minVersion; null/undefined ⇒ version unknown. */
  versionSupported?: boolean | null;
  /** Minimum grok CLI version this app requires (from the host). */
  minVersion?: string;
  /** Product recommended line (Grok Build 1.0+). Soft guidance only. */
  recommendedVersion?: string;
  /** true when version ≥ recommended; false when older; null when unknown. */
  meetsRecommended?: boolean | null;
  agentPath?: string | null;
  agentVersion?: string | null;
  /** grok vs sibling agent binary version mismatch. */
  agentBinarySkew?: boolean;
  /** Last live ACP initialize agentVersion (process cache). */
  acpAgentVersion?: string | null;
  /** probe `grok --version` vs live ACP agentVersion mismatch (soft warn). */
  acpAgentVersionSkew?: boolean;
};

export async function probeCli(manualPath?: string) {
  return invoke<CliProbeInfo>("probe_cli", { manualPath: manualPath ?? null });
}

/** Relink/copy `~/.grok/bin/agent` to match grok (install skew repair). */
export async function cliRepairAgentSidecar(grokPath?: string | null) {
  return invoke<{
    ok: boolean;
    agentPath?: string;
    agentBinarySkew?: boolean;
    agentVersion?: string | null;
    grokVersion?: string | null;
  }>("cli_repair_agent_sidecar", { grokPath: grokPath ?? null });
}

export interface AcpProbeResult {
  ok: boolean;
  agentVersion?: string | null;
  model?: string | null;
  error?: string | null;
}

/** API mode: TCP-connect to an ACP server and run the initialize handshake. */
export async function acpTestConnection(addr: string) {
  return invoke<AcpProbeResult>("acp_test_connection", { addr });
}

/** TCP-only ACP server health probe (~2s). No secrets / no RPC handshake. */
export interface AcpServerProbeResult {
  ok: boolean;
  latencyMs?: number | null;
  error?: string | null;
}

export async function acpServerProbe(addr: string) {
  return invoke<AcpServerProbeResult>("acp_server_probe", { addr });
}

/** WSL availability + distros + optional CLI probe (Settings → Runtime). */
export interface WslStatus {
  available: boolean;
  wslExe?: string | null;
  distros: string[];
  backendActive: boolean;
  probe?: CliProbeInfo | null;
  error?: string | null;
}

export async function wslStatus() {
  return invoke<WslStatus>("wsl_status");
}

export interface CliInstallProgress {
  phase: string;
  message: string;
  percent?: number | null;
  bytesDownloaded?: number | null;
  totalBytes?: number | null;
  mirror?: string | null;
  version?: string | null;
}

export interface CliInstallResult {
  ok: boolean;
  path: string | null;
  version: string | null;
  mirrorUsed: string | null;
  message: string;
  /** Streamed SHA-256 when Host computed it. */
  sha256?: string | null;
  /**
   * `true` = published sidecar matched; `false` = installed without sidecar
   * (HTTPS allowlist + binary probe). Mismatch never returns ok.
   */
  checksumVerified?: boolean | null;
}

export interface CliInstallCommands {
  primary: string;
  shell: string;
  docsUrl: string;
  mirrors: string[];
}

/**
 * Download + install latest Grok Build (multi-mirror).
 * Progress via setup://cli-install-progress.
 * When `allowUnverified` is omitted, Host uses Settings `allowUnverifiedCliInstall`.
 * Missing published checksums are allowed by default; pass `allowUnverified: true`
 * to override strict `GROK_CLI_REQUIRE_CHECKSUM` mode.
 */
export async function cliInstallLatest(opts?: {
  allowUnverified?: boolean | null;
}) {
  return invoke<CliInstallResult>("cli_install_latest", {
    allowUnverified: opts?.allowUnverified ?? null,
  });
}

export async function cliInstallCommands() {
  return invoke<CliInstallCommands>("cli_install_commands");
}

export async function pickCliBinary() {
  return invoke<string | null>("pick_cli_binary");
}

/** Native file picker for Settings → Agent profile path. */
export async function pickAgentProfile() {
  return invoke<string | null>("pick_agent_profile");
}

export async function openExternalUrl(url: string) {
  return invoke<void>("open_external_url", { url });
}

/** GitHub Releases check (Settings → About). Does not auto-install. */
export type AppUpdateCheck = {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseName: string | null;
  htmlUrl: string;
  publishedAt: string | null;
  body: string | null;
  assetNames: string[];
  /** Best-effort platform installer URL from the release assets. */
  downloadUrl: string | null;
  downloadName: string | null;
};

export async function appCheckUpdate() {
  return invoke<AppUpdateCheck>("app_check_update");
}

/** True when this install can apply Tauri in-app updates (Linux: AppImage only). */
export async function isAutoUpdateSupported() {
  return invoke<boolean>("is_auto_update_supported");
}

/** True when the binary was built with updater pubkey + endpoint (release CI). */
export async function isUpdaterPluginEnabled() {
  return invoke<boolean>("is_updater_plugin_enabled");
}

export type UpdaterStatus = {
  platformSupported: boolean;
  pluginEnabled: boolean;
  /** `silent` | `github_manual` */
  channel: string;
  endpoint: string;
};

/** About / Doctor: which update path this binary uses. */
export async function updaterStatus() {
  return invoke<UpdaterStatus>("updater_status");
}

/** Stop agents / mirror / voice / IM before install + relaunch. */
export async function prepareForAppUpdate() {
  return invoke<void>("prepare_for_app_update");
}

/** Rebuild system-tray / menu-bar menu (Recent list + Usage). */
export async function trayRefresh() {
  if (!isTauri()) return;
  return invoke<void>("tray_refresh");
}

/**
 * Show badge count on dock (macOS) or tray tooltip (elsewhere).
 * Product uses unread session count (post turn-end), not live busy.
 * Pass `0` to clear. Fail-closed outside Tauri / on host errors.
 * Does **not** drive the Windows taskbar overlay.
 */
export async function traySetBusyCount(count: number) {
  if (!isTauri()) return;
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  try {
    await invoke<void>("tray_set_busy_count", { count: n });
  } catch {
    /* fail-closed */
  }
}

/**
 * Windows taskbar *button* overlay for unread sessions (opt-in).
 * Independent of `traySetBusyCount`. Pass `0` to clear.
 * Fail-closed outside Tauri / on host errors / non-Windows (host no-op).
 */
export async function traySetWindowsOverlay(count: number) {
  if (!isTauri()) return;
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  try {
    await invoke<void>("tray_set_windows_overlay", { count: n });
  } catch {
    /* fail-closed */
  }
}

/**
 * Exit the desktop process immediately (after busy-quit confirm, or when none needed).
 * No-op outside Tauri / mirror clients.
 */
export async function appForceQuit() {
  if (!isDesktopHost()) return;
  try {
    await invoke<void>("app_force_quit");
  } catch {
    /* ignore — process may already be exiting */
  }
}

/**
 * Disarm the host pending-quit failsafe (user cancelled busy-quit confirm).
 * No-op outside Tauri / mirror clients.
 */
export async function appCancelPendingQuit() {
  if (!isDesktopHost()) return;
  try {
    await invoke<void>("app_cancel_pending_quit");
  } catch {
    /* ignore */
  }
}

/**
 * Open (or focus) a secondary webview window for a chat (`#/session/<id>`).
 * Desktop Tauri only. Secondary is live-capable (send/stop/warm-connect via
 * the shared Host session-keyed agent pool).
 */
export async function openSessionWindow(
  sessionId: string,
  title?: string | null,
): Promise<void> {
  if (!isDesktopHost()) {
    throw new Error("openSessionWindow requires desktop Tauri");
  }
  await invoke<void>("open_session_window", {
    sessionId,
    title: title ?? null,
  });
}

/**
 * Focus (and show/unminimize) the primary workbench window.
 * Desktop Tauri only — used from secondary session windows.
 */
export async function focusMainWindow(): Promise<void> {
  if (!isDesktopHost()) {
    throw new Error("focusMainWindow requires desktop Tauri");
  }
  await invoke<void>("focus_main_window");
}


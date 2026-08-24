/**
 * Phone-mirror reliability helpers (MIRROR-PRO).
 *
 * Honest host/client status + soft-fail classification for the Connect panel
 * and phone chrome. Pure — no I/O. Never surfaces tokens or full URLs that
 * may embed path tokens.
 *
 * Host honesty (src-tauri/src/mirror):
 * - Tunnel start soft-fail keeps the local loopback host up (phase `error`,
 *   running still true, publicUrl often loopback).
 * - `tunnel_dead`: local still running; cloudflared exited (no auto-restart).
 * - Never invent "live" without host phase `live`.
 */

import type { MirrorPhase, MirrorStatus } from "@/lib/api";

/** Soft-fail / error kinds for chips + actionable hints. */
export type MirrorErrorKind =
  | "cloudflared_missing"
  | "tunnel_timeout"
  | "tunnel_spawn"
  | "tunnel_not_registered"
  | "tunnel_dead"
  | "port_bind"
  | "desktop_only"
  | "ws_closed"
  | "ws_timeout"
  | "rpc_timeout"
  | "rpc_unsupported"
  | "not_connected"
  | "clients_full"
  | "other";

/** High-level host phase for the Connect status pill. */
export type MirrorHostConnectPhase =
  | "stopped"
  | "starting"
  | "waiting_tunnel"
  | "local"
  | "live"
  | "tunnel_dead"
  | "soft_local" // local host up after tunnel soft-fail
  | "error";

export type MirrorConnectTone = "ok" | "warn" | "err" | "muted";

export type MirrorHostConnectStatus = {
  phase: MirrorHostConnectPhase;
  tone: MirrorConnectTone;
  /** i18n key for the status badge (`mirror.phase.*` or soft variant). */
  labelKey: string;
  running: boolean;
  clients: number;
  maxClients: number | null;
  readOnly: boolean;
  /** Classified kind when a host/UI message is present. */
  errorKind: MirrorErrorKind | null;
  /**
   * Soft-fail: host still serving (usually loopback) after tunnel failure —
   * show diagnostic without claiming full outage / stopped.
   */
  showSoftLocal: boolean;
  /** True when an error/diagnostic string should be shown. */
  showDiagnostic: boolean;
  /**
   * Always false — documented honesty flag so UI never guesses public live
   * from a loopback URL alone.
   */
  inventLiveFromLoopback: false;
  /** Safe one-line diagnostic (tokens/URLs stripped). */
  safeMessage: string | null;
};

/** Phone client link phase (WS to host). */
export type MirrorClientLinkPhase =
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "token_missing";

export type MirrorClientLinkStatus = {
  phase: MirrorClientLinkPhase;
  tone: MirrorConnectTone;
  labelKey: string;
  errorKind: MirrorErrorKind | null;
  wsConnected: boolean;
};

// ── Sanitize ────────────────────────────────────────────────────────────────

/**
 * Strip control chars, path tokens, and absolute URLs so diagnostics never
 * leak the mirror secret. Cap length for UI.
 */
export function sanitizeMirrorDiagnostic(
  raw: string | null | undefined,
  max = 280,
): string | null {
  if (raw == null) return null;
  let s = String(raw).replace(/[\u0000-\u001f]/g, "").trim();
  if (!s) return null;
  // Redact path tokens: /t/<token>/…
  s = s.replace(/\/t\/[^/\s?#]+/gi, "/t/<redacted>");
  // Drop full URLs (public URL embeds token).
  s = s.replace(/https?:\/\/[^\s]+/gi, "[url]");
  // Long hex/base64-looking blobs that may be tokens.
  s = s.replace(/\b[a-f0-9]{24,}\b/gi, "<redacted>");
  s = s.replace(/\b[A-Za-z0-9_-]{40,}\b/g, "<redacted>");
  if (s.length > max) s = `${s.slice(0, max - 1)}…`;
  return s || null;
}

// ── Error classification ────────────────────────────────────────────────────

/**
 * Classify host / transport / RPC messages into stable kinds.
 * Pure string heuristics — never invents success.
 */
export function classifyMirrorError(
  message: string | null | undefined,
  opts?: {
    phase?: MirrorPhase | MirrorHostConnectPhase | null;
    source?: "host" | "start" | "stop" | "ws" | "rpc" | "status" | null;
  },
): MirrorErrorKind {
  if (opts?.phase === "tunnel_dead") return "tunnel_dead";

  const m = (message ?? "").toLowerCase();
  if (!m.trim()) {
    if (opts?.phase === "error") return "other";
    return "other";
  }

  if (
    m.includes("mirror host requires desktop") ||
    m.includes("desktop app") ||
    m.includes("desktop only")
  ) {
    return "desktop_only";
  }

  if (
    m.includes("cloudflared not found") ||
    (m.includes("cloudflared") && m.includes("not found")) ||
    m.includes("install cloudflared")
  ) {
    return "cloudflared_missing";
  }

  if (
    m.includes("did not become ready") ||
    m.includes("within 90s") ||
    (m.includes("cloudflared") && m.includes("timeout")) ||
    (m.includes("cloudflared") && m.includes("timed out"))
  ) {
    return "tunnel_timeout";
  }

  if (
    m.includes("registered tunnel connection") ||
    m.includes("never 'registered") ||
    m.includes("never \"registered") ||
    m.includes("printed url but never")
  ) {
    return "tunnel_not_registered";
  }

  if (
    m.includes("tunnel process exited") ||
    m.includes("cloudflared process exited") ||
    m.includes("tunnel dead")
  ) {
    return "tunnel_dead";
  }

  if (
    m.includes("failed to spawn cloudflared") ||
    m.includes("spawn cloudflared") ||
    m.includes("stdout missing") ||
    m.includes("stderr missing") ||
    m.includes("log pump closed")
  ) {
    return "tunnel_spawn";
  }

  if (
    m.includes("address already in use") ||
    m.includes("addrinuse") ||
    m.includes("eaddrinuse") ||
    (m.includes("port") && m.includes("in use")) ||
    (m.includes("bind") && (m.includes("fail") || m.includes("error")))
  ) {
    return "port_bind";
  }

  if (
    m.includes("503") ||
    m.includes("too many clients") ||
    m.includes("max clients") ||
    m.includes("client limit") ||
    m.includes("connection limit")
  ) {
    return "clients_full";
  }

  if (
    m.includes("unsupported") ||
    m.includes("not on the allowlist") ||
    m.startsWith("unsupported:")
  ) {
    return "rpc_unsupported";
  }

  if (m.includes("mirror rpc timeout") || m.includes("rpc timeout")) {
    return "rpc_timeout";
  }

  if (
    m.includes("connect timeout") ||
    m.includes("websocket connect timeout")
  ) {
    return "ws_timeout";
  }

  if (
    m.includes("websocket closed") ||
    m.includes("ws closed") ||
    m.includes("mirror websocket closed")
  ) {
    return "ws_closed";
  }

  if (
    m.includes("websocket not connected") ||
    m.includes("not connected") ||
    m.includes("mirror token missing") ||
    m.includes("token missing")
  ) {
    return "not_connected";
  }

  if (opts?.source === "ws") return "ws_closed";
  if (opts?.source === "rpc") return "rpc_timeout";

  // Generic cloudflared leftovers → spawn/tunnel bucket
  if (m.includes("cloudflared") || m.includes("tunnel")) {
    if (m.includes("exit")) return "tunnel_dead";
    return "tunnel_spawn";
  }

  return "other";
}

export function mirrorErrorKindLabelKey(kind: MirrorErrorKind): string {
  switch (kind) {
    case "cloudflared_missing":
      return "mirror.err.cloudflaredMissing";
    case "tunnel_timeout":
      return "mirror.err.tunnelTimeout";
    case "tunnel_spawn":
      return "mirror.err.tunnelSpawn";
    case "tunnel_not_registered":
      return "mirror.err.tunnelNotRegistered";
    case "tunnel_dead":
      return "mirror.err.tunnelDead";
    case "port_bind":
      return "mirror.err.portBind";
    case "desktop_only":
      return "mirror.err.desktopOnly";
    case "ws_closed":
      return "mirror.err.wsClosed";
    case "ws_timeout":
      return "mirror.err.wsTimeout";
    case "rpc_timeout":
      return "mirror.err.rpcTimeout";
    case "rpc_unsupported":
      return "mirror.err.rpcUnsupported";
    case "not_connected":
      return "mirror.err.notConnected";
    case "clients_full":
      return "mirror.err.clientsFull";
    default:
      return "mirror.err.other";
  }
}

/** Actionable soft-fail hint (i18n key). */
export function mirrorErrorKindHintKey(kind: MirrorErrorKind): string {
  switch (kind) {
    case "cloudflared_missing":
      return "mirror.hint.cloudflaredMissing";
    case "tunnel_timeout":
      return "mirror.hint.tunnelTimeout";
    case "tunnel_spawn":
      return "mirror.hint.tunnelSpawn";
    case "tunnel_not_registered":
      return "mirror.hint.tunnelNotRegistered";
    case "tunnel_dead":
      return "mirror.hint.tunnelDead";
    case "port_bind":
      return "mirror.hint.portBind";
    case "desktop_only":
      return "mirror.hint.desktopOnly";
    case "ws_closed":
      return "mirror.hint.wsClosed";
    case "ws_timeout":
      return "mirror.hint.wsTimeout";
    case "rpc_timeout":
      return "mirror.hint.rpcTimeout";
    case "rpc_unsupported":
      return "mirror.hint.rpcUnsupported";
    case "not_connected":
      return "mirror.hint.notConnected";
    case "clients_full":
      return "mirror.hint.clientsFull";
    default:
      return "mirror.hint.other";
  }
}

export function mirrorErrorKindTone(kind: MirrorErrorKind): MirrorConnectTone {
  switch (kind) {
    case "cloudflared_missing":
    case "port_bind":
    case "desktop_only":
    case "not_connected":
      return "err";
    case "tunnel_timeout":
    case "tunnel_spawn":
    case "tunnel_not_registered":
    case "tunnel_dead":
    case "ws_closed":
    case "ws_timeout":
    case "rpc_timeout":
    case "rpc_unsupported":
    case "clients_full":
      return "warn";
    default:
      return "warn";
  }
}

// ── Host connect status ─────────────────────────────────────────────────────

export type DeriveMirrorHostStatusInput = {
  phase?: MirrorPhase | null;
  running?: boolean | null;
  publicUrl?: string | null;
  localPort?: number | null;
  clients?: number | null;
  maxClients?: number | null;
  error?: string | null;
  /** UI-side error (start/stop/copy failures) in addition to host status.error. */
  uiError?: string | null;
  readOnly?: boolean | null;
};

/**
 * Derive an honest host status pill + soft-fail diagnostics from MirrorStatus.
 *
 * Does **not** invent live from a loopback URL. Tunnel soft-fail (host phase
 * `error` while still running) surfaces as `soft_local`.
 */
export function deriveMirrorHostStatus(
  input: DeriveMirrorHostStatusInput,
): MirrorHostConnectStatus {
  const hostPhase = (input.phase ?? "stopped") as MirrorPhase;
  const running = !!input.running;
  const clients =
    input.clients != null && Number.isFinite(input.clients)
      ? Math.max(0, Math.trunc(input.clients))
      : 0;
  const maxClients =
    input.maxClients != null && Number.isFinite(input.maxClients)
      ? Math.trunc(input.maxClients)
      : null;
  const readOnly = input.readOnly !== false;
  const rawMsg = (input.uiError || input.error || "").trim() || null;
  const safeMessage = sanitizeMirrorDiagnostic(rawMsg);
  const errorKind = rawMsg
    ? classifyMirrorError(rawMsg, { phase: hostPhase, source: "host" })
    : hostPhase === "tunnel_dead"
      ? ("tunnel_dead" as const)
      : null;

  const base = {
    running,
    clients,
    maxClients,
    readOnly,
    inventLiveFromLoopback: false as const,
    safeMessage,
  };

  // Clean stopped
  if (!running && (hostPhase === "stopped" || !hostPhase)) {
    return {
      ...base,
      phase: "stopped",
      tone: "muted",
      labelKey: "mirror.phase.stopped",
      errorKind: errorKind,
      showSoftLocal: false,
      showDiagnostic: !!safeMessage,
    };
  }

  if (hostPhase === "starting") {
    return {
      ...base,
      phase: "starting",
      tone: "muted",
      labelKey: "mirror.phase.starting",
      errorKind,
      showSoftLocal: false,
      showDiagnostic: !!safeMessage,
    };
  }

  if (hostPhase === "waiting_tunnel") {
    return {
      ...base,
      phase: "waiting_tunnel",
      tone: "muted",
      labelKey: "mirror.phase.waiting_tunnel",
      errorKind,
      showSoftLocal: false,
      showDiagnostic: !!safeMessage,
    };
  }

  if (hostPhase === "live") {
    // Honesty: only claim live when host says so (never from URL alone).
    return {
      ...base,
      phase: "live",
      tone: "ok",
      labelKey: "mirror.phase.live",
      errorKind: errorKind && errorKind !== "other" ? errorKind : null,
      showSoftLocal: false,
      showDiagnostic: !!safeMessage && errorKind != null && errorKind !== "other",
    };
  }

  if (hostPhase === "local") {
    // Intentional no-tunnel or local-only — not a soft-fail error.
    return {
      ...base,
      phase: "local",
      tone: running ? "ok" : "muted",
      labelKey: "mirror.phase.local",
      errorKind: errorKind && running ? errorKind : errorKind,
      showSoftLocal: false,
      showDiagnostic: !!safeMessage,
    };
  }

  if (hostPhase === "tunnel_dead") {
    return {
      ...base,
      phase: "tunnel_dead",
      tone: "warn",
      labelKey: "mirror.phase.tunnel_dead",
      errorKind: errorKind ?? "tunnel_dead",
      // Local host still up — soft continuity.
      showSoftLocal: running,
      showDiagnostic: true,
    };
  }

  // Host marks error: often soft-fail with local still running + loopback URL.
  if (hostPhase === "error") {
    // Tunnel start soft-fail keeps the HTTP server up (mod.rs) with a
    // loopback publicUrl so the panel can still copy a debug link.
    if (running && (input.publicUrl || input.localPort != null)) {
      return {
        ...base,
        phase: "soft_local",
        tone: "warn",
        labelKey: "mirror.phase.softLocal",
        errorKind: errorKind ?? "other",
        showSoftLocal: true,
        showDiagnostic: true,
      };
    }

    return {
      ...base,
      phase: "error",
      tone: "err",
      labelKey: "mirror.phase.error",
      errorKind: errorKind ?? "other",
      showSoftLocal: false,
      showDiagnostic: true,
    };
  }

  // Unknown phase — honest muted, never invent live.
  if (running) {
    return {
      ...base,
      phase: "local",
      tone: "warn",
      labelKey: "mirror.phase.local",
      errorKind,
      showSoftLocal: false,
      showDiagnostic: !!safeMessage,
    };
  }

  return {
    ...base,
    phase: "stopped",
    tone: "muted",
    labelKey: "mirror.phase.stopped",
    errorKind,
    showSoftLocal: false,
    showDiagnostic: !!safeMessage,
  };
}

/** CSS modifier class for the host phase pill. */
export function mirrorHostPhaseClass(tone: MirrorConnectTone): string {
  if (tone === "ok") return "mirror-connect__phase--ok";
  if (tone === "err") return "mirror-connect__phase--err";
  if (tone === "warn") return "mirror-connect__phase--warn";
  return "";
}

/** Map host connect phase → existing MirrorConnectLabels phase field name. */
export function mirrorHostPhaseLabelField(
  phase: MirrorHostConnectPhase,
):
  | "phaseStopped"
  | "phaseStarting"
  | "phaseLocal"
  | "phaseWaitingTunnel"
  | "phaseLive"
  | "phaseTunnelDead"
  | "phaseError"
  | "phaseSoftLocal" {
  switch (phase) {
    case "stopped":
      return "phaseStopped";
    case "starting":
      return "phaseStarting";
    case "local":
      return "phaseLocal";
    case "waiting_tunnel":
      return "phaseWaitingTunnel";
    case "live":
      return "phaseLive";
    case "tunnel_dead":
      return "phaseTunnelDead";
    case "soft_local":
      return "phaseSoftLocal";
    default:
      return "phaseError";
  }
}

/**
 * Prefer classified friendly copy over raw host errors when we have a
 * dedicated missing-cloudflared string; otherwise use sanitized message.
 */
export function mirrorDiagnosticDisplay(input: {
  errorKind: MirrorErrorKind | null;
  safeMessage: string | null;
  missingCloudflaredLabel: string;
  genericLabel: string;
}): string {
  if (input.errorKind === "cloudflared_missing") {
    return input.missingCloudflaredLabel;
  }
  if (input.safeMessage) return input.safeMessage;
  return input.genericLabel;
}

// ── Client link status ──────────────────────────────────────────────────────

export type DeriveMirrorClientLinkInput = {
  wsConnected: boolean;
  /** Path/boot token present. */
  hasToken?: boolean | null;
  /** Optional last transport error (never secrets). */
  lastError?: string | null;
  /**
   * When false and not connected, show disconnected instead of reconnecting
   * (transport intentionally closed). Default true (SPA auto-reconnects).
   */
  autoReconnect?: boolean | null;
};

/**
 * Honest phone-chrome link pill. Never claims connected without an open WS.
 */
export function deriveMirrorClientLinkStatus(
  input: DeriveMirrorClientLinkInput,
): MirrorClientLinkStatus {
  const hasToken = input.hasToken !== false;
  const errKind = input.lastError
    ? classifyMirrorError(input.lastError, { source: "ws" })
    : null;

  if (!hasToken) {
    return {
      phase: "token_missing",
      tone: "err",
      labelKey: "mirror.chrome.tokenMissing",
      errorKind: "not_connected",
      wsConnected: false,
    };
  }

  if (input.wsConnected) {
    return {
      phase: "connected",
      tone: "ok",
      labelKey: "mirror.chrome.connected",
      errorKind: null,
      wsConnected: true,
    };
  }

  const auto = input.autoReconnect !== false;
  if (auto) {
    return {
      phase: "reconnecting",
      tone: "warn",
      labelKey: "mirror.chrome.reconnecting",
      errorKind: errKind ?? "ws_closed",
      wsConnected: false,
    };
  }

  return {
    phase: "disconnected",
    tone: "err",
    labelKey: "mirror.chrome.disconnected",
    errorKind: errKind ?? "not_connected",
    wsConnected: false,
  };
}

/** Whether host status is usable for phone QR / link (live or intentional local). */
export function mirrorHostLinkReady(status: MirrorHostConnectStatus): boolean {
  return (
    status.running &&
    (status.phase === "live" || status.phase === "local") &&
    !status.showSoftLocal
  );
}

/** Soft-fail: panel should still allow copy of loopback URL when present. */
export function mirrorSoftFailKeepsHost(
  status: Pick<MirrorStatus, "running" | "phase" | "publicUrl" | "localPort">,
): boolean {
  if (!status.running) return false;
  if (status.phase === "tunnel_dead") return true;
  if (status.phase === "error") {
    return !!(status.publicUrl || status.localPort != null);
  }
  return false;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** True when the URL host is this computer only. */
export function isLoopbackMirrorUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname);
  } catch {
    return /https?:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/i.test(url);
  }
}

function isLocalOnlyPhase(phase: MirrorPhase | string | undefined): boolean {
  return (
    phase === "local" ||
    phase === "error" ||
    phase === "tunnel_dead" ||
    phase === "starting" ||
    phase === "waiting_tunnel"
  );
}

/**
 * URL to copy / QR. Local-only hosts prefer the LAN URL once opted in;
 * a live tunnel keeps the public URL as primary.
 */
export function mirrorCopyUrl(
  status: Pick<
    MirrorStatus,
    "running" | "phase" | "publicUrl" | "lanUrl" | "allowLan"
  >,
): string | null {
  if (!status.running) return null;
  if (
    status.allowLan &&
    status.lanUrl &&
    isLocalOnlyPhase(status.phase)
  ) {
    return status.lanUrl;
  }
  return status.publicUrl ?? status.lanUrl ?? null;
}

/** QR is for a phone, so never encode a loopback URL. */
export function shouldShowMirrorQr(
  status: Pick<
    MirrorStatus,
    "running" | "phase" | "publicUrl" | "lanUrl" | "allowLan"
  >,
  connect: Pick<MirrorHostConnectStatus, "phase" | "showSoftLocal">,
): boolean {
  const url = mirrorCopyUrl(status);
  if (!url || isLoopbackMirrorUrl(url)) return false;
  if (connect.phase === "live") return true;
  if (
    connect.phase === "local" ||
    connect.phase === "soft_local" ||
    connect.phase === "tunnel_dead" ||
    connect.showSoftLocal
  ) {
    return !!status.allowLan;
  }
  return false;
}

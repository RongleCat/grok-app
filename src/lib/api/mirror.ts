/** API domain: mirror */

import {
  invoke,
  isDesktopHost,
} from "./host";

// ── Remote mirror host (desktop only — DESIGN §4.2 / §11) ───────────────────

export type MirrorPhase =
  | "stopped"
  | "starting"
  | "local"
  | "waiting_tunnel"
  | "live"
  | "tunnel_dead"
  | "error";

export type MirrorStatus = {
  running: boolean;
  publicUrl: string | null;
  localPort: number | null;
  /**
   * Full token while host is running (QR / copy). Memory-only —
   * never persist to localStorage, audit logs, or support bundles.
   */
  token: string | null;
  /** Last 6 chars of token for safe display. */
  tokenTail?: string | null;
  clients: number;
  /** Concurrent WebSocket client cap (1–16, default 4). */
  maxClients?: number;
  phase: MirrorPhase;
  error: string | null;
  /** When true, phone cannot send / resolve permissions. Default true. */
  readOnly?: boolean;
  /**
   * When true, HTTP listens on all interfaces so phones on the same LAN
   * can connect. Default false (loopback only).
   */
  allowLan?: boolean;
  /** Token URL using the detected LAN IPv4. Null when LAN is off or undetected. */
  lanUrl?: string | null;
};

/** Desktop host status for Connect panel. Not available on phone mirror. */
export async function mirrorStatus(): Promise<MirrorStatus> {
  if (!isDesktopHost()) {
    return {
      running: false,
      publicUrl: null,
      localPort: null,
      token: null,
      tokenTail: null,
      clients: 0,
      maxClients: 4,
      phase: "stopped",
      error: null,
      readOnly: true,
      allowLan: false,
      lanUrl: null,
    };
  }
  return invoke<MirrorStatus>("mirror_status");
}

export async function mirrorStart(): Promise<MirrorStatus> {
  if (!isDesktopHost()) {
    throw new Error("mirror host requires desktop app");
  }
  return invoke<MirrorStatus>("mirror_start");
}

export async function mirrorStop(): Promise<MirrorStatus> {
  if (!isDesktopHost()) {
    throw new Error("mirror host requires desktop app");
  }
  return invoke<MirrorStatus>("mirror_stop");
}

export async function mirrorRotateToken(): Promise<MirrorStatus> {
  if (!isDesktopHost()) {
    throw new Error("mirror host requires desktop app");
  }
  return invoke<MirrorStatus>("mirror_rotate_token");
}

export async function mirrorSetReadOnly(readOnly: boolean): Promise<MirrorStatus> {
  if (!isDesktopHost()) {
    throw new Error("mirror host requires desktop app");
  }
  return invoke<MirrorStatus>("mirror_set_read_only", { readOnly });
}

/** Cap concurrent phone WebSocket clients (1–16). Host-only; no secrets. */
export async function mirrorSetMaxClients(
  maxClients: number,
): Promise<MirrorStatus> {
  if (!isDesktopHost()) {
    throw new Error("mirror host requires desktop app");
  }
  return invoke<MirrorStatus>("mirror_set_max_clients", { maxClients });
}

/** Bind all interfaces (true) or loopback only (false). Rebinds if the host is running. */
export async function mirrorSetAllowLan(allowLan: boolean): Promise<MirrorStatus> {
  if (!isDesktopHost()) {
    throw new Error("mirror host requires desktop app");
  }
  return invoke<MirrorStatus>("mirror_set_allow_lan", { allowLan });
}


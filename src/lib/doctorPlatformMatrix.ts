/**
 * Doctor platform capability matrix — pure honesty helpers.
 *
 * Surfaces macOS / Windows / Linux differences for:
 * path probe, sandbox kernel enforcement, window chrome, auto-update path,
 * and media loopback delivery. Complements Windows day-use checklist without
 * duplicating install/smoke steps.
 *
 * Never invents probe results: unknown inputs → `unknown` cells.
 * Status vocabulary: pass | warn | na | unknown.
 */

import type { MessageKey } from "@/i18n";
import type { AppPlatform } from "@/lib/appPlatform";
import {
  platformEnforcesOsSandbox,
  sandboxIsolationActive,
} from "@/lib/sandboxProfile";

/** Stable matrix row ids (column 0 / capability). */
export const DOCTOR_PLATFORM_MATRIX_ROW_IDS = [
  "platform",
  "cli_path_probe",
  "sandbox_enforcement",
  "window_chrome",
  "auto_update",
  "media_loopback",
] as const;

export type DoctorPlatformMatrixRowId =
  (typeof DOCTOR_PLATFORM_MATRIX_ROW_IDS)[number];

/** Cell status — no invented fail; use warn for soft-fail honesty. */
export type DoctorPlatformCellStatus = "pass" | "warn" | "na" | "unknown";

/**
 * Product update channel tokens accepted from Host / useUpdater.
 * Aligns with updater_status + app-update honesty (when present).
 */
export type DoctorUpdateChannel =
  | "silent"
  | "auto"
  | "github_manual"
  | "manual_github"
  | "manual"
  | "unsupported"
  | "host_only"
  | "unknown";

export type DoctorPlatformMatrixCell = {
  rowId: DoctorPlatformMatrixRowId;
  status: DoctorPlatformCellStatus;
  /** i18n key for the capability label (row name). */
  labelKey: MessageKey;
  /** i18n key for the detail / honesty message. */
  messageKey: MessageKey;
};

export type DoctorPlatformMatrix = {
  /** Normalized platform id used for all cells. */
  platform: AppPlatform;
  rows: DoctorPlatformMatrixCell[];
};

export type BuildDoctorPlatformMatrixInput = {
  /** App platform token (`mac` | `win` | `linux` | `other` / aliases). */
  platform?: string | null;
  /** Whether the Grok Build CLI path probe found a binary. */
  cliFound?: boolean | null;
  /** Effective sandbox profile (global or project-resolved). */
  sandboxProfile?: unknown;
  /**
   * App auto-update channel honesty (`silent` / `github_manual` / …).
   * Omit or `unknown` → do not invent silent install.
   */
  updateChannel?: string | null;
  /**
   * Optional live media loopback probe. Omit → platform-design honesty only
   * (do not invent that the server is up).
   */
  mediaLoopback?: boolean | null;
};

const ROW_LABEL_KEYS: Record<DoctorPlatformMatrixRowId, MessageKey> = {
  platform: "doctor.platformMatrix.row.platform",
  cli_path_probe: "doctor.platformMatrix.row.cliPathProbe",
  sandbox_enforcement: "doctor.platformMatrix.row.sandboxEnforcement",
  window_chrome: "doctor.platformMatrix.row.windowChrome",
  auto_update: "doctor.platformMatrix.row.autoUpdate",
  media_loopback: "doctor.platformMatrix.row.mediaLoopback",
};

/**
 * Normalize platform tokens to AppPlatform.
 * Accepts `mac` / `macos` / `darwin`, `win` / `windows`, `linux`, etc.
 */
export function normalizeDoctorPlatform(
  platform: string | null | undefined,
): AppPlatform {
  if (platform == null) return "other";
  const p = String(platform).trim().toLowerCase();
  if (!p) return "other";
  if (
    p === "mac" ||
    p === "macos" ||
    p === "darwin" ||
    p === "osx" ||
    p === "apple"
  ) {
    return "mac";
  }
  if (p === "win" || p === "windows" || p === "win32" || p === "win64") {
    return "win";
  }
  if (p === "linux" || p === "gnu/linux") {
    return "linux";
  }
  return "other";
}

/** Normalize host / hook update channel strings without inventing. */
export function normalizeDoctorUpdateChannel(
  raw: string | null | undefined,
): DoctorUpdateChannel {
  const t = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!t) return "unknown";
  if (t === "silent" || t === "auto") return "silent";
  if (t === "github_manual" || t === "manual_github" || t === "manual") {
    return "github_manual";
  }
  if (t === "unsupported") return "unsupported";
  if (t === "host_only" || t === "web") return "host_only";
  if (t === "unknown") return "unknown";
  return "unknown";
}

function cell(
  rowId: DoctorPlatformMatrixRowId,
  status: DoctorPlatformCellStatus,
  messageKey: MessageKey,
): DoctorPlatformMatrixCell {
  return {
    rowId,
    status,
    labelKey: ROW_LABEL_KEYS[rowId],
    messageKey,
  };
}

function platformRow(platform: AppPlatform): DoctorPlatformMatrixCell {
  switch (platform) {
    case "mac":
      return cell("platform", "pass", "doctor.platformMatrix.msg.platform.mac");
    case "win":
      return cell("platform", "pass", "doctor.platformMatrix.msg.platform.win");
    case "linux":
      return cell(
        "platform",
        "pass",
        "doctor.platformMatrix.msg.platform.linux",
      );
    case "other":
    default:
      return cell(
        "platform",
        "unknown",
        "doctor.platformMatrix.msg.platform.unknown",
      );
  }
}

function cliPathProbeRow(
  cliFound: boolean | null | undefined,
): DoctorPlatformMatrixCell {
  if (cliFound === true) {
    return cell(
      "cli_path_probe",
      "pass",
      "doctor.platformMatrix.msg.cli.found",
    );
  }
  if (cliFound === false) {
    return cell(
      "cli_path_probe",
      "warn",
      "doctor.platformMatrix.msg.cli.missing",
    );
  }
  return cell(
    "cli_path_probe",
    "unknown",
    "doctor.platformMatrix.msg.cli.unknown",
  );
}

/**
 * Sandbox kernel honesty from CLI docs:
 * - mac: Seatbelt enforcement when isolation requested
 * - linux: Landlock enforcement when isolation requested
 * - win / other: soft-fail (flag may be accepted, no kernel enforcement)
 * - off / not requested: N/A
 */
function sandboxEnforcementRow(
  platform: AppPlatform,
  sandboxProfile: unknown,
): DoctorPlatformMatrixCell {
  if (!sandboxIsolationActive(sandboxProfile)) {
    return cell(
      "sandbox_enforcement",
      "na",
      "doctor.platformMatrix.msg.sandbox.off",
    );
  }

  if (platform === "other") {
    return cell(
      "sandbox_enforcement",
      "unknown",
      "doctor.platformMatrix.msg.sandbox.unknown",
    );
  }

  if (platform === "mac") {
    return cell(
      "sandbox_enforcement",
      "pass",
      "doctor.platformMatrix.msg.sandbox.macSeatbelt",
    );
  }
  if (platform === "linux") {
    return cell(
      "sandbox_enforcement",
      "pass",
      "doctor.platformMatrix.msg.sandbox.linuxLandlock",
    );
  }
  // Windows (and any non-enforcing known platform)
  if (!platformEnforcesOsSandbox(platform)) {
    return cell(
      "sandbox_enforcement",
      "warn",
      "doctor.platformMatrix.msg.sandbox.winSoftFail",
    );
  }
  return cell(
    "sandbox_enforcement",
    "warn",
    "doctor.platformMatrix.msg.sandbox.platformSoft",
  );
}

/**
 * Window chrome from packaging configs:
 * - mac: Overlay title bar + traffic lights
 * - win: frameless custom chrome
 * - linux: frameless custom chrome (tauri.linux.conf)
 */
function windowChromeRow(platform: AppPlatform): DoctorPlatformMatrixCell {
  switch (platform) {
    case "mac":
      return cell(
        "window_chrome",
        "pass",
        "doctor.platformMatrix.msg.chrome.macOverlay",
      );
    case "win":
      return cell(
        "window_chrome",
        "pass",
        "doctor.platformMatrix.msg.chrome.winFrameless",
      );
    case "linux":
      return cell(
        "window_chrome",
        "pass",
        "doctor.platformMatrix.msg.chrome.linuxFrameless",
      );
    case "other":
    default:
      return cell(
        "window_chrome",
        "unknown",
        "doctor.platformMatrix.msg.chrome.unknown",
      );
  }
}

/**
 * Auto-update path honesty — echoes Host channel, never invents silent install.
 */
function autoUpdateRow(
  channelRaw: string | null | undefined,
): DoctorPlatformMatrixCell {
  const channel = normalizeDoctorUpdateChannel(channelRaw);
  switch (channel) {
    case "silent":
    case "auto":
      return cell(
        "auto_update",
        "pass",
        "doctor.platformMatrix.msg.update.silent",
      );
    case "github_manual":
    case "manual_github":
    case "manual":
      return cell(
        "auto_update",
        "warn",
        "doctor.platformMatrix.msg.update.manual",
      );
    case "unsupported":
      return cell(
        "auto_update",
        "warn",
        "doctor.platformMatrix.msg.update.unsupported",
      );
    case "host_only":
      return cell(
        "auto_update",
        "na",
        "doctor.platformMatrix.msg.update.hostOnly",
      );
    case "unknown":
    default:
      return cell(
        "auto_update",
        "unknown",
        "doctor.platformMatrix.msg.update.unknown",
      );
  }
}

/**
 * Media delivery: loopback HTTP is the product path on all desktop OSes.
 * Optional live probe: true → pass, false → warn; omit → design honesty (pass
 * on known desktop, unknown on other) without inventing server uptime.
 */
function mediaLoopbackRow(
  platform: AppPlatform,
  mediaLoopback: boolean | null | undefined,
): DoctorPlatformMatrixCell {
  if (mediaLoopback === true) {
    return cell(
      "media_loopback",
      "pass",
      "doctor.platformMatrix.msg.media.loopback",
    );
  }
  if (mediaLoopback === false) {
    return cell(
      "media_loopback",
      "warn",
      "doctor.platformMatrix.msg.media.unavailable",
    );
  }
  // No live probe — platform design honesty only.
  if (platform === "mac" || platform === "win" || platform === "linux") {
    return cell(
      "media_loopback",
      "pass",
      "doctor.platformMatrix.msg.media.loopback",
    );
  }
  return cell(
    "media_loopback",
    "unknown",
    "doctor.platformMatrix.msg.media.unknown",
  );
}

/**
 * Build the Doctor platform capability matrix from known inputs only.
 * Pure — no I/O, no invented probe results.
 */
export function buildDoctorPlatformMatrix(
  input: BuildDoctorPlatformMatrixInput,
): DoctorPlatformMatrix {
  const platform = normalizeDoctorPlatform(input.platform);
  const rows: DoctorPlatformMatrixCell[] = [
    platformRow(platform),
    cliPathProbeRow(input.cliFound),
    sandboxEnforcementRow(platform, input.sandboxProfile),
    windowChromeRow(platform),
    autoUpdateRow(input.updateChannel),
    mediaLoopbackRow(platform, input.mediaLoopback),
  ];
  return { platform, rows };
}

/** i18n key for a cell status badge. */
export function doctorPlatformCellStatusKey(
  status: DoctorPlatformCellStatus,
): MessageKey {
  switch (status) {
    case "pass":
      return "doctor.platformMatrix.status.pass";
    case "warn":
      return "doctor.platformMatrix.status.warn";
    case "na":
      return "doctor.platformMatrix.status.na";
    case "unknown":
      return "doctor.platformMatrix.status.unknown";
  }
}

/**
 * Map matrix status → Doctor check level class (ok / warn / muted).
 * `na` and `unknown` use distinct modifiers for UI honesty.
 */
export function doctorPlatformCellTone(
  status: DoctorPlatformCellStatus,
): "ok" | "warn" | "na" | "unknown" {
  if (status === "pass") return "ok";
  if (status === "warn") return "warn";
  if (status === "na") return "na";
  return "unknown";
}

/** Count cells by status (for summary chips). */
export function countDoctorPlatformMatrix(
  matrix: DoctorPlatformMatrix | null | undefined,
): {
  pass: number;
  warn: number;
  na: number;
  unknown: number;
  total: number;
} {
  const rows = matrix?.rows ?? [];
  let pass = 0;
  let warn = 0;
  let na = 0;
  let unknown = 0;
  for (const r of rows) {
    if (r.status === "pass") pass += 1;
    else if (r.status === "warn") warn += 1;
    else if (r.status === "na") na += 1;
    else unknown += 1;
  }
  return { pass, warn, na, unknown, total: rows.length };
}

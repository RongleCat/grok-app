/**
 * App auto-update path honesty (Top30 #26).
 *
 * Pure helpers that map the signed in-app updater vs GitHub manual download
 * fallback into product status copy — no invented versions, no I/O.
 *
 * Channel truth:
 * - **auto** — signed release + plugin + platform supports silent install
 * - **manual_github** — unsigned / local / plugin off → open release page
 * - **unsupported** — plugin present but this install type cannot auto-update
 *   (e.g. Linux .deb/.rpm; Linux AppImage is supported)
 * - **host_only** — not running in the desktop app host
 *
 * P0: agents / voice / IM / mirror stop only after successful `install()`
 * prepare — never claim they stop earlier.
 */

/** Mirrors `UpdateStatus` from `useUpdater` without importing the hook. */
export type AppUpdateStatusState =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "installing"
  | "ready"
  | "restarting"
  | "error"
  | "manual-required";

export type AppUpdateStatusLike = {
  state: AppUpdateStatusState;
  /** Only when known from check/download — never invent. */
  version?: string;
  message?: string;
  releaseUrl?: string;
  downloadUrl?: string | null;
  assetNames?: string[];
};

/** Product update path for About / Settings banners. */
export type UpdateChannelHonesty =
  | "auto"
  | "manual_github"
  | "unsupported"
  | "host_only";

export type UpdateHonestySeverity =
  | "none"
  | "info"
  | "success"
  | "warn"
  | "error";

/** Soft-fail classes for update errors (string match on host messages). */
export type UpdateErrorKind =
  | "network"
  | "signature"
  | "plugin_missing"
  | "not_ready"
  | "host_only"
  | "other";

/** i18n title keys for status banners (en/zh/zh-TW under same id). */
export type UpdateStatusTitleKey =
  | "settings.autoUpdateChecking"
  | "settings.autoUpdateUpToDate"
  | "settings.checkUpdateLatest"
  | "settings.autoUpdateAvailable"
  | "settings.autoUpdateDownloading"
  | "settings.autoUpdateReady"
  | "settings.autoUpdateInstalling"
  | "settings.autoUpdateRestarting"
  | "settings.autoUpdateManualRequired"
  | "settings.autoUpdateError"
  | "settings.autoUpdateIdle";

/** Optional body / note under the title. */
export type UpdateStatusBodyKey =
  | "settings.autoUpdateBody.checking"
  | "settings.autoUpdateBody.downloading"
  | "settings.autoUpdateBody.installing"
  | "settings.autoUpdateBody.restarting"
  | "settings.autoUpdateBody.ready"
  | "settings.autoUpdateBody.manual"
  | "settings.autoUpdateBody.agentsNote"
  | "settings.autoUpdateBody.linuxAppImage"
  | "settings.autoUpdateError.network"
  | "settings.autoUpdateError.signature"
  | "settings.autoUpdateError.pluginMissing"
  | "settings.autoUpdateError.notReady"
  | "settings.autoUpdateError.hostOnly"
  | "settings.autoUpdateError.other";

export type UpdateChannelLabelKey =
  | "settings.autoUpdateChannelSilent"
  | "settings.autoUpdateChannelManual"
  | "settings.autoUpdateChannelUnsupported"
  | "settings.autoUpdateChannelHostOnly";

export type UpdateStatusCopy = {
  titleKey: UpdateStatusTitleKey | null;
  bodyKey: UpdateStatusBodyKey | null;
  severity: UpdateHonestySeverity;
  /**
   * Version string from status when present — never invented.
   * Callers interpolate `{version}` only when this is set.
   */
  version: string | null;
  /** For error state: classified soft-fail kind. */
  errorKind: UpdateErrorKind | null;
  /** Raw error message when state is error (for fallback interpolate). */
  errorMessage: string | null;
};

export type ResolveUpdateChannelInput = {
  pluginEnabled: boolean;
  autoUpdateSupported: boolean;
  /** When false / omitted for non-desktop, channel is host_only. */
  isDesktopHost?: boolean;
  /**
   * Optional live status. `manual-required` forces manual_github / unsupported
   * honesty even if channel flags look auto-capable.
   */
  status?: AppUpdateStatusLike | null;
};

/**
 * Resolve product update channel honesty from host capability flags.
 *
 * Priority: not desktop → host_only; plugin off → manual_github;
 * plugin on + not platform-supported → unsupported; else auto.
 * Live `manual-required` never claims auto.
 */
export function resolveUpdateChannelHonesty(
  input: ResolveUpdateChannelInput,
): UpdateChannelHonesty {
  if (input.isDesktopHost === false) {
    return "host_only";
  }

  const state = input.status?.state;
  if (state === "manual-required") {
    // Plugin may still be on (e.g. Linux non-AppImage) — prefer unsupported
    // when the platform gate failed; otherwise GitHub manual.
    if (input.pluginEnabled && !input.autoUpdateSupported) {
      return "unsupported";
    }
    return "manual_github";
  }

  if (!input.pluginEnabled) {
    return "manual_github";
  }
  if (!input.autoUpdateSupported) {
    return "unsupported";
  }
  return "auto";
}

/** Channel label i18n key for the About hint line. */
export function updateChannelLabelKey(
  channel: UpdateChannelHonesty,
): UpdateChannelLabelKey {
  switch (channel) {
    case "auto":
      return "settings.autoUpdateChannelSilent";
    case "manual_github":
      return "settings.autoUpdateChannelManual";
    case "unsupported":
      return "settings.autoUpdateChannelUnsupported";
    case "host_only":
      return "settings.autoUpdateChannelHostOnly";
  }
}

/**
 * Map a status machine state to title/body keys + severity.
 * Never invents a version — only echoes `status.version` when present.
 */
export function mapUpdateStatusCopy(
  status: AppUpdateStatusLike,
): UpdateStatusCopy {
  const version =
    typeof status.version === "string" && status.version.trim()
      ? status.version.trim()
      : null;

  switch (status.state) {
    case "idle":
      return {
        titleKey: "settings.autoUpdateIdle",
        bodyKey: null,
        severity: "none",
        version: null,
        errorKind: null,
        errorMessage: null,
      };
    case "checking":
      return {
        titleKey: "settings.autoUpdateChecking",
        bodyKey: "settings.autoUpdateBody.checking",
        severity: "info",
        version: null,
        errorKind: null,
        errorMessage: null,
      };
    case "up-to-date":
      return {
        titleKey: version
          ? "settings.checkUpdateLatest"
          : "settings.autoUpdateUpToDate",
        bodyKey: null,
        severity: "success",
        version,
        errorKind: null,
        errorMessage: null,
      };
    case "available":
      return {
        titleKey: "settings.autoUpdateAvailable",
        bodyKey: "settings.autoUpdateBody.agentsNote",
        severity: "info",
        version,
        errorKind: null,
        errorMessage: null,
      };
    case "downloading":
      return {
        titleKey: "settings.autoUpdateDownloading",
        bodyKey: "settings.autoUpdateBody.downloading",
        severity: "info",
        version,
        errorKind: null,
        errorMessage: null,
      };
    case "ready":
      return {
        titleKey: "settings.autoUpdateReady",
        bodyKey: "settings.autoUpdateBody.ready",
        severity: "warn",
        version,
        errorKind: null,
        errorMessage: null,
      };
    case "installing":
      return {
        titleKey: "settings.autoUpdateInstalling",
        bodyKey: "settings.autoUpdateBody.installing",
        severity: "info",
        version,
        errorKind: null,
        errorMessage: null,
      };
    case "restarting":
      return {
        titleKey: "settings.autoUpdateRestarting",
        bodyKey: "settings.autoUpdateBody.restarting",
        severity: "info",
        version,
        errorKind: null,
        errorMessage: null,
      };
    case "manual-required":
      return {
        titleKey: "settings.autoUpdateManualRequired",
        bodyKey: "settings.autoUpdateBody.manual",
        severity: "warn",
        version,
        errorKind: null,
        errorMessage: null,
      };
    case "error": {
      const errorMessage =
        typeof status.message === "string" && status.message.trim()
          ? status.message.trim()
          : null;
      const errorKind = classifyUpdateError(errorMessage);
      return {
        titleKey: "settings.autoUpdateError",
        bodyKey: updateErrorBodyKey(errorKind),
        severity: "error",
        version: null,
        errorKind,
        errorMessage,
      };
    }
    default:
      return {
        titleKey: null,
        bodyKey: null,
        severity: "none",
        version: null,
        errorKind: null,
        errorMessage: null,
      };
  }
}

/**
 * One-line progress label for the status strip.
 * Returns null when idle / nothing to show; never invents versions.
 */
export function formatUpdateProgressLine(
  status: AppUpdateStatusLike,
): {
  titleKey: UpdateStatusTitleKey;
  version: string | null;
  severity: UpdateHonestySeverity;
} | null {
  const copy = mapUpdateStatusCopy(status);
  if (!copy.titleKey || status.state === "idle") return null;
  if (status.state === "error") {
    return {
      titleKey: copy.titleKey,
      version: null,
      severity: copy.severity,
    };
  }
  return {
    titleKey: copy.titleKey,
    version: copy.version,
    severity: copy.severity,
  };
}

/**
 * True while download or install is in flight (busy progress chrome).
 * `available` is not install progress (auto-download may start next).
 */
export function shouldShowInstallProgress(
  status: AppUpdateStatusLike | { state: string } | null | undefined,
): boolean {
  const state = status?.state;
  return (
    state === "downloading" ||
    state === "installing" ||
    state === "restarting"
  );
}

/** Whether check / install buttons should be disabled (in-flight). */
export function isUpdateActionBusy(
  status: AppUpdateStatusLike | { state: string } | null | undefined,
): boolean {
  const state = status?.state;
  return (
    state === "checking" ||
    state === "downloading" ||
    state === "installing" ||
    state === "restarting"
  );
}

/** Whether the Install-and-restart CTA should show (download finished). */
export function shouldShowInstallButton(
  status: AppUpdateStatusLike | { state: string } | null | undefined,
): boolean {
  return status?.state === "ready";
}

/** Manual GitHub path CTAs (open release / download asset). */
export function shouldShowManualDownloadCtas(
  status: AppUpdateStatusLike | { state: string } | null | undefined,
): boolean {
  return status?.state === "manual-required";
}

/**
 * Sidebar brand-row update affordance: show when a newer build is known or
 * an in-app update is in flight (not while idle / up-to-date / error).
 */
export function isUpdateAffordanceVisible(
  status: AppUpdateStatusLike | { state: string } | null | undefined,
): boolean {
  const state = status?.state;
  return (
    state === "available" ||
    state === "downloading" ||
    state === "ready" ||
    state === "installing" ||
    state === "restarting" ||
    state === "manual-required"
  );
}

/**
 * Classify soft-fail update errors from host / plugin message text.
 * Prefer structured paths in the hook when available; this is last-resort.
 */
export function classifyUpdateError(
  message: string | null | undefined,
): UpdateErrorKind {
  const m = String(message ?? "")
    .trim()
    .toLowerCase();
  if (!m) return "other";

  if (
    m.includes("only available in the desktop") ||
    m.includes("desktop app") ||
    m.includes("not a desktop")
  ) {
    return "host_only";
  }

  if (
    m.includes("plugin updater not found") ||
    m.includes("plugin not found") ||
    m.includes("command updater") ||
    m.includes('command "check" not found') ||
    m.includes("not initialized") ||
    m.includes("updater unavailable")
  ) {
    return "plugin_missing";
  }

  if (
    m.includes("signature") ||
    m.includes("minisign") ||
    m.includes("invalid pubkey") ||
    m.includes("public key") ||
    m.includes("verification failed") ||
    m.includes("checksum")
  ) {
    return "signature";
  }

  if (
    m.includes("not ready to install") ||
    m.includes("update is not ready")
  ) {
    return "not_ready";
  }

  if (
    m.includes("network") ||
    m.includes("timeout") ||
    m.includes("timed out") ||
    m.includes("connection") ||
    m.includes("connect") ||
    m.includes("dns") ||
    m.includes("econn") ||
    m.includes("enotfound") ||
    m.includes("fetch failed") ||
    m.includes("failed to fetch") ||
    m.includes("http 4") ||
    m.includes("http 5") ||
    m.includes("status code") ||
    m.includes("offline")
  ) {
    return "network";
  }

  return "other";
}

/** Body key for a classified update error. */
export function updateErrorBodyKey(
  kind: UpdateErrorKind,
): UpdateStatusBodyKey {
  switch (kind) {
    case "network":
      return "settings.autoUpdateError.network";
    case "signature":
      return "settings.autoUpdateError.signature";
    case "plugin_missing":
      return "settings.autoUpdateError.pluginMissing";
    case "not_ready":
      return "settings.autoUpdateError.notReady";
    case "host_only":
      return "settings.autoUpdateError.hostOnly";
    case "other":
      return "settings.autoUpdateError.other";
  }
}

/**
 * Resolve release / asset URLs for manual CTAs without inventing versions.
 * Prefers status fields; falls back to a known GitHub releases URL only.
 */
export function resolveManualUpdateUrls(
  status: AppUpdateStatusLike,
  fallbackReleaseUrl: string,
): {
  releaseUrl: string;
  downloadUrl: string | null;
  assetNames: string[];
} {
  const releaseUrl =
    typeof status.releaseUrl === "string" && status.releaseUrl.trim()
      ? status.releaseUrl.trim()
      : fallbackReleaseUrl;
  const downloadUrl =
    typeof status.downloadUrl === "string" && status.downloadUrl.trim()
      ? status.downloadUrl.trim()
      : null;
  const assetNames = Array.isArray(status.assetNames)
    ? status.assetNames.filter(
        (n): n is string => typeof n === "string" && n.trim().length > 0,
      )
    : [];
  return { releaseUrl, downloadUrl, assetNames };
}

/**
 * Map host `updater_status.channel` string to honesty without inventing.
 * Unknown → null (caller keeps capability-based resolve).
 */
export function channelFromHostString(
  raw: string | null | undefined,
): UpdateChannelHonesty | null {
  const t = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (t === "silent" || t === "auto") return "auto";
  if (t === "github_manual" || t === "manual" || t === "manual_github") {
    return "manual_github";
  }
  if (t === "unsupported") return "unsupported";
  if (t === "host_only" || t === "web") return "host_only";
  return null;
}

/**
 * Prefer capability resolve for non-auto paths so unsigned / unsupported never
 * claim silent install. Host channel is only a hint when capability says auto
 * (or is unknown); a safer non-auto host report still wins over "auto".
 * Live `manual-required` still forces non-auto honesty.
 */
export function resolveUpdateChannelHonestyPreferHost(input: {
  hostChannel?: string | null;
  pluginEnabled: boolean;
  autoUpdateSupported: boolean;
  isDesktopHost?: boolean;
  status?: AppUpdateStatusLike | null;
}): UpdateChannelHonesty {
  const fromStatus = resolveUpdateChannelHonesty({
    pluginEnabled: input.pluginEnabled,
    autoUpdateSupported: input.autoUpdateSupported,
    isDesktopHost: input.isDesktopHost,
    status: input.status,
  });

  // Live manual path and host_only always win.
  if (
    input.status?.state === "manual-required" ||
    fromStatus === "host_only"
  ) {
    return fromStatus;
  }

  // Capability-backed manual / unsupported is authoritative — never let a stale
  // host "silent" claim override unsigned or package-type limits.
  if (fromStatus !== "auto") {
    return fromStatus;
  }

  const fromHost = channelFromHostString(input.hostChannel);
  // Safer honesty: if host says non-auto while capability looks auto, prefer host.
  if (fromHost && fromHost !== "auto") {
    return fromHost;
  }
  return fromStatus;
}

/**
 * Extra channel body for package-type limits (Linux AppImage-only, etc.).
 * Null when no extra note — never invents a silent-install claim.
 */
export function channelExtraBodyKey(
  channel: UpdateChannelHonesty,
): UpdateStatusBodyKey | null {
  if (channel === "unsupported") {
    return "settings.autoUpdateBody.linuxAppImage";
  }
  return null;
}

/** CSS modifier for About status strip (`is-available` / `is-error` / …). */
export function updateStatusToneClass(
  severity: UpdateHonestySeverity,
): string {
  switch (severity) {
    case "error":
      return "is-error";
    case "warn":
      return "is-available";
    case "info":
      return "is-available";
    case "success":
      return "";
    case "none":
    default:
      return "";
  }
}

/**
 * Whether the auto path may download/install (for honest notes).
 * Manual / unsupported / host-only never claim silent install.
 */
export function isAutoUpdatePath(channel: UpdateChannelHonesty): boolean {
  return channel === "auto";
}

/**
 * Who initiated the updater action.
 * - `check` — Settings → About “Check for updates” (download only)
 * - `apply` — confirmed sidebar / Install and restart
 * - `background` — startup / periodic discovery (download only)
 */
export type UpdateInstallIntent = "check" | "apply" | "background";

/**
 * Whether reaching `ready` should immediately install+relaunch.
 * Only a confirmed apply does that. About check and background discovery stop
 * at `ready` so Install and restart can be confirmed.
 */
export function shouldInstallWhenReady(intent: UpdateInstallIntent): boolean {
  return intent === "apply";
}

/**
 * Signed in-app path: confirm before install+relaunch.
 * Manual GitHub (open URL) does not use this.
 */
export function needsInstallAndRestartConfirm(
  status: AppUpdateStatusLike | { state: string } | null | undefined,
): boolean {
  const state = status?.state;
  return (
    state === "ready" ||
    state === "available" ||
    state === "downloading"
  );
}

/** About “Check for updates”: never auto-install; may download to `ready`. */
export type UserCheckUpdatePlan =
  | { action: "noop" }
  | { action: "download"; version: string }
  | { action: "runCheck" };

export function planUserCheckUpdate(status: {
  state: string;
  version?: string;
}): UserCheckUpdatePlan {
  switch (status.state) {
    case "installing":
    case "restarting":
    case "ready":
    case "downloading":
      return { action: "noop" };
    case "available": {
      const version =
        typeof status.version === "string" && status.version.trim()
          ? status.version.trim()
          : "";
      if (version) return { action: "download", version };
      return { action: "runCheck" };
    }
    default:
      return { action: "runCheck" };
  }
}

export type UpdateInstallConfirmCopyKeys = {
  titleKey: "settings.autoUpdateConfirm.title";
  messageKey: "settings.autoUpdateConfirm.message";
  confirmKey: "settings.autoUpdateConfirm.confirm";
  cancelKey: "settings.autoUpdateConfirm.cancel";
};

export function updateInstallConfirmCopyKeys(): UpdateInstallConfirmCopyKeys {
  return {
    titleKey: "settings.autoUpdateConfirm.title",
    messageKey: "settings.autoUpdateConfirm.message",
    confirmKey: "settings.autoUpdateConfirm.confirm",
    cancelKey: "settings.autoUpdateConfirm.cancel",
  };
}

/**
 * Matrix pure config helpers — no I/O.
 *
 * Spec §6.12: /sync long poll only (no public URL). Validation covers
 * homeserver URL shape, access_token presence/soft shape, optional MXID,
 * optional proxy, and boolean option posture.
 * Soft status never claims live /sync — only credential shape.
 */

/** Product transport: long poll only (/sync; no webhook / public URL). */
export type MatrixTransport = "long_poll";

export type MatrixConfigValidation = {
  ok: boolean;
  /** Missing / invalid option / secret keys (never values) */
  missing: string[];
  /** Issues that do not block vault reuse but should warn in health */
  warnings: string[];
  transport: MatrixTransport;
  /** True when options.proxy is non-empty and parseable */
  proxySet: boolean;
  /** Detected proxy scheme when proxySet, else null */
  proxyScheme: "http" | "https" | "socks5" | "socks5h" | null;
  /** Normalized homeserver base (no trailing slash) when valid, else empty */
  homeserver: string;
  /** auto_join flag (default true) */
  autoJoin: boolean;
  /** auto_verify flag (default true) */
  autoVerify: boolean;
  /** group_reply_all flag (default false) */
  groupReplyAll: boolean;
  /** share_session_in_channel flag (default false) */
  shareSessionInChannel: boolean;
  /**
   * Soft status code for UI / host test mapping.
   * Never claims live /sync success.
   */
  softStatus:
    | "ready_long_poll"
    | "missing_credentials"
    | "missing_homeserver"
    | "missing_access_token"
    | "invalid_homeserver"
    | "invalid_access_token_format"
    | "invalid_user_id"
    | "invalid_proxy"
    | "incomplete";
};

function optionString(
  options: Record<string, unknown> | null | undefined,
  key: string,
): string {
  if (!options) return "";
  const v = options[key];
  if (v == null) return "";
  return String(v).trim();
}

function optionBool(
  options: Record<string, unknown> | null | undefined,
  key: string,
  defaultValue: boolean,
): boolean {
  if (!options || options[key] === undefined || options[key] === null) {
    return defaultValue;
  }
  const v = options[key];
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return defaultValue;
}

/**
 * Homeserver must be http(s):// with a non-empty host.
 * Empty is missing, not invalid format.
 * Trailing slash is tolerated (normalized by callers).
 */
export function isMatrixHomeserverUrl(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  try {
    const u = new URL(t);
    const scheme = u.protocol.replace(":", "").toLowerCase();
    if (scheme !== "http" && scheme !== "https") return false;
    return !!u.hostname;
  } catch {
    return false;
  }
}

/** Strip trailing slash for display / mode labels. */
export function normalizeMatrixHomeserver(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/**
 * Soft access-token shape: non-empty, reasonably long, no whitespace / URL paste.
 * Matrix tokens are opaque (syt_…, legacy random, …) — never log values.
 * Empty is missing, not invalid format.
 */
export function isMatrixAccessTokenFormat(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (/\s/.test(t)) return false;
  if (/^https?:\/\//i.test(t)) return false;
  // Soft floor — real tokens are far longer; reject obvious garbage.
  if (t.length < 16) return false;
  return true;
}

/**
 * Optional MXID: @localpart:domain (Matrix user id).
 * Empty is valid (auto-detect at runtime).
 */
export function isMatrixUserIdFormat(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  // @localpart:server.name — localpart allows common Matrix chars
  return /^@[A-Za-z0-9._=/-]+:[A-Za-z0-9.-]+$/.test(t);
}

/**
 * Proxy URL sanity: http(s) or socks5(h) with a non-empty host part.
 * Empty is valid (means no channel proxy).
 */
export function isMatrixProxyUrl(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  try {
    const u = new URL(t);
    const scheme = u.protocol.replace(":", "").toLowerCase();
    if (!["http", "https", "socks5", "socks5h"].includes(scheme)) return false;
    return !!u.hostname;
  } catch {
    return /^(https?|socks5h?):\/\/[^\s/]+/i.test(t);
  }
}

export function matrixProxyScheme(
  raw: string,
): MatrixConfigValidation["proxyScheme"] {
  const t = raw.trim();
  if (!t) return null;
  const m = t.match(/^(https?|socks5h?):\/\//i);
  if (!m) return null;
  const s = m[1].toLowerCase();
  if (s === "http" || s === "https" || s === "socks5" || s === "socks5h") {
    return s;
  }
  return null;
}

/** Required secret keys (access_token; token alias accepted at runtime). */
export function matrixRequiredSecretKeys(): readonly string[] {
  return ["access_token"];
}

/** Required non-secret bind keys. */
export function matrixRequiredNonSecretKeys(): readonly string[] {
  return ["homeserver"];
}

/** Optional advanced / options keys (not required for ready). */
export function matrixOptionalKeys(): readonly string[] {
  return [
    "user_id",
    "device_id",
    "allow_from",
    "auto_join",
    "auto_verify",
    "cross_signing_password",
    "share_session_in_channel",
    "group_reply_all",
    "proxy",
  ];
}

export type ValidateMatrixConfigInput = {
  options: Record<string, unknown>;
  /**
   * Secret field keys currently non-empty in the form (never values).
   * Accepts `token` as access_token alias.
   */
  secretKeysFilled?: ReadonlySet<string>;
  /** Vault already has credentials for this instance */
  hasCredentials?: boolean;
  /**
   * When the form has a non-empty access token, pass the raw value for
   * format validation only. Never logged or stored by this helper.
   */
  accessTokenValue?: string | null;
};

/**
 * Matrix bind validation (pure).
 * Does not read secret vault values — only key presence + optional format.
 */
export function validateMatrixConfig(
  input: ValidateMatrixConfigInput,
): MatrixConfigValidation {
  const missing: string[] = [];
  const warnings: string[] = [];
  const secrets = input.secretKeysFilled ?? new Set<string>();

  const homeserverRaw = optionString(input.options, "homeserver");
  const homeserverValid = homeserverRaw
    ? isMatrixHomeserverUrl(homeserverRaw)
    : false;
  const homeserver = homeserverValid
    ? normalizeMatrixHomeserver(homeserverRaw)
    : "";

  const proxyRaw = optionString(input.options, "proxy");
  const proxySet = !!proxyRaw;
  const proxyScheme = proxySet ? matrixProxyScheme(proxyRaw) : null;

  const autoJoin = optionBool(input.options, "auto_join", true);
  const autoVerify = optionBool(input.options, "auto_verify", true);
  const groupReplyAll = optionBool(input.options, "group_reply_all", false);
  const shareSessionInChannel = optionBool(
    input.options,
    "share_session_in_channel",
    false,
  );

  const tokenInForm =
    secrets.has("access_token") ||
    secrets.has("token") ||
    !!(input.accessTokenValue && input.accessTokenValue.trim());

  if (!homeserverRaw) {
    missing.push("homeserver");
  } else if (!homeserverValid) {
    missing.push("homeserver");
  }

  if (!tokenInForm && !input.hasCredentials) {
    missing.push("access_token");
  }

  const tokenFormatInvalid =
    !!input.accessTokenValue?.trim() &&
    !isMatrixAccessTokenFormat(input.accessTokenValue);
  if (tokenFormatInvalid && !missing.includes("access_token")) {
    missing.push("access_token");
  }

  const userIdRaw = optionString(input.options, "user_id");
  const userIdInvalid = !!userIdRaw && !isMatrixUserIdFormat(userIdRaw);
  if (userIdInvalid) {
    missing.push("user_id");
  }

  if (proxySet && !isMatrixProxyUrl(proxyRaw)) {
    missing.push("proxy");
  }

  // Soft: http homeserver is allowed (local Synapse) but warn for production.
  if (homeserverValid && /^http:\/\//i.test(homeserverRaw)) {
    warnings.push("homeserver_http");
  }

  let softStatus: MatrixConfigValidation["softStatus"];
  if (homeserverRaw && !homeserverValid) {
    softStatus = "invalid_homeserver";
  } else if (tokenFormatInvalid) {
    softStatus = "invalid_access_token_format";
  } else if (userIdInvalid) {
    softStatus = "invalid_user_id";
  } else if (proxySet && !isMatrixProxyUrl(proxyRaw)) {
    softStatus = "invalid_proxy";
  } else if (missing.length === 0) {
    softStatus = "ready_long_poll";
  } else if (!homeserverRaw && !tokenInForm && !input.hasCredentials) {
    softStatus = "missing_credentials";
  } else if (!homeserverRaw) {
    softStatus = "missing_homeserver";
  } else if (!tokenInForm && !input.hasCredentials) {
    softStatus = "missing_access_token";
  } else {
    softStatus = "incomplete";
  }

  const ok = missing.length === 0 && softStatus === "ready_long_poll";

  return {
    ok,
    missing,
    warnings,
    transport: "long_poll",
    proxySet,
    proxyScheme,
    homeserver,
    autoJoin,
    autoVerify,
    groupReplyAll,
    shareSessionInChannel,
    softStatus,
  };
}

/** i18n hint keys for Matrix health card (order preserved). */
export function matrixHealthHintKeys(
  validation: MatrixConfigValidation,
  extras?: { openAcl?: boolean },
): string[] {
  const keys: string[] = [];
  // Always state long-poll /sync / no public URL
  keys.push("settings.remoteIm.health.hint.matrixSync");
  keys.push("settings.remoteIm.health.hint.matrixNoWebhook");
  // Homeserver must be the Client-Server base (not a pure federation name)
  keys.push("settings.remoteIm.health.hint.matrixHomeserverNote");

  if (validation.softStatus === "invalid_homeserver") {
    keys.push("settings.remoteIm.health.hint.matrixHomeserverInvalid");
  } else if (
    validation.softStatus === "missing_homeserver" ||
    (validation.softStatus === "incomplete" &&
      validation.missing.includes("homeserver")) ||
    (validation.softStatus === "missing_credentials" &&
      validation.missing.includes("homeserver"))
  ) {
    keys.push("settings.remoteIm.health.hint.matrixMissingHomeserver");
  }

  if (validation.softStatus === "invalid_access_token_format") {
    keys.push("settings.remoteIm.health.hint.matrixTokenFormat");
  } else if (
    validation.softStatus === "missing_access_token" ||
    (validation.softStatus === "incomplete" &&
      validation.missing.includes("access_token")) ||
    (validation.softStatus === "missing_credentials" &&
      validation.missing.includes("access_token"))
  ) {
    keys.push("settings.remoteIm.health.hint.matrixMissingToken");
  } else if (validation.softStatus === "ready_long_poll") {
    // Shape checks never prove /sync until Bridge links the instance
    keys.push("settings.remoteIm.health.hint.matrixNoLiveClaim");
  }

  if (validation.softStatus === "invalid_user_id") {
    keys.push("settings.remoteIm.health.hint.matrixUserId");
  }

  const proxyInvalid =
    validation.softStatus === "invalid_proxy" ||
    validation.missing.includes("proxy");
  if (proxyInvalid) {
    keys.push("settings.remoteIm.health.hint.matrixProxyInvalid");
  } else if (validation.proxySet) {
    keys.push("settings.remoteIm.health.hint.matrixProxy");
  }

  if (validation.warnings.includes("homeserver_http")) {
    keys.push("settings.remoteIm.health.hint.matrixHomeserverHttp");
  }

  if (validation.autoJoin) {
    keys.push("settings.remoteIm.health.hint.matrixAutoJoin");
  }

  if (extras?.openAcl) {
    keys.push("settings.remoteIm.health.hint.matrixAcl");
  }
  return keys;
}

/** Map soft status → short host/test message code (no secrets). */
export function matrixSoftStatusMessage(
  validation: MatrixConfigValidation,
): string {
  switch (validation.softStatus) {
    case "ready_long_poll":
      return validation.proxySet
        ? "matrix_sync_credentials_present_proxy"
        : "matrix_sync_credentials_present";
    case "invalid_homeserver":
      return "invalid_matrix_homeserver";
    case "invalid_access_token_format":
      return "invalid_matrix_access_token_format";
    case "invalid_user_id":
      return "invalid_matrix_user_id";
    case "invalid_proxy":
      return "invalid_matrix_proxy";
    case "missing_homeserver":
      return "missing_matrix_homeserver";
    case "missing_access_token":
      return "missing_matrix_access_token";
    case "missing_credentials":
      return "missing_matrix_credentials";
    case "incomplete":
      return `missing_matrix_fields:${validation.missing.join(",") || "unknown"}`;
    default:
      return "missing_matrix_credentials";
  }
}

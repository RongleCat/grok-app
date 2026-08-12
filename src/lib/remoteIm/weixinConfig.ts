/**
 * Weixin personal (微信个人 · ilink) pure config helpers — no I/O.
 *
 * Spec §6.9: HTTP long-poll (no public URL). Primary bind is QR scan → token;
 * paste token is the secondary path. Soft status never claims live getUpdates
 * / long-poll connectivity — only credential posture.
 */

/** Product transport: ilink long poll only (no public webhook). */
export type WeixinTransport = "long_poll";

export type WeixinConfigValidation = {
  ok: boolean;
  /** Missing / invalid option / secret keys (never values) */
  missing: string[];
  /** Issues that do not block ready but should warn in health */
  warnings: string[];
  transport: WeixinTransport;
  /** Long poll never needs a public HTTPS callback */
  needsPublicUrl: false;
  /** True when options.proxy is non-empty */
  proxySet: boolean;
  /** True when options.base_url is non-empty (override of default ilink host) */
  customBaseUrl: boolean;
  /** True when chat_id is set (group bind) */
  chatIdSet: boolean;
  /**
   * Soft status code for UI / host test mapping.
   * Never claims live ilink long-poll success.
   */
  softStatus:
    | "ready_long_poll"
    | "missing_token"
    | "invalid_base_url"
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

/**
 * Optional base / CDN URL sanity: empty is valid (defaults apply at runtime).
 * When set, must look like an absolute http(s) URL with a host.
 */
export function isWeixinHttpUrl(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  try {
    const u = new URL(t);
    const scheme = u.protocol.replace(":", "").toLowerCase();
    if (scheme !== "http" && scheme !== "https") return false;
    return !!u.hostname;
  } catch {
    return false;
  }
}

/**
 * Proxy URL sanity: http(s) or socks5(h) with a non-empty host part.
 * Empty is valid (means no channel proxy).
 */
export function isWeixinProxyUrl(raw: string): boolean {
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

/** Non-secret bind keys required for ready (§6.9) — token is secret-only. */
export function weixinRequiredNonSecretKeys(): readonly string[] {
  return [];
}

/** Secret bind keys required for ilink long-poll (§6.9). Canonical GUI key. */
export function weixinRequiredSecretKeys(): readonly string[] {
  return ["token"];
}

/** Optional advanced / options keys (not required for ready). */
export function weixinOptionalKeys(): readonly string[] {
  return [
    "base_url",
    "cdn_base_url",
    "allow_from",
    "account_id",
    "route_tag",
    "long_poll_timeout_ms",
    "chat_id",
    "proxy",
  ];
}

export type ValidateWeixinConfigInput = {
  options: Record<string, unknown>;
  /**
   * Secret field keys currently non-empty in the form (never values).
   * Accepts token / bot_token / ilink_token aliases used by paste / scan.
   */
  secretKeysFilled?: ReadonlySet<string>;
  /** Vault already has credentials for this instance */
  hasCredentials?: boolean;
};

/**
 * Weixin personal bind validation (pure).
 * Does not read secret values — only key presence + option string shapes.
 */
export function validateWeixinConfig(
  input: ValidateWeixinConfigInput,
): WeixinConfigValidation {
  const missing: string[] = [];
  const warnings: string[] = [];
  const secrets = input.secretKeysFilled ?? new Set<string>();

  const tokenInForm =
    secrets.has("token") ||
    secrets.has("bot_token") ||
    secrets.has("ilink_token");

  if (!tokenInForm && !input.hasCredentials) {
    missing.push("token");
  }

  const baseUrl = optionString(input.options, "base_url");
  const customBaseUrl = !!baseUrl;
  if (customBaseUrl && !isWeixinHttpUrl(baseUrl)) {
    missing.push("base_url");
  }

  const cdn = optionString(input.options, "cdn_base_url");
  if (cdn && !isWeixinHttpUrl(cdn)) {
    missing.push("cdn_base_url");
  }

  const proxyRaw = optionString(input.options, "proxy");
  const proxySet = !!proxyRaw;
  if (proxySet && !isWeixinProxyUrl(proxyRaw)) {
    missing.push("proxy");
  }

  const chatId = optionString(input.options, "chat_id");
  const chatIdSet = !!chatId;
  // Soft: group chat_id usually ends with @chatroom — warn, do not block.
  if (chatIdSet && !chatId.includes("@chatroom") && !chatId.includes("@")) {
    warnings.push("chat_id_maybe_not_room");
  }

  const timeoutRaw = input.options.long_poll_timeout_ms;
  if (timeoutRaw !== undefined && timeoutRaw !== null && timeoutRaw !== "") {
    const n = Number(timeoutRaw);
    if (!Number.isFinite(n) || n < 5_000 || n > 120_000) {
      warnings.push("long_poll_timeout_out_of_range");
    }
  }

  let softStatus: WeixinConfigValidation["softStatus"];
  if (customBaseUrl && !isWeixinHttpUrl(baseUrl)) {
    softStatus = "invalid_base_url";
  } else if (proxySet && !isWeixinProxyUrl(proxyRaw)) {
    softStatus = "invalid_proxy";
  } else if (missing.length === 0) {
    softStatus = "ready_long_poll";
  } else if (!input.hasCredentials && !tokenInForm) {
    softStatus = "missing_token";
  } else {
    softStatus = "incomplete";
  }

  const ok = missing.length === 0 && softStatus === "ready_long_poll";

  return {
    ok,
    missing,
    warnings,
    transport: "long_poll",
    needsPublicUrl: false,
    proxySet,
    customBaseUrl,
    chatIdSet,
    softStatus,
  };
}

/** i18n hint keys for Weixin health card (order preserved). */
export function weixinHealthHintKeys(
  validation: WeixinConfigValidation,
  extras?: { openAcl?: boolean },
): string[] {
  const keys: string[] = [];
  // Always state long-poll / no public URL (honest vs webhook products)
  keys.push("settings.remoteIm.health.hint.weixinPoll");
  keys.push("settings.remoteIm.health.hint.weixinNoPublicUrl");
  // Token presence ≠ live getUpdates long-poll
  keys.push("settings.remoteIm.health.hint.weixinNoLiveClaim");

  if (validation.softStatus === "missing_token") {
    keys.push("settings.remoteIm.health.hint.weixinMissingToken");
  } else if (
    validation.softStatus === "incomplete" &&
    validation.missing.includes("token")
  ) {
    keys.push("settings.remoteIm.health.hint.weixinMissingToken");
  }

  if (validation.softStatus === "invalid_base_url") {
    keys.push("settings.remoteIm.health.hint.weixinBaseUrlInvalid");
  } else if (validation.customBaseUrl) {
    keys.push("settings.remoteIm.health.hint.weixinCustomBase");
  }

  if (validation.softStatus === "invalid_proxy") {
    keys.push("settings.remoteIm.health.hint.weixinProxyInvalid");
  } else if (validation.proxySet) {
    keys.push("settings.remoteIm.health.hint.weixinProxy");
  }

  if (validation.warnings.includes("chat_id_maybe_not_room")) {
    keys.push("settings.remoteIm.health.hint.weixinChatId");
  }

  if (validation.warnings.includes("long_poll_timeout_out_of_range")) {
    keys.push("settings.remoteIm.health.hint.weixinTimeout");
  }

  // Spec §6.9: force text menus (no interactive cards)
  keys.push("settings.remoteIm.health.hint.weixinTextMenu");

  if (extras?.openAcl) {
    keys.push("settings.remoteIm.health.hint.openAcl");
  }
  return keys;
}

/** Map soft status → short host/test message code (no secrets). */
export function weixinSoftStatusMessage(
  validation: WeixinConfigValidation,
): string {
  switch (validation.softStatus) {
    case "ready_long_poll":
      return validation.proxySet
        ? "weixin_ilink_credentials_present_proxy"
        : "weixin_ilink_credentials_present";
    case "invalid_base_url":
      return "invalid_weixin_base_url";
    case "invalid_proxy":
      return "invalid_weixin_proxy";
    case "missing_token":
      return "missing_weixin_token";
    case "incomplete":
      return `missing_weixin_fields:${validation.missing.join(",") || "unknown"}`;
    default:
      return "missing_weixin_token";
  }
}

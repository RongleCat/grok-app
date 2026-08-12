/**
 * Telegram pure config helpers — no I/O.
 *
 * Spec §6.5: long polling only (no public URL / webhook). Validation covers
 * Bot token shape, optional HTTP/SOCKS proxy URL, and soft proxy-auth posture.
 * Soft status never claims live getMe connectivity — only credential shape.
 */

/** Product transport: long poll only (webhook not configured by Bridge). */
export type TelegramTransport = "long_poll";

export type TelegramConfigValidation = {
  ok: boolean;
  /** Missing / invalid option / secret keys (never values) */
  missing: string[];
  /** Issues that do not block vault reuse but should warn in health */
  warnings: string[];
  transport: TelegramTransport;
  /** True when options.proxy is non-empty and parseable */
  proxySet: boolean;
  /** Detected proxy scheme when proxySet, else null */
  proxyScheme: "http" | "https" | "socks5" | "socks5h" | null;
  /**
   * Soft status code for UI / host test mapping.
   * Never claims live getUpdates / getMe success.
   */
  softStatus:
    | "ready_long_poll"
    | "missing_token"
    | "invalid_token_format"
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
 * BotFather tokens look like `123456789:AAH…` (digits : base64-ish body).
 * Accepts common paste with optional "bot" prefix only when digits:body remain.
 * Empty string is not "invalid format" — treated as missing.
 */
export function isTelegramBotTokenFormat(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  // Strip accidental "bot" prefix (user pastes full URL path segment)
  const body = t.replace(/^bot/i, "");
  return /^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(body);
}

/**
 * Proxy URL sanity: http(s) or socks5(h) with a non-empty host part.
 * Empty is valid (means no channel proxy).
 */
export function isTelegramProxyUrl(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  try {
    const u = new URL(t);
    const scheme = u.protocol.replace(":", "").toLowerCase();
    if (!["http", "https", "socks5", "socks5h"].includes(scheme)) return false;
    return !!u.hostname;
  } catch {
    // socks5:// may fail URL parse in some engines — regex fallback
    return /^(https?|socks5h?):\/\/[^\s/]+/i.test(t);
  }
}

export function telegramProxyScheme(
  raw: string,
): TelegramConfigValidation["proxyScheme"] {
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

/** Required secret keys (always token; bot_token alias accepted at runtime). */
export function telegramRequiredSecretKeys(): readonly string[] {
  return ["token"];
}

/** Optional advanced keys (not required for ready). */
export function telegramOptionalKeys(): readonly string[] {
  return [
    "proxy",
    "proxy_username",
    "proxy_password",
    "progress_style",
    "thread_isolation",
    "allow_from",
  ];
}

export type ValidateTelegramConfigInput = {
  options: Record<string, unknown>;
  /**
   * Secret field keys currently non-empty in the form (never values).
   * When `token` is filled, optional `tokenValue` enables format checks.
   */
  secretKeysFilled?: ReadonlySet<string>;
  /** Vault already has credentials for this instance */
  hasCredentials?: boolean;
  /**
   * When the form has a non-empty token, pass the raw value for format
   * validation only. Never logged or stored by this helper.
   */
  tokenValue?: string | null;
};

/**
 * Telegram bind validation (pure).
 * Does not read secret vault values — only key presence + optional format.
 */
export function validateTelegramConfig(
  input: ValidateTelegramConfigInput,
): TelegramConfigValidation {
  const missing: string[] = [];
  const warnings: string[] = [];
  const secrets = input.secretKeysFilled ?? new Set<string>();
  const proxyRaw = optionString(input.options, "proxy");
  const proxySet = !!proxyRaw;
  const proxyScheme = proxySet ? telegramProxyScheme(proxyRaw) : null;

  const tokenInForm =
    secrets.has("token") ||
    secrets.has("bot_token") ||
    !!(input.tokenValue && input.tokenValue.trim());

  if (!tokenInForm && !input.hasCredentials) {
    missing.push("token");
  }

  // Format only when the form exposes a token value
  if (input.tokenValue != null && input.tokenValue.trim()) {
    if (!isTelegramBotTokenFormat(input.tokenValue)) {
      if (!missing.includes("token")) missing.push("token");
      // Distinct soft status via invalid_token_format below
    }
  }

  if (proxySet && !isTelegramProxyUrl(proxyRaw)) {
    missing.push("proxy");
  }

  const user = optionString(input.options, "proxy_username");
  const passFilled = secrets.has("proxy_password");
  // Soft: username without password in form (or reverse) when proxy set.
  // Does not block ready — vault may hold password, but UI still surfaces the gap.
  if (proxySet && ((user && !passFilled) || (!user && passFilled))) {
    warnings.push("proxy_auth_partial");
  }

  const formatInvalid =
    !!input.tokenValue?.trim() && !isTelegramBotTokenFormat(input.tokenValue);

  let softStatus: TelegramConfigValidation["softStatus"];
  if (formatInvalid) {
    softStatus = "invalid_token_format";
  } else if (proxySet && !isTelegramProxyUrl(proxyRaw)) {
    softStatus = "invalid_proxy";
  } else if (missing.length === 0) {
    softStatus = "ready_long_poll";
  } else if (!input.hasCredentials && !tokenInForm) {
    softStatus = "missing_token";
  } else {
    softStatus = "incomplete";
  }

  const ok =
    missing.length === 0 && softStatus === "ready_long_poll";

  return {
    ok,
    missing,
    warnings,
    transport: "long_poll",
    proxySet,
    proxyScheme,
    softStatus,
  };
}

/** i18n hint keys for Telegram health card (order preserved). */
export function telegramHealthHintKeys(
  validation: TelegramConfigValidation,
  extras?: { openAcl?: boolean },
): string[] {
  const keys: string[] = [];
  // Always state long-poll / no public URL (honest vs webhook products)
  keys.push("settings.remoteIm.health.hint.telegramPoll");
  keys.push("settings.remoteIm.health.hint.telegramNoWebhook");

  if (validation.softStatus === "invalid_token_format") {
    keys.push("settings.remoteIm.health.hint.telegramTokenFormat");
  } else if (
    validation.softStatus === "missing_token" ||
    (validation.softStatus === "incomplete" &&
      validation.missing.includes("token"))
  ) {
    keys.push("settings.remoteIm.health.hint.telegramMissingToken");
  } else if (validation.softStatus === "ready_long_poll") {
    // Shape / getMe never prove getUpdates until Bridge links the instance
    keys.push("settings.remoteIm.health.hint.telegramNoLiveClaim");
  }
  const proxyInvalid =
    validation.softStatus === "invalid_proxy" ||
    validation.missing.includes("proxy");
  if (proxyInvalid) {
    keys.push("settings.remoteIm.health.hint.telegramProxyInvalid");
  } else if (validation.proxySet) {
    keys.push("settings.remoteIm.health.hint.telegramProxy");
  }
  if (validation.warnings.includes("proxy_auth_partial")) {
    keys.push("settings.remoteIm.health.hint.telegramProxyAuth");
  }
  if (extras?.openAcl) {
    keys.push("settings.remoteIm.health.hint.telegramAcl");
  }
  return keys;
}

/** Map soft status → short host/test message code (no secrets). */
export function telegramSoftStatusMessage(
  validation: TelegramConfigValidation,
): string {
  switch (validation.softStatus) {
    case "ready_long_poll":
      return validation.proxySet
        ? "telegram_long_poll_credentials_present_proxy"
        : "telegram_long_poll_credentials_present";
    case "invalid_token_format":
      return "invalid_telegram_token_format";
    case "invalid_proxy":
      return "invalid_telegram_proxy";
    case "missing_token":
      return "missing_telegram_token";
    case "incomplete":
      return `missing_telegram_fields:${validation.missing.join(",") || "unknown"}`;
    default:
      return "missing_telegram_token";
  }
}

/**
 * Discord pure config helpers — no I/O.
 *
 * Spec §6.7: Gateway transport (no public URL). Validation covers Bot token
 * shape, allow_from default, thread_isolation, and progress_style.
 * Soft status never claims live Gateway connectivity — only credential shape.
 * Message Content Intent is a developer-portal requirement (UI callout).
 */

/** Product transport: Discord Gateway only (no webhook / public URL). */
export type DiscordTransport = "gateway";

export type DiscordProgressStyle = "legacy" | "compact" | "card";

export type DiscordConfigValidation = {
  ok: boolean;
  /** Missing / invalid option / secret keys (never values) */
  missing: string[];
  /** Issues that do not block vault reuse but should warn in health */
  warnings: string[];
  transport: DiscordTransport;
  /** Normalized progress_style (default compact) */
  progressStyle: DiscordProgressStyle;
  /** thread_isolation flag (default false) */
  threadIsolation: boolean;
  /**
   * Soft status code for UI / host test mapping.
   * Never claims live Gateway / identify success.
   */
  softStatus:
    | "ready_gateway"
    | "missing_token"
    | "invalid_token_format"
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
 * Discord bot tokens are three base64url-ish segments separated by dots
 * (user_id_b64.timestamp_b64.hmac). Accept optional "Bot " paste prefix.
 * Empty string is not "invalid format" — treated as missing.
 */
export function isDiscordBotTokenFormat(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  // Strip accidental "Bot " Authorization-header paste
  const body = t.replace(/^Bot\s+/i, "").trim();
  return /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{20,}$/.test(
    body,
  );
}

/** Normalize progress_style → legacy | compact | card (default compact). */
export function normalizeDiscordProgressStyle(
  options?: Record<string, unknown> | null,
): DiscordProgressStyle {
  const raw = optionString(options, "progress_style").toLowerCase();
  if (raw === "legacy" || raw === "card" || raw === "compact") return raw;
  return "compact";
}

/** Required secret keys (always token; bot_token alias accepted at runtime). */
export function discordRequiredSecretKeys(): readonly string[] {
  return ["token"];
}

/** Optional advanced / options keys (not required for ready). */
export function discordOptionalKeys(): readonly string[] {
  return ["allow_from", "thread_isolation", "progress_style"];
}

export type ValidateDiscordConfigInput = {
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
 * Discord bind validation (pure).
 * Does not read secret vault values — only key presence + optional format.
 */
export function validateDiscordConfig(
  input: ValidateDiscordConfigInput,
): DiscordConfigValidation {
  const missing: string[] = [];
  const warnings: string[] = [];
  const secrets = input.secretKeysFilled ?? new Set<string>();
  const progressStyle = normalizeDiscordProgressStyle(input.options);
  const threadIsolation = optionBool(
    input.options,
    "thread_isolation",
    false,
  );

  const tokenInForm =
    secrets.has("token") ||
    secrets.has("bot_token") ||
    !!(input.tokenValue && input.tokenValue.trim());

  if (!tokenInForm && !input.hasCredentials) {
    missing.push("token");
  }

  // Format only when the form exposes a token value
  if (input.tokenValue != null && input.tokenValue.trim()) {
    if (!isDiscordBotTokenFormat(input.tokenValue)) {
      if (!missing.includes("token")) missing.push("token");
    }
  }

  // Soft: unknown progress_style already normalized; surface when raw was junk
  const rawStyle = optionString(input.options, "progress_style");
  if (
    rawStyle &&
    !["legacy", "compact", "card"].includes(rawStyle.toLowerCase())
  ) {
    warnings.push("progress_style_normalized");
  }

  const formatInvalid =
    !!input.tokenValue?.trim() && !isDiscordBotTokenFormat(input.tokenValue);

  let softStatus: DiscordConfigValidation["softStatus"];
  if (formatInvalid) {
    softStatus = "invalid_token_format";
  } else if (missing.length === 0) {
    softStatus = "ready_gateway";
  } else if (!input.hasCredentials && !tokenInForm) {
    softStatus = "missing_token";
  } else {
    softStatus = "incomplete";
  }

  const ok = missing.length === 0 && softStatus === "ready_gateway";

  return {
    ok,
    missing,
    warnings,
    transport: "gateway",
    progressStyle,
    threadIsolation,
    softStatus,
  };
}

/** i18n hint keys for Discord health card (order preserved). */
export function discordHealthHintKeys(
  validation: DiscordConfigValidation,
  extras?: { openAcl?: boolean },
): string[] {
  const keys: string[] = [];
  // Always state Gateway / no public URL (honest vs webhook products)
  keys.push("settings.remoteIm.health.hint.discordGateway");
  keys.push("settings.remoteIm.health.hint.discordNoWebhook");
  // Message Content Intent is required for message body — always surface
  keys.push("settings.remoteIm.health.hint.discordIntent");

  if (validation.softStatus === "invalid_token_format") {
    keys.push("settings.remoteIm.health.hint.discordTokenFormat");
  } else if (
    validation.softStatus === "missing_token" ||
    (validation.softStatus === "incomplete" &&
      validation.missing.includes("token"))
  ) {
    keys.push("settings.remoteIm.health.hint.discordMissingToken");
  } else if (validation.softStatus === "ready_gateway") {
    // REST @me never proves Gateway until Bridge links the instance
    keys.push("settings.remoteIm.health.hint.discordNoLiveClaim");
  }
  if (validation.threadIsolation) {
    keys.push("settings.remoteIm.health.hint.discordThreadIso");
  }
  if (extras?.openAcl) {
    keys.push("settings.remoteIm.health.hint.discordAcl");
  }
  return keys;
}

/** Map soft status → short host/test message code (no secrets). */
export function discordSoftStatusMessage(
  validation: DiscordConfigValidation,
): string {
  switch (validation.softStatus) {
    case "ready_gateway":
      return "discord_gateway_credentials_present";
    case "invalid_token_format":
      return "invalid_discord_token_format";
    case "missing_token":
      return "missing_discord_token";
    case "incomplete":
      return `missing_discord_fields:${validation.missing.join(",") || "unknown"}`;
    default:
      return "missing_discord_token";
  }
}

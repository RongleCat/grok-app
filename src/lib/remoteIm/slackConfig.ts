/**
 * Slack pure config helpers — no I/O.
 *
 * Spec §6.6: Socket Mode only (no public URL / Events Request URL).
 * Requires Bot Token (`xoxb-`) + App-level Token (`xapp-`) for
 * `apps.connections.open`. Soft status never claims a live Socket Mode
 * WebSocket — only credential posture / shape.
 */

/** Product transport: Socket Mode only (no public Events Request URL). */
export type SlackTransport = "socket_mode";

export type SlackConfigValidation = {
  ok: boolean;
  /** Missing / invalid option / secret keys (never values) */
  missing: string[];
  /** Issues that do not block ready but should warn in health */
  warnings: string[];
  transport: SlackTransport;
  /** Socket Mode never needs a public HTTPS callback */
  needsPublicUrl: false;
  /**
   * Soft status code for UI / host test mapping.
   * Never claims live apps.connections.open / Socket Mode success.
   */
  softStatus:
    | "ready_socket_mode"
    | "missing_credentials"
    | "missing_bot_token"
    | "missing_app_token"
    | "invalid_bot_token_format"
    | "invalid_app_token_format"
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
 * Slack Bot User OAuth tokens look like `xoxb-…` (often multi-segment).
 * Empty string is not "invalid format" — treated as missing.
 */
export function isSlackBotTokenFormat(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  // xoxb- then at least ~10 more chars (digits / letters / hyphens)
  return /^xoxb-[A-Za-z0-9-]{10,}$/i.test(t);
}

/**
 * Slack App-level tokens for Socket Mode look like `xapp-…`.
 * Empty is missing, not invalid format.
 */
export function isSlackAppTokenFormat(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  return /^xapp-[A-Za-z0-9-]{10,}$/i.test(t);
}

/** Required secret keys (§6.6 dual token). */
export function slackRequiredSecretKeys(): readonly string[] {
  return ["bot_token", "app_token"];
}

/** Non-secret bind keys — none required (allow_from is ACL optional). */
export function slackRequiredNonSecretKeys(): readonly string[] {
  return [];
}

/** Optional advanced / ACL keys (not required for ready). */
export function slackOptionalKeys(): readonly string[] {
  return ["allow_from"];
}

export type ValidateSlackConfigInput = {
  options: Record<string, unknown>;
  /**
   * Secret field keys currently non-empty in the form (never values).
   * Accepts `token` as bot_token alias and `app_level_token` as app_token alias.
   */
  secretKeysFilled?: ReadonlySet<string>;
  /** Vault already has credentials for this instance */
  hasCredentials?: boolean;
  /**
   * When the form has a non-empty bot token, pass the raw value for format
   * validation only. Never logged or stored by this helper.
   */
  botTokenValue?: string | null;
  /**
   * When the form has a non-empty app token, pass the raw value for format
   * validation only. Never logged or stored by this helper.
   */
  appTokenValue?: string | null;
};

/**
 * Slack bind validation (pure).
 * Does not read secret vault values — only key presence + optional format.
 */
export function validateSlackConfig(
  input: ValidateSlackConfigInput,
): SlackConfigValidation {
  const missing: string[] = [];
  const warnings: string[] = [];
  const secrets = input.secretKeysFilled ?? new Set<string>();

  const botInForm =
    secrets.has("bot_token") ||
    secrets.has("token") ||
    !!(input.botTokenValue && input.botTokenValue.trim());
  const appInForm =
    secrets.has("app_token") ||
    secrets.has("app_level_token") ||
    !!(input.appTokenValue && input.appTokenValue.trim());

  if (!botInForm && !input.hasCredentials) {
    missing.push("bot_token");
  }
  if (!appInForm && !input.hasCredentials) {
    missing.push("app_token");
  }

  // Format only when the form exposes raw values
  const botFormatInvalid =
    !!input.botTokenValue?.trim() &&
    !isSlackBotTokenFormat(input.botTokenValue);
  const appFormatInvalid =
    !!input.appTokenValue?.trim() &&
    !isSlackAppTokenFormat(input.appTokenValue);

  if (botFormatInvalid && !missing.includes("bot_token")) {
    missing.push("bot_token");
  }
  if (appFormatInvalid && !missing.includes("app_token")) {
    missing.push("app_token");
  }

  // Soft: open allow_from in options is informational only (ACL lives on instance)
  const allowFrom = optionString(input.options, "allow_from");
  if (allowFrom === "*") {
    warnings.push("open_acl");
  }

  let softStatus: SlackConfigValidation["softStatus"];
  if (botFormatInvalid) {
    softStatus = "invalid_bot_token_format";
  } else if (appFormatInvalid) {
    softStatus = "invalid_app_token_format";
  } else if (missing.length === 0) {
    softStatus = "ready_socket_mode";
  } else if (!input.hasCredentials && !botInForm && !appInForm) {
    softStatus = "missing_credentials";
  } else if (!input.hasCredentials && !botInForm && appInForm) {
    softStatus = "missing_bot_token";
  } else if (!input.hasCredentials && botInForm && !appInForm) {
    softStatus = "missing_app_token";
  } else {
    softStatus = "incomplete";
  }

  const ok =
    missing.length === 0 && softStatus === "ready_socket_mode";

  return {
    ok,
    missing,
    warnings,
    transport: "socket_mode",
    needsPublicUrl: false,
    softStatus,
  };
}

/** i18n hint keys for Slack health card (order preserved). */
export function slackHealthHintKeys(
  validation: SlackConfigValidation,
  extras?: { openAcl?: boolean },
): string[] {
  const keys: string[] = [];
  // Always state Socket Mode / no public URL (honest vs Events Request URL)
  keys.push("settings.remoteIm.health.hint.slackSocketMode");
  keys.push("settings.remoteIm.health.hint.slackNoPublicUrl");

  if (validation.softStatus === "invalid_bot_token_format") {
    keys.push("settings.remoteIm.health.hint.slackBotTokenFormat");
  } else if (validation.softStatus === "invalid_app_token_format") {
    keys.push("settings.remoteIm.health.hint.slackAppTokenFormat");
  } else if (
    validation.softStatus === "missing_credentials" ||
    validation.softStatus === "missing_bot_token" ||
    validation.softStatus === "missing_app_token" ||
    (validation.softStatus === "incomplete" &&
      (validation.missing.includes("bot_token") ||
        validation.missing.includes("app_token")))
  ) {
    keys.push("settings.remoteIm.health.hint.slackMissingTokens");
  }

  // Dual-token reminder when ready (Socket Mode needs both)
  if (validation.softStatus === "ready_socket_mode") {
    keys.push("settings.remoteIm.health.hint.slackDualToken");
    // auth.test / dual tokens never prove Socket Mode until Bridge links
    keys.push("settings.remoteIm.health.hint.slackNoLiveClaim");
  }

  if (extras?.openAcl) {
    keys.push("settings.remoteIm.health.hint.slackAcl");
  }
  return keys;
}

/** Map soft status → short host/test message code (no secrets). */
export function slackSoftStatusMessage(
  validation: SlackConfigValidation,
): string {
  switch (validation.softStatus) {
    case "ready_socket_mode":
      return "slack_socket_mode_credentials_present";
    case "invalid_bot_token_format":
      return "invalid_slack_bot_token_format";
    case "invalid_app_token_format":
      return "invalid_slack_app_token_format";
    case "missing_bot_token":
      return "missing_slack_bot_token";
    case "missing_app_token":
      return "missing_slack_app_token";
    case "missing_credentials":
      return "missing_slack_credentials";
    case "incomplete":
      return `missing_slack_fields:${validation.missing.join(",") || "unknown"}`;
    default:
      return "missing_slack_credentials";
  }
}

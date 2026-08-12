/**
 * WeCom (企业微信) pure config helpers — no I/O.
 *
 * Spec §6.8: connection mode is websocket (recommended) or webhook.
 * Validation and soft-status are mode-aware so WS does not require corp
 * secrets and webhook does not require bot_id.
 */

export type WecomConnectMode = "websocket" | "webhook";

export type WecomConfigValidation = {
  ok: boolean;
  /** Missing option / secret keys (never values) */
  missing: string[];
  mode: WecomConnectMode;
  /** Webhook needs a public HTTPS callback */
  needsPublicUrl: boolean;
  transport: "websocket" | "webhook";
  /**
   * Soft status code for UI / host test mapping.
   * Never claims live connectivity — only credential posture.
   */
  softStatus:
    | "ready_ws"
    | "ready_webhook"
    | "missing_credentials"
    | "mode_switch_needs_secrets"
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

/** Normalize connect_mode / mode → websocket | webhook (default websocket). */
export function normalizeWecomConnectMode(
  options?: Record<string, unknown> | null,
): WecomConnectMode {
  const raw = optionString(options, "connect_mode") || optionString(options, "mode");
  return raw === "webhook" ? "webhook" : "websocket";
}

/** Non-secret bind keys required for a mode (§6.8). */
export function wecomRequiredNonSecretKeys(
  mode: WecomConnectMode,
): readonly string[] {
  return mode === "webhook" ? ["corp_id", "agent_id"] : ["bot_id"];
}

/** Secret bind keys required for a mode (§6.8). */
export function wecomRequiredSecretKeys(
  mode: WecomConnectMode,
): readonly string[] {
  return mode === "webhook"
    ? ["corp_secret", "callback_token"]
    : ["bot_secret"];
}

/** Optional advanced keys (not required for ready). */
export function wecomOptionalKeys(
  mode: WecomConnectMode,
): readonly string[] {
  return mode === "webhook"
    ? ["encoding_aes_key", "port", "callback_path", "enable_markdown"]
    : ["api_base_url", "proxy"];
}

export type ValidateWecomConfigInput = {
  options: Record<string, unknown>;
  /** Secret field keys currently non-empty in the form (never values). */
  secretKeysFilled?: ReadonlySet<string>;
  /** Vault already has credentials for this instance */
  hasCredentials?: boolean;
  /**
   * Last saved connect_mode. When mode changes, stored secrets are not
   * assumed to cover the new mode (honest soft-fail).
   */
  savedConnectMode?: string | null;
};

/**
 * Mode-aware WeCom bind validation (pure).
 * Does not read secret values — only key presence + options strings.
 */
export function validateWecomConfig(
  input: ValidateWecomConfigInput,
): WecomConfigValidation {
  const mode = normalizeWecomConnectMode(input.options);
  const savedMode = input.savedConnectMode
    ? normalizeWecomConnectMode({ connect_mode: input.savedConnectMode })
    : null;
  const modeUnchanged =
    savedMode == null || savedMode === mode;

  const missing: string[] = [];

  for (const k of wecomRequiredNonSecretKeys(mode)) {
    if (!optionString(input.options, k)) missing.push(k);
  }

  const secrets = input.secretKeysFilled ?? new Set<string>();
  const canReuseVault = !!input.hasCredentials && modeUnchanged;

  for (const k of wecomRequiredSecretKeys(mode)) {
    if (secrets.has(k)) continue;
    if (canReuseVault) continue;
    missing.push(k);
  }

  const incomplete = missing.length > 0;
  let softStatus: WecomConfigValidation["softStatus"];
  if (!incomplete) {
    softStatus = mode === "webhook" ? "ready_webhook" : "ready_ws";
  } else if (
    input.hasCredentials &&
    savedMode != null &&
    savedMode !== mode
  ) {
    softStatus = "mode_switch_needs_secrets";
  } else if (!input.hasCredentials && secrets.size === 0) {
    softStatus = "missing_credentials";
  } else {
    softStatus = "incomplete";
  }

  return {
    ok: !incomplete,
    missing,
    mode,
    needsPublicUrl: mode === "webhook",
    transport: mode === "webhook" ? "webhook" : "websocket",
    softStatus,
  };
}

/** i18n hint keys for WeCom health card (order preserved, max useful). */
export function wecomHealthHintKeys(
  validation: WecomConfigValidation,
  extras?: { openAcl?: boolean; proxySet?: boolean },
): string[] {
  const keys: string[] = [];
  if (validation.mode === "websocket") {
    keys.push("settings.remoteIm.health.hint.wecomWs");
  } else {
    keys.push("settings.remoteIm.health.hint.wecomWebhook");
    keys.push("settings.remoteIm.health.hint.wecomPublicUrl");
  }
  // Credentials / mode readiness ≠ live WS or reachable public webhook
  keys.push("settings.remoteIm.health.hint.wecomNoLiveClaim");
  if (validation.softStatus === "mode_switch_needs_secrets") {
    keys.push("settings.remoteIm.health.hint.wecomModeSwitch");
  }
  if (validation.softStatus === "incomplete" || validation.softStatus === "missing_credentials") {
    keys.push("settings.remoteIm.health.hint.wecomMissingKeys");
  }
  if (extras?.proxySet && validation.mode === "websocket") {
    keys.push("settings.remoteIm.health.hint.wecomProxy");
  }
  if (extras?.openAcl) {
    keys.push("settings.remoteIm.health.hint.openAcl");
  }
  return keys;
}

/** Map soft status → short host/test message code (no secrets). */
export function wecomSoftStatusMessage(
  validation: WecomConfigValidation,
): string {
  switch (validation.softStatus) {
    case "ready_ws":
      return "wecom_ws_credentials_present";
    case "ready_webhook":
      return "wecom_webhook_credentials_present";
    case "mode_switch_needs_secrets":
      return "wecom_mode_switch_needs_secrets";
    case "missing_credentials":
      return "missing_wecom_credentials";
    case "incomplete":
      return `missing_wecom_fields:${validation.missing.join(",") || "unknown"}`;
    default:
      return "missing_wecom_credentials";
  }
}

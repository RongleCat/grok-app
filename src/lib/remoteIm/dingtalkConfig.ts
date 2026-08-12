/**
 * DingTalk (钉钉) pure config helpers — no I/O.
 *
 * Spec §6.2: Stream mode only (no public URL). Required bind fields are
 * Client ID (AppKey) + Client Secret. Soft status never claims a live gateway
 * WebSocket — only credential posture.
 */

export type DingtalkConnectMode = "stream";

export type DingtalkConfigValidation = {
  ok: boolean;
  /** Missing option / secret keys (never values) */
  missing: string[];
  mode: DingtalkConnectMode;
  /** Stream never needs a public HTTPS callback */
  needsPublicUrl: false;
  transport: "stream";
  /**
   * Soft status code for UI / host test mapping.
   * Never claims live gateway connectivity — only credential posture.
   */
  softStatus: "ready_stream" | "missing_credentials" | "incomplete";
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
 * Client ID from options. Accepts legacy `app_key` alias used by some
 * open-platform docs / paste formats (runtime also accepts it).
 */
export function dingtalkClientId(
  options?: Record<string, unknown> | null,
): string {
  return (
    optionString(options, "client_id") || optionString(options, "app_key")
  );
}

/** Non-secret bind keys required for Stream (§6.2). Canonical GUI key only. */
export function dingtalkRequiredNonSecretKeys(): readonly string[] {
  return ["client_id"];
}

/** Secret bind keys required for Stream (§6.2). Canonical GUI key only. */
export function dingtalkRequiredSecretKeys(): readonly string[] {
  return ["client_secret"];
}

/** Optional advanced / options keys (not required for ready). */
export function dingtalkOptionalKeys(): readonly string[] {
  return [
    "allow_from",
    "share_session_in_channel",
    "reaction_emoji",
    "done_emoji",
    "enable_ai_card",
  ];
}

export type ValidateDingtalkConfigInput = {
  options: Record<string, unknown>;
  /** Secret field keys currently non-empty in the form (never values). */
  secretKeysFilled?: ReadonlySet<string>;
  /** Vault already has credentials for this instance */
  hasCredentials?: boolean;
};

/**
 * Stream-mode DingTalk bind validation (pure).
 * Does not read secret values — only key presence + option strings.
 */
export function validateDingtalkConfig(
  input: ValidateDingtalkConfigInput,
): DingtalkConfigValidation {
  const missing: string[] = [];

  if (!dingtalkClientId(input.options)) {
    missing.push("client_id");
  }

  const secrets = input.secretKeysFilled ?? new Set<string>();
  const secretFilled =
    secrets.has("client_secret") || secrets.has("app_secret");
  if (!secretFilled && !input.hasCredentials) {
    missing.push("client_secret");
  }

  const incomplete = missing.length > 0;
  let softStatus: DingtalkConfigValidation["softStatus"];
  if (!incomplete) {
    softStatus = "ready_stream";
  } else if (!input.hasCredentials && secrets.size === 0) {
    softStatus = "missing_credentials";
  } else {
    softStatus = "incomplete";
  }

  return {
    ok: !incomplete,
    missing,
    mode: "stream",
    needsPublicUrl: false,
    transport: "stream",
    softStatus,
  };
}

/** i18n hint keys for DingTalk health card (order preserved). */
export function dingtalkHealthHintKeys(
  validation: DingtalkConfigValidation,
  extras?: {
    openAcl?: boolean;
    enableAiCard?: boolean;
  },
): string[] {
  const keys: string[] = [];
  keys.push("settings.remoteIm.health.hint.dingtalkStream");
  // Never claim Stream gateway is live from credentials alone
  keys.push("settings.remoteIm.health.hint.dingtalkNoLiveClaim");
  if (
    validation.softStatus === "incomplete" ||
    validation.softStatus === "missing_credentials"
  ) {
    keys.push("settings.remoteIm.health.hint.dingtalkMissingKeys");
  }
  if (extras?.enableAiCard) {
    keys.push("settings.remoteIm.health.hint.dingtalkAiCard");
  }
  if (extras?.openAcl) {
    keys.push("settings.remoteIm.health.hint.openAcl");
  }
  return keys;
}

/** Map soft status → short host/test message code (no secrets). */
export function dingtalkSoftStatusMessage(
  validation: DingtalkConfigValidation,
): string {
  switch (validation.softStatus) {
    case "ready_stream":
      return "dingtalk_stream_credentials_present";
    case "missing_credentials":
      return "missing_dingtalk_credentials";
    case "incomplete":
      return `missing_dingtalk_fields:${validation.missing.join(",") || "unknown"}`;
    default:
      return "missing_dingtalk_credentials";
  }
}

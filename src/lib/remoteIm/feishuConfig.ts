/**
 * Feishu / Lark pure config helpers — no I/O.
 *
 * Spec §6.1: WebSocket long connection (no public URL). Required bind fields
 * are App ID + App Secret. Soft status never claims a live WS session — only
 * credential / domain posture. Live tenant_access_token is host-side only.
 */

export type FeishuDomainKind = "feishu" | "lark" | "custom";

export type FeishuConfigValidation = {
  ok: boolean;
  /** Missing / invalid option / secret keys (never values) */
  missing: string[];
  /** Issues that do not block vault reuse but should warn in health */
  warnings: string[];
  domainKind: FeishuDomainKind;
  /** Resolved API host label (no secrets) */
  domainHost: string | null;
  /** Product transport: long-lived WS (webhook advanced fields are unused) */
  transport: "websocket";
  /** WebSocket never needs a public HTTPS callback */
  needsPublicUrl: false;
  /**
   * Soft status code for UI / host test mapping.
   * Never claims live WebSocket connectivity — only credential posture.
   */
  softStatus:
    | "ready_ws"
    | "missing_credentials"
    | "invalid_app_id_format"
    | "missing_custom_domain"
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
 * Normalize domain option → kind + host label.
 * Accepts GUI values (`open.feishu.cn` / `open.larksuite.com` / `custom`)
 * and short aliases (`feishu` / `lark`).
 */
export function normalizeFeishuDomain(
  options?: Record<string, unknown> | null,
  channelHint?: "feishu" | "lark" | string | null,
): { kind: FeishuDomainKind; host: string | null } {
  const raw = optionString(options, "domain");
  const custom = optionString(options, "custom_domain");

  if (raw === "custom") {
    return { kind: "custom", host: custom || null };
  }
  if (
    raw === "lark" ||
    raw === "open.larksuite.com" ||
    raw.toLowerCase() === "open.larksuite.com"
  ) {
    return { kind: "lark", host: "open.larksuite.com" };
  }
  if (
    raw === "feishu" ||
    raw === "open.feishu.cn" ||
    raw.toLowerCase() === "open.feishu.cn" ||
    raw === ""
  ) {
    // Empty domain: prefer channel default when binding Lark catalog entry
    if (channelHint === "lark" && !raw) {
      return { kind: "lark", host: "open.larksuite.com" };
    }
    return { kind: "feishu", host: "open.feishu.cn" };
  }
  // Unknown free-form domain string — treat as custom host
  return { kind: "custom", host: raw || custom || null };
}

/**
 * Soft App ID shape check. Feishu enterprise apps are usually `cli_…`.
 * Empty is "missing", not invalid. Rejects whitespace / obviously broken paste.
 */
export function isFeishuAppIdFormat(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (/\s/.test(t)) return false;
  if (t.length < 3 || t.length > 128) return false;
  // Prefer cli_… but allow other open-platform ids (alphanumeric + _ -)
  return /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(t);
}

/** Non-secret bind keys required for WS (§6.1). */
export function feishuRequiredNonSecretKeys(): readonly string[] {
  return ["app_id"];
}

/** Secret bind keys required for WS (§6.1). */
export function feishuRequiredSecretKeys(): readonly string[] {
  return ["app_secret"];
}

/** Optional advanced / options keys (not required for ready). */
export function feishuOptionalKeys(): readonly string[] {
  return [
    "domain",
    "custom_domain",
    "port",
    "callback_path",
    "encrypt_key",
    "enable_feishu_card",
    "group_reply_all",
    "group_only",
    "share_session_in_channel",
    "thread_isolation",
    "reply_to_trigger",
    "progress_style",
    "reaction_emoji",
    "done_emoji",
    "image_batch_window_ms",
    "resolve_mentions",
    "mention_map",
    "allow_from",
    "allow_chat",
    "require_mention",
  ];
}

/**
 * Parse Feishu mention_map advanced text: lines of `name=open_id` or `name:open_id`.
 * Empty / invalid lines skipped. Pure — no I/O.
 */
export function parseFeishuMentionMap(
  raw: string | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw == null) return out;
  const s = String(raw).trim();
  if (!s) return out;
  // JSON object paste
  if (s.startsWith("{")) {
    try {
      const obj = JSON.parse(s) as unknown;
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          const name = String(k).trim();
          const id = String(v ?? "").trim();
          if (name && id) out[name] = id;
        }
        return out;
      }
    } catch {
      // fall through to line parser
    }
  }
  for (const line of s.split(/[\n,;]+/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const sep = t.includes("=") ? "=" : t.includes(":") ? ":" : null;
    if (!sep) continue;
    const idx = t.indexOf(sep);
    const name = t.slice(0, idx).trim();
    const id = t.slice(idx + 1).trim();
    if (name && id) out[name] = id;
  }
  return out;
}

export type ValidateFeishuConfigInput = {
  options: Record<string, unknown>;
  /** Secret field keys currently non-empty in the form (never values). */
  secretKeysFilled?: ReadonlySet<string>;
  /** Vault already has credentials for this instance */
  hasCredentials?: boolean;
  /**
   * When the form has a non-empty app_id, pass for format check only.
   * Never logged or stored by this helper.
   */
  appIdValue?: string | null;
  /** Catalog channel id for domain default (feishu vs lark). */
  channel?: "feishu" | "lark" | string | null;
};

/**
 * Feishu/Lark bind validation (pure).
 * Does not read secret vault values — only key presence + optional format.
 */
export function validateFeishuConfig(
  input: ValidateFeishuConfigInput,
): FeishuConfigValidation {
  const missing: string[] = [];
  const warnings: string[] = [];
  const secrets = input.secretKeysFilled ?? new Set<string>();
  const { kind: domainKind, host: domainHost } = normalizeFeishuDomain(
    input.options,
    input.channel,
  );

  const appIdFromOptions = optionString(input.options, "app_id");
  const appIdRaw =
    (input.appIdValue != null && String(input.appIdValue).trim()
      ? String(input.appIdValue).trim()
      : "") || appIdFromOptions;

  if (!appIdRaw) {
    missing.push("app_id");
  }

  const secretFilled =
    secrets.has("app_secret") || secrets.has("appSecret");
  if (!secretFilled && !input.hasCredentials) {
    missing.push("app_secret");
  }

  if (domainKind === "custom" && !domainHost) {
    missing.push("custom_domain");
  }

  const formatInvalid = !!appIdRaw && !isFeishuAppIdFormat(appIdRaw);
  if (formatInvalid && !missing.includes("app_id")) {
    missing.push("app_id");
  }

  // Soft: card off — /p interactive buttons need card.action.trigger
  const cardRaw = input.options.enable_feishu_card;
  const cardOff =
    cardRaw === false || cardRaw === "false" || cardRaw === 0;
  if (cardOff) {
    warnings.push("feishu_card_off");
  }

  let softStatus: FeishuConfigValidation["softStatus"];
  if (formatInvalid) {
    softStatus = "invalid_app_id_format";
  } else if (
    domainKind === "custom" &&
    !domainHost &&
    missing.includes("custom_domain")
  ) {
    softStatus = "missing_custom_domain";
  } else if (missing.length === 0) {
    softStatus = "ready_ws";
  } else if (!input.hasCredentials && !secretFilled && !appIdRaw) {
    softStatus = "missing_credentials";
  } else if (!input.hasCredentials && secrets.size === 0 && !appIdRaw) {
    softStatus = "missing_credentials";
  } else if (
    !input.hasCredentials &&
    !secretFilled &&
    missing.includes("app_secret") &&
    missing.length === 1
  ) {
    softStatus = "missing_credentials";
  } else {
    softStatus = "incomplete";
  }

  const ok = missing.length === 0 && softStatus === "ready_ws";

  return {
    ok,
    missing,
    warnings,
    domainKind,
    domainHost,
    transport: "websocket",
    needsPublicUrl: false,
    softStatus,
  };
}

/** i18n hint keys for Feishu/Lark health card (order preserved). */
export function feishuHealthHintKeys(
  validation: FeishuConfigValidation,
  extras?: {
    openAcl?: boolean;
    enableFeishuCard?: boolean;
  },
): string[] {
  const keys: string[] = [];
  // Always state WS / no public URL (honest vs webhook products)
  keys.push("settings.remoteIm.health.hint.feishuWs");
  keys.push("settings.remoteIm.health.hint.feishuNoWebhook");

  if (validation.domainKind === "lark") {
    keys.push("settings.remoteIm.health.hint.feishuLarkDomain");
  } else if (validation.domainKind === "custom") {
    keys.push("settings.remoteIm.health.hint.feishuCustomDomain");
  }

  if (validation.softStatus === "invalid_app_id_format") {
    keys.push("settings.remoteIm.health.hint.feishuAppIdFormat");
  } else if (
    validation.softStatus === "missing_custom_domain" ||
    validation.missing.includes("custom_domain")
  ) {
    keys.push("settings.remoteIm.health.hint.feishuCustomDomainMissing");
  } else if (
    validation.softStatus === "incomplete" ||
    validation.softStatus === "missing_credentials"
  ) {
    keys.push("settings.remoteIm.health.hint.feishuMissingKeys");
  }

  if (extras?.enableFeishuCard !== false) {
    keys.push("settings.remoteIm.health.hint.feishuCardEvents");
  } else if (validation.warnings.includes("feishu_card_off")) {
    keys.push("settings.remoteIm.health.hint.feishuCardOff");
  }

  if (extras?.openAcl) {
    keys.push("settings.remoteIm.health.hint.openAcl");
  }
  return keys;
}

/** Map soft status → short host/test message code (no secrets). */
export function feishuSoftStatusMessage(
  validation: FeishuConfigValidation,
): string {
  switch (validation.softStatus) {
    case "ready_ws":
      return validation.domainKind === "lark"
        ? "feishu_ws_credentials_present_lark"
        : "feishu_ws_credentials_present";
    case "invalid_app_id_format":
      return "invalid_feishu_app_id_format";
    case "missing_custom_domain":
      return "missing_feishu_custom_domain";
    case "missing_credentials":
      return "missing_feishu_credentials";
    case "incomplete":
      return `missing_feishu_fields:${validation.missing.join(",") || "unknown"}`;
    default:
      return "missing_feishu_credentials";
  }
}

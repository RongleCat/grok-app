/**
 * Provider save / apply-path honesty.
 *
 * Product truth:
 * - Custom providers write agent-home `config.toml` via Host `providers_upsert`.
 * - When the mutated provider is the **active** route (or set as default), Host
 *   recycles warm agents (`provider_route`) so the next message reloads
 *   base_url / api_key / auth — **soft_respawn**, not a full app restart.
 * - Editing a non-active provider only updates disk → **saved_disk_only**
 *   (next activate / Use applies it).
 * - Browser / non-Tauri cannot call Host → **host_only** (never claim live apply).
 *
 * Pure helpers — no I/O. UI translates returned message keys via `t()`.
 */

/** How a successful provider save takes effect. */
export type ProviderApplyEffect =
  | "soft_respawn"
  | "saved_disk_only"
  | "host_only";

/** Soft-fail kinds for provider upsert / save host errors. */
export type ProviderSaveErrorKind =
  | "timeout"
  | "validation"
  | "network"
  | "host_only"
  | "other";

/** Soft-fail kinds for providers_ping / list-models network probes. */
export type ProviderPingErrorKind =
  | "timeout"
  | "network"
  | "auth"
  | "host_only"
  | "invalid_url"
  | "other";

/** Empty / honesty states for the providers list surface. */
export type ProvidersEmptyKind =
  | "host_only"
  | "no_custom"
  | "load_error"
  | "ok";

export type ProvidersEmptyState = {
  kind: ProvidersEmptyKind;
  /** Primary i18n message key (null when ok). */
  messageKey: string | null;
  severity: "none" | "info" | "warn" | "err";
};

export type RemoteProviderModelCapability = {
  id: string;
  supportsBackendSearch?: boolean;
};

/**
 * Models that prevent an explicitly selected Grok Build-compatible relay mode
 * from being saved after a live catalog has been fetched.
 *
 * An absent model and an omitted/false capability claim are both unsupported.
 * An empty remote list means no successful catalog read is available yet, so
 * the backend save-time probe remains authoritative and the UI stays neutral.
 */
export function unsupportedGrokBuildProxyModels(input: {
  providerMode: string;
  selectedModelIds: string[];
  remoteModels: RemoteProviderModelCapability[];
}): string[] {
  if (
    input.providerMode !== "grok_build_proxy" ||
    input.remoteModels.length === 0
  ) {
    return [];
  }
  const remote = new Map(input.remoteModels.map((model) => [model.id, model]));
  return input.selectedModelIds
    .map((id) => id.trim())
    .filter(Boolean)
    .filter((id) => remote.get(id)?.supportsBackendSearch !== true);
}

/**
 * Resolve when a successful upsert apply path takes effect.
 *
 * - `!isTauri` → host_only (no Host IPC; never claim reload)
 * - `needsReload` (active route / setAsDefault) → soft_respawn
 * - otherwise → saved_disk_only
 */
export function resolveProviderApplyEffect(input: {
  needsReload: boolean;
  isTauri: boolean;
}): ProviderApplyEffect {
  if (!input.isTauri) return "host_only";
  if (input.needsReload) return "soft_respawn";
  return "saved_disk_only";
}

/**
 * Stable i18n key for a post-save apply toast / inline banner.
 * Keys live under `prov.apply.*` (en/zh/zh-TW).
 */
export function buildProviderApplyToastKey(
  effect: ProviderApplyEffect,
): string {
  switch (effect) {
    case "soft_respawn":
      return "prov.apply.softRespawn";
    case "saved_disk_only":
      return "prov.apply.savedDiskOnly";
    case "host_only":
      return "prov.apply.hostOnly";
  }
}

/** i18n key for a classified provider save error. */
export function providerSaveErrorMessageKey(
  kind: ProviderSaveErrorKind,
): string {
  switch (kind) {
    case "timeout":
      return "prov.err.saveTimeout";
    case "validation":
      return "prov.err.validation";
    case "network":
      return "prov.err.network";
    case "host_only":
      return "prov.err.hostOnly";
    case "other":
      return "prov.err.other";
  }
}

/** i18n key for a classified ping / fetch-models error. */
export function providerPingErrorMessageKey(
  kind: ProviderPingErrorKind,
): string {
  switch (kind) {
    case "timeout":
      return "prov.ping.err.timeout";
    case "network":
      return "prov.ping.err.network";
    case "auth":
      return "prov.ping.err.auth";
    case "host_only":
      return "prov.ping.err.hostOnly";
    case "invalid_url":
      return "prov.ping.err.invalidUrl";
    case "other":
      return "prov.ping.err.other";
  }
}

/**
 * Classify free-form host / IPC errors from provider save (upsert) paths.
 * Soft kinds only — never invents success.
 */
export function classifyProviderSaveError(err: unknown): ProviderSaveErrorKind {
  const s = errText(err).toLowerCase();
  const code = errCode(err);

  if (code === "timeout" || code === "timed_out" || code === "deadline_exceeded") {
    return "timeout";
  }
  if (code === "host_only" || code === "need_tauri" || code === "unsupported") {
    return "host_only";
  }
  if (
    code === "validation" ||
    code === "invalid" ||
    code === "invalid_argument" ||
    code === "bad_request"
  ) {
    return "validation";
  }
  if (
    code === "network" ||
    code === "econnrefused" ||
    code === "enotfound" ||
    code === "econnreset"
  ) {
    return "network";
  }

  if (!s) return "other";

  if (isHostOnlyText(s)) return "host_only";
  if (
    /timed?\s*out|timeout|taking too long|deadline|save is taking/i.test(s)
  ) {
    return "timeout";
  }
  if (
    /already exists|required|invalid|validation|empty (base|url|key|model)|need (base|key|model)|unknown provider|not found|malformed|bad request|must (be|have)/i.test(
      s,
    )
  ) {
    return "validation";
  }
  if (isNetworkText(s)) return "network";
  return "other";
}

/**
 * Classify free-form errors from `providers_ping` / list-models probes.
 * Soft kinds only — never invents reachability success.
 */
export function classifyProviderPingError(err: unknown): ProviderPingErrorKind {
  const s = errText(err).toLowerCase();
  const code = errCode(err);

  if (code === "timeout" || code === "timed_out") return "timeout";
  if (code === "host_only" || code === "need_tauri" || code === "unsupported") {
    return "host_only";
  }
  if (
    code === "auth" ||
    code === "unauthorized" ||
    code === "forbidden" ||
    code === "401" ||
    code === "403"
  ) {
    return "auth";
  }
  if (
    code === "invalid_url" ||
    code === "bad_url" ||
    code === "invalid_uri"
  ) {
    return "invalid_url";
  }
  if (
    code === "network" ||
    code === "econnrefused" ||
    code === "enotfound" ||
    code === "econnreset"
  ) {
    return "network";
  }

  if (!s) return "other";

  if (isHostOnlyText(s)) return "host_only";
  if (/timed?\s*out|timeout|deadline|abort/i.test(s)) return "timeout";
  if (
    /invalid\s*url|bad url|url parse|malformed url|failed to parse|relative url without a base/i.test(
      s,
    )
  ) {
    return "invalid_url";
  }
  if (
    /\b401\b|\b403\b|unauthorized|forbidden|invalid api.?key|authentication|auth failed|oidc/i.test(
      s,
    )
  ) {
    return "auth";
  }
  if (isNetworkText(s)) return "network";
  return "other";
}

/**
 * Resolve contextual empty copy for the providers list rail.
 * Returns `ok` (messageKey null) when the list has content and Host is available.
 */
export function resolveProvidersEmptyState(input: {
  isTauri: boolean;
  /** Number of custom (non-official) providers. */
  customCount: number;
  /** Optional load/list error already surfaced. */
  loadError?: string | null;
}): ProvidersEmptyState {
  if (input.isTauri === false) {
    return {
      kind: "host_only",
      messageKey: "prov.empty.hostOnly",
      severity: "warn",
    };
  }
  const loadErr = (input.loadError ?? "").trim();
  if (loadErr) {
    return {
      kind: "load_error",
      messageKey: "prov.empty.loadError",
      severity: "err",
    };
  }
  const n = Math.max(0, Math.floor(input.customCount || 0));
  if (n === 0) {
    return {
      kind: "no_custom",
      messageKey: "prov.empty.noCustom",
      severity: "info",
    };
  }
  return { kind: "ok", messageKey: null, severity: "none" };
}

// ── Internal ──────────────────────────────────────────────────────────────

function errText(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const code =
      typeof (err as Error & { code?: unknown }).code === "string"
        ? String((err as Error & { code?: string }).code)
        : "";
    return `${code} ${err.message} ${err.name}`.trim();
  }
  if (typeof err === "object") {
    const o = err as {
      code?: unknown;
      message?: unknown;
      reason?: unknown;
      error?: unknown;
    };
    const parts = [o.code, o.message, o.reason, o.error]
      .filter((x) => x != null && String(x).trim())
      .map(String);
    if (parts.length) return parts.join(" ");
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

function errCode(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    const c = (err as { code?: unknown }).code;
    if (typeof c === "string") return c.trim().toLowerCase();
    if (typeof c === "number" && Number.isFinite(c)) return String(c);
  }
  return "";
}

function isHostOnlyText(s: string): boolean {
  return (
    s.includes("need tauri") ||
    s.includes("need_tauri") ||
    s.includes("requires the tauri") ||
    s.includes("requires the desktop") ||
    s.includes("host only") ||
    s.includes("host_only") ||
    s.includes("not in tauri") ||
    s.includes("not available in browser") ||
    s.includes("desktop only") ||
    s.includes("desktop app") ||
    s.includes("not a tauri") ||
    s.includes("tauri window")
  );
}

function isNetworkText(s: string): boolean {
  return (
    s.includes("network") ||
    s.includes("econnrefused") ||
    s.includes("enotfound") ||
    s.includes("econnreset") ||
    s.includes("eai_again") ||
    s.includes("dns") ||
    s.includes("connection refused") ||
    s.includes("connection reset") ||
    s.includes("failed to fetch") ||
    s.includes("fetch failed") ||
    s.includes("socket") ||
    s.includes("tls") ||
    s.includes("ssl") ||
    s.includes("certificate") ||
    s.includes("unreachable") ||
    s.includes("no route") ||
    /\bhttp\s*[45]\d\d\b/.test(s) ||
    s.includes("status code")
  );
}

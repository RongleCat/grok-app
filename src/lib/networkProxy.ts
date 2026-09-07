/**
 * Network proxy pro — pure Settings helpers for proxy mode / URL validation
 * and connectivity-probe honesty.
 *
 * Aligns with Host `src-tauri/src/proxy.rs`:
 * - modes: system | manual | none
 * - URL schemes: http | https | socks5 | socks5h (host required)
 * - invalid manual URL soft-falls back to Inherit (env), not silent Direct
 * - `network_probe` is a short HTTP path check through the effective proxy —
 *   not auth, not a tunnel, not a streaming guarantee
 *
 * No I/O. Message keys are stable strings for createT / MessageKey registration.
 */

// ── Modes ───────────────────────────────────────────────────────────────────

export const PROXY_MODES = ["system", "manual", "none"] as const;
export type ProxyMode = (typeof PROXY_MODES)[number];
export const DEFAULT_PROXY_MODE: ProxyMode = "system";

const PROXY_MODE_SET = new Set<string>(PROXY_MODES);

/** Known aliases that normalize to a ProxyMode. */
const MODE_ALIASES: Record<string, ProxyMode> = {
  system: "system",
  os: "system",
  auto: "system",
  default: "system",
  manual: "manual",
  custom: "manual",
  url: "manual",
  none: "none",
  direct: "none",
  off: "none",
  disabled: "none",
  "no-proxy": "none",
  noproxy: "none",
  "no_proxy": "none",
};

export function isProxyMode(raw: unknown): raw is ProxyMode {
  if (typeof raw !== "string") return false;
  return PROXY_MODE_SET.has(raw.trim().toLowerCase());
}

/**
 * Normalize a settings / host value to a known proxy mode.
 * Unknown / empty → {@link DEFAULT_PROXY_MODE} (`system`). The legacy
 * effective-decision label `use` only means Manual when it is paired with a
 * valid persisted URL; otherwise it safely falls back to System.
 */
export function normalizeProxyMode(
  raw: unknown,
  proxyUrl?: string | null,
): ProxyMode {
  if (raw == null) return DEFAULT_PROXY_MODE;
  const s = String(raw).trim().toLowerCase();
  if (!s) return DEFAULT_PROXY_MODE;
  if (PROXY_MODE_SET.has(s)) return s as ProxyMode;
  if (s === "use") {
    return isValidProxyUrl(proxyUrl) ? "manual" : DEFAULT_PROXY_MODE;
  }
  const alias = MODE_ALIASES[s];
  if (alias) return alias;
  return DEFAULT_PROXY_MODE;
}

// ── URL validation ──────────────────────────────────────────────────────────

/** Schemes Host `is_valid_proxy_url` accepts. */
export const PROXY_URL_SCHEMES = [
  "http",
  "https",
  "socks5",
  "socks5h",
] as const;
export type ProxyUrlScheme = (typeof PROXY_URL_SCHEMES)[number];

const SCHEME_SET = new Set<string>(PROXY_URL_SCHEMES);

export type ProxyUrlError =
  | "empty"
  | "missing_scheme"
  | "unsupported_scheme"
  | "missing_host"
  | "invalid_url";

export type ValidateProxyUrlResult =
  | { ok: true; normalized: string; scheme: ProxyUrlScheme; host: string }
  | { ok: false; error: ProxyUrlError };

/**
 * Validate a user-entered proxy URL (Manual mode).
 * Empty → `{ ok: false, error: "empty" }` (callers treat empty as soft-fail
 * when Manual is selected — Host inherits env).
 */
export function validateProxyUrl(
  raw: string | null | undefined,
): ValidateProxyUrlResult {
  if (raw == null) return { ok: false, error: "empty" };
  const trimmed = String(raw).trim();
  if (!trimmed) return { ok: false, error: "empty" };

  // Bare host:port without scheme
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    return { ok: false, error: "missing_scheme" };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "invalid_url" };
  }

  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (!SCHEME_SET.has(scheme)) {
    return { ok: false, error: "unsupported_scheme" };
  }

  const host = parsed.hostname;
  if (!host) {
    return { ok: false, error: "missing_host" };
  }

  return {
    ok: true,
    normalized: trimmed,
    scheme: scheme as ProxyUrlScheme,
    host,
  };
}

/** True when non-empty URL parses with a supported scheme + host. */
export function isValidProxyUrl(raw: string | null | undefined): boolean {
  return validateProxyUrl(raw).ok;
}

/**
 * Soft-fail when Manual mode has empty/invalid URL (Host inherits env).
 * Empty string is only soft-fail when mode is manual.
 */
export function manualProxyUrlSoftFail(
  mode: unknown,
  url: string | null | undefined,
): ProxyUrlError | null {
  if (normalizeProxyMode(mode, url) !== "manual") return null;
  const v = validateProxyUrl(url);
  if (v.ok) return null;
  return v.error;
}

/** i18n key for a proxy URL validation error. */
export function proxyUrlErrorMessageKey(error: ProxyUrlError): string {
  switch (error) {
    case "empty":
      return "settings.proxyUrlError.empty";
    case "missing_scheme":
      return "settings.proxyUrlError.missingScheme";
    case "unsupported_scheme":
      return "settings.proxyUrlError.unsupportedScheme";
    case "missing_host":
      return "settings.proxyUrlError.missingHost";
    case "invalid_url":
      return "settings.proxyUrlError.invalid";
  }
}

// ── Probe classification ────────────────────────────────────────────────────

/** Single target shape from Host `network_probe` (camelCase JSON). */
export type NetworkProbeTargetInput = {
  key?: unknown;
  url?: unknown;
  ok?: unknown;
  status?: unknown;
  error?: unknown;
  millis?: unknown;
};

export type NetworkProbeResultInput = {
  allOk?: unknown;
  targets?: unknown;
};

/**
 * Per-target reachability class.
 * Host marks `ok: true` for any HTTP response (incl. 401/404).
 */
export type NetworkProbeTargetClass =
  | "ok"
  | "fail_timeout"
  | "fail_dns"
  | "fail_connect"
  | "fail_proxy"
  | "fail_tls"
  | "fail_other";

/**
 * Aggregate probe outcome for summary chips.
 *
 * - `all_ok` / `partial` / `all_fail` — from host targets
 * - `empty` — host returned no targets
 * - `error` — invoke threw / non-desktop
 * - `unavailable` — explicitly not runnable (e.g. not Tauri)
 */
export type NetworkProbeOutcome =
  | "all_ok"
  | "partial"
  | "all_fail"
  | "empty"
  | "error"
  | "unavailable";

export type NetworkProbeTone = "ok" | "warn" | "err" | "muted";

export type ClassifiedProbeTarget = {
  key: string;
  url: string;
  ok: boolean;
  status: number | null;
  millis: number;
  error: string | null;
  klass: NetworkProbeTargetClass;
};

export type ClassifiedProbeResult = {
  outcome: NetworkProbeOutcome;
  tone: NetworkProbeTone;
  allOk: boolean;
  okCount: number;
  failCount: number;
  targets: ClassifiedProbeTarget[];
  /** Host invoke failure text when outcome is `error`. */
  invokeError: string | null;
};

/**
 * Classify a single target error string into a stable kind.
 * Pure heuristics on reqwest / OS error Display text — never invents success.
 */
export function classifyProbeTargetError(
  error: string | null | undefined,
  ok: boolean,
): NetworkProbeTargetClass {
  if (ok) return "ok";
  const m = (error ?? "").toLowerCase();
  if (!m.trim()) return "fail_other";

  if (
    m.includes("timed out") ||
    m.includes("timeout") ||
    m.includes("deadline exceeded") ||
    m.includes("operation timed out")
  ) {
    return "fail_timeout";
  }

  if (
    m.includes("dns") ||
    m.includes("name resolution") ||
    m.includes("nodename nor servname") ||
    m.includes("no such host") ||
    m.includes("getaddrinfo") ||
    m.includes("could not resolve") ||
    m.includes("failed to lookup")
  ) {
    return "fail_dns";
  }

  if (
    m.includes("proxy") ||
    m.includes("socks") ||
    m.includes("tunnel") ||
    m.includes("407") ||
    m.includes("http connect")
  ) {
    return "fail_proxy";
  }

  if (
    m.includes("tls") ||
    m.includes("ssl") ||
    m.includes("certificate") ||
    m.includes("cert ") ||
    m.includes("handshake")
  ) {
    return "fail_tls";
  }

  if (
    m.includes("connection refused") ||
    m.includes("connection reset") ||
    m.includes("network unreachable") ||
    m.includes("host unreachable") ||
    m.includes("no route to host") ||
    m.includes("connect error") ||
    m.includes("failed to connect") ||
    m.includes("connection error") ||
    m.includes("broken pipe") ||
    m.includes("network is down")
  ) {
    return "fail_connect";
  }

  return "fail_other";
}

export function probeTargetClassMessageKey(
  klass: NetworkProbeTargetClass,
): string {
  switch (klass) {
    case "ok":
      return "settings.netProbe.target.ok";
    case "fail_timeout":
      return "settings.netProbe.target.timeout";
    case "fail_dns":
      return "settings.netProbe.target.dns";
    case "fail_connect":
      return "settings.netProbe.target.connect";
    case "fail_proxy":
      return "settings.netProbe.target.proxy";
    case "fail_tls":
      return "settings.netProbe.target.tls";
    case "fail_other":
      return "settings.netProbe.target.other";
  }
}

export function probeOutcomeMessageKey(outcome: NetworkProbeOutcome): string {
  switch (outcome) {
    case "all_ok":
      return "settings.netProbe.outcome.allOk";
    case "partial":
      return "settings.netProbe.outcome.partial";
    case "all_fail":
      return "settings.netProbe.outcome.allFail";
    case "empty":
      return "settings.netProbe.outcome.empty";
    case "error":
      return "settings.netProbe.outcome.error";
    case "unavailable":
      return "settings.netProbe.outcome.unavailable";
  }
}

export function probeOutcomeTone(outcome: NetworkProbeOutcome): NetworkProbeTone {
  switch (outcome) {
    case "all_ok":
      return "ok";
    case "partial":
      return "warn";
    case "all_fail":
    case "error":
      return "err";
    case "empty":
    case "unavailable":
      return "muted";
  }
}

function asFiniteNonNeg(raw: unknown, fallback = 0): number {
  if (raw == null || raw === "") return fallback;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

function asTrimmedString(raw: unknown): string {
  if (raw == null) return "";
  return String(raw).trim();
}

/**
 * Normalize one host probe target into a classified row.
 */
export function classifyProbeTarget(
  raw: NetworkProbeTargetInput | null | undefined,
): ClassifiedProbeTarget {
  const key = asTrimmedString(raw?.key) || "unknown";
  const url = asTrimmedString(raw?.url);
  const ok = raw?.ok === true;
  const statusRaw = raw?.status;
  let status: number | null = null;
  if (statusRaw != null && statusRaw !== "") {
    const n = typeof statusRaw === "number" ? statusRaw : Number(statusRaw);
    if (Number.isFinite(n)) status = Math.floor(n);
  }
  const millis = asFiniteNonNeg(raw?.millis);
  const errorRaw = asTrimmedString(raw?.error);
  const error = errorRaw || null;
  const klass = classifyProbeTargetError(error, ok);
  return { key, url, ok, status, millis, error, klass };
}

/**
 * Classify a full Host `network_probe` result (or invoke failure).
 *
 * @param result Host JSON when invoke succeeded
 * @param opts.invokeError set when `network_probe` threw
 * @param opts.available false when not on desktop / probe disabled
 */
export function classifyProbeResult(
  result: NetworkProbeResultInput | null | undefined,
  opts?: {
    invokeError?: string | null;
    available?: boolean;
  },
): ClassifiedProbeResult {
  if (opts?.available === false) {
    return {
      outcome: "unavailable",
      tone: "muted",
      allOk: false,
      okCount: 0,
      failCount: 0,
      targets: [],
      invokeError: null,
    };
  }

  const invokeError = asTrimmedString(opts?.invokeError) || null;
  if (invokeError) {
    return {
      outcome: "error",
      tone: "err",
      allOk: false,
      okCount: 0,
      failCount: 0,
      targets: [],
      invokeError,
    };
  }

  const list = Array.isArray(result?.targets) ? result!.targets! : [];
  const targets = list.map((t) =>
    classifyProbeTarget(
      t && typeof t === "object"
        ? (t as NetworkProbeTargetInput)
        : undefined,
    ),
  );

  if (targets.length === 0) {
    return {
      outcome: "empty",
      tone: "muted",
      allOk: false,
      okCount: 0,
      failCount: 0,
      targets: [],
      invokeError: null,
    };
  }

  const okCount = targets.filter((t) => t.ok).length;
  const failCount = targets.length - okCount;
  const allOk = failCount === 0;
  let outcome: NetworkProbeOutcome;
  if (allOk) outcome = "all_ok";
  else if (okCount === 0) outcome = "all_fail";
  else outcome = "partial";

  return {
    outcome,
    tone: probeOutcomeTone(outcome),
    allOk,
    okCount,
    failCount,
    targets,
    invokeError: null,
  };
}

// ── Apply / restart honesty ─────────────────────────────────────────────────

/**
 * Apply-scope honesty for Settings copy.
 *
 * Host re-reads settings on each `network_probe` and child spawn.
 * Warm ACP sessions keep prior env until reconnect.
 */
export type ProxyApplyScope =
  | "saved"
  | "app_http"
  | "new_agents"
  | "reconnect"
  | "probe_effective"
  | "manual_invalid_inherit";

export function proxyApplyMessageKey(scope: ProxyApplyScope): string {
  switch (scope) {
    case "saved":
      return "settings.proxy.apply.saved";
    case "app_http":
      return "settings.proxy.apply.appHttp";
    case "new_agents":
      return "settings.proxy.apply.newAgents";
    case "reconnect":
      return "settings.proxy.apply.reconnect";
    case "probe_effective":
      return "settings.proxy.apply.probeEffective";
    case "manual_invalid_inherit":
      return "settings.proxy.apply.manualInvalidInherit";
  }
}

/**
 * Ordered apply-honesty scopes for the Network tab (always show core three;
 * add manual-invalid when URL soft-fails).
 */
export function proxyApplyHonestyScopes(
  mode: unknown,
  url: string | null | undefined,
): ProxyApplyScope[] {
  const scopes: ProxyApplyScope[] = [
    "saved",
    "new_agents",
    "reconnect",
    "probe_effective",
  ];
  if (manualProxyUrlSoftFail(mode, url)) {
    scopes.push("manual_invalid_inherit");
  }
  return scopes;
}

/** Chip CSS modifier from tone (`is-ok` / `is-warn` / `is-fail` / muted bare). */
export function probeToneClass(tone: NetworkProbeTone): string {
  switch (tone) {
    case "ok":
      return "is-ok";
    case "warn":
      return "is-warn";
    case "err":
      return "is-fail";
    case "muted":
      return "is-muted";
  }
}

/**
 * Soft-fail message when Manual mode URL is invalid (Host inherits).
 * Prefer specific URL error keys; fall back to generic invalid.
 */
export function proxySoftFailMessageKey(
  mode: unknown,
  url: string | null | undefined,
): string | null {
  const err = manualProxyUrlSoftFail(mode, url);
  if (!err) return null;
  return proxyUrlErrorMessageKey(err);
}

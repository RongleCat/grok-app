/**
 * Provider balance probe honesty helpers.
 * Phase 1: DeepSeek official balance only — never invent amounts.
 */

export type ProviderBalanceErrorKind =
  | "auth"
  | "network"
  | "timeout"
  | "unsupported"
  | "host_only"
  | "other";

/** Whether this channel can call DeepSeek's official balance API. */
export function supportsProviderBalance(opts: {
  providerId?: string | null;
  baseUrl?: string | null;
}): boolean {
  const host = hostFromBaseUrl(opts.baseUrl);
  if (host === "api.deepseek.com" || host.endsWith(".api.deepseek.com")) {
    return true;
  }
  const id = (opts.providerId ?? "").trim().toLowerCase();
  if (!id) return false;
  return id === "deepseek" || id.startsWith("deepseek-") || id.endsWith("-deepseek");
}

export function hostFromBaseUrl(baseUrl?: string | null): string {
  const raw = (baseUrl ?? "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).host.toLowerCase();
  } catch {
    const rest = raw.replace(/^https?:\/\//i, "");
    return (rest.split("/")[0] ?? "").toLowerCase();
  }
}

/** Classify balance probe failures for soft-fail UI (never invent totals). */
export function classifyProviderBalanceError(input: {
  errorKind?: string | null;
  error?: string | null;
  isTauri?: boolean;
}): ProviderBalanceErrorKind {
  if (input.isTauri === false) return "host_only";
  const kind = (input.errorKind ?? "").toLowerCase();
  if (
    kind === "auth" ||
    kind === "network" ||
    kind === "timeout" ||
    kind === "unsupported" ||
    kind === "other"
  ) {
    return kind;
  }
  const msg = (input.error ?? "").toLowerCase();
  if (!msg) return "other";
  if (
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("unauthorized") ||
    msg.includes("api_key") ||
    msg.includes("api key")
  ) {
    return "auth";
  }
  if (msg.includes("timed out") || msg.includes("timeout")) return "timeout";
  if (
    msg.includes("network") ||
    msg.includes("dns") ||
    msg.includes("connect") ||
    msg.includes("fetch failed")
  ) {
    return "network";
  }
  if (msg.includes("unsupported") || msg.includes("only supported")) {
    return "unsupported";
  }
  return "other";
}

/** i18n key under `prov.balance.err.*`. */
export function providerBalanceErrorMessageKey(
  kind: ProviderBalanceErrorKind,
): string {
  switch (kind) {
    case "auth":
      return "prov.balance.err.auth";
    case "network":
      return "prov.balance.err.network";
    case "timeout":
      return "prov.balance.err.timeout";
    case "unsupported":
      return "prov.balance.err.unsupported";
    case "host_only":
      return "prov.balance.err.hostOnly";
    default:
      return "prov.balance.err.other";
  }
}

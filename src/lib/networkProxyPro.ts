/**
 * Network proxy probe pro — pure Settings helpers for empty/apply banners
 * and probe summary + retry CTA honesty.
 *
 * Builds on `networkProxy` (mode / URL / classify). No I/O. Message keys are
 * stable strings for createT / MessageKey registration.
 *
 * Honesty:
 * - Connectivity check is host-only (desktop Tauri).
 * - Probe is a short HTTP path check — not auth, not a tunnel, not streaming.
 * - Manual invalid/empty URL soft-fails to inherit env (never forced Direct).
 * - Never invents reachable targets when the host returns empty/error.
 */

import {
  isValidProxyUrl,
  normalizeProxyMode,
  probeOutcomeMessageKey,
  probeOutcomeTone,
  probeToneClass,
  proxyApplyHonestyScopes,
  proxyApplyMessageKey,
  type ClassifiedProbeResult,
  type NetworkProbeOutcome,
  type NetworkProbeTone,
  type ProxyApplyScope,
  type ProxyMode,
} from "./networkProxy";

// ── Empty state (probe results surface) ─────────────────────────────────────

/**
 * Contextual empty / soft-fail surfaces for the connectivity check body.
 * Returns `null` when the target list (or chip-only result) should render.
 */
export type NetworkProxyEmptyKind =
  | "host_only"
  | "idle"
  | "empty_targets"
  | "probe_error";

export type NetworkProxyEmptyState = {
  kind: NetworkProxyEmptyKind;
  titleKey: string;
  hintKey: string;
  softFail: boolean;
  /** Offer Retry CTA (desktop + re-runnable outcome). */
  showRetry: boolean;
};

export type NetworkProxyEmptyInput = {
  /** Desktop Tauri host available (`api.isTauri()`). */
  isDesktop: boolean;
  /** Probe in flight. */
  probing?: boolean;
  /**
   * Last classified result.
   * `null` / `undefined` = never run (idle) once not probing.
   */
  classified?: ClassifiedProbeResult | null;
};

/**
 * Resolve empty / host-only honesty for the Network probe results area.
 *
 * Priority:
 * 1. !isDesktop → host_only (soft-fail; no retry)
 * 2. probing → null (show spinner on primary button)
 * 3. classified null → idle (soft; no retry — first run uses primary)
 * 4. outcome unavailable → host_only
 * 5. outcome error → probe_error (+ retry)
 * 6. outcome empty → empty_targets (+ retry)
 * 7. otherwise null (chip + optional target list)
 *
 * Never invents targets when the host returned none.
 */
export function resolveNetworkProxyEmptyState(
  input: NetworkProxyEmptyInput,
): NetworkProxyEmptyState | null {
  if (!input.isDesktop) {
    return {
      kind: "host_only",
      titleKey: "settings.netProbe.empty.hostOnly",
      hintKey: "settings.netProbe.empty.hostOnlyHint",
      softFail: true,
      showRetry: false,
    };
  }

  if (input.probing) return null;

  const classified = input.classified;
  if (classified == null) {
    return {
      kind: "idle",
      titleKey: "settings.netProbe.empty.idle",
      hintKey: "settings.netProbe.empty.idleHint",
      softFail: false,
      showRetry: false,
    };
  }

  if (classified.outcome === "unavailable") {
    return {
      kind: "host_only",
      titleKey: "settings.netProbe.empty.hostOnly",
      hintKey: "settings.netProbe.empty.hostOnlyHint",
      softFail: true,
      showRetry: false,
    };
  }

  if (classified.outcome === "error") {
    return {
      kind: "probe_error",
      titleKey: "settings.netProbe.empty.error",
      hintKey: "settings.netProbe.empty.errorHint",
      softFail: true,
      showRetry: true,
    };
  }

  if (classified.outcome === "empty") {
    return {
      kind: "empty_targets",
      titleKey: "settings.netProbe.empty.noTargets",
      hintKey: "settings.netProbe.empty.noTargetsHint",
      softFail: true,
      showRetry: true,
    };
  }

  // all_ok / partial / all_fail → list or chip; not an empty surface
  return null;
}

// ── Apply honesty banners ───────────────────────────────────────────────────

export type ProxyApplyHonestyTone = "muted" | "danger";

export type ProxyApplyHonestyLine = {
  scope: ProxyApplyScope;
  messageKey: string;
  tone: ProxyApplyHonestyTone;
};

/**
 * Structured apply-path honesty for Settings → Network.
 *
 * - `valid: false` in manual mode → include manual_invalid_inherit banner.
 * - When `valid` is omitted, derive from `url` via {@link isValidProxyUrl}
 *   (non-manual modes always count as valid).
 */
export type ProxyApplyHonesty = {
  mode: ProxyMode;
  /** True when Manual URL is usable, or mode is not Manual. */
  valid: boolean;
  lines: ProxyApplyHonestyLine[];
  /** Emphasized banner when Manual URL soft-fails. */
  showManualInvalidBanner: boolean;
  manualInvalidMessageKey: string | null;
};

/**
 * Resolve ordered apply-honesty lines for the Network tab.
 *
 * @param input.mode proxy mode (normalized)
 * @param input.valid optional explicit validity; when omitted, uses `url`
 * @param input.url optional Manual URL (used when `valid` omitted)
 */
export function resolveProxyApplyHonesty(input: {
  mode: unknown;
  valid?: boolean;
  url?: string | null;
}): ProxyApplyHonesty {
  const mode = normalizeProxyMode(input.mode, input.url);
  let valid: boolean;
  if (typeof input.valid === "boolean") {
    valid = input.valid;
  } else if (mode === "manual") {
    valid = isValidProxyUrl(input.url);
  } else {
    valid = true;
  }

  // Reuse core scope list: pass a synthetic URL when `valid` is explicit.
  const urlForScopes =
    mode === "manual"
      ? valid
        ? input.url && String(input.url).trim()
          ? String(input.url)
          : "http://127.0.0.1:1"
        : ""
      : input.url ?? "";

  const scopes = proxyApplyHonestyScopes(mode, urlForScopes);
  // When valid is explicitly false, ensure manual_invalid_inherit is present.
  if (mode === "manual" && !valid && !scopes.includes("manual_invalid_inherit")) {
    scopes.push("manual_invalid_inherit");
  }
  // When valid is explicitly true, drop inherit banner even if url looks empty.
  const finalScopes =
    mode === "manual" && valid
      ? scopes.filter((s) => s !== "manual_invalid_inherit")
      : scopes;

  const lines: ProxyApplyHonestyLine[] = finalScopes.map((scope) => ({
    scope,
    messageKey: proxyApplyMessageKey(scope),
    tone: scope === "manual_invalid_inherit" ? "danger" : "muted",
  }));

  const showManualInvalidBanner = lines.some(
    (l) => l.scope === "manual_invalid_inherit",
  );

  return {
    mode,
    valid,
    lines,
    showManualInvalidBanner,
    manualInvalidMessageKey: showManualInvalidBanner
      ? proxyApplyMessageKey("manual_invalid_inherit")
      : null,
  };
}

// ── Probe summary + retry CTA ───────────────────────────────────────────────

export type ProbePrimaryActionKey =
  | "settings.netProbeRun"
  | "settings.netProbeTesting";

/**
 * Presentation payload for the connectivity check chip / actions / empty.
 * Pure — caller runs `t(key, vars)`.
 *
 * Retry is a separate CTA (`showRetry`) so Run stays the first-run label and
 * empty banners can host their own Retry without double-label confusion.
 */
export type ProbeSummaryPresentation = {
  outcome: NetworkProbeOutcome | null;
  tone: NetworkProbeTone;
  toneClass: string;
  outcomeKey: string | null;
  okCount: number;
  failCount: number;
  showCounts: boolean;
  showChip: boolean;
  showTargetList: boolean;
  /** Desktop + re-runnable outcome — show Retry CTA (not host-only / idle / all_ok). */
  showRetry: boolean;
  primaryActionKey: ProbePrimaryActionKey;
  empty: NetworkProxyEmptyState | null;
  invokeError: string | null;
};

/**
 * Whether a classified outcome should offer Retry (desktop only).
 * Host-only / idle never retry; error / empty / fail / partial do.
 */
export function probeOutcomeOffersRetry(
  outcome: NetworkProbeOutcome | null | undefined,
  isDesktop: boolean,
): boolean {
  if (!isDesktop) return false;
  if (outcome == null) return false;
  switch (outcome) {
    case "error":
    case "empty":
    case "all_fail":
    case "partial":
      return true;
    case "all_ok":
    case "unavailable":
      return false;
  }
}

/**
 * Format classified probe result into UI presentation (summary + CTAs).
 *
 * - Host-only → empty banner, disabled retry, no invented counts.
 * - After a re-runnable failure → primary becomes Retry.
 * - Target list only when host returned rows.
 */
export function formatProbeSummary(input: {
  classified: ClassifiedProbeResult | null | undefined;
  isDesktop: boolean;
  probing?: boolean;
}): ProbeSummaryPresentation {
  const probing = Boolean(input.probing);
  const isDesktop = Boolean(input.isDesktop);
  const classified = input.classified ?? null;

  const empty = resolveNetworkProxyEmptyState({
    isDesktop,
    probing,
    classified,
  });

  if (probing) {
    return {
      outcome: classified?.outcome ?? null,
      tone: classified?.tone ?? "muted",
      toneClass: probeToneClass(classified?.tone ?? "muted"),
      outcomeKey: classified
        ? probeOutcomeMessageKey(classified.outcome)
        : null,
      okCount: classified?.okCount ?? 0,
      failCount: classified?.failCount ?? 0,
      showCounts: Boolean(classified && classified.targets.length > 0),
      showChip: Boolean(classified),
      showTargetList: Boolean(classified && classified.targets.length > 0),
      showRetry: false,
      primaryActionKey: "settings.netProbeTesting",
      empty: null,
      invokeError: classified?.invokeError ?? null,
    };
  }

  if (!isDesktop || classified?.outcome === "unavailable") {
    return {
      outcome: "unavailable",
      tone: "muted",
      toneClass: probeToneClass("muted"),
      outcomeKey: probeOutcomeMessageKey("unavailable"),
      okCount: 0,
      failCount: 0,
      showCounts: false,
      showChip: true,
      showTargetList: false,
      showRetry: false,
      primaryActionKey: "settings.netProbeRun",
      empty:
        empty ??
        ({
          kind: "host_only",
          titleKey: "settings.netProbe.empty.hostOnly",
          hintKey: "settings.netProbe.empty.hostOnlyHint",
          softFail: true,
          showRetry: false,
        } satisfies NetworkProxyEmptyState),
      invokeError: null,
    };
  }

  if (classified == null) {
    return {
      outcome: null,
      tone: "muted",
      toneClass: probeToneClass("muted"),
      outcomeKey: null,
      okCount: 0,
      failCount: 0,
      showCounts: false,
      showChip: false,
      showTargetList: false,
      showRetry: false,
      primaryActionKey: "settings.netProbeRun",
      empty,
      invokeError: null,
    };
  }

  const showRetry = probeOutcomeOffersRetry(classified.outcome, isDesktop);
  const showTargetList = classified.targets.length > 0;
  const tone = classified.tone ?? probeOutcomeTone(classified.outcome);

  return {
    outcome: classified.outcome,
    tone,
    toneClass: probeToneClass(tone),
    outcomeKey: probeOutcomeMessageKey(classified.outcome),
    okCount: classified.okCount,
    failCount: classified.failCount,
    showCounts: showTargetList,
    showChip: true,
    showTargetList,
    showRetry,
    primaryActionKey: "settings.netProbeRun",
    empty,
    invokeError: classified.invokeError,
  };
}

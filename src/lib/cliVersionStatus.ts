/**
 * Pure helpers for Grok Build CLI version / binary-skew display (1.0 align).
 * Host probe fields are source of truth; this only classifies for UI copy.
 */

export type CliRecommendStatus =
  | "missing"
  | "unknown"
  | "too_old"
  | "below_recommended"
  | "recommended";

export type CliProbeVersionFields = {
  found?: boolean;
  path?: string | null;
  version?: string | null;
  source?: string | null;
  cliAuthPresent?: boolean | null;
  versionSupported?: boolean | null;
  meetsRecommended?: boolean | null;
  recommendedVersion?: string | null;
  minVersion?: string | null;
  agentBinarySkew?: boolean | null;
  agentVersion?: string | null;
  agentPath?: string | null;
  /** Last live ACP initialize agentVersion (process cache). */
  acpAgentVersion?: string | null;
  /** probe banner vs live ACP agentVersion cores differ (soft warn only). */
  acpAgentVersionSkew?: boolean | null;
};

/** Normalize host `probe_cli` payload for React state / Settings. */
export function mapProbeToCliInfo(cli: CliProbeVersionFields) {
  return {
    found: !!cli.found,
    path: cli.path ?? null,
    version: cli.version ?? null,
    source: (cli.source ?? "").toString(),
    cliAuthPresent: !!cli.cliAuthPresent,
    versionSupported: cli.versionSupported ?? null,
    minVersion: cli.minVersion ?? null,
    recommendedVersion: cli.recommendedVersion ?? null,
    meetsRecommended: cli.meetsRecommended ?? null,
    agentBinarySkew: !!cli.agentBinarySkew,
    agentVersion: cli.agentVersion ?? null,
    agentPath: cli.agentPath ?? null,
    acpAgentVersion: cli.acpAgentVersion ?? null,
    acpAgentVersionSkew: !!cli.acpAgentVersionSkew,
  };
}

export type CliInfoState = ReturnType<typeof mapProbeToCliInfo>;

/**
 * Classify probe for Runtime / Doctor chips.
 * Never hard-blocks below recommended — only `too_old` is a hard floor failure.
 */
export function classifyCliVersionStatus(
  p: CliProbeVersionFields | null | undefined,
): CliRecommendStatus {
  if (!p?.found) return "missing";
  if (p.versionSupported === false) return "too_old";
  if (p.meetsRecommended === true) return "recommended";
  if (p.meetsRecommended === false) return "below_recommended";
  return "unknown";
}

/** i18n key for the soft status line under Settings → Runtime · CLI. */
export function cliVersionStatusMessageKey(
  status: CliRecommendStatus,
):
  | "settings.cliVersion.missing"
  | "settings.cliVersion.unknown"
  | "settings.cliVersion.tooOld"
  | "settings.cliVersion.belowRecommended"
  | "settings.cliVersion.recommended" {
  switch (status) {
    case "missing":
      return "settings.cliVersion.missing";
    case "too_old":
      return "settings.cliVersion.tooOld";
    case "below_recommended":
      return "settings.cliVersion.belowRecommended";
    case "recommended":
      return "settings.cliVersion.recommended";
    default:
      return "settings.cliVersion.unknown";
  }
}

/**
 * Compare probe banner vs live ACP `agentVersion` (when both parse).
 * Pure; returns true only on clear semver-core mismatch.
 */
export function probeVsAcpAgentVersionSkew(
  probeVersion: string | null | undefined,
  acpAgentVersion: string | null | undefined,
): boolean {
  const a = extractSemverCore(probeVersion);
  const b = extractSemverCore(acpAgentVersion);
  if (!a || !b) return false;
  return a !== b;
}

/** First `major.minor` or `major.minor.patch` token in a version banner. */
export function extractSemverCore(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/\d+\.\d+(?:\.\d+)?/);
  return m ? m[0] : null;
}

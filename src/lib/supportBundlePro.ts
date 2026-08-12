/**
 * SUPPORT-BUNDLE-PRO — pure helpers for Reliability / Doctor support zip honesty.
 *
 * Plans which redacted sections will be included, classifies export soft-fails,
 * formats a user-facing manifest checklist, and resolves empty/host-only states.
 *
 * Honesty rules:
 * - Never claim secrets (secrets.json, auth tokens, API keys) are included
 * - Never invent logs — logs/settings are "when available on host"
 * - Stall timeline only when the caller has real signals to pass
 * - Tool audit ledger is a separate export — never claimed inside the zip
 *
 * Host write path (`export_support_bundle` / `write_support_bundle`):
 * doctor.json, settings.json?, meta.json (app + soft CLI probe),
 * stall-timeline.json?, logs/*?, README.txt
 *
 * Full chat journals are a separate session diagnostic export — never claimed here.
 *
 * No DOM / Tauri side effects. Callers own dialogs and toasts.
 */

/** Stable zip section ids (known host paths only). */
export type SupportBundleSectionId =
  | "doctor"
  | "settings"
  | "meta"
  | "stall_timeline"
  | "logs"
  | "readme";

/**
 * How the section lands in the zip:
 * - `always` — host always writes it
 * - `when_available` — host includes only if present on disk (settings/logs)
 * - `when_provided` — only when the UI passes structured input (stall timeline)
 */
export type SupportBundleSectionAvailability =
  | "always"
  | "when_available"
  | "when_provided";

/** One planned zip section for checklist / manifest honesty. */
export type SupportBundleSectionPlan = {
  id: SupportBundleSectionId;
  /** Whether this section is expected in the zip for this plan. */
  included: boolean;
  availability: SupportBundleSectionAvailability;
  /** True when contents are scrubbed / redacted before packaging. */
  redacted: boolean;
  /** Zip entry path (known basename only). */
  zipPath: string;
  /** i18n label key (`reliability.supportZip.section.*`). */
  labelKey: string;
  /** i18n hint key. */
  hintKey: string;
};

/** Result of {@link planSupportBundleExport}. */
export type SupportBundleExportPlan = {
  sections: SupportBundleSectionPlan[];
  /** Ids with `included: true` (order matches {@link sections}). */
  includedIds: SupportBundleSectionId[];
  /** Always false — secrets are never packaged. */
  secretsIncluded: false;
  /**
   * Always false — audit ledger is a separate Reliability export.
   * See {@link auditOmitted}.
   */
  auditIncluded: false;
  /** True when caller had audit data but it is not in this zip. */
  auditOmitted: boolean;
  hasDoctor: boolean;
  hasStallTimeline: boolean;
  /**
   * Desktop host can run `export_support_bundle`.
   * False in browser / non-host environments.
   */
  canExport: boolean;
};

/** Soft-fail kinds for support zip export toasts. */
export type SupportBundleErrorKind =
  | "host_only"
  | "cancel"
  | "io"
  | "empty"
  | "other";

/** Empty-state kinds when export cannot start honestly. */
export type SupportBundleEmptyKind = "host_only";

export type SupportBundleEmptyState = {
  kind: SupportBundleEmptyKind;
  titleKey: string;
  hintKey: string;
};

/** Ordered section catalog (stable for checklist UI). */
export const SUPPORT_BUNDLE_SECTION_ORDER: readonly SupportBundleSectionId[] = [
  "doctor",
  "settings",
  "meta",
  "stall_timeline",
  "logs",
  "readme",
] as const;

const SECTION_META: Record<
  SupportBundleSectionId,
  {
    zipPath: string;
    availability: SupportBundleSectionAvailability;
    redacted: boolean;
    labelKey: string;
    hintKey: string;
  }
> = {
  doctor: {
    zipPath: "doctor.json",
    availability: "always",
    redacted: true,
    labelKey: "reliability.supportZip.section.doctor",
    hintKey: "reliability.supportZip.section.doctorHint",
  },
  settings: {
    zipPath: "settings.json",
    availability: "when_available",
    redacted: true,
    labelKey: "reliability.supportZip.section.settings",
    hintKey: "reliability.supportZip.section.settingsHint",
  },
  meta: {
    zipPath: "meta.json",
    availability: "always",
    redacted: false,
    labelKey: "reliability.supportZip.section.meta",
    hintKey: "reliability.supportZip.section.metaHint",
  },
  stall_timeline: {
    zipPath: "stall-timeline.json",
    availability: "when_provided",
    redacted: true,
    labelKey: "reliability.supportZip.section.stall",
    hintKey: "reliability.supportZip.section.stallHint",
  },
  logs: {
    zipPath: "logs/",
    availability: "when_available",
    redacted: true,
    labelKey: "reliability.supportZip.section.logs",
    hintKey: "reliability.supportZip.section.logsHint",
  },
  readme: {
    zipPath: "README.txt",
    availability: "always",
    redacted: false,
    labelKey: "reliability.supportZip.section.readme",
    hintKey: "reliability.supportZip.section.readmeHint",
  },
};

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
    const o = err as { code?: unknown; message?: unknown; reason?: unknown };
    const parts = [o.code, o.message, o.reason]
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
  }
  return "";
}

function sectionPlan(
  id: SupportBundleSectionId,
  included: boolean,
): SupportBundleSectionPlan {
  const m = SECTION_META[id];
  return {
    id,
    included,
    availability: m.availability,
    redacted: m.redacted,
    zipPath: m.zipPath,
    labelKey: m.labelKey,
    hintKey: m.hintKey,
  };
}

/**
 * Plan which redacted sections the support zip will contain.
 *
 * - Doctor is always included (host generates a fresh report when the UI
 *   does not pass one; `hasDoctor` only records whether the UI already has
 *   a report payload).
 * - Stall timeline is included only when `hasStallTimeline` is true.
 * - Settings and logs are listed as included-when-available — never invented.
 * - Secrets are never claimed. Audit ledger is never claimed in this zip.
 */
export function planSupportBundleExport(input: {
  hasDoctor: boolean;
  hasStallTimeline: boolean;
  hasAudit?: boolean;
  /** Desktop host present. Default `true` (content plan only). */
  isHost?: boolean;
}): SupportBundleExportPlan {
  const hasDoctor = !!input.hasDoctor;
  const hasStallTimeline = !!input.hasStallTimeline;
  const hasAudit = !!input.hasAudit;
  const isHost = input.isHost !== false;

  const sections: SupportBundleSectionPlan[] = [
    // Doctor always lands in the zip (host builds when UI passes null).
    sectionPlan("doctor", true),
    sectionPlan("settings", true),
    sectionPlan("meta", true),
    sectionPlan("stall_timeline", hasStallTimeline),
    // Logs: planned as when-available — never invent that log files exist.
    sectionPlan("logs", true),
    sectionPlan("readme", true),
  ];

  const includedIds = sections
    .filter((s) => s.included)
    .map((s) => s.id);

  return {
    sections,
    includedIds,
    secretsIncluded: false,
    auditIncluded: false,
    auditOmitted: hasAudit,
    hasDoctor,
    hasStallTimeline,
    canExport: isHost && includedIds.length > 0,
  };
}

/**
 * Resolve pre-export empty / blocked state.
 * Browser (no host) → host_only. Host can always build a base zip → null.
 */
export function resolveSupportBundleEmptyState(input: {
  isHost: boolean;
  hasDoctor?: boolean;
  hasStallTimeline?: boolean;
  hasAudit?: boolean;
}): SupportBundleEmptyState | null {
  if (!input.isHost) {
    return {
      kind: "host_only",
      titleKey: "reliability.supportZip.emptyHostOnly",
      hintKey: "reliability.supportZip.emptyHostOnlyHint",
    };
  }
  // Host always produces doctor + meta + readme — never invent an empty zip.
  return null;
}

/**
 * Redacted plain-text manifest for user preview before export.
 * English technical labels (same spirit as host README.txt); no secrets;
 * never lists invented log filenames.
 */
export function formatSupportBundleManifest(
  sections:
    | readonly SupportBundleSectionPlan[]
    | SupportBundleExportPlan
    | null
    | undefined,
  opts?: {
    /** Append audit-not-included honesty note. */
    auditOmitted?: boolean;
  },
): string {
  const list: readonly SupportBundleSectionPlan[] = !sections
    ? []
    : Array.isArray(sections)
      ? sections
      : (sections as SupportBundleExportPlan).sections ?? [];

  const auditOmitted =
    opts?.auditOmitted === true ||
    (!Array.isArray(sections) &&
      sections != null &&
      (sections as SupportBundleExportPlan).auditOmitted === true);

  const lines: string[] = [
    "# Support bundle preview (redacted)",
    "Secrets are never included (no secrets.json, auth tokens, or API keys).",
    "",
  ];

  if (list.length === 0) {
    lines.push("(no sections planned)");
  } else {
    for (const s of list) {
      const mark = s.included ? "x" : " ";
      const red = s.redacted ? "; redacted" : "";
      let avail = "";
      if (s.included) {
        if (s.availability === "when_available") {
          avail = "; if present on host";
        } else if (s.availability === "when_provided") {
          avail = "; from Reliability snapshot";
        }
      } else {
        avail = "; not included this export";
      }
      lines.push(`- [${mark}] ${s.zipPath}${red}${avail}`);
    }
  }

  lines.push("");
  lines.push("Never included: secrets.json, account auth, raw API keys.");

  if (auditOmitted) {
    lines.push(
      "Tool audit ledger is not in this zip — use Reliability → Audit export.",
    );
  }

  return lines.join("\n").trim();
}

/**
 * Classify a thrown value / host error into a stable soft-fail kind.
 * Prefer explicit `code` over free-form text.
 */
export function classifySupportBundleError(
  err: unknown,
): SupportBundleErrorKind {
  if (err == null || err === "") return "other";

  const code = errCode(err);
  if (
    code === "host_only" ||
    code === "host-only" ||
    code === "need_tauri" ||
    code === "need-tauri" ||
    code === "desktop_only" ||
    code === "desktop-only"
  ) {
    return "host_only";
  }
  if (
    code === "cancelled" ||
    code === "canceled" ||
    code === "cancel" ||
    code === "user_cancelled" ||
    code === "user_canceled"
  ) {
    return "cancel";
  }
  if (code === "empty" || code === "empty_bundle" || code === "nothing") {
    return "empty";
  }
  if (
    code === "io" ||
    code === "io_error" ||
    code === "write_failed" ||
    code === "write-failed" ||
    code === "save_failed" ||
    code === "save-failed" ||
    code === "enospc" ||
    code === "eacces" ||
    code === "eperm"
  ) {
    return "io";
  }

  const s = errText(err).toLowerCase();
  if (!s.trim()) return "other";

  if (
    s.includes("tauri required") ||
    s.includes("need tauri") ||
    s.includes("desktop only") ||
    s.includes("host only") ||
    s.includes("host_only") ||
    s.includes("not available in browser") ||
    s.includes("requires desktop")
  ) {
    return "host_only";
  }

  if (
    /\bcancel(l?ed)?\b/.test(s) ||
    s.includes("user cancelled") ||
    s.includes("user canceled") ||
    s.includes("dismissed")
  ) {
    return "cancel";
  }

  const msgOnly =
    err instanceof Error ? (err.message || "").trim().toLowerCase() : "";
  if (
    msgOnly === "empty" ||
    s.trim() === "empty" ||
    s.trim() === "error: empty" ||
    s.includes("nothing to export") ||
    s.includes("empty bundle") ||
    s.includes("no content to export")
  ) {
    return "empty";
  }

  if (
    s.includes("create zip") ||
    s.includes("write doctor") ||
    s.includes("write log") ||
    s.includes("write meta") ||
    s.includes("copy archive") ||
    s.includes("disk full") ||
    s.includes("enospc") ||
    s.includes("eacces") ||
    s.includes("permission denied") ||
    s.includes("no space") ||
    s.includes("i/o error") ||
    s.includes("io error") ||
    s.includes("failed to write") ||
    s.includes("failed to create") ||
    s.includes("finish zip")
  ) {
    return "io";
  }

  return "other";
}

/** i18n key for a classified soft-fail (never invent success). */
export function supportBundleErrorMessageKey(
  kind: SupportBundleErrorKind,
): string {
  switch (kind) {
    case "host_only":
      return "reliability.supportZip.failHostOnly";
    case "cancel":
      return "reliability.supportZip.failCancel";
    case "io":
      return "reliability.supportZip.failIo";
    case "empty":
      return "reliability.supportZip.failEmpty";
    case "other":
    default:
      return "doctor.supportZipFail";
  }
}

/** Cancelled native dialogs should not toast as a failure. */
export function supportBundleSoftFailSilent(
  kind: SupportBundleErrorKind,
): boolean {
  return kind === "cancel";
}

/**
 * Resolve user-facing soft-fail copy from a thrown value.
 * Returns message key + whether to stay silent (cancel).
 */
export function resolveSupportBundleSoftFail(err: unknown): {
  kind: SupportBundleErrorKind;
  messageKey: string;
  silent: boolean;
  /** Short technical detail for debug suffix (empty when not useful). */
  detail: string;
} {
  const kind = classifySupportBundleError(err);
  const messageKey = supportBundleErrorMessageKey(kind);
  const silent = supportBundleSoftFailSilent(kind);
  const raw = errText(err).trim();
  let detail = "";
  if (
    kind === "other" &&
    raw &&
    !/^error:\s*$/i.test(raw) &&
    raw.length < 200
  ) {
    detail = raw.replace(/^Error:\s*/i, "").trim();
  }
  return { kind, messageKey, silent, detail };
}

/** i18n label key for a section id. */
export function supportBundleSectionLabelKey(
  id: SupportBundleSectionId,
): string {
  return SECTION_META[id]?.labelKey ?? "reliability.supportZip.section.meta";
}

/** i18n hint key for a section id. */
export function supportBundleSectionHintKey(
  id: SupportBundleSectionId,
): string {
  return SECTION_META[id]?.hintKey ?? "reliability.supportZip.section.metaHint";
}

/**
 * Whether the support zip action may run.
 * Host required; busy alone does not invent content.
 */
export function canSupportBundleExport(input: {
  isHost: boolean;
  busy?: boolean;
}): boolean {
  if (!input.isHost) return false;
  if (input.busy) return false;
  return true;
}

/**
 * Only pass stall JSON to the host when the plan includes that section
 * and the snapshot has at least one signal. Empty snapshots → null
 * (never invent a timeline).
 */
export function resolveSupportBundleStallJson(input: {
  hasStallTimeline: boolean;
  /** Serialized snapshot; empty/whitespace → null. */
  stallJson?: string | null;
  /** Optional signal count; 0 → null even if string present. */
  signalCount?: number | null;
}): string | null {
  if (!input.hasStallTimeline) return null;
  if (
    typeof input.signalCount === "number" &&
    Number.isFinite(input.signalCount) &&
    input.signalCount <= 0
  ) {
    return null;
  }
  const raw = typeof input.stallJson === "string" ? input.stallJson.trim() : "";
  return raw || null;
}

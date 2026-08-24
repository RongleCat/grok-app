/**
 * Remote security ops — pure honesty helpers (Top30 #25).
 *
 * Unifies Remote IM + phone-mirror security surface for overview UI:
 * - allow-from ACL parse / summary
 * - overall risk classification
 * - security checklist (ACL · rate-limit · bridge · mirror write · YOLO)
 * - redacted copyable summary text
 *
 * Soft rules:
 * - Never invent “live WS / Gateway” without Bridge linked/listening.
 * - Never surface secrets, tokens, or full public URLs.
 * - Rate-limit posture is host soft-limit honesty, not a silent drop claim.
 *
 * Spec: docs/features/remote-security.md · docs/llm-wiki/remote-im.md §10
 */

import {
  RIM_RATE_GLOBAL,
  RIM_RATE_PER_CHAT,
  RIM_RATE_WINDOW_SECS,
  type RimErrorKind,
} from "@/lib/remoteIm/resilience";

// ─── Allow-from ACL ─────────────────────────────────────────────────────────

/** One token from an allow-from field (comma-separated platform user ids or *). */
export type AllowFromEntry = {
  /** Trimmed original token. */
  value: string;
  /** True when this token is a wildcard `*`. */
  wildcard: boolean;
};

export type AllowFromSummary = "open_acl" | "restricted" | "empty";

/**
 * Parse a raw allow-from string into trimmed entries.
 * Accepts comma / newline / semicolon separators; empty tokens dropped.
 */
export function parseAllowFromList(raw: unknown): AllowFromEntry[] {
  if (raw == null) return [];
  // Keep separators (comma / newline / semicolon); drop other C0 controls.
  const s = String(raw)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim();
  if (!s) return [];
  const parts = s.split(/[,;\n\r]+/g);
  const out: AllowFromEntry[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const value = p.replace(/[\u0000-\u001f]/g, "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ value, wildcard: value === "*" });
  }
  return out;
}

/**
 * Summarize allow-from entries for security honesty.
 * - empty — no entries (deny-by-default in product enable path)
 * - open_acl — any wildcard `*` (anyone can talk)
 * - restricted — only explicit ids
 */
export function summarizeAllowFrom(
  entries: readonly AllowFromEntry[],
): AllowFromSummary {
  if (!entries.length) return "empty";
  if (entries.some((e) => e.wildcard)) return "open_acl";
  return "restricted";
}

/** Convenience: raw string → summary (empty / open_acl / restricted). */
export function summarizeAllowFromRaw(raw: unknown): AllowFromSummary {
  return summarizeAllowFrom(parseAllowFromList(raw));
}

/** True when allow-from is open (*) or effectively empty-as-open for risk. */
export function isAllowFromOpen(raw: unknown): boolean {
  return summarizeAllowFromRaw(raw) === "open_acl";
}

// ─── Risk classification ────────────────────────────────────────────────────

export type RemoteSecurityRisk = "ok" | "warn" | "danger";

export type ClassifyRemoteSecurityRiskInput = {
  /** True when any enabled channel uses open allow-from (*). */
  allowFromOpen: boolean;
  /**
   * True when a write surface is enabled:
   * phone-mirror write and/or remote YOLO auto-approve.
   */
  writeEnabled: boolean;
  /** True when Bridge reports rate-limited posture. */
  rateLimited: boolean;
  /** Optional classified Bridge error kind. */
  bridgeErrorKind?: RimErrorKind | string | null;
};

function normalizeErrorKind(
  raw: unknown,
): RimErrorKind | null {
  if (typeof raw !== "string") return null;
  const k = raw.trim().toLowerCase();
  if (
    k === "rate_limit" ||
    k === "auth" ||
    k === "network" ||
    k === "crash" ||
    k === "config" ||
    k === "unknown"
  ) {
    return k;
  }
  return null;
}

/**
 * Classify overall remote security risk for badge / callout tone.
 *
 * - danger — open ACL + write, or auth failure while write is on
 * - warn — open ACL alone, write alone, rate-limited, config/auth/crash
 * - ok — restricted ACL, writes off, healthy
 */
export function classifyRemoteSecurityRisk(
  input: ClassifyRemoteSecurityRiskInput,
): RemoteSecurityRisk {
  const allowFromOpen = !!input.allowFromOpen;
  const writeEnabled = !!input.writeEnabled;
  const rateLimited = !!input.rateLimited;
  const kind = normalizeErrorKind(input.bridgeErrorKind);

  if (allowFromOpen && writeEnabled) return "danger";
  if (writeEnabled && kind === "auth") return "danger";

  if (allowFromOpen || writeEnabled || rateLimited) return "warn";
  if (kind === "auth" || kind === "config" || kind === "crash") return "warn";
  if (kind === "rate_limit") return "warn";

  return "ok";
}

// ─── Checklist ──────────────────────────────────────────────────────────────

export type RemoteSecurityCheckId =
  | "acl"
  | "rate_limit"
  | "bridge_health"
  | "mirror_write"
  | "remote_yolo"
  | "live_claim";

export type RemoteSecurityCheckStatus = "pass" | "warn" | "fail";

export type RemoteSecurityChecklistItem = {
  id: RemoteSecurityCheckId;
  status: RemoteSecurityCheckStatus;
  /** i18n label key */
  labelKey: string;
  /** Optional i18n detail / hint key */
  detailKey: string | null;
};

export type RemoteSecurityStatusInput = {
  /**
   * Aggregate allow-from across enabled (or configured) channel instances.
   * Prefer enabled instances; UI may pass all configured.
   */
  allowFromSummary: AllowFromSummary;
  /** Count of enabled channel instances with open allow-from. */
  openAclChannelCount?: number;
  /** Count of enabled channel instances with empty allow-from. */
  emptyAclChannelCount?: number;
  /** Bridge enabled flag. */
  bridgeEnabled?: boolean;
  /** Bridge run state (listening / running / degraded / error / stopped…). */
  bridgeState?: string | null;
  /** Bridge reports at least one connected channel instance. */
  bridgeLinked?: boolean;
  /** Host rate-limited posture. */
  rateLimited?: boolean;
  /** Soft inbound rate limit is always on in-process (product truth). */
  inboundRateLimitActive?: boolean;
  /** Phone mirror allows writes (default false / read-only). */
  mirrorWriteEnabled?: boolean;
  /** Remote YOLO auto-approve tools from IM. */
  remoteYoloEnabled?: boolean;
  /** Classified bridge error. */
  bridgeErrorKind?: RimErrorKind | string | null;
  /** Last bridge error text (redacted in format only). */
  lastError?: string | null;
  /**
   * Enabled channel count with credentials (for honesty when nothing configured).
   */
  configuredChannelCount?: number;
  /** Connected channel count from Bridge status. */
  connectedChannelCount?: number;
};

export type RemoteSecurityChecklist = {
  risk: RemoteSecurityRisk;
  items: RemoteSecurityChecklistItem[];
  /** Aggregate flags used by summary / UI. */
  flags: {
    allowFromOpen: boolean;
    allowFromEmpty: boolean;
    writeEnabled: boolean;
    rateLimited: boolean;
    bridgeListening: boolean;
    bridgeLinked: boolean;
    /** Always false — UI must not invent live without Bridge. */
    inventLiveWithoutBridge: false;
  };
};

const LABEL = {
  acl: "settings.remoteIm.security.check.acl",
  rate_limit: "settings.remoteIm.security.check.rateLimit",
  bridge_health: "settings.remoteIm.security.check.bridge",
  mirror_write: "settings.remoteIm.security.check.mirrorWrite",
  remote_yolo: "settings.remoteIm.security.check.remoteYolo",
  live_claim: "settings.remoteIm.security.check.liveClaim",
} as const;

const DETAIL = {
  aclRestricted: "settings.remoteIm.security.detail.aclRestricted",
  aclOpen: "settings.remoteIm.security.detail.aclOpen",
  aclEmpty: "settings.remoteIm.security.detail.aclEmpty",
  rateActive: "settings.remoteIm.security.detail.rateActive",
  rateHit: "settings.remoteIm.security.detail.rateHit",
  bridgeListening: "settings.remoteIm.security.detail.bridgeListening",
  bridgeDegraded: "settings.remoteIm.security.detail.bridgeDegraded",
  bridgeStopped: "settings.remoteIm.security.detail.bridgeStopped",
  bridgeError: "settings.remoteIm.security.detail.bridgeError",
  mirrorReadOnly: "settings.remoteIm.security.detail.mirrorReadOnly",
  mirrorWriteOn: "settings.remoteIm.security.detail.mirrorWriteOn",
  yoloOff: "settings.remoteIm.security.detail.yoloOff",
  yoloOn: "settings.remoteIm.security.detail.yoloOn",
  liveHonest: "settings.remoteIm.security.detail.liveHonest",
  liveLinked: "settings.remoteIm.security.detail.liveLinked",
  liveNotLinked: "settings.remoteIm.security.detail.liveNotLinked",
} as const;

function isBridgeListening(state: string | null | undefined): boolean {
  const s = String(state ?? "").toLowerCase();
  return s === "listening" || s === "running";
}

function isBridgeErrorish(state: string | null | undefined): boolean {
  const s = String(state ?? "").toLowerCase();
  return s === "error" || s === "degraded";
}

/**
 * Build the security checklist from aggregate remote status.
 * Pure — no I/O; never claims live WS without Bridge link.
 */
export function buildRemoteSecurityChecklist(
  status: RemoteSecurityStatusInput,
): RemoteSecurityChecklist {
  const allowFromSummary = status.allowFromSummary;
  const allowFromOpen = allowFromSummary === "open_acl";
  const allowFromEmpty = allowFromSummary === "empty";
  const mirrorWrite = !!status.mirrorWriteEnabled;
  const yolo = !!status.remoteYoloEnabled;
  const writeEnabled = mirrorWrite || yolo;
  const rateLimited = !!status.rateLimited;
  // Soft inbound limit is always compiled into the host; default true for honesty.
  const rateActive = status.inboundRateLimitActive !== false;
  const bridgeState = status.bridgeState ?? "stopped";
  const bridgeListening = isBridgeListening(bridgeState);
  const bridgeLinked = !!status.bridgeLinked;
  const kind = normalizeErrorKind(status.bridgeErrorKind);

  const risk = classifyRemoteSecurityRisk({
    allowFromOpen,
    writeEnabled,
    rateLimited,
    bridgeErrorKind: kind,
  });

  const items: RemoteSecurityChecklistItem[] = [];

  // 1) ACL
  if (allowFromOpen) {
    items.push({
      id: "acl",
      status: "warn",
      labelKey: LABEL.acl,
      detailKey: DETAIL.aclOpen,
    });
  } else if (allowFromEmpty) {
    // Empty is fail when channels exist; pass-ish soft when nothing configured.
    const hasChannels =
      (status.configuredChannelCount ?? 0) > 0 ||
      (status.emptyAclChannelCount ?? 0) > 0;
    items.push({
      id: "acl",
      status: hasChannels ? "fail" : "warn",
      labelKey: LABEL.acl,
      detailKey: DETAIL.aclEmpty,
    });
  } else {
    items.push({
      id: "acl",
      status: "pass",
      labelKey: LABEL.acl,
      detailKey: DETAIL.aclRestricted,
    });
  }

  // 2) Rate limit (always-on soft limiter when host is in-process)
  if (rateLimited) {
    items.push({
      id: "rate_limit",
      status: "warn",
      labelKey: LABEL.rate_limit,
      detailKey: DETAIL.rateHit,
    });
  } else if (rateActive) {
    items.push({
      id: "rate_limit",
      status: "pass",
      labelKey: LABEL.rate_limit,
      detailKey: DETAIL.rateActive,
    });
  } else {
    items.push({
      id: "rate_limit",
      status: "warn",
      labelKey: LABEL.rate_limit,
      detailKey: DETAIL.rateActive,
    });
  }

  // 3) Bridge health
  if (kind === "auth" || kind === "crash" || String(bridgeState).toLowerCase() === "error") {
    items.push({
      id: "bridge_health",
      status: "fail",
      labelKey: LABEL.bridge_health,
      detailKey: DETAIL.bridgeError,
    });
  } else if (isBridgeErrorish(bridgeState) || (status.bridgeEnabled && !bridgeListening)) {
    items.push({
      id: "bridge_health",
      status: "warn",
      labelKey: LABEL.bridge_health,
      detailKey: DETAIL.bridgeDegraded,
    });
  } else if (bridgeListening) {
    items.push({
      id: "bridge_health",
      status: "pass",
      labelKey: LABEL.bridge_health,
      detailKey: DETAIL.bridgeListening,
    });
  } else {
    items.push({
      id: "bridge_health",
      status: "pass",
      labelKey: LABEL.bridge_health,
      detailKey: DETAIL.bridgeStopped,
    });
  }

  // 4) Mirror write default off
  items.push({
    id: "mirror_write",
    status: mirrorWrite ? "warn" : "pass",
    labelKey: LABEL.mirror_write,
    detailKey: mirrorWrite ? DETAIL.mirrorWriteOn : DETAIL.mirrorReadOnly,
  });

  // 5) Remote YOLO
  items.push({
    id: "remote_yolo",
    status: yolo ? "warn" : "pass",
    labelKey: LABEL.remote_yolo,
    detailKey: yolo ? DETAIL.yoloOn : DETAIL.yoloOff,
  });

  // 6) Live claim honesty — never invent live without Bridge link
  if (bridgeListening && bridgeLinked) {
    items.push({
      id: "live_claim",
      status: "pass",
      labelKey: LABEL.live_claim,
      detailKey: DETAIL.liveLinked,
    });
  } else if (bridgeListening && !bridgeLinked) {
    items.push({
      id: "live_claim",
      status: "warn",
      labelKey: LABEL.live_claim,
      detailKey: DETAIL.liveNotLinked,
    });
  } else {
    items.push({
      id: "live_claim",
      status: "pass",
      labelKey: LABEL.live_claim,
      detailKey: DETAIL.liveHonest,
    });
  }

  return {
    risk,
    items,
    flags: {
      allowFromOpen,
      allowFromEmpty,
      writeEnabled,
      rateLimited,
      bridgeListening,
      bridgeLinked,
      inventLiveWithoutBridge: false,
    },
  };
}

// ─── Aggregate helpers for overview wiring ──────────────────────────────────

export type ChannelAclSnapshot = {
  enabled?: boolean;
  hasCredentials?: boolean;
  allowFrom?: unknown;
};

/**
 * Aggregate allow-from across channel instances.
 * Prefer enabled instances with credentials; fall back to all provided.
 */
export function aggregateAllowFromSummary(
  channels: readonly ChannelAclSnapshot[],
): {
  summary: AllowFromSummary;
  openCount: number;
  emptyCount: number;
  restrictedCount: number;
  considered: number;
} {
  const preferred = channels.filter(
    (c) => c.enabled !== false && (c.hasCredentials || c.allowFrom != null),
  );
  const list = preferred.length > 0 ? preferred : channels;

  let openCount = 0;
  let emptyCount = 0;
  let restrictedCount = 0;

  for (const c of list) {
    const s = summarizeAllowFromRaw(c.allowFrom);
    if (s === "open_acl") openCount += 1;
    else if (s === "empty") emptyCount += 1;
    else restrictedCount += 1;
  }

  let summary: AllowFromSummary = "empty";
  if (openCount > 0) summary = "open_acl";
  else if (restrictedCount > 0) summary = "restricted";
  else summary = "empty";

  return {
    summary,
    openCount,
    emptyCount,
    restrictedCount,
    considered: list.length,
  };
}

// ─── Dangerous-write confirm inventory (documentation surface) ──────────────

/**
 * Known in-app confirm surfaces for remote-related dangerous writes.
 * Inventory only — UI still uses GlassModal / setAppDialog (never window.confirm).
 */
export type DangerousWriteConfirmId =
  | "mirror_write_enable"
  | "mirror_lan_bind"
  | "mirror_token_rotate"
  | "mirror_host_stop"
  | "mirror_audit_clear"
  | "remote_yolo"
  | "channel_delete"
  | "timeline_clear";

export type DangerousWriteConfirmMeta = {
  id: DangerousWriteConfirmId;
  /** Product area. */
  area: "mirror" | "remote_im";
  /** i18n key for inventory label. */
  labelKey: string;
  /** Requires in-app confirm before applying. */
  requiresConfirm: true;
};

export const DANGEROUS_WRITE_CONFIRMS: readonly DangerousWriteConfirmMeta[] = [
  {
    id: "mirror_write_enable",
    area: "mirror",
    labelKey: "settings.remoteIm.security.confirm.mirrorWrite",
    requiresConfirm: true,
  },
  {
    id: "mirror_lan_bind",
    area: "mirror",
    labelKey: "settings.remoteIm.security.confirm.mirrorLan",
    requiresConfirm: true,
  },
  {
    id: "mirror_token_rotate",
    area: "mirror",
    labelKey: "settings.remoteIm.security.confirm.mirrorRotate",
    requiresConfirm: true,
  },
  {
    id: "mirror_host_stop",
    area: "mirror",
    labelKey: "settings.remoteIm.security.confirm.mirrorStop",
    requiresConfirm: true,
  },
  {
    id: "mirror_audit_clear",
    area: "mirror",
    labelKey: "settings.remoteIm.security.confirm.mirrorAuditClear",
    requiresConfirm: true,
  },
  {
    id: "remote_yolo",
    area: "remote_im",
    labelKey: "settings.remoteIm.security.confirm.remoteYolo",
    requiresConfirm: true,
  },
  {
    id: "channel_delete",
    area: "remote_im",
    labelKey: "settings.remoteIm.security.confirm.channelDelete",
    requiresConfirm: true,
  },
  {
    id: "timeline_clear",
    area: "remote_im",
    labelKey: "settings.remoteIm.security.confirm.timelineClear",
    requiresConfirm: true,
  },
] as const;

// ─── Redacted summary text ──────────────────────────────────────────────────

/**
 * Strip control chars, URLs, and secret-looking substrings for copy/export.
 */
export function redactRemoteSecurityText(raw: unknown, max = 240): string {
  if (raw == null) return "";
  let s = String(raw).replace(/[\u0000-\u001f]/g, "").trim();
  if (!s) return "";
  s = s.replace(
    /\b([A-Za-z0-9_]*(?:secret|token|password|key)[A-Za-z0-9_]*)\s*[:=]\s*([^\s,;]+)/gi,
    (_, k: string) => `${k}=••••`,
  );
  s = s.replace(
    /\b((?:sk|xai|xoxb|xapp|ghp|gho|xoxp)-[A-Za-z0-9._-]{6,})\b/gi,
    "••••",
  );
  s = s.replace(/https?:\/\/[^\s]+/gi, "[url]");
  s = s.replace(/\/t\/[^/\s?#]+/gi, "/t/<redacted>");
  s = s.replace(/\b[a-f0-9]{32,}\b/gi, "<redacted>");
  if (s.length > max) s = `${s.slice(0, max - 1)}…`;
  return s;
}

export type FormatRemoteSecuritySummaryInput = RemoteSecurityStatusInput & {
  /** Optional locale tag for headers (en default). */
  locale?: string;
  checklist?: RemoteSecurityChecklist;
};

/**
 * Build a redacted multi-line security summary for clipboard.
 * Never includes secrets, tokens, or full public URLs.
 */
export function formatRemoteSecuritySummaryText(
  input: FormatRemoteSecuritySummaryInput,
): string {
  const checklist = input.checklist ?? buildRemoteSecurityChecklist(input);
  const lines: string[] = [];
  lines.push("Grok App — Remote security summary");
  lines.push(`Risk: ${checklist.risk}`);
  lines.push(`Allow-from: ${input.allowFromSummary}`);
  lines.push(
    `Bridge: ${String(input.bridgeState ?? "stopped")}` +
      (input.bridgeLinked ? " · linked" : " · not linked"),
  );
  lines.push(
    `Rate limit: ${
      input.rateLimited
        ? "HIT (soft — not silent drop)"
        : `active (≤${RIM_RATE_PER_CHAT}/chat, ≤${RIM_RATE_GLOBAL}/global per ${RIM_RATE_WINDOW_SECS}s)`
    }`,
  );
  lines.push(
    `Mirror write: ${input.mirrorWriteEnabled ? "ON (broad surface)" : "off (read-only default)"}`,
  );
  lines.push(
    `Remote YOLO: ${input.remoteYoloEnabled ? "ON" : "off"}`,
  );
  lines.push(
    `Channels: configured=${input.configuredChannelCount ?? 0} connected=${input.connectedChannelCount ?? 0}`,
  );
  lines.push("Checklist:");
  for (const item of checklist.items) {
    lines.push(`  [${item.status}] ${item.id}`);
  }
  if (input.lastError) {
    const safe = redactRemoteSecurityText(input.lastError, 160);
    if (safe) lines.push(`Last error: ${safe}`);
  }
  lines.push(
    "Honesty: never invent live WS/Gateway without Bridge link; no tokens/URLs in this summary.",
  );
  lines.push(`Invent live without bridge: ${checklist.flags.inventLiveWithoutBridge}`);
  return lines.join("\n");
}

/** i18n key for overall risk badge. */
export function remoteSecurityRiskKey(
  risk: RemoteSecurityRisk,
): `settings.remoteIm.security.risk.${RemoteSecurityRisk}` {
  return `settings.remoteIm.security.risk.${risk}`;
}

/** i18n key for allow-from summary chip. */
export function allowFromSummaryKey(
  summary: AllowFromSummary,
): `settings.remoteIm.security.acl.${AllowFromSummary}` {
  return `settings.remoteIm.security.acl.${summary}`;
}

/** Map checklist status → RimBadge tone. */
export function checklistStatusTone(
  status: RemoteSecurityCheckStatus,
): "ok" | "warn" | "err" | "neutral" {
  switch (status) {
    case "pass":
      return "ok";
    case "warn":
      return "warn";
    case "fail":
      return "err";
    default:
      return "neutral";
  }
}

/** Map risk → RimBadge tone. */
export function remoteSecurityRiskTone(
  risk: RemoteSecurityRisk,
): "ok" | "warn" | "err" | "neutral" {
  switch (risk) {
    case "ok":
      return "ok";
    case "warn":
      return "warn";
    case "danger":
      return "err";
    default:
      return "neutral";
  }
}

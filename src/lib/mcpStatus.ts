/**
 * Pure helpers for MCP server health / auth status from Doctor reports.
 *
 * Never surfaces raw secrets or tokens — only redacted status tones and
 * short guidance for refresh. No fake auto-refresh; CLI has none.
 */

import { redact } from "@/lib/redact";

/** Status tones for MCP list lamps / badges. */
export type McpStatusTone =
  | "ok"
  | "warn"
  | "error"
  | "unknown"
  | "auth_expired"
  | "auth_required";

/** Normalized per-server status consumed by Extensions → MCP. */
export type McpServerStatus = {
  name: string;
  tone: McpStatusTone;
  /** Short redacted reason for UI (one line). */
  reason: string | null;
  /** True when tone is auth_expired or auth_required. */
  needsAuthRefresh: boolean;
  /** Redacted issue / check detail lines mapped to this server. */
  issues: string[];
  /** From doctor when present. */
  healthy: boolean | null;
};

/** Loose doctor server shape (host or fixture). */
export type McpDoctorServerLike = {
  name?: string | null;
  healthy?: boolean | null;
  status?: string | null;
  transport?: string | null;
  target?: string | null;
  checks?: Array<{
    label?: string | null;
    passed?: boolean | null;
    detail?: string | null;
    hint?: string | null;
    message?: string | null;
  }> | null;
  issues?: Array<string | Record<string, unknown>> | null;
  error?: string | null;
  message?: string | null;
  [key: string]: unknown;
};

/** Loose top-level issue entry. */
export type McpDoctorIssueLike = {
  name?: string | null;
  server?: string | null;
  serverName?: string | null;
  message?: string | null;
  detail?: string | null;
  summary?: string | null;
  level?: string | null;
  status?: string | null;
  [key: string]: unknown;
};

/** Loose doctor report envelope. */
export type McpDoctorReportLike = {
  ok?: boolean | null;
  servers?: McpDoctorServerLike[] | null;
  issues?: Array<string | McpDoctorIssueLike> | null;
  summary?:
    | string
    | {
        healthy?: number | null;
        unhealthy?: number | null;
        total?: number | null;
        message?: string | null;
        text?: string | null;
        [key: string]: unknown;
      }
    | null;
  message?: string | null;
  error?: string | null;
  rawText?: string | null;
  [key: string]: unknown;
};

/** Map of server name (trimmed, case-sensitive as reported) → status. */
export type McpStatusIndex = Map<string, McpServerStatus>;

const AUTH_EXPIRED_RE =
  /\b(expired|token\s+expir|credential[s]?\s+expir|session\s+expir|auth(?:entication)?\s+expir)\b/i;
const AUTH_REQUIRED_RE =
  /\b(unauthorized|unauthorised|401|403|auth(?:entication)?\s+required|not\s+authenticated|login\s+required|re[- ]?auth|invalid\s+token|missing\s+token|access\s+denied|forbidden)\b/i;
const AUTHISH_RE = /\b(token|auth(?:entication|orization)?|credential[s]?|bearer|oauth|api[_-]?key)\b/i;
const WARN_RE = /\b(warn(?:ing)?|degraded|slow|timeout|timed\s+out|retry)\b/i;
const ERROR_RE =
  /\b(error|fail(?:ed|ure)?|crash|unreachable|refused|econnrefused|enotfound|fatal)\b/i;

/** KEY=value / secret-like blobs that should never appear in UI. */
const ENV_PAIR_RE =
  /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD|PASS|AUTH|CREDENTIAL)[A-Z0-9_]*)\s*=\s*([^\s"'`;]+)/gi;
const GENERIC_SECRET_RE =
  /\b((?:sk|xai|ghp|gho|ghu|ghs|ghr)-[A-Za-z0-9._-]{8,}|Bearer\s+[A-Za-z0-9\-._~+/]+=*)\b/gi;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t || null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return null;
}

/**
 * Redact secrets and env values from doctor detail text before display.
 * Safe to call on any free-form doctor string.
 */
export function redactMcpText(text: string | null | undefined): string {
  if (!text) return "";
  let out = String(text);
  out = out.replace(ENV_PAIR_RE, "$1=[REDACTED]");
  out = out.replace(GENERIC_SECRET_RE, "[REDACTED]");
  out = redact(out);
  return out;
}

/** Collect free-form text blobs from a value (string / object / array). */
function collectTextBlobs(v: unknown, into: string[], depth = 0): void {
  if (depth > 4 || v == null) return;
  if (typeof v === "string") {
    const t = v.trim();
    if (t) into.push(t);
    return;
  }
  if (typeof v === "number" || typeof v === "boolean") {
    into.push(String(v));
    return;
  }
  if (Array.isArray(v)) {
    for (const item of v) collectTextBlobs(item, into, depth + 1);
    return;
  }
  if (isRecord(v)) {
    for (const [k, val] of Object.entries(v)) {
      // Skip obvious secret containers by key name.
      if (/token|secret|password|api[_-]?key|credential|authorization/i.test(k)) {
        continue;
      }
      collectTextBlobs(val, into, depth + 1);
    }
  }
}

/**
 * Detect auth-related tone from free text (case-insensitive).
 * Priority: auth_expired > auth_required > null.
 */
export function detectAuthToneFromText(
  text: string | null | undefined,
): "auth_expired" | "auth_required" | null {
  if (!text) return null;
  if (AUTH_EXPIRED_RE.test(text)) return "auth_expired";
  if (AUTH_REQUIRED_RE.test(text)) return "auth_required";
  // Generic token/auth mention without explicit expired/required is still auth_required
  // when combined with failure language (caller may pass failed-check text only).
  if (AUTHISH_RE.test(text) && ERROR_RE.test(text)) return "auth_required";
  if (AUTHISH_RE.test(text) && /\b(invalid|missing|denied|reject)/i.test(text)) {
    return "auth_required";
  }
  return null;
}

/**
 * Infer tone from a bag of text fragments + optional healthy flag.
 */
export function inferMcpStatusTone(
  texts: string[],
  healthy?: boolean | null,
): McpStatusTone {
  const joined = texts.filter(Boolean).join(" \n ");
  const auth = detectAuthToneFromText(joined);
  if (auth) return auth;

  if (healthy === true) {
    if (WARN_RE.test(joined)) return "warn";
    return "ok";
  }
  if (healthy === false) {
    if (ERROR_RE.test(joined) || joined.length > 0) return "error";
    return "error";
  }

  // No healthy flag — derive from keywords only.
  if (ERROR_RE.test(joined)) return "error";
  if (WARN_RE.test(joined)) return "warn";
  if (joined.length === 0) return "unknown";
  return "unknown";
}

function issueServerName(issue: string | McpDoctorIssueLike): string | null {
  if (typeof issue === "string") return null;
  return (
    asString(issue.serverName) ||
    asString(issue.server) ||
    asString(issue.name) ||
    null
  );
}

function issueText(issue: string | McpDoctorIssueLike): string {
  if (typeof issue === "string") return issue.trim();
  const parts = [
    asString(issue.message),
    asString(issue.detail),
    asString(issue.summary),
    asString(issue.status),
    asString(issue.level),
  ].filter(Boolean) as string[];
  return parts.join(" — ");
}

/**
 * Map top-level doctor issues onto server names when possible.
 * Unscoped issues go under key `""`.
 */
export function mapIssuesToServers(
  issues: Array<string | McpDoctorIssueLike> | null | undefined,
  knownServerNames: string[] = [],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const push = (key: string, text: string) => {
    const t = redactMcpText(text).trim();
    if (!t) return;
    const list = out.get(key) ?? [];
    list.push(t);
    out.set(key, list);
  };

  const knownLower = new Map(
    knownServerNames
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => [n.toLowerCase(), n] as const),
  );

  for (const issue of issues ?? []) {
    const text = issueText(issue);
    if (!text) continue;
    let name = issueServerName(issue);
    if (!name && knownLower.size > 0) {
      // Best-effort: issue text mentions a known server name.
      const lower = text.toLowerCase();
      for (const [k, original] of knownLower) {
        if (lower.includes(k)) {
          name = original;
          break;
        }
      }
    }
    push(name?.trim() || "", text);
  }
  return out;
}

function textsFromServer(server: McpDoctorServerLike): string[] {
  const texts: string[] = [];
  if (server.status) texts.push(String(server.status));
  if (server.error) texts.push(String(server.error));
  if (server.message) texts.push(String(server.message));
  for (const c of server.checks ?? []) {
    if (!c) continue;
    if (c.label) texts.push(String(c.label));
    if (c.detail) texts.push(String(c.detail));
    if (c.hint) texts.push(String(c.hint));
    if (c.message) texts.push(String(c.message));
    // Failed checks matter more for keyword scan — still include all text.
  }
  for (const issue of server.issues ?? []) {
    if (typeof issue === "string") texts.push(issue);
    else collectTextBlobs(issue, texts);
  }
  return texts;
}

function issuesFromServer(server: McpDoctorServerLike): string[] {
  const out: string[] = [];
  for (const c of server.checks ?? []) {
    if (!c || c.passed === true) continue;
    const line = [c.label, c.detail, c.hint, c.message]
      .map((x) => (x == null ? "" : String(x).trim()))
      .filter(Boolean)
      .join(" — ");
    const redacted = redactMcpText(line).trim();
    if (redacted) out.push(redacted);
  }
  for (const issue of server.issues ?? []) {
    const t =
      typeof issue === "string"
        ? redactMcpText(issue)
        : redactMcpText(issueText(issue as McpDoctorIssueLike));
    if (t.trim()) out.push(t.trim());
  }
  if (server.error) {
    const t = redactMcpText(String(server.error)).trim();
    if (t) out.push(t);
  }
  return out;
}

/**
 * Derive status for one doctor server row.
 */
export function statusFromDoctorServer(
  server: McpDoctorServerLike | null | undefined,
  extraIssues: string[] = [],
): McpServerStatus | null {
  if (!server) return null;
  const name = asString(server.name);
  if (!name) return null;

  const texts = [...textsFromServer(server), ...extraIssues];
  const healthy =
    typeof server.healthy === "boolean" ? server.healthy : null;
  // Also accept status string "ok" / "healthy" / "error" etc.
  let healthyFlag = healthy;
  if (healthyFlag == null && server.status) {
    const st = String(server.status).trim().toLowerCase();
    if (["ok", "healthy", "pass", "passed", "up"].includes(st)) {
      healthyFlag = true;
    } else if (
      ["error", "fail", "failed", "unhealthy", "down", "bad"].includes(st)
    ) {
      healthyFlag = false;
    }
  }

  const tone = inferMcpStatusTone(texts, healthyFlag);
  const issues = [
    ...issuesFromServer(server),
    ...extraIssues.map((x) => redactMcpText(x).trim()).filter(Boolean),
  ];
  // Deduplicate while preserving order.
  const seen = new Set<string>();
  const uniqueIssues: string[] = [];
  for (const i of issues) {
    if (seen.has(i)) continue;
    seen.add(i);
    uniqueIssues.push(i);
  }

  const reason =
    uniqueIssues[0] ??
    (tone === "ok"
      ? null
      : tone === "auth_expired"
        ? "Auth expired"
        : tone === "auth_required"
          ? "Auth required"
          : tone === "error"
            ? "Unhealthy"
            : tone === "warn"
              ? "Warning"
              : null);

  return {
    name,
    tone,
    reason: reason ? redactMcpText(reason).slice(0, 240) : null,
    needsAuthRefresh: tone === "auth_expired" || tone === "auth_required",
    issues: uniqueIssues.slice(0, 12),
    healthy: healthyFlag,
  };
}

/**
 * Build a name → status index from a full doctor report.
 * Maps top-level issues onto servers by name when possible.
 */
export function indexDoctorServerStatuses(
  report: McpDoctorReportLike | null | undefined,
): McpStatusIndex {
  const index: McpStatusIndex = new Map();
  if (!report) return index;

  const servers = Array.isArray(report.servers) ? report.servers : [];
  const knownNames = servers
    .map((s) => asString(s?.name) ?? "")
    .filter(Boolean);

  // Summary / envelope text for unscoped keyword detection.
  const summaryTexts: string[] = [];
  if (typeof report.summary === "string") {
    summaryTexts.push(report.summary);
  } else if (isRecord(report.summary)) {
    collectTextBlobs(report.summary, summaryTexts);
  }
  if (report.message) summaryTexts.push(String(report.message));
  if (report.error) summaryTexts.push(String(report.error));
  if (report.rawText) summaryTexts.push(String(report.rawText));

  const issueMap = mapIssuesToServers(report.issues ?? null, knownNames);

  for (const server of servers) {
    const name = asString(server?.name);
    if (!name) continue;
    const extra = [
      ...(issueMap.get(name) ?? []),
      // Case-insensitive issue map fallback
      ...[...issueMap.entries()]
        .filter(
          ([k]) => k && k !== name && k.toLowerCase() === name.toLowerCase(),
        )
        .flatMap(([, v]) => v),
    ];
    const status = statusFromDoctorServer(server, extra);
    if (status) index.set(name, status);
  }

  // Issues for unknown servers → synthetic error/auth rows.
  for (const [name, texts] of issueMap) {
    if (!name || index.has(name)) continue;
    const tone = inferMcpStatusTone(texts, false);
    index.set(name, {
      name,
      tone,
      reason: texts[0] ? redactMcpText(texts[0]).slice(0, 240) : null,
      needsAuthRefresh: tone === "auth_expired" || tone === "auth_required",
      issues: texts.map((t) => redactMcpText(t)).filter(Boolean).slice(0, 12),
      healthy: false,
    });
  }

  // If report has only summary-level auth problems and a single server, fold in.
  if (index.size === 1 && summaryTexts.length > 0) {
    const only = [...index.values()][0]!;
    const auth = detectAuthToneFromText(summaryTexts.join("\n"));
    if (auth && only.tone !== "auth_expired" && only.tone !== "auth_required") {
      index.set(only.name, {
        ...only,
        tone: auth,
        needsAuthRefresh: true,
        reason: only.reason ?? (auth === "auth_expired" ? "Auth expired" : "Auth required"),
      });
    }
  }

  return index;
}

/**
 * Lookup status for a list server name (exact then case-insensitive).
 */
export function lookupServerStatus(
  index: McpStatusIndex | null | undefined,
  name: string | null | undefined,
): McpServerStatus | null {
  if (!index || !name?.trim()) return null;
  const n = name.trim();
  if (index.has(n)) return index.get(n) ?? null;
  const lower = n.toLowerCase();
  for (const [k, v] of index) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

/** i18n key for a status tone badge label. */
export function mcpStatusLabelKey(tone: McpStatusTone): string {
  switch (tone) {
    case "ok":
      return "ext.mcp.status.ok";
    case "warn":
      return "ext.mcp.status.warn";
    case "error":
      return "ext.mcp.status.error";
    case "auth_expired":
      return "ext.mcp.status.authExpired";
    case "auth_required":
      return "ext.mcp.status.authRequired";
    case "unknown":
    default:
      return "ext.mcp.status.unknown";
  }
}

/** CSS modifier for ext-badge / lamp: ok | warn | fail | auth | muted */
export function mcpStatusBadgeMod(
  tone: McpStatusTone,
): "ok" | "warn" | "fail" | "auth" | "muted" {
  switch (tone) {
    case "ok":
      return "ok";
    case "warn":
      return "warn";
    case "error":
      return "fail";
    case "auth_expired":
    case "auth_required":
      return "auth";
    case "unknown":
    default:
      return "muted";
  }
}

/**
 * Short guidance key for auth tones (inline under the row).
 */
export function mcpAuthGuidanceKey(
  tone: McpStatusTone,
): "ext.mcp.auth.expiredHint" | "ext.mcp.auth.requiredHint" | null {
  if (tone === "auth_expired") return "ext.mcp.auth.expiredHint";
  if (tone === "auth_required") return "ext.mcp.auth.requiredHint";
  return null;
}

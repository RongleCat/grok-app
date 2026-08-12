/**
 * DOCTOR-PRO — pure helpers for Doctor findings triage UX.
 *
 * Normalizes App health checks + CLI doctor findings into unified rows,
 * classifies categories, filters, sorts, and formats copy / detail payloads.
 * Never invents findings — only maps honest host / CLI data.
 */

import type { DoctorCheck, DoctorLevel } from "@/lib/api";
import type { CliDoctorCheck, CliDoctorView } from "@/lib/cliDoctor";
import { redact } from "@/lib/redact";

/** Origin of a finding row. */
export type DoctorFindingSource = "app" | "cli";

/**
 * Stable triage categories.
 * App checks use their id; CLI findings use id prefix (e.g. `terminal.ssh-wrap` → terminal).
 */
export type DoctorFindingCategory =
  | "cli"
  | "auth"
  | "workspace"
  | "backend"
  | "logs"
  | "terminal"
  | "clipboard"
  | "color"
  | "multiplexer"
  | "ssh"
  | "voice"
  | "other";

export type DoctorFindingLevel = DoctorLevel;

/** One triage row consumed by DoctorModal list + detail GlassModal. */
export type DoctorFindingRow = {
  /** React / filter key: `${source}:${rawId}`. */
  key: string;
  /** Original check / finding id. */
  rawId: string;
  source: DoctorFindingSource;
  category: DoctorFindingCategory;
  level: DoctorFindingLevel;
  title: string;
  detail: string;
  disposition?: string;
  fixId?: string | null;
  destructive?: boolean;
};

export type DoctorFindingLevelFilter = "all" | DoctorFindingLevel;
export type DoctorFindingCategoryFilter = "all" | DoctorFindingCategory;
export type DoctorFindingSourceFilter = "all" | DoctorFindingSource;

export type DoctorFindingsFilter = {
  level?: DoctorFindingLevelFilter;
  category?: DoctorFindingCategoryFilter;
  source?: DoctorFindingSourceFilter;
  /** Free-text match on title / detail / id / fixId / disposition. */
  query?: string | null;
  /**
   * When true, hide pure ok rows (keep warn + fail).
   * Synthetic “clean” ok rows still drop unless they are the only findings.
   */
  issuesOnly?: boolean;
};

export type DoctorFindingsCounts = {
  ok: number;
  warn: number;
  fail: number;
  total: number;
  byCategory: Partial<Record<DoctorFindingCategory, number>>;
  bySource: { app: number; cli: number };
};

/** Stable category order for chips / select. */
export const DOCTOR_FINDING_CATEGORIES: DoctorFindingCategory[] = [
  "cli",
  "auth",
  "workspace",
  "backend",
  "logs",
  "terminal",
  "clipboard",
  "color",
  "multiplexer",
  "ssh",
  "voice",
  "other",
];

/** Level filter chip order. */
export const DOCTOR_FINDING_LEVEL_FILTERS: DoctorFindingLevelFilter[] = [
  "all",
  "fail",
  "warn",
  "ok",
];

/** Source filter chip order. */
export const DOCTOR_FINDING_SOURCE_FILTERS: DoctorFindingSourceFilter[] = [
  "all",
  "app",
  "cli",
];

const APP_CATEGORY_IDS = new Set<string>([
  "cli",
  "auth",
  "workspace",
  "backend",
  "logs",
]);

const KNOWN_CATEGORIES = new Set<string>(DOCTOR_FINDING_CATEGORIES);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asLevel(raw: unknown): DoctorFindingLevel {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (s === "fail" || s === "error" || s === "critical") return "fail";
  if (s === "warn" || s === "warning") return "warn";
  if (s === "ok" || s === "pass" || s === "info") return "ok";
  return "warn";
}

/**
 * Classify a finding id / title into a triage category.
 * Prefer dotted CLI prefixes (`terminal.ssh-wrap`), then exact app ids.
 */
export function classifyDoctorFindingCategory(
  id: string | null | undefined,
  title?: string | null,
): DoctorFindingCategory {
  const raw = (id ?? "").trim().toLowerCase();
  if (raw) {
    // Synthetic clean row
    if (raw === "cli-doctor-clean" || raw === "cli_doctor_clean") {
      return "cli";
    }
    if (APP_CATEGORY_IDS.has(raw)) {
      return raw as DoctorFindingCategory;
    }
    const head = raw.split(/[./:_-]/)[0] ?? "";
    if (head && KNOWN_CATEGORIES.has(head)) {
      return head as DoctorFindingCategory;
    }
    // Common aliases
    if (head === "authn" || head === "login" || head === "credential") {
      return "auth";
    }
    if (head === "term" || head === "tty") return "terminal";
    if (head === "clip" || head === "pbcopy") return "clipboard";
    if (head === "mux" || head === "tmux" || head === "byobu") {
      return "multiplexer";
    }
    if (head === "mic" || head === "audio") return "voice";
    if (head === "log" || head === "logging") return "logs";
    if (head === "ws" || head === "project" || head === "cwd") {
      return "workspace";
    }
    if (head === "agent" || head === "acp" || head === "runtime") {
      return "backend";
    }
    if (head === "grok" || head === "binary" || head === "path") {
      return "cli";
    }
  }

  const hay = `${id ?? ""} ${title ?? ""}`.toLowerCase();
  if (/\bauth|login|credential|token|api\s*key\b/.test(hay)) return "auth";
  if (/\bclipboard|pbcopy|pbpaste|osc52\b/.test(hay)) return "clipboard";
  if (/\bterminal|tty|iterm|color|no_color\b/.test(hay)) {
    if (/\bcolor|theme|no_color\b/.test(hay)) return "color";
    return "terminal";
  }
  if (/\btmux|byobu|multiplexer\b/.test(hay)) return "multiplexer";
  if (/\bssh\b/.test(hay)) return "ssh";
  if (/\bvoice|microphone|mic\b/.test(hay)) return "voice";
  if (/\blog(s|ging)?\b/.test(hay)) return "logs";
  if (/\bworkspace|project|session\b/.test(hay)) return "workspace";
  if (/\bbackend|agent|acp\b/.test(hay)) return "backend";
  if (/\bcli|grok build|binary\b/.test(hay)) return "cli";
  return "other";
}

function makeKey(source: DoctorFindingSource, rawId: string): string {
  return `${source}:${rawId}`;
}

/**
 * App-managed repair for CLI agent binary skew (`cli_agent_skew` check).
 * Not a CLI `grok doctor fix` id — Host `cli_repair_agent_sidecar`.
 */
export const APP_AGENT_SIDECAR_SKEW_FINDING_ID = "cli_agent_skew";

/** Soft-only: probe banner vs last live ACP agentVersion (`cli_acp_version_skew`). */
export const APP_ACP_VERSION_SKEW_FINDING_ID = "cli_acp_version_skew";

/** True when this finding can use one-click agent sidecar repair. */
export function isAgentSidecarSkewFinding(
  row: Pick<DoctorFindingRow, "rawId" | "source"> | null | undefined,
): boolean {
  if (!row || row.source !== "app") return false;
  return row.rawId === APP_AGENT_SIDECAR_SKEW_FINDING_ID;
}

/** True when this finding is the soft ACP agentVersion skew warn (no hard block). */
export function isAcpVersionSkewFinding(
  row: Pick<DoctorFindingRow, "rawId" | "source"> | null | undefined,
): boolean {
  if (!row || row.source !== "app") return false;
  return row.rawId === APP_ACP_VERSION_SKEW_FINDING_ID;
}

/** Map a host App `DoctorCheck` into a triage row. */
export function normalizeAppDoctorCheck(
  check: DoctorCheck | null | undefined,
): DoctorFindingRow | null {
  if (!check || typeof check !== "object") return null;
  const rawId = String(check.id ?? "").trim();
  if (!rawId) return null;
  const title = String(check.title ?? rawId).trim() || rawId;
  const detail = redact(String(check.detail ?? "")).trim();
  return {
    key: makeKey("app", rawId),
    rawId,
    source: "app",
    category: classifyDoctorFindingCategory(rawId, title),
    level: asLevel(check.level),
    title,
    detail,
  };
}

/** Map a CLI doctor check into a triage row. */
export function normalizeCliDoctorCheck(
  check: CliDoctorCheck | null | undefined,
): DoctorFindingRow | null {
  if (!check || typeof check !== "object") return null;
  const rawId = String(check.id ?? "").trim();
  if (!rawId) return null;
  const title = String(check.title ?? rawId).trim() || rawId;
  const detail = redact(String(check.detail ?? "")).trim();
  const fixId = check.fixId?.trim() || null;
  return {
    key: makeKey("cli", rawId),
    rawId,
    source: "cli",
    category: classifyDoctorFindingCategory(rawId, title),
    level: asLevel(check.level),
    title,
    detail,
    disposition: check.disposition,
    fixId: fixId || null,
    destructive: check.destructive,
  };
}

/**
 * Collect App + CLI findings into one sorted list.
 * When CLI is unavailable, only App checks are included (no fake CLI rows).
 * Skips the synthetic “cli-doctor-clean” ok row when other CLI findings exist
 * or when App checks already cover the list (keeps list honest).
 */
export function collectDoctorFindings(
  appChecks: DoctorCheck[] | null | undefined,
  cliView: CliDoctorView | null | undefined,
): DoctorFindingRow[] {
  const out: DoctorFindingRow[] = [];

  for (const c of appChecks ?? []) {
    const row = normalizeAppDoctorCheck(c);
    if (row) out.push(row);
  }

  if (cliView?.available) {
    const cliRows: DoctorFindingRow[] = [];
    for (const c of cliView.checks) {
      const row = normalizeCliDoctorCheck(c);
      if (row) cliRows.push(row);
    }
    const realCli = cliRows.filter((r) => r.rawId !== "cli-doctor-clean");
    if (realCli.length > 0) {
      out.push(...realCli);
    } else if (cliRows.length === 1 && cliRows[0]!.rawId === "cli-doctor-clean") {
      // Surface one clean row so “CLI doctor ok” is visible in triage.
      out.push(cliRows[0]!);
    }
  }

  return sortDoctorFindings(out);
}

const LEVEL_RANK: Record<DoctorFindingLevel, number> = {
  fail: 0,
  warn: 1,
  ok: 2,
};

const SOURCE_RANK: Record<DoctorFindingSource, number> = {
  app: 0,
  cli: 1,
};

/** fail → warn → ok, then app before cli, then id. */
export function sortDoctorFindings(rows: DoctorFindingRow[]): DoctorFindingRow[] {
  return [...rows].sort((a, b) => {
    const lr = LEVEL_RANK[a.level] - LEVEL_RANK[b.level];
    if (lr !== 0) return lr;
    const sr = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
    if (sr !== 0) return sr;
    return a.rawId.localeCompare(b.rawId);
  });
}

export function countDoctorFindings(
  rows: DoctorFindingRow[],
): DoctorFindingsCounts {
  let ok = 0;
  let warn = 0;
  let fail = 0;
  const byCategory: Partial<Record<DoctorFindingCategory, number>> = {};
  const bySource = { app: 0, cli: 0 };
  for (const r of rows) {
    if (r.level === "ok") ok += 1;
    else if (r.level === "warn") warn += 1;
    else fail += 1;
    byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
    bySource[r.source] += 1;
  }
  return { ok, warn, fail, total: rows.length, byCategory, bySource };
}

/** Free-text match helper. */
export function doctorFindingMatchesQuery(
  row: DoctorFindingRow,
  query: string | null | undefined,
): boolean {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return true;
  const hay = [
    row.title,
    row.detail,
    row.rawId,
    row.key,
    row.category,
    row.source,
    row.level,
    row.disposition ?? "",
    row.fixId ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

/** Filter + optional re-sort (stable relative order when sorted input). */
export function filterDoctorFindings(
  rows: DoctorFindingRow[],
  filter: DoctorFindingsFilter | null | undefined = {},
): DoctorFindingRow[] {
  const f = filter ?? {};
  const level = f.level ?? "all";
  const category = f.category ?? "all";
  const source = f.source ?? "all";
  const issuesOnly = !!f.issuesOnly;

  return rows.filter((r) => {
    if (level !== "all" && r.level !== level) return false;
    if (category !== "all" && r.category !== category) return false;
    if (source !== "all" && r.source !== source) return false;
    if (issuesOnly && r.level === "ok") return false;
    if (!doctorFindingMatchesQuery(r, f.query)) return false;
    return true;
  });
}

/** Categories present in the current set (for chip visibility). */
export function categoriesPresent(
  rows: DoctorFindingRow[],
): DoctorFindingCategory[] {
  const seen = new Set<DoctorFindingCategory>();
  for (const r of rows) seen.add(r.category);
  return DOCTOR_FINDING_CATEGORIES.filter((c) => seen.has(c));
}

/** Plain-text block for one finding (clipboard; redacted). */
export function doctorFindingCopyText(row: DoctorFindingRow): string {
  const lines = [
    `[${row.level.toUpperCase()}] ${row.title}`,
    `id: ${row.rawId}`,
    `source: ${row.source}`,
    `category: ${row.category}`,
  ];
  if (row.disposition) lines.push(`disposition: ${row.disposition}`);
  if (row.fixId) {
    lines.push(
      `fixId: ${row.fixId}${row.destructive ? " (destructive)" : ""}`,
    );
  }
  if (row.detail) lines.push("", row.detail);
  return redact(lines.join("\n")).trim();
}

/** Multi-finding clipboard payload. */
export function doctorFindingsCopyText(rows: DoctorFindingRow[]): string {
  if (rows.length === 0) return "";
  const blocks = rows.map((r, i) => {
    const head = `### ${i + 1}/${rows.length}`;
    return `${head}\n${doctorFindingCopyText(r)}`;
  });
  return redact(
    `Doctor findings (${rows.length})\n\n${blocks.join("\n\n")}`,
  ).trim();
}

/* ── Doctor findings export pro (redacted text / JSON download) ─────────── */

/** Cap rows in a single export file (UI filter already shrinks the set). */
export const DOCTOR_FINDINGS_EXPORT_MAX = 200;
/** Cap free-form title / detail fields so exports never carry multi-kb dumps. */
export const DOCTOR_FINDINGS_EXPORT_FIELD_MAX = 400;

/** One row in a findings export file (known fields only; re-redacted). */
export type DoctorFindingsExportRow = {
  id: string;
  source: DoctorFindingSource;
  category: DoctorFindingCategory;
  level: DoctorFindingLevel;
  title: string;
  detail: string;
  disposition: string | null;
  fixId: string | null;
  destructive: boolean | null;
};

/** Echo of filters used to select rows (never free-form secrets). */
export type DoctorFindingsExportFilter = {
  level: DoctorFindingLevelFilter;
  category: DoctorFindingCategoryFilter;
  source: DoctorFindingSourceFilter;
  query: string | null;
  issuesOnly: boolean;
};

/**
 * Redacted doctor findings export (download / clipboard).
 * Structured fields only — titles/details re-run through {@link redact}.
 */
export type DoctorFindingsExport = {
  kind: "doctor_findings";
  generatedAt: string;
  source: "doctor";
  count: number;
  /** Level / source summary for the exported set (filter-aware). */
  summary: {
    ok: number;
    warn: number;
    fail: number;
    total: number;
    bySource: { app: number; cli: number };
  };
  filter: DoctorFindingsExportFilter;
  findings: DoctorFindingsExportRow[];
};

function capExportField(
  raw: string | null | undefined,
  max: number = DOCTOR_FINDINGS_EXPORT_FIELD_MAX,
): string {
  if (typeof raw !== "string") return "";
  const t = redact(raw).replace(/\u0000/g, "").trim();
  if (!t) return "";
  return t.slice(0, Math.max(0, max));
}

function normalizeExportFilter(
  filter?: Partial<DoctorFindingsExportFilter> | DoctorFindingsFilter | null,
): DoctorFindingsExportFilter {
  const f = filter ?? {};
  const level =
    f.level === "ok" || f.level === "warn" || f.level === "fail"
      ? f.level
      : "all";
  const category =
    f.category && f.category !== "all" && KNOWN_CATEGORIES.has(f.category)
      ? (f.category as DoctorFindingCategory)
      : "all";
  const source =
    f.source === "app" || f.source === "cli" ? f.source : "all";
  const queryRaw = typeof f.query === "string" ? f.query.trim() : "";
  return {
    level,
    category,
    source,
    query: queryRaw
      ? capExportField(queryRaw, DOCTOR_FINDINGS_EXPORT_FIELD_MAX)
      : null,
    issuesOnly: !!(f as { issuesOnly?: boolean }).issuesOnly,
  };
}

/**
 * Build a download/clipboard-ready redacted export from finding rows.
 * Prefer filtered rows from {@link filterDoctorFindings}. Never invents data.
 * Empty input → count 0 snapshot (caller soft-fails UI; no throw).
 */
export function buildDoctorFindingsExport(
  rows: readonly DoctorFindingRow[],
  opts?: {
    nowMs?: number;
    max?: number;
    generatedAt?: string;
    filter?: Partial<DoctorFindingsExportFilter> | DoctorFindingsFilter | null;
  },
): DoctorFindingsExport {
  const max = Math.max(
    0,
    Math.floor(opts?.max ?? DOCTOR_FINDINGS_EXPORT_MAX),
  );
  const generatedAt =
    opts?.generatedAt ??
    new Date(opts?.nowMs ?? Date.now()).toISOString();
  const filter = normalizeExportFilter(opts?.filter);

  const out: DoctorFindingsExportRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const rawId = String(r.rawId ?? "").trim();
    if (!rawId) continue;
    const key = String(r.key ?? makeKey(r.source, rawId)).trim() || rawId;
    if (seen.has(key)) continue;
    seen.add(key);

    const source: DoctorFindingSource =
      r.source === "cli" ? "cli" : "app";
    const level = asLevel(r.level);
    const category = KNOWN_CATEGORIES.has(r.category)
      ? r.category
      : classifyDoctorFindingCategory(rawId, r.title);

    const fixIdRaw =
      typeof r.fixId === "string" && r.fixId.trim() ? r.fixId.trim() : null;
    out.push({
      id: capExportField(rawId, 120) || rawId.slice(0, 120),
      source,
      category,
      level,
      title: capExportField(r.title) || rawId,
      detail: capExportField(r.detail),
      disposition: (() => {
        const d = capExportField(r.disposition, 120);
        return d || null;
      })(),
      fixId: fixIdRaw ? capExportField(fixIdRaw, 120) || null : null,
      destructive: fixIdRaw ? r.destructive === true : null,
    });
    if (out.length >= max) break;
  }

  let ok = 0;
  let warn = 0;
  let fail = 0;
  const bySource = { app: 0, cli: 0 };
  for (const row of out) {
    if (row.level === "ok") ok += 1;
    else if (row.level === "warn") warn += 1;
    else fail += 1;
    bySource[row.source] += 1;
  }

  return {
    kind: "doctor_findings",
    generatedAt,
    source: "doctor",
    count: out.length,
    summary: {
      ok,
      warn,
      fail,
      total: out.length,
      bySource,
    },
    filter,
    findings: out,
  };
}

/** Pretty JSON for client download (known fields only; already redacted). */
export function serializeDoctorFindingsExport(
  snapshot: DoctorFindingsExport,
): string {
  return JSON.stringify(snapshot, null, 2);
}

/**
 * Plain-text export body (clipboard / .txt). Empty snapshot → empty string
 * so UI can soft-fail without inventing findings.
 */
export function formatDoctorFindingsExportText(
  snapshot: DoctorFindingsExport,
): string {
  if (!snapshot || snapshot.count === 0 || snapshot.findings.length === 0) {
    return "";
  }
  const f = snapshot.filter;
  const s = snapshot.summary;
  const filterLine = [
    `level=${f.level}`,
    `category=${f.category}`,
    `source=${f.source}`,
    `issuesOnly=${f.issuesOnly ? "true" : "false"}`,
    f.query ? `query=${f.query}` : "query=",
  ].join(" ");
  const summaryLine =
    `total=${s.total} ok=${s.ok} warn=${s.warn} fail=${s.fail}` +
    ` · app=${s.bySource.app} cli=${s.bySource.cli}`;

  const blocks = snapshot.findings.map((row, i) => {
    const lines = [
      `### ${i + 1}/${snapshot.count}`,
      `[${row.level.toUpperCase()}] ${row.title}`,
      `id: ${row.id}`,
      `source: ${row.source}`,
      `category: ${row.category}`,
    ];
    if (row.disposition) lines.push(`disposition: ${row.disposition}`);
    if (row.fixId) {
      lines.push(
        `fixId: ${row.fixId}${row.destructive ? " (destructive)" : ""}`,
      );
    }
    if (row.detail) {
      lines.push("");
      lines.push(row.detail);
    }
    return lines.join("\n");
  });

  const body = [
    "# Doctor findings export (redacted)",
    `generatedAt: ${snapshot.generatedAt}`,
    `filter: ${filterLine}`,
    `summary: ${summaryLine}`,
    "",
    blocks.join("\n\n"),
  ].join("\n");

  return redact(body).trim();
}

/** Soft-empty: nothing honest to export for this filter. */
export function doctorFindingsExportIsEmpty(
  snapshot: DoctorFindingsExport | null | undefined,
): boolean {
  return !snapshot || snapshot.count === 0 || snapshot.findings.length === 0;
}

/** Filesystem-safe download basename (no extension). */
export function doctorFindingsExportBasename(
  generatedAt?: string | null,
): string {
  const stamp = (generatedAt ?? new Date().toISOString())
    .slice(0, 19)
    .replace(/[:T]/g, "-")
    .replace(/[^0-9A-Za-z._-]/g, "");
  return `grok-app-doctor-findings-${stamp || "export"}`;
}

export function doctorFindingsExportJsonFilename(
  generatedAt?: string | null,
): string {
  return `${doctorFindingsExportBasename(generatedAt)}.json`;
}

export function doctorFindingsExportTextFilename(
  generatedAt?: string | null,
): string {
  return `${doctorFindingsExportBasename(generatedAt)}.txt`;
}

/** Detail payload for GlassModal (already redacted strings). */
export type DoctorFindingDetail = {
  row: DoctorFindingRow;
  /** Headline for modal title. */
  title: string;
  /** Level + category + source chips context. */
  subtitle: string;
  detail: string;
  fixId: string | null;
  destructive: boolean;
  copyText: string;
};

export function presentDoctorFindingDetail(
  row: DoctorFindingRow | null | undefined,
): DoctorFindingDetail | null {
  if (!row) return null;
  const fixId = row.fixId?.trim() || null;
  return {
    row,
    title: row.title,
    subtitle: `${row.level} · ${row.category} · ${row.source}`,
    detail: row.detail,
    fixId,
    destructive: fixId ? row.destructive !== false : false,
    copyText: doctorFindingCopyText(row),
  };
}

/**
 * Loose-shape collect for tests / support tools: accepts partial checks arrays
 * without full CliDoctorView.
 */
export function collectDoctorFindingsLoose(input: {
  appChecks?: Array<Partial<DoctorCheck> | null> | null;
  cliChecks?: Array<Partial<CliDoctorCheck> | null> | null;
  cliAvailable?: boolean;
}): DoctorFindingRow[] {
  const app: DoctorCheck[] = [];
  for (const c of input.appChecks ?? []) {
    if (!c || !isRecord(c) || !c.id) continue;
    app.push({
      id: String(c.id),
      level: asLevel(c.level),
      title: String(c.title ?? c.id),
      detail: String(c.detail ?? ""),
      meta: isRecord(c.meta) ? c.meta : undefined,
    });
  }

  let cliView: CliDoctorView | null = null;
  if (input.cliAvailable !== false && (input.cliChecks?.length ?? 0) > 0) {
    const checks: CliDoctorCheck[] = [];
    for (const c of input.cliChecks ?? []) {
      if (!c || !c.id) continue;
      checks.push({
        id: String(c.id),
        level: asLevel(c.level),
        title: String(c.title ?? c.id),
        detail: String(c.detail ?? ""),
        disposition: c.disposition,
        fixId: c.fixId ?? null,
        destructive: c.destructive,
      });
    }
    cliView = {
      available: true,
      error: null,
      schemaVersion: null,
      checks,
      facts: {},
      counts: null,
      probeNotes: [],
      summary: countDoctorFindings(
        checks.map(
          (x) =>
            normalizeCliDoctorCheck(x) ?? {
              key: `cli:${x.id}`,
              rawId: x.id,
              source: "cli" as const,
              category: "other" as const,
              level: x.level,
              title: x.title,
              detail: x.detail,
            },
        ),
      ),
    };
  }

  return collectDoctorFindings(app, cliView);
}

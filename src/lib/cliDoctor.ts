/**
 * Parse Grok Build CLI `doctor --json` into safe UI rows.
 *
 * Schema (v1): schemaVersion, facts, findings[], probeNotes[], counts.
 * Never surfaces secret-like values — only host/env facts and findings.
 */

export type DoctorLevel = "ok" | "warn" | "fail";

/** One finding (or synthetic status row) for the CLI doctor section. */
export type CliDoctorCheck = {
  id: string;
  level: DoctorLevel;
  /** Finding message or short title. */
  title: string;
  /** Note / remediation / disposition context. */
  detail: string;
  disposition?: string;
};

/** Safe, human-readable fact chips (no paths that embed tokens). */
export type CliDoctorSafeFacts = {
  terminal?: string | null;
  multiplexer?: string | null;
  ssh?: boolean | null;
  color?: string | null;
  clipboard?: string | null;
  voice?: string | null;
};

export type CliDoctorCounts = {
  issues: number;
  recommendations: number;
  probeNotes: number;
};

export type CliDoctorProbeNote = {
  probe: string;
  status: string;
  message?: string | null;
};

/**
 * Normalized view consumed by DoctorModal.
 * Built from either the host envelope (`cliDoctor` field) or a raw CLI blob.
 */
export type CliDoctorView = {
  available: boolean;
  error: string | null;
  schemaVersion: string | null;
  checks: CliDoctorCheck[];
  facts: CliDoctorSafeFacts;
  counts: CliDoctorCounts | null;
  probeNotes: CliDoctorProbeNote[];
  /** Mini summary over `checks` only. */
  summary: { ok: number; warn: number; fail: number };
};

const EMPTY_FACTS: CliDoctorSafeFacts = {};

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

function asBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  return null;
}

/**
 * Map CLI finding disposition → Doctor level.
 * Known: issue → fail, recommendation → warn, ok/pass/info → ok.
 */
export function dispositionToLevel(disposition: string | null | undefined): DoctorLevel {
  const d = (disposition ?? "").trim().toLowerCase();
  if (!d) return "warn";
  if (d === "issue" || d === "error" || d === "fail" || d === "failed" || d === "critical") {
    return "fail";
  }
  if (
    d === "recommendation" ||
    d === "recommend" ||
    d === "warn" ||
    d === "warning" ||
    d === "advice"
  ) {
    return "warn";
  }
  if (d === "ok" || d === "pass" || d === "passed" || d === "info" || d === "note") {
    return "ok";
  }
  return "warn";
}

function summarizeLevel(checks: CliDoctorCheck[]): { ok: number; warn: number; fail: number } {
  let ok = 0;
  let warn = 0;
  let fail = 0;
  for (const c of checks) {
    if (c.level === "ok") ok += 1;
    else if (c.level === "warn") warn += 1;
    else fail += 1;
  }
  return { ok, warn, fail };
}

/** Pull useful non-secret facts for the collapsible summary. */
export function extractSafeFacts(facts: unknown): CliDoctorSafeFacts {
  if (!isRecord(facts)) return { ...EMPTY_FACTS };

  const terminal = isRecord(facts.terminal) ? asString(facts.terminal.name) : asString(facts.terminal);

  let multiplexer: string | null = null;
  if (isRecord(facts.multiplexer)) {
    const kind = asString(facts.multiplexer.kind);
    const byobu = asString(facts.multiplexer.byobu);
    multiplexer = [kind, byobu ? `byobu=${byobu}` : null].filter(Boolean).join(" · ") || null;
  } else {
    multiplexer = asString(facts.multiplexer);
  }

  let color: string | null = null;
  if (isRecord(facts.color)) {
    const level = isRecord(facts.color.level)
      ? asString(facts.color.level.value) ?? asString(facts.color.level.status)
      : asString(facts.color.level);
    const themes =
      typeof facts.color.totalThemes === "number"
        ? `${facts.color.totalThemes} themes`
        : null;
    color = [level, themes].filter(Boolean).join(" · ") || null;
  } else {
    color = asString(facts.color);
  }

  let clipboard: string | null = null;
  if (isRecord(facts.clipboard)) {
    const delivery = asString(facts.clipboard.delivery);
    const tool = asString(facts.clipboard.nativeTool);
    const preflight = asString(facts.clipboard.nativePreflight);
    const display = asString(facts.clipboard.displayServer);
    clipboard =
      [delivery, tool ? `tool=${tool}` : null, preflight, display]
        .filter(Boolean)
        .join(" · ") || null;
  } else {
    clipboard = asString(facts.clipboard);
  }

  let voice: string | null = null;
  if (isRecord(facts.voice)) {
    const status = asString(facts.voice.status);
    const name = asString(facts.voice.name);
    voice = [status, name].filter(Boolean).join(" · ") || null;
  } else {
    voice = asString(facts.voice);
  }

  return {
    terminal,
    multiplexer,
    ssh: asBool(facts.ssh),
    color,
    clipboard,
    voice,
  };
}

export function parseFinding(raw: unknown, index: number): CliDoctorCheck | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id) ?? `finding-${index}`;
  const disposition = asString(raw.disposition) ?? undefined;
  const message = asString(raw.message) ?? id;
  const note = asString(raw.note);
  const remediation = asString(raw.remediation);
  const auto = asString(raw.automaticRemediation);
  const detailParts = [note, remediation, auto].filter(Boolean);
  const detail =
    detailParts.length > 0
      ? detailParts.join(" · ")
      : disposition
        ? `disposition: ${disposition}`
        : "";
  return {
    id,
    level: dispositionToLevel(disposition),
    title: message,
    detail,
    disposition,
  };
}

export function parseProbeNotes(raw: unknown): CliDoctorProbeNote[] {
  if (!Array.isArray(raw)) return [];
  const out: CliDoctorProbeNote[] = [];
  for (const row of raw) {
    if (!isRecord(row)) continue;
    const probe = asString(row.probe);
    if (!probe) continue;
    out.push({
      probe,
      status: asString(row.status) ?? "unknown",
      message: asString(row.message),
    });
  }
  return out;
}

function parseCounts(raw: unknown): CliDoctorCounts | null {
  if (!isRecord(raw)) return null;
  const issues = typeof raw.issues === "number" ? raw.issues : 0;
  const recommendations =
    typeof raw.recommendations === "number" ? raw.recommendations : 0;
  const probeNotes = typeof raw.probeNotes === "number" ? raw.probeNotes : 0;
  return { issues, recommendations, probeNotes };
}

/**
 * Parse the inner CLI doctor JSON object (`schemaVersion` / `findings` / …).
 */
export function parseCliDoctorReport(report: unknown): Omit<
  CliDoctorView,
  "available" | "error"
> {
  if (!isRecord(report)) {
    return {
      schemaVersion: null,
      checks: [],
      facts: {},
      counts: null,
      probeNotes: [],
      summary: { ok: 0, warn: 0, fail: 0 },
    };
  }

  const schemaVersion = asString(report.schemaVersion);
  const facts = extractSafeFacts(report.facts);
  const counts = parseCounts(report.counts);
  const probeNotes = parseProbeNotes(report.probeNotes);

  const checks: CliDoctorCheck[] = [];
  if (Array.isArray(report.findings)) {
    report.findings.forEach((f, i) => {
      const row = parseFinding(f, i);
      if (row) checks.push(row);
    });
  } else if (Array.isArray(report.checks)) {
    // Alternate shapes some CLI versions may emit.
    report.checks.forEach((f, i) => {
      const row = parseFinding(f, i);
      if (row) checks.push(row);
    });
  }

  // Healthy CLI doctor with zero findings → one synthetic ok row so the UI
  // is not empty when facts still matter.
  if (checks.length === 0) {
    checks.push({
      id: "cli-doctor-clean",
      level: "ok",
      title: "No CLI doctor findings",
      detail: counts
        ? `${counts.issues} issues · ${counts.recommendations} recommendations`
        : "CLI doctor completed without findings",
    });
  }

  return {
    schemaVersion,
    checks,
    facts,
    counts,
    probeNotes,
    summary: summarizeLevel(checks),
  };
}

/**
 * Host envelope from `doctor_report` → `cliDoctor` field:
 * `{ available, error, report }`.
 * Also accepts a bare CLI doctor blob for tests / support zip.
 */
export function parseCliDoctorEnvelope(input: unknown): CliDoctorView {
  if (input == null) {
    return {
      available: false,
      error: "CLI doctor not included in report",
      schemaVersion: null,
      checks: [],
      facts: {},
      counts: null,
      probeNotes: [],
      summary: { ok: 0, warn: 0, fail: 0 },
    };
  }

  // Bare CLI blob (has findings/facts/schemaVersion at top level).
  if (
    isRecord(input) &&
    (input.findings != null ||
      input.facts != null ||
      input.schemaVersion != null) &&
    input.report == null &&
    input.available == null
  ) {
    const parsed = parseCliDoctorReport(input);
    return { available: true, error: null, ...parsed };
  }

  if (!isRecord(input)) {
    return {
      available: false,
      error: "Invalid CLI doctor payload",
      schemaVersion: null,
      checks: [],
      facts: {},
      counts: null,
      probeNotes: [],
      summary: { ok: 0, warn: 0, fail: 0 },
    };
  }

  const available = input.available !== false && input.report != null;
  const error = asString(input.error);
  if (!available) {
    return {
      available: false,
      error: error ?? "Grok Build CLI doctor unavailable",
      schemaVersion: null,
      checks: [],
      facts: {},
      counts: null,
      probeNotes: [],
      summary: { ok: 0, warn: 0, fail: 0 },
    };
  }

  const parsed = parseCliDoctorReport(input.report);
  return {
    available: true,
    error: error,
    ...parsed,
  };
}

/** Fact keys shown in the collapsible block (stable order). */
export const CLI_DOCTOR_FACT_KEYS: Array<keyof CliDoctorSafeFacts> = [
  "terminal",
  "clipboard",
  "color",
  "multiplexer",
  "ssh",
  "voice",
];

export function hasAnySafeFact(facts: CliDoctorSafeFacts): boolean {
  return CLI_DOCTOR_FACT_KEYS.some((k) => {
    const v = facts[k];
    return v !== undefined && v !== null && v !== "";
  });
}

export function formatFactValue(key: keyof CliDoctorSafeFacts, value: unknown): string {
  if (key === "ssh") {
    if (value === true) return "yes";
    if (value === false) return "no";
    return "—";
  }
  if (value == null || value === "") return "—";
  return String(value);
}

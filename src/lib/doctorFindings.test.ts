import { describe, expect, it } from "vitest";
import type { DoctorCheck } from "@/lib/api";
import type { CliDoctorCheck, CliDoctorView } from "@/lib/cliDoctor";
import {
  buildDoctorFindingsExport,
  categoriesPresent,
  classifyDoctorFindingCategory,
  collectDoctorFindings,
  collectDoctorFindingsLoose,
  countDoctorFindings,
  doctorFindingCopyText,
  doctorFindingMatchesQuery,
  doctorFindingsCopyText,
  doctorFindingsExportIsEmpty,
  doctorFindingsExportJsonFilename,
  doctorFindingsExportTextFilename,
  filterDoctorFindings,
  formatDoctorFindingsExportText,
  APP_AGENT_SIDECAR_SKEW_FINDING_ID,
  APP_ACP_VERSION_SKEW_FINDING_ID,
  isAgentSidecarSkewFinding,
  isAcpVersionSkewFinding,
  normalizeAppDoctorCheck,
  normalizeCliDoctorCheck,
  presentDoctorFindingDetail,
  serializeDoctorFindingsExport,
  sortDoctorFindings,
  type DoctorFindingRow,
} from "./doctorFindings";

const APP_CHECKS: DoctorCheck[] = [
  {
    id: "cli",
    level: "ok",
    title: "Grok Build CLI",
    detail: "Found 0.2.117 at /usr/local/bin/grok",
  },
  {
    id: "auth",
    level: "warn",
    title: "Authentication",
    detail: "No CLI auth configured",
  },
  {
    id: "workspace",
    level: "ok",
    title: "Workspace",
    detail: "2 projects · 5 sessions",
  },
  {
    id: "backend",
    level: "ok",
    title: "Backend",
    detail: "Agent backend: grok_agent_stdio",
  },
  {
    id: "logs",
    level: "warn",
    title: "Logs",
    detail: "Logs directory not created yet",
  },
];

const CLI_CHECKS: CliDoctorCheck[] = [
  {
    id: "terminal.limited-color",
    level: "fail",
    title: "NO_COLOR set -- themed colors disabled",
    detail: "Unset NO_COLOR and restart Grok.",
    disposition: "issue",
  },
  {
    id: "clipboard.ok",
    level: "warn",
    title: "Prefer native clipboard when available",
    detail: "Use pbcopy · disposition: recommendation",
    disposition: "recommendation",
  },
  {
    id: "terminal.ssh-wrap",
    level: "warn",
    title: "Wrap ssh through grok wrap",
    detail: "fix: ssh-wrap",
    disposition: "recommendation",
    fixId: "ssh-wrap",
    destructive: true,
  },
];

function cliView(checks: CliDoctorCheck[], available = true): CliDoctorView {
  return {
    available,
    error: available ? null : "missing",
    schemaVersion: "1",
    checks,
    facts: {},
    counts: null,
    probeNotes: [],
    summary: { ok: 0, warn: 0, fail: 0 },
  };
}

describe("classifyDoctorFindingCategory", () => {
  it("maps app check ids", () => {
    expect(classifyDoctorFindingCategory("cli")).toBe("cli");
    expect(classifyDoctorFindingCategory("auth")).toBe("auth");
    expect(classifyDoctorFindingCategory("workspace")).toBe("workspace");
    expect(classifyDoctorFindingCategory("backend")).toBe("backend");
    expect(classifyDoctorFindingCategory("logs")).toBe("logs");
  });

  it("maps dotted CLI finding prefixes", () => {
    expect(classifyDoctorFindingCategory("terminal.ssh-wrap")).toBe(
      "terminal",
    );
    expect(classifyDoctorFindingCategory("clipboard.ok")).toBe("clipboard");
    expect(classifyDoctorFindingCategory("color.theme")).toBe("color");
    expect(classifyDoctorFindingCategory("voice.mic")).toBe("voice");
    expect(classifyDoctorFindingCategory("multiplexer.tmux")).toBe(
      "multiplexer",
    );
    expect(classifyDoctorFindingCategory("ssh.agent")).toBe("ssh");
  });

  it("falls back to title heuristics", () => {
    expect(classifyDoctorFindingCategory("x1", "Token expired")).toBe("auth");
    expect(classifyDoctorFindingCategory("", "pbcopy missing")).toBe(
      "clipboard",
    );
    expect(classifyDoctorFindingCategory("weird", "something else")).toBe(
      "other",
    );
  });

  it("maps synthetic clean id to cli", () => {
    expect(classifyDoctorFindingCategory("cli-doctor-clean")).toBe("cli");
  });
});

describe("isAgentSidecarSkewFinding", () => {
  it("matches app cli_agent_skew only", () => {
    expect(
      isAgentSidecarSkewFinding({
        rawId: APP_AGENT_SIDECAR_SKEW_FINDING_ID,
        source: "app",
      }),
    ).toBe(true);
    expect(isAgentSidecarSkewFinding({ rawId: "cli", source: "app" })).toBe(
      false,
    );
    expect(
      isAgentSidecarSkewFinding({
        rawId: APP_AGENT_SIDECAR_SKEW_FINDING_ID,
        source: "cli",
      }),
    ).toBe(false);
  });
});

describe("isAcpVersionSkewFinding", () => {
  it("matches app cli_acp_version_skew only", () => {
    expect(
      isAcpVersionSkewFinding({
        rawId: APP_ACP_VERSION_SKEW_FINDING_ID,
        source: "app",
      }),
    ).toBe(true);
    expect(
      isAcpVersionSkewFinding({
        rawId: APP_AGENT_SIDECAR_SKEW_FINDING_ID,
        source: "app",
      }),
    ).toBe(false);
    expect(
      isAcpVersionSkewFinding({
        rawId: APP_ACP_VERSION_SKEW_FINDING_ID,
        source: "cli",
      }),
    ).toBe(false);
  });
});

describe("normalizeAppDoctorCheck / normalizeCliDoctorCheck", () => {
  it("normalizes app checks", () => {
    const row = normalizeAppDoctorCheck(APP_CHECKS[1]!);
    expect(row).toMatchObject({
      key: "app:auth",
      rawId: "auth",
      source: "app",
      category: "auth",
      level: "warn",
      title: "Authentication",
    });
  });

  it("normalizes CLI checks with fix handles", () => {
    const row = normalizeCliDoctorCheck(CLI_CHECKS[2]!);
    expect(row).toMatchObject({
      key: "cli:terminal.ssh-wrap",
      source: "cli",
      category: "terminal",
      fixId: "ssh-wrap",
      destructive: true,
      disposition: "recommendation",
    });
  });

  it("returns null for empty ids", () => {
    expect(normalizeAppDoctorCheck({ id: "", level: "ok", title: "x", detail: "" })).toBeNull();
    expect(normalizeCliDoctorCheck({ id: "", level: "ok", title: "x", detail: "" })).toBeNull();
    expect(normalizeAppDoctorCheck(null)).toBeNull();
  });

  it("redacts secret-like detail", () => {
    const row = normalizeAppDoctorCheck({
      id: "auth",
      level: "fail",
      title: "Auth",
      detail: "Bearer sk-abc123secretvaluehere",
    });
    expect(row!.detail).not.toMatch(/sk-abc123/);
  });
});

describe("collectDoctorFindings", () => {
  it("merges app + CLI, sorts fail first", () => {
    const rows = collectDoctorFindings(APP_CHECKS, cliView(CLI_CHECKS));
    expect(rows[0]!.level).toBe("fail");
    expect(rows[0]!.rawId).toBe("terminal.limited-color");
    expect(rows.some((r) => r.key === "app:cli")).toBe(true);
    expect(rows.some((r) => r.key === "cli:terminal.ssh-wrap")).toBe(true);
    expect(rows.some((r) => r.rawId === "cli-doctor-clean")).toBe(false);
  });

  it("omits CLI when unavailable", () => {
    const rows = collectDoctorFindings(
      APP_CHECKS,
      cliView(CLI_CHECKS, false),
    );
    expect(rows.every((r) => r.source === "app")).toBe(true);
    expect(rows).toHaveLength(APP_CHECKS.length);
  });

  it("keeps synthetic clean row when CLI has only that", () => {
    const rows = collectDoctorFindings(
      [],
      cliView([
        {
          id: "cli-doctor-clean",
          level: "ok",
          title: "No CLI doctor findings",
          detail: "0 issues",
        },
      ]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rawId).toBe("cli-doctor-clean");
  });

  it("drops clean row when real CLI findings exist", () => {
    const rows = collectDoctorFindings(
      [],
      cliView([
        {
          id: "cli-doctor-clean",
          level: "ok",
          title: "No CLI doctor findings",
          detail: "",
        },
        CLI_CHECKS[0]!,
      ]),
    );
    expect(rows.every((r) => r.rawId !== "cli-doctor-clean")).toBe(true);
    expect(rows).toHaveLength(1);
  });
});

describe("filterDoctorFindings / count / query", () => {
  const rows = collectDoctorFindings(APP_CHECKS, cliView(CLI_CHECKS));

  it("filters by level", () => {
    const fails = filterDoctorFindings(rows, { level: "fail" });
    expect(fails.every((r) => r.level === "fail")).toBe(true);
    expect(fails.length).toBe(1);
  });

  it("filters by category and source", () => {
    const auth = filterDoctorFindings(rows, { category: "auth" });
    expect(auth.map((r) => r.rawId)).toEqual(["auth"]);
    const cliOnly = filterDoctorFindings(rows, { source: "cli" });
    expect(cliOnly.every((r) => r.source === "cli")).toBe(true);
  });

  it("filters issuesOnly", () => {
    const issues = filterDoctorFindings(rows, { issuesOnly: true });
    expect(issues.every((r) => r.level !== "ok")).toBe(true);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("matches free-text query", () => {
    const q = filterDoctorFindings(rows, { query: "ssh-wrap" });
    expect(q).toHaveLength(1);
    expect(q[0]!.fixId).toBe("ssh-wrap");
    expect(doctorFindingMatchesQuery(q[0]!, "TERMINAL")).toBe(true);
    expect(doctorFindingMatchesQuery(q[0]!, "zzz-nope")).toBe(false);
  });

  it("counts levels / categories / sources", () => {
    const c = countDoctorFindings(rows);
    expect(c.total).toBe(rows.length);
    expect(c.fail).toBe(1);
    expect(c.bySource.app).toBe(APP_CHECKS.length);
    expect(c.bySource.cli).toBe(CLI_CHECKS.length);
    expect(c.byCategory.terminal).toBeGreaterThanOrEqual(1);
  });

  it("lists present categories in stable order", () => {
    const cats = categoriesPresent(rows);
    expect(cats[0]).toBe("cli");
    expect(cats).toContain("terminal");
    expect(cats).toContain("auth");
  });
});

describe("sortDoctorFindings", () => {
  it("orders fail before warn before ok", () => {
    const mixed: DoctorFindingRow[] = [
      {
        key: "a",
        rawId: "a",
        source: "cli",
        category: "other",
        level: "ok",
        title: "a",
        detail: "",
      },
      {
        key: "b",
        rawId: "b",
        source: "app",
        category: "other",
        level: "fail",
        title: "b",
        detail: "",
      },
      {
        key: "c",
        rawId: "c",
        source: "app",
        category: "other",
        level: "warn",
        title: "c",
        detail: "",
      },
    ];
    const sorted = sortDoctorFindings(mixed);
    expect(sorted.map((r) => r.level)).toEqual(["fail", "warn", "ok"]);
  });
});

describe("copy + detail presentation", () => {
  it("formats one finding for clipboard", () => {
    const row = normalizeCliDoctorCheck(CLI_CHECKS[2]!)!;
    const text = doctorFindingCopyText(row);
    expect(text).toContain("[WARN]");
    expect(text).toContain("ssh-wrap");
    expect(text).toContain("category: terminal");
    expect(text).toContain("destructive");
  });

  it("formats multi-finding copy", () => {
    const rows = collectDoctorFindings(APP_CHECKS.slice(0, 2), null);
    const text = doctorFindingsCopyText(rows);
    expect(text).toContain("Doctor findings (2)");
    expect(text).toContain("### 1/2");
    expect(text).toContain("### 2/2");
  });

  it("returns empty multi-copy for empty list", () => {
    expect(doctorFindingsCopyText([])).toBe("");
  });

  it("presents detail for GlassModal", () => {
    const row = normalizeCliDoctorCheck(CLI_CHECKS[2]!)!;
    const d = presentDoctorFindingDetail(row);
    expect(d).not.toBeNull();
    expect(d!.title).toBe(row.title);
    expect(d!.fixId).toBe("ssh-wrap");
    expect(d!.destructive).toBe(true);
    expect(d!.copyText).toContain("ssh-wrap");
    expect(presentDoctorFindingDetail(null)).toBeNull();
  });
});

describe("collectDoctorFindingsLoose", () => {
  it("accepts partial shapes for tests", () => {
    const rows = collectDoctorFindingsLoose({
      appChecks: [{ id: "cli", level: "fail", title: "CLI", detail: "missing" }],
      cliChecks: [
        {
          id: "terminal.x",
          level: "warn",
          title: "Term",
          detail: "note",
        },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.level).toBe("fail");
  });
});

describe("buildDoctorFindingsExport / serialize / text", () => {
  const rows = collectDoctorFindings(APP_CHECKS, cliView(CLI_CHECKS));

  it("builds redacted JSON export with filter summary counts", () => {
    const snap = buildDoctorFindingsExport(rows, {
      generatedAt: "2026-07-31T00:00:00.000Z",
      filter: {
        level: "all",
        category: "all",
        source: "cli",
        query: "ssh",
        issuesOnly: true,
      },
    });
    expect(snap.kind).toBe("doctor_findings");
    expect(snap.source).toBe("doctor");
    expect(snap.generatedAt).toBe("2026-07-31T00:00:00.000Z");
    expect(snap.count).toBe(rows.length);
    expect(snap.summary.total).toBe(rows.length);
    expect(snap.summary.fail).toBe(1);
    expect(snap.summary.ok + snap.summary.warn + snap.summary.fail).toBe(
      snap.summary.total,
    );
    expect(snap.summary.bySource.app + snap.summary.bySource.cli).toBe(
      snap.summary.total,
    );
    expect(snap.filter).toEqual({
      level: "all",
      category: "all",
      source: "cli",
      query: "ssh",
      issuesOnly: true,
    });
    for (const row of snap.findings) {
      expect(Object.keys(row).sort()).toEqual(
        [
          "category",
          "detail",
          "destructive",
          "disposition",
          "fixId",
          "id",
          "level",
          "source",
          "title",
        ].sort(),
      );
    }
    const json = serializeDoctorFindingsExport(snap);
    expect(json).toContain('"kind": "doctor_findings"');
    expect(json).toContain('"summary"');
  });

  it("redacts secrets from titles/details in export", () => {
    const secretRows: DoctorFindingRow[] = [
      {
        key: "app:auth",
        rawId: "auth",
        source: "app",
        category: "auth",
        level: "fail",
        title: "Auth Bearer sk-abcdefghijklmnopqrstuv",
        detail: "token xai-abcdefghijklmnopqrstuv leaked",
        fixId: "fix-auth",
        destructive: true,
      },
    ];
    const snap = buildDoctorFindingsExport(secretRows, {
      generatedAt: "2026-07-31T12:00:00.000Z",
    });
    expect(snap.findings[0]!.title).toContain("[REDACTED]");
    expect(snap.findings[0]!.detail).toContain("[REDACTED]");
    expect(snap.findings[0]!.title).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
    expect(snap.findings[0]!.detail).not.toMatch(/xai-[A-Za-z0-9]{10,}/);
    const json = serializeDoctorFindingsExport(snap);
    expect(json).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
    expect(json).not.toMatch(/xai-[A-Za-z0-9]{10,}/);
    const text = formatDoctorFindingsExportText(snap);
    expect(text).toContain("summary:");
    expect(text).toContain("[FAIL]");
    expect(text).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
  });

  it("soft-fails empty export without inventing rows", () => {
    const empty = buildDoctorFindingsExport([]);
    expect(empty.count).toBe(0);
    expect(empty.findings).toEqual([]);
    expect(empty.summary).toEqual({
      ok: 0,
      warn: 0,
      fail: 0,
      total: 0,
      bySource: { app: 0, cli: 0 },
    });
    expect(doctorFindingsExportIsEmpty(empty)).toBe(true);
    expect(formatDoctorFindingsExportText(empty)).toBe("");
    expect(doctorFindingsExportIsEmpty(null)).toBe(true);
  });

  it("honors max cap and filters echo", () => {
    const many = rows.concat(rows).map((r, i) => ({
      ...r,
      key: `${r.key}:${i}`,
      rawId: `${r.rawId}-${i}`,
    }));
    const snap = buildDoctorFindingsExport(many, {
      max: 3,
      filter: { level: "fail", issuesOnly: true },
    });
    expect(snap.findings).toHaveLength(3);
    expect(snap.count).toBe(3);
    expect(snap.filter.level).toBe("fail");
    expect(snap.filter.issuesOnly).toBe(true);
  });

  it("builds safe download filenames", () => {
    expect(
      doctorFindingsExportJsonFilename("2026-07-31T12:34:56.000Z"),
    ).toBe("grok-app-doctor-findings-2026-07-31-12-34-56.json");
    expect(
      doctorFindingsExportTextFilename("2026-07-31T12:34:56.000Z"),
    ).toBe("grok-app-doctor-findings-2026-07-31-12-34-56.txt");
  });

  it("formats text export with summary header", () => {
    const filtered = filterDoctorFindings(rows, { issuesOnly: true });
    const snap = buildDoctorFindingsExport(filtered, {
      generatedAt: "2026-07-31T00:00:00.000Z",
      filter: { issuesOnly: true, level: "all" },
    });
    const text = formatDoctorFindingsExportText(snap);
    expect(text).toContain("# Doctor findings export (redacted)");
    expect(text).toContain("issuesOnly=true");
    expect(text).toContain(`total=${snap.summary.total}`);
    expect(text).toContain("### 1/");
    expect(doctorFindingsExportIsEmpty(snap)).toBe(false);
  });
});

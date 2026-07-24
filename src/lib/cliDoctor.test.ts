import { describe, expect, it } from "vitest";
import {
  dispositionToLevel,
  extractSafeFacts,
  formatFactValue,
  hasAnySafeFact,
  parseCliDoctorEnvelope,
  parseCliDoctorReport,
  parseFinding,
} from "./cliDoctor";

/** Minimal fixture shaped like `grok doctor --json` (schemaVersion 1). */
const FIXTURE = {
  schemaVersion: "1",
  facts: {
    terminal: {
      name: "iterm2",
      xtversion: { status: "unavailable", value: null },
    },
    multiplexer: { kind: "undetected", byobu: null },
    ssh: false,
    color: {
      level: { status: "available", value: "none" },
      availableThemes: ["groknight", "grokday"],
      totalThemes: 5,
    },
    keyboard: null,
    newline: null,
    clipboard: {
      nativeRoute: true,
      nativeTool: "pbcopy",
      nativePreflight: "local_available",
      tmuxRoute: false,
      osc52Route: false,
      osc52Capability: "supported",
      wrapSink: false,
      displayServer: "quartz",
      containerNoDisplay: false,
      dataControl: "not_applicable",
      delivery: "confirmed",
      fix: null,
    },
    voice: {
      status: "available",
      name: "MacBook Pro Microphone",
      detail: "48000 Hz, 1 ch, F32",
    },
  },
  findings: [
    {
      id: "terminal.limited-color",
      disposition: "issue",
      message: "NO_COLOR set -- themed colors disabled",
      remediation: null,
      automaticRemediation: null,
      note: "Unset NO_COLOR and restart Grok.",
    },
    {
      id: "clipboard.ok",
      disposition: "recommendation",
      message: "Prefer native clipboard when available",
      remediation: "Use pbcopy",
      automaticRemediation: null,
      note: null,
    },
  ],
  probeNotes: [
    {
      probe: "runtime.fullscreen-active",
      status: "unavailable",
      message: null,
    },
  ],
  counts: {
    issues: 1,
    recommendations: 1,
    probeNotes: 1,
  },
};

describe("dispositionToLevel", () => {
  it("maps issue / recommendation / ok", () => {
    expect(dispositionToLevel("issue")).toBe("fail");
    expect(dispositionToLevel("recommendation")).toBe("warn");
    expect(dispositionToLevel("ok")).toBe("ok");
    expect(dispositionToLevel("pass")).toBe("ok");
    expect(dispositionToLevel("weird")).toBe("warn");
  });
});

describe("extractSafeFacts", () => {
  it("pulls terminal / clipboard / color without dumping nested objects", () => {
    const f = extractSafeFacts(FIXTURE.facts);
    expect(f.terminal).toBe("iterm2");
    expect(f.ssh).toBe(false);
    expect(f.clipboard).toContain("confirmed");
    expect(f.clipboard).toContain("pbcopy");
    expect(f.color).toContain("none");
    expect(f.color).toContain("5 themes");
    expect(f.voice).toContain("available");
    expect(f.multiplexer).toContain("undetected");
    expect(hasAnySafeFact(f)).toBe(true);
  });

  it("handles missing facts", () => {
    expect(extractSafeFacts(null)).toEqual({});
    expect(hasAnySafeFact({})).toBe(false);
  });
});

describe("parseFinding", () => {
  it("builds title/detail from message + note", () => {
    const row = parseFinding(FIXTURE.findings[0], 0);
    expect(row?.id).toBe("terminal.limited-color");
    expect(row?.level).toBe("fail");
    expect(row?.title).toContain("NO_COLOR");
    expect(row?.detail).toContain("Unset NO_COLOR");
  });
});

describe("parseCliDoctorReport", () => {
  it("parses fixture JSON into pass/warn/fail rows", () => {
    const view = parseCliDoctorReport(FIXTURE);
    expect(view.schemaVersion).toBe("1");
    expect(view.checks).toHaveLength(2);
    expect(view.checks[0].level).toBe("fail");
    expect(view.checks[1].level).toBe("warn");
    expect(view.summary.fail).toBe(1);
    expect(view.summary.warn).toBe(1);
    expect(view.counts?.issues).toBe(1);
    expect(view.probeNotes).toHaveLength(1);
    expect(view.facts.terminal).toBe("iterm2");
  });

  it("synthesizes an ok row when findings are empty", () => {
    const view = parseCliDoctorReport({
      schemaVersion: "1",
      facts: { terminal: { name: "xterm" } },
      findings: [],
      counts: { issues: 0, recommendations: 0, probeNotes: 0 },
    });
    expect(view.checks).toHaveLength(1);
    expect(view.checks[0].level).toBe("ok");
    expect(view.summary.ok).toBe(1);
  });
});

describe("parseCliDoctorEnvelope", () => {
  it("accepts host envelope with report", () => {
    const view = parseCliDoctorEnvelope({
      available: true,
      error: null,
      report: FIXTURE,
      exitOk: true,
    });
    expect(view.available).toBe(true);
    expect(view.error).toBeNull();
    expect(view.checks.length).toBeGreaterThan(0);
  });

  it("accepts bare CLI blob", () => {
    const view = parseCliDoctorEnvelope(FIXTURE);
    expect(view.available).toBe(true);
    expect(view.checks[0].id).toBe("terminal.limited-color");
  });

  it("surfaces CLI missing / timeout errors", () => {
    const missing = parseCliDoctorEnvelope({
      available: false,
      error: "Grok Build CLI not found",
      report: null,
    });
    expect(missing.available).toBe(false);
    expect(missing.error).toContain("not found");
    expect(missing.checks).toEqual([]);

    const timeout = parseCliDoctorEnvelope({
      available: false,
      error: "grok command timed out after 15s",
      report: null,
    });
    expect(timeout.error).toContain("timed out");
  });

  it("handles null input", () => {
    const view = parseCliDoctorEnvelope(null);
    expect(view.available).toBe(false);
    expect(view.error).toBeTruthy();
  });
});

describe("formatFactValue", () => {
  it("formats ssh booleans", () => {
    expect(formatFactValue("ssh", true)).toBe("yes");
    expect(formatFactValue("ssh", false)).toBe("no");
    expect(formatFactValue("terminal", "iterm2")).toBe("iterm2");
  });
});

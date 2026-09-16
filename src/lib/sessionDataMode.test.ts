import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_DATA_MODE,
  SESSION_DATA_MODE_HOME,
  applyPersistedSessionDataMode,
  formatSessionDataModeConfirmBody,
  formatSessionDataModeStatusVars,
  isSessionDataMode,
  joinSessionDataModeConfirmMessage,
  normalizeSessionDataMode,
  planSessionDataModeSwitch,
  resolveSessionDataModeBanner,
  sessionDataModeHomeLabel,
  sessionDataModeLockedByCustomRoute,
  shouldBlockMixedRead,
} from "./sessionDataMode";

describe("normalizeSessionDataMode", () => {
  it("defaults to shared", () => {
    expect(normalizeSessionDataMode(null)).toBe("shared");
    expect(normalizeSessionDataMode(undefined)).toBe("shared");
    expect(normalizeSessionDataMode("")).toBe("shared");
    expect(normalizeSessionDataMode("  ")).toBe("shared");
    expect(normalizeSessionDataMode("bogus")).toBe(DEFAULT_SESSION_DATA_MODE);
    expect(normalizeSessionDataMode(42)).toBe("shared");
    expect(DEFAULT_SESSION_DATA_MODE).toBe("shared");
  });

  it("accepts independent / shared (case-insensitive)", () => {
    expect(normalizeSessionDataMode("independent")).toBe("independent");
    expect(normalizeSessionDataMode("INDEPENDENT")).toBe("independent");
    expect(normalizeSessionDataMode(" shared ")).toBe("shared");
    expect(normalizeSessionDataMode("Shared")).toBe("shared");
  });

  it("maps known aliases", () => {
    expect(normalizeSessionDataMode("cli")).toBe("shared");
    expect(normalizeSessionDataMode("agent-home")).toBe("independent");
    expect(normalizeSessionDataMode("common")).toBe("shared");
  });

  it("isSessionDataMode only accepts canonical strings", () => {
    expect(isSessionDataMode("independent")).toBe(true);
    expect(isSessionDataMode("shared")).toBe(true);
    expect(isSessionDataMode("cli")).toBe(false);
    expect(isSessionDataMode(null)).toBe(false);
  });
});

describe("sessionDataModeHomeLabel", () => {
  it("returns honest product paths", () => {
    expect(sessionDataModeHomeLabel("independent")).toBe(
      "~/.grok-app/agent-home",
    );
    expect(sessionDataModeHomeLabel("shared")).toBe("~/.grok");
    expect(sessionDataModeHomeLabel("independent")).toBe(
      SESSION_DATA_MODE_HOME.independent,
    );
    expect(sessionDataModeHomeLabel("shared")).toBe(
      SESSION_DATA_MODE_HOME.shared,
    );
  });

  it("normalizes garbage to shared home (product default)", () => {
    expect(sessionDataModeHomeLabel("???")).toBe("~/.grok");
    expect(sessionDataModeHomeLabel(null)).toBe("~/.grok");
  });
});

describe("planSessionDataModeSwitch", () => {
  it("no-ops when modes match", () => {
    const plan = planSessionDataModeSwitch({
      from: "independent",
      to: "independent",
    });
    expect(plan.needsConfirm).toBe(false);
    expect(plan.risks).toEqual([]);
    expect(plan.recycleAgents).toBe(false);
    expect(plan.from).toBe("independent");
    expect(plan.to).toBe("independent");
  });

  it("requires confirm + recycle + risks independent → shared", () => {
    const plan = planSessionDataModeSwitch({
      from: "independent",
      to: "shared",
    });
    expect(plan.needsConfirm).toBe(true);
    expect(plan.recycleAgents).toBe(true);
    expect(plan.risks).toContain(
      "settings.sessionDataMode.risk.noSilentMerge",
    );
    expect(plan.risks).toContain(
      "settings.sessionDataMode.risk.recycleAgents",
    );
    expect(plan.risks).toContain(
      "settings.sessionDataMode.risk.sharedWithCli",
    );
    expect(plan.risks).toContain(
      "settings.sessionDataMode.risk.noConfigRewrite",
    );
    expect(plan.risks).toContain(
      "settings.sessionDataMode.risk.conflictPossible",
    );
    expect(plan.risks).not.toContain(
      "settings.sessionDataMode.risk.leaveShared",
    );
  });

  it("requires confirm + recycle shared → independent (leave shared risk)", () => {
    const plan = planSessionDataModeSwitch({
      from: "shared",
      to: "independent",
    });
    expect(plan.needsConfirm).toBe(true);
    expect(plan.recycleAgents).toBe(true);
    expect(plan.risks).toContain(
      "settings.sessionDataMode.risk.noSilentMerge",
    );
    expect(plan.risks).toContain(
      "settings.sessionDataMode.risk.leaveShared",
    );
    expect(plan.risks).not.toContain(
      "settings.sessionDataMode.risk.sharedWithCli",
    );
  });

  it("normalizes raw inputs before planning", () => {
    const plan = planSessionDataModeSwitch({ from: "INDEPENDENT", to: "cli" });
    expect(plan.from).toBe("independent");
    expect(plan.to).toBe("shared");
    expect(plan.needsConfirm).toBe(true);
  });
});

describe("shouldBlockMixedRead", () => {
  it("is always true on a real switch (no silent merge)", () => {
    expect(shouldBlockMixedRead("independent", "shared")).toBe(true);
    expect(shouldBlockMixedRead("shared", "independent")).toBe(true);
    expect(shouldBlockMixedRead("cli", "app")).toBe(true);
  });

  it("is false when modes resolve equal", () => {
    expect(shouldBlockMixedRead("independent", "independent")).toBe(false);
    expect(shouldBlockMixedRead("shared", "shared")).toBe(false);
    expect(shouldBlockMixedRead(null, "bogus")).toBe(false);
  });
});

describe("resolveSessionDataModeBanner", () => {
  it("returns shared honesty keys when shared", () => {
    const b = resolveSessionDataModeBanner("shared");
    expect(b.showSharedBanner).toBe(true);
    expect(b.mode).toBe("shared");
    expect(b.homeLabel).toBe("~/.grok");
    expect(b.keys).toEqual([
      "settings.sessionDataMode.banner.sharedWithCli",
      "settings.sessionDataMode.banner.noRewriteSecrets",
      "settings.sessionDataMode.banner.conflictPossible",
    ]);
    expect(b.statusKey).toBe("settings.sessionDataMode.status");
  });

  it("hides shared banner for independent", () => {
    const b = resolveSessionDataModeBanner("independent");
    expect(b.showSharedBanner).toBe(false);
    expect(b.keys).toEqual([]);
    expect(b.homeLabel).toBe("~/.grok-app/agent-home");
  });
});

describe("formatSessionDataModeConfirmBody + join", () => {
  it("builds confirm vars for shared flip", () => {
    const body = formatSessionDataModeConfirmBody("independent", "shared");
    expect(body.needsConfirm).toBe(true);
    expect(body.danger).toBe(true);
    expect(body.fromHome).toBe("~/.grok-app/agent-home");
    expect(body.toHome).toBe("~/.grok");
    expect(body.introKey).toBe("settings.sessionDataMode.confirm.intro");
    expect(body.riskKeys.length).toBeGreaterThan(0);
    expect(body.riskKeys).toContain(
      "settings.sessionDataMode.risk.noSilentMerge",
    );
  });

  it("builds confirm vars for leave-shared without danger", () => {
    const body = formatSessionDataModeConfirmBody("shared", "independent");
    expect(body.needsConfirm).toBe(true);
    expect(body.danger).toBe(false);
    expect(body.toHome).toBe("~/.grok-app/agent-home");
  });

  it("no-ops same mode", () => {
    const body = formatSessionDataModeConfirmBody("shared", "shared");
    expect(body.needsConfirm).toBe(false);
    expect(body.riskKeys).toEqual([]);
    expect(body.danger).toBe(false);
  });

  it("joins intro + risks with bullets", () => {
    const msg = joinSessionDataModeConfirmMessage({
      intro: "Switch homes?",
      riskLines: ["No silent merge", "• Already bulleted", "  "],
    });
    expect(msg).toBe(
      "Switch homes?\n• No silent merge\n• Already bulleted",
    );
  });

  it("handles empty intro", () => {
    expect(
      joinSessionDataModeConfirmMessage({
        intro: "  ",
        riskLines: ["Only risk"],
      }),
    ).toBe("• Only risk");
  });
});

describe("formatSessionDataModeStatusVars", () => {
  it("pairs mode label with honest path", () => {
    expect(
      formatSessionDataModeStatusVars("shared", "shared (~/.grok)"),
    ).toEqual({
      modeLabel: "shared (~/.grok)",
      path: "~/.grok",
    });
    expect(formatSessionDataModeStatusVars("independent", "independent")).toEqual({
      modeLabel: "independent",
      path: "~/.grok-app/agent-home",
    });
  });
});

describe("sessionDataModeLockedByCustomRoute", () => {
  it("locks shared mode only while a custom provider is the live route", () => {
    expect(sessionDataModeLockedByCustomRoute("custom")).toBe(true);
    expect(sessionDataModeLockedByCustomRoute("CUSTOM")).toBe(true);
    expect(sessionDataModeLockedByCustomRoute("official")).toBe(false);
    expect(sessionDataModeLockedByCustomRoute("")).toBe(false);
    expect(sessionDataModeLockedByCustomRoute(null)).toBe(false);
  });
});

describe("applyPersistedSessionDataMode", () => {
  it("shows the value the host actually saved (self-heal wins)", () => {
    expect(applyPersistedSessionDataMode("shared", "independent")).toBe(
      "independent",
    );
    expect(applyPersistedSessionDataMode("independent", "shared")).toBe(
      "shared",
    );
  });

  it("falls back to the requested mode when the host omits the field", () => {
    expect(applyPersistedSessionDataMode("shared", undefined)).toBe("shared");
    expect(applyPersistedSessionDataMode("shared", "")).toBe("shared");
  });
});

import { describe, expect, it } from "vitest";
import type { AppSettings } from "@/lib/api";
import { parseAppSettingsPrefs } from "./appSettingsHydrate";

function settings(over: Partial<AppSettings> = {}): AppSettings {
  return {
    theme: "dark",
    appIcon: "default-black",
    locale: "en",
    sessionDataMode: "shared",
    manualCliPath: null,
    permissionPolicy: "ask",
    modelId: null,
    effort: null,
    mode: "agent",
    onboardingDone: true,
    setupSkipped: false,
    ...over,
  };
}

describe("parseAppSettingsPrefs", () => {
  it("uses documented defaults for missing fields", () => {
    const p = parseAppSettingsPrefs(settings());
    expect(p.sessionDataMode).toBe("shared");
    expect(p.defaultOpenTarget).toBe("finder");
    expect(p.maxConcurrentAgents).toBe(3);
    expect(p.agentIdleMinutes).toBe(30);
    expect(p.streamStallSeconds).toBe(120);
    expect(p.closeToTray).toBe(true);
    expect(p.reopenLastSession).toBe(false);
    expect(p.voiceId).toBe("eve");
    expect(p.subagentsEnabled).toBe(true);
    expect(p.planEnabled).toBe(true);
    expect(p.prefsScope).toBeNull();
  });

  it("clamps process and stall budgets", () => {
    const p = parseAppSettingsPrefs(
      settings({
        maxConcurrentAgents: 99,
        agentIdleMinutes: 0,
        streamStallSeconds: 10,
        maxAgentTurns: 500,
        todoGateMaxFiresPerPrompt: 99,
        auditLedgerRetentionDays: 12,
      }),
    );
    expect(p.maxConcurrentAgents).toBe(32);
    expect(p.agentIdleMinutes).toBe(30);
    expect(p.streamStallSeconds).toBe(120);
    expect(p.maxAgentTurns).toBe(200);
    expect(p.todoGateMaxFiresPerPrompt).toBe(20);
    expect(p.auditLedgerRetentionDays).toBe(0);
  });

  it("keeps a fallback CLI path when settings omit it", () => {
    expect(
      parseAppSettingsPrefs(settings(), { fallbackCliPath: "/opt/grok" })
        .manualCliPath,
    ).toBe("/opt/grok");
    expect(
      parseAppSettingsPrefs(settings({ manualCliPath: "/usr/bin/grok" }), {
        fallbackCliPath: "/opt/grok",
      }).manualCliPath,
    ).toBe("/usr/bin/grok");
  });

  it("filters tool lists and last session id", () => {
    const p = parseAppSettingsPrefs(
      settings({
        disallowedTools: ["shell", 1 as unknown as string],
        allowedTools: ["read"],
        lastSessionId: "  abc  ",
      }),
    );
    expect(p.disallowedTools).toEqual(["shell"]);
    expect(p.allowedTools).toEqual(["read"]);
    expect(p.lastSessionId).toBe("abc");
  });
});

/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { AppSettings } from "@/lib/api";
import { useAppSettingsPrefs } from "./useAppSettingsPrefs";

describe("useAppSettingsPrefs", () => {
  it("hydrateFromSettings writes clamped prefs without a host", () => {
    const { result } = renderHook(() => useAppSettingsPrefs());
    act(() => {
      result.current.hydrateFromSettings({
        theme: "dark",
        appIcon: "default-black",
        locale: "en",
        sessionDataMode: "independent",
        manualCliPath: "/bin/grok",
        permissionPolicy: "ask",
        modelId: null,
        effort: null,
        mode: "agent",
        onboardingDone: true,
        setupSkipped: false,
        maxConcurrentAgents: 12,
        closeToTray: false,
        reopenLastSession: true,
        lastSessionId: "sess-1",
      } satisfies AppSettings);
    });
    expect(result.current.sessionDataMode).toBe("independent");
    expect(result.current.manualCliPath).toBe("/bin/grok");
    expect(result.current.maxConcurrentAgents).toBe(12);
    expect(result.current.closeToTray).toBe(false);
    expect(result.current.reopenLastSession).toBe(true);
    expect(result.current.lastSessionId).toBe("sess-1");
  });
});

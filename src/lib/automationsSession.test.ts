import { describe, expect, it } from "vitest";
import {
  automationReuseSessionId,
  automationSessionOptions,
  normalizeAutomationSessionMode,
  shortSessionId,
} from "./automations";

describe("automation session target", () => {
  it("defaults to a fresh chat", () => {
    expect(normalizeAutomationSessionMode(undefined, undefined)).toBe("new");
    expect(normalizeAutomationSessionMode("new", "chat-1")).toBe("new");
  });

  it("keeps reuse only when a chat id is present", () => {
    expect(normalizeAutomationSessionMode("reuse", " chat-1 ")).toBe("reuse");
    expect(normalizeAutomationSessionMode("reuse", "   ")).toBe("new");
  });

  it("returns the trimmed reuse chat id", () => {
    expect(
      automationReuseSessionId({
        sessionMode: "reuse",
        sessionId: " chat-1 ",
      }),
    ).toBe("chat-1");
    expect(
      automationReuseSessionId({ sessionMode: "new", sessionId: "chat-1" }),
    ).toBeNull();
  });

  it("lists live chats newest first and keeps ids distinct", () => {
    const rows = automationSessionOptions([
      {
        id: "chat-a-111111",
        title: "Same title",
        projectId: null,
        updatedAt: "2026-10-20T10:00:00Z",
      },
      {
        id: "chat-b-222222",
        title: "Same title",
        projectId: "p1",
        updatedAt: "2026-10-21T10:00:00Z",
      },
      {
        id: "chat-c-333333",
        title: "Archived",
        projectId: null,
        updatedAt: "2026-10-22T10:00:00Z",
        archived: true,
      },
    ]);
    expect(rows.map((r) => r.id)).toEqual([
      "chat-b-222222",
      "chat-a-111111",
    ]);
    expect(shortSessionId("chat-b-222222")).toBe("222222");
    expect(shortSessionId("short")).toBe("short");
  });
});

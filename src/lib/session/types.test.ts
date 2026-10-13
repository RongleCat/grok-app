/**
 * User rows the user never typed.
 *
 * `interjection` is a mid-turn steer; `auto_wake` is a turn the Host started on
 * its own (PR-monitor wake, external send). Both must stay *inside* the turn
 * they belong to: a wake shows an automatic follow-up and the answer reads as a
 * continuation of the turn before it, instead of appearing as the user speaking
 * and opening a new turn.
 */
import { describe, expect, it } from "vitest";
import { isInjectedPromptMarker, isTurnPromptMessage } from "@/lib/session/types";
import type { ChatMessage } from "@/lib/session/types";

function userRow(marker?: string | null): ChatMessage {
  return { id: "m1", role: "user", content: "跟进这次 PR 更新", marker: marker ?? undefined };
}

describe("injected prompt markers", () => {
  it("knows the injected family", () => {
    expect(isInjectedPromptMarker("auto_wake")).toBe(true);
    expect(isInjectedPromptMarker("interjection")).toBe(true);
    expect(isInjectedPromptMarker(undefined)).toBe(false);
    expect(isInjectedPromptMarker(null)).toBe(false);
    expect(isInjectedPromptMarker("tool_step")).toBe(false);
  });

  it("keeps a host wake out of turn boundaries", () => {
    expect(isTurnPromptMessage(userRow())).toBe(true);
    expect(isTurnPromptMessage(userRow("auto_wake"))).toBe(false);
    expect(isTurnPromptMessage(userRow("interjection"))).toBe(false);
  });

  it("never treats an assistant row as a prompt", () => {
    expect(
      isTurnPromptMessage({ id: "a1", role: "assistant", content: "好的" }),
    ).toBe(false);
  });
});

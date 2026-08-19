import { describe, expect, it } from "vitest";
import {
  shouldHealZombieBusy,
  shouldReleaseStaleConnectingClaim,
  transcriptLooksTurnComplete,
  ZOMBIE_BUSY_GRACE_MS,
  ZOMBIE_BUSY_HOST_STALE_MS,
} from "./zombieBusyHeal";

const doneAssistant = [
  { role: "user", content: "hi" },
  { role: "assistant", content: "done reply", streaming: false },
];

describe("transcriptLooksTurnComplete", () => {
  it("is true when the last assistant has a finished body", () => {
    expect(transcriptLooksTurnComplete(doneAssistant)).toBe(true);
  });

  it("is false while any row is still streaming or the last turn is only a user", () => {
    expect(
      transcriptLooksTurnComplete([
        { role: "user", content: "hi" },
        { role: "assistant", content: "partial", streaming: true },
      ]),
    ).toBe(false);
    expect(transcriptLooksTurnComplete([{ role: "user", content: "hi" }])).toBe(
      false,
    );
  });
});

describe("shouldHealZombieBusy", () => {
  it("heals when Host is idle and the reply is already on screen", () => {
    expect(
      shouldHealZombieBusy({
        uiSessionState: "streaming",
        messages: doneAssistant,
        turnStartedAt: 1,
        nowMs: 1 + ZOMBIE_BUSY_GRACE_MS,
        hostStateForSession: "ready",
      }),
    ).toBe(true);
  });

  it("does not heal a live think→tool loop (streaming assistant)", () => {
    expect(
      shouldHealZombieBusy({
        uiSessionState: "streaming",
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "working", streaming: true },
        ],
        turnStartedAt: 1,
        nowMs: 1 + ZOMBIE_BUSY_HOST_STALE_MS,
        hostStateForSession: "streaming",
      }),
    ).toBe(false);
  });

  it("heals a stale Host stream after the wall clock when the body is done", () => {
    expect(
      shouldHealZombieBusy({
        uiSessionState: "streaming",
        uiConnecting: true,
        messages: doneAssistant,
        turnStartedAt: 1,
        nowMs: 1 + ZOMBIE_BUSY_HOST_STALE_MS,
        hostStateForSession: "streaming",
      }),
    ).toBe(true);
  });

  it("does not heal while send IPC is in flight", () => {
    expect(
      shouldHealZombieBusy({
        uiSessionState: "streaming",
        messages: doneAssistant,
        turnStartedAt: 1,
        nowMs: 1 + ZOMBIE_BUSY_HOST_STALE_MS,
        hostStateForSession: "ready",
        sendInFlight: true,
      }),
    ).toBe(false);
  });
});

describe("shouldReleaseStaleConnectingClaim", () => {
  it("releases a leftover 连接中 when no handshake is running", () => {
    expect(
      shouldReleaseStaleConnectingClaim({
        uiSessionState: "ready",
        uiConnecting: true,
        messages: doneAssistant,
        turnStartedAt: null,
        nowMs: 10,
        hostStateForSession: "ready",
        connectInFlightCount: 0,
      }),
    ).toBe(true);
  });

  it("keeps a real handshake", () => {
    expect(
      shouldReleaseStaleConnectingClaim({
        uiSessionState: "ready",
        uiConnecting: true,
        messages: doneAssistant,
        turnStartedAt: null,
        nowMs: 10,
        hostStateForSession: "connecting",
        connectInFlightCount: 1,
      }),
    ).toBe(false);
  });
});

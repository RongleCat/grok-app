import { describe, expect, it } from "vitest";
import {
  shouldStickOnLiveTailSettle,
  splitChatLiveTail,
} from "./chatLiveTail";

describe("splitChatLiveTail", () => {
  it("keeps a settled transcript fully in history", () => {
    const messages = [
      { id: "u", streaming: false },
      { id: "a", streaming: false },
    ];
    expect(splitChatLiveTail(messages)).toEqual({
      history: messages,
      live: null,
      liveIndex: null,
    });
  });

  it("pulls only the last streaming row into normal-flow live tail", () => {
    const messages = [
      { id: "u" },
      { id: "old", streaming: true },
      { id: "live", streaming: true },
    ];
    const split = splitChatLiveTail(messages);
    expect(split.live?.id).toBe("live");
    expect(split.liveIndex).toBe(2);
    expect(split.history.map((m) => m.id)).toEqual(["u", "old"]);
  });

  it("returns empty history when the only row is streaming", () => {
    const messages = [{ id: "a", streaming: true }];
    expect(splitChatLiveTail(messages)).toEqual({
      history: [],
      live: messages[0],
      liveIndex: 0,
    });
  });
});

describe("shouldStickOnLiveTailSettle", () => {
  it("snaps when a live tail just settled and the viewport follows", () => {
    expect(
      shouldStickOnLiveTailSettle({
        prevLiveTailId: "a",
        liveTailId: null,
        pinned: true,
      }),
    ).toBe(true);
  });

  it("does not snap when there was no live tail before", () => {
    expect(
      shouldStickOnLiveTailSettle({
        prevLiveTailId: null,
        liveTailId: null,
        pinned: true,
      }),
    ).toBe(false);
  });

  it("does not snap while a live tail is still mounted (same or next)", () => {
    expect(
      shouldStickOnLiveTailSettle({
        prevLiveTailId: "a",
        liveTailId: "a",
        pinned: true,
      }),
    ).toBe(false);
    expect(
      shouldStickOnLiveTailSettle({
        prevLiveTailId: "a",
        liveTailId: "b",
        pinned: true,
      }),
    ).toBe(false);
  });

  it("never yanks an escaped reader back to the tail", () => {
    expect(
      shouldStickOnLiveTailSettle({
        prevLiveTailId: "a",
        liveTailId: null,
        pinned: false,
      }),
    ).toBe(false);
  });
});

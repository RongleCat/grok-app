import { afterEach, describe, expect, it, vi } from "vitest";
import { findChatMatches } from "./chatFind";
import {
  EMPTY_CHAT_FIND_LIVE,
  buildChatFindLiveSnapshot,
  getChatFindLiveSnapshot,
  publishChatFindLive,
  resetChatFindLive,
  resetChatFindLiveForTests,
  subscribeChatFindLive,
} from "./chatFindLiveStore";

afterEach(() => {
  resetChatFindLiveForTests();
});

const matches = findChatMatches("ab", [
  { id: "u", role: "user", content: "ab ab" },
  { id: "a", role: "assistant", content: "ab" },
]);

describe("buildChatFindLiveSnapshot", () => {
  it("is empty when there are no matches", () => {
    const snap = buildChatFindLiveSnapshot({
      query: "zz",
      index: 3,
      matches: [],
    });
    expect(snap.matchCount).toBe(0);
    expect(snap.index).toBe(0);
    expect(snap.active).toBeNull();
    expect(snap.hitIds.size).toBe(0);
    expect(snap.query).toBe("zz");
  });

  it("clamps a stale index and reuses hitIds / active", () => {
    const first = buildChatFindLiveSnapshot({
      query: "ab",
      index: 0,
      matches,
    });
    expect(first.matchCount).toBe(3);
    expect([...first.hitIds]).toEqual(["u", "a"]);
    const second = buildChatFindLiveSnapshot(
      { query: "ab", index: 99, matches },
      first,
    );
    expect(second.index).toBe(0);
    expect(second.hitIds).toBe(first.hitIds);
    expect(second.active).toBe(first.active);
  });
});

describe("chatFindLiveStore", () => {
  it("notifies on publish and skips identical snapshots", () => {
    const listener = vi.fn();
    const unsub = subscribeChatFindLive(listener);
    publishChatFindLive({ query: "ab", index: 0, matches });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getChatFindLiveSnapshot().matchCount).toBe(3);
    publishChatFindLive({ query: "ab", index: 0, matches });
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });

  it("reset restores the empty snapshot", () => {
    publishChatFindLive({ query: "ab", index: 1, matches });
    resetChatFindLive();
    expect(getChatFindLiveSnapshot()).toBe(EMPTY_CHAT_FIND_LIVE);
  });
});

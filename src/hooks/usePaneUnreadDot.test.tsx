/**
 * @vitest-environment jsdom
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  reducePaneUnread,
  seedPaneUnread,
  usePaneUnreadDot,
} from "./usePaneUnreadDot";

afterEach(cleanup);

describe("reducePaneUnread", () => {
  it("lights only for new closed-pane keys and clears when opened", () => {
    const base = seedPaneUnread(["a"]);
    const grown = reducePaneUnread(base, {
      open: false,
      keys: new Set(["a", "b"]),
    });
    expect(grown.unread).toBe(true);
    const opened = reducePaneUnread(grown, {
      open: true,
      keys: new Set(["a", "b"]),
    });
    expect(opened.unread).toBe(false);
    expect(Array.from(opened.seen).sort()).toEqual(["a", "b"]);
  });

  it("prunes vanished keys so the same key can become unread again", () => {
    let state = seedPaneUnread(["a"]);
    state = reducePaneUnread(state, {
      open: false,
      keys: new Set<string>(),
    });
    expect(state.unread).toBe(false);
    state = reducePaneUnread(state, {
      open: false,
      keys: new Set(["a"]),
    });
    expect(state.unread).toBe(true);
  });
});

describe("usePaneUnreadDot", () => {
  it("accumulates while closed and clears synchronously when opened", () => {
    const { result, rerender } = renderHook(
      (props: { open: boolean; keys: string[] }) => usePaneUnreadDot(props),
      { initialProps: { open: false, keys: [] as string[] } },
    );
    rerender({ open: false, keys: ["s1"] });
    expect(result.current).toBe(true);
    rerender({ open: true, keys: ["s1"] });
    expect(result.current).toBe(false);
  });

  it("re-baselines when the viewed session changes", () => {
    const { result, rerender } = renderHook(
      (props: { open: boolean; keys: string[]; resetKey: string }) =>
        usePaneUnreadDot(props),
      {
        initialProps: { open: false, keys: ["a@1"], resetKey: "s1" },
      },
    );
    rerender({ open: false, keys: ["a@1", "b@1"], resetKey: "s1" });
    expect(result.current).toBe(true);
    rerender({ open: false, keys: ["c@1"], resetKey: "s2" });
    expect(result.current).toBe(false);
  });
});

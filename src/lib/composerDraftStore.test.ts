import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composerDraftStore,
  getDraft,
  getMetaSnapshot,
  getSnapshot,
  setDraft,
  subscribe,
  subscribeMeta,
} from "./composerDraftStore";

afterEach(() => {
  setDraft("");
});

describe("composerDraftStore", () => {
  it("setDraft notifies subscribers with the new value", () => {
    const listener = vi.fn();
    const unsub = subscribe(listener);
    setDraft("hello");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getDraft()).toBe("hello");
    expect(getSnapshot()).toBe("hello");
    unsub();
    setDraft("world");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getDraft()).toBe("world");
  });

  it("functional update works", () => {
    setDraft("ab");
    setDraft((prev) => prev + "c");
    expect(getDraft()).toBe("abc");
  });

  it("skips notify when value is unchanged", () => {
    setDraft("same");
    const listener = vi.fn();
    subscribe(listener);
    setDraft("same");
    expect(listener).not.toHaveBeenCalled();
  });

  it("getSnapshot returns current draft (identity for same string)", () => {
    setDraft("x");
    expect(getSnapshot()).toBe(getDraft());
    expect(getSnapshot()).toBe("x");
  });

  it("meta empty flips and length updates", () => {
    const metaListener = vi.fn();
    const unsub = subscribeMeta(metaListener);
    expect(getMetaSnapshot()).toEqual({ empty: true, length: 0 });

    setDraft("  ");
    // whitespace-only is still empty for isDraftEmpty, but length changes
    expect(getMetaSnapshot().empty).toBe(true);
    expect(getMetaSnapshot().length).toBe(2);
    expect(metaListener).toHaveBeenCalled();

    metaListener.mockClear();
    setDraft("hi");
    expect(getMetaSnapshot()).toEqual({ empty: false, length: 2 });
    expect(metaListener).toHaveBeenCalledTimes(1);

    metaListener.mockClear();
    setDraft("hi!");
    expect(getMetaSnapshot()).toEqual({ empty: false, length: 3 });
    expect(metaListener).toHaveBeenCalledTimes(1);

    unsub();
  });

  it("skill chip draft is non-empty", () => {
    setDraft("[[skill:foo]]");
    expect(getMetaSnapshot().empty).toBe(false);
  });

  it("composerDraftStore facade exposes the same API", () => {
    composerDraftStore.setDraft("via-facade");
    expect(composerDraftStore.getDraft()).toBe("via-facade");
    expect(composerDraftStore.getSnapshot()).toBe("via-facade");
  });
});

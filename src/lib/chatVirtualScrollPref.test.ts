/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_VIRTUAL_SCROLL_CHANGE_EVENT,
  CHAT_VIRTUAL_SCROLL_STORAGE_KEY,
  DEFAULT_CHAT_VIRTUAL_SCROLL,
  loadChatVirtualScrollPref,
  parseChatVirtualScrollPref,
  saveChatVirtualScrollPref,
  type ChatVirtualScrollStorage,
} from "./chatVirtualScrollPref";

function memoryStorage(
  initial: Record<string, string> = {},
): ChatVirtualScrollStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return key in data ? data[key]! : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
  };
}

describe("chatVirtualScrollPref", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to on (virtual window, previous product behavior)", () => {
    expect(DEFAULT_CHAT_VIRTUAL_SCROLL).toBe(true);
    expect(parseChatVirtualScrollPref(null)).toBe(true);
    expect(parseChatVirtualScrollPref("")).toBe(true);
    expect(parseChatVirtualScrollPref("maybe")).toBe(true);
    expect(loadChatVirtualScrollPref(memoryStorage())).toBe(true);
  });

  it("parses true/false variants", () => {
    expect(parseChatVirtualScrollPref("1")).toBe(true);
    expect(parseChatVirtualScrollPref("true")).toBe(true);
    expect(parseChatVirtualScrollPref(true)).toBe(true);
    expect(parseChatVirtualScrollPref("0")).toBe(false);
    expect(parseChatVirtualScrollPref("false")).toBe(false);
    expect(parseChatVirtualScrollPref(false)).toBe(false);
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveChatVirtualScrollPref(true, s);
    expect(s.data[CHAT_VIRTUAL_SCROLL_STORAGE_KEY]).toBe("1");
    expect(loadChatVirtualScrollPref(s)).toBe(true);
    saveChatVirtualScrollPref(false, s);
    expect(s.data[CHAT_VIRTUAL_SCROLL_STORAGE_KEY]).toBe("0");
    expect(loadChatVirtualScrollPref(s)).toBe(false);
  });

  it("dispatches a window event on save", () => {
    const handler = vi.fn();
    window.addEventListener(CHAT_VIRTUAL_SCROLL_CHANGE_EVENT, handler);
    saveChatVirtualScrollPref(true, memoryStorage());
    expect(handler).toHaveBeenCalledTimes(1);
    const ev = handler.mock.calls[0]![0] as CustomEvent;
    expect(ev.detail).toBe(true);
    window.removeEventListener(CHAT_VIRTUAL_SCROLL_CHANGE_EVENT, handler);
  });
});

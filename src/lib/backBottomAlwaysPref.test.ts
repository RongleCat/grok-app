import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BACK_BOTTOM_ALWAYS_CHANGE_EVENT,
  BACK_BOTTOM_ALWAYS_STORAGE_KEY,
  DEFAULT_BACK_BOTTOM_ALWAYS,
  loadBackBottomAlwaysPref,
  parseBackBottomAlwaysPref,
  saveBackBottomAlwaysPref,
  shouldShowBackBottom,
  type BackBottomAlwaysStorage,
} from "./backBottomAlwaysPref";

function memoryStorage(
  initial: Record<string, string> = {},
): BackBottomAlwaysStorage & { data: Record<string, string> } {
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

describe("backBottomAlwaysPref", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to false", () => {
    expect(DEFAULT_BACK_BOTTOM_ALWAYS).toBe(false);
    expect(parseBackBottomAlwaysPref(null)).toBe(false);
    expect(parseBackBottomAlwaysPref("")).toBe(false);
    expect(parseBackBottomAlwaysPref("maybe")).toBe(false);
    expect(loadBackBottomAlwaysPref(memoryStorage())).toBe(false);
  });

  it("parses true/false variants", () => {
    expect(parseBackBottomAlwaysPref("1")).toBe(true);
    expect(parseBackBottomAlwaysPref("true")).toBe(true);
    expect(parseBackBottomAlwaysPref(true)).toBe(true);
    expect(parseBackBottomAlwaysPref("0")).toBe(false);
    expect(parseBackBottomAlwaysPref("false")).toBe(false);
    expect(parseBackBottomAlwaysPref(false)).toBe(false);
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveBackBottomAlwaysPref(true, s);
    expect(s.data[BACK_BOTTOM_ALWAYS_STORAGE_KEY]).toBe("1");
    expect(loadBackBottomAlwaysPref(s)).toBe(true);
    saveBackBottomAlwaysPref(false, s);
    expect(s.data[BACK_BOTTOM_ALWAYS_STORAGE_KEY]).toBe("0");
    expect(loadBackBottomAlwaysPref(s)).toBe(false);
  });

  it("shouldShowBackBottom is always || scrolled-up", () => {
    expect(shouldShowBackBottom(false, false)).toBe(false);
    expect(shouldShowBackBottom(false, true)).toBe(true);
    expect(shouldShowBackBottom(true, false)).toBe(true);
    expect(shouldShowBackBottom(true, true)).toBe(true);
  });

  it("dispatches change event on save when window exists", () => {
    const listeners = new Map<string, Set<EventListener>>();
    const stubWindow = {
      addEventListener(type: string, listener: EventListener) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(listener);
      },
      removeEventListener(type: string, listener: EventListener) {
        listeners.get(type)?.delete(listener);
      },
      dispatchEvent(ev: Event) {
        const set = listeners.get(ev.type);
        if (set) for (const fn of set) fn(ev);
        return true;
      },
    };
    vi.stubGlobal("window", stubWindow);
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent<T = unknown> extends Event {
        detail: T;
        constructor(type: string, init?: CustomEventInit<T>) {
          super(type);
          this.detail = init?.detail as T;
        }
      },
    );

    const handler = vi.fn();
    stubWindow.addEventListener(BACK_BOTTOM_ALWAYS_CHANGE_EVENT, handler);
    saveBackBottomAlwaysPref(true, memoryStorage());
    expect(handler).toHaveBeenCalledTimes(1);
    const ev = handler.mock.calls[0][0] as CustomEvent;
    expect(ev.detail).toBe(true);
  });
});

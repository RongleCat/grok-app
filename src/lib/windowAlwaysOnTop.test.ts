import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WINDOW_ALWAYS_ON_TOP,
  WINDOW_ALWAYS_ON_TOP_CHANGE_EVENT,
  WINDOW_ALWAYS_ON_TOP_STORAGE_KEY,
  applyWindowAlwaysOnTop,
  loadWindowAlwaysOnTopPref,
  parseWindowAlwaysOnTopPref,
  saveWindowAlwaysOnTopPref,
  type WindowAlwaysOnTopStorage,
} from "./windowAlwaysOnTop";

function memoryStorage(
  initial: Record<string, string> = {},
): WindowAlwaysOnTopStorage & { data: Record<string, string> } {
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

describe("windowAlwaysOnTop pref", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to false (off)", () => {
    expect(DEFAULT_WINDOW_ALWAYS_ON_TOP).toBe(false);
    expect(parseWindowAlwaysOnTopPref(null)).toBe(false);
    expect(parseWindowAlwaysOnTopPref("")).toBe(false);
    expect(parseWindowAlwaysOnTopPref("maybe")).toBe(false);
    expect(loadWindowAlwaysOnTopPref(memoryStorage())).toBe(false);
  });

  it("parses true/false variants", () => {
    expect(parseWindowAlwaysOnTopPref("1")).toBe(true);
    expect(parseWindowAlwaysOnTopPref("true")).toBe(true);
    expect(parseWindowAlwaysOnTopPref(true)).toBe(true);
    expect(parseWindowAlwaysOnTopPref("0")).toBe(false);
    expect(parseWindowAlwaysOnTopPref("false")).toBe(false);
    expect(parseWindowAlwaysOnTopPref(false)).toBe(false);
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveWindowAlwaysOnTopPref(true, s);
    expect(s.data[WINDOW_ALWAYS_ON_TOP_STORAGE_KEY]).toBe("1");
    expect(loadWindowAlwaysOnTopPref(s)).toBe(true);
    saveWindowAlwaysOnTopPref(false, s);
    expect(s.data[WINDOW_ALWAYS_ON_TOP_STORAGE_KEY]).toBe("0");
    expect(loadWindowAlwaysOnTopPref(s)).toBe(false);
  });

  it("load returns default when storage throws", () => {
    const broken: WindowAlwaysOnTopStorage = {
      getItem() {
        throw new Error("private");
      },
      setItem() {
        throw new Error("private");
      },
    };
    expect(loadWindowAlwaysOnTopPref(broken)).toBe(false);
    expect(() => saveWindowAlwaysOnTopPref(true, broken)).not.toThrow();
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
    stubWindow.addEventListener(WINDOW_ALWAYS_ON_TOP_CHANGE_EVENT, handler);
    saveWindowAlwaysOnTopPref(true, memoryStorage());
    expect(handler).toHaveBeenCalledTimes(1);
    const ev = handler.mock.calls[0][0] as CustomEvent;
    expect(ev.detail).toBe(true);
  });
});

describe("applyWindowAlwaysOnTop", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns false outside Tauri (fail-closed)", async () => {
    vi.stubGlobal("window", {});
    expect(await applyWindowAlwaysOnTop(true)).toBe(false);
    expect(await applyWindowAlwaysOnTop(false)).toBe(false);
  });
});

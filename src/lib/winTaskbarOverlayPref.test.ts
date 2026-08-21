import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WIN_TASKBAR_OVERLAY,
  WIN_TASKBAR_OVERLAY_CHANGE_EVENT,
  WIN_TASKBAR_OVERLAY_STORAGE_KEY,
  loadWinTaskbarOverlayPref,
  parseWinTaskbarOverlayPref,
  saveWinTaskbarOverlayPref,
  type WinTaskbarOverlayStorage,
} from "./winTaskbarOverlayPref";

function memoryStorage(
  initial: Record<string, string> = {},
): WinTaskbarOverlayStorage & { data: Record<string, string> } {
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

describe("winTaskbarOverlay pref", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to false (off)", () => {
    expect(DEFAULT_WIN_TASKBAR_OVERLAY).toBe(false);
    expect(parseWinTaskbarOverlayPref(null)).toBe(false);
    expect(parseWinTaskbarOverlayPref("")).toBe(false);
    expect(parseWinTaskbarOverlayPref("maybe")).toBe(false);
    expect(loadWinTaskbarOverlayPref(memoryStorage())).toBe(false);
  });

  it("parses true/false variants", () => {
    expect(parseWinTaskbarOverlayPref("1")).toBe(true);
    expect(parseWinTaskbarOverlayPref("true")).toBe(true);
    expect(parseWinTaskbarOverlayPref(true)).toBe(true);
    expect(parseWinTaskbarOverlayPref("0")).toBe(false);
    expect(parseWinTaskbarOverlayPref("false")).toBe(false);
    expect(parseWinTaskbarOverlayPref(false)).toBe(false);
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveWinTaskbarOverlayPref(true, s);
    expect(s.data[WIN_TASKBAR_OVERLAY_STORAGE_KEY]).toBe("1");
    expect(loadWinTaskbarOverlayPref(s)).toBe(true);
    saveWinTaskbarOverlayPref(false, s);
    expect(s.data[WIN_TASKBAR_OVERLAY_STORAGE_KEY]).toBe("0");
    expect(loadWinTaskbarOverlayPref(s)).toBe(false);
  });

  it("load returns default when storage throws", () => {
    const broken: WinTaskbarOverlayStorage = {
      getItem() {
        throw new Error("private");
      },
      setItem() {
        throw new Error("private");
      },
    };
    expect(loadWinTaskbarOverlayPref(broken)).toBe(false);
    expect(() => saveWinTaskbarOverlayPref(true, broken)).not.toThrow();
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
    stubWindow.addEventListener(WIN_TASKBAR_OVERLAY_CHANGE_EVENT, handler);
    saveWinTaskbarOverlayPref(true, memoryStorage());
    expect(handler).toHaveBeenCalledTimes(1);
    const ev = handler.mock.calls[0][0] as CustomEvent;
    expect(ev.detail).toBe(true);
  });
});

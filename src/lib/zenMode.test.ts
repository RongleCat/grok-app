import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ZEN_MODE_CHANGE_EVENT,
  ZEN_MODE_PRIOR_STORAGE_KEY,
  ZEN_MODE_STORAGE_KEY,
  applyZenModeLayoutTransition,
  clearZenModePrior,
  loadZenMode,
  loadZenModePrior,
  parseZenMode,
  parseZenModePrior,
  saveZenMode,
  saveZenModePrior,
} from "./zenMode";

function memoryStorage(seed: Record<string, string> = {}): {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  _map: Map<string, string>;
} {
  const map = new Map(Object.entries(seed));
  return {
    _map: map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

describe("zenMode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to false", () => {
    expect(loadZenMode(memoryStorage())).toBe(false);
    expect(parseZenMode(null)).toBe(false);
    expect(parseZenMode("maybe")).toBe(false);
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveZenMode(true, s);
    expect(s.getItem(ZEN_MODE_STORAGE_KEY)).toBe("1");
    expect(loadZenMode(s)).toBe(true);
    saveZenMode(false, s);
    expect(s.getItem(ZEN_MODE_STORAGE_KEY)).toBe("0");
    expect(loadZenMode(s)).toBe(false);
  });

  it("accepts true/false, 1/0, and on/off values", () => {
    expect(
      loadZenMode(memoryStorage({ [ZEN_MODE_STORAGE_KEY]: "true" })),
    ).toBe(true);
    expect(loadZenMode(memoryStorage({ [ZEN_MODE_STORAGE_KEY]: "1" }))).toBe(
      true,
    );
    expect(loadZenMode(memoryStorage({ [ZEN_MODE_STORAGE_KEY]: "on" }))).toBe(
      true,
    );
    expect(
      loadZenMode(memoryStorage({ [ZEN_MODE_STORAGE_KEY]: "false" })),
    ).toBe(false);
    expect(loadZenMode(memoryStorage({ [ZEN_MODE_STORAGE_KEY]: "0" }))).toBe(
      false,
    );
    expect(loadZenMode(memoryStorage({ [ZEN_MODE_STORAGE_KEY]: "off" }))).toBe(
      false,
    );
  });

  it("round-trips prior layout", () => {
    const s = memoryStorage();
    expect(loadZenModePrior(s)).toBeNull();
    saveZenModePrior(
      { sidebarCollapsed: false, asideCollapsed: true },
      s,
    );
    expect(loadZenModePrior(s)).toEqual({
      sidebarCollapsed: false,
      asideCollapsed: true,
    });
    clearZenModePrior(s);
    expect(s.getItem(ZEN_MODE_PRIOR_STORAGE_KEY)).toBeNull();
    expect(loadZenModePrior(s)).toBeNull();
  });

  it("rejects invalid prior payloads", () => {
    expect(parseZenModePrior("{")).toBeNull();
    expect(parseZenModePrior("{}")).toBeNull();
    expect(parseZenModePrior('{"sidebarCollapsed":1}')).toBeNull();
    expect(
      parseZenModePrior(
        '{"sidebarCollapsed":true,"asideCollapsed":"no"}',
      ),
    ).toBeNull();
  });

  it("enable remembers prior and forces both collapsed", () => {
    const { layout, nextPrior } = applyZenModeLayoutTransition(
      true,
      { sidebarCollapsed: false, asideCollapsed: false },
      null,
    );
    expect(layout).toEqual({
      sidebarCollapsed: true,
      asideCollapsed: true,
    });
    expect(nextPrior).toEqual({
      sidebarCollapsed: false,
      asideCollapsed: false,
    });
  });

  it("disable restores prior collapse state", () => {
    const { layout, nextPrior } = applyZenModeLayoutTransition(
      false,
      { sidebarCollapsed: true, asideCollapsed: true },
      { sidebarCollapsed: false, asideCollapsed: false },
    );
    expect(layout).toEqual({
      sidebarCollapsed: false,
      asideCollapsed: false,
    });
    expect(nextPrior).toBeNull();
  });

  it("disable without prior leaves current layout", () => {
    const { layout, nextPrior } = applyZenModeLayoutTransition(
      false,
      { sidebarCollapsed: true, asideCollapsed: false },
      null,
    );
    expect(layout).toEqual({
      sidebarCollapsed: true,
      asideCollapsed: false,
    });
    expect(nextPrior).toBeNull();
  });

  it("dispatches grok-zen-mode-change on save when window exists", () => {
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
    stubWindow.addEventListener(ZEN_MODE_CHANGE_EVENT, handler);
    saveZenMode(true, memoryStorage());
    expect(handler).toHaveBeenCalledTimes(1);
    const ev = handler.mock.calls[0][0] as CustomEvent;
    expect(ev.detail).toBe(true);
  });
});

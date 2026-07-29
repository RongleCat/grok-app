import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CODE_LINE_NUMBERS_PREF_EVENT,
  CODE_LINE_NUMBERS_PREF_KEY,
  loadCodeLineNumbersPref,
  saveCodeLineNumbersPref,
} from "./codeLineNumbersPref";

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

describe("codeLineNumbersPref", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to false (no line numbers)", () => {
    expect(loadCodeLineNumbersPref(memoryStorage())).toBe(false);
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveCodeLineNumbersPref(true, s);
    expect(s.getItem(CODE_LINE_NUMBERS_PREF_KEY)).toBe("1");
    expect(loadCodeLineNumbersPref(s)).toBe(true);
    saveCodeLineNumbersPref(false, s);
    expect(s.getItem(CODE_LINE_NUMBERS_PREF_KEY)).toBe("0");
    expect(loadCodeLineNumbersPref(s)).toBe(false);
  });

  it("accepts true/false, 1/0, and on/off values", () => {
    expect(
      loadCodeLineNumbersPref(
        memoryStorage({ [CODE_LINE_NUMBERS_PREF_KEY]: "true" }),
      ),
    ).toBe(true);
    expect(
      loadCodeLineNumbersPref(
        memoryStorage({ [CODE_LINE_NUMBERS_PREF_KEY]: "1" }),
      ),
    ).toBe(true);
    expect(
      loadCodeLineNumbersPref(
        memoryStorage({ [CODE_LINE_NUMBERS_PREF_KEY]: "on" }),
      ),
    ).toBe(true);
    expect(
      loadCodeLineNumbersPref(
        memoryStorage({ [CODE_LINE_NUMBERS_PREF_KEY]: "false" }),
      ),
    ).toBe(false);
    expect(
      loadCodeLineNumbersPref(
        memoryStorage({ [CODE_LINE_NUMBERS_PREF_KEY]: "0" }),
      ),
    ).toBe(false);
    expect(
      loadCodeLineNumbersPref(
        memoryStorage({ [CODE_LINE_NUMBERS_PREF_KEY]: "off" }),
      ),
    ).toBe(false);
  });

  it("ignores unknown values", () => {
    expect(
      loadCodeLineNumbersPref(
        memoryStorage({ [CODE_LINE_NUMBERS_PREF_KEY]: "maybe" }),
      ),
    ).toBe(false);
  });

  it("dispatches grok:codeLineNumbersPref on save when window exists", () => {
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
    stubWindow.addEventListener(CODE_LINE_NUMBERS_PREF_EVENT, handler);
    saveCodeLineNumbersPref(true, memoryStorage());
    expect(handler).toHaveBeenCalledTimes(1);
    const ev = handler.mock.calls[0][0] as CustomEvent;
    expect(ev.detail).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMPOSER_SPELLCHECK_CHANGED_EVENT,
  COMPOSER_SPELLCHECK_KEY,
  loadComposerSpellcheck,
  saveComposerSpellcheck,
} from "./composerSpellcheck";

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

describe("composerSpellcheck pref storage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to false (current behavior)", () => {
    expect(loadComposerSpellcheck(memoryStorage())).toBe(false);
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveComposerSpellcheck(true, s);
    expect(s.getItem(COMPOSER_SPELLCHECK_KEY)).toBe("true");
    expect(loadComposerSpellcheck(s)).toBe(true);
    saveComposerSpellcheck(false, s);
    expect(s.getItem(COMPOSER_SPELLCHECK_KEY)).toBe("false");
    expect(loadComposerSpellcheck(s)).toBe(false);
  });

  it("accepts true/false and 1/0 values", () => {
    expect(
      loadComposerSpellcheck(
        memoryStorage({ [COMPOSER_SPELLCHECK_KEY]: "true" }),
      ),
    ).toBe(true);
    expect(
      loadComposerSpellcheck(memoryStorage({ [COMPOSER_SPELLCHECK_KEY]: "1" })),
    ).toBe(true);
    expect(
      loadComposerSpellcheck(
        memoryStorage({ [COMPOSER_SPELLCHECK_KEY]: "false" }),
      ),
    ).toBe(false);
    expect(
      loadComposerSpellcheck(memoryStorage({ [COMPOSER_SPELLCHECK_KEY]: "0" })),
    ).toBe(false);
  });

  it("ignores unknown values", () => {
    expect(
      loadComposerSpellcheck(
        memoryStorage({ [COMPOSER_SPELLCHECK_KEY]: "maybe" }),
      ),
    ).toBe(false);
  });

  it("dispatches grok:composerSpellcheck on save when window exists", () => {
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
    stubWindow.addEventListener(COMPOSER_SPELLCHECK_CHANGED_EVENT, handler);
    saveComposerSpellcheck(true, memoryStorage());
    expect(handler).toHaveBeenCalledTimes(1);
    const ev = handler.mock.calls[0][0] as CustomEvent;
    expect(ev.detail).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONFIRM_EXTERNAL_LINKS_CHANGE_EVENT,
  CONFIRM_EXTERNAL_LINKS_STORAGE_KEY,
  DEFAULT_CONFIRM_EXTERNAL_LINKS,
  isExternalHttpUrl,
  loadConfirmExternalLinksPref,
  parseConfirmExternalLinksPref,
  saveConfirmExternalLinksPref,
  type ConfirmExternalLinksStorage,
} from "./externalLinkPref";

function memoryStorage(
  initial: Record<string, string> = {},
): ConfirmExternalLinksStorage & { data: Record<string, string> } {
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

describe("confirmExternalLinks pref", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to false (no confirm friction)", () => {
    expect(DEFAULT_CONFIRM_EXTERNAL_LINKS).toBe(false);
    expect(parseConfirmExternalLinksPref(null)).toBe(false);
    expect(parseConfirmExternalLinksPref("")).toBe(false);
    expect(parseConfirmExternalLinksPref("maybe")).toBe(false);
    expect(loadConfirmExternalLinksPref(memoryStorage())).toBe(false);
  });

  it("parses true/false variants", () => {
    expect(parseConfirmExternalLinksPref("1")).toBe(true);
    expect(parseConfirmExternalLinksPref("true")).toBe(true);
    expect(parseConfirmExternalLinksPref(true)).toBe(true);
    expect(parseConfirmExternalLinksPref("0")).toBe(false);
    expect(parseConfirmExternalLinksPref("false")).toBe(false);
    expect(parseConfirmExternalLinksPref(false)).toBe(false);
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveConfirmExternalLinksPref(true, s);
    expect(s.data[CONFIRM_EXTERNAL_LINKS_STORAGE_KEY]).toBe("1");
    expect(loadConfirmExternalLinksPref(s)).toBe(true);
    saveConfirmExternalLinksPref(false, s);
    expect(s.data[CONFIRM_EXTERNAL_LINKS_STORAGE_KEY]).toBe("0");
    expect(loadConfirmExternalLinksPref(s)).toBe(false);
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
    stubWindow.addEventListener(CONFIRM_EXTERNAL_LINKS_CHANGE_EVENT, handler);
    saveConfirmExternalLinksPref(true, memoryStorage());
    expect(handler).toHaveBeenCalledTimes(1);
    const ev = handler.mock.calls[0][0] as CustomEvent;
    expect(ev.detail).toBe(true);
  });
});

describe("isExternalHttpUrl", () => {
  it("accepts absolute http and https", () => {
    expect(isExternalHttpUrl("https://example.com")).toBe(true);
    expect(isExternalHttpUrl("http://example.com/path?q=1")).toBe(true);
    expect(isExternalHttpUrl("  HTTPS://Example.COM/x  ")).toBe(true);
  });

  it("rejects non-http schemes and fragments", () => {
    expect(isExternalHttpUrl("mailto:hi@example.com")).toBe(false);
    expect(isExternalHttpUrl("#section")).toBe(false);
    expect(isExternalHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isExternalHttpUrl("data:text/plain,hi")).toBe(false);
    expect(isExternalHttpUrl("ftp://files.example.com")).toBe(false);
  });

  it("rejects relative paths", () => {
    expect(isExternalHttpUrl("/local/path")).toBe(false);
    expect(isExternalHttpUrl("./relative")).toBe(false);
    expect(isExternalHttpUrl("../up")).toBe(false);
    expect(isExternalHttpUrl("docs/readme.md")).toBe(false);
    expect(isExternalHttpUrl("")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  loadComposerSendKeyPref,
  saveComposerSendKeyPref,
  shouldSendOnKeydown,
  shouldSteerOnKeydown,
  type ComposerSendKeyEvent,
} from "./composerSendKey";

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

function key(
  partial: Partial<ComposerSendKeyEvent> & { key?: string } = {},
): ComposerSendKeyEvent {
  return {
    key: partial.key ?? "Enter",
    shiftKey: partial.shiftKey ?? false,
    metaKey: partial.metaKey ?? false,
    ctrlKey: partial.ctrlKey ?? false,
    altKey: partial.altKey ?? false,
  };
}

describe("composerSendKey pref storage", () => {
  it("defaults to enter", () => {
    expect(loadComposerSendKeyPref(memoryStorage())).toBe("enter");
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveComposerSendKeyPref("mod-enter", s);
    expect(loadComposerSendKeyPref(s)).toBe("mod-enter");
    saveComposerSendKeyPref("enter", s);
    expect(loadComposerSendKeyPref(s)).toBe("enter");
  });

  it("ignores unknown storage values", () => {
    expect(
      loadComposerSendKeyPref(memoryStorage({ "grok.composerSendKey": "weird" })),
    ).toBe("enter");
  });
});

describe("shouldSendOnKeydown — enter pref", () => {
  const pref = "enter" as const;

  it("sends on plain Enter", () => {
    expect(shouldSendOnKeydown(key(), pref)).toBe(true);
  });

  it("does not send on Shift+Enter (newline)", () => {
    expect(shouldSendOnKeydown(key({ shiftKey: true }), pref)).toBe(false);
  });

  it("does not send on Cmd/Ctrl/Alt+Enter", () => {
    expect(shouldSendOnKeydown(key({ metaKey: true }), pref)).toBe(false);
    expect(shouldSendOnKeydown(key({ ctrlKey: true }), pref)).toBe(false);
    expect(shouldSendOnKeydown(key({ altKey: true }), pref)).toBe(false);
  });

  it("ignores non-Enter keys", () => {
    expect(shouldSendOnKeydown(key({ key: "a" }), pref)).toBe(false);
  });
});

describe("shouldSendOnKeydown — mod-enter pref", () => {
  const pref = "mod-enter" as const;

  it("sends on Cmd+Enter or Ctrl+Enter", () => {
    expect(shouldSendOnKeydown(key({ metaKey: true }), pref)).toBe(true);
    expect(shouldSendOnKeydown(key({ ctrlKey: true }), pref)).toBe(true);
  });

  it("does not send on plain Enter (newline)", () => {
    expect(shouldSendOnKeydown(key(), pref)).toBe(false);
  });

  it("does not send on Shift+Enter or Alt+Enter", () => {
    expect(shouldSendOnKeydown(key({ shiftKey: true }), pref)).toBe(false);
    expect(
      shouldSendOnKeydown(key({ metaKey: true, shiftKey: true }), pref),
    ).toBe(false);
    expect(shouldSendOnKeydown(key({ altKey: true, metaKey: true }), pref)).toBe(
      false,
    );
  });
});

describe("shouldSteerOnKeydown — Grok Build CLI Ctrl+Enter", () => {
  it("steers on Ctrl+Enter (CLI default mid-turn chord)", () => {
    expect(shouldSteerOnKeydown(key({ ctrlKey: true }))).toBe(true);
  });

  it("also steers on Cmd+Enter (macOS App modifier)", () => {
    expect(shouldSteerOnKeydown(key({ metaKey: true }))).toBe(true);
  });

  it("does not steal plain Enter (that still sends / queues)", () => {
    expect(shouldSteerOnKeydown(key())).toBe(false);
  });

  it("does not fire on Shift+Enter or Alt+Enter", () => {
    expect(shouldSteerOnKeydown(key({ shiftKey: true, ctrlKey: true }))).toBe(
      false,
    );
    expect(shouldSteerOnKeydown(key({ altKey: true, ctrlKey: true }))).toBe(
      false,
    );
  });

  it("ignores non-Enter keys", () => {
    expect(shouldSteerOnKeydown(key({ key: "i", ctrlKey: true }))).toBe(false);
  });
});

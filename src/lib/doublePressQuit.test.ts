import { describe, expect, it } from "vitest";
import {
  QUIT_DOUBLE_PRESS_MS,
  isQuitShortcutKey,
  nextQuitPress,
} from "./doublePressQuit";

function key(
  partial: Partial<{
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
  }> = {},
) {
  return {
    key: "q",
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...partial,
  };
}

describe("isQuitShortcutKey", () => {
  it("matches Control+Q", () => {
    expect(isQuitShortcutKey(key())).toBe(true);
    expect(isQuitShortcutKey(key({ key: "Q" }))).toBe(true);
  });

  it("rejects ⌘Q, Shift/Alt, and bare Q", () => {
    expect(isQuitShortcutKey(key({ ctrlKey: false, metaKey: true }))).toBe(
      false,
    );
    expect(isQuitShortcutKey(key({ shiftKey: true }))).toBe(false);
    expect(isQuitShortcutKey(key({ altKey: true }))).toBe(false);
    expect(isQuitShortcutKey(key({ ctrlKey: false }))).toBe(false);
    expect(isQuitShortcutKey(key({ key: "w" }))).toBe(false);
  });
});

describe("nextQuitPress", () => {
  it("arms on the first press", () => {
    expect(nextQuitPress(1000, null)).toEqual({
      action: "arm",
      armedAt: 1000,
    });
  });

  it("quits when the second press is inside the window", () => {
    expect(nextQuitPress(1000 + QUIT_DOUBLE_PRESS_MS, 1000)).toEqual({
      action: "quit",
      armedAt: null,
    });
    expect(nextQuitPress(1500, 1000)).toEqual({
      action: "quit",
      armedAt: null,
    });
  });

  it("arms again after the window lapses", () => {
    expect(nextQuitPress(1001 + QUIT_DOUBLE_PRESS_MS, 1000)).toEqual({
      action: "arm",
      armedAt: 1001 + QUIT_DOUBLE_PRESS_MS,
    });
  });
});

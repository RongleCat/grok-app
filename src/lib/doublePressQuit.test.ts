import { describe, expect, it } from "vitest";
import {
  QUIT_DOUBLE_PRESS_MS,
  isPtyFocusSurface,
  isQuitShortcutKey,
  nextQuitPress,
  shouldConsumeQuitShortcut,
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

describe("PTY / xterm Ctrl+Q passthrough", () => {
  const xtermTarget = {
    closest: (sel: string) => (sel.includes(".xterm") ? {} : null),
  } as unknown as EventTarget;

  it("detects PTY/xterm focus surfaces", () => {
    expect(isPtyFocusSurface(null)).toBe(false);
    expect(isPtyFocusSurface(xtermTarget)).toBe(true);
    expect(
      isPtyFocusSurface({ closest: () => null } as unknown as EventTarget),
    ).toBe(false);
  });

  it("does not consume Ctrl+Q when focus is on a PTY/xterm surface (no preventDefault)", () => {
    expect(
      shouldConsumeQuitShortcut({
        ...key(),
        target: xtermTarget,
      }),
    ).toBe(false);
  });

  it("still consumes Ctrl+Q when focus is not on a terminal", () => {
    expect(
      shouldConsumeQuitShortcut({
        ...key(),
        target: { closest: () => null } as unknown as EventTarget,
      }),
    ).toBe(true);
    expect(shouldConsumeQuitShortcut(key())).toBe(true);
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

import { describe, expect, it } from "vitest";
import { TERMINAL_FONT_FAMILY } from "./sideTerminalTheme";
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_CUSTOM_VALUE,
  TERMINAL_FONT_FAMILY_STORAGE_KEY,
  TERMINAL_FONT_SIZE_STORAGE_KEY,
  clampTerminalFontSize,
  loadTerminalFontFamily,
  loadTerminalFontPrefs,
  loadTerminalFontSize,
  parseTerminalFontSize,
  resolveTerminalFontFamily,
  saveTerminalFontFamily,
  saveTerminalFontSize,
  setTerminalFontPrefs,
  terminalFontSelectValue,
  type TerminalFontStorage,
} from "./terminalFontPref";

function memoryStorage(
  initial: Record<string, string> = {},
): TerminalFontStorage & { data: Record<string, string> } {
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

describe("terminalFontPref", () => {
  it("defaults family empty and size 13", () => {
    const storage = memoryStorage();
    expect(loadTerminalFontFamily(storage)).toBe("");
    expect(loadTerminalFontSize(storage)).toBe(DEFAULT_TERMINAL_FONT_SIZE);
    expect(resolveTerminalFontFamily("")).toBe(TERMINAL_FONT_FAMILY);
    expect(resolveTerminalFontFamily("JetBrainsMono Nerd Font")).toBe(
      `"JetBrainsMono Nerd Font", ${TERMINAL_FONT_FAMILY}`,
    );
  });

  it("clamps and parses size", () => {
    expect(parseTerminalFontSize(null)).toBe(13);
    expect(parseTerminalFontSize("14")).toBe(14);
    expect(parseTerminalFontSize(11.6)).toBe(12);
    expect(clampTerminalFontSize(3)).toBe(10);
    expect(clampTerminalFontSize(99)).toBe(24);
  });

  it("persists family + size across relaunch", () => {
    const storage = memoryStorage();
    saveTerminalFontFamily("Hack Nerd Font", storage);
    saveTerminalFontSize(15, storage);
    expect(storage.data[TERMINAL_FONT_FAMILY_STORAGE_KEY]).toBe(
      "Hack Nerd Font",
    );
    expect(storage.data[TERMINAL_FONT_SIZE_STORAGE_KEY]).toBe("15");
    expect(loadTerminalFontPrefs(storage)).toEqual({
      family: "Hack Nerd Font",
      size: 15,
    });
  });

  it("setTerminalFontPrefs normalizes and saves", () => {
    const storage = memoryStorage();
    const next = setTerminalFontPrefs(
      { family: '  FiraCode Nerd Font  ', size: 16.2 },
      storage,
    );
    expect(next).toEqual({ family: "FiraCode Nerd Font", size: 16 });
    expect(loadTerminalFontPrefs(storage)).toEqual(next);
  });

  it("maps select value for presets vs custom", () => {
    expect(terminalFontSelectValue("")).toBe("");
    expect(terminalFontSelectValue("Menlo")).toBe("Menlo");
    expect(terminalFontSelectValue("My Nerd Font")).toBe(
      TERMINAL_FONT_CUSTOM_VALUE,
    );
  });
});

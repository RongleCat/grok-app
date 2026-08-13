import { describe, expect, it } from "vitest";
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  loadTerminalFontFamily,
  loadTerminalFontSize,
  parseTerminalFontSize,
  resolveTerminalFontFamily,
  saveTerminalFontFamily,
  saveTerminalFontSize,
} from "./terminalFontPref";
import { TERMINAL_FONT_FAMILY } from "./sideTerminalTheme";

function mem() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  };
}

describe("terminalFontPref", () => {
  it("defaults to empty custom family and built-in stack", () => {
    const s = mem();
    expect(loadTerminalFontFamily(s)).toBe("");
    expect(resolveTerminalFontFamily("")).toBe(TERMINAL_FONT_FAMILY);
    expect(resolveTerminalFontFamily("JetBrainsMono Nerd Font")).toContain(
      "JetBrainsMono Nerd Font",
    );
    expect(resolveTerminalFontFamily("JetBrainsMono Nerd Font")).toContain(
      TERMINAL_FONT_FAMILY.split(",")[0]!.trim(),
    );
    // Shorthand must expand to the Mono face and stay one quoted family.
    const nf = resolveTerminalFontFamily("JetBrainsMono NF");
    expect(nf).toMatch(/"JetBrainsMono Nerd Font Mono"/);
    expect(nf).toMatch(/"JetBrainsMono NF"/);
    expect(nf.indexOf("JetBrainsMono Nerd Font Mono")).toBeLessThan(
      nf.indexOf("JetBrainsMono NF"),
    );
  });

  it("persists family and size", () => {
    const s = mem();
    saveTerminalFontFamily("Hack Nerd Font", s);
    expect(loadTerminalFontFamily(s)).toBe("Hack Nerd Font");
    saveTerminalFontSize(16, s);
    expect(loadTerminalFontSize(s)).toBe(16);
    saveTerminalFontFamily("", s);
    expect(loadTerminalFontFamily(s)).toBe("");
  });

  it("clamps font size", () => {
    expect(parseTerminalFontSize(3)).toBe(10);
    expect(parseTerminalFontSize(99)).toBe(24);
    expect(parseTerminalFontSize("nope")).toBe(DEFAULT_TERMINAL_FONT_SIZE);
  });
});

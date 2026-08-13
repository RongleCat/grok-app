import { describe, expect, it } from "vitest";
import {
  TERM_BG_DARK_50,
  TERM_BG_LIGHT_50,
  TERMINAL_FONT_FAMILY,
  buildSideTerminalTheme,
  readCssColor,
  resolveTerminalSurfaceBg,
} from "./sideTerminalTheme";

describe("sideTerminalTheme", () => {
  it("prefers nerd fonts then system mono", () => {
    expect(TERMINAL_FONT_FAMILY).toMatch(/MesloLGS NF/);
    expect(TERMINAL_FONT_FAMILY).toMatch(/Menlo/);
    expect(TERMINAL_FONT_FAMILY).toMatch(/monospace/);
    // Multi-word faces must be quoted so WebKit does not split them.
    expect(TERMINAL_FONT_FAMILY).toMatch(/"JetBrainsMono Nerd Font Mono"/);
    expect(TERMINAL_FONT_FAMILY).toMatch(/"JetBrainsMono NF"/);
    expect(TERMINAL_FONT_FAMILY.indexOf("JetBrainsMono Nerd Font Mono")).toBeLessThan(
      TERMINAL_FONT_FAMILY.indexOf("MesloLGS NF"),
    );
  });

  it("uses CSS veil 50% and transparent xterm canvas (even bottom fill)", () => {
    const veil = resolveTerminalSurfaceBg();
    expect([TERM_BG_DARK_50, TERM_BG_LIGHT_50]).toContain(veil);
    expect(veil.slice(-2).toLowerCase()).toBe("80");

    const t = buildSideTerminalTheme();
    // Canvas must stay fully transparent so FitAddon row-gap matches CSS veil
    expect(t.background).toBe("#00000000");
    expect(t.cyan).toBeTruthy();
    expect(t.green).toBeTruthy();
  });

  it("readCssColor falls back when token missing", () => {
    expect(readCssColor("--definitely-missing-token-xyz", "#abc")).toBe("#abc");
  });
});

import { describe, expect, it } from "vitest";
import {
  expandNerdFontAliases,
  joinCssFontStack,
  normalizeFontFamilyKey,
  quoteCssFontFamily,
} from "./cssFontFamily";

describe("cssFontFamily", () => {
  it("quotes multi-word families so WebKit does not split them", () => {
    expect(quoteCssFontFamily("JetBrainsMono NF")).toBe('"JetBrainsMono NF"');
    expect(quoteCssFontFamily("JetBrainsMono Nerd Font Mono")).toBe(
      '"JetBrainsMono Nerd Font Mono"',
    );
    expect(quoteCssFontFamily("Menlo")).toBe("Menlo");
    expect(quoteCssFontFamily('"Already Quoted"')).toBe('"Already Quoted"');
  });

  it("expands JetBrainsMono NF to Mono faces first", () => {
    const aliases = expandNerdFontAliases("JetBrainsMono NF");
    expect(aliases[0]).toBe("JetBrainsMono Nerd Font Mono");
    expect(aliases).toContain("JetBrainsMono NF");
    expect(aliases).toContain("JetBrainsMono Nerd Font");
    expect(expandNerdFontAliases("Comic Code")).toEqual(["Comic Code"]);
  });

  it("joins a stack without duplicate or unquoted nerd names", () => {
    const stack = joinCssFontStack([
      "JetBrainsMono NF",
      "JetBrainsMono NF",
      "Menlo",
    ]);
    expect(stack).toBe('"JetBrainsMono NF", Menlo');
    expect(normalizeFontFamilyKey('"JetBrainsMono NF"')).toBe("jetbrainsmono nf");
  });
});

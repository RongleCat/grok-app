/**
 * Custom text color must stay on exposed chrome only — never hijack
 * global --text-primary (settings / menus / solid panels).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pref = readFileSync(
  resolve(__dirname, "./appearanceChromePref.ts"),
  "utf8",
);
const skins = readFileSync(
  resolve(__dirname, "../styles/skins.css"),
  "utf8",
);

describe("appearance chrome text color scope", () => {
  it("applyTextColor writes --appearance-chrome-ink, not html --text-primary", () => {
    expect(pref).toMatch(/setProperty\(\s*"--appearance-chrome-ink"/);
    expect(pref).toMatch(/removeProperty\(\s*"--text-primary"/);
    expect(pref).not.toMatch(
      /setProperty\(\s*"--text-primary"\s*,\s*color\s*\)/,
    );
  });

  it("scopes custom ink to exposed wallpaper chrome, including banners and aside tabs", () => {
    expect(skins).toMatch(
      /html\[data-text-color="custom"\]\s+:is\([\s\S]*?\.sidebar,[\s\S]*?\.main__top,[\s\S]*?\.composer-welcome-mark,[\s\S]*?\.pane-toggle--pinned,[\s\S]*?\.conn-bar,[\s\S]*?\.aside \.rp-chrome,[\s\S]*?\.aside \.rp__empty-state\s*\)\s*\{[^}]*--text-primary:\s*var\(--appearance-chrome-ink\)/s,
    );
    expect(skins).not.toMatch(
      /html\[data-text-color="custom"\]\s+\.settings-page/,
    );
    expect(skins).not.toMatch(
      /html\[data-text-color="custom"\][^{]*\.menu-panel/,
    );
    expect(skins).not.toMatch(
      /html\[data-wallpaper="1"\][^{]*\.main__stage > \.conn-bar/,
    );
  });
});

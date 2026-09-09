/**
 * Wallpaper chrome lift must not restyle the settings overlay.
 * Forcing position:relative on .app-settings-stage drops inset:0, so
 * short tabs (Pet, Archived chats) no longer fill the window (#846).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES = join(__dirname, "../styles");

describe("settings overlay fills the window with wallpaper on", () => {
  it("lifts only .workbench, not every app-shell child", () => {
    const css = readFileSync(join(STYLES, "skins.css"), "utf8");
    expect(css).toMatch(
      /html\[data-wallpaper="1"\]\s+\.app-shell\s*>\s*\.workbench\s*\{[^}]*position:\s*relative/s,
    );
    expect(css).not.toMatch(
      /html\[data-wallpaper="1"\]\s+\.app-shell\s*>\s*\*:not\(/s,
    );
  });

  it("keeps the settings stage absolutely filling the shell", () => {
    const css = readFileSync(join(STYLES, "settings.part1.css"), "utf8");
    expect(css).toMatch(
      /\.app-settings-stage\s*\{[^}]*position:\s*absolute/s,
    );
    expect(css).toMatch(/\.app-settings-stage\s*\{[^}]*inset:\s*0/s);
  });

  it("samples wallpaper on the settings stage via overlay tokens and a ::before veil", () => {
    const css = readFileSync(join(STYLES, "skins.css"), "utf8");
    expect(css).toMatch(
      /html\[data-wallpaper="1"\] \.app-settings-stage\s*\{[^}]*backdrop-filter:\s*blur\(var\(--wallpaper-overlay-blur/s,
    );
    expect(css).toMatch(
      /html\[data-wallpaper="1"\] \.app-settings-stage::before\s*\{[^}]*--wallpaper-overlay-veil-opacity/s,
    );
  });

  it("keeps settings-stage blur stable through stream-perf and wallpaper-clear", () => {
    const css = readFileSync(join(STYLES, "skins.css"), "utf8");
    expect(css).not.toMatch(
      /html\[data-stream-perf="1"\]\[data-wallpaper="1"\] \.app-settings-stage,[^{]*\{[^}]*backdrop-filter:\s*none\s*!important/s,
    );
    expect(css).not.toMatch(
      /html\[data-wallpaper="1"\]\[data-wallpaper-clear="1"\] \.app-settings-stage,[^{]*\{[^}]*backdrop-filter:\s*none\s*!important/s,
    );
  });

  it("keeps the standalone appearance window solid over wallpaper", () => {
    const css = readFileSync(join(STYLES, "skins.css"), "utf8");
    expect(css).toMatch(
      /html\[data-theme-editor-shell\]\[data-wallpaper="1"\] \.app-shell::after\s*\{[^}]*content:\s*none\s*!important/s,
    );
    expect(css).toMatch(
      /html\[data-theme-editor-shell\]\[data-wallpaper="1"\] \.theme-editor-shell\s*\{[^}]*background:\s*var\(--bg-main\)\s*!important/s,
    );
  });

  it("does not force the settings stage to position:relative", () => {
    const css = readFileSync(join(STYLES, "skins.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(css).not.toMatch(
      /\.app-settings-stage\s*\{[^}]*position:\s*relative/s,
    );
  });
});

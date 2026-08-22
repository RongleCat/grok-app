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

  it("frosts the still-mounted workbench behind settings", () => {
    const css = readFileSync(join(STYLES, "skins.css"), "utf8");
    expect(css).toMatch(
      /html\[data-wallpaper="1"\] \.app-settings-stage\s*\{[^}]*backdrop-filter:\s*blur\(var\(--glass-blur\)\)/s,
    );
  });

  it("does not force the settings stage to position:relative", () => {
    const css = readFileSync(join(STYLES, "skins.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(css).not.toMatch(
      /\.app-settings-stage[^{]*\{[^}]*position:\s*relative/s,
    );
  });
});

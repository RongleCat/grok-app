/**
 * Appearance · Theme layout: presets rail left, look stack right.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const section = readFileSync(
  resolve(__dirname, "../components/settings/AppearanceSection.tsx"),
  "utf8",
);
const css = readFileSync(
  resolve(__dirname, "../styles/settings.part3.css"),
  "utf8",
);
const wallpaperCss = readFileSync(
  resolve(__dirname, "../styles/settings.part4.css"),
  "utf8",
);

describe("appearance theme layout", () => {
  it("puts presets in a sticky left rail before the look stack", () => {
    const layout = section.indexOf("settings-appearance-theme-layout");
    const rail = section.indexOf("<SkinPresetsCard");
    const theme = section.indexOf('id="settings-anchor-theme"');
    const skin = section.indexOf('id="settings-anchor-skin"');
    const wallpaper = section.indexOf('id="settings-anchor-wallpaper"');
    const chrome = section.indexOf("<AppearanceChromeCard");
    expect(layout).toBeGreaterThanOrEqual(0);
    expect(rail).toBeGreaterThan(layout);
    expect(theme).toBeGreaterThan(rail);
    expect(skin).toBeGreaterThan(theme);
    expect(wallpaper).toBeGreaterThan(skin);
    expect(chrome).toBeGreaterThan(wallpaper);
    expect(section).not.toContain("settings-appearance-duo");
    expect(section.match(/<SkinPresetsCard/g)?.length).toBe(1);
    expect(section).toContain("settings.wallpaperBlurMacHint");
  });

  it("uses dual-column scroll without compressing card content height", () => {
    expect(css).toMatch(
      /\.settings-appearance-theme-layout\s*\{[^}]*grid-template-columns:\s*minmax\(200px, 240px\) minmax\(0, 1fr\)/s,
    );
    expect(css).toMatch(
      /\.settings-appearance-theme-layout__rail,\s*\.settings-appearance-theme-layout__main\s*\{[^}]*overflow-y:\s*auto/s,
    );
    expect(css).toMatch(
      /\.settings-appearance-theme-layout__main,\s*\.settings-appearance-interface\s*\{[^}]*gap:\s*14px/s,
    );
    expect(css).toMatch(
      /\.settings-appearance-theme-layout__main\s*>\s*\.settings-card,\s*\.settings-appearance-interface\s*>\s*\.settings-card\s*\{[^}]*flex:\s*0 0 auto/s,
    );
    expect(wallpaperCss).toMatch(/\.settings-wallpaper--split/);
    expect(wallpaperCss).toMatch(
      /\.settings-wallpaper--split\s*\{[^}]*align-items:\s*start/s,
    );
    expect(wallpaperCss).toMatch(
      /\.settings-wallpaper--split \.settings-wallpaper__preview\s*\{[^}]*height:\s*auto/s,
    );
    expect(wallpaperCss).not.toMatch(
      /\.settings-wallpaper--split \.settings-wallpaper__preview\s*\{[^}]*height:\s*100%/s,
    );
  });

  it("wraps wallpaper controls from card width without distorting the preview", () => {
    expect(section).toContain(
      'className="settings-row settings-row--stack settings-wallpaper-host"',
    );
    expect(wallpaperCss).toMatch(
      /\.settings-wallpaper--split\s*\{[^}]*display:\s*flex;[^}]*flex-flow:\s*row wrap;/s,
    );
    expect(wallpaperCss).toMatch(
      /\.settings-wallpaper--split \.settings-wallpaper__preview-wrap\s*\{[^}]*flex:\s*1\.4 1 320px;[^}]*min-width:\s*min\(320px, 100%\);/s,
    );
    expect(wallpaperCss).toMatch(
      /\.settings-wallpaper__side\s*\{[^}]*flex:\s*1 1 220px;[^}]*min-width:\s*min\(220px, 100%\);/s,
    );
    expect(wallpaperCss).toMatch(
      /\.settings-wallpaper--split \.settings-wallpaper__preview\s*\{[^}]*aspect-ratio:\s*16 \/ 10;[^}]*min-height:\s*0;/s,
    );
    expect(wallpaperCss).toMatch(
      /\.settings-wallpaper__sliders\s*\{[^}]*flex:\s*1 0 100%;/s,
    );
    expect(section.match(/openWallpaperSource\(/g)?.length).toBe(1);
    expect(section).toContain('t("settings.wallpaperFind")');
  });

  it("keeps appearance skin chips and preset cards flat (no bevel gradient)", () => {
    const presets = readFileSync(
      resolve(__dirname, "../components/settings/SkinPresetsCard.tsx"),
      "utf8",
    );
    const part7 = readFileSync(
      resolve(__dirname, "../styles/settings.part7.css"),
      "utf8",
    );
    expect(section).not.toMatch(
      /settings-skin-card__swatch[\s\S]{0,160}135deg/,
    );
    expect(section).toMatch(
      /style=\{\{\s*background:\s*pack\.swatch\s*\}\}/,
    );
    expect(presets).toContain("<video");
    expect(presets).toContain("skin-presets__card-media");
    expect(presets).not.toMatch(/linear-gradient\(135deg/);
    expect(part7).toMatch(/\.skin-presets__card-media\s*\{/);
    expect(part7).not.toMatch(
      /\.skin-presets__card\s*\{[^}]*inset 0 0 0 1px/s,
    );
    expect(part7).toMatch(/\.skin-presets__card\s*\{[^}]*border:\s*none/s);
    expect(part7).not.toMatch(
      /\.skin-presets__card:hover\s*\{[^}]*border-color/s,
    );
    expect(part7).toMatch(
      /\.skin-presets__card\.is-current\s*\{[^}]*outline:\s*2px solid var\(--accent\)/s,
    );
  });
});

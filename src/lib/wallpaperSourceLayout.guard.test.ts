import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const modalCss = readFileSync(
  resolve(__dirname, "../styles/settings.part3.css"),
  "utf8",
);
const sourceCss = readFileSync(
  resolve(__dirname, "../styles/settings.part4.css"),
  "utf8",
);
const tabs = readFileSync(
  resolve(__dirname, "../components/WallpaperSourceTabs.tsx"),
  "utf8",
);
const controls = readFileSync(
  resolve(__dirname, "../components/WallpaperSourceControls.tsx"),
  "utf8",
);
const gallery = readFileSync(
  resolve(__dirname, "../components/WallpaperSourceGallery.tsx"),
  "utf8",
);

describe("wallpaper source layout guard", () => {
  it("keeps all seven grouped sources visible without horizontal scrolling", () => {
    expect(modalCss).toMatch(
      /\.modal\.glass-modal\.wallpaper-source-modal\s*\{[^}]*width:\s*min\(1440px,/s,
    );
    expect(modalCss).toMatch(
      /\.wallpaper-source-tabs\s*\{[^}]*display:\s*grid[^}]*grid-template-areas:\s*"discovery create personal"[^}]*overflow:\s*visible/s,
    );
    expect(sourceCss).toMatch(
      /@media \(max-width: 1000px\)[\s\S]*?\.wallpaper-source-tabs\s*\{[^}]*"discovery discovery"\s*"create personal"/s,
    );
    expect(sourceCss).toMatch(
      /@media \(max-width: 520px\)[\s\S]*?\.wallpaper-source-tabs__group--discovery\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s,
    );
    expect(`${modalCss}\n${sourceCss}`).not.toMatch(
      /\.wallpaper-source-tabs\s*\{[^}]*overflow-x:\s*auto/s,
    );
    expect(tabs).not.toMatch(/scrollIntoView\s*\(/);
    expect(
      tabs.match(
        /id:\s*"(?:x|web|openverse|pexels|imagine|grok_album|library)"/g,
      ),
    ).toHaveLength(7);
  });

  it("keeps route choice contextual and paged results stable", () => {
    expect(controls).toMatch(
      /wallpaper-source-form__row--x[\s\S]*wallpaper-source-form__input[\s\S]*\{xRouteControl\}[\s\S]*wallpaper-source-form__select/s,
    );
    expect(sourceCss).toMatch(
      /\.wallpaper-masonry--stable\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(3,/s,
    );
    expect(sourceCss).toMatch(
      /@media \(min-width: 1320px\)[\s\S]*?\.wallpaper-source-modal \.wallpaper-masonry--stable\s*\{[^}]*grid-template-columns:\s*repeat\(4,/s,
    );
    expect(gallery).toContain("style={");
    expect(gallery).toContain("aspectRatio: mediaAspectRatio");
    expect(gallery).toContain("wallpaper-source-load-more");
    expect(sourceCss).toMatch(
      /\.wallpaper-attribution--licensed \.wallpaper-attribution__author\s*\{[^}]*flex:\s*1 1 0/s,
    );
  });
});

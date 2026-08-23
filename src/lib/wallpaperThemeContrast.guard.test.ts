import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "../styles/skins.css"), "utf8");

describe("wallpaper theme contrast CSS", () => {
  it("maps light wallpaper to its own white veil and pane curves", () => {
    expect(css).toMatch(
      /html\[data-theme="light"\]\[data-wallpaper="1"\]\s*\{[^}]*--wallpaper-theme-scrim-color:\s*#ffffff[^}]*--wallpaper-theme-scrim-opacity:\s*var\(\s*--wallpaper-light-scrim-opacity[^}]*--wallpaper-theme-mix-main:\s*var\(--wallpaper-light-mix-main/s,
    );
    expect(css).toMatch(
      /html\[data-wallpaper="1"\]\s*\{[^}]*--wallpaper-theme-scrim-opacity:\s*var\(--wallpaper-scrim-opacity[^}]*--wallpaper-theme-mix-main:\s*var\(--wallpaper-mix-main/s,
    );
  });

  it("keeps light controls readable without adding another blur layer", () => {
    const material = css.match(
      /html\[data-theme="light"\]\[data-wallpaper="1"\][^{]*:is\(\.composer, \.composer__context-bar, \.main__top \.status-pill\)\s*\{[^}]*\}/s,
    )?.[0];
    expect(material).toContain(
      "background: var(--wallpaper-light-elevated-surface)",
    );
    expect(material).not.toContain("backdrop-filter");
    expect(css).not.toMatch(
      /html\[data-theme="light"\]\[data-wallpaper="1"\][^{]*:is\([^)]*, \.status-pill\)\s*\{/s,
    );
    expect(css).toMatch(
      /--wallpaper-light-elevated-surface:\s*color-mix\(\s*in srgb,\s*var\(--bg-elevated\) 82%,\s*transparent/s,
    );
    expect(css).toMatch(
      /html\[data-theme="light"\]\[data-wallpaper="1"\] \.sidebar\s*\{[^}]*--text-tertiary:[^}]*70%[^}]*background:\s*var\(--wallpaper-light-elevated-surface\)\s*!important/s,
    );
    expect(css).toMatch(
      /html\[data-theme="light"\]\[data-wallpaper="1"\] \.main__top\s*\{[^}]*background:\s*var\(--wallpaper-light-elevated-surface\)/s,
    );
    expect(css).toMatch(
      /\.composer-welcome-mark\s*\{[^}]*background:\s*var\(--wallpaper-light-elevated-surface\)/s,
    );
    expect(css).toMatch(
      /\.lobe-chat-assistant-timeline\s+:is\(\s*pre,\s*code,\s*\.chat-code,\s*\.chat-md__table-wrap,[^)]*\.lobe-timeline-tool__output,[^)]*\.lobe-chat-plan,[^)]*\.struct-json,[^)]*\.att-card[^)]*\)\s*\{[^}]*text-shadow:\s*none/s,
    );
  });

  it("uses foreground shadows only for dark wallpaper chrome", () => {
    const lightRoot = css.match(
      /html\[data-theme="light"\]\[data-wallpaper="1"\]\s*\{[^}]*\}/s,
    )?.[0];
    expect(lightRoot).not.toContain("foreground-shadow");
    expect(css).toMatch(
      /html\[data-theme="dark"\]\[data-wallpaper="1"\] \.sidebar\s*\{[^}]*text-shadow:/s,
    );
    expect(css).not.toMatch(
      /html\[data-theme="light"\]\[data-wallpaper="1"\][^{]*\{[^}]*text-shadow:/s,
    );
  });
});

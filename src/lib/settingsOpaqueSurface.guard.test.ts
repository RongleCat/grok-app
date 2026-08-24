import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const components = join(__dirname, "../components");
const styles = join(__dirname, "../styles");

describe("settings content surfaces stay opaque", () => {
  it("reuses the shared settings card for official aux controls", () => {
    const panel = readFileSync(join(components, "OfficialAuxPanel.tsx"), "utf8");

    expect(panel).toContain('"settings-card prov-official-aux"');
    expect(panel).toContain(
      'className="settings-card prov-official-aux prov-official-aux--sub"',
    );
  });

  it("keeps the official aux modifier layout-only", () => {
    const css = readFileSync(join(styles, "composer.part1.css"), "utf8");
    const baseRule = css.match(/\.prov-official-aux\s*\{[^}]*\}/s)?.[0];

    expect(baseRule).toBeDefined();
    expect(baseRule).not.toMatch(/(?:background|border|border-radius)\s*:/);
  });

  it("dims disabled official aux content without fading its surface", () => {
    const css = readFileSync(join(styles, "composer.part1.css"), "utf8");
    const disabledRule = css.match(
      /\.prov-official-aux\.is-disabled\s*>\s*:is\([^{]+\)\s*\{[^}]*\}/s,
    )?.[0];

    expect(css).not.toMatch(
      /\.prov-official-aux\.is-disabled\s*\{[^}]*opacity\s*:/s,
    );
    expect(disabledRule).toContain("opacity: 0.72");
  });

  it("keeps the shared settings card on the solid card token", () => {
    const css = readFileSync(join(styles, "settings.part1.css"), "utf8");

    expect(css).toMatch(
      /\.settings-card\s*\{[^}]*background:\s*var\(--bg-card\)/s,
    );
  });
});

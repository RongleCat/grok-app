import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const components = join(__dirname, "../components");
const styles = join(__dirname, "../styles");

describe("settings surfaces reuse their owning component", () => {
  it("does not use the shared card class for flat extension blocks", () => {
    const panel = readFileSync(join(components, "ExtensionsPanel.tsx"), "utf8");
    const css = readFileSync(join(styles, "extensions-ref.part2.css"), "utf8");

    expect(panel).not.toContain('className="settings-card ext-card"');
    expect(css).not.toContain(".settings-card.ext-card");
  });

  it("reuses the shared card surface for the remote IM disclosure", () => {
    const panel = readFileSync(
      join(components, "RemoteImChannelPanel.tsx"),
      "utf8",
    );
    const css = readFileSync(join(styles, "phone.part3.css"), "utf8");
    const rule = css.match(/\.rim-collapse\s*\{[^}]*\}/s)?.[0];

    expect(panel).toContain('className="settings-card rim-collapse"');
    expect(rule).not.toMatch(/(?:border|border-radius|background|overflow)\s*:/);
  });

  it("removes the unused nested card override", () => {
    const css = readFileSync(join(styles, "modals.part6.css"), "utf8");

    expect(css).not.toContain(".settings-card--nested.pi-settings-block");
  });
});

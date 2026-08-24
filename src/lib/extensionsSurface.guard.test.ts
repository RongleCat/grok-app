import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(__dirname, path), "utf8");

describe("extensions settings surface guard", () => {
  it("wraps every extension tab in the shared opaque settings card", () => {
    const component = read("../components/ExtensionsPanel.tsx");
    const surface = component.match(
      /<div className="settings-card ext-panel__surface">([\s\S]*?)\n\s*<\/div>\n\n\s*<GlassModal/,
    )?.[1];

    expect(surface).toBeDefined();
    for (const tab of ["plugins", "skills", "mcp", "hooks", "agents"]) {
      expect(surface).toContain(`tab === "${tab}"`);
    }
  });

  it("reuses the shared card material and keeps its modifier layout-only", () => {
    const extensionCss = read("../styles/extensions-ref.part1.css");
    const settingsCss = read("../styles/settings.part1.css");

    expect(settingsCss).toMatch(
      /\.settings-card\s*\{[^}]*background:\s*var\(--bg-card\);/s,
    );
    expect(extensionCss).toMatch(
      /\.ext-panel__surface\s*\{[^}]*padding:\s*16px;[^}]*min-width:\s*0;/s,
    );
    expect(extensionCss).not.toMatch(
      /\.ext-panel__surface\s*\{[^}]*background:/s,
    );
  });
});

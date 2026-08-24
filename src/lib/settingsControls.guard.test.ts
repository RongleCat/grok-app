import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const components = join(__dirname, "../components");

describe("settings controls reuse shared primitives", () => {
  it("uses UiSwitch instead of a local extensions toggle", () => {
    const src = readFileSync(join(components, "ExtensionsPanel.tsx"), "utf8");

    expect(src).toContain("<UiSwitch");
    expect(src).not.toContain("ExtensionToggle");
  });

  it("keeps remote IM switch and check names as shared aliases", () => {
    const src = readFileSync(
      join(components, "remoteIm/RimControls.tsx"),
      "utf8",
    );

    expect(src).toContain("UiSwitch as RimSwitch");
    expect(src).toContain("UiCheck as RimCheck");
    expect(src).not.toContain('role="switch"');
    expect(src).not.toContain('role="checkbox"');
  });

  it("uses the shared select and segmented control directly", () => {
    const controls = readFileSync(
      join(components, "remoteIm/RimControls.tsx"),
      "utf8",
    );
    const channel = readFileSync(
      join(components, "RemoteImChannelPanel.tsx"),
      "utf8",
    );

    expect(controls).not.toMatch(/Rim(?:Select|Seg)/);
    expect(channel).not.toMatch(/Rim(?:Select|Seg)/);
    expect(channel).toContain("<Select");
    expect(channel).toContain("<SegmentedControl");
  });
});

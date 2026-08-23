import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(__dirname, path), "utf8");
const component = read("../components/ui/SegmentedControl.tsx");
const css = [
  read("../styles/settings.part1.css"),
  read("../styles/settings.part3.css"),
].join("\n");

describe("settings segmented control motion guard", () => {
  it("positions one shared indicator from the active button geometry", () => {
    expect(component).toContain("active.offsetLeft");
    expect(component).toContain("active.offsetTop");
    expect(component).toContain("active.offsetWidth");
    expect(component).toContain("active.offsetHeight");
    expect(component).toContain("void root.offsetWidth");
    expect(component).toContain('root.dataset.segmentedAnimate = "1"');
    expect(component).toContain("new ResizeObserver(measure)");
    expect(component).toContain('<span className="settings-seg__indicator"');
  });

  it("limits sliding styles to explicit segmented controls", () => {
    expect(css).toMatch(
      /\.settings-seg--sliding\[data-segmented-ready="1"\][^{]*\.settings-seg__indicator\s*\{[^}]*opacity:\s*1;?[^}]*\}/s,
    );
    expect(css).toMatch(
      /\.settings-seg--sliding\[data-segmented-animate="1"\][^{]*\.settings-seg__indicator\s*\{[^}]*transform var\(--motion-normal\)/s,
    );
    expect(css).toMatch(
      /\.settings-seg--sliding\s*\{[^}]*flex-wrap:\s*wrap;[^}]*max-width:\s*100%;[^}]*flex-shrink:\s*1;/s,
    );
    expect(css).toMatch(
      /\.settings-seg--sliding \.settings-seg__btn\s*\{[^}]*white-space:\s*nowrap;/s,
    );
    expect(css).not.toMatch(/\.settings-page__tabs-seg:has\(/);
  });

  it("routes each exclusive settings control through the shared component", () => {
    for (const path of [
      "../components/settings/shared.tsx",
      "../components/settings/AccountSection.tsx",
      "../components/settings/AppearanceSection.tsx",
      "../components/settings/GeneralSection.tsx",
      "../components/settings/RuntimeSection.tsx",
      "../components/PromptHistoryPanel.tsx",
      "../components/remoteIm/RimControls.tsx",
    ]) {
      const source = read(path);
      expect(source).toContain("<SegmentedControl");
      expect(source).not.toMatch(
        /className=(?:\{)?["']settings-seg(?:\s|["'])/,
      );
    }
  });
});

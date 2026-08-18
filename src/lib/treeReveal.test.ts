import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyTreeRevealSize,
  shouldAnimateTreeReveal,
  treeRevealSizeStyle,
} from "./treeReveal";

describe("treeRevealSizeStyle", () => {
  it("writes height/min/max together so WKWebView can interpolate the box", () => {
    expect(treeRevealSizeStyle(0)).toEqual({
      height: 0,
      minHeight: 0,
      maxHeight: 0,
    });
    expect(treeRevealSizeStyle(256)).toEqual({
      height: 256,
      minHeight: 256,
      maxHeight: 256,
    });
  });
});

describe("shouldAnimateTreeReveal", () => {
  it("skips the first commit so a hydrated open project does not collapse-in", () => {
    expect(
      shouldAnimateTreeReveal({ isFirstCommit: true, reducedMotion: false }),
    ).toBe(false);
    expect(
      shouldAnimateTreeReveal({ isFirstCommit: false, reducedMotion: false }),
    ).toBe(true);
    expect(
      shouldAnimateTreeReveal({ isFirstCommit: false, reducedMotion: true }),
    ).toBe(false);
  });
});

describe("applyTreeRevealSize", () => {
  it("sets the px tuple and clears it for auto", () => {
    const el = { style: { height: "", minHeight: "", maxHeight: "" } };
    applyTreeRevealSize(el as HTMLElement, 120);
    expect(el.style).toEqual({
      height: "120px",
      minHeight: "120px",
      maxHeight: "120px",
    });
    applyTreeRevealSize(el as HTMLElement, "auto");
    expect(el.style).toEqual({ height: "", minHeight: "", maxHeight: "" });
  });
});

describe("tree-reveal CSS", () => {
  const css = readFileSync(
    resolve(__dirname, "../styles/sidebar.part2.css"),
    "utf8",
  );

  it("interpolates the inline height tuple — not 0fr/1fr, which WKWebView snaps", () => {
    expect(css).not.toMatch(/grid-template-rows/);
    expect(css).toMatch(/\.tree-reveal\s*\{[^}]*height var\(--motion-normal\)/);
    expect(css).toMatch(/min-height var\(--motion-normal\)/);
    expect(css).toMatch(/max-height var\(--motion-normal\)/);
    expect(css).toMatch(/var\(--motion-pane-ease\)/);
  });
});

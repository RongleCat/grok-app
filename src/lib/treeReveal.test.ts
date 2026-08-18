import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyTreeRevealSize,
  beginTreeRevealMotion,
  isTreeRevealMotionActive,
  resetTreeRevealMotionForTests,
  runAfterTreeRevealMotion,
  shouldAnimateTreeReveal,
  TREE_REVEAL_CLOSE_MS,
  TREE_REVEAL_MS,
  treeRevealCloseSteps,
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

describe("treeRevealCloseSteps", () => {
  it("locks the used height before writing 0 so auto→0 can interpolate", () => {
    expect(treeRevealCloseSteps(256)).toEqual({ lockPx: 256, endPx: 0 });
    expect(treeRevealCloseSteps(0)).toEqual({ lockPx: 0, endPx: 0 });
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

describe("tree reveal motion deferral", () => {
  afterEach(() => {
    resetTreeRevealMotionForTests();
  });

  it("defers work until the last expand/collapse ends", () => {
    const ran: string[] = [];
    expect(runAfterTreeRevealMotion(() => ran.push("early"))).toBe(false);
    const end = beginTreeRevealMotion();
    expect(isTreeRevealMotionActive()).toBe(true);
    expect(runAfterTreeRevealMotion(() => ran.push("later"))).toBe(true);
    expect(ran).toEqual([]);
    end();
    expect(isTreeRevealMotionActive()).toBe(false);
    expect(ran).toEqual(["later"]);
  });
});

describe("tree-reveal CSS", () => {
  const css = readFileSync(
    resolve(__dirname, "../styles/sidebar.part2.css"),
    "utf8",
  );

  it("drives the L1 projects chevron, not only per-project chats", () => {
    const src = readFileSync(
      resolve(__dirname, "../app/AppWorkbench.tsx"),
      "utf8",
    );
    expect(src).toMatch(
      /<SidebarTreeReveal open=\{projectsOpen\} className="tree-reveal--projects">/,
    );
  });

  it("interpolates the inline height tuple — not 0fr/1fr, which WKWebView snaps", () => {
    expect(TREE_REVEAL_MS).toBe(200);
    expect(TREE_REVEAL_CLOSE_MS).toBe(200);
    expect(css).not.toMatch(/grid-template-rows/);
    expect(css).toMatch(/\.tree-reveal\s*\{[^}]*height var\(--motion-normal\)/);
    expect(css).toMatch(/min-height var\(--motion-normal\)/);
    expect(css).toMatch(/max-height var\(--motion-normal\)/);
    expect(css).toMatch(/var\(--motion-pane-ease\)/);
  });
});

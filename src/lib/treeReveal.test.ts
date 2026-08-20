import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyTreeRevealSize,
  beginTreeRevealMotion,
  isTreeRevealMotionActive,
  resetTreeRevealMotionForTests,
  runAfterTreeRevealMotion,
  subscribeTreeRevealMotion,
  shouldAnimateTreeReveal,
  shouldReleaseTreeRevealLock,
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

describe("shouldReleaseTreeRevealLock", () => {
  it("releases when open content outgrows the locked box", () => {
    expect(
      shouldReleaseTreeRevealLock({
        open: true,
        animatingOpen: false,
        contentPx: 160,
        boxPx: 96,
      }),
    ).toBe(true);
  });

  it("holds the lock during the open animation and when already fitting", () => {
    expect(
      shouldReleaseTreeRevealLock({
        open: true,
        animatingOpen: true,
        contentPx: 160,
        boxPx: 96,
      }),
    ).toBe(false);
    expect(
      shouldReleaseTreeRevealLock({
        open: true,
        animatingOpen: false,
        contentPx: 96,
        boxPx: 96,
      }),
    ).toBe(false);
    expect(
      shouldReleaseTreeRevealLock({
        open: false,
        animatingOpen: false,
        contentPx: 160,
        boxPx: 0,
      }),
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

  it("notifies subscribers on start and end even if they never deferred", () => {
    const seen: boolean[] = [];
    const stop = subscribeTreeRevealMotion((active) => seen.push(active));
    const end = beginTreeRevealMotion();
    expect(seen).toEqual([true]);
    end();
    expect(seen).toEqual([true, false]);
    stop();
  });

  it("restores overflow subscribers before deferred align waiters", () => {
    const ran: string[] = [];
    const stop = subscribeTreeRevealMotion((active) => {
      if (!active) ran.push("overflow");
    });
    const end = beginTreeRevealMotion();
    expect(runAfterTreeRevealMotion(() => ran.push("align"))).toBe(true);
    end();
    expect(ran).toEqual(["overflow", "align"]);
    stop();
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
    expect(src).toMatch(/syncTreeReveal/);
  });

  it("hides the sidebar overlay thumb while the project list is moving", () => {
    expect(css).toMatch(
      /\.sidebar__scroll:has\(\[data-tree-reveal-motion\]\) \.overlay-scroll__thumb/,
    );
    expect(css).toMatch(
      /\.sidebar__scroll:has\(\[data-tree-reveal-motion\]\) \.overlay-scroll__viewport/,
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

  it("sets min-height:0 so a flex-column sidebar can collapse the box", () => {
    // Default flex min-height:auto keeps content visible when height animates
    // to 0 (Other sessions used to be a direct child of .sidebar__scroll-inner).
    expect(css).toMatch(/\.tree-reveal\s*\{[^}]*min-height:\s*0/);
  });
});

describe("project / orphan flex shrink", () => {
  const part1 = readFileSync(
    resolve(__dirname, "../styles/sidebar.part1.css"),
    "utf8",
  );
  const part2 = readFileSync(
    resolve(__dirname, "../styles/sidebar.part2.css"),
    "utf8",
  );

  it("keeps open project folders from shrinking below their session list", () => {
    expect(part1).toMatch(/\.tree-project\s*\{[^}]*flex-shrink:\s*0/);
    expect(part2).toMatch(/\.tree-orphan\s*\{[^}]*flex-shrink:\s*0/);
  });
});

describe("Other sessions tree wrap", () => {
  const src = readFileSync(
    resolve(__dirname, "../app/AppWorkbench.tsx"),
    "utf8",
  );

  it("wraps the Other-sessions reveal in a block .tree-orphan like .tree-project", () => {
    expect(src).toContain('className="tree-orphan"');
    expect(src).toMatch(
      /className="tree-orphan"[\s\S]*SidebarTreeReveal open=\{historyOpen\}/,
    );
  });

  it("keeps Other-session rows on the same left inset as project L3", () => {
    const part2 = readFileSync(
      resolve(__dirname, "../styles/sidebar.part2.css"),
      "utf8",
    );
    expect(part2).not.toMatch(/\.tree-orphan\s+\.tree-l3-list-wrap/);
    expect(part2).not.toMatch(/\.tree-l3--orphan\s*\{/);
    expect(part2).not.toMatch(/\.tree-date-group--orphan/);
  });
});

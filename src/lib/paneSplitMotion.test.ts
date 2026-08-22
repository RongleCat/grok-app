import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  beginPaneSplitMotion,
  bumpPaneSplitMotion,
  endPaneSplitMotion,
  isPaneSplitAsideMotionActive,
  isPaneSplitCoverActive,
  isPaneSplitMotionActive,
  isPaneSplitSidebarMotionActive,
  isPaneSplitWidthMotionActive,
  paneSplitSizeStyle,
  paneWidthTarget,
  prefersReducedMotion,
  resetPaneSplitMotionForTests,
  runAfterPaneSplitMotion,
  scheduleAfterPaneSplitMotion,
  shouldStartPaneSplitMotion,
  subscribePaneSplitMotionBump,
} from "./paneSplitMotion";

afterEach(() => {
  resetPaneSplitMotionForTests();
});

describe("paneWidthTarget", () => {
  it("is 0 when collapsed and the open width when expanded", () => {
    expect(paneWidthTarget(true, 268)).toBe(0);
    expect(paneWidthTarget(false, 268)).toBe(268);
    expect(paneWidthTarget(false, 0)).toBe(0);
  });
});

describe("paneSplitSizeStyle", () => {
  it("writes the full flex size tuple so the used box can interpolate", () => {
    expect(paneSplitSizeStyle(240, "x", false)).toEqual({
      width: 240,
      minWidth: 240,
      maxWidth: 240,
      flexBasis: 240,
    });
    expect(paneSplitSizeStyle(180, "y", false)).toEqual({
      height: 180,
      minHeight: 180,
      flexBasis: 180,
    });
  });
});

describe("desktop hidden CSS must not force width 0", () => {
  /**
   * Click-toggle used to add `width: 0 !important` while drag only changed
   * inline width. !important wins immediately in WKWebView — that is the
   * hard cut. These desktop rules must stay free of that snap.
   */
  function ruleBody(css: string, selector: string): string {
    const idx = css.indexOf(selector);
    expect(idx).toBeGreaterThanOrEqual(0);
    const open = css.indexOf("{", idx);
    const close = css.indexOf("}", open);
    return css.slice(open, close + 1);
  }

  it("click-toggle clips a fixed-width rail and fades it — no wrap, no skeleton", () => {
    const sidebar = readFileSync(
      resolve(__dirname, "../styles/sidebar.part1.css"),
      "utf8",
    );
    const chat = readFileSync(
      resolve(__dirname, "../styles/chat.part6.css"),
      "utf8",
    );
    expect(sidebar).toMatch(/\.sidebar__clip/);
    expect(sidebar).toMatch(/opacity:\s*0/);
    expect(sidebar).not.toMatch(/repeating-linear-gradient/);
    expect(chat).toMatch(
      /\.workbench--sidebar-motion \.sidebar:not\(\.is-resizing\) \.sidebar__clip/,
    );
    expect(chat).toMatch(
      /\.workbench--aside-motion \.aside:not\(\.is-resizing\) \.aside__inner/,
    );
    expect(chat).toMatch(/--aside-rail-min/);
  });

  it("drop-idle fade must not replace sidebar width interpolation", () => {
    const css = readFileSync(
      resolve(__dirname, "../styles/settings.part5.css"),
      "utf8",
    );
    expect(css).not.toMatch(
      /\.main\s*,\s*\.sidebar\s*\{[^}]*\btransition\s*:/,
    );
  });

  it("sidebar--hidden / collapsed do not set width !important", () => {
    const css = readFileSync(
      resolve(__dirname, "../styles/sidebar.part1.css"),
      "utf8",
    );
    const body = ruleBody(css, ".sidebar--hidden");
    expect(body).not.toMatch(/width\s*:\s*0\s*!important/);
    expect(body).not.toMatch(/min-width\s*:\s*0\s*!important/);
    expect(body).not.toMatch(/max-width\s*:\s*0\s*!important/);
  });

  it("tokens do not zero --motion-pane under prefers-reduced-motion", () => {
    const css = readFileSync(
      resolve(__dirname, "../styles/tokens.css"),
      "utf8",
    );
    const idx = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(idx).toBeGreaterThanOrEqual(0);
    const block = css.slice(idx, idx + 280);
    expect(block).not.toMatch(/--motion-pane\s*:\s*0ms/);
  });

  it("in-flow sidebar / aside / bottom terminal snap; overlay drawers interpolate transform", () => {
    const sidebar = readFileSync(
      resolve(__dirname, "../styles/sidebar.part1.css"),
      "utf8",
    );
    expect(ruleBody(sidebar, "\n.sidebar {")).not.toMatch(
      /width var\(--motion-pane\)/,
    );
    expect(sidebar).toMatch(
      /\.sidebar\.sidebar--overlay[^{]*\{[^}]*transform var\(--motion-pane\)/,
    );
    const aside = readFileSync(
      resolve(__dirname, "../styles/chat.part6.css"),
      "utf8",
    );
    expect(ruleBody(aside, "\n.aside {")).not.toMatch(
      /width var\(--motion-pane\)/,
    );
    expect(aside).toMatch(
      /\.aside\.aside--overlay[^{]*\{[^}]*transform var\(--motion-pane\)/,
    );
    const hidden = ruleBody(aside, ".aside--collapsed");
    expect(hidden).not.toMatch(/width\s*:\s*0\s*!important/);
    const bt = readFileSync(
      resolve(__dirname, "../styles/bottom-terminal.css"),
      "utf8",
    );
    const btBody = ruleBody(bt, "\n.bt {");
    expect(btBody).not.toMatch(/height var\(--motion-pane\)/);
    expect(btBody).not.toMatch(/min-height var\(--motion-pane\)/);
    expect(btBody).not.toMatch(/flex-basis var\(--motion-pane\)/);
    expect(bt).not.toMatch(/^\s*height\s*:\s*0\s*!important/m);
  });

  it("sidebar-only motion does not overflow-hidden or contain a stable aside", () => {
    const css = readFileSync(
      resolve(__dirname, "../styles/chat.part6.css"),
      "utf8",
    );
    expect(css).not.toMatch(
      /\.workbench--pane-motion \.aside,\s*\.workbench--pane-motion \.sidebar/,
    );
    expect(css).not.toMatch(/\.workbench--sidebar-motion[^{]*\{[^}]*contain:/);
  });
});

describe("motion window", () => {
  it("still starts when OS reduce-motion is on so the pane can interpolate", () => {
    expect(
      shouldStartPaneSplitMotion({
        reducedMotion: true,
        isFirstCommit: false,
        collapsedChanged: true,
      }),
    ).toBe(true);
    expect(
      shouldStartPaneSplitMotion({
        reducedMotion: false,
        isFirstCommit: true,
        collapsedChanged: true,
      }),
    ).toBe(false);
    expect(prefersReducedMotion({ matches: true })).toBe(true);
  });

  it("tracks sidebar-only motion without covering the aside webview", () => {
    const id = beginPaneSplitMotion({
      width: true,
      sidebar: true,
      aside: false,
      cover: false,
    });
    expect(isPaneSplitSidebarMotionActive()).toBe(true);
    expect(isPaneSplitAsideMotionActive()).toBe(false);
    expect(isPaneSplitCoverActive()).toBe(false);
    endPaneSplitMotion(id);
    expect(isPaneSplitSidebarMotionActive()).toBe(false);
  });

  it("tracks width and cover independently of height-only motion", () => {
    const height = beginPaneSplitMotion({ width: false, cover: false });
    expect(isPaneSplitMotionActive()).toBe(true);
    expect(isPaneSplitWidthMotionActive()).toBe(false);
    expect(isPaneSplitCoverActive()).toBe(false);
    const aside = beginPaneSplitMotion({ width: true, cover: true });
    expect(isPaneSplitWidthMotionActive()).toBe(true);
    expect(isPaneSplitCoverActive()).toBe(true);
    endPaneSplitMotion(aside);
    expect(isPaneSplitWidthMotionActive()).toBe(false);
    expect(isPaneSplitCoverActive()).toBe(false);
    expect(isPaneSplitMotionActive()).toBe(true);
    endPaneSplitMotion(height);
    expect(isPaneSplitMotionActive()).toBe(false);
  });

  it("begin/end tokens do not cancel a sibling motion", () => {
    const a = beginPaneSplitMotion();
    const b = beginPaneSplitMotion({ width: false });
    endPaneSplitMotion(a);
    expect(isPaneSplitMotionActive()).toBe(true);
    endPaneSplitMotion(b);
    expect(isPaneSplitMotionActive()).toBe(false);
  });

  it("settles after motion so rapid toggles do not refit every time", () => {
    const ran: string[] = [];
    const a = beginPaneSplitMotion({ sidebar: true });
    scheduleAfterPaneSplitMotion(() => ran.push("fit"), 0);
    expect(ran).toEqual([]);
    endPaneSplitMotion(a);
    expect(ran).toEqual(["fit"]);
    const b = beginPaneSplitMotion({ sidebar: true });
    scheduleAfterPaneSplitMotion(() => ran.push("again"), 0);
    expect(ran).toEqual(["fit"]);
    endPaneSplitMotion(b);
    expect(ran).toEqual(["fit", "again"]);
  });

  it("defers work until the last token ends", () => {
    const ran: string[] = [];
    const a = beginPaneSplitMotion();
    expect(runAfterPaneSplitMotion(() => ran.push("x"))).toBe(true);
    expect(ran).toEqual([]);
    const b = beginPaneSplitMotion({ width: false });
    endPaneSplitMotion(a);
    expect(ran).toEqual([]);
    endPaneSplitMotion(b);
    expect(ran).toEqual(["x"]);
    expect(runAfterPaneSplitMotion(() => ran.push("y"))).toBe(false);
    expect(ran).toEqual(["x"]);
  });

  it("bump notifies only while a token is live", () => {
    let n = 0;
    const stop = subscribePaneSplitMotionBump(() => {
      n += 1;
    });
    bumpPaneSplitMotion();
    expect(n).toBe(0);
    const id = beginPaneSplitMotion();
    bumpPaneSplitMotion();
    expect(n).toBe(1);
    endPaneSplitMotion(id);
    bumpPaneSplitMotion();
    expect(n).toBe(1);
    stop();
  });
});

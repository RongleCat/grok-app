import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAIN_CHAT_MIN_WIDTH } from "@/lib/layout";
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
    expect(sidebar).toMatch(
      /\.sidebar:not\(\.sidebar--overlay\):not\(\.sidebar--phone-drawer\):not\(\.is-resizing\)[^{]*\.sidebar__clip\s*>\s*\*/s,
    );
    expect(sidebar).toMatch(/--sidebar-rail-min/);
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

  it("in-flow sidebar and aside interpolate while bottom terminal snaps", () => {
    const settings = readFileSync(
      resolve(__dirname, "../styles/settings.part5.css"),
      "utf8",
    );
    expect(ruleBody(settings, "\n.main__top {")).not.toMatch(
      /transition:[^;}]*padding-left/,
    );
    const sidebar = readFileSync(
      resolve(__dirname, "../styles/sidebar.part1.css"),
      "utf8",
    );
    expect(ruleBody(sidebar, "\n.sidebar {")).toMatch(
      /width var\(--motion-pane\)[^,]*,[^}]*min-width var\(--motion-pane\)[^,]*,[^}]*max-width var\(--motion-pane\)[^,]*,[^}]*flex-basis var\(--motion-pane\)/s,
    );
    expect(sidebar).not.toMatch(
      /^\s*\.workbench--sidebar-motion[^\n{]*\.sidebar/m,
    );
    expect(sidebar).not.toMatch(
      /\.sidebar\.sidebar--overlay[^}]*width var\(--motion-pane\)/s,
    );
    expect(sidebar).toMatch(
      /\.sidebar\.sidebar--overlay[^{]*\{[^}]*transform var\(--motion-pane\)/,
    );
    const aside = readFileSync(
      resolve(__dirname, "../styles/chat.part6.css"),
      "utf8",
    );
    const workbench = readFileSync(
      resolve(__dirname, "../styles/workbench.part1.css"),
      "utf8",
    );
    expect(aside).toMatch(
      /\.workbench--aside-motion\s+\.aside:not\(\.is-resizing\):not\(\.aside--overlay\)\s*\{[^}]*width var\(--motion-pane\)[^,]*,[^}]*min-width var\(--motion-pane\)[^,]*,[^}]*max-width var\(--motion-pane\)[^,]*,[^}]*flex-basis var\(--motion-pane\)/s,
    );
    expect(aside).toMatch(
      /\.aside\.aside--overlay[^{]*\{[^}]*transform var\(--motion-pane\)/,
    );
    expect(workbench).toMatch(
      /\.workbench--sidebar-motion \.main__top\s*\{[^}]*transition:\s*padding-left var\(--motion-pane\) var\(--motion-pane-ease\)/s,
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

  it("reveals the terminal content without interpolating the chat layout", () => {
    const terminal = readFileSync(
      resolve(__dirname, "../styles/bottom-terminal.css"),
      "utf8",
    );
    expect(terminal).toMatch(
      /\.bt\[data-open="true"\]:not\(\.is-resizing\)[\s\S]*?:is\(\.bt__chrome, \.bt__body\)\s*\{[^}]*animation:\s*bt-panel-in/,
    );
    expect(terminal).toMatch(
      /@keyframes bt-panel-in\s*\{\s*from\s*\{\s*opacity:\s*0;\s*translate:\s*0 6px;\s*\}\s*to\s*\{\s*opacity:\s*1;\s*translate:\s*0;\s*\}\s*\}/s,
    );
    expect(terminal).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.bt\[data-open="true"\]:not\(\.is-resizing\)[\s\S]*?animation:\s*none/,
    );
  });

  it("keeps the bottom terminal separator and surfaces theme-native", () => {
    const terminal = readFileSync(
      resolve(__dirname, "../styles/bottom-terminal.css"),
      "utf8",
    );
    expect(terminal).toMatch(
      /\.bt__resize::after\s*\{[^}]*height:\s*1px;[^}]*background:\s*var\(--border-subtle\)/s,
    );
    expect(terminal).toMatch(
      /\.bt__resize:hover::after,\s*\.bt\.is-resizing \.bt__resize::after\s*\{[^}]*background:\s*var\(--border-focus\)/s,
    );
    expect(ruleBody(terminal, "\n.bt__chrome {")).toMatch(
      /background:\s*color-mix\([^;]*var\(--bg-card\)[^;]*var\(--bg-main\)/s,
    );
    expect(ruleBody(terminal, "\n.bt__body {")).toMatch(
      /background:\s*var\(--bg-main\)/,
    );
    expect(terminal).toMatch(
      /html\[data-wallpaper="1"\] \.bt\s*\{[^}]*var\(--wallpaper-theme-mix-main\)[^}]*backdrop-filter:\s*blur\(var\(--wallpaper-settings-blur, 14px\)\)/s,
    );
    expect(terminal).not.toMatch(
      /(?:background|border(?:-color)?):\s*(?:#000(?:000)?\b|black\b)/i,
    );
  });

  it("starts pane width motion only outside overlay and phone layouts", () => {
    const hook = readFileSync(
      resolve(__dirname, "../hooks/usePaneSplitMotion.ts"),
      "utf8",
    );
    expect(hook).toContain("sidebarChanged && !opts.sidebarOverlay");
    expect(hook).toContain("asideChanged && opts.asideInFlow");
    expect(hook).toContain("asideInFlowRef.current");
    expect(hook).toContain("!opts.phoneLayout");
    expect(hook).toContain("width: sidebarWidthChanged || asideWidthChanged");
    expect(hook).toContain("sidebar: sidebarWidthChanged");
    expect(hook).toContain("aside: asideWidthChanged");
    expect(hook).toContain("asideOverlayMotionChanged");
    expect(hook).toContain("asideOverlayRef.current || asideOverlay");
    expect(hook).toContain("cover: coverChanged");
    expect(hook).toContain('pendingWidthPanes.add("sidebar")');
    expect(hook).toContain('pendingWidthPanes.add("aside")');
    expect(hook).toContain("pendingWidthPanes.delete(pane)");
  });

  it("interpolates the right-aligned side workbench between rail and full width", () => {
    const hook = readFileSync(
      resolve(__dirname, "../hooks/usePaneSplitMotion.ts"),
      "utf8",
    );
    const aside = readFileSync(
      resolve(__dirname, "../app/WorkbenchResourcesAside.tsx"),
      "utf8",
    );
    const side = readFileSync(
      resolve(__dirname, "../styles/side-workbench.part1.css"),
      "utf8",
    );

    expect(hook).toContain("sideExpanded: boolean");
    expect(hook).toContain("workbench--side-expand-motion");
    expect(aside).toContain(
      'width: "calc(100% - var(--sw-sidebar-occupied, 0px))"',
    );
    expect(side).not.toMatch(
      /\.workbench--side-expanded \.aside\s*\{[^}]*transition:\s*none/s,
    );
    expect(side).toMatch(
      /\.workbench--side-expand-motion \.aside:not\(\.is-resizing\)\s*\{[^}]*width var\(--motion-pane\)[^}]*min-width var\(--motion-pane\)[^}]*max-width var\(--motion-pane\)/s,
    );
    expect(side).toMatch(
      /\.workbench--side-expanded \.aside:not\(\.aside--hidden\)\s*\{[^}]*right:\s*0;[^}]*left:\s*auto;/s,
    );
    expect(side).toMatch(
      /\.workbench--side-expand-motion \.main\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden/s,
    );
    expect(side).not.toMatch(
      /\.workbench--side-expanded\.workbench--side-expand-motion \.main\s*\{[^}]*visibility:\s*visible/s,
    );
  });

  it("replays a window resize clamp after pane motion settles", () => {
    const layoutHook = readFileSync(
      resolve(__dirname, "../hooks/useWorkbenchLayout.ts"),
      "utf8",
    );
    expect(layoutHook).toMatch(
      /const applyResizeClamp = \(\) => \{[\s\S]*?runAfterPaneSplitMotion\(applyResizeClamp\)[\s\S]*?clampAsideWidth/,
    );
    expect(layoutHook).not.toMatch(
      /const onResize = \(\) => \{\s*if \(isWindowFitSuppressed\(\) \|\| isPaneSplitMotionActive\(\)\) return;/,
    );
  });

  it("keeps a tight-window aside overlay from hiding the chat column", () => {
    const app = readFileSync(
      resolve(__dirname, "../app/AppWorkbench.tsx"),
      "utf8",
    );
    const main = readFileSync(
      resolve(__dirname, "../app/WorkbenchMain.tsx"),
      "utf8",
    );
    const resources = readFileSync(
      resolve(__dirname, "../app/WorkbenchResourcesAside.tsx"),
      "utf8",
    );
    const aside = readFileSync(
      resolve(__dirname, "../styles/chat.part6.css"),
      "utf8",
    );
    const chat = readFileSync(
      resolve(__dirname, "../styles/chat.part1.css"),
      "utf8",
    );

    expect(app).toMatch(
      /const sidePaneCoversMain =\s*hideChatForSideExpand;/,
    );
    expect(app).not.toMatch(
      /sidePaneCoversMain =\s*hideChatForSideExpand \|\|/,
    );
    expect(app).toContain(
      'sidePaneCoversMain ? " workbench--side-expanded" : ""',
    );
    expect(app).toMatch(
      /!phoneLayout && sidebarOverlay && !layout\.sidebarCollapsed \? \(\s*<button[\s\S]*?className="workbench-pane-scrim"/,
    );
    expect(app).toContain("sidePaneCoversMain={sidePaneCoversMain}");
    expect(app).toMatch(
      /\[("--sw-aside-occupied")\]:[\s\S]*?!phoneLayout &&[\s\S]*?asideOverlay &&[\s\S]*?!layout\.asideCollapsed &&[\s\S]*?!sidePaneCoversMain/,
    );
    expect(main).toContain("inert={sidePaneCoversMain ? true : undefined}");
    expect(resources).toContain(
      'sidePaneCoversMain ? " aside--side-expanded" : ""',
    );
    expect(resources).not.toContain(
      "phoneLayout || (asideOverlay && !layout.asideCollapsed)",
    );
    expect(aside).toMatch(
      /\.aside\.aside--overlay\s*\{[^}]*top:\s*0;/s,
    );
    const composerFloor = String(MAIN_CHAT_MIN_WIDTH);
    expect(chat).toMatch(
      new RegExp(
        String.raw`\.composer-wrap--float\s*\{[^}]*right:\s*min\(\s*var\(--sw-aside-occupied, 0px\),\s*max\(0px, calc\(100% - ${composerFloor}px\)\)`,
        "s",
      ),
    );
    expect(chat).toMatch(
      new RegExp(
        String.raw`\.composer-wrap--welcome\s*\{[^}]*right:\s*min\(\s*var\(--sw-aside-occupied, 0px\),\s*max\(0px, calc\(100% - ${composerFloor}px\)\)`,
        "s",
      ),
    );
  });

  it("mac sidebar seam is not a 1px layout border on vibrancy", () => {
    const sidebar = readFileSync(
      resolve(__dirname, "../styles/sidebar.part1.css"),
      "utf8",
    );
    const tokens = readFileSync(
      resolve(__dirname, "../styles/tokens.css"),
      "utf8",
    );
    expect(sidebar).toMatch(
      /\.platform-mac \.sidebar\s*\{[^}]*border-right:\s*none/,
    );
    expect(sidebar).toMatch(
      /\.platform-mac \.main[^{]*\{[^}]*box-shadow:\s*var\(--sidebar-seam\)/,
    );
    expect(tokens).toMatch(/--sidebar-edge-shadow:\s*none/);
    expect(tokens).not.toMatch(
      /--sidebar-edge-shadow:[^;]*1px 0 0 var\(--bg-main\)/,
    );
  });

  it("does not toggle size transitions on the blur-owning in-flow sidebar", () => {
    /**
     * WKWebView rebuilds the backdrop-filter layer when `transition` is
     * added or removed on `.sidebar`. Size interpolation must live on
     * `.sidebar` itself; drag still uses `.is-resizing`.
     */
    const sidebar = readFileSync(
      resolve(__dirname, "../styles/sidebar.part1.css"),
      "utf8",
    );
    const body = ruleBody(sidebar, "\n.sidebar {");
    expect(body).toMatch(/width var\(--motion-pane\)/);
    expect(body).toMatch(/min-width var\(--motion-pane\)/);
    expect(body).toMatch(/max-width var\(--motion-pane\)/);
    expect(body).toMatch(/flex-basis var\(--motion-pane\)/);
    expect(sidebar).not.toMatch(
      /^\s*\.workbench--sidebar-motion[^\n{]*\.sidebar/m,
    );
  });

  it("does not put backdrop-filter on the interpolating in-flow sidebar", () => {
    /**
     * ChatGPT-desktop model: window vibrancy + tint. CSS blur must not sit
     * on a box whose width interpolates (WKWebView seam flash). Overlay /
     * phone still frost because they animate transform.
     */
    const sidebar = readFileSync(
      resolve(__dirname, "../styles/sidebar.part1.css"),
      "utf8",
    );
    const inFlow = ruleBody(
      sidebar,
      ".platform-mac .sidebar:not(.sidebar--overlay):not(.sidebar--phone-drawer) {",
    );
    expect(inFlow).toMatch(/backdrop-filter:\s*none/);
    expect(inFlow).toMatch(/background:\s*var\(--bg-sidebar\)/);
    expect(sidebar).not.toMatch(
      /\.platform-mac \.sidebar:not\(\.sidebar--overlay\):not\(\.sidebar--phone-drawer\)::before/,
    );
    expect(sidebar).toMatch(
      /\.platform-mac \.sidebar\.sidebar--overlay,\s*\.platform-mac \.sidebar\.sidebar--phone-drawer\s*\{[^}]*backdrop-filter:\s*blur\(var\(--sidebar-blur\)\)/s,
    );
  });

  it("clips the sidebar contents without changing the blur-owning pane", () => {
    const sidebar = readFileSync(
      resolve(__dirname, "../styles/sidebar.part1.css"),
      "utf8",
    );
    const css = readFileSync(
      resolve(__dirname, "../styles/chat.part6.css"),
      "utf8",
    );
    expect(css).not.toMatch(
      /\.workbench--pane-motion \.aside,\s*\.workbench--pane-motion \.sidebar/,
    );
    expect(css).not.toMatch(
      /\.workbench--pane-motion \.sidebar\s*\{[^}]*overflow:\s*hidden/s,
    );
    expect(ruleBody(sidebar, "\n.sidebar--hidden,")).toMatch(
      /overflow:\s*hidden/,
    );
    expect(ruleBody(sidebar, "\n.sidebar__clip {")).toMatch(
      /overflow:\s*hidden/,
    );
    expect(css).not.toMatch(/\.workbench--sidebar-motion[^,{]*\.sidebar__clip/);
    expect(css).not.toMatch(/\.workbench--sidebar-motion[^{]*\{[^}]*contain:/);
  });

  it("mounts one fixed desktop toggle per side without sliding-pane duplicates", () => {
    const app = readFileSync(
      resolve(__dirname, "../app/AppWorkbench.tsx"),
      "utf8",
    );
    const sidebar = readFileSync(
      resolve(__dirname, "../app/WorkbenchSidebar.tsx"),
      "utf8",
    );
    const main = readFileSync(
      resolve(__dirname, "../app/WorkbenchMain.tsx"),
      "utf8",
    );
    const resources = readFileSync(
      resolve(__dirname, "../app/WorkbenchResourcesAside.tsx"),
      "utf8",
    );
    const sideTabBar = readFileSync(
      resolve(__dirname, "../components/side-workbench/SideTabBar.tsx"),
      "utf8",
    );

    expect(app).not.toContain("<PaneToggleButton");
    expect(app).toContain(
      "sidebarToggleUnread={unreadSessionIds.size > 0}",
    );
    expect(sidebar).not.toContain("pane-toggle--pinned");
    expect(sidebar).toContain("<PaneToggleButton");
    expect(sidebar).toContain('pinned={false}');
    expect(main).not.toContain('testId="main-side-toggle"');
    expect(main.match(/<PaneToggleButton/g) ?? []).toHaveLength(2);
    expect(main).toMatch(
      /<PaneToggleButton\s+side="left"[\s\S]*layout\.sidebarCollapsed/,
    );
    expect(main).not.toMatch(
      /layout\.asideCollapsed\s*\?\s*\(\s*<Tip label=\{tr\("main\.rightPane/s,
    );
    expect(resources.match(/<PaneToggleButton/g) ?? []).toHaveLength(1);
    expect(resources).toMatch(/<PaneToggleButton\s+side="right"/);
    expect(resources).toContain('testId="main-side-toggle"');
    expect(resources).toContain('id="workbench-aside"');
    expect(resources).toContain("closeToggleInBar={phoneLayout}");
    expect(sideTabBar).toContain("expanded || closeToggleInBar");
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

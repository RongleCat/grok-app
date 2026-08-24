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

  it("retargets when collapse-all leaves the L1 projects box taller than remaining rows", () => {
    expect(
      shouldReleaseTreeRevealLock({
        open: true,
        animatingOpen: false,
        contentPx: 64,
        boxPx: 480,
      }),
    ).toBe(true);
  });

  it("does not collapse an open box on a 0px measure glitch", () => {
    expect(
      shouldReleaseTreeRevealLock({
        open: true,
        animatingOpen: false,
        contentPx: 0,
        boxPx: 480,
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
      resolve(__dirname, "../app/WorkbenchSessionTree.tsx"),
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

  it("uses the selected row surface for session actions without a solid fade", () => {
    const actions = css.match(/\.tree-l3__actions\s*\{[^}]*\}/s)?.[0];
    const sessionName = readFileSync(
      resolve(__dirname, "../components/SidebarSessionName.tsx"),
      "utf8",
    );
    expect(actions).toBeTruthy();
    expect(actions).not.toMatch(/(?:background|mask-image|--bg-sidebar-solid)/);
    expect(css).not.toContain(".tree-l3__actions::before");
    expect(css).toMatch(
      /\.tree-l3:hover:has\(\.tree-l3__actions\):not\(\.tree-l3--renaming\)[\s\S]*padding-right:\s*80px/,
    );
    expect(sessionName).not.toContain("HOVER_ACTIONS_RESERVE_PX");
    expect(sessionName).not.toMatch(/outer\.clientWidth\s*-/);
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
  const part1b = readFileSync(
    resolve(__dirname, "../styles/sidebar.part1b.css"),
    "utf8",
  );
  const part2 = readFileSync(
    resolve(__dirname, "../styles/sidebar.part2.css"),
    "utf8",
  );

  it("keeps open project folders from shrinking below their session list", () => {
    expect(part1b).toMatch(/\.tree-project\s*\{[^}]*flex-shrink:\s*0/);
    expect(part2).toMatch(/\.tree-orphan\s*\{[^}]*flex-shrink:\s*0/);
  });
});

describe("Other sessions tree wrap", () => {
  const src = readFileSync(
    resolve(__dirname, "../app/WorkbenchSessionTree.tsx"),
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

describe("sidebar tree text columns", () => {
  const tokens = readFileSync(
    resolve(__dirname, "../styles/tokens.css"),
    "utf8",
  );
  const part1 = readFileSync(
    resolve(__dirname, "../styles/sidebar.part1.css"),
    "utf8",
  );
  const part1b = readFileSync(
    resolve(__dirname, "../styles/sidebar.part1b.css"),
    "utf8",
  );
  const part2 = readFileSync(
    resolve(__dirname, "../styles/sidebar.part2.css"),
    "utf8",
  );
  const part4 = readFileSync(
    resolve(__dirname, "../styles/sidebar.part4.css"),
    "utf8",
  );
  const src = readFileSync(
    resolve(__dirname, "../app/WorkbenchSessionTree.tsx"),
    "utf8",
  );

  it("assigns tree insets once in tokens.css", () => {
    expect(tokens).toMatch(/--tree-rail-pad:\s*10px/);
    expect(tokens).toMatch(/--tree-l1-gutter:\s*var\(--space-5\)/);
    expect(tokens).toMatch(/--tree-text-inset:\s*calc\(/);
    expect(part1).not.toMatch(/--tree-l1-gutter:/);
    expect(part1).not.toMatch(/--tree-text-inset:/);
  });

  it("consumes tree tokens without px fallbacks", () => {
    expect(part1b).toMatch(
      /\.tree-l1__head--toggle,\s*\.tree-l1__chevron\s*\{[^}]*var\(--tree-l1-gutter\)/,
    );
    expect(part1b).toMatch(/\.tree-l2\s*\{[^}]*var\(--tree-l2-pad\)/);
    expect(part2).toMatch(/\.tree-l3\s*\{[^}]*var\(--tree-text-inset\)/);
    expect(part4).toMatch(/\.nav-item__icon\s*\{[^}]*var\(--tree-l1-gutter\)/);
    expect(`${part1}\n${part1b}\n${part2}\n${part4}`).not.toMatch(
      /var\(--tree-[a-z0-9-]+,\s*[^)]+\)/,
    );
  });

  it("wraps the Other chevron in the shared L1 gutter", () => {
    expect(src).toMatch(/className="tree-l1__chevron"/);
  });
});

describe("sidebar projects L1 chrome", () => {
  const part1 =
    readFileSync(resolve(__dirname, "../styles/sidebar.part1.css"), "utf8") +
    readFileSync(resolve(__dirname, "../styles/sidebar.part1b.css"), "utf8");
  const switcher = readFileSync(
    resolve(__dirname, "../components/SpaceSwitcher.tsx"),
    "utf8",
  );
  const workbench = readFileSync(
    resolve(__dirname, "../app/WorkbenchSessionTree.tsx"),
    "utf8",
  );
  let moreMenu = "";
  try {
    moreMenu = readFileSync(
      resolve(__dirname, "../components/SidebarProjectsMoreMenu.tsx"),
      "utf8",
    );
  } catch {
    moreMenu = "";
  }
  const l1 = workbench.slice(
    workbench.indexOf("{/* L1 — Projects section */}"),
    workbench.indexOf("<SidebarTreeReveal open={projectsOpen}"),
  );

  it("keeps chevron + space name on the L1 head that expands the project list", () => {
    expect(l1).toMatch(/tree-l1__head/);
    expect(l1).toMatch(/setProjectsOpen/);
    expect(l1).toMatch(/tree-l1__label/);
    expect(l1).toMatch(/activeSpaceLabel/);
  });

  it("uses an icon-only space switcher, not a name+chevron trigger", () => {
    expect(switcher).toMatch(/IconSwitch\b/);
    expect(switcher).not.toMatch(/IconChevronDown/);
    expect(switcher).not.toMatch(/space-switcher__label/);
  });

  it("keeps collapse-all as an outer L1 action", () => {
    expect(l1).toMatch(/sidebar.collapseAllProjects/);
    expect(l1).toMatch(/IconArrowsVerticalCollapse/);
  });

  it("moves select, archive, and add into a more menu", () => {
    expect(l1).toMatch(/SidebarProjectsMoreMenu/);
    expect(l1).toMatch(/sidebar.more/);
    expect(l1).not.toMatch(/<IconListCheck/);
    expect(l1).not.toMatch(/<IconArchive/);
    expect(l1).not.toMatch(/<IconPlus/);
    expect(moreMenu).toMatch(/IconMore/);
    expect(moreMenu).toMatch(/menu-panel context-menu/);
  });

  it("sizes the space-switcher trigger as an icon button", () => {
    const block = part1.match(/\.space-switcher__btn\s*\{([^}]+)\}/)?.[1] ?? "";
    expect(block).toMatch(/width:\s*28px/);
    expect(block).toMatch(/height:\s*28px/);
    expect(block).not.toMatch(/padding:\s*0 6px 0 8px/);
  });

  it("shows the space switcher only with the other hover L1 actions", () => {
    const actions = l1.slice(l1.indexOf("tree-l1__actions"));
    expect(actions).toMatch(/<SpaceSwitcher/);
    expect(l1.slice(0, l1.indexOf("tree-l1__actions"))).not.toMatch(
      /<SpaceSwitcher/,
    );
    expect(part1).toMatch(
      /\.tree-l1:has\(\.space-switcher\.is-open\) \.tree-l1__actions/,
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  emptySideWorkbenchState,
  isPickerCreatableKind,
  openSideTab,
  openSideTabFromPicker,
  closeSideTab,
  closeActiveSideTab,
  closeOtherSideTabs,
  closeAllSideTabs,
  closeSideTabsToLeft,
  closeSideTabsToRight,
  isCloseSideTabChord,
  isSideTabMiddleClick,
  resolveSideStripCloseTarget,
  applySideStripClose,
  planBulkClose,
  sideTabCloseNeedsConfirm,
  setActiveSideTab,
  sidePickerOptions,
  SIDE_PICKER_EXCLUDED,
  SIDE_TAB_DEFAULT_NAME_KEYS,
  toggleSideExpanded,
  activeSideTab,
  envReviewJumpEnabled,
  isSideTabNameKey,
  resolveSideTabLabel,
  sideTabLabel,
  sideTabCopyPath,
  joinProjectPath,
  isFsAbsolutePath,
  sideTabNeighborFlags,
} from "./sideWorkbench";

describe("sidePickerOptions", () => {
  it("excludes plan and side-chat always", () => {
    const withGit = sidePickerOptions({ isGitProject: true });
    const kinds = withGit.map((o) => o.kind);
    expect(kinds).toEqual([
      "file",
      "browser",
      "terminal",
      "skills",
      "review",
    ]);
    expect(kinds).not.toContain("plan");
    expect(SIDE_PICKER_EXCLUDED).toContain("plan");
  });

  it("hides review when not a git project", () => {
    const opts = sidePickerOptions({ isGitProject: false });
    expect(opts.map((o) => o.kind)).toEqual([
      "file",
      "browser",
      "terminal",
      "skills",
    ]);
    expect(isPickerCreatableKind("review", { isGitProject: false })).toBe(
      false,
    );
    expect(isPickerCreatableKind("review", { isGitProject: true })).toBe(true);
    expect(isPickerCreatableKind("skills", { isGitProject: false })).toBe(
      true,
    );
    expect(isPickerCreatableKind("plan", { isGitProject: true })).toBe(false);
  });
});

describe("openSideTab / close / activate", () => {
  it("picker Files reveals the project tree", () => {
    let s = emptySideWorkbenchState();
    s = { ...s, treeVisible: false };
    const next = openSideTabFromPicker(s, "file", { isGitProject: false });
    expect("created" in next && next.created).toBe(true);
    expect("treeVisible" in next && next.treeVisible).toBe(true);
    const again = openSideTabFromPicker(
      { ...next, treeVisible: false },
      "file",
      { isGitProject: false },
    );
    expect("created" in again && again.created).toBe(false);
    expect("treeVisible" in again && again.treeVisible).toBe(true);
  });

  it("creates file/browser/terminal/review tabs", () => {
    let s = emptySideWorkbenchState();
    const f = openSideTab(s, "file", { path: "/a/b.ts", name: "b.ts" });
    expect(f.created).toBe(true);
    expect(f.tabs).toHaveLength(1);
    expect(f.tabs[0]!.kind).toBe("file");
    s = f;

    const b = openSideTab(s, "browser", { url: "https://x.com" });
    expect(b.created).toBe(true);
    expect(b.tabs[0]!.kind).toBe("browser");
    s = b;

    const t = openSideTab(s, "terminal");
    expect(t.created).toBe(true);
    expect(t.tabs.filter((x) => x.kind === "terminal")).toHaveLength(1);
    s = t;

    const r = openSideTab(s, "review");
    expect(r.created).toBe(true);
    expect(r.tabs.some((x) => x.kind === "review")).toBe(true);

    s = r;
    const sk = openSideTab(s, "skills");
    expect(sk.created).toBe(true);
    expect(sk.tabs.some((x) => x.kind === "skills")).toBe(true);
    const sk2 = openSideTab(sk, "skills");
    expect(sk2.created).toBe(false);
    expect(sk2.tabs.filter((x) => x.kind === "skills")).toHaveLength(1);
  });

  it("dedupes file by path and review to single instance", () => {
    let s = emptySideWorkbenchState();
    s = openSideTab(s, "file", { path: "/p/a.ts" });
    const again = openSideTab(s, "file", { path: "/p/a.ts" });
    expect(again.created).toBe(false);
    expect(again.tabs.filter((t) => t.kind === "file")).toHaveLength(1);

    s = openSideTab(again, "review");
    const r2 = openSideTab(s, "review");
    expect(r2.created).toBe(false);
    expect(r2.tabs.filter((t) => t.kind === "review")).toHaveLength(1);
  });

  it("stores and refreshes path:line on file tabs", () => {
    let s = emptySideWorkbenchState();
    s = openSideTab(s, "file", { path: "/p/a.ts", line: 10, column: 2 });
    const first = s.tabs[0];
    expect(first?.kind).toBe("file");
    if (first?.kind === "file") {
      expect(first.line).toBe(10);
      expect(first.column).toBe(2);
    }
    const again = openSideTab(s, "file", { path: "/p/a.ts", line: 99 });
    expect(again.created).toBe(false);
    const tab = again.tabs[0];
    expect(tab?.kind).toBe("file");
    if (tab?.kind === "file") {
      expect(tab.line).toBe(99);
      expect(tab.column).toBeNull();
    }
  });

  it("allows multiple terminals (never reuses another terminal tab)", () => {
    let s = emptySideWorkbenchState();
    const a = openSideTab(s, "terminal");
    expect(a.created).toBe(true);
    const b = openSideTab(a, "terminal");
    expect(b.created).toBe(true);
    expect(b.tabs.filter((t) => t.kind === "terminal")).toHaveLength(2);
    expect(b.tabs[0]!.id).not.toBe(a.tabs[0]!.id);
    // Explicit id still focuses existing (rare programmatic path).
    const again = openSideTab(b, "terminal", { id: a.tabs[0]!.id });
    expect(again.created).toBe(false);
    expect(again.activeId).toBe(a.tabs[0]!.id);
  });

  it("process can create plan tab but picker cannot", () => {
    let s = emptySideWorkbenchState();
    const fromPicker = openSideTabFromPicker(s, "plan", {
      isGitProject: true,
    });
    expect("created" in fromPicker ? fromPicker.created : false).toBeFalsy();
    expect(
      "tabs" in fromPicker ? fromPicker.tabs.length : s.tabs.length,
    ).toBe(0);

    const plan = openSideTab(s, "plan", { planRef: "p1" });
    expect(plan.created).toBe(true);
    expect(plan.tabs[0]!.kind).toBe("plan");
  });

  it("closes and activates", () => {
    let s = emptySideWorkbenchState();
    s = openSideTab(s, "file", { path: "/a" });
    s = openSideTab(s, "browser", { url: "https://a" });
    const id = s.tabs[1]!.id;
    s = setActiveSideTab(s, id);
    expect(s.activeId).toBe(id);
    s = closeSideTab(s, id);
    expect(s.tabs).toHaveLength(1);
    expect(activeSideTab(s)?.kind).toBe("browser");
  });

  it("closeActiveSideTab closes the focused tab", () => {
    let s = emptySideWorkbenchState();
    s = openSideTab(s, "file", { path: "/a", id: "a" });
    s = openSideTab(s, "browser", { url: "https://b", id: "b" });
    // open prepends → [b, a], active b
    expect(s.activeId).toBe("b");
    s = closeActiveSideTab(s);
    expect(s.tabs.map((t) => t.id)).toEqual(["a"]);
    expect(s.activeId).toBe("a");
    s = closeActiveSideTab(s);
    expect(s.tabs).toEqual([]);
    expect(s.activeId).toBeNull();
    // empty strip is a no-op
    expect(closeActiveSideTab(s)).toEqual(s);
  });

  it("isCloseSideTabChord matches mod+w without alt/shift", () => {
    expect(
      isCloseSideTabChord({
        key: "w",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe(true);
    expect(
      isCloseSideTabChord({
        key: "W",
        metaKey: false,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe(true);
    expect(
      isCloseSideTabChord({
        key: "w",
        metaKey: true,
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
      }),
    ).toBe(false);
    expect(
      isCloseSideTabChord({
        key: "w",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
      }),
    ).toBe(false);
    expect(
      isCloseSideTabChord({
        key: "w",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe(false);
  });

  it("isSideTabMiddleClick is button 1 only", () => {
    expect(isSideTabMiddleClick({ button: 1 })).toBe(true);
    expect(isSideTabMiddleClick({ button: 0 })).toBe(false);
    expect(isSideTabMiddleClick({ button: 2 })).toBe(false);
  });

  it("toggles expanded", () => {
    const s = emptySideWorkbenchState();
    expect(s.expanded).toBe(false);
    expect(toggleSideExpanded(s).expanded).toBe(true);
  });

  it("default tab names are i18n keys, not English prose", () => {
    const s = openSideTab(emptySideWorkbenchState(), "terminal");
    const tab = s.tabs[0]!;
    expect(tab.name).toBe(SIDE_TAB_DEFAULT_NAME_KEYS.terminal);
    expect(isSideTabNameKey(tab.name)).toBe(true);
    expect(sideTabLabel(tab)).toBe("side.tab.terminal");
    const zh = resolveSideTabLabel(tab, (k) =>
      k === "side.tab.terminal" ? "终端" : k,
    );
    expect(zh).toBe("终端");
    // Custom path/title stays plain
    const f = openSideTab(emptySideWorkbenchState(), "file", {
      path: "/a/b.ts",
    });
    expect(f.tabs[0]!.name).toBe("b.ts");
    expect(isSideTabNameKey(f.tabs[0]!.name)).toBe(false);
  });
});

describe("envReviewJumpEnabled", () => {
  it("is git-only (non-git never jumps to review)", () => {
    expect(envReviewJumpEnabled(false)).toBe(false);
    expect(envReviewJumpEnabled(true)).toBe(true);
  });
});

describe("tab close batch helpers", () => {
  function threeTabs() {
    let s = emptySideWorkbenchState();
    s = openSideTab(s, "file", { path: "/a.ts", id: "t-a" });
    s = openSideTab(s, "file", { path: "/b.ts", id: "t-b" });
    s = openSideTab(s, "file", { path: "/c.ts", id: "t-c" });
    // open prepends → order is c, b, a (left → right)
    return s;
  }

  it("closeOtherSideTabs keeps only the target", () => {
    const s = threeTabs();
    const mid = s.tabs[1]!.id;
    const next = closeOtherSideTabs(s, mid);
    expect(next.tabs.map((t) => t.id)).toEqual([mid]);
    expect(next.activeId).toBe(mid);
  });

  it("closeAllSideTabs clears the strip", () => {
    const next = closeAllSideTabs(threeTabs());
    expect(next.tabs).toEqual([]);
    expect(next.activeId).toBeNull();
  });

  it("closeSideTabsToLeft / ToRight use strip order", () => {
    const s = threeTabs();
    // [c, b, a]
    const b = s.tabs[1]!.id;
    const left = closeSideTabsToLeft(s, b);
    expect(left.tabs.map((t) => t.id)).toEqual([b, s.tabs[2]!.id]);
    const right = closeSideTabsToRight(s, b);
    expect(right.tabs.map((t) => t.id)).toEqual([s.tabs[0]!.id, b]);
  });

  it("planBulkClose reports dirty tabs that would close", () => {
    const s = threeTabs();
    const mid = s.tabs[1]!.id;
    const dirty = [s.tabs[0]!.id, mid];
    const others = planBulkClose(s, "others", mid, dirty);
    expect(others.next.tabs.map((t) => t.id)).toEqual([mid]);
    expect(others.dirtyClosing.map((t) => t.id)).toEqual([s.tabs[0]!.id]);
    const all = planBulkClose(s, "all", mid, dirty);
    expect(all.next.tabs).toEqual([]);
    expect(all.dirtyClosing.map((t) => t.id).sort()).toEqual(
      [...dirty].sort(),
    );
    const clean = planBulkClose(s, "left", mid, []);
    expect(clean.dirtyClosing).toEqual([]);
  });

  it("sideTabCopyPath is file absolute only + neighbor flags", () => {
    const s = threeTabs();
    // threeTabs used absolute-looking paths starting with /
    const file = s.tabs[0]!;
    expect(sideTabCopyPath(file)).toBe("/c.ts");
    // relative path needs project root → absolute
    const rel = openSideTab(emptySideWorkbenchState(), "file", {
      path: "src/app.ts",
      name: "app.ts",
    }).tabs[0]!;
    expect(sideTabCopyPath(rel)).toBeNull();
    expect(sideTabCopyPath(rel, "/Users/me/proj")).toBe(
      "/Users/me/proj/src/app.ts",
    );
    // never use basename alone
    expect(sideTabCopyPath({ id: "x", kind: "file", name: "app.ts" })).toBeNull();
    // browser / terminal: no copy-path item
    const term = openSideTab(emptySideWorkbenchState(), "terminal").tabs[0]!;
    expect(sideTabCopyPath(term)).toBeNull();
    const br = openSideTab(emptySideWorkbenchState(), "browser", {
      url: "https://x.com",
    }).tabs[0]!;
    expect(sideTabCopyPath(br)).toBeNull();
    expect(isFsAbsolutePath("/a/b")).toBe(true);
    expect(isFsAbsolutePath("src/a.ts")).toBe(false);
    expect(joinProjectPath("C:\\proj", "src\\a.ts")).toBe("C:\\proj\\src\\a.ts");
    const flags = sideTabNeighborFlags(s.tabs, s.tabs[1]!.id);
    expect(flags).toEqual({ hasLeft: true, hasRight: true, hasOthers: true });
    expect(sideTabNeighborFlags(s.tabs, s.tabs[0]!.id).hasLeft).toBe(false);
  });
});

describe("resolveSideStripCloseTarget / applySideStripClose (what closes next)", () => {
  function stripWithActive(): ReturnType<typeof emptySideWorkbenchState> {
    let s = emptySideWorkbenchState();
    s = openSideTab(s, "file", { path: "/a.ts", id: "a" });
    s = openSideTab(s, "browser", { url: "https://b", id: "b" });
    // [b, a], active b
    return s;
  }

  it("prefers active side tab when strip non-empty and aside open", () => {
    const s = stripWithActive();
    expect(resolveSideStripCloseTarget(s)).toEqual({
      kind: "side-tab",
      tabId: "b",
    });
    expect(resolveSideStripCloseTarget(s, { asideCollapsed: false })).toEqual({
      kind: "side-tab",
      tabId: "b",
    });
  });

  it("falls through to window when strip is empty", () => {
    expect(resolveSideStripCloseTarget(emptySideWorkbenchState())).toEqual({
      kind: "window",
    });
  });

  it("falls through to window when aside is collapsed (leftover tabs)", () => {
    const s = stripWithActive();
    expect(
      resolveSideStripCloseTarget(s, { asideCollapsed: true }),
    ).toEqual({ kind: "window" });
  });

  it("uses first tab when activeId is missing or stale", () => {
    let s = stripWithActive();
    s = { ...s, activeId: null };
    expect(resolveSideStripCloseTarget(s)).toEqual({
      kind: "side-tab",
      tabId: "b",
    });
    s = { ...s, activeId: "gone" };
    expect(resolveSideStripCloseTarget(s)).toEqual({
      kind: "side-tab",
      tabId: "b",
    });
  });

  it("applySideStripClose closes active tab then window on empty", () => {
    let s = stripWithActive();
    let r = applySideStripClose(s);
    expect(r.closeWindow).toBe(false);
    expect(r.needsConfirm).toBe(false);
    expect(r.closedTabId).toBe("b");
    expect(r.state.tabs.map((t) => t.id)).toEqual(["a"]);
    s = r.state;
    r = applySideStripClose(s);
    expect(r.closeWindow).toBe(false);
    expect(r.closedTabId).toBe("a");
    expect(r.state.tabs).toEqual([]);
    r = applySideStripClose(r.state);
    expect(r.closeWindow).toBe(true);
    expect(r.closedTabId).toBeNull();
    expect(r.state.tabs).toEqual([]);
  });

  it("applySideStripClose does not mutate when aside collapsed", () => {
    const s = stripWithActive();
    const r = applySideStripClose(s, { asideCollapsed: true });
    expect(r.closeWindow).toBe(true);
    expect(r.state).toBe(s);
  });

  it("dirty target needs confirm and leaves state unchanged", () => {
    const s = stripWithActive();
    expect(sideTabCloseNeedsConfirm("b", { dirtyTabIds: ["b"] })).toBe(true);
    expect(sideTabCloseNeedsConfirm("a", { dirtyTabIds: new Set(["b"]) })).toBe(
      false,
    );
    const r = applySideStripClose(s, { dirtyTabIds: ["b"] });
    expect(r.needsConfirm).toBe(true);
    expect(r.closeWindow).toBe(false);
    expect(r.closedTabId).toBe("b");
    expect(r.state).toBe(s);
    // After forced close (caller discarded), next close proceeds
    const forced = closeSideTab(s, "b");
    const next = applySideStripClose(forced, { dirtyTabIds: ["b"] });
    expect(next.needsConfirm).toBe(false);
    expect(next.closedTabId).toBe("a");
  });
});

import { describe, expect, it } from "vitest";
import {
  emptySideWorkbenchState,
  isPickerCreatableKind,
  openSideTab,
  openSideTabFromPicker,
  closeSideTab,
  closeOtherSideTabs,
  closeAllSideTabs,
  closeSideTabsToLeft,
  closeSideTabsToRight,
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

  it("allows multiple terminals", () => {
    let s = emptySideWorkbenchState();
    s = openSideTab(s, "terminal");
    s = openSideTab(s, "terminal");
    expect(s.tabs.filter((t) => t.kind === "terminal")).toHaveLength(2);
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

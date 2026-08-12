import { describe, expect, it } from "vitest";
import {
  RESOURCE_TABS_MAX,
  closeActiveResourceTab,
  closeResourceTab,
  markTabDirty,
  normalizeResourceTabPath,
  openResourceTab,
  pickResourceTabLruDropIndex,
  resolveFilesWorkbenchSplitLayout,
  resolveResourceTabsCapSoftFail,
  resolveResourceTabsEmptyState,
  resourceTabPathsEqual,
  setActiveTab,
  shouldConfirmCloseResourceTab,
  type ResourceTab,
} from "./resourceTabs";

function tab(
  partial: Partial<ResourceTab> & Pick<ResourceTab, "id" | "path">,
): ResourceTab {
  return {
    name: partial.name ?? partial.path.split("/").pop() ?? partial.path,
    dirty: partial.dirty ?? false,
    kind: partial.kind,
    id: partial.id,
    path: partial.path,
  };
}

describe("normalizeResourceTabPath / resourceTabPathsEqual", () => {
  it("normalizes file separators and trailing slashes", () => {
    expect(normalizeResourceTabPath("src\\\\lib\\\\a.ts")).toBe("src/lib/a.ts");
    expect(normalizeResourceTabPath("/tmp/foo/")).toBe("/tmp/foo");
    expect(normalizeResourceTabPath("  /a/b  ")).toBe("/a/b");
  });

  it("preserves URL scheme double-slash", () => {
    expect(normalizeResourceTabPath("https://example.com/x")).toBe(
      "https://example.com/x",
    );
    expect(normalizeResourceTabPath("http://localhost:3000/")).toBe(
      "http://localhost:3000",
    );
  });

  it("equates paths only after normalize", () => {
    expect(resourceTabPathsEqual("a/b", "a\\\\b")).toBe(true);
    expect(resourceTabPathsEqual("a/b", "a/c")).toBe(false);
    expect(resourceTabPathsEqual("", "a")).toBe(false);
  });
});

describe("openResourceTab", () => {
  it("creates a tab and activates it", () => {
    const r = openResourceTab([], "src/App.tsx", { name: "App.tsx", kind: "code" });
    expect(r.created).toBe(true);
    expect(r.droppedIds).toEqual([]);
    expect(r.tabs).toHaveLength(1);
    expect(r.activeId).toBe(r.tabs[0]!.id);
    expect(r.tabs[0]!.path).toBe("src/App.tsx");
    expect(r.tabs[0]!.name).toBe("App.tsx");
    expect(r.tabs[0]!.kind).toBe("code");
    expect(r.tabs[0]!.dirty).toBe(false);
  });

  it("dedupes by path and moves existing to front (MRU)", () => {
    const a = tab({ id: "1", path: "a.ts" });
    const b = tab({ id: "2", path: "b.ts" });
    const r = openResourceTab([a, b], "b.ts");
    expect(r.created).toBe(false);
    expect(r.activeId).toBe("2");
    expect(r.tabs.map((t) => t.id)).toEqual(["2", "1"]);
  });

  it("dedupes by normalized path", () => {
    const a = tab({ id: "1", path: "src/x.ts" });
    const r = openResourceTab([a], "src\\\\x.ts", { name: "x.ts" });
    expect(r.created).toBe(false);
    expect(r.activeId).toBe("1");
    expect(r.tabs).toHaveLength(1);
  });

  it("dedupes by meta.id when path keys differ", () => {
    const a = tab({ id: "keep", path: "/abs/foo.ts" });
    const r = openResourceTab([a], "foo.ts", { id: "keep", name: "foo.ts" });
    expect(r.created).toBe(false);
    expect(r.activeId).toBe("keep");
    expect(r.tabs[0]!.path).toBe("foo.ts");
  });

  it("drops LRU tabs when over max", () => {
    // Build MRU order explicitly: index 0 = newest.
    const filled = Array.from({ length: RESOURCE_TABS_MAX }, (_, i) =>
      tab({ id: `id${i}`, path: `p${i}.ts` }),
    );
    const r = openResourceTab(filled, "new.ts", { name: "new.ts" }, RESOURCE_TABS_MAX);
    expect(r.created).toBe(true);
    expect(r.tabs).toHaveLength(RESOURCE_TABS_MAX);
    expect(r.tabs[0]!.path).toBe("new.ts");
    // Last (LRU) of previous list should be dropped.
    expect(r.droppedIds).toEqual([`id${RESOURCE_TABS_MAX - 1}`]);
    expect(r.droppedDirty).toBe(false);
    expect(r.tabs.some((t) => t.id === `id${RESOURCE_TABS_MAX - 1}`)).toBe(
      false,
    );
  });

  it("prefers dropping clean LRU over dirty when over max", () => {
    const tabs = [
      tab({ id: "newish", path: "n.ts" }),
      tab({ id: "dirty-old", path: "d.ts", dirty: true }),
      tab({ id: "clean-old", path: "c.ts", dirty: false }),
    ];
    const r = openResourceTab(tabs, "x.ts", { name: "x.ts" }, 3);
    expect(r.tabs).toHaveLength(3);
    expect(r.droppedIds).toEqual(["clean-old"]);
    expect(r.droppedDirty).toBe(false);
    expect(r.tabs.some((t) => t.id === "dirty-old")).toBe(true);
  });

  it("soft-fails dirty drop only when every LRU candidate is dirty", () => {
    const tabs = [
      tab({ id: "a", path: "a.ts", dirty: true }),
      tab({ id: "b", path: "b.ts", dirty: true }),
    ];
    const r = openResourceTab(tabs, "c.ts", undefined, 2);
    expect(r.tabs).toHaveLength(2);
    expect(r.droppedIds).toEqual(["b"]);
    expect(r.droppedDirty).toBe(true);
  });

  it("respects a custom max of 1", () => {
    const a = tab({ id: "a", path: "a.ts" });
    const r = openResourceTab([a], "b.ts", undefined, 1);
    expect(r.tabs).toHaveLength(1);
    expect(r.tabs[0]!.path).toBe("b.ts");
    expect(r.droppedIds).toEqual(["a"]);
  });

  it("no-ops empty path without inventing a tab", () => {
    const a = tab({ id: "a", path: "a.ts" });
    const r = openResourceTab([a], "   ");
    expect(r.created).toBe(false);
    expect(r.tabs).toEqual([a]);
    expect(r.droppedDirty).toBe(false);
  });
});

describe("closeResourceTab", () => {
  it("closes non-active and keeps active", () => {
    const tabs = [
      tab({ id: "a", path: "a.ts" }),
      tab({ id: "b", path: "b.ts" }),
    ];
    const r = closeResourceTab(tabs, "a", "b");
    expect(r.tabs.map((t) => t.id)).toEqual(["a"]);
    expect(r.activeId).toBe("a");
  });

  it("closes active and prefers left (newer) neighbor", () => {
    const tabs = [
      tab({ id: "a", path: "a.ts" }),
      tab({ id: "b", path: "b.ts" }),
      tab({ id: "c", path: "c.ts" }),
    ];
    const r = closeResourceTab(tabs, "b", "b");
    expect(r.tabs.map((t) => t.id)).toEqual(["a", "c"]);
    expect(r.activeId).toBe("a");
  });

  it("closes sole tab → empty", () => {
    const r = closeResourceTab([tab({ id: "a", path: "a.ts" })], "a", "a");
    expect(r.tabs).toEqual([]);
    expect(r.activeId).toBeNull();
  });

  it("unknown id is a no-op", () => {
    const tabs = [tab({ id: "a", path: "a.ts" })];
    const r = closeResourceTab(tabs, "a", "missing");
    expect(r.tabs).toEqual(tabs);
    expect(r.activeId).toBe("a");
  });
});

describe("setActiveTab", () => {
  it("activates an existing id", () => {
    const tabs = [
      tab({ id: "a", path: "a.ts" }),
      tab({ id: "b", path: "b.ts" }),
    ];
    expect(setActiveTab(tabs, "b")).toEqual({ tabs, activeId: "b" });
  });

  it("ignores unknown id without wiping tabs", () => {
    const tabs = [tab({ id: "a", path: "a.ts" })];
    const r = setActiveTab(tabs, "nope");
    expect(r.tabs).toEqual(tabs);
    expect(r.activeId).toBe("a");
  });
});

describe("markTabDirty", () => {
  it("sets and clears dirty on the target only", () => {
    const tabs = [
      tab({ id: "a", path: "a.ts", dirty: false }),
      tab({ id: "b", path: "b.ts", dirty: false }),
    ];
    const dirty = markTabDirty(tabs, "a", true);
    expect(dirty[0]!.dirty).toBe(true);
    expect(dirty[1]!.dirty).toBe(false);
    const clean = markTabDirty(dirty, "a", false);
    expect(clean[0]!.dirty).toBe(false);
  });
});

describe("resolveResourceTabsEmptyState", () => {
  it("returns presentation when no tabs", () => {
    const p = resolveResourceTabsEmptyState({ tabCount: 0 });
    expect(p).toEqual({
      kind: "no_tabs",
      titleKey: "resources.emptyPreview",
      hintKey: "resources.emptyPreviewHint",
    });
  });

  it("returns null when tabs are open", () => {
    expect(resolveResourceTabsEmptyState({ tabCount: 1 })).toBeNull();
    expect(resolveResourceTabsEmptyState({ tabCount: 3, sideMode: "files" })).toBeNull();
  });
});

describe("closeActiveResourceTab / dirty honesty helpers", () => {
  it("closes active and activates left neighbor", () => {
    const tabs = [
      tab({ id: "a", path: "a.ts" }),
      tab({ id: "b", path: "b.ts" }),
    ];
    expect(closeActiveResourceTab(tabs, "a")).toEqual({
      tabs: [tab({ id: "b", path: "b.ts" })],
      activeId: "b",
    });
  });

  it("no-ops empty strip", () => {
    expect(closeActiveResourceTab([], null)).toEqual({
      tabs: [],
      activeId: null,
    });
  });

  it("shouldConfirmCloseResourceTab only for dirty", () => {
    const tabs = [
      tab({ id: "a", path: "a.ts", dirty: true }),
      tab({ id: "b", path: "b.ts", dirty: false }),
    ];
    expect(shouldConfirmCloseResourceTab(tabs, "a")).toBe(true);
    expect(shouldConfirmCloseResourceTab(tabs, "b")).toBe(false);
    expect(shouldConfirmCloseResourceTab(tabs, "missing")).toBe(false);
  });

  it("pickResourceTabLruDropIndex prefers clean", () => {
    const tabs = [
      tab({ id: "keep", path: "k.ts" }),
      tab({ id: "d", path: "d.ts", dirty: true }),
      tab({ id: "c", path: "c.ts", dirty: false }),
    ];
    expect(pickResourceTabLruDropIndex(tabs, "keep")).toBe(2);
  });
});

describe("resolveResourceTabsCapSoftFail / split layout", () => {
  it("null when nothing dropped", () => {
    expect(resolveResourceTabsCapSoftFail({ droppedIds: [] })).toBeNull();
  });

  it("returns soft-fail presentation with dirty flag", () => {
    const p = resolveResourceTabsCapSoftFail({
      droppedIds: ["a", "b"],
      droppedDirty: true,
      max: 12,
    });
    expect(p).toEqual({
      kind: "cap",
      messageKey: "resources.tabsMaxSoftFail",
      dirtyMessageKey: "resources.tabsMaxSoftFailDirty",
      max: 12,
      droppedCount: 2,
      droppedDirty: true,
    });
  });

  it("split layout is simultaneous when tree visible", () => {
    expect(resolveFilesWorkbenchSplitLayout({ treeVisible: true })).toEqual({
      mode: "split",
      treeVisible: true,
    });
    expect(resolveFilesWorkbenchSplitLayout({ treeVisible: false })).toEqual({
      mode: "solo",
      treeVisible: false,
    });
  });
});

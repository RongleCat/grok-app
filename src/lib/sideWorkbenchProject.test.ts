import { describe, expect, it } from "vitest";
import { emptySideWorkbenchState, openSideTab } from "./sideWorkbench";
import {
  SIDE_WORKBENCH_ORPHAN_KEY,
  sideWorkbenchProjectKey,
  switchSideWorkbenchProject,
} from "./sideWorkbenchProject";

describe("sideWorkbenchProjectKey", () => {
  it("maps empty / null to the orphan bucket", () => {
    expect(sideWorkbenchProjectKey(null)).toBe(SIDE_WORKBENCH_ORPHAN_KEY);
    expect(sideWorkbenchProjectKey("")).toBe(SIDE_WORKBENCH_ORPHAN_KEY);
    expect(sideWorkbenchProjectKey("  ")).toBe(SIDE_WORKBENCH_ORPHAN_KEY);
    expect(sideWorkbenchProjectKey("proj-a")).toBe("proj-a");
  });
});

describe("switchSideWorkbenchProject", () => {
  it("hides project A file tabs in B and restores them on return", () => {
    let state = emptySideWorkbenchState();
    state = openSideTab(state, "file", {
      path: "/A/a.ts",
      name: "a.ts",
      id: "file-a",
    });
    state = { ...state, expanded: true, treeVisible: true };

    const first = switchSideWorkbenchProject(state, new Map(), "proj-a", "proj-b");
    expect(first.state.tabs).toEqual([]);
    expect(first.state.activeId).toBeNull();
    expect(first.state.treeVisible).toBe(false);
    expect(first.state.expanded).toBe(true);
    expect(first.store.get("proj-a")?.tabs.map((t) => t.id)).toEqual([
      "file-a",
    ]);

    const back = switchSideWorkbenchProject(
      first.state,
      first.store,
      "proj-b",
      "proj-a",
    );
    expect(back.state.tabs.map((t) => t.id)).toEqual(["file-a"]);
    expect(back.state.tabs[0]).toMatchObject({
      kind: "file",
      path: "/A/a.ts",
    });
    expect(back.state.treeVisible).toBe(true);
    expect(back.state.expanded).toBe(true);
  });

  it("keeps each project's tab group isolated", () => {
    let a = emptySideWorkbenchState();
    a = openSideTab(a, "file", { path: "/A/a.ts", id: "file-a" });

    const toB = switchSideWorkbenchProject(a, new Map(), "proj-a", "proj-b");
    let b = openSideTab(toB.state, "file", { path: "/B/b.ts", id: "file-b" });
    b = openSideTab(b, "terminal", { id: "term-b" });

    const backA = switchSideWorkbenchProject(b, toB.store, "proj-b", "proj-a");
    expect(backA.state.tabs.map((t) => t.id)).toEqual(["file-a"]);

    const backB = switchSideWorkbenchProject(
      backA.state,
      backA.store,
      "proj-a",
      "proj-b",
    );
    expect(backB.state.tabs.map((t) => t.id)).toEqual(["term-b", "file-b"]);
  });

  it("is a no-op when the project key does not change", () => {
    let state = emptySideWorkbenchState();
    state = openSideTab(state, "file", { path: "/A/a.ts", id: "file-a" });
    const next = switchSideWorkbenchProject(state, new Map(), "proj-a", "proj-a");
    expect(next.state).toBe(state);
    expect(next.store.size).toBe(0);
  });
});

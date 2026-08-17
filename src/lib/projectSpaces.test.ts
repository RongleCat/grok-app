import { describe, expect, it } from "vitest";
import {
  ALL_SPACES_ID,
  DEFAULT_SPACE_ID,
  MAX_SPACE_NAME_LEN,
  MAX_SPACES,
  activeSpaceLabel,
  assignNewProject,
  countProjectsInSpace,
  createCoalescedFlush,
  createSpace,
  createSpaceAndMoveProject,
  deleteSpace,
  emptyProjectSpacesState,
  filterProjectsBySpace,
  forgetProject,
  moveProjectToSpace,
  parseProjectSpacesState,
  renameSpace,
  revealProjectSpace,
  serializeProjectSpacesState,
  spaceOfProject,
  spliceVisibleOrder,
  switchActiveSpace,
} from "./projectSpaces";

const p = (id: string) => ({ id });

function withSpaces(
  names: string[],
  activeId = ALL_SPACES_ID,
  membership: Record<string, string> = {},
) {
  let state = emptyProjectSpacesState();
  names.forEach((name, i) => {
    const created = createSpace(state, name, { id: `space:extra-${i}` });
    if (!created.ok) throw new Error(created.error);
    state = created.state;
  });
  return { ...state, activeId, membership };
}

describe("parseProjectSpacesState", () => {
  it("starts on All with a default space when settings are empty", () => {
    const state = parseProjectSpacesState({});
    expect(state.activeId).toBe(ALL_SPACES_ID);
    expect(state.spaces).toEqual([{ id: DEFAULT_SPACE_ID, name: "" }]);
    expect(state.membership).toEqual({});
  });

  it("drops unknown membership and invalid active ids", () => {
    const state = parseProjectSpacesState({
      projectSpaces: [{ id: "space:work", name: "Work" }],
      activeProjectSpaceId: "space:missing",
      projectSpaceById: {
        a: "space:work",
        b: "space:gone",
        c: ALL_SPACES_ID,
        d: DEFAULT_SPACE_ID,
      },
    });
    expect(state.spaces.map((s) => s.id)).toEqual([
      DEFAULT_SPACE_ID,
      "space:work",
    ]);
    expect(state.activeId).toBe(ALL_SPACES_ID);
    expect(state.membership).toEqual({ a: "space:work" });
  });

  it("round-trips a named space and membership", () => {
    const created = createSpace(emptyProjectSpacesState(), "Work", {
      id: "space:work",
    });
    if (!created.ok) throw new Error(created.error);
    const moved = moveProjectToSpace(created.state, "p1", "space:work");
    const raw = serializeProjectSpacesState(moved);
    expect(raw.activeProjectSpaceId).toBe("space:work");
    expect(raw.projectSpaceById).toEqual({ p1: "space:work" });
    expect(parseProjectSpacesState(raw)).toEqual(moved);
  });
});

describe("filterProjectsBySpace", () => {
  const projects = [p("a"), p("b"), p("c")];

  it("shows every project on the All view", () => {
    const state = withSpaces(["Work"], ALL_SPACES_ID, { a: "space:extra-0" });
    expect(filterProjectsBySpace(state, projects).map((x) => x.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("keeps unassigned projects in Default", () => {
    const state = withSpaces(["Work"], DEFAULT_SPACE_ID, { a: "space:extra-0" });
    expect(filterProjectsBySpace(state, projects).map((x) => x.id)).toEqual([
      "b",
      "c",
    ]);
  });

  it("shows only members of the active named space", () => {
    const state = withSpaces(["Work"], "space:extra-0", { a: "space:extra-0" });
    expect(filterProjectsBySpace(state, projects).map((x) => x.id)).toEqual([
      "a",
    ]);
  });
});

describe("create / rename / delete space", () => {
  it("creates a space, switches to it, and rejects blank or duplicate names", () => {
    const created = createSpace(emptyProjectSpacesState(), "  Work  ", {
      id: "space:work",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.state.activeId).toBe("space:work");
    expect(created.state.spaces).toHaveLength(2);
    expect(createSpace(created.state, "work").ok).toBe(false);
    const blank = createSpace(created.state, "   ");
    expect(blank.ok ? null : blank.error).toBe("empty");
    const tooLong = createSpace(
      created.state,
      "x".repeat(MAX_SPACE_NAME_LEN + 1),
    );
    expect(tooLong.ok ? null : tooLong.error).toBe("too_long");
  });

  it("renames a space and refuses a clash", () => {
    const state = withSpaces(["Work", "Home"]);
    const renamed = renameSpace(state, "space:extra-0", "Office");
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.state.spaces.find((s) => s.id === "space:extra-0")?.name).toBe(
      "Office",
    );
    const clash = renameSpace(renamed.state, "space:extra-0", "home");
    expect(clash.ok ? null : clash.error).toBe("duplicate");
  });

  it("deletes a space, rehomes members to Default, and refuses deleting Default", () => {
    const state = withSpaces(["Work"], "space:extra-0", {
      a: "space:extra-0",
      b: "space:extra-0",
    });
    const refuseDefault = deleteSpace(state, DEFAULT_SPACE_ID);
    expect(refuseDefault.ok ? null : refuseDefault.error).toBe("default");
    const gone = deleteSpace(state, "space:extra-0");
    expect(gone.ok).toBe(true);
    if (!gone.ok) return;
    expect(gone.state.spaces.map((s) => s.id)).toEqual([DEFAULT_SPACE_ID]);
    expect(gone.state.activeId).toBe(ALL_SPACES_ID);
    expect(spaceOfProject(gone.state, "a")).toBe(DEFAULT_SPACE_ID);
    expect(gone.state.membership).toEqual({});
  });

  it("caps the number of spaces", () => {
    let state = emptyProjectSpacesState();
    for (let i = 0; i < MAX_SPACES - 1; i += 1) {
      const created = createSpace(state, `S${i}`, { id: `space:n${i}` });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      state = created.state;
    }
    const overflow = createSpace(state, "overflow");
    expect(overflow.ok ? null : overflow.error).toBe("limit");
  });
});

describe("membership", () => {
  it("assigns a new project to the current named space", () => {
    const state = withSpaces(["Work"], "space:extra-0");
    const next = assignNewProject(state, "p1");
    expect(spaceOfProject(next, "p1")).toBe("space:extra-0");
  });

  it("assigns a new project to Default while viewing All", () => {
    const state = withSpaces(["Work"]);
    const next = assignNewProject(state, "p1");
    expect(spaceOfProject(next, "p1")).toBe(DEFAULT_SPACE_ID);
    expect(next.membership).toEqual({});
  });

  it("moves a project and forgets membership on remove", () => {
    const state = withSpaces(["Work"], ALL_SPACES_ID);
    const moved = moveProjectToSpace(state, "p1", "space:extra-0");
    expect(spaceOfProject(moved, "p1")).toBe("space:extra-0");
    expect(forgetProject(moved, "p1").membership).toEqual({});
  });

  it("does not leave All when the project is already visible", () => {
    const state = withSpaces(["Work"], ALL_SPACES_ID, { p1: "space:extra-0" });
    expect(revealProjectSpace(state, "p1")).toBe(state);
    expect(revealProjectSpace(state, "unmapped")).toBe(state);
  });

  it("switches to the owning space when the current view hides the project", () => {
    const state = withSpaces(["Work", "Home"], "space:extra-1", {
      p1: "space:extra-0",
    });
    const next = revealProjectSpace(state, "p1");
    expect(next.activeId).toBe("space:extra-0");
    expect(revealProjectSpace(state, "unmapped").activeId).toBe(DEFAULT_SPACE_ID);
  });

  it("creates a space and moves a project in one snapshot", () => {
    const created = createSpaceAndMoveProject(
      emptyProjectSpacesState(),
      "Work",
      "p1",
      { id: "space:work" },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.id).toBe("space:work");
    expect(created.state.activeId).toBe("space:work");
    expect(spaceOfProject(created.state, "p1")).toBe("space:work");
    expect(created.state.membership).toEqual({ p1: "space:work" });
  });
});

describe("createCoalescedFlush", () => {
  it("writes again when a request arrives during an in-flight flush", async () => {
    let started = 0;
    let unblock = () => {};
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const flush = createCoalescedFlush(async () => {
      started += 1;
      if (started === 1) await gate;
    });
    flush.request();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toBe(1);
    flush.request();
    flush.request();
    unblock();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toBe(2);
  });
});

describe("activeSpaceLabel", () => {
  const labels = { all: "All", default: "Default", projects: "Projects" };

  it("keeps the generic Projects label on the All view", () => {
    expect(activeSpaceLabel(emptyProjectSpacesState(), labels)).toBe("Projects");
  });

  it("uses the localized Default name until the default space is renamed", () => {
    const state = switchActiveSpace(emptyProjectSpacesState(), DEFAULT_SPACE_ID);
    expect(activeSpaceLabel(state, labels)).toBe("Default");
    const renamed = renameSpace(state, DEFAULT_SPACE_ID, "Inbox");
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(activeSpaceLabel(renamed.state, labels)).toBe("Inbox");
  });
});

describe("spliceVisibleOrder", () => {
  it("reorders only the visible slots", () => {
    const all = [p("a"), p("x"), p("c"), p("y"), p("b")];
    const next = spliceVisibleOrder(all, ["a", "c", "b"], [p("b"), p("a"), p("c")]);
    expect(next.map((x) => x.id)).toEqual(["b", "x", "a", "y", "c"]);
  });

  it("is a no-op when the visible set is the full list", () => {
    const all = [p("a"), p("b"), p("c")];
    const next = spliceVisibleOrder(all, ["a", "b", "c"], [p("c"), p("a"), p("b")]);
    expect(next.map((x) => x.id)).toEqual(["c", "a", "b"]);
  });
});

describe("countProjectsInSpace", () => {
  it("counts All vs a named space", () => {
    const state = withSpaces(["Work"], ALL_SPACES_ID, { a: "space:extra-0" });
    const ids = ["a", "b", "c"];
    expect(countProjectsInSpace(state, ALL_SPACES_ID, ids)).toBe(3);
    expect(countProjectsInSpace(state, "space:extra-0", ids)).toBe(1);
    expect(countProjectsInSpace(state, DEFAULT_SPACE_ID, ids)).toBe(2);
  });
});

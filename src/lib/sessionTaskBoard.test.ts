import { describe, expect, it } from "vitest";
import {
  buildTaskBoard,
  countTaskBoardColumns,
  filterTaskBoard,
  flattenTaskBoard,
  mapDashboardStatusToBoardColumn,
  resolveTaskBoardEmptyState,
  TASK_BOARD_COLUMN_ORDER,
  type TaskBoard,
  type TaskBoardCard,
} from "./sessionTaskBoard";
import { emptyLiveSnapshot, type SessionLiveMap } from "./sessionLiveStore";

describe("mapDashboardStatusToBoardColumn", () => {
  it("maps permission → needs_you, busy/connecting → running", () => {
    expect(mapDashboardStatusToBoardColumn("permission")).toBe("needs_you");
    expect(mapDashboardStatusToBoardColumn("busy")).toBe("running");
    expect(mapDashboardStatusToBoardColumn("connecting")).toBe("running");
  });

  it("maps idle → idle, error → error", () => {
    expect(mapDashboardStatusToBoardColumn("idle")).toBe("idle");
    expect(mapDashboardStatusToBoardColumn("error")).toBe("error");
  });

  it("maps archived idle → done", () => {
    expect(mapDashboardStatusToBoardColumn("idle", true)).toBe("done");
    // Archived does not reclassify non-idle statuses.
    expect(mapDashboardStatusToBoardColumn("busy", true)).toBe("running");
    expect(mapDashboardStatusToBoardColumn("permission", true)).toBe(
      "needs_you",
    );
    expect(mapDashboardStatusToBoardColumn("error", true)).toBe("error");
  });
});

describe("buildTaskBoard", () => {
  it("groups sessions into status columns from liveMap + meta", () => {
    const liveMap: SessionLiveMap = {
      a: {
        ...emptyLiveSnapshot("a", 100),
        state: "streaming",
        liveToolTitle: "bash",
        updatedAt: 5000,
      },
      b: {
        ...emptyLiveSnapshot("b", 50),
        state: "awaiting_permission",
        awaitingPermission: true,
        updatedAt: 4000,
      },
      c: { ...emptyLiveSnapshot("c", 10), state: "ready", updatedAt: 10 },
      d: {
        ...emptyLiveSnapshot("d", 1),
        state: "disconnected",
        updatedAt: 1,
      },
    };
    const board = buildTaskBoard({
      sessions: [
        {
          id: "a",
          title: "Fix CI",
          projectId: "p1",
          updatedAt: "2026-07-30T10:00:00.000Z",
        },
        {
          id: "b",
          title: "Review PR",
          projectId: "p1",
          updatedAt: "2026-07-30T09:00:00.000Z",
        },
        {
          id: "c",
          title: "Idle chat",
          projectId: null,
          updatedAt: "2026-07-29T12:00:00.000Z",
        },
        {
          id: "d",
          title: "Dropped",
          projectId: "p2",
          updatedAt: "2026-07-28T12:00:00.000Z",
        },
      ],
      projects: [
        { id: "p1", name: "grok-app", path: "/Users/me/Code/grok-app" },
        { id: "p2", name: "other", path: "/tmp/other" },
      ],
      liveMap,
      currentSessionId: "a",
      untitledLabel: "Untitled",
      unboundProjectLabel: "Default workspace",
    });

    expect(board.running.map((c) => c.sessionId)).toEqual(["a"]);
    expect(board.needs_you.map((c) => c.sessionId)).toEqual(["b"]);
    expect(board.idle.map((c) => c.sessionId)).toEqual(["c"]);
    expect(board.error.map((c) => c.sessionId)).toEqual(["d"]);
    expect(board.done).toEqual([]);

    const a = board.running[0]!;
    expect(a.isCurrent).toBe(true);
    expect(a.liveToolTitle).toBe("bash");
    expect(a.projectName).toBe("grok-app");
    expect(a.projectPath).toBe("/Users/me/Code/grok-app");
    expect(a.status).toBe("busy");
    expect(a.column).toBe("running");

    const c = board.idle[0]!;
    expect(c.projectName).toBe("Default workspace");
    expect(c.status).toBe("idle");
  });

  it("puts archived idle into done only when includeArchived", () => {
    const sessions = [
      {
        id: "arch",
        title: "Old archive",
        archived: true,
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "live",
        title: "Live",
        updatedAt: "2026-07-30T00:00:00.000Z",
      },
    ];
    const without = buildTaskBoard({
      sessions,
      projects: [],
      liveMap: {},
      includeArchived: false,
    });
    expect(flattenTaskBoard(without).map((c) => c.sessionId)).toEqual([
      "live",
    ]);
    expect(without.done).toEqual([]);

    const withArch = buildTaskBoard({
      sessions,
      projects: [],
      liveMap: {},
      includeArchived: true,
    });
    expect(withArch.done.map((c) => c.sessionId)).toEqual(["arch"]);
    expect(withArch.done[0]!.column).toBe("done");
    expect(withArch.done[0]!.archived).toBe(true);
    expect(withArch.idle.map((c) => c.sessionId)).toEqual(["live"]);
  });

  it("keeps archived busy sessions in running even without includeArchived", () => {
    const liveMap: SessionLiveMap = {
      archBusy: {
        ...emptyLiveSnapshot("archBusy", 20),
        state: "streaming",
        updatedAt: 20,
      },
    };
    const board = buildTaskBoard({
      sessions: [
        {
          id: "archBusy",
          title: "Still running archive",
          archived: true,
          updatedAt: "2026-07-30T00:00:00.000Z",
        },
      ],
      projects: [],
      liveMap,
      includeArchived: false,
    });
    expect(board.running.map((c) => c.sessionId)).toEqual(["archBusy"]);
    expect(board.done).toEqual([]);
  });

  it("includes live-busy sessions missing from the sidebar list", () => {
    const liveMap: SessionLiveMap = {
      ghost: {
        ...emptyLiveSnapshot("ghost", 99),
        state: "connecting",
        updatedAt: 99,
      },
    };
    const board = buildTaskBoard({
      sessions: [],
      projects: [],
      liveMap,
      untitledLabel: "Untitled",
    });
    expect(board.running).toHaveLength(1);
    expect(board.running[0]!.sessionId).toBe("ghost");
    expect(board.running[0]!.title).toBe("Untitled");
    expect(board.running[0]!.status).toBe("connecting");
  });

  it("sorts within column by current then lastActivityAt desc", () => {
    const liveMap: SessionLiveMap = {
      older: {
        ...emptyLiveSnapshot("older", 1),
        state: "streaming",
        updatedAt: 100,
      },
      newer: {
        ...emptyLiveSnapshot("newer", 2),
        state: "streaming",
        updatedAt: 200,
      },
      current: {
        ...emptyLiveSnapshot("current", 3),
        state: "streaming",
        updatedAt: 50,
      },
    };
    const board = buildTaskBoard({
      sessions: [
        { id: "older", title: "Older", updatedAt: "2026-07-01T00:00:00.000Z" },
        { id: "newer", title: "Newer", updatedAt: "2026-07-02T00:00:00.000Z" },
        {
          id: "current",
          title: "Current",
          updatedAt: "2026-07-03T00:00:00.000Z",
        },
      ],
      projects: [],
      liveMap,
      currentSessionId: "current",
    });
    // Current first even with lower live updatedAt; then newer before older.
    expect(board.running.map((c) => c.sessionId)).toEqual([
      "current",
      "newer",
      "older",
    ]);
  });
});

describe("countTaskBoardColumns", () => {
  it("returns per-column and total counts", () => {
    const board: TaskBoard = {
      needs_you: [{ sessionId: "b" } as TaskBoardCard],
      running: [
        { sessionId: "a" } as TaskBoardCard,
        { sessionId: "c" } as TaskBoardCard,
      ],
      idle: [],
      done: [{ sessionId: "d" } as TaskBoardCard],
      error: [{ sessionId: "e" } as TaskBoardCard],
    };
    expect(countTaskBoardColumns(board)).toEqual({
      needs_you: 1,
      running: 2,
      idle: 0,
      done: 1,
      error: 1,
      total: 5,
    });
    expect(countTaskBoardColumns(emptyBoardLike())).toEqual({
      needs_you: 0,
      running: 0,
      idle: 0,
      done: 0,
      error: 0,
      total: 0,
    });
  });

  it("lists every column in TASK_BOARD_COLUMN_ORDER", () => {
    expect([...TASK_BOARD_COLUMN_ORDER]).toEqual([
      "needs_you",
      "running",
      "error",
      "idle",
      "done",
    ]);
  });
});

function emptyBoardLike(): TaskBoard {
  return {
    needs_you: [],
    running: [],
    idle: [],
    done: [],
    error: [],
  };
}

describe("filterTaskBoard", () => {
  const sample = buildTaskBoard({
    sessions: [
      {
        id: "a",
        title: "Fix CI",
        projectId: "p1",
        updatedAt: "2026-07-30T10:00:00.000Z",
      },
      {
        id: "b",
        title: "Notes",
        projectId: null,
        updatedAt: "2026-07-29T12:00:00.000Z",
      },
      {
        id: "c",
        title: "Auth gate",
        projectId: "p2",
        updatedAt: "2026-07-28T12:00:00.000Z",
      },
    ],
    projects: [
      { id: "p1", name: "grok-app", path: "/code/grok-app" },
      { id: "p2", name: "api-server", path: "/code/api-server" },
    ],
    liveMap: {
      a: {
        ...emptyLiveSnapshot("a", 1),
        state: "streaming",
        liveToolTitle: "bash",
        updatedAt: 10,
      },
      c: {
        ...emptyLiveSnapshot("c", 1),
        state: "awaiting_permission",
        awaitingPermission: true,
        updatedAt: 8,
      },
    },
  });

  it("filters by title free-text across columns", () => {
    const filtered = filterTaskBoard(sample, { query: "ci" });
    expect(flattenTaskBoard(filtered).map((c) => c.sessionId)).toEqual(["a"]);
    expect(filtered.running.map((c) => c.sessionId)).toEqual(["a"]);
    expect(filtered.needs_you).toEqual([]);
  });

  it("filters by project name / path substring", () => {
    const byName = filterTaskBoard(sample, { projectQuery: "API" });
    expect(flattenTaskBoard(byName).map((c) => c.sessionId)).toEqual(["c"]);
    const byPath = filterTaskBoard(sample, { projectQuery: "/code/grok" });
    expect(flattenTaskBoard(byPath).map((c) => c.sessionId)).toEqual(["a"]);
  });

  it("combines query + projectQuery with AND", () => {
    expect(
      flattenTaskBoard(
        filterTaskBoard(sample, { query: "auth", projectQuery: "api" }),
      ).map((c) => c.sessionId),
    ).toEqual(["c"]);
    expect(
      flattenTaskBoard(
        filterTaskBoard(sample, { query: "ci", projectQuery: "api" }),
      ),
    ).toHaveLength(0);
  });

  it("empty filter returns the same board", () => {
    expect(filterTaskBoard(sample, {})).toBe(sample);
    expect(filterTaskBoard(sample, { query: "  " })).toBe(sample);
  });
});

describe("resolveTaskBoardEmptyState", () => {
  it("returns empty when no sessions", () => {
    expect(
      resolveTaskBoardEmptyState({ totalSessions: 0, filteredCount: 0 }),
    ).toBe("empty");
  });

  it("returns filter_empty when catalog has rows but filter removes all", () => {
    expect(
      resolveTaskBoardEmptyState({ totalSessions: 3, filteredCount: 0 }),
    ).toBe("filter_empty");
  });

  it("returns null when there are visible cards", () => {
    expect(
      resolveTaskBoardEmptyState({ totalSessions: 3, filteredCount: 2 }),
    ).toBeNull();
  });
});

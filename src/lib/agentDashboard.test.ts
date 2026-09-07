import { describe, expect, it } from "vitest";
import {
  AGENT_DASHBOARD_STATUS_FILTERS,
  buildDashboardPeekModel,
  collectAgentDashboardRows,
  countBusyDashboardRows,
  countDashboardRowsByStatus,
  dashboardStatusFromSessionState,
  dashboardStatusSortRank,
  filterAgentDashboardRows,
  filterStoppableAmongSelection,
  groupDashboardRowsByStatus,
  isStoppableDashboardStatus,
  mapDashboardStatus,
  matchAgentDashboardProject,
  planDashboardDispatch,
  sanitizeDispatchPrompt,
  stoppableDashboardRows,
  stoppableSelectedSessionIds,
  trustedDashboardDispatchProjects,
  type AgentDashboardRow,
} from "./agentDashboard";
import { emptyLiveSnapshot, type SessionLiveMap } from "./sessionLiveStore";

describe("mapDashboardStatus", () => {
  it("maps live snapshots to coarse statuses", () => {
    const base = emptyLiveSnapshot("s1", 1);
    expect(mapDashboardStatus({ ...base, state: "streaming" })).toBe("busy");
    expect(
      mapDashboardStatus({
        ...base,
        state: "ready",
        awaitingPermission: true,
      }),
    ).toBe("permission");
    expect(mapDashboardStatus({ ...base, state: "awaiting_permission" })).toBe(
      "permission",
    );
    expect(mapDashboardStatus({ ...base, state: "connecting" })).toBe(
      "connecting",
    );
    expect(mapDashboardStatus({ ...base, state: "ready" })).toBe("idle");
    expect(mapDashboardStatus({ ...base, state: "idle" })).toBe("idle");
    expect(mapDashboardStatus({ ...base, state: "disconnected" })).toBe(
      "error",
    );
    expect(mapDashboardStatus(null)).toBe("idle");
  });
});

describe("dashboardStatusFromSessionState", () => {
  it("mirrors mapDashboardStatus for raw states", () => {
    expect(dashboardStatusFromSessionState("streaming")).toBe("busy");
    expect(dashboardStatusFromSessionState("awaiting_permission")).toBe(
      "permission",
    );
    expect(dashboardStatusFromSessionState("connecting")).toBe("connecting");
    expect(dashboardStatusFromSessionState("disconnected")).toBe("error");
    expect(dashboardStatusFromSessionState("ready")).toBe("idle");
  });
});

describe("isStoppableDashboardStatus", () => {
  it("flags busy / permission / connecting only", () => {
    expect(isStoppableDashboardStatus("busy")).toBe(true);
    expect(isStoppableDashboardStatus("permission")).toBe(true);
    expect(isStoppableDashboardStatus("connecting")).toBe(true);
    expect(isStoppableDashboardStatus("idle")).toBe(false);
    expect(isStoppableDashboardStatus("error")).toBe(false);
  });
});

describe("collectAgentDashboardRows", () => {
  it("builds rows with project / model / effort from real session + live data", () => {
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
    };
    const rows = collectAgentDashboardRows({
      sessions: [
        {
          id: "a",
          title: "Fix CI",
          projectId: "p1",
          updatedAt: "2026-07-30T10:00:00.000Z",
          modelId: "grok-4",
          effort: "high",
        },
        {
          id: "b",
          title: "Review PR",
          projectId: "p1",
          updatedAt: "2026-07-30T09:00:00.000Z",
          modelId: "grok-3",
          effort: "low",
        },
        {
          id: "c",
          title: "Idle chat",
          projectId: null,
          updatedAt: "2026-07-29T12:00:00.000Z",
          modelId: null,
          effort: null,
        },
        {
          id: "d",
          title: "Older",
          projectId: "p2",
          updatedAt: "2026-07-28T12:00:00.000Z",
          modelId: "grok-4",
        },
      ],
      projects: [
        { id: "p1", name: "grok-app", path: "/Users/me/Code/grok-app" },
        { id: "p2", name: "other", path: "/tmp/other" },
      ],
      liveMap,
      currentSessionId: "a",
      untitledLabel: "Untitled",
      generalWorkspacePath: "/Users/me/.grok-app/workspaces/general",
      unboundProjectLabel: "Default workspace",
    });

    // Permission (needs you) before busy; then idle by last activity (c newer than d).
    expect(rows.map((r) => r.sessionId)).toEqual(["b", "a", "c", "d"]);
    expect(rows[0]!.status).toBe("permission");
    expect(rows[0]!.stoppable).toBe(true);

    const busyA = rows.find((r) => r.sessionId === "a")!;
    expect(busyA.isCurrent).toBe(true);
    expect(busyA.status).toBe("busy");
    expect(busyA.liveToolTitle).toBe("bash");
    expect(busyA.modelId).toBe("grok-4");
    expect(busyA.effort).toBe("high");
    expect(busyA.projectName).toBe("grok-app");
    expect(busyA.projectPath).toBe("/Users/me/Code/grok-app");
    expect(busyA.stoppable).toBe(true);

    const idleC = rows.find((r) => r.sessionId === "c")!;
    expect(idleC.status).toBe("idle");
    expect(idleC.projectName).toBe("Default workspace");
    expect(idleC.projectPath).toBe(
      "/Users/me/.grok-app/workspaces/general",
    );
    expect(idleC.stoppable).toBe(false);

    expect(countBusyDashboardRows(rows)).toBe(2);
    expect(stoppableDashboardRows(rows).map((r) => r.sessionId)).toEqual([
      "b",
      "a",
    ]);
  });

  it("ranks permission above busy above connecting", () => {
    const liveMap: SessionLiveMap = {
      perm: {
        ...emptyLiveSnapshot("perm", 1),
        state: "awaiting_permission",
        awaitingPermission: true,
        updatedAt: 10,
      },
      busy: {
        ...emptyLiveSnapshot("busy", 2),
        state: "streaming",
        updatedAt: 99,
      },
      conn: {
        ...emptyLiveSnapshot("conn", 3),
        state: "connecting",
        updatedAt: 50,
      },
    };
    const rows = collectAgentDashboardRows({
      sessions: [
        { id: "busy", title: "Busy", updatedAt: "2026-07-30T12:00:00.000Z" },
        { id: "perm", title: "Perm", updatedAt: "2026-07-30T11:00:00.000Z" },
        { id: "conn", title: "Conn", updatedAt: "2026-07-30T10:00:00.000Z" },
      ],
      projects: [],
      liveMap,
    });
    expect(rows.map((r) => r.sessionId)).toEqual(["perm", "busy", "conn"]);
    expect(dashboardStatusSortRank("permission")).toBeLessThan(
      dashboardStatusSortRank("busy"),
    );
    expect(dashboardStatusSortRank("busy")).toBeLessThan(
      dashboardStatusSortRank("connecting"),
    );
  });

  it("includes live-busy sessions missing from the sidebar list", () => {
    const liveMap: SessionLiveMap = {
      ghost: {
        ...emptyLiveSnapshot("ghost", 99),
        state: "connecting",
        updatedAt: 99,
      },
    };
    const rows = collectAgentDashboardRows({
      sessions: [],
      projects: [],
      liveMap,
      untitledLabel: "Untitled",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sessionId).toBe("ghost");
    expect(rows[0]!.title).toBe("Untitled");
    expect(rows[0]!.status).toBe("connecting");
    expect(rows[0]!.stoppable).toBe(true);
  });

  it("omits archived idle sessions but keeps archived busy ones", () => {
    const liveMap: SessionLiveMap = {
      archBusy: {
        ...emptyLiveSnapshot("archBusy", 20),
        state: "streaming",
        updatedAt: 20,
      },
    };
    const rows = collectAgentDashboardRows({
      sessions: [
        {
          id: "archIdle",
          title: "Old archive",
          archived: true,
          updatedAt: "2026-07-01T00:00:00.000Z",
        },
        {
          id: "archBusy",
          title: "Still running archive",
          archived: true,
          updatedAt: "2026-07-30T00:00:00.000Z",
        },
      ],
      projects: [],
      liveMap,
    });
    expect(rows.map((r) => r.sessionId)).toEqual(["archBusy"]);
  });

  it("caps idle/recent rows while keeping all busy", () => {
    const sessions = Array.from({ length: 10 }, (_, i) => ({
      id: `idle-${i}`,
      title: `Idle ${i}`,
      updatedAt: new Date(Date.UTC(2026, 6, 1 + i)).toISOString(),
    }));
    sessions.push({
      id: "busy-1",
      title: "Busy",
      updatedAt: "2026-07-30T00:00:00.000Z",
    });
    const liveMap: SessionLiveMap = {
      "busy-1": {
        ...emptyLiveSnapshot("busy-1", 1),
        state: "streaming",
        updatedAt: 999,
      },
    };
    const rows = collectAgentDashboardRows({
      sessions,
      projects: [],
      liveMap,
      recentLimit: 3,
    });
    expect(rows.filter((r) => r.status === "busy")).toHaveLength(1);
    expect(rows.filter((r) => r.status === "idle")).toHaveLength(3);
  });
});

describe("filterAgentDashboardRows", () => {
  const sample: AgentDashboardRow[] = [
    {
      sessionId: "a",
      title: "Fix CI",
      projectId: "p1",
      projectName: "grok-app",
      projectPath: "/code/grok-app",
      modelId: "grok-4",
      effort: "high",
      status: "busy",
      liveToolTitle: "bash",
      isCurrent: true,
      lastActivityAt: 10,
      updatedAtIso: null,
      stoppable: true,
    },
    {
      sessionId: "b",
      title: "Notes",
      projectId: null,
      projectName: null,
      projectPath: null,
      modelId: "grok-3",
      effort: "low",
      status: "idle",
      liveToolTitle: null,
      isCurrent: false,
      lastActivityAt: 5,
      updatedAtIso: null,
      stoppable: false,
    },
    {
      sessionId: "c",
      title: "Auth gate",
      projectId: "p2",
      projectName: "api-server",
      projectPath: "/code/api-server",
      modelId: "grok-4",
      effort: "high",
      status: "permission",
      liveToolTitle: null,
      isCurrent: false,
      lastActivityAt: 8,
      updatedAtIso: null,
      stoppable: true,
    },
    {
      sessionId: "d",
      title: "Spin up",
      projectId: "p1",
      projectName: "grok-app",
      projectPath: "/code/grok-app",
      modelId: null,
      effort: null,
      status: "connecting",
      liveToolTitle: null,
      isCurrent: false,
      lastActivityAt: 7,
      updatedAtIso: null,
      stoppable: true,
    },
    {
      sessionId: "e",
      title: "Dropped",
      projectId: "p2",
      projectName: "api-server",
      projectPath: "/code/api-server",
      modelId: "grok-3",
      effort: null,
      status: "error",
      liveToolTitle: null,
      isCurrent: false,
      lastActivityAt: 1,
      updatedAtIso: null,
      stoppable: false,
    },
  ];

  it("filters by title / project / model (string form)", () => {
    expect(filterAgentDashboardRows(sample, "ci").map((r) => r.sessionId)).toEqual(
      ["a"],
    );
    expect(
      filterAgentDashboardRows(sample, "grok-3").map((r) => r.sessionId),
    ).toEqual(["b", "e"]);
    expect(
      filterAgentDashboardRows(sample, "grok-app").map((r) => r.sessionId),
    ).toEqual(["a", "d"]);
    expect(filterAgentDashboardRows(sample, "  ")).toHaveLength(5);
  });

  it("filters by status chip", () => {
    expect(
      filterAgentDashboardRows(sample, { status: "all" }).map((r) => r.sessionId),
    ).toEqual(["a", "b", "c", "d", "e"]);
    expect(
      filterAgentDashboardRows(sample, { status: "busy" }).map((r) => r.sessionId),
    ).toEqual(["a"]);
    expect(
      filterAgentDashboardRows(sample, { status: "permission" }).map(
        (r) => r.sessionId,
      ),
    ).toEqual(["c"]);
    expect(
      filterAgentDashboardRows(sample, { status: "idle" }).map((r) => r.sessionId),
    ).toEqual(["b"]);
    expect(
      filterAgentDashboardRows(sample, { status: "error" }).map((r) => r.sessionId),
    ).toEqual(["e"]);
  });

  it("filters by project id / name / path substring", () => {
    expect(
      filterAgentDashboardRows(sample, { projectQuery: "p1" }).map(
        (r) => r.sessionId,
      ),
    ).toEqual(["a", "d"]);
    expect(
      filterAgentDashboardRows(sample, { projectQuery: "API" }).map(
        (r) => r.sessionId,
      ),
    ).toEqual(["c", "e"]);
    expect(
      filterAgentDashboardRows(sample, { projectQuery: "/code/grok" }).map(
        (r) => r.sessionId,
      ),
    ).toEqual(["a", "d"]);
    expect(
      filterAgentDashboardRows(sample, { projectQuery: "   " }),
    ).toHaveLength(5);
  });

  it("combines status + project + free-text with AND", () => {
    expect(
      filterAgentDashboardRows(sample, {
        status: "busy",
        projectQuery: "p1",
        query: "ci",
      }).map((r) => r.sessionId),
    ).toEqual(["a"]);
    expect(
      filterAgentDashboardRows(sample, {
        status: "busy",
        projectQuery: "api",
      }),
    ).toHaveLength(0);
    expect(
      filterAgentDashboardRows(sample, {
        status: "permission",
        query: "auth",
      }).map((r) => r.sessionId),
    ).toEqual(["c"]);
  });
});

describe("countDashboardRowsByStatus", () => {
  it("returns total and per-status counts", () => {
    const rows: AgentDashboardRow[] = [
      {
        sessionId: "a",
        title: "A",
        projectId: null,
        projectName: null,
        projectPath: null,
        modelId: null,
        effort: null,
        status: "busy",
        liveToolTitle: null,
        isCurrent: false,
        lastActivityAt: 1,
        updatedAtIso: null,
        stoppable: true,
      },
      {
        sessionId: "b",
        title: "B",
        projectId: null,
        projectName: null,
        projectPath: null,
        modelId: null,
        effort: null,
        status: "busy",
        liveToolTitle: null,
        isCurrent: false,
        lastActivityAt: 1,
        updatedAtIso: null,
        stoppable: true,
      },
      {
        sessionId: "c",
        title: "C",
        projectId: null,
        projectName: null,
        projectPath: null,
        modelId: null,
        effort: null,
        status: "idle",
        liveToolTitle: null,
        isCurrent: false,
        lastActivityAt: 1,
        updatedAtIso: null,
        stoppable: false,
      },
      {
        sessionId: "d",
        title: "D",
        projectId: null,
        projectName: null,
        projectPath: null,
        modelId: null,
        effort: null,
        status: "error",
        liveToolTitle: null,
        isCurrent: false,
        lastActivityAt: 1,
        updatedAtIso: null,
        stoppable: false,
      },
    ];
    expect(countDashboardRowsByStatus(rows)).toEqual({
      all: 4,
      busy: 2,
      permission: 0,
      connecting: 0,
      idle: 1,
      error: 1,
    });
    expect(countDashboardRowsByStatus([])).toEqual({
      all: 0,
      busy: 0,
      permission: 0,
      connecting: 0,
      idle: 0,
      error: 0,
    });
  });

  it("lists every chip status in AGENT_DASHBOARD_STATUS_FILTERS", () => {
    expect([...AGENT_DASHBOARD_STATUS_FILTERS]).toEqual([
      "all",
      "busy",
      "permission",
      "connecting",
      "idle",
      "error",
    ]);
  });
});

describe("matchAgentDashboardProject", () => {
  const row: AgentDashboardRow = {
    sessionId: "a",
    title: "Fix",
    projectId: "proj-42",
    projectName: "grok-app",
    projectPath: "/Users/me/Code/grok-app",
    modelId: null,
    effort: null,
    status: "idle",
    liveToolTitle: null,
    isCurrent: false,
    lastActivityAt: 0,
    updatedAtIso: null,
    stoppable: false,
  };

  it("matches id, name, or path substring", () => {
    expect(matchAgentDashboardProject(row, "")).toBe(true);
    expect(matchAgentDashboardProject(row, "proj-42")).toBe(true);
    expect(matchAgentDashboardProject(row, "GROK")).toBe(true);
    expect(matchAgentDashboardProject(row, "/users/me")).toBe(true);
    expect(matchAgentDashboardProject(row, "missing")).toBe(false);
  });
});

describe("filterStoppableAmongSelection", () => {
  const rows: AgentDashboardRow[] = [
    {
      sessionId: "busy-1",
      title: "A",
      projectId: null,
      projectName: null,
      projectPath: null,
      modelId: null,
      effort: null,
      status: "busy",
      liveToolTitle: "bash",
      isCurrent: false,
      lastActivityAt: 3,
      updatedAtIso: null,
      stoppable: true,
    },
    {
      sessionId: "idle-1",
      title: "B",
      projectId: null,
      projectName: null,
      projectPath: null,
      modelId: null,
      effort: null,
      status: "idle",
      liveToolTitle: null,
      isCurrent: false,
      lastActivityAt: 2,
      updatedAtIso: null,
      stoppable: false,
    },
    {
      sessionId: "perm-1",
      title: "C",
      projectId: null,
      projectName: null,
      projectPath: null,
      modelId: null,
      effort: null,
      status: "permission",
      liveToolTitle: null,
      isCurrent: false,
      lastActivityAt: 1,
      updatedAtIso: null,
      stoppable: true,
    },
    {
      sessionId: "err-1",
      title: "D",
      projectId: null,
      projectName: null,
      projectPath: null,
      modelId: null,
      effort: null,
      status: "error",
      liveToolTitle: null,
      isCurrent: false,
      lastActivityAt: 0,
      updatedAtIso: null,
      stoppable: false,
    },
  ];

  it("returns only stoppable rows in the selection (Set or array)", () => {
    expect(
      filterStoppableAmongSelection(
        rows,
        new Set(["busy-1", "idle-1", "perm-1", "err-1", "ghost"]),
      ).map((r) => r.sessionId),
    ).toEqual(["busy-1", "perm-1"]);
    expect(
      filterStoppableAmongSelection(rows, [
        "idle-1",
        "perm-1",
        "busy-1",
      ]).map((r) => r.sessionId),
    ).toEqual(["busy-1", "perm-1"]);
  });

  it("returns empty when selection is empty or only non-stoppable", () => {
    expect(filterStoppableAmongSelection(rows, new Set())).toEqual([]);
    expect(
      filterStoppableAmongSelection(rows, new Set(["idle-1", "err-1"])),
    ).toEqual([]);
    expect(
      filterStoppableAmongSelection(rows, new Set(["missing"])),
    ).toEqual([]);
  });

  it("preserves row order and exposes session ids helper", () => {
    // Selection order must not reorder — follow catalog row order.
    expect(
      stoppableSelectedSessionIds(rows, ["perm-1", "busy-1", "idle-1"]),
    ).toEqual(["busy-1", "perm-1"]);
  });
});

describe("groupDashboardRowsByStatus", () => {
  it("groups in permission → busy → connecting → error → idle order", () => {
    const rows: AgentDashboardRow[] = [
      {
        sessionId: "i",
        title: "Idle",
        projectId: null,
        projectName: null,
        projectPath: null,
        modelId: null,
        effort: null,
        status: "idle",
        liveToolTitle: null,
        isCurrent: false,
        lastActivityAt: 1,
        updatedAtIso: null,
        stoppable: false,
      },
      {
        sessionId: "b",
        title: "Busy",
        projectId: null,
        projectName: null,
        projectPath: null,
        modelId: null,
        effort: null,
        status: "busy",
        liveToolTitle: "bash",
        isCurrent: false,
        lastActivityAt: 2,
        updatedAtIso: null,
        stoppable: true,
      },
      {
        sessionId: "p",
        title: "Perm",
        projectId: null,
        projectName: null,
        projectPath: null,
        modelId: null,
        effort: null,
        status: "permission",
        liveToolTitle: null,
        isCurrent: false,
        lastActivityAt: 3,
        updatedAtIso: null,
        stoppable: true,
      },
      {
        sessionId: "e",
        title: "Err",
        projectId: null,
        projectName: null,
        projectPath: null,
        modelId: null,
        effort: null,
        status: "error",
        liveToolTitle: null,
        isCurrent: false,
        lastActivityAt: 0,
        updatedAtIso: null,
        stoppable: false,
      },
    ];
    const groups = groupDashboardRowsByStatus(rows);
    expect(groups.map((g) => g.status)).toEqual([
      "permission",
      "busy",
      "error",
      "idle",
    ]);
    expect(groups[0]!.rows.map((r) => r.sessionId)).toEqual(["p"]);
    expect(groups[1]!.rows.map((r) => r.sessionId)).toEqual(["b"]);
  });
});

describe("buildDashboardPeekModel", () => {
  it("projects row fields into a read-only peek card", () => {
    const row: AgentDashboardRow = {
      sessionId: "s1",
      title: "Fix CI",
      projectId: "p1",
      projectName: "grok-app",
      projectPath: "/code/grok-app",
      modelId: "grok-4",
      effort: "high",
      status: "busy",
      liveToolTitle: "  bash  ",
      isCurrent: true,
      lastActivityAt: 123,
      updatedAtIso: null,
      stoppable: true,
    };
    expect(buildDashboardPeekModel(row)).toEqual({
      title: "Fix CI",
      status: "busy",
      toolTitle: "bash",
      projectPath: "/code/grok-app",
      projectName: "grok-app",
      modelId: "grok-4",
      effort: "high",
      lastActivityAt: 123,
      canOpen: true,
      canStop: true,
    });
  });
});

describe("sanitizeDispatchPrompt", () => {
  it("trims, clamps, and never invents content", () => {
    expect(sanitizeDispatchPrompt("  hello  ")).toBe("hello");
    expect(sanitizeDispatchPrompt("   ")).toBe("");
    expect(sanitizeDispatchPrompt(null)).toBe("");
    expect(sanitizeDispatchPrompt(undefined)).toBe("");
    const long = "x".repeat(9000);
    expect(sanitizeDispatchPrompt(long)).toHaveLength(8000);
    expect(sanitizeDispatchPrompt("abcdef", 3)).toBe("abc");
  });
});

describe("planDashboardDispatch", () => {
  const projects = [
    {
      id: "p1",
      name: "trusted",
      path: "/code/t",
      trusted: true,
    },
    {
      id: "p2",
      name: "untrusted",
      path: "/code/u",
      trusted: false,
    },
  ];

  it("returns ok plan with sanitized prompt + project", () => {
    const plan = planDashboardDispatch({
      projectId: "p1",
      prompt: "  do the thing  ",
      projects,
    });
    expect(plan).toEqual({
      ok: true,
      prompt: "do the thing",
      project: {
        id: "p1",
        name: "trusted",
        path: "/code/t",
        trusted: true,
      },
    });
  });

  it("soft-fails empty prompt / missing / untrusted / no trusted catalog", () => {
    expect(
      planDashboardDispatch({
        projectId: "p1",
        prompt: "   ",
        projects,
      }),
    ).toEqual({ ok: false, reason: "empty_prompt" });
    expect(
      planDashboardDispatch({
        projectId: null,
        prompt: "hi",
        projects,
      }),
    ).toEqual({ ok: false, reason: "no_project" });
    expect(
      planDashboardDispatch({
        projectId: "missing",
        prompt: "hi",
        projects,
      }),
    ).toEqual({ ok: false, reason: "no_project" });
    expect(
      planDashboardDispatch({
        projectId: "p2",
        prompt: "hi",
        projects,
      }),
    ).toEqual({ ok: false, reason: "untrusted" });
    expect(
      planDashboardDispatch({
        projectId: null,
        prompt: "hi",
        projects: [{ id: "x", name: "x", path: "/x", trusted: false }],
      }),
    ).toEqual({ ok: false, reason: "no_trusted_project" });
  });

  it("lists trusted projects for the select", () => {
    expect(trustedDashboardDispatchProjects(projects).map((p) => p.id)).toEqual(
      ["p1"],
    );
  });
});


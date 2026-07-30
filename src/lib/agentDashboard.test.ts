import { describe, expect, it } from "vitest";
import {
  collectAgentDashboardRows,
  countBusyDashboardRows,
  dashboardStatusFromSessionState,
  filterAgentDashboardRows,
  isStoppableDashboardStatus,
  mapDashboardStatus,
  stoppableDashboardRows,
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
      unboundProjectLabel: "Other chats",
    });

    // Busy first (a, b), then idle by last activity (c newer than d).
    expect(rows.map((r) => r.sessionId)).toEqual(["a", "b", "c", "d"]);
    expect(rows[0]!.isCurrent).toBe(true);
    expect(rows[0]!.status).toBe("busy");
    expect(rows[0]!.liveToolTitle).toBe("bash");
    expect(rows[0]!.modelId).toBe("grok-4");
    expect(rows[0]!.effort).toBe("high");
    expect(rows[0]!.projectName).toBe("grok-app");
    expect(rows[0]!.projectPath).toBe("/Users/me/Code/grok-app");
    expect(rows[0]!.stoppable).toBe(true);

    expect(rows[1]!.status).toBe("permission");
    expect(rows[1]!.stoppable).toBe(true);

    const idleC = rows.find((r) => r.sessionId === "c")!;
    expect(idleC.status).toBe("idle");
    expect(idleC.projectName).toBe("Other chats");
    expect(idleC.projectPath).toBe(
      "/Users/me/.grok-app/workspaces/general",
    );
    expect(idleC.stoppable).toBe(false);

    expect(countBusyDashboardRows(rows)).toBe(2);
    expect(stoppableDashboardRows(rows).map((r) => r.sessionId)).toEqual([
      "a",
      "b",
    ]);
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
  ];

  it("filters by title / project / model", () => {
    expect(filterAgentDashboardRows(sample, "ci").map((r) => r.sessionId)).toEqual(
      ["a"],
    );
    expect(
      filterAgentDashboardRows(sample, "grok-3").map((r) => r.sessionId),
    ).toEqual(["b"]);
    expect(
      filterAgentDashboardRows(sample, "grok-app").map((r) => r.sessionId),
    ).toEqual(["a"]);
    expect(filterAgentDashboardRows(sample, "  ")).toHaveLength(2);
  });
});

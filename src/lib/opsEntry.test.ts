import { describe, expect, it } from "vitest";
import {
  OPS_ENTRY_DESTINATIONS,
  OPS_ENTRY_HUB_ACTION_ID,
  buildOpsEntryRows,
  isOpsPaletteActionId,
  opsEntryHintKey,
  opsEntryIdFromPaletteAction,
  opsEntryLabelKey,
  opsEntryPaletteActionId,
  resolveOpsEntryEmptyBanner,
  resolveOpsEntryMeta,
  type OpsEntryCounts,
} from "./opsEntry";

const idle: OpsEntryCounts = {
  busySessionCount: 0,
  sessionCount: 3,
  hasActiveSession: true,
  tasksRunningCount: 0,
};

describe("opsEntry catalog", () => {
  it("lists destinations in stable order", () => {
    expect([...OPS_ENTRY_DESTINATIONS]).toEqual([
      "tasks",
      "dashboard",
      "task_board",
      "batch_agents",
    ]);
  });

  it("maps destinations to palette action ids and back", () => {
    for (const id of OPS_ENTRY_DESTINATIONS) {
      const action = opsEntryPaletteActionId(id);
      expect(opsEntryIdFromPaletteAction(action)).toBe(id);
      expect(isOpsPaletteActionId(action)).toBe(true);
    }
    expect(opsEntryIdFromPaletteAction(OPS_ENTRY_HUB_ACTION_ID)).toBeNull();
    expect(isOpsPaletteActionId(OPS_ENTRY_HUB_ACTION_ID)).toBe(true);
    expect(opsEntryIdFromPaletteAction("doctor")).toBeNull();
    expect(isOpsPaletteActionId("doctor")).toBe(false);
  });

  it("uses stable label/hint keys per destination", () => {
    expect(opsEntryLabelKey("tasks")).toBe("ops.dest.tasks");
    expect(opsEntryHintKey("tasks")).toBe("ops.dest.tasksHint");
    expect(opsEntryLabelKey("dashboard")).toBe("ops.dest.dashboard");
    expect(opsEntryHintKey("dashboard")).toBe("ops.dest.dashboardHint");
    expect(opsEntryLabelKey("task_board")).toBe("ops.dest.taskBoard");
    expect(opsEntryHintKey("task_board")).toBe("ops.dest.taskBoardHint");
    expect(opsEntryLabelKey("batch_agents")).toBe("ops.dest.batchAgents");
    expect(opsEntryHintKey("batch_agents")).toBe("ops.dest.batchAgentsHint");
  });
});

describe("resolveOpsEntryMeta", () => {
  it("tasks: no session is empty honesty", () => {
    const meta = resolveOpsEntryMeta("tasks", {
      ...idle,
      hasActiveSession: false,
    });
    expect(meta.kind).toBe("tasks_no_session");
    expect(meta.empty).toBe(true);
    expect(meta.labelKey).toBe("ops.meta.tasksNoSession");
  });

  it("tasks: running count when known", () => {
    const meta = resolveOpsEntryMeta("tasks", {
      ...idle,
      tasksRunningCount: 2,
    });
    expect(meta).toMatchObject({
      kind: "tasks_running",
      empty: false,
      vars: { n: 2 },
    });
  });

  it("tasks: idle when open chat has explicit zero running tools", () => {
    const meta = resolveOpsEntryMeta("tasks", idle);
    expect(meta.kind).toBe("tasks_idle");
    expect(meta.empty).toBe(true);
  });

  it("tasks: ready when count is unknown (do not invent idle)", () => {
    const meta = resolveOpsEntryMeta("tasks", {
      busySessionCount: 0,
      sessionCount: 1,
      hasActiveSession: true,
      tasksRunningCount: null,
    });
    expect(meta.kind).toBe("tasks_ready");
    expect(meta.empty).toBe(false);
  });

  it("dashboard: busy vs idle", () => {
    expect(
      resolveOpsEntryMeta("dashboard", { ...idle, busySessionCount: 0 }).kind,
    ).toBe("dashboard_idle");
    expect(
      resolveOpsEntryMeta("dashboard", { ...idle, busySessionCount: 4 }),
    ).toMatchObject({
      kind: "dashboard_busy",
      vars: { n: 4 },
      empty: false,
    });
  });

  it("board: empty vs ready", () => {
    expect(
      resolveOpsEntryMeta("task_board", { ...idle, sessionCount: 0 }).kind,
    ).toBe("board_empty");
    expect(
      resolveOpsEntryMeta("task_board", { ...idle, sessionCount: 5 }),
    ).toMatchObject({
      kind: "board_ready",
      vars: { n: 5 },
      empty: false,
    });
  });

  it("batch is always ready (no invented counts)", () => {
    const meta = resolveOpsEntryMeta("batch_agents", idle);
    expect(meta.kind).toBe("batch_ready");
    expect(meta.empty).toBe(false);
  });

  it("clamps negative / non-finite counts to zero", () => {
    const meta = resolveOpsEntryMeta("dashboard", {
      busySessionCount: -3,
      sessionCount: Number.NaN,
      hasActiveSession: true,
      tasksRunningCount: -1,
    });
    expect(meta.kind).toBe("dashboard_idle");
  });
});

describe("buildOpsEntryRows", () => {
  it("returns one row per destination with palette routing", () => {
    const rows = buildOpsEntryRows(idle);
    expect(rows.map((r) => r.id)).toEqual([...OPS_ENTRY_DESTINATIONS]);
    expect(rows.map((r) => r.paletteActionId)).toEqual([
      "open-tasks",
      "open-agent-dashboard",
      "open-task-board",
      "open-batch-agents",
    ]);
    for (const row of rows) {
      expect(row.labelKey).toBe(opsEntryLabelKey(row.id));
      expect(row.hintKey).toBe(opsEntryHintKey(row.id));
      expect(row.meta).toEqual(resolveOpsEntryMeta(row.id, idle));
    }
  });
});

describe("resolveOpsEntryEmptyBanner", () => {
  it("no sessions", () => {
    expect(
      resolveOpsEntryEmptyBanner({
        busySessionCount: 0,
        sessionCount: 0,
        hasActiveSession: false,
      }),
    ).toEqual({
      kind: "no_sessions",
      titleKey: "ops.empty.noSessions",
      hintKey: "ops.empty.noSessionsHint",
    });
  });

  it("sessions but none busy", () => {
    expect(resolveOpsEntryEmptyBanner(idle)).toEqual({
      kind: "no_busy",
      titleKey: "ops.empty.noBusy",
      hintKey: "ops.empty.noBusyHint",
    });
  });

  it("null when fleet has busy work", () => {
    expect(
      resolveOpsEntryEmptyBanner({
        ...idle,
        busySessionCount: 2,
      }),
    ).toBeNull();
  });
});

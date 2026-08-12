/**
 * Ops unified entry — pure destination catalog, routing keys, and honesty meta.
 *
 * Surfaces already on main:
 * - Tasks panel (per-chat tools)
 * - Agent dashboard (fleet)
 * - Session task board
 * - Batch agents (dispatch)
 *
 * No invented metrics — counts are host/App-provided only.
 */

/** Stable destination ids for the Ops hub. */
export type OpsEntryDestinationId =
  | "tasks"
  | "dashboard"
  | "task_board"
  | "batch_agents";

/** Ordered catalog (hub rows + routing). */
export const OPS_ENTRY_DESTINATIONS: readonly OpsEntryDestinationId[] = [
  "tasks",
  "dashboard",
  "task_board",
  "batch_agents",
] as const;

/** Command-palette action ids that land on the same surfaces. */
export type OpsPaletteActionId =
  | "open-ops"
  | "open-tasks"
  | "open-agent-dashboard"
  | "open-task-board"
  | "open-batch-agents";

/** Hub open action — not a destination, opens the picker itself. */
export const OPS_ENTRY_HUB_ACTION_ID: OpsPaletteActionId = "open-ops";

/** Map a hub destination to its direct palette action id. */
export function opsEntryPaletteActionId(
  id: OpsEntryDestinationId,
): Exclude<OpsPaletteActionId, "open-ops"> {
  switch (id) {
    case "tasks":
      return "open-tasks";
    case "dashboard":
      return "open-agent-dashboard";
    case "task_board":
      return "open-task-board";
    case "batch_agents":
      return "open-batch-agents";
  }
}

/** Inverse: palette destination → hub id (null for open-ops / unknown). */
export function opsEntryIdFromPaletteAction(
  actionId: string,
): OpsEntryDestinationId | null {
  switch (actionId) {
    case "open-tasks":
      return "tasks";
    case "open-agent-dashboard":
      return "dashboard";
    case "open-task-board":
      return "task_board";
    case "open-batch-agents":
      return "batch_agents";
    default:
      return null;
  }
}

/** True when a palette id is the Ops hub or a destination. */
export function isOpsPaletteActionId(actionId: string): boolean {
  return (
    actionId === OPS_ENTRY_HUB_ACTION_ID ||
    opsEntryIdFromPaletteAction(actionId) != null
  );
}

/** Primary label i18n key for a destination. */
export function opsEntryLabelKey(
  id: OpsEntryDestinationId,
):
  | "ops.dest.tasks"
  | "ops.dest.dashboard"
  | "ops.dest.taskBoard"
  | "ops.dest.batchAgents" {
  switch (id) {
    case "tasks":
      return "ops.dest.tasks";
    case "dashboard":
      return "ops.dest.dashboard";
    case "task_board":
      return "ops.dest.taskBoard";
    case "batch_agents":
      return "ops.dest.batchAgents";
  }
}

/** Short description i18n key under the label. */
export function opsEntryHintKey(
  id: OpsEntryDestinationId,
):
  | "ops.dest.tasksHint"
  | "ops.dest.dashboardHint"
  | "ops.dest.taskBoardHint"
  | "ops.dest.batchAgentsHint" {
  switch (id) {
    case "tasks":
      return "ops.dest.tasksHint";
    case "dashboard":
      return "ops.dest.dashboardHint";
    case "task_board":
      return "ops.dest.taskBoardHint";
    case "batch_agents":
      return "ops.dest.batchAgentsHint";
  }
}

/** Live counts used only for honesty meta (never invent work). */
export type OpsEntryCounts = {
  /** Sessions that are busy / permission / connecting. */
  busySessionCount: number;
  /** Total sessions considered by the board/dashboard (non-negative). */
  sessionCount: number;
  /** Current chat is open (tasks panel needs a session id). */
  hasActiveSession: boolean;
  /** Running tool rows in the focused chat when known; omit when unknown. */
  tasksRunningCount?: number | null;
};

/** Per-row meta chip for empty / busy honesty. */
export type OpsEntryMetaKind =
  | "tasks_no_session"
  | "tasks_ready"
  | "tasks_idle"
  | "tasks_running"
  | "dashboard_idle"
  | "dashboard_busy"
  | "board_empty"
  | "board_ready"
  | "batch_ready";

export type OpsEntryMeta = {
  kind: OpsEntryMetaKind;
  /** i18n key for the meta line. */
  labelKey:
    | "ops.meta.tasksNoSession"
    | "ops.meta.tasksReady"
    | "ops.meta.tasksIdle"
    | "ops.meta.tasksRunning"
    | "ops.meta.dashboardIdle"
    | "ops.meta.dashboardBusy"
    | "ops.meta.boardEmpty"
    | "ops.meta.boardReady"
    | "ops.meta.batchReady";
  vars?: Record<string, string | number>;
  /** Soft-empty: surface is openable but has nothing active. */
  empty: boolean;
};

function nonNeg(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

/**
 * Honesty meta for one destination row.
 * Counts come from App/host only — never invent busy sessions or tools.
 */
export function resolveOpsEntryMeta(
  id: OpsEntryDestinationId,
  counts: OpsEntryCounts,
): OpsEntryMeta {
  const busy = nonNeg(counts.busySessionCount);
  const sessions = nonNeg(counts.sessionCount);
  const running = nonNeg(counts.tasksRunningCount);

  switch (id) {
    case "tasks": {
      if (!counts.hasActiveSession) {
        return {
          kind: "tasks_no_session",
          labelKey: "ops.meta.tasksNoSession",
          empty: true,
        };
      }
      // Only claim idle/running when App passed an explicit count.
      if (counts.tasksRunningCount == null) {
        return {
          kind: "tasks_ready",
          labelKey: "ops.meta.tasksReady",
          empty: false,
        };
      }
      if (running > 0) {
        return {
          kind: "tasks_running",
          labelKey: "ops.meta.tasksRunning",
          vars: { n: running },
          empty: false,
        };
      }
      return {
        kind: "tasks_idle",
        labelKey: "ops.meta.tasksIdle",
        empty: true,
      };
    }
    case "dashboard": {
      if (busy > 0) {
        return {
          kind: "dashboard_busy",
          labelKey: "ops.meta.dashboardBusy",
          vars: { n: busy },
          empty: false,
        };
      }
      return {
        kind: "dashboard_idle",
        labelKey: "ops.meta.dashboardIdle",
        empty: true,
      };
    }
    case "task_board": {
      if (sessions <= 0) {
        return {
          kind: "board_empty",
          labelKey: "ops.meta.boardEmpty",
          empty: true,
        };
      }
      return {
        kind: "board_ready",
        labelKey: "ops.meta.boardReady",
        vars: { n: sessions },
        empty: false,
      };
    }
    case "batch_agents":
      return {
        kind: "batch_ready",
        labelKey: "ops.meta.batchReady",
        empty: false,
      };
  }
}

export type OpsEntryRow = {
  id: OpsEntryDestinationId;
  /** Palette action to dispatch when the row is chosen. */
  paletteActionId: Exclude<OpsPaletteActionId, "open-ops">;
  labelKey: ReturnType<typeof opsEntryLabelKey>;
  hintKey: ReturnType<typeof opsEntryHintKey>;
  meta: OpsEntryMeta;
};

/** Build ordered hub rows with honesty meta. */
export function buildOpsEntryRows(counts: OpsEntryCounts): OpsEntryRow[] {
  return OPS_ENTRY_DESTINATIONS.map((id) => ({
    id,
    paletteActionId: opsEntryPaletteActionId(id),
    labelKey: opsEntryLabelKey(id),
    hintKey: opsEntryHintKey(id),
    meta: resolveOpsEntryMeta(id, counts),
  }));
}

/** Hub-level empty banner when the fleet is fully idle / empty. */
export type OpsEntryEmptyBanner =
  | {
      kind: "no_sessions";
      titleKey: "ops.empty.noSessions";
      hintKey: "ops.empty.noSessionsHint";
    }
  | {
      kind: "no_busy";
      titleKey: "ops.empty.noBusy";
      hintKey: "ops.empty.noBusyHint";
    };

/**
 * Optional banner above destination rows.
 * Returns null when there is busy work (no fleet-level empty story).
 */
export function resolveOpsEntryEmptyBanner(
  counts: OpsEntryCounts,
): OpsEntryEmptyBanner | null {
  const sessions = nonNeg(counts.sessionCount);
  const busy = nonNeg(counts.busySessionCount);
  if (sessions <= 0) {
    return {
      kind: "no_sessions",
      titleKey: "ops.empty.noSessions",
      hintKey: "ops.empty.noSessionsHint",
    };
  }
  if (busy <= 0) {
    return {
      kind: "no_busy",
      titleKey: "ops.empty.noBusy",
      hintKey: "ops.empty.noBusyHint",
    };
  }
  return null;
}

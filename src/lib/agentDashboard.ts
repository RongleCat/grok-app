/**
 * Cross-session Agent Dashboard row model.
 *
 * Distinct from AgentTasksPanel (per-turn tools): this aggregates App sessions
 * with Host liveMap snapshots for multi-session ops (focus / stop-all).
 * Host remains authoritative — no invented metrics.
 */

import type { SessionState } from "./session";
import type {
  SessionLiveMap,
  SessionLiveSnapshot,
} from "./sessionLiveStore";
import { isSessionLiveStreaming } from "./session";

/** Coarse UI status for dashboard rows. */
export type AgentDashboardStatus =
  | "busy"
  | "permission"
  | "connecting"
  | "idle"
  | "error";

export interface AgentDashboardSessionInput {
  id: string;
  title?: string | null;
  projectId?: string | null;
  updatedAt?: string | null;
  modelId?: string | null;
  effort?: string | null;
  archived?: boolean;
}

export interface AgentDashboardProjectInput {
  id: string;
  name: string;
  path: string;
}

export interface AgentDashboardRow {
  sessionId: string;
  title: string;
  projectId: string | null;
  /** Project display name, or null when unbound. */
  projectName: string | null;
  /** Project path / cwd when known. */
  projectPath: string | null;
  modelId: string | null;
  effort: string | null;
  status: AgentDashboardStatus;
  /** Running tool title from live projection, if any. */
  liveToolTitle: string | null;
  isCurrent: boolean;
  /**
   * Best-known last activity (ms epoch): liveMap.updatedAt when present,
   * else session.updatedAt. Used for sort + optional relative display.
   */
  lastActivityAt: number;
  /** Original session.updatedAt ISO when available. */
  updatedAtIso: string | null;
  /** True when Stop / Stop-all can target this row. */
  stoppable: boolean;
}

export type SessionDashboardLookup = AgentDashboardSessionInput;

/** Map Host / live session state into a dashboard status. */
export function mapDashboardStatus(
  snap: SessionLiveSnapshot | undefined | null,
): AgentDashboardStatus {
  if (!snap) return "idle";
  if (snap.awaitingPermission || snap.state === "awaiting_permission") {
    return "permission";
  }
  if (snap.state === "connecting") return "connecting";
  if (snap.state === "streaming" || isSessionLiveStreaming(snap.state)) {
    return "busy";
  }
  if (snap.state === "disconnected") return "error";
  return "idle";
}

/** True when the row should accept sessionStop. */
export function isStoppableDashboardStatus(
  status: AgentDashboardStatus,
): boolean {
  return (
    status === "busy" ||
    status === "permission" ||
    status === "connecting"
  );
}

function parseUpdatedMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function resolveStatusFromState(state: SessionState): AgentDashboardStatus {
  if (state === "awaiting_permission") return "permission";
  if (state === "connecting") return "connecting";
  if (state === "streaming") return "busy";
  if (state === "disconnected") return "error";
  return "idle";
}

/**
 * Build dashboard rows for active (busy/live) + recent non-archived sessions.
 *
 * - Busy / connecting / permission sessions always appear (even if missing from
 *   the sidebar list, with untitled fallback).
 * - Recent idle sessions fill up to `recentLimit` (default 40), newest first.
 * - Archived sessions are omitted unless currently live-busy.
 */
export function collectAgentDashboardRows(opts: {
  sessions: AgentDashboardSessionInput[];
  projects: AgentDashboardProjectInput[];
  liveMap: SessionLiveMap;
  currentSessionId?: string | null;
  untitledLabel?: string;
  /** Cap on non-busy rows. Busy rows are always included. Default 40. */
  recentLimit?: number;
  /** Path label for project-less sessions (general workspace). */
  generalWorkspacePath?: string | null;
  /** Display name when no project is bound. */
  unboundProjectLabel?: string | null;
}): AgentDashboardRow[] {
  const untitled = opts.untitledLabel || "Untitled";
  const recentLimit = opts.recentLimit ?? 40;
  const current = opts.currentSessionId || null;
  const projectById = new Map(
    opts.projects.map((p) => [p.id, p] as const),
  );
  const sessionById = new Map(opts.sessions.map((s) => [s.id, s] as const));

  const ids = new Set<string>();
  for (const s of opts.sessions) {
    if (!s.archived) ids.add(s.id);
  }
  // Always surface live busy/connecting/permission even if not in list yet.
  for (const [id, snap] of Object.entries(opts.liveMap)) {
    const status = mapDashboardStatus(snap);
    if (isStoppableDashboardStatus(status) || status === "error") {
      ids.add(id);
    }
  }

  const rows: AgentDashboardRow[] = [];
  for (const sessionId of ids) {
    const meta = sessionById.get(sessionId);
    const snap = opts.liveMap[sessionId];
    const status = mapDashboardStatus(snap);
    // Drop archived idle sessions (keep if live-busy / error).
    if (meta?.archived && !isStoppableDashboardStatus(status) && status !== "error") {
      continue;
    }
    const projectId = meta?.projectId ?? null;
    const project = projectId ? projectById.get(projectId) : undefined;
    const sessionUpdatedMs = parseUpdatedMs(meta?.updatedAt);
    const liveUpdatedMs = snap?.updatedAt ?? 0;
    const lastActivityAt = Math.max(sessionUpdatedMs, liveUpdatedMs);
    const title = (meta?.title || "").trim() || untitled;
    const projectPath =
      project?.path?.trim() ||
      (projectId ? null : opts.generalWorkspacePath?.trim() || null);
    const projectName =
      project?.name?.trim() ||
      (projectId
        ? null
        : opts.unboundProjectLabel?.trim() || null);

    rows.push({
      sessionId,
      title,
      projectId,
      projectName,
      projectPath,
      modelId: meta?.modelId ?? null,
      effort: meta?.effort ?? null,
      status,
      liveToolTitle: snap?.liveToolTitle ?? null,
      isCurrent: current != null && sessionId === current,
      lastActivityAt,
      updatedAtIso: meta?.updatedAt ?? null,
      stoppable: isStoppableDashboardStatus(status),
    });
  }

  // Sort: stoppable/busy first (newest), then error, then idle by activity.
  const rank = (s: AgentDashboardStatus): number => {
    if (s === "busy" || s === "permission" || s === "connecting") return 0;
    if (s === "error") return 1;
    return 2;
  };
  rows.sort((a, b) => {
    const ra = rank(a.status);
    const rb = rank(b.status);
    if (ra !== rb) return ra - rb;
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return b.lastActivityAt - a.lastActivityAt;
  });

  // Keep all busy/error; cap idle/recent.
  const out: AgentDashboardRow[] = [];
  let idleCount = 0;
  for (const row of rows) {
    if (row.status === "idle") {
      if (idleCount >= recentLimit) continue;
      idleCount += 1;
    }
    out.push(row);
  }
  return out;
}

/** Rows that accept Stop / Stop all. */
export function stoppableDashboardRows(
  rows: AgentDashboardRow[],
): AgentDashboardRow[] {
  return rows.filter((r) => r.stoppable);
}

/** Count of busy / permission / connecting rows. */
export function countBusyDashboardRows(rows: AgentDashboardRow[]): number {
  return rows.filter((r) => isStoppableDashboardStatus(r.status)).length;
}

/** Filter rows by free-text query (title, project, model, path, status). */
export function filterAgentDashboardRows(
  rows: AgentDashboardRow[],
  query: string,
): AgentDashboardRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => {
    const hay = [
      r.title,
      r.projectName || "",
      r.projectPath || "",
      r.modelId || "",
      r.effort || "",
      r.status,
      r.liveToolTitle || "",
      r.sessionId,
    ]
      .join("\n")
      .toLowerCase();
    return hay.includes(q);
  });
}

/** Exported for tests that assert state mapping without a full snapshot. */
export function dashboardStatusFromSessionState(
  state: SessionState,
): AgentDashboardStatus {
  return resolveStatusFromState(state);
}

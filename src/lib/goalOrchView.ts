/**
 * Goal orchestration — session-chrome indicator + view assembly.
 *
 * Soft session indicator (active vs waiting chip, never fake progress),
 * newest-event pick, and the view assembler used by Reliability /
 * session UI. Split from goalOrch.ts (1k-line budget); re-exported there.
 */
import {
  GOAL_ORCH_EVENT_MAX,
  filterGoalOrchByPhaseAndRole,
  filterGoalOrchEvents,
  type GoalConfigKeyPresence,
  type GoalOrchEvent,
  type GoalOrchPhase,
  type GoalOrchPhaseFilter,
  type GoalOrchView,
} from "./goalOrch";

/**
 * Newest observed event (ring is newest-first). Optional session filter.
 * Returns null when nothing observed — never invents a synthetic event.
 */
export function pickLatestGoalOrchEvent(
  list: readonly GoalOrchEvent[],
  sessionId?: string | null,
): GoalOrchEvent | null {
  const filtered = filterGoalOrchEvents(list, sessionId);
  return filtered[0] ?? null;
}

/** Max chars for session-chrome detail snippet (after redaction). */
export const GOAL_ORCH_CHIP_DETAIL_MAX = 48;

/** Compact session-chrome indicator (soft; no fake progress meter). */
export type GoalOrchSessionIndicator = {
  show: true;
  /**
   * `active` — real goal_updated observed.
   * `waiting` — composer goal mode on but harness has not emitted yet (honest empty).
   */
  kind: "active" | "waiting";
  phase: GoalOrchPhase;
  label: string;
  detail: string | null;
  progress: string | null;
  goalId: string | null;
  at: number;
};

/**
 * Truncate an already-redacted detail line for the session chip label.
 * Returns null when empty — never invents progress text.
 */
export function formatGoalOrchChipDetail(
  detail: string | null | undefined,
  max: number = GOAL_ORCH_CHIP_DETAIL_MAX,
): string | null {
  if (detail == null) return null;
  const t = detail.replace(/\s+/g, " ").trim();
  if (!t) return null;
  const cap = Math.max(1, Math.floor(max));
  if (t.length <= cap) return t;
  return `${t.slice(0, Math.max(1, cap - 1))}…`;
}

/**
 * Soft session indicator:
 * - real `goal_updated` → active chip with phase / progress / detail
 * - composer `goalMode` on but no events yet → waiting chip (never fake progress)
 * Hidden when UI is off and not in goal mode.
 */
export function resolveGoalOrchSessionIndicator(input: {
  uiEnabled: boolean;
  events: readonly GoalOrchEvent[];
  sessionId?: string | null;
  /** Product composer /goal mode — waiting chip only when true and no events. */
  goalMode?: boolean | null;
  /** Clock for waiting-chip `at` (pure/tests). Defaults to Date.now(). */
  nowMs?: number;
}): GoalOrchSessionIndicator | null {
  if (!input.uiEnabled && !input.goalMode) return null;
  const latest = pickLatestGoalOrchEvent(input.events, input.sessionId);
  if (latest) {
    return {
      show: true,
      kind: "active",
      phase: latest.phase,
      label: latest.label || latest.phase,
      detail: latest.detail || null,
      progress: latest.deliverableProgress,
      goalId: latest.goalId,
      at: latest.at,
    };
  }
  if (input.goalMode && input.uiEnabled) {
    const at =
      typeof input.nowMs === "number" && Number.isFinite(input.nowMs)
        ? input.nowMs
        : Date.now();
    return {
      show: true,
      kind: "waiting",
      phase: "status",
      label: "waiting",
      detail: null,
      progress: null,
      goalId: null,
      at,
    };
  }
  return null;
}

export function assembleGoalOrchView(opts: {
  events: readonly GoalOrchEvent[];
  sessionId?: string | null;
  phase?: GoalOrchPhaseFilter | null;
  role?: string | null;
  configKeys?: GoalConfigKeyPresence[];
  max?: number;
}): GoalOrchView {
  const max = opts.max ?? GOAL_ORCH_EVENT_MAX;
  const filtered = filterGoalOrchByPhaseAndRole(opts.events, {
    sessionId: opts.sessionId,
    phase: opts.phase,
    role: opts.role,
  }).slice(0, max);
  const latestByPhase: Partial<Record<GoalOrchPhase, GoalOrchEvent>> = {};
  for (const e of filtered) {
    if (!latestByPhase[e.phase]) latestByPhase[e.phase] = e;
  }
  const configKeys = opts.configKeys ?? [];
  const hasConfigKeys = configKeys.some((k) => k.present);
  return {
    events: filtered,
    count: filtered.length,
    empty: filtered.length === 0,
    latestByPhase,
    configKeys,
    hasConfigKeys,
  };
}
/**
 * Goal orchestration (CLI 0.2.117+) — pure parse + UI projection.
 *
 * The Grok Build goal harness can emit ACP `session/update` with
 * `sessionUpdate: "goal_updated"` (classifier / planner / strategist /
 * verifier roles and progress fields). This module:
 * - Soft-parses those updates (snake_case + camelCase)
 * - Projects a compact phase timeline for Reliability / session UI
 * - Detects optional `goal_*` config keys when config text is available
 * - Holds an in-memory ring of observed events (never invents goals)
 *
 * Honest empty state: when the CLI does not emit goal events, the UI
 * shows “no goal events” — never fake progress.
 */

import { redact } from "./redact";

/** Max events kept in the session-local ring (newest first). */
export const GOAL_ORCH_EVENT_MAX = 40;

/** Max characters kept in a detail line after redaction. */
export const GOAL_ORCH_DETAIL_MAX = 200;

/** Display-only pref (localStorage). Default on. */
export const GOAL_ORCH_UI_STORAGE_KEY = "grok.goalOrchUiEnabled";

/** Fired on `window` after a successful save (detail = boolean). */
export const GOAL_ORCH_UI_CHANGE_EVENT = "grok-goal-orch-ui-change";

export const DEFAULT_GOAL_ORCH_UI_ENABLED = true;

/** Known CLI goal harness phase roles (from GoalUpdated.current_subagent_role). */
export type GoalOrchPhase =
  | "planner"
  | "strategist"
  | "classifier"
  | "verifier"
  | "summarizer"
  | "worker"
  | "status"
  | "unknown";

export type GoalOrchEventSource =
  | "host"
  | "acp_ndjson"
  | "tool"
  | "config"
  | "synthetic";

export type GoalOrchEvent = {
  id: string;
  /** Epoch ms when recorded (local). */
  at: number;
  phase: GoalOrchPhase;
  /** Short label for list row (role / status). */
  label: string;
  /** Redacted detail (objective snippet, deliverable title, verdict, …). */
  detail: string;
  source: GoalOrchEventSource;
  sessionId: string | null;
  goalId: string | null;
  /** Best-effort role string from the wire. */
  role: string | null;
  /** Deliverable progress when known. */
  deliverableProgress: string | null;
  verifyingCompletion: boolean | null;
  lastClassifierVerdict: string | null;
  /** Raw sessionUpdate kind when known. */
  sessionUpdate: string | null;
};

export type GoalOrchHostPayload = {
  sessionId?: string | null;
  goalId?: string | null;
  goal_id?: string | null;
  currentSubagentRole?: string | null;
  current_subagent_role?: string | null;
  currentDeliverableTitle?: string | null;
  current_deliverable_title?: string | null;
  completedDeliverables?: number | null;
  completed_deliverables?: number | null;
  totalDeliverables?: number | null;
  total_deliverables?: number | null;
  verifyingCompletion?: boolean | null;
  verifying_completion?: boolean | null;
  lastClassifierVerdict?: string | null;
  last_classifier_verdict?: string | null;
  classifierRunsAttempted?: number | null;
  classifier_runs_attempted?: number | null;
  classifierMaxRuns?: number | null;
  classifier_max_runs?: number | null;
  totalWorkerRounds?: number | null;
  total_worker_rounds?: number | null;
  totalVerifyRounds?: number | null;
  total_verify_rounds?: number | null;
  objective?: string | null;
  status?: string | null;
  detail?: string | null;
  update?: unknown;
  raw?: unknown;
  [key: string]: unknown;
};

/** Allowlisted goal_* keys observed in CLI config / managed flags. */
export const GOAL_CONFIG_KEY_NAMES = [
  "goal_enabled",
  "goal_classifier_enabled",
  "goal_planner_enabled",
  "goal_summary_enabled",
  "goal_verifier_count",
  "goal_classifier_max_runs",
  "goal_strategist_every",
  "goal_planner_model",
  "goal_strategist_model",
  "goal_skeptic_models",
] as const;

export type GoalConfigKeyName = (typeof GOAL_CONFIG_KEY_NAMES)[number];

export type GoalConfigKeyPresence = {
  key: GoalConfigKeyName;
  /** Raw value text when present (never invent defaults). */
  value: string | null;
  present: boolean;
};

export type GoalOrchView = {
  events: GoalOrchEvent[];
  count: number;
  empty: boolean;
  /** Latest event per phase (for compact chips). */
  latestByPhase: Partial<Record<GoalOrchPhase, GoalOrchEvent>>;
  configKeys: GoalConfigKeyPresence[];
  hasConfigKeys: boolean;
};

export interface GoalOrchUiStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): GoalOrchUiStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function str(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t ? t : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return null;
}

function pick(
  obj: Record<string, unknown>,
  ...keys: string[]
): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function clipDetail(raw: string): string {
  const red = redact(raw).replace(/\s+/g, " ").trim();
  if (red.length <= GOAL_ORCH_DETAIL_MAX) return red;
  return `${red.slice(0, GOAL_ORCH_DETAIL_MAX - 1)}…`;
}

/** Map wire role / status strings → stable phase id. */
export function mapGoalRoleToPhase(role: string | null | undefined): GoalOrchPhase {
  if (!role) return "unknown";
  const r = role.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!r) return "unknown";
  if (r.includes("plan")) return "planner";
  if (r.includes("strateg")) return "strategist";
  if (r.includes("classif")) return "classifier";
  if (r.includes("skeptic") || r.includes("verif")) return "verifier";
  if (r.includes("summar")) return "summarizer";
  if (
    r.includes("worker") ||
    r.includes("implement") ||
    r.includes("agent")
  ) {
    return "worker";
  }
  if (
    r.includes("pause") ||
    r.includes("resume") ||
    r.includes("complete") ||
    r.includes("clear") ||
    r.includes("active") ||
    r.includes("status")
  ) {
    return "status";
  }
  return "unknown";
}

/**
 * True when a sessionUpdate kind (or tool title) looks goal-related.
 * Soft recognition only — never invents goal state.
 */
export function isGoalRelatedSessionUpdate(kind: string | null | undefined): boolean {
  if (!kind) return false;
  const k = kind.trim().toLowerCase();
  if (!k) return false;
  if (k === "goal_updated" || k === "goalupdated") return true;
  if (k.startsWith("goal_")) return true;
  if (k.includes("goal") && (k.includes("update") || k.includes("orch"))) {
    return true;
  }
  return false;
}

export function isGoalRelatedTool(titleOrName: string | null | undefined): boolean {
  if (!titleOrName) return false;
  const t = titleOrName.trim().toLowerCase();
  return (
    t === "update_goal" ||
    t.includes("update_goal") ||
    t === "goal" ||
    t.startsWith("goal ")
  );
}

export type ParsedGoalUpdated = {
  sessionUpdate: string;
  goalId: string | null;
  role: string | null;
  phase: GoalOrchPhase;
  currentDeliverableTitle: string | null;
  completedDeliverables: number | null;
  totalDeliverables: number | null;
  verifyingCompletion: boolean | null;
  lastClassifierVerdict: string | null;
  classifierRunsAttempted: number | null;
  classifierMaxRuns: number | null;
  totalWorkerRounds: number | null;
  totalVerifyRounds: number | null;
  objective: string | null;
  status: string | null;
  detail: string;
};

/**
 * Parse a `goal_updated` (or similar) ACP update object.
 * Accepts the bare update body or full `session/update` params.
 */
export function parseGoalUpdatedUpdate(
  input: unknown,
): ParsedGoalUpdated | null {
  if (!isRecord(input)) return null;

  // Unwrap common envelopes: { update: {...} } | { params: { update } }
  let body: Record<string, unknown> = input;
  if (isRecord(input.update)) {
    body = input.update;
  } else if (isRecord(input.params)) {
    const p = input.params;
    if (isRecord(p.update)) body = p.update;
    else body = p;
  }

  const sessionUpdate =
    str(pick(body, "sessionUpdate", "session_update", "kind", "type")) ?? "";
  const lower = sessionUpdate.toLowerCase();

  // Also accept bare GoalUpdated payloads without sessionUpdate tag when
  // goal_id / current_subagent_role are present (host-forwarded partials).
  const hasGoalShape =
    pick(body, "goalId", "goal_id") != null ||
    pick(body, "currentSubagentRole", "current_subagent_role") != null ||
    pick(body, "verifyingCompletion", "verifying_completion") != null ||
    pick(body, "lastClassifierVerdict", "last_classifier_verdict") != null ||
    pick(body, "totalDeliverables", "total_deliverables") != null;

  if (
    sessionUpdate &&
    !isGoalRelatedSessionUpdate(sessionUpdate) &&
    !hasGoalShape
  ) {
    return null;
  }
  if (!sessionUpdate && !hasGoalShape) return null;
  // Reject pure non-goal shapes that only match hasGoalShape loosely —
  // require at least one strong goal field.
  if (
    !isGoalRelatedSessionUpdate(sessionUpdate || "goal_updated") &&
    pick(body, "goalId", "goal_id") == null &&
    pick(body, "currentSubagentRole", "current_subagent_role") == null &&
    pick(body, "verifyingCompletion", "verifying_completion") == null &&
    pick(body, "lastClassifierVerdict", "last_classifier_verdict") == null
  ) {
    // total_deliverables alone is weak; still allow goal_updated kind.
    if (lower !== "goal_updated" && lower !== "goalupdated") return null;
  }

  const goalId = str(pick(body, "goalId", "goal_id"));
  const role = str(
    pick(body, "currentSubagentRole", "current_subagent_role", "role"),
  );
  const status = str(pick(body, "status", "state", "goal_status", "goalStatus"));
  const objective = str(pick(body, "objective", "goal", "title"));
  const currentDeliverableTitle = str(
    pick(body, "currentDeliverableTitle", "current_deliverable_title"),
  );
  const completedDeliverables = num(
    pick(body, "completedDeliverables", "completed_deliverables"),
  );
  const totalDeliverables = num(
    pick(body, "totalDeliverables", "total_deliverables"),
  );
  const verifyingCompletion = bool(
    pick(body, "verifyingCompletion", "verifying_completion"),
  );
  const lastClassifierVerdict = str(
    pick(body, "lastClassifierVerdict", "last_classifier_verdict", "verdict"),
  );
  const classifierRunsAttempted = num(
    pick(body, "classifierRunsAttempted", "classifier_runs_attempted"),
  );
  const classifierMaxRuns = num(
    pick(body, "classifierMaxRuns", "classifier_max_runs"),
  );
  const totalWorkerRounds = num(
    pick(body, "totalWorkerRounds", "total_worker_rounds"),
  );
  const totalVerifyRounds = num(
    pick(body, "totalVerifyRounds", "total_verify_rounds"),
  );

  let phase = mapGoalRoleToPhase(role);
  if (phase === "unknown" && verifyingCompletion === true) {
    phase = "classifier";
  }
  if (phase === "unknown" && status) {
    phase = mapGoalRoleToPhase(status);
  }
  if (phase === "unknown" && (objective || goalId || hasGoalShape)) {
    phase = "status";
  }

  const parts: string[] = [];
  if (status) parts.push(status);
  if (currentDeliverableTitle) parts.push(currentDeliverableTitle);
  if (
    completedDeliverables != null &&
    totalDeliverables != null &&
    totalDeliverables > 0
  ) {
    parts.push(`${completedDeliverables}/${totalDeliverables}`);
  }
  if (verifyingCompletion === true) parts.push("verifying");
  if (lastClassifierVerdict) parts.push(`verdict=${lastClassifierVerdict}`);
  if (
    classifierRunsAttempted != null &&
    classifierMaxRuns != null
  ) {
    parts.push(`classifier ${classifierRunsAttempted}/${classifierMaxRuns}`);
  }
  if (objective) parts.push(objective);
  if (parts.length === 0 && role) parts.push(role);

  return {
    sessionUpdate: sessionUpdate || "goal_updated",
    goalId,
    role,
    phase,
    currentDeliverableTitle,
    completedDeliverables,
    totalDeliverables,
    verifyingCompletion,
    lastClassifierVerdict,
    classifierRunsAttempted,
    classifierMaxRuns,
    totalWorkerRounds,
    totalVerifyRounds,
    objective,
    status,
    detail: clipDetail(parts.join(" · ")),
  };
}

/** Build a ring entry from a host `session://goal` payload. */
export function goalEventFromHostPayload(
  payload: GoalOrchHostPayload | null | undefined,
  nowMs: number = Date.now(),
): GoalOrchEvent | null {
  if (!payload || !isRecord(payload as object)) return null;

  const update =
    payload.update ??
    payload.raw ??
    payload;
  const parsed = parseGoalUpdatedUpdate(update) ?? parseGoalUpdatedUpdate(payload);
  if (!parsed) {
    // Soft tool-shaped fallback when host only forwarded a title.
    const title =
      str(payload.detail) ??
      str((payload as { title?: unknown }).title) ??
      str((payload as { toolName?: unknown }).toolName);
    if (!isGoalRelatedTool(title)) return null;
    return {
      id: `goal-tool-${nowMs}`,
      at: nowMs,
      phase: "status",
      label: title || "update_goal",
      detail: clipDetail(str(payload.detail) ?? title ?? ""),
      source: "tool",
      sessionId: str(payload.sessionId),
      goalId: str(payload.goalId) ?? str(payload.goal_id),
      role: null,
      deliverableProgress: null,
      verifyingCompletion: null,
      lastClassifierVerdict: null,
      sessionUpdate: null,
    };
  }

  const sessionId = str(payload.sessionId);
  const goalId = parsed.goalId ?? str(payload.goalId) ?? str(payload.goal_id);
  const progress =
    parsed.completedDeliverables != null && parsed.totalDeliverables != null
      ? `${parsed.completedDeliverables}/${parsed.totalDeliverables}`
      : null;

  const label =
    parsed.role ||
    parsed.status ||
    (parsed.verifyingCompletion ? "verifying" : null) ||
    parsed.phase;

  return {
    id: `goal-${goalId ?? "x"}-${parsed.phase}-${nowMs}`,
    at: nowMs,
    phase: parsed.phase,
    label,
    detail: parsed.detail,
    source: "host",
    sessionId,
    goalId,
    role: parsed.role,
    deliverableProgress: progress,
    verifyingCompletion: parsed.verifyingCompletion,
    lastClassifierVerdict: parsed.lastClassifierVerdict,
    sessionUpdate: parsed.sessionUpdate,
  };
}

/** Prepend into a capped ring (newest first); de-dupe by id. */
export function prependGoalOrchEvent(
  list: readonly GoalOrchEvent[],
  item: GoalOrchEvent,
  max: number = GOAL_ORCH_EVENT_MAX,
): GoalOrchEvent[] {
  const cap = Math.max(0, Math.floor(max));
  if (cap === 0) return [];
  const rest = list.filter((x) => x.id !== item.id);
  return [item, ...rest].slice(0, cap);
}

/** Filter ring to one session (null = all). */
export function filterGoalOrchEvents(
  list: readonly GoalOrchEvent[],
  sessionId?: string | null,
): GoalOrchEvent[] {
  if (!sessionId) return [...list];
  return list.filter((e) => e.sessionId === sessionId);
}

/** Phase chip filter: `"all"` or a concrete {@link GoalOrchPhase}. */
export type GoalOrchPhaseFilter = GoalOrchPhase | "all";

/**
 * Filter observed goal events by session, phase, and/or role substring.
 * Never invents events — only projects the ring.
 */
export function filterGoalOrchByPhaseAndRole(
  list: readonly GoalOrchEvent[],
  opts?: {
    sessionId?: string | null;
    phase?: GoalOrchPhaseFilter | null;
    role?: string | null;
  },
): GoalOrchEvent[] {
  let out = filterGoalOrchEvents(list, opts?.sessionId);
  const phase = opts?.phase;
  if (phase && phase !== "all") {
    out = out.filter((e) => e.phase === phase);
  }
  const roleQ = (opts?.role ?? "").trim().toLowerCase();
  if (roleQ) {
    out = out.filter((e) => {
      const role = (e.role ?? "").toLowerCase();
      const label = (e.label ?? "").toLowerCase();
      return role.includes(roleQ) || label.includes(roleQ);
    });
  }
  return out;
}

/** True when phase chip or role query narrows the list. */
export function hasActiveGoalOrchFilters(opts?: {
  phase?: GoalOrchPhaseFilter | null;
  role?: string | null;
}): boolean {
  const phase = opts?.phase;
  if (phase && phase !== "all") return true;
  if ((opts?.role ?? "").trim()) return true;
  return false;
}

/**
 * Phases that appear in the event list, ordered by pipeline order.
 * Used for phase chips (never invent phases with zero observed events
 * beyond the always-present "all" chip in UI).
 */
export function phasesPresentInEvents(
  list: readonly GoalOrchEvent[],
): GoalOrchPhase[] {
  const seen = new Set<GoalOrchPhase>();
  for (const e of list) seen.add(e.phase);
  return GOAL_ORCH_PHASE_ORDER.filter((p) => seen.has(p));
}

/** Empty-state kinds for Reliability Goal section (legacy 3-way). */
export type GoalOrchEmptyKind = "ui_off" | "no_events" | "filtered";

/**
 * Unified control-panel empty kinds (includes session-scoped mismatch).
 * Prefer {@link resolveGoalControlEmptyState} for new UI paths.
 */
export type GoalControlEmptyKind =
  | "ui_off"
  | "no_events"
  | "filtered"
  | "session_mismatch";

export type GoalOrchEmptyPresentation = {
  kind: GoalOrchEmptyKind;
  /** i18n key — callers pass through `t()`. */
  titleKey:
    | "reliability.goal.empty"
    | "reliability.goal.emptyFilter"
    | "reliability.goal.uiOff";
  hintKey:
    | "reliability.goal.lead"
    | "reliability.goal.emptyFilterHint"
    | "reliability.goal.uiOffHint";
  showClearFilters: boolean;
};

export type GoalControlEmptyPresentation = {
  kind: GoalControlEmptyKind;
  /** i18n key — callers pass through `t()`. */
  titleKey:
    | "reliability.goal.empty"
    | "reliability.goal.emptyFilter"
    | "reliability.goal.uiOff"
    | "reliability.goal.emptySessionMismatch";
  hintKey:
    | "reliability.goal.lead"
    | "reliability.goal.emptyFilterHint"
    | "reliability.goal.uiOffHint"
    | "reliability.goal.emptySessionMismatchHint";
  showClearFilters: boolean;
};

/**
 * Resolve empty-state presentation for the Goal orchestration section.
 * Returns `null` when there are filtered events to list.
 * Honest: never claims progress when the CLI emitted nothing.
 */
export function resolveGoalOrchEmptyState(input: {
  uiEnabled: boolean;
  /** Count after session filter, before phase/role filter. */
  totalCount: number;
  /** Count after phase/role filter. */
  filteredCount: number;
  phaseFilter?: GoalOrchPhaseFilter | null;
  role?: string | null;
}): GoalOrchEmptyPresentation | null {
  const unified = resolveGoalControlEmptyState({
    uiEnabled: input.uiEnabled,
    totalCount: input.totalCount,
    filteredCount: input.filteredCount,
    phaseFilter: input.phaseFilter,
    role: input.role,
  });
  if (!unified) return null;
  // Legacy API never returns session_mismatch (no ring/session inputs).
  if (unified.kind === "session_mismatch") {
    return {
      kind: "no_events",
      titleKey: "reliability.goal.empty",
      hintKey: "reliability.goal.lead",
      showClearFilters: false,
    };
  }
  return {
    kind: unified.kind,
    titleKey: unified.titleKey as GoalOrchEmptyPresentation["titleKey"],
    hintKey: unified.hintKey as GoalOrchEmptyPresentation["hintKey"],
    showClearFilters: unified.showClearFilters,
  };
}

/**
 * Unified empty-state for Goal control surfaces (Reliability + session chip).
 * Returns `null` when there are events to list after filters.
 *
 * Keys:
 * - `ui_off` — display pref hides the panel
 * - `no_events` — ring (or session slice) has zero observed events
 * - `filtered` — phase/role chips hid every row
 * - `session_mismatch` — ring has events, but none for the active session
 *
 * Never invents progress when the CLI emitted nothing.
 */
export function resolveGoalControlEmptyState(input: {
  uiEnabled: boolean;
  /**
   * Count after optional session filter, before phase/role filter.
   * For session-scoped UIs this is the current-session slice.
   */
  totalCount: number;
  /** Count after phase/role filter. */
  filteredCount: number;
  phaseFilter?: GoalOrchPhaseFilter | null;
  role?: string | null;
  /**
   * Full ring length (any session). When set and greater than `totalCount`
   * with a session scope active, empty session → `session_mismatch`.
   */
  ringCount?: number | null;
  /** When true (or sessionId provided), allow session_mismatch vs no_events. */
  sessionScoped?: boolean | null;
  sessionId?: string | null;
}): GoalControlEmptyPresentation | null {
  if (!input.uiEnabled) {
    return {
      kind: "ui_off",
      titleKey: "reliability.goal.uiOff",
      hintKey: "reliability.goal.uiOffHint",
      showClearFilters: false,
    };
  }
  if (input.filteredCount > 0) return null;

  const scoped =
    input.sessionScoped === true ||
    (typeof input.sessionId === "string" && input.sessionId.trim().length > 0);
  const ring =
    typeof input.ringCount === "number" && Number.isFinite(input.ringCount)
      ? Math.max(0, Math.floor(input.ringCount))
      : null;

  if (input.totalCount === 0) {
    if (scoped && ring != null && ring > 0) {
      return {
        kind: "session_mismatch",
        titleKey: "reliability.goal.emptySessionMismatch",
        hintKey: "reliability.goal.emptySessionMismatchHint",
        showClearFilters: false,
      };
    }
    return {
      kind: "no_events",
      titleKey: "reliability.goal.empty",
      hintKey: "reliability.goal.lead",
      showClearFilters: false,
    };
  }

  // Had events for this scope, but phase/role filters hid them all.
  return {
    kind: "filtered",
    titleKey: "reliability.goal.emptyFilter",
    hintKey: "reliability.goal.emptyFilterHint",
    showClearFilters: hasActiveGoalOrchFilters({
      phase: input.phaseFilter,
      role: input.role,
    }),
  };
}

/** Plan result for wiping the in-memory goal orch event ring. */
export type ClearGoalOrchPlan = {
  /** Always empty — local clear only (no host RPC). */
  next: GoalOrchEvent[];
  /** How many events would be removed. */
  cleared: number;
};

/**
 * Plan clearing the local goal orchestration timeline (pure).
 * Does **not** call the CLI or host — only wipes the App-side ring.
 * Composer `/goal` mode (`goalMode` / planBar clear) is independent.
 */
export function planClearGoalOrchEvents(
  events: readonly GoalOrchEvent[] | null | undefined,
): ClearGoalOrchPlan {
  const list = Array.isArray(events) ? events : [];
  return { next: [], cleared: list.length };
}

/**
 * Default: confirm clear when there is at least one observed event.
 * (Threshold is inclusive lower bound: count >= min → confirm.)
 */
export const GOAL_ORCH_CLEAR_CONFIRM_MIN = 1;

/**
 * Whether clearing the local goal timeline should open an in-app confirm
 * (GlassModal) — never `window.confirm`.
 */
export function shouldConfirmClearGoalOrch(
  count: number,
  min: number = GOAL_ORCH_CLEAR_CONFIRM_MIN,
): boolean {
  if (!Number.isFinite(count) || count <= 0) return false;
  const threshold =
    Number.isFinite(min) && min >= 0
      ? Math.floor(min)
      : GOAL_ORCH_CLEAR_CONFIRM_MIN;
  return count >= threshold;
}

/**
 * Soft: whether the plan-bar "Clear goal" control should be available.
 * Host path is local only — toggles composer `goalMode` off (no RPC).
 * Independent of the goal orch event ring.
 */
export function canClearGoalBar(opts: {
  goalMode?: boolean | null;
  /** When plan bar model is already in goal chrome. */
  barShowsGoal?: boolean | null;
}): boolean {
  return opts.goalMode === true || opts.barShowsGoal === true;
}

/**
 * Plain-text, redacted summary for clipboard export.
 * Uses already-redacted event detail fields; re-runs redact for safety.
 * Never invents events — empty list → short honest header only.
 */
export function formatGoalOrchSummaryText(
  events: readonly GoalOrchEvent[],
  opts?: {
    title?: string;
    maxEvents?: number;
    /** ISO or locale string for "generated at"; omit to skip. */
    generatedAt?: string | null;
  },
): string {
  const title = (opts?.title ?? "Goal orchestration").trim() || "Goal orchestration";
  const max = Math.max(0, Math.floor(opts?.maxEvents ?? GOAL_ORCH_EVENT_MAX));
  const slice = events.slice(0, max);
  const lines: string[] = [
    title,
    `events: ${slice.length}` +
      (events.length > slice.length ? ` (of ${events.length})` : ""),
  ];
  if (opts?.generatedAt) {
    lines.push(`generated: ${opts.generatedAt}`);
  }
  lines.push("");
  if (slice.length === 0) {
    lines.push("(no goal_updated events observed)");
    return lines.join("\n");
  }
  for (const e of slice) {
    const when = Number.isFinite(e.at)
      ? new Date(e.at).toISOString()
      : String(e.at);
    const parts = [
      when,
      e.phase,
      e.label ? clipDetail(e.label) : null,
      e.deliverableProgress ? `progress=${e.deliverableProgress}` : null,
      e.goalId ? `goal=${clipDetail(e.goalId)}` : null,
      e.sessionId ? `session=${clipDetail(e.sessionId.slice(0, 12))}` : null,
    ].filter(Boolean);
    lines.push(`- ${parts.join(" · ")}`);
    if (e.detail) {
      lines.push(`  ${clipDetail(e.detail)}`);
    }
  }
  return lines.join("\n");
}

/**
 * Redacted one-pager for control-panel copy (session chip / Reliability).
 * Phase tallies + latest line + the same event list as
 * {@link formatGoalOrchSummaryText}. Never invents progress.
 */
export function buildGoalControlSummary(
  events: readonly GoalOrchEvent[],
  opts?: {
    title?: string;
    maxEvents?: number;
    generatedAt?: string | null;
  },
): string {
  const title =
    (opts?.title ?? "Goal orchestration").trim() || "Goal orchestration";
  const list = Array.isArray(events) ? events : [];
  const max = Math.max(0, Math.floor(opts?.maxEvents ?? GOAL_ORCH_EVENT_MAX));
  const slice = list.slice(0, max);

  const phaseCounts = new Map<GoalOrchPhase, number>();
  for (const e of slice) {
    phaseCounts.set(e.phase, (phaseCounts.get(e.phase) ?? 0) + 1);
  }
  const phaseLine =
    phaseCounts.size > 0
      ? GOAL_ORCH_PHASE_ORDER.filter((p) => phaseCounts.has(p))
          .map((p) => `${p}=${phaseCounts.get(p)}`)
          .join(" ")
      : "(none)";

  const latest = slice[0] ?? null;
  const header: string[] = [
    title,
    `events: ${slice.length}` +
      (list.length > slice.length ? ` (of ${list.length})` : ""),
    `phases: ${phaseLine}`,
  ];
  if (opts?.generatedAt) {
    header.push(`generated: ${opts.generatedAt}`);
  }
  if (latest) {
    const when = Number.isFinite(latest.at)
      ? new Date(latest.at).toISOString()
      : String(latest.at);
    header.push(
      `latest: ${when} · ${latest.phase}` +
        (latest.deliverableProgress
          ? ` · progress=${latest.deliverableProgress}`
          : "") +
        (latest.label ? ` · ${clipDetail(latest.label)}` : ""),
    );
  } else {
    header.push("latest: (none)");
  }
  header.push("");
  // Reuse list body (without re-emitting title/events header).
  const body = formatGoalOrchSummaryText(list, {
    title: "_",
    maxEvents: max,
  });
  const bodyLines = body.split("\n");
  // Drop title + events line + blank from formatGoalOrchSummaryText.
  const rest = bodyLines.slice(3);
  return [...header, ...rest].join("\n");
}

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

/**
 * Scan config.toml (or similar) for known `goal_*` keys.
 * Missing keys → present:false (never invent CLI defaults).
 */
export function parseGoalConfigKeys(
  text: string | null | undefined,
): GoalConfigKeyPresence[] {
  const src = text ?? "";
  const out: GoalConfigKeyPresence[] = [];
  for (const key of GOAL_CONFIG_KEY_NAMES) {
    // Match `key = value` or `key=value` at line start (allow spaces).
    const re = new RegExp(
      `^\\s*${key}\\s*=\\s*(.+?)\\s*(?:#.*)?$`,
      "im",
    );
    const m = src.match(re);
    if (m) {
      let value = (m[1] ?? "").trim();
      // Strip surrounding quotes.
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      out.push({ key, value: value || null, present: true });
    } else {
      out.push({ key, value: null, present: false });
    }
  }
  return out;
}

/** True when any allowlisted goal_* key appears in config text. */
export function configHasGoalKeys(text: string | null | undefined): boolean {
  return parseGoalConfigKeys(text).some((k) => k.present);
}

// ── Display pref ────────────────────────────────────────────────────────────

export function parseGoalOrchUiEnabled(raw: unknown): boolean {
  if (raw === "0" || raw === "false" || raw === false) return false;
  if (raw === "1" || raw === "true" || raw === true) return true;
  return DEFAULT_GOAL_ORCH_UI_ENABLED;
}

export function loadGoalOrchUiEnabled(
  storage: GoalOrchUiStorage = defaultStorage(),
): boolean {
  try {
    return parseGoalOrchUiEnabled(storage.getItem(GOAL_ORCH_UI_STORAGE_KEY));
  } catch {
    return DEFAULT_GOAL_ORCH_UI_ENABLED;
  }
}

export function saveGoalOrchUiEnabled(
  enabled: boolean,
  storage: GoalOrchUiStorage = defaultStorage(),
): void {
  try {
    storage.setItem(GOAL_ORCH_UI_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(GOAL_ORCH_UI_CHANGE_EVENT, { detail: enabled }),
      );
    } catch {
      /* ignore */
    }
  }
}

/** Phase order for compact chips (orchestration pipeline). */
export const GOAL_ORCH_PHASE_ORDER: readonly GoalOrchPhase[] = [
  "planner",
  "strategist",
  "worker",
  "classifier",
  "verifier",
  "summarizer",
  "status",
  "unknown",
] as const;

export function phaseSortIndex(phase: GoalOrchPhase): number {
  const i = GOAL_ORCH_PHASE_ORDER.indexOf(phase);
  return i < 0 ? GOAL_ORCH_PHASE_ORDER.length : i;
}

/** i18n message key for a phase chip / row label. */
export function goalOrchPhaseLabelKey(
  phase: GoalOrchPhase,
):
  | "reliability.goal.phase.planner"
  | "reliability.goal.phase.strategist"
  | "reliability.goal.phase.classifier"
  | "reliability.goal.phase.verifier"
  | "reliability.goal.phase.summarizer"
  | "reliability.goal.phase.worker"
  | "reliability.goal.phase.status"
  | "reliability.goal.phase.unknown" {
  switch (phase) {
    case "planner":
      return "reliability.goal.phase.planner";
    case "strategist":
      return "reliability.goal.phase.strategist";
    case "classifier":
      return "reliability.goal.phase.classifier";
    case "verifier":
      return "reliability.goal.phase.verifier";
    case "summarizer":
      return "reliability.goal.phase.summarizer";
    case "worker":
      return "reliability.goal.phase.worker";
    case "status":
      return "reliability.goal.phase.status";
    default:
      return "reliability.goal.phase.unknown";
  }
}

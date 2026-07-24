/**
 * Pure helpers for Plan / Goal status bar (L04).
 *
 * Plan entries come from ACP `sessionUpdate: plan` (content + status).
 * Load state / mode chips are separate from the in-thread plan card.
 */

export type PlanEntryStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "unknown";

export type PlanEntry = {
  content: string;
  status: PlanEntryStatus;
  priority?: string | null;
};

export type PlanProgress = {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  cancelled: number;
  /** 0–100; 0 when total is 0 */
  percent: number;
  /** First in_progress entry, else first pending, else last completed. */
  current: PlanEntry | null;
};

export type PlanBarKind =
  | "hidden"
  | "goal"
  | "plan_mode"
  | "plan_progress"
  | "plan_review";

export type PlanBarModel = {
  kind: PlanBarKind;
  progress: PlanProgress;
  /** Short headline for the bar */
  headlineKey:
    | "planBar.goal"
    | "planBar.planMode"
    | "planBar.progress"
    | "planBar.review"
    | "planBar.done";
  currentLabel: string;
  showActions: boolean;
};

const COMPLETED = new Set(["completed", "complete", "done", "success"]);
const IN_PROGRESS = new Set([
  "in_progress",
  "in-progress",
  "running",
  "active",
  "doing",
]);
const PENDING = new Set(["pending", "todo", "open", "not_started", ""]);
const CANCELLED = new Set(["cancelled", "canceled", "skipped", "abandoned"]);

/** Normalize ACP / agent status strings into a fixed set. */
export function normalizePlanEntryStatus(
  raw: string | null | undefined,
): PlanEntryStatus {
  const s = (raw ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (COMPLETED.has(s)) return "completed";
  if (IN_PROGRESS.has(s)) return "in_progress";
  if (CANCELLED.has(s)) return "cancelled";
  if (PENDING.has(s)) return "pending";
  if (!s) return "pending";
  return "unknown";
}

/** Parse one plan entry from ACP JSON (object or string). */
export function parsePlanEntry(raw: unknown): PlanEntry | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const content = raw.trim();
    if (!content) return null;
    return { content, status: "pending" };
  }
  if (typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const content = String(
    o.content ?? o.title ?? o.text ?? o.description ?? "",
  ).trim();
  if (!content) return null;
  const status = normalizePlanEntryStatus(
    o.status != null ? String(o.status) : null,
  );
  const priority =
    o.priority != null && String(o.priority).trim()
      ? String(o.priority).trim()
      : null;
  return { content, status, priority };
}

export function parsePlanEntries(raw: unknown): PlanEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: PlanEntry[] = [];
  for (const item of raw) {
    const e = parsePlanEntry(item);
    if (e) out.push(e);
  }
  return out;
}

export function computePlanProgress(entries: PlanEntry[]): PlanProgress {
  const total = entries.length;
  let completed = 0;
  let inProgress = 0;
  let pending = 0;
  let cancelled = 0;
  for (const e of entries) {
    if (e.status === "completed") completed += 1;
    else if (e.status === "in_progress") inProgress += 1;
    else if (e.status === "cancelled") cancelled += 1;
    else pending += 1; // pending + unknown count as not done
  }
  const denom = total;
  const percent =
    denom === 0 ? 0 : Math.min(100, Math.round((completed / denom) * 100));

  let current: PlanEntry | null =
    entries.find((e) => e.status === "in_progress") ?? null;
  if (!current) {
    current = entries.find((e) => e.status === "pending" || e.status === "unknown") ?? null;
  }
  if (!current && completed > 0) {
    current = [...entries].reverse().find((e) => e.status === "completed") ?? null;
  }

  return {
    total,
    completed,
    inProgress,
    pending,
    cancelled,
    percent,
    current,
  };
}

/**
 * Decide what the sticky bar should show.
 * Priority: review gate → live progress → plan card idle → plan mode → goal → hidden.
 */
export function resolvePlanBarModel(input: {
  goalMode: boolean;
  mode: string;
  planVisible: boolean;
  planWaiting: boolean;
  planRpcId?: number | null;
  entries: unknown[];
}): PlanBarModel {
  const parsed = parsePlanEntries(input.entries);
  const progress = computePlanProgress(parsed);
  const hasEntries = progress.total > 0;
  const canAct = input.planRpcId != null;

  // exit_plan_mode pending — user must approve / revise.
  if (input.planVisible && canAct) {
    return {
      kind: "plan_review",
      progress,
      headlineKey: "planBar.review",
      currentLabel: progress.current?.content ?? "",
      showActions: true,
    };
  }

  // Live step list (while planning, after approve, or mid-execution).
  if (hasEntries) {
    const allDone =
      progress.completed + progress.cancelled >= progress.total &&
      progress.inProgress === 0 &&
      progress.pending === 0;
    return {
      kind: "plan_progress",
      progress,
      headlineKey: allDone ? "planBar.done" : "planBar.progress",
      currentLabel: progress.current?.content ?? "",
      showActions: false,
    };
  }

  // Card visible but only markdown body so far.
  if (input.planVisible) {
    return {
      kind: "plan_progress",
      progress,
      headlineKey: input.planWaiting ? "planBar.planMode" : "planBar.review",
      currentLabel: "",
      showActions: false,
    };
  }

  if (input.mode === "plan") {
    return {
      kind: "plan_mode",
      progress,
      headlineKey: "planBar.planMode",
      currentLabel: "",
      showActions: false,
    };
  }

  if (input.goalMode) {
    return {
      kind: "goal",
      progress,
      headlineKey: "planBar.goal",
      currentLabel: "",
      showActions: false,
    };
  }

  return {
    kind: "hidden",
    progress,
    headlineKey: "planBar.planMode",
    currentLabel: "",
    showActions: false,
  };
}

/** Whether the sticky bar should render. */
export function shouldShowPlanBar(model: PlanBarModel): boolean {
  return model.kind !== "hidden";
}

/** Compact fraction label "2/5". */
export function formatPlanFraction(progress: PlanProgress): string {
  if (progress.total <= 0) return "";
  return `${progress.completed}/${progress.total}`;
}

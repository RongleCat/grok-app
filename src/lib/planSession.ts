/**
 * Session-scoped plan chrome (top bar + resource Plan panel).
 *
 * Lifecycle (per session id):
 * 1. Idle — no plan UI (`visible: false`, empty body/entries).
 * 2. Live — `session://plan` events fill body/entries; bar shows progress/review.
 * 3. Soft UI actions (approve / request changes) hide review gate but may keep steps.
 * 4. User dismiss (with confirm) — **hard close**: clear chrome, set `userClosed`.
 *    Reopening the session restores the closed state (no bar / no panel body).
 * 5. New plan cycle only un-closes: a **new** plan `toolCallId`, or a **new**
 *    `exit_plan_mode` `rpcId` (not the one abandoned on dismiss).
 *    Residual updates while still in composer plan mode must NOT resurrect
 *    the dismissed cycle.
 */

export type SessionPlanState = {
  title: string;
  body: string;
  entries: unknown[];
  waiting: boolean;
  visible: boolean;
  rpcId: number | null;
  toolCallId: string | null;
  /**
   * Soft-hide top bar only (legacy). Hard dismiss clears content instead;
   * kept for approve/progress transitions that hide without abandoning history.
   */
  barDismissed: boolean;
  /**
   * User confirmed dismiss for this plan cycle. Suppresses further plan events
   * until a new cycle is detected.
   */
  userClosed: boolean;
  /** toolCallId at hard-dismiss time — same id = same cycle, keep suppressed. */
  closedToolCallId: string | null;
  /**
   * exit_plan_mode rpcId abandoned on hard-dismiss. Same id must not re-open
   * the review panel after the user confirmed close.
   */
  closedRpcId: number | null;
  /**
   * Host process died while a gate was open (or chrome reloaded after restart).
   * Approve is disabled until a live re-park rpcId arrives.
   */
  gateStale: boolean;
  /**
   * Agent `plan_mode.json` reports `awaiting_plan_approval` — Build will re-park
   * exit_plan_mode after session/load. UI shows resume chrome without a live rpcId.
   */
  awaitingAgentApproval: boolean;
};

/** Host-persisted plan chrome (camelCase wire). */
export type PlanChromeStored = {
  title?: string;
  body?: string;
  entries?: unknown;
  waiting?: boolean;
  visible?: boolean;
  rpcId?: number | null;
  toolCallId?: string | null;
  barDismissed?: boolean;
  userClosed?: boolean;
  closedToolCallId?: string | null;
  closedRpcId?: number | null;
  gateStale?: boolean;
  awaitingAgentApproval?: boolean;
  updatedAt?: string;
};

/** Agent-side plan_mode.json + plan.md snapshot. */
export type AgentPlanSnapshot = {
  found?: boolean;
  awaitingPlanApproval?: boolean;
  planModeState?: string | null;
  planBody?: string | null;
  planPath?: string | null;
  agentSessionId?: string | null;
};

export type PlanEventPayload = {
  entries?: unknown[];
  body?: string | null;
  rpcId?: number | null;
  toolCallId?: string | null;
  waiting?: boolean;
};

export function emptySessionPlan(
  title = "Plan ready for review",
): SessionPlanState {
  return {
    title,
    body: "",
    entries: [],
    waiting: true,
    visible: false,
    rpcId: null,
    toolCallId: null,
    barDismissed: false,
    userClosed: false,
    closedToolCallId: null,
    closedRpcId: null,
    gateStale: false,
    awaitingAgentApproval: false,
  };
}

/** Hard-closed empty plan for a session after user confirms dismiss. */
export function closedSessionPlan(
  title = "Plan ready for review",
  closedToolCallId: string | null = null,
  closedRpcId: number | null = null,
): SessionPlanState {
  return {
    ...emptySessionPlan(title),
    userClosed: true,
    closedToolCallId,
    closedRpcId,
    barDismissed: true,
  };
}

/**
 * Agent process died / recycled while a plan gate was open.
 * Drop Approve / request-changes (dead rpcId) but keep body/entries as
 * read-only so the user can still open Resources → Plan history of the draft.
 * Does **not** set `userClosed` — a resume re-park with a **new** rpcId may reopen.
 */
export function invalidatePlanGate(prev: SessionPlanState): SessionPlanState {
  // Only an open exit_plan_mode reverse-RPC can Approve into a dead process.
  // Default empty chrome uses waiting=true without rpcId — leave it alone.
  if (prev.rpcId == null && !prev.awaitingAgentApproval) {
    return prev;
  }
  const hasBody = !!(prev.body && prev.body.trim()) || prev.entries.length > 0;
  return {
    ...prev,
    rpcId: null,
    waiting: false,
    gateStale: true,
    awaitingAgentApproval: prev.awaitingAgentApproval,
    // Keep chrome visible when there is content to browse; otherwise hide.
    visible: hasBody ? prev.visible : false,
    barDismissed: hasBody ? prev.barDismissed : true,
  };
}

/**
 * Restore plan chrome after App restart / session open.
 * Host chrome is authoritative for userClosed; agent snapshot fills body +
 * awaiting_plan_approval when Build still has a parked approval.
 * Never restores a live rpcId (reverse-RPC dies with the process).
 */
export function restorePlanFromPersistence(
  chrome: PlanChromeStored | null | undefined,
  agent: AgentPlanSnapshot | null | undefined,
  readyTitle: string,
): SessionPlanState {
  const base = emptySessionPlan(readyTitle);
  if (!chrome && !agent?.found && !agent?.planBody && !agent?.awaitingPlanApproval) {
    return base;
  }

  const entries = Array.isArray(chrome?.entries)
    ? (chrome!.entries as unknown[])
    : [];
  let body = (chrome?.body ?? "").trim();
  if (!body && agent?.planBody) {
    body = String(agent.planBody).trim();
  }

  const userClosed = !!chrome?.userClosed;
  const awaitingAgent =
    !!agent?.awaitingPlanApproval || !!chrome?.awaitingAgentApproval;
  const gateStale =
    !!chrome?.gateStale ||
    (awaitingAgent && !userClosed) ||
    (!!chrome?.rpcId && !userClosed);

  if (userClosed && !awaitingAgent) {
    return {
      ...closedSessionPlan(
        readyTitle,
        chrome?.closedToolCallId ?? chrome?.toolCallId ?? null,
        chrome?.closedRpcId ?? null,
      ),
      body: body || "",
      entries,
      gateStale: false,
      awaitingAgentApproval: false,
    };
  }

  const hasContent = !!body || entries.length > 0;
  if (!hasContent && !awaitingAgent) {
    return base;
  }

  return {
    title: (chrome?.title || "").trim() || readyTitle,
    body,
    entries,
    waiting: !awaitingAgent,
    visible: !userClosed && (hasContent || awaitingAgent),
    rpcId: null,
    toolCallId: chrome?.toolCallId != null ? String(chrome.toolCallId) : null,
    barDismissed: !!chrome?.barDismissed && !awaitingAgent,
    userClosed: false,
    closedToolCallId: null,
    closedRpcId: null,
    gateStale: gateStale || awaitingAgent,
    awaitingAgentApproval: awaitingAgent,
  };
}

/** Serialize UI plan state for Host plan_chrome.json. */
export function planStateToStored(plan: SessionPlanState): PlanChromeStored {
  return {
    title: plan.title,
    body: plan.body,
    entries: plan.entries,
    waiting: plan.waiting,
    visible: plan.visible,
    rpcId: plan.rpcId,
    toolCallId: plan.toolCallId,
    barDismissed: plan.barDismissed,
    userClosed: plan.userClosed,
    closedToolCallId: plan.closedToolCallId,
    closedRpcId: plan.closedRpcId,
    gateStale: plan.gateStale,
    awaitingAgentApproval: plan.awaitingAgentApproval,
    updatedAt: new Date().toISOString(),
  };
}

/** True when UI should show “waiting for agent re-park / reconnect” copy. */
export function planNeedsResumeHint(
  plan: Pick<
    SessionPlanState,
    "rpcId" | "gateStale" | "awaitingAgentApproval" | "visible" | "userClosed"
  >,
): boolean {
  if (plan.userClosed || plan.rpcId != null) return false;
  return (
    plan.visible &&
    (plan.gateStale || plan.awaitingAgentApproval)
  );
}

/**
 * Sidebar / dashboard badge: session needs human plan review.
 * Live exit_plan_mode rpcId, or restored awaiting re-park chrome.
 * Does not affect click / busy spinner / approve handlers.
 */
export function sessionHasPendingPlanReview(
  plan: Pick<
    SessionPlanState,
    | "rpcId"
    | "visible"
    | "userClosed"
    | "gateStale"
    | "awaitingAgentApproval"
  > | null | undefined,
): boolean {
  if (!plan || plan.userClosed) return false;
  if (plan.rpcId != null) return true;
  return planNeedsResumeHint(plan);
}

/**
 * Update a session-id set used for sidebar badges without forcing a new Set
 * when membership is unchanged (keeps memoized rows stable).
 */
export function applyPlanPendingMembership(
  prev: ReadonlySet<string>,
  sessionId: string | null | undefined,
  plan: Parameters<typeof sessionHasPendingPlanReview>[0],
): Set<string> {
  const sid = sessionId?.trim();
  if (!sid) return prev instanceof Set ? prev : new Set(prev);
  const pending = sessionHasPendingPlanReview(plan);
  const had = prev.has(sid);
  if (pending === had) {
    return prev instanceof Set ? prev : new Set(prev);
  }
  const next = new Set(prev);
  if (pending) next.add(sid);
  else next.delete(sid);
  return next;
}

function normalizeToolCallId(
  toolCallId: string | null | undefined,
): string | null {
  if (toolCallId == null) return null;
  const t = String(toolCallId).trim();
  return t || null;
}

/**
 * Whether a plan event should reopen UI after the user hard-closed this cycle.
 *
 * Important: merely remaining in composer `plan` mode is NOT enough to reopen.
 * Residual `session://plan` updates from the dismissed cycle (same toolCallId,
 * no new rpcId) would otherwise resurrect the bar + resource Plan panel.
 */
export function shouldReopenClosedPlan(
  prev: SessionPlanState,
  p: PlanEventPayload,
  _composerMode: string,
): boolean {
  if (!prev.userClosed) return true;

  // New exit_plan_mode gate (must surface for approve/revise) — but not the
  // same rpc the user just abandoned on dismiss.
  if (p.rpcId != null && p.rpcId !== prev.closedRpcId) return true;

  // New plan tool invocation (different toolCallId than the one we closed).
  const tid = normalizeToolCallId(p.toolCallId ?? null);
  if (tid && tid !== prev.closedToolCallId) return true;

  return false;
}

/**
 * Merge a `session://plan` payload into previous session plan state.
 * Honors hard-dismiss suppression until a new plan cycle.
 */
export function mergePlanFromEvent(
  prev: SessionPlanState,
  p: PlanEventPayload,
  readyTitle: string,
  composerMode = "agent",
): SessionPlanState {
  if (prev.userClosed && !shouldReopenClosedPlan(prev, p, composerMode)) {
    return prev;
  }

  // body is real planContent only — entries render as the structured step
  // list, so duplicating them into body showed the same list twice.
  const displayBody = (p.body || "").trim();
  const entries = Array.isArray(p.entries) ? p.entries : [];

  // Preserve exit_plan_mode rpcId across later sessionUpdate plan
  // notifications (those arrive with rpcId=null and would otherwise
  // disable Approve / Request changes — see #17).
  // After hard-close, do not inherit a stale rpcId from prev.
  const rpcId =
    p.rpcId != null
      ? p.rpcId
      : prev.userClosed
        ? null
        : prev.visible
          ? (prev.rpcId ?? null)
          : null;

  const toolCallId =
    p.toolCallId != null
      ? String(p.toolCallId)
      : prev.userClosed
        ? null
        : prev.visible
          ? (prev.toolCallId ?? null)
          : null;

  const liveRpc = rpcId != null;
  return {
    title: readyTitle,
    body: displayBody || (prev.visible && !prev.userClosed ? prev.body : ""),
    entries:
      entries.length > 0
        ? entries
        : prev.visible && !prev.userClosed
          ? prev.entries
          : [],
    waiting: rpcId == null && !prev.awaitingAgentApproval,
    visible: true,
    rpcId,
    toolCallId,
    barDismissed: false,
    userClosed: false,
    closedToolCallId: null,
    closedRpcId: null,
    // Fresh reverse-RPC clears stale/resume flags.
    gateStale: liveRpc ? false : prev.gateStale,
    awaitingAgentApproval: liveRpc ? false : prev.awaitingAgentApproval,
  };
}

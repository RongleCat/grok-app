import { describe, expect, it } from "vitest";
import {
  applyPlanPendingMembership,
  closedSessionPlan,
  emptySessionPlan,
  invalidatePlanGate,
  mergePlanFromEvent,
  planNeedsResumeHint,
  restorePlanFromPersistence,
  sessionHasPendingPlanReview,
  shouldReopenClosedPlan,
} from "./planSession";

describe("planSession hard dismiss", () => {
  it("empty plan is not visible", () => {
    const p = emptySessionPlan("t");
    expect(p.visible).toBe(false);
    expect(p.userClosed).toBe(false);
    expect(p.entries).toEqual([]);
    expect(p.closedRpcId).toBeNull();
  });

  it("closed plan stays suppressed for same-cycle updates", () => {
    const closed = closedSessionPlan("t", "tool-1");
    expect(
      shouldReopenClosedPlan(
        closed,
        { toolCallId: "tool-1", entries: [{ content: "step", status: "pending" }] },
        "agent",
      ),
    ).toBe(false);

    const next = mergePlanFromEvent(
      closed,
      { toolCallId: "tool-1", entries: [{ content: "step", status: "in_progress" }] },
      "ready",
      "agent",
    );
    expect(next.userClosed).toBe(true);
    expect(next.visible).toBe(false);
    expect(next.entries).toEqual([]);
  });

  it("stays suppressed while composer is still plan mode (same cycle)", () => {
    // Hard-dismiss while still in plan mode used to reopen on every residual
    // session://plan update because composerMode === "plan".
    const closed = closedSessionPlan("t", "tool-1", 7);
    expect(
      shouldReopenClosedPlan(
        closed,
        {
          toolCallId: "tool-1",
          entries: [{ content: "a", status: "in_progress" }],
        },
        "plan",
      ),
    ).toBe(false);

    const next = mergePlanFromEvent(
      closed,
      {
        toolCallId: "tool-1",
        entries: [{ content: "a", status: "completed" }],
        body: "# leftover",
      },
      "ready",
      "plan",
    );
    expect(next.userClosed).toBe(true);
    expect(next.visible).toBe(false);
    expect(next.body).toBe("");
    expect(next.entries).toEqual([]);
  });

  it("does not reopen the abandoned exit_plan_mode rpcId", () => {
    const closed = closedSessionPlan("t", "tool-1", 42);
    expect(
      shouldReopenClosedPlan(
        closed,
        { rpcId: 42, body: "# Plan\n..." },
        "plan",
      ),
    ).toBe(false);

    const next = mergePlanFromEvent(
      closed,
      { rpcId: 42, body: "# Plan\n..." },
      "ready",
      "plan",
    );
    expect(next.userClosed).toBe(true);
    expect(next.visible).toBe(false);
  });

  it("reopens on new toolCallId (new plan tool)", () => {
    const closed = closedSessionPlan("t", "tool-1");
    const next = mergePlanFromEvent(
      closed,
      {
        toolCallId: "tool-2",
        entries: [{ content: "new", status: "pending" }],
      },
      "ready",
      "agent",
    );
    expect(next.userClosed).toBe(false);
    expect(next.visible).toBe(true);
    expect(next.toolCallId).toBe("tool-2");
  });

  it("reopens on a new exit_plan_mode rpcId", () => {
    const closed = closedSessionPlan("t", "tool-1", 7);
    const next = mergePlanFromEvent(
      closed,
      { rpcId: 42, body: "# Plan\n..." },
      "ready",
      "agent",
    );
    expect(next.userClosed).toBe(false);
    expect(next.visible).toBe(true);
    expect(next.rpcId).toBe(42);
  });

  it("entries-only updates do not duplicate steps into body", () => {
    const next = mergePlanFromEvent(
      emptySessionPlan("t"),
      {
        toolCallId: "tool-1",
        entries: [
          { content: "scan repo", status: "completed" },
          { content: "apply patch", status: "in_progress" },
        ],
      },
      "ready",
      "agent",
    );
    expect(next.visible).toBe(true);
    expect(next.entries).toHaveLength(2);
    // Panel renders entries as the step list; body must stay real planContent.
    expect(next.body).toBe("");
    // A later real planContent still fills body.
    const withBody = mergePlanFromEvent(
      next,
      { toolCallId: "tool-1", body: "# Plan\nfull text", entries: [] },
      "ready",
      "agent",
    );
    expect(withBody.body).toContain("full text");
    expect(withBody.entries).toHaveLength(2);
  });

  it("invalidatePlanGate drops rpcId but keeps body for read-only review", () => {
    const live = mergePlanFromEvent(
      emptySessionPlan("t"),
      { rpcId: 9, body: "# Draft\n1. step", toolCallId: "tc-1" },
      "ready",
      "plan",
    );
    expect(live.rpcId).toBe(9);
    expect(live.visible).toBe(true);
    const dead = invalidatePlanGate(live);
    expect(dead.rpcId).toBeNull();
    expect(dead.waiting).toBe(false);
    expect(dead.body).toContain("Draft");
    expect(dead.visible).toBe(true);
    expect(dead.userClosed).toBe(false);
    // Resume re-park with a new rpcId may reopen actions.
    const reparked = mergePlanFromEvent(
      dead,
      { rpcId: 99, body: "# Draft\n1. step", toolCallId: "exit-plan-mode-resume-x" },
      "ready",
      "plan",
    );
    expect(reparked.rpcId).toBe(99);
    expect(reparked.visible).toBe(true);
  });

  it("invalidatePlanGate is a no-op when no gate is open", () => {
    const idle = emptySessionPlan("t");
    expect(invalidatePlanGate(idle)).toBe(idle);
  });

  it("restorePlanFromPersistence rebuilds body without live rpcId", () => {
    const restored = restorePlanFromPersistence(
      {
        body: "# Draft\n1. a",
        entries: [{ content: "a", status: "pending" }],
        visible: true,
        rpcId: 99,
        gateStale: false,
        userClosed: false,
      },
      { found: true, awaitingPlanApproval: true, planBody: "# Draft\n1. a" },
      "ready",
    );
    expect(restored.rpcId).toBeNull();
    expect(restored.visible).toBe(true);
    expect(restored.body).toContain("Draft");
    expect(restored.awaitingAgentApproval).toBe(true);
    expect(restored.gateStale).toBe(true);
    expect(planNeedsResumeHint(restored)).toBe(true);
  });

  it("restorePlanFromPersistence honors hard-closed chrome", () => {
    const restored = restorePlanFromPersistence(
      {
        body: "# old",
        userClosed: true,
        closedToolCallId: "tc-1",
        closedRpcId: 7,
        visible: false,
      },
      { found: false, awaitingPlanApproval: false },
      "ready",
    );
    expect(restored.userClosed).toBe(true);
    expect(restored.visible).toBe(false);
    expect(planNeedsResumeHint(restored)).toBe(false);
  });

  it("agent plan.md alone can restore read-only chrome when awaiting", () => {
    const restored = restorePlanFromPersistence(
      null,
      {
        found: true,
        awaitingPlanApproval: true,
        planBody: "# From agent\n",
      },
      "ready",
    );
    expect(restored.visible).toBe(true);
    expect(restored.body).toContain("From agent");
    expect(restored.rpcId).toBeNull();
    expect(planNeedsResumeHint(restored)).toBe(true);
  });

  it("sessionHasPendingPlanReview tracks live gate and resume chrome only", () => {
    expect(sessionHasPendingPlanReview(emptySessionPlan("t"))).toBe(false);
    expect(
      sessionHasPendingPlanReview({
        ...emptySessionPlan("t"),
        rpcId: 3,
        visible: true,
      }),
    ).toBe(true);
    expect(
      sessionHasPendingPlanReview({
        ...emptySessionPlan("t"),
        visible: true,
        gateStale: true,
        awaitingAgentApproval: true,
      }),
    ).toBe(true);
    expect(
      sessionHasPendingPlanReview({
        ...closedSessionPlan("t", "tc", 1),
        rpcId: 9,
      }),
    ).toBe(false);
  });

  it("applyPlanPendingMembership is stable when membership unchanged", () => {
    const prev = new Set(["a"]);
    const same = applyPlanPendingMembership(
      prev,
      "a",
      { ...emptySessionPlan("t"), rpcId: 1, visible: true },
    );
    expect(same).toBe(prev);
    const cleared = applyPlanPendingMembership(prev, "a", emptySessionPlan("t"));
    expect(cleared.has("a")).toBe(false);
    expect(cleared).not.toBe(prev);
  });

  it("reopens new tool while still in plan mode", () => {
    const closed = closedSessionPlan("t", "tool-1", 7);
    const next = mergePlanFromEvent(
      closed,
      {
        toolCallId: "tool-2",
        entries: [{ content: "fresh", status: "pending" }],
      },
      "ready",
      "plan",
    );
    expect(next.userClosed).toBe(false);
    expect(next.visible).toBe(true);
    expect(next.toolCallId).toBe("tool-2");
  });
});

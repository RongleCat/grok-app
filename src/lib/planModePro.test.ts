import { describe, expect, it } from "vitest";
import {
  planHasExpandableContent,
  planPanelInnerEmptyLabelKey,
  resolvePlanPanelInnerEmpty,
  resolvePlanResourceEmptyState,
  shouldAutoLeavePlanSideMode,
  shouldExitComposerPlanModeAfterDecision,
  shouldOfferOpenInResources,
  shouldOfferOpenInResourcesFromModel,
  shouldOpenPlanSideTab,
  shouldShowPlanChromeButton,
} from "./planModePro";

describe("resolvePlanResourceEmptyState", () => {
  const base = {
    planVisible: false,
    planEnabled: true,
    userClosed: false,
    composerMode: "agent",
    hasHistory: false,
  };

  it("returns null when a live plan is visible", () => {
    expect(
      resolvePlanResourceEmptyState({ ...base, planVisible: true }),
    ).toBeNull();
  });

  it("surfaces disabled settings before other kinds", () => {
    const p = resolvePlanResourceEmptyState({
      ...base,
      planEnabled: false,
      composerMode: "plan",
      userClosed: true,
    });
    expect(p?.kind).toBe("disabled");
    expect(p?.titleKey).toBe("plan.emptyDisabledTitle");
    expect(p?.hintKey).toBe("plan.emptyDisabledHint");
    expect(p?.showHistoryCta).toBe(false);
  });

  it("shows history CTA when disabled but archive exists", () => {
    const p = resolvePlanResourceEmptyState({
      ...base,
      planEnabled: false,
      hasHistory: true,
    });
    expect(p?.kind).toBe("disabled");
    expect(p?.showHistoryCta).toBe(true);
  });

  it("shows user_closed after hard dismiss", () => {
    const p = resolvePlanResourceEmptyState({
      ...base,
      userClosed: true,
      hasHistory: true,
    });
    expect(p?.kind).toBe("user_closed");
    expect(p?.titleKey).toBe("plan.emptyClosedTitle");
    expect(p?.hintKey).toBe("plan.emptyClosedHint");
    expect(p?.showHistoryCta).toBe(true);
  });

  it("shows plan_mode waiting while composer is in plan", () => {
    const p = resolvePlanResourceEmptyState({
      ...base,
      composerMode: "plan",
    });
    expect(p?.kind).toBe("plan_mode");
    expect(p?.titleKey).toBe("plan.waiting");
    expect(p?.hintKey).toBe("plan.emptyPlanModeHint");
  });

  it("is case-insensitive for composer plan mode", () => {
    const p = resolvePlanResourceEmptyState({
      ...base,
      composerMode: "Plan",
    });
    expect(p?.kind).toBe("plan_mode");
  });

  it("idle without history uses generic resources.planEmpty", () => {
    const p = resolvePlanResourceEmptyState(base);
    expect(p?.kind).toBe("idle");
    expect(p?.titleKey).toBe("resources.plan");
    expect(p?.hintKey).toBe("resources.planEmpty");
    expect(p?.showHistoryCta).toBe(false);
  });

  it("idle with history offers archive CTA + idle hint", () => {
    const p = resolvePlanResourceEmptyState({ ...base, hasHistory: true });
    expect(p?.kind).toBe("idle");
    expect(p?.hintKey).toBe("plan.emptyIdleHint");
    expect(p?.showHistoryCta).toBe(true);
  });
});

describe("shouldOfferOpenInResources", () => {
  it("offers for review always", () => {
    expect(
      shouldOfferOpenInResources({ barKind: "plan_review", planVisible: true }),
    ).toBe(true);
    expect(
      shouldOfferOpenInResources({
        barKind: "plan_review",
        planVisible: false,
      }),
    ).toBe(true);
  });

  it("offers progress only when planVisible", () => {
    expect(
      shouldOfferOpenInResources({
        barKind: "plan_progress",
        planVisible: true,
      }),
    ).toBe(true);
    expect(
      shouldOfferOpenInResources({
        barKind: "plan_progress",
        planVisible: false,
      }),
    ).toBe(false);
  });

  it("offers plan_mode so empty/waiting is reachable", () => {
    expect(
      shouldOfferOpenInResources({ barKind: "plan_mode", planVisible: false }),
    ).toBe(true);
  });

  it("never offers for goal / hidden", () => {
    expect(
      shouldOfferOpenInResources({ barKind: "goal", planVisible: false }),
    ).toBe(false);
    expect(
      shouldOfferOpenInResources({ barKind: "hidden", planVisible: false }),
    ).toBe(false);
  });

  it("reads kind from bar model", () => {
    expect(
      shouldOfferOpenInResourcesFromModel(
        { kind: "plan_mode" },
        false,
      ),
    ).toBe(true);
  });
});

describe("shouldAutoLeavePlanSideMode", () => {
  it("leaves when plan gone and not pinned", () => {
    expect(
      shouldAutoLeavePlanSideMode({
        sideModeIsPlan: true,
        planVisible: false,
        userPinnedPlanSide: false,
      }),
    ).toBe(true);
  });

  it("stays when user pinned open-in-resources", () => {
    expect(
      shouldAutoLeavePlanSideMode({
        sideModeIsPlan: true,
        planVisible: false,
        userPinnedPlanSide: true,
      }),
    ).toBe(false);
  });

  it("stays while plan is visible", () => {
    expect(
      shouldAutoLeavePlanSideMode({
        sideModeIsPlan: true,
        planVisible: true,
        userPinnedPlanSide: false,
      }),
    ).toBe(false);
  });

  it("no-op when not on plan side", () => {
    expect(
      shouldAutoLeavePlanSideMode({
        sideModeIsPlan: false,
        planVisible: false,
        userPinnedPlanSide: false,
      }),
    ).toBe(false);
  });
});

describe("shouldShowPlanChromeButton", () => {
  it("shows for live plan", () => {
    expect(
      shouldShowPlanChromeButton({
        planVisible: true,
        composerMode: "agent",
        userClosed: false,
        userPinnedPlanSide: false,
      }),
    ).toBe(true);
  });

  it("shows in plan mode and when closed / pinned", () => {
    expect(
      shouldShowPlanChromeButton({
        planVisible: false,
        composerMode: "plan",
        userClosed: false,
        userPinnedPlanSide: false,
      }),
    ).toBe(true);
    expect(
      shouldShowPlanChromeButton({
        planVisible: false,
        composerMode: "agent",
        userClosed: true,
        userPinnedPlanSide: false,
      }),
    ).toBe(true);
    expect(
      shouldShowPlanChromeButton({
        planVisible: false,
        composerMode: "agent",
        userClosed: false,
        userPinnedPlanSide: true,
      }),
    ).toBe(true);
  });

  it("hides when idle agent with no pin", () => {
    expect(
      shouldShowPlanChromeButton({
        planVisible: false,
        composerMode: "agent",
        userClosed: false,
        userPinnedPlanSide: false,
      }),
    ).toBe(false);
  });
});

describe("planHasExpandableContent / inner empty", () => {
  it("detects body or entries", () => {
    expect(planHasExpandableContent({ body: "  ", entries: [] })).toBe(false);
    expect(planHasExpandableContent({ body: "# x", entries: [] })).toBe(true);
    expect(
      planHasExpandableContent({
        body: "",
        entries: [{ content: "a", status: "pending" }],
      }),
    ).toBe(true);
  });

  it("inner empty distinguishes waiting vs blank", () => {
    expect(
      resolvePlanPanelInnerEmpty({
        waiting: true,
        hasExpandableContent: false,
      }),
    ).toBe("waiting");
    expect(
      resolvePlanPanelInnerEmpty({
        waiting: false,
        hasExpandableContent: false,
      }),
    ).toBe("blank");
    expect(
      resolvePlanPanelInnerEmpty({
        waiting: true,
        hasExpandableContent: true,
      }),
    ).toBeNull();
    expect(planPanelInnerEmptyLabelKey("waiting")).toBe("plan.waiting");
    expect(planPanelInnerEmptyLabelKey("blank")).toBe("plan.empty");
  });
});

describe("shouldExitComposerPlanModeAfterDecision", () => {
  it("exits plan mode only after approve", () => {
    expect(
      shouldExitComposerPlanModeAfterDecision({
        decision: "approved",
        composerMode: "plan",
      }),
    ).toBe(true);
    expect(
      shouldExitComposerPlanModeAfterDecision({
        decision: "cancelled",
        composerMode: "plan",
      }),
    ).toBe(false);
    expect(
      shouldExitComposerPlanModeAfterDecision({
        decision: "abandoned",
        composerMode: "plan",
      }),
    ).toBe(false);
  });

  it("is a no-op when not in plan mode", () => {
    expect(
      shouldExitComposerPlanModeAfterDecision({
        decision: "approved",
        composerMode: "agent",
      }),
    ).toBe(false);
  });

  it("is case-insensitive for plan", () => {
    expect(
      shouldExitComposerPlanModeAfterDecision({
        decision: "approved",
        composerMode: "Plan",
      }),
    ).toBe(true);
  });
});

describe("shouldOpenPlanSideTab", () => {
  it("opens when plan becomes visible", () => {
    const r = shouldOpenPlanSideTab({
      autoOpenEnabled: true,
      planVisible: true,
      focusKey: 0,
      lastFocusKey: 0,
    });
    expect(r.open).toBe(true);
    expect(r.nextLastFocusKey).toBe(0);
  });

  it("opens on focus key bump even without a visible plan", () => {
    const r = shouldOpenPlanSideTab({
      autoOpenEnabled: true,
      planVisible: false,
      focusKey: 2,
      lastFocusKey: 1,
    });
    expect(r.open).toBe(true);
    expect(r.nextLastFocusKey).toBe(2);
  });

  it("does not reopen on same focus key when plan is hidden", () => {
    const r = shouldOpenPlanSideTab({
      autoOpenEnabled: true,
      planVisible: false,
      focusKey: 1,
      lastFocusKey: 1,
    });
    expect(r.open).toBe(false);
  });

  it("respects autoOpenEnabled", () => {
    const r = shouldOpenPlanSideTab({
      autoOpenEnabled: false,
      planVisible: true,
      focusKey: 3,
      lastFocusKey: 0,
    });
    expect(r.open).toBe(false);
    expect(r.nextLastFocusKey).toBe(0);
  });
});

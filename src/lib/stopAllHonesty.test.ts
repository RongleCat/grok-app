import { describe, expect, it } from "vitest";
import {
  planStopAllBusySessions,
  stopAllButtonLabelKey,
  stopAllButtonTitleKey,
  stopAllDialogKeys,
  stopAllEmptyMessageKey,
  stopAllResultToast,
  stopAllScopeKind,
} from "./stopAllHonesty";

describe("stopAllScopeKind", () => {
  it("is always app busy sessions (never tools-in-one-chat)", () => {
    expect(stopAllScopeKind()).toBe("app_busy_sessions");
  });
});

describe("planStopAllBusySessions", () => {
  it("returns empty for null / empty / blank ids", () => {
    expect(planStopAllBusySessions(null)).toEqual({ kind: "empty" });
    expect(planStopAllBusySessions(undefined)).toEqual({ kind: "empty" });
    expect(planStopAllBusySessions([])).toEqual({ kind: "empty" });
    expect(planStopAllBusySessions(["", "  ", "\t"])).toEqual({
      kind: "empty",
    });
  });

  it("dedupes and preserves first-seen order", () => {
    const plan = planStopAllBusySessions([
      "s-a",
      "s-b",
      "s-a",
      "  s-c  ",
      "s-b",
    ]);
    expect(plan).toEqual({
      kind: "ready",
      sessionIds: ["s-a", "s-b", "s-c"],
      count: 3,
    });
  });

  it("does not invent session ids", () => {
    const plan = planStopAllBusySessions(["only-one"]);
    expect(plan.kind).toBe("ready");
    if (plan.kind === "ready") {
      expect(plan.sessionIds).toEqual(["only-one"]);
      expect(plan.count).toBe(1);
    }
  });
});

describe("stopAllDialogKeys / button keys", () => {
  it("tasks surface uses tasks.activity.* keys", () => {
    expect(stopAllDialogKeys("tasks")).toEqual({
      titleKey: "tasks.activity.stopAllTitle",
      messageKey: "tasks.activity.stopAllConfirm",
      confirmKey: "tasks.activity.stopAll",
    });
    expect(stopAllButtonLabelKey("tasks")).toBe("tasks.activity.stopAll");
    expect(stopAllButtonTitleKey("tasks")).toBe(
      "tasks.activity.stopAllTitle",
    );
  });

  it("dashboard surface uses dashboard.* keys (app-wide wording)", () => {
    expect(stopAllDialogKeys("dashboard")).toEqual({
      titleKey: "dashboard.stopAllTitle",
      messageKey: "dashboard.stopAllConfirm",
      confirmKey: "dashboard.stopAll",
    });
    expect(stopAllButtonLabelKey("dashboard")).toBe("dashboard.stopAll");
    expect(stopAllButtonTitleKey("dashboard")).toBe("dashboard.stopAllTitle");
  });
});

describe("stopAllResultToast", () => {
  it("empty when nothing attempted", () => {
    expect(stopAllResultToast(0, 0)).toEqual({
      kind: "empty",
      messageKey: "tasks.activity.stopAllEmpty",
    });
  });

  it("done when all ok", () => {
    expect(stopAllResultToast(3, 0)).toEqual({
      kind: "done",
      messageKey: "tasks.activity.stopAllDone",
      vars: { n: "3" },
    });
  });

  it("partial when mix", () => {
    expect(stopAllResultToast(2, 1)).toEqual({
      kind: "partial",
      messageKey: "tasks.activity.stopAllPartial",
      vars: { ok: "2", fail: "1" },
    });
  });

  it("all_failed when none ok", () => {
    expect(stopAllResultToast(0, 4)).toEqual({
      kind: "all_failed",
      messageKey: "tasks.activity.stopAllAllFailed",
      vars: { fail: "4" },
    });
  });

  it("floors non-integer and clamps negatives", () => {
    expect(stopAllResultToast(1.9, -2).kind).toBe("done");
    expect(stopAllResultToast(-1, 2.2)).toEqual({
      kind: "all_failed",
      messageKey: "tasks.activity.stopAllAllFailed",
      vars: { fail: "2" },
    });
  });
});

describe("stopAllEmptyMessageKey", () => {
  it("is stable", () => {
    expect(stopAllEmptyMessageKey()).toBe("tasks.activity.stopAllEmpty");
  });
});

import { describe, expect, it } from "vitest";
import {
  PRODUCT_TUTORIAL_STEPS,
  PRODUCT_TUTORIAL_STORAGE_KEY,
  PRODUCT_TUTORIAL_VERSION,
  getSteps,
  loadDone,
  markDone,
  parseProductTutorialDone,
  reset,
  shouldAutoOffer,
  stepAt,
  stepCount,
  type ProductTutorialStorage,
} from "./productTutorial";

function memoryStorage(
  initial: Record<string, string> = {},
): ProductTutorialStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return key in data ? data[key]! : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

describe("productTutorial", () => {
  it("exposes 7–9 stable ordered step ids", () => {
    const steps = getSteps();
    expect(steps.length).toBeGreaterThanOrEqual(7);
    expect(steps.length).toBeLessThanOrEqual(9);
    expect(steps).toEqual(PRODUCT_TUTORIAL_STEPS);
    expect(stepCount()).toBe(steps.length);
    expect(steps[0]).toBe("welcome");
    expect(steps[steps.length - 1]).toBe("done");
    expect(new Set(steps).size).toBe(steps.length);
  });

  it("includes core themes: project, permissions, worktree, queue, compact, shortcuts", () => {
    const set = new Set(getSteps());
    for (const id of [
      "project",
      "permissions",
      "worktree",
      "send-queue",
      "context-compact",
      "shortcuts",
    ] as const) {
      expect(set.has(id)).toBe(true);
    }
  });

  it("stepAt bounds", () => {
    expect(stepAt(0)).toBe("welcome");
    expect(stepAt(-1)).toBeNull();
    expect(stepAt(999)).toBeNull();
    expect(stepAt(stepCount() - 1)).toBe("done");
  });

  it("parseProductTutorialDone defaults false", () => {
    expect(parseProductTutorialDone(null)).toBe(false);
    expect(parseProductTutorialDone("")).toBe(false);
    expect(parseProductTutorialDone("maybe")).toBe(false);
    expect(parseProductTutorialDone("{}")).toBe(false);
    expect(parseProductTutorialDone('{"done":false}')).toBe(false);
  });

  it("parseProductTutorialDone accepts JSON and legacy flags", () => {
    expect(parseProductTutorialDone("1")).toBe(true);
    expect(parseProductTutorialDone("true")).toBe(true);
    expect(parseProductTutorialDone(true)).toBe(true);
    expect(
      parseProductTutorialDone(
        JSON.stringify({ version: PRODUCT_TUTORIAL_VERSION, done: true }),
      ),
    ).toBe(true);
  });

  it("loadDone / markDone / reset round-trip", () => {
    const s = memoryStorage();
    expect(loadDone(s)).toBe(false);
    markDone(s);
    expect(s.data[PRODUCT_TUTORIAL_STORAGE_KEY]).toContain('"done":true');
    expect(loadDone(s)).toBe(true);
    reset(s);
    expect(loadDone(s)).toBe(false);
    expect(s.data[PRODUCT_TUTORIAL_STORAGE_KEY]).toBeUndefined();
  });

  it("shouldAutoOffer only when ready and not done", () => {
    expect(shouldAutoOffer(false, false)).toBe(false);
    expect(shouldAutoOffer(true, true)).toBe(false);
    expect(shouldAutoOffer(false, true)).toBe(false);
    expect(shouldAutoOffer(true, false)).toBe(true);
  });
});

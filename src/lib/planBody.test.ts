import { describe, expect, it } from "vitest";
import {
  planActionsEnabled,
  planDisplayMarkdown,
  planEntriesToMarkdown,
  planIsAwaitingReview,
} from "./planBody";
import type { PlanEntry } from "./planStatus";

describe("planEntriesToMarkdown", () => {
  it("formats statuses as task markers", () => {
    const entries: PlanEntry[] = [
      { content: "A", status: "completed" },
      { content: "B", status: "in_progress", priority: "high" },
      { content: "C", status: "pending" },
    ];
    const md = planEntriesToMarkdown(entries);
    expect(md).toContain("1. [x] A");
    expect(md).toContain("2. [~] B *(high)*");
    expect(md).toContain("3. [ ] C");
  });
});

describe("planDisplayMarkdown", () => {
  it("prefers body over entries", () => {
    expect(
      planDisplayMarkdown("# Hello", [{ content: "step", status: "pending" }]),
    ).toBe("# Hello");
  });

  it("falls back to entries markdown", () => {
    const md = planDisplayMarkdown("", [
      { content: "Do thing", status: "pending" },
    ]);
    expect(md).toContain("Do thing");
    expect(md).toMatch(/\[ \]/);
  });

  it("returns empty when both missing", () => {
    expect(planDisplayMarkdown("", [])).toBe("");
    expect(planDisplayMarkdown(null, null)).toBe("");
  });
});

describe("plan gate helpers", () => {
  it("actions enabled only with rpcId", () => {
    expect(planActionsEnabled({ rpcId: 3 })).toBe(true);
    expect(planActionsEnabled({ rpcId: null })).toBe(false);
  });

  it("awaiting review needs visible + rpcId", () => {
    expect(planIsAwaitingReview({ visible: true, rpcId: 1 })).toBe(true);
    expect(planIsAwaitingReview({ visible: true, rpcId: null })).toBe(false);
    expect(planIsAwaitingReview({ visible: false, rpcId: 1 })).toBe(false);
  });
});

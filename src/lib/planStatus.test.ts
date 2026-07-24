import { describe, expect, it } from "vitest";
import {
  computePlanProgress,
  formatPlanFraction,
  normalizePlanEntryStatus,
  parsePlanEntries,
  parsePlanEntry,
  resolvePlanBarModel,
  shouldShowPlanBar,
} from "./planStatus";

describe("normalizePlanEntryStatus", () => {
  it("maps common ACP statuses", () => {
    expect(normalizePlanEntryStatus("pending")).toBe("pending");
    expect(normalizePlanEntryStatus("in_progress")).toBe("in_progress");
    expect(normalizePlanEntryStatus("in-progress")).toBe("in_progress");
    expect(normalizePlanEntryStatus("completed")).toBe("completed");
    expect(normalizePlanEntryStatus("done")).toBe("completed");
    expect(normalizePlanEntryStatus("cancelled")).toBe("cancelled");
    expect(normalizePlanEntryStatus("")).toBe("pending");
    expect(normalizePlanEntryStatus("weird")).toBe("unknown");
  });
});

describe("parsePlanEntries", () => {
  it("parses fixture-shaped entries", () => {
    const entries = parsePlanEntries([
      { content: "Touch fixtures", status: "pending" },
      { content: "Run cargo test", status: "in_progress" },
      { content: "Ship", status: "completed" },
    ]);
    expect(entries).toHaveLength(3);
    expect(entries[0].content).toBe("Touch fixtures");
    expect(entries[1].status).toBe("in_progress");
    expect(entries[2].status).toBe("completed");
  });

  it("accepts title/text aliases and string rows", () => {
    expect(parsePlanEntry({ title: "A", status: "todo" })?.content).toBe("A");
    expect(parsePlanEntry("plain step")?.status).toBe("pending");
    expect(parsePlanEntry({})).toBeNull();
    expect(parsePlanEntries(null)).toEqual([]);
  });
});

describe("computePlanProgress", () => {
  it("counts and picks current step", () => {
    const p = computePlanProgress(
      parsePlanEntries([
        { content: "a", status: "completed" },
        { content: "b", status: "in_progress" },
        { content: "c", status: "pending" },
      ]),
    );
    expect(p.total).toBe(3);
    expect(p.completed).toBe(1);
    expect(p.inProgress).toBe(1);
    expect(p.pending).toBe(1);
    expect(p.percent).toBe(33);
    expect(p.current?.content).toBe("b");
    expect(formatPlanFraction(p)).toBe("1/3");
  });

  it("falls back to first pending when none in progress", () => {
    const p = computePlanProgress(
      parsePlanEntries([
        { content: "a", status: "completed" },
        { content: "b", status: "pending" },
      ]),
    );
    expect(p.current?.content).toBe("b");
    expect(p.percent).toBe(50);
  });
});

describe("resolvePlanBarModel", () => {
  it("hides when idle", () => {
    const m = resolvePlanBarModel({
      goalMode: false,
      mode: "agent",
      planVisible: false,
      planWaiting: true,
      planRpcId: null,
      entries: [],
    });
    expect(m.kind).toBe("hidden");
    expect(shouldShowPlanBar(m)).toBe(false);
  });

  it("shows goal mode strip", () => {
    const m = resolvePlanBarModel({
      goalMode: true,
      mode: "agent",
      planVisible: false,
      planWaiting: true,
      entries: [],
    });
    expect(m.kind).toBe("goal");
    expect(m.headlineKey).toBe("planBar.goal");
  });

  it("shows plan mode before entries arrive", () => {
    const m = resolvePlanBarModel({
      goalMode: false,
      mode: "plan",
      planVisible: false,
      planWaiting: true,
      entries: [],
    });
    expect(m.kind).toBe("plan_mode");
  });

  it("prefers review when exit_plan_mode is pending", () => {
    const m = resolvePlanBarModel({
      goalMode: false,
      mode: "plan",
      planVisible: true,
      planWaiting: false,
      planRpcId: 9,
      entries: [
        { content: "Touch fixtures", status: "pending" },
        { content: "Run cargo test", status: "pending" },
      ],
    });
    expect(m.kind).toBe("plan_review");
    expect(m.showActions).toBe(true);
    expect(m.progress.total).toBe(2);
  });

  it("does not show review actions without rpc id", () => {
    const m = resolvePlanBarModel({
      goalMode: false,
      mode: "agent",
      planVisible: true,
      planWaiting: true,
      planRpcId: null,
      entries: [{ content: "draft", status: "pending" }],
    });
    expect(m.kind).toBe("plan_progress");
    expect(m.showActions).toBe(false);
  });

  it("shows progress while entries update (requires planVisible)", () => {
    const m = resolvePlanBarModel({
      goalMode: false,
      mode: "agent",
      planVisible: true,
      planWaiting: true,
      planRpcId: null,
      entries: [
        { content: "a", status: "completed" },
        { content: "b", status: "in_progress" },
      ],
    });
    expect(m.kind).toBe("plan_progress");
    expect(m.headlineKey).toBe("planBar.progress");
    expect(m.currentLabel).toBe("b");
    expect(formatPlanFraction(m.progress)).toBe("1/2");
  });

  it("hides progress entries when plan not visible (soft-dismiss)", () => {
    const m = resolvePlanBarModel({
      goalMode: false,
      mode: "agent",
      planVisible: false,
      planWaiting: true,
      planRpcId: null,
      entries: [
        { content: "a", status: "completed" },
        { content: "b", status: "in_progress" },
      ],
    });
    expect(m.kind).toBe("hidden");
  });

  it("marks done when all completed", () => {
    const m = resolvePlanBarModel({
      goalMode: false,
      mode: "agent",
      planVisible: true,
      planWaiting: true,
      entries: [
        { content: "a", status: "completed" },
        { content: "b", status: "completed" },
      ],
    });
    expect(m.headlineKey).toBe("planBar.done");
    expect(m.progress.percent).toBe(100);
  });
});

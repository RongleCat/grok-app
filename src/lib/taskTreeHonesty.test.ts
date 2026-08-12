import { describe, expect, it } from "vitest";
import {
  buildTaskTree,
  type AgentTask,
  type AgentTaskStatus,
} from "./sessionTasks";
import {
  collectTaskTreeIds,
  describeTaskTreeHonesty,
  resolveTaskParentLinkSource,
  shouldShowTaskTreeChrome,
  taskTreeIdsAreHonest,
} from "./taskTreeHonesty";

function task(
  partial: Partial<AgentTask> & Pick<AgentTask, "id" | "name">,
): AgentTask {
  const status: AgentTaskStatus = partial.status ?? "completed";
  return {
    id: partial.id,
    name: partial.name,
    kind: partial.kind ?? "read_file",
    status,
    longRunning: partial.longRunning ?? false,
    ...(partial.detail ? { detail: partial.detail } : {}),
    ...(partial.path ? { path: partial.path } : {}),
    ...(partial.cwd ? { cwd: partial.cwd } : {}),
    ...(partial.parentId ? { parentId: partial.parentId } : {}),
    ...(partial.updatedAt ? { updatedAt: partial.updatedAt } : {}),
  };
}

describe("describeTaskTreeHonesty", () => {
  it("reports flat honesty when no parent signals", () => {
    const tasks = [
      task({ id: "a", name: "A" }),
      task({ id: "b", name: "B", kind: "bash", longRunning: true }),
    ];
    const h = describeTaskTreeHonesty(tasks);
    expect(h.taskCount).toBe(2);
    expect(h.hasNesting).toBe(false);
    expect(h.hasExplicitParent).toBe(false);
    expect(h.inferredChildCount).toBe(0);
    expect(h.explicitChildCount).toBe(0);
    expect(h.spawnRootCount).toBe(0);
  });

  it("counts explicit parents only when parent exists", () => {
    const tasks = [
      // Before spawn: invalid parentId → root (not inferred under a later spawn).
      task({ id: "orphan", name: "o", parentId: "missing" }),
      task({
        id: "p",
        name: "spawn",
        kind: "spawn_subagent",
        longRunning: true,
        status: "running",
      }),
      task({ id: "c", name: "child", parentId: "p" }),
    ];
    const h = describeTaskTreeHonesty(tasks);
    expect(h.hasNesting).toBe(true);
    expect(h.hasExplicitParent).toBe(true);
    expect(h.explicitChildCount).toBe(1);
    expect(h.inferredChildCount).toBe(0);
    expect(h.spawnRootCount).toBe(1);
  });

  it("counts inferred children under spawn without inventing spawns", () => {
    const tasks = [
      task({
        id: "spawn1",
        name: "spawn A",
        kind: "spawn_subagent",
        longRunning: true,
        status: "running",
      }),
      task({ id: "child1", name: "work", kind: "grep" }),
      task({ id: "child2", name: "shell", kind: "bash", longRunning: true }),
    ];
    const h = describeTaskTreeHonesty(tasks);
    expect(h.hasNesting).toBe(true);
    expect(h.hasExplicitParent).toBe(false);
    expect(h.inferredChildCount).toBe(2);
    expect(h.explicitChildCount).toBe(0);
    expect(h.spawnRootCount).toBe(1);
  });

  it("never invents task rows — honesty taskCount matches input", () => {
    const tasks = [
      task({
        id: "s",
        name: "spawn",
        kind: "spawn_subagent",
        longRunning: true,
      }),
      task({ id: "t", name: "tool" }),
    ];
    expect(describeTaskTreeHonesty(tasks).taskCount).toBe(tasks.length);
    expect(describeTaskTreeHonesty([]).taskCount).toBe(0);
  });
});

describe("resolveTaskParentLinkSource", () => {
  it("returns explicit / inferred / none", () => {
    const tasks = [
      task({
        id: "p",
        name: "spawn",
        kind: "spawn_subagent",
        longRunning: true,
        status: "running",
      }),
      task({ id: "ex", name: "explicit", parentId: "p" }),
      task({ id: "inf", name: "inferred", kind: "read_file" }),
      task({ id: "pre", name: "before", kind: "read_file" }),
    ];
    // Order matters for inference: pre before spawn stays none.
    const ordered = [
      tasks[3]!,
      tasks[0]!,
      tasks[1]!,
      tasks[2]!,
    ];
    expect(resolveTaskParentLinkSource(ordered[2]!, ordered)).toBe("explicit");
    expect(resolveTaskParentLinkSource(ordered[3]!, ordered)).toBe("inferred");
    expect(resolveTaskParentLinkSource(ordered[0]!, ordered)).toBe("none");
  });
});

describe("taskTreeIdsAreHonest / collectTaskTreeIds", () => {
  it("accepts trees built only from input tool ids", () => {
    const tasks = [
      task({
        id: "p",
        name: "spawn",
        kind: "spawn_subagent",
        longRunning: true,
        status: "running",
      }),
      task({ id: "c", name: "child", parentId: "p" }),
      task({ id: "x", name: "other" }),
    ];
    const tree = buildTaskTree(tasks);
    const ids = collectTaskTreeIds(tree);
    expect(new Set(ids)).toEqual(new Set(["p", "c", "x"]));
    expect(
      taskTreeIdsAreHonest(
        tree,
        tasks.map((t) => t.id),
      ),
    ).toBe(true);
  });

  it("rejects invented node ids", () => {
    const fakeTree = [
      {
        task: task({ id: "real", name: "r" }),
        children: [
          {
            task: task({ id: "invented-subagent", name: "fake" }),
            children: [],
          },
        ],
      },
    ];
    expect(taskTreeIdsAreHonest(fakeTree, ["real"])).toBe(false);
  });
});

describe("shouldShowTaskTreeChrome", () => {
  it("is false for empty and flat forests", () => {
    expect(shouldShowTaskTreeChrome([])).toBe(false);
    const flat = buildTaskTree([
      task({ id: "a", name: "A" }),
      task({ id: "b", name: "B" }),
    ]);
    expect(shouldShowTaskTreeChrome(flat)).toBe(false);
  });

  it("is true only when nesting data exists", () => {
    const nested = buildTaskTree([
      task({
        id: "p",
        name: "spawn",
        kind: "spawn_subagent",
        longRunning: true,
      }),
      task({ id: "c", name: "child", parentId: "p" }),
    ]);
    expect(shouldShowTaskTreeChrome(nested)).toBe(true);
  });
});

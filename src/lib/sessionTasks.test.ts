import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./session";
import {
  assignInferredParentIds,
  buildTaskTree,
  collectSessionTasks,
  countRunningTasks,
  extractSubagentCwd,
  filterSessionTasks,
  filterTaskTree,
  formatTaskCwdLabel,
  isLongRunningToolKind,
  isRunningToolStatus,
  isSubagentSpawnKind,
  normalizeExtractedCwdPath,
  normalizeTaskStatus,
  taskFromToolMessage,
  taskStatusMessageKey,
  taskTreeHasNesting,
  taskTreeHasRunning,
  type AgentTask,
} from "./sessionTasks";

function task(partial: Partial<AgentTask> & { id: string; name: string }): AgentTask {
  return {
    kind: partial.kind ?? "read_file",
    status: partial.status ?? "completed",
    longRunning: partial.longRunning ?? false,
    ...partial,
  };
}

function tool(
  partial: Partial<ChatMessage> & { id: string; toolCallId: string },
): ChatMessage {
  return {
    role: "tool",
    content: partial.content ?? "tool work",
    marker: "tool_step",
    toolStatus: partial.toolStatus ?? "in_progress",
    streaming: partial.streaming ?? true,
    toolKind: partial.toolKind,
    toolDetail: partial.toolDetail,
    toolPath: partial.toolPath,
    createdAt: partial.createdAt,
    ...partial,
  };
}

describe("normalizeTaskStatus / isRunningToolStatus", () => {
  it("treats in-flight statuses as running", () => {
    expect(isRunningToolStatus("in_progress")).toBe(true);
    expect(isRunningToolStatus("pending")).toBe(true);
    expect(isRunningToolStatus("running")).toBe(true);
    expect(isRunningToolStatus("")).toBe(true);
    expect(normalizeTaskStatus("in_progress")).toBe("running");
    expect(normalizeTaskStatus(undefined, true)).toBe("running");
  });

  it("maps terminal statuses", () => {
    expect(normalizeTaskStatus("completed")).toBe("completed");
    expect(normalizeTaskStatus("failed")).toBe("failed");
    expect(normalizeTaskStatus("error")).toBe("failed");
    expect(normalizeTaskStatus("cancelled")).toBe("cancelled");
    expect(normalizeTaskStatus("canceled")).toBe("cancelled");
  });

  it("a terminal toolStatus wins when the streaming flag was left on", () => {
    expect(normalizeTaskStatus("completed", true)).toBe("completed");
    expect(normalizeTaskStatus("failed", true)).toBe("failed");
    expect(normalizeTaskStatus("cancelled", true)).toBe("cancelled");
    const task = taskFromToolMessage(
      tool({
        id: "tool-bg",
        toolCallId: "bg",
        content: "sleep 1",
        toolKind: "run_terminal_command",
        toolStatus: "completed",
        streaming: true,
      }),
    );
    expect(task?.status).toBe("completed");
  });
});

describe("isLongRunningToolKind", () => {
  it("flags subagent / shell / monitor family", () => {
    expect(isLongRunningToolKind("spawn_subagent")).toBe(true);
    expect(isLongRunningToolKind("run_terminal_command")).toBe(true);
    expect(isLongRunningToolKind("monitor")).toBe(true);
    expect(isLongRunningToolKind("bash")).toBe(true);
    expect(isLongRunningToolKind("get_command_or_subagent_output")).toBe(true);
  });

  it("does not flag ordinary file tools", () => {
    expect(isLongRunningToolKind("read_file")).toBe(false);
    expect(isLongRunningToolKind("search_replace")).toBe(false);
    expect(isLongRunningToolKind("")).toBe(false);
  });
});

describe("taskFromToolMessage", () => {
  it("builds a task from live tool_step fields", () => {
    const t = taskFromToolMessage(
      tool({
        id: "tool-tc1",
        toolCallId: "tc1",
        content: "spawn helper",
        toolKind: "spawn_subagent",
        toolStatus: "in_progress",
        toolDetail: "research docs",
        streaming: true,
      }),
    );
    expect(t).toMatchObject({
      id: "tc1",
      name: "spawn helper",
      kind: "spawn_subagent",
      status: "running",
      detail: "research docs",
      longRunning: true,
    });
  });

  it("parses journal tool_step| lines", () => {
    const t = taskFromToolMessage({
      id: "tool-j1",
      role: "tool",
      marker: "tool_step",
      content: "tool_step|completed|run_terminal_command|pnpm test\nls -la",
      toolCallId: "j1",
    });
    expect(t?.status).toBe("completed");
    expect(t?.kind).toBe("run_terminal_command");
    expect(t?.name).toBe("pnpm test");
    expect(t?.detail).toBe("ls -la");
    expect(t?.longRunning).toBe(true);
  });

  it("returns null for non-tool rows", () => {
    expect(
      taskFromToolMessage({
        id: "u1",
        role: "user",
        content: "hi",
      }),
    ).toBeNull();
  });
});

describe("collectSessionTasks", () => {
  it("lists running first then recent terminal from current turn", () => {
    const msgs: ChatMessage[] = [
      { id: "u0", role: "user", content: "old" },
      tool({
        id: "tool-old",
        toolCallId: "old",
        content: "old write",
        toolKind: "write",
        toolStatus: "completed",
        streaming: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
      { id: "u1", role: "user", content: "now" },
      tool({
        id: "tool-a",
        toolCallId: "a",
        content: "grep foo",
        toolKind: "grep",
        toolStatus: "completed",
        streaming: false,
        createdAt: "2026-01-02T00:00:01.000Z",
      }),
      tool({
        id: "tool-b",
        toolCallId: "b",
        content: "spawn agent",
        toolKind: "spawn_subagent",
        toolStatus: "in_progress",
        streaming: true,
        createdAt: "2026-01-02T00:00:02.000Z",
      }),
      tool({
        id: "tool-c",
        toolCallId: "c",
        content: "shell sleep",
        toolKind: "run_terminal_command",
        toolStatus: "running",
        streaming: true,
        createdAt: "2026-01-02T00:00:03.000Z",
      }),
    ];
    const tasks = collectSessionTasks(msgs);
    expect(tasks.map((t) => t.id)).toEqual(["b", "c", "a"]);
    expect(countRunningTasks(tasks)).toBe(2);
    expect(tasks.find((t) => t.id === "old")).toBeUndefined();
  });

  it("keeps a still-running tool from before the last user message", () => {
    const msgs: ChatMessage[] = [
      { id: "u0", role: "user", content: "start" },
      tool({
        id: "tool-bg",
        toolCallId: "bg",
        content: "monitor logs",
        toolKind: "monitor",
        toolStatus: "in_progress",
        streaming: true,
      }),
      { id: "u1", role: "user", content: "follow up" },
      tool({
        id: "tool-r",
        toolCallId: "r",
        content: "read x",
        toolKind: "read_file",
        toolStatus: "completed",
        streaming: false,
        createdAt: "2026-01-02T00:00:01.000Z",
      }),
    ];
    const tasks = collectSessionTasks(msgs);
    expect(tasks.map((t) => t.id)).toEqual(["bg", "r"]);
  });

  it("replaces a stale running row when the same tool later completes", () => {
    const msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: "now" },
      tool({
        id: "tool-bg-live",
        toolCallId: "bg",
        content: "sleep 1",
        toolKind: "run_terminal_command",
        toolStatus: "running",
        streaming: true,
        createdAt: "2026-01-02T00:00:01.000Z",
      }),
      tool({
        id: "tool-bg-done",
        toolCallId: "bg",
        content: "sleep 1",
        toolKind: "run_terminal_command",
        toolStatus: "completed",
        streaming: false,
        createdAt: "2026-01-02T00:00:02.000Z",
      }),
    ];
    const tasks = collectSessionTasks(msgs);
    expect(tasks.filter((t) => t.id === "bg")).toHaveLength(1);
    expect(tasks.find((t) => t.id === "bg")?.status).toBe("completed");
  });

  it("respects recentLimit", () => {
    const msgs: ChatMessage[] = [{ id: "u", role: "user", content: "x" }];
    for (let i = 0; i < 5; i++) {
      msgs.push(
        tool({
          id: `tool-${i}`,
          toolCallId: `t${i}`,
          content: `step ${i}`,
          toolKind: "read_file",
          toolStatus: "completed",
          streaming: false,
          createdAt: `2026-01-0${i + 1}T00:00:00.000Z`,
        }),
      );
    }
    const tasks = collectSessionTasks(msgs, { recentLimit: 2 });
    expect(tasks).toHaveLength(2);
  });
});

describe("filterSessionTasks", () => {
  it("filters by name / kind / detail", () => {
    const tasks = collectSessionTasks([
      { id: "u", role: "user", content: "x" },
      tool({
        id: "tool-1",
        toolCallId: "1",
        content: "pnpm test",
        toolKind: "run_terminal_command",
        toolStatus: "completed",
        streaming: false,
        toolDetail: "cd app && pnpm test",
      }),
      tool({
        id: "tool-2",
        toolCallId: "2",
        content: "read file",
        toolKind: "read_file",
        toolStatus: "completed",
        streaming: false,
      }),
    ]);
    expect(filterSessionTasks(tasks, "pnpm").map((t) => t.id)).toEqual(["1"]);
    expect(filterSessionTasks(tasks, "READ_FILE").map((t) => t.id)).toEqual([
      "2",
    ]);
  });
});

describe("taskStatusMessageKey", () => {
  it("maps to activity.* keys", () => {
    expect(taskStatusMessageKey("running")).toBe("activity.running");
    expect(taskStatusMessageKey("completed")).toBe("activity.done");
    expect(taskStatusMessageKey("failed")).toBe("activity.failed");
    expect(taskStatusMessageKey("cancelled")).toBe("activity.cancelled");
  });
});

describe("isSubagentSpawnKind", () => {
  it("recognizes spawn / subagent parents", () => {
    expect(isSubagentSpawnKind("spawn_subagent")).toBe(true);
    expect(isSubagentSpawnKind("subagent")).toBe(true);
    expect(isSubagentSpawnKind("Agent")).toBe(true);
  });

  it("does not treat helper tools as spawn parents", () => {
    expect(isSubagentSpawnKind("get_command_or_subagent_output")).toBe(false);
    expect(isSubagentSpawnKind("kill_command_or_subagent")).toBe(false);
    expect(isSubagentSpawnKind("read_file")).toBe(false);
  });
});

describe("taskFromToolMessage parentId", () => {
  it("reads toolParentId from message metadata", () => {
    const t = taskFromToolMessage(
      tool({
        id: "tool-child",
        toolCallId: "child",
        content: "read",
        toolKind: "read_file",
        toolStatus: "completed",
        streaming: false,
        toolParentId: "spawn-1",
      }),
    );
    expect(t?.parentId).toBe("spawn-1");
  });
});

describe("buildTaskTree", () => {
  it("returns a flat forest when no parents (identical order)", () => {
    const tasks = [
      task({ id: "a", name: "A", status: "completed" }),
      task({ id: "b", name: "B", status: "running" }),
      task({ id: "c", name: "C", status: "completed" }),
    ];
    const tree = buildTaskTree(tasks);
    expect(taskTreeHasNesting(tree)).toBe(false);
    expect(tree.map((n) => n.task.id)).toEqual(["a", "b", "c"]);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });

  it("nests children under explicit parentId", () => {
    const tasks = [
      // Before the spawn stays top-level (not inferred under a later parent).
      task({ id: "z", name: "other", status: "completed" }),
      task({
        id: "p",
        name: "spawn",
        kind: "spawn_subagent",
        longRunning: true,
        status: "running",
      }),
      task({ id: "c1", name: "read", parentId: "p", status: "completed" }),
      task({ id: "c2", name: "grep", parentId: "p", status: "running" }),
    ];
    const tree = buildTaskTree(tasks);
    expect(tree.map((n) => n.task.id)).toEqual(["z", "p"]);
    expect(tree[1]!.children.map((c) => c.task.id)).toEqual(["c1", "c2"]);
    expect(taskTreeHasNesting(tree)).toBe(true);
    expect(taskTreeHasRunning(tree[1]!)).toBe(true);
  });

  it("infers nesting after longRunning spawn_subagent until next top-level spawn", () => {
    const tasks = [
      task({ id: "pre", name: "before", kind: "read_file", status: "completed" }),
      task({
        id: "spawn1",
        name: "spawn A",
        kind: "spawn_subagent",
        longRunning: true,
        status: "running",
      }),
      task({ id: "child1", name: "work", kind: "grep", status: "completed" }),
      task({ id: "child2", name: "shell", kind: "bash", status: "running" }),
      task({
        id: "spawn2",
        name: "spawn B",
        kind: "spawn_subagent",
        longRunning: true,
        status: "completed",
      }),
      task({ id: "child3", name: "after", kind: "write", status: "completed" }),
    ];
    const tree = buildTaskTree(tasks);
    expect(tree.map((n) => n.task.id)).toEqual(["pre", "spawn1", "spawn2"]);
    expect(tree[1]!.children.map((c) => c.task.id)).toEqual(["child1", "child2"]);
    expect(tree[2]!.children.map((c) => c.task.id)).toEqual(["child3"]);
  });

  it("does not invent nesting without a spawn parent", () => {
    const tasks = [
      task({
        id: "shell",
        name: "shell",
        kind: "run_terminal_command",
        longRunning: true,
        status: "running",
      }),
      task({ id: "r", name: "read", kind: "read_file", status: "completed" }),
    ];
    const tree = buildTaskTree(tasks);
    expect(taskTreeHasNesting(tree)).toBe(false);
    expect(tree.map((n) => n.task.id)).toEqual(["shell", "r"]);
  });

  it("treats missing parent id as root", () => {
    const tasks = [
      task({ id: "orphan", name: "o", parentId: "missing", status: "completed" }),
      task({ id: "solo", name: "s", status: "completed" }),
    ];
    const tree = buildTaskTree(tasks);
    expect(tree.map((n) => n.task.id)).toEqual(["orphan", "solo"]);
  });

  it("breaks simple parent cycles", () => {
    const tasks = [
      task({ id: "a", name: "A", parentId: "b", status: "completed" }),
      task({ id: "b", name: "B", parentId: "a", status: "completed" }),
    ];
    const tree = buildTaskTree(tasks);
    // Both become roots (cycle skipped) — no infinite structure.
    expect(tree).toHaveLength(2);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });
});

describe("assignInferredParentIds", () => {
  it("preserves explicit parentId over inference", () => {
    const tasks = [
      task({
        id: "s1",
        name: "spawn",
        kind: "spawn_subagent",
        longRunning: true,
        status: "running",
      }),
      task({
        id: "s2",
        name: "other spawn",
        kind: "spawn_subagent",
        longRunning: true,
        status: "running",
      }),
      task({
        id: "c",
        name: "child",
        kind: "read_file",
        parentId: "s2",
        status: "completed",
      }),
    ];
    // After s1 is open, c has explicit parent s2 — keep it.
    const linked = assignInferredParentIds(tasks);
    expect(linked.find((t) => t.id === "c")?.parentId).toBe("s2");
  });
});

describe("filterTaskTree", () => {
  it("keeps ancestors of matching children", () => {
    const tree = buildTaskTree([
      task({
        id: "p",
        name: "spawn",
        kind: "spawn_subagent",
        longRunning: true,
        status: "completed",
      }),
      task({
        id: "c",
        name: "pnpm test",
        kind: "run_terminal_command",
        parentId: "p",
        status: "completed",
      }),
      task({ id: "x", name: "unrelated", status: "completed" }),
    ]);
    const filtered = filterTaskTree(tree, "pnpm");
    expect(filtered.map((n) => n.task.id)).toEqual(["p"]);
    expect(filtered[0]!.children.map((c) => c.task.id)).toEqual(["c"]);
  });

  it("matches cwd on nested tasks", () => {
    const tree = buildTaskTree([
      task({
        id: "p",
        name: "spawn",
        kind: "spawn_subagent",
        longRunning: true,
        status: "completed",
        cwd: "/tmp/wt-feature-login",
      }),
      task({
        id: "c",
        name: "read",
        kind: "read_file",
        parentId: "p",
        status: "completed",
      }),
    ]);
    const filtered = filterTaskTree(tree, "feature-login");
    expect(filtered.map((n) => n.task.id)).toEqual(["p"]);
  });
});

describe("normalizeExtractedCwdPath", () => {
  it("accepts absolute and home-relative paths", () => {
    expect(normalizeExtractedCwdPath("/Users/me/proj")).toBe("/Users/me/proj");
    expect(normalizeExtractedCwdPath('"/tmp/wt"')).toBe("/tmp/wt");
    expect(normalizeExtractedCwdPath("~/Code/app")).toBe("~/Code/app");
    expect(normalizeExtractedCwdPath("C:\\Users\\me\\wt")).toBe(
      "C:\\Users\\me\\wt",
    );
  });

  it("rejects relative or empty", () => {
    expect(normalizeExtractedCwdPath("relative/path")).toBeUndefined();
    expect(normalizeExtractedCwdPath("")).toBeUndefined();
    expect(normalizeExtractedCwdPath(null)).toBeUndefined();
  });
});

describe("extractSubagentCwd", () => {
  it("returns undefined for non-subagent kinds (never invents)", () => {
    expect(
      extractSubagentCwd({
        kind: "read_file",
        path: "/tmp/file.ts",
        detail: "cwd: /tmp/other",
      }),
    ).toBeUndefined();
    expect(
      extractSubagentCwd({
        kind: "run_terminal_command",
        detail: "cwd: /tmp/shell",
      }),
    ).toBeUndefined();
  });

  it("reads absolute path field for spawn_subagent", () => {
    expect(
      extractSubagentCwd({
        kind: "spawn_subagent",
        path: "/Users/me/.grok/worktrees/app/feat-x",
        detail: "research the feature",
      }),
    ).toBe("/Users/me/.grok/worktrees/app/feat-x");
  });

  it("parses cwd: / worktree: labels in detail", () => {
    expect(
      extractSubagentCwd({
        kind: "Agent",
        detail: "cwd: /tmp/agent-wt\nImplement the fix",
      }),
    ).toBe("/tmp/agent-wt");
    expect(
      extractSubagentCwd({
        kind: "subagent",
        detail: "worktree=/var/tmp/wt-1",
      }),
    ).toBe("/var/tmp/wt-1");
  });

  it("parses JSON detail with cwd / worktree keys", () => {
    expect(
      extractSubagentCwd({
        kind: "spawn_subagent",
        detail: JSON.stringify({
          prompt: "do work",
          cwd: "/home/u/wt",
        }),
      }),
    ).toBe("/home/u/wt");
    expect(
      extractSubagentCwd({
        kind: "spawn_subagent",
        detail: 'prefix {"worktreePath":"/opt/trees/a","task":"x"} tail',
      }),
    ).toBe("/opt/trees/a");
  });

  it("parses --cwd / -C flags", () => {
    expect(
      extractSubagentCwd({
        kind: "spawn_subagent",
        title: "helper",
        detail: "grok --cwd /data/wt-cli --prompt hi",
      }),
    ).toBe("/data/wt-cli");
    expect(
      extractSubagentCwd({
        kind: "spawn_subagent",
        detail: "run -C '/tmp/quoted-wt' something",
      }),
    ).toBe("/tmp/quoted-wt");
  });

  it("accepts whole-blob absolute path as detail", () => {
    expect(
      extractSubagentCwd({
        kind: "spawn_subagent",
        detail: "/tmp/only-path",
      }),
    ).toBe("/tmp/only-path");
  });

  it("does not invent when no path present", () => {
    expect(
      extractSubagentCwd({
        kind: "spawn_subagent",
        title: "Research docs",
        detail: "look through the repository and summarize",
      }),
    ).toBeUndefined();
  });
});

describe("formatTaskCwdLabel", () => {
  it("returns short paths as-is and long paths as basename or WT", () => {
    expect(formatTaskCwdLabel("/tmp/wt")).toBe("/tmp/wt");
    expect(formatTaskCwdLabel("/Users/me/.grok/worktrees/app/feat-login")).toBe(
      "feat-login",
    );
    expect(
      formatTaskCwdLabel(
        "/Users/me/.grok/worktrees/very-long-repo-name/very-long-branch-name-here",
        10,
      ),
    ).toBe("WT");
  });
});

describe("taskFromToolMessage cwd", () => {
  it("attaches cwd when spawn tool_step carries worktree path", () => {
    const t = taskFromToolMessage(
      tool({
        id: "tool-s",
        toolCallId: "s1",
        content: "spawn helper",
        toolKind: "spawn_subagent",
        toolStatus: "in_progress",
        toolPath: "/tmp/sub-wt",
        streaming: true,
      }),
    );
    expect(t?.cwd).toBe("/tmp/sub-wt");
  });

  it("parses journal tool_step detail labels", () => {
    const t = taskFromToolMessage({
      id: "tool-j2",
      role: "tool",
      marker: "tool_step",
      content:
        "tool_step|running|spawn_subagent|Subagent\ncwd: /Users/me/wt-j",
      toolCallId: "j2",
    });
    expect(t?.kind).toBe("spawn_subagent");
    expect(t?.cwd).toBe("/Users/me/wt-j");
  });

  it("omits cwd for ordinary tools even with absolute path", () => {
    const t = taskFromToolMessage(
      tool({
        id: "tool-r",
        toolCallId: "r1",
        content: "read file",
        toolKind: "read_file",
        toolStatus: "completed",
        toolPath: "/tmp/file.ts",
        streaming: false,
      }),
    );
    expect(t?.cwd).toBeUndefined();
    expect(t?.path).toBe("/tmp/file.ts");
  });
});

describe("buildTaskTree with cwd", () => {
  it("preserves cwd on nested spawn roots", () => {
    const tasks = [
      task({
        id: "p",
        name: "spawn",
        kind: "spawn_subagent",
        longRunning: true,
        status: "running",
        cwd: "/tmp/nested-wt",
      }),
      task({ id: "c1", name: "read", parentId: "p", status: "completed" }),
    ];
    const tree = buildTaskTree(tasks);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.task.cwd).toBe("/tmp/nested-wt");
    expect(tree[0]!.children).toHaveLength(1);
    expect(taskTreeHasNesting(tree)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./session";
import {
  collectSessionTasks,
  countRunningTasks,
  filterSessionTasks,
  isLongRunningToolKind,
  isRunningToolStatus,
  normalizeTaskStatus,
  taskFromToolMessage,
  taskStatusMessageKey,
} from "./sessionTasks";

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

import { describe, expect, it } from "vitest";
import {
  buildContinueAfterStopPrompt,
  buildContinueAgentPrompt,
  isContinuableEndReason,
  latestContinuableEndMessageId,
} from "./continueInterruptedTurn";

describe("continueInterruptedTurn", () => {
  it("includes the pending command in a fence", () => {
    const text = buildContinueAgentPrompt({
      command: "git rev-parse master origin/master HEAD",
      title: "List commits to merge into hzh/dev",
      toolName: "run_terminal_command",
    });
    expect(text).toContain("git rev-parse master origin/master HEAD");
    expect(text).toContain("run_terminal_command");
    expect(text).toContain("```");
    expect(text).toMatch(/interrupted when the app host process restarted/i);
    expect(text).not.toMatch(/^继续上次中断的任务$/);
  });

  it("still asks to resume when the command is missing", () => {
    const text = buildContinueAgentPrompt({});
    expect(text).toMatch(/command is not available/i);
    expect(text).not.toContain("```");
  });

  it("marks host_exit and agent_exit as continuable", () => {
    expect(isContinuableEndReason("host_exit")).toBe(true);
    expect(isContinuableEndReason("agent_exit")).toBe(true);
    expect(isContinuableEndReason("user_stop")).toBe(true);
    expect(isContinuableEndReason("process_exit")).toBe(true);
    expect(isContinuableEndReason("host")).toBe(true);
    expect(isContinuableEndReason("stall")).toBe(false);
    expect(isContinuableEndReason("cancelled")).toBe(false);
  });

  it("does not tell the agent the host restarted after a user stop", () => {
    const text = buildContinueAfterStopPrompt();
    expect(text).toMatch(/model stream was cut off/i);
    expect(text).not.toMatch(/host process restarted/i);
  });
});

describe("latestContinuableEndMessageId", () => {
  it("returns only the last host_exit after the last user", () => {
    const id = latestContinuableEndMessageId([
      { id: "u1", role: "user" },
      { id: "old", role: "tool", marker: "turn_cancelled", content: "turn_cancelled|host_exit", toolStatus: "host_exit" },
      { id: "u2", role: "user" },
      { id: "a2", role: "assistant" },
      { id: "new", role: "tool", marker: "turn_cancelled", content: "turn_cancelled|host_exit", toolStatus: "host_exit" },
    ]);
    expect(id).toBe("new");
  });

  it("ignores older chips once a later user turn exists", () => {
    const id = latestContinuableEndMessageId([
      { id: "u1", role: "user" },
      { id: "old", role: "tool", marker: "turn_cancelled", content: "turn_cancelled|agent_exit", toolStatus: "agent_exit" },
      { id: "u2", role: "user" },
      { id: "a2", role: "assistant" },
    ]);
    expect(id).toBeNull();
  });

  it("returns the latest user_stop chip and drops it after a later user turn", () => {
    const before = latestContinuableEndMessageId([
      { id: "u1", role: "user" },
      { id: "stop", role: "tool", marker: "turn_end", content: "turn_end|user_stop", toolStatus: "user_stop" },
    ]);
    expect(before).toBe("stop");
    const after = latestContinuableEndMessageId([
      { id: "u1", role: "user" },
      { id: "stop", role: "tool", marker: "turn_end", content: "turn_end|user_stop", toolStatus: "user_stop" },
      { id: "u2", role: "user", content: "continue" },
    ]);
    expect(after).toBeNull();
  });

  it("uses the journal reason when toolStatus is only cancelled", () => {
    const id = latestContinuableEndMessageId([
      { id: "u1", role: "user" },
      {
        id: "stop",
        role: "tool",
        marker: "turn_cancelled",
        content: "turn_cancelled|user_stop",
        toolStatus: "cancelled",
      },
    ]);
    expect(id).toBe("stop");
  });

  it("treats a process_exit status as an agent exit", () => {
    const id = latestContinuableEndMessageId([
      { id: "u1", role: "user" },
      {
        id: "exit",
        role: "tool",
        marker: "turn_end",
        toolStatus: "process_exit",
      },
    ]);
    expect(id).toBe("exit");
  });

  it("does not continue a stall chip", () => {
    const id = latestContinuableEndMessageId([
      { id: "u1", role: "user" },
      {
        id: "stall",
        role: "tool",
        marker: "turn_end",
        content: "turn_end|stall",
        toolStatus: "stall",
      },
    ]);
    expect(id).toBeNull();
  });
});

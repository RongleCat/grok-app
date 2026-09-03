import { describe, expect, it } from "vitest";
import type { TimelineUnit } from "./timelinePhases";
import { buildTurnProcessSummary, shouldCompactTurnProcess } from "./turnProcess";

function tool(id: string, toolKind: string): TimelineUnit {
  return {
    kind: "tool",
    si: 0,
    tool: {
      kind: "tool",
      toolCallId: id,
      title: toolKind,
      toolKind,
      status: "completed",
    },
  };
}

describe("turnProcess", () => {
  it("counts tools by bucket and replies", () => {
    const units: TimelineUnit[] = [
      tool("a", "read_file"),
      tool("b", "grep"),
      { kind: "content", text: "hello", si: 2, streaming: false },
    ];
    const s = buildTurnProcessSummary(units);
    expect(s.toolCount).toBe(2);
    expect(s.readCount).toBe(1);
    expect(s.searchCount).toBe(1);
    expect(s.replyCount).toBe(1);
    expect(s.hasFinalAnswer).toBe(true);
    expect(shouldCompactTurnProcess(s)).toBe(true);
  });

  it("does not compact tool-only turns (no final answer)", () => {
    const s = buildTurnProcessSummary([tool("a", "read_file")]);
    expect(s.hasFinalAnswer).toBe(false);
    expect(shouldCompactTurnProcess(s)).toBe(false);
  });

  it("dedupes repeated toolCallId updates", () => {
    const s = buildTurnProcessSummary([
      tool("same", "read_file"),
      tool("same", "read_file"),
    ]);
    expect(s.toolCount).toBe(1);
  });
});

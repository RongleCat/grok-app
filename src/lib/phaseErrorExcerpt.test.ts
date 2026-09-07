import { describe, expect, it } from "vitest";
import type { GrokPhaseItem } from "./grokActivitySteps";
import type { MessageToolSegment } from "./session";
import {
  PHASE_ERROR_EXCERPT_CAP,
  collectPhaseErrorExcerpt,
  countFailedToolSegments,
  phaseErrorExcerptHeightPx,
} from "./phaseErrorExcerpt";
import { GROK_ACTIVITY_STEP_ROW_PX } from "./grokActivityVirtualize";

function tool(
  id: string,
  title: string,
  status = "completed",
  extra: Partial<MessageToolSegment> = {},
): MessageToolSegment {
  return {
    ...extra,
    kind: "tool",
    toolCallId: extra.toolCallId ?? id,
    title: extra.title ?? title,
    status: extra.status ?? status,
    toolKind: extra.toolKind ?? "read_file",
    streaming: extra.streaming ?? status === "running",
    isError: extra.isError ?? (status === "failed" || status === "error"),
  };
}

function items(
  ...parts: Array<GrokPhaseItem | MessageToolSegment>
): GrokPhaseItem[] {
  return parts.map((p) =>
    "kind" in p && p.kind === "thought"
      ? p
      : "kind" in p && p.kind === "speech"
        ? p
        : { kind: "tool" as const, tool: p as MessageToolSegment },
  );
}

describe("collectPhaseErrorExcerpt", () => {
  it("returns empty when nothing failed", () => {
    expect(
      collectPhaseErrorExcerpt(
        items(
          { kind: "thought", text: "try" },
          tool("ok", "Read a"),
        ),
      ),
    ).toEqual({ rows: [], overflow: 0 });
  });

  it("keeps a single failed leaf and ignores thoughts/speech", () => {
    const excerpt = collectPhaseErrorExcerpt(
      items(
        { kind: "thought", text: "try" },
        { kind: "speech", text: "mid" },
        tool("ok", "Read a"),
        tool("bad", "npm test", "failed", {
          toolKind: "run_terminal_command",
          input: "npm test",
        }),
      ),
    );
    expect(excerpt.overflow).toBe(0);
    expect(excerpt.rows).toHaveLength(1);
    const row = excerpt.rows[0]!;
    expect(row.type === "tool" || row.type === "browse" || row.type === "web-search").toBe(
      true,
    );
    expect(row.type !== "speech" && row.type !== "thought" && row.failed).toBe(
      true,
    );
    if (row.type === "tool") {
      expect(row.tool.toolCallId).toBe("bad");
    }
  });

  it("does not fold consecutive failed bash into a group label", () => {
    const excerpt = collectPhaseErrorExcerpt(
      items(
        tool("b1", "npm test", "failed", { toolKind: "run_terminal_command" }),
        tool("b2", "npm lint", "completed", { toolKind: "run_terminal_command" }),
        tool("b3", "npm build", "failed", { toolKind: "run_terminal_command" }),
      ),
    );
    expect(excerpt.rows).toHaveLength(2);
    expect(excerpt.rows.every((r) => r.type !== "bash-group")).toBe(true);
    expect(
      excerpt.rows.every(
        (r) => r.type !== "speech" && r.type !== "thought" && r.failed,
      ),
    ).toBe(true);
  });

  it("caps visible rows and reports overflow", () => {
    const failed = Array.from({ length: 8 }, (_, i) =>
      tool(`f${i}`, `fail ${i}`, "failed", {
        toolKind: "run_terminal_command",
      }),
    );
    const excerpt = collectPhaseErrorExcerpt(items(...failed));
    expect(PHASE_ERROR_EXCERPT_CAP).toBe(5);
    expect(excerpt.rows).toHaveLength(5);
    expect(excerpt.overflow).toBe(3);
  });
});

describe("countFailedToolSegments", () => {
  it("counts isError and failed statuses", () => {
    expect(
      countFailedToolSegments([
        tool("a", "ok"),
        tool("b", "bad", "failed"),
        { status: "denied" },
        { status: "completed", isError: true },
      ]),
    ).toBe(3);
  });
});

describe("phaseErrorExcerptHeightPx", () => {
  it("is 0 when there are no failures", () => {
    expect(phaseErrorExcerptHeightPx(0)).toBe(0);
  });

  it("is N rows, plus one overflow row past the cap", () => {
    expect(phaseErrorExcerptHeightPx(2)).toBe(2 * GROK_ACTIVITY_STEP_ROW_PX);
    expect(phaseErrorExcerptHeightPx(5)).toBe(5 * GROK_ACTIVITY_STEP_ROW_PX);
    expect(phaseErrorExcerptHeightPx(8)).toBe(6 * GROK_ACTIVITY_STEP_ROW_PX);
  });
});

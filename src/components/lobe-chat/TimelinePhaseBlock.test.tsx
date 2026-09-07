/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TimelinePhase } from "@/lib/timelinePhases";
import type { MessageToolSegment } from "@/lib/session";
import { TimelinePhaseBlock } from "./TimelinePhaseBlock";

afterEach(cleanup);

function tool(
  id: string,
  title: string,
  status: string,
  extra: Partial<MessageToolSegment> = {},
): MessageToolSegment {
  return {
    ...extra,
    kind: "tool",
    toolCallId: extra.toolCallId ?? id,
    title: extra.title ?? title,
    status: extra.status ?? status,
    toolKind: extra.toolKind ?? "read_file",
    isError: extra.isError ?? (status === "failed" || status === "error"),
  };
}

function phaseWith(
  tools: MessageToolSegment[],
  extra: Partial<TimelinePhase> = {},
): TimelinePhase {
  return {
    kind: "phase",
    id: "p0",
    items: [
      { kind: "thought", text: "try" },
      ...tools.map((t) => ({ kind: "tool" as const, tool: t })),
    ],
    thoughts: ["try"],
    tools,
    startSi: 0,
    endSi: tools.length,
    live: false,
    errorCount: tools.filter((t) => t.isError || t.status === "failed").length,
    runningCount: 0,
    ...extra,
  };
}

describe("TimelinePhaseBlock history excerpt", () => {
  it("folds a finished phase and shows only failed leaves", () => {
    render(
      <TimelinePhaseBlock
        phase={phaseWith([
          tool("ok", "Read a", "completed"),
          tool("bad", "npm test", "failed", {
            toolKind: "run_terminal_command",
            input: "npm test",
          }),
        ])}
        locale="en"
        messageStreaming={false}
        autoCollapse
      />,
    );
    const root = screen.getByTestId("timeline-phase");
    expect(root.getAttribute("data-expanded")).toBe("0");
    expect(root.getAttribute("data-error-excerpt")).toBe("1");
    expect(screen.getByTestId("timeline-phase-excerpt")).toBeTruthy();
    expect(screen.getByText(/npm test/)).toBeTruthy();
    expect(screen.queryByText(/Read a/)).toBeNull();
  });

  it("caps excerpt and opens the full rail from overflow", () => {
    const tools = Array.from({ length: 8 }, (_, i) =>
      tool(`f${i}`, `fail ${i}`, "failed", {
        toolKind: "run_terminal_command",
        input: `cmd-${i}`,
      }),
    );
    render(
      <TimelinePhaseBlock
        phase={phaseWith(tools)}
        locale="en"
        messageStreaming={false}
        autoCollapse
      />,
    );
    expect(screen.getByTestId("timeline-phase-excerpt-more").textContent).toMatch(
      /3/,
    );
    fireEvent.click(screen.getByTestId("timeline-phase-excerpt-more"));
    expect(screen.getByTestId("timeline-phase").getAttribute("data-expanded")).toBe(
      "1",
    );
    expect(screen.queryByTestId("timeline-phase-excerpt")).toBeNull();
  });

  it("keeps the live rail fully open", () => {
    render(
      <TimelinePhaseBlock
        phase={phaseWith(
          [
            tool("ok", "Read a", "completed"),
            tool("run", "npm test", "running", {
              toolKind: "run_terminal_command",
              streaming: true,
            }),
          ],
          { live: true, runningCount: 1, errorCount: 0 },
        )}
        locale="en"
        messageStreaming
        autoCollapse
      />,
    );
    expect(screen.getByTestId("timeline-phase").getAttribute("data-expanded")).toBe(
      "1",
    );
    expect(screen.queryByTestId("timeline-phase-excerpt")).toBeNull();
    expect(screen.getByText("Read file")).toBeTruthy();
    expect(screen.getByText("Run command")).toBeTruthy();
  });
});

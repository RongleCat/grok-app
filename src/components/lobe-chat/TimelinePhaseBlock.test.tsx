/**
 * @vitest-environment jsdom
 */
import "@/test/jsdomStubs";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelinePhase } from "@/lib/timelinePhases";
import type { MessageToolSegment } from "@/lib/session";
import { TimelinePhaseBlock } from "./TimelinePhaseBlock";
import { resetEntranceLedger } from "@/lib/entranceLedger";

beforeEach(() => {
  resetEntranceLedger();
});

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

  it("latches the entrance class for a phase mounted live", () => {
    const phase: TimelinePhase = {
      ...phaseWith([tool("ok", "Read a", "completed")]),
      items: [{ kind: "speech", text: "先核对", chunkEnds: [3] }],
      thoughts: [],
      live: true,
    };
    const { container, rerender } = render(
      <TimelinePhaseBlock
        phase={phase}
        locale="en"
        messageStreaming
        autoCollapse
      />,
    );

    expect(
      screen.getByTestId("timeline-phase").classList.contains("chat-block-enter"),
    ).toBe(true);

    rerender(
      <TimelinePhaseBlock
        phase={{ ...phase, live: false }}
        locale="en"
        messageStreaming={false}
        autoCollapse
      />,
    );

    // The class stays once entered, but a state flip does not replay it.
    expect(
      container
        .querySelector("[data-testid='timeline-phase']")
        ?.classList.contains("chat-block-enter"),
    ).toBe(true);
  });

  it("does not animate a phase that only becomes running after mount", () => {
    const idle: TimelinePhase = {
      ...phaseWith([tool("ok", "Read a", "completed")]),
      items: [{ kind: "speech", text: "先核对", chunkEnds: [3] }],
      thoughts: [],
      live: false,
    };
    const { container, rerender } = render(
      <TimelinePhaseBlock
        phase={idle}
        locale="en"
        messageStreaming={false}
        autoCollapse
      />,
    );

    expect(
      container
        .querySelector("[data-testid='timeline-phase']")
        ?.classList.contains("chat-block-enter"),
    ).toBe(false);

    rerender(
      <TimelinePhaseBlock
        phase={{ ...idle, live: true, runningCount: 1 }}
        locale="en"
        messageStreaming
        autoCollapse
      />,
    );

    expect(
      container
        .querySelector("[data-testid='timeline-phase']")
        ?.classList.contains("chat-block-enter"),
    ).toBe(false);
  });

  it("fades in in-phase tool rows that mount during a live phase", () => {
    const livePhase: TimelinePhase = {
      ...phaseWith([tool("ok", "Read a", "completed")]),
      live: true,
    };
    const { container, rerender } = render(
      <TimelinePhaseBlock
        phase={livePhase}
        locale="en"
        messageStreaming
        autoCollapse={false}
      />,
    );

    const firstRow = container.querySelector('[data-step-type="tool"]');
    expect(firstRow?.classList.contains("chat-block-enter")).toBe(true);

    // Appended tool rows mount inside the live phase too.
    rerender(
      <TimelinePhaseBlock
        phase={{
          ...livePhase,
          items: [
            ...livePhase.items,
            {
              kind: "tool",
              tool: tool("ok2", "Send mail", "completed", {
                toolKind: "mcp_tool",
              }),
            },
          ],
          tools: [
            ...livePhase.tools,
            tool("ok2", "Send mail", "completed", { toolKind: "mcp_tool" }),
          ],
        }}
        locale="en"
        messageStreaming
        autoCollapse={false}
      />,
    );
    const rows = container.querySelectorAll('[data-step-type="tool"]');
    expect(rows).toHaveLength(2);
    expect(rows[1]?.classList.contains("chat-block-enter")).toBe(true);

    // Rows that already entered keep the class after the phase ends, but it
    // does not replay them.
    rerender(
      <TimelinePhaseBlock
        phase={{ ...livePhase, live: false }}
        locale="en"
        messageStreaming={false}
        autoCollapse={false}
      />,
    );
    expect(
      container
        .querySelector('[data-step-type="tool"]')
        ?.classList.contains("chat-block-enter"),
    ).toBe(true);
  });

  it("does not fade in in-phase tool rows rendered from history", () => {
    const { container } = render(
      <TimelinePhaseBlock
        phase={phaseWith([tool("ok", "Read a", "completed")])}
        locale="en"
        messageStreaming={false}
        autoCollapse={false}
      />,
    );

    expect(
      container
        .querySelector('[data-step-type="tool"]')
        ?.classList.contains("chat-block-enter"),
    ).toBe(false);
  });

  it("reveals live phase speech by chunk", () => {
    vi.useFakeTimers();
    try {
      const phase: TimelinePhase = {
        ...phaseWith([tool("ok", "Read a", "completed")]),
        items: [{ kind: "speech", text: "先核对", chunkEnds: [3] }],
        thoughts: [],
        live: true,
      };
      const { container, rerender } = render(
        <TimelinePhaseBlock
          phase={phase}
          locale="en"
          messageStreaming
          autoCollapse
        />,
      );

      // Text already present at mount does not play.
      expect(
        container.querySelectorAll(
          "[data-testid='timeline-process-speech'] [data-reveal='1']",
        ).length,
      ).toBe(0);

      rerender(
        <TimelinePhaseBlock
          phase={{
            ...phase,
            items: [
              { kind: "speech", text: "先核对仓库。", chunkEnds: [3, 6] },
            ],
          }}
          locale="en"
          messageStreaming
          autoCollapse
        />,
      );
      act(() => {
        vi.advanceTimersByTime(200);
      });

      const animated = Array.from(
        container.querySelectorAll<HTMLElement>(
          "[data-testid='timeline-process-speech'] [data-reveal='1']",
        ),
      );
      expect(animated.map((node) => node.textContent)).toContain("仓库。");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reveals a live in-phase thought body by chunk", () => {
    vi.useFakeTimers();
    try {
      const phase: TimelinePhase = {
        ...phaseWith([tool("ok", "Read a", "completed")]),
        items: [{ kind: "thought", text: "再核对", chunkEnds: [3] }],
        thoughts: ["再核对"],
        live: true,
      };
      const { container, rerender } = render(
        <TimelinePhaseBlock
          phase={phase}
          locale="en"
          messageStreaming
          autoCollapse
        />,
      );

      expect(
        container.querySelectorAll(".grok-act__thought-body [data-reveal='1']")
          .length,
      ).toBe(0);

      rerender(
        <TimelinePhaseBlock
          phase={{
            ...phase,
            items: [{ kind: "thought", text: "再核对😀", chunkEnds: [3, 5] }],
            thoughts: ["再核对😀"],
          }}
          locale="en"
          messageStreaming
          autoCollapse
        />,
      );
      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(
        container.querySelectorAll(".grok-act__thought-body [data-reveal='1']")
          .length,
      ).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
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

  it("shows the running tool in the collapsed header", () => {
    const phase = phaseWith(
      [
        tool("ok", "Read a", "completed"),
        tool("run", "npm test", "running", {
          toolKind: "run_terminal_command",
          streaming: true,
        }),
      ],
      { live: true, runningCount: 1, errorCount: 0 },
    );
    const { container, rerender } = render(
      <TimelinePhaseBlock
        phase={phase}
        locale="en"
        messageStreaming
        autoCollapse
      />,
    );
    const now = () => container.querySelector(".grok-act__now");
    expect(now()?.textContent).toContain("Run command");
    const firstNode = now();

    rerender(
      <TimelinePhaseBlock
        phase={phaseWith(
          [
            tool("ok", "Read a", "completed"),
            tool("grep", "Search b", "running", {
              toolKind: "grep",
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
    expect(now()?.textContent).toContain("search");
    expect(now()?.textContent).not.toContain("Run command");
    // A new tool remounts the label node: the previous animation is cut short
    // and the next one starts from its first frame.
    expect(now()).not.toBe(firstNode);
  });

  it("shows thinking while the live phase has no running tool", () => {
    const phase: TimelinePhase = {
      ...phaseWith([]),
      items: [{ kind: "thought", text: "checking" }],
      thoughts: ["checking"],
      live: true,
    };
    const { container } = render(
      <TimelinePhaseBlock
        phase={phase}
        locale="en"
        messageStreaming
        autoCollapse
      />,
    );
    expect(container.querySelector(".grok-act__now")?.textContent).toContain(
      "Thinking",
    );
  });

  it("hides the live activity once the turn settles", () => {
    const { container } = render(
      <TimelinePhaseBlock
        phase={phaseWith(
          [
            tool("run", "npm test", "running", {
              toolKind: "run_terminal_command",
              streaming: true,
            }),
          ],
          { live: true, runningCount: 1 },
        )}
        locale="en"
        messageStreaming={false}
        autoCollapse
      />,
    );
    expect(container.querySelector(".grok-act__now")).toBeNull();
  });

  it("draws the connector as two half-rails so it centers between icons", () => {
    const { container } = render(
      <TimelinePhaseBlock
        phase={phaseWith(
          [
            tool("a", "pwd", "completed", {
              toolKind: "run_terminal_command",
            }),
            tool("b", "Search b", "completed", { toolKind: "grep" }),
            tool("c", "Read c", "completed", { toolKind: "read_file" }),
          ],
          { live: true, runningCount: 0 },
        )}
        locale="en"
        messageStreaming
        autoCollapse
      />,
    );
    const rows = Array.from(
      container.querySelectorAll<HTMLElement>("[data-step-key]"),
    );
    expect(rows).toHaveLength(3);
    const rails = (row: HTMLElement) =>
      row.querySelectorAll(".grok-act__rail").length;
    const topRails = (row: HTMLElement) =>
      row.querySelectorAll(".grok-act__rail--top").length;

    expect(rails(rows[0]!)).toBe(1); // first row: bottom half only
    expect(topRails(rows[0]!)).toBe(0);
    expect(rails(rows[1]!)).toBe(2); // middle row: half above and below
    expect(topRails(rows[1]!)).toBe(1);
    expect(rails(rows[2]!)).toBe(1); // last row: top half only
    expect(topRails(rows[2]!)).toBe(1);
  });
});

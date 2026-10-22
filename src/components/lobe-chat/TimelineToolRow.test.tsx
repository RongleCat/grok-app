/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/test/jsdomStubs";
import { ensureLocalStorage } from "@/test/ensureLocalStorage";
import type { MessageToolSegment } from "@/lib/session";
import { TimelineToolRow } from "./TimelineToolRow";
import { resetEntranceLedger } from "@/lib/entranceLedger";

ensureLocalStorage();

beforeEach(() => {
  resetEntranceLedger();
});

afterEach(cleanup);

function tool(extra: Partial<MessageToolSegment> = {}): MessageToolSegment {
  return {
    kind: "tool",
    toolCallId: "call-1",
    title: "pwd",
    toolKind: "run_terminal_command",
    status: "running",
    input: "pwd",
    output: "/tmp\n",
    streaming: true,
    ...extra,
  };
}

describe("TimelineToolRow block entrance", () => {
  it("marks the outermost row on first mount", () => {
    const { container } = render(
      <TimelineToolRow tool={tool()} defaultExpanded={false} locale="en" />,
    );
    const root = container.firstElementChild;
    expect(root?.getAttribute("data-testid")).toBe("timeline-tool");
    expect(root?.classList.contains("chat-block-enter")).toBe(true);
    expect(container.querySelectorAll(".chat-block-enter")).toHaveLength(1);
  });

  it("does not replay the entrance when the same tool row remounts", () => {
    const seg = tool();
    const first = render(<TimelineToolRow tool={seg} locale="en" />);
    expect(
      first.container.firstElementChild?.classList.contains("chat-block-enter"),
    ).toBe(true);
    first.unmount();

    const second = render(<TimelineToolRow tool={seg} locale="en" />);
    expect(
      second.container.firstElementChild?.classList.contains("chat-block-enter"),
    ).toBe(false);
  });

  it("marks the row and its expanded panel once and keeps both stable", () => {
    const { container, rerender } = render(
      <TimelineToolRow tool={tool()} defaultExpanded locale="en" />,
    );
    const row = container.querySelector("[data-testid='timeline-tool']");
    const panel = container.querySelector(".lobe-timeline-tool__body");
    expect(row?.classList.contains("chat-block-enter")).toBe(true);
    expect(panel?.classList.contains("chat-block-enter")).toBe(true);
    expect(container.querySelectorAll(".chat-block-enter")).toHaveLength(2);

    rerender(
      <TimelineToolRow
        tool={tool({ status: "completed", streaming: false })}
        defaultExpanded
        locale="en"
      />,
    );

    expect(container.querySelector("[data-testid='timeline-tool']")).toBe(row);
    expect(container.querySelector(".lobe-timeline-tool__body")).toBe(panel);
    expect(row?.classList.contains("chat-block-enter")).toBe(true);
    expect(panel?.classList.contains("chat-block-enter")).toBe(true);
    expect(container.querySelectorAll(".chat-block-enter")).toHaveLength(2);
  });

  it("keeps the class stable when the tool finishes in place", () => {
    const { container, rerender } = render(
      <TimelineToolRow tool={tool()} defaultExpanded={false} locale="en" />,
    );
    const root = container.firstElementChild;
    expect(root?.classList.contains("chat-block-enter")).toBe(true);

    rerender(
      <TimelineToolRow
        tool={tool({ status: "completed", streaming: false })}
        defaultExpanded={false}
        locale="en"
      />,
    );

    expect(root).toBe(container.firstElementChild);
    expect(root?.classList.contains("chat-block-enter")).toBe(true);
    expect(container.querySelectorAll(".chat-block-enter")).toHaveLength(1);
  });
});

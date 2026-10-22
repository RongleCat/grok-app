/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toolExpandBody } from "@/lib/toolDisplay";
import { ToolExpandBody } from "./ToolExpandBody";

afterEach(cleanup);

describe("ToolExpandBody copy", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("shows a bash command without stdout and copies it", async () => {
    const body = toolExpandBody(
      {
        toolKind: "run_terminal_command",
        input: "pwd",
      },
      false,
    );
    const { container } = render(
      <ToolExpandBody body={body} locale="en" />,
    );
    expect(screen.getByText("pwd")).toBeTruthy();
    expect(screen.queryByTestId("tool-output")).toBeNull();
    expect(
      container.firstElementChild?.classList.contains("chat-block-enter"),
    ).toBe(true);
    // One node keeps a single animation: detail entrance never stacks on top
    // of block entrance.
    expect(
      container.firstElementChild?.classList.contains("chat-detail-enter"),
    ).toBe(false);
    fireEvent.click(screen.getByTestId("tool-copy-command"));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("pwd");
    });
  });

  it("copies full stdout, not the elided view", async () => {
    const long = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n");
    const body = toolExpandBody(
      {
        toolKind: "run_terminal_command",
        input: "seq 1000",
        output: long,
      },
      false,
    );
    expect(body.outputBody).toMatch(/more lines/);
    expect(body.outputFull).not.toMatch(/more lines/);
    render(<ToolExpandBody body={body} locale="en" />);
    fireEvent.click(screen.getByTestId("tool-copy-output"));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(body.outputFull);
    });
  });
});

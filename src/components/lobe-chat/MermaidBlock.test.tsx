/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const { renderMermaidSvg } = vi.hoisted(() => ({
  renderMermaidSvg: vi.fn(async () => {
    return '<svg xmlns="http://www.w3.org/2000/svg" data-testid="mermaid-svg"><text>diagram</text></svg>';
  }),
}));

vi.mock("@/lib/mermaidRender", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mermaidRender")>(
    "@/lib/mermaidRender",
  );
  return {
    ...actual,
    renderMermaidSvg,
    documentThemeMode: () => "dark" as const,
  };
});

import { MermaidBlock } from "./MermaidBlock";

afterEach(() => {
  cleanup();
  renderMermaidSvg.mockClear();
});

beforeEach(() => {
  renderMermaidSvg.mockImplementation(async () => {
    return '<svg xmlns="http://www.w3.org/2000/svg" data-testid="mermaid-svg"><text>diagram</text></svg>';
  });
});

describe("MermaidBlock", () => {
  it("renders mermaid source as SVG after load", async () => {
    render(
      <MermaidBlock
        source={"flowchart LR\n  A-->B"}
        copyLabel="Copy"
        sourceLabel="Source"
        diagramLabel="Diagram"
        loadingLabel="Rendering diagram…"
        errorLabel="Could not render diagram"
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("mermaid-svg")).toBeTruthy();
    });
    expect(renderMermaidSvg).toHaveBeenCalled();
    expect(screen.getByText("mermaid")).toBeTruthy();
    const root = document.querySelector(".chat-mermaid");
    expect(root?.classList.contains("chat-md-enter")).toBe(true);
    expect(document.querySelectorAll(".chat-md-enter")).toHaveLength(1);
    expect(
      document.querySelector(".chat-mermaid__svg")?.classList.contains(
        "chat-md-enter",
      ),
    ).toBe(false);
  });

  it("keeps the last good SVG and the same root when a streaming update fails", async () => {
    const { container, rerender } = render(
      <MermaidBlock
        source={"flowchart LR\n  A-->B"}
        streaming
        copyLabel="Copy"
        sourceLabel="Source"
        diagramLabel="Diagram"
        loadingLabel="Rendering diagram…"
        errorLabel="Could not render diagram"
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("mermaid-svg")).toBeTruthy();
    });
    const root = container.querySelector(".chat-mermaid");
    expect(root?.classList.contains("chat-md-enter")).toBe(true);

    renderMermaidSvg.mockRejectedValueOnce(new Error("parse fail"));
    rerender(
      <MermaidBlock
        source={"flowchart LR\n  A-->"}
        streaming
        copyLabel="Copy"
        sourceLabel="Source"
        diagramLabel="Diagram"
        loadingLabel="Rendering diagram…"
        errorLabel="Could not render diagram"
      />,
    );

    await waitFor(() => {
      expect(renderMermaidSvg).toHaveBeenCalledTimes(2);
      expect(root?.classList.contains("is-pending")).toBe(false);
    });
    // Rerendering the same root node keeps the entrance class, so the
    // animation does not replay.
    expect(container.querySelector(".chat-mermaid")).toBe(root);
    expect(screen.getByTestId("mermaid-svg")).toBeTruthy();
    expect(screen.queryByText("Could not render diagram")).toBeNull();
    expect(root?.classList.contains("chat-md-enter")).toBe(true);
  });

  it("falls back to source text when render fails and streaming is false", async () => {
    renderMermaidSvg.mockRejectedValueOnce(new Error("parse fail"));
    render(
      <MermaidBlock
        source={"flowchart LR\n  A-->"}
        streaming={false}
        copyLabel="Copy"
        sourceLabel="Source"
        diagramLabel="Diagram"
        loadingLabel="Rendering diagram…"
        errorLabel="Could not render diagram"
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("Could not render diagram")).toBeTruthy();
    });
    expect(screen.getByText(/flowchart LR/)).toBeTruthy();
  });
});

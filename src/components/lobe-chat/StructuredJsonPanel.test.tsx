/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@/test/jsdomStubs";
import {
  StructuredJsonPanel,
  type StructuredJsonPanelLabels,
} from "./StructuredJsonPanel";

afterEach(cleanup);

const labels: StructuredJsonPanelLabels = {
  title: "Structured output",
  badge: "JSON",
  copy: "Copy",
  copied: "Copied",
  export: "Export",
  invalidJson: "Not valid JSON",
  empty: "Empty",
  valid: "Valid",
  schemaMismatch: "Schema mismatch",
  missingRequired: "Missing: {fields}",
};

function renderPanel(content: string, streaming = false) {
  return render(
    <StructuredJsonPanel
      content={content}
      labels={labels}
      streaming={streaming}
    />,
  );
}

describe("StructuredJsonPanel block entrance", () => {
  it("marks the panel root on first mount", () => {
    const { container } = renderPanel('{"a":1}');
    const root = container.firstElementChild;
    expect(root?.getAttribute("data-testid")).toBe("struct-json-panel");
    expect(root?.classList.contains("chat-md-enter")).toBe(true);
    expect(container.querySelectorAll(".chat-md-enter")).toHaveLength(1);
  });

  it("keeps the class stable while the JSON keeps streaming", () => {
    const { container, rerender } = renderPanel('{"a":', true);
    const root = container.firstElementChild;
    expect(root?.classList.contains("chat-md-enter")).toBe(true);

    rerender(
      <StructuredJsonPanel
        content='{"a":1}'
        labels={labels}
        streaming
      />,
    );

    expect(root).toBe(container.firstElementChild);
    expect(root?.classList.contains("chat-md-enter")).toBe(true);
    expect(container.querySelectorAll(".chat-md-enter")).toHaveLength(1);
  });
});

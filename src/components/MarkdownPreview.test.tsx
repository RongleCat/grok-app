/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@/test/jsdomStubs";
import { MarkdownPreview } from "./MarkdownPreview";
import { MARKDOWN_PREVIEW_VIRTUALIZE_THRESHOLD } from "@/lib/markdownPreviewWindow";

afterEach(cleanup);

describe("MarkdownPreview", () => {
  it("renders a short file as one markdown tree", () => {
    render(<MarkdownPreview>{"# Hi\n\nHello"}</MarkdownPreview>);
    expect(document.querySelectorAll(".md-body")).toHaveLength(1);
    expect(document.querySelector("[data-virtualized]")).toBeNull();
  });

  it("does not mount every section of a 5000-line file", () => {
    const chunks: string[] = [];
    for (let i = 0; i < 500; i++) {
      chunks.push(`# H${i}\n${"x\n".repeat(9)}`);
    }
    const text = chunks.join("");
    expect(text.split("\n").length).toBeGreaterThan(
      MARKDOWN_PREVIEW_VIRTUALIZE_THRESHOLD,
    );
    render(<MarkdownPreview>{text}</MarkdownPreview>);
    const mounted = document.querySelectorAll("[data-md-section]").length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(MARKDOWN_PREVIEW_VIRTUALIZE_THRESHOLD);
    expect(
      document.querySelector(".md-preview")?.getAttribute("data-virtualized"),
    ).toBe("1");
  });
});

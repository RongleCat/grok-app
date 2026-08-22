import { describe, expect, it } from "vitest";
import {
  MARKDOWN_PREVIEW_VIRTUALIZE_THRESHOLD,
  MARKDOWN_SECTION_MAX_LINES,
  computeMarkdownSectionWindow,
  countMarkdownLines,
  markdownSectionLayout,
  shouldWindowMarkdownPreview,
  splitMarkdownSections,
} from "./markdownPreviewWindow";

describe("countMarkdownLines / shouldWindowMarkdownPreview", () => {
  it("does not count a trailing newline as a row", () => {
    expect(countMarkdownLines("a\nb\n")).toBe(2);
    expect(countMarkdownLines("")).toBe(1);
  });

  it("windows at 200 lines", () => {
    expect(
      shouldWindowMarkdownPreview(MARKDOWN_PREVIEW_VIRTUALIZE_THRESHOLD - 1),
    ).toBe(false);
    expect(
      shouldWindowMarkdownPreview(MARKDOWN_PREVIEW_VIRTUALIZE_THRESHOLD),
    ).toBe(true);
  });
});

describe("splitMarkdownSections", () => {
  it("keeps a short file as one section", () => {
    const s = splitMarkdownSections("# Hi\n\nHello");
    expect(s).toHaveLength(1);
    expect(s[0]?.source).toBe("# Hi\n\nHello");
  });

  it("starts a section on each ATX heading", () => {
    const s = splitMarkdownSections("# A\nbody\n# B\nmore");
    expect(s.map((x) => x.source)).toEqual(["# A\nbody", "# B\nmore"]);
    expect(s.map((x) => x.startLine)).toEqual([1, 3]);
  });

  it("does not split a heading inside a fence", () => {
    const s = splitMarkdownSections("# A\n```\n# not a heading\n```\n# B");
    expect(s.map((x) => x.source)).toEqual([
      "# A\n```\n# not a heading\n```",
      "# B",
    ]);
  });

  it("caps long heading-less bodies on blank lines", () => {
    const lines = Array.from({ length: 120 }, (_, i) => `line ${i}`);
    lines[MARKDOWN_SECTION_MAX_LINES] = "";
    const s = splitMarkdownSections(lines.join("\n"));
    expect(s.length).toBeGreaterThan(1);
    expect(s[0]?.lineCount).toBe(MARKDOWN_SECTION_MAX_LINES);
  });
});

describe("computeMarkdownSectionWindow", () => {
  it("covers the viewport plus overscan", () => {
    const layout = markdownSectionLayout([
      { lineCount: 10 },
      { lineCount: 10 },
      { lineCount: 10 },
      { lineCount: 10 },
    ]);
    const win = computeMarkdownSectionWindow({
      offsets: layout.offsets,
      heights: layout.heights,
      totalHeight: layout.total,
      scrollOffset: 240,
      viewportHeight: 100,
      overscan: 1,
    });
    expect(win.start).toBeGreaterThanOrEqual(0);
    expect(win.end).toBeGreaterThan(win.start);
    expect(win.end).toBeLessThanOrEqual(4);
    expect(win.paddingTop + win.paddingBottom).toBeLessThan(layout.total);
  });
});

import { describe, expect, it } from "vitest";
import {
  CODE_PREVIEW_VIRTUALIZE_THRESHOLD,
  shouldVirtualizeCodePreview,
  splitSourceLines,
} from "./codePreviewWindow";

describe("splitSourceLines", () => {
  it("keeps a single empty row for empty input", () => {
    expect(splitSourceLines("")).toEqual([""]);
  });

  it("does not add a gutter row for a trailing newline", () => {
    expect(splitSourceLines("a\nb\n")).toEqual(["a", "b"]);
  });

  it("keeps an internal empty line", () => {
    expect(splitSourceLines("a\n\nb")).toEqual(["a", "", "b"]);
  });
});

describe("shouldVirtualizeCodePreview", () => {
  it("leaves short files fully rendered", () => {
    expect(shouldVirtualizeCodePreview(1)).toBe(false);
    expect(
      shouldVirtualizeCodePreview(CODE_PREVIEW_VIRTUALIZE_THRESHOLD - 1),
    ).toBe(false);
  });

  it("windows at the threshold (5000-line files included)", () => {
    expect(
      shouldVirtualizeCodePreview(CODE_PREVIEW_VIRTUALIZE_THRESHOLD),
    ).toBe(true);
    expect(shouldVirtualizeCodePreview(5000)).toBe(true);
  });
});

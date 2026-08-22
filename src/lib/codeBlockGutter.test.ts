import { describe, expect, it } from "vitest";
import { formatLineNumberGutter } from "./codeBlockGutter";

describe("formatLineNumberGutter", () => {
  it("always has at least line 1", () => {
    expect(formatLineNumberGutter(0)).toBe("1");
    expect(formatLineNumberGutter(-3)).toBe("1");
    expect(formatLineNumberGutter(Number.NaN)).toBe("1");
    expect(formatLineNumberGutter(1)).toBe("1");
  });

  it("is one newline-separated text node", () => {
    expect(formatLineNumberGutter(3)).toBe("1\n2\n3");
    expect(formatLineNumberGutter(3.9)).toBe("1\n2\n3");
  });

  it("covers a 5000-line fence without per-line tokens", () => {
    const gutter = formatLineNumberGutter(5000);
    expect(gutter.startsWith("1\n2\n")).toBe(true);
    expect(gutter.endsWith("\n4999\n5000")).toBe(true);
    expect(gutter.split("\n")).toHaveLength(5000);
  });
});

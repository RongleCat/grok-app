import { describe, expect, it } from "vitest";
import {
  normalizeFocusLine,
  parsePathLineCitation,
  pathWithoutLineSuffix,
} from "./pathLineCitation";

describe("parsePathLineCitation", () => {
  it("parses path:line", () => {
    expect(parsePathLineCitation("src/lib/foo.ts:42")).toEqual({
      path: "src/lib/foo.ts",
      line: 42,
      column: null,
    });
  });

  it("parses path:line:col", () => {
    expect(parsePathLineCitation("src/lib/foo.ts:42:10")).toEqual({
      path: "src/lib/foo.ts",
      line: 42,
      column: 10,
    });
  });

  it("parses absolute unix path:line", () => {
    expect(parsePathLineCitation("/Users/me/proj/a.md:1")).toEqual({
      path: "/Users/me/proj/a.md",
      line: 1,
      column: null,
    });
  });

  it("handles Windows drive letters", () => {
    expect(parsePathLineCitation("C:\\Users\\me\\a.ts:12")).toEqual({
      path: "C:\\Users\\me\\a.ts",
      line: 12,
      column: null,
    });
    expect(parsePathLineCitation("C:/Users/me/a.ts:12:3")).toEqual({
      path: "C:/Users/me/a.ts",
      line: 12,
      column: 3,
    });
  });

  it("leaves plain paths alone", () => {
    expect(parsePathLineCitation("src/lib/foo.ts")).toEqual({
      path: "src/lib/foo.ts",
      line: null,
      column: null,
    });
  });

  it("soft-fails invalid line (zero) — keeps full token", () => {
    expect(parsePathLineCitation("src/foo.ts:0")).toEqual({
      path: "src/foo.ts:0",
      line: null,
      column: null,
    });
  });

  it("does not rewrite URLs with ports", () => {
    const u = "https://example.com:8080/path";
    expect(parsePathLineCitation(u)).toEqual({
      path: u,
      line: null,
      column: null,
    });
  });

  it("does not treat bare words:number as path citations", () => {
    expect(parsePathLineCitation("error:404")).toEqual({
      path: "error:404",
      line: null,
      column: null,
    });
  });

  it("accepts bare filename with extension", () => {
    expect(parsePathLineCitation("README.md:3")).toEqual({
      path: "README.md",
      line: 3,
      column: null,
    });
  });

  it("trims whitespace", () => {
    expect(parsePathLineCitation("  src/a.ts:9  ")).toEqual({
      path: "src/a.ts",
      line: 9,
      column: null,
    });
  });
});

describe("normalizeFocusLine", () => {
  it("accepts in-range lines", () => {
    expect(normalizeFocusLine(3, 10)).toBe(3);
    expect(normalizeFocusLine(1, 1)).toBe(1);
  });

  it("soft-fails out of range / invalid", () => {
    expect(normalizeFocusLine(0, 10)).toBeNull();
    expect(normalizeFocusLine(11, 10)).toBeNull();
    expect(normalizeFocusLine(null, 10)).toBeNull();
    expect(normalizeFocusLine(5, 0)).toBeNull();
    expect(normalizeFocusLine(1.5, 10)).toBeNull();
  });

  it("allows unbounded when lineCount omitted", () => {
    expect(normalizeFocusLine(999)).toBe(999);
  });
});

describe("pathWithoutLineSuffix", () => {
  it("strips valid suffix", () => {
    expect(pathWithoutLineSuffix("a/b.ts:2:1")).toBe("a/b.ts");
  });
});

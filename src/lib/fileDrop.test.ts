import { describe, expect, it } from "vitest";
import {
  HTML5_NATIVE_DROP_GUARD_MS,
  isFileDrag,
  pathsFromDroppedFiles,
  shouldSkipHtml5AfterNative,
} from "./fileDrop";

function dt(partial: {
  types?: string[];
  files?: { length: number };
  items?: Array<{ kind: string }>;
}): DataTransfer {
  return partial as unknown as DataTransfer;
}

describe("isFileDrag", () => {
  it("rejects null / empty", () => {
    expect(isFileDrag(null)).toBe(false);
    expect(isFileDrag(dt({ types: ["text/plain"] }))).toBe(false);
  });

  it("accepts Files / moz-file / uri-list", () => {
    expect(isFileDrag(dt({ types: ["Files"] }))).toBe(true);
    expect(isFileDrag(dt({ types: ["application/x-moz-file"] }))).toBe(true);
    expect(isFileDrag(dt({ types: ["text/uri-list"] }))).toBe(true);
  });

  it("accepts FileList or items kind=file even without types", () => {
    expect(isFileDrag(dt({ types: [], files: { length: 1 } }))).toBe(true);
    expect(isFileDrag(dt({ types: [], items: [{ kind: "file" }] }))).toBe(
      true,
    );
  });
});

describe("pathsFromDroppedFiles", () => {
  it("keeps unique non-empty File.path", () => {
    const a = { name: "a.png", path: "/tmp/a.png" } as File & { path: string };
    const b = { name: "b.png", path: "" } as File & { path: string };
    const c = { name: "a2.png", path: "/tmp/a.png" } as File & { path: string };
    expect(pathsFromDroppedFiles([a, b, c])).toEqual(["/tmp/a.png"]);
  });
});

describe("shouldSkipHtml5AfterNative", () => {
  it("skips only inside the guard window", () => {
    expect(shouldSkipHtml5AfterNative(1000, 1000)).toBe(true);
    expect(
      shouldSkipHtml5AfterNative(1000, 1000 + HTML5_NATIVE_DROP_GUARD_MS - 1),
    ).toBe(true);
    expect(
      shouldSkipHtml5AfterNative(1000, 1000 + HTML5_NATIVE_DROP_GUARD_MS),
    ).toBe(false);
    expect(shouldSkipHtml5AfterNative(0, 50)).toBe(false);
  });
});

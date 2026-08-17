import { describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi";

describe("stripAnsi", () => {
  it("removes SGR sequences", () => {
    expect(stripAnsi("\u001b[31mERROR\u001b[0m boom")).toBe("ERROR boom");
  });

  it("removes leftover SGR after ESC was dropped", () => {
    expect(stripAnsi("[39mBuild complete in [32m42169ms[39m")).toBe(
      "Build complete in 42169ms",
    );
    expect(stripAnsi("[30m WARN [39m Unsupported platform")).toBe(
      " WARN  Unsupported platform",
    );
  });

  it("keeps ordinary bracket text", () => {
    expect(stripAnsi("array[0] ok")).toBe("array[0] ok");
    expect(stripAnsi("see issue [39] later")).toBe("see issue [39] later");
  });

  it("returns clean output unchanged (no regex work)", () => {
    const plain = "ran 3 searches, 4 files";
    expect(stripAnsi(plain)).toBe(plain);
    expect(stripAnsi("")).toBe("");
  });
});

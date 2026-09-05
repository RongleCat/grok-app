import { describe, expect, it } from "vitest";
import {
  TOOL_OUTPUT_MEMORY_MAX_CHARS,
  compactToolOutputForMemory,
  maybeCompactToolOutputForMemory,
  shouldCompactToolOutputForMemory,
} from "./toolOutputMemory";

describe("compactToolOutputForMemory", () => {
  it("leaves short output alone", () => {
    expect(compactToolOutputForMemory("ok\n")).toBe("ok");
    expect(shouldCompactToolOutputForMemory("ok")).toBe(false);
  });

  it("elides the middle of many lines like expand UI", () => {
    const lines = Array.from({ length: 900 }, (_, i) => `L${i}`);
    const out = compactToolOutputForMemory(lines.join("\n"));
    expect(out).toContain("L0");
    expect(out).toContain("L899");
    expect(out).toMatch(/more lines/);
    expect(out.split("\n").length).toBeLessThan(900);
    expect(shouldCompactToolOutputForMemory(lines.join("\n"))).toBe(true);
  });

  it("caps very long lines by characters", () => {
    const long = "x".repeat(TOOL_OUTPUT_MEMORY_MAX_CHARS + 5000);
    const out = compactToolOutputForMemory(long);
    expect(out.length).toBeLessThanOrEqual(TOOL_OUTPUT_MEMORY_MAX_CHARS);
    expect(out.startsWith("xxx")).toBe(true);
    expect(out.endsWith("xxx")).toBe(true);
    expect(out).toContain("…");
  });

  it("is idempotent", () => {
    const lines = Array.from({ length: 600 }, (_, i) => `row-${i}`).join("\n");
    const once = compactToolOutputForMemory(lines);
    expect(compactToolOutputForMemory(once)).toBe(once);
  });
});

describe("maybeCompactToolOutputForMemory", () => {
  it("keeps raw output while running", () => {
    const long = Array.from({ length: 500 }, (_, i) => `L${i}`).join("\n");
    expect(maybeCompactToolOutputForMemory(long, true)).toBe(long);
  });

  it("compacts on terminal status", () => {
    const long = Array.from({ length: 500 }, (_, i) => `L${i}`).join("\n");
    const out = maybeCompactToolOutputForMemory(long, false)!;
    expect(out.length).toBeLessThan(long.length);
    expect(out).toContain("L0");
  });
});

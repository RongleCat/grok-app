import { describe, expect, it } from "vitest";
import { isProjectPathMissing } from "./projectPath";

describe("isProjectPathMissing", () => {
  it("is true only for explicit false", () => {
    expect(isProjectPathMissing(false)).toBe(true);
  });

  it("treats true / nullish as ok (do not invent missing)", () => {
    expect(isProjectPathMissing(true)).toBe(false);
    expect(isProjectPathMissing(undefined)).toBe(false);
    expect(isProjectPathMissing(null)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { sourceHasMath } from "./markdownMath";

describe("sourceHasMath", () => {
  it("is false for ordinary chat markdown", () => {
    expect(sourceHasMath("")).toBe(false);
    expect(sourceHasMath("Use `path` and **bold**.")).toBe(false);
    expect(sourceHasMath("cost is 5 dollars")).toBe(false);
  });

  it("detects $ / $$ / \\( \\[", () => {
    expect(sourceHasMath("$E=mc^2$")).toBe(true);
    expect(sourceHasMath("$$\\int x$$")).toBe(true);
    expect(sourceHasMath("\\(x\\)")).toBe(true);
    expect(sourceHasMath("\\[a+b\\]")).toBe(true);
  });
});

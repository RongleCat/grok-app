import { describe, expect, it } from "vitest";
import { normalizeMarkdownMath, sourceHasMath } from "./markdownMath";

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

  it("detects a one-line [ TeX ] formula", () => {
    expect(
      sourceHasMath("[ I=\\int_1^2\\frac{x^2}{2}\\mathrm{d}x. ]"),
    ).toBe(true);
    expect(sourceHasMath("[docs](https://example.com)")).toBe(false);
    expect(sourceHasMath("cost is 5 dollars")).toBe(false);
  });

  it("rewrites \\[ \\] and one-line [ TeX ] to $$", () => {
    expect(normalizeMarkdownMath("\\[ a+b \\]")).toBe("$$ a+b $$");
    expect(normalizeMarkdownMath("\\(x\\)")).toBe("$x$");
    expect(
      normalizeMarkdownMath("[ I=\\int_1^2\\frac{x^2}{2}\\mathrm{d}x. ]"),
    ).toBe("$$ I=\\int_1^2\\frac{x^2}{2}\\mathrm{d}x. $$");
    expect(normalizeMarkdownMath("[docs](https://example.com)")).toBe(
      "[docs](https://example.com)",
    );
  });
});

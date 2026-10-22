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

  it("leaves \\[ \\] inside a code fence and inline code unchanged", () => {
    const fenced = "```\n\\[ x \\]\n```";
    expect(normalizeMarkdownMath(fenced)).toBe(fenced);
    expect(sourceHasMath(fenced)).toBe(false);
    const inline = "see `\\[x\\]`";
    expect(normalizeMarkdownMath(inline)).toBe(inline);
    expect(sourceHasMath(inline)).toBe(false);
  });

  it("leaves a tilde fence and a Windows line ending alone", () => {
    const tilde = "~~~\n\\[ x \\]\n~~~";
    expect(normalizeMarkdownMath(tilde)).toBe(tilde);
    const crlf = "```\r\n\\[ x \\]\r\n```\r\n\\(y\\)";
    expect(normalizeMarkdownMath(crlf)).toBe("```\r\n\\[ x \\]\r\n```\r\n$y$");
  });

  it("still rewrites a formula that sits outside a fence", () => {
    const src = "```\n\\[ x \\]\n```\n\\[ y \\]";
    expect(normalizeMarkdownMath(src)).toBe("```\n\\[ x \\]\n```\n$$ y $$");
    expect(sourceHasMath(src)).toBe(true);
  });
});

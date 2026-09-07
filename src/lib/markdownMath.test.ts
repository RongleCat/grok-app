import { describe, expect, it } from "vitest";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { MARKDOWN_REHYPE_PLUGINS, MARKDOWN_REMARK_PLUGINS } from "./markdownMath";

describe("markdownMath plugins", () => {
  it("keeps GFM then remark-math as a stable pair", () => {
    expect(MARKDOWN_REMARK_PLUGINS[0]).toBe(remarkGfm);
    expect(MARKDOWN_REMARK_PLUGINS[1]).toBe(remarkMath);
  });

  it("loads KaTeX styles lazily, then runs rehype-katex without throwing on bad TeX", () => {
    expect(MARKDOWN_REHYPE_PLUGINS).toHaveLength(2);
    // First entry is the css-on-attach loader plugin (keeps katex.min.css
    // off main.tsx's critical path); second is the configured rehype-katex.
    const cssLoader = MARKDOWN_REHYPE_PLUGINS[0];
    expect(typeof cssLoader).toBe("function");
    const entry = MARKDOWN_REHYPE_PLUGINS[1];
    expect(Array.isArray(entry)).toBe(true);
    const opts = (entry as [unknown, { throwOnError: boolean; trust: boolean }])[1];
    expect(opts.throwOnError).toBe(false);
    expect(opts.trust).toBe(false);
  });
});

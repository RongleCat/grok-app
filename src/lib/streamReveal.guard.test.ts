import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(__dirname, "../components/lobe-chat/lobe-chat.part1b.css"),
  "utf8",
);
const tokens = readFileSync(resolve(__dirname, "../styles/tokens.css"), "utf8");
const blockCss = readFileSync(
  resolve(__dirname, "../components/lobe-chat/lobe-chat.motion.css"),
  "utf8",
);

describe("stream reveal motion", () => {
  it("declares dedicated reveal tokens", () => {
    expect(tokens).toMatch(/--motion-stream-reveal:\s*340ms;/);
    expect(tokens).toMatch(/--motion-stream-reveal-step:\s*24ms;/);
    expect(tokens).toMatch(/--motion-stream-reveal-max:\s*144ms;/);
    expect(tokens).toMatch(/--motion-stream-reveal-ease:\s*cubic-bezier\(/);
  });

  it("animates opacity and a short blur only", () => {
    const keyframes =
      css.match(/@keyframes chat-stream-reveal-in\s*\{([\s\S]*?)\n\}/)?.[1] ??
      "";
    const properties = Array.from(
      keyframes.matchAll(/([a-z-]+)\s*:/g),
      (match) => match[1],
    );

    expect(new Set(properties)).toEqual(new Set(["opacity", "filter"]));
    expect(keyframes).toContain("filter: blur(2.5px)");
    expect(keyframes).toContain("filter: blur(0)");
    expect(keyframes).not.toContain("transform");
    expect(keyframes).not.toContain("translateY");
  });

  it("uses backwards fill so the blur does not linger", () => {
    expect(css).toMatch(
      /\.lobe-chat__live-tail \.chat-md \[data-reveal="1"\]\s*\{[^}]*animation:\s*chat-stream-reveal-in[^;]*backwards;/s,
    );
    expect(css).not.toMatch(
      /animation:\s*chat-stream-reveal-in[^;]*both;/s,
    );
  });

  it("keeps reveal spans inline and never overrides layout", () => {
    const revealRules = Array.from(
      css.matchAll(/^[^\n{}]*\[data-reveal[^{}]*\{([^}]*)\}/gm),
      (match) => match[1] ?? "",
    );

    expect(revealRules.length).toBeGreaterThan(0);
    for (const body of revealRules) {
      expect(body).not.toMatch(/display\s*:/);
      expect(body).not.toMatch(/transform\s*:/);
      expect(body).not.toMatch(/\b(?:width|height|margin|padding|font-size)\s*:/);
    }
  });

  it("scopes the reveal to the live tail with stagger and a per-batch cap", () => {
    expect(css).toMatch(
      /\.lobe-chat__live-tail \.chat-md \[data-reveal="1"\]\s*\{[^}]*animation:\s*chat-stream-reveal-in/s,
    );
    expect(css).toMatch(/var\(--reveal-i/);
    expect(css).toMatch(/--motion-stream-reveal-max/);
    // Every reveal selector must be anchored inside the live tail.
    const revealSelectors = css.match(/\.chat-md \[data-reveal/g) ?? [];
    const scopedSelectors =
      css.match(/\.lobe-chat__live-tail \.chat-md \[data-reveal/g) ?? [];
    expect(revealSelectors.length).toBeGreaterThan(0);
    expect(scopedSelectors.length).toBe(revealSelectors.length);
  });

  it("honors the output-motion switch and system reduced motion", () => {
    expect(css).toMatch(
      /html\[data-output-motion="off"\] \.lobe-chat__live-tail \.chat-md \[data-reveal\]\s*\{[^}]*animation:\s*none;/s,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.lobe-chat__live-tail \.chat-md \[data-reveal\]\s*\{[^}]*animation:\s*none;/s,
    );
  });
});

describe("chat block entrance motion", () => {
  const cleanBlockCss = blockCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = Array.from(
    cleanBlockCss.matchAll(/([^{}]+)\{([^{}]*)\}/g),
    (match) => match[1] ?? "",
  )
    .filter((selectorList) => selectorList.includes(".chat-block-enter"))
    .flatMap((selectorList) => selectorList.split(","))
    .map((selector) => selector.trim())
    .filter(Boolean);

  it("scopes every block entrance selector to the live tail", () => {
    expect(selectors.length).toBeGreaterThanOrEqual(3);
    for (const selector of selectors) {
      expect(selector).toContain(".lobe-chat__live-tail");
    }
  });

  it("is disabled by the output-motion switch and system reduced motion", () => {
    expect(cleanBlockCss).toMatch(
      /html\[data-output-motion="off"\][^{]*\.chat-block-enter[^{]*\{[^}]*animation:\s*none;/s,
    );
    expect(cleanBlockCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*\.chat-block-enter[^{]*\{[^}]*animation:\s*none;/s,
    );
  });
});

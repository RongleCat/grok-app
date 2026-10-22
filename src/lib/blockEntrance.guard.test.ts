import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(__dirname, "../components/lobe-chat/lobe-chat.motion.css"),
  "utf8",
);
const tokens = readFileSync(resolve(__dirname, "../styles/tokens.css"), "utf8");

type CssRule = { selectors: string[]; body: string };

function parseRules(text: string): CssRule[] {
  return Array.from(text.matchAll(/([^{}]+)\{([^{}]*)\}/g), (match) => ({
    selectors: (match[1] ?? "")
      .split(",")
      .map((selector) => selector.trim())
      .filter(Boolean),
    body: match[2] ?? "",
  }));
}

// Comments leak into selector text; strip them before splitting on commas.
const cleanCss = css.replace(/\/\*[\s\S]*?\*\//g, "");
const reducedBlock =
  cleanCss.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}\s*$/)?.[1] ??
  "";
const baseRules = parseRules(
  cleanCss.replace(/\s*@media \(prefers-reduced-motion: reduce\)[\s\S]*$/, ""),
);
const reducedRules = parseRules(reducedBlock);
const allRules = [...baseRules, ...reducedRules];

function isEntranceSelector(selector: string): boolean {
  return (
    selector.includes(".chat-block-enter") ||
    selector.includes(".chat-md-enter") ||
    selector.includes(".chat-detail-enter")
  );
}

function selectorsFor(className: string): string[] {
  return allRules
    .flatMap((rule) => rule.selectors)
    .filter((selector) => selector.includes(className));
}

const stateSelectors = [
  ".grok-act__label",
  ".grok-act__label-text",
  ".grok-act__icon",
];

describe("block entrance motion", () => {
  it("fades in place: opacity only, no transform (no CLS)", () => {
    const keyframes =
      css.match(/@keyframes chat-block-enter\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const properties = new Set(
      Array.from(keyframes.matchAll(/([a-z-]+)\s*:/g), (match) => match[1]),
    );

    expect(properties).toEqual(new Set(["opacity"]));
    expect(keyframes).not.toContain("transform");
    expect(keyframes).not.toContain("translateY");
    expect(keyframes).not.toContain("scale");
    expect(tokens).toMatch(/--motion-block-enter:\s*280ms;/);
    expect(tokens).toMatch(
      /--motion-block-enter-ease:\s*cubic-bezier\(0\.34,\s*1\.3,\s*0\.64,\s*1\);/,
    );
  });

  it("uses backwards fill for block entrance", () => {
    expect(cleanCss).toMatch(
      /animation:\s*chat-block-enter var\(--motion-block-enter\)\s*var\(--motion-block-enter-ease\)\s*backwards;/s,
    );
  });

  it("adds a shorter detail entrance for expanded bodies", () => {
    const keyframes =
      css.match(/@keyframes chat-detail-enter\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(keyframes).toContain("opacity: 0");
    expect(keyframes).not.toContain("transform");
    expect(keyframes).not.toContain("translateY");
    expect(tokens).toMatch(/--motion-detail-enter:\s*200ms;/);
    expect(cleanCss).toMatch(
      /\.lobe-chat__live-tail \.chat-detail-enter\s*\{[^}]*animation:\s*chat-detail-enter var\(--motion-detail-enter\)[^;]*backwards;/s,
    );
  });

  it("swaps the live activity label over 800ms and can be interrupted", () => {
    expect(tokens).toMatch(/--motion-now-swap:\s*800ms;/);
    expect(cleanCss).toMatch(
      /\.lobe-chat__live-tail \.grok-act__now\s*\{[^}]*animation:\s*chat-now-swap var\(--motion-now-swap\)[^;]*;/s,
    );
    expect(cleanCss).toMatch(
      /html\[data-output-motion="off"\][^{]*\.grok-act__now[^{]*\{[^}]*animation:\s*none;/s,
    );
    expect(cleanCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.grok-act__now[^{]*\{[^}]*animation:\s*none;/s,
    );
  });

  it("transitions tool and phase state changes inside the live tail", () => {
    const transitionRules = baseRules.filter(
      (rule) =>
        rule.body.includes("color var(--motion-state-change) ease") &&
        rule.selectors.some((selector) =>
          stateSelectors.some((state) => selector.includes(state)),
        ),
    );

    expect(transitionRules.length).toBeGreaterThan(0);
    expect(tokens).toMatch(/--motion-state-change:\s*180ms;/);
    for (const rule of transitionRules) {
      for (const selector of rule.selectors) {
        expect(selector).toContain(".lobe-chat__live-tail");
      }
      expect(rule.body).toMatch(
        /transition:\s*color var\(--motion-state-change\) ease,\s*opacity var\(--motion-state-change\) ease;/s,
      );
    }
    for (const state of stateSelectors) {
      expect(
        transitionRules.some((rule) =>
          rule.selectors.some((selector) => selector.includes(state)),
        ),
      ).toBe(true);
    }
  });

  it("keeps the stream-tail wrapper out of layout", () => {
    const rule = baseRules.find((r) =>
      r.selectors.includes(".chat-md__stream-tail"),
    );
    expect(rule?.body).toContain("display: contents");
  });

  it("scopes every selector in every comma list", () => {
    const entranceSelectors = allRules
      .flatMap((rule) => rule.selectors)
      .filter(isEntranceSelector);

    expect(entranceSelectors.length).toBeGreaterThan(0);
    for (const selector of entranceSelectors) {
      expect(selector).toContain(".lobe-chat__live-tail");
      if (selector.includes(".chat-md-enter")) {
        expect(
          selector.includes(".chat-md__stream-tail--live .chat-md-enter") ||
            selector.includes(".struct-json.chat-md-enter"),
        ).toBe(true);
      }
    }
  });

  it("covers row containers, markdown containers and expanded bodies", () => {
    expect(selectorsFor(".chat-block-enter").length).toBeGreaterThan(0);
    expect(selectorsFor(".chat-md__stream-tail--live .chat-md-enter").length).toBeGreaterThan(0);
    expect(selectorsFor(".struct-json.chat-md-enter").length).toBeGreaterThan(0);
    expect(selectorsFor(".chat-detail-enter").length).toBeGreaterThan(0);
  });

  it("honors the output-motion switch for every motion class", () => {
    const offRules = baseRules.filter((rule) =>
      rule.selectors.some((selector) =>
        selector.includes('data-output-motion="off"'),
      ),
    );
    const offSelectors = offRules.flatMap((rule) => rule.selectors);
    const animationOffRules = offRules.filter((rule) =>
      rule.body.includes("animation:"),
    );
    const transitionOffRules = offRules.filter((rule) =>
      rule.body.includes("transition:"),
    );

    expect(animationOffRules.length).toBeGreaterThan(0);
    for (const rule of animationOffRules) {
      expect(rule.body).toMatch(/animation:\s*none;/);
    }
    expect(transitionOffRules.length).toBeGreaterThan(0);
    for (const rule of transitionOffRules) {
      expect(rule.body).toMatch(/transition:\s*none;/);
    }
    expect(offSelectors.some((selector) => selector.includes(".chat-block-enter"))).toBe(
      true,
    );
    expect(offSelectors.some((selector) => selector.includes(".chat-md-enter"))).toBe(
      true,
    );
    expect(
      offSelectors.some((selector) => selector.includes(".chat-detail-enter")),
    ).toBe(true);
    for (const state of stateSelectors) {
      expect(
        offSelectors.some((selector) => selector.includes(state)),
      ).toBe(true);
    }
  });

  it("honors system reduced motion for every motion class", () => {
    const reducedSelectors = reducedRules.flatMap((rule) => rule.selectors);
    const animationReducedRules = reducedRules.filter((rule) =>
      rule.body.includes("animation:"),
    );
    const transitionReducedRules = reducedRules.filter((rule) =>
      rule.body.includes("transition:"),
    );

    expect(animationReducedRules.length).toBeGreaterThan(0);
    for (const rule of animationReducedRules) {
      expect(rule.body).toMatch(/animation:\s*none;/);
    }
    expect(transitionReducedRules.length).toBeGreaterThan(0);
    for (const rule of transitionReducedRules) {
      expect(rule.body).toMatch(/transition:\s*none;/);
    }
    expect(
      reducedSelectors.some((selector) => selector.includes(".chat-block-enter")),
    ).toBe(true);
    expect(
      reducedSelectors.some((selector) => selector.includes(".chat-md-enter")),
    ).toBe(true);
    expect(
      reducedSelectors.some((selector) => selector.includes(".chat-detail-enter")),
    ).toBe(true);
    for (const state of stateSelectors) {
      expect(
        reducedSelectors.some((selector) => selector.includes(state)),
      ).toBe(true);
    }
  });
});

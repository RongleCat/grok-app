/**
 * Structural guard: assistant conclusion text must not paint over a sibling
 * (tool stdout / process speech). The #667/#672 Working-rail crush used
 * flex-shrink + overflow:visible; the same hole one level up (timeline /
 * answer / expand-body) stacked two bodies in one box.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../components/lobe-chat");

function css(file: string): string {
  return readFileSync(join(ROOT, file), "utf8");
}

describe("chat answer overlap guard", () => {
  it("keeps transcript rows from flex-shrinking inside .lobe-chat__inner", () => {
    const src = css("lobe-chat.part1.css");
    expect(src).toMatch(/\.lobe-chat-item\s*\{[^}]*flex-shrink:\s*0/s);
  });

  it("keeps the conclusion markdown from shrinking under the work fold", () => {
    const src = css("lobe-chat.part2.css");
    expect(src).toMatch(/\.chat-md--answer\s*\{[^}]*flex-shrink:\s*0/s);
  });

  it("scopes expand-body overflow:visible to a capped/virtual scroller", () => {
    const src = css("lobe-chat.part2.css");
    // Bare `.grok-act__expand-body { overflow: visible }` lets bash stdout
    // paint over the answer when the fold height is short.
    expect(src).not.toMatch(
      /(?:^|\n)\.grok-act__expand-body\s*\{[^}]*overflow:\s*visible/s,
    );
    expect(src).toMatch(
      /\.grok-act__steps--(?:capped|virtual)\s+\.grok-act__expand-body\s*\{[^}]*overflow:\s*visible/s,
    );
  });

  it("reserves a transcript scrollbar gutter only when the column is tight", () => {
    const src = css("lobe-chat.part1.css");
    const scrollStart = src.indexOf(".lobe-chat__scroll {");
    const innerStart = src.indexOf(".lobe-chat__inner {");
    expect(scrollStart).toBeGreaterThanOrEqual(0);
    expect(innerStart).toBeGreaterThan(scrollStart);
    const scrollBlock = src.slice(scrollStart, innerStart);
    expect(scrollBlock).toContain("container-type: inline-size");
    expect(scrollBlock).toContain("container-name: chat-scroll");
    expect(scrollBlock).toContain("scrollbar-gutter: stable");
    expect(scrollBlock).toMatch(/scrollbar-width:\s*thin\s*!important/);
    expect(scrollBlock).toMatch(
      /\.lobe-chat__scroll::-webkit-scrollbar\s*\{[^}]*width:\s*var\(--scrollbar-size/s,
    );
    const innerBlock = src.slice(
      innerStart,
      src.indexOf(".lobe-chat-item {", innerStart),
    );
    expect(innerBlock).toMatch(/padding:\s*20px 20px 8px/);
    expect(innerBlock).toMatch(
      /padding-inline-end:\s*max\(\s*20px,\s*calc\([\s\S]*100cqi\s*-\s*var\(--chat-width-max/,
    );
    expect(innerBlock).toContain('html[data-chat-width="full"] .lobe-chat__inner');
    // Composer clearance must be a real box in scrollHeight, not only
    // padding-bottom (WKWebView drops that from scrollHeight → last lines
    // park under the floating composer).
    expect(innerBlock).toMatch(
      /\.lobe-chat__end-pad\s*\{[^}]*height:\s*calc\(\s*var\(--composer-float-pad/,
    );
  });

  it("does not nest a 220px scroller on live thinking", () => {
    const src = css("lobe-chat.part2.css");
    expect(src).toMatch(
      /\.grok-thought\.is-live\s+\.grok-thought__body\s*\{[^}]*max-height:\s*none/s,
    );
    expect(src).toMatch(
      /\.grok-thought\.is-live\s+\.grok-thought__body\s*\{[^}]*overflow:\s*visible/s,
    );
  });

  it("gives answer paragraphs an explicit unitless line-height", () => {
    const src = css("lobe-chat.part1.css");
    expect(src).toMatch(
      /\.chat-md p\s*\{[^}]*line-height:\s*var\(--chat-lh\)/s,
    );
  });
});

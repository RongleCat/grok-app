/**
 * Active-session composer shares Appearance chat reading width
 * (`--chat-width-max` / html[data-chat-width]). Welcome/empty session
 * keeps the classic 42rem input.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const STYLES = join(ROOT, "styles");
const LOBE = join(ROOT, "components/lobe-chat");

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("composer tracks chat reading width", () => {
  it("hoists --chat-width-max onto html[data-chat-width]", () => {
    const css = stripComments(
      readFileSync(join(LOBE, "lobe-chat.part3.css"), "utf8"),
    );
    expect(css).toMatch(
      /html\[data-chat-width="narrow"\][^{]*\{[^}]*--chat-width-max:\s*640px/s,
    );
    expect(css).toMatch(
      /html\[data-chat-width="medium"\][^{]*\{[^}]*--chat-width-max:\s*800px/s,
    );
    expect(css).toMatch(
      /html\[data-chat-width="wide"\][^{]*\{[^}]*--chat-width-max:\s*1000px/s,
    );
    expect(css).toMatch(
      /html\[data-chat-width="full"\][^{]*\{[^}]*--chat-width-max:\s*none/s,
    );
  });

  it("active composer / stack / perm-bar use --chat-width-max", () => {
    const part1 = stripComments(
      readFileSync(join(STYLES, "chat.part1.css"), "utf8"),
    );
    const part2 = stripComments(
      readFileSync(join(STYLES, "chat.part2.css"), "utf8"),
    );

    const stack = part1.match(/(?:^|\n)\.composer-stack\s*\{[^}]*\}/);
    expect(stack?.[0]).toMatch(/max-width:\s*var\(--chat-width-max/);

    const perm = part1.match(/(?:^|\n)\.perm-bar\s*\{[^}]*\}/);
    expect(perm?.[0]).toMatch(/max-width:\s*var\(--chat-width-max/);
    // Floating composer wrap is pointer-events:none; the card must opt back in
    // and stay no-drag so Windows WebView2 does not swallow Approve / Deny.
    expect(perm?.[0]).toMatch(/pointer-events:\s*auto/);
    expect(perm?.[0]).toMatch(/-webkit-app-region:\s*no-drag/);

    // Prefer the standalone .composer rule (not .composer-stack .composer).
    const composer = [...part2.matchAll(/(?:^|\n)\.composer\s*\{[^}]*\}/g)].map(
      (m) => m[0],
    );
    expect(composer.some((b) => /max-width:\s*var\(--chat-width-max/.test(b))).toBe(
      true,
    );
  });

  it("welcome/empty session keeps classic 42rem composer width", () => {
    const part1 = stripComments(
      readFileSync(join(STYLES, "chat.part1.css"), "utf8"),
    );
    const stack = part1.match(
      /\.composer-wrap--welcome\s+\.composer-stack\s*\{[^}]*\}/,
    );
    expect(stack?.[0]).toMatch(/max-width:\s*42rem/);
    expect(part1).toMatch(
      /\.composer-wrap--welcome\s+\.composer-stack\s+\.composer\s*,\s*\.composer-wrap--welcome\s*>\s*\.composer\s*\{[^}]*max-width:\s*42rem/s,
    );
  });

  it("side-dock composer avoids min(..., none) with full width", () => {
    const css = stripComments(
      readFileSync(join(STYLES, "side-workbench.part1.css"), "utf8"),
    );
    const dock = css.match(
      /\.composer-wrap--side-dock\s+\.composer\s*\{[^}]*\}/,
    );
    expect(dock?.[0]).toMatch(/max-width:\s*var\(--chat-width-max/);
    expect(dock?.[0]).not.toMatch(/min\(/);
  });
});

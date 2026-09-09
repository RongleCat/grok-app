/**
 * Composer · context-window inline edit: the token input must never push the
 * Save button out of the flyout panel.
 *
 * Root cause: `input[type=number]` carries an intrinsic minimum width in
 * some engines (notably WKWebView). With `flex: 1` the input refuses
 * to shrink below that intrinsic width, so the button overflows the
 * `overflow-x: hidden` flyout and becomes unclickable. `width: 0` on the
 * flex item lets the flex algorithm ignore the intrinsic width entirely.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(__dirname, "../styles/composer.part1.css"),
  "utf8",
);

describe("composer context-window inline edit", () => {
  it("keeps the number input shrinkable so Save stays inside the panel", () => {
    const block = css.match(
      /\.cmm__inline-edit input\s*\{(?<body>[^}]*)\}/s,
    )?.groups?.body;
    expect(block).toBeTruthy();
    // Flex item must be allowed to shrink to zero intrinsic width.
    expect(block).toMatch(/flex:\s*1 1 0/);
    expect(block).toMatch(/min-width:\s*0/);
    expect(block).toMatch(/width:\s*0/);
  });

  it("pins the Save button to its content width", () => {
    const block = css.match(
      /\.cmm__inline-save\s*\{(?<body>[^}]*)\}/s,
    )?.groups?.body;
    expect(block).toBeTruthy();
    expect(block).toMatch(/flex:\s*0 0 auto/);
    expect(block).toMatch(/white-space:\s*nowrap/);
  });
});

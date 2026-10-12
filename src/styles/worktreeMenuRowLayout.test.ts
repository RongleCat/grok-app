/**
 * Branch menu row layout: a row's name is the row.
 *
 * The PR rows print a rollup beside the name (`state · checks · branch`), and on
 * a real PR that rollup is wide enough to fill the row by itself. With the
 * rollup holding its full width and the name free to shrink, the name collapsed
 * to zero width: the row read as a bare rollup with no PR on it, and the rollup
 * spilled out of the item and ran under the trailing watch bell. These are
 * source-level assertions — jsdom has no layout, so the widths themselves are
 * measured in the browser (see the PR that fixed it).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));

function readCss(name: string): string {
  return readFileSync(join(dir, name), "utf8");
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Top-level `selector { … }` bodies. Skips at-rules, comments, and nested blocks. */
function ruleBodies(css: string, selector: string): string[] {
  const bodies: string[] = [];
  const re = /(?:^|\n)([^{}@\n][^{}]*)\{([^}]*)\}/g;
  for (const match of stripComments(css).matchAll(re)) {
    const selectors = match[1]!.split(",").map((part) => part.trim());
    if (selectors.includes(selector)) bodies.push(match[2]!);
  }
  return bodies;
}

const css = ["chat.part1.css", "chat.part2.css", "chat.part3.css"]
  .map(readCss)
  .join("\n");

const ROW_META = ".cwm__item-meta";
const PR_ROW_NAME = ".cwm__pr-row .cwm__item-name";
const PR_ROW_META = ".cwm__pr-row .cwm__item-meta";

describe("branch menu row layout", () => {
  it("keeps a floor under the PR row's title", () => {
    const body = ruleBodies(css, PR_ROW_NAME).join("\n");
    expect(body).not.toBe("");
    expect(body).toMatch(/min-width\s*:\s*40%/);
    expect(body).toMatch(/text-overflow\s*:\s*ellipsis/);
  });

  it("caps the PR rollup so it cannot take the row from the title", () => {
    const body = ruleBodies(css, PR_ROW_META).join("\n");
    expect(body).not.toBe("");
    // floor (40%) + the row's 8px gap + cap (60%) is exactly one row.
    expect(body).toMatch(/max-width\s*:\s*calc\(\s*60%\s*-\s*8px\s*\)/);
    expect(body).toMatch(/flex-shrink\s*:\s*0/);
  });

  it("clips row meta instead of letting it hold its full width", () => {
    const body = ruleBodies(css, ROW_META).join("\n");
    expect(body).not.toBe("");
    // `flex-shrink: 0` here is what squeezed the PR title to zero width.
    expect(body).not.toMatch(/flex-shrink\s*:\s*0/);
    expect(body).toMatch(/min-width\s*:\s*0/);
    expect(body).toMatch(/overflow\s*:\s*hidden/);
    expect(body).toMatch(/text-overflow\s*:\s*ellipsis/);
  });
});

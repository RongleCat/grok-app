/**
 * The boot splash paints before the JS bundle loads, so its copy lives as a
 * table in index.html rather than a catalog lookup. Keep the two in step.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { LOCALES, loadAllLocaleCatalogs, messages } from "./messages";

const INDEX_HTML = resolve(__dirname, "../../index.html");

/** One row: `"ja": ["Grok \u3078\u3088\u3046\u3053\u305d", "..."],` */
const ROW =
  /^\s*"([A-Za-z-]+)":\s*\["((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)"\],?\s*$/gm;

function readBootCopy(): Record<string, [string, string]> {
  const html = readFileSync(INDEX_HTML, "utf8");
  const start = html.indexOf("var BOOT_COPY = {");
  expect(start, "BOOT_COPY table missing from index.html").toBeGreaterThan(-1);
  const body = html.slice(start, html.indexOf("};", start));
  const out: Record<string, [string, string]> = {};
  for (const m of body.matchAll(ROW)) out[m[1]] = [m[2], m[3]];
  return out;
}

describe("boot splash copy", () => {
  beforeAll(async () => {
    await loadAllLocaleCatalogs();
  });
  const table = readBootCopy();

  it("covers exactly the shipped catalogs", () => {
    expect(Object.keys(table).sort()).toEqual([...LOCALES].sort());
  });

  it("says the same thing as each catalog's setup gate", () => {
    // React swaps #root for the setup gate a moment later. A mismatch here
    // shows the user two different sentences in the same second.
    for (const locale of LOCALES) {
      expect(table[locale], locale).toEqual([
        messages[locale]["setup.title"],
        messages[locale]["setup.detecting"],
      ]);
    }
  });
});

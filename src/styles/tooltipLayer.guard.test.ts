/**
 * Tip stacking band.
 *
 * A tip is portaled to `document.body` and anchored to a control that lives in
 * some surface (a floating menu, the space switcher menu, a GlassModal, an app
 * dialog). DOM order cannot put it on top of those surfaces — they are portaled
 * too — so the only thing that decides is the layer. At `10050` a tip on a row
 * inside the branch menu painted *behind* the open menu: hovering the watch bell
 * showed the tooltip underneath it. Keep the tip band above every surface a tip
 * can be anchored in.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FLOATING_MENU_Z_INDEX } from "@/lib/floatingMenu";

const dir = dirname(fileURLToPath(import.meta.url));

function readCss(name: string): string {
  return readFileSync(join(dir, name), "utf8");
}

/** `z-index` declared for `selector` (top-level rule, last declaration wins). */
function zIndexOf(css: string, selector: string): number | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`,
    "g",
  );
  let found: number | null = null;
  for (const match of css.matchAll(re)) {
    const z = /z-index\s*:\s*(-?\d+)/.exec(match[1]!);
    if (z) found = Number(z[1]);
  }
  return found;
}

/** Surfaces a tip can be anchored inside, and where each one declares its layer. */
const SURFACES: Array<[file: string, selector: string]> = [
  ["chat.part3.css", ".att-menu"],
  ["chat.part4.css", ".overlay"],
  ["chat.part6.css", ".app-dialog-overlay"],
  ["settings.part5.css", ".app-toast"],
  ["sidebar.part1.css", ".yarl__portal"],
  ["sidebar.part1b.css", ".space-switcher__menu"],
];

describe("tip stacking band", () => {
  const sidebarCss = readCss("sidebar.part1.css");
  const tipZ = zIndexOf(sidebarCss, ".ui-tip");

  it("puts the tip layer above every surface it can be anchored in", () => {
    expect(tipZ).not.toBeNull();
    expect(tipZ!).toBeGreaterThan(FLOATING_MENU_Z_INDEX);
    for (const [file, selector] of SURFACES) {
      const surfaceZ = zIndexOf(readCss(file), selector);
      expect(surfaceZ, `${file} ${selector}`).not.toBeNull();
      expect(tipZ!, `${selector} (${file})`).toBeGreaterThan(surfaceZ!);
    }
  });

  it("never lowers a tip variant below the tip band", () => {
    const variants = [...sidebarCss.matchAll(/\.ui-tip--[\w-]+\s*\{([^}]*)\}/g)];
    for (const [, body] of variants) {
      const z = /z-index\s*:\s*(-?\d+)/.exec(body!);
      if (z) expect(Number(z[1])).toBeGreaterThanOrEqual(tipZ!);
    }
  });
});

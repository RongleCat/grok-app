/**
 * Toasts must paint above GlassModal overlays, otherwise rewind / fork
 * errors are invisible and the dialog looks stuck.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES = join(__dirname, "../styles");

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function block(css: string, selector: string): string {
  const re = new RegExp(
    `(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{[^}]*\\}`,
  );
  return css.match(re)?.[0] ?? "";
}

describe("toast vs modal overlay stacking", () => {
  it("places app-toast above .overlay (12000)", () => {
    const toastCss = stripComments(
      readFileSync(join(STYLES, "settings.part5.css"), "utf8"),
    );
    const overlayCss = stripComments(
      readFileSync(join(STYLES, "chat.part4.css"), "utf8"),
    );
    const toast = block(toastCss, ".app-toast");
    const overlay = block(overlayCss, ".overlay");
    expect(toast).toMatch(/z-index:\s*14000/);
    expect(overlay).toMatch(/z-index:\s*12000/);
  });
});

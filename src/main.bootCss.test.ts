import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("boot CSS", () => {
  const src = readFileSync(join(here, "main.tsx"), "utf8");

  it("does not import streamdown styles in main.tsx", () => {
    expect(src).not.toContain("streamdown/styles.css");
  });

  it("loads PetApp and App through dynamic import", () => {
    expect(src).not.toMatch(/import\s+App\s+from\s+["']\.\/App["']/);
    expect(src).not.toMatch(/import\s+\{\s*PetApp\s*\}\s+from/);
    expect(src).toContain('import("./components/pet/PetApp")');
    expect(src).toContain('import("./App")');
  });
});

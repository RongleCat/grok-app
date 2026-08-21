import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("boot CSS", () => {
  it("does not import streamdown styles in main.tsx", () => {
    const src = readFileSync(join(here, "main.tsx"), "utf8");
    expect(src).not.toContain("streamdown/styles.css");
  });
});

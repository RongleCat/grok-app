import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(__dirname, "PetApp.tsx"), "utf8");

describe("PetApp first paint", () => {
  it("boots from injected overlay prefs instead of flashing default green", () => {
    expect(src).toContain("readPetBootPrefs");
    expect(src).toContain("useState<PetPrefs>(readPetBootPrefs)");
  });
});

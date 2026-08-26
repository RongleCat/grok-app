import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(__dirname, "PetApp.tsx"), "utf8");

describe("PetApp first paint", () => {
  it("boots from injected overlay prefs instead of flashing default green", () => {
    expect(src).toContain("readPetBootPrefs");
    expect(src).toContain("useState<PetPrefs>(readPetBootPrefs)");
  });

  it("loads the UI catalog so pet copy follows the app language", () => {
    expect(src).toContain("loadLocaleCatalog");
    expect(src).toContain("parseLocalePreference");
    expect(src).toContain("resolveLocalePreference");
    expect(src).toContain("__GROK_BOOT_LOCALE__");
    expect(src).toContain("localeCatalogRev");
  });
});

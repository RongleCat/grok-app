import { describe, expect, it } from "vitest";
import {
  OFFICIAL_SKIN_CATALOG_URL,
  officialCatalogConfigured,
} from "./skinCatalog";

describe("skinCatalog constants", () => {
  it("ships with empty official URL", () => {
    expect(OFFICIAL_SKIN_CATALOG_URL).toBe("");
    expect(officialCatalogConfigured()).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  isLocaleCatalogReady,
  loadLocaleCatalog,
  t,
} from "./index";

describe("on-demand locale catalogs", () => {
  it("keeps English ready without a loader", () => {
    expect(isLocaleCatalogReady("en")).toBe(true);
  });

  it("zh catalog supplies Chinese once loaded", async () => {
    await loadLocaleCatalog("zh");
    expect(isLocaleCatalogReady("zh")).toBe(true);
    expect(t("zh", "window.minimize")).toBe("最小化");
  });
});

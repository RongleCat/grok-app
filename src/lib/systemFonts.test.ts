import { describe, expect, it } from "vitest";
import {
  CSS_GENERIC_MONO_FAMILY,
  CSS_GENERIC_UI_FAMILY,
  filterFontFamilies,
  fontSelectOptions,
  normalizeInstalledFontFamilies,
} from "./systemFonts";

describe("systemFonts", () => {
  it("normalizes aliases, hidden faces, and case-insensitive dupes", () => {
    expect(
      normalizeInstalledFontFamilies([
        " Inter ",
        "PingFang SC,PingFang SC",
        ".SF NS",
        "@Arial Unicode MS",
        "inter",
        "",
      ]),
    ).toEqual(["Inter", "PingFang SC"]);
  });

  it("filters by substring without regard to case", () => {
    expect(
      filterFontFamilies(["PingFang SC", "Inter", "Menlo"], "fang"),
    ).toEqual(["PingFang SC"]);
  });

  it("puts system default and system-ui ahead of installed faces", () => {
    const options = fontSelectOptions({
      families: ["Inter", "PingFang SC"],
      query: "",
      current: "",
      defaultLabel: "System default",
    });
    expect(options[0]).toEqual({ value: "", label: "System default" });
    expect(options[1]).toEqual({
      value: CSS_GENERIC_UI_FAMILY,
      label: CSS_GENERIC_UI_FAMILY,
    });
    expect(options.map((o) => o.value)).toContain("PingFang SC");
  });

  it("keeps a leftover custom value that is not installed", () => {
    const options = fontSelectOptions({
      families: ["Inter"],
      query: "",
      current: "Comic Sans MS",
      defaultLabel: "System default",
    });
    expect(options.some((o) => o.value === "Comic Sans MS")).toBe(true);
  });

  it("hides leftover custom values that do not match the query", () => {
    const options = fontSelectOptions({
      families: ["Inter"],
      query: "inter",
      current: "Comic Sans MS",
      defaultLabel: "System default",
    });
    expect(options.some((o) => o.value === "Comic Sans MS")).toBe(false);
    expect(options.some((o) => o.value === "Inter")).toBe(true);
  });

  it("can swap the generic family for the terminal picker", () => {
    const options = fontSelectOptions({
      families: ["Menlo"],
      query: "",
      current: "",
      defaultLabel: "Built-in Nerd Font",
      genericFamily: CSS_GENERIC_MONO_FAMILY,
    });
    expect(options[0].label).toBe("Built-in Nerd Font");
    expect(options[1]).toEqual({
      value: CSS_GENERIC_MONO_FAMILY,
      label: CSS_GENERIC_MONO_FAMILY,
    });
    expect(options.some((o) => o.value === CSS_GENERIC_UI_FAMILY)).toBe(false);
  });
});

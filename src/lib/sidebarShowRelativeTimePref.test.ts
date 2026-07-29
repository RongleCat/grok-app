import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIDEBAR_SHOW_RELATIVE_TIME,
  SIDEBAR_SHOW_RELATIVE_TIME_STORAGE_KEY,
  loadSidebarShowRelativeTimePref,
  parseSidebarShowRelativeTimePref,
  saveSidebarShowRelativeTimePref,
  type SidebarShowRelativeTimeStorage,
} from "./sidebarShowRelativeTimePref";

function memoryStorage(
  initial: Record<string, string> = {},
): SidebarShowRelativeTimeStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return key in data ? data[key]! : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
  };
}

describe("sidebarShowRelativeTimePref", () => {
  it("defaults to true", () => {
    expect(DEFAULT_SIDEBAR_SHOW_RELATIVE_TIME).toBe(true);
    expect(parseSidebarShowRelativeTimePref(null)).toBe(true);
    expect(parseSidebarShowRelativeTimePref("")).toBe(true);
    expect(parseSidebarShowRelativeTimePref("maybe")).toBe(true);
    expect(loadSidebarShowRelativeTimePref(memoryStorage())).toBe(true);
  });

  it("parses true/false variants", () => {
    expect(parseSidebarShowRelativeTimePref("1")).toBe(true);
    expect(parseSidebarShowRelativeTimePref("true")).toBe(true);
    expect(parseSidebarShowRelativeTimePref(true)).toBe(true);
    expect(parseSidebarShowRelativeTimePref("0")).toBe(false);
    expect(parseSidebarShowRelativeTimePref("false")).toBe(false);
    expect(parseSidebarShowRelativeTimePref(false)).toBe(false);
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveSidebarShowRelativeTimePref(false, s);
    expect(s.data[SIDEBAR_SHOW_RELATIVE_TIME_STORAGE_KEY]).toBe("0");
    expect(loadSidebarShowRelativeTimePref(s)).toBe(false);
    saveSidebarShowRelativeTimePref(true, s);
    expect(s.data[SIDEBAR_SHOW_RELATIVE_TIME_STORAGE_KEY]).toBe("1");
    expect(loadSidebarShowRelativeTimePref(s)).toBe(true);
  });
});

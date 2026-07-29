import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIDEBAR_DENSITY,
  SIDEBAR_DENSITIES,
  SIDEBAR_DENSITY_ATTR,
  SIDEBAR_DENSITY_METRICS,
  SIDEBAR_DENSITY_STORAGE_KEY,
  applySidebarDensity,
  isSidebarDensity,
  loadSidebarDensity,
  parseSidebarDensity,
  saveSidebarDensity,
  setSidebarDensity,
  sidebarSessionRowMetrics,
  type SidebarDensityStorage,
} from "./sidebarDensity";
import {
  SIDEBAR_SESSION_ROW_GAP,
  SIDEBAR_SESSION_ROW_HEIGHT,
} from "./virtualList";

function memoryStorage(
  initial: Record<string, string> = {},
): SidebarDensityStorage & { data: Record<string, string> } {
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

describe("sidebarDensity", () => {
  it("defaults to comfortable and rejects unknown values", () => {
    expect(DEFAULT_SIDEBAR_DENSITY).toBe("comfortable");
    expect(parseSidebarDensity(null)).toBe("comfortable");
    expect(parseSidebarDensity("")).toBe("comfortable");
    expect(parseSidebarDensity("dense")).toBe("comfortable");
    expect(isSidebarDensity("comfortable")).toBe(true);
    expect(isSidebarDensity("compact")).toBe(true);
    expect(isSidebarDensity("dense")).toBe(false);
    expect(SIDEBAR_DENSITIES).toEqual(["comfortable", "compact"]);
  });

  it("persists and reloads after simulated relaunch", () => {
    const storage = memoryStorage();
    expect(loadSidebarDensity(storage)).toBe("comfortable");
    saveSidebarDensity("compact", storage);
    expect(storage.data[SIDEBAR_DENSITY_STORAGE_KEY]).toBe("compact");
    expect(loadSidebarDensity(storage)).toBe("compact");
    saveSidebarDensity("comfortable", storage);
    expect(loadSidebarDensity(storage)).toBe("comfortable");
  });

  it("applySidebarDensity sets data-sidebar-density", () => {
    const attrs = new Map<string, string>();
    const el = {
      setAttribute(name: string, value: string) {
        attrs.set(name, value);
      },
    };
    applySidebarDensity("compact", el, false);
    expect(attrs.get(SIDEBAR_DENSITY_ATTR)).toBe("compact");
    applySidebarDensity("comfortable", el, false);
    expect(attrs.get(SIDEBAR_DENSITY_ATTR)).toBe("comfortable");
  });

  it("setSidebarDensity saves and applies", () => {
    const storage = memoryStorage();
    const attrs = new Map<string, string>();
    const el = {
      setAttribute(name: string, value: string) {
        attrs.set(name, value);
      },
    };
    setSidebarDensity("compact", storage, el);
    expect(storage.data[SIDEBAR_DENSITY_STORAGE_KEY]).toBe("compact");
    expect(attrs.get(SIDEBAR_DENSITY_ATTR)).toBe("compact");
  });

  it("comfortable metrics match VirtualList defaults", () => {
    const m = sidebarSessionRowMetrics("comfortable");
    expect(m.rowHeight).toBe(SIDEBAR_SESSION_ROW_HEIGHT);
    expect(m.gap).toBe(SIDEBAR_SESSION_ROW_GAP);
    expect(SIDEBAR_DENSITY_METRICS.comfortable).toEqual(m);
  });

  it("compact metrics are tighter than comfortable", () => {
    const c = sidebarSessionRowMetrics("compact");
    const comfy = sidebarSessionRowMetrics("comfortable");
    expect(c.rowHeight).toBeLessThan(comfy.rowHeight);
    expect(c.gap).toBeLessThanOrEqual(comfy.gap);
    expect(c.rowHeight).toBe(24);
    expect(c.gap).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import {
  bumpSidebarPage,
  clearSidebarPage,
  SIDEBAR_SESSION_PAGE_SIZE,
  sidebarVisibleCount,
  type SidebarPageMap,
} from "./sidebarPagination";

describe("sidebarVisibleCount", () => {
  it("caps the first window at one page", () => {
    expect(sidebarVisibleCount(3, 0, -1)).toBe(3);
    expect(sidebarVisibleCount(SIDEBAR_SESSION_PAGE_SIZE, 0, -1)).toBe(
      SIDEBAR_SESSION_PAGE_SIZE,
    );
    expect(sidebarVisibleCount(12, 0, -1)).toBe(SIDEBAR_SESSION_PAGE_SIZE);
  });

  it("grows the window one page per extra page", () => {
    expect(sidebarVisibleCount(12, 1, -1)).toBe(2 * SIDEBAR_SESSION_PAGE_SIZE);
    expect(sidebarVisibleCount(12, 2, -1)).toBe(12);
  });

  it("clamps at the group total", () => {
    expect(sidebarVisibleCount(7, 5, -1)).toBe(7);
  });

  it("returns 0 for an empty group", () => {
    expect(sidebarVisibleCount(0, 0, -1)).toBe(0);
    expect(sidebarVisibleCount(0, 3, 2)).toBe(0);
  });

  it("auto-expands page-wise until the active session is visible", () => {
    // Active row at index 6 → needs 2 pages (rows 0–9).
    expect(sidebarVisibleCount(20, 0, 6)).toBe(2 * SIDEBAR_SESSION_PAGE_SIZE);
    // Active row is the last of a page → still one page.
    expect(sidebarVisibleCount(20, 0, SIDEBAR_SESSION_PAGE_SIZE - 1)).toBe(
      SIDEBAR_SESSION_PAGE_SIZE,
    );
    // Active beyond user-revealed pages extends past them, page-aligned.
    expect(sidebarVisibleCount(30, 1, 11)).toBe(3 * SIDEBAR_SESSION_PAGE_SIZE);
    // Active inside the revealed window does not shrink it.
    expect(sidebarVisibleCount(30, 2, 3)).toBe(3 * SIDEBAR_SESSION_PAGE_SIZE);
    // Auto-expansion still clamps at total.
    expect(sidebarVisibleCount(7, 0, 6)).toBe(7);
  });

  it("treats negative extra pages as page one", () => {
    expect(sidebarVisibleCount(12, -2, -1)).toBe(SIDEBAR_SESSION_PAGE_SIZE);
  });
});

describe("bumpSidebarPage", () => {
  it("increments a group's extra pages without touching others", () => {
    const m: SidebarPageMap = { "proj:a": 1 };
    const next = bumpSidebarPage(m, "proj:b");
    expect(next["proj:b"]).toBe(1);
    expect(next["proj:a"]).toBe(1);
    expect(bumpSidebarPage(next, "proj:a")["proj:a"]).toBe(2);
    expect(m["proj:b"]).toBeUndefined();
  });
});

describe("clearSidebarPage", () => {
  it("removes the counter so reopening starts at page one", () => {
    const m: SidebarPageMap = { "proj:a": 3, orphans: 1 };
    const next = clearSidebarPage(m, "proj:a");
    expect("proj:a" in next).toBe(false);
    expect(next.orphans).toBe(1);
    // Clearing an absent key returns the same map (no state churn).
    expect(clearSidebarPage(m, "proj:missing")).toBe(m);
  });
});

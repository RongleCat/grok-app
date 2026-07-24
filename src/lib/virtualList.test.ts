import { describe, expect, it } from "vitest";
import {
  computeVirtualWindow,
  itemOffset,
  scrollTopForIndex,
  totalListHeight,
  SIDEBAR_SESSION_ROW_GAP,
  SIDEBAR_SESSION_ROW_HEIGHT,
  SIDEBAR_VIRTUALIZE_THRESHOLD,
} from "./virtualList";

const H = SIDEBAR_SESSION_ROW_HEIGHT;
const G = SIDEBAR_SESSION_ROW_GAP;

describe("totalListHeight / itemOffset", () => {
  it("empty list is zero height", () => {
    expect(totalListHeight(0, H, G)).toBe(0);
    expect(itemOffset(0, H, G)).toBe(0);
  });

  it("single row has no trailing gap", () => {
    expect(totalListHeight(1, H, G)).toBe(H);
  });

  it("n rows: n*height + (n-1)*gap", () => {
    expect(totalListHeight(100, H, G)).toBe(100 * H + 99 * G);
    expect(itemOffset(0, H, G)).toBe(0);
    expect(itemOffset(1, H, G)).toBe(H + G);
    expect(itemOffset(10, H, G)).toBe(10 * (H + G));
  });

  it("matches sidebar constants used by CSS", () => {
    expect(H).toBe(30);
    expect(G).toBe(2);
    expect(SIDEBAR_VIRTUALIZE_THRESHOLD).toBeGreaterThanOrEqual(16);
  });
});

describe("computeVirtualWindow", () => {
  it("returns empty window for zero items", () => {
    expect(
      computeVirtualWindow({
        itemCount: 0,
        rowHeight: H,
        gap: G,
        scrollOffset: 0,
        viewportHeight: 400,
      }),
    ).toEqual({
      start: 0,
      end: 0,
      paddingTop: 0,
      paddingBottom: 0,
      totalHeight: 0,
    });
  });

  it("renders a full small list when everything fits", () => {
    const count = 10;
    const win = computeVirtualWindow({
      itemCount: count,
      rowHeight: H,
      gap: G,
      scrollOffset: 0,
      viewportHeight: 800,
      overscan: 0,
    });
    expect(win.start).toBe(0);
    expect(win.end).toBe(count);
    expect(win.paddingTop).toBe(0);
    expect(win.paddingBottom).toBe(0);
    expect(win.totalHeight).toBe(totalListHeight(count, H, G));
  });

  it("windows a long list at the top", () => {
    const count = 200;
    const win = computeVirtualWindow({
      itemCount: count,
      rowHeight: H,
      gap: G,
      scrollOffset: 0,
      viewportHeight: 320, // ~10 rows
      overscan: 2,
    });
    expect(win.start).toBe(0);
    // ~10 visible + 2 overscan bottom
    expect(win.end).toBeGreaterThan(10);
    expect(win.end).toBeLessThan(30);
    expect(win.paddingTop).toBe(0);
    expect(win.paddingBottom).toBeGreaterThan(0);
    expect(win.paddingTop + totalListHeight(win.end - win.start, H, G) + win.paddingBottom).toBe(
      win.totalHeight,
    );
  });

  it("windows mid-list with correct spacers", () => {
    const count = 200;
    const stride = H + G;
    // Scroll so row ~50 is at the top of the viewport
    const scrollOffset = 50 * stride;
    const win = computeVirtualWindow({
      itemCount: count,
      rowHeight: H,
      gap: G,
      scrollOffset,
      viewportHeight: 320,
      overscan: 3,
    });
    expect(win.start).toBe(50 - 3);
    expect(win.end).toBeGreaterThan(50);
    expect(win.paddingTop).toBe(itemOffset(win.start, H, G));
    expect(
      win.paddingTop +
        totalListHeight(win.end - win.start, H, G) +
        win.paddingBottom,
    ).toBe(win.totalHeight);
  });

  it("clamps at the bottom", () => {
    const count = 100;
    const total = totalListHeight(count, H, G);
    const win = computeVirtualWindow({
      itemCount: count,
      rowHeight: H,
      gap: G,
      scrollOffset: total, // past end
      viewportHeight: 200,
      overscan: 4,
    });
    expect(win.end).toBe(count);
    expect(win.start).toBeLessThan(count);
    expect(win.paddingBottom).toBe(0);
  });

  it("handles negative scrollOffset (list below viewport top)", () => {
    const win = computeVirtualWindow({
      itemCount: 50,
      rowHeight: H,
      gap: G,
      scrollOffset: -100,
      viewportHeight: 200,
      overscan: 0,
    });
    expect(win.start).toBe(0);
    expect(win.end).toBeGreaterThan(0);
    expect(win.paddingTop).toBe(0);
  });

  it("overscan expands the window without exceeding bounds", () => {
    const noOs = computeVirtualWindow({
      itemCount: 100,
      rowHeight: H,
      gap: G,
      scrollOffset: 0,
      viewportHeight: 100,
      overscan: 0,
    });
    const withOs = computeVirtualWindow({
      itemCount: 100,
      rowHeight: H,
      gap: G,
      scrollOffset: 0,
      viewportHeight: 100,
      overscan: 5,
    });
    expect(withOs.end - withOs.start).toBeGreaterThan(noOs.end - noOs.start);
    expect(withOs.start).toBe(0);
    expect(withOs.end).toBeLessThanOrEqual(100);
  });

  it("spacers + rendered rows always sum to totalHeight", () => {
    for (const scroll of [0, 50, 200, 1000, 5000]) {
      for (const vh of [100, 400, 800]) {
        const win = computeVirtualWindow({
          itemCount: 150,
          rowHeight: H,
          gap: G,
          scrollOffset: scroll,
          viewportHeight: vh,
          overscan: 6,
        });
        const rendered = totalListHeight(win.end - win.start, H, G);
        expect(win.paddingTop + rendered + win.paddingBottom).toBe(
          win.totalHeight,
        );
        expect(win.start).toBeGreaterThanOrEqual(0);
        expect(win.end).toBeLessThanOrEqual(150);
        expect(win.start).toBeLessThan(win.end);
      }
    }
  });
});

describe("scrollTopForIndex", () => {
  const base = {
    itemCount: 100,
    rowHeight: H,
    gap: G,
    viewportHeight: 300,
    listOffsetTop: 0,
    margin: 0,
  };

  it("does not move when item already visible", () => {
    const top = scrollTopForIndex(2, {
      ...base,
      currentScrollTop: 0,
    });
    expect(top).toBe(0);
  });

  it("scrolls up when item is above the viewport", () => {
    const top = scrollTopForIndex(0, {
      ...base,
      currentScrollTop: 500,
    });
    expect(top).toBe(0);
  });

  it("scrolls down when item is below the viewport", () => {
    const idx = 80;
    const top = scrollTopForIndex(idx, {
      ...base,
      currentScrollTop: 0,
    });
    expect(top).toBeGreaterThan(0);
    // Item bottom should land at or above view bottom
    const itemBottom = itemOffset(idx, H, G) + H;
    expect(itemBottom).toBeLessThanOrEqual(top + base.viewportHeight);
  });

  it("accounts for listOffsetTop within a nested group", () => {
    const idx = 5;
    const listOffsetTop = 200;
    const top = scrollTopForIndex(idx, {
      ...base,
      listOffsetTop,
      currentScrollTop: 0,
    });
    // Item absolute top = 200 + 5*(30+2) = 360; viewport 300 → need scroll
    expect(top).toBe(listOffsetTop + itemOffset(idx, H, G) + H - base.viewportHeight);
  });
});

/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, act } from "@testing-library/react";
import { useChatMessageVirtualizer } from "./useChatMessageVirtualizer";

afterEach(cleanup);

describe("useChatMessageVirtualizer", () => {
  it("renders full non-virtualized window when itemCount is below threshold and height is small", () => {
    const viewport = document.createElement("div");
    const isPinnedRef = { current: true };
    const viewportRef = { current: viewport };

    const { result } = renderHook(() =>
      useChatMessageVirtualizer({
        itemCount: 5,
        getKey: (i) => "item-" + i,
        getEstimateHeight: () => 50,
        viewportRef,
        isPinnedRef,
        threshold: 20,
      }),
    );

    expect(result.current.virtualized).toBe(false);
    expect(result.current.start).toBe(0);
    expect(result.current.end).toBe(5);
    expect(result.current.paddingTop).toBe(0);
    expect(result.current.paddingBottom).toBe(0);
  });

  it("hydrates a journal onto the tail when stick identity goes pending → ready", () => {
    const viewport = document.createElement("div");
    Object.defineProperty(viewport, "clientHeight", { value: 600, configurable: true });
    Object.defineProperty(viewport, "scrollHeight", { value: 8000, configurable: true });
    Object.defineProperty(viewport, "scrollTop", { value: 0, writable: true, configurable: true });
    const isPinnedRef = { current: false };
    const viewportRef = { current: viewport };

    const { result, rerender } = renderHook(
      ({ key, count }) =>
        useChatMessageVirtualizer({
          itemCount: count,
          getKey: (i) => `s1-${i}`,
          getEstimateHeight: () => 100,
          viewportRef,
          isPinnedRef,
          conversationKey: key,
          threshold: 10,
        }),
      { initialProps: { key: "s1:pending", count: 0 } },
    );

    rerender({ key: "s1:ready", count: 80 });

    expect(result.current.virtualized).toBe(true);
    expect(result.current.end).toBe(80);
    expect(result.current.paddingBottom).toBe(0);
  });

  it("opens a conversation on the tail even if the previous chat had escaped pin", () => {
    const viewport = document.createElement("div");
    Object.defineProperty(viewport, "clientHeight", { value: 600, configurable: true });
    Object.defineProperty(viewport, "scrollHeight", { value: 8000, configurable: true });
    Object.defineProperty(viewport, "scrollTop", { value: 0, writable: true, configurable: true });
    const isPinnedRef = { current: false };
    const viewportRef = { current: viewport };

    const { result, rerender } = renderHook(
      ({ key, count }) =>
        useChatMessageVirtualizer({
          itemCount: count,
          getKey: (i) => `${key}-${i}`,
          getEstimateHeight: () => 100,
          viewportRef,
          isPinnedRef,
          conversationKey: key,
          threshold: 10,
        }),
      { initialProps: { key: "chat-a", count: 80 } },
    );

    rerender({ key: "chat-b", count: 80 });

    expect(result.current.virtualized).toBe(true);
    expect(result.current.end).toBe(80);
    expect(result.current.paddingBottom).toBe(0);
  });

  it("activates virtualization when itemCount exceeds threshold", () => {
    const viewport = document.createElement("div");
    Object.defineProperty(viewport, "clientHeight", { value: 600, configurable: true });
    Object.defineProperty(viewport, "scrollTop", { value: 0, configurable: true });
    const isPinnedRef = { current: false };
    const viewportRef = { current: viewport };

    const { result } = renderHook(() =>
      useChatMessageVirtualizer({
        itemCount: 100,
        getKey: (i) => "item-" + i,
        getEstimateHeight: () => 100,
        viewportRef,
        isPinnedRef,
        threshold: 10,
      }),
    );

    expect(result.current.virtualized).toBe(true);
    expect(result.current.start).toBe(0);
    expect(result.current.end).toBeLessThan(100);
    expect(result.current.paddingBottom).toBeGreaterThan(0);
  });

  it("stays on a full native window when enabled is false", () => {
    const viewport = document.createElement("div");
    Object.defineProperty(viewport, "clientHeight", { value: 600, configurable: true });
    Object.defineProperty(viewport, "scrollTop", { value: 0, configurable: true });
    const isPinnedRef = { current: false };
    const viewportRef = { current: viewport };

    const { result } = renderHook(() =>
      useChatMessageVirtualizer({
        itemCount: 100,
        getKey: (i) => "item-" + i,
        getEstimateHeight: () => 100,
        viewportRef,
        isPinnedRef,
        threshold: 10,
        enabled: false,
      }),
    );

    expect(result.current.virtualized).toBe(false);
    expect(result.current.start).toBe(0);
    expect(result.current.end).toBe(100);
    expect(result.current.paddingTop).toBe(0);
    expect(result.current.paddingBottom).toBe(0);
  });

  it("returns stable measureRef callbacks across re-renders for the same index", () => {
    const viewport = document.createElement("div");
    const isPinnedRef = { current: false };
    const viewportRef = { current: viewport };

    const { result, rerender } = renderHook(
      ({ count }) =>
        useChatMessageVirtualizer({
          itemCount: count,
          getKey: (i) => "item-" + i,
          getEstimateHeight: () => 100,
          viewportRef,
          isPinnedRef,
          threshold: 10,
        }),
      { initialProps: { count: 30 } },
    );

    const cb0_a = result.current.measureRef(0);
    const cb1_a = result.current.measureRef(1);

    rerender({ count: 35 });

    const cb0_b = result.current.measureRef(0);
    const cb1_b = result.current.measureRef(1);

    expect(cb0_a).toBe(cb0_b);
    expect(cb1_a).toBe(cb1_b);
  });

  it("observes elements with shared ResizeObserver on measureRef attachment", () => {
    const observeMock = vi.fn();
    const unobserveMock = vi.fn();
    const disconnectMock = vi.fn();

    class MockResizeObserver {
      observe = observeMock;
      unobserve = unobserveMock;
      disconnect = disconnectMock;
      constructor(public callback: ResizeObserverCallback) {}
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);

    const viewport = document.createElement("div");
    const isPinnedRef = { current: false };
    const viewportRef = { current: viewport };

    const { result } = renderHook(() =>
      useChatMessageVirtualizer({
        itemCount: 50,
        getKey: (i) => "item-" + i,
        getEstimateHeight: () => 100,
        viewportRef,
        isPinnedRef,
        threshold: 10,
      }),
    );

    const rowEl = document.createElement("div");
    act(() => {
      result.current.measureRef(3)(rowEl);
    });

    expect(observeMock).toHaveBeenCalledWith(rowEl);

    act(() => {
      result.current.measureRef(3)(null);
    });

    expect(unobserveMock).toHaveBeenCalledWith(rowEl);
  });

  it("rebuilds the tail window synchronously on pinned itemCount growth", () => {
    const viewport = document.createElement("div");
    Object.defineProperty(viewport, "clientHeight", { value: 600, configurable: true });
    Object.defineProperty(viewport, "scrollHeight", { value: 10000, configurable: true });
    Object.defineProperty(viewport, "scrollTop", { value: 0, writable: true, configurable: true });
    const isPinnedRef = { current: true };
    const viewportRef = { current: viewport };

    const { result, rerender } = renderHook(
      ({ count }) =>
        useChatMessageVirtualizer({
          itemCount: count,
          getKey: (i) => `pin-${i}`,
          getEstimateHeight: () => 100,
          viewportRef,
          isPinnedRef,
          threshold: 10,
        }),
      { initialProps: { count: 30 } },
    );

    act(() => {
      // Pinned itemCount growth must keep the window bottom-anchored on the
      // urgent lane (a transition-deferred swap clamps scrollTop through a
      // collapsed-scrollHeight DOM state — "jump to the middle after settle").
      rerender({ count: 40 });
    });
    expect(result.current.end).toBe(40);
    expect(result.current.paddingBottom).toBe(0);
  });
});

describe("useChatMessageVirtualizer touch freeze", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  function mount(opts: { pinned: boolean; count?: number; scrollTop?: number }) {
    const count = opts.count ?? 80;
    const row = 100;
    const viewport = document.createElement("div");
    Object.defineProperty(viewport, "clientHeight", {
      value: 600,
      configurable: true,
    });
    Object.defineProperty(viewport, "scrollHeight", {
      value: count * row,
      configurable: true,
    });
    Object.defineProperty(viewport, "scrollTop", {
      value: opts.scrollTop ?? Math.max(0, count * row - 600),
      writable: true,
      configurable: true,
    });
    document.body.appendChild(viewport);
    const isPinnedRef = { current: opts.pinned };
    const viewportRef = { current: viewport };
    const hook = renderHook(() =>
      useChatMessageVirtualizer({
        itemCount: count,
        getKey: (i) => "item-" + i,
        getEstimateHeight: () => row,
        viewportRef,
        isPinnedRef,
        threshold: 10,
      }),
    );
    act(() => {
      vi.advanceTimersByTime(16);
    });
    return { viewport, isPinnedRef, ...hook };
  }

  function dispatchPointer(
    target: EventTarget,
    type: string,
    pointerType: string,
  ) {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        isPrimary: true,
        pointerId: 1,
        pointerType,
        button: 0,
      }),
    );
  }

  function dispatchTouch(target: EventTarget, type: string, n: number) {
    const ev = new Event(type, { bubbles: true });
    Object.defineProperty(ev, "touches", {
      value: Array.from({ length: n }, (_, i) => ({ identifier: i })),
    });
    target.dispatchEvent(ev);
  }

  it("does not treat touch pointercancel as lift while still pinned", () => {
    const { viewport } = mount({ pinned: true });
    act(() => {
      dispatchPointer(viewport, "pointerdown", "touch");
      dispatchPointer(window, "pointercancel", "touch");
      viewport.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(250);
    });
    expect(viewport.dataset.scrolling).toBe("1");
  });

  it("never exposes the scrolling UI flag for programmatic pin follow", () => {
    const { viewport } = mount({ pinned: true });
    act(() => {
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(viewport.dataset.scrolling).toBeUndefined();
  });

  it("still exposes the scrolling UI flag for explicit wheel input", () => {
    const { viewport } = mount({ pinned: true });
    act(() => {
      viewport.dispatchEvent(new Event("wheel"));
    });
    expect(viewport.dataset.scrolling).toBe("1");
  });

  it("does not clear scrolling mid-wheel while pinned (#1159)", () => {
    // Trackpad leave-bottom: wheel sets scrolling, then scroll runs
    // recomputeNow. Must not clear scrollingRef in the same turn or pin-snap
    // yanks sub-10px escapes. Idle settle may clear later (#1172).
    const { viewport } = mount({ pinned: true });
    act(() => {
      viewport.dispatchEvent(new Event("wheel"));
      viewport.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(16);
    });
    expect(viewport.dataset.scrolling).toBe("1");
  });

  it("clears scrolling after pinned wheel idle so thinking can pin-follow (#1172)", () => {
    const { viewport } = mount({ pinned: true });
    act(() => {
      viewport.dispatchEvent(new Event("wheel"));
      viewport.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(16);
    });
    expect(viewport.dataset.scrolling).toBe("1");
    act(() => {
      // pinnedScrollIdleTimer (160) + hover-restore debounce (220)
      vi.advanceTimersByTime(400);
    });
    expect(viewport.dataset.scrolling).toBeUndefined();
  });

  it("clears contact on the last touchend, not pointercancel", () => {
    const { viewport } = mount({ pinned: true });
    act(() => {
      dispatchPointer(viewport, "pointerdown", "touch");
      dispatchTouch(viewport, "touchstart", 1);
      dispatchPointer(window, "pointercancel", "touch");
      viewport.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(16);
    });
    expect(viewport.dataset.scrolling).toBe("1");
    act(() => {
      dispatchTouch(viewport, "touchend", 0);
      vi.advanceTimersByTime(250);
    });
    expect(viewport.dataset.scrolling).toBeUndefined();
  });

  it("updates geo shells after unpin and still paints the live viewport", () => {
    const { viewport, result } = mount({
      pinned: false,
      count: 300,
      scrollTop: 0,
    });
    const start0 = result.current.start;
    act(() => {
      dispatchPointer(viewport, "pointerdown", "touch");
      dispatchPointer(window, "pointercancel", "touch");
      viewport.scrollTop = 2400;
      viewport.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(16);
    });
    expect(result.current.start).toBeGreaterThan(start0);
    expect(result.current.richStart).toBeGreaterThan(10);
    expect(result.current.richStart).toBeLessThanOrEqual(24);
    expect(result.current.richEnd).toBeGreaterThan(24);
  });
});

describe("useChatMessageVirtualizer pinned pendingAnchorOffset drop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  let roCallback: ResizeObserverCallback | null = null;
  class MockResizeObserver {
    constructor(cb: ResizeObserverCallback) {
      roCallback = cb;
    }
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }

  /**
   * A pre-pin descent scenario: 80 rows × 100px, viewport 600px, the user is
   * 800px above the tail and scrolling. Row 0 (fully above the viewport)
   * re-measures 100 → 500 while scrolling → the shift must be absorbed into
   * pendingAnchorOffset (compressed paddingTop), never written to scrollTop.
   */
  function mountDescending() {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const count = 80;
    const row = 100;
    const viewport = document.createElement("div");
    Object.defineProperty(viewport, "clientHeight", {
      value: 600,
      configurable: true,
    });
    Object.defineProperty(viewport, "scrollHeight", {
      value: count * row,
      configurable: true,
    });
    Object.defineProperty(viewport, "scrollTop", {
      value: count * row - 600 - 800,
      writable: true,
      configurable: true,
    });
    document.body.appendChild(viewport);
    const isPinnedRef = { current: false };
    const viewportRef = { current: viewport };
    const hook = renderHook(() =>
      useChatMessageVirtualizer({
        itemCount: count,
        getKey: (i) => "item-" + i,
        getEstimateHeight: () => row,
        viewportRef,
        isPinnedRef,
        threshold: 10,
      }),
    );
    act(() => {
      vi.advanceTimersByTime(16);
    });
    return { viewport, isPinnedRef, rowEl: document.createElement("div"), ...hook };
  }

  function commitRow0Growth(rowEl: HTMLElement) {
    roCallback?.(
      [
        {
          target: rowEl,
          borderBoxSize: [{ blockSize: 500 }],
        } as unknown as ResizeObserverEntry,
      ],
      {} as ResizeObserver,
    );
  }

  /**
   * Clean pinned baseline for the same geometry: row 0 pre-measured at 500
   * via the estimator, no descent, no absorption. Its paddingTop is what
   * the drop must restore, independent of overscan constants.
   */
  function mountPinnedControlPaddingTop(): number {
    const count = 80;
    const viewport = document.createElement("div");
    Object.defineProperty(viewport, "clientHeight", {
      value: 600,
      configurable: true,
    });
    Object.defineProperty(viewport, "scrollHeight", {
      value: count * 100,
      configurable: true,
    });
    Object.defineProperty(viewport, "scrollTop", {
      value: 0,
      writable: true,
      configurable: true,
    });
    document.body.appendChild(viewport);
    const { result } = renderHook(() =>
      useChatMessageVirtualizer({
        itemCount: count,
        getKey: (i) => "ctrl-" + i,
        getEstimateHeight: (i) => (i === 0 ? 500 : 100),
        viewportRef: { current: viewport },
        isPinnedRef: { current: true },
        threshold: 10,
      }),
    );
    act(() => {
      vi.advanceTimersByTime(16);
    });
    return result.current.paddingTop;
  }

  it("drops the absorbed offset after re-pin so the snap lands on the real bottom", () => {
    const controlPaddingTop = mountPinnedControlPaddingTop();
    const { viewport, isPinnedRef, rowEl, result } = mountDescending();
    const scrollTopBefore = viewport.scrollTop;
    act(() => {
      result.current.measureRef(0)(rowEl);
      viewport.dispatchEvent(new Event("wheel"));
      commitRow0Growth(rowEl);
      vi.advanceTimersByTime(16);
    });
    // Absorbed: scrollTop untouched while scrolling; the 400px shift went
    // into the spacer (paddingTop below the clean value for this window).
    expect(viewport.scrollTop).toBe(scrollTopBefore);

    // Re-pin lands before velocity settle (the bug window). Scroll under pin
    // arms the 160ms idle release (#1172), whose recompute drops the offset.
    isPinnedRef.current = true;
    act(() => {
      viewport.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(400);
    });
    expect(result.current.paddingTop).toBe(controlPaddingTop);
    expect(viewport.scrollTop).toBe(viewport.scrollHeight - viewport.clientHeight);

    // Idempotent: further recomputes hold the restored padding / bottom.
    act(() => {
      viewport.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(400);
    });
    expect(result.current.paddingTop).toBe(controlPaddingTop);
    expect(viewport.scrollTop).toBe(viewport.scrollHeight - viewport.clientHeight);
  });

  it("does not drop mid-scroll while scrollingRef still holds (#1159 neighbor)", () => {
    const controlPaddingTop = mountPinnedControlPaddingTop();
    const { viewport, isPinnedRef, rowEl, result } = mountDescending();
    act(() => {
      result.current.measureRef(0)(rowEl);
      viewport.dispatchEvent(new Event("wheel"));
      commitRow0Growth(rowEl);
      vi.advanceTimersByTime(16);
    });

    // Pin flips but the motion has not idled yet — keep the spacer
    // compressed until idle; restoring mid-fling would jump scrollHeight.
    isPinnedRef.current = true;
    act(() => {
      viewport.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(16);
    });
    expect(viewport.dataset.scrolling).toBe("1");
    expect(result.current.paddingTop).toBe(controlPaddingTop - 400);
  });

  it("still flushes the absorbed offset to scrollTop when unpinned (velocity settle)", () => {
    const { viewport, rowEl, result } = mountDescending();
    const scrollTopBefore = viewport.scrollTop;
    act(() => {
      result.current.measureRef(0)(rowEl);
      viewport.dispatchEvent(new Event("wheel"));
      commitRow0Growth(rowEl);
      vi.advanceTimersByTime(16);
    });
    expect(viewport.scrollTop).toBe(scrollTopBefore);

    // Escape path unchanged: motion settles (scrollTop static → velocity 0),
    // the absorbed +400 flushes into scrollTop to keep the reading anchor.
    act(() => {
      viewport.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(1000);
    });
    expect(viewport.scrollTop).toBe(scrollTopBefore + 400);
  });

  it("touch lift drop still restores full padding under pin", () => {
    const controlPaddingTop = mountPinnedControlPaddingTop();
    const { viewport, isPinnedRef, rowEl, result } = mountDescending();
    act(() => {
      result.current.measureRef(0)(rowEl);
      viewport.dispatchEvent(new Event("wheel"));
      commitRow0Growth(rowEl);
      vi.advanceTimersByTime(16);
    });

    isPinnedRef.current = true;
    act(() => {
      viewport.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          isPrimary: true,
          pointerId: 1,
          pointerType: "touch",
          button: 0,
        }),
      );
      const touchstart = new Event("touchstart", { bubbles: true });
      Object.defineProperty(touchstart, "touches", { value: [{ identifier: 0 }] });
      viewport.dispatchEvent(touchstart);
      const touchend = new Event("touchend", { bubbles: true });
      Object.defineProperty(touchend, "touches", { value: [] });
      viewport.dispatchEvent(touchend);
      vi.advanceTimersByTime(16);
    });
    expect(result.current.paddingTop).toBe(controlPaddingTop);
    expect(viewport.scrollTop).toBe(viewport.scrollHeight - viewport.clientHeight);
  });
});

describe("useChatMessageVirtualizer oversized shift guard (#1257 follow-up)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  let roCallback: ResizeObserverCallback | null = null;
  class MockResizeObserver {
    constructor(cb: ResizeObserverCallback) {
      roCallback = cb;
    }
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }

  /**
   * Stationary reader 800px from the top, unpinned, not scrolling. Row 0
   * sits fully above the viewport: a remount (compact↔rich) re-measures it
   * far from the estimate — the compensation must not yank scrollTop.
   */
  function mountStationaryReader() {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const count = 80;
    const row = 100;
    const viewport = document.createElement("div");
    Object.defineProperty(viewport, "clientHeight", {
      value: 600,
      configurable: true,
    });
    Object.defineProperty(viewport, "scrollHeight", {
      value: count * row,
      configurable: true,
    });
    Object.defineProperty(viewport, "scrollTop", {
      value: 800,
      writable: true,
      configurable: true,
    });
    document.body.appendChild(viewport);
    const hook = renderHook(() =>
      useChatMessageVirtualizer({
        itemCount: count,
        getKey: (i) => "guard-" + i,
        getEstimateHeight: () => row,
        viewportRef: { current: viewport },
        isPinnedRef: { current: false },
        threshold: 10,
      }),
    );
    act(() => {
      vi.advanceTimersByTime(16);
    });
    return { viewport, rowEl: document.createElement("div"), ...hook };
  }

  let rowElRef: { current: HTMLElement | null } = { current: null };

  function remeasureRow0(blockSize: number) {
    roCallback?.(
      [
        {
          target: rowElRef.current!,
          borderBoxSize: [{ blockSize }],
        } as unknown as ResizeObserverEntry,
      ],
      {} as ResizeObserver,
    );
  }

  it("defers an oversized above-viewport shift instead of yanking scrollTop mid-read", () => {
    const { viewport, rowEl, result } = mountStationaryReader();
    rowElRef.current = rowEl;
    act(() => {
      result.current.measureRef(0)(rowEl);
    });
    const before = viewport.scrollTop;
    // Compact remount measures 5000 vs the 100 estimate (+4900 > viewport).
    act(() => {
      remeasureRow0(5000);
    });
    expect(viewport.scrollTop).toBe(before);
  });

  it("still applies a small above-viewport shift immediately", () => {
    const { viewport, rowEl, result } = mountStationaryReader();
    rowElRef.current = rowEl;
    act(() => {
      result.current.measureRef(0)(rowEl);
    });
    const before = viewport.scrollTop;
    act(() => {
      remeasureRow0(150);
    });
    expect(viewport.scrollTop).toBe(before + 50);
  });
});

describe("useChatMessageVirtualizer oversized flush drop (#1257 follow-up)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  let roCallback: ResizeObserverCallback | null = null;
  class MockResizeObserver {
    constructor(cb: ResizeObserverCallback) {
      roCallback = cb;
    }
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }

  /**
   * Same stationary-reader geometry as the oversized-shift guard, but the
   * remount delta lands while scrolling: an oversized absorption must be
   * dropped on velocity settle, never flushed — flushing the uncanceled
   * remount remainder yanked the reader from the top of the last answer to
   * the previous reply.
   */
  function mountScrollingReader() {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const count = 80;
    const row = 100;
    const viewport = document.createElement("div");
    Object.defineProperty(viewport, "clientHeight", {
      value: 600,
      configurable: true,
    });
    Object.defineProperty(viewport, "scrollHeight", {
      value: count * row,
      configurable: true,
    });
    Object.defineProperty(viewport, "scrollTop", {
      value: 800,
      writable: true,
      configurable: true,
    });
    document.body.appendChild(viewport);
    const hook = renderHook(() =>
      useChatMessageVirtualizer({
        itemCount: count,
        getKey: (i) => "flush-" + i,
        getEstimateHeight: () => row,
        viewportRef: { current: viewport },
        isPinnedRef: { current: false },
        threshold: 10,
      }),
    );
    act(() => {
      vi.advanceTimersByTime(16);
    });
    return { viewport, rowEl: document.createElement("div"), ...hook };
  }

  it("drops an oversized absorbed offset on settle instead of flushing it", () => {
    const { viewport, rowEl, result } = mountScrollingReader();
    const before = viewport.scrollTop;
    act(() => {
      result.current.measureRef(0)(rowEl);
      viewport.dispatchEvent(new Event("wheel"));
      // 5000 vs 100 estimate → +4900 absorbed (viewport is 600).
      roCallback?.(
        [
          {
            target: rowEl,
            borderBoxSize: [{ blockSize: 5000 }],
          } as unknown as ResizeObserverEntry,
        ],
        {} as ResizeObserver,
      );
      vi.advanceTimersByTime(16);
    });
    expect(viewport.scrollTop).toBe(before);

    // Motion settles: the oversized batch must be dropped, not flushed.
    act(() => {
      viewport.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(1000);
    });
    expect(viewport.scrollTop).toBe(before);
  });
});

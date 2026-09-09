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

  it("still clears the scrolling flag for programmatic pin follow", () => {
    const { viewport } = mount({ pinned: true });
    act(() => {
      viewport.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(250);
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

  it("updates geo shells after unpin but does not snap the rich band to the new target", () => {
    const { viewport, result } = mount({
      pinned: false,
      count: 300,
      scrollTop: 0,
    });
    const richEnd0 = result.current.richEnd;
    const start0 = result.current.start;
    expect(richEnd0).toBeGreaterThan(0);
    act(() => {
      dispatchPointer(viewport, "pointerdown", "touch");
      dispatchPointer(window, "pointercancel", "touch");
      viewport.scrollTop = 2400;
      viewport.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(16);
    });
    expect(result.current.start).toBeGreaterThan(start0);
    expect(result.current.richEnd).toBe(richEnd0);
    expect(result.current.richStart).toBeLessThan(20);
  });
});

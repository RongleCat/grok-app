/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
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

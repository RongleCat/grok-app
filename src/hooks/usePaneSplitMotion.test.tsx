/**
 * @vitest-environment jsdom
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  nativeWebviewCoverDepth,
  resetNativeWebviewCoverForTests,
} from "@/lib/nativeWebviewCover";
import {
  isPaneSplitMotionActive,
  PANE_SPLIT_MOTION_TIMEOUT_MS,
  resetPaneSplitMotionForTests,
} from "@/lib/paneSplitMotion";
import { usePaneSplitMotion } from "./usePaneSplitMotion";

const initialProps = {
  sidebarCollapsed: false,
  asideCollapsed: false,
  phoneLayout: false,
  sidebarOverlay: false,
  asideOverlay: true,
};

function dispatchWidthTransitionEnd(className: string): void {
  const pane = document.createElement("aside");
  pane.className = className;
  document.body.appendChild(pane);
  const event = new Event("transitionend", { bubbles: true });
  Object.defineProperty(event, "propertyName", { value: "width" });
  pane.dispatchEvent(event);
  pane.remove();
}

describe("usePaneSplitMotion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPaneSplitMotionForTests();
    resetNativeWebviewCoverForTests();
  });

  afterEach(() => {
    cleanup();
    resetPaneSplitMotionForTests();
    resetNativeWebviewCoverForTests();
    vi.useRealTimers();
  });

  it("keeps native webviews covered across a rapid aside overlay reversal", () => {
    const { rerender } = renderHook((props) => usePaneSplitMotion(props), {
      initialProps,
    });

    rerender({ ...initialProps, asideOverlay: false });
    expect(nativeWebviewCoverDepth()).toBe(1);
    expect(isPaneSplitMotionActive()).toBe(true);

    act(() => dispatchWidthTransitionEnd("aside"));
    expect(nativeWebviewCoverDepth()).toBe(1);

    act(() => vi.advanceTimersByTime(200));
    rerender(initialProps);
    expect(nativeWebviewCoverDepth()).toBe(1);

    act(() => vi.advanceTimersByTime(PANE_SPLIT_MOTION_TIMEOUT_MS - 1));
    expect(nativeWebviewCoverDepth()).toBe(1);
    act(() => vi.advanceTimersByTime(1));
    expect(nativeWebviewCoverDepth()).toBe(0);
    expect(isPaneSplitMotionActive()).toBe(false);
  });

  it("ends an in-flow sidebar token on its width transition", () => {
    const { rerender } = renderHook((props) => usePaneSplitMotion(props), {
      initialProps: { ...initialProps, asideOverlay: false },
    });

    rerender({
      ...initialProps,
      asideOverlay: false,
      sidebarCollapsed: true,
    });
    expect(isPaneSplitMotionActive()).toBe(true);

    act(() => dispatchWidthTransitionEnd("sidebar"));
    expect(isPaneSplitMotionActive()).toBe(false);
  });
});

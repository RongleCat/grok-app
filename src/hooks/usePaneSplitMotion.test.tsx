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
  asideInFlow: false,
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

    rerender({ ...initialProps, asideOverlay: false, asideInFlow: true });
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
      initialProps: {
        ...initialProps,
        asideOverlay: false,
        asideInFlow: true,
      },
    });

    rerender({
      ...initialProps,
      asideOverlay: false,
      asideInFlow: true,
      sidebarCollapsed: true,
    });
    expect(isPaneSplitMotionActive()).toBe(true);

    act(() => dispatchWidthTransitionEnd("sidebar"));
    expect(isPaneSplitMotionActive()).toBe(false);
  });

  it("covers native webviews while an in-flow aside interpolates", () => {
    const props = {
      ...initialProps,
      asideOverlay: false,
      asideInFlow: true,
    };
    const { result, rerender } = renderHook(
      (next) => usePaneSplitMotion(next),
      { initialProps: props },
    );

    rerender({ ...props, asideCollapsed: true });
    expect(result.current.paneMotionClass).toContain(
      "workbench--aside-motion",
    );
    expect(nativeWebviewCoverDepth()).toBe(1);
    expect(isPaneSplitMotionActive()).toBe(true);

    act(() => dispatchWidthTransitionEnd("aside"));
    expect(nativeWebviewCoverDepth()).toBe(0);
    expect(isPaneSplitMotionActive()).toBe(false);
  });

  it("waits for both in-flow panes before ending a shared motion", () => {
    const props = {
      ...initialProps,
      asideOverlay: false,
      asideInFlow: true,
    };
    const { rerender } = renderHook((next) => usePaneSplitMotion(next), {
      initialProps: props,
    });

    rerender({
      ...props,
      sidebarCollapsed: true,
      asideCollapsed: true,
    });
    expect(nativeWebviewCoverDepth()).toBe(1);
    expect(isPaneSplitMotionActive()).toBe(true);

    act(() => dispatchWidthTransitionEnd("sidebar"));
    expect(nativeWebviewCoverDepth()).toBe(1);
    expect(isPaneSplitMotionActive()).toBe(true);

    act(() => dispatchWidthTransitionEnd("aside"));
    expect(nativeWebviewCoverDepth()).toBe(0);
    expect(isPaneSplitMotionActive()).toBe(false);
  });

  it("does not animate an aside leaving the in-flow split", () => {
    const props = {
      ...initialProps,
      asideOverlay: false,
      asideInFlow: true,
    };
    const { result, rerender } = renderHook(
      (next) => usePaneSplitMotion(next),
      { initialProps: props },
    );

    rerender({ ...props, asideCollapsed: true, asideInFlow: false });
    expect(result.current.paneMotionClass).not.toContain(
      "workbench--aside-motion",
    );
    expect(nativeWebviewCoverDepth()).toBe(0);
    expect(isPaneSplitMotionActive()).toBe(false);
  });

  it("does not cover webviews when an overlay becomes side-expanded", () => {
    const { result, rerender } = renderHook(
      (next) => usePaneSplitMotion(next),
      { initialProps },
    );

    rerender({ ...initialProps, asideOverlay: false, asideInFlow: false });
    expect(result.current.paneMotionClass).toBe("");
    expect(nativeWebviewCoverDepth()).toBe(0);
    expect(isPaneSplitMotionActive()).toBe(false);
  });

  it("ends an active in-flow aside motion when side-expanded takes over", () => {
    const props = {
      ...initialProps,
      asideOverlay: false,
      asideInFlow: true,
    };
    const { result, rerender } = renderHook(
      (next) => usePaneSplitMotion(next),
      { initialProps: props },
    );

    rerender({ ...props, asideCollapsed: true });
    expect(nativeWebviewCoverDepth()).toBe(1);
    expect(isPaneSplitMotionActive()).toBe(true);

    rerender({
      ...props,
      asideCollapsed: true,
      asideInFlow: false,
    });
    expect(result.current.paneMotionClass).toBe("");
    expect(nativeWebviewCoverDepth()).toBe(0);
    expect(isPaneSplitMotionActive()).toBe(false);
  });

  it("ends an active overlay token when side-expanded takes over", () => {
    const props = {
      ...initialProps,
      asideOverlay: false,
      asideInFlow: true,
    };
    const { result, rerender } = renderHook(
      (next) => usePaneSplitMotion(next),
      { initialProps: props },
    );

    rerender({ ...props, asideOverlay: true, asideInFlow: false });
    expect(nativeWebviewCoverDepth()).toBe(1);
    expect(isPaneSplitMotionActive()).toBe(true);

    rerender({ ...props, asideOverlay: false, asideInFlow: false });
    expect(result.current.paneMotionClass).toBe("");
    expect(nativeWebviewCoverDepth()).toBe(0);
    expect(isPaneSplitMotionActive()).toBe(false);
  });
});

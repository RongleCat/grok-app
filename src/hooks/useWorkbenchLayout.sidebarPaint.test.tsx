/**
 * @vitest-environment jsdom
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/test/jsdomStubs";
import {
  DEFAULT_LAYOUT,
  LAYOUT_STORAGE_KEY,
} from "@/lib/layout";
import { applyLiveSplitWidth } from "@/lib/paneDragLive";
import { useWorkbenchLayout } from "./useWorkbenchLayout";

function usedSize(el: HTMLElement): {
  width: string;
  minWidth: string;
  maxWidth: string;
  flexBasis: string;
} {
  const s = el.style;
  return {
    width: s.width,
    minWidth: s.minWidth,
    maxWidth: s.maxWidth,
    flexBasis: s.flexBasis,
  };
}

function px(n: number): string {
  return `${n}px`;
}

describe("useWorkbenchLayout sidebar sync paint", () => {
  let sidebar: HTMLElement;

  beforeEach(() => {
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1400,
    });
    const workbench = document.createElement("div");
    workbench.className = "workbench";
    sidebar = document.createElement("aside");
    sidebar.className = "sidebar";
    workbench.appendChild(sidebar);
    document.body.appendChild(workbench);
    applyLiveSplitWidth(sidebar, DEFAULT_LAYOUT.sidebarWidth);
  });

  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
  });

  it("writes destination used size before React flushes the host commit", () => {
    const { result } = renderHook(() => useWorkbenchLayout());
    const openPx = px(DEFAULT_LAYOUT.sidebarWidth);

    // Do not wrap in act: the paint must land on this turn, before React
    // flushes startTransition / host reconcile.
    result.current.closeSidebarPane();
    expect(usedSize(sidebar)).toEqual({
      width: px(0),
      minWidth: px(0),
      maxWidth: px(0),
      flexBasis: px(0),
    });
    expect(sidebar.classList.contains("sidebar--hidden")).toBe(true);
    expect(sidebar.classList.contains("sidebar--collapsed")).toBe(true);

    result.current.openSidebarPane();
    expect(usedSize(sidebar)).toEqual({
      width: openPx,
      minWidth: openPx,
      maxWidth: openPx,
      flexBasis: openPx,
    });
    expect(sidebar.classList.contains("sidebar--hidden")).toBe(false);
    expect(sidebar.classList.contains("sidebar--collapsed")).toBe(false);

    act(() => {});
  });
});

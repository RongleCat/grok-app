/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import "@/test/jsdomStubs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OverlayScroll } from "./OverlayScroll";
import { VirtualList } from "./VirtualList";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const items = (n: number) => Array.from({ length: n }, (_, i) => `row-${i}`);

describe("VirtualList inside OverlayScroll", () => {
  it("marks the OverlayScroll viewport for scroll-parent lookup", () => {
    const { container } = render(
      <OverlayScroll syncTreeReveal>
        <VirtualList
          items={items(41)}
          getKey={(s) => s}
          renderItem={(s) => <div>{s}</div>}
          rowHeight={30}
        />
      </OverlayScroll>,
    );
    expect(
      container.querySelector(".overlay-scroll__viewport"),
    ).toHaveAttribute("data-overlay-scroll-viewport");
  });

  it("renders scrolled rows even when the viewport is overflow:hidden at mount", () => {
    // syncTreeReveal pins overflowY to "hidden" whenever the content does not
    // overflow (jsdom: always) or a reveal animation runs. Resolving the scroll
    // parent by computed overflow in that window skips the real viewport, so
    // the scroll listener lands outside and the render window stays frozen.
    const { container } = render(
      <OverlayScroll syncTreeReveal>
        <VirtualList
          items={items(41)}
          getKey={(s) => s}
          renderItem={(s) => <div>{s}</div>}
          rowHeight={30}
        />
      </OverlayScroll>,
    );
    const viewport = container.querySelector(
      ".overlay-scroll__viewport",
    ) as HTMLElement;
    const root = container.querySelector(".virtual-list") as HTMLElement;
    expect(viewport.style.overflowY).toBe("hidden");

    Object.defineProperty(viewport, "clientHeight", {
      configurable: true,
      value: 300,
    });
    expect(screen.queryByText("row-30")).not.toBeInTheDocument();

    // Simulate scrolling 30 rows down: the list top sits 900px above the
    // viewport top (rects are what recompute reads, not scrollTop).
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      top: -900,
      bottom: -900 + 41 * 30,
      left: 0,
      right: 0,
      width: 200,
      height: 41 * 30,
      x: 0,
      y: -900,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent.scroll(viewport);

    expect(screen.getByText("row-30")).toBeInTheDocument();
  });
});

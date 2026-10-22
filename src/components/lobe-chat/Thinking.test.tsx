/**
 * @vitest-environment jsdom
 */
import "@/test/jsdomStubs";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Thinking } from "./Thinking";

afterEach(cleanup);

function revealCount(root: HTMLElement): number {
  return root.querySelectorAll("[data-reveal]").length;
}

function animatedRevealCount(root: HTMLElement): number {
  return root.querySelectorAll(".grok-thought__body [data-reveal='1']").length;
}

describe("Thinking stream reveal", () => {
  it("reveals live thought text by chunk and marks the header as entering", () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(
        <Thinking thinking content="Hello " chunkEnds={[6]} locale="en" />,
      );

      const header = container.querySelector(".grok-thought__header");
      expect(header?.classList.contains("chat-block-enter")).toBe(true);
      // The first segment painted at mount stays static; only chunks that
      // arrive afterwards fade in.
      expect(animatedRevealCount(container)).toBe(0);

      rerender(
        <Thinking
          thinking
          content="Hello world."
          chunkEnds={[6, 12]}
          locale="en"
        />,
      );
      act(() => {
        vi.advanceTimersByTime(200);
      });

      const animated = Array.from(
        container.querySelectorAll<HTMLElement>(
          ".grok-thought__body [data-reveal='1']",
        ),
      );
      expect(animated.map((node) => node.textContent)).toContain("world.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reveal a finished thought even when the user expands it", () => {
    const { container } = render(
      <Thinking content="Hello " chunkEnds={[6]} locale="en" />,
    );

    const header = container.querySelector<HTMLElement>(
      ".grok-thought__header",
    );
    expect(header?.classList.contains("chat-block-enter")).toBe(false);
    fireEvent.click(header!);

    expect(
      container.querySelector(".grok-thought__body")?.textContent,
    ).toContain("Hello");
    expect(revealCount(container)).toBe(0);
  });

  it("stops revealing while the live block is collapsed", () => {
    const { container } = render(
      <Thinking thinking content="Hello world." chunkEnds={[6, 12]} locale="en" />,
    );

    fireEvent.click(container.querySelector(".grok-thought__header")!);

    expect(container.querySelector(".grok-thought__body")).toBeNull();
    expect(revealCount(container)).toBe(0);
  });

  it("does not replay a live single-chunk thought after collapse and expand", () => {
    const { container } = render(
      <Thinking thinking content="Hello " chunkEnds={[6]} locale="en" />,
    );

    const header = container.querySelector<HTMLElement>(
      ".grok-thought__header",
    )!;
    fireEvent.click(header);
    expect(container.querySelector(".grok-thought__body")).toBeNull();
    fireEvent.click(header);

    expect(
      container.querySelector(".grok-thought__body")?.textContent,
    ).toContain("Hello");
    expect(animatedRevealCount(container)).toBe(0);
  });
});

describe("Thinking detail entrance", () => {
  it("marks the expanded body that mounts on expand", () => {
    const { container } = render(
      <Thinking thinking content="Hello " locale="en" />,
    );

    const body = container.querySelector(".grok-thought__body");
    expect(body?.classList.contains("chat-detail-enter")).toBe(true);
    expect(
      container.querySelector(".grok-thought__header")?.classList.contains(
        "chat-detail-enter",
      ),
    ).toBe(false);
  });

  it("keeps a collapsed thought free of the detail entrance", () => {
    const { container } = render(<Thinking content="Hello " locale="en" />);

    expect(container.querySelector(".grok-thought__body")).toBeNull();
    expect(container.querySelector(".chat-detail-enter")).toBeNull();
  });
});

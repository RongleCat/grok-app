import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  pinReviewFocusPath,
  reviewEntryCoversPath,
  reviewFocusPathParts,
  scrollChildToContainerStart,
  scrollTopToAlignChildStart,
} from "./reviewFocusPaths";

describe("reviewFocusPaths", () => {
  it("pins newest path first and dedupes", () => {
    expect(pinReviewFocusPath([], ".grok-app-998-mvp-b.txt")).toEqual([
      ".grok-app-998-mvp-b.txt",
    ]);
    expect(
      pinReviewFocusPath(
        [".grok-app-998-mvp-a.txt"],
        ".grok-app-998-mvp-b.txt",
      ),
    ).toEqual([".grok-app-998-mvp-b.txt", ".grok-app-998-mvp-a.txt"]);
    expect(
      pinReviewFocusPath(
        [".grok-app-998-mvp-b.txt", ".grok-app-998-mvp-a.txt"],
        ".grok-app-998-mvp-b.txt",
      ),
    ).toEqual([".grok-app-998-mvp-b.txt", ".grok-app-998-mvp-a.txt"]);
  });

  it("builds parts for dotted relative paths", () => {
    const p = reviewFocusPathParts(
      ".grok-app-998-mvp-b.txt",
      "/Users/me/proj",
    );
    expect(p.name).toBe(".grok-app-998-mvp-b.txt");
    expect(p.relPath).toBe(".grok-app-998-mvp-b.txt");
    expect(p.key).toBe("focus:.grok-app-998-mvp-b.txt");
  });

  it("matches entries by basename", () => {
    expect(
      reviewEntryCoversPath(
        { path: "/Users/me/proj/.grok-app-998-mvp-b.txt", relPath: ".grok-app-998-mvp-b.txt" },
        ".grok-app-998-mvp-b.txt",
        "/Users/me/proj",
      ),
    ).toBe(true);
  });

  it("aligns child to container top without negative scrollTop (#1041)", () => {
    // Child 80px below container top while stack is scrolled 20 → aim for 100.
    expect(scrollTopToAlignChildStart(20, 100, 180)).toBe(100);
    // Child already at container top → keep current scrollTop.
    expect(scrollTopToAlignChildStart(40, 100, 100)).toBe(40);
    // Child above the visible top (would go negative) → clamp to 0.
    expect(scrollTopToAlignChildStart(10, 100, 50)).toBe(0);
  });

  it("scrollChildToContainerStart only mutates the given scroller", () => {
    const container = {
      scrollTop: 20,
      getBoundingClientRect: () => ({ top: 100, bottom: 400, left: 0, right: 0 }),
    };
    const child = {
      getBoundingClientRect: () => ({ top: 180, bottom: 220, left: 0, right: 0 }),
    };
    scrollChildToContainerStart(
      container as unknown as HTMLElement,
      child as unknown as HTMLElement,
    );
    expect(container.scrollTop).toBe(100);
  });

  it("ReviewTab focuses files via nested stack scroll, not scrollIntoView (#1041)", () => {
    const src = readFileSync(
      resolve(__dirname, "../components/side-workbench/ReviewTab.tsx"),
      "utf8",
    );
    expect(src).toContain("scrollChildToContainerStart");
    expect(src).toContain("stackRef.current");
    expect(src).not.toMatch(/scrollIntoView\s*\(/);
  });
});

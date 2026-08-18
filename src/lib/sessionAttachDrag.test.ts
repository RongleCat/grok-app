import { describe, expect, it } from "vitest";
import {
  isSessionAttachDropTarget,
  sessionAttachDragPastThreshold,
  sessionAttachDropReadyFromPoint,
} from "./sessionAttachDrag";

describe("sessionAttachDragPastThreshold", () => {
  it("ignores tiny movement (click)", () => {
    expect(sessionAttachDragPastThreshold(2, 2)).toBe(false);
    expect(sessionAttachDragPastThreshold(0, 0)).toBe(false);
  });

  it("starts after 6px", () => {
    expect(sessionAttachDragPastThreshold(6, 0)).toBe(true);
    expect(sessionAttachDragPastThreshold(0, -6)).toBe(true);
    expect(sessionAttachDragPastThreshold(4, 5)).toBe(true);
  });
});

describe("isSessionAttachDropTarget", () => {
  it("accepts composer or main chat, not sidebar", () => {
    expect(
      isSessionAttachDropTarget({ overComposer: true, zone: "sidebar" }),
    ).toBe(true);
    expect(
      isSessionAttachDropTarget({ overComposer: false, zone: "main" }),
    ).toBe(true);
    expect(
      isSessionAttachDropTarget({ overComposer: false, zone: "sidebar" }),
    ).toBe(false);
  });
});

describe("sessionAttachDropReadyFromPoint", () => {
  it("uses the hit node, not the pointer-capture target", () => {
    const hit = { id: "composer-child" } as unknown as Element;
    const composer = { contains: (n: Node) => n === (hit as Node) };
    expect(
      sessionAttachDropReadyFromPoint(10, 10, {
        composerEl: composer,
        zone: "sidebar",
        hit,
      }),
    ).toBe(true);
    expect(
      sessionAttachDropReadyFromPoint(10, 10, {
        composerEl: composer,
        zone: "sidebar",
        hit: { id: "elsewhere" } as unknown as Element,
      }),
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  isSessionAttachDropTarget,
  sessionAttachDragPastThreshold,
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

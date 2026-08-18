import { describe, expect, it } from "vitest";
import { isSessionMoveIgnoredTarget } from "@/hooks/useSidebarSessionMoveDrag";
import {
  isSessionAttachDropTarget,
  isSessionAttachPointerStartTarget,
} from "@/lib/sessionAttachDrag";

function gripAndRow() {
  const handle = document.createElement("button");
  handle.className = "tree-icon-btn tree-l3__drag-handle";
  const icon = document.createElement("span");
  handle.appendChild(icon);
  const row = document.createElement("div");
  row.className = "tree-l3";
  const title = document.createElement("span");
  title.className = "tree-l3__title";
  title.textContent = "Chat";
  row.appendChild(handle);
  row.appendChild(title);
  return { handle, icon, row, title };
}

describe("sidebar attach vs move gestures", () => {
  it("grip/button starts attach and is ignored by session-move", () => {
    if (typeof document === "undefined") return;
    const { handle, icon } = gripAndRow();
    expect(isSessionAttachPointerStartTarget(handle)).toBe(true);
    expect(isSessionAttachPointerStartTarget(icon)).toBe(true);
    expect(isSessionMoveIgnoredTarget(handle)).toBe(true);
    expect(isSessionMoveIgnoredTarget(icon)).toBe(true);
  });

  it("row body starts move, not attach", () => {
    if (typeof document === "undefined") return;
    const { row, title } = gripAndRow();
    expect(isSessionAttachPointerStartTarget(row)).toBe(false);
    expect(isSessionAttachPointerStartTarget(title)).toBe(false);
    expect(isSessionMoveIgnoredTarget(row)).toBe(false);
    expect(isSessionMoveIgnoredTarget(title)).toBe(false);
  });

  it("attach drop is ready only on the composer", () => {
    expect(
      isSessionAttachDropTarget({ overComposer: true, zone: "main" }),
    ).toBe(true);
    expect(
      isSessionAttachDropTarget({ overComposer: false, zone: "main" }),
    ).toBe(false);
    expect(
      isSessionAttachDropTarget({ overComposer: false, zone: "sidebar" }),
    ).toBe(false);
  });
});

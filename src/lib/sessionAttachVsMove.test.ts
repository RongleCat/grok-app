import { describe, expect, it } from "vitest";
import { isSessionMoveIgnoredTarget } from "@/hooks/useSidebarSessionMoveDrag";

function rowWithAttachIcon() {
  const iconBtn = document.createElement("button");
  iconBtn.className = "tree-icon-btn tree-l3__attach-btn";
  iconBtn.setAttribute("data-testid", "sidebar-session-attach");
  const glyph = document.createElement("span");
  iconBtn.appendChild(glyph);
  const row = document.createElement("div");
  row.className = "tree-l3";
  const title = document.createElement("span");
  title.className = "tree-l3__title";
  title.textContent = "Chat";
  row.appendChild(iconBtn);
  row.appendChild(title);
  return { iconBtn, glyph, row, title };
}

describe("sidebar attach vs move gestures", () => {
  it("attach is a click on the icon, not a row-body drag", () => {
    if (typeof document === "undefined") return;
    const { iconBtn, glyph, row, title } = rowWithAttachIcon();
    // Session-move must not steal the attach icon click.
    expect(isSessionMoveIgnoredTarget(iconBtn)).toBe(true);
    expect(isSessionMoveIgnoredTarget(glyph)).toBe(true);
    // Row body still starts move-to-project.
    expect(isSessionMoveIgnoredTarget(row)).toBe(false);
    expect(isSessionMoveIgnoredTarget(title)).toBe(false);
    expect(document.querySelector(".tree-l3__drag-handle")).toBeNull();
  });
});

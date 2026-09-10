/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  applyLiveSplitWidth,
  paintSidebarRail,
  queryWorkbenchSplitPane,
} from "./paneDragLive";

describe("applyLiveSplitWidth", () => {
  it("writes the flex size tuple and rounds", () => {
    const el = document.createElement("div");
    expect(applyLiveSplitWidth(el, 240.4)).toBe(240);
    expect(el.style.width).toBe("240px");
    expect(el.style.minWidth).toBe("240px");
    expect(el.style.maxWidth).toBe("240px");
    expect(el.style.flexBasis).toBe("240px");
  });

  it("is a no-op on a missing node", () => {
    expect(applyLiveSplitWidth(null, 180)).toBe(180);
  });
});

describe("paintSidebarRail", () => {
  it("snaps in-flow used size to 0 when collapsing", () => {
    const el = document.createElement("aside");
    applyLiveSplitWidth(el, 268);
    paintSidebarRail(el, { collapsed: true, openWidth: 268, overlay: false });
    expect(el.style.width).toBe("0px");
    expect(el.style.minWidth).toBe("0px");
    expect(el.style.maxWidth).toBe("0px");
    expect(el.style.flexBasis).toBe("0px");
    expect(el.classList.contains("sidebar--hidden")).toBe(true);
    expect(el.classList.contains("sidebar--collapsed")).toBe(true);
  });

  it("keeps overlay width at the open size while collapsing", () => {
    const el = document.createElement("aside");
    applyLiveSplitWidth(el, 268);
    paintSidebarRail(el, { collapsed: true, openWidth: 268, overlay: true });
    expect(el.style.width).toBe("268px");
    expect(el.classList.contains("sidebar--hidden")).toBe(true);
  });
});

describe("queryWorkbenchSplitPane", () => {
  it("picks the workbench sidebar and aside, not a nested aside", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="workbench">
        <aside class="sidebar"></aside>
        <main></main>
        <aside class="aside"><aside class="nested"></aside></aside>
      </div>
    `;
    expect(queryWorkbenchSplitPane("sidebar", root)?.className).toBe("sidebar");
    expect(queryWorkbenchSplitPane("aside", root)?.className).toBe("aside");
  });
});

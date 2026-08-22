/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { applyLiveSplitWidth, queryWorkbenchSplitPane } from "./paneDragLive";

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

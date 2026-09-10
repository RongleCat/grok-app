import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ASIDE_WIDTH_MIN,
  MAIN_CHAT_MIN_WIDTH,
  SIDEBAR_WIDTH_MIN,
} from "@/lib/layout";
import { resolveWorkbenchPaneOverlay } from "./paneOverlay";

const workbenchLayout = readFileSync(
  resolve(__dirname, "../hooks/useWorkbenchLayout.ts"),
  "utf8",
);

describe("resolveWorkbenchPaneOverlay", () => {
  it("uses in-flow floors rather than preferred widths", () => {
    const src = readFileSync(resolve(__dirname, "./paneOverlay.ts"), "utf8");
    expect(src).toContain(
      "const side = opts.sidebarOpen ? SIDEBAR_WIDTH_MIN : 0;",
    );
    expect(src).toContain(
      "const aside = opts.asideOpen ? ASIDE_WIDTH_MIN : 0;",
    );
    expect(src).not.toContain("Math.max(0, opts.sidebarWidth)");
    expect(src).not.toContain("Math.max(0, opts.asideWidth)");
  });

  it("keeps both panes in flow when the window fits chat plus both", () => {
    expect(
      resolveWorkbenchPaneOverlay({
        viewportWidth: 1400,
        sidebarOpen: true,
        sidebarWidth: 268,
        asideOpen: true,
        asideWidth: 400,
      }),
    ).toEqual({ sidebarOverlay: false, asideOverlay: false });
  });

  it("overlays the right pane when both open would crush chat", () => {
    expect(
      resolveWorkbenchPaneOverlay({
        viewportWidth: 900,
        sidebarOpen: true,
        sidebarWidth: 268,
        asideOpen: true,
        asideWidth: 400,
      }),
    ).toEqual({ sidebarOverlay: false, asideOverlay: true });
  });

  it("overlays a single pane that cannot sit beside the chat floor", () => {
    expect(
      resolveWorkbenchPaneOverlay({
        viewportWidth: MAIN_CHAT_MIN_WIDTH + 100,
        sidebarOpen: true,
        sidebarWidth: 268,
        asideOpen: false,
        asideWidth: 400,
      }),
    ).toEqual({ sidebarOverlay: true, asideOverlay: false });
  });

  it("clamps a wide saved aside instead of overlaying when floors still fit", () => {
    expect(
      resolveWorkbenchPaneOverlay({
        viewportWidth: 1200,
        sidebarOpen: true,
        sidebarWidth: 268,
        asideOpen: true,
        asideWidth: 720,
      }),
    ).toEqual({ sidebarOverlay: false, asideOverlay: false });
    // Floors: 200 + 400 + 360 = 960 ≤ 1200. Preferred 268+720+360 = 1348
    // would have overlaid; squeeze+clamp is the in-flow path.
    expect(SIDEBAR_WIDTH_MIN + ASIDE_WIDTH_MIN + MAIN_CHAT_MIN_WIDTH).toBeLessThanOrEqual(
      1200,
    );
  });

  it("still overlays when even the in-flow floors would crush chat", () => {
    expect(
      resolveWorkbenchPaneOverlay({
        viewportWidth: SIDEBAR_WIDTH_MIN + ASIDE_WIDTH_MIN + MAIN_CHAT_MIN_WIDTH - 1,
        sidebarOpen: true,
        sidebarWidth: 268,
        asideOpen: true,
        asideWidth: 400,
      }),
    ).toEqual({ sidebarOverlay: false, asideOverlay: true });
  });

  it("does not overlay when both panes are closed", () => {
    expect(
      resolveWorkbenchPaneOverlay({
        viewportWidth: 500,
        sidebarOpen: false,
        sidebarWidth: 268,
        asideOpen: false,
        asideWidth: 400,
      }),
    ).toEqual({ sidebarOverlay: false, asideOverlay: false });
  });

  it("does not grow the window when opening the sidebar leaves the aside overlaid", () => {
    const start = workbenchLayout.indexOf("const openSidebarPane = useCallback");
    const end = workbenchLayout.indexOf("const closeSidebarPane", start);
    const openSidebarPane = workbenchLayout.slice(start, end);

    expect(openSidebarPane).toContain(
      "if (overlay.sidebarOverlay || overlay.asideOverlay) return;",
    );
    expect(openSidebarPane).toContain(
      "if (!windowFitWouldGrow(vw, projected)) return;",
    );
  });
});

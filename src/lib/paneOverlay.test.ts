import { describe, expect, it } from "vitest";
import { MAIN_CHAT_MIN_WIDTH } from "@/lib/layout";
import { resolveWorkbenchPaneOverlay } from "./paneOverlay";

describe("resolveWorkbenchPaneOverlay", () => {
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
});

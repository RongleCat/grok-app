/** @vitest-environment jsdom */
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/test/jsdomStubs";
import type { WallpaperSourceTab } from "./WallpaperSourceModal";
import { WallpaperSourceTabs } from "./WallpaperSourceTabs";

const scrollIntoView = vi.fn();
Object.defineProperty(Element.prototype, "scrollIntoView", {
  configurable: true,
  writable: true,
  value: scrollIntoView,
});

afterEach(() => {
  cleanup();
  scrollIntoView.mockClear();
});

function Harness() {
  const [value, setValue] = useState<WallpaperSourceTab>("x");
  return (
    <WallpaperSourceTabs
      t={(key) => key}
      value={value}
      disabled={false}
      panelId="wallpaper-source-panel"
      onChange={setValue}
    />
  );
}

describe("WallpaperSourceTabs", () => {
  it("groups all delivered discovery sources", () => {
    render(<Harness />);

    const tablist = screen.getByRole("tablist", {
      name: "settings.wallpaperSource.title",
    });
    const groups = Array.from(
      tablist.querySelectorAll(".wallpaper-source-tabs__group"),
    );
    expect(
      groups.map((group) => group.getAttribute("data-source-group")),
    ).toEqual(["discovery", "create", "personal"]);
    expect(
      groups.map((group) =>
        Array.from(group.querySelectorAll('[role="tab"]')).map((tab) =>
          tab.getAttribute("aria-label"),
        ),
      ),
    ).toEqual([
      [
        "settings.wallpaperFromX",
        "settings.wallpaperWeb",
        "settings.wallpaperOpenverse",
        "settings.wallpaperPexels",
      ],
      ["settings.wallpaperImagine"],
      ["settings.wallpaperGrokAlbum", "settings.wallpaperLibrary"],
    ]);
    expect(
      screen.getByRole("tab", { name: "settings.wallpaperWeb" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "settings.wallpaperGrokAlbum" }),
    ).toBeTruthy();
  });

  it("associates every tab with the shared panel", () => {
    render(<Harness />);

    expect(
      screen
        .getAllByRole("tab")
        .every(
          (tab) =>
            tab.getAttribute("aria-controls") === "wallpaper-source-panel",
        ),
    ).toBe(true);
    expect(
      screen
        .getByRole("tab", { name: "settings.wallpaperFromX" })
        .getAttribute("tabindex"),
    ).toBe("0");
  });

  it("supports arrow, Home and End keyboard navigation", () => {
    render(<Harness />);

    fireEvent.keyDown(
      screen.getByRole("tab", { name: "settings.wallpaperFromX" }),
      { key: "ArrowRight" },
    );
    expect(
      screen
        .getByRole("tab", { name: "settings.wallpaperWeb" })
        .getAttribute("aria-selected"),
    ).toBe("true");

    fireEvent.keyDown(
      screen.getByRole("tab", { name: "settings.wallpaperWeb" }),
      { key: "End" },
    );
    expect(
      screen
        .getByRole("tab", { name: "settings.wallpaperLibrary" })
        .getAttribute("aria-selected"),
    ).toBe("true");

    fireEvent.keyDown(
      screen.getByRole("tab", { name: "settings.wallpaperLibrary" }),
      { key: "Home" },
    );
    expect(
      screen
        .getByRole("tab", { name: "settings.wallpaperFromX" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("does not shift the source strip when the active tab changes", () => {
    render(<Harness />);

    fireEvent.click(
      screen.getByRole("tab", { name: "settings.wallpaperLibrary" }),
    );

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole("tab", { name: "settings.wallpaperLibrary" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });
});

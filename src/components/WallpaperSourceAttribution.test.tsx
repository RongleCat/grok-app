/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WallpaperGalleryItem } from "@/lib/wallpaperSource";
import { WallpaperSourceAttribution } from "./WallpaperSourceAttribution";

afterEach(cleanup);

function item(provenance: Partial<WallpaperGalleryItem>): WallpaperGalleryItem {
  return {
    id: "remote-image",
    thumbUrl: "https://images.example.test/thumb.jpg",
    fullUrl: "https://images.example.test/full.jpg",
    kind: "image",
    source: "openverse",
    ...provenance,
  };
}

describe("WallpaperSourceAttribution", () => {
  it("keeps licensed attribution compact and opens every exact link", () => {
    const onOpen = vi.fn();
    const { container } = render(
      <WallpaperSourceAttribution
        item={item({
          sourceName: "Openverse",
          sourceUrl: "https://openverse.org/image/source",
          authorName: "A. Photographer",
          authorUrl: "https://example.test/author",
          license: "CC BY 4.0",
          licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        })}
        t={(key) => key}
        disabled={false}
        onOpen={onOpen}
      />,
    );

    const source = screen.getByRole("button", { name: "Openverse" });
    expect(
      container.querySelector(".wallpaper-attribution--licensed"),
    ).not.toBeNull();
    expect(
      screen.getByLabelText("settings.wallpaperSource.attribution"),
    ).not.toBeNull();
    expect(source.querySelector("svg")).not.toBeNull();
    expect(source.textContent).toBe("");

    fireEvent.click(source);
    fireEvent.click(screen.getByRole("button", { name: "A. Photographer" }));
    fireEvent.click(screen.getByRole("button", { name: "CC BY 4.0" }));

    expect(onOpen.mock.calls).toEqual([
      ["https://openverse.org/image/source"],
      ["https://example.test/author"],
      ["https://creativecommons.org/licenses/by/4.0/"],
    ]);
  });

  it("keeps an ordinary Web source label visible", () => {
    const onOpen = vi.fn();
    render(
      <WallpaperSourceAttribution
        item={item({
          source: "web",
          sourceName: "photos.example.test",
          sourceUrl: "https://photos.example.test/story",
          authorName: "A. Reporter",
        })}
        t={(key) => key}
        disabled={false}
        onOpen={onOpen}
      />,
    );

    const source = screen.getByRole("button", {
      name: "photos.example.test",
    });
    expect(source.textContent).toBe("photos.example.test");
    fireEvent.click(source);
    expect(onOpen).toHaveBeenCalledWith("https://photos.example.test/story");
  });
});

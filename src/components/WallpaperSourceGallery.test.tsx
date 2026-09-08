/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WallpaperGalleryItem } from "@/lib/wallpaperSource";
import { WallpaperSourceGallery } from "./WallpaperSourceGallery";

vi.mock("@/lib/api/wallpaper", () => ({
  wallpaperLibraryFindById: vi.fn(),
}));
vi.mock("@/lib/nativeWebviewCover", () => ({
  acquireNativeWebviewCover: () => () => {},
}));

const t = ((key: string) => key) as never;
const item: WallpaperGalleryItem = {
  id: "saved-artwork",
  source: "imagine",
  kind: "image",
  thumbUrl: "https://example.test/thumb.jpg",
  fullUrl: "https://example.test/full.jpg",
  localPath: "C:/wallpapers/saved-artwork.jpg",
  textPreview: "Saved artwork",
  metadata: {
    id: "media-saved",
    source: "imagine",
    sourceUrl: null,
    license: null,
    licenseUrl: null,
    title: "Saved artwork",
    width: 1280,
    height: 720,
    prompt: "A quiet mountain lake",
    generation: null,
    parentId: null,
    favorite: false,
    purpose: "generated",
    bytes: 1024,
    modifiedMs: 1,
  },
};

function galleryProps(visibleItems: WallpaperGalleryItem[]) {
  return {
    t,
    tab: "imagine" as const,
    busy: false,
    locked: false,
    visibleItems,
    selectedId: null,
    previewingId: null,
    showEmptyBlock: false,
    emptyState: null,
    clearGalleryFilters: vi.fn(),
    openItemPreview: vi.fn(async () => {}),
    dropItem: vi.fn(),
    openExternalSource: vi.fn(),
    requestDeleteLibraryItem: vi.fn(),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WallpaperSourceGallery media details", () => {
  it("opens details with an item-specific label and forwards prompt reuse", () => {
    const onReusePrompt = vi.fn();
    render(
      <WallpaperSourceGallery
        {...galleryProps([item])}
        onReusePrompt={onReusePrompt}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.wallpaperSource.details.title: Saved artwork",
      }),
    );
    expect(
      screen.getByRole("dialog", {
        name: "settings.wallpaperSource.details.title",
      }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.wallpaperSource.details.reuse",
      }),
    );
    expect(onReusePrompt).toHaveBeenCalledWith(item);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes details when filtering removes its card and does not reopen it", async () => {
    const view = render(
      <WallpaperSourceGallery {...galleryProps([item])} />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.wallpaperSource.details.title: Saved artwork",
      }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();

    view.rerender(<WallpaperSourceGallery {...galleryProps([])} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    view.rerender(<WallpaperSourceGallery {...galleryProps([item])} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

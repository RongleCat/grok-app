// @vitest-environment jsdom
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createT } from "@/i18n";
import type {
  WallpaperGalleryItem,
  WallpaperLibraryEntry,
} from "@/lib/wallpaperSource";
import { GlassModal } from "./GlassModal";
import {
  ImageViewerContext,
  type ImageViewerApi,
} from "./ImageViewerContext";
import { WallpaperMediaDetails } from "./WallpaperMediaDetails";

const find = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/wallpaper", () => ({ wallpaperLibraryFindById: find }));
vi.mock("@/lib/nativeWebviewCover", () => ({
  acquireNativeWebviewCover: () => () => {},
}));

const t = createT("en");
const item: WallpaperGalleryItem = {
  id: "result",
  source: "imagine",
  kind: "image",
  thumbUrl: "",
  fullUrl: "file:///result.png",
  localPath: "/result.png",
  metadata: {
    id: "media-result",
    parentId: "media-parent",
    title: "Result title",
    prompt: "Blue sky",
    bytes: 2000,
    width: 1280,
    height: 720,
    durationMs: 6_750,
    generation: {
      operation: "image_edit",
      aspectRatio: "16:9",
      requestedModel: "requested-only",
    },
  } as never,
};
const parent: WallpaperLibraryEntry = {
  path: "/original.png",
  name: "original.png",
  source: "web",
  kind: "image",
  bytes: 1000,
  modifiedMs: 1,
  metadata: {
    id: "media-parent",
    title: "Original title",
    width: 600,
    height: 400,
  } as never,
};
const props = () => ({
  item,
  t,
  locked: false,
  onClose: vi.fn(),
  onOpenSource: vi.fn(),
  onReusePrompt: vi.fn(),
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("WallpaperMediaDetails", () => {
  it("shows measured dimensions, requested parameters, and unknown historical fields", () => {
    render(<WallpaperMediaDetails {...props()} />);
    expect(screen.getByText("1280 × 720")).toBeTruthy();
    expect(screen.getByText("Requested model")).toBeTruthy();
    expect(screen.getByText("requested-only")).toBeTruthy();
    expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
    expect(screen.getByText("/result.png")).toBeTruthy();
  });

  it("shows measured video duration separately from the requested duration", () => {
    render(
      <WallpaperMediaDetails
        {...props()}
        item={{
          ...item,
          kind: "video",
          metadata: {
            ...item.metadata,
            durationMs: 6_750,
            generation: {
              operation: "image_to_video",
              duration: 10,
            },
          } as never,
        }}
      />,
    );
    expect(screen.getByText("Media duration").nextElementSibling).toHaveProperty(
      "textContent",
      "6.8s",
    );
    expect(screen.getByText("Requested duration").nextElementSibling).toHaveProperty(
      "textContent",
      "10s",
    );
  });

  it("sanitizes attribution links and rejects credentials or unsafe schemes", () => {
    const p = props();
    render(
      <WallpaperMediaDetails
        {...p}
        item={{
          ...item,
          metadata: {
            ...item.metadata,
            sourceName: "Photo site",
            sourceUrl: "https://example.test/photo?token=private#tracking",
            authorName: "Author",
            authorUrl: "https://user:secret@example.test/author",
            license: "License",
            licenseUrl: "javascript:alert(1)",
          } as never,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Photo site" }));
    expect(p.onOpenSource).toHaveBeenCalledWith("https://example.test/photo");
    expect(screen.queryByRole("button", { name: "Author" })).toBeNull();
    expect(screen.queryByRole("button", { name: "License" })).toBeNull();
    expect(document.body.textContent).not.toContain("private");
  });

  it("navigates to the recorded parent and returns without mutating the gallery", async () => {
    find.mockResolvedValue(parent);
    const p = props();
    render(<WallpaperMediaDetails {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "View source image" }));
    await screen.findByText("Original title");
    expect(find).toHaveBeenCalledWith("media-parent");
    expect(screen.getByText("600 × 400")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to result" }));
    expect(screen.getByText("Result title")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Use prompt for a new image" }),
    );
    expect(p.onReusePrompt).toHaveBeenCalledWith(item);
  });

  it("retains details when the parent is missing or lookup fails, with manual retry", async () => {
    find
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("private host path"))
      .mockResolvedValueOnce(parent);
    render(<WallpaperMediaDetails {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "View source image" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "The source image is missing or has changed.",
    );
    expect(screen.getByText("Result title")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View source image" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Could not load the source image. Try again.",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "View source image" }));
    await screen.findByText("Original title");
    expect(find).toHaveBeenCalledTimes(3);
  });

  it("discards parent lookup after closing and reopening another item", async () => {
    let resolve!: (entry: WallpaperLibraryEntry) => void;
    find.mockReturnValue(
      new Promise<WallpaperLibraryEntry>((done) => {
        resolve = done;
      }),
    );
    const p = props();
    const view = render(<WallpaperMediaDetails {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "View source image" }));
    view.rerender(<WallpaperMediaDetails {...p} item={null} />);
    view.rerender(
      <WallpaperMediaDetails
        {...p}
        item={{ ...item, id: "another", textPreview: "Other" }}
      />,
    );
    await act(async () => resolve(parent));
    expect(screen.queryByText("Original title")).toBeNull();
    expect(screen.getByText("Result title")).toBeTruthy();
  });

  it("Escape closes only details and restores focus to its entry button", async () => {
    const closeOuter = vi.fn();
    function Nested() {
      const [open, setOpen] = useState(false);
      return (
        <GlassModal open title="Gallery" onClose={closeOuter}>
          <button onClick={() => setOpen(true)}>Details entry</button>
          <WallpaperMediaDetails
            {...props()}
            item={open ? item : null}
            onClose={() => setOpen(false)}
          />
        </GlassModal>
      );
    }
    render(<Nested />);
    const entry = screen.getByRole("button", { name: "Details entry" });
    entry.focus();
    fireEvent.click(entry);
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Close"),
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Media details" })).toBeNull();
    expect(closeOuter).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(entry);
  });

  it("Escape closes the parent preview before its details", async () => {
    find.mockResolvedValue(parent);
    let viewerOpen = false;
    const viewer: ImageViewerApi = {
      open: vi.fn(() => {
        viewerOpen = true;
      }),
      close: vi.fn(() => {
        viewerOpen = false;
      }),
      isOpen: () => viewerOpen,
      copyImage: async () => false,
    };
    const p = props();
    render(
      <ImageViewerContext.Provider value={viewer}>
        <WallpaperMediaDetails {...p} />
      </ImageViewerContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "View source image" }));
    await screen.findByText("Original title");
    fireEvent.click(
      screen.getByRole("button", { name: "Open full-size preview" }),
    );
    expect(viewer.open).toHaveBeenCalledWith([
      { src: "/original.png", kind: "image", title: "Original title" },
    ]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(viewer.close).toHaveBeenCalledTimes(1);
    expect(p.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it("cancels a parent preview still resolving when details close", async () => {
    find.mockResolvedValue(parent);
    const viewer: ImageViewerApi = {
      open: vi.fn(),
      close: vi.fn(),
      isOpen: () => false,
      copyImage: async () => false,
    };
    const p = props();
    const view = render(
      <ImageViewerContext.Provider value={viewer}>
        <WallpaperMediaDetails {...p} />
      </ImageViewerContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "View source image" }));
    await screen.findByText("Original title");
    fireEvent.click(
      screen.getByRole("button", { name: "Open full-size preview" }),
    );
    expect(viewer.open).toHaveBeenCalledOnce();
    view.unmount();
    expect(viewer.close).toHaveBeenCalledOnce();
  });
});

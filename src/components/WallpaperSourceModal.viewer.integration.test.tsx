/**
 * @vitest-environment jsdom
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/test/jsdomStubs";

vi.mock("@/lib/imageLightboxFit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/imageLightboxFit")>(
    "@/lib/imageLightboxFit",
  );
  return {
    ...actual,
    loadImageNaturalSize: vi.fn(async () => ({ width: 1920, height: 1080 })),
  };
});

const fetchAlbumMedia = vi.hoisted(() =>
  vi.fn(async () => ({
    path: "H:\\wallpapers\\integration-video.mp4",
    name: "integration-video.mp4",
    mime: "video/mp4",
    bytes: 1024,
  })),
);
const xSearchState = vi.hoisted(() => ({
  search: vi.fn(),
  loadMore: vi.fn(),
  cancel: vi.fn(async () => true),
}));
const providerState = vi.hoisted(() => ({
  busy: false,
  loadingMore: false,
  stage: null as string | null,
  canLoadMore: true,
}));
const webItems = vi.hoisted(() => [
  {
    id: "web-integration-image",
    thumbUrl: "https://images.example.test/wallpaper.jpg",
    fullUrl: "https://images.example.test/wallpaper.jpg",
    kind: "image" as const,
    source: "web" as const,
    width: 1920,
    height: 1080,
    sourceUrl: "https://photos.example.test/wallpaper",
    sourceName: "photos.example.test",
  },
]);
const albumState = vi.hoisted(() => {
  const albumUrl =
    "https://assets.grok.com/users/test/generated/fake/integration-video.mp4";
  return {
    items: [
      {
        id: "album-integration-video",
        thumbUrl: albumUrl,
        fullUrl: albumUrl,
        kind: "video" as const,
        source: "grok_album" as const,
        width: 1280,
        height: 720,
      },
    ],
    open: vi.fn(),
    sync: vi.fn(),
    refresh: vi.fn(),
    loadMore: vi.fn(),
  };
});

vi.mock("@/hooks/useWallpaperXSearch", () => ({
  useWallpaperXSearch: () => ({
    busy: false,
    loadingMore: false,
    requestId: null,
    stage: null,
    progressiveItems: [],
    search: xSearchState.search,
    loadMore: xSearchState.loadMore,
    cancel: xSearchState.cancel,
  }),
}));

vi.mock("@/hooks/useWallpaperGrokAlbum", () => ({
  useWallpaperGrokAlbum: () => ({
    historyRevision: 0,
    items: albumState.items,
    status: "ready",
    cachedCount: 1,
    visibleCount: 1,
    busy: false,
    syncing: false,
    loadingMore: false,
    hasSynced: true,
    errorCode: null,
    canLoadMore: false,
    open: albumState.open,
    sync: albumState.sync,
    refresh: albumState.refresh,
    loadMore: albumState.loadMore,
  }),
}));

vi.mock("@/hooks/useWallpaperProviderController", () => ({
  useWallpaperProviderController: (options: {
    setItems: (items: typeof webItems) => void;
    setHasSearched: (value: boolean) => void;
  }) => ({
    ...providerState,
    search: async () => {
      options.setItems(webItems);
      options.setHasSearched(true);
    },
    loadMore: vi.fn(),
    cancel: vi.fn(async () => false),
    clear: vi.fn(async () => false),
    capture: vi.fn(() => null),
    restore: vi.fn(),
  }),
}));

vi.mock("@/lib/api", () => ({
  isDesktopHost: () => true,
  isTauri: () => false,
  settingsGet: vi.fn(async () => ({ wallpaperXSearchMode: "cli" })),
  settingsSet: vi.fn(async () => ({})),
  wallpaperFetchMedia: vi.fn(),
  wallpaperLibraryRemember: vi.fn(async () => ({ source: "grok_album" })),
  wallpaperLibraryLookup: vi.fn(async () => []),
  wallpaperRemoteFetchMedia: vi.fn(async () => ({
    path: "H:\\wallpapers\\web-integration.jpg",
    name: "web-integration.jpg",
    mime: "image/jpeg",
    bytes: 1024,
  })),
  wallpaperRemoteThumbnail: vi.fn(async () => ({
    dataUrl: "data:image/jpeg;base64,YWJj",
    width: 32,
    height: 18,
  })),
  wallpaperRemoteCancelMediaRequests: vi.fn(async () => 0),
  wallpaperRemoteCancelAllMediaRequests: vi.fn(async () => 0),
  wallpaperGrokAlbumFetchMedia: fetchAlbumMedia,
  wallpaperGrokAlbumThumbnail: vi.fn(async () => ({
    dataUrl: "data:image/jpeg;base64,YWJj",
    width: 32,
    height: 18,
  })),
  wallpaperGrokAlbumCancelRequests: vi.fn(async () => 0),
  wallpaperGrokAlbumCancelAllRequests: vi.fn(async () => 0),
  wallpaperImagine: vi.fn(),
  wallpaperLibraryList: vi.fn(),
  wallpaperLibraryPage: vi.fn(async () => ({
    items: [],
    nextCursor: null,
    total: 0,
    kindCounts: { all: 0, image: 0, video: 0 },
  })),
  wallpaperLibraryDelete: vi.fn(),
  openExternalUrl: vi.fn(),
}));

vi.mock("@/components/Select", () => ({
  Select: ({ value }: { value: string }) => <span>{value}</span>,
}));

import { ImageViewerProvider } from "./ImageViewer";
import { WallpaperSourceModal } from "./WallpaperSourceModal";
import { setMediaEndpoint } from "@/lib/imageSrc";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  setMediaEndpoint(null);
  providerState.busy = false;
  providerState.loadingMore = false;
  providerState.stage = null;
  providerState.canLoadMore = true;
});

describe("WallpaperSourceModal image viewer integration", () => {
  it("retries a failed original in the real preview without dropping its card", async () => {
    setMediaEndpoint({
      baseUrl: "http://127.0.0.1:19200",
      token: "test-only",
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    fetchAlbumMedia.mockRejectedValueOnce(
      new Error("download_failed: private diagnostic"),
    );

    render(
      <ImageViewerProvider locale="en">
        <WallpaperSourceModal
          open
          initialTab="grok_album"
          t={(key) =>
            key === "settings.wallpaperSource.err.download_failed"
              ? "Download failed"
              : key
          }
          onClose={vi.fn()}
          onPickFile={vi.fn()}
        />
      </ImageViewerProvider>,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "settings.wallpaperSource.openPreview",
      }),
    );
    const retry = await screen.findByRole("button", { name: "Retry" });
    const portal = document.querySelector<HTMLElement>(".yarl__portal");
    expect(portal).not.toBeNull();
    expect(within(portal!).getByRole("status").textContent).toContain(
      "Download failed",
    );
    expect(document.body.textContent).not.toContain("private diagnostic");
    expect(document.querySelector(".wallpaper-masonry__preview")).not.toBeNull();

    fireEvent.click(retry);
    await waitFor(() => expect(portal?.querySelector("video")).not.toBeNull());
    expect(fetchAlbumMedia).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("opens the real preview while a provider page is loading", async () => {
    const props = {
      open: true,
      initialTab: "web" as const,
      t: ((key: string) => key) as never,
      onClose: vi.fn(),
      onPickFile: vi.fn(),
    };
    const view = render(
      <ImageViewerProvider locale="en">
        <WallpaperSourceModal {...props} />
      </ImageViewerProvider>,
    );

    fireEvent.change(
      screen.getByRole("searchbox", {
        name: "settings.wallpaperSource.search",
      }),
      { target: { value: "night skyline" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "settings.wallpaperSource.search" }),
    );
    const card = await screen.findByRole("button", {
      name: "settings.wallpaperSource.openPreview",
    });

    providerState.busy = true;
    providerState.loadingMore = true;
    view.rerender(
      <ImageViewerProvider locale="en">
        <WallpaperSourceModal {...props} />
      </ImageViewerProvider>,
    );

    expect((card as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(card);
    await waitFor(() =>
      expect(document.querySelector(".yarl__portal")).not.toBeNull(),
    );
  });
});

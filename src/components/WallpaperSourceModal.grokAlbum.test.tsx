/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/test/jsdomStubs";

const mocks = vi.hoisted(() => ({
  fetchMedia: vi.fn(async () => ({
    path: "C:/wallpapers/grok-album/selected.jpg",
    name: "selected.jpg",
    mime: "image/jpeg",
  })),
  cancelMedia: vi.fn(),
  viewerOpen: vi.fn(),
  loadMore: vi.fn(async () => undefined),
}));

const albumItems = [
  {
    id: "saved-one",
    thumbUrl: "https://assets.grok.com/generated/one-thumb.jpg",
    fullUrl: "https://assets.grok.com/generated/one.jpg",
    kind: "image",
    width: 1600,
    height: 900,
    source: "grok_album",
    textPreview: "First saved image",
    localPath: null,
  },
  {
    id: "saved-two",
    thumbUrl: "https://assets.grok.com/generated/two-thumb.jpg",
    fullUrl: "https://assets.grok.com/generated/two.jpg",
    kind: "image",
    width: 1600,
    height: 900,
    source: "grok_album",
    textPreview: "Second saved image",
    localPath: null,
  },
];

vi.mock("@/hooks/useWallpaperGrokAlbum", () => ({
  useWallpaperGrokAlbum: () => ({
    historyRevision: 0,
    status: "ready",
    items: albumItems,
    cachedCount: 40,
    visibleCount: 20,
    busy: true,
    syncing: false,
    loadingMore: true,
    hasSynced: true,
    errorCode: null,
    canLoadMore: true,
    open: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    sync: vi.fn(async () => null),
    loadMore: mocks.loadMore,
  }),
}));

vi.mock("@/hooks/useWallpaperXSearch", () => ({
  useWallpaperXSearch: () => ({
    progressiveItems: [],
    busy: false,
    loadingMore: false,
    stage: null,
    search: vi.fn(),
    loadMore: vi.fn(),
    cancel: vi.fn(async () => true),
  }),
}));

vi.mock("@/hooks/useWallpaperProviderController", () => ({
  useWallpaperProviderController: () => ({
    busy: false,
    loadingMore: false,
    stage: null,
    canLoadMore: false,
    search: vi.fn(),
    loadMore: vi.fn(),
    cancel: vi.fn(async () => true),
  }),
}));

vi.mock("@/lib/grokAlbumMedia", () => ({
  fetchGrokAlbumMedia: mocks.fetchMedia,
  cancelGrokAlbumMediaRequests: mocks.cancelMedia,
}));

vi.mock("@/lib/api", () => ({
  isDesktopHost: () => true,
  isTauri: () => false,
  openExternalUrl: vi.fn(async () => undefined),
  wallpaperRemoteCancelMediaRequests: vi.fn(async () => 0),
}));

vi.mock("@/components/GrokAlbumThumbnail", () => ({
  GrokAlbumThumbnail: ({ url }: { url: string }) => (
    <span data-testid="isolated-album-thumbnail" data-url={url} />
  ),
}));

vi.mock("@/components/ImageViewerContext", () => ({
  useImageViewerOptional: () => ({ open: mocks.viewerOpen }),
}));

vi.mock("@/components/GlassModal", () => ({
  GlassModal: ({
    open,
    onClose,
    children,
    footer,
  }: {
    open: boolean;
    onClose: () => void;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    open ? (
      <div>
        <button type="button" onClick={onClose}>modal-close</button>
        {children}
        {footer}
      </div>
    ) : null,
}));

import { WallpaperSourceModal } from "./WallpaperSourceModal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WallpaperSourceModal Grok Saved integration", () => {
  it("keeps cached cards selectable during warmup and previews only Host-local media", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <WallpaperSourceModal
        open
        initialTab="grok_album"
        t={((key: string) => key) as never}
        onClose={onClose}
        onPickFile={vi.fn()}
      />,
    );

    expect(screen.getAllByTestId("isolated-album-thumbnail")).toHaveLength(2);
    expect(
      container.querySelector('img[src^="https://assets.grok.com/"]'),
    ).toBeNull();

    const firstCard = screen.getAllByRole("button", {
      name: "settings.wallpaperSource.openPreview",
    })[0];
    expect(firstCard).toBeDefined();
    expect(firstCard?.hasAttribute("disabled")).toBe(false);
    fireEvent.click(firstCard!);

    await waitFor(() => expect(mocks.fetchMedia).toHaveBeenCalledOnce());
    expect(mocks.fetchMedia).toHaveBeenCalledWith(
      "https://assets.grok.com/generated/one.jpg",
    );
    await waitFor(() => expect(mocks.viewerOpen).toHaveBeenCalledOnce());
    expect(mocks.viewerOpen.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ src: "C:/wallpapers/grok-album/selected.jpg" }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "modal-close" }));
    expect(mocks.cancelMedia).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});

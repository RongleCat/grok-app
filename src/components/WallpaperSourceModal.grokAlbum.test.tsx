/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/jsdomStubs";

const mocks = vi.hoisted(() => ({
  fetchMedia: vi.fn(async () => ({
    path: "C:/wallpapers/grok-album/selected.jpg",
    name: "selected.jpg",
    mime: "image/jpeg",
  })),
  cancelMedia: vi.fn(),
  viewerOpen: vi.fn(),
  viewerClose: vi.fn(),
  loadMore: vi.fn(async () => undefined),
}));

const defaultAlbumItems = [
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
    thumbUrl: "https://assets.grok.com/generated/two-thumb.mp4",
    fullUrl: "https://assets.grok.com/generated/two.mp4",
    kind: "video",
    width: 900,
    height: 1600,
    source: "grok_album",
    textPreview: "Second saved image",
    localPath: null,
  },
];

let albumState = {
  historyRevision: 0,
  status: "ready",
  items: defaultAlbumItems,
  busy: true,
};

vi.mock("@/hooks/useWallpaperGrokAlbum", () => ({
  useWallpaperGrokAlbum: () => ({
    ...albumState,
    cachedCount: 40,
    visibleCount: 20,
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
  settingsGet: vi.fn(async () => ({ wallpaperXSearchMode: "cli" })),
  settingsSet: vi.fn(async () => ({})),
  wallpaperGrokAlbumCancelRequests: vi.fn(async () => 0),
  wallpaperRemoteCancelMediaRequests: vi.fn(async () => 0),
  wallpaperLibraryLookup: vi.fn(async () => []),
  wallpaperLibraryRemember: vi.fn(async () => undefined),
}));

vi.mock("@/components/GrokAlbumThumbnail", () => ({
  GrokAlbumThumbnail: ({ url }: { url: string }) => (
    <span data-testid="isolated-album-thumbnail" data-url={url} />
  ),
}));

vi.mock("@/components/ImageViewerContext", () => ({
  useImageViewerOptional: () => ({
    open: mocks.viewerOpen,
    close: mocks.viewerClose,
    isOpen: () => false,
  }),
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

const renderAlbum = () =>
  render(
    <WallpaperSourceModal
      open
      initialTab="grok_album"
      t={((key: string) => key) as never}
      onClose={vi.fn()}
      onPickFile={vi.fn()}
    />,
  );

beforeEach(() => {
  albumState = {
    historyRevision: 0,
    status: "ready",
    items: defaultAlbumItems,
    busy: true,
  };
});

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

    await waitFor(() => expect(mocks.viewerOpen).toHaveBeenCalledOnce());
    expect(mocks.fetchMedia).not.toHaveBeenCalled();
    const slide = mocks.viewerOpen.mock.calls[0]?.[0]?.[0] as {
      kind: string;
      loadOriginal?: () => Promise<{
        src: string;
        kind?: string;
        mime?: string;
      } | null>;
    };
    expect(slide.kind).toBe("image");
    expect(slide.loadOriginal).toBeTypeOf("function");

    let original:
      | { src: string; kind?: string; mime?: string }
      | null
      | undefined;
    await act(async () => {
      original = await slide.loadOriginal?.();
    });
    expect(mocks.fetchMedia).toHaveBeenCalledOnce();
    expect(mocks.fetchMedia).toHaveBeenCalledWith(
      "https://assets.grok.com/generated/one.jpg",
    );
    expect(original).toMatchObject({
      src: "C:/wallpapers/grok-album/selected.jpg",
      kind: "image",
      mime: "image/jpeg",
    });

    fireEvent.click(screen.getByRole("button", { name: "modal-close" }));
    expect(mocks.cancelMedia).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes the viewer and rejects a late original after the album revision changes", async () => {
    let finishFetch!: (result: {
      path: string;
      name: string;
      mime: string;
    }) => void;
    mocks.fetchMedia.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFetch = resolve;
        }),
    );
    const view = renderAlbum();
    const firstCard = screen.getAllByRole("button", {
      name: "settings.wallpaperSource.openPreview",
    })[0];
    fireEvent.click(firstCard!);
    await waitFor(() => expect(mocks.viewerOpen).toHaveBeenCalledOnce());
    const slide = mocks.viewerOpen.mock.calls[0]?.[0]?.[0] as {
      loadOriginal: () => Promise<{ src: string } | null>;
    };
    let pendingOriginal!: Promise<{ src: string } | null>;
    await act(async () => {
      pendingOriginal = slide.loadOriginal();
      await Promise.resolve();
    });
    expect(mocks.fetchMedia).toHaveBeenCalledOnce();

    albumState = {
      ...albumState,
      historyRevision: 1,
      items: [
        {
          ...defaultAlbumItems[0],
          id: "saved-new-page",
          fullUrl: "https://assets.grok.com/generated/new-page.jpg",
        },
      ],
    };
    view.rerender(
      <WallpaperSourceModal
        open
        initialTab="grok_album"
        t={((key: string) => key) as never}
        onClose={vi.fn()}
        onPickFile={vi.fn()}
      />,
    );
    await waitFor(() => expect(mocks.viewerClose).toHaveBeenCalled());
    expect(mocks.cancelMedia).toHaveBeenCalled();

    let original: { src: string } | null = { src: "unexpected" };
    await act(async () => {
      finishFetch({
        path: "C:/wallpapers/grok-album/stale.jpg",
        name: "stale.jpg",
        mime: "image/jpeg",
      });
      original = await pendingOriginal;
    });
    expect(original).toBeNull();
    expect(
      screen.getAllByRole("button", {
        name: "settings.wallpaperSource.openPreview",
      }),
    ).toHaveLength(1);
  });

  it("restores filters and scroll after loading, then clears them for a new album revision", async () => {
    albumState = { ...albumState, busy: false };
    const view = renderAlbum();
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", {
          name: "settings.wallpaperSource.openPreview",
        }),
      ).toHaveLength(2),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /settings\.wallpaperSource\.kind\.video/,
      }),
    );
    expect(
      screen.getAllByRole("button", {
        name: "settings.wallpaperSource.openPreview",
      }),
    ).toHaveLength(1);

    const scroller = document.querySelector<HTMLDivElement>(
      ".wallpaper-masonry-scroll",
    );
    expect(scroller).not.toBeNull();
    scroller!.scrollTop = 360;
    fireEvent.click(
      screen.getByRole("tab", { name: "settings.wallpaperFromX" }),
    );
    scroller!.scrollTop = 0;

    albumState = { ...albumState, status: "loading", busy: true };
    view.rerender(
      <WallpaperSourceModal
        open
        initialTab="grok_album"
        t={((key: string) => key) as never}
        onClose={vi.fn()}
        onPickFile={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("tab", { name: "settings.wallpaperGrokAlbum" }),
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", {
          name: "settings.wallpaperSource.openPreview",
        }),
      ).toHaveLength(1),
    );
    expect(scroller!.scrollTop).toBe(0);

    albumState = { ...albumState, status: "ready", busy: false };
    view.rerender(
      <WallpaperSourceModal
        open
        initialTab="grok_album"
        t={((key: string) => key) as never}
        onClose={vi.fn()}
        onPickFile={vi.fn()}
      />,
    );
    await waitFor(() => expect(scroller!.scrollTop).toBe(360));

    albumState = { ...albumState, historyRevision: 1 };
    view.rerender(
      <WallpaperSourceModal
        open
        initialTab="grok_album"
        t={((key: string) => key) as never}
        onClose={vi.fn()}
        onPickFile={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", {
          name: "settings.wallpaperSource.openPreview",
        }),
      ).toHaveLength(2),
    );
    expect(scroller!.scrollTop).toBe(0);
  });
});

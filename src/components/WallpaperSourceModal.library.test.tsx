/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/test/jsdomStubs";
import type { WallpaperLibraryPage } from "@/lib/api/wallpaper";

const mocks = vi.hoisted(() => ({
  page: vi.fn(),
  preview: vi.fn(),
  remember: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  wallpaperLibraryPage: mocks.page,
  wallpaperLibraryDelete: mocks.delete,
  wallpaperLibraryLookup: vi.fn(async () => []),
  wallpaperLibraryRemember: mocks.remember,
  wallpaperRemoteSearch: vi.fn(),
  wallpaperRemoteFetchMedia: vi.fn(),
  wallpaperRemoteSearchMore: vi.fn(),
  wallpaperRemoteSearchCancel: vi.fn(async () => true),
  listenWallpaperRemoteSearchProgress: vi.fn(async () => () => {}),
  listenWallpaperRemoteSearchBatch: vi.fn(async () => () => {}),
  wallpaperRemoteCancelMediaRequests: vi.fn(async () => 0),
  wallpaperRemoteCancelAllMediaRequests: vi.fn(async () => 0),
  wallpaperGrokAlbumCancelRequests: vi.fn(async () => 0),
  wallpaperGrokAlbumCancelAllRequests: vi.fn(async () => 0),
  isDesktopHost: () => true,
  isTauri: () => false,
  settingsGet: vi.fn(async () => ({ wallpaperXSearchMode: "cli" })),
  settingsSet: vi.fn(async () => ({})),
  wallpaperXSearch: vi.fn(),
  wallpaperXSearchMore: vi.fn(),
  wallpaperXSearchCancel: vi.fn(async () => true),
  listenWallpaperXSearchProgress: vi.fn(async () => () => {}),
  listenWallpaperXSearchBatch: vi.fn(async () => () => {}),
  wallpaperFetchMedia: vi.fn(),
  wallpaperImagine: vi.fn(),
  wallpaperImaginePendingRecoveries: vi.fn(async () => []),
  wallpaperImagineRecoverCatalog: vi.fn(),
  openExternalUrl: vi.fn(),
}));

vi.mock("@/components/ImageViewerContext", () => ({
  useImageViewerOptional: () => ({
    open: mocks.preview,
    close: vi.fn(),
    isOpen: () => false,
  }),
}));

vi.mock("@/components/Select", () => ({
  Select: ({
    value,
    options,
    onChange,
    "aria-label": ariaLabel,
  }: {
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange: (value: string) => void;
    "aria-label"?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock("@/components/GlassModal", () => ({
  GlassModal: ({
    open,
    children,
    footer,
  }: {
    open: boolean;
    children: ReactNode;
    footer?: ReactNode;
  }) => (open ? <div>{children}{footer}</div> : null),
}));

import { WallpaperSourceModal } from "./WallpaperSourceModal";
import * as api from "@/lib/api";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function page(name: string, nextCursor: string | null = null): WallpaperLibraryPage {
  return {
    items: [
      {
        path: `C:/wallpapers/${name}.png`,
        name,
        source: "library",
        kind: "image",
        bytes: 100,
        modifiedMs: 1,
      },
    ],
    nextCursor,
    total: 2,
    kindCounts: { all: 2, image: 2, video: 0 },
  };
}

const t = (key: string) => key;
const cards = () =>
  screen.getAllByRole("button", {
    name: "settings.wallpaperSource.openPreview",
  });

function renderLibrary() {
  return render(
    <WallpaperSourceModal
      open
      initialTab="library"
      t={t as never}
      onClose={vi.fn()}
      onPickFile={vi.fn()}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WallpaperSourceModal library paging", () => {
  it("prefills Imagine from saved media details without starting generation", async () => {
    const savedPage = page("saved-artwork");
    savedPage.items[0].metadata = {
      id: "saved-artwork-id",
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
      bytes: 100,
      modifiedMs: 1,
    };
    mocks.page.mockResolvedValue(savedPage);
    renderLibrary();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "settings.wallpaperSource.details.title: Saved artwork",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.wallpaperSource.details.reuse",
      }),
    );

    const prompt = await screen.findByPlaceholderText(
      "settings.wallpaperSource.imaginePlaceholder",
    );
    expect(prompt).toHaveProperty("value", "A quiet mountain lake");
    expect(
      screen
        .getByRole("tab", { name: "settings.wallpaperImagine" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(mocks.page).toHaveBeenCalledTimes(1);
  });

  it("removes an unfavorited item from the favorites view without deleting its file", async () => {
    const savedPage = page("favorite");
    savedPage.total = 1;
    savedPage.kindCounts = { all: 1, image: 1, video: 0 };
    savedPage.items[0].metadata = {
      id: "favorite-id", source: "library", sourceUrl: null, license: null,
      licenseUrl: null, title: null, width: null, height: null, prompt: null,
      generation: null, parentId: null, favorite: true, purpose: "cache",
      bytes: 100, modifiedMs: 1,
    };
    mocks.page.mockResolvedValue(savedPage);
    mocks.remember.mockResolvedValue({ ...savedPage.items[0].metadata, favorite: false });
    renderLibrary();
    await screen.findByRole("button", { name: "settings.wallpaperSource.library.unfavorite" });
    fireEvent.change(screen.getByLabelText("settings.wallpaperSource.library.collection"), {
      target: { value: "favorites" },
    });
    const unfavorite = await screen.findByRole("button", {
      name: "settings.wallpaperSource.library.unfavorite",
    });
    fireEvent.click(unfavorite);
    await waitFor(() => expect(screen.queryByRole("listitem")).toBeNull());
    expect(screen.getByRole("button", {
      name: /^settings\.wallpaperSource\.kind\.all\s*0$/,
    })).toBeTruthy();
    expect(screen.getByText("settings.wallpaperSource.empty.filterEmpty")).toBeTruthy();
    expect(screen.queryByText("settings.wallpaperSource.empty.libraryIdleHint")).toBeNull();
    expect(mocks.remember).toHaveBeenCalledWith(
      "C:/wallpapers/favorite.png", expect.objectContaining({ localPath: "C:/wallpapers/favorite.png" }), false,
    );
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("keeps loaded cards selectable while the next page is pending", async () => {
    const pending = deferred<WallpaperLibraryPage>();
    mocks.page
      .mockResolvedValueOnce(page("first", "cursor-1"))
      .mockReturnValueOnce(pending.promise);
    renderLibrary();

    const loadMore = await screen.findByRole("button", {
      name: "settings.wallpaperSource.loadMore",
    });
    fireEvent.click(loadMore);
    await waitFor(() => expect(mocks.page).toHaveBeenCalledTimes(2));

    expect((cards()[0] as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(cards()[0]);
    await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(1));

    pending.resolve(page("second"));
    await waitFor(() => expect(cards()).toHaveLength(2));
  });

  it("sends text, kind, and collection filters to the Host", async () => {
    mocks.page.mockResolvedValue(page("result"));
    renderLibrary();
    await waitFor(() =>
      expect(mocks.page).toHaveBeenCalledWith({ query: "", kind: "all" }),
    );

    fireEvent.change(
      screen.getByPlaceholderText("settings.wallpaperSource.filterPlaceholder"),
      { target: { value: "mountain" } },
    );
    await waitFor(() =>
      expect(mocks.page).toHaveBeenCalledWith({
        query: "mountain",
        kind: "all",
      }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /settings\.wallpaperSource\.kind\.image/,
      }),
    );
    await waitFor(() =>
      expect(mocks.page).toHaveBeenCalledWith({
        query: "mountain",
        kind: "image",
      }),
    );

    fireEvent.change(
      screen.getByLabelText("settings.wallpaperSource.library.collection"),
      { target: { value: "favorites" } },
    );
    await waitFor(() =>
      expect(mocks.page).toHaveBeenCalledWith({
        query: "mountain",
        kind: "image",
        purpose: "favorites",
      }),
    );
  });

  it("restores the cached query, kind, collection, and scroll without another Host page", async () => {
    mocks.page.mockResolvedValue(page("cached"));
    const view = renderLibrary();
    await waitFor(() => expect(mocks.page).toHaveBeenCalledTimes(1));

    fireEvent.change(
      screen.getByPlaceholderText("settings.wallpaperSource.filterPlaceholder"),
      { target: { value: "mountain" } },
    );
    await waitFor(() => expect(mocks.page).toHaveBeenCalledTimes(2));
    fireEvent.click(
      screen.getByRole("button", {
        name: /settings\.wallpaperSource\.kind\.image/,
      }),
    );
    await waitFor(() => expect(mocks.page).toHaveBeenCalledTimes(3));
    fireEvent.change(
      screen.getByLabelText("settings.wallpaperSource.library.collection"),
      { target: { value: "favorites" } },
    );
    await waitFor(() => expect(mocks.page).toHaveBeenCalledTimes(4));

    const scroller = document.querySelector<HTMLDivElement>(
      ".wallpaper-masonry-scroll",
    );
    expect(scroller).not.toBeNull();
    scroller!.scrollTop = 275;
    fireEvent.click(
      screen.getByRole("tab", { name: "settings.wallpaperFromX" }),
    );
    scroller!.scrollTop = 0;
    fireEvent.click(
      screen.getByRole("tab", { name: "settings.wallpaperLibrary" }),
    );

    await waitFor(() =>
      expect(
        screen.getByPlaceholderText<HTMLInputElement>(
          "settings.wallpaperSource.filterPlaceholder",
        ).value,
      ).toBe("mountain"),
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: /settings\.wallpaperSource\.kind\.image/,
      }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByLabelText<HTMLSelectElement>(
        "settings.wallpaperSource.library.collection",
      ).value,
    ).toBe("favorites");
    await waitFor(() => expect(scroller!.scrollTop).toBe(275));
    expect(mocks.page).toHaveBeenCalledTimes(4);

    view.unmount();
  });

  it("downloads a remote card again after its cached library file is deleted", async () => {
    const localPath = "C:/wallpapers/remote-photo.png";
    const metadata = {
      id: "remote-media",
      source: "web",
      sourceUrl: null,
      license: null,
      licenseUrl: null,
      title: null,
      width: 1920,
      height: 1080,
      prompt: null,
      generation: null,
      parentId: null,
      favorite: false,
      purpose: "cache" as const,
      bytes: 100,
      modifiedMs: 1,
    };
    vi.mocked(api.wallpaperRemoteSearch).mockResolvedValue({
      source: "web",
      items: [
        {
          id: "remote-photo",
          source: "web",
          kind: "image",
          fullUrl: "https://images.example.test/photo.jpg",
          thumbUrl: "https://images.example.test/photo.jpg",
          localPath,
          metadata,
        },
      ],
      hasMore: false,
      cacheHit: false,
      durationMs: 100,
    });
    const savedPage = page("remote-photo");
    savedPage.items[0].metadata = metadata;
    mocks.page.mockResolvedValue(savedPage);
    mocks.delete.mockResolvedValue(undefined);
    vi.mocked(api.wallpaperRemoteFetchMedia).mockResolvedValue({
      path: localPath,
      name: "remote-photo.png",
      mime: "image/png",
      bytes: 100,
    });
    mocks.remember.mockResolvedValue(metadata);
    render(
      <WallpaperSourceModal
        open
        initialTab="web"
        t={t as never}
        onClose={vi.fn()}
        onPickFile={vi.fn()}
      />,
    );

    fireEvent.change(
      screen.getByRole("searchbox", {
        name: "settings.wallpaperSource.search",
      }),
      { target: { value: "coast" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "settings.wallpaperSource.search" }),
    );
    await screen.findByRole("button", {
      name: "settings.wallpaperSource.openPreview",
    });
    fireEvent.click(
      screen.getByRole("tab", { name: "settings.wallpaperLibrary" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "settings.wallpaperSource.delete",
      }),
    );
    fireEvent.click(screen.getByTestId("wallpaper-library-delete-confirm"));
    await waitFor(() => expect(mocks.delete).toHaveBeenCalledWith(localPath));
    await waitFor(() => expect(screen.queryByRole("listitem")).toBeNull());

    fireEvent.click(
      screen.getByRole("tab", { name: "settings.wallpaperWeb" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "settings.wallpaperSource.openPreview",
      }),
    );
    const slides = mocks.preview.mock.calls[0]?.[0] as Array<{
      loadOriginal?: (signal: AbortSignal) => Promise<unknown>;
    }>;
    await act(async () => {
      await slides[0]?.loadOriginal?.(new AbortController().signal);
    });

    expect(api.wallpaperRemoteFetchMedia).toHaveBeenCalledTimes(1);
  });

  it("clears a prepared Imagine source when its library file is deleted", async () => {
    const savedPage = page("video-source");
    savedPage.total = 1;
    savedPage.kindCounts = { all: 1, image: 1, video: 0 };
    mocks.page.mockResolvedValue(savedPage);
    mocks.delete.mockResolvedValue(undefined);
    renderLibrary();

    fireEvent.click(
      await screen.findByRole("button", {
        name: /settings\.wallpaperSource\.generateVideoFromImage/,
      }),
    );
    expect(
      screen.getByRole("button", {
        name: "settings.wallpaperSource.removeSourceImage",
      }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("tab", { name: "settings.wallpaperLibrary" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "settings.wallpaperSource.delete",
      }),
    );
    fireEvent.click(screen.getByTestId("wallpaper-library-delete-confirm"));
    await waitFor(() =>
      expect(mocks.delete).toHaveBeenCalledWith(
        "C:/wallpapers/video-source.png",
      ),
    );

    fireEvent.click(
      screen.getByRole("tab", { name: "settings.wallpaperImagine" }),
    );
    expect(
      screen.getByText("settings.wallpaperSource.videoSourceMissing"),
    ).toBeTruthy();
  });
});

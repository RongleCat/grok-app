/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "@/test/jsdomStubs";
import type {
  WallpaperRemoteSearchResult,
  WallpaperRemoteSource,
} from "@/lib/wallpaperRemoteSearch";

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  more: vi.fn(),
  cancel: vi.fn(async () => true),
  preview: vi.fn(),
  thumbnail: vi.fn(),
  remoteFetch: vi.fn(async () => ({
    path: "C:/cache/sky.jpg",
    mime: "image/jpeg",
  })),
  libraryLookup: vi.fn(),
  libraryRemember: vi.fn(),
  openExternal: vi.fn(async (_url: string) => undefined),
}));
vi.mock("@/lib/api", () => ({
  wallpaperRemoteSearch: mocks.search, wallpaperRemoteSearchMore: mocks.more,
  wallpaperRemoteFetchMedia: mocks.remoteFetch,
  wallpaperRemoteThumbnail: mocks.thumbnail,
  wallpaperRemoteSearchCancel: vi.fn(async () => true),
  listenWallpaperRemoteSearchProgress: vi.fn(async () => () => {}),
  listenWallpaperRemoteSearchBatch: vi.fn(async () => () => {}),
  wallpaperRemoteCancelMediaRequests: vi.fn(async () => 0),
  wallpaperGrokAlbumCancelRequests: vi.fn(async () => 0),
  wallpaperGrokAlbumCancelAllRequests: vi.fn(async () => 0),
  isDesktopHost: () => true,
  isTauri: () => false,
  settingsGet: vi.fn(async () => ({ wallpaperXSearchMode: "responses_preview" })),
  settingsSet: vi.fn(async () => ({})),
  wallpaperXSearch: mocks.search, wallpaperXSearchMore: mocks.more, wallpaperXSearchCancel: mocks.cancel,
  listenWallpaperXSearchProgress: vi.fn(async () => () => {}),
  listenWallpaperXSearchBatch: vi.fn(async () => () => {}),
  wallpaperFetchMedia: vi.fn(async () => ({ path: "C:/cache/sky.jpg", mime: "image/jpeg", name: "sky.jpg" })),
  wallpaperImagine: vi.fn(), wallpaperLibraryList: vi.fn(), wallpaperLibraryDelete: vi.fn(),
  wallpaperImaginePendingRecoveries: vi.fn(async () => []),
  wallpaperImagineRecoverCatalog: vi.fn(),
  wallpaperLibraryLookup: mocks.libraryLookup,
  wallpaperLibraryRemember: mocks.libraryRemember,
  openExternalUrl: mocks.openExternal,
}));
vi.mock("@/components/ImageViewerContext", () => ({ useImageViewerOptional: () => ({ open: mocks.preview }) }));
vi.mock("@/components/Select", () => ({ Select: ({ value }: { value: string }) => <span>{value}</span> }));
vi.mock("@/components/GlassModal", () => ({
  GlassModal: ({
    open,
    children,
    footer,
    onClose,
  }: {
    open: boolean;
    children: React.ReactNode;
    footer?: React.ReactNode;
    onClose: () => void;
  }) =>
    open ? (
      <div>
        <button onClick={onClose}>close-modal</button>
        {children}
        {footer}
      </div>
    ) : null,
}));
import { WallpaperSourceModal } from "./WallpaperSourceModal";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const item = (id: string, source: WallpaperRemoteSource = "openverse") =>
  ({
    id,
    kind: "image",
    source,
    fullUrl: `https://images.example.com/${id}.jpg`,
    thumbUrl: `https://images.example.com/${id}.jpg`,
    sourceName:
      source === "web"
        ? "photos.example.test"
        : source === "pexels"
          ? "Pexels"
          : "Openverse",
    sourceUrl: `https://${source}.example.test/${id}`,
    authorName: "Ada",
    authorUrl:
      source === "openverse"
        ? `https://openverse.example.test/author/${id}`
        : undefined,
    license: source === "openverse" ? "CC0" : undefined,
    licenseUrl:
      source === "openverse"
        ? "https://creativecommons.org/publicdomain/zero/1.0/"
        : undefined,
  });
const result = (
  ids: string[],
  hasMore = true,
  source: WallpaperRemoteSource = "openverse",
): WallpaperRemoteSearchResult => ({
  source,
  items: ids.map((id) => item(id, source)),
  hasMore,
  cacheHit: false,
  durationMs: 1,
});
const cards = () => screen.queryAllByRole("button", { name: "settings.wallpaperSource.openPreview" });
async function initial(ids = ["first"]) {
  mocks.search.mockResolvedValue(result(ids));
  const view = render(<WallpaperSourceModal open initialTab="openverse" t={key => key} onClose={vi.fn()} onPickFile={vi.fn()} />);
  fireEvent.change(screen.getByRole("searchbox", { name: "settings.wallpaperSource.search" }), { target: { value: "sky" } });
  fireEvent.click(screen.getByRole("button", { name: "settings.wallpaperSource.search" }));
  await waitFor(() => expect(cards()).toHaveLength(1));
  return view;
}
beforeEach(() => {
  mocks.libraryLookup.mockResolvedValue([]);
  mocks.libraryRemember.mockImplementation(
    async (_path: string, media: { source: string }, favorite?: boolean) => ({
      id: "saved-media",
      source: media.source,
      favorite: favorite ?? false,
    }),
  );
  mocks.thumbnail.mockResolvedValue({
    dataUrl: "data:image/jpeg;base64,AA==",
    width: 100,
    height: 100,
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("restores provider query, rows, prefetched page, and scroll without searching again", async () => {
  mocks.search.mockResolvedValue(result(["saved"]));
  mocks.more.mockResolvedValue(result(["second"], false));
  render(
    <WallpaperSourceModal
      open
      initialTab="openverse"
      t={(key) => key}
      onClose={vi.fn()}
      onPickFile={vi.fn()}
    />,
  );

  const search = screen.getByRole("searchbox", {
    name: "settings.wallpaperSource.search",
  });
  fireEvent.change(search, { target: { value: "misty coast" } });
  fireEvent.click(
    screen.getByRole("button", { name: "settings.wallpaperSource.search" }),
  );
  await waitFor(() => expect(cards()).toHaveLength(1));
  await waitFor(() => expect(mocks.more).toHaveBeenCalledTimes(1));

  const scroller = document.querySelector<HTMLDivElement>(
    ".wallpaper-masonry-scroll",
  );
  expect(scroller).not.toBeNull();
  scroller!.scrollTop = 420;
  fireEvent.click(
    screen.getByRole("tab", { name: "settings.wallpaperWeb" }),
  );
  expect(cards()).toHaveLength(0);
  scroller!.scrollTop = 0;

  fireEvent.click(
    screen.getByRole("tab", { name: "settings.wallpaperOpenverse" }),
  );
  await waitFor(() => expect(cards()).toHaveLength(1));
  expect(
    screen.getByRole<HTMLInputElement>("searchbox", {
      name: "settings.wallpaperSource.search",
    }).value,
  ).toBe("misty coast");
  await waitFor(() => expect(scroller!.scrollTop).toBe(420));
  expect(mocks.search).toHaveBeenCalledTimes(1);

  fireEvent.click(
    await screen.findByRole("button", {
      name: "settings.wallpaperSource.loadMore",
    }),
  );
  await waitFor(() => expect(cards()).toHaveLength(2));
  expect(mocks.more).toHaveBeenCalledTimes(1);
});
it("clears per-source history after the picker closes", async () => {
  const view = await initial(["saved"]);
  fireEvent.click(
    screen.getByRole("tab", { name: "settings.wallpaperWeb" }),
  );

  view.rerender(
    <WallpaperSourceModal
      open={false}
      initialTab="openverse"
      t={(key) => key}
      onClose={vi.fn()}
      onPickFile={vi.fn()}
    />,
  );
  view.rerender(
    <WallpaperSourceModal
      open
      initialTab="openverse"
      t={(key) => key}
      onClose={vi.fn()}
      onPickFile={vi.fn()}
    />,
  );

  await waitFor(() => expect(cards()).toHaveLength(0));
  expect(
    screen.getByRole<HTMLInputElement>("searchbox", {
      name: "settings.wallpaperSource.search",
    }).value,
  ).toBe("");
  expect(mocks.search).toHaveBeenCalledTimes(1);
});
it("keeps provider pictures selectable during more and preserves the downloaded local path", async () => {
  let finish!: (value: WallpaperRemoteSearchResult) => void;
  mocks.more.mockReturnValue(new Promise<WallpaperRemoteSearchResult>(resolve => { finish = resolve; }));
  await initial();
  fireEvent.click(screen.getByRole("button", { name: "settings.wallpaperSource.loadMore" }));
  await waitFor(() => expect(mocks.more).toHaveBeenCalledTimes(1));
  expect((cards()[0] as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(cards()[0]);
  await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(1));
  finish(result(["first", "second"], false));
  await waitFor(() => expect(cards()).toHaveLength(2));
  expect(screen.queryByRole("button", { name: "settings.wallpaperSource.loadMore" })).toBeNull();
});
it("searches and previews Web results through the remote media pipeline", async () => {
  mocks.search.mockResolvedValue(result(["web-first"], false, "web"));
  render(
    <WallpaperSourceModal
      open
      initialTab="web"
      t={(key) => key}
      onClose={vi.fn()}
      onPickFile={vi.fn()}
    />,
  );

  fireEvent.change(
    screen.getByRole("searchbox", { name: "settings.wallpaperSource.search" }),
    { target: { value: "misty forest" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "settings.wallpaperSource.search" }),
  );

  await waitFor(() =>
    expect(mocks.search).toHaveBeenCalledWith(
      "web",
      "misty forest",
      expect.any(String),
    ),
  );
  await waitFor(() => expect(cards()).toHaveLength(1));
  fireEvent.click(cards()[0]);
  await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(1));
  expect(mocks.remoteFetch).not.toHaveBeenCalled();
  const slide = mocks.preview.mock.calls[0]?.[0]?.[0] as {
    loadOriginal?: () => Promise<{
      src: string;
      kind?: string;
      mime?: string;
    } | null>;
  };
  expect(slide.loadOriginal).toBeTypeOf("function");

  let original:
    | { src: string; kind?: string; mime?: string }
    | null
    | undefined;
  await act(async () => {
    original = await slide.loadOriginal?.();
  });
  expect(mocks.remoteFetch).toHaveBeenCalledWith(
      "web",
      "https://images.example.com/web-first.jpg",
      expect.any(String),
  );
  expect(original).toMatchObject({
    src: "C:/cache/sky.jpg",
    kind: "image",
    mime: "image/jpeg",
  });
});
it("favorites a provider result without downloading it again to unfavorite", async () => {
  await initial(["favorite"]);

  fireEvent.click(
    screen.getByRole("button", {
      name: "settings.wallpaperSource.library.favorite",
    }),
  );
  await waitFor(() => expect(mocks.libraryRemember).toHaveBeenCalledTimes(2));
  expect(mocks.libraryRemember).toHaveBeenLastCalledWith(
    "C:/cache/sky.jpg",
    expect.objectContaining({ id: "favorite" }),
    true,
  );
  expect(mocks.remoteFetch).toHaveBeenCalledTimes(1);
  expect(
    screen
      .getByRole("button", {
        name: "settings.wallpaperSource.library.unfavorite",
      })
      .getAttribute("aria-pressed"),
  ).toBe("true");

  fireEvent.click(
    screen.getByRole("button", {
      name: "settings.wallpaperSource.library.unfavorite",
    }),
  );
  await waitFor(() => expect(mocks.libraryRemember).toHaveBeenCalledTimes(3));
  expect(mocks.libraryRemember).toHaveBeenLastCalledWith(
    "C:/cache/sky.jpg",
    expect.objectContaining({ id: "favorite" }),
    false,
  );
  expect(mocks.remoteFetch).toHaveBeenCalledTimes(1);
  expect(
    screen
      .getByRole("button", {
        name: "settings.wallpaperSource.library.favorite",
      })
      .getAttribute("aria-pressed"),
  ).toBe("false");
});
it("keeps the card after a catalog failure and clears the error on favorite retry", async () => {
  mocks.libraryRemember.mockRejectedValueOnce(new Error("catalog_write_failed"));
  await initial(["retry-save"]);
  const favorite = () => screen.getByRole("button", {
    name: "settings.wallpaperSource.library.favorite",
  });

  fireEvent.click(favorite());
  await screen.findByText("settings.wallpaperSource.library.saveFailed");
  expect(cards()).toHaveLength(1);
  expect(favorite().hasAttribute("disabled")).toBe(false);

  fireEvent.click(favorite());
  await screen.findByRole("button", {
    name: "settings.wallpaperSource.library.unfavorite",
  });
  expect(screen.queryByText("settings.wallpaperSource.library.saveFailed")).toBeNull();
  expect(mocks.preview).not.toHaveBeenCalled();
});

it("keeps a lazy preview retryable when saving its provenance fails", async () => {
  mocks.libraryRemember.mockRejectedValueOnce(new Error("catalog_write_failed"));
  await initial(["preview-save"]);

  fireEvent.click(cards()[0]);
  await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(1));
  const slide = mocks.preview.mock.calls[0]?.[0]?.[0] as {
    loadOriginal?: () => Promise<{ src: string } | null>;
  };
  expect(slide.loadOriginal).toBeTypeOf("function");
  await act(async () => {
    await expect(slide.loadOriginal!()).rejects.toThrow("catalog_write_failed");
  });
  expect(cards()).toHaveLength(1);
  expect(
    screen.queryByText("settings.wallpaperSource.library.saveFailed"),
  ).toBeNull();

  let original: { src: string } | null | undefined;
  await act(async () => {
    original = await slide.loadOriginal?.();
  });
  expect(original).toMatchObject({ src: "C:/cache/sky.jpg" });
  expect(mocks.remoteFetch).toHaveBeenCalledTimes(2);
});

it("disables preview only for the card whose favorite is being saved", async () => {
  let finish!: (metadata: { favorite: boolean }) => void;
  mocks.libraryRemember.mockReturnValueOnce(new Promise((resolve) => {
    finish = resolve;
  }));
  await initial(["saving"]);
  fireEvent.click(screen.getByRole("button", {
    name: "settings.wallpaperSource.library.favorite",
  }));
  await waitFor(() => expect(mocks.libraryRemember).toHaveBeenCalledTimes(1));
  expect(cards()[0].hasAttribute("disabled")).toBe(true);
  fireEvent.click(cards()[0]);
  expect(mocks.preview).not.toHaveBeenCalled();
  finish({ favorite: false });
  await screen.findByRole("button", {
    name: "settings.wallpaperSource.library.unfavorite",
  });
  expect(cards()[0].hasAttribute("disabled")).toBe(false);
});

it("preserves provider results after paging failure and allows a fresh retry", async () => {
  mocks.more
    .mockResolvedValueOnce({ ...result([]), errorCode: "provider_network" })
    .mockResolvedValueOnce({ ...result([]), errorCode: "provider_network" })
    .mockResolvedValueOnce(result(["second"], false));
  await initial();
  await waitFor(() => expect(mocks.more).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "settings.wallpaperSource.loadMore" }));
  await screen.findByText("settings.wallpaperSource.err.search_failed");
  expect(cards()).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "settings.wallpaperSource.loadMore" }));
  await waitFor(() => expect(cards()).toHaveLength(2));
});
it("keeps a provider page running after switching tabs and restores it", async () => {
  let finish!: (value: WallpaperRemoteSearchResult) => void;
  mocks.more.mockReturnValue(new Promise<WallpaperRemoteSearchResult>(resolve => { finish = resolve; }));
  await initial();
  fireEvent.click(screen.getByRole("button", { name: "settings.wallpaperSource.loadMore" }));
  await waitFor(() => expect(mocks.more).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("tab", { name: "settings.wallpaperFromX" }));
  finish(result(["late"], false));
  await waitFor(() => expect(cards()).toHaveLength(0));
  fireEvent.click(
    screen.getByRole("tab", { name: "settings.wallpaperOpenverse" }),
  );
  await waitFor(() => expect(cards()).toHaveLength(2));
});

it("keeps a provider page running after switching to another provider", async () => {
  const pending = deferred<WallpaperRemoteSearchResult>();
  mocks.more.mockReturnValue(pending.promise);
  await initial();
  fireEvent.click(
    screen.getByRole("button", { name: "settings.wallpaperSource.loadMore" }),
  );
  await waitFor(() => expect(mocks.more).toHaveBeenCalledTimes(1));
  fireEvent.click(
    screen.getByRole("tab", { name: "settings.wallpaperWeb" }),
  );
  pending.resolve(result(["late"], false));
  await waitFor(() => expect(cards()).toHaveLength(0));
  fireEvent.click(
    screen.getByRole("tab", { name: "settings.wallpaperOpenverse" }),
  );
  await waitFor(() => expect(cards()).toHaveLength(2));
});

it("restores provider pagination after searching another provider", async () => {
  mocks.search.mockImplementation(
    async (source: WallpaperRemoteSource) =>
      result(
        source === "web" ? ["web-first"] : ["open-first"],
        source === "openverse",
        source,
      ),
  );
  mocks.more.mockImplementation(
    async (source: WallpaperRemoteSource) =>
      result(source === "openverse" ? ["open-prefetched"] : [], false, source),
  );

  render(
    <WallpaperSourceModal
      open
      initialTab="openverse"
      t={(key) => key}
      onClose={vi.fn()}
      onPickFile={vi.fn()}
    />,
  );
  const search = () =>
    screen.getByRole<HTMLInputElement>("searchbox", {
      name: "settings.wallpaperSource.search",
    });
  fireEvent.change(search(), { target: { value: "open" } });
  fireEvent.click(
    screen.getByRole("button", { name: "settings.wallpaperSource.search" }),
  );
  await waitFor(() => expect(cards()).toHaveLength(1));
  await waitFor(() => expect(mocks.more).toHaveBeenCalledTimes(1));

  fireEvent.click(
    screen.getByRole("tab", { name: "settings.wallpaperWeb" }),
  );
  fireEvent.change(search(), { target: { value: "web" } });
  fireEvent.click(
    screen.getByRole("button", { name: "settings.wallpaperSource.search" }),
  );
  await waitFor(() => expect(cards()).toHaveLength(1));

  fireEvent.click(
    screen.getByRole("tab", { name: "settings.wallpaperOpenverse" }),
  );
  await waitFor(() => expect(cards()).toHaveLength(1));
  fireEvent.click(
    screen.getByRole("button", { name: "settings.wallpaperSource.loadMore" }),
  );
  await waitFor(() => expect(cards()).toHaveLength(2));
  expect(mocks.more).toHaveBeenCalledTimes(1);
});

it("records a hidden provider continuation before another source search", async () => {
  const hidden = deferred<WallpaperRemoteSearchResult>();
  mocks.search.mockImplementation(
    (source: WallpaperRemoteSource) =>
      source === "openverse"
        ? hidden.promise
        : Promise.resolve(result(["web-first"], false, source)),
  );
  mocks.more.mockImplementation(
    (source: WallpaperRemoteSource) =>
      Promise.resolve(result(["open-more"], false, source)),
  );

  render(
    <WallpaperSourceModal
      open
      initialTab="openverse"
      t={(key) => key}
      onClose={vi.fn()}
      onPickFile={vi.fn()}
    />,
  );
  const search = () =>
    screen.getByRole<HTMLInputElement>("searchbox", {
      name: "settings.wallpaperSource.search",
    });
  fireEvent.change(search(), { target: { value: "open" } });
  fireEvent.click(
    screen.getByRole("button", { name: "settings.wallpaperSource.search" }),
  );
  await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(1));
  fireEvent.click(
    screen.getByRole("tab", { name: "settings.wallpaperWeb" }),
  );
  await act(async () => {
    hidden.resolve(result(["open-first"], true, "openverse"));
    await hidden.promise;
  });
  expect(mocks.more).not.toHaveBeenCalled();

  fireEvent.change(search(), { target: { value: "web" } });
  fireEvent.click(
    screen.getByRole("button", { name: "settings.wallpaperSource.search" }),
  );
  await waitFor(() => expect(cards()).toHaveLength(1));
  fireEvent.click(
    screen.getByRole("tab", { name: "settings.wallpaperOpenverse" }),
  );
  await waitFor(() => expect(cards()).toHaveLength(1));
  fireEvent.click(
    screen.getByRole("button", { name: "settings.wallpaperSource.loadMore" }),
  );
  await waitFor(() => expect(cards()).toHaveLength(2));
  expect(mocks.more).toHaveBeenCalledTimes(1);
});

it("keeps a provider result selectable when its bounded thumbnail fails", async () => {
  mocks.thumbnail.mockResolvedValue({
    dataUrl: "invalid-thumbnail",
    width: 100,
    height: 100,
  });
  await initial(["broken-thumb"]);

  await screen.findByText("settings.wallpaperSource.err.download_failed");
  expect(cards()).toHaveLength(1);
  expect((cards()[0] as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(cards()[0]);
  await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(1));
});

it("opens provider attribution links without opening the image preview", async () => {
  await initial(["attributed"]);

  const card = within(screen.getByRole("listitem"));
  fireEvent.click(card.getByRole("button", { name: "Openverse" }));
  fireEvent.click(card.getByRole("button", { name: "Ada" }));
  fireEvent.click(card.getByRole("button", { name: "CC0" }));

  await waitFor(() => expect(mocks.openExternal).toHaveBeenCalledTimes(3));
  expect(mocks.openExternal.mock.calls.map(([url]) => url)).toEqual([
    "https://openverse.example.test/attributed",
    "https://openverse.example.test/author/attributed",
    "https://creativecommons.org/publicdomain/zero/1.0/",
  ]);
  expect(mocks.preview).not.toHaveBeenCalled();
});

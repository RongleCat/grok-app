/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "@/test/jsdomStubs";
import type { WallpaperRemoteSearchResult } from "@/lib/wallpaperRemoteSearch";

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
  isDesktopHost: () => true,
  isTauri: () => false,
  settingsGet: vi.fn(async () => ({ wallpaperXSearchMode: "responses_preview" })),
  settingsSet: vi.fn(async () => ({})),
  wallpaperXSearch: mocks.search, wallpaperXSearchMore: mocks.more, wallpaperXSearchCancel: mocks.cancel,
  listenWallpaperXSearchProgress: vi.fn(async () => () => {}),
  listenWallpaperXSearchBatch: vi.fn(async () => () => {}),
  wallpaperFetchMedia: vi.fn(async () => ({ path: "C:/cache/sky.jpg", mime: "image/jpeg", name: "sky.jpg" })),
  wallpaperImagine: vi.fn(), wallpaperLibraryList: vi.fn(), wallpaperLibraryDelete: vi.fn(), openExternalUrl: mocks.openExternal,
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


const item = (id: string, source: "web" | "openverse" = "openverse") =>
  ({
    id,
    kind: "image",
    source,
    fullUrl: `https://images.example.com/${id}.jpg`,
    thumbUrl: `https://images.example.com/${id}.jpg`,
    sourceName: source === "web" ? "photos.example.test" : "Openverse",
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
  source: "web" | "openverse" = "openverse",
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
  mocks.thumbnail.mockResolvedValue({
    dataUrl: "data:image/jpeg;base64,AA==",
    width: 100,
    height: 100,
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
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
  await waitFor(() =>
    expect(mocks.remoteFetch).toHaveBeenCalledWith(
      "web",
      "https://images.example.com/web-first.jpg",
      expect.any(String),
    ),
  );
  expect(mocks.preview).toHaveBeenCalledTimes(1);
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
it("discards a provider page that completes after switching to X", async () => {
  let finish!: (value: WallpaperRemoteSearchResult) => void;
  mocks.more.mockReturnValue(new Promise<WallpaperRemoteSearchResult>(resolve => { finish = resolve; }));
  await initial();
  fireEvent.click(screen.getByRole("button", { name: "settings.wallpaperSource.loadMore" }));
  await waitFor(() => expect(mocks.more).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("tab", { name: "settings.wallpaperFromX" }));
  finish(result(["late"]));
  await waitFor(() => expect(cards()).toHaveLength(0));
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

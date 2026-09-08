/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import "@/test/jsdomStubs";
import type { WallpaperSearchResult } from "@/lib/wallpaperSource";

const mocks = vi.hoisted(() => ({ search: vi.fn(), more: vi.fn(), cancel: vi.fn(async () => true), preview: vi.fn() }));
vi.mock("@/lib/api", () => ({
  wallpaperRemoteSearch: vi.fn(),
  wallpaperRemoteSearchMore: vi.fn(),
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
  wallpaperLibraryLookup: vi.fn(async () => []),
  wallpaperLibraryRemember: vi.fn(async () => undefined),
  openExternalUrl: vi.fn(),
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
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const item = (id: string) => ({
  id,
  kind: "image",
  source: "x",
  fullUrl: `https://pbs.twimg.com/media/${id}.jpg`,
  thumbUrl: `https://pbs.twimg.com/media/${id}.jpg`,
});
const t = (key: string) => key;
const moreButton = () => screen.getByRole("button", { name: "settings.wallpaperSource.loadMore" });
const cards = () => screen.getAllByRole("button", { name: "settings.wallpaperSource.openPreview" });
async function initial() {
  mocks.search.mockResolvedValue({ items: [item("first")], meta: { routeUsed: "responses", durationMs: 1, continuationId: "context-1" } });
  const view = render(<WallpaperSourceModal open t={t as never} onClose={vi.fn()} onPickFile={vi.fn()} />);
  const input = screen.getByPlaceholderText("settings.wallpaperSource.xPlaceholder");
  fireEvent.change(input, { target: { value: "sky" } });
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "settings.wallpaperSource.search",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "settings.wallpaperSource.search" }));
  await screen.findByRole("button", { name: "settings.wallpaperSource.loadMore" });
  return view;
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("preserves selectable images during enrichment and appends distinct final results", async () => {
  const pending = deferred<WallpaperSearchResult>();
  mocks.more.mockReturnValue(pending.promise);
  await initial();
  fireEvent.click(moreButton());
  await waitFor(() => expect(mocks.more).toHaveBeenCalledTimes(1));
  expect(mocks.more.mock.calls[0][0]).toBe("context-1");
  expect((cards()[0] as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(cards()[0]);
  await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(1));
  pending.resolve({ items: [item("first"), item("second")] });
  await waitFor(() => expect(cards()).toHaveLength(2));
  expect(screen.queryByRole("button", { name: "settings.wallpaperSource.loadMore" })).toBeNull();
});

it("keeps old gallery and allows retry after network failure, then consumes empty completion", async () => {
  mocks.more.mockResolvedValueOnce({ items: [], errorCode: "responses_network" }).mockResolvedValueOnce({ items: [], errorCode: "empty" });
  await initial();
  fireEvent.click(moreButton());
  await waitFor(() => expect(screen.queryByRole("button", { name: "settings.wallpaperSource.cancelSearch" })).toBeNull());
  expect(cards()).toHaveLength(1);
  fireEvent.click(moreButton());
  await screen.findByText("settings.wallpaperSource.noMore");
  expect(cards()).toHaveLength(1);
  expect(mocks.more).toHaveBeenCalledTimes(2);
});

it("hides continuation for a changed query and discards a late result after close", async () => {
  const pending = deferred<WallpaperSearchResult>();
  mocks.more.mockReturnValue(pending.promise);
  await initial();
  const input = screen.getByPlaceholderText("settings.wallpaperSource.xPlaceholder");
  fireEvent.change(input, { target: { value: "sea" } });
  expect(screen.queryByRole("button", { name: "settings.wallpaperSource.loadMore" })).toBeNull();
  fireEvent.change(input, { target: { value: "sky" } });
  fireEvent.click(moreButton());
  fireEvent.click(screen.getByRole("button", { name: "close-modal" }));
  await waitFor(() => expect(mocks.cancel).toHaveBeenCalled());
  pending.resolve({ items: [item("late")] });
  await waitFor(() => expect(cards()).toHaveLength(1));
});

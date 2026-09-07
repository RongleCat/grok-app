import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  cancel: vi.fn(async () => 0),
  cancelAll: vi.fn(async () => 0),
  nextId: 0,
}));

vi.mock("@/lib/api", () => ({
  wallpaperGrokAlbumFetchMedia: mocks.fetch,
  wallpaperGrokAlbumCancelRequests: mocks.cancel,
  wallpaperGrokAlbumCancelAllRequests: mocks.cancelAll,
}));

vi.mock("@/lib/wallpaperRequest", () => ({
  createWallpaperRequestId: () => `album-media-${++mocks.nextId}`,
}));

import {
  cancelGrokAlbumMediaRequests,
  fetchGrokAlbumMedia,
  grokAlbumMediaRequestState,
} from "./grokAlbumMedia";

beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.cancel.mockClear();
  mocks.cancelAll.mockClear();
  mocks.nextId = 0;
});

afterEach(() => {
  cancelGrokAlbumMediaRequests();
});

describe("Grok Saved original media requests", () => {
  it("deduplicates concurrent transfers for the same URL", async () => {
    const result = { path: "C:/wallpapers/saved.jpg", mime: "image/jpeg" };
    mocks.fetch.mockResolvedValue(result);

    const first = fetchGrokAlbumMedia(" https://assets.grok.com/generated/a.jpg ");
    const second = fetchGrokAlbumMedia("https://assets.grok.com/generated/a.jpg");

    expect(first).toBe(second);
    await expect(first).resolves.toEqual(result);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://assets.grok.com/generated/a.jpg",
      "album-media-1",
    );
    expect(grokAlbumMediaRequestState()).toEqual({ active: 0, pending: 0 });
  });

  it("cancels tracked requests and the Host fallback registry", async () => {
    let resolveRequest!: (value: { path: string }) => void;
    mocks.fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );

    const pending = fetchGrokAlbumMedia(
      "https://assets.grok.com/generated/pending.jpg",
    );
    expect(grokAlbumMediaRequestState()).toEqual({ active: 1, pending: 1 });

    cancelGrokAlbumMediaRequests();
    expect(mocks.cancel).toHaveBeenCalledWith(["album-media-1"]);
    expect(mocks.cancelAll).toHaveBeenCalledOnce();
    expect(grokAlbumMediaRequestState()).toEqual({ active: 0, pending: 0 });

    resolveRequest({ path: "C:/wallpapers/pending.jpg" });
    await pending;
  });
});

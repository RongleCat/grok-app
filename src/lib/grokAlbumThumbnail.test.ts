import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const albumThumbnail = vi.hoisted(() => vi.fn());
const cancelAlbumThumbnails = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  wallpaperGrokAlbumThumbnail: albumThumbnail,
  wallpaperGrokAlbumCancelRequests: cancelAlbumThumbnails,
}));

import {
  clearGrokAlbumThumbnailCache,
  grokAlbumThumbnailQueueState,
  peekGrokAlbumThumbnail,
  resolveGrokAlbumThumbnail,
  subscribeGrokAlbumThumbnail,
} from "./grokAlbumThumbnail";

const URL =
  "https://assets.grok.com/users/test/generated/example/image.jpg?cache=1";
const DATA_URL = `data:image/jpeg;base64,${"A".repeat(64)}`;

beforeEach(() => {
  clearGrokAlbumThumbnailCache();
  albumThumbnail.mockReset();
  cancelAlbumThumbnails.mockReset();
  cancelAlbumThumbnails.mockResolvedValue(0);
});

afterEach(() => {
  clearGrokAlbumThumbnailCache();
});

describe("grok album thumbnail delivery", () => {
  it("materializes once and reuses the in-memory result", async () => {
    albumThumbnail.mockResolvedValue({
      dataUrl: DATA_URL,
      width: 1920,
      height: 1080,
    });

    await expect(resolveGrokAlbumThumbnail(URL)).resolves.toBe(DATA_URL);
    await expect(resolveGrokAlbumThumbnail(URL)).resolves.toBe(DATA_URL);
    expect(albumThumbnail).toHaveBeenCalledTimes(1);
    expect(grokAlbumThumbnailQueueState().cached).toBe(1);
  });

  it("notifies mounted cards when warming succeeds and when the source clears", async () => {
    albumThumbnail.mockResolvedValue({
      dataUrl: DATA_URL,
      width: 1920,
      height: 1080,
    });
    const observed: Array<string | null> = [];
    const unsubscribe = subscribeGrokAlbumThumbnail(URL, () => {
      observed.push(peekGrokAlbumThumbnail(URL));
    });

    await expect(resolveGrokAlbumThumbnail(URL)).resolves.toBe(DATA_URL);
    expect(observed).toEqual([DATA_URL]);

    clearGrokAlbumThumbnailCache();
    expect(observed).toEqual([DATA_URL, null]);
    unsubscribe();
  });

  it("rejects non-album URLs before invoking the Host", async () => {
    await expect(
      resolveGrokAlbumThumbnail("https://example.com/generated/image.jpg"),
    ).resolves.toBeNull();
    expect(albumThumbnail).not.toHaveBeenCalled();
  });

  it("does not cache malformed Host payloads", async () => {
    albumThumbnail.mockResolvedValue({
      dataUrl: "https://assets.grok.com/not-inline.jpg",
      width: 1920,
      height: 1080,
    });

    await expect(resolveGrokAlbumThumbnail(URL)).resolves.toBeNull();
    expect(grokAlbumThumbnailQueueState().cached).toBe(0);
  });

  it("settles queued work immediately when the album source is cleared", async () => {
    const releases: Array<(value: unknown) => void> = [];
    albumThumbnail.mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(resolve);
        }),
    );
    const requests = Array.from({ length: 6 }, (_, index) =>
      resolveGrokAlbumThumbnail(
        `https://assets.grok.com/users/test/generated/item-${index}/image.jpg`,
      ),
    );
    expect(grokAlbumThumbnailQueueState()).toMatchObject({ active: 4, queued: 2 });

    clearGrokAlbumThumbnailCache();
    expect(cancelAlbumThumbnails).toHaveBeenCalledTimes(1);
    const cancelledIds = cancelAlbumThumbnails.mock.calls[0]?.[0] as string[];
    expect(cancelledIds).toHaveLength(4);
    expect(new Set(cancelledIds).size).toBe(4);
    for (const [, requestId] of albumThumbnail.mock.calls) {
      expect(cancelledIds).toContain(requestId);
    }
    await expect(Promise.all(requests.slice(4))).resolves.toEqual([null, null]);
    expect(grokAlbumThumbnailQueueState().queued).toBe(0);

    for (const release of releases) {
      release({ dataUrl: DATA_URL, width: 32, height: 32 });
    }
    await expect(Promise.all(requests.slice(0, 4))).resolves.toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(grokAlbumThumbnailQueueState().active).toBe(0);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WallpaperGalleryItem } from "./wallpaperSource";

const fetchThumbnail = vi.hoisted(() => vi.fn());
const cancelThumbnails = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  wallpaperRemoteThumbnail: fetchThumbnail,
  wallpaperRemoteCancelMediaRequests: cancelThumbnails,
}));

import {
  clearRemoteWallpaperThumbnailCache,
  peekRemoteWallpaperThumbnail,
  remoteWallpaperThumbnailQueueState,
  resolveRemoteWallpaperThumbnail,
} from "./remoteWallpaperThumbnail";

const DATA_URL = `data:image/jpeg;base64,${"A".repeat(64)}`;
const ITEM: WallpaperGalleryItem = {
  id: "web-image",
  thumbUrl: "https://cdn.example.test/photo.jpg",
  fullUrl: "https://cdn.example.test/photo.jpg",
  kind: "image",
  source: "web",
  sourceUrl: "https://photos.example.test/gallery/item",
};

beforeEach(() => {
  clearRemoteWallpaperThumbnailCache();
  fetchThumbnail.mockReset();
  cancelThumbnails.mockReset();
  cancelThumbnails.mockResolvedValue(0);
});

afterEach(() => {
  clearRemoteWallpaperThumbnailCache();
});

describe("remote wallpaper thumbnail delivery", () => {
  it("uses the Host once and keeps only the bounded data URL in memory", async () => {
    fetchThumbnail.mockResolvedValue({
      dataUrl: DATA_URL,
      width: 1920,
      height: 1080,
    });

    await expect(resolveRemoteWallpaperThumbnail(ITEM)).resolves.toBe(DATA_URL);
    await expect(resolveRemoteWallpaperThumbnail(ITEM)).resolves.toBe(DATA_URL);

    expect(fetchThumbnail).toHaveBeenCalledTimes(1);
    expect(fetchThumbnail).toHaveBeenCalledWith(
      "web",
      "https://cdn.example.test/photo.jpg",
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
    expect(peekRemoteWallpaperThumbnail(ITEM)).toBe(DATA_URL);
    expect(remoteWallpaperThumbnailQueueState().cached).toBe(1);
  });

  it("rejects unsafe media URLs before invoking the Host", async () => {
    await expect(
      resolveRemoteWallpaperThumbnail({
        ...ITEM,
        thumbUrl: "http://cdn.example.test/photo.jpg",
      }),
    ).resolves.toBeNull();
    await expect(
      resolveRemoteWallpaperThumbnail({
        ...ITEM,
        thumbUrl: "https://user:secret@cdn.example.test/photo.jpg",
      }),
    ).resolves.toBeNull();
    expect(fetchThumbnail).not.toHaveBeenCalled();
  });

  it("does not cache malformed Host payloads", async () => {
    fetchThumbnail.mockResolvedValue({
      dataUrl: "https://cdn.example.test/not-inline.jpg",
      width: 1920,
      height: 1080,
    });

    await expect(resolveRemoteWallpaperThumbnail(ITEM)).resolves.toBeNull();
    expect(remoteWallpaperThumbnailQueueState().cached).toBe(0);
  });

  it("normalizes fragments out of the source-scoped cache key", async () => {
    fetchThumbnail.mockResolvedValue({
      dataUrl: DATA_URL,
      width: 1920,
      height: 1080,
    });

    await resolveRemoteWallpaperThumbnail({
      ...ITEM,
      thumbUrl: `${ITEM.thumbUrl}#preview`,
    });
    await resolveRemoteWallpaperThumbnail(ITEM);

    expect(fetchThumbnail).toHaveBeenCalledTimes(1);
    expect(fetchThumbnail).toHaveBeenCalledWith(
      "web",
      ITEM.thumbUrl,
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
  });
});

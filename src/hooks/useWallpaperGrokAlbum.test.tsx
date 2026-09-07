/**
 * @vitest-environment jsdom
 */
import {
  act,
  cleanup,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GrokAlbumSnapshot } from "@/lib/grokAlbum";

const albumSnapshot = vi.hoisted(() => vi.fn());
const albumLoadMore = vi.hoisted(() => vi.fn());
const albumOpen = vi.hoisted(() => vi.fn());
const albumRefresh = vi.hoisted(() => vi.fn());
const warmAlbumThumbnails = vi.hoisted(() =>
  vi.fn(async (_urls: string[]) => undefined),
);
const clearAlbumThumbnails = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  isDesktopHost: () => true,
  wallpaperGrokAlbumSnapshot: albumSnapshot,
  wallpaperGrokAlbumLoadMore: albumLoadMore,
  wallpaperGrokAlbumOpen: albumOpen,
  wallpaperGrokAlbumRefresh: albumRefresh,
  wallpaperGrokAlbumCancelRequests: vi.fn(async () => 0),
  wallpaperGrokAlbumCancelAllRequests: vi.fn(async () => 0),
  wallpaperRemoteCancelMediaRequests: vi.fn(async () => 0),
  wallpaperRemoteCancelAllMediaRequests: vi.fn(async () => 0),
}));

vi.mock("@/lib/grokAlbumThumbnail", () => ({
  warmGrokAlbumThumbnails: warmAlbumThumbnails,
  clearGrokAlbumThumbnailCache: clearAlbumThumbnails,
}));

import { useWallpaperGrokAlbum } from "./useWallpaperGrokAlbum";

function media(index: number) {
  return {
    mediaUrl: `https://assets.grok.com/users/test/generated/item-${index}/image.jpg`,
    thumbnailUrl: null,
    kind: "image" as const,
    width: 1920,
    height: 1080,
    createdAt: null,
    postId: null,
  };
}

function readySnapshot(count: number): GrokAlbumSnapshot {
  return {
    status: "ready",
    items: Array.from({ length: count }, (_, index) => media(index)),
    total: count,
    canLoadMore: true,
    newItems: 0,
    prefetchSkipped: false,
    pageChanged: false,
  };
}

beforeEach(() => {
  albumSnapshot.mockReset();
  albumLoadMore.mockReset();
  albumOpen.mockReset();
  albumRefresh.mockReset();
  warmAlbumThumbnails.mockClear();
  clearAlbumThumbnails.mockClear();
});

afterEach(() => cleanup());

describe("useWallpaperGrokAlbum", () => {
  it("restores expanded pages only after a fresh snapshot and resets them on modal close", async () => {
    albumSnapshot.mockResolvedValue(readySnapshot(60));
    const { result, rerender } = renderHook(({ enabled, open }) => useWallpaperGrokAlbum(enabled, open), {
      initialProps: { enabled: true, open: true },
    });
    await waitFor(() => expect(result.current.items).toHaveLength(20));
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.items).toHaveLength(40);
    rerender({ enabled: false, open: true });
    expect(result.current.items).toHaveLength(0);
    let finish!: (snapshot: GrokAlbumSnapshot) => void;
    albumSnapshot.mockImplementationOnce(() => new Promise<GrokAlbumSnapshot>((resolve) => { finish = resolve; }));
    rerender({ enabled: true, open: true });
    expect(result.current.status).toBe("loading");
    expect(result.current.items).toHaveLength(0);
    await act(async () => { finish(readySnapshot(60)); });
    expect(result.current.items).toHaveLength(40);
    rerender({ enabled: false, open: false });
    rerender({ enabled: true, open: true });
    await waitFor(() => expect(result.current.items).toHaveLength(20));
  });

  it("invalidates restored navigation when the Host reports a changed ready page", async () => {
    albumSnapshot.mockResolvedValue(readySnapshot(60));
    const { result, rerender } = renderHook(({ enabled }) => useWallpaperGrokAlbum(enabled), { initialProps: { enabled: true } });
    await waitFor(() => expect(result.current.items).toHaveLength(20));
    await act(async () => { await result.current.loadMore(); });
    const revision = result.current.historyRevision;
    rerender({ enabled: false });
    albumSnapshot.mockResolvedValue({ ...readySnapshot(60), pageChanged: true });
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.historyRevision).toBeGreaterThan(revision));
    expect(result.current.items).toHaveLength(20);
  });

  it("syncs after StrictMode replays effect cleanup and setup", async () => {
    albumSnapshot.mockResolvedValue(readySnapshot(20));
    const view = renderHook(() => useWallpaperGrokAlbum(true), {
      wrapper: StrictMode,
    });

    await waitFor(() => expect(view.result.current.cachedCount).toBe(20));
    expect(albumSnapshot).toHaveBeenCalled();
    expect(view.result.current.status).toBe("ready");
  });

  it("shows an honest loading state until the first Host snapshot arrives", async () => {
    let resolveSnapshot: ((snapshot: GrokAlbumSnapshot) => void) | null = null;
    albumSnapshot.mockImplementation(
      () =>
        new Promise<GrokAlbumSnapshot>((resolve) => {
          resolveSnapshot = resolve;
        }),
    );
    const view = renderHook(() => useWallpaperGrokAlbum(true));

    expect(view.result.current.status).toBe("loading");
    expect(view.result.current.busy).toBe(true);

    await act(async () => {
      resolveSnapshot?.({
        status: "closed",
        items: [],
        total: 0,
        canLoadMore: false,
        newItems: 0,
        prefetchSkipped: false,
        pageChanged: false,
      });
    });

    expect(view.result.current.status).toBe("closed");
    expect(view.result.current.busy).toBe(false);
  });

  it("surfaces a failed first snapshot instead of remaining in loading", async () => {
    albumSnapshot.mockRejectedValue(new Error("album_bridge_unavailable"));
    const view = renderHook(() => useWallpaperGrokAlbum(true));

    expect(view.result.current.status).toBe("loading");
    await waitFor(() => expect(view.result.current.status).toBe("closed"));
    expect(view.result.current.busy).toBe(false);
    expect(view.result.current.errorCode).toBe("bridge");
  });

  it("keeps an initial sign-in snapshot loading until verification is classified", async () => {
    albumSnapshot
      .mockResolvedValueOnce({
        status: "sign_in",
        items: [],
        total: 0,
        canLoadMore: false,
        newItems: 0,
        prefetchSkipped: false,
        pageChanged: false,
      } satisfies GrokAlbumSnapshot)
      .mockResolvedValueOnce({
        status: "verification",
        items: [],
        total: 0,
        canLoadMore: false,
        newItems: 0,
        prefetchSkipped: false,
        pageChanged: false,
      } satisfies GrokAlbumSnapshot);
    const view = renderHook(() => useWallpaperGrokAlbum(true));

    await waitFor(() => expect(albumSnapshot).toHaveBeenCalledTimes(1));
    expect(view.result.current.status).toBe("loading");
    expect(view.result.current.busy).toBe(true);

    await waitFor(() => expect(view.result.current.status).toBe("verification"), {
      timeout: 3_000,
    });
    expect(albumSnapshot).toHaveBeenCalledTimes(2);
    expect(view.result.current.busy).toBe(false);
  });

  it("accepts two consecutive initial sign-in snapshots", async () => {
    const signIn = {
      status: "sign_in",
      items: [],
      total: 0,
      canLoadMore: false,
      newItems: 0,
      prefetchSkipped: false,
      pageChanged: false,
    } satisfies GrokAlbumSnapshot;
    albumSnapshot.mockResolvedValue(signIn);
    const view = renderHook(() => useWallpaperGrokAlbum(true));

    await waitFor(() => expect(albumSnapshot).toHaveBeenCalledTimes(1));
    expect(view.result.current.status).toBe("loading");

    await waitFor(() => expect(view.result.current.status).toBe("sign_in"), {
      timeout: 3_000,
    });
    expect(albumSnapshot).toHaveBeenCalledTimes(2);
    expect(view.result.current.busy).toBe(false);
  });

  it("warms thumbnails for the visible page and exactly one page ahead", async () => {
    albumSnapshot.mockResolvedValue(readySnapshot(60));
    renderHook(() => useWallpaperGrokAlbum(true));

    await waitFor(() => expect(warmAlbumThumbnails).toHaveBeenCalled());
    const warmed = warmAlbumThumbnails.mock.calls.at(-1)?.[0] as string[];
    expect(warmed).toHaveLength(40);
    expect(warmed[0]).toContain("item-0");
    expect(warmed[39]).toContain("item-39");
  });

  it("shows 20 items and reveals an already warm page without another Host call", async () => {
    albumSnapshot.mockResolvedValue(readySnapshot(40));
    const view = renderHook(() => useWallpaperGrokAlbum(true));

    await waitFor(() => expect(view.result.current.cachedCount).toBe(40));
    expect(view.result.current.visibleCount).toBe(20);

    await act(async () => view.result.current.loadMore());
    expect(view.result.current.visibleCount).toBe(40);
    expect(albumLoadMore).not.toHaveBeenCalled();
  });

  it("resets paging and thumbnail state when the official page identity changes", async () => {
    const initial = { ...readySnapshot(60), canLoadMore: false };
    const changed = {
      ...readySnapshot(50),
      items: Array.from({ length: 50 }, (_, index) => media(index + 100)),
      canLoadMore: false,
      newItems: 50,
      pageChanged: true,
    } satisfies GrokAlbumSnapshot;
    albumSnapshot.mockResolvedValueOnce(initial).mockResolvedValue(changed);
    const view = renderHook(() => useWallpaperGrokAlbum(true));

    await waitFor(() => expect(view.result.current.cachedCount).toBe(60));
    await act(async () => view.result.current.loadMore());
    await act(async () => view.result.current.loadMore());
    expect(view.result.current.visibleCount).toBe(60);

    await act(async () => {
      await view.result.current.sync();
    });

    expect(view.result.current.cachedCount).toBe(50);
    expect(view.result.current.visibleCount).toBe(20);
    expect(clearAlbumThumbnails).toHaveBeenCalledTimes(1);
  });

  it("warms exactly the next page in the background without revealing it", async () => {
    albumSnapshot.mockResolvedValue(readySnapshot(20));
    albumLoadMore.mockResolvedValue({
      ...readySnapshot(40),
      newItems: 20,
    } satisfies GrokAlbumSnapshot);
    const view = renderHook(() => useWallpaperGrokAlbum(true));

    await waitFor(() => expect(view.result.current.cachedCount).toBe(20));
    await waitFor(
      () => expect(albumLoadMore).toHaveBeenCalledWith(true),
      { timeout: 1_500 },
    );
    await waitFor(() => expect(view.result.current.cachedCount).toBe(40));
    expect(view.result.current.visibleCount).toBe(20);
  });

  it("reuses an in-flight background warmup when load more is clicked", async () => {
    let resolveWarmup: ((snapshot: GrokAlbumSnapshot) => void) | null = null;
    albumSnapshot.mockResolvedValue(readySnapshot(20));
    albumLoadMore.mockImplementation(
      () =>
        new Promise<GrokAlbumSnapshot>((resolve) => {
          resolveWarmup = resolve;
        }),
    );
    const view = renderHook(() => useWallpaperGrokAlbum(true));

    await waitFor(() => expect(view.result.current.cachedCount).toBe(20));
    await waitFor(
      () => expect(albumLoadMore).toHaveBeenCalledWith(true),
      { timeout: 1_500 },
    );

    let manualLoad: Promise<void> | null = null;
    await act(async () => {
      manualLoad = view.result.current.loadMore();
      await Promise.resolve();
    });
    expect(albumLoadMore).toHaveBeenCalledTimes(1);
    expect(view.result.current.loadingMore).toBe(true);
    expect(view.result.current.syncing).toBe(false);

    await act(async () => {
      resolveWarmup?.({
        ...readySnapshot(40),
        newItems: 20,
      });
      await manualLoad;
    });
    expect(view.result.current.cachedCount).toBe(40);
    expect(view.result.current.visibleCount).toBe(40);
    expect(view.result.current.loadingMore).toBe(false);
  });

  it("retries a skipped background warmup as an explicit load more", async () => {
    let resolveWarmup: ((snapshot: GrokAlbumSnapshot) => void) | null = null;
    albumSnapshot.mockResolvedValue(readySnapshot(20));
    albumLoadMore
      .mockImplementationOnce(
        () =>
          new Promise<GrokAlbumSnapshot>((resolve) => {
            resolveWarmup = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ...readySnapshot(40),
        newItems: 20,
      } satisfies GrokAlbumSnapshot);
    const view = renderHook(() => useWallpaperGrokAlbum(true));

    await waitFor(
      () => expect(albumLoadMore).toHaveBeenCalledWith(true),
      { timeout: 1_500 },
    );
    let manualLoad: Promise<void> | null = null;
    await act(async () => {
      manualLoad = view.result.current.loadMore();
      await Promise.resolve();
    });
    await act(async () => {
      resolveWarmup?.({
        ...readySnapshot(20),
        prefetchSkipped: true,
      });
      await manualLoad;
    });

    expect(albumLoadMore).toHaveBeenCalledTimes(2);
    expect(albumLoadMore).toHaveBeenNthCalledWith(2, false);
    expect(view.result.current.cachedCount).toBe(40);
    expect(view.result.current.visibleCount).toBe(40);
    expect(view.result.current.canLoadMore).toBe(true);
  });

  it("retries an empty in-flight background warmup as an explicit load more", async () => {
    let resolveWarmup: ((snapshot: GrokAlbumSnapshot) => void) | null = null;
    albumSnapshot.mockResolvedValue(readySnapshot(20));
    albumLoadMore
      .mockImplementationOnce(
        () =>
          new Promise<GrokAlbumSnapshot>((resolve) => {
            resolveWarmup = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ...readySnapshot(40),
        newItems: 20,
      } satisfies GrokAlbumSnapshot);
    const view = renderHook(() => useWallpaperGrokAlbum(true));

    await waitFor(
      () => expect(albumLoadMore).toHaveBeenCalledWith(true),
      { timeout: 1_500 },
    );
    let manualLoad: Promise<void> | null = null;
    await act(async () => {
      manualLoad = view.result.current.loadMore();
      await Promise.resolve();
    });
    expect(albumLoadMore).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveWarmup?.(readySnapshot(20));
      await manualLoad;
    });

    expect(albumLoadMore).toHaveBeenCalledTimes(2);
    expect(albumLoadMore).toHaveBeenNthCalledWith(2, false);
    expect(view.result.current.cachedCount).toBe(40);
    expect(view.result.current.visibleCount).toBe(40);
    expect(view.result.current.canLoadMore).toBe(true);
  });

  it("retries a rejected in-flight background warmup as an explicit load more", async () => {
    albumSnapshot.mockResolvedValue(readySnapshot(20));
    albumLoadMore
      .mockRejectedValueOnce(new Error("warmup failed"))
      .mockResolvedValueOnce({
        ...readySnapshot(40),
        newItems: 20,
      } satisfies GrokAlbumSnapshot);
    const view = renderHook(() => useWallpaperGrokAlbum(true));

    await waitFor(
      () => expect(albumLoadMore).toHaveBeenCalledWith(true),
      { timeout: 1_500 },
    );
    await act(async () => view.result.current.loadMore());

    expect(albumLoadMore).toHaveBeenCalledTimes(2);
    expect(albumLoadMore).toHaveBeenNthCalledWith(2, false);
    expect(view.result.current.cachedCount).toBe(40);
    expect(view.result.current.visibleCount).toBe(40);
  });

  it("surfaces a foreground failure after a rejected background warmup", async () => {
    albumSnapshot.mockResolvedValue(readySnapshot(20));
    albumLoadMore
      .mockRejectedValueOnce(new Error("warmup failed"))
      .mockRejectedValueOnce(new Error("album_bridge foreground failed"));
    const view = renderHook(() => useWallpaperGrokAlbum(true));

    await waitFor(
      () => expect(albumLoadMore).toHaveBeenCalledWith(true),
      { timeout: 1_500 },
    );
    await act(async () => view.result.current.loadMore());

    expect(albumLoadMore).toHaveBeenCalledTimes(2);
    expect(albumLoadMore).toHaveBeenNthCalledWith(2, false);
    expect(view.result.current.errorCode).toBe("bridge");
    expect(view.result.current.cachedCount).toBe(20);
  });

  it("drops cached media when the official page becomes signed out", async () => {
    albumSnapshot
      .mockResolvedValueOnce({ ...readySnapshot(20), canLoadMore: false })
      .mockResolvedValueOnce({
        ...readySnapshot(20),
        status: "sign_in",
        canLoadMore: false,
      } satisfies GrokAlbumSnapshot);
    const view = renderHook(() => useWallpaperGrokAlbum(true));

    await waitFor(() => expect(view.result.current.cachedCount).toBe(20));
    await act(async () => {
      await view.result.current.sync();
    });

    expect(view.result.current.status).toBe("sign_in");
    expect(view.result.current.cachedCount).toBe(0);
    expect(view.result.current.visibleCount).toBe(0);
    expect(view.result.current.hasSynced).toBe(false);
  });

  it("keeps an explicit load-more retry after an empty background warmup", async () => {
    albumSnapshot.mockResolvedValue(readySnapshot(20));
    const emptyWarmup = Promise.resolve(readySnapshot(20));
    albumLoadMore
      .mockReturnValueOnce(emptyWarmup)
      .mockResolvedValueOnce({
        ...readySnapshot(40),
        newItems: 20,
      } satisfies GrokAlbumSnapshot);
    const view = renderHook(() => useWallpaperGrokAlbum(true));

    await waitFor(
      () => expect(albumLoadMore).toHaveBeenCalledWith(true),
      { timeout: 1_500 },
    );
    await act(async () => {
      await emptyWarmup;
      await Promise.resolve();
    });
    await act(async () => view.result.current.loadMore());

    expect(albumLoadMore).toHaveBeenNthCalledWith(2, false);
    expect(view.result.current.cachedCount).toBe(40);
    expect(view.result.current.visibleCount).toBe(40);
  });

  it("ignores a late warmup after the album source is disabled and reopened", async () => {
    let resolveWarmup: ((snapshot: GrokAlbumSnapshot) => void) | null = null;
    albumSnapshot.mockResolvedValue(readySnapshot(20));
    albumLoadMore.mockImplementation(
      () =>
        new Promise<GrokAlbumSnapshot>((resolve) => {
          resolveWarmup = resolve;
        }),
    );
    const view = renderHook(
      ({ enabled }) => useWallpaperGrokAlbum(enabled),
      { initialProps: { enabled: true } },
    );

    await waitFor(
      () => expect(albumLoadMore).toHaveBeenCalledWith(true),
      { timeout: 1_500 },
    );
    view.rerender({ enabled: false });
    await waitFor(() => expect(view.result.current.status).toBe("closed"));
    view.rerender({ enabled: true });
    await waitFor(() => expect(view.result.current.cachedCount).toBe(20));
    await act(async () => {
      resolveWarmup?.({
        ...readySnapshot(40),
        newItems: 20,
      });
      await Promise.resolve();
    });

    expect(view.result.current.status).toBe("ready");
    expect(view.result.current.cachedCount).toBe(20);
    expect(view.result.current.visibleCount).toBe(20);
  });

  it("invalidates a pending snapshot when the hook unmounts", async () => {
    let resolveSnapshot: ((snapshot: GrokAlbumSnapshot) => void) | null = null;
    albumSnapshot.mockImplementation(
      () =>
        new Promise<GrokAlbumSnapshot>((resolve) => {
          resolveSnapshot = resolve;
        }),
    );
    const view = renderHook(() => useWallpaperGrokAlbum(true));
    await waitFor(() => expect(albumSnapshot).toHaveBeenCalledTimes(1));

    view.unmount();
    await act(async () => {
      resolveSnapshot?.(readySnapshot(20));
      await Promise.resolve();
    });

    expect(warmAlbumThumbnails).not.toHaveBeenCalled();
    expect(albumLoadMore).not.toHaveBeenCalled();
    expect(clearAlbumThumbnails).toHaveBeenCalled();
  });
});

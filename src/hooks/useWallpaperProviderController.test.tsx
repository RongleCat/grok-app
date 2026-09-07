/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessageKey } from "@/i18n";
import type {
  WallpaperRemoteSearchResult,
  WallpaperRemoteSearchStage,
  WallpaperRemoteSource,
} from "@/lib/wallpaperRemoteSearch";
import type {
  WallpaperGalleryItem,
  WallpaperSourceErrorCode,
} from "@/lib/wallpaperSource";

const remote = vi.hoisted(() => ({
  busy: false,
  source: null as WallpaperRemoteSource | null,
  requestId: null as string | null,
  stage: null as WallpaperRemoteSearchStage | null,
  progressiveItems: [] as WallpaperGalleryItem[],
  progressiveCount: 0,
  progressiveDone: false,
  search: vi.fn(),
  loadMore: vi.fn(),
  cancel: vi.fn(async () => true),
}));

vi.mock("./useWallpaperRemoteSearch", () => ({
  useWallpaperRemoteSearch: () => remote,
}));

import { useWallpaperProviderController } from "./useWallpaperProviderController";

function galleryItem(id: string): WallpaperGalleryItem {
  return {
    id,
    kind: "image",
    source: "openverse",
    thumbUrl: `https://images.example.test/${id}.jpg`,
    fullUrl: `https://images.example.test/${id}.jpg`,
    sourceName: "Openverse",
    sourceUrl: `https://openverse.example.test/${id}`,
  };
}

function result(
  ids: string[],
  overrides: Partial<WallpaperRemoteSearchResult> = {},
): WallpaperRemoteSearchResult {
  return {
    source: "openverse",
    items: ids.map(galleryItem),
    hasMore: false,
    cacheHit: false,
    durationMs: 1_000,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function translate(
  key: MessageKey,
  vars?: Record<string, string | number | undefined | null>,
) {
  const suffix = vars
    ? Object.entries(vars)
        .map(([name, value]) => `${name}=${value}`)
        .join(",")
    : "";
  return suffix ? `${key}:${suffix}` : key;
}

function useHarness({
  enabled = true,
  source = "openverse" as WallpaperRemoteSource,
  query = "misty coast",
} = {}) {
  const [items, setItems] = useState<WallpaperGalleryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] =
    useState<WallpaperSourceErrorCode | null>(null);
  const [statusHint, setStatusHint] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>("old");
  const controller = useWallpaperProviderController({
    enabled,
    source,
    query,
    items,
    t: translate,
    setItems,
    setError,
    setErrorCode,
    setStatusHint,
    setHasSearched,
    setSelectedId,
  });
  return {
    controller,
    items,
    error,
    errorCode,
    statusHint,
    hasSearched,
    selectedId,
  };
}

afterEach(() => {
  cleanup();
  remote.busy = false;
  remote.source = null;
  remote.requestId = null;
  remote.stage = null;
  remote.progressiveItems = [];
  remote.progressiveCount = 0;
  remote.progressiveDone = false;
  remote.search.mockReset();
  remote.loadMore.mockReset();
  remote.cancel.mockClear();
});

describe("useWallpaperProviderController prefetch", () => {
  it("keeps one successful page ahead without revealing it early", async () => {
    const nextPrefetch = deferred<WallpaperRemoteSearchResult | null>();
    remote.search.mockResolvedValue(result(["first"], { hasMore: true }));
    remote.loadMore
      .mockResolvedValueOnce(result(["second"], { hasMore: true }))
      .mockReturnValueOnce(nextPrefetch.promise);
    const hook = renderHook(() => useHarness());

    await act(async () => hook.result.current.controller.search());
    await waitFor(() => expect(remote.loadMore).toHaveBeenCalledTimes(1));
    expect(hook.result.current.items.map((item) => item.id)).toEqual(["first"]);

    await act(async () => hook.result.current.controller.loadMore());

    expect(hook.result.current.items.map((item) => item.id)).toEqual([
      "first",
      "second",
    ]);
    expect(remote.loadMore).toHaveBeenCalledTimes(2);
    expect(hook.result.current.controller.canLoadMore).toBe(true);

    await act(async () => {
      nextPrefetch.resolve(result(["third"]));
      await nextPrefetch.promise;
    });
    expect(hook.result.current.items.map((item) => item.id)).toEqual([
      "first",
      "second",
    ]);
  });

  it("awaits an in-flight prefetch instead of issuing a duplicate request", async () => {
    const pending = deferred<WallpaperRemoteSearchResult | null>();
    remote.search.mockResolvedValue(result(["first"], { hasMore: true }));
    remote.loadMore.mockReturnValue(pending.promise);
    const hook = renderHook(() => useHarness());

    await act(async () => hook.result.current.controller.search());
    let paging!: Promise<void>;
    let duplicate!: Promise<void>;
    act(() => {
      paging = hook.result.current.controller.loadMore();
      duplicate = hook.result.current.controller.loadMore();
    });

    expect(remote.loadMore).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(hook.result.current.controller.loadingMore).toBe(true),
    );
    await act(async () => {
      pending.resolve(result(["second"]));
      await Promise.all([paging, duplicate]);
    });
    expect(remote.loadMore).toHaveBeenCalledTimes(1);
    expect(hook.result.current.items.map((item) => item.id)).toEqual([
      "first",
      "second",
    ]);
  });

  it("does not expose progressive items from a hidden prefetch", async () => {
    const pending = deferred<WallpaperRemoteSearchResult | null>();
    remote.search.mockResolvedValue(result(["first"], { hasMore: true }));
    remote.loadMore.mockReturnValue(pending.promise);
    const hook = renderHook(() => useHarness());

    await act(async () => hook.result.current.controller.search());
    remote.busy = true;
    remote.source = "openverse";
    remote.progressiveItems = [galleryItem("hidden")];
    hook.rerender();

    expect(hook.result.current.items.map((item) => item.id)).toEqual(["first"]);
    expect(hook.result.current.controller.busy).toBe(false);
    expect(hook.result.current.controller.stage).toBeNull();

    await act(async () => {
      pending.resolve(result(["second"]));
      await pending.promise;
    });
  });

  it("retries foreground paging after a resolved prefetch error", async () => {
    remote.search.mockResolvedValue(result(["first"], { hasMore: true }));
    remote.loadMore
      .mockResolvedValueOnce(result([], { errorCode: "provider_network" }))
      .mockResolvedValueOnce(result(["second"]));
    const hook = renderHook(() => useHarness());

    await act(async () => hook.result.current.controller.search());
    await waitFor(() => expect(remote.loadMore).toHaveBeenCalledTimes(1));
    expect(hook.result.current.error).toBeNull();
    await act(async () => hook.result.current.controller.loadMore());

    expect(remote.loadMore).toHaveBeenCalledTimes(2);
    expect(hook.result.current.items.map((item) => item.id)).toEqual([
      "first",
      "second",
    ]);
    expect(hook.result.current.error).toBeNull();
  });

  it("retries foreground paging after a rejected prefetch", async () => {
    remote.search.mockResolvedValue(result(["first"], { hasMore: true }));
    remote.loadMore
      .mockRejectedValueOnce(new Error("provider_timeout"))
      .mockResolvedValueOnce(result(["second"]));
    const hook = renderHook(() => useHarness());

    await act(async () => hook.result.current.controller.search());
    await waitFor(() => expect(remote.loadMore).toHaveBeenCalledTimes(1));
    await act(async () => hook.result.current.controller.loadMore());

    expect(remote.loadMore).toHaveBeenCalledTimes(2);
    expect(hook.result.current.items.map((item) => item.id)).toEqual([
      "first",
      "second",
    ]);
  });

  it("preserves cards and retry state when foreground paging also fails", async () => {
    remote.search.mockResolvedValue(result(["survivor"], { hasMore: true }));
    remote.loadMore
      .mockResolvedValueOnce(result([], { errorCode: "provider_network" }))
      .mockRejectedValueOnce(new Error("provider_timeout"));
    const hook = renderHook(() => useHarness());

    await act(async () => hook.result.current.controller.search());
    await waitFor(() => expect(remote.loadMore).toHaveBeenCalledTimes(1));
    await act(async () => hook.result.current.controller.loadMore());

    expect(hook.result.current.items.map((item) => item.id)).toEqual([
      "survivor",
    ]);
    expect(hook.result.current.errorCode).toBe("timeout");
    expect(hook.result.current.controller.canLoadMore).toBe(true);
  });

  it("cancels and discards a late prefetch after the query changes", async () => {
    const pending = deferred<WallpaperRemoteSearchResult | null>();
    remote.search.mockResolvedValue(result(["first"], { hasMore: true }));
    remote.loadMore.mockReturnValue(pending.promise);
    const hook = renderHook(
      ({ query }) => useHarness({ query }),
      { initialProps: { query: "misty coast" } },
    );

    await act(async () => hook.result.current.controller.search());
    remote.cancel.mockClear();
    hook.rerender({ query: "desert" });
    await waitFor(() => expect(remote.cancel).toHaveBeenCalledTimes(1));
    expect(hook.result.current.controller.canLoadMore).toBe(false);

    await act(async () => {
      pending.resolve(result(["late"]));
      await pending.promise;
    });
    expect(hook.result.current.items.map((item) => item.id)).toEqual(["first"]);
  });
});

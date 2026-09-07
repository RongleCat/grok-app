/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useWallpaperRemoteSearch,
  type WallpaperRemoteSearchClient,
} from "./useWallpaperRemoteSearch";
import type {
  WallpaperRemoteSearchBatch,
  WallpaperRemoteSearchProgress,
  WallpaperRemoteSearchResult,
} from "@/lib/wallpaperRemoteSearch";

afterEach(() => cleanup());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function result(
  source: "web" | "openverse" | "pexels",
): WallpaperRemoteSearchResult {
  return {
    source,
    items: [],
    hasMore: false,
    cacheHit: false,
    durationMs: 1,
  };
}

function harness() {
  let progressHandler:
    | ((progress: WallpaperRemoteSearchProgress) => void)
    | null = null;
  let batchHandler: ((batch: WallpaperRemoteSearchBatch) => void) | null = null;
  const unlisten = vi.fn();
  const client: WallpaperRemoteSearchClient = {
    search: vi.fn(),
    searchMore: vi.fn(),
    cancel: vi.fn(async () => true),
    listenProgress: vi.fn(async (handler) => {
      progressHandler = handler;
      return unlisten;
    }),
    listenBatch: vi.fn(async (handler) => {
      batchHandler = handler;
      return unlisten;
    }),
  };
  return {
    client,
    progress(value: WallpaperRemoteSearchProgress) {
      progressHandler?.(value);
    },
    batch(value: WallpaperRemoteSearchBatch) {
      batchHandler?.(value);
    },
    unlisten,
  };
}

describe("useWallpaperRemoteSearch", () => {
  it("isolates events by both request id and source", async () => {
    const pending = deferred<WallpaperRemoteSearchResult>();
    const test = harness();
    vi.mocked(test.client.search).mockReturnValue(pending.promise);
    const hook = renderHook(() =>
      useWallpaperRemoteSearch(test.client, () => "remote-active"),
    );
    act(() => {
      void hook.result.current.search("web", "mountains");
    });
    await waitFor(() => expect(hook.result.current.busy).toBe(true));
    await waitFor(() => expect(test.client.listenBatch).toHaveBeenCalled());

    act(() => {
      test.progress({
        requestId: "remote-active",
        source: "openverse",
        stage: "loading_more",
      });
      test.batch({
        requestId: "remote-active",
        source: "openverse",
        batchIndex: 1,
        items: [],
        accumulatedCount: 0,
        done: true,
      });
    });
    expect(hook.result.current.stage).toBe("preparing");
    expect(hook.result.current.progressiveDone).toBe(false);

    act(() => {
      test.progress({
        requestId: "remote-active",
        source: "web",
        stage: "validating_images",
      });
      test.batch({
        requestId: "remote-active",
        source: "web",
        batchIndex: 1,
        items: [
          {
            id: "one",
            thumbUrl: "https://images.example.test/one.jpg",
            fullUrl: "https://images.example.test/one.jpg",
            kind: "image",
            source: "web",
          },
        ],
        accumulatedCount: 1,
        done: true,
      });
    });
    expect(hook.result.current.stage).toBe("validating_images");
    expect(hook.result.current.progressiveItems).toHaveLength(1);
    expect(hook.result.current.progressiveDone).toBe(true);

    pending.resolve(result("web"));
    await waitFor(() => expect(hook.result.current.busy).toBe(false));
  });

  it("cancels a generation and rejects its late result", async () => {
    const pending = deferred<WallpaperRemoteSearchResult>();
    const test = harness();
    vi.mocked(test.client.search).mockReturnValue(pending.promise);
    const hook = renderHook(() =>
      useWallpaperRemoteSearch(test.client, () => "remote-cancel"),
    );
    let searchPromise!: Promise<WallpaperRemoteSearchResult | null>;
    act(() => {
      searchPromise = hook.result.current.search("web", "ocean");
    });
    await waitFor(() => expect(hook.result.current.busy).toBe(true));
    await act(async () => {
      expect(await hook.result.current.cancel()).toBe(true);
    });
    expect(test.client.cancel).toHaveBeenCalledWith("web", "remote-cancel");
    pending.resolve(result("web"));
    await expect(searchPromise).resolves.toBeNull();
  });

  it("cancels the prior source before replacement and cleans up on unmount", async () => {
    const first = deferred<WallpaperRemoteSearchResult>();
    const second = deferred<WallpaperRemoteSearchResult>();
    const test = harness();
    vi.mocked(test.client.search)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const ids = ["remote-old", "remote-new"];
    const hook = renderHook(() =>
      useWallpaperRemoteSearch(
        test.client,
        () => ids.shift() ?? "remote-extra",
      ),
    );
    let oldPromise!: Promise<WallpaperRemoteSearchResult | null>;
    act(() => {
      oldPromise = hook.result.current.search("web", "old");
    });
    await waitFor(() => expect(hook.result.current.busy).toBe(true));
    act(() => {
      void hook.result.current.search("openverse", "new");
    });
    await waitFor(() =>
      expect(test.client.cancel).toHaveBeenCalledWith("web", "remote-old"),
    );
    second.resolve(result("openverse"));
    await waitFor(() => expect(hook.result.current.busy).toBe(false));
    first.resolve(result("web"));
    await expect(oldPromise).resolves.toBeNull();
    hook.unmount();
    expect(test.unlisten).toHaveBeenCalledTimes(2);
  });

  it("does not let an invocation waiting for cancellation replace a newer search", async () => {
    const first = deferred<WallpaperRemoteSearchResult>();
    const newest = deferred<WallpaperRemoteSearchResult>();
    const cancellation = deferred<boolean>();
    const test = harness();
    vi.mocked(test.client.search)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(newest.promise);
    vi.mocked(test.client.cancel).mockReturnValue(cancellation.promise);
    const ids = ["remote-first", "remote-newest"];
    const hook = renderHook(() =>
      useWallpaperRemoteSearch(
        test.client,
        () => ids.shift() ?? "remote-unexpected",
      ),
    );

    let firstPromise!: Promise<WallpaperRemoteSearchResult | null>;
    let supersededPromise!: Promise<WallpaperRemoteSearchResult | null>;
    let newestPromise!: Promise<WallpaperRemoteSearchResult | null>;
    act(() => {
      firstPromise = hook.result.current.search("web", "first");
    });
    await waitFor(() => expect(hook.result.current.busy).toBe(true));
    act(() => {
      supersededPromise = hook.result.current.search("openverse", "superseded");
    });
    await waitFor(() =>
      expect(test.client.cancel).toHaveBeenCalledWith("web", "remote-first"),
    );
    act(() => {
      newestPromise = hook.result.current.search("pexels", "newest");
    });
    await waitFor(() => expect(test.client.search).toHaveBeenCalledTimes(2));
    expect(test.client.search).toHaveBeenLastCalledWith(
      "pexels",
      "newest",
      "remote-newest",
    );

    await act(async () => cancellation.resolve(true));
    await expect(supersededPromise).resolves.toBeNull();
    expect(test.client.search).toHaveBeenCalledTimes(2);

    newest.resolve(result("pexels"));
    await expect(newestPromise).resolves.toEqual(result("pexels"));
    first.resolve(result("web"));
    await expect(firstPromise).resolves.toBeNull();
  });
});

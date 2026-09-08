/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WallpaperLibraryPage } from "@/lib/api/wallpaper";
import type { WallpaperMediaRecord } from "@/lib/wallpaperSource";
import { useWallpaperLibrary } from "./useWallpaperLibrary";

const fetchPage = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({ wallpaperLibraryPage: fetchPage }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
});

function page(
  name: string,
  nextCursor: string | null = null,
): WallpaperLibraryPage {
  return {
    items: [
      {
        path: `/wallpapers/${name}.png`,
        name,
        source: "library",
        kind: "image",
        bytes: 100,
        modifiedMs: 1,
      },
    ],
    nextCursor,
    total: 251,
    kindCounts: { all: 251, image: 251, video: 0 },
  };
}

function metadata(id: string, favorite: boolean): WallpaperMediaRecord {
  return {
    id,
    source: "library",
    sourceUrl: null,
    license: null,
    licenseUrl: null,
    title: null,
    width: null,
    height: null,
    prompt: null,
    generation: null,
    parentId: null,
    favorite,
    purpose: "cache",
    bytes: 100,
    modifiedMs: 1,
  };
}

describe("useWallpaperLibrary", () => {
  it.each([false, true])(
    "keeps favorite edits when a pending page settles (failure: %s)",
    async (fails) => {
      let resolve!: (value: WallpaperLibraryPage) => void;
      let reject!: (reason: Error) => void;
      fetchPage
        .mockResolvedValueOnce(page("first", "cursor-1"))
        .mockReturnValueOnce(
          new Promise<WallpaperLibraryPage>((done, fail) => {
            resolve = done;
            reject = fail;
          }),
        );
      const { result } = renderHook(() =>
        useWallpaperLibrary(true, "", "all"),
      );
      await waitFor(() => expect(result.current.canLoadMore).toBe(true));

      let pending!: Promise<void>;
      act(() => {
        pending = result.current.loadMore();
      });
      act(() =>
        result.current.updateItem({
          ...result.current.items[0],
          metadata: metadata("first", true),
        }),
      );
      await act(async () => {
        if (fails) reject(new Error("timeout"));
        else resolve(page("second"));
        await pending;
      });

      expect(result.current.items[0].metadata?.favorite).toBe(true);
      expect(result.current.items).toHaveLength(fails ? 1 : 2);
      expect(result.current.error).toBe(fails ? "timeout" : null);
    },
  );

  it("keeps visible rows after expiry and renews the snapshot before paging", async () => {
    vi.useFakeTimers();
    fetchPage
      .mockResolvedValueOnce(page("first", "expired-cursor"))
      .mockResolvedValueOnce(page("fresh"));
    const { result, rerender } = renderHook(() =>
      useWallpaperLibrary(true, "", "all"),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(21 * 60_000);
    });
    rerender();
    expect(result.current.items[0].textPreview).toBe("first");
    await act(async () => {
      await result.current.loadMore();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.items[0].textPreview).toBe("fresh");
    expect(fetchPage.mock.calls).toEqual([
      [{ query: "", kind: "all" }],
      [{ query: "", kind: "all" }],
    ]);
  });

  it("resumes loaded pages and retries an interrupted page after returning", async () => {
    let resolve!: (value: WallpaperLibraryPage) => void;
    fetchPage
      .mockResolvedValueOnce(page("first", "cursor-1"))
      .mockResolvedValueOnce(page("second", "cursor-2"))
      .mockReturnValueOnce(
        new Promise<WallpaperLibraryPage>((done) => {
          resolve = done;
        }),
      )
      .mockResolvedValueOnce(page("third"));
    const { result, rerender } = renderHook(
      ({ enabled }) => useWallpaperLibrary(enabled, "", "all"),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.canLoadMore).toBe(true));
    await act(async () => result.current.loadMore());

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.loadMore();
    });
    rerender({ enabled: false });
    await act(async () => {
      resolve(page("stale"));
      await pending;
    });
    rerender({ enabled: true });

    expect(result.current.loadingMore).toBe(false);
    expect(result.current.items.map((item) => item.textPreview)).toEqual([
      "first",
      "second",
    ]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    await act(async () => result.current.loadMore());
    expect(fetchPage).toHaveBeenLastCalledWith(
      { query: "", kind: "all" },
      "cursor-2",
    );
    expect(result.current.items.map((item) => item.textPreview)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("isolates filters, removes cached items, and clears history on close", async () => {
    fetchPage
      .mockResolvedValueOnce(page("first"))
      .mockResolvedValueOnce(page("filtered"))
      .mockResolvedValueOnce(page("reopened"));
    const { result, rerender } = renderHook(
      ({ query, open }) => useWallpaperLibrary(open, query, "all", open),
      { initialProps: { query: "", open: true } },
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    const removedId = result.current.items[0].id;

    rerender({ query: "filtered", open: true });
    await waitFor(() =>
      expect(result.current.items[0]?.textPreview).toBe("filtered"),
    );
    act(() => result.current.remove(removedId));
    rerender({ query: "", open: true });
    expect(result.current.items).toHaveLength(0);
    expect(fetchPage).toHaveBeenCalledTimes(2);

    rerender({ query: "", open: false });
    rerender({ query: "", open: true });
    await waitFor(() =>
      expect(result.current.items[0]?.textPreview).toBe("reopened"),
    );
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("does not renew snapshot age when appending", async () => {
    vi.useFakeTimers();
    fetchPage
      .mockResolvedValueOnce(page("first", "cursor-1"))
      .mockResolvedValueOnce(page("second"))
      .mockResolvedValueOnce(page("fresh"));
    const { result, rerender } = renderHook(
      ({ enabled }) => useWallpaperLibrary(enabled, "", "all"),
      { initialProps: { enabled: true } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(19 * 60_000);
      await result.current.loadMore();
    });
    rerender({ enabled: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60_000);
    });
    rerender({ enabled: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.items[0].textPreview).toBe("fresh");
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("appends in host order and retries only the failed page", async () => {
    fetchPage
      .mockResolvedValueOnce(page("first", "cursor-1"))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(page("older"));
    const { result } = renderHook(() =>
      useWallpaperLibrary(true, "", "all"),
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(async () => result.current.loadMore());
    expect(result.current.error).toBe("timeout");
    expect(result.current.items[0].textPreview).toBe("first");
    expect(result.current.canLoadMore).toBe(true);
    await act(async () => result.current.loadMore());

    expect(result.current.items.map((item) => item.textPreview)).toEqual([
      "first",
      "older",
    ]);
    expect(fetchPage.mock.calls.slice(1)).toEqual([
      [{ query: "", kind: "all" }, "cursor-1"],
      [{ query: "", kind: "all" }, "cursor-1"],
    ]);
  });

  it("queries the complete collection and ignores a previous late response", async () => {
    let resolve!: (value: WallpaperLibraryPage) => void;
    fetchPage
      .mockReturnValueOnce(
        new Promise<WallpaperLibraryPage>((done) => {
          resolve = done;
        }),
      )
      .mockResolvedValueOnce(page("found-old-file"));
    const { result, rerender } = renderHook(
      ({ query }) => useWallpaperLibrary(true, query, "all"),
      { initialProps: { query: "" } },
    );
    await waitFor(() => expect(fetchPage).toHaveBeenCalledOnce());

    rerender({ query: "old-file" });
    await waitFor(() =>
      expect(result.current.items[0]?.textPreview).toBe("found-old-file"),
    );
    await act(async () => resolve(page("stale")));

    expect(result.current.items[0].textPreview).toBe("found-old-file");
    expect(fetchPage).toHaveBeenLastCalledWith({
      query: "old-file",
      kind: "all",
    });
  });

  it("invalidates an in-flight page on source switch", async () => {
    let resolve!: (value: WallpaperLibraryPage) => void;
    fetchPage
      .mockResolvedValueOnce(page("first", "cursor-1"))
      .mockReturnValueOnce(
        new Promise<WallpaperLibraryPage>((done) => {
          resolve = done;
        }),
      );
    const { result, rerender } = renderHook(
      ({ enabled }) => useWallpaperLibrary(enabled, "", "all"),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.canLoadMore).toBe(true));

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.loadMore();
    });
    rerender({ enabled: false });
    await act(async () => {
      resolve(page("late"));
      await pending;
    });

    expect(result.current.items.map((item) => item.textPreview)).toEqual([
      "first",
    ]);
  });
});

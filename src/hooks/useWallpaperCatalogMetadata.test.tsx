/** @vitest-environment jsdom */
import { useState } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WallpaperLibraryMatch } from "@/lib/api";
import type {
  WallpaperGalleryItem,
  WallpaperMediaRecord,
} from "@/lib/wallpaperSource";
import { useWallpaperCatalogMetadata } from "./useWallpaperCatalogMetadata";

const lookup = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ wallpaperLibraryLookup: lookup }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const item = (id: number): WallpaperGalleryItem => ({
  id: String(id),
  source: "openverse",
  fullUrl: `https://example.test/${id}.jpg`,
  thumbUrl: "",
  kind: "image",
});

const metadata: WallpaperMediaRecord = {
  id: "media-1",
  source: "openverse",
  sourceUrl: null,
  license: null,
  licenseUrl: null,
  title: null,
  width: 1920,
  height: 1080,
  prompt: null,
  generation: null,
  parentId: null,
  favorite: true,
  purpose: "cache",
  bytes: 100,
  modifiedMs: 1,
};

describe("useWallpaperCatalogMetadata", () => {
  it("hydrates bounded batches without reordering cards", async () => {
    lookup.mockImplementation(
      async (requests: Array<{ mediaUrl: string }>) => {
        const index = requests.findIndex(
          (request) => request.mediaUrl === item(95).fullUrl,
        );
        return index < 0
          ? []
          : [{ index, path: "C:/wallpapers/95.jpg", metadata }];
      },
    );
    const onError = vi.fn();
    const { result } = renderHook(() => {
      const [items, setItems] = useState(
        Array.from({ length: 110 }, (_, index) => item(index)),
      );
      useWallpaperCatalogMetadata(true, items, setItems, onError);
      return items;
    });

    await waitFor(() =>
      expect(result.current[95].metadata?.favorite).toBe(true),
    );
    expect(result.current.map((row) => row.id)).toEqual(
      Array.from({ length: 110 }, (_, index) => String(index)),
    );
    expect(result.current[95].width).toBe(1920);
    expect(
      lookup.mock.calls.every(([requests]) => requests.length <= 96),
    ).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it("ignores a late match after the source closes", async () => {
    let resolve!: (matches: WallpaperLibraryMatch[]) => void;
    lookup.mockReturnValue(
      new Promise<WallpaperLibraryMatch[]>((done) => {
        resolve = done;
      }),
    );
    const onError = vi.fn();
    const { result, rerender } = renderHook(
      ({ enabled }) => {
        const [items, setItems] = useState([item(0)]);
        useWallpaperCatalogMetadata(enabled, items, setItems, onError);
        return items;
      },
      { initialProps: { enabled: true } },
    );

    rerender({ enabled: false });
    await act(async () =>
      resolve([{ index: 0, path: "C:/private.jpg", metadata }]),
    );
    expect(result.current[0].localPath).toBeUndefined();
  });

  it("preserves a newer favorite while lookup is pending", async () => {
    let resolve!: (matches: WallpaperLibraryMatch[]) => void;
    lookup.mockReturnValue(
      new Promise<WallpaperLibraryMatch[]>((done) => {
        resolve = done;
      }),
    );
    const onError = vi.fn();
    const { result } = renderHook(() => {
      const [items, setItems] = useState([item(0)]);
      useWallpaperCatalogMetadata(true, items, setItems, onError);
      return { items, setItems };
    });

    act(() =>
      result.current.setItems([
        { ...item(0), metadata: { ...metadata, favorite: false } },
      ]),
    );
    await act(async () =>
      resolve([{ index: 0, path: "C:/old.jpg", metadata }]),
    );
    expect(result.current.items[0].metadata?.favorite).toBe(false);
  });
});

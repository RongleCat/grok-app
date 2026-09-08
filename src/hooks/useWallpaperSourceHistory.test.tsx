/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WallpaperGalleryItem } from "@/lib/wallpaperSource";
import {
  useWallpaperSourceHistory,
  type WallpaperSourceSnapshot,
} from "./useWallpaperSourceHistory";

const item = (
  id: string,
  source: WallpaperGalleryItem["source"] = "openverse",
): WallpaperGalleryItem => ({
  id,
  source,
  kind: "image",
  thumbUrl: `https://images.example.test/${id}.jpg`,
  fullUrl: `https://images.example.test/${id}.jpg`,
});

const snapshot = (
  items: WallpaperGalleryItem[] = [item("first")],
): WallpaperSourceSnapshot => ({
  query: "misty coast",
  sort: "top",
  items,
  selectedId: null,
  galleryFilter: "",
  kindFilter: "all",
  libraryPurpose: "all",
  hasSearched: true,
  statusHint: null,
  citeSummary: null,
  xContinuation: null,
  providerContinuation: null,
  scrollTop: 120,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useWallpaperSourceHistory", () => {
  it("keeps bounded source snapshots but never copies authenticated album rows", () => {
    const { result } = renderHook(() => useWallpaperSourceHistory());
    act(() => {
      result.current.save("openverse", snapshot());
      result.current.save("grok_album", snapshot([item("private-album")]));
    });

    expect(result.current.get("openverse")?.items).toHaveLength(1);
    expect(result.current.get("grok_album")?.items).toEqual([]);

    act(() => {
      result.current.save(
        "web",
        snapshot(Array.from({ length: 2_001 }, (_, index) => item(String(index)))),
      );
    });
    expect(result.current.get("web")).toBeNull();
  });

  it("expires old entries and updates restored catalog metadata in place", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { result } = renderHook(() => useWallpaperSourceHistory());
    const original = item("shared");
    act(() => result.current.save("openverse", snapshot([original])));

    const updated = {
      ...original,
      localPath: "C:/wallpapers/shared.jpg",
      width: 1600,
      height: 900,
      metadata: { favorite: true },
    } as WallpaperGalleryItem;
    act(() => result.current.updateItem(updated));
    expect(result.current.get("openverse")?.items[0]).toMatchObject({
      localPath: "C:/wallpapers/shared.jpg",
      width: 1600,
      height: 900,
      metadata: { favorite: true },
    });

    now.mockReturnValue(1_000 + 20 * 60 * 1_000 + 1);
    expect(result.current.get("openverse")).toBeNull();
  });

  it("does not update an unrelated source that reuses the same item id", () => {
    const { result } = renderHook(() => useWallpaperSourceHistory());
    act(() => {
      result.current.save("openverse", snapshot([item("shared", "openverse")]));
      result.current.save("pexels", snapshot([item("shared", "pexels")]));
      result.current.updateItem({
        ...item("shared", "openverse"),
        metadata: { favorite: true },
      } as WallpaperGalleryItem);
    });

    expect(result.current.get("openverse")?.items[0]?.metadata?.favorite).toBe(
      true,
    );
    expect(result.current.get("pexels")?.items[0]?.metadata).toBeUndefined();
  });
});

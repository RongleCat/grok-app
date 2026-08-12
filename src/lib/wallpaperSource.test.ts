import { describe, expect, it, vi } from "vitest";
import {
  dedupeGalleryItems,
  errorCodeFromSearchResult,
  fetchEntireMediaBlob,
  isStaticImageLibraryEntry,
  libraryEntriesToGalleryItems,
  libraryEntryToGalleryItem,
  MEDIA_PROTO_CHUNK,
  parseContentRangeTotal,
  parseWallpaperSourceError,
  resolveApplySource,
  sortLibraryEntriesStaticFirst,
  type WallpaperGalleryItem,
  type WallpaperLibraryEntry,
} from "./wallpaperSource";

function item(
  partial: Partial<WallpaperGalleryItem> & Pick<WallpaperGalleryItem, "id" | "fullUrl">,
): WallpaperGalleryItem {
  return {
    thumbUrl: partial.thumbUrl ?? partial.fullUrl,
    kind: partial.kind ?? "image",
    source: partial.source ?? "x",
    ...partial,
  };
}

describe("wallpaperSource", () => {
  it("parses host error codes", () => {
    expect(parseWallpaperSourceError("auth_required")).toBe("auth_required");
    expect(parseWallpaperSourceError(new Error("download_failed: HTTP 403"))).toBe(
      "download_failed",
    );
    expect(parseWallpaperSourceError("url_blocked")).toBe("url_blocked");
    expect(parseWallpaperSourceError("path_not_allowed")).toBe("url_blocked");
    expect(parseWallpaperSourceError("timeout")).toBe("timeout");
    expect(parseWallpaperSourceError("imagine_failed")).toBe("imagine_failed");
    expect(parseWallpaperSourceError("wallpaper_imagine: boom")).toBe(
      "imagine_failed",
    );
    expect(parseWallpaperSourceError("delete_failed: EPERM")).toBe("generic");
    expect(parseWallpaperSourceError("something else")).toBe("generic");
  });

  it("maps empty search results", () => {
    expect(
      errorCodeFromSearchResult({ items: [], errorCode: "auth_required" }),
    ).toBe("auth_required");
    expect(
      errorCodeFromSearchResult({ items: [], errorCode: "imagine_failed" }),
    ).toBe("imagine_failed");
    expect(
      errorCodeFromSearchResult({ items: [], errorCode: "timeout" }),
    ).toBe("timeout");
    expect(errorCodeFromSearchResult({ items: [], errorCode: null })).toBe("empty");
    expect(
      errorCodeFromSearchResult({
        items: [item({ id: "1", fullUrl: "https://pbs.twimg.com/a.jpg" })],
        errorCode: "empty",
      }),
    ).toBeNull();
  });

  it("dedupes by url / path", () => {
    const items = dedupeGalleryItems([
      item({ id: "1", fullUrl: "https://a/x.jpg" }),
      item({ id: "2", fullUrl: "https://a/x.jpg" }),
      item({ id: "3", fullUrl: "https://a/y.jpg", localPath: "/tmp/y.jpg" }),
      item({ id: "4", fullUrl: "file:///tmp/y.jpg", localPath: "/tmp/y.jpg" }),
    ]);
    expect(items.map((i) => i.id)).toEqual(["1", "3"]);
  });

  it("resolves apply source", () => {
    expect(
      resolveApplySource(
        item({ id: "1", fullUrl: "https://a/x.jpg", localPath: "/w/a.jpg" }),
      ),
    ).toEqual({ kind: "path", path: "/w/a.jpg" });
    expect(
      resolveApplySource(item({ id: "2", fullUrl: "file:///Users/me/a.jpg" })),
    ).toEqual({ kind: "path", path: "/Users/me/a.jpg" });
    expect(
      resolveApplySource(item({ id: "3", fullUrl: "https://pbs.twimg.com/a.jpg" })),
    ).toEqual({ kind: "url", url: "https://pbs.twimg.com/a.jpg" });
  });

  it("maps read_failed to download_failed", () => {
    expect(parseWallpaperSourceError(new Error("read_failed: HTTP 403"))).toBe(
      "download_failed",
    );
    expect(
      parseWallpaperSourceError(new Error("read_failed: short read (10/99 bytes)")),
    ).toBe("download_failed");
  });

  it("parses Content-Range totals", () => {
    expect(parseContentRangeTotal("bytes 0-0/4096")).toBe(4096);
    expect(parseContentRangeTotal("bytes 0-2097151/5000000")).toBe(5_000_000);
    expect(parseContentRangeTotal(null)).toBeNull();
    expect(parseContentRangeTotal("bytes */100")).toBeNull();
  });

  it("reassembles multi-chunk media:// style responses", async () => {
    // Use a small synthetic chunk size so the suite stays fast under load
    // (production path still defaults to MEDIA_PROTO_CHUNK = 2 MiB).
    const chunk = 4096;
    const total = chunk + 1234;
    const bytes = new Uint8Array(total);
    for (let i = 0; i < total; i++) bytes[i] = i % 251;

    const fetchImpl: typeof fetch = async (_input, init) => {
      const headers = init?.headers;
      let range: string | undefined;
      if (headers instanceof Headers) {
        range = headers.get("Range") ?? undefined;
      } else if (Array.isArray(headers)) {
        range = headers.find(([k]) => k.toLowerCase() === "range")?.[1];
      } else if (headers && typeof headers === "object") {
        range = (headers as Record<string, string>).Range;
      }
      if (!range) {
        // Bare GET would only return first chunk (the bug we avoid)
        return new Response(bytes.slice(0, chunk), {
          status: 206,
          headers: {
            "Content-Range": `bytes 0-${chunk - 1}/${total}`,
            "Content-Type": "image/png",
          },
        });
      }
      const m = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (!m) return new Response(null, { status: 400 });
      const start = Number(m[1]);
      const end = Number(m[2]);
      const slice = bytes.slice(start, end + 1);
      return new Response(slice, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Content-Type": "image/png",
          "Content-Length": String(slice.length),
        },
      });
    };

    const spy = vi.fn(fetchImpl);
    const blob = await fetchEntireMediaBlob("media://localhost/x.png", spy, {
      chunkSize: chunk,
    });
    expect(blob.size).toBe(total);
    const out = new Uint8Array(await blob.arrayBuffer());
    expect(out).toEqual(bytes);
    // Every request must carry a Range header (no truncated bare GET body).
    expect(spy).toHaveBeenCalled();
    for (const call of spy.mock.calls) {
      const headers = call[1]?.headers as Record<string, string> | undefined;
      expect(headers?.Range).toMatch(/^bytes=\d+-\d+$/);
    }
    // multi-chunk path used more than probe+one full read
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(3);
    // production default remains 2 MiB
    expect(MEDIA_PROTO_CHUNK).toBe(2 * 1024 * 1024);
  });

  it("maps library entries to gallery items (static first)", () => {
    const entries: WallpaperLibraryEntry[] = [
      {
        path: "/w/imagine/2026-08-01/b.mp4",
        name: "b.mp4",
        source: "imagine",
        kind: "video",
        bytes: 10,
        modifiedMs: 200,
      },
      {
        path: "/w/x/2026-08-01/a.jpg",
        name: "a.jpg",
        source: "x",
        kind: "image",
        bytes: 5,
        modifiedMs: 100,
      },
      {
        path: "/w/imagine/2026-08-01/c.png",
        name: "c.png",
        source: "imagine",
        kind: "image",
        bytes: 8,
        modifiedMs: 300,
      },
    ];
    expect(isStaticImageLibraryEntry(entries[0]!)).toBe(false);
    expect(isStaticImageLibraryEntry(entries[1]!)).toBe(true);

    const sorted = sortLibraryEntriesStaticFirst(entries);
    expect(sorted.map((e) => e.name)).toEqual(["c.png", "a.jpg", "b.mp4"]);

    const imagesOnly = sortLibraryEntriesStaticFirst(entries, {
      imagesOnly: true,
    });
    expect(imagesOnly.map((e) => e.name)).toEqual(["c.png", "a.jpg"]);

    const items = libraryEntriesToGalleryItems(entries);
    expect(items.map((i) => i.localPath)).toEqual([
      "/w/imagine/2026-08-01/c.png",
      "/w/x/2026-08-01/a.jpg",
      "/w/imagine/2026-08-01/b.mp4",
    ]);
    expect(items[0]!.source).toBe("imagine");
    expect(items[0]!.kind).toBe("image");
    expect(items[2]!.kind).toBe("video");

    const one = libraryEntryToGalleryItem(entries[1]!);
    expect(one.localPath).toBe("/w/x/2026-08-01/a.jpg");
    expect(one.fullUrl).toBe("file:///w/x/2026-08-01/a.jpg");
  });
});

import { describe, expect, it } from "vitest";
import {
  grokAlbumItemsToGallery,
  isGrokAlbumMediaUrl,
  nextGrokAlbumVisibleCount,
  parseGrokAlbumError,
  resolveGrokAlbumEmptyPresentation,
} from "./grokAlbum";

describe("Grok saved album bridge", () => {
  it("accepts generated assets only", () => {
    expect(
      isGrokAlbumMediaUrl(
        "https://assets.grok.com/users/test/generated/fake/image.jpg",
      ),
    ).toBe(true);
    expect(
      isGrokAlbumMediaUrl("https://assets.grok.com/users/test/avatar.jpg"),
    ).toBe(false);
    expect(
      isGrokAlbumMediaUrl(
        "https://assets.grok.com.evil.example/users/test/generated/x.jpg",
      ),
    ).toBe(false);
  });

  it("maps and deduplicates allowlisted media without exposing post ids", () => {
    const mediaUrl =
      "https://assets.grok.com/users/test/generated/fake/image.jpg";
    const items = grokAlbumItemsToGallery([
      {
        mediaUrl,
        kind: "image",
        width: 1920,
        height: 1080,
        postId: "private-looking-id",
      },
      { mediaUrl, kind: "image" },
      { mediaUrl: "https://evil.example/generated/x.jpg", kind: "image" },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      source: "grok_album",
      width: 1920,
      height: 1080,
      postUrl: null,
    });
    expect(JSON.stringify(items[0])).not.toContain("private-looking-id");
  });

  it("reveals cached pages in stable batches", () => {
    expect(nextGrokAlbumVisibleCount({ current: 20, available: 60 })).toBe(40);
    expect(nextGrokAlbumVisibleCount({ current: 40, available: 47 })).toBe(47);
  });

  it("keeps non-ready album states honest instead of reporting no results", () => {
    const base = {
      kind: "empty" as const,
      titleKey: "settings.wallpaperSource.empty.noResults",
      hintKey: "settings.wallpaperSource.empty.noResultsHint",
      showClearFilters: false,
      softFail: true,
    };
    expect(resolveGrokAlbumEmptyPresentation(base, "verification")).toMatchObject({
      kind: "idle",
      titleKey: "settings.wallpaperSource.grokAlbum.status.verification",
      hintKey: "settings.wallpaperSource.grokAlbum.emptyHint",
    });
    expect(resolveGrokAlbumEmptyPresentation(base, "sign_in")).toMatchObject({
      kind: "idle",
      titleKey: "settings.wallpaperSource.grokAlbum.status.sign_in",
      hintKey: "settings.wallpaperSource.grokAlbum.emptySignInHint",
    });
  });

  it("reports a true empty result only after the album is ready", () => {
    const resolved = resolveGrokAlbumEmptyPresentation(
      {
        kind: "empty",
        titleKey: "unused",
        hintKey: null,
        showClearFilters: false,
        softFail: true,
      },
      "ready",
    );
    expect(resolved).toMatchObject({
      kind: "empty",
      titleKey: "settings.wallpaperSource.empty.noResults",
      hintKey: "settings.wallpaperSource.grokAlbum.emptyHint",
    });
  });

  it("normalizes Host errors without echoing details", () => {
    expect(parseGrokAlbumError("album_bridge_timeout: detail")).toBe("timeout");
    expect(parseGrokAlbumError("album_proxy_unsupported: secret detail")).toBe(
      "proxy",
    );
    expect(parseGrokAlbumError("album_window_unavailable")).toBe("window");
  });
});

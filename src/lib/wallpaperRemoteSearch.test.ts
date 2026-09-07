import { describe, expect, it } from "vitest";
import {
  createWallpaperRemoteSearchRequestId,
  isWallpaperRemoteSearchBatch,
  isWallpaperRemoteSearchProgress,
  isWallpaperRemoteSource,
  wallpaperRemoteProgressMessageKey,
  wallpaperRemoteUiError,
} from "./wallpaperRemoteSearch";

describe("wallpaper remote search contract", () => {
  it("strictly enumerates independent remote sources", () => {
    expect(isWallpaperRemoteSource("web")).toBe(true);
    expect(isWallpaperRemoteSource("openverse")).toBe(true);
    expect(isWallpaperRemoteSource("pexels")).toBe(true);
    expect(isWallpaperRemoteSource("x")).toBe(false);
    expect(isWallpaperRemoteSource("https://example.test")).toBe(false);
  });

  it("accepts only matching source progress and batches", () => {
    const requestId = createWallpaperRemoteSearchRequestId();
    expect(
      isWallpaperRemoteSearchProgress({
        requestId,
        source: "web",
        stage: "fetching_sources",
      }),
    ).toBe(true);
    expect(
      isWallpaperRemoteSearchProgress({
        requestId,
        source: "web",
        stage: "searching_x",
      }),
    ).toBe(false);

    const item = {
      id: "web-image",
      thumbUrl: "https://images.example.test/thumb.jpg",
      fullUrl: "https://images.example.test/full.jpg",
      kind: "image",
      source: "web",
      sourceUrl: "https://example.test/photo",
      sourceName: "example.test",
    };
    expect(
      isWallpaperRemoteSearchBatch({
        requestId,
        source: "web",
        batchIndex: 1,
        items: [item],
        accumulatedCount: 1,
        done: false,
      }),
    ).toBe(true);
    expect(
      isWallpaperRemoteSearchBatch({
        requestId,
        source: "openverse",
        batchIndex: 1,
        items: [item],
        accumulatedCount: 1,
        done: true,
      }),
    ).toBe(false);
  });

  it("maps stable Host errors without exposing protocol details", () => {
    const result = {
      source: "web" as const,
      items: [],
      hasMore: false,
      cacheHit: false,
      durationMs: 1,
    };
    expect(
      wallpaperRemoteUiError({ ...result, errorCode: "oauth_expired" }),
    ).toBe("auth_required");
    expect(
      wallpaperRemoteUiError({
        ...result,
        errorCode: "responses_rate_limited",
      }),
    ).toBe("rate_limited");
    expect(
      wallpaperRemoteUiError({ ...result, errorCode: "responses_network" }),
    ).toBe("search_failed");
    expect(
      wallpaperRemoteUiError({ ...result, errorCode: "pexels_key_missing" }),
    ).toBe("pexels_key_required");
    expect(
      wallpaperRemoteUiError({ ...result, errorCode: "pexels_key_invalid" }),
    ).toBe("pexels_key_invalid");
    expect(
      wallpaperRemoteUiError({
        ...result,
        errorCode: "responses_tool_budget_exceeded",
      }),
    ).toBe("service_unavailable");
    expect(
      wallpaperRemoteUiError({ ...result, errorCode: "responses_protocol" }),
    ).toBe("service_unavailable");
    expect(wallpaperRemoteUiError({ ...result, errorCode: "empty" })).toBe(
      "empty",
    );
    expect(
      wallpaperRemoteUiError({
        ...result,
        items: [
          {
            id: "one",
            thumbUrl: "https://images.example.test/one.jpg",
            fullUrl: "https://images.example.test/one.jpg",
            kind: "image",
            source: "web",
          },
        ],
        errorCode: "responses_network",
      }),
    ).toBeNull();
  });

  it("maps only visible progress stages to copy", () => {
    expect(wallpaperRemoteProgressMessageKey("searching_web")).toBe(
      "settings.wallpaperSource.remote.progress.searchingWeb",
    );
    expect(wallpaperRemoteProgressMessageKey("done")).toBeNull();
  });
});

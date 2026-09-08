import { describe, expect, it } from "vitest";
import {
  createWallpaperXSearchRequestId,
  DEFAULT_WALLPAPER_X_SEARCH_MODE,
  isWallpaperXSearchBatch,
  isWallpaperXSearchProgress,
  normalizeWallpaperXSearchMode,
  wallpaperXSearchFallbackReasonKey,
  wallpaperXSearchProgressMessageKey,
  wallpaperXSearchRouteSummary,
  WALLPAPER_X_SEARCH_MODES,
} from "./wallpaperXSearch";

describe("wallpaper X search settings contract", () => {
  it("keeps CLI as the safe default", () => {
    expect(DEFAULT_WALLPAPER_X_SEARCH_MODE).toBe("cli");
    expect(WALLPAPER_X_SEARCH_MODES).toEqual([
      "cli",
      "responses_preview",
      "auto",
    ]);
    for (const raw of [undefined, null, "", "responses", "future", 1]) {
      expect(normalizeWallpaperXSearchMode(raw)).toBe("cli");
    }
    expect(normalizeWallpaperXSearchMode("responses_preview")).toBe(
      "responses_preview",
    );
    expect(normalizeWallpaperXSearchMode("auto")).toBe("auto");
  });

  it("describes the actual route instead of the requested route", () => {
    expect(
      wallpaperXSearchRouteSummary({
        requestedMode: "responses_preview",
        routeUsed: "responses",
        durationMs: 12_345,
        cacheHit: false,
      }),
    ).toEqual({
      key: "settings.wallpaperSource.route.responses",
      seconds: "12.3",
      cacheHit: false,
    });

    expect(
      wallpaperXSearchRouteSummary({
        requestedMode: "responses_preview",
        routeUsed: "cli",
        fallbackReason: "oauth_expired",
        durationMs: 987,
        cacheHit: false,
      }),
    ).toEqual({
      key: "settings.wallpaperSource.route.fallback",
      seconds: "1.0",
      reasonKey: "settings.wallpaperSource.route.fallback.auth",
      cacheHit: false,
    });
  });

  it("reports Responses, CLI, and total fallback timings", () => {
    expect(
      wallpaperXSearchRouteSummary({
        requestedMode: "responses_preview",
        routeUsed: "cli",
        fallbackReason: "responses_network",
        durationMs: 84_900,
        responsesDurationMs: 18_400,
        cliDurationMs: 66_500,
        cacheHit: false,
      }),
    ).toEqual({
      key: "settings.wallpaperSource.route.fallbackTimed",
      seconds: "84.9",
      responsesSeconds: "18.4",
      cliSeconds: "66.5",
      reasonKey: "settings.wallpaperSource.route.fallback.network",
      cacheHit: false,
    });
  });

  it("falls back to total-only copy for invalid split timings and cache hits", () => {
    expect(
      wallpaperXSearchRouteSummary({
        routeUsed: "cli",
        fallbackReason: "responses_network",
        durationMs: 900,
        responsesDurationMs: Number.NaN,
        cliDurationMs: -1,
        cacheHit: false,
      }),
    ).toMatchObject({
      key: "settings.wallpaperSource.route.fallback",
      seconds: "0.9",
    });
    expect(
      wallpaperXSearchRouteSummary({
        routeUsed: "cli",
        fallbackReason: "responses_network",
        durationMs: 1,
        responsesDurationMs: 10,
        cliDurationMs: 20,
        cacheHit: true,
      }),
    ).toMatchObject({
      key: "settings.wallpaperSource.route.fallback",
      cacheHit: true,
    });
  });

  it("groups known fallback codes and keeps unknown codes honest", () => {
    expect(wallpaperXSearchFallbackReasonKey("responses_timeout")).toBe(
      "settings.wallpaperSource.route.fallback.network",
    );
    expect(wallpaperXSearchFallbackReasonKey("responses_protocol")).toBe(
      "settings.wallpaperSource.route.fallback.compatibility",
    );
    expect(wallpaperXSearchFallbackReasonKey("responses_circuit_open")).toBe(
      "settings.wallpaperSource.route.fallback.circuit",
    );
    expect(wallpaperXSearchFallbackReasonKey("future_reason")).toBe(
      "settings.wallpaperSource.route.fallback.other",
    );
  });

  it("rejects absent or invalid route metadata", () => {
    expect(wallpaperXSearchRouteSummary(undefined)).toBeNull();
    expect(
      wallpaperXSearchRouteSummary({
        routeUsed: "cli",
        durationMs: Number.NaN,
      }),
    ).toBeNull();
  });

  it("creates UUID request ids and validates request-owned events", () => {
    const requestId = createWallpaperXSearchRequestId();
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(
      isWallpaperXSearchProgress({ requestId, stage: "validating" }),
    ).toBe(true);
    expect(
      isWallpaperXSearchProgress({ requestId, stage: "invented" }),
    ).toBe(false);

    const item = {
      id: "image-1",
      thumbUrl: "https://example.test/thumb.jpg",
      fullUrl: "https://example.test/full.jpg",
      kind: "image",
      source: "x",
    };
    expect(
      isWallpaperXSearchBatch({
        requestId,
        batchIndex: 1,
        items: [item],
        accumulatedCount: 1,
        done: false,
      }),
    ).toBe(true);
    expect(
      isWallpaperXSearchBatch({
        requestId,
        batchIndex: 0,
        items: [item],
        accumulatedCount: 1,
        done: false,
      }),
    ).toBe(false);
  });

  it("maps only visible progress stages to localized copy", () => {
    expect(wallpaperXSearchProgressMessageKey("preparing")).toBe(
      "settings.wallpaperSource.progress.preparing",
    );
    expect(wallpaperXSearchProgressMessageKey("searching_x")).toBe(
      "settings.wallpaperSource.searching",
    );
    expect(wallpaperXSearchProgressMessageKey("done")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  countWallpaperXCitations,
  extractXStatusId,
  isCanonicalXStatusUrl,
  loadWallpaperXEvidenceRing,
  normalizeXStatusUrl,
  parseWallpaperXEvidencePick,
  parseWallpaperXEvidenceRing,
  pushWallpaperXEvidence,
  recordWallpaperXEvidencePick,
  resolveWallpaperXCitation,
  wallpaperXEvidenceFromGalleryItem,
  wallpaperXSearchCitationSummaryKey,
  type WallpaperXEvidencePick,
  type WallpaperXEvidenceStorage,
} from "./xEvidenceCitation";

function memStorage(seed?: string): WallpaperXEvidenceStorage {
  let raw: string | null = seed ?? null;
  return {
    getItem: () => raw,
    setItem: (_k, v) => {
      raw = v;
    },
  };
}

describe("extractXStatusId / isCanonicalXStatusUrl", () => {
  it("extracts snowflake ids from x.com and twitter.com status URLs", () => {
    expect(
      extractXStatusId("https://x.com/elonmusk/status/1234567890123456789"),
    ).toBe("1234567890123456789");
    expect(
      extractXStatusId("https://twitter.com/foo/status/9876543210987654321?s=20"),
    ).toBe("9876543210987654321");
    expect(extractXStatusId("https://x.com/i/status/1234567890123456789")).toBe(
      "1234567890123456789",
    );
    expect(extractXStatusId("1234567890123456789")).toBe("1234567890123456789");
  });

  it("rejects CDN media, profiles, short ids, and empty", () => {
    expect(extractXStatusId("https://pbs.twimg.com/media/ABC.jpg")).toBeNull();
    expect(extractXStatusId("https://x.com/elonmusk")).toBeNull();
    expect(extractXStatusId("https://x.com/search?q=foo")).toBeNull();
    expect(extractXStatusId("1234567")).toBeNull(); // too short
    expect(extractXStatusId("")).toBeNull();
    expect(extractXStatusId(null)).toBeNull();
  });

  it("isCanonicalXStatusUrl requires status path on x/twitter host", () => {
    expect(
      isCanonicalXStatusUrl("https://x.com/user/status/1234567890123456789"),
    ).toBe(true);
    expect(isCanonicalXStatusUrl("https://pbs.twimg.com/media/x.jpg")).toBe(false);
    expect(isCanonicalXStatusUrl("https://example.com/status/1234567890123456789")).toBe(
      false,
    );
    expect(isCanonicalXStatusUrl("not a url")).toBe(false);
  });
});

describe("normalizeXStatusUrl", () => {
  it("canonicalizes to https://x.com/<user>/status/<id>", () => {
    expect(
      normalizeXStatusUrl(
        "https://twitter.com/FooBar/status/1234567890123456789?s=20",
      ),
    ).toBe("https://x.com/FooBar/status/1234567890123456789");
    // /i/status/… — fill handle from username when path is the anonymous form
    expect(
      normalizeXStatusUrl("https://x.com/i/status/1234567890123456789", "alice"),
    ).toBe("https://x.com/alice/status/1234567890123456789");
    expect(normalizeXStatusUrl("https://x.com/i/status/1234567890123456789")).toBe(
      "https://x.com/i/status/1234567890123456789",
    );
    expect(normalizeXStatusUrl("1234567890123456789", "@bob")).toBe(
      "https://x.com/bob/status/1234567890123456789",
    );
  });

  it("never invents a status id", () => {
    expect(normalizeXStatusUrl("https://pbs.twimg.com/media/x.jpg", "u")).toBeNull();
    expect(normalizeXStatusUrl("https://x.com/alice", "alice")).toBeNull();
  });
});

describe("resolveWallpaperXCitation", () => {
  it("marks verified when postUrl is a real status link", () => {
    const c = resolveWallpaperXCitation({
      source: "x",
      username: "alice",
      postUrl: "https://x.com/alice/status/1234567890123456789",
      fullUrl: "https://pbs.twimg.com/media/ABC.jpg",
    });
    expect(c.state).toBe("verified");
    expect(c.statusId).toBe("1234567890123456789");
    expect(c.statusUrl).toBe("https://x.com/alice/status/1234567890123456789");
    expect(c.labelKey).toBe("settings.wallpaperSource.cite.verified");
  });

  it("marks unverified when only CDN media is present", () => {
    const c = resolveWallpaperXCitation({
      source: "x",
      username: "alice",
      postUrl: null,
      fullUrl: "https://pbs.twimg.com/media/ABC.jpg",
    });
    expect(c.state).toBe("unverified");
    expect(c.statusUrl).toBeNull();
    expect(c.labelKey).toBe("settings.wallpaperSource.cite.unverified");
  });

  it("does not treat invent-looking non-status postUrl as verified", () => {
    const c = resolveWallpaperXCitation({
      source: "x",
      postUrl: "https://x.com/alice",
      fullUrl: "https://pbs.twimg.com/media/ABC.jpg",
    });
    expect(c.state).toBe("unverified");
  });

  it("labels imagine / library as not-X", () => {
    expect(
      resolveWallpaperXCitation({ source: "imagine", fullUrl: "file:///a.png" })
        .labelKey,
    ).toBe("settings.wallpaperSource.cite.notX");
  });
});

describe("count + summary", () => {
  it("counts only x-sourced items", () => {
    const counts = countWallpaperXCitations([
      {
        source: "x",
        postUrl: "https://x.com/a/status/1234567890123456789",
      },
      { source: "x", postUrl: null, fullUrl: "https://pbs.twimg.com/m.jpg" },
      { source: "imagine", fullUrl: "file:///x.png" },
    ]);
    expect(counts).toEqual({ total: 2, verified: 1, unverified: 1 });
  });

  it("soft-fail summary keys for empty / mixed / all states", () => {
    expect(
      wallpaperXSearchCitationSummaryKey({
        itemCount: 0,
        verified: 0,
        unverified: 0,
        errorCode: "empty",
      }),
    ).toBe("settings.wallpaperSource.cite.summaryEmpty");
    expect(
      wallpaperXSearchCitationSummaryKey({
        itemCount: 3,
        verified: 0,
        unverified: 3,
      }),
    ).toBe("settings.wallpaperSource.cite.summaryAllUnverified");
    expect(
      wallpaperXSearchCitationSummaryKey({
        itemCount: 3,
        verified: 2,
        unverified: 1,
      }),
    ).toBe("settings.wallpaperSource.cite.summaryMixed");
    expect(
      wallpaperXSearchCitationSummaryKey({
        itemCount: 2,
        verified: 2,
        unverified: 0,
      }),
    ).toBe("settings.wallpaperSource.cite.summaryAllVerified");
  });
});

describe("local wallpaper X evidence ring", () => {
  const sample = (partial: Partial<WallpaperXEvidencePick>): WallpaperXEvidencePick => ({
    path: partial.path ?? "/wallpapers/x/a.jpg",
    postUrl: partial.postUrl ?? "https://x.com/a/status/1234567890123456789",
    statusId: partial.statusId ?? "1234567890123456789",
    username: partial.username ?? "a",
    mediaUrl: partial.mediaUrl ?? "https://pbs.twimg.com/media/a.jpg",
    verified: partial.verified ?? true,
    at: partial.at ?? "2026-08-12T00:00:00.000Z",
  });

  it("parses picks and rejects pathless rows", () => {
    expect(
      parseWallpaperXEvidencePick({
        path: "/w/a.jpg",
        postUrl: "https://x.com/a/status/1234567890123456789",
        verified: true,
      })?.verified,
    ).toBe(true);
    expect(parseWallpaperXEvidencePick({ postUrl: "https://x.com/a/status/1" })).toBeNull();
    // CDN-only → stored but unverified
    const u = parseWallpaperXEvidencePick({
      path: "/w/b.jpg",
      mediaUrl: "https://pbs.twimg.com/media/b.jpg",
      verified: true, // claim ignored without status url
    });
    expect(u?.verified).toBe(false);
  });

  it("ring push newest-first with path dedupe", () => {
    const a = sample({ path: "/a.jpg", at: "2026-01-01T00:00:00.000Z" });
    const b = sample({
      path: "/b.jpg",
      postUrl: "https://x.com/b/status/9876543210987654321",
      statusId: "9876543210987654321",
      at: "2026-01-02T00:00:00.000Z",
    });
    const a2 = sample({
      path: "/a.jpg",
      at: "2026-01-03T00:00:00.000Z",
    });
    let ring = pushWallpaperXEvidence([], a, 10);
    ring = pushWallpaperXEvidence(ring, b, 10);
    ring = pushWallpaperXEvidence(ring, a2, 10);
    expect(ring.map((e) => e.path)).toEqual(["/a.jpg", "/b.jpg"]);
    expect(ring[0]?.at).toBe("2026-01-03T00:00:00.000Z");
  });

  it("parseWallpaperXEvidenceRing tolerates corrupt storage", () => {
    expect(parseWallpaperXEvidenceRing("not-json")).toEqual([]);
    expect(parseWallpaperXEvidenceRing(null)).toEqual([]);
    expect(
      parseWallpaperXEvidenceRing(
        JSON.stringify([
          sample({ path: "/ok.jpg" }),
          { nope: true },
          sample({ path: "/ok2.jpg" }),
        ]),
      ).map((e) => e.path),
    ).toEqual(["/ok.jpg", "/ok2.jpg"]);
  });

  it("wallpaperXEvidenceFromGalleryItem builds pick from gallery + path", () => {
    const pick = wallpaperXEvidenceFromGalleryItem(
      {
        source: "x",
        username: "alice",
        postUrl: "https://x.com/alice/status/1234567890123456789",
        fullUrl: "https://pbs.twimg.com/media/x.jpg",
      },
      "/wallpapers/x/2026-08-12/x.jpg",
      "2026-08-12T12:00:00.000Z",
    );
    expect(pick).toEqual({
      path: "/wallpapers/x/2026-08-12/x.jpg",
      postUrl: "https://x.com/alice/status/1234567890123456789",
      statusId: "1234567890123456789",
      username: "alice",
      mediaUrl: "https://pbs.twimg.com/media/x.jpg",
      verified: true,
      at: "2026-08-12T12:00:00.000Z",
    });
    expect(
      wallpaperXEvidenceFromGalleryItem(
        { source: "x", fullUrl: "https://pbs.twimg.com/media/x.jpg" },
        "",
      ),
    ).toBeNull();
  });

  it("recordWallpaperXEvidencePick soft-fails storage errors", () => {
    const store = memStorage();
    const pick = sample({ path: "/w/c.jpg" });
    const ring = recordWallpaperXEvidencePick(pick, store);
    expect(ring).toHaveLength(1);
    expect(loadWallpaperXEvidenceRing(store)).toHaveLength(1);

    const boom: WallpaperXEvidenceStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    // setItem throws — returns prior load (empty when getItem is null)
    expect(recordWallpaperXEvidencePick(pick, boom)).toEqual([]);
  });
});

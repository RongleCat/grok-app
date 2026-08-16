import { describe, expect, it } from "vitest";
import {
  classifyMediaLoadError,
  classifyMediaSrcFailure,
  deriveMediaLoadPhase,
  formatMediaLoadErrorMessage,
  isSafeLocalMediaUrl,
  mediaLoadErrorLabelMap,
  mediaLoadErrorMessageKey,
  mediaLoadPhaseMessageKey,
  mediaUrlPathParam,
  resolveMediaLoadError,
  resolveMediaSrcFailure,
  shouldApplyChatImageLoadError,
  nextLocalMediaRetryMs,
  shouldRetryLocalMediaFailure,
} from "./mediaLoadPro";

describe("classifyMediaLoadError", () => {
  it("classifies missing path / 404", () => {
    expect(classifyMediaLoadError("file not found")).toBe("missing_path");
    expect(classifyMediaLoadError("failed to load file (404)")).toBe(
      "missing_path",
    );
    expect(classifyMediaLoadError({ code: "enoent" })).toBe("missing_path");
    expect(classifyMediaLoadError({ status: 404 })).toBe("missing_path");
  });

  it("classifies untrusted / path not allowed", () => {
    expect(classifyMediaLoadError("path not allowed")).toBe("untrusted");
    expect(classifyMediaLoadError("unauthorized")).toBe("untrusted");
    expect(classifyMediaLoadError({ status: 403 })).toBe("untrusted");
    expect(classifyMediaLoadError({ code: "untrusted" })).toBe("untrusted");
  });

  it("classifies host-only", () => {
    expect(classifyMediaLoadError("need tauri")).toBe("host_only");
    expect(classifyMediaLoadError("desktop only")).toBe("host_only");
    expect(classifyMediaLoadError({ code: "host_only" })).toBe("host_only");
  });

  it("classifies broken blob / decode", () => {
    expect(classifyMediaLoadError("decode")).toBe("broken_blob");
    expect(classifyMediaLoadError("corrupt image data")).toBe("broken_blob");
    expect(classifyMediaLoadError({ code: "broken_blob" })).toBe("broken_blob");
  });

  it("classifies timeout", () => {
    expect(classifyMediaLoadError("timeout")).toBe("timeout");
    expect(classifyMediaLoadError("request timed out")).toBe("timeout");
    expect(classifyMediaLoadError({ status: 504 })).toBe("timeout");
  });

  it("classifies files that exceed the preview budget", () => {
    expect(classifyMediaLoadError("file too large for in-app pdf preview")).toBe(
      "too_large",
    );
    expect(classifyMediaLoadError({ status: 413 })).toBe("too_large");
    expect(classifyMediaLoadError({ code: "payload_too_large" })).toBe(
      "too_large",
    );
  });

  it("classifies unsupported type", () => {
    expect(classifyMediaLoadError("unsupported")).toBe("unsupported_type");
    expect(classifyMediaLoadError("format has no in-app preview")).toBe(
      "unsupported_type",
    );
    expect(classifyMediaLoadError({ status: 415 })).toBe("unsupported_type");
  });

  it("classifies media server unavailable", () => {
    expect(classifyMediaLoadError("cannot resolve local file URL")).toBe(
      "media_server_unavailable",
    );
    expect(classifyMediaLoadError("connection refused")).toBe(
      "media_server_unavailable",
    );
    expect(classifyMediaLoadError("network")).toBe("media_server_unavailable");
    expect(classifyMediaLoadError({ code: "no_endpoint" })).toBe(
      "media_server_unavailable",
    );
  });

  it("falls back to other for unknown text", () => {
    expect(classifyMediaLoadError("something weird happened")).toBe("other");
    expect(classifyMediaLoadError(null)).toBe("other");
  });
});

describe("classifyMediaSrcFailure", () => {
  it("missing when exists is false or path empty", () => {
    expect(
      classifyMediaSrcFailure({ pathOrUrl: "/a.png", exists: false }),
    ).toBe("missing_path");
    expect(classifyMediaSrcFailure({ pathOrUrl: "" })).toBe("missing_path");
  });

  it("host-only outside Tauri for absolute paths", () => {
    expect(
      classifyMediaSrcFailure({
        pathOrUrl: "/Users/me/pic.png",
        isTauri: false,
        resolvedSrc: null,
      }),
    ).toBe("host_only");
  });

  it("media server unavailable when endpoint not ready in Tauri", () => {
    expect(
      classifyMediaSrcFailure({
        pathOrUrl: "/Users/me/pic.png",
        isTauri: true,
        mediaEndpointReady: false,
        resolvedSrc: null,
      }),
    ).toBe("media_server_unavailable");
  });

  it("broken blob after loadFailed with src", () => {
    expect(
      classifyMediaSrcFailure({
        pathOrUrl: "/Users/me/pic.png",
        resolvedSrc: "http://127.0.0.1:9/v1/media?t=x&p=y",
        loadFailed: true,
      }),
    ).toBe("broken_blob");
    expect(
      classifyMediaSrcFailure({
        pathOrUrl: "clip",
        resolvedSrc: "blob:http://localhost/1",
        loadFailed: true,
      }),
    ).toBe("broken_blob");
  });

  it("shouldApplyChatImageLoadError ignores abort leftover from a src swap", () => {
    const remote = "https://gbres.example/chart.png";
    const thumb = "http://127.0.0.1:9/v1/media?t=tok&p=%2Ftmp%2Ft.jpg";
    expect(
      shouldApplyChatImageLoadError({
        failedSrc: remote,
        paintedSrc: thumb,
      }),
    ).toBe(false);
    expect(
      shouldApplyChatImageLoadError({
        failedSrc: remote,
        paintedSrc: remote,
        mediaElementError: "aborted",
      }),
    ).toBe(false);
    expect(
      shouldApplyChatImageLoadError({
        failedSrc: thumb,
        paintedSrc: thumb,
      }),
    ).toBe(true);
  });

  it("broken blob for remote http image decode failures (not allowlist)", () => {
    expect(
      classifyMediaSrcFailure({
        pathOrUrl: "https://cdn.example/a.png",
        resolvedSrc: "https://cdn.example/a.png",
        loadFailed: true,
      }),
    ).toBe("broken_blob");
  });

  it("uses media element error codes", () => {
    expect(
      classifyMediaSrcFailure({
        pathOrUrl: "/a.mp4",
        resolvedSrc: "http://127.0.0.1:1/v1/media",
        mediaElementError: "timeout",
      }),
    ).toBe("timeout");
    expect(
      classifyMediaSrcFailure({
        pathOrUrl: "/a.mp4",
        mediaElementError: "unsupported",
      }),
    ).toBe("unsupported_type");
  });
});

describe("isSafeLocalMediaUrl", () => {
  it("accepts loopback media HTTP, media://, data, blob", () => {
    expect(
      isSafeLocalMediaUrl("http://127.0.0.1:34567/v1/media?t=x&p=y"),
    ).toBe(true);
    expect(isSafeLocalMediaUrl("http://localhost:9/v1/media")).toBe(true);
    expect(isSafeLocalMediaUrl("media://localhost/foo")).toBe(true);
    expect(isSafeLocalMediaUrl("data:image/png;base64,xx")).toBe(true);
    expect(isSafeLocalMediaUrl("blob:http://localhost/1")).toBe(true);
  });

  it("rejects non-local hosts", () => {
    expect(isSafeLocalMediaUrl("http://evil.example/v1/media")).toBe(false);
    expect(isSafeLocalMediaUrl("https://cdn.example/a.png")).toBe(false);
    expect(isSafeLocalMediaUrl("")).toBe(false);
  });
});

describe("local media retry", () => {
  it("retries missing / grant / server races, not decode", () => {
    expect(shouldRetryLocalMediaFailure(null)).toBe(true);
    expect(shouldRetryLocalMediaFailure("missing_path")).toBe(true);
    expect(shouldRetryLocalMediaFailure("untrusted")).toBe(true);
    expect(shouldRetryLocalMediaFailure("media_server_unavailable")).toBe(
      true,
    );
    expect(shouldRetryLocalMediaFailure("broken_blob")).toBe(false);
    expect(shouldRetryLocalMediaFailure("unsupported_type")).toBe(false);
  });

  it("caps retry delays", () => {
    expect(nextLocalMediaRetryMs(0)).toBe(250);
    expect(nextLocalMediaRetryMs(1)).toBe(800);
    expect(nextLocalMediaRetryMs(2)).toBe(2000);
    expect(nextLocalMediaRetryMs(3)).toBeNull();
  });
});

describe("mediaLoadErrorMessageKey / resolve", () => {
  it("maps kinds to stable keys", () => {
    expect(mediaLoadErrorMessageKey("missing_path")).toBe(
      "media.err.missingPath",
    );
    expect(mediaLoadErrorMessageKey("untrusted")).toBe("media.err.untrusted");
    expect(mediaLoadErrorMessageKey("host_only")).toBe("media.err.hostOnly");
    expect(mediaLoadErrorMessageKey("broken_blob")).toBe(
      "media.err.brokenBlob",
    );
    expect(mediaLoadErrorMessageKey("timeout")).toBe("media.err.timeout");
    expect(mediaLoadErrorMessageKey("too_large")).toBe("media.err.tooLarge");
    expect(mediaLoadErrorMessageKey("unsupported_type")).toBe(
      "media.err.unsupportedType",
    );
    expect(mediaLoadErrorMessageKey("media_server_unavailable")).toBe(
      "media.err.mediaServerUnavailable",
    );
    expect(mediaLoadErrorMessageKey("other")).toBe("media.err.other");
  });

  it("resolveMediaLoadError keeps short detail only for other", () => {
    const known = resolveMediaLoadError("file not found");
    expect(known.kind).toBe("missing_path");
    expect(known.detail).toBe("");

    const other = resolveMediaLoadError("weird host code 42");
    expect(other.kind).toBe("other");
    expect(other.messageKey).toBe("media.err.other");
    expect(other.detail).toContain("weird");
  });

  it("resolveMediaSrcFailure uses path context", () => {
    const r = resolveMediaSrcFailure({
      pathOrUrl: "/tmp/a.png",
      isTauri: false,
      resolvedSrc: null,
    });
    expect(r.kind).toBe("host_only");
    expect(r.messageKey).toBe("media.err.hostOnly");
  });
});

describe("deriveMediaLoadPhase / phase keys", () => {
  it("missing when exists is false", () => {
    expect(
      deriveMediaLoadPhase({ hasSrc: false, exists: false }),
    ).toBe("missing");
  });

  it("broken after loadFailed", () => {
    expect(
      deriveMediaLoadPhase({ hasSrc: true, loadFailed: true }),
    ).toBe("broken");
  });

  it("ready only with src and no failure", () => {
    expect(deriveMediaLoadPhase({ hasSrc: true, loadFailed: false })).toBe(
      "ready",
    );
  });

  it("pending while waiting for src", () => {
    expect(deriveMediaLoadPhase({ hasSrc: false })).toBe("pending");
  });

  it("phase message keys", () => {
    expect(mediaLoadPhaseMessageKey("broken")).toBe("media.err.brokenBlob");
    expect(mediaLoadPhaseMessageKey("missing")).toBe("media.err.missingPath");
    expect(mediaLoadPhaseMessageKey("pending")).toBe("media.loading");
    expect(mediaLoadPhaseMessageKey("ready")).toBeNull();
  });
});

describe("classifyMediaSrcFailure — fused query keys & loopback URLs", () => {
  it("fused t:/… path is untrusted, never broken_blob", () => {
    expect(
      classifyMediaSrcFailure({ pathOrUrl: "t:/Users/me/pic.png" }),
    ).toBe("untrusted");
    expect(
      classifyMediaSrcFailure({
        pathOrUrl: "t:/Users/me/pic.png",
        resolvedSrc: null,
        loadFailed: true,
      }),
    ).toBe("untrusted");
  });

  it("loopback media URL with fused p= param is untrusted on loadFailed", () => {
    expect(
      classifyMediaSrcFailure({
        pathOrUrl: "/Users/me/pic.png",
        resolvedSrc:
          "http://127.0.0.1:52193/v1/media?t=tok&p=t%3A%2FUsers%2Fme%2Fpic.png",
        loadFailed: true,
      }),
    ).toBe("untrusted");
  });

  it("loopback media URL without p= is media_server_unavailable", () => {
    expect(
      classifyMediaSrcFailure({
        pathOrUrl: "/Users/me/pic.png",
        resolvedSrc: "http://127.0.0.1:52193/v1/media?t=tok",
        loadFailed: true,
      }),
    ).toBe("media_server_unavailable");
  });

  it("normal loopback media URL with real path stays broken_blob on decode failure", () => {
    expect(
      classifyMediaSrcFailure({
        pathOrUrl: "/Users/me/pic.png",
        resolvedSrc:
          "http://127.0.0.1:52193/v1/media?t=tok&p=%2FUsers%2Fme%2Fpic.png",
        loadFailed: true,
      }),
    ).toBe("broken_blob");
  });
});

describe("mediaUrlPathParam", () => {
  it("extracts decoded p= from loopback media URLs", () => {
    expect(
      mediaUrlPathParam(
        "http://127.0.0.1:52193/v1/media?t=tok&p=%2FUsers%2Fme%2Fa%20b.png",
      ),
    ).toBe("/Users/me/a b.png");
  });

  it("returns null for non-loopback or pathless URLs", () => {
    expect(mediaUrlPathParam("https://cdn.example/a.png")).toBe(null);
    expect(mediaUrlPathParam("http://127.0.0.1:9/v1/media?t=tok")).toBe(null);
    expect(mediaUrlPathParam("")).toBe(null);
    expect(mediaUrlPathParam(null)).toBe(null);
  });
});

describe("formatMediaLoadErrorMessage / label map", () => {
  it("appends detail for other when distinct", () => {
    const tr = (k: string) =>
      k === "media.err.other" ? "Could not load media" : k;
    expect(
      formatMediaLoadErrorMessage(
        { messageKey: "media.err.other", detail: "weird 42" },
        tr,
      ),
    ).toBe("Could not load media (weird 42)");
  });

  it("builds full kind map", () => {
    const map = mediaLoadErrorLabelMap((k: string) => `T:${k}`);
    expect(map.missing_path).toBe("T:media.err.missingPath");
    expect(map.media_server_unavailable).toBe(
      "T:media.err.mediaServerUnavailable",
    );
  });
});

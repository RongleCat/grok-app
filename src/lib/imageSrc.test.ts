import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearImageSrcCache,
  isMediaEndpointReady,
  isViewableSrc,
  localPathToMediaHttpUrl,
  normalizeMediaRef,
  onMediaEndpointChange,
  resetMediaEndpointForTests,
  resolveImageSrcSync,
  setMediaEndpoint,
} from "./imageSrc";

describe("isViewableSrc", () => {
  it("accepts http(s), data, blob, asset, media", () => {
    expect(isViewableSrc("https://example.com/a.png")).toBe(true);
    expect(isViewableSrc("http://example.com/a.png")).toBe(true);
    expect(isViewableSrc("data:image/png;base64,xx")).toBe(true);
    expect(isViewableSrc("blob:http://localhost/1")).toBe(true);
    expect(isViewableSrc("asset://localhost/foo")).toBe(true);
    expect(isViewableSrc("media://localhost/foo")).toBe(true);
    expect(isViewableSrc("https://media.localhost/foo")).toBe(true);
    expect(isViewableSrc("http://127.0.0.1:9/v1/media?t=x&p=y")).toBe(true);
  });

  it("rejects bare paths", () => {
    expect(isViewableSrc("/Users/me/pic.png")).toBe(false);
    expect(isViewableSrc("C:\\Users\\me\\pic.png")).toBe(false);
  });
});

describe("normalizeMediaRef / ChatCut refs", () => {
  it("upgrades protocol-relative S3 URLs to https", () => {
    const raw =
      "//chatcut-production-mainbucketbucket-oxvbnfsx.s3.us-east-1.amazonaws.com/users/u/projects/p/assets/image/id/%E7%AC%AC2%E9%9B%86-thumbnail.jpg";
    expect(normalizeMediaRef(raw)).toBe(`https:${raw}`);
    expect(resolveImageSrcSync(raw)).toBe(`https:${raw}`);
  });

  it("rejects angle-bracket placeholders", () => {
    expect(normalizeMediaRef("/<frame-name>.jpg")).toBe(null);
    expect(resolveImageSrcSync("/<frame-name>.jpg")).toBe(null);
  });

  it("collapses double slashes in local temp paths", () => {
    const raw =
      "/var/folders/75/xx/T//chatcut-frames.qVukfi/f2150.jpg";
    expect(normalizeMediaRef(raw)).toBe(
      "/var/folders/75/xx/T/chatcut-frames.qVukfi/f2150.jpg",
    );
  });
});

describe("fused media query keys never reach the media server", () => {
  afterEach(() => {
    clearImageSrcCache();
    resetMediaEndpointForTests();
  });

  it("keeps a Windows UNC path as a local file", () => {
    expect(normalizeMediaRef("\\\\server\\share\\a.png")).toBe(
      "\\\\server\\share\\a.png",
    );
    expect(normalizeMediaRef("\\\\files.corp\\share\\a.png")).toBe(
      "\\\\files.corp\\share\\a.png",
    );
    expect(normalizeMediaRef("//cdn.example.com/a.png")).toBe(
      "https://cdn.example.com/a.png",
    );
  });

  it("normalizeMediaRef rejects t:/… fused paths", () => {
    expect(normalizeMediaRef("t:/Users/me/pic.png")).toBe(null);
    expect(normalizeMediaRef("p:/Users/me/pic.png")).toBe(null);
    expect(normalizeMediaRef("t:/Users/me/Library/Application Support/a.png")).toBe(
      null,
    );
    // Real Windows profile path still normalizes.
    expect(normalizeMediaRef("C:/Users/me/pic.png")).toBe("C:/Users/me/pic.png");
  });

  it("resolveImageSrcSync returns null (never a media URL) for fused paths", () => {
    setMediaEndpoint({ baseUrl: "http://127.0.0.1:52193", token: "tok" });
    expect(resolveImageSrcSync("t:/Users/me/pic.png")).toBe(null);
    // A real local path still resolves to a token-gated media URL.
    expect(resolveImageSrcSync("/Users/me/pic.png")).toBe(
      "http://127.0.0.1:52193/v1/media?t=tok&p=%2FUsers%2Fme%2Fpic.png",
    );
  });

  it("localPathToMediaHttpUrl is a last line of defense", () => {
    setMediaEndpoint({ baseUrl: "http://127.0.0.1:52193", token: "tok" });
    expect(localPathToMediaHttpUrl("t:/Users/me/pic.png")).toBe(null);
    expect(localPathToMediaHttpUrl("/Users/me/pic.png")).toContain("&p=%2FUsers%2Fme%2Fpic.png");
  });
});

describe("onMediaEndpointChange", () => {
  afterEach(() => {
    clearImageSrcCache();
    resetMediaEndpointForTests();
  });

  it("notifies listeners only when the endpoint actually changes", () => {
    const fn = vi.fn();
    const off = onMediaEndpointChange(fn);
    setMediaEndpoint({ baseUrl: "http://127.0.0.1:1", token: "a" });
    expect(fn).toHaveBeenCalledTimes(1);
    setMediaEndpoint({ baseUrl: "http://127.0.0.1:1", token: "a" });
    expect(fn).toHaveBeenCalledTimes(1);
    setMediaEndpoint({ baseUrl: "http://127.0.0.1:2", token: "b" });
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    setMediaEndpoint({ baseUrl: "http://127.0.0.1:3", token: "c" });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("resolveImageSrcSync", () => {
  afterEach(() => {
    clearImageSrcCache();
    resetMediaEndpointForTests();
  });

  it("passes through already-viewable URLs without caching side effects", () => {
    expect(resolveImageSrcSync("https://cdn.example/a.jpg")).toBe(
      "https://cdn.example/a.jpg",
    );
    expect(resolveImageSrcSync("media://localhost/x")).toBe(
      "media://localhost/x",
    );
  });

  it("returns null for empty / relative / ellipsis paths", () => {
    expect(resolveImageSrcSync("")).toBe(null);
    expect(resolveImageSrcSync("images/1.jpg")).toBe(null);
    expect(resolveImageSrcSync(".../foo/bar.png")).toBe(null);
  });

  it("returns null for absolute paths outside Tauri without media endpoint", () => {
    // isTauri() is false in vitest — path must not throw, must resolve once.
    const a = resolveImageSrcSync("/Users/me/pic.png");
    const b = resolveImageSrcSync("/Users/me/pic.png");
    expect(a).toBe(null);
    expect(b).toBe(null);
  });

  it("builds loopback HTTP URLs when media endpoint is set", () => {
    setMediaEndpoint({
      baseUrl: "http://127.0.0.1:34567",
      token: "sec-tok",
    });
    expect(isMediaEndpointReady()).toBe(true);
    const url = resolveImageSrcSync("/Users/me/pic.png");
    expect(url).toBe(
      "http://127.0.0.1:34567/v1/media?t=sec-tok&p=%2FUsers%2Fme%2Fpic.png",
    );
    // Cached
    expect(resolveImageSrcSync("/Users/me/pic.png")).toBe(url);
    expect(localPathToMediaHttpUrl("/tmp/a.jpg")).toContain("t=sec-tok");
    expect(localPathToMediaHttpUrl("/tmp/a.jpg")).toContain(
      encodeURIComponent("/tmp/a.jpg"),
    );
  });
});

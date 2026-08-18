import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import {
  clearChatImageThumbClientCache,
  canUseImageThumb,
  chatCardFirstPaintSrc,
  getThumbCacheEndpoint,
  nextChatCardDisplaySrc,
  peekChatImageThumb,
  resolveChatImageThumb,
} from "./imageThumbClient";
import {
  localPathToMediaHttpUrl,
  resetMediaEndpointForTests,
  setMediaEndpoint,
} from "./imageSrc";

afterEach(() => {
  clearChatImageThumbClientCache();
  resetMediaEndpointForTests();
  vi.restoreAllMocks();
});

describe("canUseImageThumb", () => {
  it("accepts real local paths and remote https", () => {
    expect(canUseImageThumb("/Users/me/a.png")).toBe(true);
    expect(canUseImageThumb("C:/Users/me/a.png")).toBe(true);
    expect(canUseImageThumb("https://cdn.example/x.jpg")).toBe(true);
  });

  it("rejects fused query-key paths (t:/Users/…)", () => {
    expect(canUseImageThumb("t:/Users/me/a.png")).toBe(false);
    // A real local src still wins over a fused path arg (src is the target).
    expect(canUseImageThumb("/Users/me/a.png", "t:/Users/me/a.png")).toBe(
      true,
    );
  });

  it("rejects loopback URLs and blob/data", () => {
    expect(canUseImageThumb("http://127.0.0.1:9/v1/media?t=x&p=y")).toBe(
      false,
    );
    expect(canUseImageThumb("blob:http://localhost/1")).toBe(false);
  });
});

describe("resolveChatImageThumb — fused paths never hit the thumb host", () => {
  it("returns null for a fused path without calling the host", async () => {
    const spy = vi.spyOn(api, "mediaImageThumb");
    const r = await resolveChatImageThumb("t:/Users/me/a.png");
    expect(r).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("peekChatImageThumb / nextChatCardDisplaySrc", () => {
  it("seeds remount from the in-memory thumb cache (no https→loopback swap)", async () => {
    setMediaEndpoint({ baseUrl: "http://127.0.0.1:9", token: "tok" });
    vi.spyOn(api, "isDesktopHost").mockReturnValue(true);
    vi.spyOn(api, "mediaImageThumb").mockResolvedValue({
      thumbPath: "/tmp/cache/image-thumbs/x.jpg",
      fromCache: true,
      width: 480,
      height: 283,
      isOriginal: false,
    });
    const remote =
      "https://gbres.example/Files/iimage/20260814/chart.png";
    expect(peekChatImageThumb(remote)).toBeNull();

    const resolved = await resolveChatImageThumb(remote);
    expect(resolved?.displaySrc).toContain("127.0.0.1:9");

    const peek = peekChatImageThumb(remote);
    expect(peek?.displaySrc).toBe(resolved?.displaySrc);
    expect(peekChatImageThumb(remote, remote)?.displaySrc).toBe(
      resolved?.displaySrc,
    );
  });

  it("does not wipe a working https src when thumb resolve returns null", () => {
    const live = "https://cdn.example/chart.png";
    expect(nextChatCardDisplaySrc(live, null)).toBe(live);
    expect(nextChatCardDisplaySrc(live, { displaySrc: "" } as never)).toBe(
      live,
    );
  });

  it("keeps a live loopback src when first-paint seed is empty (no gray flash)", () => {
    const live = "http://127.0.0.1:9/v1/media?t=tok&p=%2Ftmp%2Ft.jpg";
    expect(
      nextChatCardDisplaySrc(live, { displaySrc: undefined } as never),
    ).toBe(live);
    expect(nextChatCardDisplaySrc(live, { displaySrc: null } as never)).toBe(
      live,
    );
  });

  it("prefers a successful thumb displaySrc over the live src", () => {
    expect(
      nextChatCardDisplaySrc("https://cdn.example/chart.png", {
        displaySrc: "http://127.0.0.1:9/v1/media?t=tok&p=%2Ftmp%2Ft.jpg",
        fullKey: "https://cdn.example/chart.png",
        width: 480,
        height: 283,
        fromCache: true,
      }),
    ).toBe("http://127.0.0.1:9/v1/media?t=tok&p=%2Ftmp%2Ft.jpg");
  });
});

describe("chatCardFirstPaintSrc — empty cache vs remount (#675)", () => {
  it("does not first-paint a user-paste attachment original (history flash)", () => {
    setMediaEndpoint({ baseUrl: "http://127.0.0.1:9", token: "tok" });
    const paste =
      "/Users/me/Library/Application Support/com.grokapp.grok-app/attachments/paste/20260818-173813-602-paste.png";
    const originalUrl = localPathToMediaHttpUrl(paste);
    expect(originalUrl).toContain("/v1/media");
    expect(peekChatImageThumb(paste, paste)).toBeNull();

    const first = chatCardFirstPaintSrc(paste, paste, "card");
    expect(first).toBeNull();
    expect(first).not.toBe(originalUrl);
    expect(first).not.toBe(paste);
  });

  it("does not first-paint the original media URL when the thumb cache is empty", () => {
    setMediaEndpoint({ baseUrl: "http://127.0.0.1:9", token: "tok" });
    const local = "/Users/me/imagine/1.png";
    const originalUrl = localPathToMediaHttpUrl(local);
    expect(originalUrl).toContain("/v1/media");
    expect(originalUrl).toContain(encodeURIComponent(local));
    expect(peekChatImageThumb(local, local)).toBeNull();

    const first = chatCardFirstPaintSrc(local, local, "card");
    expect(first).toBeNull();
    expect(first).not.toBe(originalUrl);
    expect(first).not.toBe(local);
  });

  it("does not first-paint a remote https original on an empty card cache", () => {
    const remote = "https://cdn.example/chart.png";
    expect(peekChatImageThumb(remote)).toBeNull();
    expect(chatCardFirstPaintSrc(remote, undefined, "card")).toBeNull();
  });

  it("first-paints the cached thumb on remount", async () => {
    setMediaEndpoint({ baseUrl: "http://127.0.0.1:9", token: "tok" });
    vi.spyOn(api, "isDesktopHost").mockReturnValue(true);
    vi.spyOn(api, "mediaImageThumb").mockResolvedValue({
      thumbPath: "/tmp/cache/image-thumbs/x.jpg",
      fromCache: true,
      width: 1024,
      height: 768,
      isOriginal: false,
    });
    const local = "/Users/me/imagine/2.png";
    expect(chatCardFirstPaintSrc(local, local, "card")).toBeNull();

    const resolved = await resolveChatImageThumb(local, local);
    expect(resolved?.displaySrc).toContain("127.0.0.1:9");
    expect(resolved?.displaySrc).toContain(encodeURIComponent("/tmp/cache/image-thumbs/x.jpg"));

    const remount = chatCardFirstPaintSrc(local, local, "card");
    expect(remount).toBe(resolved?.displaySrc);
    expect(remount).not.toBe(localPathToMediaHttpUrl(local));
  });

  it("pane layout still resolves the original on first paint", () => {
    setMediaEndpoint({ baseUrl: "http://127.0.0.1:9", token: "tok" });
    const local = "/Users/me/imagine/3.png";
    expect(chatCardFirstPaintSrc(local, local, "pane")).toBe(
      localPathToMediaHttpUrl(local),
    );
  });

  it("keeps data/blob src when the card cannot use a host thumb", () => {
    const data = "data:image/png;base64,xx";
    expect(canUseImageThumb(data)).toBe(false);
    expect(chatCardFirstPaintSrc(data, undefined, "card")).toBe(data);
  });
});

describe("resolveChatImageThumb — endpoint change drops stale loopback URLs", () => {
  it("clears cached displaySrc when the media endpoint changes", async () => {
    setMediaEndpoint({ baseUrl: "http://127.0.0.1:1", token: "old" });
    expect(getThumbCacheEndpoint()).toBe("http://127.0.0.1:1?t=old");

    vi.spyOn(api, "mediaImageThumb").mockResolvedValue({
      thumbPath: "/Users/me/Library/cache/image-thumbs/abc.jpg",
      fromCache: true,
      width: 120,
      height: 80,
      isOriginal: false,
    });
    const first = await resolveChatImageThumb("/Users/me/a.png");
    expect(first?.displaySrc).toContain("127.0.0.1:1");
    expect(first?.displaySrc).toContain("t=old");

    // New endpoint (media server restarted with a new port/token).
    setMediaEndpoint({ baseUrl: "http://127.0.0.1:2", token: "new" });
    expect(getThumbCacheEndpoint()).toBe("http://127.0.0.1:2?t=new");

    const second = await resolveChatImageThumb("/Users/me/a.png");
    expect(second?.displaySrc).toContain("127.0.0.1:2");
    expect(second?.displaySrc).toContain("t=new");
  });
});

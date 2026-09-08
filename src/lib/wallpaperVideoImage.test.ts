// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./wallpaperSource", () => ({ readLocalMediaBlobViaIpc: vi.fn() }));
import { videoImageToPng } from "./wallpaperVideoImage";

class PendingImage {
  src = "";
  naturalWidth = 4096;
  naturalHeight = 2048;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
}

class PendingReader {
  static readonly LOADING = 1;
  readyState = 0;
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  readAsDataURL = vi.fn(() => { this.readyState = 1; });
  abort = vi.fn(() => {
    this.readyState = 2;
    this.onabort?.();
  });
}

let source: PendingImage;
let canvas: HTMLCanvasElement;
let finishEncoding: BlobCallback;
let readers: PendingReader[];
let revokeUrl: ReturnType<typeof vi.fn>;
const png = () => new Blob(["normalized pixels"], { type: "image/png" });
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  source = new PendingImage();
  readers = [];
  vi.stubGlobal("Image", class { constructor() { return source; } });
  vi.stubGlobal("FileReader", class extends PendingReader {
    constructor() {
      super();
      readers.push(this);
    }
  });
  revokeUrl = vi.fn();
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn(() => "blob:video-source");
    static revokeObjectURL = revokeUrl;
  });
  canvas = document.createElement("canvas");
  vi.spyOn(canvas, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(canvas, "toBlob").mockImplementation((callback) => { finishEncoding = callback; });
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag, options) =>
    tag === "canvas" ? canvas : createElement(tag, options));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function startEncoding(signal: AbortSignal) {
  const result = videoImageToPng(new Blob(["original pixels"], { type: "image/avif" }), signal);
  source.onload?.();
  await nextTask();
  return { result };
}

function expectReleased() {
  expect(source.src).toBe("");
  expect(canvas.width).toBe(0);
  expect(canvas.height).toBe(0);
  expect(revokeUrl).toHaveBeenCalledExactlyOnceWith("blob:video-source");
}

describe("wallpaper video browser conversion", () => {
  it("settles cancellation before a slow PNG encoder returns", async () => {
    const controller = new AbortController();
    const { result } = await startEncoding(controller.signal);
    const reason = new DOMException("Cancelled", "AbortError");
    let rejected: unknown;
    const settled = result.catch((error: unknown) => { rejected = error; });
    controller.abort(reason);
    await nextTask();
    try {
      expect(rejected).toBe(reason);
      expectReleased();
      expect(readers).toHaveLength(0);
    } finally {
      finishEncoding(png());
      await settled;
    }
    expectReleased();
    expect(readers).toHaveLength(0);
  });

  it("aborts pending Base64 reads and releases pixels immediately", async () => {
    const controller = new AbortController();
    const { result } = await startEncoding(controller.signal);
    finishEncoding(png());
    await nextTask();
    const reader = readers[0];
    expect(reader.readAsDataURL).toHaveBeenCalledOnce();
    const lateLoad = reader.onload;
    const reason = new DOMException("Cancelled", "AbortError");
    let rejected: unknown;
    const settled = result.catch((error: unknown) => { rejected = error; });
    controller.abort(reason);
    await nextTask();
    try {
      expect(rejected).toBe(reason);
      expect(reader.abort).toHaveBeenCalledOnce();
      expect(reader.onload).toBeNull();
      expect(reader.onerror).toBeNull();
      expect(reader.onabort).toBeNull();
      expectReleased();
    } finally {
      reader.result = "data:image/png;base64,bGF0ZQ==";
      reader.readyState = 2;
      lateLoad?.();
      await settled;
    }
    expectReleased();
  });

  it("returns bounded PNG pixels and detaches cancellation after completion", async () => {
    const controller = new AbortController();
    const { result } = await startEncoding(controller.signal);
    expect([canvas.width, canvas.height]).toEqual([2048, 1024]);
    finishEncoding(png());
    await nextTask();
    const reader = readers[0];
    reader.result = "data:image/png;base64,cGl4ZWxz";
    reader.readyState = 2;
    reader.onload?.();
    await expect(result).resolves.toBe("cGl4ZWxz");
    expectReleased();
    controller.abort();
    expect(reader.abort).not.toHaveBeenCalled();
  });
});

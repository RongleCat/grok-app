import { describe, expect, it, vi } from "vitest";
import { fetchViaRange, pathToFileUrl } from "./filePreviewSrc";

describe("pathToFileUrl", () => {
  it("encodes unix paths with spaces and CJK", () => {
    const u = pathToFileUrl(
      "/Users/me/Documents/AI HOT今日选题报告.html",
    );
    expect(u.startsWith("file:///Users/me/Documents/")).toBe(true);
    expect(u).toContain("AI%20HOT");
    expect(u).toContain("%E4%BB%8A%E6%97%A5"); // 今日
    expect(u.endsWith(".html")).toBe(true);
  });

  it("handles windows drive letters", () => {
    const u = pathToFileUrl("C:/Users/me/report.html");
    expect(u).toBe("file:///C:/Users/me/report.html");
  });
});

describe("fetchViaRange", () => {
  it("rejects an oversized PDF from the first Content-Range response", async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      new Response(new Uint8Array(4), {
        status: 206,
        headers: { "Content-Range": `bytes 0-3/${40 * 1024 * 1024 + 1}` },
      }),
    );

    await expect(
      fetchViaRange("http://127.0.0.1/preview", {
        kind: "pdf",
        fetchImpl,
      }),
    ).rejects.toThrow("file too large for in-app pdf preview");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects an overlarge initial range before reading its body", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    const fetchImpl: typeof fetch = vi.fn(async () => {
      const response = new Response(null, {
        status: 206,
        headers: {
          "Content-Range": `bytes 0-${4 * 1024 * 1024 - 1}/${8 * 1024 * 1024}`,
        },
      });
      Object.defineProperty(response, "arrayBuffer", { value: arrayBuffer });
      return response;
    });

    await expect(
      fetchViaRange("http://127.0.0.1/preview", {
        kind: "pdf",
        fetchImpl,
      }),
    ).rejects.toThrow("invalid Content-Range");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("passes one AbortSignal to every range request", async () => {
    const controller = new AbortController();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchImpl: typeof fetch = vi.fn(async (_url, init) => {
      expect(init?.signal).toBe(controller.signal);
      const range = (init?.headers as Record<string, string> | undefined)?.Range;
      if (!range) {
        return new Response(bytes.slice(0, 2), {
          status: 206,
          headers: { "Content-Range": "bytes 0-1/4" },
        });
      }
      return new Response(bytes.slice(2), {
        status: 206,
        headers: { "Content-Range": "bytes 2-3/4" },
      });
    });

    await expect(
      fetchViaRange("http://127.0.0.1/preview", {
        kind: "pdf",
        signal: controller.signal,
        fetchImpl,
        chunkSize: 2,
      }),
    ).resolves.toEqual(bytes.buffer);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects a range response that does not start where requested", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchImpl: typeof fetch = vi.fn(async (_url, init) => {
      const range = (init?.headers as Record<string, string> | undefined)?.Range;
      return new Response(bytes.slice(0, 2), {
        status: 206,
        headers: {
          "Content-Range": range ? "bytes 0-1/4" : "bytes 0-1/4",
        },
      });
    });

    await expect(
      fetchViaRange("http://127.0.0.1/preview", {
        kind: "docx",
        fetchImpl,
        chunkSize: 2,
      }),
    ).rejects.toThrow("invalid Content-Range");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stops an in-flight range request when aborted", async () => {
    const controller = new AbortController();
    let requestStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    const fetchImpl: typeof fetch = vi.fn((_url, init) => {
      const range = (init?.headers as Record<string, string> | undefined)?.Range;
      if (!range) {
        return Promise.resolve(
          new Response(new Uint8Array([1, 2]), {
            status: 206,
            headers: { "Content-Range": "bytes 0-1/4" },
          }),
        );
      }
      requestStarted?.();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
          once: true,
        });
      });
    });

    const pending = fetchViaRange("http://127.0.0.1/preview", {
      kind: "pdf",
      signal: controller.signal,
      fetchImpl,
      chunkSize: 2,
    });
    await started;
    controller.abort();

    await expect(pending).rejects.toSatisfy(
      (error: unknown) => error instanceof DOMException && error.name === "AbortError",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

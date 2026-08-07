import { describe, expect, it } from "vitest";
import { absPathFromMediaHttpUrl } from "./copyImage";

describe("absPathFromMediaHttpUrl", () => {
  it("extracts absolute path from loopback media URL", () => {
    const path = "/Users/sunny/Work/CC/bflabs-agent-readiness/preview/01.png";
    const url = `http://127.0.0.1:58632/v1/media?t=abc&p=${encodeURIComponent(path)}`;
    expect(absPathFromMediaHttpUrl(url)).toBe(path);
  });

  it("rejects non-media URLs", () => {
    expect(absPathFromMediaHttpUrl("https://example.com/a.png")).toBeNull();
    expect(absPathFromMediaHttpUrl("http://127.0.0.1:9/other?p=/x.png")).toBeNull();
    expect(absPathFromMediaHttpUrl("not-a-url")).toBeNull();
  });
});

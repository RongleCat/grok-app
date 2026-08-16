import { describe, expect, it } from "vitest";
import {
  detectAppPlatform,
  fileManagerOpenTarget,
  revealInOsMessageKey,
  usesCustomWindowChrome,
} from "./appPlatform";

describe("detectAppPlatform", () => {
  it("detects mac / win / linux", () => {
    expect(detectAppPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X)")).toBe(
      "mac",
    );
    expect(detectAppPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(
      "win",
    );
    expect(detectAppPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
  });
});

describe("revealInOsMessageKey", () => {
  it("picks OS-specific reveal keys", () => {
    expect(revealInOsMessageKey("mac")).toBe("main.openInFinder");
    expect(revealInOsMessageKey("win")).toBe("main.openInExplorer");
    expect(revealInOsMessageKey("linux")).toBe("main.openInFileManager");
    expect(revealInOsMessageKey("other")).toBe("main.openInFileManager");
  });
});

describe("usesCustomWindowChrome", () => {
  it("is frameless on Windows / Linux / other, native Overlay on mac", () => {
    expect(usesCustomWindowChrome("win")).toBe(true);
    expect(usesCustomWindowChrome("linux")).toBe(true);
    expect(usesCustomWindowChrome("other")).toBe(true);
    expect(usesCustomWindowChrome("mac")).toBe(false);
  });
});

describe("fileManagerOpenTarget", () => {
  it("uses explorer id only on Windows", () => {
    expect(fileManagerOpenTarget("win")).toBe("explorer");
    expect(fileManagerOpenTarget("mac")).toBe("finder");
    expect(fileManagerOpenTarget("linux")).toBe("finder");
  });
});

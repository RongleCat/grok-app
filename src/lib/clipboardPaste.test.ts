import { describe, expect, it, vi } from "vitest";
import {
  clipboardLooksLikeMedia,
  clipboardLooksLikeOsFiles,
  clipboardPlainText,
  collectFilesFromDataTransfer,
  fileKey,
  fileNativePath,
  isFileUrlOnlyText,
  isNotReadableBlobError,
  readClipboardMediaFiles,
} from "./clipboardPaste";

function fakeFile(
  name: string,
  type: string,
  size = 12,
  lastModified = 1,
): File {
  const buf = new Uint8Array(size);
  return new File([buf], name, { type, lastModified });
}

describe("collectFilesFromDataTransfer", () => {
  it("returns empty for null", () => {
    expect(collectFilesFromDataTransfer(null)).toEqual([]);
  });

  it("collects files from items kind=file", () => {
    const f = fakeFile("shot.png", "image/png");
    const data = {
      files: { length: 0, item: () => null } as unknown as FileList,
      items: [
        {
          kind: "file",
          type: "image/png",
          getAsFile: () => f,
        },
      ],
      types: ["Files", "image/png"],
      getData: () => "",
    } as unknown as DataTransfer;
    const files = collectFilesFromDataTransfer(data);
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe("shot.png");
  });

  it("dedupes same file from files + items", () => {
    const f = fakeFile("a.png", "image/png");
    const data = {
      files: {
        length: 1,
        item: (i: number) => (i === 0 ? f : null),
        0: f,
        [Symbol.iterator]: function* () {
          yield f;
        },
      } as unknown as FileList,
      items: [
        {
          kind: "file",
          type: "image/png",
          getAsFile: () => f,
        },
      ],
      types: ["Files"],
      getData: () => "",
    } as unknown as DataTransfer;
    expect(collectFilesFromDataTransfer(data)).toHaveLength(1);
  });

  it("dedupes files+items wrappers with different lastModified", () => {
    // WKWebView often returns distinct File objects for the same paste.
    const a = fakeFile("image.png", "image/png", 64, 100);
    const b = fakeFile("image.png", "image/png", 64, 999);
    const data = {
      files: {
        length: 1,
        item: (i: number) => (i === 0 ? a : null),
        0: a,
        [Symbol.iterator]: function* () {
          yield a;
        },
      } as unknown as FileList,
      items: [
        {
          kind: "file",
          type: "image/png",
          getAsFile: () => b,
        },
      ],
      types: ["Files", "image/png"],
      getData: () => "",
    } as unknown as DataTransfer;
    expect(collectFilesFromDataTransfer(data)).toHaveLength(1);
  });

  it("skips zero-byte files", () => {
    const empty = fakeFile("empty.png", "image/png", 0);
    const data = {
      files: {
        length: 1,
        item: () => empty,
        0: empty,
        [Symbol.iterator]: function* () {
          yield empty;
        },
      } as unknown as FileList,
      items: [],
      types: ["Files"],
      getData: () => "",
    } as unknown as DataTransfer;
    expect(collectFilesFromDataTransfer(data)).toHaveLength(0);
  });
});

describe("fileKey", () => {
  it("ignores lastModified for identity", () => {
    const a = fakeFile("shot.png", "image/png", 20, 1);
    const b = fakeFile("shot.png", "image/png", 20, 99);
    expect(fileKey(a)).toBe(fileKey(b));
  });

  it("treats generic clipboard names as anonymous", () => {
    const a = fakeFile("image.png", "image/png", 40, 1);
    const b = fakeFile("paste.png", "image/png", 40, 2);
    expect(fileKey(a)).toBe(fileKey(b));
  });
});

describe("clipboardLooksLikeOsFiles / fileNativePath / isNotReadableBlobError", () => {
  it("detects Explorer Files list without readable blobs", () => {
    const data = {
      files: { length: 0, item: () => null } as unknown as FileList,
      items: [{ kind: "file", type: "", getAsFile: () => null }],
      types: ["Files"],
      getData: () => "",
    } as unknown as DataTransfer;
    expect(clipboardLooksLikeOsFiles(data)).toBe(true);
    expect(clipboardLooksLikeOsFiles({
      files: { length: 0, item: () => null } as unknown as FileList,
      items: [],
      types: ["image/png"],
      getData: () => "",
    } as unknown as DataTransfer)).toBe(false);
  });

  it("does not treat a copied http URL uri-list as OS files", () => {
    const data = {
      files: { length: 0, item: () => null } as unknown as FileList,
      items: [{ kind: "string", type: "text/plain", getAsFile: () => null }],
      types: ["text/uri-list", "text/plain"],
      getData: (t: string) =>
        t === "text/plain" || t === "text/uri-list"
          ? "https://example.com/shot.png"
          : "",
    } as unknown as DataTransfer;
    expect(clipboardLooksLikeOsFiles(data)).toBe(false);
    expect(clipboardLooksLikeMedia(data)).toBe(false);
  });

  it("reads Tauri File.path when present", () => {
    const f = Object.assign(fakeFile("crash.dmp", ""), {
      path: "C:\\\\dumps\\\\crash.dmp",
    });
    expect(fileNativePath(f)).toBe("C:\\\\dumps\\\\crash.dmp");
    expect(fileNativePath(fakeFile("crash.dmp", ""))).toBe("");
  });

  it("classifies Chromium NotReadableError", () => {
    const err = Object.assign(new Error(
      "The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.",
    ), { name: "NotReadableError" });
    expect(isNotReadableBlobError(err)).toBe(true);
    expect(isNotReadableBlobError(new Error("disk full"))).toBe(false);
  });
});

describe("clipboardLooksLikeMedia", () => {
  it("detects image types without File objects", () => {
    const data = {
      files: { length: 0, item: () => null } as unknown as FileList,
      items: [{ kind: "string", type: "image/png", getAsFile: () => null }],
      types: ["image/png"],
      getData: () => "",
    } as unknown as DataTransfer;
    expect(clipboardLooksLikeMedia(data)).toBe(true);
  });

  it("false for plain text only", () => {
    const data = {
      files: { length: 0, item: () => null } as unknown as FileList,
      items: [{ kind: "string", type: "text/plain", getAsFile: () => null }],
      types: ["text/plain"],
      getData: () => "hello",
    } as unknown as DataTransfer;
    expect(clipboardLooksLikeMedia(data)).toBe(false);
  });
});

describe("clipboardPlainText / isFileUrlOnlyText", () => {
  it("normalizes newlines", () => {
    const data = {
      getData: (t: string) => (t === "text/plain" ? "a\r\nb\rc" : ""),
    } as unknown as DataTransfer;
    expect(clipboardPlainText(data)).toBe("a\nb\nc");
  });

  it("detects file url only", () => {
    expect(isFileUrlOnlyText("file:///tmp/x.png")).toBe(true);
    expect(isFileUrlOnlyText("hello\nfile:///tmp/x.png")).toBe(false);
  });
});

describe("readClipboardMediaFiles", () => {
  it("returns one file per clipboard item even with multiple image types", async () => {
    const png = new Blob([new Uint8Array(8)], { type: "image/png" });
    const jpeg = new Blob([new Uint8Array(10)], { type: "image/jpeg" });
    const read = vi.fn().mockResolvedValue([
      {
        types: ["image/jpeg", "image/png", "text/html"],
        getType: async (t: string) => (t === "image/png" ? png : jpeg),
      },
    ]);
    const prev = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { read },
    });
    try {
      const files = await readClipboardMediaFiles();
      expect(files).toHaveLength(1);
      expect(files[0]?.type).toBe("image/png");
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: prev,
      });
    }
  });
});

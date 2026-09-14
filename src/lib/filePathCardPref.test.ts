/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FILE_PATH_CARD_BASENAME,
  FILE_PATH_CARD_BASENAME_CHANGE_EVENT,
  FILE_PATH_CARD_BASENAME_STORAGE_KEY,
  filePathCardDisplayLabel,
  filePathCardHoverLabel,
  filePathCardTokens,
  filePathCardWrittenToken,
  loadFilePathCardBasenamePref,
  parseFilePathCardBasenamePref,
  saveFilePathCardBasenamePref,
  type FilePathCardBasenameStorage,
} from "./filePathCardPref";

function memoryStorage(
  initial: Record<string, string> = {},
): FilePathCardBasenameStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return key in data ? data[key]! : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
  };
}

describe("filePathCardBasenamePref", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to file name only", () => {
    expect(DEFAULT_FILE_PATH_CARD_BASENAME).toBe(true);
    expect(parseFilePathCardBasenamePref(null)).toBe(true);
    expect(parseFilePathCardBasenamePref("")).toBe(true);
    expect(parseFilePathCardBasenamePref("maybe")).toBe(true);
    expect(loadFilePathCardBasenamePref(memoryStorage())).toBe(true);
  });

  it("parses on/off and legacy select values", () => {
    expect(parseFilePathCardBasenamePref("1")).toBe(true);
    expect(parseFilePathCardBasenamePref("0")).toBe(false);
    expect(parseFilePathCardBasenamePref("basename")).toBe(true);
    expect(parseFilePathCardBasenamePref("original")).toBe(false);
    expect(parseFilePathCardBasenamePref("full")).toBe(false);
    expect(parseFilePathCardBasenamePref("as-written")).toBe(false);
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveFilePathCardBasenamePref(false, s);
    expect(s.data[FILE_PATH_CARD_BASENAME_STORAGE_KEY]).toBe("0");
    expect(loadFilePathCardBasenamePref(s)).toBe(false);
    saveFilePathCardBasenamePref(true, s);
    expect(s.data[FILE_PATH_CARD_BASENAME_STORAGE_KEY]).toBe("1");
    expect(loadFilePathCardBasenamePref(s)).toBe(true);
  });

  it("reads the legacy select key when the checkbox key is absent", () => {
    expect(
      loadFilePathCardBasenamePref(
        memoryStorage({ "grok.filePathCardLabel": "original" }),
      ),
    ).toBe(false);
    expect(
      loadFilePathCardBasenamePref(
        memoryStorage({ "grok.filePathCardLabel": "basename" }),
      ),
    ).toBe(true);
  });

  it("dispatches a window event on save", () => {
    const handler = vi.fn();
    window.addEventListener(FILE_PATH_CARD_BASENAME_CHANGE_EVENT, handler);
    saveFilePathCardBasenamePref(false, memoryStorage());
    expect(handler).toHaveBeenCalledTimes(1);
    const ev = handler.mock.calls[0]![0] as CustomEvent;
    expect(ev.detail).toBe(false);
    window.removeEventListener(FILE_PATH_CARD_BASENAME_CHANGE_EVENT, handler);
  });
});

describe("filePathCardDisplayLabel", () => {
  it("basename uses the filename; off keeps the token as written", () => {
    const path = "~/.grok/sandbox.toml";
    expect(
      filePathCardDisplayLabel({ basenameOnly: true, path }),
    ).toBe("sandbox.toml");
    expect(
      filePathCardDisplayLabel({ basenameOnly: false, path }),
    ).toBe("~/.grok/sandbox.toml");
  });

  it("does not rewrite an absolute home path to tilde", () => {
    const path = "/Users/yangzongru/.codex/AGENTS.md";
    expect(
      filePathCardDisplayLabel({ basenameOnly: false, path }),
    ).toBe(path);
  });

  it("basename prefers resolved abs when the token is a bare name", () => {
    expect(
      filePathCardDisplayLabel({
        basenameOnly: true,
        path: "AGENTS.md",
        resolvedAbs: "/Users/me/.codex/AGENTS.md",
      }),
    ).toBe("AGENTS.md");
    expect(
      filePathCardDisplayLabel({
        basenameOnly: false,
        path: "AGENTS.md",
        resolvedAbs: "/Users/me/.codex/AGENTS.md",
      }),
    ).toBe("AGENTS.md");
  });

  it("as-written keeps a short token even when resolve already has a full path", () => {
    const written = "src/lib/filePathCardPref.ts";
    const abs =
      "/Users/yangzongru/Documents/CodeGitHub/grok-app/src/lib/filePathCardPref.ts";
    expect(
      filePathCardDisplayLabel({
        basenameOnly: false,
        path: written,
        resolvedAbs: abs,
      }),
    ).toBe(written);
    expect(
      filePathCardDisplayLabel({
        basenameOnly: true,
        path: written,
        resolvedAbs: abs,
      }),
    ).toBe("filePathCardPref.ts");
  });

  it("URL basename is the host; off keeps the href", () => {
    const path = "https://example.com/docs/path";
    expect(
      filePathCardDisplayLabel({ basenameOnly: true, path, kind: "url" }),
    ).toBe("example.com");
    expect(
      filePathCardDisplayLabel({ basenameOnly: false, path, kind: "url" }),
    ).toBe(path);
  });
});

describe("filePathCardTokens", () => {
  it("keeps the written token on path and puts the abs on absolutePath", () => {
    const written = "src/lib/filePathCardPref.ts";
    const abs =
      "/Users/yangzongru/Documents/CodeGitHub/grok-app/src/lib/filePathCardPref.ts";
    expect(filePathCardWrittenToken(written)).toBe(written);
    expect(filePathCardWrittenToken(`${written}:12`)).toBe(written);
    expect(filePathCardTokens({ written, resolved: abs })).toEqual({
      path: written,
      absolutePath: abs,
    });
    expect(
      filePathCardTokens({ written, resolved: written }),
    ).toEqual({ path: written });
  });
});

describe("filePathCardHoverLabel", () => {
  it("prefers resolved abs, else the original token", () => {
    expect(filePathCardHoverLabel("~/.grok/sandbox.toml", null)).toBe(
      "~/.grok/sandbox.toml",
    );
    expect(
      filePathCardHoverLabel(
        "sandbox.toml",
        "/Users/me/.grok/sandbox.toml",
      ),
    ).toBe("/Users/me/.grok/sandbox.toml");
  });
});

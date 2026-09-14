/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FILE_PATH_CARD_LABEL,
  FILE_PATH_CARD_LABEL_CHANGE_EVENT,
  FILE_PATH_CARD_LABEL_STORAGE_KEY,
  filePathCardDisplayLabel,
  filePathCardHoverLabel,
  loadFilePathCardLabelPref,
  parseFilePathCardLabelPref,
  saveFilePathCardLabelPref,
  type FilePathCardLabelStorage,
} from "./filePathCardPref";

function memoryStorage(
  initial: Record<string, string> = {},
): FilePathCardLabelStorage & { data: Record<string, string> } {
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

describe("filePathCardPref", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to basename (previous product behavior)", () => {
    expect(DEFAULT_FILE_PATH_CARD_LABEL).toBe("basename");
    expect(parseFilePathCardLabelPref(null)).toBe("basename");
    expect(parseFilePathCardLabelPref("")).toBe("basename");
    expect(parseFilePathCardLabelPref("maybe")).toBe("basename");
    expect(loadFilePathCardLabelPref(memoryStorage())).toBe("basename");
  });

  it("parses original aliases", () => {
    expect(parseFilePathCardLabelPref("original")).toBe("original");
    expect(parseFilePathCardLabelPref("full")).toBe("original");
    expect(parseFilePathCardLabelPref("as-written")).toBe("original");
    expect(parseFilePathCardLabelPref("basename")).toBe("basename");
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveFilePathCardLabelPref("original", s);
    expect(s.data[FILE_PATH_CARD_LABEL_STORAGE_KEY]).toBe("original");
    expect(loadFilePathCardLabelPref(s)).toBe("original");
    saveFilePathCardLabelPref("basename", s);
    expect(s.data[FILE_PATH_CARD_LABEL_STORAGE_KEY]).toBe("basename");
    expect(loadFilePathCardLabelPref(s)).toBe("basename");
  });

  it("dispatches a window event on save", () => {
    const handler = vi.fn();
    window.addEventListener(FILE_PATH_CARD_LABEL_CHANGE_EVENT, handler);
    saveFilePathCardLabelPref("original", memoryStorage());
    expect(handler).toHaveBeenCalledTimes(1);
    const ev = handler.mock.calls[0]![0] as CustomEvent;
    expect(ev.detail).toBe("original");
    window.removeEventListener(FILE_PATH_CARD_LABEL_CHANGE_EVENT, handler);
  });
});

describe("filePathCardDisplayLabel", () => {
  it("basename mode uses the filename, original keeps the token", () => {
    const path = "~/.grok/sandbox.toml";
    expect(
      filePathCardDisplayLabel({ mode: "basename", path }),
    ).toBe("sandbox.toml");
    expect(
      filePathCardDisplayLabel({ mode: "original", path }),
    ).toBe("~/.grok/sandbox.toml");
  });

  it("basename prefers resolved abs when the token is a bare name", () => {
    expect(
      filePathCardDisplayLabel({
        mode: "basename",
        path: "AGENTS.md",
        resolvedAbs: "/Users/me/.codex/AGENTS.md",
      }),
    ).toBe("AGENTS.md");
    expect(
      filePathCardDisplayLabel({
        mode: "original",
        path: "AGENTS.md",
        resolvedAbs: "/Users/me/.codex/AGENTS.md",
      }),
    ).toBe("AGENTS.md");
  });

  it("URL basename is the host; original keeps the href", () => {
    const path = "https://example.com/docs/path";
    expect(
      filePathCardDisplayLabel({ mode: "basename", path, kind: "url" }),
    ).toBe("example.com");
    expect(
      filePathCardDisplayLabel({ mode: "original", path, kind: "url" }),
    ).toBe(path);
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

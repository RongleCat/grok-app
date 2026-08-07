import { describe, expect, it } from "vitest";
import {
  clearComposerSessionDraft,
  COMPOSER_SESSION_DRAFTS_STORAGE_KEY,
  emptyComposerSessionDraft,
  isComposerSessionDraftEmpty,
  loadAllComposerSessionDrafts,
  loadComposerSessionDraft,
  saveComposerSessionDraft,
  sessionDraftKey,
  type ComposerSessionDraftStorage,
} from "./composerSessionDraft";

function memoryStorage(
  seed: Record<string, string> = {},
): ComposerSessionDraftStorage {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

describe("sessionDraftKey", () => {
  it("rejects empty / null", () => {
    expect(sessionDraftKey(null)).toBeNull();
    expect(sessionDraftKey(undefined)).toBeNull();
    expect(sessionDraftKey("")).toBeNull();
    expect(sessionDraftKey("  ")).toBeNull();
  });

  it("trims session ids", () => {
    expect(sessionDraftKey(" abc ")).toBe("abc");
  });
});

describe("isComposerSessionDraftEmpty", () => {
  it("treats whitespace-only as empty", () => {
    expect(isComposerSessionDraftEmpty(null)).toBe(true);
    expect(
      isComposerSessionDraftEmpty({
        text: "  \n  ",
        attachments: [],
        updatedAt: 1,
      }),
    ).toBe(true);
  });

  it("keeps skill-only or attachment drafts", () => {
    expect(
      isComposerSessionDraftEmpty({
        text: "[[skill:foo]]",
        attachments: [],
        updatedAt: 1,
      }),
    ).toBe(false);
    expect(
      isComposerSessionDraftEmpty({
        text: "",
        attachments: [{ path: "/a.png", name: "a.png", isDir: false }],
        updatedAt: 1,
      }),
    ).toBe(false);
  });
});

describe("save / load / clear", () => {
  it("round-trips per session", () => {
    const s = memoryStorage();
    saveComposerSessionDraft(
      "sess-1",
      { text: "hello thread", attachments: [], goalMode: true },
      s,
    );
    saveComposerSessionDraft(
      "sess-2",
      {
        text: "other thread",
        attachments: [{ path: "/x.md", name: "x.md", isDir: false }],
      },
      s,
    );

    expect(loadComposerSessionDraft("sess-1", s)?.text).toBe("hello thread");
    expect(loadComposerSessionDraft("sess-1", s)?.goalMode).toBe(true);
    expect(loadComposerSessionDraft("sess-2", s)?.text).toBe("other thread");
    expect(loadComposerSessionDraft("sess-2", s)?.attachments).toHaveLength(1);
    expect(loadComposerSessionDraft("missing", s)).toBeNull();
    expect(loadComposerSessionDraft(null, s)).toBeNull();
  });

  it("clears empty saves and clearComposerSessionDraft", () => {
    const s = memoryStorage();
    saveComposerSessionDraft("s1", { text: "keep" }, s);
    saveComposerSessionDraft("s1", { text: "   " }, s);
    expect(loadComposerSessionDraft("s1", s)).toBeNull();

    saveComposerSessionDraft("s2", { text: "x" }, s);
    clearComposerSessionDraft("s2", s);
    expect(loadComposerSessionDraft("s2", s)).toBeNull();
  });

  it("ignores corrupt storage", () => {
    const s = memoryStorage({
      [COMPOSER_SESSION_DRAFTS_STORAGE_KEY]: "{not-json",
    });
    expect(loadAllComposerSessionDrafts(s)).toEqual({});
  });

  it("emptyComposerSessionDraft is empty", () => {
    expect(isComposerSessionDraftEmpty(emptyComposerSessionDraft())).toBe(
      true,
    );
  });

  it("does not write when session id is empty", () => {
    const s = memoryStorage();
    saveComposerSessionDraft(null, { text: "nope" }, s);
    saveComposerSessionDraft("  ", { text: "nope" }, s);
    expect(loadAllComposerSessionDrafts(s)).toEqual({});
  });
});

import { describe, expect, it } from "vitest";
import {
  clearComposerProjectDraft,
  COMPOSER_PROJECT_DRAFTS_STORAGE_KEY,
  emptyComposerProjectDraft,
  isComposerProjectDraftEmpty,
  loadAllComposerProjectDrafts,
  loadComposerProjectDraft,
  ORPHAN_PROJECT_DRAFT_KEY,
  projectDraftKey,
  resolveComposerProjectDraftToApply,
  saveComposerProjectDraft,
  composerProjectDraftLooksSent,
  shouldRestoreComposerProjectDraft,
  type ComposerProjectDraftStorage,
} from "./composerProjectDraft";

function memoryStorage(seed: Record<string, string> = {}): ComposerProjectDraftStorage {
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

describe("projectDraftKey", () => {
  it("maps empty / null to orphan", () => {
    expect(projectDraftKey(null)).toBe(ORPHAN_PROJECT_DRAFT_KEY);
    expect(projectDraftKey(undefined)).toBe(ORPHAN_PROJECT_DRAFT_KEY);
    expect(projectDraftKey("")).toBe(ORPHAN_PROJECT_DRAFT_KEY);
    expect(projectDraftKey("  ")).toBe(ORPHAN_PROJECT_DRAFT_KEY);
  });

  it("trims project ids", () => {
    expect(projectDraftKey(" abc ")).toBe("abc");
  });
});

describe("isComposerProjectDraftEmpty", () => {
  it("treats whitespace-only as empty", () => {
    expect(isComposerProjectDraftEmpty(null)).toBe(true);
    expect(
      isComposerProjectDraftEmpty({
        text: "  \n  ",
        attachments: [],
        updatedAt: 1,
      }),
    ).toBe(true);
  });

  it("keeps skill-only, attachment, or quote drafts", () => {
    expect(
      isComposerProjectDraftEmpty({
        text: "[[skill:foo]]",
        attachments: [],
        updatedAt: 1,
      }),
    ).toBe(false);
    expect(
      isComposerProjectDraftEmpty({
        text: "",
        attachments: [{ path: "/a.png", name: "a.png", isDir: false }],
        updatedAt: 1,
      }),
    ).toBe(false);
    expect(
      isComposerProjectDraftEmpty({
        text: "",
        attachments: [],
        quotes: [{ id: "q1", text: "excerpt", comment: "" }],
        updatedAt: 1,
      }),
    ).toBe(false);
  });
});

describe("save / load / clear", () => {
  it("round-trips per project and orphan", () => {
    const s = memoryStorage();
    saveComposerProjectDraft(
      "p1",
      { text: "hello p1", attachments: [], goalMode: true },
      s,
    );
    saveComposerProjectDraft(
      ORPHAN_PROJECT_DRAFT_KEY,
      {
        text: "orphan body",
        attachments: [{ path: "/x.md", name: "x.md", isDir: false }],
      },
      s,
    );

    expect(loadComposerProjectDraft("p1", s)?.text).toBe("hello p1");
    expect(loadComposerProjectDraft("p1", s)?.goalMode).toBe(true);
    expect(loadComposerProjectDraft(ORPHAN_PROJECT_DRAFT_KEY, s)?.text).toBe(
      "orphan body",
    );
    expect(
      loadComposerProjectDraft(ORPHAN_PROJECT_DRAFT_KEY, s)?.attachments,
    ).toHaveLength(1);
    expect(loadComposerProjectDraft("missing", s)).toBeNull();
  });

  it("clears empty saves and clearComposerProjectDraft", () => {
    const s = memoryStorage();
    saveComposerProjectDraft("p1", { text: "keep" }, s);
    saveComposerProjectDraft("p1", { text: "   " }, s);
    expect(loadComposerProjectDraft("p1", s)).toBeNull();

    saveComposerProjectDraft("p2", { text: "x" }, s);
    clearComposerProjectDraft("p2", s);
    expect(loadComposerProjectDraft("p2", s)).toBeNull();
  });

  it("ignores corrupt storage", () => {
    const s = memoryStorage({
      [COMPOSER_PROJECT_DRAFTS_STORAGE_KEY]: "{not-json",
    });
    expect(loadAllComposerProjectDrafts(s)).toEqual({});
  });

  it("emptyComposerProjectDraft is empty", () => {
    expect(isComposerProjectDraftEmpty(emptyComposerProjectDraft())).toBe(
      true,
    );
  });
});

describe("shouldRestoreComposerProjectDraft", () => {
  it("restores a half-typed prompt that was never sent", () => {
    expect(
      shouldRestoreComposerProjectDraft(
        { text: "unsent task", attachments: [], updatedAt: 1 },
        ["something else"],
      ),
    ).toBe(true);
  });

  it("drops a buffer that matches a recently sent prompt", () => {
    const sent = "为什么我的内存占用这么多啊？";
    expect(
      shouldRestoreComposerProjectDraft(
        { text: sent, attachments: [], updatedAt: 1 },
        [sent, "older"],
      ),
    ).toBe(false);
  });

  it("does not restore empty / whitespace drafts", () => {
    expect(shouldRestoreComposerProjectDraft(null, ["x"])).toBe(false);
    expect(
      shouldRestoreComposerProjectDraft(
        { text: "  \n", attachments: [], updatedAt: 1 },
        [],
      ),
    ).toBe(false);
  });

  it("restores attachment-only and quote-only drafts", () => {
    expect(
      shouldRestoreComposerProjectDraft(
        {
          text: "",
          attachments: [{ path: "/a.png", name: "a.png", isDir: false }],
          updatedAt: 1,
        },
        ["hello"],
      ),
    ).toBe(true);
    expect(
      shouldRestoreComposerProjectDraft(
        {
          text: "",
          attachments: [],
          quotes: [{ id: "q1", text: "excerpt", comment: "note" }],
          updatedAt: 1,
        },
        [],
      ),
    ).toBe(true);
  });

  it("resolveComposerProjectDraftToApply wipes sent leftovers", () => {
    const leftover = {
      text: "hello",
      attachments: [] as [],
      updatedAt: 1,
    };
    expect(resolveComposerProjectDraftToApply(leftover, ["hello"])).toBeNull();
    expect(resolveComposerProjectDraftToApply(leftover, ["other"])).toEqual(
      leftover,
    );
  });

  it("drops a mid-type prefix of a later send", () => {
    expect(
      composerProjectDraftLooksSent("好的\n", ["好的\n你看好了吗？"]),
    ).toBe(true);
    expect(
      shouldRestoreComposerProjectDraft(
        { text: "好的\n", attachments: [], updatedAt: 1 },
        ["好的\n你看好了吗？"],
      ),
    ).toBe(false);
  });

  it("drops a short first-line fragment of a later send (Software leftover)", () => {
    expect(
      composerProjectDraftLooksSent("好的\nd", ["好的\n你看好了吗？"]),
    ).toBe(true);
    expect(
      shouldRestoreComposerProjectDraft(
        { text: "好的\nd", attachments: [], updatedAt: 1 },
        ["好的\n你看好了吗？", "已经退出了，那你测试一下？"],
      ),
    ).toBe(false);
  });

  it("keeps a different unsent new-task prompt", () => {
    expect(
      shouldRestoreComposerProjectDraft(
        { text: "帮我看一下这个目录的依赖", attachments: [], updatedAt: 1 },
        ["好的\n你看好了吗？", "继续"],
      ),
    ).toBe(true);
  });
});

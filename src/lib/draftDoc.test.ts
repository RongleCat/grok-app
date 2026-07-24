import { describe, expect, it } from "vitest";
import {
  applySkillAtSlash,
  detectSlashQuery,
  detectSlashQueryFromEditor,
  draftFromPlainText,
  emptyDraft,
  hydrateDisplayContent,
  isDraftEmpty,
  mergeAdjacentText,
  parseStoredContent,
  parseUserMessageContent,
  plainTextOf,
  previewStoredAsSlash,
  segmentsToPlainEditorText,
  serializeForAgent,
  serializeStored,
  type DraftSegment,
} from "./draftDoc";

describe("draftDoc empty / plain", () => {
  it("emptyDraft is empty", () => {
    expect(emptyDraft()).toEqual([]);
    expect(isDraftEmpty(emptyDraft())).toBe(true);
  });

  it("draftFromPlainText", () => {
    expect(draftFromPlainText("")).toEqual([]);
    expect(draftFromPlainText("hi")).toEqual([{ type: "text", text: "hi" }]);
  });

  it("isDraftEmpty ignores whitespace-only text", () => {
    expect(isDraftEmpty([{ type: "text", text: "  \n\t" }])).toBe(true);
    expect(isDraftEmpty([{ type: "text", text: "a" }])).toBe(false);
    expect(isDraftEmpty([{ type: "skill", name: "x" }])).toBe(false);
    expect(
      isDraftEmpty([
        { type: "text", text: "  " },
        { type: "skill", name: "x" },
      ]),
    ).toBe(false);
  });

  it("plainTextOf omits skills", () => {
    const segs: DraftSegment[] = [
      { type: "text", text: "a" },
      { type: "skill", name: "foo" },
      { type: "text", text: "b" },
    ];
    expect(plainTextOf(segs)).toBe("ab");
  });
});

describe("draftDoc roundtrip", () => {
  it("parseStoredContent ↔ serializeStored", () => {
    const raw = "hello [[skill:my-skill]] world [[skill:a.b:c_1]]!";
    const segs = parseStoredContent(raw);
    expect(segs).toEqual([
      { type: "text", text: "hello " },
      { type: "skill", name: "my-skill" },
      { type: "text", text: " world " },
      { type: "skill", name: "a.b:c_1" },
      { type: "text", text: "!" },
    ]);
    expect(serializeStored(segs)).toBe(raw);
    expect(segmentsToPlainEditorText(segs)).toBe(raw);
  });

  it("plain text roundtrip", () => {
    const raw = "no skills here";
    expect(serializeStored(parseStoredContent(raw))).toBe(raw);
  });

  it("leaves invalid tokens as text", () => {
    const raw = "[[skill:bad name]] [[skill:]]";
    const segs = parseStoredContent(raw);
    expect(segs.every((s) => s.type === "text")).toBe(true);
    expect(serializeStored(segs)).toBe(raw);
  });
});

describe("detectSlashQuery", () => {
  it("triggers at start", () => {
    expect(detectSlashQuery("/")).toEqual({ start: 0, query: "" });
    expect(detectSlashQuery("/go")).toEqual({ start: 0, query: "go" });
  });

  it('triggers after whitespace ("a /x")', () => {
    expect(detectSlashQuery("a /x")).toEqual({ start: 2, query: "x" });
    expect(detectSlashQuery("hello\n/foo")).toEqual({ start: 6, query: "foo" });
  });

  it("does not trigger on https://", () => {
    expect(detectSlashQuery("https://")).toBeNull();
    expect(detectSlashQuery("see https://example.com/path")).toBeNull();
  });

  it("null when no trailing slash token", () => {
    expect(detectSlashQuery("")).toBeNull();
    expect(detectSlashQuery("hello")).toBeNull();
    expect(detectSlashQuery("a /x more")).toBeNull();
  });

  it("supports Chinese query after slash", () => {
    expect(detectSlashQuery("/目标")).toEqual({ start: 0, query: "目标" });
    expect(detectSlashQuery("a /计划")).toEqual({ start: 2, query: "计划" });
    expect(detectSlashQuery("/热点资讯")).toEqual({
      start: 0,
      query: "热点资讯",
    });
  });

  it("normalizes fullwidth slash and zero-width chars from IME", () => {
    expect(detectSlashQuery("／目标")).toEqual({ start: 0, query: "目标" });
    expect(detectSlashQuery("/\u200B目标")).toEqual({ start: 0, query: "目标" });
    expect(detectSlashQuery("/目\u200C标")).toEqual({ start: 0, query: "目标" });
  });

  it("ignores trailing newlines/nbsp from contenteditable <br>", () => {
    // This was the production bug: panel showed full list for `/目标` because
    // serializeDom appends \n for the trailing <br> WebKit inserts.
    expect(detectSlashQuery("/目标\n")).toEqual({ start: 0, query: "目标" });
    expect(detectSlashQuery("/目标\n\n")).toEqual({ start: 0, query: "目标" });
    expect(detectSlashQuery("/go\n")).toEqual({ start: 0, query: "go" });
    expect(detectSlashQuery("/目标\u00a0")).toEqual({ start: 0, query: "目标" });
    expect(detectSlashQuery("hello\n/plan\n")).toEqual({
      start: 6,
      query: "plan",
    });
  });
});

describe("detectSlashQueryFromEditor", () => {
  it("returns null for null element", () => {
    expect(detectSlashQueryFromEditor(null)).toBeNull();
  });
});

describe("previewStoredAsSlash", () => {
  it("replaces skill tokens in place (order preserved)", () => {
    expect(previewStoredAsSlash("hello [[skill:foo]] world")).toBe(
      "hello /foo world",
    );
    expect(previewStoredAsSlash("[[skill:a]][[skill:b]] x")).toBe("/a/b x");
  });
});

describe("serializeForAgent", () => {
  it("multi skill + text", () => {
    const segs: DraftSegment[] = [
      { type: "skill", name: "alpha" },
      { type: "text", text: " please " },
      { type: "skill", name: "beta" },
      { type: "text", text: "run this\nnow  " },
    ];
    expect(serializeForAgent(segs)).toBe("/alpha /beta\nplease run this\nnow");
  });

  it("goalMode prefixes /goal\\n", () => {
    const segs: DraftSegment[] = [
      { type: "skill", name: "x" },
      { type: "text", text: "do it" },
    ];
    expect(serializeForAgent(segs, { goalMode: true })).toBe(
      "/goal\n/x\ndo it",
    );
    expect(serializeForAgent([], { goalMode: true })).toBe("/goal");
    expect(
      serializeForAgent([{ type: "text", text: "only" }], { goalMode: true }),
    ).toBe("/goal\nonly");
  });

  it("skills only / text only", () => {
    expect(
      serializeForAgent([
        { type: "skill", name: "a" },
        { type: "skill", name: "b" },
      ]),
    ).toBe("/a /b");
    expect(serializeForAgent([{ type: "text", text: "  hi  " }])).toBe("hi");
  });
});

describe("applySkillAtSlash", () => {
  it("replaces slash range with token + trailing space", () => {
    const stored = "hi /foo bar";
    // slash at 3, end after "foo" = 7
    expect(applySkillAtSlash(stored, 3, 7, "foo")).toBe(
      "hi [[skill:foo]]  bar",
    );
  });

  it("works at start", () => {
    expect(applySkillAtSlash("/aih", 0, 4, "aihot")).toBe("[[skill:aihot]] ");
  });
});

describe("mergeAdjacentText", () => {
  it("merges consecutive text segments", () => {
    const segs: DraftSegment[] = [
      { type: "text", text: "a" },
      { type: "text", text: "b" },
      { type: "skill", name: "x" },
      { type: "text", text: "c" },
      { type: "text", text: "d" },
    ];
    expect(mergeAdjacentText(segs)).toEqual([
      { type: "text", text: "ab" },
      { type: "skill", name: "x" },
      { type: "text", text: "cd" },
    ]);
  });
});

describe("hydrateDisplayContent", () => {
  it("converts agent-form skill line to chips", () => {
    const raw = "/xhx-media-gen\n画一张小猫喝水的图片，卡通怪诞画风";
    expect(hydrateDisplayContent(raw)).toBe(
      "[[skill:xhx-media-gen]]\n画一张小猫喝水的图片，卡通怪诞画风",
    );
    const segs = parseUserMessageContent(raw);
    expect(segs[0]).toEqual({ type: "skill", name: "xhx-media-gen" });
  });

  it("converts multi-skill first line", () => {
    expect(hydrateDisplayContent("/a /b\nhello")).toBe(
      "[[skill:a]][[skill:b]]\nhello",
    );
  });

  it("leaves [[skill:]] alone", () => {
    const raw = "[[skill:x]] hi";
    expect(hydrateDisplayContent(raw)).toBe(raw);
  });

  it("does not convert builtin commands", () => {
    expect(hydrateDisplayContent("/compact keep auth")).toBe(
      "/compact keep auth",
    );
    expect(hydrateDisplayContent("/doctor")).toBe("/doctor");
  });

  it("strips goal prefix then converts skills", () => {
    expect(hydrateDisplayContent("/goal\n/xhx-media-gen\nhi")).toBe(
      "[[skill:xhx-media-gen]]\nhi",
    );
  });
});

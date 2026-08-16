import { describe, expect, it } from "vitest";
import {
  findChatMatches,
  findMatchesBeforeVisible,
  formatChatFindCount,
  searchableTextForMessage,
  splitHighlightParts,
  stepChatFindIndex,
  type ChatFindMessage,
} from "./chatFind";

const msgs: ChatFindMessage[] = [
  { id: "u1", role: "user", content: "Please fix the Doctor reset flow" },
  {
    id: "a1",
    role: "assistant",
    content: "I'll inspect Doctor reset and the doctor CLI path.",
  },
  {
    id: "t1",
    role: "tool",
    content: "tool_step|completed|read|Read doctor.rs\n/tmp/doctor.rs",
    toolTitle: "Read doctor.rs",
    marker: "tool_step",
  },
  { id: "u2", role: "user", content: "Also update README" },
];

describe("searchableTextForMessage", () => {
  it("uses content for user/assistant", () => {
    expect(searchableTextForMessage(msgs[0]!)).toContain("Doctor");
    expect(searchableTextForMessage(msgs[1]!)).toContain("doctor CLI");
  });

  it("prefers toolTitle for tools", () => {
    expect(searchableTextForMessage(msgs[2]!)).toBe("Read doctor.rs");
  });

  it("parses tool_step header when title missing", () => {
    expect(
      searchableTextForMessage({
        id: "t",
        role: "tool",
        content: "tool_step|running|bash|Run cargo test",
        marker: "tool_step",
      }),
    ).toBe("Run cargo test");
  });
});

describe("findChatMatches", () => {
  it("returns empty for blank query", () => {
    expect(findChatMatches("  ", msgs)).toEqual([]);
    expect(findChatMatches("", msgs)).toEqual([]);
  });

  it("matches case-insensitively across messages", () => {
    const hits = findChatMatches("doctor", msgs);
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(hits[0]?.messageId).toBe("u1");
    expect(hits.map((h) => h.messageId)).toContain("a1");
    expect(hits.map((h) => h.messageId)).toContain("t1");
    // Global indices are dense 0..n-1
    expect(hits.map((h) => h.index)).toEqual(hits.map((_, i) => i));
  });

  it("tracks per-message occurrence", () => {
    const hits = findChatMatches("doctor", msgs);
    const inA1 = hits.filter((h) => h.messageId === "a1");
    // "Doctor" + "doctor" in assistant content
    expect(inA1.length).toBe(2);
    expect(inA1[0]?.occurrence).toBe(0);
    expect(inA1[1]?.occurrence).toBe(1);
  });

  it("records start/end offsets into searchable text", () => {
    const hits = findChatMatches("README", msgs);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.messageId).toBe("u2");
    expect(hits[0]?.start).toBe(msgs[3]!.content.indexOf("README"));
    expect(hits[0]?.end - hits[0]!.start).toBe("README".length);
  });

  it("does not match roles outside chat findables", () => {
    const hits = findChatMatches("x", [
      { id: "sys", role: "system", content: "xxx" },
    ]);
    expect(hits).toHaveLength(0);
  });
});

describe("findMatchesBeforeVisible", () => {
  it("counts hits in the folded prefix of a process + conclusion body", () => {
    const process =
      "先把 8 张 hard-set 都 decode。接着补重试。8 张 decode 稿都出了。";
    const answer = "成品文件名带 -decode，旧的手写成品没动。";
    expect(
      findMatchesBeforeVisible({
        full: `${process}\n\n${answer}`,
        visible: answer,
        query: "decode",
      }),
    ).toBe(2);
    expect(
      findMatchesBeforeVisible({
        full: `${process}\n\n${answer}`,
        visible: answer,
        query: "成品",
      }),
    ).toBe(0);
  });

  it("returns 0 when the visible slice is the whole body", () => {
    expect(
      findMatchesBeforeVisible({
        full: "正在写结论，还没有分段。",
        visible: "正在写结论，还没有分段。",
        query: "结论",
      }),
    ).toBe(0);
  });
});

describe("stepChatFindIndex", () => {
  it("wraps forward and backward", () => {
    expect(stepChatFindIndex(0, 3, 1)).toBe(1);
    expect(stepChatFindIndex(2, 3, 1)).toBe(0);
    expect(stepChatFindIndex(0, 3, -1)).toBe(2);
    expect(stepChatFindIndex(1, 3, -1)).toBe(0);
  });

  it("handles empty / out-of-range", () => {
    expect(stepChatFindIndex(0, 0, 1)).toBe(0);
    expect(stepChatFindIndex(-1, 4, 1)).toBe(0);
    expect(stepChatFindIndex(99, 4, -1)).toBe(3);
  });
});

describe("splitHighlightParts", () => {
  it("returns plain when no query", () => {
    expect(splitHighlightParts("Hello", "")).toEqual([
      { text: "Hello", match: false },
    ]);
  });

  it("splits multiple case-insensitive hits", () => {
    const parts = splitHighlightParts("Foo doctor FOO", "foo");
    expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual([
      "Foo",
      "FOO",
    ]);
    expect(parts.filter((p) => p.match).map((p) => p.occurrence)).toEqual([
      0, 1,
    ]);
    expect(parts.map((p) => p.text).join("")).toBe("Foo doctor FOO");
  });
});

describe("formatChatFindCount", () => {
  it("is 1-based for display and zero when empty", () => {
    expect(formatChatFindCount(0, 5)).toEqual({ current: 1, total: 5 });
    expect(formatChatFindCount(4, 5)).toEqual({ current: 5, total: 5 });
    expect(formatChatFindCount(0, 0)).toEqual({ current: 0, total: 0 });
  });
});

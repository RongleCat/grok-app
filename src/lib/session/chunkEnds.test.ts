import { describe, expect, it } from "vitest";
import { compactMessageSegments } from "./segments";
import { applyStreamChunk } from "./stream";
import type { ChatMessage, MessageSegment, StreamPayload } from "./types";

function chunk(
  text: string,
  chunkLens?: number[],
  done = false,
): StreamPayload {
  return {
    sessionId: "s1",
    messageId: "m1",
    text,
    done,
    kind: "assistant",
    chunkLens,
  };
}

function contentSegment(messages: ChatMessage[]): MessageSegment | undefined {
  return messages[0]?.segments?.find((segment) => segment.kind === "content");
}

function contentEnds(messages: ChatMessage[]): number[] | undefined {
  const segment = contentSegment(messages);
  return segment?.kind === "content" ? segment.chunkEnds : undefined;
}

describe("content chunk boundaries", () => {
  it("accumulates UTF-16 end offsets in arrival order", () => {
    let messages = applyStreamChunk([], chunk("Hello ", [6]));

    expect(contentEnds(messages)).toEqual([6]);

    messages = applyStreamChunk(messages, chunk("世界😀", [4]));

    expect(messages[0]?.content).toBe("Hello 世界😀");
    expect(contentEnds(messages)).toEqual([6, 10]);
    // Sum of boundaries equals the text length in UTF-16 code units.
    expect(contentEnds(messages)?.at(-1)).toBe(messages[0]!.content.length);
  });

  it("marks text without host lengths as one chunk before new boundaries", () => {
    let messages = applyStreamChunk([], chunk("Hello "));

    expect(contentEnds(messages)).toBeUndefined();

    messages = applyStreamChunk(messages, chunk("world.", [6]));

    expect(contentEnds(messages)).toEqual([6, 12]);
  });

  it("keeps offsets absolute after a chunk with no lengths", () => {
    let messages = applyStreamChunk([], chunk("Hello ", [6]));
    messages = applyStreamChunk(messages, chunk("!", undefined));
    messages = applyStreamChunk(messages, chunk(" Bye", [4]));

    expect(messages[0]?.content).toBe("Hello ! Bye");
    expect(contentEnds(messages)).toEqual([6, 7, 11]);
  });

  it("records thought boundaries the same way as content", () => {
    const messages = applyStreamChunk([], {
      ...chunk("thinking", [8]),
      kind: "thought",
    });

    const thought = messages[0]?.segments?.find((s) => s.kind === "thought");
    expect(thought).toEqual({ kind: "thought", text: "thinking", chunkEnds: [8] });
  });

  it("shifts boundaries when compacting adjacent content segments", () => {
    const merged = compactMessageSegments([
      { kind: "content", text: "Hello ", chunkEnds: [6] },
      { kind: "content", text: "world.", chunkEnds: [6] },
    ]);

    expect(merged).toEqual([
      { kind: "content", text: "Hello world.", chunkEnds: [6, 12] },
    ]);
  });
});

function thoughtSegment(messages: ChatMessage[]): MessageSegment | undefined {
  return messages[0]?.segments?.find((segment) => segment.kind === "thought");
}

function thoughtText(messages: ChatMessage[]): string | undefined {
  const segment = thoughtSegment(messages);
  return segment?.kind === "thought" ? segment.text : undefined;
}

function thoughtEnds(messages: ChatMessage[]): number[] | undefined {
  const segment = thoughtSegment(messages);
  return segment?.kind === "thought" ? segment.chunkEnds : undefined;
}

describe("thought chunk boundaries", () => {
  it("accumulates UTF-16 end offsets for CJK and emoji", () => {
    let messages = applyStreamChunk([], {
      ...chunk("思考", [2]),
      kind: "thought",
    });
    messages = applyStreamChunk(messages, {
      ...chunk("😀完成", [4]),
      kind: "thought",
    });

    expect(thoughtText(messages)).toBe("思考😀完成");
    expect(thoughtEnds(messages)).toEqual([2, 6]);
    expect(thoughtEnds(messages)?.at(-1)).toBe(thoughtText(messages)?.length);
  });

  it("covers thought text appended without chunk lengths", () => {
    let messages = applyStreamChunk([], {
      ...chunk("思考", [2]),
      kind: "thought",
    });
    messages = applyStreamChunk(messages, {
      ...chunk("继续"),
      kind: "thought",
    });

    expect(thoughtText(messages)).toBe("思考继续");
    // A segment without a length table still gets an end boundary, otherwise
    // the trailing segment would replay on remount.
    expect(thoughtEnds(messages)).toEqual([2, 4]);
  });

  it("keeps offsets absolute after a thought chunk without lengths", () => {
    let messages = applyStreamChunk([], {
      ...chunk("想"),
      kind: "thought",
    });
    expect(thoughtEnds(messages)).toBeUndefined();

    messages = applyStreamChunk(messages, {
      ...chunk("😀", [2]),
      kind: "thought",
    });

    expect(thoughtText(messages)).toBe("想😀");
    expect(thoughtEnds(messages)).toEqual([1, 3]);
  });

  it("shifts thought boundaries across the trimmed phase break", () => {
    const merged = compactMessageSegments([
      { kind: "thought", text: "先看 ", chunkEnds: [3] },
      { kind: "thought", text: " 再看😀", chunkEnds: [5] },
    ]);

    expect(merged).toEqual([
      { kind: "thought", text: "先看\n\n再看😀", chunkEnds: [2, 8] },
    ]);
    const thought = merged[0];
    const ends = thought?.kind === "thought" ? thought.chunkEnds : undefined;
    expect(ends?.at(-1)).toBe(thought?.kind === "thought" ? thought.text.length : 0);
  });

  it("covers the merged tail when the incoming thought has no boundaries", () => {
    const merged = compactMessageSegments([
      { kind: "thought", text: "先看", chunkEnds: [2] },
      { kind: "thought", text: " 再看" },
    ]);

    expect(merged).toEqual([
      { kind: "thought", text: "先看\n\n再看", chunkEnds: [2, 6] },
    ]);
  });

  it("does not invent boundaries when neither thought side has them", () => {
    const merged = compactMessageSegments([
      { kind: "thought", text: "a" },
      { kind: "thought", text: "b" },
    ]);

    expect(merged).toEqual([{ kind: "thought", text: "a\n\nb" }]);
  });
});

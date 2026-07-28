import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./session";
import {
  adjacentNode,
  buildSessionMessageNodes,
  isMessageNodeCandidate,
  isThoughtOnlyAssistant,
  nearestNodeForMessageIndex,
  pickActiveNodeIdFromRects,
  truncateNodePreview,
} from "./sessionMessageNodes";

function msg(
  partial: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role">,
): ChatMessage {
  return {
    content: partial.content ?? "",
    ...partial,
  };
}

describe("isMessageNodeCandidate", () => {
  it("accepts user and assistant", () => {
    expect(isMessageNodeCandidate(msg({ id: "u", role: "user" }))).toBe(true);
    expect(
      isMessageNodeCandidate(msg({ id: "a", role: "assistant", content: "hi" })),
    ).toBe(true);
  });

  it("rejects tool, interjection, end markers", () => {
    expect(
      isMessageNodeCandidate(msg({ id: "t", role: "tool", marker: "tool_step" })),
    ).toBe(false);
    expect(
      isMessageNodeCandidate(
        msg({ id: "i", role: "user", marker: "interjection", content: "steer" }),
      ),
    ).toBe(false);
    expect(
      isMessageNodeCandidate(
        msg({ id: "e", role: "assistant", marker: "turn_cancelled" }),
      ),
    ).toBe(false);
  });

  it("rejects thought-only / empty streaming assistant (not a reply node)", () => {
    expect(
      isMessageNodeCandidate(
        msg({
          id: "think",
          role: "assistant",
          content: "",
          thought: "reasoning…",
          streaming: true,
        }),
      ),
    ).toBe(false);
    expect(
      isMessageNodeCandidate(
        msg({
          id: "shell",
          role: "assistant",
          content: "   ",
          streaming: true,
        }),
      ),
    ).toBe(false);
  });

  it("accepts assistant once reply body exists (thought may still be present)", () => {
    expect(
      isMessageNodeCandidate(
        msg({
          id: "a",
          role: "assistant",
          content: "Here is the answer",
          thought: "I should explain…",
        }),
      ),
    ).toBe(true);
  });
});

describe("isThoughtOnlyAssistant", () => {
  it("is true for empty-body assistant, false when body or error", () => {
    expect(
      isThoughtOnlyAssistant(
        msg({ id: "t", role: "assistant", content: "", thought: "…" }),
      ),
    ).toBe(true);
    expect(
      isThoughtOnlyAssistant(
        msg({ id: "a", role: "assistant", content: "hi", thought: "…" }),
      ),
    ).toBe(false);
    expect(
      isThoughtOnlyAssistant(
        msg({ id: "e", role: "assistant", content: "", isError: true }),
      ),
    ).toBe(false);
  });
});

describe("buildSessionMessageNodes", () => {
  it("emits one node per user/assistant in order", () => {
    const messages = [
      msg({ id: "u1", role: "user", content: "Hello world" }),
      msg({ id: "a1", role: "assistant", content: "Hi there" }),
      msg({
        id: "t1",
        role: "tool",
        marker: "tool_step",
        content: "tool_step|done|shell|ls",
      }),
      msg({ id: "u2", role: "user", content: "Next" }),
      msg({ id: "a2", role: "assistant", content: "Ok", isError: true }),
    ];
    const nodes = buildSessionMessageNodes(messages);
    expect(nodes.map((n) => n.id)).toEqual(["u1", "a1", "u2", "a2"]);
    expect(nodes.map((n) => n.nodeIndex)).toEqual([0, 1, 2, 3]);
    expect(nodes[0]?.role).toBe("user");
    expect(nodes[0]?.promptIndex).toBe(0);
    expect(nodes[1]?.role).toBe("assistant");
    expect(nodes[1]?.promptIndex).toBeNull();
    expect(nodes[2]?.promptIndex).toBe(1);
    expect(nodes[3]?.status).toBe("error");
    expect(nodes[0]?.messageIndex).toBe(0);
    expect(nodes[1]?.messageIndex).toBe(1);
    expect(nodes[2]?.messageIndex).toBe(3);
  });

  it("does not add a node while assistant is thinking with no body", () => {
    const nodes = buildSessionMessageNodes([
      msg({ id: "u", role: "user", content: "q" }),
      msg({
        id: "a",
        role: "assistant",
        content: "",
        thought: "planning…",
        streaming: true,
      }),
    ]);
    expect(nodes.map((n) => n.id)).toEqual(["u"]);
  });

  it("adds assistant node after reply body appears (pending while streaming)", () => {
    const nodes = buildSessionMessageNodes([
      msg({ id: "u", role: "user", content: "q" }),
      msg({
        id: "a",
        role: "assistant",
        content: "partial answer",
        thought: "planning…",
        streaming: true,
      }),
    ]);
    expect(nodes.map((n) => n.id)).toEqual(["u", "a"]);
    expect(nodes[1]?.status).toBe("pending");
    expect(nodes[1]?.preview).toContain("partial answer");
  });
});

describe("truncateNodePreview", () => {
  it("collapses whitespace and ellipsizes", () => {
    expect(truncateNodePreview("  a   b  ")).toBe("a b");
    expect(truncateNodePreview("x".repeat(100)).endsWith("…")).toBe(true);
  });
});

describe("nearestNodeForMessageIndex / adjacentNode", () => {
  const nodes = buildSessionMessageNodes([
    msg({ id: "u1", role: "user", content: "a" }),
    msg({ id: "a1", role: "assistant", content: "b" }),
    msg({ id: "u2", role: "user", content: "c" }),
  ]);

  it("picks nearest node at or before index", () => {
    expect(nearestNodeForMessageIndex(nodes, 0)?.id).toBe("u1");
    expect(nearestNodeForMessageIndex(nodes, 1)?.id).toBe("a1");
    // tool gap would be index 2 → still a1 if only 0,1,2 user/asst
    expect(nearestNodeForMessageIndex(nodes, 2)?.id).toBe("u2");
  });

  it("steps adjacent nodes", () => {
    expect(adjacentNode(nodes, "u1", 1)?.id).toBe("a1");
    expect(adjacentNode(nodes, "a1", -1)?.id).toBe("u1");
    expect(adjacentNode(nodes, "u1", -1)).toBeNull();
    expect(adjacentNode(nodes, "u2", 1)).toBeNull();
  });
});

describe("pickActiveNodeIdFromRects", () => {
  it("prefers the last node whose top is above the focus line (tall prev)", () => {
    // Long first message still covers the viewport center, but second has
    // started — reading position should be the second node.
    const id = pickActiveNodeIdFromRects(
      [
        { id: "a", top: 0, bottom: 800 },
        { id: "b", top: 200, bottom: 280 },
      ],
      250,
    );
    expect(id).toBe("b");
  });

  it("falls back to nearest center when all nodes are below focus", () => {
    const id = pickActiveNodeIdFromRects(
      [
        { id: "a", top: 400, bottom: 480 },
        { id: "b", top: 500, bottom: 560 },
      ],
      100,
    );
    expect(id).toBe("a");
  });
});

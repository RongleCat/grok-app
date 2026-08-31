import { describe, expect, it } from "vitest";
import {
  applyStreamChunk,
  contentLooksLikeThought,
  messageSegments,
  toolSegmentFromFields,
  upgradeMessagesFromJournal,
  weaveToolsIntoAssistantSegments,
  type ChatMessage,
} from "./session";
import { StreamCoalescer } from "./streamCoalesce";
import { buildAssistantTimeline } from "./timelinePhases";

describe("thinking painted as the final reply until remount", () => {
  it("contentLooksLikeThought catches leaked CoT in the body field", () => {
    expect(contentLooksLikeThought("plan the pdf", "plan the pdf")).toBe(true);
    expect(contentLooksLikeThought("FINAL", "plan")).toBe(false);
    expect(contentLooksLikeThought("", "plan")).toBe(false);
    // A short real reply that happens to prefix CoT is still an answer.
    expect(contentLooksLikeThought("Yes", "Yes, and then the rest of the plan")).toBe(
      false,
    );
  });

  it("messageSegments lifts a real answer that only lives on the content field", () => {
    // Live thought-only segs + content field already filled (heal / late
    // journal). Paint used segs, so CoT looked like the reply until remount
    // rebuilt from fields.
    const segs = messageSegments({
      id: "a1",
      role: "assistant",
      content: "FINAL ANSWER",
      thought: "plan the layout",
      streaming: false,
      segments: [{ kind: "thought", text: "plan the layout" }],
    });
    expect(segs.some((s) => s.kind === "content" && s.text.includes("FINAL"))).toBe(
      true,
    );
    expect(segs.some((s) => s.kind === "thought" && s.text.includes("plan"))).toBe(
      true,
    );
  });

  it("does not promote leaked thought text into a content segment", () => {
    const thought = "plan the layout";
    const segs = messageSegments({
      id: "a1",
      role: "assistant",
      content: thought,
      thought,
      streaming: false,
      segments: [{ kind: "thought", text: thought }],
    });
    expect(segs.filter((s) => s.kind === "content")).toEqual([]);
    expect(segs).toEqual([{ kind: "thought", text: thought }]);
  });

  it("weave keeps the answer when live segs are still thought-only", () => {
    const woven = weaveToolsIntoAssistantSegments([
      { id: "u1", role: "user", content: "write pdf" },
      {
        id: "a1",
        role: "assistant",
        content: "Here is the PDF.",
        thought: "plan the layout",
        streaming: false,
        segments: [{ kind: "thought", text: "plan the layout" }],
      },
      {
        id: "tool-t1",
        role: "tool",
        content: "tool_step|completed|write|pdf",
        marker: "tool_step",
        toolCallId: "t1",
        toolKind: "write",
        toolStatus: "completed",
      },
    ]);
    const asst = woven.find((m) => m.id === "a1")!;
    expect(asst.content).toContain("PDF");
    const segs = messageSegments(asst);
    expect(segs.some((s) => s.kind === "content" && s.text.includes("PDF"))).toBe(
      true,
    );
    const units = buildAssistantTimeline(segs, { streaming: false });
    expect(units.some((u) => u.kind === "content")).toBe(true);
  });

  it("applyStreamChunk fills a settled thought-only bubble without remount", () => {
    const msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: "write pdf" },
      {
        id: "a1",
        role: "assistant",
        content: "",
        thought: "plan the layout",
        streaming: false,
        segments: [{ kind: "thought", text: "plan the layout" }],
      },
    ];
    const out = applyStreamChunk(msgs, {
      sessionId: "s1",
      messageId: "a-new",
      text: "Here is the PDF.",
      done: true,
      kind: "assistant",
    });
    const asst = out.find((m) => m.role === "assistant")!;
    expect(out.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect(asst.content).toContain("PDF");
    expect(asst.streaming).toBe(false);
    expect(
      messageSegments(asst).some(
        (s) => s.kind === "content" && s.text.includes("PDF"),
      ),
    ).toBe(true);
  });

  it("late thought after settle does not re-open 思考中", () => {
    const msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: "q" },
      {
        id: "a1",
        role: "assistant",
        content: "done",
        thought: "plan",
        streaming: false,
        segments: [
          { kind: "thought", text: "plan" },
          { kind: "content", text: "done" },
        ],
      },
    ];
    const out = applyStreamChunk(msgs, {
      sessionId: "s1",
      messageId: "a1",
      text: " leftover",
      done: false,
      kind: "thought",
    });
    expect(out.find((m) => m.id === "a1")?.streaming).toBe(false);
    expect(out.find((m) => m.id === "a1")?.content).toBe("done");
  });

  it("upgradeMessagesFromJournal adds a content segment when the field is already filled", () => {
    const ui: ChatMessage[] = [
      { id: "u1", role: "user", content: "write pdf" },
      {
        id: "a1",
        role: "assistant",
        content: "Here is the PDF.",
        thought: "plan the layout",
        streaming: false,
        segments: [
          { kind: "thought", text: "plan the layout" },
          toolSegmentFromFields({
            toolCallId: "t1",
            title: "write",
            status: "completed",
          }),
        ],
      },
    ];
    const journal: ChatMessage[] = [
      { id: "u1", role: "user", content: "write pdf" },
      {
        id: "a1",
        role: "assistant",
        content: "Here is the PDF.",
        thought: "plan the layout",
      },
    ];
    const out = upgradeMessagesFromJournal(ui, journal);
    const asst = out.find((m) => m.id === "a1")!;
    expect(
      messageSegments(asst).some(
        (s) => s.kind === "content" && s.text.includes("PDF"),
      ),
    ).toBe(true);
  });

  it("upgradeMessagesFromJournal replaces thought-as-body with the journal answer", () => {
    const thought = "planning fonts and margins for a long time…";
    const ui: ChatMessage[] = [
      { id: "u1", role: "user", content: "write pdf" },
      {
        id: "a1",
        role: "assistant",
        content: thought,
        thought,
        streaming: false,
        segments: [{ kind: "thought", text: thought }],
      },
    ];
    const journal: ChatMessage[] = [
      { id: "u1", role: "user", content: "write pdf" },
      {
        id: "a1",
        role: "assistant",
        content: "Here is the PDF.",
        thought,
      },
    ];
    const out = upgradeMessagesFromJournal(ui, journal);
    const asst = out.find((m) => m.id === "a1")!;
    expect(asst.content).toBe("Here is the PDF.");
    expect(
      messageSegments(asst).some(
        (s) => s.kind === "content" && s.text.includes("PDF"),
      ),
    ).toBe(true);
  });

  it("stream coalescer flushes pending thought before a done assistant tick", () => {
    const out: Array<{ kind?: string | null; text?: string | null; done?: boolean | null }> =
      [];
    const c = new StreamCoalescer({
      flushMs: 1000,
      onFlush: (ch) => out.push({ kind: ch.kind, text: ch.text, done: ch.done }),
    });
    c.push({
      sessionId: "s",
      messageId: "m",
      kind: "thought",
      text: "plan",
    });
    c.push({
      sessionId: "s",
      messageId: "m",
      kind: "assistant",
      text: "answer",
      done: true,
    });
    expect(out.map((x) => x.kind)).toEqual(["thought", "assistant"]);
    expect(out[0]!.text).toBe("plan");
    expect(out[1]!.text).toBe("answer");
    expect(out[1]!.done).toBe(true);
    c.dispose();
  });
});

import { describe, expect, it } from "vitest";
import {
  JOURNAL_REHYDRATE_RETRY_GAPS_MS,
  shouldApplyLateStreamText,
  shouldHealJournalOnStreamDone,
  shouldIgnorePrematureStreamDone,
} from "./streamLateToken";

describe("shouldApplyLateStreamText", () => {
  it("always applies when host is still live-streaming", () => {
    expect(
      shouldApplyLateStreamText({
        hostLiveStreaming: true,
        chunkIsForFocusedHost: true,
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", streaming: true, content: "" },
        ],
      }),
    ).toBe(true);
  });

  it("always applies for background (non-focused) sessions", () => {
    expect(
      shouldApplyLateStreamText({
        hostLiveStreaming: false,
        chunkIsForFocusedHost: false,
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", streaming: false, content: "done" },
        ],
      }),
    ).toBe(true);
  });

  it("applies late body after thinking when host already ready", () => {
    // User report: thinking finished, host ready, answer tokens still arrive.
    // Ready path may clear streaming=false while thought is already present.
    expect(
      shouldApplyLateStreamText({
        hostLiveStreaming: false,
        chunkIsForFocusedHost: true,
        messages: [
          { role: "user", content: "write pdf" },
          {
            role: "assistant",
            streaming: false,
            content: "",
            thought: "planning the pdf…",
          },
        ],
      }),
    ).toBe(true);
  });

  it("applies when streaming flag stuck true after ready", () => {
    expect(
      shouldApplyLateStreamText({
        hostLiveStreaming: false,
        chunkIsForFocusedHost: true,
        messages: [
          { role: "user", content: "q" },
          { role: "assistant", streaming: true, content: "partial " },
        ],
      }),
    ).toBe(true);
  });

  it("drops pure replay once body is settled", () => {
    expect(
      shouldApplyLateStreamText({
        hostLiveStreaming: false,
        chunkIsForFocusedHost: true,
        messages: [
          { role: "user", content: "q" },
          { role: "assistant", streaming: false, content: "final answer" },
        ],
      }),
    ).toBe(false);
  });

  it("applies late answer after a tool-only bubble was settled by early ready", () => {
    // Repro: long tool turn → stream done / host ready first → real answer
    // tokens. Old code treated empty+no-thought as "settled final" and
    // dropped the body. Switching sessions remounted from journal and
    // the text appeared.
    expect(
      shouldApplyLateStreamText({
        hostLiveStreaming: false,
        chunkIsForFocusedHost: true,
        messages: [
          { role: "user", content: "删掉昨晚的 branches" },
          {
            role: "assistant",
            streaming: false,
            content: "",
            thought: "",
          },
        ],
      }),
    ).toBe(true);
  });

  it("ignores stream-done while host or tools are still live", () => {
    expect(
      shouldIgnorePrematureStreamDone({
        hostLiveStreaming: true,
        hasRunningTool: false,
      }),
    ).toBe(true);
    expect(
      shouldIgnorePrematureStreamDone({
        hostLiveStreaming: false,
        hasRunningTool: true,
      }),
    ).toBe(true);
    expect(
      shouldIgnorePrematureStreamDone({
        hostLiveStreaming: false,
        hasRunningTool: false,
      }),
    ).toBe(false);
  });

  it("applies when no assistant yet (first body chunk after ready)", () => {
    expect(
      shouldApplyLateStreamText({
        hostLiveStreaming: false,
        chunkIsForFocusedHost: true,
        messages: [{ role: "user", content: "q" }],
      }),
    ).toBe(true);
  });

  it("applies to an empty queued pending after the previous turn settled", () => {
    expect(
      shouldApplyLateStreamText({
        hostLiveStreaming: false,
        chunkIsForFocusedHost: true,
        messages: [
          { role: "user", content: "long task" },
          { role: "assistant", streaming: false, content: "turn 1 answer" },
          { role: "user", content: "ok continue" },
          { role: "assistant", streaming: false, content: "" },
        ],
      }),
    ).toBe(true);
  });

  it("drops tokens if a stale heal copied the previous turn onto the pending", () => {
    // What the queued-turn bug looks like before canLiftJournalLastTurn:
    // last assistant already has turn-1 body, so turn-2 tokens are replay.
    expect(
      shouldApplyLateStreamText({
        hostLiveStreaming: false,
        chunkIsForFocusedHost: true,
        messages: [
          { role: "user", content: "long task" },
          { role: "assistant", streaming: false, content: "turn 1 answer" },
          { role: "user", content: "ok continue" },
          {
            role: "assistant",
            streaming: false,
            content: "turn 1 answer",
          },
        ],
      }),
    ).toBe(false);
  });
});

describe("shouldHealJournalOnStreamDone", () => {
  it("heals the viewed chat on stream done (ready→ready skips state heal)", () => {
    expect(
      shouldHealJournalOnStreamDone({
        isViewingSession: true,
        streamDone: true,
      }),
    ).toBe(true);
  });

  it("does not heal a background chat or a non-done chunk", () => {
    expect(
      shouldHealJournalOnStreamDone({
        isViewingSession: false,
        streamDone: true,
      }),
    ).toBe(false);
    expect(
      shouldHealJournalOnStreamDone({
        isViewingSession: true,
        streamDone: false,
      }),
    ).toBe(false);
  });

  it("retries long enough to cover Host post-turn journal flush", () => {
    const total = JOURNAL_REHYDRATE_RETRY_GAPS_MS.reduce((a, b) => a + b, 0);
    expect(JOURNAL_REHYDRATE_RETRY_GAPS_MS).toEqual([400, 500]);
    expect(total).toBeGreaterThanOrEqual(750);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  STREAM_COALESCE_FLUSH_MS,
  TimedBatchQueue,
  mergeStreamChunks,
  resolveStreamFlushMs,
  StreamCoalescer,
  streamChunkNeedsImmediateFlush,
  streamCoalesceKey,
  toolEventNeedsImmediateFlush,
} from "./streamCoalesce";

describe("streamCoalesce", () => {
  it("keys by session + message + kind", () => {
    expect(
      streamCoalesceKey({ sessionId: "s1", messageId: "m1", kind: "assistant" }),
    ).toBe(streamCoalesceKey({ sessionId: "s1", messageId: "m1", kind: "assistant" }));
    expect(
      streamCoalesceKey({ sessionId: "s1", messageId: "m1", kind: "assistant" }),
    ).not.toBe(
      streamCoalesceKey({ sessionId: "s1", messageId: "m1", kind: "thought" }),
    );
  });

  it("merges text and ORs done", () => {
    const m = mergeStreamChunks(
      { sessionId: "s", messageId: "m", kind: "assistant", text: "hel" },
      { sessionId: "s", messageId: "m", kind: "assistant", text: "lo", done: true },
    );
    expect(m).toEqual({
      sessionId: "s",
      messageId: "m",
      kind: "assistant",
      text: "hello",
      done: true,
      thoughtPhase: undefined,
    });
  });

  it("refuses merge across keys", () => {
    expect(
      mergeStreamChunks(
        { sessionId: "a", messageId: "1", kind: "assistant", text: "x" },
        { sessionId: "b", messageId: "1", kind: "assistant", text: "y" },
      ),
    ).toBeNull();
  });

  it("immediate flush on done / new thought phase", () => {
    expect(streamChunkNeedsImmediateFlush({ done: true })).toBe(true);
    expect(streamChunkNeedsImmediateFlush({ thoughtPhase: "new" })).toBe(true);
    expect(streamChunkNeedsImmediateFlush({ text: "hi" })).toBe(false);
  });

  it("resolveStreamFlushMs scales with cores (Intel longer, high-core snappier)", () => {
    expect(resolveStreamFlushMs(4)).toBe(128);
    expect(resolveStreamFlushMs(8)).toBe(128);
    expect(resolveStreamFlushMs(10)).toBe(STREAM_COALESCE_FLUSH_MS);
    expect(resolveStreamFlushMs(12)).toBe(STREAM_COALESCE_FLUSH_MS);
    expect(resolveStreamFlushMs(16)).toBe(72);
    expect(STREAM_COALESCE_FLUSH_MS).toBe(110);
  });

  it("default flush uses STREAM_COALESCE_FLUSH_MS (higher than historical 48)", () => {
    vi.useFakeTimers();
    const out: string[] = [];
    const c = new StreamCoalescer({
      onFlush: (ch) => out.push(ch.text ?? ""),
    });
    expect(c.intervalMs).toBe(STREAM_COALESCE_FLUSH_MS);
    expect(c.intervalMs).toBeGreaterThan(48);
    c.push({ sessionId: "s", messageId: "m", kind: "assistant", text: "a" });
    c.push({ sessionId: "s", messageId: "m", kind: "assistant", text: "b" });
    expect(out).toEqual([]);
    vi.advanceTimersByTime(STREAM_COALESCE_FLUSH_MS - 1);
    expect(out).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(out).toEqual(["ab"]);
    c.dispose();
    vi.useRealTimers();
  });

  it("coalescer batches then flushes on timer", async () => {
    vi.useFakeTimers();
    const out: string[] = [];
    const c = new StreamCoalescer({
      flushMs: 40,
      onFlush: (ch) => out.push(ch.text ?? ""),
    });
    c.push({ sessionId: "s", messageId: "m", kind: "assistant", text: "a" });
    c.push({ sessionId: "s", messageId: "m", kind: "assistant", text: "b" });
    expect(out).toEqual([]);
    vi.advanceTimersByTime(40);
    expect(out).toEqual(["ab"]);
    c.dispose();
    vi.useRealTimers();
  });

  it("coalescer flushes immediately on done", () => {
    const out: string[] = [];
    const c = new StreamCoalescer({
      flushMs: 1000,
      onFlush: (ch) => out.push(`${ch.text}|${ch.done ? "d" : ""}`),
    });
    c.push({ sessionId: "s", messageId: "m", kind: "assistant", text: "a" });
    c.push({
      sessionId: "s",
      messageId: "m",
      kind: "assistant",
      text: "b",
      done: true,
    });
    expect(out).toEqual(["ab|d"]);
    c.dispose();
  });

  it("trailing re-arm flushes chunks pushed during onFlush", () => {
    vi.useFakeTimers();
    const out: string[] = [];
    let reentered = false;
    const c = new StreamCoalescer({
      flushMs: 50,
      onFlush: (ch) => {
        out.push(ch.text ?? "");
        if (!reentered && ch.text === "ab") {
          reentered = true;
          // Simulate a late token arriving while React is applying the flush.
          c.push({
            sessionId: "s",
            messageId: "m",
            kind: "assistant",
            text: "c",
          });
        }
      },
    });
    c.push({ sessionId: "s", messageId: "m", kind: "assistant", text: "a" });
    c.push({ sessionId: "s", messageId: "m", kind: "assistant", text: "b" });
    vi.advanceTimersByTime(50);
    expect(out).toEqual(["ab"]);
    // Trailing arm should schedule another flush for "c".
    vi.advanceTimersByTime(50);
    expect(out).toEqual(["ab", "c"]);
    c.dispose();
    vi.useRealTimers();
  });

  it("toolEventNeedsImmediateFlush only for terminal statuses", () => {
    expect(toolEventNeedsImmediateFlush("in_progress")).toBe(false);
    expect(toolEventNeedsImmediateFlush("running")).toBe(false);
    expect(toolEventNeedsImmediateFlush("completed")).toBe(true);
    expect(toolEventNeedsImmediateFlush("failed")).toBe(true);
    expect(toolEventNeedsImmediateFlush("error")).toBe(true);
    expect(toolEventNeedsImmediateFlush("cancelled")).toBe(true);
  });

  it("TimedBatchQueue batches then flushes; terminal is immediate", () => {
    vi.useFakeTimers();
    const out: string[][] = [];
    const q = new TimedBatchQueue<{ id: string; status?: string }>({
      flushMs: 60,
      shouldFlushImmediate: (i) => toolEventNeedsImmediateFlush(i.status),
      onFlush: (items) => out.push(items.map((i) => i.id)),
    });
    q.push({ id: "a", status: "in_progress" });
    q.push({ id: "b", status: "in_progress" });
    expect(out).toEqual([]);
    vi.advanceTimersByTime(60);
    expect(out).toEqual([["a", "b"]]);
    q.push({ id: "c", status: "in_progress" });
    q.push({ id: "d", status: "completed" });
    expect(out).toEqual([["a", "b"], ["c", "d"]]);
    q.dispose();
    vi.useRealTimers();
  });
});

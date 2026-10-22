import { describe, expect, it } from "vitest";
import {
  CHAT_VIRTUALIZE_THRESHOLD_PERF,
  isStreamPerfActive,
  resolveStreamFlushMs,
  resolveStreamMarkdownParseMs,
  resolveStreamOverscanScale,
  resolveMarkdownPaintSource,
  resolveStreamRevealMode,
  resolveTranscriptContentNotifyMs,
  setStreamPerfActive,
  shouldPlayWallpaperVideo,
  shouldSyncStreamPerfDataset,
  shouldUsePlainStreamBody,
  STREAM_COALESCE_FLUSH_MS,
  STREAM_MARKDOWN_PARSE_MS,
  STREAM_PLAIN_TEXT_CHAR_THRESHOLD,
  STREAM_REVEAL_MAX_CHARS,
  STREAM_REVEAL_MAX_SPANS,
  TRANSCRIPT_CONTENT_NOTIFY_MS,
} from "./streamRenderPolicy";
import { LONG_ASSISTANT_SPILL_CHARS } from "./longAssistantSpill";

describe("streamRenderPolicy", () => {
  it("virtualize threshold is early enough for multi-turn agent chats", () => {
    expect(CHAT_VIRTUALIZE_THRESHOLD_PERF).toBeLessThanOrEqual(24);
    expect(CHAT_VIRTUALIZE_THRESHOLD_PERF).toBeGreaterThanOrEqual(12);
  });

  it("never drops to plain stream body (keeps live markdown)", () => {
    expect(shouldUsePlainStreamBody(100, true)).toBe(false);
    expect(
      shouldUsePlainStreamBody(STREAM_PLAIN_TEXT_CHAR_THRESHOLD, true),
    ).toBe(false);
    expect(
      shouldUsePlainStreamBody(STREAM_PLAIN_TEXT_CHAR_THRESHOLD + 50_000, true),
    ).toBe(false);
    expect(
      shouldUsePlainStreamBody(STREAM_PLAIN_TEXT_CHAR_THRESHOLD + 1, false),
    ).toBe(false);
  });

  it("markdown parse interval lengthens for long streaming bodies", () => {
    expect(resolveStreamMarkdownParseMs(100, false)).toBe(0);
    expect(resolveStreamMarkdownParseMs(100, true)).toBe(
      STREAM_MARKDOWN_PARSE_MS,
    );
    expect(
      resolveStreamMarkdownParseMs(STREAM_PLAIN_TEXT_CHAR_THRESHOLD, true),
    ).toBeGreaterThan(STREAM_MARKDOWN_PARSE_MS);
    expect(resolveStreamMarkdownParseMs(12_000, true)).toBeGreaterThan(
      resolveStreamMarkdownParseMs(STREAM_PLAIN_TEXT_CHAR_THRESHOLD, true),
    );
  });

  it("flush ms scales with hardware concurrency", () => {
    expect(resolveStreamFlushMs(4)).toBeGreaterThanOrEqual(STREAM_COALESCE_FLUSH_MS);
    expect(resolveStreamFlushMs(12)).toBe(STREAM_COALESCE_FLUSH_MS);
    expect(resolveStreamFlushMs(16)).toBeLessThan(STREAM_COALESCE_FLUSH_MS);
  });

  it("settled markdown paints live source, not the throttle lag", () => {
    expect(resolveMarkdownPaintSource(true, "live", "lag")).toBe("lag");
    expect(resolveMarkdownPaintSource(false, "live", "lag")).toBe("live");
    expect(resolveMarkdownPaintSource(false, "final", "final")).toBe("final");
  });

  it("overscan scale shrinks only while streaming", () => {
    expect(resolveStreamOverscanScale(false, 12)).toBe(1);
    expect(resolveStreamOverscanScale(true, 12)).toBeLessThan(1);
    expect(resolveStreamOverscanScale(true, 16)).toBeLessThan(1);
    expect(resolveStreamOverscanScale(true, 12)).toBeLessThan(
      resolveStreamOverscanScale(true, 16),
    );
  });

  it("content notify ms scales with hardware concurrency", () => {
    expect(resolveTranscriptContentNotifyMs(4)).toBeGreaterThanOrEqual(
      TRANSCRIPT_CONTENT_NOTIFY_MS,
    );
    expect(resolveTranscriptContentNotifyMs(12)).toBe(
      TRANSCRIPT_CONTENT_NOTIFY_MS,
    );
    expect(resolveTranscriptContentNotifyMs(16)).toBeLessThan(
      TRANSCRIPT_CONTENT_NOTIFY_MS,
    );
  });

  it("only pauses wallpaper video while the document is hidden", () => {
    expect(shouldPlayWallpaperVideo({})).toBe(true);
    expect(shouldPlayWallpaperVideo({ visibilityState: "visible" })).toBe(true);
    expect(shouldPlayWallpaperVideo({ visibilityState: "hidden" })).toBe(false);
  });

  it("tracks stream-perf in a module flag for overscan without requiring html attrs (#1158)", () => {
    setStreamPerfActive(false);
    expect(isStreamPerfActive()).toBe(false);
    setStreamPerfActive(true);
    expect(isStreamPerfActive()).toBe(true);
    setStreamPerfActive(false);
    expect(isStreamPerfActive()).toBe(false);
  });

  it("skips html data-stream-perf sync while wallpaper is active (#1158)", () => {
    expect(shouldSyncStreamPerfDataset({ wallpaperActive: true })).toBe(false);
    expect(shouldSyncStreamPerfDataset({ wallpaperActive: false })).toBe(true);
  });
});

describe("resolveStreamRevealMode", () => {
  const mode = (
    overrides: Partial<{
      streaming: boolean;
      contentLength: number;
      pendingChunkCount: number;
    }> = {},
  ) =>
    resolveStreamRevealMode({
      streaming: true,
      contentLength: 100,
      pendingChunkCount: 3,
      ...overrides,
    });

  it("keeps per-chunk reveal while under both budgets", () => {
    expect(mode()).toBe("chunk");
    expect(mode({ contentLength: 0, pendingChunkCount: 0 })).toBe("chunk");
  });

  it("degrades at and over the char cap", () => {
    expect(mode({ contentLength: STREAM_REVEAL_MAX_CHARS - 1 })).toBe("chunk");
    expect(mode({ contentLength: STREAM_REVEAL_MAX_CHARS })).toBe("block");
    expect(mode({ contentLength: STREAM_REVEAL_MAX_CHARS + 1 })).toBe("block");
  });

  it("degrades only above the span budget", () => {
    expect(mode({ pendingChunkCount: STREAM_REVEAL_MAX_SPANS })).toBe("chunk");
    expect(mode({ pendingChunkCount: STREAM_REVEAL_MAX_SPANS + 1 })).toBe(
      "block",
    );
  });

  it("keeps the blur reveal budget at 400 animated spans", () => {
    expect(STREAM_REVEAL_MAX_SPANS).toBe(400);
  });

  it("never reveals when the reply is settled", () => {
    expect(mode({ streaming: false })).toBe("block");
    expect(
      mode({ streaming: false, contentLength: 10, pendingChunkCount: 1 }),
    ).toBe("block");
  });

  it("shares the char cap with the Windows long-answer spill threshold", () => {
    expect(STREAM_REVEAL_MAX_CHARS).toBe(LONG_ASSISTANT_SPILL_CHARS);
  });
});

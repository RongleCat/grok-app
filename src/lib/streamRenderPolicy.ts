/**
 * Streaming render / coalesce policy for chat UI.
 *
 * Long assistant turns re-parse markdown and re-render the App shell on every
 * chunk. On integrated-GPU Retina laptops (e.g. 2019 16" Intel MBP), that
 * thrash freezes the UI after a few tool-heavy turns. These knobs batch and
 * cheapen the hot path without changing final (non-streaming) fidelity.
 */

/** Default stream→React flush interval (ms). Higher = fewer App setStates. */
export const STREAM_COALESCE_FLUSH_MS = 110;

/**
 * Virtualize the transcript once this many rows exist (tool steps count).
 * Lower than historical 48 so "a few agent turns" already window the DOM.
 */
export const CHAT_VIRTUALIZE_THRESHOLD_PERF = 16;

/**
 * While streaming, re-run ReactMarkdown at most this often (ms).
 * Smooth/plain text can still update more often; only the parse is throttled.
 * ~9×/s keeps long answers fluid without an O(n) parse per token.
 */
export const STREAM_MARKDOWN_PARSE_MS = 110;

/**
 * Non-structural content notify throttle for the transcript store (ms).
 * Full text is always stored immediately; React only re-renders on this cadence.
 */
export const TRANSCRIPT_CONTENT_NOTIFY_MS = 84;

/**
 * Adaptive content-notify interval: longer on thermally limited laptops so
 * ConversationThread / live panels don't thrash every stream coalesce tick.
 */
export function resolveTranscriptContentNotifyMs(
  hardwareConcurrency: number = typeof navigator !== "undefined"
    ? navigator.hardwareConcurrency || 8
    : 8,
): number {
  if (hardwareConcurrency <= 8) return 110;
  if (hardwareConcurrency <= 12) return TRANSCRIPT_CONTENT_NOTIFY_MS;
  return 64;
}

/**
 * Historical threshold for the old plain-pre stream body. Kept as a length
 * breakpoint for adaptive markdown parse throttling only — we no longer drop
 * to bare markdown mid-turn (that caused visible `**` / fence flashes).
 */
export const STREAM_PLAIN_TEXT_CHAR_THRESHOLD = 2000;

/** Whether hardware looks like a thermally-limited laptop (Intel dual-GPU class). */
export function isLowPowerClient(
  hardwareConcurrency: number = typeof navigator !== "undefined"
    ? navigator.hardwareConcurrency || 8
    : 8,
): boolean {
  return hardwareConcurrency <= 12;
}

/**
 * Always keep live markdown while streaming. Plain-pre fallback was retired
 * because it showed bare markdown syntax until the turn settled.
 * Kept for call-site compatibility; always returns false.
 */
export function shouldUsePlainStreamBody(
  _contentLength: number,
  _streaming: boolean,
  _threshold: number = STREAM_PLAIN_TEXT_CHAR_THRESHOLD,
): boolean {
  return false;
}

/**
 * Adaptive ReactMarkdown re-parse interval while streaming.
 * Longer bodies re-parse less often so the hot path stays cheap without
 * switching to plain text.
 */
export function resolveStreamMarkdownParseMs(
  contentLength: number,
  streaming: boolean,
): number {
  if (!streaming) return 0;
  if (contentLength >= 12_000) return 280;
  if (contentLength >= STREAM_PLAIN_TEXT_CHAR_THRESHOLD) return 220;
  return STREAM_MARKDOWN_PARSE_MS;
}

/**
 * Adaptive coalesce interval: slightly longer on low core counts (typical
 * Intel dual-socket laptop cores / thermal throttle), shorter on big machines.
 */
export function resolveStreamFlushMs(
  hardwareConcurrency: number = typeof navigator !== "undefined"
    ? navigator.hardwareConcurrency || 8
    : 8,
): number {
  if (hardwareConcurrency <= 8) return 128;
  if (hardwareConcurrency <= 12) return STREAM_COALESCE_FLUSH_MS;
  return 72;
}

/** Scale chat virtual overscan down while streaming on low-power clients. */
export function resolveStreamOverscanScale(
  streaming: boolean,
  hardwareConcurrency?: number,
): number {
  if (!streaming) return 1;
  return isLowPowerClient(hardwareConcurrency) ? 0.55 : 0.75;
}

/**
 * Streaming markdown parse is throttled. On settle, paint the live source in
 * the same render — a useEffect flush leaves one frame of stale tree at the
 * tail (the end-of-answer flash).
 */
export function resolveMarkdownPaintSource(
  streaming: boolean,
  liveSource: string,
  throttledSource: string,
): string {
  return streaming ? throttledSource : liveSource;
}

/**
 * Reveal cap for a single reply, in painted characters. Past it, chunks are no
 * longer split individually and only block entrance remains. Matches the
 * Windows long-answer spill threshold — beyond that line a single markdown
 * tree is already a known hotspot.
 */
export const STREAM_REVEAL_MAX_CHARS = 8000;

/**
 * Budget for animated spans alive in the live tail at once. Each chunk
 * boundary past the reveal threshold yields at most one animated span, and
 * every span runs a blur filter, which costs more than plain opacity; hundreds
 * of filters from very fine chunks would outweigh the motion itself, so this
 * budget is lower than a fade-only one.
 */
export const STREAM_REVEAL_MAX_SPANS = 400;

/** `chunk` = per-chunk text fade-in; `block` = block container entrance only. */
export type StreamRevealMode = "chunk" | "block";

/**
 * Decides whether the current streamed reply is still worth revealing per
 * chunk.
 *
 * Reveal buys a sense of writing, at the cost of one inline span per chunk,
 * one split during parsing, and one CSS animation. Long replies or very fine
 * chunks stack hundreds of spans in the always-mounted live tail — exactly
 * where a low-end laptop drops scroll frames. Over budget, the component keeps
 * its own block entrance and renders the body as plain markdown: content stays
 * fully readable, only the per-chunk fade is lost.
 *
 * Callers must latch the result for the whole lifetime of that reply —
 * switching around the threshold would tear down and rebuild painted spans,
 * which flickers the tail.
 *
 * @param opts.streaming Only a reply that is still growing needs motion.
 * @param opts.contentLength Painted characters of this reply.
 * @param opts.pendingChunkCount Chunk boundaries produced by this reply.
 *   Each boundary yields at most one animated span, so this bounds the span
 *   count; boundaries already folded into the stable prefix only make the
 *   budget slightly conservative.
 */
export function resolveStreamRevealMode(opts: {
  streaming: boolean;
  contentLength: number;
  pendingChunkCount: number;
}): StreamRevealMode {
  if (!opts.streaming) return "block";
  if (opts.contentLength >= STREAM_REVEAL_MAX_CHARS) return "block";
  if (opts.pendingChunkCount > STREAM_REVEAL_MAX_SPANS) return "block";
  return "chunk";
}

/**
 * Wallpaper `<video>` should decode whenever the window is visible. Streaming
 * must not pause/restart it because that rebuilds the compositor layer.
 */
export function shouldPlayWallpaperVideo(opts: {
  visibilityState?: string;
}): boolean {
  return (opts.visibilityState ?? "visible") !== "hidden";
}

/**
 * Module-level stream-perf flag for JS readers (virtual overscan, etc.).
 * Prefer this over `document.documentElement.dataset.streamPerf` so wallpaper
 * sessions can skip flipping html attributes that invalidate macOS blur layers.
 */
let streamPerfActive = false;

export function setStreamPerfActive(on: boolean): void {
  streamPerfActive = on;
}

export function isStreamPerfActive(): boolean {
  return streamPerfActive;
}

/** When wallpaper frost is active, skip syncing `data-stream-perf` onto `<html>`. */
export function shouldSyncStreamPerfDataset(opts: {
  wallpaperActive: boolean;
}): boolean {
  return !opts.wallpaperActive;
}

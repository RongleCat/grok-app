/**
 * Streaming render policy for chat markdown.
 *
 * Long assistant turns re-parse markdown on every chunk. These knobs cheapen
 * the hot path without changing final (non-streaming) fidelity.
 */

/**
 * While streaming, re-run ReactMarkdown at most this often (ms).
 * Smooth/plain text can still update more often; only the parse is throttled.
 */
export const STREAM_MARKDOWN_PARSE_MS = 160;

/**
 * Past this many characters while streaming, skip live markdown and show
 * plain pre-wrap until the turn settles (one full parse on done).
 */
export const STREAM_PLAIN_TEXT_CHAR_THRESHOLD = 2000;

/** Prefer plain streaming body once content crosses the threshold. */
export function shouldUsePlainStreamBody(
  contentLength: number,
  streaming: boolean,
  threshold: number = STREAM_PLAIN_TEXT_CHAR_THRESHOLD,
): boolean {
  if (!streaming) return false;
  return contentLength >= threshold;
}

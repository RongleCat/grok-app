/**
 * Chat stream / virtual-list render policy (perf knobs shared by
 * chatVirtualList + useChatMessageVirtualizer).
 *
 * Multi-turn agent chats explode row count (tools, phases, end-of-turn chips).
 * Virtualize earlier than a pure Q&A transcript, and shrink overscan while the
 * tail is streaming so low-power clients mount fewer markdown siblings.
 */

/** Virtualize when the transcript reaches this many rows (was 48). */
export const CHAT_VIRTUALIZE_THRESHOLD_PERF = 16;

/**
 * Multiplier applied to adaptive overscan while a turn is streaming.
 * Idle → 1. Streaming → 0.55–0.75 (more aggressive on fewer CPU cores).
 */
export function resolveStreamOverscanScale(
  streaming: boolean,
  hardwareConcurrency?: number,
): number {
  if (!streaming) return 1;
  const cores =
    hardwareConcurrency ??
    (typeof navigator !== "undefined"
      ? navigator.hardwareConcurrency
      : undefined) ??
    8;
  if (cores <= 4) return 0.55;
  if (cores <= 8) return 0.65;
  return 0.75;
}

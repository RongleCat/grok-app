import type { RefObject } from "react";
import type { ChatVirtualWindow } from "@/lib/chatVirtualList";

export type UseChatMessageVirtualizerArgs = {
  itemCount: number;
  getKey: (index: number) => string;
  /** Content-aware estimate before first measure (critical for tall answers). */
  getEstimateHeight?: (index: number) => number;
  viewportRef: RefObject<HTMLElement | null>;
  /** Stick pin flag from useStickToBottom (ref, not reactive). */
  isPinnedRef: RefObject<boolean>;
  /** Reset height cache when conversation switches. */
  conversationKey?: string | number | null;
  /** Always-mounted indices (find match, streaming row, …). */
  forceIndices?: readonly number[];
  /** Below this count, render everything (no spacers). */
  threshold?: number;
  enabled?: boolean;
};

export type UseChatMessageVirtualizerResult = {
  /** True when windowing is active. */
  virtualized: boolean;
  start: number;
  end: number;
  paddingTop: number;
  paddingBottom: number;
  richStart: number;
  richEnd: number;
  /** Measured height, else content estimate. */
  rowHeight: (index: number) => number;
  /** Attach to each row wrapper for measurement. */
  measureRef: (index: number) => (el: HTMLElement | null) => void;
  /** Recompute after scroll (also driven by native scroll listener). */
  onViewportScroll: () => void;
};

/** Full (non-windowed) range covering every row. */
export const fullChatVirtualWindow = (count: number): ChatVirtualWindow => ({
  start: 0,
  end: count,
  paddingTop: 0,
  paddingBottom: 0,
  totalHeight: 0,
  richStart: 0,
  richEnd: count,
});

/**
 * Grok-web-style message node rail (right edge of the transcript).
 * One tick per user/assistant message; hover preview; prev/next steppers.
 *
 * Active highlight is owned here during free scroll (rAF-throttled
 * querySelectorAll) so ConversationThread does not setState on every scroll
 * frame — that was a multi-turn jank source (#280). Parent only mirrors the
 * free-scroll cursor via `onScrollActiveChange` (ref update, no setState).
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { IconChevronDown, IconChevronUp } from "@/components/icons";
import type { SessionMessageNode } from "@/lib/sessionMessageNodes";
import {
  estimateMessageIndexAtY,
  nearestNodeIdFromPaintList,
  pickActiveNodeIdFromRects,
} from "@/lib/sessionMessageNodes";
import type { ChatMessage } from "@/lib/session";
import { cn } from "@/lib/utils";

export type MessageNodeRailLabels = {
  aria: string;
  prev: string;
  next: string;
  userRole: string;
  assistantRole: string;
  /** "{current} / {total}" */
  count: (current: number, total: number) => string;
};

type TipState = {
  node: SessionMessageNode;
  top: number;
  right: number;
};

export function MessageNodeRail({
  nodes,
  activeId,
  onSelect,
  onPrev,
  onNext,
  labels,
  scrollParentRef,
  /**
   * Paint list (filtered transcript) for height-estimate fallback when rows
   * are virtualized away. Must match the virtualizer item list — not the full
   * journal — or free-scroll highlight drifts past hidden tool rows.
   */
  messages,
  /** When performance.now() < this ref value, ignore scroll-driven highlight. */
  navLockUntilRef,
  /**
   * Free-scroll cursor sync (ref-only on the parent). Called when the rail
   * picks a new active node so prev/next step from the reading position.
   */
  onScrollActiveChange,
}: {
  nodes: readonly SessionMessageNode[];
  /** Programmatic cursor seed (prev/next / click) — mirrored into local state. */
  activeId: string | null;
  onSelect: (node: SessionMessageNode) => void;
  onPrev: () => void;
  onNext: () => void;
  labels: MessageNodeRailLabels;
  scrollParentRef?: RefObject<HTMLElement | null>;
  messages?: readonly ChatMessage[];
  navLockUntilRef?: RefObject<number>;
  onScrollActiveChange?: (id: string) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  /**
   * Scroll-derived highlight owns the display after free scroll.
   * Programmatic activeId only seeds this state (see effect below) so a
   * stale parent activeId cannot pin the rail after the user has scrolled.
   */
  const [scrollActiveId, setScrollActiveId] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const onScrollActiveChangeRef = useRef(onScrollActiveChange);
  onScrollActiveChangeRef.current = onScrollActiveChange;

  // Free-scroll / local state first; fall back to programmatic seed.
  const displayActiveId = scrollActiveId ?? activeId;

  const activeIndex = useMemo(() => {
    if (!displayActiveId) return -1;
    return nodes.findIndex((n) => n.id === displayActiveId);
  }, [nodes, displayActiveId]);

  const canPrev = activeIndex > 0 || (activeIndex < 0 && nodes.length > 0);
  const canNext =
    (activeIndex >= 0 && activeIndex < nodes.length - 1) ||
    (activeIndex < 0 && nodes.length > 0);

  const nodeIdSet = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  // Keep the active tick roughly in view inside a long rail.
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const list = listRef.current;
    const tick = list.querySelector(
      `[data-node-id="${CSS.escape(nodes[activeIndex]!.id)}"]`,
    ) as HTMLElement | null;
    if (!tick) return;
    const tickTop = tick.offsetTop;
    const tickBottom = tickTop + tick.offsetHeight;
    const viewTop = list.scrollTop;
    const viewBottom = viewTop + list.clientHeight;
    // Only scroll if outside visible range to avoid redundant scroll operations.
    if (tickTop < viewTop || tickBottom > viewBottom) {
      tick.scrollIntoView({ block: "nearest", behavior: "auto" });
    }
  }, [activeIndex, nodes]);

  // Free-scroll highlight: rAF throttle + one querySelectorAll per frame.
  useEffect(() => {
    const viewport = scrollParentRef?.current;
    if (!viewport || nodes.length < 2) return;

    const sync = () => {
      rafRef.current = null;
      if (
        navLockUntilRef &&
        performance.now() < (navLockUntilRef.current ?? 0)
      ) {
        return;
      }

      const viewportRect = viewport.getBoundingClientRect();
      const focusY = viewportRect.top + viewport.clientHeight * 0.28;

      // Single pass over mounted message rows (virtual window only).
      const mounted = viewport.querySelectorAll<HTMLElement>("[data-message-id]");
      const rects: { id: string; top: number; bottom: number }[] = [];
      for (const row of mounted) {
        const id = row.getAttribute("data-message-id");
        if (!id || !nodeIdSet.has(id)) continue;
        const r = row.getBoundingClientRect();
        rects.push({ id, top: r.top, bottom: r.bottom });
      }

      let bestId = pickActiveNodeIdFromRects(rects, focusY);

      if (!bestId && messages && messages.length > 0) {
        const y = viewport.scrollTop + viewport.clientHeight * 0.28;
        const msgIdx = estimateMessageIndexAtY(messages, y);
        // Id walk on the paint list — not journal messageIndex (filtered lists).
        bestId = nearestNodeIdFromPaintList(messages, nodes, msgIdx);
      }

      if (bestId) {
        setScrollActiveId((prev) => {
          if (prev === bestId) return prev;
          onScrollActiveChangeRef.current?.(bestId);
          return bestId;
        });
      }
    };

    const onScroll = () => {
      if (rafRef.current != null) return;
      rafRef.current = window.requestAnimationFrame(sync);
    };

    viewport.addEventListener("scroll", onScroll, { passive: true });
    // Initial paint.
    rafRef.current = window.requestAnimationFrame(sync);

    return () => {
      viewport.removeEventListener("scroll", onScroll);
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [scrollParentRef, nodes, nodeIdSet, messages, navLockUntilRef]);

  // When parent sets a programmatic activeId, mirror it into scroll state so
  // highlight does not snap back on the next free-scroll frame incorrectly.
  useEffect(() => {
    if (activeId) {
      setScrollActiveId(activeId);
      onScrollActiveChangeRef.current?.(activeId);
    }
  }, [activeId]);

  const showTipFor = (node: SessionMessageNode, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setTip({
      node,
      top: r.top + r.height / 2,
      right: window.innerWidth - r.left + 8,
    });
  };

  const clearTip = (id: string) => {
    setTip((cur) => (cur?.node.id === id ? null : cur));
  };

  if (nodes.length < 2) return null;

  const tipRole =
    tip == null
      ? ""
      : tip.node.role === "user"
        ? labels.userRole
        : labels.assistantRole;

  return (
    <nav
      className="lobe-msg-rail"
      aria-label={labels.aria}
      data-slot="message-node-rail"
    >
      <button
        type="button"
        className="lobe-msg-rail__step"
        aria-label={labels.prev}
        disabled={!canPrev}
        onClick={onPrev}
      >
        <IconChevronUp size={14} />
      </button>

      <div ref={listRef} className="lobe-msg-rail__list" role="list">
        {nodes.map((n) => {
          const isActive = n.id === displayActiveId;
          const isHover = tip?.node.id === n.id;
          const roleLabel =
            n.role === "user" ? labels.userRole : labels.assistantRole;
          // Keep button role; wrap with listitem so a11y trees do not promote
          // the control to a nameless "group" (Appshot / VoiceOver).
          return (
            <div key={n.id} role="listitem" className="lobe-msg-rail__item">
              <button
                type="button"
                data-node-id={n.id}
                className={cn(
                  "lobe-msg-rail__tick",
                  n.role === "user" && "lobe-msg-rail__tick--user",
                  n.role === "assistant" && "lobe-msg-rail__tick--assistant",
                  isActive && "is-active",
                  isHover && "is-hover",
                  n.status === "error" && "is-error",
                  n.status === "pending" && "is-pending",
                )}
                aria-label={`${roleLabel}: ${n.preview}`}
                aria-current={isActive ? "true" : undefined}
                onMouseEnter={(e) => showTipFor(n, e.currentTarget)}
                onMouseLeave={() => clearTip(n.id)}
                onFocus={(e) => showTipFor(n, e.currentTarget)}
                onBlur={() => clearTip(n.id)}
                onClick={() => onSelect(n)}
              />
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="lobe-msg-rail__step"
        aria-label={labels.next}
        disabled={!canNext}
        onClick={onNext}
      >
        <IconChevronDown size={14} />
      </button>

      {tip && typeof document !== "undefined"
        ? createPortal(
            <div
              className="lobe-msg-rail__tip lobe-msg-rail__tip--portal"
              role="tooltip"
              style={{
                top: tip.top,
                right: tip.right,
              }}
            >
              <div className="lobe-msg-rail__tip-role">{tipRole}</div>
              <div className="lobe-msg-rail__tip-body">{tip.node.preview}</div>
              <div className="lobe-msg-rail__tip-count">
                {labels.count(tip.node.nodeIndex + 1, nodes.length)}
              </div>
            </div>,
            document.body,
          )
        : null}
    </nav>
  );
}

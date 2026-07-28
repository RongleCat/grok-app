/**
 * Grok-web-style message node rail (right edge of the transcript).
 * One tick per user/assistant message; hover preview; prev/next steppers.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconChevronDown, IconChevronUp } from "@/components/icons";
import type { SessionMessageNode } from "@/lib/sessionMessageNodes";
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
}: {
  nodes: readonly SessionMessageNode[];
  activeId: string | null;
  onSelect: (node: SessionMessageNode) => void;
  onPrev: () => void;
  onNext: () => void;
  labels: MessageNodeRailLabels;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);

  const activeIndex = useMemo(() => {
    if (!activeId) return -1;
    return nodes.findIndex((n) => n.id === activeId);
  }, [nodes, activeId]);

  const canPrev = activeIndex > 0 || (activeIndex < 0 && nodes.length > 0);
  const canNext =
    (activeIndex >= 0 && activeIndex < nodes.length - 1) ||
    (activeIndex < 0 && nodes.length > 0);

  // Keep the active tick roughly in view inside a long rail.
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const tick = listRef.current.querySelector(
      `[data-node-id="${CSS.escape(nodes[activeIndex]!.id)}"]`,
    ) as HTMLElement | null;
    tick?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex, nodes]);

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
          const isActive = n.id === activeId;
          const isHover = tip?.node.id === n.id;
          const roleLabel =
            n.role === "user" ? labels.userRole : labels.assistantRole;
          return (
            <button
              key={n.id}
              type="button"
              role="listitem"
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

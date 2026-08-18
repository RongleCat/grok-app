/**
 * Picker: attach another local session as context on the current turn.
 */

import { useEffect, useRef, type CSSProperties, type Ref } from "react";
import { IconChat } from "@/components/icons";
import type { AttachableSession } from "@/lib/chatAttach";
import { attachSessionBadge } from "@/lib/chatAttach";

export type AttachChatPanelLabels = {
  title: string;
  placeholder: string;
  empty: string;
  emptyFilter: string;
  aria: string;
  recentBadge?: string;
  projectBadge?: string;
};

export type AttachChatPanelProps = {
  open: boolean;
  sessions: AttachableSession[];
  query: string;
  activeIndex: number;
  focusFilter?: boolean;
  labels: AttachChatPanelLabels;
  onQueryChange: (q: string) => void;
  onActiveIndexChange: (i: number) => void;
  onSelect: (session: AttachableSession) => void;
  onClose: () => void;
  recentIds?: string[];
  currentProjectId?: string | null;
  style?: CSSProperties;
  panelRef?: Ref<HTMLDivElement | null>;
};

export function AttachChatPanel({
  open,
  sessions,
  query,
  activeIndex,
  focusFilter = true,
  labels,
  onQueryChange,
  onActiveIndexChange,
  onSelect,
  onClose,
  recentIds,
  currentProjectId,
  style,
  panelRef,
}: AttachChatPanelProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const filterRef = useRef<HTMLInputElement | null>(null);

  const setRefs = (node: HTMLDivElement | null) => {
    listRef.current = node;
    if (typeof panelRef === "function") panelRef(node);
    else if (panelRef && "current" in panelRef) {
      (panelRef as { current: HTMLDivElement | null }).current = node;
    }
  };

  useEffect(() => {
    if (!open || !focusFilter) return;
    const t = window.setTimeout(() => {
      filterRef.current?.focus();
      filterRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open, focusFilter]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-ac-idx="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, sessions.length]);

  if (!open) return null;

  const emptyText = query.trim() ? labels.emptyFilter : labels.empty;

  return (
    <div
      className="menu-panel prompt-history"
      role="listbox"
      aria-label={labels.aria}
      style={style}
      ref={setRefs}
      data-testid="attach-chat-panel"
    >
      <div className="prompt-history__head">
        <span className="prompt-history__title">{labels.title}</span>
      </div>
      <div className="prompt-history__filter">
        <span className="prompt-history__filter-ico" aria-hidden>
          <IconChat size={14} />
        </span>
        <input
          ref={filterRef}
          type="search"
          className="prompt-history__input"
          value={query}
          placeholder={labels.placeholder}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label={labels.placeholder}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onClose();
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (sessions.length === 0) return;
              onActiveIndexChange(
                Math.min(activeIndex + 1, sessions.length - 1),
              );
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              if (sessions.length === 0) return;
              onActiveIndexChange(Math.max(activeIndex - 1, 0));
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              const entry = sessions[activeIndex];
              if (entry) onSelect(entry);
            }
          }}
        />
      </div>
      <div className="prompt-history__list">
        {sessions.length === 0 ? (
          <div className="prompt-history__empty">{emptyText}</div>
        ) : (
          sessions.map((s, i) => {
            const active = i === activeIndex;
            const title = (s.title || "").trim() || s.id.slice(0, 8);
            const badge = attachSessionBadge(s, {
              recentIds,
              currentProjectId,
            });
            const badgeLabel =
              badge === "recent"
                ? labels.recentBadge
                : badge === "project"
                  ? labels.projectBadge
                  : null;
            return (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={active}
                data-ac-idx={i}
                className={
                  "prompt-history__item" + (active ? " is-active" : "")
                }
                title={title}
                onMouseEnter={() => onActiveIndexChange(i)}
                onClick={() => onSelect(s)}
              >
                <span className="prompt-history__item-text">{title}</span>
                {badgeLabel ? (
                  <span className="prompt-history__item-meta">{badgeLabel}</span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

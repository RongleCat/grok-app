/**
 * Prompt history picker (Grok Build `/history`).
 * Tabs: current-session prompts + cross-session recent (localStorage ring).
 * Newest-first list + optional fuzzy filter; Enter/click selects into composer.
 *
 * COMPOSER-HISTORY-PRO: Home/End/Page nav, request clear recent (parent shows
 * GlassModal — no window.confirm), remove-one on recent rows, clear-filter
 * empty affordance, optional relative-time meta.
 */

import { useEffect, useMemo, useRef, type CSSProperties, type Ref } from "react";
import {
  promptHistoryEmptyMessageKey,
  promptHistoryListNavFromKey,
  promptHistoryListPreview,
  resolvePromptHistoryEmptyState,
  stepPromptHistoryListIndex,
  type PromptHistoryEntry,
  type PromptHistoryScope,
} from "@/lib/composerPromptHistory";
import { previewStoredAsSlash } from "@/lib/draftDoc";
import { IconClock, IconTrash } from "@/components/icons";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

export type { PromptHistoryScope };

export type PromptHistoryPanelLabels = {
  /** "This chat" tab */
  tabSession: string;
  /** "Recent (all chats)" tab */
  tabRecent: string;
  placeholder: string;
  empty: string;
  emptyFilter: string;
  emptyRecent: string;
  emptyRecentFilter: string;
  aria: string;
  /** Clear filter control (when query hides all rows). */
  clearFilter?: string;
  /** Clear all recent prompts (recent tab only). */
  clearRecent?: string;
  /** Remove one recent row (aria). */
  removeRecent?: string;
};

export type PromptHistoryPanelProps = {
  open: boolean;
  scope: PromptHistoryScope;
  onScopeChange: (scope: PromptHistoryScope) => void;
  entries: PromptHistoryEntry[];
  /**
   * Unfiltered count for the active scope (clear-filter + clear-recent enable).
   * Defaults to `entries.length` when the filter is empty.
   */
  unfilteredCount?: number;
  query: string;
  activeIndex: number;
  /** Focus the filter field on open (`/history`); leave false for empty-↑ browse. */
  focusFilter?: boolean;
  labels: PromptHistoryPanelLabels;
  /**
   * Optional relative-time labels aligned with `entries` (recent tab).
   * Missing/empty → no meta row.
   */
  entryMeta?: ReadonlyArray<string | null | undefined>;
  onQueryChange: (q: string) => void;
  onActiveIndexChange: (i: number) => void;
  onSelect: (entry: PromptHistoryEntry) => void;
  onClose: () => void;
  /**
   * Request clear of the cross-session recent ring.
   * Parent shows GlassModal confirm, then calls `clearRecentPromptHistory`.
   * Only used on the Recent tab.
   */
  onRequestClearRecent?: () => void;
  /**
   * Remove one recent entry by unfiltered `historyIndex`.
   * Parent persists via `removeRecentPrompt`.
   */
  onRemoveRecent?: (historyIndex: number) => void;
  style?: CSSProperties;
  panelRef?: Ref<HTMLDivElement | null>;
};

export function PromptHistoryPanel({
  open,
  scope,
  onScopeChange,
  entries,
  unfilteredCount,
  query,
  activeIndex,
  focusFilter = false,
  labels,
  entryMeta,
  onQueryChange,
  onActiveIndexChange,
  onSelect,
  onClose,
  onRequestClearRecent,
  onRemoveRecent,
  style,
  panelRef,
}: PromptHistoryPanelProps) {
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
      `[data-ph-idx="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, entries.length, scope]);

  const unfiltered =
    typeof unfilteredCount === "number"
      ? Math.max(0, unfilteredCount)
      : query.trim()
        ? Math.max(entries.length, 0)
        : entries.length;

  const emptyState = useMemo(
    () =>
      resolvePromptHistoryEmptyState({
        scope,
        query,
        filteredCount: entries.length,
        unfilteredCount: unfiltered,
      }),
    [scope, query, entries.length, unfiltered],
  );

  if (!open) return null;

  const emptyText = emptyState
    ? (() => {
        const key = promptHistoryEmptyMessageKey(emptyState.kind);
        if (key === "promptHistory.emptyFilter") return labels.emptyFilter;
        if (key === "promptHistory.emptyRecent") return labels.emptyRecent;
        if (key === "promptHistory.emptyRecentFilter")
          return labels.emptyRecentFilter;
        return labels.empty;
      })()
    : "";

  const showClearRecent =
    scope === "recent" &&
    !!onRequestClearRecent &&
    !!labels.clearRecent &&
    unfiltered > 0;

  const applyListNav = (key: string) => {
    const nav = promptHistoryListNavFromKey(key);
    if (!nav || entries.length === 0) return false;
    const next = stepPromptHistoryListIndex(activeIndex, entries.length, nav);
    onActiveIndexChange(next);
    return true;
  };

  return (
    <div
      className="menu-panel prompt-history"
      role="listbox"
      aria-label={labels.aria}
      style={style}
      ref={setRefs}
      data-testid="prompt-history-panel"
      data-scope={scope}
    >
      <div className="prompt-history__head">
        <SegmentedControl
          value={scope}
          role="tablist"
          className="prompt-history__tabs"
          ariaLabel={labels.aria}
          options={[
            {
              value: "session",
              label: labels.tabSession,
              className: "prompt-history__tab",
              testId: "prompt-history-tab-session",
            },
            {
              value: "recent",
              label: labels.tabRecent,
              className: "prompt-history__tab",
              testId: "prompt-history-tab-recent",
            },
          ]}
          onChange={onScopeChange}
        />
        {showClearRecent ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm prompt-history__clear"
            data-testid="prompt-history-clear-recent"
            title={labels.clearRecent}
            aria-label={labels.clearRecent}
            onClick={() => onRequestClearRecent()}
          >
            <IconTrash size={13} />
            <span className="prompt-history__clear-label">
              {labels.clearRecent}
            </span>
          </button>
        ) : null}
      </div>
      <div className="prompt-history__filter">
        <span className="prompt-history__filter-ico" aria-hidden>
          <IconClock size={14} />
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
            if (applyListNav(e.key)) {
              e.preventDefault();
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              const entry = entries[activeIndex];
              if (entry) onSelect(entry);
            }
          }}
        />
      </div>
      <div className="prompt-history__list">
        {emptyState ? (
          <div className="prompt-history__empty" data-testid="prompt-history-empty">
            <div>{emptyText}</div>
            {emptyState.showClearFilter && labels.clearFilter ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm prompt-history__clear-filter"
                data-testid="prompt-history-clear-filter"
                onClick={() => onQueryChange("")}
              >
                {labels.clearFilter}
              </button>
            ) : null}
          </div>
        ) : (
          entries.map((entry, i) => {
            const active = i === activeIndex;
            const preview = promptHistoryListPreview(
              previewStoredAsSlash(entry.text),
            );
            const meta = entryMeta?.[i]?.trim() || "";
            const canRemove =
              scope === "recent" &&
              !!onRemoveRecent &&
              !!labels.removeRecent;
            return (
              <div
                key={`${scope}:${entry.historyIndex}:${i}`}
                className={
                  "prompt-history__row" + (active ? " is-active" : "")
                }
                data-ph-idx={i}
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={
                    "prompt-history__item" + (active ? " is-active" : "")
                  }
                  title={previewStoredAsSlash(entry.text)}
                  onMouseEnter={() => onActiveIndexChange(i)}
                  onClick={() => onSelect(entry)}
                >
                  <span className="prompt-history__item-main">
                    <span className="prompt-history__item-text">{preview}</span>
                    {meta ? (
                      <span className="prompt-history__item-meta">{meta}</span>
                    ) : null}
                  </span>
                </button>
                {canRemove ? (
                  <button
                    type="button"
                    className="icon-btn prompt-history__remove"
                    data-testid={`prompt-history-remove-${entry.historyIndex}`}
                    title={labels.removeRecent}
                    aria-label={labels.removeRecent}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onRemoveRecent(entry.historyIndex);
                    }}
                  >
                    <IconTrash size={12} />
                  </button>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

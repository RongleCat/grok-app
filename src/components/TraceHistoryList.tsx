/**
 * Recent session-trace exports — paths only (never file contents).
 * Used in Settings → Runtime → Diagnostics and the Traces modal.
 *
 * Manage: scope chips (all/local/uploaded) · search · remove row ·
 * clear all (GlassModal confirm with count) · size if known ·
 * uploaded badge only when history flag is true.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatListTimestamp } from "@/lib/formatDateTime";
import { GlassModal } from "@/components/GlassModal";
import { IconCopy, IconFolder, IconTrash } from "@/components/icons";
import * as api from "@/lib/api";
import {
  TRACE_HISTORY_CHANGE_EVENT,
  TRACE_HISTORY_STORAGE_KEY,
  clearTraceHistory,
  loadTraceHistory,
  removeTraceHistory,
  traceHistoryFileName,
  traceHistoryLabel,
  type TraceHistoryEntry,
} from "@/lib/traceHistory";
import {
  TRACE_HISTORY_SCOPES,
  countTraceHistoryMeta,
  filterTraceHistory,
  formatTraceSize,
  hasActiveTraceHistoryFilters,
  planClearTraceHistory,
  resolveTraceHistoryEmptyState,
  shouldShowTraceUploadedBadge,
  traceHistoryScopeLabelKey,
  type TraceHistoryScope,
} from "@/lib/traceHistoryPro";

export type TraceHistoryListLabels = {
  empty: string;
  /** Optional secondary empty hint (export prompt). */
  emptyHint?: string;
  emptyFilter: string;
  /** Optional filter-empty hint. */
  emptyFilterHint?: string;
  clearFilters?: string;
  reveal: string;
  copyPath: string;
  copied: string;
  remove: string;
  clearAll: string;
  clearConfirmTitle: string;
  /** Prefer with `{count}` — plan count is interpolated by caller when provided. */
  clearConfirmMessage: string;
  clearConfirmAction: string;
  cancel: string;
  searchPlaceholder: string;
  /** Optional column/section aria */
  listAria?: string;
  /** Optional badge when history notes uploaded=true (no URLs). */
  uploadedBadge?: string;
  /** Honest tooltip: upload reported by export, no remote URL stored. */
  uploadedBadgeTitle?: string;
  /** Filter chip labels */
  filterAll?: string;
  filterLocal?: string;
  filterUploaded?: string;
  filterAria?: string;
  closeLabel?: string;
};

export type TraceHistoryListProps = {
  labels: TraceHistoryListLabels;
  /** Called after copy-path success (toast). */
  onCopied?: () => void;
  /** Called after reveal failure. */
  onError?: (msg: string) => void;
  className?: string;
  /** Compact rows for modal. */
  /** Resolved catalog locale — formats the export timestamps. */
  locale: string;
  compact?: boolean;
};

function scopeLabel(
  scope: TraceHistoryScope,
  labels: TraceHistoryListLabels,
): string {
  if (scope === "local" && labels.filterLocal) return labels.filterLocal;
  if (scope === "uploaded" && labels.filterUploaded) return labels.filterUploaded;
  if (scope === "all" && labels.filterAll) return labels.filterAll;
  // Fallback keys are only for aria when labels omitted (tests).
  return traceHistoryScopeLabelKey(scope);
}

export function TraceHistoryList({
  labels,
  locale,
  onCopied,
  onError,
  className = "",
  compact = false,
}: TraceHistoryListProps) {
  const [entries, setEntries] = useState<TraceHistoryEntry[]>(() =>
    loadTraceHistory(),
  );
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<TraceHistoryScope>("all");
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    const refresh = () => setEntries(loadTraceHistory());
    refresh();
    const onChange = () => refresh();
    window.addEventListener(TRACE_HISTORY_CHANGE_EVENT, onChange);
    // Storage events from other tabs
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === TRACE_HISTORY_STORAGE_KEY) refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(TRACE_HISTORY_CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const meta = useMemo(() => countTraceHistoryMeta(entries), [entries]);

  const filtered = useMemo(
    () => filterTraceHistory(entries, { query, scope }),
    [entries, query, scope],
  );

  const emptyState = useMemo(
    () =>
      resolveTraceHistoryEmptyState({
        total: entries.length,
        filtered: filtered.length,
        query,
        scope,
      }),
    [entries.length, filtered.length, query, scope],
  );

  const clearPlan = useMemo(() => planClearTraceHistory(entries), [entries]);

  const filtersActive = useMemo(
    () => hasActiveTraceHistoryFilters({ query, scope }),
    [query, scope],
  );

  const clearFilters = useCallback(() => {
    setQuery("");
    setScope("all");
  }, []);

  const reveal = useCallback(
    async (path: string) => {
      try {
        if (api.isTauri()) await api.pathReveal(path);
      } catch (e) {
        onError?.(String(e));
      }
    },
    [onError],
  );

  const copyPath = useCallback(
    async (path: string) => {
      try {
        await navigator.clipboard.writeText(path);
        onCopied?.();
      } catch (e) {
        onError?.(String(e));
      }
    },
    [onCopied, onError],
  );

  const removeRow = useCallback((path: string) => {
    const next = removeTraceHistory(path);
    setEntries(next);
  }, []);

  const doClearAll = useCallback(() => {
    if (!clearPlan.confirmNeeded) {
      setConfirmClear(false);
      return;
    }
    const next = clearTraceHistory();
    setEntries(next);
    setQuery("");
    setScope("all");
    setConfirmClear(false);
  }, [clearPlan.confirmNeeded]);

  const rootClass =
    "trace-history" +
    (compact ? " trace-history--compact" : "") +
    (className ? ` ${className}` : "");

  const chipCounts: Record<TraceHistoryScope, number> = {
    all: meta.total,
    local: meta.local,
    uploaded: meta.uploaded,
  };

  const toolbar =
    entries.length > 0 ? (
      <div className="trace-history-toolbar-block">
        <div
          className="trace-history-chips"
          role="toolbar"
          aria-label={labels.filterAria ?? labels.listAria}
        >
          {TRACE_HISTORY_SCOPES.map((id) => {
            const n = chipCounts[id];
            // Hide zero-count chips except "all" and the active selection.
            if (id !== "all" && n === 0 && scope !== id) return null;
            return (
              <button
                key={id}
                type="button"
                className={
                  "trace-history-chip" + (scope === id ? " is-active" : "")
                }
                aria-pressed={scope === id}
                onClick={() => setScope(id)}
              >
                <span>{scopeLabel(id, labels)}</span>
                <span className="trace-history-chip__count">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="trace-history-toolbar">
          <input
            type="search"
            className="trace-history-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={labels.searchPlaceholder}
            aria-label={labels.searchPlaceholder}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              if (clearPlan.confirmNeeded) setConfirmClear(true);
            }}
            disabled={!clearPlan.confirmNeeded}
            title={labels.clearAll}
            aria-label={labels.clearAll}
          >
            <IconTrash size={14} />
            <span className="trace-history-row__action-label">
              {labels.clearAll}
            </span>
          </button>
        </div>
      </div>
    ) : null;

  const clearModal = (
    <GlassModal
      open={confirmClear}
      onClose={() => setConfirmClear(false)}
      title={labels.clearConfirmTitle}
      size="sm"
      closeLabel={labels.closeLabel ?? labels.cancel}
      footer={
        <>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setConfirmClear(false)}
          >
            {labels.cancel}
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={doClearAll}
            disabled={!clearPlan.confirmNeeded}
          >
            {labels.clearConfirmAction}
          </button>
        </>
      }
    >
      <p className="trace-history-clear-msg" style={{ margin: 0 }}>
        {labels.clearConfirmMessage.replace(
          /\{count\}/g,
          String(clearPlan.count),
        )}
      </p>
    </GlassModal>
  );

  if (emptyState && emptyState.kind === "empty" && entries.length === 0) {
    return (
      <div className={rootClass}>
        <div className="trace-history-empty" role="status">
          <div className="trace-history-empty__title">{labels.empty}</div>
          {labels.emptyHint ? (
            <div className="trace-history-empty__hint">{labels.emptyHint}</div>
          ) : null}
        </div>
        {clearModal}
      </div>
    );
  }

  return (
    <div className={rootClass}>
      {toolbar}
      {emptyState ? (
        <div
          className="trace-history-empty"
          role="status"
          data-kind={emptyState.kind}
        >
          <div className="trace-history-empty__title">
            {emptyState.kind === "filter_empty"
              ? labels.emptyFilter
              : labels.empty}
          </div>
          {emptyState.kind === "filter_empty" && labels.emptyFilterHint ? (
            <div className="trace-history-empty__hint">
              {labels.emptyFilterHint}
            </div>
          ) : null}
          {emptyState.kind === "empty" && labels.emptyHint ? (
            <div className="trace-history-empty__hint">{labels.emptyHint}</div>
          ) : null}
          {emptyState.showClearFilters && filtersActive && labels.clearFilters ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm trace-history-clear-filters"
              onClick={clearFilters}
            >
              {labels.clearFilters}
            </button>
          ) : null}
        </div>
      ) : (
        <ul
          className={
            "trace-history-list" +
            (compact ? " trace-history-list--compact" : "")
          }
          aria-label={labels.listAria}
        >
          {filtered.map((e) => {
            const file = traceHistoryFileName(e.path);
            const label = traceHistoryLabel(e);
            // Size only when known — never invent from path.
            const sizeLabel = formatTraceSize(e.sizeBytes);
            const showUploaded =
              shouldShowTraceUploadedBadge(e) && Boolean(labels.uploadedBadge);
            return (
              <li
                key={`${e.path}|${e.exportedAt}`}
                className="trace-history-row"
              >
                <div className="trace-history-row__text">
                  <div className="trace-history-row__title" title={label}>
                    {label}
                  </div>
                  <div className="trace-history-row__meta" title={e.path}>
                    <span className="trace-history-row__file">{file}</span>
                    {sizeLabel ? (
                      <span className="trace-history-row__size">
                        {sizeLabel}
                      </span>
                    ) : null}
                    {showUploaded ? (
                      <span
                        className="trace-history-row__uploaded"
                        title={
                          labels.uploadedBadgeTitle ?? labels.uploadedBadge
                        }
                      >
                        {labels.uploadedBadge}
                      </span>
                    ) : null}
                    {e.exportedAt ? (
                      <span className="trace-history-row__when">
                        {formatListTimestamp(e.exportedAt, locale)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="trace-history-row__actions">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => void reveal(e.path)}
                    title={labels.reveal}
                    aria-label={labels.reveal}
                  >
                    <IconFolder size={14} />
                    <span className="trace-history-row__action-label">
                      {labels.reveal}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => void copyPath(e.path)}
                    title={labels.copyPath}
                    aria-label={labels.copyPath}
                  >
                    <IconCopy size={14} />
                    <span className="trace-history-row__action-label">
                      {labels.copyPath}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => removeRow(e.path)}
                    title={labels.remove}
                    aria-label={labels.remove}
                  >
                    <IconTrash size={14} />
                    <span className="trace-history-row__action-label">
                      {labels.remove}
                    </span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {clearModal}
    </div>
  );
}

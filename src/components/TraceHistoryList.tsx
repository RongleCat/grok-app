/**
 * Recent session-trace exports — paths only (never file contents).
 * Used in Settings → Runtime → Diagnostics and the Traces modal.
 */

import { useCallback, useEffect, useState } from "react";
import { IconCopy, IconFolder } from "@/components/icons";
import * as api from "@/lib/api";
import {
  TRACE_HISTORY_CHANGE_EVENT,
  loadTraceHistory,
  traceHistoryFileName,
  traceHistoryLabel,
  type TraceHistoryEntry,
} from "@/lib/traceHistory";

export type TraceHistoryListLabels = {
  empty: string;
  reveal: string;
  copyPath: string;
  copied: string;
  /** Optional column/section aria */
  listAria?: string;
};

export type TraceHistoryListProps = {
  labels: TraceHistoryListLabels;
  /** Called after copy-path success (toast). */
  onCopied?: () => void;
  /** Called after reveal failure. */
  onError?: (msg: string) => void;
  className?: string;
  /** Compact rows for modal. */
  compact?: boolean;
};

function formatExportedAt(iso: string): string {
  const d = Date.parse(iso);
  if (!Number.isFinite(d)) return iso || "";
  try {
    return new Date(d).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function TraceHistoryList({
  labels,
  onCopied,
  onError,
  className = "",
  compact = false,
}: TraceHistoryListProps) {
  const [entries, setEntries] = useState<TraceHistoryEntry[]>(() =>
    loadTraceHistory(),
  );

  useEffect(() => {
    const refresh = () => setEntries(loadTraceHistory());
    refresh();
    const onChange = () => refresh();
    window.addEventListener(TRACE_HISTORY_CHANGE_EVENT, onChange);
    // Storage events from other tabs
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === "grok.traceHistory") refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(TRACE_HISTORY_CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
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

  if (entries.length === 0) {
    return (
      <div
        className={"trace-history-empty" + (className ? ` ${className}` : "")}
        role="status"
      >
        {labels.empty}
      </div>
    );
  }

  return (
    <ul
      className={
        "trace-history-list" +
        (compact ? " trace-history-list--compact" : "") +
        (className ? ` ${className}` : "")
      }
      aria-label={labels.listAria}
    >
      {entries.map((e) => {
        const file = traceHistoryFileName(e.path);
        const label = traceHistoryLabel(e);
        return (
          <li key={`${e.path}|${e.exportedAt}`} className="trace-history-row">
            <div className="trace-history-row__text">
              <div className="trace-history-row__title" title={label}>
                {label}
              </div>
              <div
                className="trace-history-row__meta"
                title={e.path}
              >
                <span className="trace-history-row__file">{file}</span>
                {e.exportedAt ? (
                  <span className="trace-history-row__when">
                    {formatExportedAt(e.exportedAt)}
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
            </div>
          </li>
        );
      })}
    </ul>
  );
}

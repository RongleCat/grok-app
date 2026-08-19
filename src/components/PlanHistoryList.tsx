/**
 * Local archive of reviewed plans — body previews only (redacted, capped).
 * Used from the session menu / Plan history modal.
 *
 * Supports search, decision chips, clear-all (via parent confirm), and open session.
 */

import { useEffect, useMemo, useState } from "react";
import {
  PLAN_HISTORY_CHANGE_EVENT,
  PLAN_HISTORY_STORAGE_KEY,
  filterPlanHistory,
  loadPlanHistory,
  planHistoryEntryKey,
  planHistoryLabel,
  planHistoryListSnippet,
  type PlanHistoryDecision,
  type PlanHistoryEntry,
} from "@/lib/planHistory";
import { formatListTimestamp } from "@/lib/formatDateTime";

export type PlanHistoryDecisionFilter = "all" | PlanHistoryDecision;

export type PlanHistoryListLabels = {
  empty: string;
  /** Shown when archive has rows but filters match nothing. */
  emptyFilter: string;
  open: string;
  openSession: string;
  clearAll: string;
  searchPlaceholder: string;
  filterAll: string;
  decisionApproved: string;
  decisionAbandoned: string;
  decisionCompleted: string;
  /** Optional list aria */
  listAria?: string;
};

export type PlanHistoryListProps = {
  labels: PlanHistoryListLabels;
  /** App locale, so the timestamps follow Settings and not the WebView. */
  locale: string | null;
  onOpen?: (entry: PlanHistoryEntry) => void;
  /**
   * Open the chat that produced this plan when it still exists.
   * Parent should no-op / toast when the session is gone.
   */
  onOpenSession?: (entry: PlanHistoryEntry) => void;
  /** Session ids currently known (sidebar / list). Enables Open session. */
  existingSessionIds?: ReadonlySet<string> | readonly string[];
  /**
   * Clear-all control. Parent must confirm via in-app dialog, then wipe storage.
   * When omitted, clear button is hidden.
   */
  onRequestClearAll?: () => void;
  className?: string;
  compact?: boolean;
};

function decisionLabel(
  decision: PlanHistoryDecision,
  labels: PlanHistoryListLabels,
): string {
  if (decision === "approved") return labels.decisionApproved;
  if (decision === "abandoned") return labels.decisionAbandoned;
  return labels.decisionCompleted;
}

function toSessionIdSet(
  ids: ReadonlySet<string> | readonly string[] | undefined,
): ReadonlySet<string> {
  if (!ids) return new Set();
  if (ids instanceof Set) return ids;
  return new Set(ids);
}

export function PlanHistoryList({
  labels,
  locale,
  onOpen,
  onOpenSession,
  existingSessionIds,
  onRequestClearAll,
  className = "",
  compact = false,
}: PlanHistoryListProps) {
  const [entries, setEntries] = useState<PlanHistoryEntry[]>(() =>
    loadPlanHistory(),
  );
  const [query, setQuery] = useState("");
  const [decisionFilter, setDecisionFilter] =
    useState<PlanHistoryDecisionFilter>("all");

  useEffect(() => {
    const refresh = () => setEntries(loadPlanHistory());
    refresh();
    const onChange = () => refresh();
    window.addEventListener(PLAN_HISTORY_CHANGE_EVENT, onChange);
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === PLAN_HISTORY_STORAGE_KEY) refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(PLAN_HISTORY_CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const sessionIds = useMemo(
    () => toSessionIdSet(existingSessionIds),
    [existingSessionIds],
  );

  const filtered = useMemo(
    () =>
      filterPlanHistory(entries, {
        query,
        decisions: decisionFilter === "all" ? "all" : [decisionFilter],
      }),
    [entries, query, decisionFilter],
  );

  const chips: { id: PlanHistoryDecisionFilter; label: string }[] = [
    { id: "all", label: labels.filterAll },
    { id: "approved", label: labels.decisionApproved },
    { id: "abandoned", label: labels.decisionAbandoned },
    { id: "completed", label: labels.decisionCompleted },
  ];

  const shellClass =
    "plan-history" +
    (compact ? " plan-history--compact" : "") +
    (className ? ` ${className}` : "");

  if (entries.length === 0) {
    return (
      <div className={shellClass}>
        <div className="plan-history-empty" role="status">
          {labels.empty}
        </div>
      </div>
    );
  }

  return (
    <div className={shellClass}>
      <div className="plan-history__toolbar">
        <label className="plan-history__search">
          <span className="sr-only">{labels.searchPlaceholder}</span>
          <input
            type="search"
            className="plan-history__search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={labels.searchPlaceholder}
            autoComplete="off"
            data-testid="plan-history-search"
          />
        </label>
        {onRequestClearAll ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm plan-history__clear"
            onClick={onRequestClearAll}
            data-testid="plan-history-clear"
          >
            {labels.clearAll}
          </button>
        ) : null}
      </div>

      <div
        className="plan-history__chips settings-seg"
        role="tablist"
        aria-label={labels.listAria}
      >
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            className={
              "settings-seg__btn plan-history__chip" +
              (decisionFilter === c.id ? " is-on" : "")
            }
            aria-selected={decisionFilter === c.id}
            data-testid={`plan-history-filter-${c.id}`}
            onClick={() => setDecisionFilter(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="plan-history-empty" role="status">
          {labels.emptyFilter}
        </div>
      ) : (
        <ul
          className={
            "plan-history-list" +
            (compact ? " plan-history-list--compact" : "")
          }
          aria-label={labels.listAria}
        >
          {filtered.map((e) => {
            const label = planHistoryLabel(e);
            const snippet = planHistoryListSnippet(e);
            const decision = decisionLabel(e.decision, labels);
            const canOpenSession =
              !!onOpenSession && sessionIds.has(e.sessionId);
            return (
              <li key={planHistoryEntryKey(e)} className="plan-history-row">
                <button
                  type="button"
                  className="plan-history-row__btn"
                  onClick={() => onOpen?.(e)}
                  title={labels.open}
                >
                  <div className="plan-history-row__text">
                    <div className="plan-history-row__title" title={label}>
                      {label}
                    </div>
                    <div className="plan-history-row__meta">
                      <span
                        className={
                          "plan-history-row__decision plan-history-row__decision--" +
                          e.decision
                        }
                      >
                        {decision}
                      </span>
                      {e.at ? (
                        <span className="plan-history-row__when">
                          {formatListTimestamp(e.at, locale)}
                        </span>
                      ) : null}
                    </div>
                    {snippet ? (
                      <div className="plan-history-row__snippet" title={snippet}>
                        {snippet}
                      </div>
                    ) : null}
                  </div>
                </button>
                {canOpenSession ? (
                  <div className="plan-history-row__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onOpenSession?.(e);
                      }}
                      title={labels.openSession}
                      data-testid="plan-history-open-session"
                    >
                      {labels.openSession}
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

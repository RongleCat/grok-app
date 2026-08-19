/**
 * Process budget occupancy panel — live warm-agent counts vs maxConcurrentAgents.
 * Used in Settings → Runtime → Process pool and Reliability center.
 * Soft-fails when host snapshot is unavailable; never invents busy occupancy.
 * Empty honesty + process_limit callout via processBudgetPro.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createT, intlLocale, type Locale, type MessageKey } from "@/i18n";
import * as api from "@/lib/api";
import {
  DEFAULT_MAX_CONCURRENT_AGENTS,
  emptyProcessBudgetSnapshot,
  occupancyPercent,
  occupancyTone,
  parseProcessBudgetSnapshot,
  processBudgetCountVars,
  PROCESS_BUDGET_POLL_MS,
  reclaimPlan,
  reclaimPlanCopyKey,
  type ProcessBudgetSnapshot,
  type ProcessLimitEvent,
} from "@/lib/processBudget";
import {
  formatOccupancySummary,
  resolveProcessBudgetEmptyState,
  resolveProcessLimitCalloutState,
} from "@/lib/processBudgetPro";

export type ProcessBudgetPanelProps = {
  locale: Locale;
  /** When false, skip polling (e.g. settings tab not visible). Default true. */
  active?: boolean;
  /** Compact (settings row) vs card (reliability). */
  variant?: "settings" | "card";
  /** Last process_limit event from App (optional honesty callout). */
  lastProcessLimit?: ProcessLimitEvent | null;
  /** Optional class on root. */
  className?: string;
  /** Anchor id for settings search / deep link. */
  id?: string;
};

function formatWhen(ms: number, locale: Locale): string {
  try {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(
      intlLocale(locale),
      { dateStyle: "short", timeStyle: "short" },
    );
  } catch {
    return "";
  }
}

export function ProcessBudgetPanel({
  locale,
  active = true,
  variant = "settings",
  lastProcessLimit = null,
  className = "",
  id,
}: ProcessBudgetPanelProps) {
  const t = useMemo(() => createT(locale), [locale]);
  const [snap, setSnap] = useState<ProcessBudgetSnapshot>(() =>
    emptyProcessBudgetSnapshot(),
  );
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await api.processBudgetSnapshot();
      setSnap(parseProcessBudgetSnapshot(raw));
      setLoadError(null);
    } catch (err) {
      setSnap(emptyProcessBudgetSnapshot());
      setLoadError(err);
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, PROCESS_BUDGET_POLL_MS);
    return () => window.clearInterval(timer);
  }, [active, load]);

  const empty = resolveProcessBudgetEmptyState({
    loading,
    snapshot: snap,
    error: loadError,
  });
  const summary = formatOccupancySummary(snap);
  const plan = reclaimPlan(snap);
  const planKey = reclaimPlanCopyKey(plan) as MessageKey;
  const tone = empty != null ? empty.tone : occupancyTone(plan);
  // Count vars for i18n: use live snap when available; else max/idle only (zeros elsewhere).
  const vars = processBudgetCountVars(
    snap.available
      ? snap
      : {
          ...emptyProcessBudgetSnapshot({
            maxConcurrent:
              snap.maxConcurrent || DEFAULT_MAX_CONCURRENT_AGENTS,
            idleMinutes: snap.idleMinutes || 30,
          }),
          maxConcurrent:
            snap.maxConcurrent || DEFAULT_MAX_CONCURRENT_AGENTS,
          idleMinutes: snap.idleMinutes || 30,
        },
  );
  const pct = summary.available
    ? occupancyPercent(summary.total, summary.max)
    : 0;

  const limitCallout = resolveProcessLimitCalloutState({
    event: lastProcessLimit,
    now,
  });

  const rootClass =
    (variant === "card" ? "reliab-card process-budget-panel" : "process-budget-panel") +
    (className ? ` ${className}` : "");

  const headCountLabel = (() => {
    if (empty?.kind === "loading") return t("processBudget.loading");
    if (empty?.kind === "error") return t("processBudget.unavailable");
    if (empty?.kind === "unavailable") return t("processBudget.unavailable");
    if (summary.available) return t("processBudget.counts", vars);
    return t("processBudget.unavailable");
  })();

  const planBody = (() => {
    if (empty?.kind === "loading") {
      return t((empty.bodyKey ?? empty.titleKey) as MessageKey);
    }
    if (empty?.kind === "error") {
      const title = t(empty.titleKey as MessageKey);
      const body = empty.bodyKey
        ? t(empty.bodyKey as MessageKey)
        : "";
      return body ? `${title} ${body}` : title;
    }
    if (empty?.kind === "unavailable") {
      return t(empty.titleKey as MessageKey);
    }
    // empty_pool or occupancy: reclaim plan copy (includes honest empty pool).
    return t(planKey, vars);
  })();

  return (
    <section
      className={rootClass}
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      data-testid="process-budget-panel"
      data-available={snap.available ? "1" : "0"}
      data-plan={plan}
      data-empty-kind={empty?.kind ?? "none"}
      data-limit-kind={limitCallout.kind}
    >
      <header className="process-budget-panel__head">
        <h3
          id={id ? `${id}-title` : undefined}
          className={
            variant === "card"
              ? "reliab-card__title process-budget-panel__title"
              : "process-budget-panel__title"
          }
        >
          {t("processBudget.title")}
        </h3>
        <div className="process-budget-panel__head-actions">
          <span
            className={
              summary.available
                ? "process-budget-panel__count"
                : "process-budget-panel__count process-budget-panel__count--muted"
            }
            aria-label={
              summary.available
                ? t("processBudget.countsAria", vars)
                : headCountLabel
            }
            data-testid="process-budget-count"
          >
            {headCountLabel}
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm process-budget-panel__refresh"
            onClick={() => void load()}
            disabled={loading}
            data-testid="process-budget-refresh"
          >
            {t("processBudget.refresh")}
          </button>
        </div>
      </header>

      <p className="process-budget-panel__lead">
        {t("processBudget.lead")}
      </p>

      <div
        className={`process-budget-panel__meter process-budget-panel__meter--${tone}`}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={t("processBudget.meterAria", {
          ...vars,
          percent: pct,
        })}
        data-testid="process-budget-meter"
      >
        <div
          className="process-budget-panel__meter-fill"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div
        className="process-budget-panel__buckets"
        aria-hidden={!snap.available}
        data-testid="process-budget-buckets"
      >
        <span className="process-budget-panel__bucket">
          <span className="process-budget-panel__bucket-label">
            {t("processBudget.bucket.live")}
          </span>
          <span className="process-budget-panel__bucket-val">
            {summary.available ? summary.live : "—"}
          </span>
        </span>
        <span className="process-budget-panel__bucket">
          <span className="process-budget-panel__bucket-label">
            {t("processBudget.bucket.background")}
          </span>
          <span className="process-budget-panel__bucket-val">
            {summary.available ? summary.background : "—"}
          </span>
        </span>
        <span className="process-budget-panel__bucket">
          <span className="process-budget-panel__bucket-label">
            {t("processBudget.bucket.parked")}
          </span>
          <span className="process-budget-panel__bucket-val">
            {summary.available ? summary.parked : "—"}
          </span>
        </span>
        <span className="process-budget-panel__bucket">
          <span className="process-budget-panel__bucket-label">
            {t("processBudget.bucket.free")}
          </span>
          <span className="process-budget-panel__bucket-val">
            {summary.available ? summary.free : "—"}
          </span>
        </span>
      </div>

      <p
        className={
          empty != null && empty.kind !== "empty_pool"
            ? "process-budget-panel__plan process-budget-panel__plan--soft"
            : "process-budget-panel__plan"
        }
        data-testid="process-budget-plan"
        data-empty-kind={empty?.kind ?? "none"}
      >
        {planBody}
      </p>

      {empty?.kind === "empty_pool" && empty.bodyKey ? (
        <p
          className="process-budget-panel__empty-hint"
          data-testid="process-budget-empty-hint"
        >
          {t(empty.bodyKey as MessageKey, vars)}
        </p>
      ) : null}

      {empty?.kind === "unavailable" && empty.bodyKey ? (
        <p
          className="process-budget-panel__empty-hint"
          data-testid="process-budget-unavailable-hint"
        >
          {t(empty.bodyKey as MessageKey)}
        </p>
      ) : null}

      <p className="process-budget-panel__policy">
        {t("processBudget.idlePolicy", { idleMinutes: vars.idleMinutes })}
      </p>

      <div
        className={
          limitCallout.emphasized
            ? "process-budget-panel__limit process-budget-panel__limit--active"
            : "process-budget-panel__limit process-budget-panel__limit--none"
        }
        role="status"
        data-testid="process-budget-last-limit"
        data-limit-kind={limitCallout.kind}
      >
        <div className="process-budget-panel__limit-title">
          {t(limitCallout.titleKey)}
        </div>
        <p className="process-budget-panel__limit-body">
          {limitCallout.kind === "active" && lastProcessLimit
            ? t(limitCallout.bodyKey, {
                max:
                  lastProcessLimit.maxConcurrentAgents ??
                  vars.max ??
                  DEFAULT_MAX_CONCURRENT_AGENTS,
                when: formatWhen(lastProcessLimit.at, locale),
              })
            : t(limitCallout.bodyKey)}
        </p>
      </div>
    </section>
  );
}

export type { ProcessLimitEvent };

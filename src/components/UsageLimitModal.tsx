/**
 * TUI `/usage` Usage limit tab — weekly SuperGrok quota + session spend.
 */

import { useEffect, useMemo, useState } from "react";
import { createT, type Locale } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import * as api from "@/lib/api";
import type { AccountStatus } from "@/lib/api";
import {
  isQuotaUsageKnown,
  resolveQuotaPercents,
} from "@/lib/accountQuotaHonesty";
import { tierLabel } from "@/lib/accountUi";
import {
  formatApiDuration,
  formatExactTokenCount,
  formatUsdFromTicks,
  formatUsageResetTime,
  hasSessionSpend,
  type SessionSpend,
} from "@/lib/sessionSpend";

type Props = {
  open: boolean;
  locale: Locale;
  sessionId?: string | null;
  spend: SessionSpend;
  account: AccountStatus | null;
  customRoute?: boolean;
  onClose: () => void;
};

function formatPercent(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p >= 10) return `${Math.round(p)}%`;
  if (p >= 1) return `${Math.round(p * 10) / 10}%`;
  return `${Math.round(p * 100) / 100}%`;
}

export function UsageLimitModal({
  open,
  locale,
  sessionId,
  spend,
  account,
  customRoute = false,
  onClose,
}: Props) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [liveAccount, setLiveAccount] = useState<AccountStatus | null>(null);
  const effectiveAccount = liveAccount ?? account;
  const billing = effectiveAccount?.billing ?? null;
  const usageKnown = isQuotaUsageKnown(billing);
  const { usedPercent } = resolveQuotaPercents(billing);
  const plan = billing
    ? tierLabel(billing, effectiveAccount?.channel ?? "")
    : "—";
  const resetTime = formatUsageResetTime(billing?.resetsAt, locale);
  const weeklyTitle =
    plan && plan !== "—"
      ? tr("usageModal.weeklyTitleNamed", { plan })
      : tr("usageModal.weeklyTitle");
  const cost = formatUsdFromTicks(spend.costUsdTicks);
  const showSpend = hasSessionSpend(spend);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void api
      .accountStatus({ refreshBilling: true })
      .then((st) => {
        if (!cancelled && st) setLiveAccount(st);
      })
      .catch(() => {
        /* quota refresh is best-effort; last snapshot still shows */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const barTone =
    usedPercent == null
      ? ""
      : usedPercent >= 90
        ? " is-danger"
        : usedPercent >= 70
          ? " is-warn"
          : "";

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      title={tr("usageModal.title")}
      titleId="usage-limit-modal-title"
      closeLabel={tr("common.close")}
      size="md"
      className="usage-limit-modal"
      wrapBody
      bodyClassName="usage-limit-modal__body"
      footer={
        <>
          {!customRoute ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                void api.accountOpenUsage();
              }}
            >
              {tr("usageModal.manage")}
            </button>
          ) : null}
          <button type="button" className="btn btn--solid" onClick={onClose}>
            {tr("common.close")}
          </button>
        </>
      }
    >
      <section className="usage-limit-modal__section" aria-labelledby="usage-weekly-title">
        <h3 id="usage-weekly-title" className="usage-limit-modal__h">
          {weeklyTitle}
        </h3>
        {customRoute ? (
          <p className="usage-limit-modal__note">{tr("usageModal.quotaCustom")}</p>
        ) : usageKnown && usedPercent != null ? (
          <>
            <div className="usage-limit-modal__bar-row">
              <div className="account-quota-bar" aria-hidden>
                <div
                  className={`account-quota-bar__fill${barTone}`}
                  style={{
                    width: `${Math.min(100, usedPercent)}%`,
                  }}
                />
              </div>
              <span className="usage-limit-modal__pct">
                {formatPercent(usedPercent)}
              </span>
            </div>
            {resetTime ? (
              <p className="usage-limit-modal__meta">
                {tr("usageModal.resets", { time: resetTime })}
              </p>
            ) : null}
          </>
        ) : (
          <p className="usage-limit-modal__note">{tr("usageModal.quotaUnknown")}</p>
        )}
      </section>

      <section className="usage-limit-modal__section" aria-labelledby="usage-session-title">
        <h3 id="usage-session-title" className="usage-limit-modal__h">
          {tr("usageModal.sessionTitle")}
        </h3>
        {!sessionId ? (
          <p className="usage-limit-modal__note">{tr("usageModal.noSession")}</p>
        ) : !showSpend ? (
          <p className="usage-limit-modal__note">{tr("usageModal.noCalls")}</p>
        ) : (
          <dl className="usage-limit-modal__dl">
            <div className="usage-limit-modal__row">
              <dt>{tr("usageModal.input")}</dt>
              <dd>
                {formatExactTokenCount(spend.inputTokens, locale)}
                {spend.cachedReadTokens > 0
                  ? ` ${tr("usageModal.cached", {
                      count: formatExactTokenCount(
                        spend.cachedReadTokens,
                        locale,
                      ),
                    })}`
                  : ""}
              </dd>
            </div>
            <div className="usage-limit-modal__row">
              <dt>{tr("usageModal.output")}</dt>
              <dd>
                {formatExactTokenCount(spend.outputTokens, locale)}
                {spend.reasoningTokens > 0
                  ? ` ${tr("usageModal.reasoning", {
                      count: formatExactTokenCount(
                        spend.reasoningTokens,
                        locale,
                      ),
                    })}`
                  : ""}
              </dd>
            </div>
            <div className="usage-limit-modal__row">
              <dt>{tr("usageModal.total")}</dt>
              <dd>{formatExactTokenCount(spend.totalTokens, locale)}</dd>
            </div>
            <div className="usage-limit-modal__row">
              <dt>{tr("usageModal.modelCalls")}</dt>
              <dd>
                {formatExactTokenCount(spend.modelCalls, locale)}
                <span className="usage-limit-modal__sep"> · </span>
                <span className="usage-limit-modal__k">
                  {tr("usageModal.apiTime")}
                </span>{" "}
                {formatApiDuration(spend.apiDurationMs)}
              </dd>
            </div>
            <div className="usage-limit-modal__row">
              <dt>{tr("usageModal.cost")}</dt>
              <dd>{cost ?? "—"}</dd>
            </div>
          </dl>
        )}
        {showSpend && spend.usageIsIncomplete ? (
          <p className="usage-limit-modal__note">{tr("usageModal.incomplete")}</p>
        ) : null}
        {showSpend && spend.costIsPartial ? (
          <p className="usage-limit-modal__note">{tr("usageModal.costPartial")}</p>
        ) : null}
      </section>
    </GlassModal>
  );
}

/**
 * Account panel — clean hero card + heatmap + call logs.
 *
 * Multi-account: one button opens a modal (not inline chips).
 * Hero layout: identity | actions on top; plan/quota full width below (not mixed).
 */

import { useMemo, useRef, useState } from "react";
import type { AccountStatus, SavedAccount } from "@/lib/api";
import {
  accountDisplayName,
  accountInitials,
  formatCompactNumber,
  formatDuration,
  formatQuotaResetTime,
  formatRelativeTime,
  localDateKeyFromIso,
  tierLabel,
  usagePercent,
} from "@/lib/accountUi";
import {
  Heatmap,
  dateInHeatRange,
  sumHeatInRange,
  type HeatGranularity,
  type HeatRange,
} from "@/components/Heatmap";
import { GlassModal } from "@/components/GlassModal";
import { Tip } from "@/components/ui/tooltip";
import { IconPlus, IconTrash, IconUser } from "@/components/icons";

export interface AccountPanelLabels {
  signedIn: string;
  signedOut: string;
  loginOauth: string;
  loginDevice: string;
  logout: string;
  refresh: string;
  refreshing: string;
  manageUsage: string;
  subscribe: string;
  channel: string;
  subscription: string;
  quota: string;
  quotaRemaining: string;
  quotaUsed: string;
  quotaUnknown: string;
  period: string;
  prepaid: string;
  onDemand: string;
  heatmap: string;
  heatmapHint: string;
  callLogs: string;
  callLogsEmpty: string;
  colSession: string;
  colModel: string;
  colTurns: string;
  colTokens: string;
  colDuration: string;
  colWhen: string;
  less: string;
  more: string;
  expired: string;
  team: string;
  billingUnavailable: string;
  loginBusy: string;
  loginCancel: string;
  resetsAt: string;
  fetchedAt: string;
  products: string;
  heatmapNoData: string;
  heatmapAria: string;
  heatmapRequests: string;
  heatmapTokens: string;
  /** Day filter title: "{date} · {count} sessions" */
  callLogsDayFilter: string;
  /** Week filter title: "{start} – {end} · {count} sessions" */
  callLogsWeekFilter: string;
  callLogsClearDay: string;
  callLogsDayEmpty: string;
  heatmapDay: string;
  heatmapWeek: string;
  weeklyTitle: string;
  loginHelpTitle: string;
  loginHelpBody: string;
  loginTryDevice: string;
  profiles: string;
  profilesHint: string;
  profilesEmpty: string;
  profileSave: string;
  profileSwitch: string;
  profileRemove: string;
  profileActive: string;
  /** Open multi-account manager */
  manageAccounts: string;
  /** Save current + start OAuth for another account */
  addAccount: string;
  importChat: string;
  importChatHint: string;
  importChatBtn: string;
  close: string;
}

export interface AccountPanelProps {
  status: AccountStatus | null;
  loading: boolean;
  busy: boolean;
  locale: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
  labels: AccountPanelLabels;
  compact?: boolean;
  loginHint?: string | null;
  savedAccounts?: SavedAccount[];
  activeAccountId?: string | null;
  onLoginOauth: () => void;
  onLoginDevice: () => void;
  onCancelLogin?: () => void;
  onLogout: () => void;
  onRefresh: () => void;
  onManageUsage: () => void;
  onSubscribe: () => void;
  onOpenSettings?: () => void;
  onSaveAccount?: () => void;
  /** Save current (if signed in) then start OAuth for another account. */
  onAddAccount?: () => void;
  onSwitchAccount?: (id: string) => void;
  onRemoveAccount?: (id: string) => void;
  onImportChat?: () => void;
}

function rowInitials(a: SavedAccount): string {
  const src = (a.displayName || a.label || a.email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return src.slice(0, 2).toUpperCase() || "?";
}

export function AccountPanel({
  status,
  loading,
  busy,
  locale,
  t,
  labels,
  compact = false,
  loginHint = null,
  savedAccounts = [],
  activeAccountId = null,
  onLoginOauth,
  onLoginDevice,
  onCancelLogin,
  onLogout,
  onRefresh,
  onManageUsage,
  onSubscribe,
  onOpenSettings,
  onSaveAccount,
  onAddAccount,
  onSwitchAccount,
  onRemoveAccount,
  onImportChat,
}: AccountPanelProps) {
  const [accountsOpen, setAccountsOpen] = useState(false);
  /** Day or week range → filter recent call logs. */
  const [heatGranularity, setHeatGranularity] =
    useState<HeatGranularity>("day");
  const [selectedHeatRange, setSelectedHeatRange] = useState<HeatRange | null>(
    null,
  );
  const logsSectionRef = useRef<HTMLElement | null>(null);

  const profile = status?.profile;
  const signedIn = !!profile?.signedIn;
  const name = profile
    ? accountDisplayName(profile, t("common.local"))
    : t("common.local");
  const initials = profile ? accountInitials(profile) : "G";
  const channel = status?.channel ?? "none";
  const billing = status?.billing;
  const usedPct = billing ? usagePercent(billing) : null;
  /** Same absolute clock as sidebar UserMenu (`MM-DD HH:mm`). */
  const resetTime = formatQuotaResetTime(billing?.resetsAt);

  const rangeSessionCount = selectedHeatRange
    ? sumHeatInRange(status?.heatmap ?? [], selectedHeatRange).requests
    : null;

  const filteredCallLogs = useMemo(() => {
    const logs = status?.callLogs ?? [];
    if (!selectedHeatRange) return logs;
    return logs.filter((row) => {
      const key = localDateKeyFromIso(row.startedAt);
      return key != null && dateInHeatRange(key, selectedHeatRange);
    });
  }, [status?.callLogs, selectedHeatRange]);

  const callLogsTitle = (() => {
    if (!selectedHeatRange || rangeSessionCount == null) return labels.callLogs;
    if (selectedHeatRange.start === selectedHeatRange.end) {
      return labels.callLogsDayFilter
        .replace("{date}", selectedHeatRange.start)
        .replace("{count}", String(rangeSessionCount));
    }
    const endShort =
      selectedHeatRange.start.slice(0, 4) === selectedHeatRange.end.slice(0, 4)
        ? selectedHeatRange.end.slice(5)
        : selectedHeatRange.end;
    return labels.callLogsWeekFilter
      .replace("{start}", selectedHeatRange.start)
      .replace("{end}", endShort)
      .replace("{count}", String(rangeSessionCount));
  })();

  const onHeatSelect = (range: HeatRange | null) => {
    setSelectedHeatRange(range);
    if (range) {
      requestAnimationFrame(() => {
        logsSectionRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      });
    }
  };

  const setGranularity = (g: HeatGranularity) => {
    if (g === heatGranularity) return;
    setHeatGranularity(g);
    // Day/week cells are different shapes — drop stale selection.
    setSelectedHeatRange(null);
  };

  const remaining =
    billing?.remainingPercent != null
      ? billing.remainingPercent
      : usedPct != null
        ? Math.max(0, 100 - usedPct)
        : null;
  const products = (billing?.products ?? []).filter(
    (p) => p.usedPercent > 0 || p.productId === 1 || p.productId === 2,
  );
  const plan = billing ? tierLabel(billing, channel) : "—";
  const hasQuota = signedIn && !!billing?.available && remaining != null;

  const canManageAccounts =
    !!onSwitchAccount ||
    !!onSaveAccount ||
    !!onRemoveAccount ||
    !!onAddAccount;

  const accountsModal = canManageAccounts ? (
    <GlassModal
      open={accountsOpen}
      onClose={() => setAccountsOpen(false)}
      title={labels.profiles}
      size="md"
      closeLabel={labels.close}
      wrapBody
      footer={
        <>
          {onAddAccount ? (
            <button
              type="button"
              className="btn btn--solid"
              disabled={busy}
              onClick={() => {
                setAccountsOpen(false);
                onAddAccount();
              }}
            >
              <IconPlus size={14} />
              {labels.addAccount}
            </button>
          ) : null}
          {signedIn && onSaveAccount ? (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => {
                onSaveAccount();
              }}
            >
              {labels.profileSave}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setAccountsOpen(false)}
          >
            {labels.close}
          </button>
        </>
      }
    >
      <p className="account-mgr__hint">{labels.profilesHint}</p>
      {savedAccounts.length === 0 ? (
        <div className="account-mgr__empty">{labels.profilesEmpty}</div>
      ) : (
        <ul className="account-mgr__list">
          {savedAccounts.map((a) => {
            const active = activeAccountId === a.id;
            return (
              <li
                key={a.id}
                className={
                  "account-mgr__row" + (active ? " is-active" : "")
                }
              >
                <span className="account-mgr__av" aria-hidden>
                  {rowInitials(a)}
                </span>
                <div className="account-mgr__meta">
                  <div className="account-mgr__name">
                    <span>{a.label}</span>
                    {active ? (
                      <span className="account-badge account-badge--muted">
                        {labels.profileActive}
                      </span>
                    ) : null}
                  </div>
                  {a.email && a.email !== a.label ? (
                    <div className="account-mgr__email">{a.email}</div>
                  ) : null}
                </div>
                <div className="account-mgr__actions">
                  {!active && onSwitchAccount ? (
                    <button
                      type="button"
                      className="btn btn--solid btn--sm"
                      disabled={busy}
                      onClick={() => {
                        onSwitchAccount(a.id);
                        setAccountsOpen(false);
                      }}
                    >
                      {labels.profileSwitch}
                    </button>
                  ) : null}
                  {onRemoveAccount ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm btn--danger"
                      disabled={busy}
                      onClick={() => onRemoveAccount(a.id)}
                    >
                      <IconTrash size={14} />
                      {labels.profileRemove}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </GlassModal>
  ) : null;

  return (
    <div
      className={"account-panel" + (compact ? " account-panel--compact" : "")}
      data-testid="account-panel"
    >
      <div className="account-hero">
        {/* Row 1: identity · primary actions */}
        <div className="account-hero__top">
          <div className="account-hero__who">
            <div className="account-avatar" aria-hidden>
              {initials}
            </div>
            <div className="account-hero__id">
              <div className="account-hero__name-row">
                <span className="account-hero__name">{name}</span>
                {!signedIn ? (
                  <span className="account-badge account-badge--muted">
                    {labels.signedOut}
                  </span>
                ) : profile?.expired ? (
                  <span className="account-badge account-badge--muted account-hero__warn">
                    {labels.expired}
                  </span>
                ) : null}
              </div>
              {profile?.email && profile.email !== name ? (
                <div className="account-hero__email">{profile.email}</div>
              ) : null}
            </div>
          </div>
          <div className="account-hero__actions">
            {signedIn ? (
              <>
                {canManageAccounts ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={busy}
                    onClick={() => setAccountsOpen(true)}
                  >
                    <IconUser size={14} />
                    {labels.manageAccounts}
                    {savedAccounts.length > 0 ? (
                      <span className="account-hero__count">
                        {savedAccounts.length}
                      </span>
                    ) : null}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={busy || loading}
                  onClick={onRefresh}
                >
                  {loading ? labels.refreshing : labels.refresh}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={busy}
                  onClick={onLogout}
                >
                  {labels.logout}
                </button>
              </>
            ) : (
              <>
                {canManageAccounts && savedAccounts.length > 0 ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={busy}
                    onClick={() => setAccountsOpen(true)}
                  >
                    <IconUser size={14} />
                    {labels.manageAccounts}
                    <span className="account-hero__count">
                      {savedAccounts.length}
                    </span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn--solid btn--sm"
                  disabled={busy}
                  onClick={onLoginOauth}
                >
                  {busy ? labels.loginBusy : labels.loginOauth}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={busy}
                  onClick={onLoginDevice}
                >
                  {labels.loginDevice}
                </button>
                {busy && onCancelLogin ? (
                  <button
                    type="button"
                    className="btn btn--solid btn--sm"
                    onClick={onCancelLogin}
                  >
                    {labels.loginCancel}
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>

        {!signedIn ? (
          <div className="account-login-help" role="note">
            <strong>{labels.loginHelpTitle}</strong>
            <p>{labels.loginHelpBody}</p>
            {loginHint ? (
              <p className="account-login-help__err">{loginHint}</p>
            ) : null}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={busy}
              onClick={onLoginDevice}
            >
              {labels.loginTryDevice}
            </button>
          </div>
        ) : null}

        {/* Row 2: plan + quota (full width, clean stack) */}
        {signedIn ? (
          <div className="account-hero__plan">
            {hasQuota ? (
              <>
                <div className="account-hero__plan-head">
                  <span className="account-hero__plan-name">{plan}</span>
                  <span className="account-hero__plan-remain">
                    {remaining!.toFixed(0)}% {labels.quotaRemaining}
                  </span>
                </div>
                <div className="account-quota-bar" aria-hidden>
                  <div
                    className={
                      "account-quota-bar__fill" +
                      ((usedPct ?? 0) >= 90
                        ? " is-danger"
                        : (usedPct ?? 0) >= 70
                          ? " is-warn"
                          : "")
                    }
                    style={{ width: `${Math.min(100, usedPct ?? 0)}%` }}
                  />
                </div>
                <div className="account-hero__plan-meta">
                  <span>
                    {labels.quotaUsed} {(usedPct ?? 0).toFixed(0)}%
                    {resetTime
                      ? ` · ${labels.resetsAt} ${resetTime}`
                      : ""}
                  </span>
                  {products.length > 0 ? (
                    <span className="account-products">
                      {products.map((p) => (
                        <span
                          key={`${p.productId}-${p.label}`}
                          className="account-product-tag"
                        >
                          {p.label} {p.usedPercent.toFixed(0)}%
                        </span>
                      ))}
                    </span>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="account-hero__plan-empty">
                <span className="account-hero__plan-name">{plan}</span>
                <span className="account-hero__plan-meta-text">
                  {billing?.message || labels.quotaUnknown}
                </span>
              </div>
            )}
          </div>
        ) : null}

        {/* Row 3: text links */}
        {signedIn ? (
          <div className="account-hero__links">
            <button
              type="button"
              className="account-link"
              onClick={onManageUsage}
            >
              {labels.manageUsage}
            </button>
            <button
              type="button"
              className="account-link"
              onClick={onSubscribe}
            >
              {labels.subscribe}
            </button>
            {onImportChat ? (
              <button
                type="button"
                className="account-link"
                disabled={busy}
                onClick={onImportChat}
              >
                {labels.importChatBtn}
              </button>
            ) : null}
            {compact && onOpenSettings ? (
              <button
                type="button"
                className="account-link"
                onClick={onOpenSettings}
              >
                {t("settings.nav.account")}
              </button>
            ) : null}
          </div>
        ) : compact && onOpenSettings ? (
          <div className="account-hero__links">
            <button
              type="button"
              className="account-link"
              onClick={onOpenSettings}
            >
              {t("settings.nav.account")}
            </button>
          </div>
        ) : null}
      </div>

      {!compact && (
        <>
          <section className="account-section">
            <div className="account-section__title account-section__title--row">
              <span>{labels.heatmap}</span>
              <div
                className="account-heat-toggle"
                role="group"
                aria-label={labels.heatmap}
              >
                <button
                  type="button"
                  className={
                    "account-heat-toggle__btn" +
                    (heatGranularity === "day" ? " is-active" : "")
                  }
                  aria-pressed={heatGranularity === "day"}
                  onClick={() => setGranularity("day")}
                >
                  {labels.heatmapDay}
                </button>
                <button
                  type="button"
                  className={
                    "account-heat-toggle__btn" +
                    (heatGranularity === "week" ? " is-active" : "")
                  }
                  aria-pressed={heatGranularity === "week"}
                  onClick={() => setGranularity("week")}
                >
                  {labels.heatmapWeek}
                </button>
              </div>
            </div>
            <div className="account-section__body account-section__body--heat">
              <Heatmap
                days={status?.heatmap ?? []}
                metric="tokens"
                granularity={heatGranularity}
                locale={locale}
                selectedRange={selectedHeatRange}
                onSelectRange={onHeatSelect}
                labels={{
                  less: labels.less,
                  more: labels.more,
                  noData: labels.heatmapNoData,
                  aria: labels.heatmapAria,
                  requests: labels.heatmapRequests,
                  tokens: labels.heatmapTokens,
                }}
              />
            </div>
          </section>

          <section className="account-section" ref={logsSectionRef}>
            <div className="account-section__title account-section__title--row">
              <span>{callLogsTitle}</span>
              {selectedHeatRange ? (
                <button
                  type="button"
                  className="account-link"
                  onClick={() => setSelectedHeatRange(null)}
                >
                  {labels.callLogsClearDay}
                </button>
              ) : null}
            </div>
            <div className="account-section__body account-logs-scroll">
              {!status?.callLogs?.length ? (
                <div className="account-logs__empty">
                  {labels.callLogsEmpty}
                </div>
              ) : selectedHeatRange && filteredCallLogs.length === 0 ? (
                <div className="account-logs__empty">
                  {labels.callLogsDayEmpty}
                </div>
              ) : (
                <div className="account-logs">
                  <div className="account-logs__head">
                    <span>{labels.colSession}</span>
                    <span>{labels.colModel}</span>
                    <span>{labels.colTurns}</span>
                    <span>{labels.colTokens}</span>
                    <span>{labels.colDuration}</span>
                    <span>{labels.colWhen}</span>
                  </div>
                  {filteredCallLogs.map((row) => (
                    <div
                      key={row.id}
                      className={
                        "account-logs__row" +
                        (selectedHeatRange ? " is-day-hit" : "")
                      }
                    >
                      <Tip label={row.projectPath ?? row.title}>
                        <span className="account-logs__title">
                          {row.title}
                        </span>
                      </Tip>
                      <span className="account-logs__mono">
                        {row.model || "—"}
                      </span>
                      <span>{row.turns}</span>
                      <span>{formatCompactNumber(row.contextTokens)}</span>
                      <span>{formatDuration(row.durationSecs)}</span>
                      <span>
                        {formatRelativeTime(row.startedAt, locale)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {accountsModal}
    </div>
  );
}

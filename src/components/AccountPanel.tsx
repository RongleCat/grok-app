/**
 * Account panel — clean hero card + heatmap + call logs.
 *
 * Multi-account: one button opens a modal (not inline chips).
 * Hero layout: identity | actions on top; plan/quota full width below (not mixed).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { GrokLogo } from "@/components/GrokLogo";
import type { AccountStatus, SavedAccount } from "@/lib/api";
import {
  accountDisplayName,
  accountInitials,
  formatChineseCount,
  formatCompactNumber,
  formatDuration,
  formatQuotaResetTime,
  formatRelativeTime,
  localDateKeyFromIso,
  tierLabel,
} from "@/lib/accountUi";
import {
  formatQuotaRemainLabel,
  isQuotaUsageKnown,
  resolveQuotaEmptyState,
  resolveQuotaErrorChip,
  resolveQuotaPercents,
} from "@/lib/accountQuotaHonesty";
import {
  Heatmap,
  dateInHeatRange,
  sumHeatInRange,
  type HeatGranularity,
  type HeatRange,
} from "@/components/Heatmap";
import {
  heatmapErrorView,
  heatmapHasSamples,
  listHeatmapGranularityChips,
  resolveHeatmapErrorChip,
} from "@/lib/heatmapUsagePro";
import {
  formatStatDuration,
  summarizeHeatmapStats,
} from "@/lib/heatmapStats";
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
  colUsage: string;
  colTokens: string;
  colDuration: string;
  colWhen: string;
  less: string;
  more: string;
  expired: string;
  team: string;
  billingUnavailable: string;
  loginBusy: string;
  /** Collapsed toggle — paste is optional fallback only. */
  loginPasteToggle: string;
  loginPasteTitle: string;
  loginPasteBody: string;
  loginPastePlaceholder: string;
  loginPasteSubmit: string;
  loginCancel: string;
  resetsAt: string;
  fetchedAt: string;
  products: string;
  heatmapNoData: string;
  /** Body under no-data empty (local sessions only — not SuperGrok quota). */
  heatmapNoDataHint: string;
  heatmapLoading: string;
  heatmapLoadingHint: string;
  heatmapRangeEmpty: string;
  heatmapRangeEmptyHint: string;
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
  /** Total tokens across heatmap (or selected range). Includes `{count}`. */
  heatmapTotalTokens: string;
  /** Active days chip. Includes `{count}`. */
  heatmapActiveDays: string;
  /** Sessions count chip. Includes `{count}`. */
  heatmapSessionsCount: string;
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
  /** SuperGrok quota honesty — loading / unknown / error chips */
  quotaLoading: string;
  quotaLoadingHint: string;
  quotaChipLoading: string;
  quotaChipUnknown: string;
  quotaChipErrNetwork: string;
  quotaChipErrAuth: string;
  quotaChipErrHostOnly: string;
  quotaChipErrOther: string;
  quotaErrNetwork: string;
  quotaErrNetworkHint: string;
  quotaErrAuth: string;
  quotaErrAuthHint: string;
  quotaErrHostOnly: string;
  quotaErrHostOnlyHint: string;
  quotaErrOther: string;
  quotaErrOtherHint: string;
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
  /**
   * Soft-fail error from account_status / host (heatmap only surfaces this —
   * never invents activity cells or SuperGrok quota from it).
   */
  heatmapError?: unknown;
  /**
   * Soft-fail error from account_status / billing probe.
   * Never invents remaining % — surfaces unknown/error chips instead.
   */
  probeError?: unknown;
  savedAccounts?: SavedAccount[];
  activeAccountId?: string | null;
  onLoginOauth: () => void;
  onLoginDevice: () => void;
  /** Paste browser-shown verification code into running grok login. */
  onSubmitLoginCode?: (code: string) => void | Promise<void>;
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
  heatmapError = null,
  probeError = null,
  savedAccounts = [],
  activeAccountId = null,
  onLoginOauth,
  onLoginDevice,
  onSubmitLoginCode,
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
  /**
   * Optional paste-back from auth.x.ai “copy into Grok Build” page.
   * Collapsed by default — normal OAuth still auto-completes in the browser.
   */
  const [loginPasteOpen, setLoginPasteOpen] = useState(false);
  const [loginPasteCode, setLoginPasteCode] = useState("");
  const [loginPasteBusy, setLoginPasteBusy] = useState(false);
  // Collapse paste UI when login ends so next sign-in starts clean.
  useEffect(() => {
    if (!busy) {
      setLoginPasteOpen(false);
      setLoginPasteCode("");
      setLoginPasteBusy(false);
    }
  }, [busy]);
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
  const usageKnown = isQuotaUsageKnown(billing);
  const { usedPercent: usedPct, remainingPercent: remaining } =
    resolveQuotaPercents(billing);
  /** Same absolute clock as sidebar UserMenu (`MM-DD HH:mm`). */
  const resetTime = formatQuotaResetTime(billing?.resetsAt);

  const heatDays = status?.heatmap ?? [];
  const heatHasSamples = useMemo(
    () => heatmapHasSamples(heatDays),
    [heatDays],
  );

  const heatErrChip = useMemo(
    () => resolveHeatmapErrorChip(heatmapError),
    [heatmapError],
  );
  const heatErrView = useMemo(
    () => (heatmapError != null && heatmapError !== ""
      ? heatmapErrorView(heatmapError)
      : null),
    [heatmapError],
  );
  const heatmapErrTitle = heatErrView
    ? t(heatErrView.titleKey)
    : t("account.heatmap.err.other");
  const heatmapErrHint = heatErrView
    ? t(heatErrView.hintKey)
    : t("account.heatmap.err.otherHint");
  const granularityChips = useMemo(
    () => listHeatmapGranularityChips(heatGranularity),
    [heatGranularity],
  );
  /**
   * SuperGrok quota empty / soft-fail surface.
   * Never invent remaining % when Host is silent or probe fails.
   */
  const quotaEmpty = resolveQuotaEmptyState({
    loading,
    membership: signedIn,
    usageKnown,
    error: probeError,
  });
  const quotaErrChip =
    usageKnown && probeError != null
      ? resolveQuotaErrorChip(probeError)
      : null;
  const remainLabel = formatQuotaRemainLabel(remaining);

  const rangeSessionCount = selectedHeatRange
    ? sumHeatInRange(heatDays, selectedHeatRange).requests
    : null;

  /** Tokens in selected range or full heatmap — only when real activity exists. */
  const heatStats = useMemo(
    () => summarizeHeatmapStats(heatDays, status?.callLogs),
    [heatDays, status?.callLogs],
  );
  const locCount = locale === "zh-TW" ? "zh-TW" : "zh";
  const statDays = (n: number | null) =>
    n == null
      ? "—"
      : t("account.heatmap.stat.days", { count: String(n) });

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

  const products = (billing?.products ?? []).filter(
    (p) => p.usedPercent > 0 || p.productId === 1 || p.productId === 2,
  );
  const plan = billing ? tierLabel(billing, channel) : "—";
  /** Known remaining only — never invent when Host silent. */
  const hasQuota = signedIn && usageKnown && remainLabel != null;

  const quotaChipText = (() => {
    if (!quotaEmpty) return null;
    switch (quotaEmpty.chipKey) {
      case "account.quota.chip.loading":
        return labels.quotaChipLoading;
      case "account.quota.chip.err.network":
        return labels.quotaChipErrNetwork;
      case "account.quota.chip.err.auth":
        return labels.quotaChipErrAuth;
      case "account.quota.chip.err.host_only":
        return labels.quotaChipErrHostOnly;
      case "account.quota.chip.err.other":
        return labels.quotaChipErrOther;
      case "account.quota.chip.unknown":
      default:
        return labels.quotaChipUnknown;
    }
  })();

  const quotaEmptyTitle = (() => {
    if (!quotaEmpty) return null;
    if (quotaEmpty.kind === "loading") return labels.quotaLoading;
    if (quotaEmpty.kind === "error" && quotaEmpty.error) {
      switch (quotaEmpty.error.kind) {
        case "network":
          return labels.quotaErrNetwork;
        case "auth":
          return labels.quotaErrAuth;
        case "host_only":
          return labels.quotaErrHostOnly;
        default:
          return labels.quotaErrOther;
      }
    }
    if (quotaEmpty.kind === "unknown") return labels.quotaUnknown;
    return labels.quotaUnknown;
  })();

  const quotaEmptyBody = (() => {
    if (!quotaEmpty) return null;
    if (quotaEmpty.kind === "loading") return labels.quotaLoadingHint;
    if (quotaEmpty.kind === "error" && quotaEmpty.error) {
      switch (quotaEmpty.error.kind) {
        case "network":
          return labels.quotaErrNetworkHint;
        case "auth":
          return labels.quotaErrAuthHint;
        case "host_only":
          return labels.quotaErrHostOnlyHint;
        default:
          return labels.quotaErrOtherHint;
      }
    }
    if (quotaEmpty.kind === "unknown") {
      // Prefer host message when present; else honest billing-unavailable copy.
      return billing?.message?.trim() || labels.billingUnavailable;
    }
    return null;
  })();

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
              {signedIn ? <GrokLogo size={26} /> : initials}
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
            {/*
              Optional fallback only. Default OAuth still finishes in the
              browser with no paste. Show while login is in flight so users who
              hit the reverse pairing page can expand and paste.
            */}
            {busy && onSubmitLoginCode ? (
              <div className="account-login-paste">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm account-login-paste__toggle"
                  aria-expanded={loginPasteOpen}
                  onClick={() => setLoginPasteOpen((v) => !v)}
                >
                  {labels.loginPasteToggle}
                </button>
                {loginPasteOpen ? (
                  <>
                    <strong>{labels.loginPasteTitle}</strong>
                    <p>{labels.loginPasteBody}</p>
                    <div className="account-login-paste__row">
                      <input
                        type="text"
                        className="input account-login-paste__input"
                        value={loginPasteCode}
                        placeholder={labels.loginPastePlaceholder}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={loginPasteBusy}
                        onChange={(e) => setLoginPasteCode(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && loginPasteCode.trim()) {
                            e.preventDefault();
                            void (async () => {
                              setLoginPasteBusy(true);
                              try {
                                await onSubmitLoginCode(loginPasteCode.trim());
                                setLoginPasteCode("");
                              } finally {
                                setLoginPasteBusy(false);
                              }
                            })();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn--solid btn--sm"
                        disabled={loginPasteBusy || !loginPasteCode.trim()}
                        onClick={() => {
                          void (async () => {
                            setLoginPasteBusy(true);
                            try {
                              await onSubmitLoginCode(loginPasteCode.trim());
                              setLoginPasteCode("");
                            } finally {
                              setLoginPasteBusy(false);
                            }
                          })();
                        }}
                      >
                        {labels.loginPasteSubmit}
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
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
                    {remainLabel} {labels.quotaRemaining}
                  </span>
                </div>
                {quotaErrChip ? (
                  <span
                    className="account-quota-err-chip"
                    title={
                      quotaErrChip.kind === "network"
                        ? labels.quotaErrNetworkHint
                        : quotaErrChip.kind === "auth"
                          ? labels.quotaErrAuthHint
                          : quotaErrChip.kind === "host_only"
                            ? labels.quotaErrHostOnlyHint
                            : labels.quotaErrOtherHint
                    }
                  >
                    {quotaErrChip.kind === "network"
                      ? labels.quotaErrNetwork
                      : quotaErrChip.kind === "auth"
                        ? labels.quotaErrAuth
                        : quotaErrChip.kind === "host_only"
                          ? labels.quotaErrHostOnly
                          : labels.quotaErrOther}
                  </span>
                ) : null}
                <div className="account-quota-bar" aria-hidden>
                  <div
                    className={
                      "account-quota-bar__fill" +
                      (usedPct != null && usedPct >= 90
                        ? " is-danger"
                        : usedPct != null && usedPct >= 70
                          ? " is-warn"
                          : "")
                    }
                    style={{
                      // Only paint fill when used is known — never invent 0%.
                      width:
                        usedPct != null
                          ? `${Math.min(100, usedPct)}%`
                          : "0%",
                      opacity: usedPct != null ? 1 : 0.35,
                    }}
                  />
                </div>
                <div className="account-hero__plan-meta">
                  <span>
                    {usedPct != null
                      ? `${labels.quotaUsed} ${usedPct.toFixed(0)}%`
                      : labels.quotaChipUnknown}
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
              <div
                className={
                  "account-hero__plan-empty" +
                  (quotaEmpty?.softFail ? " is-soft-fail" : "")
                }
                data-testid="account-quota-empty"
                data-quota-kind={quotaEmpty?.kind ?? "unknown"}
              >
                <span className="account-hero__plan-name">{plan}</span>
                {quotaChipText ? (
                  <span
                    className={
                      "account-quota-chip" +
                      (quotaEmpty?.softFail
                        ? " account-quota-chip--warn"
                        : " account-quota-chip--muted")
                    }
                  >
                    {quotaChipText}
                  </span>
                ) : null}
                <div className="account-hero__plan-empty-copy">
                  {quotaEmptyTitle ? (
                    <span className="account-hero__plan-empty-title">
                      {quotaEmptyTitle}
                    </span>
                  ) : null}
                  {quotaEmptyBody ? (
                    <span className="account-hero__plan-meta-text">
                      {quotaEmptyBody}
                    </span>
                  ) : null}
                </div>
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
              <div className="account-heatmap-title-meta">
                {heatErrChip ? (
                  <span
                    className="account-heatmap-err-chip"
                    title={heatmapErrHint}
                    data-kind={heatErrChip.kind}
                  >
                    {heatmapErrTitle}
                  </span>
                ) : null}
                <div
                  className="account-heat-toggle"
                  role="group"
                  aria-label={labels.heatmap}
                >
                  {granularityChips.map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      className={
                        "account-heat-toggle__btn" +
                        (chip.active ? " is-active" : "")
                      }
                      aria-pressed={chip.active}
                      onClick={() => setGranularity(chip.id)}
                    >
                      {chip.id === "day"
                        ? labels.heatmapDay
                        : chip.id === "week"
                          ? labels.heatmapWeek
                          : t("account.heatmap.cumulative")}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {heatHasSamples ? (
              <div className="account-heat-stats" aria-live="polite">
                <div
                  className="account-heat-stat"
                  title={
                    heatStats.totalTokens != null
                      ? String(heatStats.totalTokens)
                      : undefined
                  }
                >
                  <span className="account-heat-stat__value">
                    {formatChineseCount(heatStats.totalTokens, locCount)}
                  </span>
                  <span className="account-heat-stat__label">
                    {t("account.heatmap.stat.total")}
                  </span>
                </div>
                <div
                  className="account-heat-stat"
                  title={heatStats.peakDate ?? undefined}
                >
                  <span className="account-heat-stat__value">
                    {formatChineseCount(heatStats.peakTokens, locCount)}
                  </span>
                  <span className="account-heat-stat__label">
                    {t("account.heatmap.stat.peak")}
                  </span>
                </div>
                <div className="account-heat-stat">
                  <span className="account-heat-stat__value">
                    {formatStatDuration(
                      heatStats.longestDurationSecs,
                      locale,
                    )}
                  </span>
                  <span className="account-heat-stat__label">
                    {t("account.heatmap.stat.longestChat")}
                  </span>
                </div>
                <div className="account-heat-stat">
                  <span className="account-heat-stat__value">
                    {statDays(heatStats.currentStreak)}
                  </span>
                  <span className="account-heat-stat__label">
                    {t("account.heatmap.stat.streak")}
                  </span>
                </div>
                <div className="account-heat-stat">
                  <span className="account-heat-stat__value">
                    {statDays(heatStats.longestStreak)}
                  </span>
                  <span className="account-heat-stat__label">
                    {t("account.heatmap.stat.longestStreak")}
                  </span>
                </div>
              </div>
            ) : loading ? null : (
              <span
                className="account-heatmap-total account-heatmap-chip account-heatmap-chip--muted"
                title={labels.heatmapNoDataHint}
              >
                {labels.heatmapNoData}
              </span>
            )}
            <p className="account-section__hint account-heatmap-hint">
              {labels.heatmapHint}
            </p>
            <div className="account-section__body account-section__body--heat">
              <Heatmap
                days={heatDays}
                metric="tokens"
                granularity={heatGranularity}
                locale={locale}
                selectedRange={selectedHeatRange}
                onSelectRange={onHeatSelect}
                loading={loading}
                error={heatmapError}
                onClearRange={() => setSelectedHeatRange(null)}
                labels={{
                  less: labels.less,
                  more: labels.more,
                  noData: labels.heatmapNoData,
                  noDataHint: labels.heatmapNoDataHint,
                  loading: labels.heatmapLoading,
                  loadingHint: labels.heatmapLoadingHint,
                  rangeEmpty: labels.heatmapRangeEmpty,
                  rangeEmptyHint: labels.heatmapRangeEmptyHint,
                  clearRange: labels.callLogsClearDay,
                  aria: labels.heatmapAria,
                  requests: labels.heatmapRequests,
                  tokens: labels.heatmapTokens,
                  cumulative: t("account.heatmap.tipCumulative"),
                  errorTitle: heatmapErrTitle,
                  errorHint: heatmapErrHint,
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
                    <span>{labels.colUsage}</span>
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
                      <span>
                        {row.usageTokens != null && row.usageTokens > 0
                          ? formatCompactNumber(
                              row.usageTokens,
                              locale === "zh-TW" ? "zh-TW" : "zh",
                            )
                          : "—"}
                      </span>
                      <span>
                        {formatCompactNumber(
                          row.contextTokens,
                          locale === "zh-TW" ? "zh-TW" : "zh",
                        )}
                      </span>
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

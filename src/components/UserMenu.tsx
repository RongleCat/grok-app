/**
 * Personal center — compact upward menu: account card · settings · theme · logout.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  IconCheck,
  IconChevronRight,
  IconHelp,
  IconSettings,
  IconThemeMoon,
  IconThemeSun,
} from "@/components/icons";
import type { Theme, ThemePreference } from "@/lib/theme";
import { GrokLogo } from "@/components/GrokLogo";
import {
  FLOATING_MENU_Z_INDEX,
  useFloatingMenu,
} from "@/lib/floatingMenu";
import type {
  AccountStatus,
  CustomProvider,
  ProviderBalanceResult,
} from "@/lib/api";
import {
  accountDisplayName,
  accountInitials,
  formatQuotaResetTime,
  tierLabel,
  usagePercent,
} from "@/lib/accountUi";
import {
  formatProviderBalanceDetailParts,
  formatProviderBalanceLine,
} from "@/lib/providerBalanceFormat";

export interface UserMenuProps {
  open: boolean;
  onClose: () => void;
  /** Resolved light/dark for icons. */
  theme: Theme;
  /** Preference driving the theme submenu selection. */
  themePreference: ThemePreference;
  labels: {
    settings: string;
    /** Optional product tour entry label */
    tutorial?: string;
    theme: string;
    themeSystem: string;
    themeLight: string;
    themeDark: string;
    local: string;
    signedIn: string;
    signedOut: string;
    login: string;
    logout: string;
    remaining: string;
    customProvider: string;
    /** Prefix for quota refresh time, e.g. 重置 / Resets */
    resetsAt: string;
    /** DeepSeek balance (optional) */
    balanceAvailable?: string;
    balanceUnavailable?: string;
    balanceGranted?: string;
    balanceToppedUp?: string;
    balanceRefresh?: string;
    balanceChecking?: string;
  };
  account: AccountStatus | null;
  activeProvider: CustomProvider | null;
  accountBusy: boolean;
  /** Active custom provider balance (DeepSeek); null when N/A or failed. */
  providerBalance?: ProviderBalanceResult | null;
  providerBalanceBusy?: boolean;
  providerBalanceError?: string | null;
  onRefreshProviderBalance?: () => void;
  onSettings: () => void;
  onAccountSettings: () => void;
  /** Open optional in-app product tour */
  onTutorial?: () => void;
  onTheme: (preference: ThemePreference) => void;
  onLogin: () => void;
  onLogout: () => void;
  children: ReactNode;
}

export function remainingPercent(account: AccountStatus | null): number | null {
  if (!account?.billing) return null;
  const billing = account.billing;
  if (billing.remainingPercent != null && Number.isFinite(billing.remainingPercent)) {
    return Math.max(0, Math.min(100, billing.remainingPercent));
  }
  const used = usagePercent(billing);
  if (used == null) return null;
  return Math.max(0, Math.min(100, 100 - used));
}

const THEME_OPTIONS: ThemePreference[] = ["system", "light", "dark"];
const FLYOUT_GAP = 4;
const FLYOUT_MIN_W = 148;
const FLYOUT_EST_H = 120;

function computeThemeFlyoutStyle(
  anchor: DOMRect,
  panelW: number,
  panelH: number,
): CSSProperties {
  const vw =
    typeof window.innerWidth === "number" ? window.innerWidth : 1024;
  const vh =
    typeof window.innerHeight === "number" ? window.innerHeight : 768;
  const margin = 8;

  // Prefer open to the right of the theme row (sidebar sits left).
  let left = anchor.right + FLYOUT_GAP;
  if (left + panelW > vw - margin) {
    left = anchor.left - FLYOUT_GAP - panelW;
  }
  left = Math.max(margin, Math.min(left, vw - margin - panelW));

  // Vertically center the flyout on the theme menu item.
  let top = anchor.top + anchor.height / 2 - panelH / 2;
  top = Math.max(margin, Math.min(top, vh - margin - panelH));

  return {
    position: "fixed",
    top,
    left,
    minWidth: FLYOUT_MIN_W,
    // Above the account menu (FLOATING_MENU_Z_INDEX) so the flyout is not clipped under it.
    zIndex: FLOATING_MENU_Z_INDEX + 1,
  };
}

export function UserMenu({
  open,
  onClose,
  theme,
  themePreference,
  labels,
  account,
  activeProvider,
  accountBusy,
  providerBalance = null,
  providerBalanceBusy = false,
  providerBalanceError = null,
  onRefreshProviderBalance,
  onSettings,
  onAccountSettings,
  onTutorial,
  onTheme,
  onLogin,
  onLogout,
  children,
}: UserMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const themeItemRef = useRef<HTMLButtonElement>(null);
  const themeFlyoutRef = useRef<HTMLDivElement>(null);
  const [themeSubOpen, setThemeSubOpen] = useState(false);
  const [flyoutStyle, setFlyoutStyle] = useState<CSSProperties | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) setThemeSubOpen(false);
  }, [open]);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleCloseThemeSub = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setThemeSubOpen(false);
      closeTimerRef.current = null;
    }, 160);
  }, [clearCloseTimer]);

  const openThemeSub = useCallback(() => {
    clearCloseTimer();
    setThemeSubOpen(true);
  }, [clearCloseTimer]);

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  const updateFlyoutPos = useCallback(() => {
    const el = themeItemRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const fly = themeFlyoutRef.current;
    const pw = fly?.offsetWidth || FLYOUT_MIN_W;
    const ph = fly?.offsetHeight || FLYOUT_EST_H;
    setFlyoutStyle(computeThemeFlyoutStyle(r, pw, ph));
  }, []);

  useLayoutEffect(() => {
    if (!open || !themeSubOpen) {
      setFlyoutStyle(null);
      return;
    }
    updateFlyoutPos();
    const onMove = () => updateFlyoutPos();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, themeSubOpen, updateFlyoutPos]);

  // Refine after flyout mounts (real size).
  useLayoutEffect(() => {
    if (!open || !themeSubOpen || !themeFlyoutRef.current) return;
    updateFlyoutPos();
  }, [open, themeSubOpen, updateFlyoutPos, themePreference]);

  const { pos, style } = useFloatingMenu({
    open,
    triggerRef,
    panelRef,
    roots: [rootRef, themeFlyoutRef],
    onClose,
    placement: "up",
    fitContent: true,
    matchTriggerWidth: true,
    minWidth: 220,
    estHeight: 260,
    gap: 6,
  });

  const profile = account?.profile;
  const isCustomProvider = activeProvider != null;
  const signedIn = !isCustomProvider && !!profile?.signedIn;
  const providerName =
    activeProvider?.name.trim() || activeProvider?.id.trim() || labels.customProvider;
  const name = isCustomProvider
    ? providerName
    : profile
      ? accountDisplayName(profile, labels.local)
      : labels.local;
  const initials = isCustomProvider
    ? Array.from(providerName)[0]?.toUpperCase() || "P"
    : profile
      ? accountInitials(profile)
      : "G";
  const channel = account?.channel ?? "none";
  const billing = account?.billing;
  const usedPct = billing ? usagePercent(billing) : null;
  const remaining = remainingPercent(account);
  const resetTime = formatQuotaResetTime(billing?.resetsAt);
  const tier = billing
    ? tierLabel(billing, channel)
    : signedIn
      ? "Grok Build"
      : "—";

  const themeLabel = (pref: ThemePreference) => {
    if (pref === "system") return labels.themeSystem;
    if (pref === "light") return labels.themeLight;
    return labels.themeDark;
  };

  const themeFlyout =
    open &&
    themeSubOpen &&
    flyoutStyle &&
    typeof document !== "undefined"
      ? createPortal(
          <div
            ref={themeFlyoutRef}
            className="menu-panel user-menu__flyout"
            role="menu"
            aria-label={labels.theme}
            style={flyoutStyle}
            onMouseEnter={openThemeSub}
            onMouseLeave={scheduleCloseThemeSub}
          >
            {THEME_OPTIONS.map((pref) => {
              const selected = themePreference === pref;
              return (
                <button
                  key={pref}
                  type="button"
                  className={
                    "user-menu__item user-menu__item--flyout" +
                    (selected ? " is-selected" : "")
                  }
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    onTheme(pref);
                    setThemeSubOpen(false);
                    onClose();
                  }}
                >
                  <span className="user-menu__check" aria-hidden>
                    {selected ? <IconCheck size={14} stroke={2.4} /> : null}
                  </span>
                  <span className="user-menu__item-label">
                    {themeLabel(pref)}
                  </span>
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  const panel =
    open && pos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            className="menu-panel user-menu__pop user-menu__pop--portal user-menu__pop--account"
            role="menu"
            style={style}
          >
            <button
              type="button"
              className="user-menu__account"
              role="menuitem"
              onClick={() => {
                onClose();
                onAccountSettings();
              }}
            >
              <div className="user-menu__account-top">
                <div className="account-avatar account-avatar--sm" aria-hidden>
                  {signedIn ? <GrokLogo size={17} /> : initials}
                </div>
                <div className="user-menu__account-text">
                  <div className="user-menu__account-name-row">
                    <div className="user-menu__account-name">{name}</div>
                    {signedIn && resetTime ? (
                      <span className="user-menu__quota-reset">
                        {labels.resetsAt} {resetTime}
                      </span>
                    ) : null}
                  </div>
                  {isCustomProvider ? (
                    <>
                      <div className="user-menu__account-sub">
                        {labels.customProvider}
                        {activeProvider.model
                          ? ` / ${activeProvider.model}`
                          : ""}
                      </div>
                      {(() => {
                        const line = formatProviderBalanceLine(providerBalance);
                        const detail =
                          formatProviderBalanceDetailParts(providerBalance);
                        const showBalanceBlock =
                          onRefreshProviderBalance != null ||
                          line != null ||
                          providerBalanceError != null ||
                          providerBalanceBusy;
                        if (!showBalanceBlock) return null;
                        return (
                          <div className="user-menu__balance">
                            <div className="user-menu__quota-row">
                              <span className="user-menu__remain">
                                {line
                                  ? line
                                  : providerBalanceBusy
                                    ? (labels.balanceChecking ?? "…")
                                    : "—"}
                              </span>
                              {providerBalance?.ok &&
                              providerBalance.isAvailable === false &&
                              labels.balanceUnavailable ? (
                                <span className="user-menu__balance-warn">
                                  {labels.balanceUnavailable}
                                </span>
                              ) : providerBalance?.ok &&
                                labels.balanceAvailable ? (
                                <span className="user-menu__tier">
                                  {labels.balanceAvailable}
                                </span>
                              ) : null}
                            </div>
                            {detail &&
                            (detail.granted || detail.toppedUp) ? (
                              <div className="user-menu__account-sub user-menu__balance-detail">
                                {[
                                  detail.granted && labels.balanceGranted
                                    ? `${labels.balanceGranted} ${detail.granted}`
                                    : null,
                                  detail.toppedUp && labels.balanceToppedUp
                                    ? `${labels.balanceToppedUp} ${detail.toppedUp}`
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </div>
                            ) : null}
                            {providerBalanceError ? (
                              <div className="user-menu__balance-err">
                                {providerBalanceError}
                              </div>
                            ) : null}
                            {onRefreshProviderBalance ? (
                              <button
                                type="button"
                                className="user-menu__balance-refresh"
                                disabled={providerBalanceBusy}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRefreshProviderBalance();
                                }}
                              >
                                {providerBalanceBusy
                                  ? (labels.balanceChecking ?? "…")
                                  : (labels.balanceRefresh ?? "Refresh")}
                              </button>
                            ) : null}
                          </div>
                        );
                      })()}
                    </>
                  ) : !signedIn ? (
                    <div className="user-menu__account-sub">
                      {labels.signedOut}
                    </div>
                  ) : (
                    <div className="user-menu__quota">
                      <div className="user-menu__quota-row">
                        <span className="user-menu__tier">{tier}</span>
                        <span className="user-menu__remain">
                          {remaining != null
                            ? `${remaining.toFixed(0)}% ${labels.remaining}`
                            : "—"}
                        </span>
                      </div>
                      {remaining != null && (
                        <div
                          className="account-quota-bar account-quota-bar--sm"
                          aria-hidden
                        >
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
                              width: `${Math.min(100, usedPct ?? 0)}%`,
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </button>

            <button
              type="button"
              className="user-menu__item"
              role="menuitem"
              onClick={() => {
                onClose();
                onSettings();
              }}
            >
              <IconSettings size={16} />
              <span>{labels.settings}</span>
            </button>

            {onTutorial && labels.tutorial ? (
              <button
                type="button"
                className="user-menu__item"
                role="menuitem"
                onClick={() => {
                  onClose();
                  onTutorial();
                }}
              >
                <IconHelp size={16} />
                <span>{labels.tutorial}</span>
              </button>
            ) : null}

            <button
              ref={themeItemRef}
              type="button"
              className={
                "user-menu__item user-menu__item--submenu" +
                (themeSubOpen ? " is-open" : "")
              }
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={themeSubOpen}
              onClick={() => {
                if (themeSubOpen) {
                  setThemeSubOpen(false);
                } else {
                  openThemeSub();
                }
              }}
              onMouseEnter={openThemeSub}
              onMouseLeave={scheduleCloseThemeSub}
            >
              {theme === "dark" ? (
                <IconThemeMoon size={16} />
              ) : (
                <IconThemeSun size={16} />
              )}
              <span className="user-menu__item-label">{labels.theme}</span>
              <IconChevronRight
                size={14}
                className="user-menu__sub-chev"
                aria-hidden
              />
            </button>

            {isCustomProvider ? null : signedIn ? (
              <button
                type="button"
                className="user-menu__item user-menu__item--danger"
                role="menuitem"
                disabled={accountBusy}
                onClick={() => {
                  onClose();
                  onLogout();
                }}
              >
                <span>{labels.logout}</span>
              </button>
            ) : (
              <button
                type="button"
                className="user-menu__item"
                role="menuitem"
                disabled={accountBusy}
                onClick={() => {
                  onClose();
                  onLogin();
                }}
              >
                <span>{labels.login}</span>
              </button>
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={"user-menu" + (open ? " is-open" : "")} ref={rootRef}>
      <div ref={triggerRef} className="user-menu__anchor">
        {children}
      </div>
      {panel}
      {themeFlyout}
    </div>
  );
}

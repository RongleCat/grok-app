/**
 * Personal center — compact upward menu.
 * Optional quota / provider-balance header, then saved official accounts,
 * then what's new · theme · auth.
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
  IconSparkles,
  IconThemeMoon,
  IconThemeSun,
} from "@/components/icons";
import { GrokLogo } from "@/components/GrokLogo";
import type { Theme, ThemePreference } from "@/lib/theme";
import {
  FLOATING_MENU_Z_INDEX,
  useFloatingMenu,
} from "@/lib/floatingMenu";
import { OPEN_PRESENCE_MS, useOpenPresence } from "@/lib/openPresence";
import type { AccountStatus, CustomProvider, SavedAccount } from "@/lib/api";
import { formatQuotaResetTime } from "@/lib/accountUi";
import {
  formatQuotaRemainLabel,
  resolveQuotaPercents,
} from "@/lib/accountQuotaHonesty";
import {
  mergeAccountQuota,
  switcherDisplayName,
  type SwitcherQuota,
} from "@/lib/accountSwitcherQuota";

export type UserMenuOfficialQuota = {
  plan: string;
  resetText: string | null;
  remainLabel: string | null;
  usedPercent: number | null;
  remainLow?: boolean;
  barFillClass: string;
};

export type UserMenuProviderBalance = {
  line: string | null;
  busy: boolean;
  error: string | null;
  refreshLabel: string;
  refreshingLabel: string;
  onRefresh: () => void;
};

export interface UserMenuProps {
  open: boolean;
  /** Skip the portal exit when a full-page view replaces the workbench. */
  closeImmediately?: boolean;
  onClose: () => void;
  /** Resolved light/dark for icons. */
  theme: Theme;
  /** Preference driving the theme submenu selection. */
  themePreference: ThemePreference;
  /** App locale so per-account reset clocks follow Settings. */
  locale?: string;
  labels: {
    /** Optional what's-new entry (account menu, above the tour). */
    whatsNew?: string;
    /** Optional product tour entry label */
    tutorial?: string;
    theme: string;
    themeSystem: string;
    themeLight: string;
    themeDark: string;
    /** Opens the floating appearance editor. */
    themeEditor?: string;
    login: string;
    logout: string;
    /** Suffix after remain %, e.g. "remaining". */
    remaining?: string;
    /** Active-account badge, e.g. "Active". */
    profileActive?: string;
    /** Aria prefix when switching, e.g. "Switch to this account". */
    switchTo?: string;
    /** Prefix before reset time, e.g. "Resets". */
    resetsAt?: string;
  };
  account: AccountStatus | null;
  activeProvider: CustomProvider | null;
  accountBusy: boolean;
  /** Official SuperGrok quota card at the top of the sheet. */
  officialQuota?: UserMenuOfficialQuota | null;
  /** DeepSeek (etc.) balance card at the top of the sheet. */
  providerBalance?: UserMenuProviderBalance | null;
  /** Saved official account snapshots for in-menu switch. */
  savedAccounts?: SavedAccount[];
  activeAccountId?: string | null;
  accountQuotas?: Record<string, SwitcherQuota>;
  onSwitchAccount?: (id: string) => void;
  /** Active row opens Settings → Account. */
  onAccountSettings?: () => void;
  /** Re-open the current version's update notes. */
  onWhatsNew?: () => void;
  /** Open optional in-app product tour */
  onTutorial?: () => void;
  onTheme: (preference: ThemePreference) => void;
  /** Open the homepage appearance editor (theme + interface tabs). */
  onThemeEditor?: () => void;
  onLogin: () => void;
  onLogout: () => void;
  children: ReactNode;
}

const THEME_OPTIONS: ThemePreference[] = ["system", "light", "dark"];
const FLYOUT_GAP = 4;
const FLYOUT_MIN_W = 148;
const FLYOUT_EST_H = 172;

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
  closeImmediately = false,
  onClose,
  theme,
  themePreference,
  locale = "en",
  labels,
  account,
  activeProvider,
  accountBusy,
  officialQuota = null,
  providerBalance = null,
  savedAccounts = [],
  activeAccountId = null,
  accountQuotas = {},
  onSwitchAccount,
  onAccountSettings,
  onWhatsNew,
  onTutorial,
  onTheme,
  onThemeEditor,
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

  useEffect(() => {
    if (closeImmediately && open) onClose();
  }, [closeImmediately, onClose, open]);

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
      // Keep last rect so the flyout can play its exit motion.
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
  }, [open, themeSubOpen, updateFlyoutPos, themePreference, labels.themeEditor]);

  const panelPresence = useOpenPresence(
    open,
    true,
    closeImmediately ? 0 : OPEN_PRESENCE_MS,
  );
  const { pos, style, settled } = useFloatingMenu({
    open: !closeImmediately && panelPresence.mounted,
    triggerRef,
    panelRef,
    roots: [rootRef, themeFlyoutRef],
    onClose,
    placement: "up",
    width: 0,
    fitContent: false,
    matchTriggerWidth: true,
    estHeight: savedAccounts.length > 1 ? 360 : 260,
    gap: 6,
    // CSS owns transform (rise from the footer). Do not apply placeAbove -100%.
    anchorTransform: false,
  });
  const panelEntered = useOpenPresence(
    Boolean(open && settled),
    true,
    closeImmediately ? 0 : OPEN_PRESENCE_MS,
  ).entered;

  const isCustomProvider = activeProvider != null;
  const signedIn = !isCustomProvider && !!account?.profile?.signedIn;
  const profile = account?.profile ?? null;
  const livePercents = resolveQuotaPercents(account?.billing ?? null);
  // Top officialQuota card already shows the active remain %. With a single
  // saved account the account row is the same card again — hide it. Keep the
  // list when there are 2+ accounts to switch, or when the top card is absent.
  const showSavedOfficialAccounts =
    signedIn &&
    savedAccounts.length > 0 &&
    (savedAccounts.length > 1 || !officialQuota);
  const remainingWord = labels.remaining ?? "remaining";
  const profileActiveLabel = labels.profileActive ?? "Active";
  const switchToLabel = labels.switchTo ?? "Switch to this account";
  const resetsAtLabel = labels.resetsAt ?? "Resets";

  const themeLabel = (pref: ThemePreference) => {
    if (pref === "system") return labels.themeSystem;
    if (pref === "light") return labels.themeLight;
    return labels.themeDark;
  };

  const flyoutPresence = useOpenPresence(
    open && themeSubOpen,
    !!flyoutStyle,
    closeImmediately ? 0 : OPEN_PRESENCE_MS,
  );
  const themeFlyout =
    !closeImmediately &&
    flyoutPresence.mounted &&
    flyoutStyle &&
    typeof document !== "undefined"
      ? createPortal(
          <div
            ref={themeFlyoutRef}
            className={
              "menu-panel user-menu__flyout" +
              (flyoutPresence.entered ? " is-open" : "")
            }
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
            {labels.themeEditor && onThemeEditor ? (
              <>
                <div className="user-menu__flyout-sep" role="separator" />
                <button
                  type="button"
                  className="user-menu__item user-menu__item--flyout"
                  role="menuitem"
                  onClick={() => {
                    onThemeEditor();
                    setThemeSubOpen(false);
                    onClose();
                  }}
                >
                  <span className="user-menu__check" aria-hidden />
                  <span className="user-menu__item-label">
                    {labels.themeEditor}
                  </span>
                </button>
              </>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  const panel =
    !closeImmediately &&
    panelPresence.mounted &&
    pos &&
    typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            className={
              "menu-panel user-menu__pop user-menu__pop--portal user-menu__pop--account" +
              (panelEntered ? " is-open" : "")
            }
            role="menu"
            style={style}
          >
            {officialQuota ? (
              <div className="user-menu__quota" data-testid="user-menu-quota">
                <div className="user-menu__quota-row">
                  <span className="user-menu__tier">{officialQuota.plan}</span>
                  {officialQuota.resetText ? (
                    <span className="user-menu__quota-reset">
                      {officialQuota.resetText}
                    </span>
                  ) : null}
                </div>
                {officialQuota.remainLabel != null ||
                officialQuota.usedPercent != null ? (
                  <div className="user-menu__quota-meter">
                    {officialQuota.usedPercent != null ? (
                      <div
                        className="account-quota-bar account-quota-bar--sm"
                        aria-hidden
                      >
                        <div
                          className={
                            "account-quota-bar__fill" +
                            officialQuota.barFillClass
                          }
                          style={{
                            width: `${Math.min(100, officialQuota.usedPercent)}%`,
                          }}
                        />
                      </div>
                    ) : null}
                    {officialQuota.remainLabel ? (
                      <span
                        className={
                          "user-menu__remain" +
                          (officialQuota.remainLow ? " is-low" : "")
                        }
                      >
                        {officialQuota.remainLabel}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {providerBalance ? (
              <div
                className="user-menu__balance"
                data-testid="user-menu-balance"
              >
                {providerBalance.line ? (
                  <span className="user-menu__balance-detail">
                    {providerBalance.line}
                  </span>
                ) : null}
                {providerBalance.error ? (
                  <span className="user-menu__balance-err">
                    {providerBalance.error}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="user-menu__balance-refresh"
                  disabled={providerBalance.busy}
                  onClick={() => providerBalance.onRefresh()}
                >
                  {providerBalance.busy
                    ? providerBalance.refreshingLabel
                    : providerBalance.refreshLabel}
                </button>
              </div>
            ) : null}

            {officialQuota || providerBalance ? (
              <div className="user-menu__sep" role="separator" />
            ) : null}

            {showSavedOfficialAccounts ? (
              <div className="user-menu__accounts" data-testid="user-menu-accounts">
                {savedAccounts.map((saved) => {
                  const active = saved.id === activeAccountId;
                  const rowName = switcherDisplayName(saved);
                  const q = mergeAccountQuota(
                    saved.id,
                    saved.email,
                    accountQuotas,
                    {
                      id: activeAccountId,
                      email: profile?.email,
                      remaining: livePercents.remainingPercent,
                      used: livePercents.usedPercent,
                      resetsAt: account?.billing?.resetsAt ?? null,
                    },
                  );
                  const rowRemain = q?.remainingPercent ?? null;
                  const rowUsed = q?.usedPercent ?? null;
                  const rowReset = formatQuotaResetTime(q?.resetsAt, locale);
                  const rowRemainLabel = formatQuotaRemainLabel(rowRemain);
                  const low = rowRemain != null && rowRemain <= 10;
                  return (
                    <button
                      key={saved.id}
                      type="button"
                      className={
                        "user-menu__account" +
                        (active ? " is-active" : "") +
                        (low ? " is-low" : "")
                      }
                      role="menuitem"
                      disabled={accountBusy}
                      aria-current={active ? "true" : undefined}
                      aria-label={
                        active
                          ? `${rowName}, ${profileActiveLabel}`
                          : `${switchToLabel}: ${rowName}`
                      }
                      onClick={() => {
                        if (active) {
                          onClose();
                          onAccountSettings?.();
                          return;
                        }
                        if (!onSwitchAccount) return;
                        onClose();
                        onSwitchAccount(saved.id);
                      }}
                    >
                      <div className="user-menu__account-top">
                        <div
                          className="account-avatar account-avatar--sm"
                          aria-hidden
                        >
                          {active && signedIn ? (
                            <GrokLogo size={17} />
                          ) : (
                            rowName.slice(0, 1).toUpperCase()
                          )}
                        </div>
                        <div className="user-menu__account-text">
                          <div className="user-menu__account-name-row">
                            <div className="user-menu__account-id">
                              <div className="user-menu__account-name">
                                {rowName}
                              </div>
                              {active ? (
                                <span className="user-menu__current">
                                  {profileActiveLabel}
                                </span>
                              ) : null}
                            </div>
                            {rowReset ? (
                              <span className="user-menu__quota-reset">
                                {resetsAtLabel} {rowReset}
                              </span>
                            ) : null}
                          </div>
                          <div className="user-menu__quota">
                            <div className="user-menu__quota-row">
                              <span className="user-menu__tier">
                                {active
                                  ? (officialQuota?.plan ?? "Grok Build")
                                  : saved.email && saved.email !== rowName
                                    ? saved.email
                                    : "\u00a0"}
                              </span>
                              <span className="user-menu__remain">
                                {rowRemainLabel
                                  ? `${rowRemainLabel} ${remainingWord}`
                                  : "—"}
                              </span>
                            </div>
                            {rowRemainLabel ? (
                              <div
                                className="account-quota-bar account-quota-bar--sm"
                                aria-hidden
                              >
                                <div
                                  className={
                                    "account-quota-bar__fill" +
                                    (rowUsed != null && rowUsed >= 90
                                      ? " is-danger"
                                      : rowUsed != null && rowUsed >= 70
                                        ? " is-warn"
                                        : "")
                                  }
                                  style={{
                                    width: `${Math.min(100, rowUsed ?? 0)}%`,
                                  }}
                                />
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {showSavedOfficialAccounts ? (
              <div className="user-menu__sep" role="separator" />
            ) : null}

            {onWhatsNew && labels.whatsNew ? (
              <button
                type="button"
                className="user-menu__item"
                role="menuitem"
                onClick={() => {
                  onClose();
                  onWhatsNew();
                }}
              >
                <IconSparkles size={16} />
                <span>{labels.whatsNew}</span>
              </button>
            ) : null}

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
              onClick={openThemeSub}
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

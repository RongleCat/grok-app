/**
 * Personal center — compact upward menu: account card · settings · theme · logout.
 */

import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  IconSettings,
  IconThemeMoon,
  IconThemeSun,
} from "@/components/icons";
import type { Theme } from "@/lib/theme";
import { useFloatingMenu } from "@/lib/floatingMenu";
import type { AccountStatus, CustomProvider } from "@/lib/api";
import {
  accountDisplayName,
  accountInitials,
  formatQuotaResetTime,
  tierLabel,
  usagePercent,
} from "@/lib/accountUi";

export interface UserMenuProps {
  open: boolean;
  onClose: () => void;
  theme: Theme;
  labels: {
    settings: string;
    theme: string;
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
  };
  account: AccountStatus | null;
  activeProvider: CustomProvider | null;
  accountBusy: boolean;
  onSettings: () => void;
  onAccountSettings: () => void;
  onToggleTheme: () => void;
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

export function UserMenu({
  open,
  onClose,
  theme,
  labels,
  account,
  activeProvider,
  accountBusy,
  onSettings,
  onAccountSettings,
  onToggleTheme,
  onLogin,
  onLogout,
  children,
}: UserMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { pos, style } = useFloatingMenu({
    open,
    triggerRef,
    panelRef,
    roots: [rootRef],
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
                  {initials}
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
                    <div className="user-menu__account-sub">
                      {labels.customProvider}
                      {activeProvider.model ? ` / ${activeProvider.model}` : ""}
                    </div>
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

            <button
              type="button"
              className="user-menu__item"
              role="menuitem"
              onClick={() => {
                onToggleTheme();
              }}
            >
              {theme === "dark" ? (
                <IconThemeSun size={16} />
              ) : (
                <IconThemeMoon size={16} />
              )}
              <span>
                {labels.theme}
                <em>
                  {theme === "dark" ? labels.themeLight : labels.themeDark}
                </em>
              </span>
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
    </div>
  );
}

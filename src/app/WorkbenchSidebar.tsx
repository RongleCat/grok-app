/**
 * Left workbench rail: chrome, primary nav, session tree slot, user footer.
 * Open/new-chat and settings navigation stay with the host.
 */
import {
  useEffect,
  useState,
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { Tip } from "@/components/ui/tooltip";
import { SidebarBrand } from "@/components/SidebarBrand";
import { SidebarUpdateButton } from "@/components/SidebarUpdateButton";
import { ThemeEditorModal } from "@/components/ThemeEditorModal";
import { UserMenu } from "@/components/UserMenu";
import { GrokLogo } from "@/components/GrokLogo";
import {
  ProviderBrandIcon,
  providerAvatarLetter,
} from "@/components/ProviderBrandIcon";
import {
  IconDeviceMobile,
  IconFolderPlus,
  IconList,
  IconNewChat,
  IconScheduled,
  IconSearch,
  IconSettings,
} from "@/components/icons";
import { createT } from "@/i18n";
import {
  isDesktopHost,
  type AccountStatus,
  type CustomProvider,
  type SavedAccount,
} from "@/lib/api";
import { openThemeEditorWindow } from "@/lib/api/system";
import {
  accountDisplayName,
  accountInitials,
  formatQuotaResetTime,
  tierLabel,
} from "@/lib/accountUi";
import {
  formatQuotaRemainLabel,
  resolveQuotaPercents,
} from "@/lib/accountQuotaHonesty";
import type { SwitcherQuota } from "@/lib/accountSwitcherQuota";
import {
  formatProviderBalanceLine,
  type ProviderBalanceCache,
} from "@/lib/providerBalanceFormat";
import { resolveProviderBrandId } from "@/lib/providerPresets";
import { supportsProviderBalance } from "@/lib/providerBalanceHonesty";
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_WIDTH_MIN,
} from "@/lib/layout";
import { paneSplitSizeStyle } from "@/lib/paneSplitMotion";
import type { Theme, ThemePreference } from "@/lib/theme";
import { requestWhatsNewOpen } from "@/lib/whatsNew";

type TFn = ReturnType<typeof createT>;

function quotaBarFillClass(usedPercent: number | null): string {
  if (usedPercent != null && usedPercent >= 90) return " is-danger";
  if (usedPercent != null && usedPercent >= 70) return " is-warn";
  return "";
}

type SidebarLayout = {
  sidebarCollapsed: boolean;
  sidebarWidth: number;
};

type TitlebarMax = {
  onDoubleClick: (e: { target: EventTarget | null; button?: number }) => void;
  onMouseDown: (e: {
    target: EventTarget | null;
    button: number;
    detail: number;
    preventDefault: () => void;
  }) => void;
};

export type WorkbenchSidebarProps = {
  tr: TFn;
  locale: string;
  children: ReactNode;
  layout: SidebarLayout;
  phoneLayout: boolean;
  sidebarOverlay: boolean;
  resizingSidebar: boolean;
  dragZone: "sidebar" | "main" | null;
  sidebarOpenW: number;
  sidebarPaint: number;
  beginSidebarResize: (clientX: number, width: number) => void;
  dragRegion: "false" | "deep";
  titlebarMax: TitlebarMax;
  replaceProviderBrandLogo: boolean;
  customRouteActive: boolean;
  activeCustomProvider: CustomProvider | null;
  mainPane: "chat" | "automations" | "kanban";
  onOpenSearch: () => void;
  onNewChat: () => void;
  onNavigateAutomations: () => void;
  onNavigateKanban: () => void;
  onNavigateRemoteIm: () => void;
  showUserMenu: boolean;
  setShowUserMenu: Dispatch<SetStateAction<boolean>>;
  closeImmediately?: boolean;
  theme: Theme;
  themePreference: ThemePreference;
  account: AccountStatus | null;
  accountBusy: boolean;
  providerBalanceCache: ProviderBalanceCache | null;
  providerBalanceBusy: boolean;
  providerBalanceError: string | null;
  loadProviderBalance: (opts?: {
    force?: boolean;
    provider?: CustomProvider | null;
  }) => void | Promise<void>;
  applyThemeChoice: (preference: ThemePreference) => void;
  onSettings: () => void;
  onAccountSettings: () => void;
  onTutorial: () => void;
  onLogin: () => void;
  onLogout: () => void;
  savedAccounts: SavedAccount[];
  activeAccountId: string | null;
  accountQuotas: Record<string, SwitcherQuota>;
  onSwitchAccount: (id: string) => void;
  onUserMenuOpened: () => void;
};

export function WorkbenchSidebar(props: WorkbenchSidebarProps) {
  const [themeEditorOpen, setThemeEditorOpen] = useState(false);
  useEffect(() => {
    const onHash = () => {
      if ((window.location.hash || "").startsWith("#/settings")) {
        setThemeEditorOpen(false);
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const {
    tr,
    locale,
    children,
    layout,
    phoneLayout,
    sidebarOverlay,
    resizingSidebar,
    dragZone,
    sidebarOpenW,
    sidebarPaint,
    beginSidebarResize,
    dragRegion,
    titlebarMax,
    replaceProviderBrandLogo,
    customRouteActive,
    activeCustomProvider,
    mainPane,
    onOpenSearch,
    onNewChat,
    onNavigateAutomations,
    onNavigateKanban,
    onNavigateRemoteIm,
    showUserMenu,
    setShowUserMenu,
    closeImmediately = false,
    theme,
    themePreference,
    account,
    accountBusy,
    providerBalanceCache,
    applyThemeChoice,
    onSettings,
    onAccountSettings,
    onTutorial,
    onLogin,
    onLogout,
    onUserMenuOpened,
  } = props;

  const providerSupportsBalance =
    !!activeCustomProvider &&
    supportsProviderBalance({
      providerId: activeCustomProvider.id,
      baseUrl: activeCustomProvider.baseUrl,
    });
  const signedInOfficial =
    !customRouteActive && !!account?.profile?.signedIn;
  const pinQuota = customRouteActive
    ? providerSupportsBalance
    : signedInOfficial;
  const livePercents = resolveQuotaPercents(account?.billing ?? null);
  const remainLabel = formatQuotaRemainLabel(livePercents.remainingPercent);
  const resetTime = formatQuotaResetTime(
    account?.billing?.resetsAt,
    locale,
  );
  const officialName = account?.profile
    ? accountDisplayName(account.profile, tr("common.local"))
    : tr("common.local");
  const customName =
    activeCustomProvider?.name.trim() ||
    activeCustomProvider?.id ||
    tr("prov.customProvider");
  const pinPlan = customRouteActive
    ? `${tr("prov.customProvider")}${
        activeCustomProvider?.model
          ? ` / ${activeCustomProvider.model}`
          : ""
      }`
    : account?.billing
      ? tierLabel(account.billing, account.channel ?? "none")
      : "Grok Build";
  const pinResetText =
    signedInOfficial && resetTime
      ? `${tr("account.resetsAt")} ${resetTime}`
      : null;
  const providerBalance =
    providerBalanceCache != null &&
    providerBalanceCache.providerId === activeCustomProvider?.id
      ? providerBalanceCache.result
      : null;
  const pinRemain = customRouteActive
    ? formatProviderBalanceLine(providerBalance)
    : remainLabel;
  const remainLow =
    !customRouteActive &&
    livePercents.remainingPercent != null &&
    livePercents.remainingPercent <= 10;
  return (
    <aside
      id="workbench-sidebar"
      className={
        "sidebar" +
        (layout.sidebarCollapsed ? " sidebar--hidden" : "") +
        (resizingSidebar ? " is-resizing" : "") +
        (dragZone === "sidebar" ? " is-drop-target" : "") +
        (dragZone === "main" ? " is-drop-idle" : "") +
        (phoneLayout ? " sidebar--phone-drawer" : "") +
        (sidebarOverlay ? " sidebar--overlay" : "")
      }
      aria-label={tr("a11y.sidebar")}
      aria-hidden={layout.sidebarCollapsed}
      style={
        phoneLayout
          ? undefined
          : sidebarOverlay
            ? ({
                width: sidebarOpenW,
                minWidth: sidebarOpenW,
                maxWidth: sidebarOpenW,
                ["--sidebar-rail-min"]: `${sidebarOpenW}px`,
              } as CSSProperties)
            : resizingSidebar
              ? ({
                  ["--sidebar-rail-min"]: `${sidebarOpenW}px`,
                } as CSSProperties)
              : ({
                  ...paneSplitSizeStyle(sidebarPaint, "x", false),
                  ["--sidebar-rail-min"]: `${sidebarOpenW}px`,
                } as CSSProperties)
      }
    >
      {dragZone === "sidebar" && (
        <div className="drop-overlay drop-overlay--project" aria-hidden>
          <div className="drop-overlay__card">
            <span className="drop-overlay__icon">
              <IconFolderPlus size={22} />
            </span>
            <strong>{tr("composer.dropProjectTitle")}</strong>
            <span>{tr("composer.dropProjectHint")}</span>
          </div>
        </div>
      )}
      {!layout.sidebarCollapsed && !phoneLayout && !sidebarOverlay ? (
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={tr("sidebar.resize")}
          aria-valuenow={layout.sidebarWidth || SIDEBAR_DEFAULT_WIDTH}
          aria-valuemin={SIDEBAR_WIDTH_MIN}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            beginSidebarResize(
              e.clientX,
              layout.sidebarWidth || SIDEBAR_DEFAULT_WIDTH,
            );
          }}
        />
      ) : null}
      <div className="sidebar__clip">
        <div
          className="sidebar-chrome"
          data-tauri-drag-region={dragRegion}
          {...titlebarMax}
        >
          {/* Search sits just right of the fixed pane toggle (traffic-light safe inset). */}
          <div className="sidebar-chrome__actions">
            <Tip label={tr("sidebar.search")}>
              <button
                type="button"
                className="chrome-btn"
                aria-label={tr("sidebar.search")}
                onClick={onOpenSearch}
              >
                <IconSearch size={16} />
              </button>
            </Tip>
            <SidebarUpdateButton t={tr} />
          </div>
          <div
            className="sidebar-chrome__drag"
            data-tauri-drag-region={dragRegion}
            {...titlebarMax}
          />
        </div>

        <div className="sidebar-nav">
          <button
            type="button"
            className="nav-new"
            onClick={onNewChat}
            aria-label={tr("sidebar.newSession")}
          >
            <span className="nav-new__brand">
              <SidebarBrand
                replaceLogo={replaceProviderBrandLogo}
                brandId={
                  replaceProviderBrandLogo &&
                  customRouteActive &&
                  activeCustomProvider
                    ? resolveProviderBrandId({
                        providerId: activeCustomProvider.id,
                        baseUrl: activeCustomProvider.baseUrl,
                      })
                    : null
                }
                label={
                  replaceProviderBrandLogo &&
                  customRouteActive &&
                  activeCustomProvider
                    ? activeCustomProvider.name.trim() ||
                      activeCustomProvider.id
                    : "Grok"
                }
              />
            </span>
            <span className="nav-new__action" aria-hidden>
              <span className="nav-new__edit">
                <IconNewChat size={16} />
              </span>
              <span className="nav-new__label">
                {tr("sidebar.newSession")}
              </span>
            </span>
          </button>
          <button
            type="button"
            className={
              "nav-item" +
              (mainPane === "automations" ? " nav-item--active" : "")
            }
            onClick={onNavigateAutomations}
          >
            <span className="nav-item__icon">
              <IconScheduled size={16} />
            </span>
            {tr("sidebar.scheduled")}
          </button>
          <button
            type="button"
            className={
              "nav-item" + (mainPane === "kanban" ? " nav-item--active" : "")
            }
            onClick={onNavigateKanban}
          >
            <span className="nav-item__icon">
              <IconList size={16} />
            </span>
            {tr("sidebar.kanban")}
          </button>
          {isDesktopHost() ? (
            <button
              type="button"
              className="nav-item"
              onClick={onNavigateRemoteIm}
              title={tr("settings.nav.remoteIm")}
            >
              <span className="nav-item__icon">
                <IconDeviceMobile size={16} />
              </span>
              {tr("mirror.connect")}
            </button>
          ) : null}
        </div>

        {children}

        <div className="sidebar__account">
          {pinQuota ? (
            <button
              type="button"
              className="sidebar__quota-pin"
              aria-label={
                [pinPlan, pinRemain, pinResetText]
                  .filter(Boolean)
                  .join(", ")
              }
              onClick={onAccountSettings}
            >
              <span className="sidebar__quota-pin__row">
                <span className="sidebar__quota-pin__plan">{pinPlan}</span>
                {pinResetText ? (
                  <span className="sidebar__quota-pin__reset">
                    {pinResetText}
                  </span>
                ) : null}
              </span>
              {pinRemain ||
              (!customRouteActive &&
                livePercents.remainingPercent != null) ? (
                <span className="sidebar__quota-pin__meter">
                  {!customRouteActive &&
                  livePercents.remainingPercent != null ? (
                    <div
                      className="account-quota-bar account-quota-bar--sm"
                      aria-hidden
                    >
                      <div
                        className={
                          "account-quota-bar__fill" +
                          quotaBarFillClass(livePercents.usedPercent)
                        }
                        style={{
                          width: `${Math.min(100, livePercents.usedPercent ?? 0)}%`,
                        }}
                      />
                    </div>
                  ) : null}
                  {pinRemain ? (
                    <span
                      className={
                        "sidebar__quota-pin__remain" +
                        (remainLow ? " is-low" : "")
                      }
                    >
                      {pinRemain}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </button>
          ) : null}
          <div className="sidebar__footer-row">
            <UserMenu
              open={showUserMenu}
              onClose={() => setShowUserMenu(false)}
              closeImmediately={closeImmediately}
              theme={theme}
              themePreference={themePreference}
              account={account}
              activeProvider={activeCustomProvider}
              accountBusy={accountBusy}
              labels={{
                whatsNew: tr("whatsNew.menu"),
                tutorial: tr("tutorial.menu"),
                theme: tr("user.theme"),
                themeSystem: tr("settings.themeSystem"),
                themeLight: tr("settings.themeLight"),
                themeDark: tr("settings.themeDark"),
                themeEditor: tr("user.themeEditor"),
                login: tr("account.login"),
                logout: tr("account.logout"),
              }}
              onWhatsNew={() => requestWhatsNewOpen()}
              onTutorial={onTutorial}
              onTheme={applyThemeChoice}
              onThemeEditor={() => {
                if (isDesktopHost()) {
                  void openThemeEditorWindow().catch(() => {
                    setThemeEditorOpen(true);
                  });
                  return;
                }
                setThemeEditorOpen(true);
              }}
              onLogin={onLogin}
              onLogout={onLogout}
            >
              <Tip label={tr("user.menu")}>
                <button
                  type="button"
                  className={
                    "sidebar__footer" + (showUserMenu ? " is-open" : "")
                  }
                  aria-haspopup="menu"
                  aria-expanded={showUserMenu}
                  onClick={() => {
                    setShowUserMenu((v) => !v);
                    if (!showUserMenu) onUserMenuOpened();
                  }}
                >
                  <div
                    className={
                      "user-avatar" +
                      (activeCustomProvider &&
                      resolveProviderBrandId({
                        providerId: activeCustomProvider.id,
                        baseUrl: activeCustomProvider.baseUrl,
                      })
                        ? " user-avatar--logo"
                        : account?.profile?.signedIn
                          ? " user-avatar--logo"
                          : "")
                    }
                    aria-hidden
                  >
                    {activeCustomProvider ? (
                      resolveProviderBrandId({
                        providerId: activeCustomProvider.id,
                        baseUrl: activeCustomProvider.baseUrl,
                      }) ? (
                        <ProviderBrandIcon
                          providerId={activeCustomProvider.id}
                          baseUrl={activeCustomProvider.baseUrl}
                          size={20}
                        />
                      ) : (
                        providerAvatarLetter(
                          activeCustomProvider.name.trim() ||
                            activeCustomProvider.id,
                        )
                      )
                    ) : account?.profile?.signedIn ? (
                      <GrokLogo size={20} />
                    ) : account?.profile ? (
                      accountInitials(account.profile)
                    ) : (
                      "G"
                    )}
                  </div>
                  <div className="user-meta">
                    <span className="user-meta__name">
                      {customRouteActive ? customName : officialName}
                    </span>
                  </div>
                </button>
              </Tip>
            </UserMenu>
            <Tip label={tr("sidebar.settings")}>
              <button
                type="button"
                className="sidebar__footer-settings chrome-btn"
                aria-label={tr("sidebar.settings")}
                onClick={onSettings}
              >
                <IconSettings size={16} />
              </button>
            </Tip>
          </div>
        </div>
      </div>
      {themeEditorOpen ? (
        <ThemeEditorModal
          open
          onClose={() => setThemeEditorOpen(false)}
          locale={locale}
        />
      ) : null}
    </aside>
  );
}

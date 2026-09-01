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
import { PaneToggleButton } from "@/components/PaneToggleButton";
import { SidebarBrand } from "@/components/SidebarBrand";
import { SidebarUpdateButton } from "@/components/SidebarUpdateButton";
import { ThemeEditorModal } from "@/components/ThemeEditorModal";
import { UserMenu, remainingPercent } from "@/components/UserMenu";
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
} from "@/components/icons";
import { createT } from "@/i18n";
import {
  isDesktopHost,
  type AccountStatus,
  type CustomProvider,
  type SavedAccount,
} from "@/lib/api";
import { openThemeEditorWindow } from "@/lib/api/system";
import { accountDisplayName, accountInitials } from "@/lib/accountUi";
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
  sidebarToggleUnread?: boolean;
  onToggleSidebar?: () => void;
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
    sidebarToggleUnread = false,
    onToggleSidebar,
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
    providerBalanceBusy,
    providerBalanceError,
    loadProviderBalance,
    applyThemeChoice,
    onSettings,
    onAccountSettings,
    onTutorial,
    onLogin,
    onLogout,
    savedAccounts,
    activeAccountId,
    accountQuotas,
    onSwitchAccount,
    onUserMenuOpened,
  } = props;

  const providerSupportsBalance =
    !!activeCustomProvider &&
    supportsProviderBalance({
      providerId: activeCustomProvider.id,
      baseUrl: activeCustomProvider.baseUrl,
    });

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
          <div className="sidebar-brand-row__left">
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
            <SidebarUpdateButton t={tr} />
          </div>
          <div
            className="sidebar-chrome__drag"
            data-tauri-drag-region={dragRegion}
            {...titlebarMax}
          />
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
            {!phoneLayout && onToggleSidebar ? (
              <PaneToggleButton
                side="left"
                pinned={false}
                open={!layout.sidebarCollapsed}
                unread={sidebarToggleUnread}
                label={tr("main.leftPaneHide")}
                unreadLabel={tr("main.paneUnread")}
                controlsId="workbench-sidebar"
                onToggle={onToggleSidebar}
              />
            ) : null}
          </div>
        </div>

        <div className="sidebar-nav">
          <button
            type="button"
            className="nav-new"
            onClick={onNewChat}
          >
            <span className="nav-item__icon">
              <IconNewChat size={16} />
            </span>
            {tr("sidebar.newSession")}
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

        <UserMenu
          open={showUserMenu}
          onClose={() => setShowUserMenu(false)}
          closeImmediately={closeImmediately}
          theme={theme}
          themePreference={themePreference}
          locale={locale}
          account={account}
          activeProvider={activeCustomProvider}
          accountBusy={accountBusy}
          providerBalance={
            providerBalanceCache != null &&
            providerBalanceCache.providerId === activeCustomProvider?.id
              ? providerBalanceCache.result
              : null
          }
          providerBalanceBusy={providerBalanceBusy}
          providerBalanceError={
            providerSupportsBalance ? providerBalanceError : null
          }
          onRefreshProviderBalance={
            providerSupportsBalance
              ? () => {
                  void loadProviderBalance({ force: true });
                }
              : undefined
          }
          labels={{
            settings: tr("sidebar.settings"),
            whatsNew: tr("whatsNew.menu"),
            tutorial: tr("tutorial.menu"),
            theme: tr("user.theme"),
            themeSystem: tr("settings.themeSystem"),
            themeLight: tr("settings.themeLight"),
            themeDark: tr("settings.themeDark"),
            themeEditor: tr("user.themeEditor"),
            local: tr("common.local"),
            signedIn: tr("account.signedIn"),
            signedOut: tr("account.signedOut"),
            login: tr("account.login"),
            logout: tr("account.logout"),
            remaining: tr("account.quotaRemaining"),
            profileActive: tr("account.profileActive"),
            switchTo: tr("account.switchTo"),
            customProvider: tr("prov.customProvider"),
            resetsAt: tr("account.resetsAt"),
            balanceAvailable: tr("prov.balance.available"),
            balanceUnavailable: tr("prov.balance.unavailable"),
            balanceGranted: tr("prov.balance.granted"),
            balanceToppedUp: tr("prov.balance.toppedUp"),
            balanceRefresh: tr("prov.balance.refresh"),
            balanceChecking: tr("prov.balance.checking"),
          }}
          onSettings={onSettings}
          onAccountSettings={onAccountSettings}
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
          savedAccounts={savedAccounts}
          activeAccountId={activeAccountId}
          accountQuotas={accountQuotas}
          onSwitchAccount={onSwitchAccount}
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
                  {activeCustomProvider
                    ? activeCustomProvider.name.trim() ||
                      activeCustomProvider.id
                    : account?.profile
                      ? accountDisplayName(
                          account.profile,
                          tr("common.local"),
                        )
                      : tr("common.local")}
                </span>
                {(() => {
                  if (customRouteActive && activeCustomProvider) {
                    if (
                      !supportsProviderBalance({
                        providerId: activeCustomProvider.id,
                        baseUrl: activeCustomProvider.baseUrl,
                      })
                    ) {
                      return null;
                    }
                    const line =
                      providerBalanceCache?.providerId ===
                      activeCustomProvider.id
                        ? formatProviderBalanceLine(
                            providerBalanceCache.result,
                          )
                        : null;
                    return line ? (
                      <span className="user-meta__quota">{line}</span>
                    ) : null;
                  }
                  if (!account?.profile?.signedIn) return null;
                  const rem = remainingPercent(account);
                  return rem != null ? (
                    <span className="user-meta__quota">{rem.toFixed(0)}%</span>
                  ) : null;
                })()}
              </div>
            </button>
          </Tip>
        </UserMenu>
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

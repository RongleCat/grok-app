/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AccountStatus } from "@/lib/api";
import { createT } from "@/i18n";
import { WorkbenchSidebar, type WorkbenchSidebarProps } from "./WorkbenchSidebar";

vi.mock("@/lib/floatingMenu", () => ({
  FLOATING_MENU_Z_INDEX: 13_000,
  useFloatingMenu: () => ({
    pos: { top: 100, left: 10 },
    style: { position: "fixed" },
    settled: true,
  }),
}));

vi.mock("@/components/SidebarUpdateButton", () => ({
  SidebarUpdateButton: () => null,
}));

afterEach(cleanup);

const tr = createT("en");

function signedInAccount(): AccountStatus {
  return {
    profile: {
      signedIn: true,
      authMode: "oauth",
      email: "ada@x.ai",
      displayName: "Ada",
      userId: "u1",
      teamId: null,
      principalType: null,
      expiresAt: null,
      expired: false,
      hasRefresh: true,
      oidcIssuer: null,
    },
    hasOfficialKey: false,
    hasRelayKey: false,
    relayBaseUrl: null,
    cliAuthPresent: true,
    cliFound: true,
    cliPath: "/usr/bin/grok",
    channel: "official_oauth",
    billing: {
      available: true,
      source: "remote",
      message: null,
      subscriptionTier: "SuperGrok",
      creditUsagePercent: 11,
      remainingPercent: 89,
      monthlyLimit: null,
      includedUsed: null,
      totalUsed: null,
      prepaidBalance: null,
      onDemandEnabled: null,
      onDemandCap: null,
      onDemandUsed: null,
      billingPeriodStart: null,
      billingPeriodEnd: null,
      resetsAt: "2026-09-07T04:32:00.000Z",
      isUnifiedBillingUser: true,
      products: [],
      manageUrl: "https://grok.com/?_s=usage",
      subscribeUrl: "https://grok.com/supergrok",
      fetchedAt: "2026-09-06T00:00:00.000Z",
    },
    heatmap: [],
    callLogs: [],
    usageManageUrl: "https://grok.com/?_s=usage",
    subscribeUrl: "https://grok.com/supergrok",
  };
}

function props(
  override: Partial<WorkbenchSidebarProps> = {},
): WorkbenchSidebarProps {
  return {
    tr,
    locale: "en",
    children: <div>sessions</div>,
    layout: { sidebarCollapsed: false, sidebarWidth: 280 },
    phoneLayout: false,
    sidebarOverlay: false,
    resizingSidebar: false,
    dragZone: null,
    sidebarOpenW: 280,
    sidebarPaint: 280,
    beginSidebarResize: () => undefined,
    dragRegion: "false",
    titlebarMax: {
      onDoubleClick: () => undefined,
      onMouseDown: () => undefined,
    },
    replaceProviderBrandLogo: false,
    customRouteActive: false,
    activeCustomProvider: null,
    mainPane: "chat",
    onOpenSearch: () => undefined,
    onNewChat: () => undefined,
    onNavigateAutomations: () => undefined,
    onNavigateKanban: () => undefined,
    onNavigateRemoteIm: () => undefined,
    showUserMenu: false,
    setShowUserMenu: () => undefined,
    theme: "dark",
    themePreference: "dark",
    account: signedInAccount(),
    accountBusy: false,
    providerBalanceCache: null,
    providerBalanceBusy: false,
    providerBalanceError: null,
    loadProviderBalance: () => undefined,
    applyThemeChoice: () => undefined,
    onSettings: () => undefined,
    onAccountSettings: () => undefined,
    onTutorial: () => undefined,
    onLogin: () => undefined,
    onLogout: () => undefined,
    savedAccounts: [],
    activeAccountId: null,
    accountQuotas: {},
    onSwitchAccount: () => undefined,
    onUserMenuOpened: () => undefined,
    ...override,
  };
}

it("pins plan + reset, with remaining % on the bar row", () => {
  const onSettings = vi.fn();
  const onAccountSettings = vi.fn();
  render(
    <WorkbenchSidebar
      {...props({ onSettings, onAccountSettings })}
    />,
  );

  const pin = document.querySelector(".sidebar__quota-pin");
  expect(pin).toBeTruthy();
  expect(pin?.textContent).toContain("SuperGrok");
  expect(pin?.textContent).toContain("Resets");
  expect(pin?.textContent).not.toContain("Ada");
  expect(pin?.textContent).not.toContain("89% remaining");
  expect(
    document.querySelector(".sidebar__quota-pin__remain")?.textContent,
  ).toBe("89%");
  expect(document.querySelector(".sidebar__footer-remain")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(onSettings).toHaveBeenCalledTimes(1);
  expect(onAccountSettings).not.toHaveBeenCalled();

  fireEvent.click(pin as HTMLElement);
  expect(onAccountSettings).toHaveBeenCalledTimes(1);
});

it("does not pin a quota card when signed out, but still shows settings", () => {
  const account = signedInAccount();
  account.profile.signedIn = false;
  render(<WorkbenchSidebar {...props({ account })} />);
  expect(document.querySelector(".sidebar__quota-pin")).toBeNull();
  expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
});

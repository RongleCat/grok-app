/**
 * @vitest-environment jsdom
 *
 * Account snapshot / login verbs live here. Host supplies toast, dialog,
 * setup-gate, and focused-session reset.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createT } from "@/i18n";
import * as api from "@/lib/api";
import {
  createAccountQuotaChromeHost,
  useAccountQuotaChrome,
} from "./useAccountQuotaChrome";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    isTauri: vi.fn(() => false),
    accountStatus: vi.fn(),
    accountsList: vi.fn(),
    accountsQuota: vi.fn(),
    accountLogin: vi.fn(),
    accountLogout: vi.fn(),
    accountSwitch: vi.fn(),
    accountRemove: vi.fn(),
    accountSaveCurrent: vi.fn(),
    accountLoginCancel: vi.fn(),
    accountLoginSubmitCode: vi.fn(),
    trayRefresh: vi.fn(async () => {}),
    openExternalUrl: vi.fn(async () => {}),
  };
});

function signedOutStatus(): api.AccountStatus {
  return {
    profile: {
      signedIn: false,
      authMode: null,
      email: null,
      displayName: null,
      userId: null,
      teamId: null,
      principalType: null,
      expiresAt: null,
      expired: false,
      hasRefresh: false,
      oidcIssuer: null,
    },
    hasOfficialKey: false,
    hasRelayKey: false,
    relayBaseUrl: null,
    cliAuthPresent: false,
    cliFound: true,
    cliPath: "/cli",
    channel: "none",
    billing: {
      available: false,
      source: "test",
      message: null,
      subscriptionTier: null,
      creditUsagePercent: null,
      remainingPercent: null,
      monthlyLimit: null,
      includedUsed: null,
      totalUsed: null,
      prepaidBalance: null,
      onDemandEnabled: null,
      onDemandCap: null,
      onDemandUsed: null,
      billingPeriodStart: null,
      billingPeriodEnd: null,
      resetsAt: null,
      isUnifiedBillingUser: null,
      products: [],
      manageUrl: "",
      subscribeUrl: "",
      fetchedAt: null,
    },
    heatmap: [],
    callLogs: [],
    usageManageUrl: "",
    subscribeUrl: "",
  };
}

function setup() {
  const host = createAccountQuotaChromeHost();
  host.tr = createT("en");
  host.showToast = vi.fn();
  host.setAppDialog = vi.fn();
  host.noteAccountConnected = vi.fn();
  host.resetFocusedSession = vi.fn();
  const hostRef = { current: host };
  const hook = renderHook(() =>
    useAccountQuotaChrome({
      hostRef,
      manualCliPath: null,
      accountSettingsOpen: false,
    }),
  );
  return { ...hook, host };
}

describe("useAccountQuotaChrome", () => {
  beforeEach(() => {
    vi.mocked(api.isTauri).mockReturnValue(false);
    vi.mocked(api.accountStatus).mockResolvedValue(signedOutStatus());
    vi.mocked(api.accountsList).mockResolvedValue({
      profiles: [],
      activeId: null,
    });
    vi.mocked(api.accountLogin).mockReset();
    vi.mocked(api.trayRefresh).mockClear();
  });

  it("marks host_only errors when not running under Tauri", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.refreshAccount();
    });
    expect(result.current.accountProbeError).toMatchObject({
      code: "host_only",
    });
    expect(api.accountStatus).not.toHaveBeenCalled();
  });

  it("stores the Host snapshot and notes setup auth", async () => {
    const st = signedOutStatus();
    st.cliFound = true;
    vi.mocked(api.isTauri).mockReturnValue(true);
    vi.mocked(api.accountStatus).mockResolvedValue(st);
    vi.mocked(api.accountsList).mockResolvedValue({
      profiles: [],
      activeId: null,
    });
    const { result, host } = setup();
    await act(async () => {
      await result.current.refreshAccount({ refreshBilling: false });
    });
    await waitFor(() => {
      expect(result.current.account?.cliFound).toBe(true);
    });
    expect(host.noteAccountConnected).toHaveBeenCalledWith({
      auth: false,
      cliFound: true,
    });
  });

  it("resets the focused session after a successful login", async () => {
    vi.mocked(api.isTauri).mockReturnValue(true);
    vi.mocked(api.accountLogin).mockResolvedValue({
      ok: true,
      method: "oauth",
      message: "",
      deviceUrl: null,
      deviceCode: null,
      profile: null,
    });
    vi.mocked(api.accountStatus).mockResolvedValue(signedOutStatus());
    vi.mocked(api.accountsList).mockResolvedValue({
      profiles: [],
      activeId: null,
    });
    const { result, host } = setup();
    let ok = false;
    await act(async () => {
      ok = await result.current.runAccountLogin("oauth");
    });
    expect(ok).toBe(true);
    expect(host.resetFocusedSession).toHaveBeenCalled();
  });

  it("opens a confirm dialog before removing a saved account", () => {
    vi.mocked(api.isTauri).mockReturnValue(true);
    const { result, host } = setup();
    act(() => {
      result.current.runRemoveAccount("acc-1");
    });
    expect(host.setAppDialog).toHaveBeenCalled();
    const dialog = vi.mocked(host.setAppDialog).mock.calls[0]?.[0];
    expect(dialog).toMatchObject({ kind: "confirm", danger: true });
  });
});

/**
 * Official account snapshot, quota probe, and multi-account switcher.
 *
 * Owns the Account page / user-menu projection. Host fills
 * {@link AccountQuotaChromeHost} so setup-gate and focused-session reset
 * stay late-bound. Transcript import is not account knowledge — host may
 * call {@link runWithAccountBusy} for the shared spinner.
 */
import {
  useCallback,
  useEffect,
  useState,
  type MutableRefObject,
} from "react";
import { createT } from "@/i18n";
import * as api from "@/lib/api";
import type { AppDialog } from "@/lib/app/appDialogTypes";
import {
  canFetchOfficialQuota,
  mergeAccountStatusPreservingLocalUsage,
} from "@/lib/accountQuotaRefresh";
import {
  quotaFromHostItem,
  type SwitcherQuota,
} from "@/lib/accountSwitcherQuota";
import { isAccountConnected } from "@/lib/accountUi";
import { useAccountQuotaAutoRefresh } from "@/hooks/useAccountQuotaAutoRefresh";

type TFn = ReturnType<typeof createT>;

export type AccountQuotaChromeHost = {
  tr: TFn;
  showToast: (msg: string, ms?: number) => void;
  setAppDialog: (dialog: AppDialog) => void;
  noteAccountConnected: (next: { auth: boolean; cliFound: boolean }) => void;
  resetFocusedSession: () => void;
};

function emptyHost(): AccountQuotaChromeHost {
  const noop = () => {};
  return {
    tr: ((k: string) => k) as TFn,
    showToast: noop,
    setAppDialog: noop,
    noteAccountConnected: noop,
    resetFocusedSession: noop,
  };
}

export function createAccountQuotaChromeHost(): AccountQuotaChromeHost {
  return emptyHost();
}

export function useAccountQuotaChrome(opts: {
  hostRef: MutableRefObject<AccountQuotaChromeHost>;
  manualCliPath: string | null | undefined;
  accountSettingsOpen: boolean;
}) {
  const hostRef = opts.hostRef;
  const manualCliPath = opts.manualCliPath ?? null;

  const [account, setAccount] = useState<api.AccountStatus | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountHeatmapError, setAccountHeatmapError] = useState<unknown>(null);
  const [accountProbeError, setAccountProbeError] = useState<unknown>(null);
  const [loginHint, setLoginHint] = useState<string | null>(null);
  const [savedAccounts, setSavedAccounts] = useState<api.SavedAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [accountQuotas, setAccountQuotas] = useState<
    Record<string, SwitcherQuota>
  >({});

  const applyAccountSnapshot = useCallback((st: api.AccountStatus | null) => {
    if (st) setAccount(st);
  }, []);

  const runWithAccountBusy = useCallback(async (fn: () => Promise<void>) => {
    setAccountBusy(true);
    try {
      await fn();
    } finally {
      setAccountBusy(false);
    }
  }, []);

  const refreshAccount = useCallback(
    async (refreshOpts?: {
      refreshBilling?: boolean;
      quiet?: boolean;
      includeLocalUsage?: boolean;
      isCurrent?: () => boolean;
    }) => {
      if (!api.isTauri()) {
        setAccountHeatmapError({ code: "host_only", message: "need tauri" });
        setAccountProbeError({
          code: "host_only",
          message: "Account requires Tauri desktop runtime",
        });
        return;
      }
      const quiet = refreshOpts?.quiet === true;
      const includeLocalUsage = refreshOpts?.includeLocalUsage ?? true;
      if (!quiet) setAccountLoading(true);
      try {
        const st = await api.accountStatus({
          refreshBilling: refreshOpts?.refreshBilling ?? true,
          includeLocalUsage,
          manualCliPath: manualCliPath || null,
        });
        if (refreshOpts?.isCurrent && !refreshOpts.isCurrent()) return;
        setAccount((prev) =>
          includeLocalUsage
            ? st
            : mergeAccountStatusPreservingLocalUsage(prev, st),
        );
        if (!quiet) setAccountHeatmapError(null);
        setAccountProbeError(null);
        hostRef.current.noteAccountConnected({
          auth: isAccountConnected(st),
          cliFound: !!st?.cliFound,
        });
        if (!quiet) {
          try {
            const list = await api.accountsList();
            setSavedAccounts(list.profiles ?? []);
            setActiveAccountId(list.activeId ?? null);
          } catch {
            /* multi-account list is best-effort */
          }
        }
        void api.trayRefresh();
      } catch (e) {
        if (refreshOpts?.isCurrent && !refreshOpts.isCurrent()) return;
        console.warn("account status failed", e);
        if (!quiet) {
          setAccountHeatmapError(e);
          setAccountProbeError(e);
        }
      } finally {
        if (!quiet) setAccountLoading(false);
      }
    },
    [hostRef, manualCliPath],
  );

  const refreshSavedAccounts = useCallback(async () => {
    if (!api.isTauri()) return;
    try {
      const list = await api.accountsList();
      setSavedAccounts(list.profiles ?? []);
      setActiveAccountId(list.activeId ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  const refreshAccountQuotas = useCallback(async () => {
    if (!api.isTauri()) return;
    try {
      const r = await api.accountsQuota();
      const map: Record<string, SwitcherQuota> = {};
      for (const item of r.items ?? []) {
        map[item.id] = quotaFromHostItem(item);
      }
      setAccountQuotas(map);
    } catch {
      /* rows stay on live seed / em dash */
    }
  }, []);

  const runAccountLogin = useCallback(
    async (method: "oauth" | "device" = "oauth"): Promise<boolean> => {
      const h = hostRef.current;
      if (!api.isTauri()) {
        h.showToast(h.tr("error.needTauri"));
        return false;
      }
      setAccountBusy(true);
      setLoginHint(null);
      try {
        const res = await api.accountLogin(method);
        if (res.ok) {
          setLoginHint(null);
        } else if (res.timedOut) {
          const msg = `${h.tr("account.loginTimeout")} ${h.tr(
            "account.loginUnreachableHint",
          )}`;
          setLoginHint(msg);
          h.showToast(msg, 10000);
        } else {
          const msg = res.message || h.tr("account.loginFailed");
          setLoginHint(msg);
          h.showToast(msg, 6000);
        }
        if (res.deviceUrl) {
          try {
            await api.openExternalUrl(res.deviceUrl);
          } catch {
            /* host may already open it */
          }
        }
        await refreshAccount({ refreshBilling: true });
        await refreshSavedAccounts();
        if (res.ok) h.resetFocusedSession();
        return !!res.ok;
      } catch (e) {
        const msg = String(e);
        setLoginHint(msg);
        h.showToast(msg, 4500);
        return false;
      } finally {
        setAccountBusy(false);
      }
    },
    [hostRef, refreshAccount, refreshSavedAccounts],
  );

  const cancelAccountLogin = useCallback(async () => {
    try {
      await api.accountLoginCancel();
    } catch {
      /* still unlock UI */
    }
    setAccountBusy(false);
  }, []);

  const submitAccountLoginCode = useCallback(
    async (code: string) => {
      const h = hostRef.current;
      if (!api.isTauri()) {
        h.showToast(h.tr("error.needTauri"));
        return;
      }
      try {
        await api.accountLoginSubmitCode(code);
        h.showToast(h.tr("account.loginPasteOk"), 4000);
      } catch (e) {
        const msg = `${h.tr("account.loginPasteFailed")}: ${String(e)}`;
        setLoginHint(msg);
        h.showToast(msg, 5000);
      }
    },
    [hostRef],
  );

  const runSaveAccount = useCallback(async () => {
    if (!api.isTauri()) return;
    const h = hostRef.current;
    setAccountBusy(true);
    try {
      await api.accountSaveCurrent();
      await refreshSavedAccounts();
    } catch (e) {
      h.showToast(String(e), 4500);
    } finally {
      setAccountBusy(false);
    }
  }, [hostRef, refreshSavedAccounts]);

  const runAddAccount = useCallback(async () => {
    const h = hostRef.current;
    if (!api.isTauri()) {
      h.showToast(h.tr("error.needTauri"));
      return;
    }
    if (account?.profile?.signedIn) {
      setAccountBusy(true);
      try {
        await api.accountSaveCurrent();
        await refreshSavedAccounts();
      } catch (e) {
        h.showToast(String(e), 3500);
      } finally {
        setAccountBusy(false);
      }
    }
    await runAccountLogin("oauth");
  }, [account?.profile?.signedIn, hostRef, refreshSavedAccounts, runAccountLogin]);

  const runSwitchAccount = useCallback(
    async (id: string) => {
      if (!api.isTauri()) return;
      const h = hostRef.current;
      setAccountBusy(true);
      try {
        await api.accountSwitch(id);
        await refreshAccount({ refreshBilling: true });
        await refreshSavedAccounts();
        h.resetFocusedSession();
      } catch (e) {
        h.showToast(String(e), 4500);
      } finally {
        setAccountBusy(false);
      }
    },
    [hostRef, refreshAccount, refreshSavedAccounts],
  );

  const runRemoveAccount = useCallback(
    (id: string) => {
      if (!api.isTauri()) return;
      const h = hostRef.current;
      h.setAppDialog({
        kind: "confirm",
        title: h.tr("account.profileRemove"),
        message: h.tr("account.profilesHint"),
        confirmLabel: h.tr("account.profileRemove"),
        danger: true,
        onConfirm: async () => {
          setAccountBusy(true);
          try {
            await api.accountRemove(id);
            await refreshSavedAccounts();
          } catch (e) {
            h.showToast(String(e), 4500);
          } finally {
            setAccountBusy(false);
          }
        },
      });
    },
    [hostRef, refreshSavedAccounts],
  );

  const runAccountLogout = useCallback(async () => {
    if (!api.isTauri()) return;
    const h = hostRef.current;
    setAccountBusy(true);
    try {
      await api.accountLogout();
      await refreshAccount({ refreshBilling: false });
      await refreshSavedAccounts();
      h.resetFocusedSession();
    } catch (e) {
      h.showToast(String(e), 4500);
    } finally {
      setAccountBusy(false);
    }
  }, [hostRef, refreshAccount, refreshSavedAccounts]);

  useEffect(() => {
    if (!api.isTauri()) return;
    let cancelled = false;
    void (async () => {
      const isCurrent = () => !cancelled;
      await refreshAccount({ refreshBilling: false, isCurrent });
      if (cancelled) return;
      await refreshAccount({ refreshBilling: true, isCurrent });
      if (cancelled) return;
      await refreshSavedAccounts();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshAccount, refreshSavedAccounts]);

  useEffect(() => {
    if (!opts.accountSettingsOpen) return;
    void refreshAccount({ refreshBilling: true });
    void refreshSavedAccounts();
  }, [opts.accountSettingsOpen, refreshAccount, refreshSavedAccounts]);

  useAccountQuotaAutoRefresh({
    enabled: api.isTauri(),
    canFetch: canFetchOfficialQuota(account),
    refresh: (isCurrent) =>
      refreshAccount({
        refreshBilling: true,
        quiet: true,
        includeLocalUsage: false,
        isCurrent,
      }),
  });

  return {
    account,
    accountLoading,
    accountBusy,
    accountHeatmapError,
    accountProbeError,
    loginHint,
    savedAccounts,
    activeAccountId,
    accountQuotas,
    applyAccountSnapshot,
    runWithAccountBusy,
    refreshAccount,
    refreshSavedAccounts,
    refreshAccountQuotas,
    runAccountLogin,
    cancelAccountLogin,
    submitAccountLoginCode,
    runSaveAccount,
    runAddAccount,
    runSwitchAccount,
    runRemoveAccount,
    runAccountLogout,
  };
}

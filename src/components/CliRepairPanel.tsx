import { useCallback, useEffect, useRef, useState } from "react";
import type { CliInstallProgress, CliProbeInfo } from "@/lib/api";
import * as api from "@/lib/api";
import type { SettingsViewModel } from "@/components/settings/types";

type Props = {
  cliInfo: Pick<CliProbeInfo, "found" | "path" | "cliAuthPresent">;
  allowUnverifiedCliInstall?: boolean;
  accountBusy?: boolean;
  loginHint?: string | null;
  onCliInfoRefresh?: (cli: CliProbeInfo) => void;
  onAccountLoginOauth?: () => void;
  onAccountLoginDevice?: () => void;
  showSettingsToast?: (message: string, durationMs?: number) => void;
  t: SettingsViewModel["t"];
};

/** Recovery actions shown in Runtime when the CLI or its auth state is missing. */
export function CliRepairPanel({
  cliInfo,
  allowUnverifiedCliInstall,
  accountBusy = false,
  loginHint,
  onCliInfoRefresh,
  onAccountLoginOauth,
  onAccountLoginDevice,
  showSettingsToast,
  t,
}: Props) {
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<CliInstallProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previousAccountBusy = useRef(accountBusy);

  const refreshCli = useCallback(async () => {
    try {
      const next = await api.probeCli(cliInfo.path || undefined);
      onCliInfoRefresh?.(next);
      return next;
    } catch {
      return null;
    }
  }, [cliInfo.path, onCliInfoRefresh]);

  useEffect(() => {
    if (previousAccountBusy.current && !accountBusy) {
      void refreshCli();
    }
    previousAccountBusy.current = accountBusy;
  }, [accountBusy, refreshCli]);

  useEffect(() => {
    if (!api.isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<CliInstallProgress>(
          "setup://cli-install-progress",
          (event) => {
            if (!cancelled) setProgress(event.payload);
          },
        );
      } catch {
        // Preview builds do not expose the Tauri event bus.
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const install = useCallback(async () => {
    if (installing) return;
    setInstalling(true);
    setError(null);
    setProgress({ phase: "resolving", message: t("setup.detecting"), percent: 0 });
    try {
      const result = await api.cliInstallLatest(
        allowUnverifiedCliInstall ? { allowUnverified: true } : undefined,
      );
      if (!result.ok) {
        const message = result.message || t("settings.cliUpdateNeedCli");
        setError(t("settings.cliUpdateInstallFailed", { error: message }));
        return;
      }
      const next = await api.probeCli(result.path || undefined);
      onCliInfoRefresh?.(next);
      if (!next.found) {
        setError(t("settings.cliVersion.missing"));
        return;
      }
      showSettingsToast?.(
        t("settings.cliUpdateDone", {
          version: next.version || result.version || "—",
        }),
        3200,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(t("settings.cliUpdateInstallFailed", { error: message }));
    } finally {
      setInstalling(false);
    }
  }, [allowUnverifiedCliInstall, installing, onCliInfoRefresh, showSettingsToast, t]);

  const needsInstall = !cliInfo.found;
  const needsAuth = !cliInfo.cliAuthPresent;

  if (!needsInstall && !needsAuth) return null;

  return (
    <div className="settings-row settings-row--stack settings-row--compact" data-testid="settings-cli-repair">
      <div className="settings-row__text">
        <div className="settings-row__label">
          {needsInstall ? t("settings.cliVersion.missing") : t("account.cliAuthMissing")}
        </div>
        <div className="settings-row__desc">
          {needsInstall ? t("settings.cliPathDesc") : t("account.loginHelpBody")}
        </div>
      </div>
      <div className="settings-row__actions">
        {needsInstall ? (
          <button
            type="button"
            className="btn btn--solid btn--sm"
            disabled={installing}
            onClick={() => void install()}
          >
            {installing ? t("setup.installing") : t("setup.install")}
          </button>
        ) : null}
        {needsAuth ? (
          <>
            <button
              type="button"
              className="btn btn--solid btn--sm"
              disabled={accountBusy || installing || needsInstall}
              onClick={onAccountLoginOauth}
            >
              {accountBusy ? t("account.loginBusy") : t("account.loginOauth")}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={accountBusy || installing || needsInstall}
              onClick={onAccountLoginDevice}
            >
              {t("account.loginDevice")}
            </button>
          </>
        ) : null}
      </div>
      {installing && progress?.message ? (
        <div className="settings-row__hint" role="status">
          {progress.message}
          {typeof progress.percent === "number" ? ` · ${Math.round(progress.percent)}%` : ""}
        </div>
      ) : null}
      {error ? <div className="settings-row__hint settings-row__hint--warn">{error}</div> : null}
      {loginHint ? <div className="settings-row__hint settings-row__hint--warn">{loginHint}</div> : null}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { CliInstallProgress, CliProbeInfo } from "@/lib/api";
import * as api from "@/lib/api";
import type { SettingsViewModel } from "@/components/settings/types";
type Props = {
  allowUnverifiedCliInstall?: boolean;
  onCliInfoRefresh?: (cli: CliProbeInfo) => void;
  showSettingsToast?: SettingsViewModel["showSettingsToast"];
  t: SettingsViewModel["t"];
};

/** One-click reinstall shown in Runtime → CLI only when the binary is missing. */
export function CliRepairPanel({
  allowUnverifiedCliInstall,
  onCliInfoRefresh,
  showSettingsToast,
  t,
}: Props) {
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<CliInstallProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refreshCli = useCallback(
    async (path?: string | null) => {
      try {
        const next = await api.probeCli(path || undefined);
        if (alive.current) onCliInfoRefresh?.(next);
        return next;
      } catch {
        return null;
      }
    },
    [onCliInfoRefresh],
  );

  // Live install progress from Host (same channel as SetupWizard).
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
      const next = await refreshCli(result.path);
      if (!next?.found) {
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
      if (alive.current) setInstalling(false);
    }
  }, [allowUnverifiedCliInstall, installing, refreshCli, showSettingsToast, t]);

  return (
    <div
      className="settings-row settings-row--stack settings-row--compact"
      data-testid="settings-cli-repair"
    >
      <div className="settings-row__text">
        <div className="settings-row__label">{t("settings.cliVersion.missing")}</div>
        <div className="settings-row__desc">{t("settings.cliUpdateNeedCli")}</div>
      </div>
      <div className="settings-row__actions">
        <button
          type="button"
          className="btn btn--solid btn--sm"
          disabled={installing}
          onClick={() => void install()}
        >
          {installing ? t("setup.installing") : t("setup.install")}
        </button>
      </div>
      {installing && progress?.message ? (
        <div className="settings-row__hint" role="status">
          {progress.message}
          {typeof progress.percent === "number"
            ? ` · ${Math.round(progress.percent)}%`
            : ""}
        </div>
      ) : null}
      {error ? (
        <div className="settings-row__hint settings-row__hint--warn">{error}</div>
      ) : null}
    </div>
  );
}

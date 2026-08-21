/**
 * Single-source auto-update state machine.
 *
 * - Signed release binaries (plugin enabled): Tauri check → download → confirm →
 *   install → relaunch. About “Check for updates” stops at `ready`.
 * - Local / unsigned / plugin off: GitHub Releases via `app_check_update` → open page.
 *
 * P0: `prepare_for_app_update` runs only AFTER successful `install()`, so a failed
 * install never kills agents / voice / IM / mirror.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import { isDesktopHost, type AppUpdateCheck } from "@/lib/api";
import {
  planUserCheckUpdate,
  shouldInstallWhenReady,
} from "@/lib/appUpdateHonesty";
import { DEVELOPER_MODE_CHANGE_EVENT } from "@/lib/developerModePref";
import {
  UPDATE_SIM_CHANGE_EVENT,
  UPDATE_SIM_VERSION,
  clearUpdateSimIfDeveloperModeOff,
  installDeveloperModeSimCleanup,
  installUpdateSimConsoleApi,
  readUpdateSimMode,
  sleepMs,
} from "@/lib/updateSim";

export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "up-to-date"; version?: string }
  | { state: "available"; version: string }
  | { state: "downloading"; version: string }
  | { state: "installing"; version: string }
  | { state: "ready"; version: string }
  /** Install staged; process is about to relaunch (or sim page reload). */
  | { state: "restarting"; version: string }
  | { state: "error"; message: string }
  | {
      state: "manual-required";
      version: string;
      /** GitHub release page (or html_url from app_check_update). */
      releaseUrl: string;
      /** Best-effort platform installer asset URL. */
      downloadUrl?: string | null;
      assetNames?: string[];
    };

const BACKGROUND_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const BACKGROUND_BLOCKED_STATES = new Set<UpdateStatus["state"]>([
  "checking",
  "available",
  "downloading",
  "installing",
  "ready",
  "restarting",
  "manual-required",
]);

/** Override via VITE_GROK_RELEASES_URL when the repo path differs. */
const GITHUB_RELEASES_URL =
  (import.meta.env.VITE_GROK_RELEASES_URL as string | undefined) ||
  "https://github.com/RongleCat/grok-app/releases/latest";

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Last-resort string match only — prefer `is_updater_plugin_enabled` first. */
function isUpdaterUnavailable(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("plugin updater not found") ||
    m.includes("not initialized") ||
    m.includes("command updater") ||
    m.includes("not allowed") ||
    m.includes('command "check" not found') ||
    m.includes("plugin not found")
  );
}

function canRunBackgroundCheck(status: UpdateStatus): boolean {
  return !BACKGROUND_BLOCKED_STATES.has(status.state);
}

function initialUpdateStatus(): UpdateStatus {
  return { state: "idle" };
}

async function isAutoUpdateSupported(): Promise<boolean> {
  if (!isDesktopHost()) return false;
  try {
    return await invoke<boolean>("is_auto_update_supported");
  } catch {
    return false;
  }
}

async function isUpdaterPluginEnabled(): Promise<boolean> {
  if (!isDesktopHost()) return false;
  try {
    return await invoke<boolean>("is_updater_plugin_enabled");
  } catch {
    return false;
  }
}

/** Tear down ACP / mirror / voice / IM — only after successful install. */
async function prepareForAppUpdate(): Promise<void> {
  if (!isDesktopHost()) return;
  await invoke("prepare_for_app_update");
}

async function githubCheckUpdate(): Promise<AppUpdateCheck> {
  return invoke<AppUpdateCheck>("app_check_update");
}

export type UpdaterChannelInfo = {
  /**
   * Host channel honesty:
   * - `silent` — signed release plugin + platform supports in-app install
   * - `github_manual` — unsigned / local / plugin off
   * - `unsupported` — plugin on but package type cannot auto-update (e.g. Linux non-AppImage)
   * - `unknown` — not yet probed
   */
  channel: "silent" | "github_manual" | "unsupported" | "unknown";
  pluginEnabled: boolean;
  platformSupported: boolean;
  endpoint: string;
};

export type ApplyUpdateResult =
  | { kind: "manual"; releaseUrl: string; downloadUrl?: string | null }
  | { kind: "busy" }
  | { kind: "installing" }
  | { kind: "pending" }
  | { kind: "checking" }
  | { kind: "noop" };

export function useUpdater() {
  const [status, setStatusState] = useState<UpdateStatus>(initialUpdateStatus);
  const [channelInfo, setChannelInfo] = useState<UpdaterChannelInfo>({
    channel: "unknown",
    pluginEnabled: false,
    platformSupported: false,
    endpoint: "",
  });
  const statusRef = useRef<UpdateStatus>(initialUpdateStatus());
  const updateRef = useRef<Update | null>(null);
  const checkInFlightRef = useRef(false);
  const downloadInFlightRef = useRef(false);
  const installInFlightRef = useRef(false);
  const manualResultRequestedRef = useRef(false);
  /**
   * When true, finish download → install → relaunch (confirmed sidebar apply).
   * About “Check for updates” and background discovery only stage to `ready`.
   */
  const installWhenReadyRef = useRef(false);
  /** Bumped on unmount so in-flight async work never setState on a dead tree. */
  const generationRef = useRef(0);
  const aliveRef = useRef(true);

  const setStatus = useCallback((nextStatus: UpdateStatus) => {
    if (!aliveRef.current) return;
    statusRef.current = nextStatus;
    setStatusState(nextStatus);
  }, []);

  /** Always close the previous Update handle (no in-flight short-circuit). */
  const closeUpdate = useCallback(async () => {
    const current = updateRef.current;
    if (!current) return;
    updateRef.current = null;
    try {
      await current.close();
    } catch {
      // ignore — handle may already be closed after failed download/install
    }
  }, []);

  /** Replace updateRef, closing any previous handle first. */
  const adoptUpdate = useCallback(async (next: Update | null) => {
    const prev = updateRef.current;
    updateRef.current = next;
    if (prev && prev !== next) {
      try {
        await prev.close();
      } catch {
        // ignore
      }
    }
  }, []);

  const performInstall = useCallback(
    async (version: string) => {
      if (installInFlightRef.current) {
        return;
      }

      // Sim silent path: full chain install → restarting → page reload
      // (stand-in for process relaunch). Developer mode + sim prefs persist.
      if (readUpdateSimMode() === "silent") {
        installInFlightRef.current = true;
        installWhenReadyRef.current = false;
        try {
          setStatus({ state: "installing", version });
          await sleepMs(900);
          if (!aliveRef.current) return;
          setStatus({ state: "restarting", version });
          await sleepMs(700);
          if (!aliveRef.current) return;
          console.info(
            `[grok] Update sim: install complete for ${version} — reloading to simulate relaunch`,
          );
          // Full-flow completion: same as product relaunch from the UI's POV.
          window.location.reload();
        } catch (err) {
          if (!aliveRef.current) return;
          setStatus({ state: "error", message: toErrorMessage(err) });
          installInFlightRef.current = false;
        }
        // Leave installInFlight true across reload; page tear-down clears it.
        return;
      }

      const update = updateRef.current;
      if (!update) {
        setStatus({
          state: "error",
          message: "Update is not ready to install yet",
        });
        return;
      }

      installInFlightRef.current = true;
      installWhenReadyRef.current = false;
      try {
        setStatus({ state: "installing", version });
        // P0: stage the update first. Only tear down children after install succeeds
        // so a failed install leaves agents / IM / mirror intact.
        await update.install();
        try {
          await prepareForAppUpdate();
        } catch (prepErr) {
          // Install already staged — still relaunch so the new binary can start.
          console.warn(
            "prepare_for_app_update failed; continuing relaunch",
            prepErr,
          );
        }
        updateRef.current = null;
        if (!aliveRef.current) return;
        setStatus({ state: "restarting", version });
        await relaunch();
      } catch (err) {
        if (!aliveRef.current) return;
        setStatus({ state: "error", message: toErrorMessage(err) });
      } finally {
        installInFlightRef.current = false;
      }
    },
    [setStatus],
  );

  const downloadUpdate = useCallback(
    async (version: string) => {
      if (downloadInFlightRef.current) {
        return;
      }

      // DEV sim silent path — no Tauri Update handle.
      if (readUpdateSimMode() === "silent") {
        downloadInFlightRef.current = true;
        try {
          setStatus({ state: "downloading", version });
          await sleepMs(1200);
          if (!aliveRef.current) return;
          setStatus({ state: "ready", version });
          if (installWhenReadyRef.current) {
            await performInstall(version);
          }
        } finally {
          downloadInFlightRef.current = false;
        }
        return;
      }

      downloadInFlightRef.current = true;
      try {
        const update = updateRef.current;
        if (!update) {
          return;
        }

        setStatus({ state: "downloading", version });
        await update.download();
        if (!aliveRef.current) return;
        setStatus({ state: "ready", version });
        // Confirmed apply only — About check / background stay at `ready`.
        if (installWhenReadyRef.current) {
          await performInstall(version);
        }
      } catch (err) {
        if (!aliveRef.current) return;
        installWhenReadyRef.current = false;
        setStatus({ state: "error", message: toErrorMessage(err) });
      } finally {
        downloadInFlightRef.current = false;
      }
    },
    [performInstall, setStatus],
  );

  const installAndRelaunch = useCallback(async () => {
    // Only install when download has finished (status ready).
    const current = statusRef.current;
    if (current.state !== "ready") {
      setStatus({
        state: "error",
        message: "Update is not ready to install yet",
      });
      return;
    }
    await performInstall(current.version);
  }, [performInstall, setStatus]);

  const applyGithubResult = useCallback(
    (r: AppUpdateCheck) => {
      if (!r.updateAvailable) {
        installWhenReadyRef.current = false;
        setStatus({
          state: "up-to-date",
          version: r.currentVersion,
        });
        return;
      }
      // Manual / GitHub path cannot silent-install.
      installWhenReadyRef.current = false;
      setStatus({
        state: "manual-required",
        version: r.latestVersion,
        releaseUrl: r.htmlUrl || GITHUB_RELEASES_URL,
        downloadUrl: r.downloadUrl,
        assetNames: r.assetNames,
      });
    },
    [setStatus],
  );

  const runGithubFallback = useCallback(
    async ({ background }: { background: boolean }) => {
      const shouldShow = !background || manualResultRequestedRef.current;
      try {
        const r = await githubCheckUpdate();
        if (!aliveRef.current) return;
        if (shouldShow || r.updateAvailable) {
          applyGithubResult(r);
        }
      } catch (err) {
        if (!aliveRef.current) return;
        if (shouldShow) {
          installWhenReadyRef.current = false;
          setStatus({ state: "error", message: toErrorMessage(err) });
        }
      }
    },
    [applyGithubResult, setStatus],
  );

  const runUpdateCheck = useCallback(
    async ({ background }: { background: boolean }) => {
      const simMode = readUpdateSimMode();

      // DEV simulation: skip host/plugin I/O entirely.
      if (simMode !== "off") {
        if (checkInFlightRef.current) {
          if (!background) {
            manualResultRequestedRef.current = true;
            setStatus({ state: "checking" });
          }
          return;
        }
        if (downloadInFlightRef.current || installInFlightRef.current) {
          return;
        }
        if (background && !canRunBackgroundCheck(statusRef.current)) {
          return;
        }

        checkInFlightRef.current = true;
        try {
          if (!background) {
            setStatus({ state: "checking" });
          }
          await sleepMs(background ? 350 : 500);
          if (!aliveRef.current) return;

          if (simMode === "manual") {
            installWhenReadyRef.current = false;
            setStatus({
              state: "manual-required",
              version: UPDATE_SIM_VERSION,
              releaseUrl: GITHUB_RELEASES_URL,
              downloadUrl: GITHUB_RELEASES_URL,
              assetNames: ["GrokApp-sim.dmg", "GrokApp-sim.exe"],
            });
            return;
          }

          // silent
          setStatus({ state: "available", version: UPDATE_SIM_VERSION });
          void downloadUpdate(UPDATE_SIM_VERSION);
        } finally {
          checkInFlightRef.current = false;
        }
        return;
      }

      if (!isDesktopHost()) {
        if (!background) {
          setStatus({
            state: "error",
            message: "Updates are only available in the desktop app",
          });
        }
        return;
      }

      if (checkInFlightRef.current) {
        if (!background) {
          manualResultRequestedRef.current = true;
          setStatus({ state: "checking" });
        }
        return;
      }

      if (downloadInFlightRef.current || installInFlightRef.current) {
        return;
      }

      if (background && !canRunBackgroundCheck(statusRef.current)) {
        return;
      }

      checkInFlightRef.current = true;
      manualResultRequestedRef.current = false;
      const gen = generationRef.current;

      try {
        if (!background) {
          setStatus({ state: "checking" });
        }

        const pluginOn = await isUpdaterPluginEnabled();
        if (generationRef.current !== gen || !aliveRef.current) return;

        if (!pluginOn) {
          // Single path: plugin off → GitHub check (no separate Settings branch).
          await runGithubFallback({ background });
          return;
        }

        // Close any previous Update handle before requesting a new one.
        await closeUpdate();
        if (generationRef.current !== gen || !aliveRef.current) return;

        let update: Update | null = null;
        try {
          update = await check({
            headers: { "Cache-Control": "no-cache" },
          });
        } catch (err) {
          const message = toErrorMessage(err);
          if (isUpdaterUnavailable(message)) {
            console.warn(
              `updater unavailable, falling back to GitHub: ${message}`,
            );
            await runGithubFallback({ background });
            return;
          }
          // Plugin on but endpoint/network failed — fall back so one button still works.
          console.warn(
            `updater check failed, falling back to GitHub: ${message}`,
          );
          await runGithubFallback({ background });
          return;
        }

        if (generationRef.current !== gen || !aliveRef.current) {
          if (update) {
            try {
              await update.close();
            } catch {
              /* ignore */
            }
          }
          return;
        }

        const shouldShowQuietResult =
          !background || manualResultRequestedRef.current;

        if (update) {
          const autoUpdateOk = await isAutoUpdateSupported();
          if (generationRef.current !== gen || !aliveRef.current) {
            try {
              await update.close();
            } catch {
              /* ignore */
            }
            return;
          }

          if (autoUpdateOk) {
            await adoptUpdate(update);
            setStatus({ state: "available", version: update.version });
            void downloadUpdate(update.version);
          } else {
            installWhenReadyRef.current = false;
            try {
              await update.close();
            } catch {
              /* ignore */
            }
            await adoptUpdate(null);
            setStatus({
              state: "manual-required",
              version: update.version,
              releaseUrl: GITHUB_RELEASES_URL,
            });
          }
        } else if (shouldShowQuietResult) {
          installWhenReadyRef.current = false;
          setStatus({ state: "up-to-date" });
        }
      } finally {
        if (generationRef.current === gen) {
          manualResultRequestedRef.current = false;
          checkInFlightRef.current = false;
        }
      }
    },
    [adoptUpdate, closeUpdate, downloadUpdate, runGithubFallback, setStatus],
  );

  const checkForUpdate = useCallback(async () => {
    // About “Check for updates”: check / download only. Stop at `ready`.
    // Never arm auto-install — that requires confirmed Install and restart.
    const current = statusRef.current;
    const plan = planUserCheckUpdate(current);
    if (plan.action === "noop") {
      return;
    }
    if (plan.action === "download") {
      if (!downloadInFlightRef.current) {
        void downloadUpdate(plan.version);
      }
      return;
    }
    await runUpdateCheck({ background: false });
  }, [downloadUpdate, runUpdateCheck]);

  const checkForUpdateInBackground = useCallback(async () => {
    await runUpdateCheck({ background: true });
  }, [runUpdateCheck]);

  /**
   * Sidebar / one-shot update affordance (call after in-app confirm).
   * - Signed path: download (if needed) → install → relaunch.
   * - Manual path: return URLs so the UI can open GitHub (no confirm).
   */
  const applyAvailableUpdate = useCallback(async (): Promise<ApplyUpdateResult> => {
    const current = statusRef.current;

    if (current.state === "manual-required") {
      return {
        kind: "manual",
        releaseUrl: current.releaseUrl,
        downloadUrl: current.downloadUrl,
      };
    }

    if (
      current.state === "installing" ||
      current.state === "restarting"
    ) {
      return { kind: "busy" };
    }

    installWhenReadyRef.current = shouldInstallWhenReady("apply");

    if (current.state === "ready") {
      await installAndRelaunch();
      return { kind: "installing" };
    }

    if (current.state === "downloading" || current.state === "available") {
      if (current.state === "available" && !downloadInFlightRef.current) {
        // Real path needs a Tauri Update handle; silent sim does not.
        if (updateRef.current || readUpdateSimMode() === "silent") {
          void downloadUpdate(current.version);
        }
      }
      return { kind: "pending" };
    }

    if (current.state === "checking") {
      return { kind: "checking" };
    }

    // idle / up-to-date / error — full check, then install when ready.
    await runUpdateCheck({ background: false });
    return { kind: "checking" };
  }, [downloadUpdate, installAndRelaunch, runUpdateCheck]);

  const refreshChannelInfo = useCallback(async () => {
    const simMode = readUpdateSimMode();
    if (simMode !== "off") {
      setChannelInfo({
        channel: simMode === "silent" ? "silent" : "github_manual",
        pluginEnabled: simMode === "silent",
        platformSupported: true,
        endpoint: simMode === "silent" ? "sim://local-dev" : "",
      });
      return;
    }
    if (!isDesktopHost()) return;
    try {
      const s = await invoke<{
        platformSupported: boolean;
        pluginEnabled: boolean;
        channel: string;
        endpoint: string;
      }>("updater_status");
      if (!aliveRef.current) return;
      // Prefer host string when known; derive unsupported from flags so a
      // collapsed github_manual never claims silent for non-AppImage Linux.
      let channel: UpdaterChannelInfo["channel"] = "unknown";
      if (s.channel === "silent") {
        channel = "silent";
      } else if (s.channel === "unsupported") {
        channel = "unsupported";
      } else if (s.channel === "github_manual") {
        channel =
          s.pluginEnabled && !s.platformSupported
            ? "unsupported"
            : "github_manual";
      } else if (s.pluginEnabled && !s.platformSupported) {
        channel = "unsupported";
      } else if (!s.pluginEnabled) {
        channel = "github_manual";
      }
      setChannelInfo({
        channel,
        pluginEnabled: !!s.pluginEnabled,
        platformSupported: !!s.platformSupported,
        endpoint: s.endpoint || "",
      });
    } catch {
      /* ignore — About still works via status machine */
    }
  }, []);

  /**
   * Re-seed after Settings developer / sim toggles. Resets blocked states so
   * background discovery is not stuck on a previous sim `ready`.
   */
  const reseedFromPrefs = useCallback(async () => {
    clearUpdateSimIfDeveloperModeOff();
    installUpdateSimConsoleApi();
    installWhenReadyRef.current = false;
    downloadInFlightRef.current = false;
    installInFlightRef.current = false;
    checkInFlightRef.current = false;
    await closeUpdate();
    setStatus({ state: "idle" });
    await refreshChannelInfo();
    await runUpdateCheck({ background: true });
  }, [closeUpdate, refreshChannelInfo, runUpdateCheck, setStatus]);

  useEffect(() => {
    aliveRef.current = true;
    const gen = ++generationRef.current;
    installDeveloperModeSimCleanup();
    installUpdateSimConsoleApi();

    void refreshChannelInfo();

    // Startup + periodic discovery (download only; no silent install).
    void checkForUpdateInBackground();

    const intervalId = window.setInterval(() => {
      if (generationRef.current !== gen) return;
      // While simulating, discovery is driven by sim reseed / click path.
      if (readUpdateSimMode() !== "off") return;
      void checkForUpdateInBackground();
    }, BACKGROUND_UPDATE_CHECK_INTERVAL_MS);

    const onPrefsChange = () => {
      if (generationRef.current !== gen) return;
      void reseedFromPrefs();
    };
    window.addEventListener(UPDATE_SIM_CHANGE_EVENT, onPrefsChange);
    window.addEventListener(DEVELOPER_MODE_CHANGE_EVENT, onPrefsChange);

    return () => {
      aliveRef.current = false;
      generationRef.current += 1;
      window.clearInterval(intervalId);
      window.removeEventListener(UPDATE_SIM_CHANGE_EVENT, onPrefsChange);
      window.removeEventListener(DEVELOPER_MODE_CHANGE_EVENT, onPrefsChange);
      void closeUpdate();
    };
  }, [
    checkForUpdateInBackground,
    closeUpdate,
    refreshChannelInfo,
    reseedFromPrefs,
  ]);

  return {
    status,
    channelInfo,
    checkForUpdate,
    installAndRelaunch,
    applyAvailableUpdate,
    githubReleasesUrl: GITHUB_RELEASES_URL,
  };
}

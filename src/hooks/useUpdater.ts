/**
 * Single-source auto-update state machine.
 *
 * - Signed release binaries (plugin enabled): Tauri check → download → install → relaunch.
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

export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "up-to-date"; version?: string }
  | { state: "available"; version: string }
  | { state: "downloading"; version: string }
  | { state: "installing"; version: string }
  | { state: "ready"; version: string }
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

export function useUpdater() {
  const [status, setStatusState] = useState<UpdateStatus>(initialUpdateStatus);
  const statusRef = useRef<UpdateStatus>(initialUpdateStatus());
  const updateRef = useRef<Update | null>(null);
  const checkInFlightRef = useRef(false);
  const downloadInFlightRef = useRef(false);
  const installInFlightRef = useRef(false);
  const manualResultRequestedRef = useRef(false);
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

  const downloadUpdate = useCallback(
    async (version: string) => {
      if (downloadInFlightRef.current) {
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
      } catch (err) {
        if (!aliveRef.current) return;
        setStatus({ state: "error", message: toErrorMessage(err) });
      } finally {
        downloadInFlightRef.current = false;
      }
    },
    [setStatus],
  );

  const installAndRelaunch = useCallback(async () => {
    if (installInFlightRef.current) {
      return;
    }

    const update = updateRef.current;
    if (!update) {
      return;
    }

    // Only install when download has finished (status ready).
    const current = statusRef.current;
    if (current.state !== "ready") {
      setStatus({
        state: "error",
        message: "Update is not ready to install yet",
      });
      return;
    }
    const version = current.version;

    installInFlightRef.current = true;
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
      await relaunch();
    } catch (err) {
      if (!aliveRef.current) return;
      setStatus({ state: "error", message: toErrorMessage(err) });
    } finally {
      installInFlightRef.current = false;
    }
  }, [setStatus]);

  const applyGithubResult = useCallback(
    (r: AppUpdateCheck) => {
      if (!r.updateAvailable) {
        setStatus({
          state: "up-to-date",
          version: r.currentVersion,
        });
        return;
      }
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
          setStatus({ state: "error", message: toErrorMessage(err) });
        }
      }
    },
    [applyGithubResult, setStatus],
  );

  const runUpdateCheck = useCallback(
    async ({ background }: { background: boolean }) => {
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
    await runUpdateCheck({ background: false });
  }, [runUpdateCheck]);

  const checkForUpdateInBackground = useCallback(async () => {
    await runUpdateCheck({ background: true });
  }, [runUpdateCheck]);

  useEffect(() => {
    aliveRef.current = true;
    const gen = ++generationRef.current;

    void checkForUpdateInBackground();

    const intervalId = window.setInterval(() => {
      if (generationRef.current !== gen) return;
      void checkForUpdateInBackground();
    }, BACKGROUND_UPDATE_CHECK_INTERVAL_MS);

    return () => {
      aliveRef.current = false;
      generationRef.current += 1;
      window.clearInterval(intervalId);
      void closeUpdate();
    };
  }, [checkForUpdateInBackground, closeUpdate]);

  return {
    status,
    checkForUpdate,
    installAndRelaunch,
    githubReleasesUrl: GITHUB_RELEASES_URL,
  };
}

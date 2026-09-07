/**
 * First-run gate: loading → setup wizard → ready.
 *
 * Owns gate phase, CLI seed, boot-detect flags, and the ready-once
 * notification permission. Workbench list/model hydration stays on the host.
 */
import { useCallback, useEffect, useState } from "react";
import { isMirrorClient } from "@/lib/api";
import { ensureNotifyPermission } from "@/lib/desktopNotify";
import type { SetupCliInfo } from "@/components/SetupWizard";

export type AppGatePhase = "loading" | "setup" | "ready";

export type SetupFlags = {
  cli: boolean;
  auth: boolean;
  project: boolean;
};

function initialGate(): AppGatePhase {
  if (typeof window === "undefined") return "loading";
  if (isMirrorClient()) return "ready";
  // Vite HMR / host heartbeats used to remount this splash forever in `tauri dev`.
  if (import.meta.env.DEV) return "ready";
  return "loading";
}

export function useSetupBootGate() {
  const [appGate, setAppGate] = useState<AppGatePhase>(initialGate);
  const [bootDetectTimedOut, setBootDetectTimedOut] = useState(false);
  const [bootDetectSlow, setBootDetectSlow] = useState(false);
  const [bootRetryNonce, setBootRetryNonce] = useState(0);
  const [setupCliSeed, setSetupCliSeed] = useState<SetupCliInfo | null>(null);
  const [setup, setSetup] = useState<SetupFlags>({
    cli: false,
    auth: false,
    project: false,
  });

  useEffect(() => {
    if (appGate !== "ready") return;
    void ensureNotifyPermission();
  }, [appGate]);

  const retryBootDetect = useCallback(() => {
    setBootDetectTimedOut(false);
    setBootDetectSlow(false);
    setBootRetryNonce((n) => n + 1);
  }, []);

  const skipToSetup = useCallback(() => {
    setBootDetectTimedOut(false);
    setAppGate("setup");
  }, []);

  return {
    appGate,
    setAppGate,
    bootDetectTimedOut,
    setBootDetectTimedOut,
    bootDetectSlow,
    setBootDetectSlow,
    bootRetryNonce,
    setupCliSeed,
    setSetupCliSeed,
    setup,
    setSetup,
    retryBootDetect,
    skipToSetup,
  };
}

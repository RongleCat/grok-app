/**
 * Install / poll / teardown Design Mode inside a side-browser Webview.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri, sideBrowserEval } from "@/lib/api";
import {
  buildDesignModeClearScript,
  buildDesignModeInstallScript,
  buildDesignModePollScript,
  buildDesignModeReadScript,
  buildDesignModeTeardownScript,
  nextDesignModeHostOp,
  parseDesignModeInstall,
  parseDesignModePoll,
  parseDesignModeRead,
  shouldApplyDesignModeHostResult,
  type DesignModeSelection,
  type DesignModeShot,
  type DesignModeStatus,
} from "@/lib/browserDesignMode";

export type UseBrowserDesignModeArgs = {
  label: string;
  enabled: boolean;
  active: boolean;
  pageLoading: boolean;
};

export type UseBrowserDesignModeResult = {
  status: DesignModeStatus;
  selection: DesignModeSelection | null;
  shot: DesignModeShot;
  clearSelection: () => void;
};

const POLL_MS = 180;
const FAIL_LIMIT = 4;

const IDLE_SHOT: DesignModeShot = { status: "idle" };

async function evalRaw(label: string, script: string): Promise<string> {
  return sideBrowserEval(label, script);
}

export function useBrowserDesignMode({
  label,
  enabled,
  active,
  pageLoading,
}: UseBrowserDesignModeArgs): UseBrowserDesignModeResult {
  const [status, setStatus] = useState<DesignModeStatus>("off");
  const [selection, setSelection] = useState<DesignModeSelection | null>(null);
  const [shot, setShot] = useState<DesignModeShot>(IDLE_SHOT);
  const [overlayEpoch, setOverlayEpoch] = useState(0);
  const versionRef = useRef(0);
  const failsRef = useRef(0);
  const aliveRef = useRef(true);
  const installedRef = useRef(false);
  const hostGenRef = useRef(0);
  const pageLoadingRef = useRef(pageLoading);
  const selectionRef = useRef<DesignModeSelection | null>(null);
  const shotStatusRef = useRef<DesignModeShot["status"]>("idle");
  pageLoadingRef.current = pageLoading;

  const clearLocal = useCallback(() => {
    versionRef.current = 0;
    selectionRef.current = null;
    shotStatusRef.current = "idle";
    setSelection(null);
    setShot(IDLE_SHOT);
  }, []);

  const clearSelection = useCallback(() => {
    clearLocal();
    if (!isTauri() || !label || pageLoading || !installedRef.current) return;
    void evalRaw(label, buildDesignModeClearScript()).catch(() => {
      /* page may have navigated */
    });
  }, [clearLocal, label, pageLoading]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus("off");
      clearLocal();
    } else if (!isTauri()) {
      setStatus("unavailable");
      return;
    }

    const op = nextDesignModeHostOp({
      enabled,
      pageLoading,
      installed: installedRef.current,
    });
    if (op === "idle") {
      // In-flight install may have been cancelled by a load flicker.
      if (enabled && installedRef.current && !pageLoading) {
        setStatus((s) => (s === "installing" ? "ready" : s));
      }
      return;
    }
    if (!isTauri() || !label) return;

    if (op === "teardown") {
      installedRef.current = false;
      hostGenRef.current += 1;
      void evalRaw(label, buildDesignModeTeardownScript()).catch(() => {
        /* page may have navigated */
      });
      return;
    }

    let cancelled = false;
    const gen = ++hostGenRef.current;
    installedRef.current = true;
    setStatus("installing");
    void (async () => {
      try {
        const raw = await evalRaw(label, buildDesignModeInstallScript());
        if (
          !shouldApplyDesignModeHostResult({
            alive: aliveRef.current,
            cancelled,
            pageLoading: pageLoadingRef.current,
            generation: gen,
            currentGeneration: hostGenRef.current,
          })
        ) {
          return;
        }
        const installed = parseDesignModeInstall(raw);
        if (!installed.ok) {
          installedRef.current = false;
          setStatus("unavailable");
          return;
        }
        failsRef.current = 0;
        setStatus("ready");
      } catch {
        if (
          !shouldApplyDesignModeHostResult({
            alive: aliveRef.current,
            cancelled,
            pageLoading: pageLoadingRef.current,
            generation: gen,
            currentGeneration: hostGenRef.current,
          })
        ) {
          return;
        }
        installedRef.current = false;
        setStatus("unavailable");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clearLocal, enabled, label, overlayEpoch, pageLoading]);

  useEffect(() => {
    return () => {
      if (!isTauri() || !label || !installedRef.current) return;
      installedRef.current = false;
      hostGenRef.current += 1;
      void evalRaw(label, buildDesignModeTeardownScript()).catch(() => {
        /* ignore */
      });
    };
  }, [label]);

  useEffect(() => {
    if (
      !enabled ||
      !active ||
      status !== "ready" ||
      pageLoading ||
      !isTauri()
    ) {
      return;
    }
    let timer = 0;
    let inflight = false;
    let cancelled = false;
    const gen = hostGenRef.current;

    const live = () =>
      shouldApplyDesignModeHostResult({
        alive: aliveRef.current,
        cancelled,
        pageLoading: pageLoadingRef.current,
        generation: gen,
        currentGeneration: hostGenRef.current,
      });

    const tick = async () => {
      if (inflight || !live()) return;
      inflight = true;
      try {
        const raw = await evalRaw(label, buildDesignModePollScript());
        if (!live()) return;
        const poll = parseDesignModePoll(raw);
        if (!poll || !poll.ok) {
          if (poll?.reason === "missing") {
            installedRef.current = false;
            clearLocal();
            setOverlayEpoch((n) => n + 1);
            return;
          }
          failsRef.current += 1;
          if (failsRef.current >= FAIL_LIMIT) {
            setStatus("unavailable");
          }
          return;
        }
        failsRef.current = 0;
        if (!poll.enabled) {
          setStatus("unavailable");
          return;
        }
        if (!poll.hasSelection) {
          if (versionRef.current !== 0 || selectionRef.current) {
            versionRef.current = poll.version;
            selectionRef.current = null;
            shotStatusRef.current = "idle";
            setSelection(null);
            setShot(IDLE_SHOT);
          }
          return;
        }
        const versionChanged = poll.version !== versionRef.current;
        const shotPending =
          poll.shotStatus === "pending" ||
          (poll.shotStatus === "ok" && shotStatusRef.current !== "ok") ||
          (poll.shotStatus === "error" && shotStatusRef.current === "pending");
        if (!versionChanged && !shotPending) return;
        const readRaw = await evalRaw(label, buildDesignModeReadScript());
        if (!live()) return;
        const read = parseDesignModeRead(readRaw);
        if (!read?.ok) return;
        versionRef.current = poll.version;
        selectionRef.current = read.selected;
        shotStatusRef.current = read.shot.status;
        setSelection(read.selected);
        setShot(read.shot);
      } catch {
        if (!live()) return;
        failsRef.current += 1;
        if (failsRef.current >= FAIL_LIMIT) setStatus("unavailable");
      } finally {
        inflight = false;
      }
    };

    timer = window.setInterval(() => {
      void tick();
    }, POLL_MS);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active, clearLocal, enabled, label, pageLoading, status]);

  return { status, selection, shot, clearSelection };
}

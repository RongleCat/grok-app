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
  parseDesignModeInstall,
  parseDesignModePoll,
  parseDesignModeRead,
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
  const versionRef = useRef(0);
  const failsRef = useRef(0);
  const aliveRef = useRef(true);
  const selectionRef = useRef<DesignModeSelection | null>(null);
  const shotStatusRef = useRef<DesignModeShot["status"]>("idle");

  const clearLocal = useCallback(() => {
    versionRef.current = 0;
    selectionRef.current = null;
    shotStatusRef.current = "idle";
    setSelection(null);
    setShot(IDLE_SHOT);
  }, []);

  const clearSelection = useCallback(() => {
    clearLocal();
    if (!isTauri() || !label) return;
    void evalRaw(label, buildDesignModeClearScript()).catch(() => {
      /* page may have navigated */
    });
  }, [clearLocal, label]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Install when enabled and the document is ready; tear down on disable.
  useEffect(() => {
    if (!enabled) {
      setStatus("off");
      clearLocal();
      if (isTauri() && label) {
        void evalRaw(label, buildDesignModeTeardownScript()).catch(() => {
          /* ignore */
        });
      }
      return;
    }
    if (!isTauri()) {
      setStatus("unavailable");
      return;
    }
    if (pageLoading) {
      setStatus("installing");
      clearLocal();
      return;
    }

    let cancelled = false;
    setStatus("installing");
    void (async () => {
      try {
        const raw = await evalRaw(label, buildDesignModeInstallScript());
        if (cancelled || !aliveRef.current) return;
        const installed = parseDesignModeInstall(raw);
        if (!installed.ok) {
          setStatus("unavailable");
          return;
        }
        failsRef.current = 0;
        setStatus("ready");
      } catch {
        if (cancelled || !aliveRef.current) return;
        setStatus("unavailable");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clearLocal, enabled, label, pageLoading]);

  // Unmount: always try to remove the overlay.
  useEffect(() => {
    return () => {
      if (!isTauri() || !label) return;
      void evalRaw(label, buildDesignModeTeardownScript()).catch(() => {
        /* ignore */
      });
    };
  }, [label]);

  // Poll while the tab is active and the overlay is live.
  useEffect(() => {
    if (!enabled || !active || status !== "ready" || !isTauri()) return;
    let timer = 0;
    let inflight = false;

    const tick = async () => {
      if (inflight) return;
      inflight = true;
      try {
        const raw = await evalRaw(label, buildDesignModePollScript());
        if (!aliveRef.current) return;
        const poll = parseDesignModePoll(raw);
        if (!poll || !poll.ok) {
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
        if (!aliveRef.current) return;
        const read = parseDesignModeRead(readRaw);
        if (!read?.ok) return;
        versionRef.current = poll.version;
        selectionRef.current = read.selected;
        shotStatusRef.current = read.shot.status;
        setSelection(read.selected);
        setShot(read.shot);
      } catch {
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
      window.clearInterval(timer);
    };
  }, [active, enabled, label, status]);

  return { status, selection, shot, clearSelection };
}

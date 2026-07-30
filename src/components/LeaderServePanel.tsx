/**
 * Settings → Runtime → Connection: Agent leader / serve status + start/stop.
 */

import { useCallback, useEffect, useState } from "react";
import type { MessageKey, Vars } from "@/i18n";
import * as api from "@/lib/api";
import type { LeaderStatus } from "@/lib/api";

function formatAge(
  secs: number | null | undefined,
  t: (k: MessageKey, vars?: Vars) => string,
): string {
  if (secs == null || !Number.isFinite(secs)) return t("settings.leader.ageUnknown");
  if (secs < 60) return t("settings.leader.ageSeconds", { n: Math.max(0, Math.floor(secs)) });
  if (secs < 3600) {
    return t("settings.leader.ageMinutes", { n: Math.floor(secs / 60) });
  }
  if (secs < 86400) {
    return t("settings.leader.ageHours", { n: Math.floor(secs / 3600) });
  }
  return t("settings.leader.ageDays", { n: Math.floor(secs / 86400) });
}

export function LeaderServePanel({
  t,
  onOpenUseLeader,
}: {
  t: (k: MessageKey, vars?: Vars) => string;
  /** Deep-link to General → Agent → useLeader toggle. */
  onOpenUseLeader?: () => void;
}) {
  const [status, setStatus] = useState<LeaderStatus | null>(null);
  const [busy, setBusy] = useState<"refresh" | "start" | "stop" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setBusy("refresh");
    setError(null);
    try {
      const st = await api.leaderStatus();
      setStatus(st);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      void refresh();
    }, 8000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const onStart = async () => {
    setBusy("start");
    setError(null);
    try {
      const st = await api.leaderStart();
      setStatus(st);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      try {
        setStatus(await api.leaderStatus());
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(null);
    }
  };

  const onStop = async () => {
    setBusy("stop");
    setError(null);
    try {
      const st = await api.leaderStop();
      setStatus(st);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      try {
        setStatus(await api.leaderStatus());
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(null);
    }
  };

  const onCopySocket = async () => {
    const path = status?.socketPath;
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const state = status?.state ?? "stopped";
  const running = state === "running";
  const unsupported = state === "unsupported" || status?.cliSupportsLeader === false;
  const canStart =
    !busy &&
    !running &&
    !unsupported &&
    status?.cliFound !== false &&
    status?.cliSupportsLeader !== false;
  const canStop = !busy && (running || state === "error");

  const stateLabel =
    state === "running"
      ? t("settings.leader.stateRunning")
      : state === "error"
        ? t("settings.leader.stateError")
        : state === "unsupported"
          ? t("settings.leader.stateUnsupported")
          : t("settings.leader.stateStopped");

  const tone =
    state === "running" ? "ok" : state === "error" || state === "unsupported" ? "err" : "muted";

  return (
    <div
      className="settings-card"
      id="settings-anchor-leaderServe"
    >
      <div className="settings-row settings-row--stack">
        <div className="settings-row__text">
          <div className="settings-row__label">{t("settings.leader.title")}</div>
          <div className="settings-row__desc">{t("settings.leader.desc")}</div>
        </div>
        <div className="rim-btn-row" style={{ alignItems: "center", gap: 8 }}>
          <span
            className={
              "account-badge" +
              (tone === "ok"
                ? " account-badge--ok"
                : tone === "err"
                  ? " account-badge--warn"
                  : " account-badge--muted")
            }
          >
            {stateLabel}
          </span>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={!!busy}
            onClick={() => void refresh()}
          >
            {t("settings.leader.refresh")}
          </button>
        </div>
      </div>

      {unsupported ? (
        <div className="settings-row settings-row--stack">
          <div className="settings-row__hint is-danger" role="status">
            {status?.message || t("settings.leader.unsupportedBody")}
          </div>
          {onOpenUseLeader ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onOpenUseLeader}
            >
              {t("settings.leader.openUseLeader")}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="settings-row settings-row--stack">
            <div className="settings-row__text">
              <div className="settings-row__label">{t("settings.leader.socket")}</div>
              <div className="settings-row__desc">
                {status?.socketPath || t("settings.leader.socketDefault")}
              </div>
              <div className="settings-row__hint">
                {status?.socketExists
                  ? t("settings.leader.socketExists", {
                      age: formatAge(status.socketAgeSecs, t),
                    })
                  : t("settings.leader.socketMissing")}
                {status?.pid != null ? ` · PID ${status.pid}` : ""}
                {status?.version ? ` · v${status.version}` : ""}
                {status?.classification ? ` · ${status.classification}` : ""}
              </div>
            </div>
            <div className="rim-btn-row">
              <button
                type="button"
                className="btn btn--ghost"
                disabled={!status?.socketPath}
                onClick={() => void onCopySocket()}
              >
                {copied ? t("settings.leader.copied") : t("settings.leader.copySocket")}
              </button>
            </div>
          </div>

          <div className="settings-row settings-row--stack">
            <div className="settings-row__label">{t("settings.leader.actions")}</div>
            <div className="rim-btn-row">
              <button
                type="button"
                className="btn btn--primary"
                disabled={!canStart}
                onClick={() => void onStart()}
              >
                {busy === "start" ? t("settings.leader.starting") : t("settings.leader.start")}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={!canStop}
                onClick={() => void onStop()}
              >
                {busy === "stop" ? t("settings.leader.stopping") : t("settings.leader.stop")}
              </button>
            </div>
            <div className="settings-row__hint">{t("settings.leader.startHint")}</div>
          </div>

          {onOpenUseLeader ? (
            <div className="settings-row">
              <div className="settings-row__text">
                <div className="settings-row__label">{t("settings.useLeader")}</div>
                <div className="settings-row__desc">{t("settings.leader.useLeaderLinkDesc")}</div>
              </div>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={onOpenUseLeader}
              >
                {t("settings.leader.openUseLeader")}
              </button>
            </div>
          ) : null}

          <div className="settings-row settings-row--stack">
            <div className="settings-row__hint">{t("settings.leader.serveHint")}</div>
          </div>
        </>
      )}

      {(error || (status?.message && state === "error")) && (
        <div className="settings-row settings-row--stack">
          <div className="settings-row__hint is-danger" role="alert">
            {error || status?.message}
          </div>
        </div>
      )}
    </div>
  );
}

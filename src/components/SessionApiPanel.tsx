/**
 * Settings → Runtime → Connection: local session list + continue-by-id.
 * Shows listen status and the token-file path — never the token itself.
 */
import { useCallback, useEffect, useState } from "react";
import * as api from "@/lib/api";
import { isDesktopHost } from "@/lib/api";
import type { MessageKey, Vars } from "@/i18n";

type TFn = (key: MessageKey, vars?: Vars) => string;

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function SessionApiPanel({ t }: { t: TFn }) {
  const [status, setStatus] = useState<api.SessionApiStatus | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"token" | "install" | "remove" | "cli" | null>(
    null,
  );

  const refresh = useCallback(() => {
    if (!isDesktopHost()) {
      setStatus(null);
      return;
    }
    void api
      .sessionApiStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    refresh();
    if (!isDesktopHost()) return;
    const id = window.setInterval(refresh, 4000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const run = useCallback(
    async (kind: "token" | "install" | "remove" | "cli", fn: () => Promise<unknown>) => {
      setActionError(null);
      setBusy(kind);
      try {
        const next = await fn();
        if (next && typeof next === "object" && "tokenFile" in (next as object)) {
          setStatus(next as api.SessionApiStatus);
        }
      } catch (e) {
        setActionError(errText(e));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const listening = !!status?.listening;
  const url = status?.url ?? "";
  const tokenFile = status?.tokenFile ?? "";
  const cli = status?.cli;
  const desktop = isDesktopHost();
  const canInstall = desktop && !!cli?.supported && (!cli.installed || !cli.ours || !cli.matchesRunning);
  const canRemove = desktop && !!cli?.installed && !!cli.ours;

  let cliHint = t("settings.sessionApi.cliMissing");
  if (!cli?.supported) {
    cliHint = t("settings.sessionApi.cliUnsupported");
  } else if (cli.installed && cli.ours && !cli.matchesRunning) {
    cliHint = t("settings.sessionApi.cliStale");
  } else if (cli.installed && !cli.ours) {
    cliHint = t("settings.sessionApi.cliForeign", { path: cli.linkPath });
  } else if (cli.installed && cli.matchesRunning) {
    cliHint = t("settings.sessionApi.cliInstalled", { path: cli.linkPath });
  }

  return (
    <div className="settings-card" id="settings-anchor-sessionApi">
      <div className="settings-row settings-row--stack">
        <div className="settings-row__text">
          <div className="settings-row__label">{t("settings.sessionApi.title")}</div>
          <div className="settings-row__desc">{t("settings.sessionApi.desc")}</div>
        </div>
        <div className="settings-row__hint">
          {listening
            ? t("settings.sessionApi.listening")
            : t("settings.sessionApi.offline")}
          {url ? ` · ${url}` : ""}
        </div>
        {tokenFile ? (
          <div className="settings-row__hint">
            {t("settings.sessionApi.tokenFile")}: {tokenFile}
          </div>
        ) : null}
        <div className="settings-row__actions">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={!desktop || busy !== null || !tokenFile}
            onClick={() => void run("token", () => api.sessionApiRevealTokenFile())}
          >
            {t("settings.sessionApi.revealTokenFile")}
          </button>
        </div>
        <div className="settings-row__label" id="settings-anchor-sessionApiCli">
          {t("settings.sessionApi.cliCommand")}
        </div>
        <div className="settings-row__desc">{t("settings.sessionApi.cliCommandDesc")}</div>
        <div className="settings-row__hint">{cliHint}</div>
        {cli?.linkPath ? (
          <div className="settings-row__hint">
            {t("settings.sessionApi.cliLinkPath")}: {cli.linkPath}
          </div>
        ) : null}
        <div className="settings-row__actions">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={!canInstall || busy !== null}
            onClick={() => void run("install", () => api.sessionApiInstallCli())}
          >
            {cli?.installed && cli.ours && !cli.matchesRunning
              ? t("settings.sessionApi.cliUpdate")
              : t("settings.sessionApi.cliInstall")}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={!canRemove || busy !== null}
            onClick={() => void run("remove", () => api.sessionApiRemoveCli())}
          >
            {t("settings.sessionApi.cliRemove")}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={!desktop || busy !== null}
            onClick={() => void run("cli", () => api.sessionApiRevealCliLink())}
          >
            {t("settings.sessionApi.cliReveal")}
          </button>
        </div>
        <div className="settings-row__hint">{t("settings.sessionApi.cliPathHint")}</div>
        {actionError ? (
          <div className="settings-row__hint" role="alert">
            {t("settings.sessionApi.actionFailed")}: {actionError}
          </div>
        ) : null}
        <div className="settings-row__hint">
          {t("settings.sessionApi.cliList")}
        </div>
        <code className="settings-acp-cmd">grok-app --sessions</code>
        <div className="settings-row__hint">
          {t("settings.sessionApi.cliSend")}
        </div>
        <code className="settings-acp-cmd">
          grok-app --session-send &lt;session-id&gt; --prompt &quot;…&quot;
        </code>
        <div className="settings-row__hint">{t("settings.sessionApi.httpHint")}</div>
        <div className="settings-row__hint">{t("settings.sessionApi.busyHint")}</div>
      </div>
    </div>
  );
}

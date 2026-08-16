/**
 * Settings → Runtime → Connection: local session list + continue-by-id.
 * Shows listen status and the token-file path — never the token itself.
 */
import { useCallback, useEffect, useState } from "react";
import * as api from "@/lib/api";
import { isDesktopHost } from "@/lib/api";
import type { MessageKey, Vars } from "@/i18n";

type TFn = (key: MessageKey, vars?: Vars) => string;

export function SessionApiPanel({ t }: { t: TFn }) {
  const [status, setStatus] = useState<api.SessionApiStatus | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);

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

  const onReveal = useCallback(async () => {
    setRevealError(null);
    setRevealing(true);
    try {
      await api.sessionApiRevealTokenFile();
    } catch (e) {
      setRevealError(e instanceof Error ? e.message : String(e));
    } finally {
      setRevealing(false);
    }
  }, []);

  const listening = !!status?.listening;
  const url = status?.url ?? "";
  const tokenFile = status?.tokenFile ?? "";

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
            disabled={!isDesktopHost() || revealing || !tokenFile}
            onClick={() => void onReveal()}
          >
            {t("settings.sessionApi.revealTokenFile")}
          </button>
        </div>
        {revealError ? (
          <div className="settings-row__hint" role="alert">
            {t("settings.sessionApi.revealFailed")}: {revealError}
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

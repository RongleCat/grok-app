/**
 * Settings → Account → Extras.
 * Official-aux MCP inject toggles (custom main route only).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import { createT, type Locale } from "@/i18n";

export interface OfficialAuxPanelProps {
  locale: Locale;
  /** Official OAuth / CLI auth / official API key present. */
  officialAvailable?: boolean;
  /** Soft-respawn after inject prefs change (Host settings_set). */
  onProviderActivated?: () => void;
}

export function OfficialAuxPanel({
  locale,
  officialAvailable = false,
  onProviderActivated,
}: OfficialAuxPanelProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSource, setActiveSource] = useState<"official" | "custom">(
    "official",
  );
  const [hasOfficialKey, setHasOfficialKey] = useState(false);
  const [officialAuxInject, setOfficialAuxInject] = useState(true);
  const [officialAuxWithUserMcp, setOfficialAuxWithUserMcp] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!api.isTauri()) {
        setActiveSource("official");
        setHasOfficialKey(false);
        return;
      }
      const [list, masked, settings] = await Promise.all([
        api.providersList().catch(() => null),
        api.secretsGetMasked().catch(() => null),
        api.settingsGet().catch(() => null),
      ]);
      setActiveSource(list?.activeSource === "custom" ? "custom" : "official");
      setHasOfficialKey(!!masked?.hasOfficialKey);
      if (settings) {
        setOfficialAuxInject(settings.officialAuxInject !== false);
        setOfficialAuxWithUserMcp(!!settings.officialAuxWithUserMcp);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const officialCredsOk = !!(officialAvailable || hasOfficialKey);
  const officialActive = activeSource === "official";
  /** Host only injects on custom main; official subscription uses native tools. */
  const injectAllowed = officialCredsOk && !officialActive;

  const setOfficialAuxInjectPref = async (on: boolean) => {
    if (!api.isTauri() || !injectAllowed) return;
    setBusy(true);
    try {
      const cur = await api.settingsGet();
      await api.settingsSet({ ...cur, officialAuxInject: on });
      setOfficialAuxInject(on);
      onProviderActivated?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const setOfficialAuxWithUserMcpPref = async (on: boolean) => {
    if (!api.isTauri() || !injectAllowed || !officialAuxInject) return;
    setBusy(true);
    try {
      const cur = await api.settingsGet();
      await api.settingsSet({ ...cur, officialAuxWithUserMcp: on });
      setOfficialAuxWithUserMcp(on);
      onProviderActivated?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="prov-panel" data-testid="official-aux-panel">
        <div className="prov-loading">{tr("prov.loading")}</div>
      </div>
    );
  }

  return (
    <div className="prov-panel" data-testid="official-aux-panel">
      {error && (
        <div className="prov-alert" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setError(null)}
          >
            {tr("common.dismiss")}
          </button>
        </div>
      )}

      <div
        className={
          "settings-card prov-official-aux" +
          (!injectAllowed ? " is-disabled" : "")
        }
        id="settings-anchor-official-aux-inject"
      >
        <div className="prov-official-aux__text">
          <div className="prov-official-aux__title">
            {tr("prov.officialAuxInject")}
          </div>
          <p className="prov-official-aux__desc">
            {!officialCredsOk
              ? tr("prov.officialAuxInjectDisabled")
              : officialActive
                ? tr("prov.officialAuxInjectOfficialRoute")
                : tr("prov.officialAuxInjectDesc")}
          </p>
        </div>
        <label className="prov-official-aux__switch">
          <input
            type="checkbox"
            checked={injectAllowed && officialAuxInject}
            disabled={!injectAllowed || busy}
            onChange={(e) => void setOfficialAuxInjectPref(e.target.checked)}
            aria-label={tr("prov.officialAuxInject")}
          />
          <span>
            {injectAllowed && officialAuxInject
              ? tr("prov.officialAuxInjectOn")
              : tr("prov.officialAuxInjectOff")}
          </span>
        </label>
      </div>

      {injectAllowed && officialAuxInject ? (
        <div
          className="settings-card prov-official-aux prov-official-aux--sub"
          id="settings-anchor-official-aux-user-mcp"
        >
          <div className="prov-official-aux__text">
            <div className="prov-official-aux__title">
              {tr("prov.officialAuxWithUserMcp")}
            </div>
            <p className="prov-official-aux__desc">
              {tr("prov.officialAuxWithUserMcpDesc")}
            </p>
          </div>
          <label className="prov-official-aux__switch">
            <input
              type="checkbox"
              checked={officialAuxWithUserMcp}
              disabled={busy}
              onChange={(e) =>
                void setOfficialAuxWithUserMcpPref(e.target.checked)
              }
              aria-label={tr("prov.officialAuxWithUserMcp")}
            />
            <span>
              {officialAuxWithUserMcp
                ? tr("prov.officialAuxInjectOn")
                : tr("prov.officialAuxInjectOff")}
            </span>
          </label>
        </div>
      ) : null}
    </div>
  );
}

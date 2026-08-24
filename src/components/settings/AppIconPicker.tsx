import { useEffect, useState } from "react";
import * as api from "@/lib/api";
import defaultBlack from "@/assets/app-icons/default-black.png";
import defaultWhite from "@/assets/app-icons/default-white.png";
import pixelGlitch from "@/assets/app-icons/pixel-glitch.png";
import minimalLine from "@/assets/app-icons/minimal-line.png";
import terminalCode from "@/assets/app-icons/terminal-code.png";
import whiteHole from "@/assets/app-icons/white-hole.png";
import { SettingsLabelWithTip } from "./shared";

const DEFAULT_APP_ICON = "default-black";

const APP_ICONS = [
  {
    id: DEFAULT_APP_ICON,
    image: defaultBlack,
    labelKey: "settings.appIcon.defaultBlack",
  },
  {
    id: "default-white",
    image: defaultWhite,
    labelKey: "settings.appIcon.defaultWhite",
  },
  {
    id: "pixel-glitch",
    image: pixelGlitch,
    labelKey: "settings.appIcon.pixelGlitch",
  },
  {
    id: "minimal-line",
    image: minimalLine,
    labelKey: "settings.appIcon.minimalLine",
  },
  {
    id: "terminal-code",
    image: terminalCode,
    labelKey: "settings.appIcon.terminalCode",
  },
  {
    id: "white-hole",
    image: whiteHole,
    labelKey: "settings.appIcon.whiteHole",
  },
] as const;

type AppIconId = (typeof APP_ICONS)[number]["id"];

const isAppIconId = (value: unknown): value is AppIconId =>
  APP_ICONS.some((icon) => icon.id === value);

export function AppIconPicker({
  t,
  rowHighlight,
}: {
  t: (key: string) => string;
  rowHighlight: (anchorId: string) => string;
}) {
  const [selected, setSelected] = useState<AppIconId>(DEFAULT_APP_ICON);
  const [draft, setDraft] = useState<AppIconId>(DEFAULT_APP_ICON);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    if (!api.isTauri()) {
      setLoading(false);
      return;
    }
    void api
      .settingsGet()
      .then((settings) => {
        const saved = settings.appIcon;
        if (active && isAppIconId(saved)) {
          setSelected(saved);
          setDraft(saved);
        }
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const confirm = async () => {
    if (!api.isTauri() || loading || busy || draft === selected) return;
    setBusy(true);
    setError(false);
    try {
      const settings = await api.settingsGet();
      await api.settingsSet({ ...settings, appIcon: draft });
      setSelected(draft);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`settings-card${rowHighlight("settings-anchor-app-icon")}`}
      id="settings-anchor-app-icon"
    >
      <div className="settings-row settings-row--stack">
        <div className="settings-row__text">
          <SettingsLabelWithTip
            label={t("settings.appIcon")}
            tip={t("settings.appIconDesc")}
          />
        </div>
        <div
          className="settings-skin-grid settings-app-icon-grid"
          role="listbox"
          aria-label={t("settings.appIcon")}
          aria-busy={loading || busy}
        >
          {APP_ICONS.map((icon) => {
            const isSelected = draft === icon.id;
            return (
              <button
                key={icon.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`settings-app-icon-card${isSelected ? " is-on" : ""}`}
                disabled={loading || busy}
                onClick={() => setDraft(icon.id)}
              >
                <img
                  className="settings-app-icon__preview"
                  src={icon.image}
                  alt=""
                  aria-hidden
                />
                <span className="settings-app-icon-card__name">
                  {t(icon.labelKey)}
                </span>
              </button>
            );
          })}
        </div>
        <div className="settings-row__actions settings-app-icon-actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={loading || busy || draft === DEFAULT_APP_ICON}
            onClick={() => setDraft(DEFAULT_APP_ICON)}
          >
            {t("settings.appIcon.restoreDefault")}
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={loading || busy || draft === selected}
            onClick={() => void confirm()}
          >
            {t("settings.appIcon.confirm")}
          </button>
        </div>
        {error ? (
          <div className="settings-row__hint is-danger" role="alert">
            {t("settings.appIconError")}
          </div>
        ) : null}
      </div>
    </div>
  );
}

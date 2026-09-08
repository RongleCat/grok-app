/**
 * Settings → Appearance → Theme: composer + UI surface opacity sliders.
 * Independent of wallpaper overlay (scrim).
 */
import { IconHelp } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { useThemeShell } from "@/providers/ThemeShellContext";
import { useSettingsModel } from "@/providers/SettingsModelContext";

function OpacitySlider(props: {
  id: string;
  label: string;
  desc: string;
  value: number;
  onChange: (v: number) => void;
  highlight: string;
}) {
  return (
    <div className={"settings-wallpaper__scrim" + props.highlight} id={props.id}>
      <div className="settings-wallpaper__scrim-head">
        <label className="settings-wallpaper__scrim-label" htmlFor={props.id + "-range"}>
          <span>{props.label}</span>
          <Tip
            label={props.desc}
            placement="top"
            className="ui-tip--wrap"
            delayMs={280}
          >
            <button
              type="button"
              className="settings-label-help"
              aria-label={props.desc}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <IconHelp size={14} stroke={1.75} />
            </button>
          </Tip>
        </label>
        <span className="settings-wallpaper__scrim-value" aria-hidden>
          {Math.round(props.value)}%
        </span>
      </div>
      <input
        id={props.id + "-range"}
        type="range"
        className="settings-wallpaper__scrim-range"
        min={0}
        max={100}
        step={1}
        value={props.value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(props.value)}
        aria-label={props.label}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function AppearanceOpacityCard() {
  const theme = useThemeShell();
  const s = useSettingsModel() as {
    t: (k: string, v?: Record<string, string | number>) => string;
    rowHighlight: (id: string) => string;
  };
  const { t, rowHighlight } = s;

  return (
    <div className="settings-card">
      <div className="settings-row settings-row--stack">
        <div className="settings-row__text">
          <div className="settings-row__label">{t("settings.surfaceOpacity")}</div>
          <p className="settings-desc">{t("settings.surfaceOpacityDesc")}</p>
        </div>
        <div className="settings-wallpaper__sliders">
          <OpacitySlider
            id="settings-anchor-composerOpacity"
            label={t("settings.composerOpacity")}
            desc={t("settings.composerOpacityDesc")}
            value={theme.composerOpacity}
            onChange={theme.applyComposerOpacityChoice}
            highlight={rowHighlight("settings-anchor-composerOpacity")}
          />
          <OpacitySlider
            id="settings-anchor-uiOpacity"
            label={t("settings.uiOpacity")}
            desc={t("settings.uiOpacityDesc")}
            value={theme.uiOpacity}
            onChange={theme.applyUiOpacityChoice}
            highlight={rowHighlight("settings-anchor-uiOpacity")}
          />
          <OpacitySlider
            id="settings-anchor-settingsOpacity"
            label={t("settings.settingsOpacity")}
            desc={t("settings.settingsOpacityDesc")}
            value={theme.settingsOpacity}
            onChange={theme.applySettingsOpacityChoice}
            highlight={rowHighlight("settings-anchor-settingsOpacity")}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Settings → Appearance → Theme: custom text color + font shadow.
 */
import { useEffect, useState } from "react";
import { GlassModal } from "@/components/GlassModal";
import { useThemeShell } from "@/providers/ThemeShellContext";
import {
  THEME_DEFAULT_TEXT_COLOR,
  parseTextColor,
} from "@/lib/appearanceChromePref";
import { SettingsLabelWithTip, UiCheck } from "./shared";
import { useSettingsModel } from "@/providers/SettingsModelContext";

export function AppearanceChromeCard() {
  const theme = useThemeShell();
  const s = useSettingsModel() as {
    t: (k: string, v?: Record<string, string | number>) => string;
    rowHighlight: (id: string) => string;
  };
  const { t, rowHighlight } = s;
  const [hexDraft, setHexDraft] = useState(theme.textColor ?? "");
  const [resetOpen, setResetOpen] = useState(false);

  useEffect(() => {
    setHexDraft(theme.textColor ?? "");
  }, [theme.textColor]);

  const pickerValue =
    theme.textColor ?? THEME_DEFAULT_TEXT_COLOR[theme.theme];
  const isCustom = theme.textColor != null;

  const commitHex = (raw: string) => {
    const next = parseTextColor(raw);
    if (!raw.trim()) {
      theme.applyTextColorChoice(null);
      return;
    }
    if (next) theme.applyTextColorChoice(next);
    else setHexDraft(theme.textColor ?? "");
  };

  return (
    <>
      <div
        className={"settings-card" + rowHighlight("settings-anchor-textColor")}
        id="settings-anchor-textColor"
      >
        <div className="settings-row settings-row--stack">
          <div className="settings-row__text">
            <SettingsLabelWithTip
              label={t("settings.textColor")}
              tip={t("settings.textColorDesc")}
            />
          </div>
          <div className="settings-row__controls settings-row__controls--grow settings-appearance-chrome-controls">
            <label className="settings-color-picker">
              <span className="settings-color-picker__swatch">
                <input
                  type="color"
                  value={pickerValue}
                  aria-label={t("settings.textColor")}
                  onChange={(e) => {
                    const next = parseTextColor(e.target.value);
                    if (next) theme.applyTextColorChoice(next);
                  }}
                />
              </span>
              <input
                type="text"
                className="settings-input settings-color-picker__hex"
                value={hexDraft}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                placeholder={
                  isCustom ? "#rrggbb" : t("settings.textColorFollowTheme")
                }
                aria-label={t("settings.textColor")}
                onChange={(e) => setHexDraft(e.target.value)}
                onBlur={() => commitHex(hexDraft)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitHex(hexDraft);
                  }
                }}
              />
            </label>
            <div
              className={
                "settings-appearance-chrome-shadow" +
                rowHighlight("settings-anchor-fontShadow")
              }
              id="settings-anchor-fontShadow"
            >
              <SettingsLabelWithTip
                label={t("settings.fontShadow")}
                tip={t("settings.fontShadowDesc")}
              />
              <UiCheck
                checked={theme.fontShadow}
                onChange={(next) => theme.applyFontShadowChoice(next)}
                ariaLabel={t("settings.fontShadow")}
              />
            </div>
            <button
              type="button"
              className="btn ghost sm"
              id="settings-anchor-appearanceReset"
              onClick={() => setResetOpen(true)}
            >
              {t("settings.appearanceReset")}
            </button>
          </div>
        </div>
      </div>

      <GlassModal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title={t("settings.appearanceResetTitle")}
        size="sm"
        wrapBody
        closeLabel={t("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setResetOpen(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => {
                theme.resetAppearanceChromeChoice();
                setResetOpen(false);
              }}
            >
              {t("settings.appearanceResetConfirm")}
            </button>
          </>
        }
      >
        <p className="settings-desc">{t("settings.appearanceResetBody")}</p>
      </GlassModal>
    </>
  );
}

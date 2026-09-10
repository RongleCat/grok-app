/**
 * Settings → about section (consumes SettingsModel context).
 */
import { useSettingsModel } from "@/providers/SettingsModelContext";

import { IconHelp, IconInfo, IconSparkles } from "@/components/icons";
import { CliUpdateRow } from "@/components/CliUpdateRow";
import { AboutUpdateRow } from "./AboutUpdateRow";
import { DeveloperModeSection } from "./DeveloperModeSection";
import { requestWhatsNewOpen } from "@/lib/whatsNew";

export function AboutSection() {
  const s = useSettingsModel();
  const {
    cliInfo,
    onOpenProductTutorial,
    rowHighlight,
    t,
    versionFooter,
  } = s;

  return (
    <>
      <div
        className={"settings-card" + rowHighlight("settings-anchor-about")}
        id="settings-anchor-about"
      >
        <div className="settings-row settings-row--stack">
          <div className="settings-row__text">
            <div className="settings-row__label">
              <IconInfo size={16} />
              {t("settings.aboutApp")}
            </div>
            <div className="settings-row__desc">{versionFooter}</div>
          </div>
        </div>
        <AboutUpdateRow t={t} />
        <div
          className={
            "settings-row settings-row--stack" +
            rowHighlight("settings-anchor-aboutCli")
          }
          id="settings-anchor-aboutCli"
        >
          <CliUpdateRow t={t} cliFound={cliInfo.found} autoCheck />
        </div>
      </div>
      <DeveloperModeSection t={t} rowHighlight={rowHighlight} />
      <div
        className={"settings-card" + rowHighlight("settings-anchor-whatsNew")}
        id="settings-anchor-whatsNew"
      >
        <div className="settings-row">
          <div className="settings-row__text">
            <div className="settings-row__label">
              <IconSparkles size={16} />
              {t("whatsNew.replay")}
            </div>
            <div className="settings-row__desc">
              {t("whatsNew.replayDesc")}
            </div>
          </div>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => requestWhatsNewOpen()}
          >
            {t("whatsNew.menu")}
          </button>
        </div>
      </div>
      {onOpenProductTutorial ? (
        <div
          className={
            "settings-card" + rowHighlight("settings-anchor-tutorial")
          }
          id="settings-anchor-tutorial"
        >
          <div className="settings-row">
            <div className="settings-row__text">
              <div className="settings-row__label">
                <IconHelp size={16} />
                {t("tutorial.replay")}
              </div>
              <div className="settings-row__desc">
                {t("tutorial.replayDesc")}
              </div>
            </div>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => onOpenProductTutorial()}
            >
              {t("tutorial.menu")}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

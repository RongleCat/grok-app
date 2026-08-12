/**
 * App auto-update row for Settings → About.
 *
 * Channel + status copy via appUpdateHonesty — never invent versions or claim
 * silent install on unsigned / unsupported / host-only paths.
 */
import { useState } from "react";
import { useUpdaterContext } from "@/hooks/UpdaterProvider";
import * as api from "@/lib/api";
import {
  channelExtraBodyKey,
  classifyUpdateError,
  isAutoUpdatePath,
  isUpdateActionBusy,
  mapUpdateStatusCopy,
  resolveManualUpdateUrls,
  resolveUpdateChannelHonestyPreferHost,
  shouldShowInstallButton,
  shouldShowInstallProgress,
  shouldShowManualDownloadCtas,
  updateChannelLabelKey,
  updateErrorBodyKey,
  updateStatusToneClass,
  type AppUpdateStatusLike,
} from "@/lib/appUpdateHonesty";
import type { MessageKey } from "@/i18n";

export function AboutUpdateRow({
  t,
}: {
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}) {
  // Single authority: useUpdater (plugin path or GitHub fallback).
  const {
    status,
    channelInfo,
    checkForUpdate,
    installAndRelaunch,
    githubReleasesUrl,
  } = useUpdaterContext();
  const [openError, setOpenError] = useState<string | null>(null);

  const openRelease = async (url: string) => {
    try {
      setOpenError(null);
      await api.openExternalUrl(url);
    } catch (e) {
      setOpenError(String(e));
    }
  };

  const statusLike = status as AppUpdateStatusLike;
  const copy = mapUpdateStatusCopy(statusLike);
  const channel = resolveUpdateChannelHonestyPreferHost({
    hostChannel: channelInfo.channel,
    pluginEnabled: channelInfo.pluginEnabled,
    autoUpdateSupported: channelInfo.platformSupported,
    isDesktopHost: api.isDesktopHost(),
    status: statusLike,
  });
  const channelLabelKey = updateChannelLabelKey(channel);
  const channelExtraKey = channelExtraBodyKey(channel);

  const statusText = (() => {
    if (!copy.titleKey || status.state === "error") return null;
    // Idle: honest empty line (no invented "up to date").
    if (status.state === "idle") {
      return t(copy.titleKey);
    }
    if (copy.version) {
      return t(copy.titleKey, { version: copy.version });
    }
    return t(copy.titleKey);
  })();

  const bodyText = (() => {
    if (!copy.bodyKey) return null;
    // Error body is shown under the alert line separately.
    if (status.state === "error") return null;
    // Agents note only on auto path; manual path uses manual body.
    if (
      copy.bodyKey === "settings.autoUpdateBody.agentsNote" &&
      !isAutoUpdatePath(channel)
    ) {
      return null;
    }
    return t(copy.bodyKey);
  })();

  const busy = isUpdateActionBusy(statusLike);
  const showInstallProgress = shouldShowInstallProgress(statusLike);
  // Only show install when download finished (ready), never on available.
  // After install, restart runs automatically (no second click).
  const showInstall = shouldShowInstallButton(statusLike);
  const showOpenRelease = shouldShowManualDownloadCtas(statusLike);
  const manualUrls = showOpenRelease
    ? resolveManualUpdateUrls(statusLike, githubReleasesUrl)
    : null;
  const releaseUrl = manualUrls?.releaseUrl ?? githubReleasesUrl;
  const downloadUrl = manualUrls?.downloadUrl ?? null;
  const assetNames = manualUrls?.assetNames;
  const toneClass = updateStatusToneClass(copy.severity);

  const openErrorKind = openError ? classifyUpdateError(openError) : null;
  const openErrorHintKey =
    openErrorKind && openErrorKind !== "other"
      ? updateErrorBodyKey(openErrorKind)
      : null;

  return (
    <div className="settings-row settings-row--stack">
      <div className="settings-row__text">
        <div className="settings-row__label">{t("settings.checkUpdate")}</div>
        <div className="settings-row__desc">{t("settings.checkUpdateDesc")}</div>
        <div
          className="settings-row__hint"
          data-updater-channel={channel}
          data-updater-host-channel={channelInfo.channel}
        >
          {t(channelLabelKey)}
          {channelInfo.endpoint && isAutoUpdatePath(channel)
            ? ` · ${channelInfo.endpoint.replace(/^https:\/\//, "")}`
            : ""}
        </div>
        {channelExtraKey ? (
          <div
            className="settings-row__hint settings-about-update__channel-note"
            data-update-channel-note={channelExtraKey}
          >
            {t(channelExtraKey)}
          </div>
        ) : null}
      </div>
      <div className="settings-about-update">
        <div className="settings-about-update__actions">
          <button
            type="button"
            className="btn btn--solid"
            disabled={busy}
            onClick={() => void checkForUpdate()}
          >
            {busy
              ? t("settings.checkUpdateChecking")
              : t("settings.checkUpdate")}
          </button>
          {showInstallProgress &&
          (status.state === "installing" || status.state === "restarting") ? (
            <button type="button" className="btn btn--solid" disabled>
              {status.state === "restarting"
                ? t("settings.autoUpdateRestarting")
                : t("settings.autoUpdateInstalling")}
            </button>
          ) : showInstall ? (
            <button
              type="button"
              className="btn btn--solid"
              disabled={busy}
              onClick={() => void installAndRelaunch()}
            >
              {t("settings.autoUpdateInstall")}
            </button>
          ) : null}
          {showOpenRelease && downloadUrl ? (
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => void openRelease(downloadUrl)}
            >
              {t("settings.checkUpdateDownload")}
            </button>
          ) : null}
          {showOpenRelease ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => void openRelease(releaseUrl)}
            >
              {t("settings.checkUpdateOpen")}
            </button>
          ) : null}
        </div>
        {statusText ? (
          <div
            className={
              "settings-about-update__status" +
              (toneClass ? ` ${toneClass}` : "")
            }
            role="status"
            data-update-state={status.state}
            data-update-severity={copy.severity}
          >
            {statusText}
          </div>
        ) : null}
        {bodyText ? (
          <div
            className="settings-about-update__body"
            data-update-body={copy.bodyKey ?? undefined}
          >
            {bodyText}
          </div>
        ) : null}
        {status.state === "error" ? (
          <div
            className="settings-about-update__err"
            role="alert"
            data-update-error-kind={copy.errorKind ?? "other"}
          >
            {t("settings.autoUpdateError", {
              error: copy.errorMessage ?? status.message,
            })}
            {copy.bodyKey ? (
              <div className="settings-about-update__err-hint">
                {t(copy.bodyKey)}
              </div>
            ) : null}
          </div>
        ) : null}
        {openError ? (
          <div
            className="settings-about-update__err"
            role="alert"
            data-update-error-kind={openErrorKind ?? "other"}
          >
            {t("settings.checkUpdateFailed", { error: openError })}
            {openErrorHintKey ? (
              <div className="settings-about-update__err-hint">
                {t(openErrorHintKey)}
              </div>
            ) : null}
          </div>
        ) : null}
        {assetNames && assetNames.length > 0 ? (
          <div className="settings-about-update__assets">
            {assetNames.slice(0, 6).join(" · ")}
          </div>
        ) : null}
      </div>
    </div>
  );
}

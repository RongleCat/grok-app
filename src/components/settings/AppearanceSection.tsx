/**
 * Settings → appearance section (consumes SettingsModel context).
 */
import { useSettingsModel } from "@/providers/SettingsModelContext";
import type { SettingsViewModel } from "./types";

import { Select } from "@/components/Select";
import { IconAppearance, IconCrop, IconHelp } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import {
  DEFAULT_WALLPAPER_FOCUS,
  THEME_SKINS,
  WALLPAPER_ACCEPT,
} from "@/lib/themeSkin";
import { CHAT_FONT_SCALES } from "@/lib/chatFontScale";
import { CODE_FONT_SCALES } from "@/lib/codeFontScalePref";
import {
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  resolveTerminalFontFamily,
} from "@/lib/terminalFontPref";
import { CHAT_DENSITIES } from "@/lib/chatDensity";
import { CHAT_WIDTHS } from "@/lib/chatWidthPref";
import { SIDEBAR_DENSITIES } from "@/lib/sidebarDensity";
import { WallpaperFocusEditor } from "@/components/WallpaperFocusEditor";
import { WallpaperMediaLayer } from "@/components/WallpaperMediaLayer";
import { WallpaperSourceModal } from "@/components/WallpaperSourceModal";
import { saveToolStepsAutoCollapsePref } from "@/lib/toolStepsAutoCollapsePref";
import {
  saveTranscriptFilterPref,
  type TranscriptFilterMode,
} from "@/lib/transcriptFilterPref";
import {
  saveThinkingExpandPref,
  type ThinkingExpandPref,
} from "@/lib/thinkingPref";
import { saveCodeWrapPref } from "@/lib/codeWrapPref";
import { saveCodeLineNumbersPref } from "@/lib/codeLineNumbersPref";
import { saveBackBottomAlwaysPref } from "@/lib/backBottomAlwaysPref";
import { saveSessionSearchRankPref } from "@/lib/sessionSearchRankPref";
import type { SessionSearchRankMode } from "@/lib/sessionSearch";
import { saveConfirmExternalLinksPref } from "@/lib/externalLinkPref";
import { MESSAGE_ACTIONS_VISIBILITIES } from "@/lib/messageActionsPref";
import { MESSAGE_TIME_FORMATS } from "@/lib/messageTimeFormatPref";
import { normalizeHHmm } from "@/lib/notifyQuietHours";
import { SettingsTabStrip, SettingsLabelWithTip, UiCheck } from "./shared";

export function AppearanceSection() {
  const s = useSettingsModel() as SettingsViewModel & Record<string, any>;
  const {
    title,
    mutedSessionCount = 0,
    unreadSessionCount = 0,
    activeTab,
    backBottomAlways,
    chatDensity,
    chatFontScale,
    chatWidth,
    codeFontScale,
    codeLineNumbers,
    codeWrapDefault,
    confirmExternalLinks,
    exportLogo,
    exportLogoInputRef,
    goalOrchUiEnabled,
    messageActionsVisibility,
    messageTimeFormat,
    uiFontFamily = "",
    terminalFontFamily = "",
    terminalFontSize = 13,
    onChatDensity,
    onChatFontScale,
    onChatWidth,
    onClearAllSessionMutes,
    onClearAllSessionUnread,
    onClearExportLogo,
    onCodeFontScale,
    onUiFontFamily,
    onResetUiFont,
    onTerminalFontFamily,
    onTerminalFontSize,
    onResetTerminalFont,
    onExportLogoFile,
    onGoalOrchUiEnabled,
    onMessageActionsVisibility,
    onMessageTimeFormat,
    onSection,
    onShowMessageTimestamps,
    onShowReplyLength,
    onReplaceProviderBrandLogo,
    onSidebarDensity,
    onSidebarShowRelativeTime,
    onSkin,
    onTheme,
    onThemeSchedule,
    onWallpaper,
    onWallpaperAdjust,
    onWallpaperFile,
    onWallpaperMediaSize,
    onWallpaperScrim,
    onZenMode,
    openWallpaperSource,
    rowHighlight,
    sectionNav,
    sessionSearchRank,
    setBackBottomAlways,
    setCodeLineNumbers,
    setCodeWrapDefault,
    setConfirmExternalLinks,
    setSectionTab,
    setSessionSearchRank,
    setThinkingExpand,
    setToolStepsAutoCollapse,
    setTranscriptFilter,
    setWallpaperError,
    setWallpaperFocusOpen,
    setWallpaperSourceOpen,
    showMessageTimestamps,
    showReplyLength,
    replaceProviderBrandLogo,
    sidebarDensity,
    sidebarShowRelativeTime,
    skin,
    t,
    themePreference = "system",
    themeSchedule = { enabled: false, lightFrom: "07:00", darkFrom: "19:00" },
    themeScheduleHonesty,
    thinkingExpand,
    toolStepsAutoCollapse,
    transcriptFilter,
    wallpaperBusy,
    wallpaperClip,
    wallpaperError,
    wallpaperFocus,
    wallpaperFocusOpen,
    wallpaperInputRef,
    wallpaperKind,
    wallpaperMediaSize,
    wallpaperScrim = 100,
    wallpaperSourceOpen,
    wallpaperSourceTab,
    wallpaperUrl,
    zenMode,
  } = s;

  return (
    <>
<>
            <SettingsTabStrip
              tabs={sectionNav?.tabs ?? []}
              active={activeTab}
              onChange={setSectionTab}
              ariaLabel={title}
              t={(k) => t(k)}
            />

            {(activeTab === "theme" || activeTab == null) && (
              <>
                <h2 className="settings-page__h2">
                  {t("settings.tab.theme")}
                </h2>
                <div
                  className={
                    "settings-card" + rowHighlight("settings-anchor-theme")
                  }
                  id="settings-anchor-theme"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        leading={<IconAppearance size={16} />}
                        label={t("settings.theme")}
                        tip={t("settings.themeDesc")}
                      />
                    </div>
                    <div
                      className="settings-seg"
                      role="radiogroup"
                      aria-label={t("settings.theme")}
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={themePreference === "system"}
                        className={
                          "settings-seg__btn" +
                          (themePreference === "system" ? " is-on" : "")
                        }
                        onClick={() => onTheme("system")}
                      >
                        {t("settings.themeSystem")}
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={themePreference === "light"}
                        className={
                          "settings-seg__btn" +
                          (themePreference === "light" ? " is-on" : "")
                        }
                        onClick={() => onTheme("light")}
                      >
                        {t("settings.themeLight")}
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={themePreference === "dark"}
                        className={
                          "settings-seg__btn" +
                          (themePreference === "dark" ? " is-on" : "")
                        }
                        onClick={() => onTheme("dark")}
                      >
                        {t("settings.themeDark")}
                      </button>
                    </div>
                  </div>
                  {onThemeSchedule ? (
                    <>
                      <div
                        className={
                          "settings-row" +
                          rowHighlight("settings-anchor-themeSchedule")
                        }
                        id="settings-anchor-themeSchedule"
                      >
                        <div className="settings-row__text">
                          <SettingsLabelWithTip
                            label={t("settings.themeSchedule")}
                            tip={t("settings.themeScheduleDesc")}
                          />
                        </div>
                        <UiCheck
                          checked={!!themeSchedule.enabled}
                          onChange={() =>
                            onThemeSchedule({
                              ...themeSchedule,
                              enabled: !themeSchedule.enabled,
                            })
                          }
                          ariaLabel={t("settings.themeSchedule")}
                        />
                      </div>
                      {themeSchedule.enabled ? (
                        <div className="settings-row settings-row--stack settings-quiet-hours">
                          <div className="settings-quiet-hours__times">
                            <label className="settings-quiet-hours__field">
                              <span className="settings-quiet-hours__label">
                                {t("settings.themeScheduleLightFrom")}
                              </span>
                              <input
                                type="time"
                                className="settings-input settings-quiet-hours__input"
                                value={themeSchedule.lightFrom}
                                onChange={(e) => {
                                  const next =
                                    normalizeHHmm(e.target.value) ??
                                    themeSchedule.lightFrom;
                                  onThemeSchedule({
                                    ...themeSchedule,
                                    lightFrom: next,
                                  });
                                }}
                                aria-label={t(
                                  "settings.themeScheduleLightFrom",
                                )}
                              />
                            </label>
                            <label className="settings-quiet-hours__field">
                              <span className="settings-quiet-hours__label">
                                {t("settings.themeScheduleDarkFrom")}
                              </span>
                              <input
                                type="time"
                                className="settings-input settings-quiet-hours__input"
                                value={themeSchedule.darkFrom}
                                onChange={(e) => {
                                  const next =
                                    normalizeHHmm(e.target.value) ??
                                    themeSchedule.darkFrom;
                                  onThemeSchedule({
                                    ...themeSchedule,
                                    darkFrom: next,
                                  });
                                }}
                                aria-label={t(
                                  "settings.themeScheduleDarkFrom",
                                )}
                              />
                            </label>
                          </div>
                          {themeScheduleHonesty.statusKey ? (
                            <div
                              className={
                                "settings-tray-notify__status" +
                                (themeScheduleHonesty.severity === "warn"
                                  ? " is-warn"
                                  : themeScheduleHonesty.severity === "info"
                                    ? " is-info"
                                    : "")
                              }
                              role="status"
                            >
                              {themeScheduleHonesty.next &&
                              (themeScheduleHonesty.statusKey ===
                                "settings.themeSchedule.nextSwitch" ||
                                themeScheduleHonesty.statusKey ===
                                  "settings.themeSchedule.nextSwitchTomorrow")
                                ? t(themeScheduleHonesty.statusKey, {
                                    time: themeScheduleHonesty.next.atHHmm,
                                    theme:
                                      themeScheduleHonesty.next.toTheme ===
                                      "light"
                                        ? t("settings.themeLight")
                                        : t("settings.themeDark"),
                                  })
                                : t(themeScheduleHonesty.statusKey)}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
                {onSkin || onWallpaper ? (
                  <div className="settings-appearance-duo">
                    {onSkin ? (
                      <div
                        className={
                          "settings-card settings-card--appearance-col" +
                          rowHighlight("settings-anchor-skin")
                        }
                        id="settings-anchor-skin"
                      >
                        <div className="settings-row settings-row--stack">
                          <div className="settings-row__text">
                            <SettingsLabelWithTip
                              label={t("settings.skin")}
                              tip={t("settings.skinDesc")}
                            />
                          </div>
                          <div
                            className="settings-skin-grid"
                            role="listbox"
                            aria-label={t("settings.skin")}
                          >
                            {THEME_SKINS.map((pack) => {
                              const selected = skin === pack.id;
                              const label = t(
                                `settings.skin.${pack.id}` as "settings.skin.default",
                              );
                              return (
                                <button
                                  key={pack.id}
                                  type="button"
                                  role="option"
                                  aria-selected={selected}
                                  className={
                                    "settings-skin-card" +
                                    (selected ? " is-on" : "")
                                  }
                                  onClick={() => onSkin(pack.id)}
                                >
                                  <span
                                    className="settings-skin-card__swatch"
                                    style={{
                                      background: `linear-gradient(135deg, ${pack.swatch} 0%, ${pack.swatchAlt} 100%)`,
                                    }}
                                    aria-hidden
                                  />
                                  <span className="settings-skin-card__name">
                                    {label}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ) : null}
                    {onWallpaper ? (
                      <div
                        className={
                          "settings-card settings-card--appearance-col" +
                          rowHighlight("settings-anchor-wallpaper")
                        }
                        id="settings-anchor-wallpaper"
                      >
                        <div className="settings-row settings-row--stack">
                          <div className="settings-row__text">
                            <SettingsLabelWithTip
                              label={t("settings.wallpaper")}
                              tip={t("settings.wallpaperDesc")}
                            />
                          </div>
                          <div className="settings-wallpaper">
                            <input
                              ref={wallpaperInputRef}
                              type="file"
                              accept={WALLPAPER_ACCEPT}
                              hidden
                              onChange={(e) => {
                                void onWallpaperFile(e.target.files?.[0]).catch(
                                  () => {
                                    /* error already surfaced via wallpaperError */
                                  },
                                );
                              }}
                            />
                            <div className="settings-wallpaper__preview-wrap">
                              {wallpaperUrl ? (
                                <div
                                  className={
                                    "settings-wallpaper__preview settings-wallpaper__preview--set" +
                                    (wallpaperBusy
                                      ? " settings-wallpaper__preview--busy"
                                      : "")
                                  }
                                >
                                  <WallpaperMediaLayer
                                    url={wallpaperUrl}
                                    kind={wallpaperKind ?? "image"}
                                    focus={
                                      wallpaperFocus ?? DEFAULT_WALLPAPER_FOCUS
                                    }
                                    clip={wallpaperClip}
                                    intrinsicSize={wallpaperMediaSize}
                                    onIntrinsicSize={onWallpaperMediaSize}
                                    className="settings-wallpaper__media"
                                    mediaClassName="settings-wallpaper__media-el"
                                  />
                                  {wallpaperBusy ? (
                                    <span
                                      className="settings-wallpaper__busy"
                                      aria-hidden
                                    >
                                      {t("settings.wallpaperWorking")}
                                    </span>
                                  ) : null}
                                  <div className="settings-wallpaper__hover">
                                    <button
                                      type="button"
                                      className="btn btn--solid btn--sm"
                                      disabled={wallpaperBusy}
                                      onClick={() =>
                                        wallpaperInputRef.current?.click()
                                      }
                                    >
                                      {t("settings.wallpaperReplace")}
                                    </button>
                                    {onWallpaperAdjust ? (
                                      <button
                                        type="button"
                                        className="btn btn--solid btn--sm"
                                        disabled={wallpaperBusy}
                                        onClick={() =>
                                          setWallpaperFocusOpen(true)
                                        }
                                      >
                                        <IconCrop size={14} />
                                        {t("settings.wallpaperFocus")}
                                      </button>
                                    ) : null}
                                  </div>
                                  <button
                                    type="button"
                                    className="settings-wallpaper__clear btn btn--ghost btn--sm"
                                    disabled={wallpaperBusy}
                                    onClick={() => {
                                      setWallpaperError(null);
                                      setWallpaperFocusOpen(false);
                                      void onWallpaper(null);
                                    }}
                                  >
                                    {t("settings.wallpaperClear")}
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className={
                                    "settings-wallpaper__preview" +
                                    (wallpaperBusy
                                      ? " settings-wallpaper__preview--busy"
                                      : "")
                                  }
                                  disabled={wallpaperBusy}
                                  aria-label={
                                    wallpaperBusy
                                      ? t("settings.wallpaperWorking")
                                      : t("settings.wallpaperUpload")
                                  }
                                  onClick={() =>
                                    wallpaperInputRef.current?.click()
                                  }
                                >
                                  <span className="settings-wallpaper__preview-empty">
                                    {wallpaperBusy
                                      ? t("settings.wallpaperWorking")
                                      : t("settings.wallpaperEmpty")}
                                  </span>
                                </button>
                              )}
                            </div>
                            <div className="settings-wallpaper__actions">
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                disabled={wallpaperBusy}
                                onClick={() =>
                                  wallpaperInputRef.current?.click()
                                }
                              >
                                {wallpaperUrl
                                  ? t("settings.wallpaperReplace")
                                  : t("settings.wallpaperUpload")}
                              </button>
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                disabled={wallpaperBusy}
                                onClick={() => openWallpaperSource("x")}
                              >
                                {t("settings.wallpaperFromX")}
                              </button>
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                disabled={wallpaperBusy}
                                onClick={() => openWallpaperSource("imagine")}
                              >
                                {t("settings.wallpaperImagine")}
                              </button>
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                disabled={wallpaperBusy}
                                onClick={() => openWallpaperSource("library")}
                              >
                                {t("settings.wallpaperLibrary")}
                              </button>
                            </div>
                            <WallpaperSourceModal
                              open={wallpaperSourceOpen}
                              onClose={() => setWallpaperSourceOpen(false)}
                              initialTab={wallpaperSourceTab}
                              t={t}
                              onPickFile={(file) => onWallpaperFile(file)}
                              onRequestLogin={() => {
                                setWallpaperSourceOpen(false);
                                onSection("account");
                              }}
                            />
                            {wallpaperUrl && onWallpaperAdjust ? (
                              <WallpaperFocusEditor
                                open={wallpaperFocusOpen}
                                onClose={() => setWallpaperFocusOpen(false)}
                                onApply={(result) => onWallpaperAdjust(result)}
                                mediaUrl={wallpaperUrl}
                                kind={wallpaperKind ?? "image"}
                                initialFocus={
                                  wallpaperFocus ?? DEFAULT_WALLPAPER_FOCUS
                                }
                                initialClip={wallpaperClip}
                                labels={{
                                  title: t("settings.wallpaperFocusTitle"),
                                  hint: t("settings.wallpaperFocusHint"),
                                  hintVideo: t(
                                    "settings.wallpaperFocusHintVideo",
                                  ),
                                  zoom: t("settings.wallpaperFocusZoom"),
                                  clip: t("settings.wallpaperClip"),
                                  clipStart: t("settings.wallpaperClipStart"),
                                  clipEnd: t("settings.wallpaperClipEnd"),
                                  reset: t("settings.wallpaperFocusReset"),
                                  cancel: t("common.cancel"),
                                  apply: t("settings.wallpaperFocusApply"),
                                  close: t("common.close"),
                                }}
                              />
                            ) : null}
                            {wallpaperUrl && onWallpaperScrim ? (
                              <div className="settings-wallpaper__scrim">
                                <div className="settings-wallpaper__scrim-head">
                                  <label
                                    className="settings-wallpaper__scrim-label"
                                    htmlFor="settings-wallpaper-scrim"
                                  >
                                    <span>{t("settings.wallpaperScrim")}</span>
                                    <Tip
                                      label={t("settings.wallpaperScrimDesc")}
                                      placement="top"
                                      className="ui-tip--wrap"
                                      delayMs={280}
                                    >
                                      <button
                                        type="button"
                                        className="settings-label-help"
                                        aria-label={t(
                                          "settings.wallpaperScrimDesc",
                                        )}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                        }}
                                      >
                                        <IconHelp size={14} stroke={1.75} />
                                      </button>
                                    </Tip>
                                  </label>
                                  <span
                                    className="settings-wallpaper__scrim-value"
                                    aria-hidden
                                  >
                                    {Math.round(wallpaperScrim)}%
                                  </span>
                                </div>
                                <input
                                  id="settings-wallpaper-scrim"
                                  type="range"
                                  className="settings-wallpaper__scrim-range"
                                  min={0}
                                  max={100}
                                  step={1}
                                  value={wallpaperScrim}
                                  aria-valuemin={0}
                                  aria-valuemax={100}
                                  aria-valuenow={Math.round(wallpaperScrim)}
                                  aria-label={t("settings.wallpaperScrim")}
                                  onChange={(e) => {
                                    onWallpaperScrim(Number(e.target.value));
                                  }}
                                />
                              </div>
                            ) : null}
                            {wallpaperError ? (
                              <p
                                className="settings-wallpaper__error"
                                role="alert"
                              >
                                {wallpaperError}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}

            {activeTab === "interface" && (
              <>
                <h2 className="settings-page__h2">
                  {t("settings.tab.interface")}
                </h2>
                {onZenMode ? (
                  <div
                    className={
                      "settings-card" + rowHighlight("settings-anchor-zenMode")
                    }
                    id="settings-anchor-zenMode"
                  >
                    <div className="settings-row">
                      <div className="settings-row__text">
                        <SettingsLabelWithTip
                          label={t("settings.zenMode")}
                          tip={t("settings.zenModeDesc")}
                        />
                      </div>
                      <UiCheck
                        checked={!!zenMode}
                        onChange={() => onZenMode(!zenMode)}
                        ariaLabel={t("settings.zenMode")}
                      />
                    </div>
                  </div>
                ) : null}
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-thinkingExpand")
                  }
                  id="settings-anchor-thinkingExpand"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.thinkingExpand")}
                        tip={t("settings.thinkingExpandDesc")}
                      />
                    </div>
                    <Select
                      value={thinkingExpand}
                      aria-label={t("settings.thinkingExpand")}
                      onChange={(v) => {
                        const pref: ThinkingExpandPref =
                          v === "keep-open" ? "keep-open" : "auto-collapse";
                        saveThinkingExpandPref(pref);
                        setThinkingExpand(pref);
                      }}
                      options={[
                        {
                          value: "auto-collapse",
                          label: t("settings.thinkingExpand.autoCollapse"),
                        },
                        {
                          value: "keep-open",
                          label: t("settings.thinkingExpand.keepOpen"),
                        },
                      ]}
                    />
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-toolStepsAutoCollapse")
                  }
                  id="settings-anchor-toolStepsAutoCollapse"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.toolStepsAutoCollapse")}
                        tip={t("settings.toolStepsAutoCollapseDesc")}
                      />
                    </div>
                    <UiCheck
                      checked={toolStepsAutoCollapse}
                      onChange={() => {
                        const next = !toolStepsAutoCollapse;
                        setToolStepsAutoCollapse(next);
                        saveToolStepsAutoCollapsePref(next);
                      }}
                      ariaLabel={t("settings.toolStepsAutoCollapse")}
                    />
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-transcriptFilter")
                  }
                  id="settings-anchor-transcriptFilter"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.transcriptFilter")}
                        tip={t("settings.transcriptFilterDesc")}
                      />
                    </div>
                    <Select
                      value={transcriptFilter}
                      aria-label={t("settings.transcriptFilter")}
                      onChange={(v) => {
                        const next: TranscriptFilterMode =
                          v === "conversation" ? "conversation" : "all";
                        saveTranscriptFilterPref(next);
                        setTranscriptFilter(next);
                      }}
                      options={[
                        {
                          value: "all",
                          label: t("settings.transcriptFilter.all"),
                        },
                        {
                          value: "conversation",
                          label: t("settings.transcriptFilter.conversation"),
                        },
                      ]}
                    />
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-uiFont")
                  }
                  id="settings-anchor-uiFont"
                >
                  <div className="settings-row settings-row--stack">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.uiFont")}
                        tip={t("settings.uiFontDesc")}
                      />
                    </div>
                    <div className="settings-row__controls settings-row__controls--grow">
                      <input
                        type="text"
                        className="settings-input"
                        value={uiFontFamily}
                        placeholder={t("settings.uiFontPh")}
                        aria-label={t("settings.uiFont")}
                        onChange={(e) => onUiFontFamily?.(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => onResetUiFont?.()}
                      >
                        {t("settings.fontReset")}
                      </button>
                    </div>
                    <p className="settings-hint muted">
                      {t("settings.uiFontHint")}
                    </p>
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-terminalFont")
                  }
                  id="settings-anchor-terminalFont"
                >
                  <div className="settings-row settings-row--stack">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.terminalFont")}
                        tip={t("settings.terminalFontDesc")}
                      />
                    </div>
                    <div className="settings-row__controls settings-row__controls--grow">
                      <input
                        type="text"
                        className="settings-input"
                        value={terminalFontFamily}
                        placeholder={t("settings.terminalFontPh")}
                        aria-label={t("settings.terminalFont")}
                        onChange={(e) =>
                          onTerminalFontFamily?.(e.target.value)
                        }
                      />
                      <label className="settings-inline-label">
                        <span>{t("settings.terminalFontSize")}</span>
                        <input
                          type="number"
                          className="settings-input settings-input--narrow"
                          min={MIN_TERMINAL_FONT_SIZE}
                          max={MAX_TERMINAL_FONT_SIZE}
                          value={terminalFontSize}
                          aria-label={t("settings.terminalFontSize")}
                          onChange={(e) =>
                            onTerminalFontSize?.(Number(e.target.value))
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => onResetTerminalFont?.()}
                      >
                        {t("settings.fontReset")}
                      </button>
                    </div>
                    <p className="settings-hint muted">
                      {t("settings.terminalFontHint")}
                    </p>
                    <p
                      className="settings-font-preview"
                      style={{
                        fontFamily: resolveTerminalFontFamily(terminalFontFamily),
                        fontSize: terminalFontSize,
                      }}
                      aria-hidden
                    >
                      {t("settings.terminalFontPreview")}
                    </p>
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-chatFontScale")
                  }
                  id="settings-anchor-chatFontScale"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.chatFontScale")}
                        tip={t("settings.chatFontScaleDesc")}
                      />
                    </div>
                    <div
                      className="settings-seg"
                      role="radiogroup"
                      aria-label={t("settings.chatFontScale")}
                    >
                      {CHAT_FONT_SCALES.map((scale) => (
                        <button
                          key={scale}
                          type="button"
                          role="radio"
                          aria-checked={chatFontScale === scale}
                          className={
                            "settings-seg__btn" +
                            (chatFontScale === scale ? " is-on" : "")
                          }
                          onClick={() => onChatFontScale(scale)}
                        >
                          {t(`settings.chatFontScale.${scale}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-codeFontScale")
                  }
                  id="settings-anchor-codeFontScale"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.codeFontScale")}
                        tip={t("settings.codeFontScaleDesc")}
                      />
                    </div>
                    <div
                      className="settings-seg"
                      role="radiogroup"
                      aria-label={t("settings.codeFontScale")}
                    >
                      {CODE_FONT_SCALES.map((scale) => (
                        <button
                          key={scale}
                          type="button"
                          role="radio"
                          aria-checked={codeFontScale === scale}
                          className={
                            "settings-seg__btn" +
                            (codeFontScale === scale ? " is-on" : "")
                          }
                          onClick={() => onCodeFontScale(scale)}
                        >
                          {t(`settings.codeFontScale.${scale}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-chatDensity")
                  }
                  id="settings-anchor-chatDensity"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.chatDensity")}
                        tip={t("settings.chatDensityDesc")}
                      />
                    </div>
                    <div
                      className="settings-seg"
                      role="radiogroup"
                      aria-label={t("settings.chatDensity")}
                    >
                      {CHAT_DENSITIES.map((density) => (
                        <button
                          key={density}
                          type="button"
                          role="radio"
                          aria-checked={chatDensity === density}
                          className={
                            "settings-seg__btn" +
                            (chatDensity === density ? " is-on" : "")
                          }
                          onClick={() => onChatDensity(density)}
                        >
                          {t(`settings.chatDensity.${density}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-chatWidth")
                  }
                  id="settings-anchor-chatWidth"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.chatWidth")}
                        tip={t("settings.chatWidthDesc")}
                      />
                    </div>
                    <div
                      className="settings-seg"
                      role="radiogroup"
                      aria-label={t("settings.chatWidth")}
                    >
                      {CHAT_WIDTHS.map((width) => (
                        <button
                          key={width}
                          type="button"
                          role="radio"
                          aria-checked={chatWidth === width}
                          className={
                            "settings-seg__btn" +
                            (chatWidth === width ? " is-on" : "")
                          }
                          onClick={() => onChatWidth(width)}
                        >
                          {t(`settings.chatWidth.${width}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-sidebarDensity")
                  }
                  id="settings-anchor-sidebarDensity"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.sidebarDensity")}
                        tip={t("settings.sidebarDensityDesc")}
                      />
                    </div>
                    <div
                      className="settings-seg"
                      role="radiogroup"
                      aria-label={t("settings.sidebarDensity")}
                    >
                      {SIDEBAR_DENSITIES.map((density) => (
                        <button
                          key={density}
                          type="button"
                          role="radio"
                          aria-checked={sidebarDensity === density}
                          className={
                            "settings-seg__btn" +
                            (sidebarDensity === density ? " is-on" : "")
                          }
                          onClick={() => onSidebarDensity(density)}
                        >
                          {t(`settings.sidebarDensity.${density}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-messageActions")
                  }
                  id="settings-anchor-messageActions"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.messageActions")}
                        tip={t("settings.messageActionsDesc")}
                      />
                    </div>
                    <div
                      className="settings-seg"
                      role="radiogroup"
                      aria-label={t("settings.messageActions")}
                    >
                      {MESSAGE_ACTIONS_VISIBILITIES.map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          role="radio"
                          aria-checked={messageActionsVisibility === mode}
                          className={
                            "settings-seg__btn" +
                            (messageActionsVisibility === mode ? " is-on" : "")
                          }
                          onClick={() => onMessageActionsVisibility(mode)}
                        >
                          {t(`settings.messageActions.${mode}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-codeWrapDefault")
                  }
                  id="settings-anchor-codeWrapDefault"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.codeWrapDefault")}
                        tip={t("settings.codeWrapDefaultDesc")}
                      />
                    </div>
                    <UiCheck
                      checked={codeWrapDefault}
                      onChange={() => {
                        const next = !codeWrapDefault;
                        setCodeWrapDefault(next);
                        saveCodeWrapPref(next);
                      }}
                      ariaLabel={t("settings.codeWrapDefault")}
                    />
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-codeLineNumbers")
                  }
                  id="settings-anchor-codeLineNumbers"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.codeLineNumbers")}
                        tip={t("settings.codeLineNumbersDesc")}
                      />
                    </div>
                    <UiCheck
                      checked={codeLineNumbers}
                      onChange={() => {
                        const next = !codeLineNumbers;
                        setCodeLineNumbers(next);
                        saveCodeLineNumbersPref(next);
                      }}
                      ariaLabel={t("settings.codeLineNumbers")}
                    />
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-backBottomAlways")
                  }
                  id="settings-anchor-backBottomAlways"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.backBottomAlways")}
                        tip={t("settings.backBottomAlwaysDesc")}
                      />
                    </div>
                    <UiCheck
                      checked={backBottomAlways}
                      onChange={() => {
                        const next = !backBottomAlways;
                        setBackBottomAlways(next);
                        saveBackBottomAlwaysPref(next);
                      }}
                      ariaLabel={t("settings.backBottomAlways")}
                    />
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-sessionSearchRank")
                  }
                  id="settings-anchor-sessionSearchRank"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.sessionSearchRank")}
                        tip={t("settings.sessionSearchRankDesc")}
                      />
                    </div>
                    <Select
                      value={sessionSearchRank}
                      aria-label={t("settings.sessionSearchRank")}
                      onChange={(v) => {
                        const next: SessionSearchRankMode =
                          v === "hybrid" ? "hybrid" : "keyword";
                        setSessionSearchRank(next);
                        saveSessionSearchRankPref(next);
                      }}
                      options={[
                        {
                          value: "keyword",
                          label: t("settings.sessionSearchRank.keyword"),
                        },
                        {
                          value: "hybrid",
                          label: t("settings.sessionSearchRank.hybrid"),
                        },
                      ]}
                    />
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-confirmExternalLinks")
                  }
                  id="settings-anchor-confirmExternalLinks"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.confirmExternalLinks")}
                        tip={t("settings.confirmExternalLinksDesc")}
                      />
                    </div>
                    <UiCheck
                      checked={confirmExternalLinks}
                      onChange={() => {
                        const next = !confirmExternalLinks;
                        setConfirmExternalLinks(next);
                        saveConfirmExternalLinksPref(next);
                      }}
                      ariaLabel={t("settings.confirmExternalLinks")}
                    />
                  </div>
                </div>
                {onShowMessageTimestamps ? (
                  <div
                    className={
                      "settings-card" +
                      rowHighlight("settings-anchor-messageTimestamps")
                    }
                    id="settings-anchor-messageTimestamps"
                  >
                    <div className="settings-row">
                      <div className="settings-row__text">
                        <SettingsLabelWithTip
                          label={t("settings.messageTimestamps")}
                          tip={t("settings.messageTimestampsDesc")}
                        />
                      </div>
                      <UiCheck
                        checked={!!showMessageTimestamps}
                        onChange={() =>
                          onShowMessageTimestamps(!showMessageTimestamps)
                        }
                        ariaLabel={t("settings.messageTimestamps")}
                      />
                    </div>
                  </div>
                ) : null}
                {onGoalOrchUiEnabled ? (
                  <div
                    className={
                      "settings-card" +
                      rowHighlight("settings-anchor-goalOrchUi")
                    }
                    id="settings-anchor-goalOrchUi"
                  >
                    <div className="settings-row">
                      <div className="settings-row__text">
                        <SettingsLabelWithTip
                          label={t("settings.goalOrchUi")}
                          tip={t("settings.goalOrchUiDesc")}
                        />
                      </div>
                      <UiCheck
                        checked={!!goalOrchUiEnabled}
                        onChange={() =>
                          onGoalOrchUiEnabled(!goalOrchUiEnabled)
                        }
                        ariaLabel={t("settings.goalOrchUi")}
                      />
                    </div>
                  </div>
                ) : null}
                {onReplaceProviderBrandLogo ? (
                  <div
                    className={
                      "settings-card" +
                      rowHighlight(
                        "settings-anchor-replaceProviderBrandLogo",
                      )
                    }
                    id="settings-anchor-replaceProviderBrandLogo"
                  >
                    <div className="settings-row">
                      <div className="settings-row__text">
                        <SettingsLabelWithTip
                          label={t("settings.replaceProviderBrandLogo")}
                          tip={t("settings.replaceProviderBrandLogoDesc")}
                        />
                      </div>
                      <UiCheck
                        checked={!!replaceProviderBrandLogo}
                        onChange={() =>
                          onReplaceProviderBrandLogo(
                            !replaceProviderBrandLogo,
                          )
                        }
                        ariaLabel={t("settings.replaceProviderBrandLogo")}
                      />
                    </div>
                  </div>
                ) : null}
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-exportLogo")
                  }
                  id="settings-anchor-exportLogo"
                >
                  <div className="settings-row settings-row--stack">
                    <div className="settings-row__text">
                      <SettingsLabelWithTip
                        label={t("settings.exportLogo")}
                        tip={t("settings.exportLogoDesc")}
                      />
                    </div>
                    <div
                      className="settings-export-logo"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        flexWrap: "wrap",
                        marginTop: 8,
                      }}
                    >
                      <div
                        className="settings-export-logo__preview"
                        aria-label={t("settings.exportLogoPreview")}
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 10,
                          overflow: "hidden",
                          background: "var(--bg-elevated, #18181b)",
                          border: "1px solid var(--border, #27272a)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 700,
                          flexShrink: 0,
                        }}
                      >
                        {exportLogo ? (
                          <img
                            src={exportLogo}
                            alt=""
                            width={40}
                            height={40}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                            }}
                          />
                        ) : (
                          <span aria-hidden>G</span>
                        )}
                      </div>
                      <input
                        ref={exportLogoInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        hidden
                        onChange={(e) => {
                          const f = e.target.files?.[0] ?? null;
                          void onExportLogoFile(f);
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => exportLogoInputRef.current?.click()}
                      >
                        {t("settings.exportLogoUpload")}
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        disabled={!exportLogo}
                        onClick={onClearExportLogo}
                      >
                        {t("settings.exportLogoClear")}
                      </button>
                    </div>
                  </div>
                </div>
                {onShowReplyLength ? (
                  <div
                    className={
                      "settings-card" +
                      rowHighlight("settings-anchor-showReplyLength")
                    }
                    id="settings-anchor-showReplyLength"
                  >
                    <div className="settings-row">
                      <div className="settings-row__text">
                        <SettingsLabelWithTip
                          label={t("settings.showReplyLength")}
                          tip={t("settings.showReplyLengthDesc")}
                        />
                      </div>
                      <UiCheck
                        checked={!!showReplyLength}
                        onChange={() => onShowReplyLength(!showReplyLength)}
                        ariaLabel={t("settings.showReplyLength")}
                      />
                    </div>
                  </div>
                ) : null}
                {onMessageTimeFormat ? (
                  <div
                    className={
                      "settings-card" +
                      rowHighlight("settings-anchor-messageTimeFormat")
                    }
                    id="settings-anchor-messageTimeFormat"
                  >
                    <div className="settings-row">
                      <div className="settings-row__text">
                        <SettingsLabelWithTip
                          label={t("settings.messageTimeFormat")}
                          tip={t("settings.messageTimeFormatDesc")}
                        />
                      </div>
                      <div
                        className="settings-seg"
                        role="radiogroup"
                        aria-label={t("settings.messageTimeFormat")}
                      >
                        {MESSAGE_TIME_FORMATS.map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            role="radio"
                            aria-checked={messageTimeFormat === mode}
                            className={
                              "settings-seg__btn" +
                              (messageTimeFormat === mode ? " is-on" : "")
                            }
                            onClick={() => onMessageTimeFormat(mode)}
                          >
                            {t(`settings.messageTimeFormat.${mode}`)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
                {onSidebarShowRelativeTime ? (
                  <div
                    className={
                      "settings-card" +
                      rowHighlight("settings-anchor-sidebarShowRelativeTime")
                    }
                    id="settings-anchor-sidebarShowRelativeTime"
                  >
                    <div className="settings-row">
                      <div className="settings-row__text">
                        <SettingsLabelWithTip
                          label={t("settings.sidebarShowRelativeTime")}
                          tip={t("settings.sidebarShowRelativeTimeDesc")}
                        />
                      </div>
                      <UiCheck
                        checked={!!sidebarShowRelativeTime}
                        onChange={() =>
                          onSidebarShowRelativeTime(!sidebarShowRelativeTime)
                        }
                        ariaLabel={t("settings.sidebarShowRelativeTime")}
                      />
                    </div>
                  </div>
                ) : null}
                {onClearAllSessionMutes ? (
                  <div
                    className={
                      "settings-card" +
                      rowHighlight("settings-anchor-sessionMuteSummary")
                    }
                    id="settings-anchor-sessionMuteSummary"
                  >
                    <div className="settings-row">
                      <div className="settings-row__text">
                        <SettingsLabelWithTip
                          label={t("settings.sessionMuteSummary")}
                          tip={t("settings.sessionMuteSummaryDesc")}
                        />
                        <div className="settings-row__desc">
                          {mutedSessionCount > 0
                            ? t("settings.sessionMuteCount", {
                                n: String(mutedSessionCount),
                              })
                            : t("settings.sessionMuteCountZero")}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={mutedSessionCount <= 0}
                        onClick={() => onClearAllSessionMutes()}
                      >
                        {t("settings.sessionMuteClear")}
                      </button>
                    </div>
                  </div>
                ) : null}
                {onClearAllSessionUnread ? (
                  <div
                    className={
                      "settings-card" +
                      rowHighlight("settings-anchor-sessionUnreadSummary")
                    }
                    id="settings-anchor-sessionUnreadSummary"
                  >
                    <div className="settings-row">
                      <div className="settings-row__text">
                        <SettingsLabelWithTip
                          label={t("settings.sessionUnreadSummary")}
                          tip={t("settings.sessionUnreadSummaryDesc")}
                        />
                        <div className="settings-row__desc">
                          {unreadSessionCount > 0
                            ? t("settings.sessionUnreadCount", {
                                n: String(unreadSessionCount),
                              })
                            : t("settings.sessionUnreadCountZero")}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={unreadSessionCount <= 0}
                        onClick={() => onClearAllSessionUnread()}
                      >
                        {t("settings.sessionUnreadClear")}
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </>
    </>
  );
}

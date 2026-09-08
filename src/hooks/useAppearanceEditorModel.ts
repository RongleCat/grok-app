/**
 * Appearance settings model for the homepage theme editor popup.
 * Reuses ThemeProvider + the same localStorage apply/save paths as SettingsPage
 * so wallpaper, skin, fonts, and interface prefs stay live on the workbench.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createT,
  loadLocaleCatalog,
  resolveLocale,
  type MessageKey,
  type Vars,
} from "@/i18n";
import {
  getNavDef,
  buildSettingsHash,
  resolveTab,
  type SettingsSectionId,
  type SettingsTabId,
} from "@/lib/settingsCatalog";
import {
  WallpaperPrepareError,
  prepareWallpaperFromFile,
} from "@/lib/themeSkin";
import {
  acquireAppearanceWrite,
  subscribeAppearanceWriteBusy,
} from "@/lib/appearanceWriteLock";
import { deriveThemeScheduleHonesty } from "@/lib/themeSchedule";
import { loadZenMode, saveZenMode, ZEN_MODE_CHANGE_EVENT } from "@/lib/zenMode";
import {
  applyChatFontScale,
  loadChatFontScale,
  saveChatFontScale,
  type ChatFontScale,
} from "@/lib/chatFontScale";
import {
  applyCodeFontScale,
  loadCodeFontScale,
  saveCodeFontScale,
  type CodeFontScale,
} from "@/lib/codeFontScalePref";
import {
  applyUiFontFamily,
  loadUiFontFamily,
  saveUiFontFamily,
} from "@/lib/uiFontPref";
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  loadTerminalFontFamily,
  loadTerminalFontSize,
  saveTerminalFontFamily,
  saveTerminalFontSize,
} from "@/lib/terminalFontPref";
import {
  applyChatDensity,
  loadChatDensity,
  saveChatDensity,
  type ChatDensity,
} from "@/lib/chatDensity";
import {
  applyChatWidth,
  dispatchChatWidthChange,
  loadChatWidth,
  saveChatWidth,
  type ChatWidth,
} from "@/lib/chatWidthPref";
import {
  loadExportLogoPref,
  readImageFileAsDataUrl,
  saveExportLogoPref,
} from "@/lib/exportLogoPref";
import {
  applySidebarDensity,
  loadSidebarDensity,
  saveSidebarDensity,
  type SidebarDensity,
} from "@/lib/sidebarDensity";
import { loadCodeWrapPref } from "@/lib/codeWrapPref";
import { loadCodeLineNumbersPref } from "@/lib/codeLineNumbersPref";
import { loadBackBottomAlwaysPref } from "@/lib/backBottomAlwaysPref";
import { loadTranscriptSelectionToolbarPref } from "@/lib/transcriptSelectionToolbarPref";
import { loadSessionSearchRankPref } from "@/lib/sessionSearchRankPref";
import type { SessionSearchRankMode } from "@/lib/sessionSearch";
import { loadConfirmExternalLinksPref } from "@/lib/externalLinkPref";
import {
  applyMessageActionsVisibility,
  loadMessageActionsVisibility,
  saveMessageActionsVisibility,
  type MessageActionsVisibility,
} from "@/lib/messageActionsPref";
import {
  loadThinkingExpandPref,
  type ThinkingExpandPref,
} from "@/lib/thinkingPref";
import { loadToolStepsAutoCollapsePref } from "@/lib/toolStepsAutoCollapsePref";
import {
  loadTranscriptFilterPref,
  type TranscriptFilterMode,
} from "@/lib/transcriptFilterPref";
import {
  loadMessageTimestampsPref,
  saveMessageTimestampsPref,
  MESSAGE_TIMESTAMPS_CHANGE_EVENT,
} from "@/lib/messageTimestampsPref";
import {
  loadShowReplyLengthPref,
  saveShowReplyLengthPref,
  SHOW_REPLY_LENGTH_CHANGE_EVENT,
} from "@/lib/messageLength";
import {
  loadReplaceProviderBrandLogoPref,
  saveReplaceProviderBrandLogoPref,
  REPLACE_PROVIDER_BRAND_LOGO_CHANGE_EVENT,
} from "@/lib/replaceProviderBrandLogoPref";
import {
  loadWelcomeMotionPref,
  saveWelcomeMotionPref,
  WELCOME_MOTION_CHANGE_EVENT,
} from "@/lib/welcomeMotionPref";
import {
  loadGoalOrchUiEnabled,
  saveGoalOrchUiEnabled,
  GOAL_ORCH_UI_CHANGE_EVENT,
} from "@/lib/goalOrch";
import {
  loadMessageTimeFormatPref,
  saveMessageTimeFormatPref,
  MESSAGE_TIME_FORMAT_CHANGE_EVENT,
  type MessageTimeFormat,
} from "@/lib/messageTimeFormatPref";
import {
  loadSidebarShowRelativeTimePref,
  saveSidebarShowRelativeTimePref,
  SIDEBAR_SHOW_RELATIVE_TIME_CHANGE_EVENT,
} from "@/lib/sidebarShowRelativeTimePref";
import type { WallpaperSourceTab } from "@/components/WallpaperSourceModal";
import { useThemeShell } from "@/providers/ThemeShellContext";
import type { SettingsModel } from "@/providers/SettingsModelContext";
import { notifyAppearanceChanged } from "@/lib/appearanceLiveSync";

function useBooleanEvent(
  eventName: string,
  reload: () => boolean,
  set: (v: boolean) => void,
) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const setRef = useRef(set);
  setRef.current = set;
  useEffect(() => {
    const onChange = (ev: Event) => {
      const detail = (ev as CustomEvent<unknown>).detail;
      if (typeof detail === "boolean") {
        setRef.current(detail);
        return;
      }
      setRef.current(reloadRef.current());
    };
    window.addEventListener(eventName, onChange);
    return () => window.removeEventListener(eventName, onChange);
  }, [eventName]);
}

export function useAppearanceEditorModel(opts: {
  open: boolean;
  locale: string;
  onClose: () => void;
  onNavigateSettings?: (
    section: SettingsSectionId,
    tab?: string | null,
  ) => void;
}): {
  model: SettingsModel;
  toast: string | null;
} {
  const { open, locale, onClose, onNavigateSettings } = opts;
  const theme = useThemeShell();
  const resolvedLocale = resolveLocale(locale);
  const [catalogRev, setCatalogRev] = useState(0);

  // Local 30s clock for the schedule honesty preview — previously consumed
  // theme.scheduleClock from ThemeProvider, which forced every context
  // consumer (including AppWorkbench) to re-render on every 60s tick.
  const [scheduleClock, setScheduleClock] = useState(() => new Date());
  useEffect(() => {
    if (!theme.themeSchedule.enabled) return;
    const id = window.setInterval(() => setScheduleClock(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, [theme.themeSchedule.enabled]);
  useEffect(() => {
    let cancelled = false;
    void loadLocaleCatalog(resolvedLocale).then(() => {
      if (!cancelled) setCatalogRev((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [resolvedLocale]);
  const tr = useMemo(
    () => createT(resolvedLocale),
    [resolvedLocale, catalogRev],
  );
  const t = useCallback(
    (k: string, vars?: Vars) => tr(k as MessageKey, vars),
    [tr],
  );

  const [activeTab, setActiveTab] = useState<SettingsTabId>("theme");
  useEffect(() => {
    if (open) setActiveTab("theme");
  }, [open]);
  const [toast, setToast] = useState<string | null>(null);
  const showSettingsToast = useCallback((msg: string, ms = 3500) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), ms);
  }, []);

  const wallpaperInputRef = useRef<HTMLInputElement>(null);
  const exportLogoInputRef = useRef<HTMLInputElement | null>(null);
  const [wallpaperBusy, setWallpaperBusy] = useState(false);
  const [appearanceWriteBusy, setAppearanceWriteBusy] = useState(false);
  useEffect(() => subscribeAppearanceWriteBusy(setAppearanceWriteBusy), []);
  const [wallpaperError, setWallpaperError] = useState<string | null>(null);
  const [wallpaperFocusOpen, setWallpaperFocusOpen] = useState(false);
  const [wallpaperSourceOpen, setWallpaperSourceOpen] = useState(false);
  const [wallpaperSourceTab, setWallpaperSourceTab] =
    useState<WallpaperSourceTab>("x");

  const [thinkingExpand, setThinkingExpand] = useState<ThinkingExpandPref>(() =>
    loadThinkingExpandPref(),
  );
  const [toolStepsAutoCollapse, setToolStepsAutoCollapse] = useState(() =>
    loadToolStepsAutoCollapsePref(),
  );
  const [transcriptFilter, setTranscriptFilter] =
    useState<TranscriptFilterMode>(() => loadTranscriptFilterPref());
  const [chatFontScale, setChatFontScaleState] = useState<ChatFontScale>(() =>
    loadChatFontScale(),
  );
  const [codeFontScale, setCodeFontScaleState] = useState<CodeFontScale>(() =>
    loadCodeFontScale(),
  );
  const [uiFontFamily, setUiFontFamilyState] = useState(() => loadUiFontFamily());
  const [terminalFontFamily, setTerminalFontFamilyState] = useState(() =>
    loadTerminalFontFamily(),
  );
  const [terminalFontSize, setTerminalFontSizeState] = useState(() =>
    loadTerminalFontSize(),
  );
  const [chatDensity, setChatDensityState] = useState<ChatDensity>(() =>
    loadChatDensity(),
  );
  const [chatWidth, setChatWidthState] = useState<ChatWidth>(() =>
    loadChatWidth(),
  );
  const [exportLogo, setExportLogo] = useState<string | null>(() =>
    loadExportLogoPref(),
  );
  const [sidebarDensity, setSidebarDensityState] = useState<SidebarDensity>(() =>
    loadSidebarDensity(),
  );
  const [codeWrapDefault, setCodeWrapDefault] = useState(() =>
    loadCodeWrapPref(),
  );
  const [codeLineNumbers, setCodeLineNumbers] = useState(() =>
    loadCodeLineNumbersPref(),
  );
  const [backBottomAlways, setBackBottomAlways] = useState(() =>
    loadBackBottomAlwaysPref(),
  );
  const [selectionToolbar, setSelectionToolbar] = useState(() =>
    loadTranscriptSelectionToolbarPref(),
  );
  const [sessionSearchRank, setSessionSearchRank] =
    useState<SessionSearchRankMode>(() => loadSessionSearchRankPref());
  const [confirmExternalLinks, setConfirmExternalLinks] = useState(() =>
    loadConfirmExternalLinksPref(),
  );
  const [messageActionsVisibility, setMessageActionsVisibilityState] =
    useState<MessageActionsVisibility>(() => loadMessageActionsVisibility());

  const [zenMode, setZenMode] = useState(() => loadZenMode());
  const [showMessageTimestamps, setShowMessageTimestamps] = useState(() =>
    loadMessageTimestampsPref(),
  );
  const [showReplyLength, setShowReplyLength] = useState(() =>
    loadShowReplyLengthPref(),
  );
  const [replaceProviderBrandLogo, setReplaceProviderBrandLogo] = useState(() =>
    loadReplaceProviderBrandLogoPref(),
  );
  const [welcomeMotionEnabled, setWelcomeMotionEnabled] = useState(() =>
    loadWelcomeMotionPref(),
  );
  const [goalOrchUiEnabled, setGoalOrchUiEnabled] = useState(() =>
    loadGoalOrchUiEnabled(),
  );
  const [messageTimeFormat, setMessageTimeFormat] =
    useState<MessageTimeFormat>(() => loadMessageTimeFormatPref());
  const [sidebarShowRelativeTime, setSidebarShowRelativeTime] = useState(() =>
    loadSidebarShowRelativeTimePref(),
  );

  useBooleanEvent(
    MESSAGE_TIMESTAMPS_CHANGE_EVENT,
    () => loadMessageTimestampsPref(),
    setShowMessageTimestamps,
  );
  useBooleanEvent(
    SHOW_REPLY_LENGTH_CHANGE_EVENT,
    () => loadShowReplyLengthPref(),
    setShowReplyLength,
  );
  useBooleanEvent(
    REPLACE_PROVIDER_BRAND_LOGO_CHANGE_EVENT,
    () => loadReplaceProviderBrandLogoPref(),
    setReplaceProviderBrandLogo,
  );
  useBooleanEvent(
    WELCOME_MOTION_CHANGE_EVENT,
    () => loadWelcomeMotionPref(),
    setWelcomeMotionEnabled,
  );
  useBooleanEvent(
    GOAL_ORCH_UI_CHANGE_EVENT,
    () => loadGoalOrchUiEnabled(),
    setGoalOrchUiEnabled,
  );
  useBooleanEvent(
    SIDEBAR_SHOW_RELATIVE_TIME_CHANGE_EVENT,
    () => loadSidebarShowRelativeTimePref(),
    setSidebarShowRelativeTime,
  );
  useBooleanEvent(ZEN_MODE_CHANGE_EVENT, () => loadZenMode(), setZenMode);

  useEffect(() => {
    const onChange = (ev: Event) => {
      const detail = (ev as CustomEvent<unknown>).detail;
      if (detail === "absolute" || detail === "relative") {
        setMessageTimeFormat(detail);
        return;
      }
      setMessageTimeFormat(loadMessageTimeFormatPref());
    };
    window.addEventListener(MESSAGE_TIME_FORMAT_CHANGE_EVENT, onChange);
    return () =>
      window.removeEventListener(MESSAGE_TIME_FORMAT_CHANGE_EVENT, onChange);
  }, []);

  const onChatFontScale = useCallback((next: ChatFontScale) => {
    setChatFontScaleState(next);
    saveChatFontScale(next);
    applyChatFontScale(next);
    notifyAppearanceChanged();
  }, []);
  const onCodeFontScale = useCallback((next: CodeFontScale) => {
    setCodeFontScaleState(next);
    saveCodeFontScale(next);
    applyCodeFontScale(next);
    notifyAppearanceChanged();
  }, []);
  const onUiFontFamily = useCallback((next: string) => {
    setUiFontFamilyState(next);
    saveUiFontFamily(next);
    applyUiFontFamily(next);
    notifyAppearanceChanged();
  }, []);
  const onResetUiFont = useCallback(() => {
    setUiFontFamilyState("");
    saveUiFontFamily("");
    applyUiFontFamily("");
    notifyAppearanceChanged();
  }, []);
  const onTerminalFontFamily = useCallback((next: string) => {
    setTerminalFontFamilyState(next);
    saveTerminalFontFamily(next);
    notifyAppearanceChanged();
  }, []);
  const onTerminalFontSize = useCallback((next: number) => {
    setTerminalFontSizeState(next);
    saveTerminalFontSize(next);
    notifyAppearanceChanged();
  }, []);
  const onResetTerminalFont = useCallback(() => {
    setTerminalFontFamilyState("");
    saveTerminalFontFamily("");
    setTerminalFontSizeState(DEFAULT_TERMINAL_FONT_SIZE);
    saveTerminalFontSize(DEFAULT_TERMINAL_FONT_SIZE);
    notifyAppearanceChanged();
  }, []);
  const onChatDensity = useCallback((next: ChatDensity) => {
    setChatDensityState(next);
    saveChatDensity(next);
    applyChatDensity(next);
    notifyAppearanceChanged();
  }, []);
  const onChatWidth = useCallback((next: ChatWidth) => {
    setChatWidthState(next);
    saveChatWidth(next);
    applyChatWidth(next);
    dispatchChatWidthChange(next);
    notifyAppearanceChanged();
  }, []);
  const onSidebarDensity = useCallback((next: SidebarDensity) => {
    setSidebarDensityState(next);
    saveSidebarDensity(next);
    applySidebarDensity(next);
    notifyAppearanceChanged();
  }, []);
  const onMessageActionsVisibility = useCallback(
    (next: MessageActionsVisibility) => {
      setMessageActionsVisibilityState(next);
      saveMessageActionsVisibility(next);
      applyMessageActionsVisibility(next);
      notifyAppearanceChanged();
    },
    [],
  );

  const onExportLogoFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      try {
        const dataUrl = await readImageFileAsDataUrl(file);
        saveExportLogoPref(dataUrl);
        setExportLogo(dataUrl);
      } catch (e) {
        const msg = String(e);
        if (msg.includes("too-large")) {
          showSettingsToast(t("settings.exportLogoTooLarge"), 4000);
        } else {
          showSettingsToast(t("settings.exportLogoInvalid"), 4000);
        }
      } finally {
        if (exportLogoInputRef.current) exportLogoInputRef.current.value = "";
      }
    },
    [showSettingsToast, t],
  );
  const onClearExportLogo = useCallback(() => {
    saveExportLogoPref(null);
    setExportLogo(null);
    if (exportLogoInputRef.current) exportLogoInputRef.current.value = "";
  }, []);

  const wallpaperErrorMessage = useCallback(
    (err: unknown): string => {
      if (err instanceof WallpaperPrepareError) {
        const key = `settings.wallpaper.err.${err.code}` as MessageKey;
        const msg = t(key);
        return msg === key ? t("settings.wallpaper.err.generic") : msg;
      }
      return t("settings.wallpaper.err.generic");
    },
    [t],
  );
  const openWallpaperSource = useCallback((tab: WallpaperSourceTab) => {
    setWallpaperError(null);
    setWallpaperSourceTab(tab);
    setWallpaperSourceOpen(true);
  }, []);
  const onWallpaperFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      const unlock = await acquireAppearanceWrite();
      setWallpaperBusy(true);
      setWallpaperError(null);
      try {
        const record = await prepareWallpaperFromFile(file);
        await theme.applyWallpaperChoice(record);
      } catch (e) {
        setWallpaperError(wallpaperErrorMessage(e));
        throw e;
      } finally {
        setWallpaperBusy(false);
        unlock();
        if (wallpaperInputRef.current) wallpaperInputRef.current.value = "";
      }
    },
    [theme, wallpaperErrorMessage],
  );

  const themeScheduleHonesty = useMemo(
    () =>
      deriveThemeScheduleHonesty({
        preference: theme.themePreference,
        schedule: theme.themeSchedule,
        now: scheduleClock,
      }),
    [theme.themePreference, theme.themeSchedule, scheduleClock],
  );

  const sectionNav = useMemo(() => getNavDef("appearance"), []);
  const title = t("settings.nav.appearance");

  const onSection = useCallback(
    (id: SettingsSectionId, tab?: string | null) => {
      if (onNavigateSettings) {
        onNavigateSettings(id, tab);
        return;
      }
      onClose();
      if (typeof window === "undefined") return;
      window.location.hash = buildSettingsHash({
        section: id,
        tab: resolveTab(id, tab),
      });
    },
    [onClose, onNavigateSettings],
  );

  const model = {
    t,
    title,
    sectionNav,
    activeTab,
    setSectionTab: setActiveTab,
    rowHighlight: () => "",
    showSettingsToast,
    locale,
    theme: theme.theme,
    themePreference: theme.themePreference,
    onTheme: theme.applyThemeChoice,
    themeSchedule: theme.themeSchedule,
    onThemeSchedule: theme.applyThemeScheduleChoice,
    themeScheduleHonesty,
    skin: theme.skin,
    onSkin: theme.applySkinChoice,
    wallpaperUrl: theme.wallpaperUrl,
    wallpaperKind: theme.wallpaperRecord?.kind ?? null,
    wallpaperFocus: theme.wallpaperRecord?.focus ?? null,
    wallpaperClip: theme.wallpaperRecord?.clip ?? null,
    wallpaperMediaSize:
      theme.wallpaperRecord?.width && theme.wallpaperRecord?.height
        ? { w: theme.wallpaperRecord.width, h: theme.wallpaperRecord.height }
        : null,
    onWallpaper: theme.applyWallpaperChoice,
    onWallpaperAdjust: theme.applyWallpaperAdjustChoice,
    onWallpaperMediaSize: theme.applyWallpaperMediaSize,
    wallpaperScrim: theme.wallpaperScrim,
    onWallpaperScrim: theme.applyWallpaperScrimChoice,
    wallpaperBlur: theme.wallpaperBlur,
    onWallpaperBlur: theme.applyWallpaperBlurChoice,
    wallpaperInputRef,
    wallpaperBusy: wallpaperBusy || appearanceWriteBusy,
    wallpaperError,
    setWallpaperError,
    wallpaperFocusOpen,
    setWallpaperFocusOpen,
    wallpaperSourceOpen,
    setWallpaperSourceOpen,
    wallpaperSourceTab,
    onWallpaperFile,
    openWallpaperSource,
    showMessageTimestamps,
    onShowMessageTimestamps: (v: boolean) => {
      saveMessageTimestampsPref(v);
      notifyAppearanceChanged();
    },
    showReplyLength,
    onShowReplyLength: (v: boolean) => {
      saveShowReplyLengthPref(v);
      notifyAppearanceChanged();
    },
    replaceProviderBrandLogo,
    onReplaceProviderBrandLogo: (v: boolean) => {
      saveReplaceProviderBrandLogoPref(v);
      notifyAppearanceChanged();
    },
    welcomeMotionEnabled,
    onWelcomeMotionEnabled: (v: boolean) => {
      saveWelcomeMotionPref(v);
      notifyAppearanceChanged();
    },
    goalOrchUiEnabled,
    onGoalOrchUiEnabled: (v: boolean) => {
      saveGoalOrchUiEnabled(v);
      notifyAppearanceChanged();
    },
    messageTimeFormat,
    onMessageTimeFormat: (v: MessageTimeFormat) => {
      saveMessageTimeFormatPref(v);
      notifyAppearanceChanged();
    },
    sidebarShowRelativeTime,
    onSidebarShowRelativeTime: (v: boolean) => {
      saveSidebarShowRelativeTimePref(v);
      notifyAppearanceChanged();
    },
    zenMode,
    onZenMode: (v: boolean) => {
      saveZenMode(v);
      notifyAppearanceChanged();
    },
    chatFontScale,
    onChatFontScale,
    codeFontScale,
    onCodeFontScale,
    uiFontFamily,
    onUiFontFamily,
    onResetUiFont,
    terminalFontFamily,
    terminalFontSize,
    onTerminalFontFamily,
    onTerminalFontSize,
    onResetTerminalFont,
    chatDensity,
    onChatDensity,
    chatWidth,
    onChatWidth,
    exportLogo,
    exportLogoInputRef,
    onExportLogoFile,
    onClearExportLogo,
    sidebarDensity,
    onSidebarDensity,
    codeWrapDefault,
    setCodeWrapDefault: (next: boolean) => {
      setCodeWrapDefault(next);
      notifyAppearanceChanged();
    },
    codeLineNumbers,
    setCodeLineNumbers: (next: boolean) => {
      setCodeLineNumbers(next);
      notifyAppearanceChanged();
    },
    backBottomAlways,
    setBackBottomAlways: (next: boolean) => {
      setBackBottomAlways(next);
      notifyAppearanceChanged();
    },
    selectionToolbar,
    setSelectionToolbar: (next: boolean) => {
      setSelectionToolbar(next);
      notifyAppearanceChanged();
    },
    sessionSearchRank,
    setSessionSearchRank: (next: SessionSearchRankMode) => {
      setSessionSearchRank(next);
      notifyAppearanceChanged();
    },
    confirmExternalLinks,
    setConfirmExternalLinks: (next: boolean) => {
      setConfirmExternalLinks(next);
      notifyAppearanceChanged();
    },
    thinkingExpand,
    setThinkingExpand: (next: ThinkingExpandPref) => {
      setThinkingExpand(next);
      notifyAppearanceChanged();
    },
    toolStepsAutoCollapse,
    setToolStepsAutoCollapse: (next: boolean) => {
      setToolStepsAutoCollapse(next);
      notifyAppearanceChanged();
    },
    transcriptFilter,
    setTranscriptFilter: (next: TranscriptFilterMode) => {
      setTranscriptFilter(next);
      notifyAppearanceChanged();
    },
    messageActionsVisibility,
    onMessageActionsVisibility,
    onSection,
    mutedSessionCount: 0,
    unreadSessionCount: 0,
  } as unknown as SettingsModel;

  return { model, toast };
}

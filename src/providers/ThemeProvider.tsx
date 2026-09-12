/**
 * Theme / skin / wallpaper ownership (extracted from App God Component).
 * localStorage keys and apply* behavior match the pre-split App.
 * The shared context lives separately so Fast Refresh preserves its identity.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { detectAppPlatform } from "@/lib/appPlatform";
import {
  applyNativeWindowTheme,
  applyThemePreference,
  applyThemeToDocument,
  getSystemTheme,
  loadThemePreference,
  nativeWindowThemeArg,
  parseThemePreference,
  readOsTheme,
  runThemeTransition,
  saveThemePreference,
  subscribeHostOsTheme,
  subscribeSystemTheme,
  type Theme,
  type ThemePreference,
} from "@/lib/theme";
import {
  THEME_SCHEDULE_TICK_MS,
  isThemeScheduleActive,
  loadThemeSchedule,
  resolveThemeWithSchedule,
  saveThemeSchedule,
  type ThemeScheduleConfig,
} from "@/lib/themeSchedule";
import {
  applyAppearanceChrome,
  applyFontShadow,
  applyTextColor,
  loadAppearanceChrome,
  parseFontShadow,
  parseTextColor,
  saveFontShadow,
  saveTextColor,
} from "@/lib/appearanceChromePref";
import {
  applyComposerOpacityToDocument,
  applySettingsOpacityToDocument,
  applySkinToDocument,
  applyUiOpacityToDocument,
  applyWallpaperFlag,
  applyWallpaperColorFlag,
  applyWallpaperBlurToDocument,
  applyWallpaperScrimToDocument,
  clearWallpaper,
  loadComposerOpacity,
  loadSettingsOpacity,
  loadSkin,
  loadUiOpacity,
  loadWallpaperBlur,
  loadWallpaperRecord,
  loadWallpaperScrim,
  wallpaperColorHex,
  saveComposerOpacity,
  saveSettingsOpacity,
  saveSkin,
  saveUiOpacity,
  saveWallpaper,
  saveWallpaperAdjust,
  saveWallpaperBlur,
  saveWallpaperMediaSize,
  saveWallpaperScrim,
  skinPreferredTheme,
  type ThemeSkinId,
  type WallpaperClip,
  type WallpaperFocus,
  type WallpaperRecord,
} from "@/lib/themeSkin";
import {
  appearanceWindowOrigin,
  hydrateDocumentAppearancePrefs,
  notifyAppearanceChanged,
  subscribeAppearanceChanged,
} from "@/lib/appearanceLiveSync";
import { isThemeEditorDocument } from "@/lib/themeEditorShell";
import {
  ThemeShellContext,
  type ThemeShellValue,
} from "@/providers/ThemeShellContext";

function wallpaperViewUrl(record: WallpaperRecord): string | null {
  const fill = wallpaperColorHex(record);
  if (fill) return fill;
  if (!record.blob) return null;
  return URL.createObjectURL(record.blob);
}

function revokeIfBlobUrl(url: string | null | undefined): void {
  if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
}

/** Persist theme preference into AppSettings (Host) for next cold-start paint. */
async function persistThemeToHostSettings(
  preference: ThemePreference,
): Promise<void> {
  try {
    const { isDesktopHost } = await import("@/lib/api");
    if (!isDesktopHost()) return;
    const { settingsGet, settingsSet } = await import("@/lib/api/settings");
    const s = await settingsGet();
    if (s.theme === preference) return;
    await settingsSet({ ...s, theme: preference });
  } catch {
    /* non-Tauri / store busy — localStorage still holds the choice */
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    loadThemePreference(localStorage),
  );
  const [systemTheme, setSystemTheme] = useState<Theme>(() => getSystemTheme());
  const [themeSchedule, setThemeSchedule] = useState<ThemeScheduleConfig>(() =>
    loadThemeSchedule(localStorage),
  );
  const [scheduleClock, setScheduleClock] = useState(() => new Date());
  const scheduleActive = isThemeScheduleActive(themePreference, themeSchedule);
  const theme = useMemo(
    () =>
      resolveThemeWithSchedule(
        themePreference,
        systemTheme,
        themeSchedule,
        scheduleClock,
      ),
    [themePreference, systemTheme, themeSchedule, scheduleClock],
  );
  const [skin, setSkin] = useState<ThemeSkinId>(() => loadSkin(localStorage));
  const [wallpaperRecord, setWallpaperRecord] = useState<WallpaperRecord | null>(
    null,
  );
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(null);
  const wallpaperUrlRef = useRef<string | null>(null);
  const paintWallpaperRecord = useCallback((rec: WallpaperRecord | null) => {
    revokeIfBlobUrl(wallpaperUrlRef.current);
    wallpaperUrlRef.current = null;
    if (!rec) {
      setWallpaperRecord(null);
      setWallpaperUrl(null);
      return;
    }
    const url = wallpaperViewUrl(rec);
    if (!url) {
      setWallpaperRecord(null);
      setWallpaperUrl(null);
      return;
    }
    wallpaperUrlRef.current = url.startsWith("blob:") ? url : null;
    setWallpaperRecord(rec);
    setWallpaperUrl(url);
  }, []);
  const [wallpaperScrim, setWallpaperScrim] = useState(() =>
    loadWallpaperScrim(localStorage),
  );
  const [wallpaperBlur, setWallpaperBlur] = useState(() =>
    loadWallpaperBlur(localStorage),
  );
  const [composerOpacity, setComposerOpacity] = useState(() =>
    loadComposerOpacity(localStorage),
  );
  const [uiOpacity, setUiOpacity] = useState(() => loadUiOpacity(localStorage));
  const [settingsOpacity, setSettingsOpacity] = useState(() =>
    loadSettingsOpacity(localStorage),
  );
  const [textColor, setTextColor] = useState<string | null>(
    () => loadAppearanceChrome(localStorage).textColor,
  );
  const [fontShadow, setFontShadow] = useState(
    () => loadAppearanceChrome(localStorage).fontShadow,
  );

  useEffect(() => {
    applyThemeToDocument(theme);
    void applyNativeWindowTheme(
      nativeWindowThemeArg(
        themePreference,
        themeSchedule.enabled,
        theme,
        detectAppPlatform(),
      ),
    );
  }, [theme, themePreference, themeSchedule.enabled]);

  useEffect(() => {
    if (themePreference !== "system" || themeSchedule.enabled) return;
    let cancelled = false;
    let unsubHost = () => {};
    const platform = detectAppPlatform();
    let applied: Theme | null = null;
    const applySystem = (next: Theme) => {
      if (applied === next) return;
      applied = next;
      setSystemTheme(next);
      applyThemeToDocument(next);
      void applyNativeWindowTheme(
        nativeWindowThemeArg("system", false, next, platform),
      );
    };
    void (async () => {
      const sys = await readOsTheme();
      if (cancelled) return;
      applySystem(sys);
    })();
    const unsubMql = subscribeSystemTheme(applySystem);
    void subscribeHostOsTheme(applySystem).then((unsub) => {
      if (cancelled) {
        unsub();
        return;
      }
      unsubHost = unsub;
    });
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      void readOsTheme().then((sys) => {
        if (!cancelled) applySystem(sys);
      });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      unsubMql();
      unsubHost();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [themePreference, themeSchedule.enabled]);

  useEffect(() => {
    if (!scheduleActive) return;
    const tick = () => setScheduleClock(new Date());
    tick();
    const id = window.setInterval(tick, THEME_SCHEDULE_TICK_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [scheduleActive]);

  useEffect(() => {
    applySkinToDocument(skin);
  }, [skin]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rec = await loadWallpaperRecord();
      if (cancelled || !rec) return;
      paintWallpaperRecord(rec);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let myOrigin = "web";
    void appearanceWindowOrigin().then((o) => {
      myOrigin = o;
    });
    let timer: number | null = null;
    const reload = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        setThemePreference(loadThemePreference(localStorage));
        setThemeSchedule(loadThemeSchedule(localStorage));
        setSkin(loadSkin(localStorage));
        setWallpaperScrim(loadWallpaperScrim(localStorage));
        setWallpaperBlur(loadWallpaperBlur(localStorage));
        setComposerOpacity(loadComposerOpacity(localStorage));
        setUiOpacity(loadUiOpacity(localStorage));
        setSettingsOpacity(loadSettingsOpacity(localStorage));
        const chrome = loadAppearanceChrome(localStorage);
        setTextColor(chrome.textColor);
        setFontShadow(chrome.fontShadow);
        hydrateDocumentAppearancePrefs();
        void (async () => {
          const rec = await loadWallpaperRecord();
          paintWallpaperRecord(rec);
        })();
      }, 24);
    };
    const stop = subscribeAppearanceChanged((payload) => {
      if (payload.origin === myOrigin) return;
      reload();
    });
    return () => {
      stop();
      if (timer != null) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (isThemeEditorDocument()) {
      applyWallpaperFlag(false);
      applyWallpaperColorFlag(false);
      return;
    }
    applyWallpaperFlag(wallpaperUrl !== null);
    applyWallpaperColorFlag(wallpaperRecord?.kind === "color");
  }, [wallpaperUrl, wallpaperRecord?.kind]);

  useEffect(() => {
    if (isThemeEditorDocument()) return;
    applyWallpaperScrimToDocument(wallpaperScrim);
  }, [wallpaperScrim]);

  useEffect(() => {
    if (isThemeEditorDocument()) return;
    applyWallpaperBlurToDocument(wallpaperBlur);
  }, [wallpaperBlur]);

  useEffect(() => {
    if (isThemeEditorDocument()) return;
    applyComposerOpacityToDocument(composerOpacity);
  }, [composerOpacity]);

  useEffect(() => {
    if (isThemeEditorDocument()) return;
    applyUiOpacityToDocument(uiOpacity);
  }, [uiOpacity]);

  useEffect(() => {
    if (isThemeEditorDocument()) return;
    applySettingsOpacityToDocument(settingsOpacity);
  }, [settingsOpacity]);

  useEffect(() => {
    applyAppearanceChrome({ textColor, fontShadow });
  }, [textColor, fontShadow]);

  const applyThemeChoice = useCallback(
    (next: ThemePreference) => {
      saveThemePreference(localStorage, next);
      notifyAppearanceChanged();
      // Dual-write Host settings so the next cold start can paint the boot
      // shell + native chrome before React loads (see resolve_boot_theme).
      void persistThemeToHostSettings(next);
      if (next === "light" || next === "dark") {
        runThemeTransition(() => {
          applyThemeToDocument(next);
          flushSync(() => setThemePreference(next));
        });
        return;
      }
      setThemePreference(next);
      if (next === "system" && themeSchedule.enabled) {
        const resolved = resolveThemeWithSchedule(
          next,
          getSystemTheme(),
          themeSchedule,
          new Date(),
        );
        setScheduleClock(new Date());
        applyThemeToDocument(resolved);
        void applyNativeWindowTheme(resolved);
        return;
      }
      void applyThemePreference(next, {
        onResolved: (resolved, system) => {
          setSystemTheme(next === "system" ? resolved : system);
        },
      });
    },
    [themeSchedule],
  );

  // One-shot: migrate localStorage theme → Host when Host still has the
  // factory default "system" while the user already chose light/dark locally.
  // After dual-write is live, Host is source of truth on subsequent boots.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { isDesktopHost } = await import("@/lib/api");
        if (!isDesktopHost()) return;
        const { settingsGet, settingsSet } = await import("@/lib/api/settings");
        const s = await settingsGet();
        if (cancelled) return;
        const host = parseThemePreference(s.theme);
        const local = loadThemePreference(localStorage);
        if (host === "system" && local !== "system") {
          await settingsSet({ ...s, theme: local });
          return;
        }
        if (host !== local) {
          // Host wins (written by a previous dual-write / other client).
          saveThemePreference(localStorage, host);
          if (!cancelled) {
            setThemePreference(host);
            void applyThemePreference(host, {
              onResolved: (resolved, system) => {
                if (!cancelled) {
                  setSystemTheme(host === "system" ? resolved : system);
                }
              },
            });
          }
        }
      } catch {
        /* browser / offline */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyThemeScheduleChoice = useCallback(
    (next: ThemeScheduleConfig) => {
      saveThemeSchedule(next, localStorage);
      notifyAppearanceChanged();
      setThemeSchedule(next);
      setScheduleClock(new Date());
      const resolved = resolveThemeWithSchedule(
        themePreference,
        getSystemTheme(),
        next,
        new Date(),
      );
      applyThemeToDocument(resolved);
      if (themePreference === "system" && next.enabled) {
        void applyNativeWindowTheme(resolved);
      } else if (themePreference === "system" && !next.enabled) {
        void applyThemePreference("system", {
          onResolved: (r) => {
            setSystemTheme(r);
          },
        });
      } else {
        void applyNativeWindowTheme(resolved);
      }
    },
    [themePreference],
  );

  const applySkinChoice = useCallback(
    (next: ThemeSkinId, opts?: { applyPreferredTheme?: boolean }) => {
      saveSkin(localStorage, next);
      applySkinToDocument(next);
      setSkin(next);
      notifyAppearanceChanged();
      if (opts?.applyPreferredTheme === false) return;
      const preferred = skinPreferredTheme(next);
      if (preferred && preferred !== theme) {
        applyThemeChoice(preferred);
      }
    },
    [theme, applyThemeChoice],
  );

  const applyWallpaperChoice = useCallback(
    async (
      record: WallpaperRecord | null,
      opts?: { onError?: (msg: string) => void },
    ) => {
      if (!record) {
        try {
          await clearWallpaper();
        } catch (e) {
          opts?.onError?.(String(e));
          return;
        }
        paintWallpaperRecord(null);
        notifyAppearanceChanged();
        return;
      }
      const toSave: WallpaperRecord = {
        ...record,
        focus: record.focus ?? undefined,
      };
      if (toSave.kind === "color" ? !wallpaperColorHex(toSave) : !toSave.blob) {
        return;
      }
      paintWallpaperRecord(toSave);
      try {
        await saveWallpaper(toSave);
        notifyAppearanceChanged();
      } catch (e) {
        opts?.onError?.(String(e));
      }
    },
    [paintWallpaperRecord],
  );

  const applyWallpaperAdjustChoice = useCallback(
    (patch: {
      focus: WallpaperFocus;
      clip: WallpaperClip | null;
      duration?: number;
    }) => {
      const meta = saveWallpaperAdjust({
        focus: patch.focus,
        clip: patch.clip,
        duration: patch.duration,
      });
      if (!meta) return;
      setWallpaperRecord((prev) => {
        if (!prev) return prev;
        const next: WallpaperRecord = {
          ...prev,
          focus: meta.focus,
          clip: meta.clip,
        };
        if (!meta.focus) delete next.focus;
        if (!meta.clip) delete next.clip;
        return next;
      });
      notifyAppearanceChanged();
    },
    [],
  );

  const applyWallpaperMediaSize = useCallback(
    (size: { w: number; h: number }) => {
      const meta = saveWallpaperMediaSize(size.w, size.h);
      if (!meta) return;
      setWallpaperRecord((prev) => {
        if (!prev) return prev;
        if (prev.width === meta.width && prev.height === meta.height) return prev;
        return {
          ...prev,
          width: meta.width,
          height: meta.height,
        };
      });
      notifyAppearanceChanged();
    },
    [],
  );

  const applyWallpaperScrimChoice = useCallback((value: number) => {
    saveWallpaperScrim(localStorage, value);
    applyWallpaperScrimToDocument(value);
    setWallpaperScrim(value);
    notifyAppearanceChanged();
  }, []);

  const applyWallpaperBlurChoice = useCallback((value: number) => {
    saveWallpaperBlur(localStorage, value);
    applyWallpaperBlurToDocument(value);
    setWallpaperBlur(value);
    notifyAppearanceChanged();
  }, []);

  const applyComposerOpacityChoice = useCallback((value: number) => {
    saveComposerOpacity(localStorage, value);
    applyComposerOpacityToDocument(value);
    setComposerOpacity(value);
    notifyAppearanceChanged();
  }, []);

  const applyUiOpacityChoice = useCallback((value: number) => {
    saveUiOpacity(localStorage, value);
    applyUiOpacityToDocument(value);
    setUiOpacity(value);
    notifyAppearanceChanged();
  }, []);

  const applySettingsOpacityChoice = useCallback((value: number) => {
    saveSettingsOpacity(localStorage, value);
    applySettingsOpacityToDocument(value);
    setSettingsOpacity(value);
    notifyAppearanceChanged();
  }, []);

  const applyTextColorChoice = useCallback((value: string | null) => {
    const next = parseTextColor(value);
    saveTextColor(next, localStorage);
    applyTextColor(next);
    setTextColor(next);
    notifyAppearanceChanged();
  }, []);

  const applyFontShadowChoice = useCallback((value: boolean) => {
    const next = parseFontShadow(value);
    saveFontShadow(next, localStorage);
    applyFontShadow(next);
    setFontShadow(next);
    notifyAppearanceChanged();
  }, []);

  const resetAppearanceChromeChoice = useCallback(() => {
    saveTextColor(null, localStorage);
    saveFontShadow(false, localStorage);
    applyTextColor(null);
    applyFontShadow(false);
    setTextColor(null);
    setFontShadow(false);
    saveComposerOpacity(localStorage, 100);
    applyComposerOpacityToDocument(100);
    setComposerOpacity(100);
    saveUiOpacity(localStorage, 100);
    applyUiOpacityToDocument(100);
    setUiOpacity(100);
    saveSettingsOpacity(localStorage, 100);
    applySettingsOpacityToDocument(100);
    setSettingsOpacity(100);
    notifyAppearanceChanged();
  }, []);

  const value = useMemo<ThemeShellValue>(
    () => ({
      theme,
      themePreference,
      setThemePreference,
      systemTheme,
      setSystemTheme,
      themeSchedule,
      setThemeSchedule,
      scheduleActive,
      skin,
      setSkin,
      wallpaperRecord,
      setWallpaperRecord,
      wallpaperUrl,
      setWallpaperUrl,
      wallpaperUrlRef,
      wallpaperScrim,
      setWallpaperScrim,
      wallpaperBlur,
      setWallpaperBlur,
      composerOpacity,
      uiOpacity,
      settingsOpacity,
      textColor,
      fontShadow,
      applyThemeChoice,
      applyThemeScheduleChoice,
      applySkinChoice,
      applyWallpaperChoice,
      applyWallpaperAdjustChoice,
      applyWallpaperMediaSize,
      applyWallpaperScrimChoice,
      applyWallpaperBlurChoice,
      applyComposerOpacityChoice,
      applyUiOpacityChoice,
      applySettingsOpacityChoice,
      applyTextColorChoice,
      applyFontShadowChoice,
      resetAppearanceChromeChoice,
    }),
    [
      theme,
      themePreference,
      systemTheme,
      themeSchedule,
      // scheduleClock intentionally excluded: the resolved `theme` above
      // already reflects the schedule. Rebuilding the context value every
      // 60s tick forced a full workbench re-render.
      scheduleActive,
      skin,
      wallpaperRecord,
      wallpaperUrl,
      wallpaperScrim,
      wallpaperBlur,
      composerOpacity,
      uiOpacity,
      settingsOpacity,
      textColor,
      fontShadow,
      applyThemeChoice,
      applyThemeScheduleChoice,
      applySkinChoice,
      applyWallpaperChoice,
      applyWallpaperAdjustChoice,
      applyWallpaperMediaSize,
      applyWallpaperScrimChoice,
      applyWallpaperBlurChoice,
      applyComposerOpacityChoice,
      applyUiOpacityChoice,
      applySettingsOpacityChoice,
      applyTextColorChoice,
      applyFontShadowChoice,
      resetAppearanceChromeChoice,
    ],
  );

  return (
    <ThemeShellContext.Provider value={value}>
      {children}
    </ThemeShellContext.Provider>
  );
}

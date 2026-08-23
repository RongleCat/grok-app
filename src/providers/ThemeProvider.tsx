/**
 * Theme / skin / wallpaper ownership (extracted from App God Component).
 * localStorage keys and apply* behavior match the pre-split App.
 */
import {
  createContext,
  useCallback,
  useContext,
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
  applySkinToDocument,
  applyWallpaperFlag,
  applyWallpaperScrimToDocument,
  clearWallpaper,
  loadSkin,
  loadWallpaperRecord,
  loadWallpaperScrim,
  saveSkin,
  saveWallpaper,
  saveWallpaperAdjust,
  saveWallpaperMediaSize,
  saveWallpaperScrim,
  skinPreferredTheme,
  type ThemeSkinId,
  type WallpaperClip,
  type WallpaperFocus,
  type WallpaperRecord,
} from "@/lib/themeSkin";

export type ThemeShellValue = {
  theme: Theme;
  themePreference: ThemePreference;
  setThemePreference: (v: ThemePreference) => void;
  systemTheme: Theme;
  setSystemTheme: (v: Theme) => void;
  themeSchedule: ThemeScheduleConfig;
  setThemeSchedule: (v: ThemeScheduleConfig) => void;
  scheduleClock: Date;
  setScheduleClock: (v: Date) => void;
  scheduleActive: boolean;
  skin: ThemeSkinId;
  setSkin: (v: ThemeSkinId) => void;
  wallpaperRecord: WallpaperRecord | null;
  setWallpaperRecord: React.Dispatch<React.SetStateAction<WallpaperRecord | null>>;
  wallpaperUrl: string | null;
  setWallpaperUrl: (v: string | null) => void;
  wallpaperUrlRef: React.MutableRefObject<string | null>;
  wallpaperScrim: number;
  setWallpaperScrim: (v: number) => void;
  applyThemeChoice: (next: ThemePreference) => void;
  applyThemeScheduleChoice: (next: ThemeScheduleConfig) => void;
  applySkinChoice: (
    next: ThemeSkinId,
    opts?: { applyPreferredTheme?: boolean },
  ) => void;
  applyWallpaperChoice: (
    record: WallpaperRecord | null,
    opts?: { onError?: (msg: string) => void },
  ) => Promise<void>;
  applyWallpaperAdjustChoice: (patch: {
    focus: WallpaperFocus;
    clip: WallpaperClip | null;
    duration?: number;
  }) => void;
  applyWallpaperMediaSize: (size: { w: number; h: number }) => void;
  applyWallpaperScrimChoice: (value: number) => void;
};

const ThemeShellContext = createContext<ThemeShellValue | null>(null);

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
  const [wallpaperScrim, setWallpaperScrim] = useState(() =>
    loadWallpaperScrim(localStorage),
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
      const url = URL.createObjectURL(rec.blob);
      wallpaperUrlRef.current = url;
      setWallpaperRecord(rec);
      setWallpaperUrl(url);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    applyWallpaperFlag(wallpaperUrl !== null);
  }, [wallpaperUrl]);

  useEffect(() => {
    applyWallpaperScrimToDocument(wallpaperScrim);
  }, [wallpaperScrim]);

  const applyThemeChoice = useCallback(
    (next: ThemePreference) => {
      saveThemePreference(localStorage, next);
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
        if (wallpaperUrlRef.current) {
          URL.revokeObjectURL(wallpaperUrlRef.current);
          wallpaperUrlRef.current = null;
        }
        setWallpaperRecord(null);
        setWallpaperUrl(null);
        return;
      }
      const toSave: WallpaperRecord = {
        ...record,
        focus: record.focus ?? undefined,
      };
      try {
        await saveWallpaper(toSave);
      } catch (e) {
        opts?.onError?.(String(e));
        return;
      }
      const url = URL.createObjectURL(toSave.blob);
      if (wallpaperUrlRef.current) URL.revokeObjectURL(wallpaperUrlRef.current);
      wallpaperUrlRef.current = url;
      setWallpaperRecord(toSave);
      setWallpaperUrl(url);
    },
    [],
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
    },
    [],
  );

  const applyWallpaperScrimChoice = useCallback((value: number) => {
    saveWallpaperScrim(localStorage, value);
    applyWallpaperScrimToDocument(value);
    setWallpaperScrim(value);
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
      scheduleClock,
      setScheduleClock,
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
      applyThemeChoice,
      applyThemeScheduleChoice,
      applySkinChoice,
      applyWallpaperChoice,
      applyWallpaperAdjustChoice,
      applyWallpaperMediaSize,
      applyWallpaperScrimChoice,
    }),
    [
      theme,
      themePreference,
      systemTheme,
      themeSchedule,
      scheduleClock,
      scheduleActive,
      skin,
      wallpaperRecord,
      wallpaperUrl,
      wallpaperScrim,
      applyThemeChoice,
      applyThemeScheduleChoice,
      applySkinChoice,
      applyWallpaperChoice,
      applyWallpaperAdjustChoice,
      applyWallpaperMediaSize,
      applyWallpaperScrimChoice,
    ],
  );

  return (
    <ThemeShellContext.Provider value={value}>
      {children}
    </ThemeShellContext.Provider>
  );
}

export function useThemeShell(): ThemeShellValue {
  const ctx = useContext(ThemeShellContext);
  if (!ctx) {
    throw new Error("useThemeShell must be used within ThemeProvider");
  }
  return ctx;
}

import {
  createContext,
  useContext,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { Theme, ThemePreference } from "@/lib/theme";
import type { ThemeScheduleConfig } from "@/lib/themeSchedule";
import type {
  ThemeSkinId,
  WallpaperClip,
  WallpaperFocus,
  WallpaperRecord,
} from "@/lib/themeSkin";

export type ThemeShellValue = {
  theme: Theme;
  themePreference: ThemePreference;
  setThemePreference: (value: ThemePreference) => void;
  systemTheme: Theme;
  setSystemTheme: (value: Theme) => void;
  themeSchedule: ThemeScheduleConfig;
  setThemeSchedule: (value: ThemeScheduleConfig) => void;
  scheduleActive: boolean;
  skin: ThemeSkinId;
  setSkin: (value: ThemeSkinId) => void;
  wallpaperRecord: WallpaperRecord | null;
  setWallpaperRecord: Dispatch<SetStateAction<WallpaperRecord | null>>;
  wallpaperUrl: string | null;
  setWallpaperUrl: (value: string | null) => void;
  wallpaperUrlRef: MutableRefObject<string | null>;
  wallpaperScrim: number;
  setWallpaperScrim: (value: number) => void;
  wallpaperBlur: number;
  setWallpaperBlur: (value: number) => void;
  composerOpacity: number;
  uiOpacity: number;
  settingsOpacity: number;
  textColor: string | null;
  fontShadow: boolean;
  applyThemeChoice: (next: ThemePreference) => void;
  applyThemeScheduleChoice: (next: ThemeScheduleConfig) => void;
  applySkinChoice: (
    next: ThemeSkinId,
    options?: { applyPreferredTheme?: boolean },
  ) => void;
  applyWallpaperChoice: (
    record: WallpaperRecord | null,
    options?: { onError?: (message: string) => void },
  ) => Promise<void>;
  applyWallpaperAdjustChoice: (patch: {
    focus: WallpaperFocus;
    clip: WallpaperClip | null;
    duration?: number;
  }) => void;
  applyWallpaperMediaSize: (size: { w: number; h: number }) => void;
  applyWallpaperScrimChoice: (value: number) => void;
  applyWallpaperBlurChoice: (value: number) => void;
  applyComposerOpacityChoice: (value: number) => void;
  applyUiOpacityChoice: (value: number) => void;
  applySettingsOpacityChoice: (value: number) => void;
  applyTextColorChoice: (value: string | null) => void;
  applyFontShadowChoice: (value: boolean) => void;
  resetAppearanceChromeChoice: () => void;
};

export const ThemeShellContext = createContext<ThemeShellValue | null>(null);

export function useThemeShell(): ThemeShellValue {
  const context = useContext(ThemeShellContext);
  if (!context) {
    throw new Error("useThemeShell must be used within ThemeProvider");
  }
  return context;
}

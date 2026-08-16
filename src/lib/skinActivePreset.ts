/**
 * Which library preset the current look last came from, plus a list-refresh bus.
 */

import { parseWallpaperScrim, type ThemeSkinId, type WallpaperRecord } from "./themeSkin";
import type { SkinPresetListItem } from "./api/skin";

export const SKIN_ACTIVE_PRESET_KEY = "grok-app.skin-preset-active";
export const SKIN_LIBRARY_CHANGED_EVENT = "grok-app.skin-library-changed";

export function loadActivePresetId(
  storage: Pick<Storage, "getItem"> = localStorage,
): string | null {
  try {
    const v = storage.getItem(SKIN_ACTIVE_PRESET_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function saveActivePresetId(
  id: string | null,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = localStorage,
): void {
  try {
    if (!id) storage.removeItem(SKIN_ACTIVE_PRESET_KEY);
    else storage.setItem(SKIN_ACTIVE_PRESET_KEY, id);
  } catch {
    /* ignore quota / private mode */
  }
}

export function presetMatchesCurrentLook(
  preset: Pick<SkinPresetListItem, "skin" | "scrim" | "hasWallpaper">,
  look: {
    skin: ThemeSkinId;
    wallpaperRecord: WallpaperRecord | null;
    wallpaperScrim: number;
  },
): boolean {
  return (
    preset.skin === look.skin &&
    preset.scrim === parseWallpaperScrim(look.wallpaperScrim) &&
    preset.hasWallpaper === (look.wallpaperRecord != null)
  );
}

export function resolveActivePresetId(
  storedId: string | null,
  presets: SkinPresetListItem[],
  look: {
    skin: ThemeSkinId;
    wallpaperRecord: WallpaperRecord | null;
    wallpaperScrim: number;
  },
): string | null {
  if (!storedId) return null;
  const preset = presets.find((p) => p.id === storedId);
  if (!preset) return null;
  return presetMatchesCurrentLook(preset, look) ? storedId : null;
}

export function notifySkinLibraryChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SKIN_LIBRARY_CHANGED_EVENT));
}

export function subscribeSkinLibraryChanged(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(SKIN_LIBRARY_CHANGED_EVENT, fn);
  return () => window.removeEventListener(SKIN_LIBRARY_CHANGED_EVENT, fn);
}

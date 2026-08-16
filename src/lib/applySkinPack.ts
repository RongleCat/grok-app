/**
 * Apply a inspected skin pack through ThemeProvider helpers.
 *
 * Snapshot (when required) happens before any appearance mutation.
 * Library-save failure after helpers succeed does not roll back appearance.
 */

import type { ThemeSkinId, WallpaperFocus, WallpaperClip, WallpaperRecord } from "./themeSkin";
import { DEFAULT_WALLPAPER_FOCUS } from "./wallpaperFocus";
import {
  isEmptyDefaultLook,
  keepWallpaperAllowed,
  type SkinPackErrorCode,
  type SkinPackPreview,
} from "./skinPack";

export type ApplySkinPackOpts = {
  keepWallpaper: boolean;
  saveToLibrary: boolean;
  skipUndoSnapshot: boolean;
};

export type ApplySkinPackLook = {
  skin: ThemeSkinId;
  wallpaperRecord: WallpaperRecord | null;
  wallpaperScrim: number;
};

export type SnapshotResult =
  | { ok: true }
  | { ok: false; code: SkinPackErrorCode };

export type ApplySkinPackDeps = {
  currentLook: () => ApplySkinPackLook;
  snapshotBeforeLastApply: () => Promise<SnapshotResult>;
  fileFromAbsolutePath: (
    path: string,
    opts: { name: string; mime: string },
  ) => Promise<File>;
  prepareWallpaperFromFile: (file: File) => Promise<WallpaperRecord>;
  applyWallpaperChoice: (
    record: WallpaperRecord | null,
    opts?: { onError?: (msg: string) => void },
  ) => Promise<void>;
  applyWallpaperAdjustChoice: (patch: {
    focus: WallpaperFocus;
    clip: WallpaperClip | null;
  }) => void;
  applySkinChoice: (
    next: ThemeSkinId,
    opts?: { applyPreferredTheme?: boolean },
  ) => void;
  applyWallpaperScrimChoice: (value: number) => void;
  applyThemeChoice?: (next: string) => void;
  saveFromInspect: (inspectId: string) => Promise<void>;
  inspectAbort: (inspectId: string) => Promise<void>;
  acquireWrite: () => Promise<() => void>;
};

export type ApplySkinPackResult = {
  appearanceWriteCompleted: boolean;
  undoSnapshotCompleted: boolean;
  wallpaperAlreadyMutated: boolean;
  savedToLibrary: boolean;
  error: SkinPackErrorCode | null;
  libraryError: SkinPackErrorCode | null;
  appliedKeepWallpaper: boolean;
  applySkinOpts: { applyPreferredTheme: boolean } | null;
};

function codeFrom(e: unknown): SkinPackErrorCode {
  const s = e instanceof Error ? e.message : String(e);
  const head = s.split(":")[0]?.trim();
  const known: SkinPackErrorCode[] = [
    "invalid_pack",
    "unsupported_schema",
    "too_large",
    "hash_mismatch",
    "network",
    "cancelled",
    "url_blocked",
    "preset_limit",
    "disk_budget",
    "official_unconfigured",
    "source_disabled",
    "not_found",
    "busy",
    "desktop_only",
    "ffmpeg_required",
  ];
  if (head && (known as string[]).includes(head)) return head as SkinPackErrorCode;
  return "invalid_pack";
}

export async function applySkinPack(
  preview: SkinPackPreview,
  opts: ApplySkinPackOpts,
  deps: ApplySkinPackDeps,
): Promise<ApplySkinPackResult> {
  const unlock = await deps.acquireWrite();
  const result: ApplySkinPackResult = {
    appearanceWriteCompleted: false,
    undoSnapshotCompleted: false,
    wallpaperAlreadyMutated: false,
    savedToLibrary: false,
    error: null,
    libraryError: null,
    appliedKeepWallpaper: false,
    applySkinOpts: null,
  };
  let savedToLibrary = false;
  try {
    const keep =
      opts.keepWallpaper &&
      keepWallpaperAllowed(preview.source, preview.wallpaper);
    result.appliedKeepWallpaper = keep;
    const needClearWallpaper = preview.wallpaper == null && !keep;

    if (!opts.skipUndoSnapshot && !isEmptyDefaultLook(deps.currentLook())) {
      const snap = await deps.snapshotBeforeLastApply();
      if (!snap.ok) {
        result.error = snap.code;
        return result;
      }
      result.undoSnapshotCompleted = true;
    }

    if (preview.wallpaper) {
      const file = await deps.fileFromAbsolutePath(preview.wallpaper.path, {
        name: preview.wallpaper.name,
        mime: preview.wallpaper.mime,
      });
      const record = await deps.prepareWallpaperFromFile(file);
      const wallOk = await new Promise<boolean>((resolve) => {
        void deps
          .applyWallpaperChoice(record, {
            onError: () => resolve(false),
          })
          .then(() => resolve(true));
      });
      if (!wallOk) {
        result.error = "invalid_pack";
        return result;
      }
      result.wallpaperAlreadyMutated = true;
      deps.applyWallpaperAdjustChoice({
        focus: preview.wallpaper.focus ?? DEFAULT_WALLPAPER_FOCUS,
        clip: preview.wallpaper.clip ?? null,
      });
    } else if (needClearWallpaper) {
      const wallOk = await new Promise<boolean>((resolve) => {
        void deps
          .applyWallpaperChoice(null, {
            onError: () => resolve(false),
          })
          .then(() => resolve(true));
      });
      if (!wallOk) {
        result.error = "invalid_pack";
        return result;
      }
      result.wallpaperAlreadyMutated = true;
    }

    const applySkinOpts = { applyPreferredTheme: false as const };
    result.applySkinOpts = applySkinOpts;
    deps.applySkinChoice(preview.skin, applySkinOpts);
    deps.applyWallpaperScrimChoice(preview.scrim);
    result.appearanceWriteCompleted = true;

    if (opts.saveToLibrary) {
      try {
        await deps.saveFromInspect(preview.id);
        savedToLibrary = true;
        result.savedToLibrary = true;
      } catch (saveErr) {
        result.libraryError = codeFrom(saveErr);
      }
    }
  } catch (e) {
    if (
      result.wallpaperAlreadyMutated &&
      result.undoSnapshotCompleted &&
      !result.appearanceWriteCompleted
    ) {
      /* caller may rollback; this function surfaces the error */
    }
    if (!result.appearanceWriteCompleted) {
      result.error = codeFrom(e);
    }
  } finally {
    if (!savedToLibrary) {
      try {
        await deps.inspectAbort(preview.id);
      } catch {
        /* ignore abort errors */
      }
    }
    unlock();
  }
  return result;
}

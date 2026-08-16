/**
 * Host wrappers + IDB→disk chunk upload for save/export current look.
 */

import {
  skinStagingAbort,
  skinStagingAppend,
  skinStagingBegin,
  skinUndoAbort,
  skinUndoAppend,
  skinUndoCommit,
  skinUndoPrepare,
} from "./api/skin";
import { buildExportManifest } from "./skinPack";
import type { ThemeSkinId, WallpaperRecord } from "./themeSkin";
import { DEFAULT_WALLPAPER_FOCUS, normalizeWallpaperFocus } from "./wallpaperFocus";
import { readViewportAspect } from "./wallpaperExportBake";

const CHUNK = 512 * 1024;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => reject(r.error ?? new Error("read_failed"));
    r.readAsDataURL(blob);
  });
}

async function uploadBlob(
  blob: Blob,
  append: (b64: string) => Promise<unknown>,
  onProgress?: (sent: number, total: number) => void,
  signal?: { cancelled: boolean },
): Promise<void> {
  const total = blob.size;
  let sent = 0;
  while (sent < total) {
    if (signal?.cancelled) throw new Error("cancelled");
    const end = Math.min(sent + CHUNK, total);
    const slice = blob.slice(sent, end);
    const b64 = await blobToBase64(slice);
    await append(b64);
    sent = end;
    onProgress?.(sent, total);
  }
}

export function wallpaperExtForRecord(rec: WallpaperRecord): string {
  const mime = rec.mime.toLowerCase();
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4")) return "mp4";
  return "jpg";
}

export function currentLookManifest(input: {
  name: string;
  skin: ThemeSkinId;
  scrim: number;
  wallpaper: WallpaperRecord | null;
  /** Exporter window aspect; wallpaper bake uses this to match the editor crop. */
  viewAspect?: number;
}): ReturnType<typeof buildExportManifest> {
  const ext = input.wallpaper ? wallpaperExtForRecord(input.wallpaper) : "jpg";
  const viewAspect = input.wallpaper
    ? input.viewAspect && input.viewAspect > 0
      ? input.viewAspect
      : readViewportAspect()
    : undefined;
  return buildExportManifest({
    name: input.name,
    skin: input.skin,
    scrim: input.scrim,
    wallpaper: input.wallpaper
      ? {
          file: `assets/wallpaper.${ext}`,
          kind: input.wallpaper.kind,
          mime: input.wallpaper.mime,
          name: input.wallpaper.name,
          sha256: "0".repeat(64),
          width: input.wallpaper.width,
          height: input.wallpaper.height,
          focus: input.wallpaper.focus
            ? normalizeWallpaperFocus(input.wallpaper.focus)
            : { ...DEFAULT_WALLPAPER_FOCUS },
          clip: input.wallpaper.clip ?? null,
          ...(typeof viewAspect === "number" ? { viewAspect } : {}),
        }
      : null,
  });
}

export async function uploadCurrentWallpaper(opts: {
  blob: Blob;
  onProgress?: (sent: number, total: number) => void;
  signal?: { cancelled: boolean };
}): Promise<string> {
  const { uploadId } = await skinStagingBegin();
  try {
    await uploadBlob(opts.blob, (b64) => skinStagingAppend(uploadId, b64), opts.onProgress, opts.signal);
    return uploadId;
  } catch (e) {
    await skinStagingAbort(uploadId).catch(() => undefined);
    throw e;
  }
}

export type UndoSnapshotIo = {
  prepare: () => Promise<string>;
  append: (id: string, chunkBase64: string) => Promise<number>;
  commit: (id: string, manifest: unknown) => Promise<void>;
  abort: (id: string) => Promise<void>;
};

export const hostUndoSnapshotIo: UndoSnapshotIo = {
  prepare: skinUndoPrepare,
  append: skinUndoAppend,
  commit: skinUndoCommit,
  abort: skinUndoAbort,
};

function isCancelled(signal?: { cancelled: boolean }): boolean {
  return !!signal?.cancelled;
}

/**
 * Write `before-last-apply`. Checks `signal.cancelled` even when there is no
 * wallpaper — cancel must abort Apply, not commit then continue.
 */
export async function snapshotBeforeLastApply(
  opts: {
    name: string;
    skin: ThemeSkinId;
    scrim: number;
    wallpaper: WallpaperRecord | null;
    onProgress?: (sent: number, total: number) => void;
    signal?: { cancelled: boolean };
  },
  io: UndoSnapshotIo = hostUndoSnapshotIo,
): Promise<{ ok: true } | { ok: false; code: "cancelled" | "disk_budget" | "invalid_pack" }> {
  if (isCancelled(opts.signal)) return { ok: false, code: "cancelled" };
  let id: string | null = null;
  try {
    id = await io.prepare();
    if (isCancelled(opts.signal)) {
      await io.abort(id).catch(() => undefined);
      return { ok: false, code: "cancelled" };
    }
    if (opts.wallpaper?.blob) {
      await uploadBlob(
        opts.wallpaper.blob,
        (b64) => io.append(id!, b64),
        opts.onProgress,
        opts.signal,
      );
    }
    if (isCancelled(opts.signal)) {
      await io.abort(id).catch(() => undefined);
      return { ok: false, code: "cancelled" };
    }
    const manifest = currentLookManifest({
      name: opts.name,
      skin: opts.skin,
      scrim: opts.scrim,
      wallpaper: opts.wallpaper,
    });
    await io.commit(id, manifest);
    if (isCancelled(opts.signal)) {
      // Commit raced with cancel: still report cancelled so Apply stops.
      return { ok: false, code: "cancelled" };
    }
    return { ok: true };
  } catch (e) {
    if (id) await io.abort(id).catch(() => undefined);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("cancelled") || isCancelled(opts.signal)) {
      return { ok: false, code: "cancelled" };
    }
    if (msg.startsWith("disk_budget")) return { ok: false, code: "disk_budget" };
    return { ok: false, code: "invalid_pack" };
  }
}

/**
 * Preview Cancel: while Apply is in flight only flip the abort flag.
 * Dismissing the modal during snapshot would hide a still-running Apply
 * (silent apply). Idle Cancel still closes the preview.
 */
export function onSkinPreviewCancel(
  applying: boolean,
  signal: { cancelled: boolean },
): { dismiss: boolean } {
  signal.cancelled = true;
  return { dismiss: !applying };
}

/**
 * Appearance skin pack (`.grokskin`) — types, manifest validation, export helpers.
 *
 * Host ZIP inspect is authoritative for on-disk packs. This module is the
 * shared field contract used by export, preview, and Apply orchestration.
 */

import {
  DEFAULT_SKIN,
  DEFAULT_WALLPAPER_SCRIM,
  isThemeSkinId,
  parseWallpaperScrim,
  type ThemeSkinId,
  type WallpaperClip,
  type WallpaperFocus,
  type WallpaperKind,
  type WallpaperRecord,
} from "./themeSkin";
import { DEFAULT_WALLPAPER_FOCUS, normalizeWallpaperFocus } from "./wallpaperFocus";
import { parseWallpaperClip } from "./wallpaperClip";
import type { ThemePreference } from "./theme";

export const SKIN_PACK_SCHEMA_VERSION = 1;
export const SKIN_PACK_EXT = "grokskin";
export const SKIN_PACK_ZIP_COMMENT = "GROKSKIN/1";
export const SKIN_PACK_NAME_MAX = 80;
export const SKIN_PACK_DESC_MAX = 500;
export const SKIN_PACK_AUTHOR_MAX = 80;
export const SKIN_PACK_ID_MAX = 64;

export type SkinPackWarningCode = "unknown_skin" | "will_clear_wallpaper";

export type SkinPackErrorCode =
  | "invalid_pack"
  | "unsupported_schema"
  | "too_large"
  | "hash_mismatch"
  | "network"
  | "cancelled"
  | "url_blocked"
  | "preset_limit"
  | "disk_budget"
  | "official_unconfigured"
  | "source_disabled"
  | "not_found"
  | "busy"
  | "desktop_only";

export type SkinPackSource = "file" | "preset" | "catalog" | "deeplink";

export type SkinPackWallpaperPreview = {
  path: string;
  kind: WallpaperKind;
  mime: string;
  name: string;
  bytes: number;
  width?: number;
  height?: number;
  focus?: WallpaperFocus;
  clip?: WallpaperClip | null;
};

export type SkinPackPreview = {
  id: string;
  sourceId: string | null;
  name: string;
  description: string;
  author: string;
  createdAt: number;
  skin: ThemeSkinId;
  requestedSkin: string;
  scrim: number;
  themePreference: ThemePreference | null;
  wallpaper: SkinPackWallpaperPreview | null;
  previewPath: string | null;
  warnings: SkinPackWarningCode[];
  source: SkinPackSource;
};

export type SkinPackWallpaperManifest = {
  file: string;
  kind: WallpaperKind;
  mime: string;
  name: string;
  width?: number;
  height?: number;
  sha256: string;
  focus?: WallpaperFocus;
  clip?: WallpaperClip | null;
};

export type SkinPackManifest = {
  schemaVersion: number;
  id?: string;
  sourceId?: string;
  name: string;
  description?: string;
  author?: string;
  createdAt?: number;
  skin: string;
  scrim?: number;
  /** Forward-compat only. App export never writes this; import ignores it. */
  themePreference?: ThemePreference;
  wallpaper?: SkinPackWallpaperManifest | null;
};

export type ValidateManifestOk = {
  ok: true;
  manifest: SkinPackManifest;
  skin: ThemeSkinId;
  requestedSkin: string;
  scrim: number;
  warnings: SkinPackWarningCode[];
};

export type ValidateManifestErr = {
  ok: false;
  code: SkinPackErrorCode;
};

const WALLPAPER_FILE_RE =
  /^assets\/wallpaper\.(jpg|jpeg|png|webp|gif|mp4|webm)$/;

const MIME_BY_EXT: Record<string, { kind: WallpaperKind; mime: string }> = {
  jpg: { kind: "image", mime: "image/jpeg" },
  jpeg: { kind: "image", mime: "image/jpeg" },
  png: { kind: "image", mime: "image/png" },
  webp: { kind: "image", mime: "image/webp" },
  gif: { kind: "image", mime: "image/gif" },
  mp4: { kind: "video", mime: "video/mp4" },
  webm: { kind: "video", mime: "video/webm" },
};

const SHA256_RE = /^[0-9a-f]{64}$/;
const PACK_ID_RE = /^[a-z0-9-]{1,64}$/;
const FORBIDDEN_MANIFEST_KEYS = ["tokens", "style", "css"] as const;

export function wallpaperExtOfFile(file: string): string | null {
  const m = file.toLowerCase().match(WALLPAPER_FILE_RE);
  return m ? m[1]! : null;
}

export function mimeForWallpaperExt(
  ext: string,
): { kind: WallpaperKind; mime: string } | null {
  return MIME_BY_EXT[ext.toLowerCase()] ?? null;
}

function stripControls(s: string): string {
  return [...s].filter((ch) => {
    const c = ch.codePointAt(0) ?? 0;
    return c >= 0x20 && c !== 0x7f;
  }).join("");
}

export function sanitizePackName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = stripControls(raw).trim();
  if (!trimmed) return null;
  const graphemes = [...trimmed];
  if (graphemes.length < 1 || graphemes.length > SKIN_PACK_NAME_MAX) return null;
  return graphemes.join("");
}

export function sanitizeOptionalText(
  raw: unknown,
  max: number,
): string {
  if (typeof raw !== "string") return "";
  const trimmed = stripControls(raw).trim();
  if (!trimmed) return "";
  return [...trimmed].slice(0, max).join("");
}

export function sanitizeExportFileStem(name: string): string {
  const mapped = name
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  const cut = mapped.slice(0, 60);
  return cut || "skin";
}

export function exportFileName(name: string): string {
  return `${sanitizeExportFileStem(name)}.${SKIN_PACK_EXT}`;
}

export function isEmptyDefaultLook(s: {
  skin: ThemeSkinId;
  wallpaperRecord: WallpaperRecord | null;
  wallpaperScrim: number;
}): boolean {
  return (
    s.skin === DEFAULT_SKIN &&
    s.wallpaperRecord == null &&
    parseWallpaperScrim(s.wallpaperScrim) === DEFAULT_WALLPAPER_SCRIM
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function parseSkinPackError(raw: unknown): {
  code: SkinPackErrorCode;
  detail: string;
} {
  const s = typeof raw === "string" ? raw : raw instanceof Error ? raw.message : String(raw);
  const idx = s.indexOf(":");
  const head = (idx >= 0 ? s.slice(0, idx) : s).trim();
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
  ];
  if ((known as string[]).includes(head)) {
    return { code: head as SkinPackErrorCode, detail: idx >= 0 ? s.slice(idx + 1).trim() : "" };
  }
  return { code: "invalid_pack", detail: s };
}

/**
 * Validate a parsed `manifest.json` object.
 * Does not read ZIP bytes — Host inspect still enforces container rules.
 */
export function validateSkinManifest(raw: unknown): ValidateManifestOk | ValidateManifestErr {
  if (!isRecord(raw)) return { ok: false, code: "invalid_pack" };

  for (const k of FORBIDDEN_MANIFEST_KEYS) {
    if (k in raw) return { ok: false, code: "unsupported_schema" };
  }

  const schemaVersion = raw.schemaVersion;
  if (schemaVersion !== SKIN_PACK_SCHEMA_VERSION) {
    return { ok: false, code: "unsupported_schema" };
  }

  const name = sanitizePackName(raw.name);
  if (!name) return { ok: false, code: "invalid_pack" };

  const requestedSkin = typeof raw.skin === "string" ? raw.skin : "";
  const warnings: SkinPackWarningCode[] = [];
  let skin: ThemeSkinId = DEFAULT_SKIN;
  if (isThemeSkinId(requestedSkin)) {
    skin = requestedSkin;
  } else {
    warnings.push("unknown_skin");
  }

  const scrim = parseWallpaperScrim(raw.scrim);
  const description = sanitizeOptionalText(raw.description, SKIN_PACK_DESC_MAX);
  const author = sanitizeOptionalText(raw.author, SKIN_PACK_AUTHOR_MAX);

  let id: string | undefined;
  if (typeof raw.id === "string") {
    const lid = raw.id.trim().toLowerCase();
    if (PACK_ID_RE.test(lid)) id = lid;
  }

  let sourceId: string | undefined;
  if (typeof raw.sourceId === "string") {
    const sid = raw.sourceId.trim();
    if (sid) sourceId = sid.slice(0, SKIN_PACK_ID_MAX);
  }

  let createdAt: number | undefined;
  if (typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) && raw.createdAt > 0) {
    createdAt = Math.round(raw.createdAt);
  }

  // themePreference is ignored on import; never required. Do not copy into
  // export payloads from this helper — callers that export current look omit it.
  void raw.themePreference;

  let wallpaper: SkinPackWallpaperManifest | null = null;
  if (raw.wallpaper == null) {
    warnings.push("will_clear_wallpaper");
  } else if (!isRecord(raw.wallpaper)) {
    return { ok: false, code: "invalid_pack" };
  } else {
    const w = raw.wallpaper;
    if (typeof w.file !== "string" || !WALLPAPER_FILE_RE.test(w.file.toLowerCase())) {
      return { ok: false, code: "invalid_pack" };
    }
    const ext = wallpaperExtOfFile(w.file.toLowerCase());
    const expected = ext ? mimeForWallpaperExt(ext) : null;
    if (!expected) return { ok: false, code: "invalid_pack" };
    if (w.kind !== expected.kind || w.mime !== expected.mime) {
      return { ok: false, code: "invalid_pack" };
    }
    if (w.mime === "image/svg+xml" || w.mime === "text/html") {
      return { ok: false, code: "invalid_pack" };
    }
    if (typeof w.sha256 !== "string" || !SHA256_RE.test(w.sha256.toLowerCase())) {
      return { ok: false, code: "invalid_pack" };
    }
    if (typeof w.name !== "string" || !w.name.trim()) {
      return { ok: false, code: "invalid_pack" };
    }
    const focus = w.focus
      ? normalizeWallpaperFocus(w.focus as Partial<WallpaperFocus>)
      : undefined;
    const clip =
      expected.kind === "video"
        ? parseWallpaperClip(w.clip)
        : null;
    wallpaper = {
      file: w.file.toLowerCase(),
      kind: expected.kind,
      mime: expected.mime,
      name: w.name.trim().slice(0, 200),
      sha256: w.sha256.toLowerCase(),
      width: typeof w.width === "number" && w.width > 0 ? Math.round(w.width) : undefined,
      height: typeof w.height === "number" && w.height > 0 ? Math.round(w.height) : undefined,
      focus,
      clip,
    };
  }

  return {
    ok: true,
    manifest: {
      schemaVersion: SKIN_PACK_SCHEMA_VERSION,
      id,
      sourceId,
      name,
      description,
      author,
      createdAt,
      skin: requestedSkin || skin,
      scrim,
      wallpaper,
    },
    skin,
    requestedSkin: requestedSkin || skin,
    scrim,
    warnings,
  };
}

/** Build a v1 export manifest. Never writes `themePreference`. */
export function buildExportManifest(input: {
  name: string;
  description?: string;
  author?: string;
  skin: ThemeSkinId;
  scrim: number;
  wallpaper?: SkinPackWallpaperManifest | null;
  id?: string;
}): SkinPackManifest {
  const name = sanitizePackName(input.name) ?? "skin";
  const out: SkinPackManifest = {
    schemaVersion: SKIN_PACK_SCHEMA_VERSION,
    name,
    skin: input.skin,
    scrim: parseWallpaperScrim(input.scrim),
  };
  if (input.id) out.id = input.id;
  if (input.description) out.description = sanitizeOptionalText(input.description, SKIN_PACK_DESC_MAX);
  if (input.author) out.author = sanitizeOptionalText(input.author, SKIN_PACK_AUTHOR_MAX);
  out.createdAt = Date.now();
  if (input.wallpaper) out.wallpaper = input.wallpaper;
  else out.wallpaper = null;
  return out;
}

export function keepWallpaperAllowed(
  source: SkinPackSource,
  wallpaper: SkinPackWallpaperPreview | null,
): boolean {
  return source === "file" && wallpaper == null;
}

export { DEFAULT_WALLPAPER_FOCUS };

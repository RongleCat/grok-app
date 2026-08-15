/**
 * First-party theme catalog constants.
 * Must stay in sync with `src-tauri/src/skin_catalog.rs`.
 */

export const OFFICIAL_SKIN_CATALOG_ID = "official";

/** Empty until a first-party catalog URL is filled in. */
export const OFFICIAL_SKIN_CATALOG_URL = "";

/**
 * Official catalog / pack / preview hosts.
 * Match if host == entry or host.endsWith('.' + entry).
 */
export const OFFICIAL_SKIN_DOWNLOAD_ORIGINS = [
  "github.com",
  "github.io",
  "githubusercontent.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
  "x.ai",
] as const;

export const SKIN_CATALOG_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const SKIN_CATALOG_JSON_MAX_BYTES = 512 * 1024;
export const SKIN_CATALOG_MAX_PACKS = 200;
export const SKIN_USER_SOURCE_LIMIT = 5;

export function officialCatalogConfigured(): boolean {
  return OFFICIAL_SKIN_CATALOG_URL.trim().length > 0;
}

export function hostMatchesOfficialOrigin(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (!h) return false;
  for (const e of OFFICIAL_SKIN_DOWNLOAD_ORIGINS) {
    if (h === e || h.endsWith(`.${e}`)) return true;
  }
  if (OFFICIAL_SKIN_CATALOG_URL) {
    try {
      const u = new URL(OFFICIAL_SKIN_CATALOG_URL);
      const oh = u.hostname.toLowerCase();
      if (h === oh || h.endsWith(`.${oh}`)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return (
      ua.protocol === ub.protocol &&
      ua.hostname.toLowerCase() === ub.hostname.toLowerCase() &&
      ua.port === ub.port
    );
  } catch {
    return false;
  }
}

export type CatalogPack = {
  id: string;
  name: string;
  description: string;
  author: string;
  previewUrl: string;
  downloadUrl: string;
  sha256: string;
  bytes: number;
  skin: string;
  hasWallpaper: boolean;
  kind?: "image" | "video";
  tags: string[];
};

export type SkinCatalogSource = {
  id: string;
  url: string;
  enabled: boolean;
  official: boolean;
  label: string;
};

/**
 * X Evidence citation honesty (lite) — wallpaper X gallery + optional local pick ring.
 *
 * Product truth:
 * - A wallpaper X result is **verified** only when it carries a canonical
 *   `x.com/…/status/<id>` (or twitter.com) status URL. CDN media alone never
 *   counts as a post citation.
 * - Missing / non-status post URLs are **unverified** (still showable as
 *   wallpaper, but never claimed as citable evidence).
 * - Empty search soft-fails (zero items + empty code) — never invent gallery
 *   tiles or fabricated status links.
 * - Local evidence ring stores path + url meta for wallpaper X picks only
 *   (localStorage; no cloud / no full MCP SaaS).
 *
 * Pure helpers — no DOM / Tauri side effects except optional storage adapters.
 */

// ── Citation resolve ─────────────────────────────────────────────────────────

/** Citation honesty for one X wallpaper (or chat X) result. */
export type XCitationState = "verified" | "unverified";

export type WallpaperXCitation = {
  state: XCitationState;
  /** Canonical status URL when verified. */
  statusUrl: string | null;
  /** Snowflake status id when extractable. */
  statusId: string | null;
  /** Primary i18n key for badge / meta. */
  labelKey: string;
  /** Hint i18n key (why unverified / open post). */
  hintKey: string;
};

/** Minimal gallery shape for citation (matches WallpaperGalleryItem fields). */
export type WallpaperXCitationInput = {
  postUrl?: string | null;
  username?: string | null;
  /** Optional free-form fields that may carry a status link. */
  textPreview?: string | null;
  fullUrl?: string | null;
  source?: string | null;
};

const STATUS_ID_MIN_LEN = 8;

/**
 * Extract a numeric X/Twitter status snowflake from a URL or bare id.
 * Real status ids are long digit runs; short runs are noise.
 */
export function extractXStatusId(urlOrId: string | null | undefined): string | null {
  if (urlOrId == null) return null;
  const raw = String(urlOrId).trim();
  if (!raw) return null;

  if (/^\d{8,}$/.test(raw)) return raw;

  const lower = raw.toLowerCase();
  if (!(lower.includes("x.com/") || lower.includes("twitter.com/"))) {
    return null;
  }
  const m = /\/status(?:es)?\/(\d{8,})/i.exec(raw);
  return m?.[1] ?? null;
}

/**
 * True when `url` is a real x.com / twitter.com status page URL
 * (not a CDN media URL, profile, or search page).
 */
export function isCanonicalXStatusUrl(url: string | null | undefined): boolean {
  if (url == null) return false;
  const u = String(url).trim();
  if (!u) return false;
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return false;
  }
  const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  if (host !== "x.com" && host !== "twitter.com" && host !== "mobile.twitter.com") {
    return false;
  }
  return extractXStatusId(u) != null;
}

/**
 * Normalize a status URL to `https://x.com/<user>/status/<id>` when possible.
 * Returns null when no status id can be confirmed (never invents ids).
 */
export function normalizeXStatusUrl(
  url: string | null | undefined,
  username?: string | null,
): string | null {
  if (url == null) return null;
  const trimmed = String(url).trim();
  if (!trimmed) return null;

  const statusId = extractXStatusId(trimmed);
  if (!statusId) return null;

  // Prefer handle from the URL path when present.
  let handle = "";
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (
      host === "x.com" ||
      host === "twitter.com" ||
      host === "mobile.twitter.com"
    ) {
      const segs = parsed.pathname.split("/").filter(Boolean);
      // /i/status/ID or /user/status/ID
      if (segs.length >= 2 && segs[0]?.toLowerCase() !== "i") {
        handle = segs[0].replace(/^@/, "");
      }
    }
  } catch {
    /* bare id or non-URL — fall through */
  }

  if (!handle && username) {
    handle = String(username).trim().replace(/^@/, "");
  }
  if (!handle) handle = "i";

  return `https://x.com/${encodeURIComponent(handle)}/status/${statusId}`;
}

/**
 * Resolve citation honesty for a wallpaper X gallery item (or similar).
 *
 * - source === "imagine" → always unverified (no X status; label is imagine path)
 * - canonical postUrl → verified
 * - otherwise unverified (CDN-only / missing / fabricated-looking non-status)
 */
export function resolveWallpaperXCitation(
  item: WallpaperXCitationInput | null | undefined,
): WallpaperXCitation {
  const source = String(item?.source ?? "")
    .trim()
    .toLowerCase();
  if (source === "imagine" || source === "library") {
    return {
      state: "unverified",
      statusUrl: null,
      statusId: null,
      labelKey: "settings.wallpaperSource.cite.notX",
      hintKey: "settings.wallpaperSource.cite.hint.notX",
    };
  }

  const candidates = [item?.postUrl, item?.textPreview, item?.fullUrl];
  for (const c of candidates) {
    if (!isCanonicalXStatusUrl(c)) continue;
    const statusUrl = normalizeXStatusUrl(c, item?.username);
    const statusId = extractXStatusId(c);
    if (statusUrl && statusId) {
      return {
        state: "verified",
        statusUrl,
        statusId,
        labelKey: "settings.wallpaperSource.cite.verified",
        hintKey: "settings.wallpaperSource.cite.hint.verified",
      };
    }
  }

  return {
    state: "unverified",
    statusUrl: null,
    statusId: extractXStatusId(item?.postUrl ?? null),
    labelKey: "settings.wallpaperSource.cite.unverified",
    hintKey: "settings.wallpaperSource.cite.hint.unverified",
  };
}

/** Count verified / unverified among X-sourced gallery items. */
export function countWallpaperXCitations(
  items: readonly WallpaperXCitationInput[],
): { total: number; verified: number; unverified: number } {
  let verified = 0;
  let unverified = 0;
  let total = 0;
  for (const it of items) {
    const src = String(it.source ?? "x")
      .trim()
      .toLowerCase();
    if (src !== "x" && src !== "") continue;
    total += 1;
    const c = resolveWallpaperXCitation({ ...it, source: "x" });
    if (c.state === "verified") verified += 1;
    else unverified += 1;
  }
  return { total, verified, unverified };
}

/**
 * Soft-fail summary for a completed X wallpaper search.
 * Returns null when there is nothing useful to surface (empty list handled elsewhere).
 */
export function wallpaperXSearchCitationSummaryKey(input: {
  itemCount: number;
  verified: number;
  unverified: number;
  errorCode?: string | null;
}): string | null {
  const n = Math.max(0, Math.floor(input.itemCount) || 0);
  if (n <= 0) {
    const code = (input.errorCode || "empty").toLowerCase();
    if (code === "empty" || code === "no_results" || !code) {
      return "settings.wallpaperSource.cite.summaryEmpty";
    }
    return null;
  }
  if (input.verified <= 0 && input.unverified > 0) {
    return "settings.wallpaperSource.cite.summaryAllUnverified";
  }
  if (input.unverified > 0) {
    return "settings.wallpaperSource.cite.summaryMixed";
  }
  return "settings.wallpaperSource.cite.summaryAllVerified";
}

// ── Local evidence ring (wallpaper X picks) ──────────────────────────────────

export type WallpaperXEvidencePick = {
  /** Local absolute path after download / apply. */
  path: string;
  /** Canonical status URL when verified; null when unverified. */
  postUrl: string | null;
  statusId: string | null;
  username: string | null;
  /** Original media CDN / file URL. */
  mediaUrl: string | null;
  verified: boolean;
  /** ISO-8601. */
  at: string;
};

export const WALLPAPER_X_EVIDENCE_STORAGE_KEY = "grok.wallpaperXEvidence";
export const WALLPAPER_X_EVIDENCE_MAX = 40;

/** Minimal storage surface so unit tests need no jsdom. */
export interface WallpaperXEvidenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): WallpaperXEvidenceStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/** Normalize one raw object into a pick, or null if invalid. */
export function parseWallpaperXEvidencePick(
  raw: unknown,
): WallpaperXEvidencePick | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const path = typeof o.path === "string" ? o.path.trim() : "";
  if (!path) return null;

  const postUrlRaw =
    typeof o.postUrl === "string"
      ? o.postUrl
      : typeof o.url === "string"
        ? o.url
        : null;
  const statusUrl = normalizeXStatusUrl(
    postUrlRaw,
    typeof o.username === "string" ? o.username : null,
  );
  const statusId =
    extractXStatusId(
      typeof o.statusId === "string" ? o.statusId : postUrlRaw,
    ) ?? null;
  const verified =
    typeof o.verified === "boolean"
      ? o.verified && statusUrl != null
      : statusUrl != null;

  const username =
    typeof o.username === "string" && o.username.trim()
      ? o.username.trim().replace(/^@/, "")
      : null;
  const mediaUrl =
    typeof o.mediaUrl === "string" && o.mediaUrl.trim()
      ? o.mediaUrl.trim()
      : typeof o.fullUrl === "string" && o.fullUrl.trim()
        ? o.fullUrl.trim()
        : null;
  const at =
    typeof o.at === "string" && o.at.trim()
      ? o.at.trim()
      : new Date(0).toISOString();

  return {
    path,
    postUrl: statusUrl,
    statusId,
    username,
    mediaUrl,
    verified: verified && statusUrl != null,
    at,
  };
}

/** Parse stored JSON into a clean newest-first list (capped). */
export function parseWallpaperXEvidenceRing(
  raw: unknown,
  max = WALLPAPER_X_EVIDENCE_MAX,
): WallpaperXEvidencePick[] {
  let list: unknown[] = [];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      return [];
    }
  } else if (Array.isArray(raw)) {
    list = raw;
  } else {
    return [];
  }

  const out: WallpaperXEvidencePick[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const e = parseWallpaperXEvidencePick(item);
    if (!e) continue;
    const key = e.path || e.postUrl || e.mediaUrl || "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Pure ring-buffer push: newest first, max length.
 * Dedupes by absolute path (primary key for wallpaper picks).
 */
export function pushWallpaperXEvidence(
  existing: readonly WallpaperXEvidencePick[],
  pick: WallpaperXEvidencePick,
  max = WALLPAPER_X_EVIDENCE_MAX,
): WallpaperXEvidencePick[] {
  const next = parseWallpaperXEvidencePick(pick);
  if (!next) return parseWallpaperXEvidenceRing(existing, max);

  const cleaned = parseWallpaperXEvidenceRing(existing, max).filter(
    (e) => e.path !== next.path,
  );

  return [next, ...cleaned].slice(0, max);
}

/** Build a pick from a gallery item + local path after apply/download. */
export function wallpaperXEvidenceFromGalleryItem(
  item: WallpaperXCitationInput & {
    localPath?: string | null;
    fullUrl?: string | null;
  },
  localPath: string,
  at: string = new Date().toISOString(),
): WallpaperXEvidencePick | null {
  const path = String(localPath || item.localPath || "").trim();
  if (!path) return null;
  const cite = resolveWallpaperXCitation(item);
  return {
    path,
    postUrl: cite.statusUrl,
    statusId: cite.statusId,
    username:
      typeof item.username === "string" && item.username.trim()
        ? item.username.trim().replace(/^@/, "")
        : null,
    mediaUrl:
      typeof item.fullUrl === "string" && item.fullUrl.trim()
        ? item.fullUrl.trim()
        : null,
    verified: cite.state === "verified",
    at,
  };
}

/** Read the local wallpaper X evidence ring. */
export function loadWallpaperXEvidenceRing(
  storage: WallpaperXEvidenceStorage = defaultStorage(),
  max = WALLPAPER_X_EVIDENCE_MAX,
): WallpaperXEvidencePick[] {
  return parseWallpaperXEvidenceRing(
    storage.getItem(WALLPAPER_X_EVIDENCE_STORAGE_KEY),
    max,
  );
}

/** Persist a new wallpaper X pick into the local ring (soft-fail on storage errors). */
export function recordWallpaperXEvidencePick(
  pick: WallpaperXEvidencePick,
  storage: WallpaperXEvidenceStorage = defaultStorage(),
  max = WALLPAPER_X_EVIDENCE_MAX,
): WallpaperXEvidencePick[] {
  let existing: WallpaperXEvidencePick[] = [];
  try {
    existing = loadWallpaperXEvidenceRing(storage, max);
  } catch {
    existing = [];
  }
  try {
    const next = pushWallpaperXEvidence(existing, pick, max);
    storage.setItem(WALLPAPER_X_EVIDENCE_STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    // Soft-fail: leave prior ring; never throw into UI apply path.
    return existing;
  }
}

// Re-export min length for tests (documentation only).
export const X_STATUS_ID_MIN_LEN = STATUS_ID_MIN_LEN;

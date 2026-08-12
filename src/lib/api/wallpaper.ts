/** API domain: wallpaper */

import {
  invoke,
} from "./host";

import type {
  WallpaperFetchResult,
  WallpaperLibraryEntry,
  WallpaperSearchResult,
} from "../wallpaperSource";
export type {
  WallpaperFetchResult,
  WallpaperGalleryItem,
  WallpaperLibraryEntry,
  WallpaperSearchResult,
} from "../wallpaperSource";

// ── Wallpaper sources (X search + Imagine) ──────────────────────────────────

export async function wallpaperXSearch(
  query: string,
  sort?: "top" | "latest",
): Promise<WallpaperSearchResult> {
  return invoke<WallpaperSearchResult>("wallpaper_x_search", {
    query,
    sort: sort ?? null,
  });
}

export async function wallpaperFetchMedia(
  url: string,
  source?: string,
): Promise<WallpaperFetchResult> {
  return invoke<WallpaperFetchResult>("wallpaper_fetch_media", {
    url,
    source: source ?? null,
  });
}

export async function wallpaperImagine(
  prompt: string,
  aspectRatio?: string,
): Promise<WallpaperSearchResult> {
  return invoke<WallpaperSearchResult>("wallpaper_imagine", {
    prompt,
    aspectRatio: aspectRatio ?? null,
  });
}

export async function wallpaperLibraryList(
  limit?: number,
): Promise<WallpaperLibraryEntry[]> {
  return invoke<WallpaperLibraryEntry[]>("wallpaper_library_list", {
    limit: limit ?? null,
  });
}

// ── X Evidence Rail (search → local evidence store → quote pack) ────────────
// Design: docs/features/x-search.md — every X search result becomes a local
// evidence row with a stable id; later turns list / re-read / quote it.

export interface XEvidenceItem {
  evidenceId: string;
  statusId?: string;
  url?: string;
  author?: string;
  text?: string;
  createdAt?: string;
  likes?: number;
  query?: string;
  sessionTag?: string;
  source: string;
  verified: boolean;
  fetchedAtMs: number;
}

export interface XSearchEnvelope {
  ok: boolean;
  errorCode?: string;
  message?: string;
  query: string;
  evidence: XEvidenceItem[];
  newCount: number;
  unverifiedCount: number;
}

export interface XEvidenceFilter {
  sessionTag?: string;
  queryContains?: string;
  author?: string;
  limit?: number;
}

export interface XQuotePack {
  markdown: string;
  path?: string;
  count: number;
}

export async function xEvidenceSearch(
  query: string,
  limit?: number,
  sessionTag?: string,
): Promise<XSearchEnvelope> {
  return invoke<XSearchEnvelope>("x_evidence_search", {
    query,
    limit: limit ?? null,
    sessionTag: sessionTag ?? null,
  });
}

export async function xEvidenceList(
  filter?: XEvidenceFilter,
): Promise<XEvidenceItem[]> {
  return invoke<XEvidenceItem[]>("x_evidence_list", {
    filter: filter ?? null,
  });
}

export async function xEvidenceGet(ids: string[]): Promise<XEvidenceItem[]> {
  return invoke<XEvidenceItem[]>("x_evidence_get", { ids });
}

export async function xQuotePack(
  ids: string[],
  title?: string,
): Promise<XQuotePack> {
  return invoke<XQuotePack>("x_quote_pack", { ids, title: title ?? null });
}

export interface XEvidenceStats {
  total: number;
  todayNew: number;
  weekPacks: number;
}

export async function xEvidenceStats(): Promise<XEvidenceStats> {
  return invoke<XEvidenceStats>("x_evidence_stats");
}

export async function wallpaperLibraryDelete(path: string): Promise<void> {
  await invoke<void>("wallpaper_library_delete", { path });
}


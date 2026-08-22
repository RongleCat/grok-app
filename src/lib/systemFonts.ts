/**
 * Installed UI font families for Settings → Appearance.
 * Host lists faces; Chromium `queryLocalFonts` is a browser-only fallback.
 */

import { isDesktopHost, listSystemFontFamilies } from "@/lib/api";
import { normalizeFontFamilyKey } from "@/lib/cssFontFamily";

/** CSS generic that is not an OS face but is a valid UI choice. */
export const CSS_GENERIC_UI_FAMILY = "system-ui";

export type FontSelectOption = { value: string; label: string };

type QueryLocalFonts = () => Promise<Array<{ family: string }>>;

let cached: Promise<string[]> | null = null;

export function normalizeInstalledFontFamilies(
  raw: readonly string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    for (const part of item.split(",")) {
      const name = part.trim();
      if (!name || name.startsWith(".") || name.startsWith("@")) continue;
      const key = normalizeFontFamilyKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return out;
}

async function queryBrowserFonts(): Promise<string[]> {
  const fn = (globalThis as { queryLocalFonts?: QueryLocalFonts })
    .queryLocalFonts;
  if (typeof fn !== "function") return [];
  try {
    const fonts = await fn();
    return fonts.map((f) => f.family);
  } catch {
    return [];
  }
}

async function loadInstalledFontFamiliesUncached(): Promise<string[]> {
  let raw: string[] = [];
  if (isDesktopHost()) {
    try {
      const listed = await listSystemFontFamilies();
      if (Array.isArray(listed)) raw = listed;
    } catch {
      raw = [];
    }
  }
  if (raw.length === 0) raw = await queryBrowserFonts();
  return normalizeInstalledFontFamilies(raw);
}

export function loadInstalledFontFamilies(): Promise<string[]> {
  if (!cached) cached = loadInstalledFontFamiliesUncached();
  return cached;
}

export function filterFontFamilies(
  families: readonly string[],
  query: string,
): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...families];
  return families.filter((f) => f.toLowerCase().includes(q));
}

function matchesQuery(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || name.toLowerCase().includes(q);
}

/** CSS generic used for the built-in terminal picker. */
export const CSS_GENERIC_MONO_FAMILY = "ui-monospace";

/** Default + optional leftover current value + generic + installed (filtered). */
export function fontSelectOptions(args: {
  families: readonly string[];
  query: string;
  current: string;
  defaultLabel: string;
  /** Extra CSS generic (system-ui / ui-monospace). Empty skips it. */
  genericFamily?: string | null;
}): FontSelectOption[] {
  const filtered = filterFontFamilies(args.families, args.query);
  const options: FontSelectOption[] = [
    { value: "", label: args.defaultLabel },
  ];
  const seen = new Set<string>([""]);
  const generic =
    args.genericFamily === undefined
      ? CSS_GENERIC_UI_FAMILY
      : args.genericFamily?.trim() || null;

  if (generic && matchesQuery(generic, args.query)) {
    options.push({
      value: generic,
      label: generic,
    });
    seen.add(normalizeFontFamilyKey(generic));
  }

  const current = args.current.trim();
  if (current) {
    const key = normalizeFontFamilyKey(current);
    const inFiltered = filtered.some(
      (f) => normalizeFontFamilyKey(f) === key,
    );
    if (!inFiltered && !seen.has(key) && matchesQuery(current, args.query)) {
      options.push({ value: current, label: current });
      seen.add(key);
    }
  }

  for (const family of filtered) {
    const key = normalizeFontFamilyKey(family);
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ value: family, label: family });
  }
  return options;
}

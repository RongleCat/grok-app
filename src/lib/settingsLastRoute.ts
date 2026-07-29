/**
 * Remember last Settings section + tab so generic "open Settings"
 * (⌘,, gear, slash /settings, tray Settings…) restores that place.
 *
 * localStorage-only — no Rust AppSettings.
 * Explicit deep links (`#/settings/{section}[/{tab}]`) always win.
 */

import {
  isSettingsSectionId,
  resolveTab,
  type SettingsSectionId,
  type SettingsTabId,
} from "./settingsCatalog";

export const SETTINGS_LAST_ROUTE_STORAGE_KEY = "grok.settingsLastRoute";

export type SettingsLastRoute = {
  section: SettingsSectionId;
  tab: SettingsTabId | null;
};

export interface SettingsLastRouteStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const noopStorage: SettingsLastRouteStorage = {
  getItem: () => null,
  setItem: () => {},
};

function defaultStorage(): SettingsLastRouteStorage {
  return typeof localStorage !== "undefined" ? localStorage : noopStorage;
}

/**
 * Parse stored JSON. Invalid / unknown section → null.
 * Unknown tab falls back via resolveTab (default tab or null).
 */
export function parseSettingsLastRoute(raw: unknown): SettingsLastRoute | null {
  if (raw == null || raw === "") return null;
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const section = (obj as { section?: unknown }).section;
  if (typeof section !== "string" || !isSettingsSectionId(section)) {
    return null;
  }
  const tabRaw = (obj as { tab?: unknown }).tab;
  const tab =
    typeof tabRaw === "string" || tabRaw === null || tabRaw === undefined
      ? resolveTab(section, tabRaw as string | null | undefined)
      : resolveTab(section, null);
  return { section, tab };
}

export function loadSettingsLastRoute(
  storage: SettingsLastRouteStorage = defaultStorage(),
): SettingsLastRoute | null {
  try {
    return parseSettingsLastRoute(
      storage.getItem(SETTINGS_LAST_ROUTE_STORAGE_KEY),
    );
  } catch {
    return null;
  }
}

/**
 * Persist a validated route. Unknown section is ignored (no write).
 * Tab is always resolved so storage stays canonical.
 */
export function saveSettingsLastRoute(
  route: { section: SettingsSectionId; tab?: SettingsTabId | string | null },
  storage: SettingsLastRouteStorage = defaultStorage(),
): void {
  if (!isSettingsSectionId(route.section)) return;
  const tab = resolveTab(route.section, route.tab);
  const payload: SettingsLastRoute = { section: route.section, tab };
  try {
    storage.setItem(SETTINGS_LAST_ROUTE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* private mode / quota */
  }
}

/**
 * Resolve where to open Settings.
 *
 * - Explicit `section` (deep link / palette / account) always wins.
 * - Otherwise use last route when section id is valid.
 * - Else general + default tab.
 */
export function resolveOpenSettingsLocation(opts: {
  /** Explicit target; omit / null / undefined → try last. */
  section?: SettingsSectionId | string | null;
  tab?: string | null;
  last?: SettingsLastRoute | null;
}): SettingsLastRoute {
  const explicit = opts.section;
  if (typeof explicit === "string" && isSettingsSectionId(explicit)) {
    return {
      section: explicit,
      tab: resolveTab(explicit, opts.tab),
    };
  }
  const last = opts.last ?? null;
  if (last && isSettingsSectionId(last.section)) {
    return {
      section: last.section,
      tab: resolveTab(last.section, last.tab ?? opts.tab),
    };
  }
  return {
    section: "general",
    tab: resolveTab("general", opts.tab),
  };
}

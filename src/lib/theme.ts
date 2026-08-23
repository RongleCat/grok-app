/**
 * Theme preference + resolved light/dark for the document.
 * Preference is durable (`system` | `light` | `dark`); DOM always gets a
 * concrete `data-theme="light|dark"`. Default preference is follow system.
 */

import { detectAppPlatform, type AppPlatform } from "./appPlatform";

export type Theme = "dark" | "light";
/** User-facing choice including follow-OS. */
export type ThemePreference = "system" | Theme;

/** Host → frontend when Windows `AppsUseLightTheme` flips. */
export const OS_THEME_CHANGED_EVENT = "os-theme://changed";

export const THEME_STORAGE_KEY = "grok-app.theme";
/** Fallback when OS scheme cannot be read (tests / SSR). */
export const DEFAULT_RESOLVED_THEME: Theme = "dark";
/** New installs / empty storage → follow system. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

/** @deprecated Use DEFAULT_THEME_PREFERENCE; kept for call sites that mean "fallback resolved". */
export const DEFAULT_THEME: Theme = DEFAULT_RESOLVED_THEME;

export function isTheme(value: unknown): value is Theme {
  return value === "dark" || value === "light";
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || isTheme(value);
}

/** Parse a stored preference; invalid / empty → system. */
export function parseThemePreference(raw: unknown): ThemePreference {
  if (typeof raw === "string" && isThemePreference(raw)) return raw;
  return DEFAULT_THEME_PREFERENCE;
}

/**
 * Parse a stored value as a concrete theme (legacy).
 * Empty → resolved system theme (or DEFAULT_RESOLVED_THEME without window).
 */
export function parseTheme(raw: unknown): Theme {
  if (typeof raw === "string" && isTheme(raw)) return raw;
  if (raw === "system" || raw == null || raw === "") {
    return getSystemTheme();
  }
  return DEFAULT_RESOLVED_THEME;
}

/** Read OS light/dark. Safe outside the browser. */
export function getSystemTheme(
  matchMedia: ((query: string) => MediaQueryList) | null = typeof window !==
  "undefined"
    ? window.matchMedia.bind(window)
    : null,
): Theme {
  try {
    if (!matchMedia) return DEFAULT_RESOLVED_THEME;
    return matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } catch {
    return DEFAULT_RESOLVED_THEME;
  }
}

/** Map preference → concrete theme applied to the document. */
export function resolveTheme(
  preference: ThemePreference,
  systemTheme: Theme = getSystemTheme(),
): Theme {
  if (preference === "system") return systemTheme;
  return preference;
}

export function toggleTheme(current: Theme): Theme {
  return current === "dark" ? "light" : "dark";
}

/**
 * Quick-toggle from the user menu: always land on an explicit light/dark
 * (leaves "system" mode so the click has an obvious effect).
 */
export function toggleThemePreference(
  _preference: ThemePreference,
  resolved: Theme,
): ThemePreference {
  return toggleTheme(resolved);
}

/** Apply theme to documentElement (data-theme attribute). */
export function applyThemeToDocument(
  theme: Theme,
  root: HTMLElement = document.documentElement,
): void {
  root.setAttribute("data-theme", theme);
}

let themeTransitionGeneration = 0;
let activeThemeTransition: ViewTransition | null = null;

/** Run one user-triggered theme update inside the native page cross-fade. */
export function runThemeTransition(
  update: () => void,
  doc: Document = document,
): void {
  const generation = ++themeTransitionGeneration;
  activeThemeTransition?.skipTransition();
  activeThemeTransition = null;
  delete doc.documentElement.dataset.themeTransition;

  let reduceMotion = false;
  try {
    reduceMotion =
      doc.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches ??
      false;
  } catch {
    /* restricted / test window */
  }

  const commit = () => {
    if (generation === themeTransitionGeneration) update();
  };
  const userAgent = doc.defaultView?.navigator?.userAgent ?? "";
  // WebKit bug 302256 drops backdrop-filter for the whole snapshot animation.
  const webKitDropsGlass =
    /AppleWebKit/i.test(userAgent) &&
    !/(Chrome|Chromium|CriOS|Edg)/i.test(userAgent);
  if (
    reduceMotion ||
    webKitDropsGlass ||
    doc.visibilityState === "hidden" ||
    typeof doc.startViewTransition !== "function"
  ) {
    commit();
    return;
  }

  doc.documentElement.dataset.themeTransition = "1";
  const transition = doc.startViewTransition(commit);
  activeThemeTransition = transition;
  const cleanup = () => {
    if (activeThemeTransition !== transition) return;
    activeThemeTransition = null;
    delete doc.documentElement.dataset.themeTransition;
  };
  void transition.finished.then(cleanup, cleanup);
}

/**
 * Native chrome lock vs Auto when the user follows the OS.
 *
 * macOS / Linux: `null` (Auto) so WKWebView matchMedia + Tauri theme-changed
 * stay live. Windows WebView2: Auto after a boot lock does not fire
 * `prefers-color-scheme` changes — push the resolved theme instead; the host
 * watches `AppsUseLightTheme` and the frontend re-applies.
 */
export function nativeWindowThemeArg(
  preference: ThemePreference,
  scheduleEnabled: boolean,
  resolved: Theme,
  platform: AppPlatform,
): Theme | null {
  if (preference === "system" && !scheduleEnabled && platform !== "win") {
    return null;
  }
  return resolved;
}

/** Host event / command payload → concrete theme. */
export function parseOsThemePayload(raw: unknown): Theme | null {
  if (raw === "light" || raw === "dark") return raw;
  if (raw && typeof raw === "object" && "theme" in raw) {
    const theme = (raw as { theme: unknown }).theme;
    if (theme === "light" || theme === "dark") return theme;
  }
  return null;
}

/** Authoritative OS theme: Host probe, then matchMedia. */
export async function readOsTheme(
  hostRead?: () => Promise<unknown>,
): Promise<Theme> {
  try {
    const read =
      hostRead ??
      (async () => {
        const { isDesktopHost, invoke } = await import("@/lib/api/host");
        if (!isDesktopHost()) return null;
        return invoke<string>("os_theme_current");
      });
    const parsed = parseOsThemePayload(await read());
    if (parsed) return parsed;
  } catch {
    /* browser / older host */
  }
  return getSystemTheme();
}

/**
 * Sync Tauri / macOS native chrome (NSAppearance + vibrancy) with app theme.
 * Without this, light UI still sits on dark Sidebar vibrancy → dirty gray rail + black edges.
 *
 * Pass `null` to **follow the OS** (required for live system switching on
 * macOS — locking light/dark freezes `prefers-color-scheme` inside the WebView).
 * On Windows, pass the concrete theme (see `nativeWindowThemeArg`).
 * No-op outside Tauri.
 */
export async function applyNativeWindowTheme(
  theme: Theme | null,
): Promise<void> {
  try {
    const isTauri =
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
    if (!isTauri) return;
    const { setTheme } = await import("@tauri-apps/api/app");
    // Tauri: null/undefined = follow system theme
    await setTheme(theme);
  } catch {
    /* permissions / older runtime — CSS still applies */
  }
}

/**
 * Apply preference end-to-end: unlock/lock native chrome, resolve system if
 * needed, write `data-theme`. Host probe wins over matchMedia on Windows.
 */
export async function applyThemePreference(
  preference: ThemePreference,
  options?: {
    /** Called with the concrete theme after resolve (for React state). */
    onResolved?: (resolved: Theme, system: Theme) => void;
  },
): Promise<Theme> {
  if (preference === "system") {
    const system = await readOsTheme();
    applyThemeToDocument(system);
    await applyNativeWindowTheme(
      nativeWindowThemeArg("system", false, system, detectAppPlatform()),
    );
    options?.onResolved?.(system, system);
    return system;
  }
  applyThemeToDocument(preference);
  await applyNativeWindowTheme(preference);
  options?.onResolved?.(preference, getSystemTheme());
  return preference;
}

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Read persisted preference (system | light | dark). */
export function loadThemePreference(storage: ThemeStorage): ThemePreference {
  try {
    return parseThemePreference(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

/** Persist preference (including "system"). */
export function saveThemePreference(
  storage: ThemeStorage,
  preference: ThemePreference,
): void {
  storage.setItem(THEME_STORAGE_KEY, preference);
}

/**
 * Read preference and resolve to concrete theme for first paint.
 * Prefer loadThemePreference + resolveTheme when preference is needed in UI.
 */
export function loadTheme(storage: ThemeStorage): Theme {
  return resolveTheme(loadThemePreference(storage));
}

/** Persist a concrete theme (legacy helper; prefer saveThemePreference). */
export function saveTheme(storage: ThemeStorage, theme: Theme): void {
  storage.setItem(THEME_STORAGE_KEY, theme);
}

/** Full switch: compute next concrete theme, persist as explicit light/dark, apply DOM. */
export function switchTheme(
  current: Theme,
  storage: ThemeStorage,
  root?: HTMLElement,
): Theme {
  const next = toggleTheme(current);
  saveThemePreference(storage, next);
  if (typeof document !== "undefined" || root) {
    applyThemeToDocument(next, root ?? document.documentElement);
  }
  return next;
}

/**
 * Subscribe to OS scheme changes. Returns unsubscribe.
 * No-op when matchMedia is unavailable.
 */
export function subscribeSystemTheme(
  onChange: (systemTheme: Theme) => void,
  matchMedia: ((query: string) => MediaQueryList) | null = typeof window !==
  "undefined"
    ? window.matchMedia.bind(window)
    : null,
): () => void {
  if (!matchMedia) return () => {};
  let mql: MediaQueryList;
  try {
    mql = matchMedia("(prefers-color-scheme: dark)");
  } catch {
    return () => {};
  }
  const handler = () => {
    onChange(mql.matches ? "dark" : "light");
  };
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }
  // Safari < 14
  const legacy = mql as MediaQueryList & {
    addListener?: (cb: () => void) => void;
    removeListener?: (cb: () => void) => void;
  };
  legacy.addListener?.(handler);
  return () => legacy.removeListener?.(handler);
}

/**
 * Host OS-theme event (+ Tauri window theme-changed when not injecting listen).
 * WebView2 matchMedia often stays frozen; this is the live path on Windows.
 */
export async function subscribeHostOsTheme(
  onChange: (systemTheme: Theme) => void,
  listenFn?: (
    event: string,
    handler: (payload: unknown) => void,
  ) => Promise<() => void>,
): Promise<() => void> {
  const listen =
    listenFn ??
    (async (event, handler) => {
      const { listen: hostListen } = await import("@/lib/api/host");
      return hostListen<unknown>(event, handler);
    });
  const unsubs: Array<() => void> = [];
  unsubs.push(
    await listen(OS_THEME_CHANGED_EVENT, (payload) => {
      const theme = parseOsThemePayload(payload);
      if (theme) onChange(theme);
    }),
  );
  if (!listenFn) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      unsubs.push(
        await getCurrentWindow().onThemeChanged(({ payload }) => {
          if (payload === "light" || payload === "dark") onChange(payload);
        }),
      );
    } catch {
      /* browser / older runtime */
    }
  }
  return () => {
    for (const unsub of unsubs) unsub();
  };
}

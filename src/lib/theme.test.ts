import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RESOLVED_THEME,
  DEFAULT_THEME_PREFERENCE,
  getSystemTheme,
  loadTheme,
  loadThemePreference,
  nativeWindowThemeArg,
  OS_THEME_CHANGED_EVENT,
  parseOsThemePayload,
  parseTheme,
  parseThemePreference,
  readOsTheme,
  resolveTheme,
  saveTheme,
  saveThemePreference,
  subscribeHostOsTheme,
  subscribeSystemTheme,
  switchTheme,
  THEME_STORAGE_KEY,
  toggleTheme,
  toggleThemePreference,
  type ThemeStorage,
} from "./theme";

function memoryStorage(initial: Record<string, string> = {}): ThemeStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return key in data ? data[key]! : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
  };
}

describe("theme preference + resolve", () => {
  it("defaults preference to system", () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
    expect(parseThemePreference("nope")).toBe("system");
    expect(parseThemePreference("system")).toBe("system");
  });

  it("keeps explicit light/dark preferences", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
  });

  it("resolves system to the given OS theme", () => {
    expect(resolveTheme("system", "light")).toBe("light");
    expect(resolveTheme("system", "dark")).toBe("dark");
    expect(resolveTheme("light", "dark")).toBe("light");
    expect(resolveTheme("dark", "light")).toBe("dark");
  });

  it("getSystemTheme reads matchMedia when provided", () => {
    const darkMq = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    const lightMq = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    expect(getSystemTheme(() => darkMq)).toBe("dark");
    expect(getSystemTheme(() => lightMq)).toBe("light");
    expect(getSystemTheme(null)).toBe(DEFAULT_RESOLVED_THEME);
  });

  it("toggles dark ↔ light", () => {
    expect(toggleTheme("dark")).toBe("light");
    expect(toggleTheme("light")).toBe("dark");
  });

  it("quick toggle leaves system and flips resolved", () => {
    expect(toggleThemePreference("system", "dark")).toBe("light");
    expect(toggleThemePreference("system", "light")).toBe("dark");
    expect(toggleThemePreference("dark", "dark")).toBe("light");
  });

  it("empty storage loads preference system and resolves", () => {
    const storage = memoryStorage();
    expect(loadThemePreference(storage)).toBe("system");
    // Without window matchMedia in node, resolve uses DEFAULT_RESOLVED_THEME
    expect(loadTheme(storage)).toBe(DEFAULT_RESOLVED_THEME);
  });

  it("migrates legacy light/dark storage", () => {
    const storage = memoryStorage({ [THEME_STORAGE_KEY]: "light" });
    expect(loadThemePreference(storage)).toBe("light");
    expect(loadTheme(storage)).toBe("light");
  });

  it("persists system preference", () => {
    const storage = memoryStorage();
    saveThemePreference(storage, "system");
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("system");
    expect(loadThemePreference(storage)).toBe("system");
  });

  it("switchTheme persists explicit light/dark", () => {
    const storage = memoryStorage();
    const after = switchTheme("dark", storage);
    expect(after).toBe("light");
    expect(storage.data[THEME_STORAGE_KEY]).toBe("light");
    expect(loadTheme(storage)).toBe("light");
  });

  it("saveTheme writes the storage key used by the UI", () => {
    const storage = memoryStorage();
    saveTheme(storage, "light");
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("subscribeSystemTheme fires on change", () => {
    const listeners = new Set<() => void>();
    const mql = {
      matches: true,
      addEventListener: (_: string, cb: () => void) => {
        listeners.add(cb);
      },
      removeEventListener: (_: string, cb: () => void) => {
        listeners.delete(cb);
      },
    } as unknown as MediaQueryList;
    const seen: string[] = [];
    const unsub = subscribeSystemTheme((t) => seen.push(t), () => mql);
    // flip
    (mql as { matches: boolean }).matches = false;
    for (const cb of listeners) cb();
    expect(seen).toEqual(["light"]);
    unsub();
    expect(listeners.size).toBe(0);
  });

  it("parseTheme still accepts concrete themes", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
  });

  it("resolveTheme(system) uses latest system argument (switch-to-system path)", () => {
    // After unlock, caller passes freshly read OS theme — must win over stale state.
    expect(resolveTheme("system", "dark")).toBe("dark");
    expect(resolveTheme("system", "light")).toBe("light");
  });

  it("Windows follow-system locks native chrome to the resolved theme", () => {
    // WebView2 matchMedia does not live-update after boot lock — push concrete.
    expect(nativeWindowThemeArg("system", false, "light", "win")).toBe("light");
    expect(nativeWindowThemeArg("system", false, "dark", "win")).toBe("dark");
    expect(nativeWindowThemeArg("system", false, "dark", "mac")).toBeNull();
    expect(nativeWindowThemeArg("system", false, "light", "linux")).toBeNull();
    expect(nativeWindowThemeArg("system", true, "light", "mac")).toBe("light");
    expect(nativeWindowThemeArg("dark", false, "dark", "win")).toBe("dark");
    expect(nativeWindowThemeArg("light", false, "light", "mac")).toBe("light");
  });

  it("parseOsThemePayload accepts command strings and host events", () => {
    expect(parseOsThemePayload("light")).toBe("light");
    expect(parseOsThemePayload("dark")).toBe("dark");
    expect(parseOsThemePayload({ theme: "light" })).toBe("light");
    expect(parseOsThemePayload({ theme: "nope" })).toBeNull();
    expect(parseOsThemePayload(null)).toBeNull();
  });

  it("readOsTheme prefers a host probe over matchMedia", async () => {
    await expect(readOsTheme(async () => ({ theme: "light" }))).resolves.toBe(
      "light",
    );
    await expect(readOsTheme(async () => "dark")).resolves.toBe("dark");
  });

  it("subscribeHostOsTheme forwards parsed host payloads", async () => {
    const listeners = new Map<string, (p: unknown) => void>();
    const listen = async (event: string, handler: (p: unknown) => void) => {
      listeners.set(event, handler);
      return () => {
        listeners.delete(event);
      };
    };
    const seen: string[] = [];
    const unsub = await subscribeHostOsTheme((t) => seen.push(t), listen);
    listeners.get(OS_THEME_CHANGED_EVENT)?.({ theme: "light" });
    expect(seen).toEqual(["light"]);
    unsub();
    expect(listeners.size).toBe(0);
  });
});

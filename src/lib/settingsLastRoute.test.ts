import { describe, expect, it } from "vitest";
import {
  SETTINGS_LAST_ROUTE_STORAGE_KEY,
  loadSettingsLastRoute,
  parseSettingsLastRoute,
  resolveOpenSettingsLocation,
  saveSettingsLastRoute,
  type SettingsLastRouteStorage,
} from "./settingsLastRoute";

function memoryStorage(
  initial: Record<string, string> = {},
): SettingsLastRouteStorage & { data: Record<string, string> } {
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

describe("settingsLastRoute", () => {
  it("parse rejects empty / invalid / unknown section", () => {
    expect(parseSettingsLastRoute(null)).toBeNull();
    expect(parseSettingsLastRoute("")).toBeNull();
    expect(parseSettingsLastRoute("not-json")).toBeNull();
    expect(parseSettingsLastRoute("{}")).toBeNull();
    expect(parseSettingsLastRoute({ section: "nope" })).toBeNull();
    expect(parseSettingsLastRoute({ section: 1 })).toBeNull();
  });

  it("parse accepts valid section and resolves tab", () => {
    expect(
      parseSettingsLastRoute({ section: "runtime", tab: "tools" }),
    ).toEqual({ section: "runtime", tab: "tools" });
    expect(parseSettingsLastRoute({ section: "about" })).toEqual({
      section: "about",
      tab: null,
    });
    // unknown tab → default for section
    expect(
      parseSettingsLastRoute({ section: "extensions", tab: "not-a-tab" }),
    ).toEqual({ section: "extensions", tab: "plugins" });
    expect(
      parseSettingsLastRoute(
        JSON.stringify({ section: "appearance", tab: "interface" }),
      ),
    ).toEqual({ section: "appearance", tab: "interface" });
  });

  it("load / save round-trip and ignores bad section on save", () => {
    const storage = memoryStorage();
    expect(loadSettingsLastRoute(storage)).toBeNull();

    saveSettingsLastRoute({ section: "remote_im", tab: "mirror" }, storage);
    expect(storage.data[SETTINGS_LAST_ROUTE_STORAGE_KEY]).toBe(
      JSON.stringify({ section: "remote_im", tab: "mirror" }),
    );
    expect(loadSettingsLastRoute(storage)).toEqual({
      section: "remote_im",
      tab: "mirror",
    });

    saveSettingsLastRoute({ section: "shortcuts" }, storage);
    expect(loadSettingsLastRoute(storage)).toEqual({
      section: "shortcuts",
      tab: null,
    });

    // Invalid section must not clobber storage (type-guard is runtime for safety).
    saveSettingsLastRoute(
      { section: "bogus" as "general", tab: "composer" },
      storage,
    );
    expect(loadSettingsLastRoute(storage)).toEqual({
      section: "shortcuts",
      tab: null,
    });
  });

  it("resolveOpenSettingsLocation: explicit wins over last", () => {
    const last = { section: "runtime" as const, tab: "tools" as const };
    expect(
      resolveOpenSettingsLocation({
        section: "account",
        tab: "providers",
        last,
      }),
    ).toEqual({ section: "account", tab: "providers" });
    expect(
      resolveOpenSettingsLocation({ section: "about", last }),
    ).toEqual({ section: "about", tab: null });
  });

  it("resolveOpenSettingsLocation: no section uses last when valid", () => {
    expect(
      resolveOpenSettingsLocation({
        last: { section: "extensions", tab: "mcp" },
      }),
    ).toEqual({ section: "extensions", tab: "mcp" });
    expect(
      resolveOpenSettingsLocation({
        last: { section: "extensions", tab: "nope" as "mcp" },
      }),
    ).toEqual({ section: "extensions", tab: "plugins" });
  });

  it("resolveOpenSettingsLocation: falls back to general", () => {
    expect(resolveOpenSettingsLocation({})).toEqual({
      section: "general",
      tab: "composer",
    });
    expect(resolveOpenSettingsLocation({ last: null })).toEqual({
      section: "general",
      tab: "composer",
    });
    expect(
      resolveOpenSettingsLocation({ section: "not-a-section", last: null }),
    ).toEqual({ section: "general", tab: "composer" });
  });

  it("isSettingsSectionId gate: only known sections restore", () => {
    // parse already nulls unknown sections — resolve never sees them as last.
    const bad = parseSettingsLastRoute({ section: "legacy_foo", tab: "x" });
    expect(bad).toBeNull();
    expect(resolveOpenSettingsLocation({ last: bad })).toEqual({
      section: "general",
      tab: "composer",
    });
  });
});

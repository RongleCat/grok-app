import { describe, expect, it } from "vitest";
import { createT } from "@/i18n";
import {
  SETTINGS_ENTRIES,
  SETTINGS_NAV,
  SETTINGS_SECTION_IDS,
  buildSettingsHash,
  catalogInvariants,
  defaultTabFor,
  isSettingsSectionId,
  keywordKeysForSection,
  parseSettingsHash,
  resolveTab,
  searchSettingsEntries,
} from "./settingsCatalog";

describe("settingsCatalog", () => {
  it("has no structural invariants broken", () => {
    expect(catalogInvariants()).toEqual([]);
  });

  it("lists each section exactly once in NAV", () => {
    const ids = SETTINGS_NAV.map((n) => n.id);
    expect(ids).toEqual([...SETTINGS_SECTION_IDS]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("registers at least one entry per section", () => {
    for (const id of SETTINGS_SECTION_IDS) {
      expect(
        SETTINGS_ENTRIES.some((e) => e.section === id),
        `missing entries for ${id}`,
      ).toBe(true);
    }
  });

  it("parseSettingsHash handles section and tab", () => {
    expect(parseSettingsHash("settings")).toEqual({
      section: "general",
      tab: "composer",
    });
    expect(parseSettingsHash("#/settings/extensions")).toEqual({
      section: "extensions",
      tab: "plugins",
    });
    expect(parseSettingsHash("settings/extensions/mcp")).toEqual({
      section: "extensions",
      tab: "mcp",
    });
    expect(parseSettingsHash("settings/runtime/tools")).toEqual({
      section: "runtime",
      tab: "tools",
    });
    expect(parseSettingsHash("settings/bogus/x")).toEqual({
      section: "general",
      tab: "composer",
    });
    expect(parseSettingsHash("settings/appearance")).toEqual({
      section: "appearance",
      tab: "theme",
    });
    expect(parseSettingsHash("settings/appearance/interface")).toEqual({
      section: "appearance",
      tab: "interface",
    });
    expect(parseSettingsHash("settings/extensions/not-a-tab")).toEqual({
      section: "extensions",
      tab: "plugins",
    });
  });

  it("buildSettingsHash is stable and round-trips", () => {
    expect(buildSettingsHash({ section: "general" })).toBe(
      "#/settings/general/composer",
    );
    expect(buildSettingsHash({ section: "extensions", tab: "mcp" })).toBe(
      "#/settings/extensions/mcp",
    );
    expect(buildSettingsHash({ section: "about" })).toBe("#/settings/about");
    const h = buildSettingsHash({ section: "runtime", tab: "pool" });
    expect(parseSettingsHash(h)).toEqual({ section: "runtime", tab: "pool" });
  });

  it("resolveTab falls back to default", () => {
    expect(defaultTabFor("extensions")).toBe("plugins");
    expect(resolveTab("extensions", "mcp")).toBe("mcp");
    expect(resolveTab("extensions", "nope")).toBe("plugins");
    expect(resolveTab("about", "x")).toBeNull();
  });

  it("isSettingsSectionId", () => {
    expect(isSettingsSectionId("runtime")).toBe(true);
    expect(isSettingsSectionId("nope")).toBe(false);
  });

  it("keywordKeysForSection includes appearance prefs and remote control", () => {
    const appearance = keywordKeysForSection("appearance");
    expect(appearance).toContain("settings.skin");
    expect(appearance).toContain("settings.wallpaper");
    expect(appearance).toContain("settings.thinkingExpand");
    expect(appearance).toContain("settings.chatFontScale");
    expect(appearance).toContain("settings.chatDensity");
    expect(appearance).toContain("settings.sidebarDensity");
    expect(appearance).toContain("settings.messageActions");
    expect(appearance).toContain("settings.messageTimestamps");
    expect(appearance).toContain("settings.messageTimeFormat");
    expect(appearance).toContain("settings.sidebarShowRelativeTime");
    expect(appearance).toContain("settings.backBottomAlways");
    const rim = keywordKeysForSection("remote_im");
    expect(rim).toContain("settings.nav.remoteIm");
    expect(rim).toContain("settings.tab.remoteIm");
    expect(rim).toContain("settings.tab.phoneMirror");
  });

  it("remote_im has im + mirror tabs", () => {
    expect(defaultTabFor("remote_im")).toBe("im");
    expect(resolveTab("remote_im", "mirror")).toBe("mirror");
    expect(resolveTab("remote_im", "feishu")).toBe("im");
    expect(parseSettingsHash("settings/remote_im")).toEqual({
      section: "remote_im",
      tab: "im",
    });
    expect(parseSettingsHash("settings/remote_im/mirror")).toEqual({
      section: "remote_im",
      tab: "mirror",
    });
    // Legacy channel deep-link: unknown tab segment falls back to IM tab.
    expect(parseSettingsHash("settings/remote_im/feishu")).toEqual({
      section: "remote_im",
      tab: "im",
    });
    expect(buildSettingsHash({ section: "remote_im", tab: "mirror" })).toBe(
      "#/settings/remote_im/mirror",
    );
  });

  it("search finds mcp / wallpaper / thinking / chat font / actions / cli path", () => {
    const tZh = createT("zh");
    const tEn = createT("en");
    const mcp = searchSettingsEntries("mcp", tZh, tEn);
    expect(mcp.some((h) => h.entry.id === "ext.mcp")).toBe(true);
    const wallpaper = searchSettingsEntries("壁纸", tZh, tEn);
    // zh copy may use 背景图 — also try English
    const wallpaperHits =
      wallpaper.length > 0
        ? wallpaper
        : searchSettingsEntries("wallpaper", tZh, tEn);
    expect(wallpaperHits.some((h) => h.entry.id === "appearance.wallpaper")).toBe(
      true,
    );
    const thinking = searchSettingsEntries("thinking", tZh, tEn);
    expect(thinking.some((h) => h.entry.id === "appearance.thinkingExpand")).toBe(
      true,
    );
    const reasoning = searchSettingsEntries("reasoning", tZh, tEn);
    expect(
      reasoning.some((h) => h.entry.id === "appearance.thinkingExpand"),
    ).toBe(true);
    const font = searchSettingsEntries("字号", tZh, tEn);
    expect(font.some((h) => h.entry.id === "appearance.chatFontScale")).toBe(
      true,
    );
    const fontEn = searchSettingsEntries("text size", tZh, tEn);
    expect(fontEn.some((h) => h.entry.id === "appearance.chatFontScale")).toBe(
      true,
    );
    const density = searchSettingsEntries("密度", tZh, tEn);
    expect(density.some((h) => h.entry.id === "appearance.chatDensity")).toBe(
      true,
    );
    expect(
      density.some((h) => h.entry.id === "appearance.sidebarDensity"),
    ).toBe(true);
    const densityEn = searchSettingsEntries("compact", tZh, tEn);
    expect(
      densityEn.some((h) => h.entry.id === "appearance.chatDensity"),
    ).toBe(true);
    expect(
      densityEn.some((h) => h.entry.id === "appearance.sidebarDensity"),
    ).toBe(true);
    const sidebar = searchSettingsEntries("侧栏", tZh, tEn);
    const sidebarHits =
      sidebar.length > 0
        ? sidebar
        : searchSettingsEntries("sidebar", tZh, tEn);
    expect(
      sidebarHits.some((h) => h.entry.id === "appearance.sidebarDensity"),
    ).toBe(true);
    const actions = searchSettingsEntries("操作", tZh, tEn);
    expect(
      actions.some((h) => h.entry.id === "appearance.messageActions"),
    ).toBe(true);
    const actionsEn = searchSettingsEntries("copy buttons", tZh, tEn);
    expect(
      actionsEn.some((h) => h.entry.id === "appearance.messageActions"),
    ).toBe(true);
    const timestamps = searchSettingsEntries("时间戳", tZh, tEn);
    const timestampsHits =
      timestamps.length > 0
        ? timestamps
        : searchSettingsEntries("timestamp", tZh, tEn);
    expect(
      timestampsHits.some((h) => h.entry.id === "appearance.messageTimestamps"),
    ).toBe(true);
    const relativeTime = searchSettingsEntries("relative time", tZh, tEn);
    expect(
      relativeTime.some((h) => h.entry.id === "appearance.messageTimeFormat"),
    ).toBe(true);
    expect(
      relativeTime.some(
        (h) => h.entry.id === "appearance.sidebarShowRelativeTime",
      ),
    ).toBe(true);
    const relativeZh = searchSettingsEntries("相对时间", tZh, tEn);
    expect(
      relativeZh.some((h) => h.entry.id === "appearance.messageTimeFormat"),
    ).toBe(true);
    expect(
      relativeZh.some(
        (h) => h.entry.id === "appearance.sidebarShowRelativeTime",
      ),
    ).toBe(true);
    const backBottom = searchSettingsEntries("back to bottom", tZh, tEn);
    expect(
      backBottom.some((h) => h.entry.id === "appearance.backBottomAlways"),
    ).toBe(true);
    const backBottomZh = searchSettingsEntries("回到底部", tZh, tEn);
    expect(
      backBottomZh.some((h) => h.entry.id === "appearance.backBottomAlways"),
    ).toBe(true);
    const cli = searchSettingsEntries("CLI", tZh, tEn);
    expect(cli.some((h) => h.entry.section === "runtime")).toBe(true);
  });
});

import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";
import { createT, loadAllLocaleCatalogs } from "@/i18n";
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
  beforeAll(async () => {
    await loadAllLocaleCatalogs();
  });

  it("has no structural invariants broken", () => {
    expect(catalogInvariants()).toEqual([]);
  });

  it("mounts every searchable anchor in production", { timeout: 30_000 }, () => {
    const srcRoot = resolve(__dirname, "..");
    const mountedAnchors = new Set<string>();
    for (const file of globSync("**/*.{ts,tsx}", {
      cwd: srcRoot,
      exclude: [
        "**/*.test.*",
        "**/*.guard.test.*",
        "lib/settingsCatalog/entries/**",
      ],
    })) {
      const source = readFileSync(resolve(srcRoot, file), "utf8");
      const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const collectIdValues = (node: ts.Node) => {
        if (ts.isStringLiteralLike(node)) {
          mountedAnchors.add(node.text);
        } else if (ts.isJsxExpression(node) && node.expression) {
          collectIdValues(node.expression);
        } else if (ts.isConditionalExpression(node)) {
          collectIdValues(node.whenTrue);
          collectIdValues(node.whenFalse);
        } else if (ts.isParenthesizedExpression(node)) {
          collectIdValues(node.expression);
        }
      };
      const visit = (node: ts.Node) => {
        if (ts.isJsxAttribute(node) && node.name.getText(sourceFile) === "id") {
          if (node.initializer) collectIdValues(node.initializer);
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }
    const missing = SETTINGS_ENTRIES.filter(
      ({ anchorId }) => !mountedAnchors.has(anchorId),
    ).map(({ id, anchorId }) => `${id}: ${anchorId}`);

    expect(missing).toEqual([]);
  });

  it("registers three distinct static skin-share anchors", () => {
    const presets = SETTINGS_ENTRIES.find((e) => e.id === "appearance.skinPresets");
    const catalog = SETTINGS_ENTRIES.find((e) => e.id === "appearance.skinCatalog");
    const sources = SETTINGS_ENTRIES.find((e) => e.id === "appearance.skinSources");
    expect(presets?.anchorId).toBe("settings-anchor-skin-presets");
    expect(catalog?.anchorId).toBe("settings-anchor-skin-catalog");
    expect(sources?.anchorId).toBe("settings-anchor-skin-sources");
    expect(new Set([presets?.anchorId, catalog?.anchorId, sources?.anchorId]).size).toBe(3);
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
    // Query (PR hub deep link) must not break section/tab parse.
    expect(parseSettingsHash("#/settings/runtime/tools?pr=42")).toEqual({
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

  it("extensions has no market tab; market deep-link → plugins catalog", () => {
    const extNav = SETTINGS_NAV.find((n) => n.id === "extensions");
    expect(extNav?.tabs.map((t) => t.id)).toEqual([
      "plugins",
      "mcp",
      "skills",
      "agents",
      "hooks",
    ]);
    expect(extNav?.tabs.some((t) => t.id === "market")).toBe(false);
    expect(resolveTab("extensions", "market")).toBe("plugins");
    expect(parseSettingsHash("#/settings/extensions/market")).toEqual({
      section: "extensions",
      tab: "plugins",
    });
    expect(parseSettingsHash("settings/extensions/market")).toEqual({
      section: "extensions",
      tab: "plugins",
    });
    const marketEntry = SETTINGS_ENTRIES.find((e) => e.id === "ext.market");
    expect(marketEntry?.tab).toBe("plugins");
    expect(marketEntry?.anchorId).toBe("settings-anchor-ext-plugins-catalog");
    const tZh = createT("zh");
    const tEn = createT("en");
    const hits = searchSettingsEntries("marketplace", tZh, tEn);
    expect(hits.some((h) => h.entry.id === "ext.market")).toBe(true);
    expect(hits.every((h) => h.entry.tab === "plugins" || h.entry.tab == null)).toBe(
      true,
    );
    const marketZh = searchSettingsEntries("市场", tZh, tEn);
    expect(
      marketZh.some(
        (h) =>
          h.entry.id === "ext.market" &&
          h.entry.tab === "plugins" &&
          h.entry.anchorId === "settings-anchor-ext-plugins-catalog",
      ),
    ).toBe(true);
  });

  it("runtime has an SSH tab for OpenSSH hosts", () => {
    const runtime = SETTINGS_NAV.find((n) => n.id === "runtime");
    expect(runtime?.tabs.map((t) => t.id)).toEqual([
      "cli",
      "connection",
      "ssh",
      "network",
      "pool",
      "tools",
      "privacy",
    ]);
    expect(parseSettingsHash("#/settings/runtime/ssh")).toEqual({
      section: "runtime",
      tab: "ssh",
    });
    expect(buildSettingsHash({ section: "runtime", tab: "ssh" })).toBe(
      "#/settings/runtime/ssh",
    );
    const entry = SETTINGS_ENTRIES.find((e) => e.id === "runtime.sshHosts");
    expect(entry?.tab).toBe("ssh");
    expect(entry?.anchorId).toBe("settings-anchor-sshHosts");
    const tZh = createT("zh");
    const tEn = createT("en");
    const hits = searchSettingsEntries("ssh", tZh, tEn);
    expect(hits.some((h) => h.entry.id === "runtime.sshHosts")).toBe(true);
    const zhHits = searchSettingsEntries("测试连接", tZh, tEn);
    expect(zhHits.some((h) => h.entry.id === "runtime.sshHosts")).toBe(true);
  });

  it("isSettingsSectionId", () => {
    expect(isSettingsSectionId("runtime")).toBe(true);
    expect(isSettingsSectionId("pet")).toBe(true);
    expect(isSettingsSectionId("nope")).toBe(false);
  });

  it("pet is a first-class nav section with look · bubbles tabs", () => {
    expect(SETTINGS_NAV.some((n) => n.id === "pet")).toBe(true);
    expect(SETTINGS_ENTRIES.some((e) => e.section === "pet")).toBe(true);
    expect(defaultTabFor("pet")).toBe("look");
    expect(resolveTab("pet", "bubbles")).toBe("bubbles");
    expect(resolveTab("pet", "nope")).toBe("look");
    expect(buildSettingsHash({ section: "pet" })).toBe("#/settings/pet/look");
    expect(buildSettingsHash({ section: "pet", tab: "bubbles" })).toBe(
      "#/settings/pet/bubbles",
    );
    expect(parseSettingsHash("#/settings/pet")).toEqual({
      section: "pet",
      tab: "look",
    });
    expect(parseSettingsHash("settings/pet")).toEqual({
      section: "pet",
      tab: "look",
    });
    expect(parseSettingsHash("settings/pet/bubbles")).toEqual({
      section: "pet",
      tab: "bubbles",
    });
    const loc = parseSettingsHash(buildSettingsHash({ section: "pet" }));
    expect(loc).toEqual({ section: "pet", tab: "look" });
    expect(SETTINGS_ENTRIES.find((e) => e.id === "pet.identity")?.tab).toBe("look");
    expect(SETTINGS_ENTRIES.find((e) => e.id === "pet.bubbles")?.tab).toBe(
      "bubbles",
    );
  });

  it("search finds 宠物 / pet menu", () => {
    const tZh = createT("zh");
    const tEn = createT("en");
    const zhHits = searchSettingsEntries("宠物", tZh, tEn);
    expect(zhHits.some((h) => h.entry.section === "pet")).toBe(true);
    const enHits = searchSettingsEntries("pet", tZh, tEn);
    expect(enHits.some((h) => h.entry.section === "pet")).toBe(true);
    expect(enHits.some((h) => h.entry.id === "pet.companion")).toBe(true);
    const eyeHits = searchSettingsEntries("眼睛", tZh, tEn);
    expect(eyeHits.some((h) => h.entry.id === "pet.eyeColor")).toBe(true);
    const eyeEn = searchSettingsEntries("eye color", tZh, tEn);
    expect(eyeEn.some((h) => h.entry.section === "pet")).toBe(true);
    const bubbleHits = searchSettingsEntries("提示框", tZh, tEn);
    expect(bubbleHits.some((h) => h.entry.id === "pet.bubbles")).toBe(true);
    const dismissHits = searchSettingsEntries("自动关闭", tZh, tEn);
    expect(dismissHits.some((h) => h.entry.id === "pet.bubbleDismiss")).toBe(true);
    const lookHits = searchSettingsEntries("气泡形状", tZh, tEn);
    expect(lookHits.some((h) => h.entry.id === "pet.bubbleLook")).toBe(true);
    const faceHits = searchSettingsEntries("表情", tZh, tEn);
    expect(faceHits.some((h) => h.entry.id === "pet.expression")).toBe(true);
    const lookTabHits = searchSettingsEntries("外观设置", tZh, tEn);
    expect(lookTabHits.some((h) => h.entry.id === "pet.companion" && h.entry.tab === "look")).toBe(
      true,
    );
    const bubbleTabHits = searchSettingsEntries("气泡设置", tZh, tEn);
    expect(
      bubbleTabHits.some((h) => h.entry.id === "pet.bubbles" && h.entry.tab === "bubbles"),
    ).toBe(true);
  });

  it("keywordKeysForSection includes appearance prefs and remote control", () => {
    const appearance = keywordKeysForSection("appearance");
    expect(appearance).toContain("settings.skin");
    expect(appearance).toContain("settings.themeSchedule");
    expect(appearance).toContain("settings.wallpaper");
    expect(appearance).toContain("settings.thinkingExpand");
    expect(appearance).toContain("settings.toolStepsAutoCollapse");
    expect(appearance).toContain("settings.transcriptFilter");
    expect(appearance).toContain("settings.chatFontScale");
    expect(appearance).toContain("settings.codeFontScale");
    expect(appearance).toContain("settings.chatDensity");
    expect(appearance).toContain("settings.chatWidth");
    expect(appearance).toContain("settings.msgRailSide");
    expect(appearance).toContain("settings.sidebarDensity");
    expect(appearance).toContain("settings.zenMode");
    expect(appearance).toContain("settings.messageActions");
    expect(appearance).toContain("settings.messageTimestamps");
    expect(appearance).toContain("settings.showReplyLength");
    expect(appearance).toContain("settings.messageTimeFormat");
    expect(appearance).toContain("settings.sidebarShowRelativeTime");
    expect(appearance).toContain("settings.sessionMuteSummary");
    expect(appearance).toContain("settings.sessionUnreadSummary");
    expect(appearance).toContain("settings.backBottomAlways");
    expect(appearance).toContain("settings.selectionToolbar");
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

  it("account has official · providers · extras tabs", () => {
    expect(defaultTabFor("account")).toBe("official");
    expect(resolveTab("account", "providers")).toBe("providers");
    expect(resolveTab("account", "extras")).toBe("extras");
    expect(resolveTab("account", "nope")).toBe("official");
    expect(parseSettingsHash("settings/account/extras")).toEqual({
      section: "account",
      tab: "extras",
    });
    expect(buildSettingsHash({ section: "account", tab: "extras" })).toBe(
      "#/settings/account/extras",
    );
    const aux = SETTINGS_ENTRIES.find((e) => e.id === "account.officialAuxInject");
    expect(aux?.tab).toBe("extras");
  });

  it("search finds mcp / wallpaper / thinking / chat font / actions / cli path", () => {
    const tZh = createT("zh");
    const tEn = createT("en");
    const inject = searchSettingsEntries("注入官方工具", tZh, tEn);
    expect(
      inject.some(
        (h) =>
          h.entry.id === "account.officialAuxInject" &&
          h.entry.tab === "extras",
      ),
    ).toBe(true);
    const extras = searchSettingsEntries("拓展", tZh, tEn);
    expect(extras.some((h) => h.entry.id === "account.extras")).toBe(true);
    const mcp = searchSettingsEntries("mcp", tZh, tEn);
    expect(mcp.some((h) => h.entry.id === "ext.mcp")).toBe(true);
    const claudeSkills = searchSettingsEntries("claude", tZh, tEn);
    expect(
      claudeSkills.some((h) => h.entry.id === "ext.skills.discoverExternal"),
    ).toBe(true);
    const discoverZh = searchSettingsEntries("探测", tZh, tEn);
    expect(
      discoverZh.some((h) => h.entry.id === "ext.skills.discoverExternal"),
    ).toBe(true);
    const wallpaper = searchSettingsEntries("壁纸", tZh, tEn);
    // zh copy may use 背景图 — also try English
    const wallpaperHits =
      wallpaper.length > 0
        ? wallpaper
        : searchSettingsEntries("wallpaper", tZh, tEn);
    expect(wallpaperHits.some((h) => h.entry.id === "appearance.wallpaper")).toBe(
      true,
    );
    const textColor = searchSettingsEntries("文字颜色", tZh, tEn);
    expect(textColor.some((h) => h.entry.id === "appearance.textColor")).toBe(
      true,
    );
    const fontShadow = searchSettingsEntries("text shadow", tZh, tEn);
    expect(fontShadow.some((h) => h.entry.id === "appearance.fontShadow")).toBe(
      true,
    );
    const chromeReset = searchSettingsEntries("恢复默认", tZh, tEn);
    expect(
      chromeReset.some((h) => h.entry.id === "appearance.chromeReset"),
    ).toBe(true);
    const schedule = searchSettingsEntries("schedule", tZh, tEn);
    expect(
      schedule.some((h) => h.entry.id === "appearance.themeSchedule"),
    ).toBe(true);
    const scheduleZh = searchSettingsEntries("按时切换", tZh, tEn);
    expect(
      scheduleZh.some((h) => h.entry.id === "appearance.themeSchedule"),
    ).toBe(true);
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
    const zen = searchSettingsEntries("zen", tZh, tEn);
    expect(zen.some((h) => h.entry.id === "appearance.zenMode")).toBe(true);
    const zenZh = searchSettingsEntries("禅", tZh, tEn);
    expect(zenZh.some((h) => h.entry.id === "appearance.zenMode")).toBe(true);
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
    const width = searchSettingsEntries("宽度", tZh, tEn);
    const widthHits =
      width.length > 0 &&
      width.some((h) => h.entry.id === "appearance.chatWidth")
        ? width
        : searchSettingsEntries("reading width", tZh, tEn);
    expect(widthHits.some((h) => h.entry.id === "appearance.chatWidth")).toBe(
      true,
    );
    const widthEn = searchSettingsEntries("narrow", tZh, tEn);
    expect(widthEn.some((h) => h.entry.id === "appearance.chatWidth")).toBe(
      true,
    );
    const rail = searchSettingsEntries("进度条", tZh, tEn);
    expect(rail.some((h) => h.entry.id === "appearance.msgRailSide")).toBe(
      true,
    );
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
    const selectionToolbar = searchSettingsEntries("selection toolbar", tZh, tEn);
    expect(
      selectionToolbar.some((h) => h.entry.id === "appearance.selectionToolbar"),
    ).toBe(true);
    const selectionToolbarZh = searchSettingsEntries("选中文字", tZh, tEn);
    expect(
      selectionToolbarZh.some(
        (h) => h.entry.id === "appearance.selectionToolbar",
      ),
    ).toBe(true);
    const toolCollapse = searchSettingsEntries("tool steps", tZh, tEn);
    expect(
      toolCollapse.some(
        (h) => h.entry.id === "appearance.toolStepsAutoCollapse",
      ),
    ).toBe(true);
    const toolCollapseZh = searchSettingsEntries("工具步骤", tZh, tEn);
    expect(
      toolCollapseZh.some(
        (h) => h.entry.id === "appearance.toolStepsAutoCollapse",
      ),
    ).toBe(true);
    const transcriptFilter = searchSettingsEntries("transcript filter", tZh, tEn);
    expect(
      transcriptFilter.some(
        (h) => h.entry.id === "appearance.transcriptFilter",
      ),
    ).toBe(true);
    const transcriptFilterZh = searchSettingsEntries("仅对话", tZh, tEn);
    expect(
      transcriptFilterZh.some(
        (h) => h.entry.id === "appearance.transcriptFilter",
      ),
    ).toBe(true);
    const hideTools = searchSettingsEntries("hide tools", tZh, tEn);
    expect(
      hideTools.some((h) => h.entry.id === "appearance.transcriptFilter"),
    ).toBe(true);
    const cli = searchSettingsEntries("CLI", tZh, tEn);
    expect(cli.some((h) => h.entry.section === "runtime")).toBe(true);
    const sessionCmd = searchSettingsEntries("grok-app command", tZh, tEn);
    expect(
      sessionCmd.some((h) => h.entry.id === "runtime.sessionApi"),
    ).toBe(true);
    const sessionApi = searchSettingsEntries("session api", tZh, tEn);
    expect(
      sessionApi.some((h) => h.entry.id === "runtime.sessionApi"),
    ).toBe(true);
    const sessionApiZh = searchSettingsEntries("会话列表", tZh, tEn);
    expect(
      sessionApiZh.some((h) => h.entry.id === "runtime.sessionApi"),
    ).toBe(true);
    const importListed = searchSettingsEntries("import listed", tZh, tEn);
    expect(
      importListed.some((h) => h.entry.id === "account.callLogs"),
    ).toBe(true);
    const importZh = searchSettingsEntries("导入会话", tZh, tEn);
    expect(
      importZh.some((h) => h.entry.id === "account.callLogs"),
    ).toBe(true);
  });
});

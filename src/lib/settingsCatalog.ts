/**
 * Settings IA registry — single source for nav, page tabs, and search jump targets.
 *
 * Rules (see docs/llm-wiki/settings-ia.md):
 * - Every user-visible setting must be registered here.
 * - Search matches labelKey + descKeys + keywords (en + active locale via createT).
 * - Deep links: #/settings/{section}[/{tab}]
 */

import type { MessageKey } from "@/i18n";

export type SettingsSectionId =
  | "general"
  | "appearance"
  | "account"
  | "archived"
  | "extensions"
  | "remote_im"
  | "runtime"
  | "shortcuts"
  | "about";

export const SETTINGS_SECTION_IDS: readonly SettingsSectionId[] = [
  "general",
  "appearance",
  "account",
  "archived",
  "extensions",
  "runtime",
  "remote_im",
  "shortcuts",
  "about",
] as const;

export function isSettingsSectionId(v: string | undefined | null): v is SettingsSectionId {
  return !!v && (SETTINGS_SECTION_IDS as readonly string[]).includes(v);
}

/** Page-local tab ids (stable for hash + registry). */
export type SettingsTabId =
  // general
  | "composer"
  | "permissions"
  | "agent"
  | "app"
  // appearance
  | "theme"
  | "interface"
  // account
  | "official"
  | "providers"
  // extensions
  | "plugins"
  | "skills"
  | "mcp"
  | "hooks"
  | "market"
  // runtime
  | "cli"
  | "connection"
  | "network"
  | "pool"
  | "tools"
  // remote control (section id stays remote_im)
  | "im"
  | "mirror";

export type SettingsNavGroup = "personal" | "system";

export type SettingsNavIcon =
  | "settings"
  | "appearance"
  | "user"
  | "archive"
  | "extensions"
  | "remote_im"
  | "doctor"
  | "keyboard"
  | "info";

export type SettingsTabDef = {
  id: SettingsTabId;
  labelKey: MessageKey;
};

export type SettingsNavDef = {
  id: SettingsSectionId;
  icon: SettingsNavIcon;
  labelKey: MessageKey;
  group: SettingsNavGroup;
  /** Ordered tabs for this section; empty = single-page (no tab strip). */
  tabs: readonly SettingsTabDef[];
  defaultTab?: SettingsTabId;
};

/**
 * One searchable / jumpable settings surface.
 * Prefer registering each control (or cohesive card) with a stable id + anchor.
 */
export type SettingsEntry = {
  /** Stable id, e.g. `general.language` */
  id: string;
  section: SettingsSectionId;
  /** Page tab when the section uses tabs. */
  tab?: SettingsTabId;
  /** DOM id for scrollIntoView (must match element id=). */
  anchorId: string;
  labelKey: MessageKey;
  /** Extra i18n keys included in search (descriptions, option labels). */
  descKeys?: readonly MessageKey[];
  /** Free-form aliases (usually English) for search. */
  keywords?: readonly string[];
};

/** Primary nav order (exactly one row per section — no duplicate runtime). */
export const SETTINGS_NAV: readonly SettingsNavDef[] = [
  {
    id: "general",
    icon: "settings",
    labelKey: "settings.nav.general",
    group: "personal",
    defaultTab: "composer",
    tabs: [
      { id: "composer", labelKey: "settings.tab.composer" },
      { id: "permissions", labelKey: "settings.tab.permissions" },
      { id: "agent", labelKey: "settings.tab.agent" },
      { id: "app", labelKey: "settings.tab.app" },
    ],
  },
  {
    id: "appearance",
    icon: "appearance",
    labelKey: "settings.nav.appearance",
    group: "personal",
    defaultTab: "theme",
    tabs: [
      { id: "theme", labelKey: "settings.tab.theme" },
      { id: "interface", labelKey: "settings.tab.interface" },
    ],
  },
  {
    id: "account",
    icon: "user",
    labelKey: "settings.nav.account",
    group: "personal",
    defaultTab: "official",
    tabs: [
      { id: "official", labelKey: "settings.tabOfficial" },
      { id: "providers", labelKey: "settings.tabProviders" },
    ],
  },
  {
    id: "archived",
    icon: "archive",
    labelKey: "settings.nav.archived",
    group: "personal",
    tabs: [],
  },
  {
    id: "extensions",
    icon: "extensions",
    labelKey: "settings.nav.extensions",
    group: "system",
    defaultTab: "plugins",
    tabs: [
      { id: "plugins", labelKey: "ext.plugins.title" },
      { id: "skills", labelKey: "ext.skills.title" },
      { id: "mcp", labelKey: "ext.mcp.title" },
      { id: "hooks", labelKey: "ext.hooks.title" },
      { id: "market", labelKey: "ext.market.title" },
    ],
  },
  {
    id: "runtime",
    icon: "doctor",
    labelKey: "settings.nav.runtime",
    group: "system",
    defaultTab: "cli",
    tabs: [
      { id: "cli", labelKey: "settings.tab.cli" },
      { id: "connection", labelKey: "settings.tab.connection" },
      { id: "network", labelKey: "settings.tab.network" },
      { id: "pool", labelKey: "settings.tab.pool" },
      { id: "tools", labelKey: "settings.tab.tools" },
    ],
  },
  {
    id: "remote_im",
    icon: "remote_im",
    labelKey: "settings.nav.remoteIm",
    group: "system",
    defaultTab: "im",
    tabs: [
      { id: "im", labelKey: "settings.tab.remoteIm" },
      { id: "mirror", labelKey: "settings.tab.phoneMirror" },
    ],
  },
  {
    id: "shortcuts",
    icon: "keyboard",
    labelKey: "settings.nav.shortcuts",
    group: "system",
    tabs: [],
  },
  {
    id: "about",
    icon: "info",
    labelKey: "settings.nav.about",
    group: "system",
    tabs: [],
  },
];

/** Full registry of searchable settings (UI rows / cards). */
export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  // ── general / composer ──
  {
    id: "general.prefsScope",
    section: "general",
    tab: "composer",
    anchorId: "settings-anchor-prefsScope",
    labelKey: "settings.prefsScope",
    descKeys: [
      "settings.prefsScopeDesc",
      "settings.prefsScope.global",
      "settings.prefsScope.project",
      "settings.prefsScope.session",
      "settings.section.composer",
    ],
    keywords: ["composer", "prefs", "scope"],
  },
  {
    id: "general.availableModels",
    section: "general",
    tab: "composer",
    anchorId: "settings-anchor-availableModels",
    labelKey: "settings.availableModels",
    descKeys: ["settings.availableModelsDesc"],
    keywords: ["models", "model list"],
  },
  {
    id: "general.composerSendKey",
    section: "general",
    tab: "composer",
    anchorId: "settings-anchor-composerSendKey",
    labelKey: "settings.composerSendKey",
    descKeys: [
      "settings.composerSendKeyDesc",
      "settings.composerSendKey.enter",
      "settings.composerSendKey.modEnter",
      "settings.section.composer",
    ],
    keywords: [
      "composer",
      "send",
      "enter",
      "mod-enter",
      "cmd enter",
      "ctrl enter",
      "newline",
      "keyboard",
    ],
  },
  {
    id: "general.composerSpellcheck",
    section: "general",
    tab: "composer",
    anchorId: "settings-anchor-composerSpellcheck",
    labelKey: "settings.composerSpellcheck",
    descKeys: [
      "settings.composerSpellcheckDesc",
      "settings.section.composer",
    ],
    keywords: [
      "composer",
      "spellcheck",
      "spell check",
      "spelling",
      "typo",
      "autocorrect",
    ],
  },
  // ── general / permissions ──
  {
    id: "general.permissionPolicy",
    section: "general",
    tab: "permissions",
    anchorId: "settings-anchor-permissionPolicy",
    labelKey: "settings.permissionDeep",
    descKeys: [
      "settings.permissionDeepDesc",
      "settings.section.permissions",
      "policy.ask",
      "policy.accept_edits",
      "policy.allow_for_session",
      "policy.dont_ask",
      "policy.always_approve",
    ],
    keywords: ["permission", "yolo", "always approve", "policy"],
  },
  {
    id: "general.sandbox",
    section: "general",
    tab: "permissions",
    anchorId: "settings-anchor-sandbox",
    labelKey: "settings.sandboxProfile",
    descKeys: ["settings.sandboxProfileDesc"],
    keywords: ["sandbox"],
  },
  {
    id: "general.permissionRules",
    section: "general",
    tab: "permissions",
    anchorId: "settings-anchor-permissionRules",
    labelKey: "settings.section.permissions",
    keywords: ["rules", "permission rules"],
  },
  // ── general / agent ──
  {
    id: "general.maxAgentTurns",
    section: "general",
    tab: "agent",
    anchorId: "settings-anchor-maxAgentTurns",
    labelKey: "settings.maxAgentTurns",
    descKeys: ["settings.maxAgentTurnsDesc", "settings.section.agent"],
    keywords: ["max turns", "turns"],
  },
  {
    id: "general.preferredAgent",
    section: "general",
    tab: "agent",
    anchorId: "settings-anchor-preferredAgent",
    labelKey: "settings.preferredAgent",
    descKeys: ["settings.preferredAgentDesc"],
    keywords: ["preferred agent", "agent definition"],
  },
  {
    id: "general.experimentalMemory",
    section: "general",
    tab: "agent",
    anchorId: "settings-anchor-experimentalMemory",
    labelKey: "settings.experimentalMemory",
    descKeys: ["settings.experimentalMemoryDesc"],
    keywords: ["memory"],
  },
  {
    id: "general.subagents",
    section: "general",
    tab: "agent",
    anchorId: "settings-anchor-subagents",
    labelKey: "settings.subagentsEnabled",
    descKeys: ["settings.subagentsEnabledDesc"],
    keywords: ["subagents", "sub-agent"],
  },
  {
    id: "general.plan",
    section: "general",
    tab: "agent",
    anchorId: "settings-anchor-planEnabled",
    labelKey: "settings.planEnabled",
    descKeys: ["settings.planEnabledDesc"],
    keywords: ["plan mode"],
  },
  {
    id: "general.disableWebSearch",
    section: "general",
    tab: "agent",
    anchorId: "settings-anchor-disableWebSearch",
    labelKey: "settings.disableWebSearch",
    descKeys: ["settings.disableWebSearchDesc"],
    keywords: ["web search"],
  },
  {
    id: "general.useLeader",
    section: "general",
    tab: "agent",
    anchorId: "settings-anchor-useLeader",
    labelKey: "settings.useLeader",
    descKeys: ["settings.useLeaderDesc"],
    keywords: ["leader"],
  },
  // ── general / app ──
  {
    id: "general.language",
    section: "general",
    tab: "app",
    anchorId: "settings-anchor-language",
    labelKey: "settings.language",
    descKeys: ["settings.languageDesc", "settings.section.general"],
    keywords: ["language", "locale", "中文", "english"],
  },
  {
    id: "general.sessionDataMode",
    section: "general",
    tab: "app",
    anchorId: "settings-anchor-sessionDataMode",
    labelKey: "settings.sessionDataMode",
    descKeys: [
      "settings.sessionDataModeDesc",
      "settings.modeIndependent",
      "settings.modeShared",
      "settings.cliSessions",
    ],
    keywords: ["session data", "shared", "independent", "cli sessions"],
  },
  {
    id: "general.voiceId",
    section: "general",
    tab: "app",
    anchorId: "settings-anchor-voiceId",
    labelKey: "settings.voiceId",
    descKeys: ["settings.voiceIdDesc", "settings.section.voice"],
    keywords: ["voice", "speaker", "tts", "语音", "音色"],
  },
  {
    id: "general.voiceDictationAutoSend",
    section: "general",
    tab: "app",
    anchorId: "settings-anchor-voiceDictationAutoSend",
    labelKey: "settings.voiceDictationAutoSend",
    descKeys: ["settings.voiceDictationAutoSendDesc"],
    keywords: ["dictation", "auto send", "听写", "语音输入"],
  },
  {
    id: "general.voiceKeepAgentsOnEnd",
    section: "general",
    tab: "app",
    anchorId: "settings-anchor-voiceKeepAgentsOnEnd",
    labelKey: "settings.voiceKeepAgentsOnEnd",
    descKeys: ["settings.voiceKeepAgentsOnEndDesc"],
    keywords: ["voice", "keep agents", "语音", "保留"],
  },
  {
    id: "general.keychain",
    section: "general",
    tab: "app",
    anchorId: "settings-anchor-keychain",
    labelKey: "settings.storeApiKeysInKeychain",
    descKeys: ["settings.storeApiKeysInKeychainDesc"],
    keywords: ["keychain", "api key", "secrets"],
  },
  {
    id: "general.clearMemory",
    section: "general",
    tab: "app",
    anchorId: "settings-anchor-clearMemory",
    labelKey: "settings.clearWorkspaceMemory",
    descKeys: ["settings.clearWorkspaceMemoryDesc"],
    keywords: ["clear memory", "workspace memory"],
  },
  {
    id: "general.reopenLastSession",
    section: "general",
    tab: "app",
    anchorId: "settings-anchor-reopenLastSession",
    labelKey: "settings.reopenLastSession",
    descKeys: ["settings.reopenLastSessionDesc"],
    keywords: ["reopen", "restore session"],
  },
  {
    id: "general.notifyOnTurnDone",
    section: "general",
    tab: "app",
    anchorId: "settings-anchor-notifyOnTurnDone",
    labelKey: "settings.notifyOnTurnDone",
    descKeys: ["settings.notifyOnTurnDoneDesc"],
    keywords: [
      "notification",
      "desktop",
      "alert",
      "turn done",
      "notify",
      "桌面通知",
      "完成通知",
    ],
  },
  {
    id: "general.notifyOnPermission",
    section: "general",
    tab: "app",
    anchorId: "settings-anchor-notifyOnPermission",
    labelKey: "settings.notifyOnPermission",
    descKeys: ["settings.notifyOnPermissionDesc"],
    keywords: [
      "notification",
      "desktop",
      "alert",
      "permission",
      "notify",
      "桌面通知",
      "授权通知",
    ],
  },
  {
    id: "general.openTarget",
    section: "general",
    tab: "app",
    anchorId: "settings-anchor-openTarget",
    labelKey: "settings.openTarget",
    descKeys: ["settings.openTargetDesc", "settings.openFinder"],
    keywords: ["open in", "finder", "editor"],
  },
  // ── appearance · theme ──
  {
    id: "appearance.theme",
    section: "appearance",
    tab: "theme",
    anchorId: "settings-anchor-theme",
    labelKey: "settings.theme",
    descKeys: [
      "settings.themeDesc",
      "settings.themeSystem",
      "settings.themeLight",
      "settings.themeDark",
    ],
    keywords: ["theme", "dark", "light", "system", "auto", "跟随系统"],
  },
  {
    id: "appearance.skin",
    section: "appearance",
    tab: "theme",
    anchorId: "settings-anchor-skin",
    labelKey: "settings.skin",
    descKeys: ["settings.skinDesc"],
    keywords: ["skin", "color pack", "accent"],
  },
  {
    id: "appearance.wallpaper",
    section: "appearance",
    tab: "theme",
    anchorId: "settings-anchor-wallpaper",
    labelKey: "settings.wallpaper",
    descKeys: [
      "settings.wallpaperDesc",
      "settings.wallpaperScrim",
      "settings.wallpaperScrimDesc",
      "settings.wallpaperFromX",
      "settings.wallpaperImagine",
    ],
    keywords: [
      "wallpaper",
      "background",
      "scrim",
      "x",
      "twitter",
      "imagine",
      "背景",
      "壁纸",
    ],
  },
  // ── appearance · interface (chat chrome) ──
  {
    id: "appearance.thinkingExpand",
    section: "appearance",
    tab: "interface",
    anchorId: "settings-anchor-thinkingExpand",
    labelKey: "settings.thinkingExpand",
    descKeys: [
      "settings.thinkingExpandDesc",
      "settings.thinkingExpand.autoCollapse",
      "settings.thinkingExpand.keepOpen",
    ],
    keywords: [
      "thinking",
      "reasoning",
      "collapse",
      "expand",
      "thought",
      "思考",
      "推理",
      "折叠",
      "展開",
      "展开",
    ],
  },
  {
    id: "appearance.chatFontScale",
    section: "appearance",
    tab: "interface",
    anchorId: "settings-anchor-chatFontScale",
    labelKey: "settings.chatFontScale",
    descKeys: [
      "settings.chatFontScaleDesc",
      "settings.chatFontScale.sm",
      "settings.chatFontScale.md",
      "settings.chatFontScale.lg",
    ],
    keywords: ["font", "size", "text size", "字号", "字號", "字体", "字體"],
  },
  {
    id: "appearance.chatDensity",
    section: "appearance",
    tab: "interface",
    anchorId: "settings-anchor-chatDensity",
    labelKey: "settings.chatDensity",
    descKeys: [
      "settings.chatDensityDesc",
      "settings.chatDensity.comfortable",
      "settings.chatDensity.compact",
    ],
    keywords: [
      "density",
      "compact",
      "comfortable",
      "spacing",
      "padding",
      "dense",
      "密度",
      "紧凑",
      "緊湊",
      "舒适",
      "舒適",
      "间距",
      "間距",
    ],
  },
  {
    id: "appearance.codeWrapDefault",
    section: "appearance",
    tab: "interface",
    anchorId: "settings-anchor-codeWrapDefault",
    labelKey: "settings.codeWrapDefault",
    descKeys: ["settings.codeWrapDefaultDesc"],
    keywords: [
      "code wrap",
      "line wrap",
      "word wrap",
      "soft wrap",
      "代码换行",
      "自動換行",
      "自动换行",
    ],
  },
  {
    id: "appearance.codeLineNumbers",
    section: "appearance",
    tab: "interface",
    anchorId: "settings-anchor-codeLineNumbers",
    labelKey: "settings.codeLineNumbers",
    descKeys: ["settings.codeLineNumbersDesc"],
    keywords: [
      "line numbers",
      "code lines",
      "gutter",
      "行号",
      "行號",
      "代码行号",
      "程式碼行號",
    ],
  },
  {
    id: "appearance.confirmExternalLinks",
    section: "appearance",
    tab: "interface",
    anchorId: "settings-anchor-confirmExternalLinks",
    labelKey: "settings.confirmExternalLinks",
    descKeys: ["settings.confirmExternalLinksDesc"],
    keywords: [
      "external link",
      "confirm link",
      "open link",
      "http",
      "https",
      "safety",
      "外链",
      "确认",
      "確認",
      "打开链接",
      "開啟連結",
    ],
  },
  {
    id: "appearance.messageActions",
    section: "appearance",
    tab: "interface",
    anchorId: "settings-anchor-messageActions",
    labelKey: "settings.messageActions",
    descKeys: [
      "settings.messageActionsDesc",
      "settings.messageActions.hover",
      "settings.messageActions.always",
    ],
    keywords: [
      "actions",
      "hover",
      "copy buttons",
      "message actions",
      "always show",
      "操作",
      "按钮",
      "按鈕",
      "复制",
      "複製",
    ],
  },
  {
    id: "appearance.messageTimestamps",
    section: "appearance",
    tab: "interface",
    anchorId: "settings-anchor-messageTimestamps",
    labelKey: "settings.messageTimestamps",
    descKeys: ["settings.messageTimestampsDesc"],
    keywords: [
      "timestamp",
      "timestamps",
      "message time",
      "time label",
      "时间戳",
      "时间",
      "時間戳",
    ],
  },
  {
    id: "appearance.messageTimeFormat",
    section: "appearance",
    tab: "interface",
    anchorId: "settings-anchor-messageTimeFormat",
    labelKey: "settings.messageTimeFormat",
    descKeys: [
      "settings.messageTimeFormatDesc",
      "settings.messageTimeFormat.absolute",
      "settings.messageTimeFormat.relative",
    ],
    keywords: [
      "relative time",
      "absolute time",
      "time format",
      "minutes ago",
      "相对时间",
      "绝对时间",
      "相對時間",
      "絕對時間",
      "多久前",
    ],
  },
  // ── account ──
  {
    id: "account.official",
    section: "account",
    tab: "official",
    anchorId: "settings-anchor-account-official",
    labelKey: "settings.tabOfficial",
    descKeys: [
      "settings.tabOfficialHint",
      "account.signedIn",
      "account.loginOauth",
      "account.loginDevice",
      "account.logout",
      "account.subscription",
      "account.quota",
      "account.profiles",
      "account.manageAccounts",
      "account.addAccount",
      "account.importChat",
    ],
    keywords: ["login", "oauth", "supergrok", "quota", "account"],
  },
  {
    id: "account.providers",
    section: "account",
    tab: "providers",
    anchorId: "settings-anchor-account-providers",
    labelKey: "settings.tabProviders",
    descKeys: ["settings.tabProvidersHint"],
    keywords: ["provider", "relay", "custom api", "base url"],
  },
  {
    id: "account.officialApiKey",
    section: "account",
    tab: "providers",
    anchorId: "settings-anchor-official-key",
    labelKey: "prov.officialApiKey",
    descKeys: ["prov.officialVoiceHint", "prov.officialDesc"],
    keywords: [
      "api key",
      "xai",
      "official key",
      "voice",
      "speech",
      "stt",
      "dictation",
      "语音",
      "語音",
      "听写",
    ],
  },
  // ── archived ──
  {
    id: "archived.list",
    section: "archived",
    anchorId: "settings-anchor-archived",
    labelKey: "settings.nav.archived",
    descKeys: [
      "settings.archived.desc",
      "settings.archived.empty",
      "settings.archived.restore",
      "settings.archived.delete",
      "settings.archived.selectAll",
    ],
    keywords: ["archive", "archived chats"],
  },
  // ── extensions ──
  {
    id: "ext.plugins",
    section: "extensions",
    tab: "plugins",
    anchorId: "settings-anchor-ext-plugins",
    labelKey: "ext.plugins.title",
    descKeys: ["ext.lead", "ext.plugins.installLabel"],
    keywords: ["plugin", "plugins", "extensions"],
  },
  {
    id: "ext.skills",
    section: "extensions",
    tab: "skills",
    anchorId: "settings-anchor-ext-skills",
    labelKey: "ext.skills.title",
    keywords: ["skill", "skills", "slash"],
  },
  {
    id: "ext.mcp",
    section: "extensions",
    tab: "mcp",
    anchorId: "settings-anchor-ext-mcp",
    labelKey: "ext.mcp.title",
    descKeys: ["ext.mcp.doctor", "ext.mcp.add"],
    keywords: ["mcp", "model context protocol", "server"],
  },
  {
    id: "ext.hooks",
    section: "extensions",
    tab: "hooks",
    anchorId: "settings-anchor-ext-hooks",
    labelKey: "ext.hooks.title",
    keywords: ["hooks", "hook"],
  },
  {
    id: "ext.market",
    section: "extensions",
    tab: "market",
    anchorId: "settings-anchor-ext-market",
    labelKey: "ext.market.title",
    keywords: ["marketplace", "market", "install plugin"],
  },
  // ── runtime ──
  {
    id: "runtime.cliPath",
    section: "runtime",
    tab: "cli",
    anchorId: "settings-anchor-cliPath",
    labelKey: "settings.cliPath",
    descKeys: ["settings.cliPathDesc"],
    keywords: ["cli", "binary", "grok path", "path"],
  },
  {
    id: "runtime.allowUnverifiedCli",
    section: "runtime",
    tab: "cli",
    anchorId: "settings-anchor-allowUnverifiedCli",
    labelKey: "settings.allowUnverifiedCli",
    descKeys: ["settings.allowUnverifiedCliDesc"],
    keywords: ["checksum", "sha256", "unverified", "cli install", "trust"],
  },
  {
    id: "runtime.acp",
    section: "runtime",
    tab: "connection",
    anchorId: "settings-anchor-acpServer",
    labelKey: "settings.acpServer",
    descKeys: ["settings.acpServerDesc"],
    keywords: ["acp", "remote agent", "host port", "tcp"],
  },
  {
    id: "runtime.maxConcurrent",
    section: "runtime",
    tab: "pool",
    anchorId: "settings-anchor-maxConcurrentAgents",
    labelKey: "settings.maxConcurrentAgents",
    descKeys: ["settings.maxConcurrentAgentsDesc"],
    keywords: ["concurrent", "pool", "parallel agents"],
  },
  {
    id: "runtime.idle",
    section: "runtime",
    tab: "pool",
    anchorId: "settings-anchor-agentIdleMinutes",
    labelKey: "settings.agentIdleMinutes",
    descKeys: ["settings.agentIdleMinutesDesc"],
    keywords: ["idle", "recycle"],
  },
  {
    id: "runtime.stall",
    section: "runtime",
    tab: "pool",
    anchorId: "settings-anchor-streamStallSeconds",
    labelKey: "settings.streamStallSeconds",
    descKeys: ["settings.streamStallSecondsDesc"],
    keywords: ["stall", "timeout", "stream"],
  },
  {
    id: "runtime.doctor",
    section: "runtime",
    tab: "tools",
    anchorId: "settings-anchor-doctor",
    labelKey: "doctor.title",
    descKeys: ["settings.doctorDesc", "settings.runDoctor"],
    keywords: ["doctor", "diagnose"],
  },
  {
    id: "runtime.inspect",
    section: "runtime",
    tab: "tools",
    anchorId: "settings-anchor-inspect",
    labelKey: "inspect.title",
    descKeys: ["inspect.desc"],
    keywords: ["inspect", "project inspect"],
  },
  {
    id: "runtime.managedSetup",
    section: "runtime",
    tab: "tools",
    anchorId: "settings-anchor-managedSetup",
    labelKey: "managedSetup.title",
    keywords: ["managed setup", "grok setup"],
  },
  // ── remote_im (Remote control) ──
  {
    id: "remote_im.root",
    section: "remote_im",
    tab: "im",
    anchorId: "settings-anchor-remote-im",
    labelKey: "settings.tab.remoteIm",
    descKeys: ["settings.nav.remoteIm", "settings.remoteIm.bridgeOverview"],
    keywords: [
      "remote control",
      "remote im",
      "feishu",
      "lark",
      "telegram",
      "bridge",
      "im",
      "远程控制",
      "远程 IM",
    ],
  },
  {
    id: "remote_im.mirror",
    section: "remote_im",
    tab: "mirror",
    anchorId: "settings-anchor-phone-mirror",
    labelKey: "settings.tab.phoneMirror",
    descKeys: [
      "mirror.connect",
      "mirror.connectTitle",
      "mirror.connectHint",
      "settings.nav.remoteIm",
    ],
    keywords: [
      "phone mirror",
      "connect phone",
      "connect device",
      "qr",
      "cloudflared",
      "手机镜像",
      "连接手机",
      "连接设备",
    ],
  },
  // ── shortcuts ──
  {
    id: "shortcuts.table",
    section: "shortcuts",
    anchorId: "settings-anchor-shortcuts",
    labelKey: "settings.shortcuts.title",
    descKeys: [
      "settings.shortcuts.desc",
      "settings.shortcuts.group.workbench",
      "settings.shortcuts.group.navigation",
      "settings.shortcuts.group.diagnostics",
      "settings.shortcuts.group.input",
    ],
    keywords: ["keyboard", "hotkey", "shortcut"],
  },
  // ── about ──
  {
    id: "about.app",
    section: "about",
    anchorId: "settings-anchor-about",
    labelKey: "settings.aboutApp",
    keywords: ["about", "version", "update"],
  },
];

export type SettingsLocation = {
  section: SettingsSectionId;
  tab?: SettingsTabId | null;
  anchorId?: string | null;
};

export function getNavDef(section: SettingsSectionId): SettingsNavDef | undefined {
  return SETTINGS_NAV.find((n) => n.id === section);
}

export function defaultTabFor(section: SettingsSectionId): SettingsTabId | null {
  const nav = getNavDef(section);
  if (!nav || nav.tabs.length === 0) return null;
  return nav.defaultTab ?? nav.tabs[0]!.id;
}

export function isValidTab(
  section: SettingsSectionId,
  tab: string | null | undefined,
): tab is SettingsTabId {
  if (!tab) return false;
  const nav = getNavDef(section);
  return !!nav?.tabs.some((t) => t.id === tab);
}

/** Resolve tab for a section: valid tab, else default, else null. */
export function resolveTab(
  section: SettingsSectionId,
  tab?: string | null,
): SettingsTabId | null {
  if (isValidTab(section, tab)) return tab;
  return defaultTabFor(section);
}

/**
 * Parse hash path after leading #/  e.g. "settings/extensions/mcp"
 * Also accepts "settings" alone.
 */
export function parseSettingsHash(raw: string): SettingsLocation | null {
  const path = raw.replace(/^#\/?/, "").replace(/\/+$/, "");
  if (!path.startsWith("settings")) return null;
  const parts = path.split("/").filter(Boolean);
  // parts[0] === "settings"
  const sectionPart = parts[1];
  const tabPart = parts[2];
  const section: SettingsSectionId = isSettingsSectionId(sectionPart)
    ? sectionPart
    : "general";
  const tab = resolveTab(section, tabPart);
  return { section, tab };
}

/** Build hash without leading # — App adds # when writing location.hash. */
export function buildSettingsHash(loc: SettingsLocation): string {
  const section = isSettingsSectionId(loc.section) ? loc.section : "general";
  const tab = resolveTab(section, loc.tab);
  if (tab) return `#/settings/${section}/${tab}`;
  return `#/settings/${section}`;
}

/** Aggregate i18n keys used for section-level nav filtering (legacy search). */
export function keywordKeysForSection(section: SettingsSectionId): MessageKey[] {
  const keys = new Set<MessageKey>();
  const nav = getNavDef(section);
  if (nav) keys.add(nav.labelKey);
  for (const t of nav?.tabs ?? []) keys.add(t.labelKey);
  for (const e of SETTINGS_ENTRIES) {
    if (e.section !== section) continue;
    keys.add(e.labelKey);
    for (const k of e.descKeys ?? []) keys.add(k);
  }
  return [...keys];
}

export type SettingsSearchHit = {
  entry: SettingsEntry;
  /** Precomputed path label keys for UI: section · tab */
  sectionLabelKey: MessageKey;
  tabLabelKey?: MessageKey;
};

/**
 * Search entries by query against translated label/desc + raw keywords.
 * `translate` should resolve MessageKey → string for the active locale;
 * callers typically also pass an English translator for bilingual match.
 */
export function searchSettingsEntries(
  query: string,
  translate: (key: MessageKey) => string,
  translateEn?: (key: MessageKey) => string,
): SettingsSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const en = translateEn ?? translate;
  const hits: SettingsSearchHit[] = [];
  for (const entry of SETTINGS_ENTRIES) {
    const hay: string[] = [
      entry.id,
      translate(entry.labelKey),
      en(entry.labelKey),
      ...(entry.keywords ?? []),
    ];
    for (const k of entry.descKeys ?? []) {
      hay.push(translate(k), en(k));
    }
    if (!hay.some((h) => h.toLowerCase().includes(q))) continue;
    const nav = getNavDef(entry.section);
    const tabDef = entry.tab
      ? nav?.tabs.find((t) => t.id === entry.tab)
      : undefined;
    hits.push({
      entry,
      sectionLabelKey: nav?.labelKey ?? "settings.nav.general",
      tabLabelKey: tabDef?.labelKey,
    });
  }
  return hits;
}

/** Invariant checks used by unit tests. */
export function catalogInvariants(): string[] {
  const errors: string[] = [];
  const navIds = new Set<string>();
  for (const n of SETTINGS_NAV) {
    if (navIds.has(n.id)) errors.push(`duplicate nav section: ${n.id}`);
    navIds.add(n.id);
    const tabIds = new Set<string>();
    for (const t of n.tabs) {
      if (tabIds.has(t.id)) errors.push(`duplicate tab ${t.id} in ${n.id}`);
      tabIds.add(t.id);
    }
    if (n.defaultTab && !tabIds.has(n.defaultTab)) {
      errors.push(`defaultTab ${n.defaultTab} missing in ${n.id}`);
    }
    if (n.tabs.length > 0 && !n.defaultTab) {
      errors.push(`section ${n.id} has tabs but no defaultTab`);
    }
  }
  for (const id of SETTINGS_SECTION_IDS) {
    if (!navIds.has(id)) errors.push(`section id missing from NAV: ${id}`);
  }
  const entryIds = new Set<string>();
  const anchors = new Set<string>();
  for (const e of SETTINGS_ENTRIES) {
    if (entryIds.has(e.id)) errors.push(`duplicate entry id: ${e.id}`);
    entryIds.add(e.id);
    if (anchors.has(e.anchorId)) errors.push(`duplicate anchor: ${e.anchorId}`);
    anchors.add(e.anchorId);
    if (!navIds.has(e.section)) {
      errors.push(`entry ${e.id} unknown section ${e.section}`);
    }
    if (e.tab && !isValidTab(e.section, e.tab)) {
      errors.push(`entry ${e.id} invalid tab ${e.tab} for ${e.section}`);
    }
  }
  return errors;
}

/**
 * Settings primary navigation — one row per section.
 */

import type { SettingsNavDef } from "./types";

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
      { id: "extras", labelKey: "settings.tabExtras" },
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
    id: "pet",
    icon: "pet",
    labelKey: "settings.nav.pet",
    group: "personal",
    defaultTab: "look",
    tabs: [
      { id: "look", labelKey: "settings.tab.petLook" },
      { id: "bubbles", labelKey: "settings.tab.petBubbles" },
    ],
  },
  {
    id: "extensions",
    icon: "extensions",
    labelKey: "settings.nav.extensions",
    group: "system",
    defaultTab: "plugins",
    tabs: [
      { id: "plugins", labelKey: "ext.plugins.title" },
      { id: "mcp", labelKey: "ext.mcp.title" },
      { id: "skills", labelKey: "ext.skills.title" },
      { id: "rules", labelKey: "ext.rules.title" },
      { id: "commands", labelKey: "ext.commands.title" },
      { id: "agents", labelKey: "ext.agents.title" },
      { id: "hooks", labelKey: "ext.hooks.title" },
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
      { id: "ssh", labelKey: "settings.tab.ssh" },
      { id: "network", labelKey: "settings.tab.network" },
      { id: "pool", labelKey: "settings.tab.pool" },
      { id: "tools", labelKey: "settings.tab.tools" },
      { id: "privacy", labelKey: "settings.tab.privacy" },
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


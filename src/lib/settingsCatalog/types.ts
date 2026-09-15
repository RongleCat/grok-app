/**
 * Settings IA types — section / tab / nav / entry shapes.
 * See docs/llm-wiki/settings-ia.md.
 */

import type { MessageKey } from "@/i18n";

export type SettingsSectionId =
  | "general"
  | "appearance"
  | "account"
  | "archived"
  | "pet"
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
  "pet",
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
  | "extras"
  // extensions (legacy hash segment "market" resolves to plugins — not a live tab)
  | "plugins"
  | "skills"
  | "mcp"
  | "rules"
  | "commands"
  | "agents"
  | "hooks"
  | "market"
  // runtime
  | "cli"
  | "connection"
  | "ssh"
  | "network"
  | "pool"
  | "tools"
  | "privacy"
  // remote control (section id stays remote_im)
  | "im"
  | "mirror"
  // pet
  | "look"
  | "bubbles";

export type SettingsNavGroup = "personal" | "system";

export type SettingsNavIcon =
  | "settings"
  | "appearance"
  | "user"
  | "archive"
  | "pet"
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

export type SettingsLocation = {
  section: SettingsSectionId;
  tab?: SettingsTabId | null;
  anchorId?: string | null;
};

export type SettingsSearchHit = {
  entry: SettingsEntry;
  /** Precomputed path label keys for UI: section · tab */
  sectionLabelKey: MessageKey;
  tabLabelKey?: MessageKey;
};

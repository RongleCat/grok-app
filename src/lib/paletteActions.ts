/**
 * Command-palette quick actions — pure catalog + filter.
 * UI (App search panel) maps ids to existing openers (settings hash, doctor, etc.).
 */

import type { MessageKey } from "@/i18n";

export type PaletteActionDef = {
  /** Stable id used by the host to dispatch (e.g. `settings-general`). */
  id: string;
  /** i18n key for the row label. */
  labelKey: MessageKey;
  /** English (and optional alias) tokens for free-text match. */
  keywords: string[];
  /** Optional UI group hint (host may ignore). */
  group?: string;
};

/** Full default catalog — only actions that already exist in App. */
export function defaultPaletteActions(): PaletteActionDef[] {
  return [
    {
      id: "new-chat",
      labelKey: "search.newChat",
      keywords: ["new", "chat", "conversation", "session", "compose"],
      group: "create",
    },
    {
      id: "add-project",
      labelKey: "sidebar.addProject",
      keywords: ["add", "project", "folder", "open folder", "workspace"],
      group: "create",
    },
    {
      id: "open-automations",
      labelKey: "automations.title",
      keywords: [
        "automations",
        "scheduled",
        "schedule",
        "cron",
        "tasks list",
        "recurring",
      ],
      group: "navigate",
    },
    {
      id: "open-tasks",
      labelKey: "tasks.showPanel",
      keywords: [
        "tasks",
        "agent tasks",
        "tools panel",
        "activity",
        "running tools",
      ],
      group: "navigate",
    },
    {
      id: "doctor",
      labelKey: "doctor.title",
      keywords: ["doctor", "diagnostics", "health", "cli check", "troubleshoot"],
      group: "diagnose",
    },
    {
      id: "shortcuts-help",
      labelKey: "shortcuts.help",
      keywords: ["shortcuts", "keyboard", "hotkeys", "keymap", "help", "?"],
      group: "help",
    },
    {
      id: "product-tutorial",
      labelKey: "tutorial.menu",
      keywords: [
        "tutorial",
        "product tour",
        "tour",
        "onboarding",
        "walkthrough",
        "guide",
        "help",
      ],
      group: "help",
    },
    {
      id: "settings-general",
      labelKey: "settings.nav.general",
      keywords: ["settings", "general", "preferences", "prefs", "composer"],
      group: "settings",
    },
    {
      id: "settings-appearance",
      labelKey: "settings.nav.appearance",
      keywords: [
        "settings",
        "appearance",
        "theme",
        "dark",
        "light",
        "wallpaper",
        "skin",
      ],
      group: "settings",
    },
    {
      id: "settings-account",
      labelKey: "settings.nav.account",
      keywords: [
        "settings",
        "account",
        "login",
        "providers",
        "api key",
        "auth",
      ],
      group: "settings",
    },
    {
      id: "settings-extensions",
      labelKey: "settings.nav.extensions",
      keywords: [
        "settings",
        "extensions",
        "plugins",
        "skills",
        "mcp",
        "hooks",
        "marketplace",
      ],
      group: "settings",
    },
    {
      id: "settings-runtime",
      labelKey: "settings.nav.runtime",
      keywords: [
        "settings",
        "runtime",
        "cli",
        "connection",
        "network",
        "pool",
        "tools",
      ],
      group: "settings",
    },
    {
      id: "settings-remote",
      labelKey: "settings.nav.remoteIm",
      keywords: [
        "settings",
        "remote",
        "remote control",
        "im",
        "mirror",
        "phone",
        "feishu",
        "telegram",
      ],
      group: "settings",
    },
    {
      id: "settings-shortcuts",
      labelKey: "settings.nav.shortcuts",
      keywords: ["settings", "keyboard", "shortcuts", "hotkeys", "bindings"],
      group: "settings",
    },
    {
      id: "settings-about",
      labelKey: "settings.nav.about",
      keywords: ["settings", "about", "version", "update", "license"],
      group: "settings",
    },
  ];
}

/**
 * Filter palette actions by free-text query.
 * - Empty query → all actions (optionally capped by `limit`).
 * - Non-empty → match id, keywords, and translated label (when `t` is provided).
 */
export function filterPaletteActions(
  query: string,
  actions: readonly PaletteActionDef[],
  t?: (key: MessageKey) => string,
  opts?: { limit?: number },
): PaletteActionDef[] {
  const limit = opts?.limit ?? 50;
  const q = query.trim().toLowerCase();
  if (!q) return actions.slice(0, limit);

  const hits: PaletteActionDef[] = [];
  for (const action of actions) {
    if (hits.length >= limit) break;
    if (matchesPaletteAction(action, q, t)) hits.push(action);
  }
  return hits;
}

function matchesPaletteAction(
  action: PaletteActionDef,
  q: string,
  t?: (key: MessageKey) => string,
): boolean {
  const hay: string[] = [
    action.id.toLowerCase(),
    action.labelKey.toLowerCase(),
    ...action.keywords.map((k) => k.toLowerCase()),
  ];
  if (t) hay.push(t(action.labelKey).toLowerCase());

  // Full-string substring (handles "settings-general", single keywords, labels).
  if (hay.some((h) => h.includes(q))) return true;

  // Multi-word: every token must hit somewhere (e.g. "New Chat" → new + chat).
  const tokens = q.split(/[\s/_-]+/).filter(Boolean);
  if (tokens.length > 1) {
    return tokens.every((tok) => hay.some((h) => h.includes(tok)));
  }
  return false;
}

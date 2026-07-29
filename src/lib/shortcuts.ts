/** Keyboard shortcut catalog — help panel + Settings → Keyboard. */

export type ShortcutGroup = "workbench" | "navigation" | "diagnostics" | "input";

export type ShortcutRow = {
  id: string;
  /** i18n message key for the action label */
  labelKey: string;
  group: ShortcutGroup;
  /** Display keys for mac (⌘ is replaced at render time if needed) */
  mac: string;
  /** Display keys for win/linux */
  win: string;
};

/**
 * Shipped shortcuts that already work in the app.
 * Keep this list honest — only document real bindings.
 * Single source for the help modal and Settings → Keyboard.
 */
export const SHORTCUTS: ShortcutRow[] = [
  {
    id: "search",
    labelKey: "shortcuts.search",
    group: "workbench",
    mac: "⌘ K",
    win: "Ctrl K",
  },
  {
    id: "findInChat",
    labelKey: "shortcuts.findInChat",
    group: "workbench",
    mac: "⌘ F",
    win: "Ctrl F",
  },
  {
    id: "newChat",
    labelKey: "shortcuts.newChat",
    group: "workbench",
    mac: "⌘ N",
    win: "Ctrl N",
  },
  {
    id: "send",
    labelKey: "shortcuts.send",
    group: "workbench",
    // Product default: plain Enter (mod-enter only when Settings → Composer pref is set).
    mac: "↵",
    win: "Enter",
  },
  {
    id: "stop",
    labelKey: "shortcuts.stop",
    group: "workbench",
    mac: "Esc",
    win: "Esc",
  },
  {
    id: "copyLastReply",
    labelKey: "shortcuts.copyLastReply",
    group: "workbench",
    mac: "⌘ ⇧ C",
    win: "Ctrl Shift C",
  },
  {
    id: "settings",
    labelKey: "shortcuts.settings",
    group: "navigation",
    mac: "⌘ ,",
    win: "Ctrl ,",
  },
  {
    id: "help",
    labelKey: "shortcuts.help",
    group: "navigation",
    mac: "⌘ /",
    win: "Ctrl /",
  },
  {
    id: "doctor",
    labelKey: "shortcuts.doctor",
    group: "diagnostics",
    mac: "⌘ ⇧ D",
    win: "Ctrl Shift D",
  },
  {
    id: "liveVoice",
    labelKey: "shortcuts.liveVoice",
    group: "input",
    mac: "⌘ ⇧ V",
    win: "Ctrl Shift V",
  },
  {
    // Global Ctrl+Space (not Cmd+Space — Spotlight on macOS). See isVoiceToggleKey.
    id: "dictation",
    labelKey: "shortcuts.voice",
    group: "input",
    mac: "Ctrl Space",
    win: "Ctrl Space",
  },
];

/** Group order for Settings → Keyboard (and optional help grouping). */
export const SHORTCUT_GROUP_ORDER: ShortcutGroup[] = [
  "workbench",
  "navigation",
  "diagnostics",
  "input",
];

export function shortcutsForPlatform(
  platform: "mac" | "win" | "other",
): Array<{ id: string; labelKey: string; keys: string; group: ShortcutGroup }> {
  return SHORTCUTS.map((s) => ({
    id: s.id,
    labelKey: s.labelKey,
    group: s.group,
    keys: platform === "mac" ? s.mac : s.win,
  }));
}

/** Detect host OS for highlighting the active column in Settings. */
export function detectShortcutPlatform(): "mac" | "win" | "other" {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent || "";
  const p = navigator.platform || "";
  if (/Mac|iPhone|iPad|iPod/i.test(p) || /Mac OS X|Macintosh/i.test(ua)) {
    return "mac";
  }
  if (/Win/i.test(p) || /Windows/i.test(ua)) return "win";
  return "other";
}

export function shortcutsByGroup(): Array<{
  group: ShortcutGroup;
  rows: ShortcutRow[];
}> {
  return SHORTCUT_GROUP_ORDER.map((group) => ({
    group,
    rows: SHORTCUTS.filter((s) => s.group === group),
  })).filter((g) => g.rows.length > 0);
}

/**
 * Append Latin aliases for display glyphs (cmd for ⌘, shift for ⇧, …).
 * Original key strings stay intact so queries like "⌘ k" still match.
 */
function keySearchExtra(keys: string): string {
  const parts: string[] = [];
  if (keys.includes("⌘")) parts.push("cmd", "command", "meta");
  if (keys.includes("⇧")) parts.push("shift");
  if (keys.includes("↵")) parts.push("enter", "return");
  if (keys.includes("⌥")) parts.push("option", "alt");
  if (keys.includes("⌃")) parts.push("control", "ctrl");
  return parts.join(" ");
}

/**
 * Filter shortcut rows by free-text query.
 * Case-insensitive match on id, localized label (via `t`), and mac/win key strings
 * (including expanded tokens like "cmd" for ⌘). Empty/whitespace query → all rows.
 */
export function filterShortcutRows(
  query: string,
  rows: ShortcutRow[],
  t: (key: string) => string,
): ShortcutRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => {
    const label = t(row.labelKey).toLowerCase();
    const haystack = [
      row.id,
      label,
      row.mac,
      row.win,
      keySearchExtra(row.mac),
      keySearchExtra(row.win),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

/**
 * Apply {@link filterShortcutRows} per group and drop empty groups.
 * Preserves {@link SHORTCUT_GROUP_ORDER}.
 */
export function filterShortcutGroups(
  query: string,
  groups: Array<{ group: ShortcutGroup; rows: ShortcutRow[] }>,
  t: (key: string) => string,
): Array<{ group: ShortcutGroup; rows: ShortcutRow[] }> {
  return groups
    .map(({ group, rows }) => ({
      group,
      rows: filterShortcutRows(query, rows, t),
    }))
    .filter((g) => g.rows.length > 0);
}

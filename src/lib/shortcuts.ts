/** Keyboard shortcut catalog — help panel + Settings → Keyboard. */

import {
  loadComposerSendKeyPref,
  type ComposerSendKeyPref,
} from "@/lib/composerSendKey";

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
 *
 * The `send` row stores the product default (plain Enter). Live display
 * patches via {@link sendShortcutDisplay} / optional send pref args.
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

/**
 * Display chords for the Send shortcut based on Composer send-key preference.
 * - `enter`: mac `↵`, win `Enter`
 * - `mod-enter`: mac `⌘ ↵`, win `Ctrl Enter`
 */
export function sendShortcutDisplay(
  pref: ComposerSendKeyPref = "enter",
): { mac: string; win: string } {
  if (pref === "mod-enter") {
    return { mac: "⌘ ↵", win: "Ctrl Enter" };
  }
  return { mac: "↵", win: "Enter" };
}

function resolveSendPref(pref?: ComposerSendKeyPref): ComposerSendKeyPref {
  if (pref !== undefined) return pref;
  if (typeof localStorage !== "undefined") {
    try {
      return loadComposerSendKeyPref();
    } catch {
      /* private mode / non-browser */
    }
  }
  return "enter";
}

function withSendPref(
  row: ShortcutRow,
  pref: ComposerSendKeyPref,
): ShortcutRow {
  if (row.id !== "send") return row;
  const keys = sendShortcutDisplay(pref);
  return { ...row, mac: keys.mac, win: keys.win };
}

export function shortcutsForPlatform(
  platform: "mac" | "win" | "other",
  sendPref?: ComposerSendKeyPref,
): Array<{ id: string; labelKey: string; keys: string; group: ShortcutGroup }> {
  const pref = resolveSendPref(sendPref);
  return SHORTCUTS.map((s) => {
    const row = withSendPref(s, pref);
    return {
      id: row.id,
      labelKey: row.labelKey,
      group: row.group,
      keys: platform === "mac" ? row.mac : row.win,
    };
  });
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

export function shortcutsByGroup(
  sendPref?: ComposerSendKeyPref,
): Array<{
  group: ShortcutGroup;
  rows: ShortcutRow[];
}> {
  const pref = resolveSendPref(sendPref);
  return SHORTCUT_GROUP_ORDER.map((group) => ({
    group,
    rows: SHORTCUTS.filter((s) => s.group === group).map((s) =>
      withSendPref(s, pref),
    ),
  })).filter((g) => g.rows.length > 0);
}

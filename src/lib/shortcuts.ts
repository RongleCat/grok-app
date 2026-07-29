/** Keyboard shortcut catalog + global chord matchers (help, Settings, App keydown). */

export type ShortcutGroup = "workbench" | "navigation" | "diagnostics" | "input";

export type ShortcutId =
  | "search"
  | "findInChat"
  | "newChat"
  | "send"
  | "stop"
  | "copyLastReply"
  | "settings"
  | "help"
  | "doctor"
  | "liveVoice"
  | "dictation";

export type ShortcutRow = {
  id: ShortcutId;
  /** i18n message key for the action label */
  labelKey: string;
  group: ShortcutGroup;
  /** Display keys for mac (⌘ is replaced at render time if needed) */
  mac: string;
  /** Display keys for win/linux */
  win: string;
};

/**
 * Stable catalog id order — same as SHORTCUTS.
 * Includes display-only rows (send, stop, dictation) that are not matched by
 * {@link matchGlobalShortcut}.
 */
export const SHORTCUT_IDS: readonly ShortcutId[] = [
  "search",
  "findInChat",
  "newChat",
  "send",
  "stop",
  "copyLastReply",
  "settings",
  "help",
  "doctor",
  "liveVoice",
  "dictation",
] as const;

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

/**
 * Catalog ids handled by {@link matchGlobalShortcut} (mod-based App capture handler).
 * Not included: `send` (composer-local), `stop` (Esc special-cased in App for order
 * vs voice cancel / overlays), `dictation` (Ctrl+Space via `isVoiceToggleKey` —
 * must not use meta, and runs before the mod branch).
 */
export const GLOBAL_MOD_SHORTCUT_IDS = [
  "search",
  "findInChat",
  "newChat",
  "settings",
  "help",
  "doctor",
  "liveVoice",
  "copyLastReply",
] as const satisfies readonly ShortcutId[];

export type GlobalModShortcutId = (typeof GLOBAL_MOD_SHORTCUT_IDS)[number];

/** Normalized chord state for pure global matching (no DOM). */
export type ShortcutChordContext = {
  /** Lowercased `KeyboardEvent.key` (e.g. "k", ",", "/") */
  key: string;
  /** metaKey || ctrlKey */
  mod: boolean;
  shift: boolean;
  alt: boolean;
  /** True when focus is input / textarea / contenteditable */
  typing: boolean;
};

/**
 * Match mod-based global shortcuts that App handles in the capture-phase keydown.
 *
 * Esc-stop and Ctrl+Space dictation stay special-cased in App (handler order /
 * non-mod-or-ctrl-only semantics). See comment on {@link GLOBAL_MOD_SHORTCUT_IDS}.
 *
 * Behavior preserved from the previous inline App handler:
 * - findInChat works while typing
 * - newChat / settings skip when typing
 * - search / help / doctor / copyLastReply / liveVoice work while typing
 */
export function matchGlobalShortcut(
  ctx: ShortcutChordContext,
): GlobalModShortcutId | null {
  if (!ctx.mod) return null;
  // Alt chords are left to the OS / browser (not used by catalog mod actions).
  if (ctx.alt) return null;

  const key = ctx.key;
  const shift = ctx.shift;
  const typing = ctx.typing;

  // findInChat: mod+f without shift (even while typing).
  if (key === "f" && !shift) return "findInChat";
  // search / help: same as prior App handler (no shift gate).
  if (key === "k") return "search";
  if (key === "/") return "help";
  if (key === "," && !typing) return "settings";
  if (key === "n" && !typing) return "newChat";
  if (key === "d" && shift) return "doctor";
  if (key === "c" && shift) return "copyLastReply";
  if (key === "v" && shift) return "liveVoice";

  return null;
}

/** Group order for Settings → Keyboard (and optional help grouping). */
export const SHORTCUT_GROUP_ORDER: ShortcutGroup[] = [
  "workbench",
  "navigation",
  "diagnostics",
  "input",
];

export function shortcutsForPlatform(
  platform: "mac" | "win" | "other",
): Array<{ id: ShortcutId; labelKey: string; keys: string; group: ShortcutGroup }> {
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

/** Keyboard shortcut catalog + global chord matchers (help, Settings, App keydown). */

import {
  loadComposerSendKeyPref,
  type ComposerSendKeyPref,
} from "@/lib/composerSendKey";
import {
  DEFAULT_SHORTCUT_CHORDS,
  buildEffectiveChordMap,
  chordMatchesContext,
  effectiveShortcutChord,
  formatChordDisplay,
  loadShortcutRemaps,
  type ShortcutRemapMap,
} from "@/lib/shortcutRemap";

export type ShortcutGroup = "workbench" | "navigation" | "diagnostics" | "input";

export type ShortcutId =
  | "search"
  | "findInChat"
  | "newChat"
  | "send"
  | "stop"
  | "copyLastReply"
  | "toggleSidebar"
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
  "toggleSidebar",
  "settings",
  "help",
  "doctor",
  "liveVoice",
  "dictation",
];

/**
 * Catalog of shortcuts shown in Settings → Keyboard / help.
 *
 * `send` display strings are patched via {@link sendShortcutDisplay} / optional
 * send pref args (Settings → Composer Enter vs mod-enter).
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
    id: "toggleSidebar",
    labelKey: "shortcuts.toggleSidebar",
    group: "navigation",
    mac: "⌘ B",
    win: "Ctrl B",
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
  "toggleSidebar",
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
 * Effective chords come from catalog defaults + optional user remaps
 * ({@link loadShortcutRemaps}). Pass `remaps` explicitly in tests; runtime
 * loads from localStorage when omitted.
 *
 * Behavior preserved from the previous inline App handler (with defaults):
 * - findInChat works while typing
 * - newChat / settings skip when typing
 * - search / help / doctor / copyLastReply / liveVoice / toggleSidebar work while typing
 *   (toggleSidebar works while typing so composers do not block layout chords)
 */
export function matchGlobalShortcut(
  ctx: ShortcutChordContext,
  remaps?: ShortcutRemapMap | null,
): GlobalModShortcutId | null {
  const map =
    remaps !== undefined && remaps !== null
      ? remaps
      : typeof localStorage !== "undefined"
        ? loadShortcutRemaps()
        : {};

  // Default catalog chords never use Alt; reject Alt unless a remap includes it.
  // (Bare OS/browser Alt chords stay unclaimed.)

  for (const id of GLOBAL_MOD_SHORTCUT_IDS) {
    const chord = effectiveShortcutChord(id, map);
    if (
      !chordMatchesContext(chord, {
        key: ctx.key,
        mod: ctx.mod,
        shift: ctx.shift,
        alt: ctx.alt,
      })
    ) {
      continue;
    }
    // newChat / settings: skip while typing (same as pre-remap handler).
    if ((id === "newChat" || id === "settings") && ctx.typing) {
      continue;
    }
    return id;
  }

  return null;
}

/** Group order for Settings → Keyboard (and optional help grouping). */
export const SHORTCUT_GROUP_ORDER: ShortcutGroup[] = [
  "workbench",
  "navigation",
  "diagnostics",
  "input",
];

/** Display keys for the Send catalog row from the composer send-key preference. */
export function sendShortcutDisplay(pref: ComposerSendKeyPref): {
  mac: string;
  win: string;
} {
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

/** Apply user remaps (and send pref) to a catalog row for display. */
export function withEffectiveBindings(
  row: ShortcutRow,
  opts?: {
    sendPref?: ComposerSendKeyPref;
    remaps?: ShortcutRemapMap | null;
  },
): ShortcutRow {
  const pref = resolveSendPref(opts?.sendPref);
  let next = withSendPref(row, pref);
  const remaps =
    opts?.remaps !== undefined
      ? opts.remaps
      : typeof localStorage !== "undefined"
        ? loadShortcutRemaps()
        : {};
  if (!remaps || !remaps[row.id]) return next;
  const chord = effectiveShortcutChord(row.id, remaps);
  // Prefer formatChordDisplay so remapped rows stay consistent across platforms.
  // Keep send row owned by Composer pref (not remappable).
  if (row.id === "send") return next;
  return {
    ...next,
    mac: formatChordDisplay(chord, "mac"),
    win: formatChordDisplay(chord, "win"),
  };
}

export function shortcutsForPlatform(
  platform: "mac" | "win" | "other",
  sendPref?: ComposerSendKeyPref,
  remaps?: ShortcutRemapMap | null,
): Array<{
  id: ShortcutId;
  labelKey: string;
  keys: string;
  group: ShortcutGroup;
}> {
  const map =
    remaps !== undefined
      ? remaps
      : typeof localStorage !== "undefined"
        ? loadShortcutRemaps()
        : {};
  return SHORTCUTS.map((s) => {
    const row = withEffectiveBindings(s, { sendPref, remaps: map });
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
  remaps?: ShortcutRemapMap | null,
): Array<{ group: ShortcutGroup; rows: ShortcutRow[] }> {
  const map =
    remaps !== undefined
      ? remaps
      : typeof localStorage !== "undefined"
        ? loadShortcutRemaps()
        : {};
  return SHORTCUT_GROUP_ORDER.map((group) => ({
    group,
    rows: SHORTCUTS.filter((s) => s.group === group).map((s) =>
      withEffectiveBindings(s, { sendPref, remaps: map }),
    ),
  }));
}

/** Re-export remap types/helpers used by Settings / App. */
export type { ShortcutRemapMap };
export {
  DEFAULT_SHORTCUT_CHORDS,
  buildEffectiveChordMap,
  loadShortcutRemaps,
};

/** Normalize catalog key glyphs for free-text search (⌘ → cmd, etc.). */
function keySearchExtra(keys: string): string {
  return keys
    .replace(/⌘/g, "cmd command")
    .replace(/⇧/g, "shift")
    .replace(/↵|Return/gi, "enter return")
    .replace(/Esc/gi, "escape esc")
    .toLowerCase();
}

/**
 * Filter catalog rows by free-text query against id, translated label, and key chords.
 * Empty / whitespace query returns all rows (same reference order).
 */
export function filterShortcutRows(
  query: string,
  rows: ShortcutRow[],
  t: (key: string) => string,
): ShortcutRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => {
    const label = t(row.labelKey);
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

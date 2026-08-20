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
import {
  SHORTCUT_KEYS_OFF,
  loadVoiceHotkeyEnabled,
  shouldFireLiveVoiceHotkey,
} from "@/lib/voiceHotkeyPref";

export type ShortcutGroup = "workbench" | "navigation" | "diagnostics" | "input";

/**
 * When a remappable chord may fire:
 * - `global` — app shell / workbench (palette, settings, sidebar, doctor, …)
 * - `chat-focus` — conversation surface (find-in-chat, copy last reply, send, stop)
 *
 * Used for Settings scope column and optional cross-scope conflict ignoring.
 * Does not change App capture matching by itself.
 */
export type ShortcutScope = "global" | "chat-focus";

export type ShortcutId =
  | "search"
  | "findInChat"
  | "newChat"
  | "send"
  | "steer"
  | "stop"
  | "copyLastReply"
  | "toggleSidebar"
  | "toggleRightPane"
  | "sideFiles"
  | "sideBrowser"
  | "sideTerminal"
  | "closeSideTab"
  | "quit"
  | "sidebarSessionNav"
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
  /** Where the action applies (Settings column + conflict scope). */
  scope: ShortcutScope;
  /** Display keys for mac (⌘ is replaced at render time if needed) */
  mac: string;
  /** Display keys for win/linux */
  win: string;
};

/**
 * Stable catalog id order — same as SHORTCUTS.
 * Includes display-only rows (send, steer, stop, dictation, quit, sidebarSessionNav)
 * that are not matched by {@link matchGlobalShortcut}.
 */
export const SHORTCUT_IDS: readonly ShortcutId[] = [
  "search",
  "findInChat",
  "newChat",
  "send",
  "steer",
  "stop",
  "copyLastReply",
  "toggleSidebar",
  "toggleRightPane",
  "sideFiles",
  "sideBrowser",
  "sideTerminal",
  "closeSideTab",
  "quit",
  "sidebarSessionNav",
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
    scope: "global",
    mac: "⌘ K",
    win: "Ctrl K",
  },
  {
    id: "findInChat",
    labelKey: "shortcuts.findInChat",
    group: "workbench",
    scope: "chat-focus",
    mac: "⌘ F",
    win: "Ctrl F",
  },
  {
    id: "newChat",
    labelKey: "shortcuts.newChat",
    group: "workbench",
    scope: "global",
    mac: "⌘ N",
    win: "Ctrl N",
  },
  {
    id: "send",
    labelKey: "shortcuts.send",
    group: "workbench",
    scope: "chat-focus",
    // Product default: plain Enter (mod-enter only when Settings → Composer pref is set).
    mac: "↵",
    win: "Enter",
  },
  {
    // Composer-local. Matches Grok Build CLI default mid-turn chord (Ctrl+Enter).
    id: "steer",
    labelKey: "shortcuts.steer",
    group: "workbench",
    scope: "chat-focus",
    mac: "⌃ ↵",
    win: "Ctrl Enter",
  },
  {
    id: "stop",
    labelKey: "shortcuts.stop",
    group: "workbench",
    scope: "chat-focus",
    mac: "Esc",
    win: "Esc",
  },
  {
    id: "copyLastReply",
    labelKey: "shortcuts.copyLastReply",
    group: "workbench",
    scope: "chat-focus",
    mac: "⌘ ⇧ C",
    win: "Ctrl Shift C",
  },
  {
    id: "toggleSidebar",
    labelKey: "shortcuts.toggleSidebar",
    group: "navigation",
    scope: "global",
    mac: "⌘ B",
    win: "Ctrl B",
  },
  {
    id: "toggleRightPane",
    labelKey: "shortcuts.toggleRightPane",
    group: "navigation",
    scope: "global",
    mac: "⌥ ⌘ B",
    win: "Alt Ctrl B",
  },
  {
    id: "sideFiles",
    labelKey: "shortcuts.sideFiles",
    group: "navigation",
    scope: "global",
    mac: "⌘ P",
    win: "Ctrl P",
  },
  {
    id: "sideBrowser",
    labelKey: "shortcuts.sideBrowser",
    group: "navigation",
    scope: "global",
    mac: "⌘ T",
    win: "Ctrl T",
  },
  {
    /** Toggle the chat-column bottom terminal (VS Code / common ⌘`). */
    id: "sideTerminal",
    labelKey: "shortcuts.sideTerminal",
    group: "navigation",
    scope: "global",
    mac: "⌘ `",
    win: "Ctrl `",
  },
  {
    // Display-only: SideWorkbench capture handler. When side tabs exist →
    // close active tab; when empty → host closes the window (⌘W default).
    id: "closeSideTab",
    labelKey: "shortcuts.closeSideTab",
    group: "navigation",
    scope: "global",
    mac: "⌘ W",
    win: "Ctrl W",
  },
  {
    // Display-only: Ctrl+Q twice (toast, then quit). Not remappable.
    id: "quit",
    labelKey: "shortcuts.quit",
    group: "workbench",
    scope: "global",
    mac: "⌃ Q",
    win: "Ctrl Q",
  },
  {
    // Sidebar-local j/k (not global mod). App handles when focus is in the
    // session list / sidebar; never steals from inputs. Display-only here.
    id: "sidebarSessionNav",
    labelKey: "shortcuts.sidebarSessionNav",
    group: "navigation",
    scope: "global",
    mac: "J / K",
    win: "J / K",
  },
  {
    id: "settings",
    labelKey: "shortcuts.settings",
    group: "navigation",
    scope: "global",
    mac: "⌘ ,",
    win: "Ctrl ,",
  },
  {
    id: "help",
    labelKey: "shortcuts.help",
    group: "navigation",
    scope: "global",
    mac: "⌘ /",
    win: "Ctrl /",
  },
  {
    id: "doctor",
    labelKey: "shortcuts.doctor",
    group: "diagnostics",
    scope: "global",
    mac: "⌘ ⇧ D",
    win: "Ctrl Shift D",
  },
  {
    id: "liveVoice",
    labelKey: "shortcuts.liveVoice",
    group: "input",
    scope: "global",
    mac: "⌘ ⇧ V",
    win: "Ctrl Shift V",
  },
  {
    // Global Ctrl+Space (not Cmd+Space — Spotlight on macOS). See isVoiceToggleKey.
    id: "dictation",
    labelKey: "shortcuts.voice",
    group: "input",
    scope: "global",
    mac: "Ctrl Space",
    win: "Ctrl Space",
  },
];

/** Resolve catalog scope for an id (defaults to `global` for unknown ids). */
export function shortcutScope(id: ShortcutId): ShortcutScope {
  const row = SHORTCUTS.find((s) => s.id === id);
  return row?.scope ?? "global";
}

/**
 * Catalog ids handled by {@link matchGlobalShortcut} (mod-based App capture handler).
 * Not included: `send` / `steer` (composer-local), `stop` (Esc special-cased in App for order
 * vs voice cancel / overlays), `dictation` (Ctrl+Space via `isVoiceToggleKey` —
 * must not use meta, and runs before the mod branch), `sidebarSessionNav` (plain
 * j/k when focus is in the sidebar session list), `closeSideTab` (⌘W / Ctrl+W
 * handled in SideWorkbench — only steals when tabs are open), `quit`
 * (Ctrl+Q twice via `useDoublePressQuit`).
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
  "toggleRightPane",
  "sideFiles",
  "sideBrowser",
  "sideTerminal",
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

/** Optional gates for {@link matchGlobalShortcut} / catalog display. */
export type MatchGlobalShortcutOpts = {
  /**
   * When false, the Live Voice catalog chord does not match
   * (composer / slash / menus stay available). Defaults to loaded pref / true.
   */
  voiceHotkeyEnabled?: boolean;
};

function resolveVoiceHotkeyEnabled(explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  if (typeof localStorage !== "undefined") {
    try {
      return loadVoiceHotkeyEnabled();
    } catch {
      /* private mode / non-browser */
    }
  }
  return true;
}

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
 * - search / help / doctor / copyLastReply / liveVoice / toggleSidebar /
 *   sideFiles / sideBrowser / sideTerminal work while typing
 *   (layout + side / bottom-terminal chords are not blocked by composers)
 * - liveVoice is suppressed when {@link shouldFireLiveVoiceHotkey} is false
 */
export function matchGlobalShortcut(
  ctx: ShortcutChordContext,
  remaps?: ShortcutRemapMap | null,
  opts?: MatchGlobalShortcutOpts,
): GlobalModShortcutId | null {
  const map =
    remaps !== undefined && remaps !== null
      ? remaps
      : typeof localStorage !== "undefined"
        ? loadShortcutRemaps()
        : {};
  const voiceHotkeyEnabled = resolveVoiceHotkeyEnabled(opts?.voiceHotkeyEnabled);

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
    // Live Voice hotkey can be disabled in Settings (composer / menus still work).
    if (id === "liveVoice" && !shouldFireLiveVoiceHotkey(voiceHotkeyEnabled)) {
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

/** Scope order for Settings / help when grouping by {@link ShortcutScope}. */
export const SHORTCUT_SCOPE_ORDER: ShortcutScope[] = ["global", "chat-focus"];

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

/** Apply user remaps (and send / Live Voice hotkey prefs) to a catalog row for display. */
export function withEffectiveBindings(
  row: ShortcutRow,
  opts?: {
    sendPref?: ComposerSendKeyPref;
    remaps?: ShortcutRemapMap | null;
    voiceHotkeyEnabled?: boolean;
  },
): ShortcutRow {
  const pref = resolveSendPref(opts?.sendPref);
  let next = withSendPref(row, pref);
  // Live Voice hotkey disabled → show Off (composer / menus still work).
  if (
    row.id === "liveVoice" &&
    !shouldFireLiveVoiceHotkey(resolveVoiceHotkeyEnabled(opts?.voiceHotkeyEnabled))
  ) {
    return { ...next, mac: SHORTCUT_KEYS_OFF, win: SHORTCUT_KEYS_OFF };
  }
  const remaps =
    opts?.remaps !== undefined
      ? opts.remaps
      : typeof localStorage !== "undefined"
        ? loadShortcutRemaps()
        : {};
  if (!remaps || !remaps[row.id]) return next;
  const chord = effectiveShortcutChord(row.id, remaps);
  // Prefer formatChordDisplay so remapped rows stay consistent across platforms.
  // Keep send / steer rows composer-owned (not remappable).
  if (row.id === "send" || row.id === "steer") return next;
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
  voiceHotkeyEnabled?: boolean,
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
    const row = withEffectiveBindings(s, {
      sendPref,
      remaps: map,
      voiceHotkeyEnabled,
    });
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
  voiceHotkeyEnabled?: boolean,
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
      withEffectiveBindings(s, { sendPref, remaps: map, voiceHotkeyEnabled }),
    ),
  }));
}

/**
 * Group catalog rows by {@link ShortcutScope} (global vs chat-focus).
 * Preserves {@link SHORTCUT_SCOPE_ORDER}; drops empty scopes.
 * Does not apply remaps / send pref — pass pre-bound rows when needed.
 */
export function shortcutsByScope(
  rows: readonly ShortcutRow[] = SHORTCUTS,
): Array<{ scope: ShortcutScope; rows: ShortcutRow[] }> {
  return SHORTCUT_SCOPE_ORDER.map((scope) => ({
    scope,
    rows: rows.filter((s) => s.scope === scope),
  })).filter((g) => g.rows.length > 0);
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
      row.scope,
      row.scope === "chat-focus" ? "chat focus" : "global",
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

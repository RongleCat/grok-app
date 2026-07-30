/**
 * User remappable keyboard shortcuts.
 *
 * Storage: localStorage map of catalog id → unified chord string
 * (e.g. "mod+k", "mod+shift+c", "ctrl+space"). `mod` is ⌘ on macOS and
 * Ctrl on Windows/Linux (matches metaKey || ctrlKey at runtime).
 *
 * Pure parse / conflict helpers live here; Settings + App load via
 * {@link loadShortcutRemaps} / {@link effectiveShortcutChord}.
 */

import type { ShortcutId } from "@/lib/shortcuts";

export const SHORTCUT_REMAP_STORAGE_KEY = "grok.shortcutRemap";

/** Fired on `window` after a same-tab remap save (storage events are cross-tab only). */
export const SHORTCUT_REMAP_CHANGED_EVENT = "grok:shortcutRemap";

/** Unified chord string, tokens joined by `+` (order: mod|ctrl, alt, shift, key). */
export type ChordString = string;

export type ParsedChord = {
  /** Lowercased key (`"k"`, `","`, `"/"`, `"escape"`, `" "`, …). */
  key: string;
  /** Cmd/Ctrl primary — match `metaKey || ctrlKey`. */
  mod: boolean;
  /** Explicit Ctrl only (e.g. dictation). When set without `mod`, require ctrl && !meta. */
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
};

/** Catalog defaults as unified chords (send is display-only here; Composer owns Enter pref). */
export const DEFAULT_SHORTCUT_CHORDS: Record<ShortcutId, ChordString> = {
  search: "mod+k",
  findInChat: "mod+f",
  newChat: "mod+n",
  send: "enter",
  stop: "escape",
  copyLastReply: "mod+shift+c",
  toggleSidebar: "mod+b",
  settings: "mod+,",
  help: "mod+/",
  doctor: "mod+shift+d",
  liveVoice: "mod+shift+v",
  dictation: "ctrl+space",
};

/**
 * Ids that honor user remaps in the App capture-phase mod handler.
 * Subset of catalog — send / stop / dictation stay special-cased elsewhere.
 */
export const REMAPPABLE_SHORTCUT_IDS = [
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

export type RemappableShortcutId = (typeof REMAPPABLE_SHORTCUT_IDS)[number];

export type ShortcutRemapMap = Partial<Record<ShortcutId, ChordString>>;

const REMAPPABLE_SET = new Set<string>(REMAPPABLE_SHORTCUT_IDS);

const KNOWN_IDS = new Set<string>(Object.keys(DEFAULT_SHORTCUT_CHORDS));

/** True while Settings is capturing a chord (App global handler should no-op). */
let shortcutRecordingActive = false;

export function setShortcutRecordingActive(active: boolean): void {
  shortcutRecordingActive = active;
}

export function isShortcutRecordingActive(): boolean {
  return shortcutRecordingActive;
}

export function isRemappableShortcutId(id: string): id is RemappableShortcutId {
  return REMAPPABLE_SET.has(id);
}

/**
 * Parse a unified chord string into flags + key.
 * Accepts flexible tokens: `cmd`/`meta`/`⌘` → mod, `ctrl`/`control`, `shift`/`⇧`, etc.
 */
export function parseChord(raw: string): ParsedChord | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;

  const parts = s.split("+").filter(Boolean);
  if (parts.length === 0) return null;

  let mod = false;
  let ctrl = false;
  let shift = false;
  let alt = false;
  let key: string | null = null;

  for (const p of parts) {
    if (
      p === "mod" ||
      p === "cmd" ||
      p === "command" ||
      p === "meta" ||
      p === "⌘" ||
      p === "super" ||
      p === "win"
    ) {
      mod = true;
      continue;
    }
    if (p === "ctrl" || p === "control" || p === "ctl") {
      ctrl = true;
      continue;
    }
    if (p === "shift" || p === "⇧") {
      shift = true;
      continue;
    }
    if (p === "alt" || p === "option" || p === "opt" || p === "⌥") {
      alt = true;
      continue;
    }
    if (key !== null) return null;
    if (p === "space" || p === "spacebar") {
      key = " ";
    } else if (p === "esc" || p === "escape") {
      key = "escape";
    } else if (p === "enter" || p === "return" || p === "↵") {
      key = "enter";
    } else if (p === "comma") {
      key = ",";
    } else if (p === "slash" || p === "forwardslash") {
      key = "/";
    } else if (p === "period" || p === "dot") {
      key = ".";
    } else if (p.length === 1) {
      key = p;
    } else if (/^f\d{1,2}$/.test(p)) {
      key = p;
    } else {
      // Multi-char key names (arrowup, tab, …)
      key = p;
    }
  }

  if (key === null) return null;

  // `mod` subsumes bare `ctrl` when both tokens present.
  if (mod && ctrl) ctrl = false;

  return { key, mod, ctrl, shift, alt };
}

/** Canonical serialize (stable for storage + conflict compare). */
export function serializeChord(p: ParsedChord): ChordString {
  const parts: string[] = [];
  if (p.mod) parts.push("mod");
  else if (p.ctrl) parts.push("ctrl");
  if (p.alt) parts.push("alt");
  if (p.shift) parts.push("shift");
  if (p.key === " ") parts.push("space");
  else parts.push(p.key);
  return parts.join("+");
}

/** Normalize raw input to canonical chord string, or null if invalid. */
export function normalizeChordString(raw: string): ChordString | null {
  const p = parseChord(raw);
  if (!p) return null;
  return serializeChord(p);
}

export type ChordMatchContext = {
  /** Lowercased `KeyboardEvent.key` */
  key: string;
  /** metaKey || ctrlKey */
  mod: boolean;
  shift: boolean;
  alt: boolean;
  /** Optional: precise ctrl / meta when available (dictation-style). */
  metaKey?: boolean;
  ctrlKey?: boolean;
};

/**
 * Whether a parsed / string chord matches a key event context.
 * - `mod` requires meta||ctrl
 * - bare `ctrl` (no mod) requires ctrl && !meta when meta/ctrl flags provided; else falls back to mod
 */
export function chordMatchesContext(
  chord: ChordString | ParsedChord,
  ctx: ChordMatchContext,
): boolean {
  const p = typeof chord === "string" ? parseChord(chord) : chord;
  if (!p) return false;

  const ctxKey = ctx.key.length === 1 ? ctx.key.toLowerCase() : ctx.key.toLowerCase();
  if (p.key !== ctxKey) return false;
  if (p.shift !== ctx.shift) return false;
  if (p.alt !== ctx.alt) return false;

  if (p.mod) {
    return ctx.mod;
  }
  if (p.ctrl) {
    if (ctx.metaKey !== undefined || ctx.ctrlKey !== undefined) {
      return !!ctx.ctrlKey && !ctx.metaKey;
    }
    return ctx.mod;
  }
  // Bare key: no mod held
  return !ctx.mod;
}

/**
 * Build a unified chord from a keydown event while recording.
 * Returns null for pure modifier keys or bare letter keys (need a modifier).
 * Escape is allowed as a bare key (cancel is handled by the UI layer if desired).
 */
export function chordFromKeyboardEvent(e: {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): ChordString | null {
  const { key } = e;
  if (
    key === "Control" ||
    key === "Meta" ||
    key === "Shift" ||
    key === "Alt" ||
    key === "AltGraph" ||
    key === "OS" ||
    key === "Hyper" ||
    key === "Super"
  ) {
    return null;
  }

  const hasMod = e.metaKey || e.ctrlKey;
  const isBareEscape = key === "Escape" && !hasMod && !e.altKey && !e.shiftKey;
  const isFn =
    /^F\d{1,2}$/i.test(key) && !hasMod && !e.altKey && !e.shiftKey;

  // Global remaps must not steal bare typing keys.
  if (!hasMod && !e.altKey && !isBareEscape && !isFn) {
    return null;
  }

  const parts: string[] = [];
  if (hasMod) {
    // Ctrl+Space without Meta stays ctrl-only (dictation style).
    if (e.ctrlKey && !e.metaKey && key === " ") {
      parts.push("ctrl");
    } else {
      parts.push("mod");
    }
  }
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");

  let keyTok: string;
  if (key === " ") keyTok = "space";
  else if (key === "Escape") keyTok = "escape";
  else if (key === "Enter") keyTok = "enter";
  else if (key === "Tab") keyTok = "tab";
  else if (key === "Backspace") keyTok = "backspace";
  else if (key === "Delete") keyTok = "delete";
  else if (key === "ArrowUp") keyTok = "arrowup";
  else if (key === "ArrowDown") keyTok = "arrowdown";
  else if (key === "ArrowLeft") keyTok = "arrowleft";
  else if (key === "ArrowRight") keyTok = "arrowright";
  else if (key.length === 1) keyTok = key.toLowerCase();
  else keyTok = key.toLowerCase();

  parts.push(keyTok);
  return normalizeChordString(parts.join("+"));
}

/** Display string for Settings / help (mac glyphs vs Ctrl/Shift words). */
export function formatChordDisplay(
  chord: ChordString,
  platform: "mac" | "win" | "other",
): string {
  const p = parseChord(chord);
  if (!p) return chord;

  const parts: string[] = [];
  const mac = platform === "mac";

  if (p.mod) parts.push(mac ? "⌘" : "Ctrl");
  else if (p.ctrl) parts.push("Ctrl");
  if (p.alt) parts.push(mac ? "⌥" : "Alt");
  if (p.shift) parts.push(mac ? "⇧" : "Shift");

  let k: string;
  if (p.key === " ") k = "Space";
  else if (p.key === "escape") k = "Esc";
  else if (p.key === "enter") k = mac ? "↵" : "Enter";
  else if (p.key === "tab") k = "Tab";
  else if (p.key === ",") k = ",";
  else if (p.key === "/") k = "/";
  else if (p.key === ".") k = ".";
  else if (p.key.length === 1) k = p.key.toUpperCase();
  else if (/^f\d{1,2}$/.test(p.key)) k = p.key.toUpperCase();
  else k = p.key.charAt(0).toUpperCase() + p.key.slice(1);

  parts.push(k);
  return parts.join(" ");
}

/** Effective chord for an id (custom remap or catalog default). */
export function effectiveShortcutChord(
  id: ShortcutId,
  remaps?: ShortcutRemapMap | null,
): ChordString {
  const custom = remaps?.[id];
  if (custom) {
    const n = normalizeChordString(custom);
    if (n) return n;
  }
  return DEFAULT_SHORTCUT_CHORDS[id];
}

/** Full id → effective chord map (defaults + remaps). */
export function buildEffectiveChordMap(
  remaps?: ShortcutRemapMap | null,
): Record<ShortcutId, ChordString> {
  const out = { ...DEFAULT_SHORTCUT_CHORDS };
  if (remaps) {
    for (const id of Object.keys(remaps) as ShortcutId[]) {
      if (!KNOWN_IDS.has(id)) continue;
      const n = remaps[id] ? normalizeChordString(remaps[id]!) : null;
      if (n) out[id] = n;
    }
  }
  return out;
}

/**
 * If `candidateChord` is already used by another shortcut id in `effectiveMap`,
 * return that id; otherwise null.
 */
export function findChordConflict(
  candidateId: ShortcutId,
  candidateChord: ChordString,
  effectiveMap: Readonly<Partial<Record<ShortcutId, ChordString>>>,
): ShortcutId | null {
  const norm = normalizeChordString(candidateChord);
  if (!norm) return null;
  for (const id of Object.keys(effectiveMap) as ShortcutId[]) {
    if (id === candidateId) continue;
    const other = effectiveMap[id];
    if (!other) continue;
    if (normalizeChordString(other) === norm) return id;
  }
  return null;
}

export function loadShortcutRemaps(
  storage: Storage = localStorage,
): ShortcutRemapMap {
  try {
    const raw = storage.getItem(SHORTCUT_REMAP_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: ShortcutRemapMap = {};
    for (const [id, chord] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (!isRemappableShortcutId(id)) continue;
      if (typeof chord !== "string") continue;
      const n = normalizeChordString(chord);
      if (!n) continue;
      if (n === DEFAULT_SHORTCUT_CHORDS[id]) continue;
      out[id] = n;
    }
    return out;
  } catch {
    return {};
  }
}

function dispatchRemapChanged(map: ShortcutRemapMap): void {
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(SHORTCUT_REMAP_CHANGED_EVENT, { detail: map }),
      );
    }
  } catch {
    /* ignore */
  }
}

export function saveShortcutRemaps(
  map: ShortcutRemapMap,
  storage: Storage = localStorage,
): void {
  const cleaned: ShortcutRemapMap = {};
  for (const [id, chord] of Object.entries(map) as Array<
    [ShortcutId, ChordString | undefined]
  >) {
    if (!isRemappableShortcutId(id) || !chord) continue;
    const n = normalizeChordString(chord);
    if (!n || n === DEFAULT_SHORTCUT_CHORDS[id]) continue;
    cleaned[id] = n;
  }
  try {
    if (Object.keys(cleaned).length === 0) {
      storage.removeItem(SHORTCUT_REMAP_STORAGE_KEY);
    } else {
      storage.setItem(SHORTCUT_REMAP_STORAGE_KEY, JSON.stringify(cleaned));
    }
  } catch {
    /* private mode */
  }
  dispatchRemapChanged(cleaned);
}

/** Set one remap (`null` / empty resets to default). Returns the full map. */
export function setShortcutRemap(
  id: ShortcutId,
  chord: ChordString | null,
  storage: Storage = localStorage,
): ShortcutRemapMap {
  const map = loadShortcutRemaps(storage);
  if (!isRemappableShortcutId(id)) return map;
  if (chord === null || chord.trim() === "") {
    delete map[id];
  } else {
    const n = normalizeChordString(chord);
    if (!n || n === DEFAULT_SHORTCUT_CHORDS[id]) {
      delete map[id];
    } else {
      map[id] = n;
    }
  }
  saveShortcutRemaps(map, storage);
  return loadShortcutRemaps(storage);
}

export function clearAllShortcutRemaps(
  storage: Storage = localStorage,
): ShortcutRemapMap {
  saveShortcutRemaps({}, storage);
  return {};
}

export function hasAnyShortcutRemaps(
  remaps?: ShortcutRemapMap | null,
): boolean {
  const map = remaps ?? loadShortcutRemaps();
  return Object.keys(map).length > 0;
}

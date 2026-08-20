import { describe, expect, it, beforeEach } from "vitest";
import { shortcutScope } from "./shortcuts";
import {
  CHORD_CONFLICT_IGNORE_IDS,
  DEFAULT_IGNORE_CROSS_SCOPE_CONFLICTS,
  DEFAULT_SHORTCUT_CHORDS,
  REMAPPABLE_SHORTCUT_IDS,
  SHORTCUT_IGNORE_CROSS_SCOPE_STORAGE_KEY,
  SHORTCUT_REMAP_STORAGE_KEY,
  buildEffectiveChordMap,
  chordFromKeyboardEvent,
  chordMatchesContext,
  clearAllShortcutRemaps,
  effectiveShortcutChord,
  findChordConflict,
  findChordConflicts,
  formatChordDisplay,
  hasAnyShortcutRemaps,
  loadIgnoreCrossScopeConflicts,
  loadShortcutRemaps,
  normalizeChordString,
  parseChord,
  parseIgnoreCrossScopeConflicts,
  planResetAllShortcutRemaps,
  resetConflictingShortcutRemaps,
  saveIgnoreCrossScopeConflicts,
  saveShortcutRemaps,
  serializeChord,
  setShortcutRemap,
  summarizeChordConflicts,
} from "./shortcutRemap";

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

describe("parseChord / serializeChord", () => {
  it("parses mod+key defaults", () => {
    expect(parseChord("mod+k")).toEqual({
      key: "k",
      mod: true,
      ctrl: false,
      shift: false,
      alt: false,
    });
    expect(parseChord("mod+shift+c")).toEqual({
      key: "c",
      mod: true,
      ctrl: false,
      shift: true,
      alt: false,
    });
    expect(parseChord("mod+,")).toEqual({
      key: ",",
      mod: true,
      ctrl: false,
      shift: false,
      alt: false,
    });
  });

  it("accepts aliases and whitespace", () => {
    expect(normalizeChordString("Cmd + K")).toBe("mod+k");
    expect(normalizeChordString("⌘+Shift+D")).toBe("mod+shift+d");
    expect(normalizeChordString("ctrl+space")).toBe("ctrl+space");
    expect(normalizeChordString("Escape")).toBe("escape");
  });

  it("rejects empty / double keys / modifiers-only", () => {
    expect(parseChord("")).toBeNull();
    expect(parseChord("mod")).toBeNull();
    expect(parseChord("mod+k+p")).toBeNull();
    expect(parseChord("   ")).toBeNull();
  });

  it("round-trips serialize", () => {
    for (const chord of Object.values(DEFAULT_SHORTCUT_CHORDS)) {
      const p = parseChord(chord);
      expect(p).not.toBeNull();
      expect(serializeChord(p!)).toBe(normalizeChordString(chord));
    }
  });
});

describe("chordMatchesContext", () => {
  it("matches mod chords like the catalog defaults", () => {
    expect(
      chordMatchesContext("mod+k", {
        key: "k",
        mod: true,
        shift: false,
        alt: false,
      }),
    ).toBe(true);
    expect(
      chordMatchesContext("mod+shift+c", {
        key: "c",
        mod: true,
        shift: true,
        alt: false,
      }),
    ).toBe(true);
    expect(
      chordMatchesContext("mod+k", {
        key: "k",
        mod: false,
        shift: false,
        alt: false,
      }),
    ).toBe(false);
    expect(
      chordMatchesContext("mod+k", {
        key: "k",
        mod: true,
        shift: true,
        alt: false,
      }),
    ).toBe(false);
  });

  it("matches ctrl-only when meta/ctrl flags provided", () => {
    expect(
      chordMatchesContext("ctrl+space", {
        key: " ",
        mod: true,
        shift: false,
        alt: false,
        ctrlKey: true,
        metaKey: false,
      }),
    ).toBe(true);
    expect(
      chordMatchesContext("ctrl+space", {
        key: " ",
        mod: true,
        shift: false,
        alt: false,
        ctrlKey: false,
        metaKey: true,
      }),
    ).toBe(false);
  });
});

describe("chordFromKeyboardEvent", () => {
  it("builds mod chords from meta/ctrl + key", () => {
    expect(
      chordFromKeyboardEvent({
        key: "k",
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe("mod+k");
    expect(
      chordFromKeyboardEvent({
        key: "C",
        metaKey: false,
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
      }),
    ).toBe("mod+shift+c");
  });

  it("rejects pure modifiers and bare letters", () => {
    expect(
      chordFromKeyboardEvent({
        key: "Meta",
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeNull();
    expect(
      chordFromKeyboardEvent({
        key: "a",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeNull();
  });

  it("allows bare Escape", () => {
    expect(
      chordFromKeyboardEvent({
        key: "Escape",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe("escape");
  });

  it("stores Ctrl+Space as ctrl+space", () => {
    expect(
      chordFromKeyboardEvent({
        key: " ",
        metaKey: false,
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe("ctrl+space");
  });
});

describe("findChordConflict", () => {
  it("detects duplicate chords across ids", () => {
    const effective = buildEffectiveChordMap();
    expect(findChordConflict("search", "mod+k", effective)).toBeNull();
    // mod+k is search's default — assigning to newChat conflicts with search
    expect(findChordConflict("newChat", "mod+k", effective)).toBe("search");
    // mod+y is free (not a catalog default)
    expect(findChordConflict("search", "mod+y", effective)).toBeNull();
    // mod+p is sideFiles default
    expect(findChordConflict("search", "mod+p", effective)).toBe("sideFiles");
  });

  it("ignores self when checking candidate against effective map with custom", () => {
    const effective = buildEffectiveChordMap({ search: "mod+y" });
    expect(findChordConflict("search", "mod+y", effective)).toBeNull();
    expect(findChordConflict("help", "mod+y", effective)).toBe("search");
  });

  it("skips display-only conflict-ignore ids", () => {
    const effective = buildEffectiveChordMap();
    // send default is enter — ignored even if present in the map
    expect(findChordConflict("stop", "enter", effective)).toBeNull();
  });
});

describe("findChordConflicts", () => {
  it("returns empty when all defaults are unique", () => {
    expect(findChordConflicts({})).toEqual([]);
    expect(findChordConflicts(null)).toEqual([]);
  });

  it("groups ids that share a normalized chord after remaps", () => {
    // newChat remapped onto search's default mod+k
    const groups = findChordConflicts({ newChat: "mod+k" });
    expect(groups).toEqual([
      { chord: "mod+k", ids: ["newChat", "search"] },
    ]);
  });

  it("detects two remaps colliding on a free chord", () => {
    const groups = findChordConflicts({
      search: "mod+y",
      help: "mod+y",
    });
    expect(groups).toEqual([{ chord: "mod+y", ids: ["help", "search"] }]);
  });

  it("normalizes aliases before comparing", () => {
    const groups = findChordConflicts({
      search: "Cmd+Y",
      settings: "mod+y",
    });
    expect(groups).toEqual([
      { chord: "mod+y", ids: ["search", "settings"] },
    ]);
  });

  it("reports three-way collisions", () => {
    const groups = findChordConflicts({
      newChat: "mod+k",
      help: "mod+k",
    });
    expect(groups).toEqual([
      { chord: "mod+k", ids: ["help", "newChat", "search"] },
    ]);
  });

  it("excludes display-only ignore ids (send / sidebarSessionNav)", () => {
    expect(CHORD_CONFLICT_IGNORE_IDS.has("send")).toBe(true);
    expect(CHORD_CONFLICT_IGNORE_IDS.has("steer")).toBe(true);
    expect(CHORD_CONFLICT_IGNORE_IDS.has("sidebarSessionNav")).toBe(true);
    // Even if a remap used bare "j", sidebarSessionNav must not join a group.
    // (Recording UI cannot bind bare j; this guards the pure helper.)
    const groups = findChordConflicts({
      // force a map that would collide with sidebarSessionNav's default "j"
      // if it were included — use a custom defaults override instead:
    });
    expect(groups).toEqual([]);
    // Custom defaults: pretend search default is "j" alongside sidebarSessionNav
    const withDefaults = findChordConflicts(
      {},
      { ...DEFAULT_SHORTCUT_CHORDS, search: "j" },
    );
    // sidebarSessionNav ignored → search alone on "j" → no conflict group
    expect(withDefaults.some((g) => g.chord === "j")).toBe(false);
  });

  it("accepts an explicit defaults map", () => {
    const groups = findChordConflicts(
      { search: "mod+x" },
      {
        search: "mod+a",
        help: "mod+x",
      },
    );
    expect(groups).toEqual([{ chord: "mod+x", ids: ["help", "search"] }]);
  });

  it("optionally ignores cross-scope collisions (global vs chat-focus)", () => {
    // findInChat is chat-focus; search is global — same chord.
    const remaps = { findInChat: "mod+k" as const };
    // Default: still a conflict.
    expect(findChordConflicts(remaps)).toEqual([
      { chord: "mod+k", ids: ["findInChat", "search"] },
    ]);
    // With ignore + scopeOf: no same-scope multi-id group.
    expect(
      findChordConflicts(remaps, DEFAULT_SHORTCUT_CHORDS, {
        ignoreCrossScope: true,
        scopeOf: shortcutScope,
      }),
    ).toEqual([]);
    // Same-scope still conflicts (search + help are both global).
    expect(
      findChordConflicts(
        { help: "mod+k" },
        DEFAULT_SHORTCUT_CHORDS,
        { ignoreCrossScope: true, scopeOf: shortcutScope },
      ),
    ).toEqual([{ chord: "mod+k", ids: ["help", "search"] }]);
  });

  it("findChordConflict honors ignoreCrossScope with scopeOf", () => {
    const effective = buildEffectiveChordMap({ findInChat: "mod+k" });
    // Without opts: findInChat conflicts with search's default.
    expect(findChordConflict("search", "mod+k", effective)).toBe("findInChat");
    // With ignore: search (global) may keep mod+k while findInChat also has it.
    expect(
      findChordConflict("search", "mod+k", effective, {
        ignoreCrossScope: true,
        scopeOf: shortcutScope,
      }),
    ).toBeNull();
    // Same-scope still blocked.
    expect(
      findChordConflict("help", "mod+k", effective, {
        ignoreCrossScope: true,
        scopeOf: shortcutScope,
      }),
    ).toBe("search");
  });

  it("ignoreCrossScope without scopeOf is a no-op", () => {
    const groups = findChordConflicts(
      { findInChat: "mod+k" },
      DEFAULT_SHORTCUT_CHORDS,
      { ignoreCrossScope: true },
    );
    expect(groups).toEqual([
      { chord: "mod+k", ids: ["findInChat", "search"] },
    ]);
  });
});

describe("ignore cross-scope conflicts pref", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it("defaults to false and round-trips", () => {
    expect(DEFAULT_IGNORE_CROSS_SCOPE_CONFLICTS).toBe(false);
    expect(loadIgnoreCrossScopeConflicts(storage)).toBe(false);
    saveIgnoreCrossScopeConflicts(true, storage);
    expect(storage.getItem(SHORTCUT_IGNORE_CROSS_SCOPE_STORAGE_KEY)).toBe("1");
    expect(loadIgnoreCrossScopeConflicts(storage)).toBe(true);
    saveIgnoreCrossScopeConflicts(false, storage);
    expect(loadIgnoreCrossScopeConflicts(storage)).toBe(false);
  });

  it("parses known tokens and falls back on junk", () => {
    expect(parseIgnoreCrossScopeConflicts("1")).toBe(true);
    expect(parseIgnoreCrossScopeConflicts("true")).toBe(true);
    expect(parseIgnoreCrossScopeConflicts("0")).toBe(false);
    expect(parseIgnoreCrossScopeConflicts("nope")).toBe(false);
    expect(parseIgnoreCrossScopeConflicts(null)).toBe(false);
  });
});

describe("resetConflictingShortcutRemaps", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it("clears remaps that participate in conflicts and leaves others", () => {
    setShortcutRemap("search", "mod+y", storage);
    setShortcutRemap("help", "mod+y", storage);
    setShortcutRemap("doctor", "mod+shift+x", storage);

    const next = resetConflictingShortcutRemaps(
      loadShortcutRemaps(storage),
      storage,
    );
    expect(next).toEqual({ doctor: "mod+shift+x" });
    expect(findChordConflicts(next)).toEqual([]);
  });

  it("resets a remap that steals another action's default chord", () => {
    setShortcutRemap("newChat", "mod+k", storage);
    const next = resetConflictingShortcutRemaps(undefined, storage);
    expect(next).toEqual({});
    expect(findChordConflicts(next)).toEqual([]);
  });

  it("is a no-op when there are no conflicts", () => {
    // mod+y is free — not a catalog default
    setShortcutRemap("search", "mod+y", storage);
    const next = resetConflictingShortcutRemaps(
      loadShortcutRemaps(storage),
      storage,
    );
    expect(next).toEqual({ search: "mod+y" });
  });
});

describe("formatChordDisplay", () => {
  it("formats for mac and win", () => {
    expect(formatChordDisplay("mod+k", "mac")).toBe("⌘ K");
    expect(formatChordDisplay("mod+k", "win")).toBe("Ctrl K");
    expect(formatChordDisplay("mod+shift+c", "mac")).toBe("⌘ ⇧ C");
    expect(formatChordDisplay("mod+shift+c", "win")).toBe("Ctrl Shift C");
    expect(formatChordDisplay("mod+,", "mac")).toBe("⌘ ,");
    expect(formatChordDisplay("ctrl+space", "mac")).toBe("Ctrl Space");
  });
});

describe("summarizeChordConflicts", () => {
  it("returns zeros for empty groups", () => {
    expect(summarizeChordConflicts([])).toEqual({
      groupCount: 0,
      chordCount: 0,
      idCount: 0,
      bindingCount: 0,
      remappedCount: 0,
    });
  });

  it("counts groups, unique chords/ids, and remapped participants", () => {
    const groups = findChordConflicts({
      help: "mod+k",
      doctor: "mod+f",
    });
    // help steals search's mod+k; doctor steals findInChat's mod+f
    expect(groups.length).toBe(2);
    const summary = summarizeChordConflicts(groups, {
      help: "mod+k",
      doctor: "mod+f",
    });
    expect(summary.groupCount).toBe(2);
    expect(summary.chordCount).toBe(2);
    expect(summary.idCount).toBe(4); // help+search, doctor+findInChat
    expect(summary.bindingCount).toBe(4);
    // only the remapped ids among conflict participants
    expect(summary.remappedCount).toBe(2);
  });

  it("treats remappedCount as 0 when remaps omitted", () => {
    const groups = findChordConflicts({ help: "mod+k" });
    expect(summarizeChordConflicts(groups).remappedCount).toBe(0);
  });
});

describe("planResetAllShortcutRemaps", () => {
  it("plans empty map as no-op", () => {
    expect(planResetAllShortcutRemaps({})).toEqual({
      ids: [],
      count: 0,
      hasAny: false,
    });
    expect(planResetAllShortcutRemaps(null)).toEqual({
      ids: [],
      count: 0,
      hasAny: false,
    });
    expect(planResetAllShortcutRemaps(undefined)).toEqual({
      ids: [],
      count: 0,
      hasAny: false,
    });
  });

  it("lists sorted remappable ids without writing storage", () => {
    const remaps = {
      doctor: "mod+shift+x",
      search: "mod+y",
    } as const;
    const plan = planResetAllShortcutRemaps(remaps);
    expect(plan).toEqual({
      ids: ["doctor", "search"],
      count: 2,
      hasAny: true,
    });
    expect(hasAnyShortcutRemaps(remaps)).toBe(true);
    // Pure: original map unchanged
    expect(remaps).toEqual({
      doctor: "mod+shift+x",
      search: "mod+y",
    });
  });

  it("ignores non-remappable keys if present", () => {
    // `send` is a catalog id but not remappable — plan must not list it.
    const plan = planResetAllShortcutRemaps({
      search: "mod+y",
      send: "mod+enter",
    });
    expect(plan.ids).toEqual(["search"]);
    expect(plan.count).toBe(1);
  });
});

describe("load / save remaps", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it("starts empty and falls back to defaults", () => {
    expect(loadShortcutRemaps(storage)).toEqual({});
    expect(effectiveShortcutChord("search", {})).toBe("mod+k");
    expect(effectiveShortcutChord("search", { search: "mod+y" })).toBe(
      "mod+y",
    );
  });

  it("persists only remappable non-default chords", () => {
    setShortcutRemap("search", "mod+y", storage);
    setShortcutRemap("toggleSidebar", "mod+shift+b", storage);
    // send is not remappable
    setShortcutRemap("send", "mod+enter", storage);
    // setting default clears
    setShortcutRemap("newChat", "mod+n", storage);

    const loaded = loadShortcutRemaps(storage);
    expect(loaded).toEqual({
      search: "mod+y",
      toggleSidebar: "mod+shift+b",
    });
    expect(storage.getItem(SHORTCUT_REMAP_STORAGE_KEY)).toContain("mod+y");
  });

  it("reset one and clear all", () => {
    setShortcutRemap("settings", "mod+.", storage);
    setShortcutRemap("help", "mod+h", storage);
    setShortcutRemap("settings", null, storage);
    expect(loadShortcutRemaps(storage)).toEqual({ help: "mod+h" });
    clearAllShortcutRemaps(storage);
    expect(loadShortcutRemaps(storage)).toEqual({});
    expect(storage.getItem(SHORTCUT_REMAP_STORAGE_KEY)).toBeNull();
  });

  it("ignores corrupt storage", () => {
    storage.setItem(SHORTCUT_REMAP_STORAGE_KEY, "not-json");
    expect(loadShortcutRemaps(storage)).toEqual({});
    storage.setItem(SHORTCUT_REMAP_STORAGE_KEY, JSON.stringify(["x"]));
    expect(loadShortcutRemaps(storage)).toEqual({});
  });

  it("saveShortcutRemaps strips defaults and unknown ids", () => {
    saveShortcutRemaps(
      {
        search: "mod+k",
        doctor: "mod+shift+x",
        // @ts-expect-error intentional junk id
        notAnId: "mod+z",
      },
      storage,
    );
    expect(loadShortcutRemaps(storage)).toEqual({ doctor: "mod+shift+x" });
  });
});

describe("REMAPPABLE_SHORTCUT_IDS", () => {
  it("covers core global actions including palette/settings/new chat/sidebar/side pane", () => {
    for (const id of [
      "search",
      "settings",
      "newChat",
      "toggleSidebar",
      "sideFiles",
      "sideBrowser",
      "sideTerminal",
    ] as const) {
      expect(REMAPPABLE_SHORTCUT_IDS).toContain(id);
    }
  });
});

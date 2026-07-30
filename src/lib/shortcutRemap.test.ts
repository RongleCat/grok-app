import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULT_SHORTCUT_CHORDS,
  REMAPPABLE_SHORTCUT_IDS,
  SHORTCUT_REMAP_STORAGE_KEY,
  buildEffectiveChordMap,
  chordFromKeyboardEvent,
  chordMatchesContext,
  clearAllShortcutRemaps,
  effectiveShortcutChord,
  findChordConflict,
  formatChordDisplay,
  loadShortcutRemaps,
  normalizeChordString,
  parseChord,
  saveShortcutRemaps,
  serializeChord,
  setShortcutRemap,
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
    expect(findChordConflict("search", "mod+p", effective)).toBeNull();
  });

  it("ignores self when checking candidate against effective map with custom", () => {
    const effective = buildEffectiveChordMap({ search: "mod+p" });
    expect(findChordConflict("search", "mod+p", effective)).toBeNull();
    expect(findChordConflict("help", "mod+p", effective)).toBe("search");
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

describe("load / save remaps", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it("starts empty and falls back to defaults", () => {
    expect(loadShortcutRemaps(storage)).toEqual({});
    expect(effectiveShortcutChord("search", {})).toBe("mod+k");
    expect(effectiveShortcutChord("search", { search: "mod+p" })).toBe(
      "mod+p",
    );
  });

  it("persists only remappable non-default chords", () => {
    setShortcutRemap("search", "mod+p", storage);
    setShortcutRemap("toggleSidebar", "mod+shift+b", storage);
    // send is not remappable
    setShortcutRemap("send", "mod+enter", storage);
    // setting default clears
    setShortcutRemap("newChat", "mod+n", storage);

    const loaded = loadShortcutRemaps(storage);
    expect(loaded).toEqual({
      search: "mod+p",
      toggleSidebar: "mod+shift+b",
    });
    expect(storage.getItem(SHORTCUT_REMAP_STORAGE_KEY)).toContain("mod+p");
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
  it("covers core global actions including palette/settings/new chat/sidebar", () => {
    for (const id of [
      "search",
      "settings",
      "newChat",
      "toggleSidebar",
    ] as const) {
      expect(REMAPPABLE_SHORTCUT_IDS).toContain(id);
    }
  });
});

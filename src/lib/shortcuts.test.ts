import { describe, expect, it } from "vitest";
import {
  GLOBAL_MOD_SHORTCUT_IDS,
  matchGlobalShortcut,
  SHORTCUT_IDS,
  SHORTCUTS,
  shortcutsByGroup,
  shortcutsForPlatform,
  type GlobalModShortcutId,
  type ShortcutChordContext,
} from "./shortcuts";

function chord(
  partial: Partial<ShortcutChordContext> & Pick<ShortcutChordContext, "key">,
): ShortcutChordContext {
  return {
    mod: true,
    shift: false,
    alt: false,
    typing: false,
    ...partial,
  };
}

describe("shortcuts catalog", () => {
  it("has stable unique ids", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("SHORTCUT_IDS matches catalog rows in order", () => {
    expect([...SHORTCUT_IDS]).toEqual(SHORTCUTS.map((s) => s.id));
  });

  it("every row has mac and win bindings and a group", () => {
    for (const s of SHORTCUTS) {
      expect(s.mac.trim().length).toBeGreaterThan(0);
      expect(s.win.trim().length).toBeGreaterThan(0);
      expect(s.labelKey.startsWith("shortcuts.")).toBe(true);
      expect(s.group).toBeTruthy();
    }
  });

  it("picks platform-specific keys", () => {
    const mac = shortcutsForPlatform("mac");
    const win = shortcutsForPlatform("win");
    const searchMac = mac.find((s) => s.id === "search");
    const searchWin = win.find((s) => s.id === "search");
    expect(searchMac?.keys).toContain("⌘");
    expect(searchWin?.keys.toLowerCase()).toContain("ctrl");
  });

  it("groups for settings panel cover every shortcut once", () => {
    const grouped = shortcutsByGroup();
    const flat = grouped.flatMap((g) => g.rows.map((r) => r.id));
    expect(flat.sort()).toEqual([...SHORTCUTS.map((s) => s.id)].sort());
  });

  it("lists find-in-chat (Cmd/Ctrl+F) in workbench near search", () => {
    const row = SHORTCUTS.find((s) => s.id === "findInChat");
    expect(row).toBeDefined();
    expect(row!.labelKey).toBe("shortcuts.findInChat");
    expect(row!.group).toBe("workbench");
    expect(row!.mac).toBe("⌘ F");
    expect(row!.win).toBe("Ctrl F");
    const searchIdx = SHORTCUTS.findIndex((s) => s.id === "search");
    const findIdx = SHORTCUTS.findIndex((s) => s.id === "findInChat");
    expect(findIdx).toBeGreaterThan(searchIdx);
  });

  it("lists default send as plain Enter, not only mod-enter", () => {
    const row = SHORTCUTS.find((s) => s.id === "send");
    expect(row).toBeDefined();
    // Default product pref is plain Enter; ⌘/Ctrl+Enter is a Settings → Composer option.
    expect(row!.mac).toMatch(/↵|Return/);
    expect(row!.win.toLowerCase()).toBe("enter");
    expect(row!.mac).not.toMatch(/⌘/);
    expect(row!.win.toLowerCase()).not.toMatch(/ctrl/);
  });

  it("lists Ctrl+Space dictation on both platforms (not Cmd)", () => {
    const row = SHORTCUTS.find((s) => s.id === "dictation");
    expect(row).toBeDefined();
    expect(row!.group).toBe("input");
    expect(row!.mac).toMatch(/Ctrl/i);
    expect(row!.mac).not.toMatch(/⌘/);
    expect(row!.win).toMatch(/Ctrl/i);
    expect(row!.mac.toLowerCase()).toContain("space");
    expect(row!.win.toLowerCase()).toContain("space");
  });

  it("lists copy last reply (Cmd/Ctrl+Shift+C) in workbench", () => {
    const row = SHORTCUTS.find((s) => s.id === "copyLastReply");
    expect(row).toBeDefined();
    expect(row!.labelKey).toBe("shortcuts.copyLastReply");
    expect(row!.group).toBe("workbench");
    expect(row!.mac).toBe("⌘ ⇧ C");
    expect(row!.win).toBe("Ctrl Shift C");
  });
});

describe("matchGlobalShortcut", () => {
  /** Canonical chords that App handles via the mod matcher. */
  const cases: Array<{
    id: GlobalModShortcutId;
    key: string;
    shift?: boolean;
    typing?: boolean;
  }> = [
    { id: "search", key: "k" },
    { id: "findInChat", key: "f" },
    { id: "newChat", key: "n", typing: false },
    { id: "settings", key: ",", typing: false },
    { id: "help", key: "/" },
    { id: "doctor", key: "d", shift: true },
    { id: "liveVoice", key: "v", shift: true },
    { id: "copyLastReply", key: "c", shift: true },
  ];

  it("covers every GLOBAL_MOD_SHORTCUT_IDS entry", () => {
    const covered = new Set(cases.map((c) => c.id));
    for (const id of GLOBAL_MOD_SHORTCUT_IDS) {
      expect(covered.has(id)).toBe(true);
    }
    expect(covered.size).toBe(GLOBAL_MOD_SHORTCUT_IDS.length);
  });

  it("matches each global mod catalog action", () => {
    for (const c of cases) {
      expect(
        matchGlobalShortcut(
          chord({
            key: c.key,
            shift: c.shift ?? false,
            typing: c.typing ?? false,
          }),
        ),
      ).toBe(c.id);
    }
  });

  it("findInChat / search / help work while typing", () => {
    expect(matchGlobalShortcut(chord({ key: "f", typing: true }))).toBe(
      "findInChat",
    );
    expect(matchGlobalShortcut(chord({ key: "k", typing: true }))).toBe(
      "search",
    );
    expect(matchGlobalShortcut(chord({ key: "/", typing: true }))).toBe("help");
    expect(
      matchGlobalShortcut(chord({ key: "d", shift: true, typing: true })),
    ).toBe("doctor");
    expect(
      matchGlobalShortcut(chord({ key: "c", shift: true, typing: true })),
    ).toBe("copyLastReply");
    expect(
      matchGlobalShortcut(chord({ key: "v", shift: true, typing: true })),
    ).toBe("liveVoice");
  });

  it("skips newChat and settings while typing", () => {
    expect(matchGlobalShortcut(chord({ key: "n", typing: true }))).toBeNull();
    expect(matchGlobalShortcut(chord({ key: ",", typing: true }))).toBeNull();
  });

  it("does not match without mod", () => {
    expect(matchGlobalShortcut(chord({ key: "k", mod: false }))).toBeNull();
    expect(
      matchGlobalShortcut(chord({ key: "d", mod: false, shift: true })),
    ).toBeNull();
  });

  it("does not match plain keys or unrelated chords", () => {
    expect(matchGlobalShortcut(chord({ key: "a" }))).toBeNull();
    expect(matchGlobalShortcut(chord({ key: "f", shift: true }))).toBeNull(); // not find
    expect(matchGlobalShortcut(chord({ key: "c" }))).toBeNull(); // needs shift
    expect(matchGlobalShortcut(chord({ key: "v" }))).toBeNull();
    expect(matchGlobalShortcut(chord({ key: "d" }))).toBeNull();
    expect(matchGlobalShortcut(chord({ key: "escape" }))).toBeNull();
    expect(matchGlobalShortcut(chord({ key: " ", mod: false }))).toBeNull();
  });

  it("does not match with alt held", () => {
    expect(matchGlobalShortcut(chord({ key: "k", alt: true }))).toBeNull();
  });

  it("does not claim send / stop / dictation (special-cased elsewhere)", () => {
    const special = new Set(["send", "stop", "dictation"]);
    for (const id of SHORTCUT_IDS) {
      if (special.has(id)) {
        expect(
          (GLOBAL_MOD_SHORTCUT_IDS as readonly string[]).includes(id),
        ).toBe(false);
      }
    }
  });
});

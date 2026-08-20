import { describe, expect, it } from "vitest";
import {
  GLOBAL_MOD_SHORTCUT_IDS,
  SHORTCUT_SCOPE_ORDER,
  filterShortcutGroups,
  filterShortcutRows,
  matchGlobalShortcut,
  sendShortcutDisplay,
  SHORTCUT_IDS,
  SHORTCUTS,
  shortcutScope,
  shortcutsByGroup,
  shortcutsByScope,
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

const tStub = (key: string) => {
  const map: Record<string, string> = {
    "shortcuts.search": "Search",
    "shortcuts.findInChat": "Find in conversation",
    "shortcuts.newChat": "New chat",
    "shortcuts.send": "Send",
    "shortcuts.steer": "Steer mid-turn",
    "shortcuts.stop": "Stop",
    "shortcuts.copyLastReply": "Copy last reply",
    "shortcuts.toggleSidebar": "Toggle sidebar",
    "shortcuts.sidebarSessionNav": "Next / previous chat in sidebar",
    "shortcuts.settings": "Settings",
    "shortcuts.help": "Keyboard shortcuts",
    "shortcuts.doctor": "Doctor",
    "shortcuts.liveVoice": "Live voice",
    "shortcuts.voice": "Dictation",
    "shortcuts.quit": "Quit (press twice)",
  };
  return map[key] ?? key;
};

describe("shortcuts catalog", () => {
  it("has stable unique ids", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("SHORTCUT_IDS matches catalog rows in order", () => {
    expect([...SHORTCUT_IDS]).toEqual(SHORTCUTS.map((s) => s.id));
  });

  it("every row has mac and win bindings, a group, and a scope", () => {
    for (const s of SHORTCUTS) {
      expect(s.mac.trim().length).toBeGreaterThan(0);
      expect(s.win.trim().length).toBeGreaterThan(0);
      expect(s.labelKey.startsWith("shortcuts.")).toBe(true);
      expect(s.group).toBeTruthy();
      expect(s.scope === "global" || s.scope === "chat-focus").toBe(true);
      expect(shortcutScope(s.id)).toBe(s.scope);
    }
  });

  it("tags chat-surface actions as chat-focus and shell actions as global", () => {
    expect(shortcutScope("findInChat")).toBe("chat-focus");
    expect(shortcutScope("copyLastReply")).toBe("chat-focus");
    expect(shortcutScope("send")).toBe("chat-focus");
    expect(shortcutScope("steer")).toBe("chat-focus");
    expect(shortcutScope("stop")).toBe("chat-focus");
    expect(shortcutScope("search")).toBe("global");
    expect(shortcutScope("settings")).toBe("global");
    expect(shortcutScope("toggleSidebar")).toBe("global");
    expect(shortcutScope("doctor")).toBe("global");
    expect(shortcutScope("sideFiles")).toBe("global");
    expect(shortcutScope("sideBrowser")).toBe("global");
    expect(shortcutScope("sideTerminal")).toBe("global");
  });

  it("lists find-in-chat and toggle sidebar", () => {
    const find = SHORTCUTS.find((s) => s.id === "findInChat");
    expect(find).toBeDefined();
    expect(find!.mac).toMatch(/⌘|Cmd/i);
    const side = SHORTCUTS.find((s) => s.id === "toggleSidebar");
    expect(side).toBeDefined();
    expect(side!.labelKey).toBe("shortcuts.toggleSidebar");
    expect(side!.group).toBe("navigation");
  });

  it("lists sidebar j/k session navigation (display-only)", () => {
    const row = SHORTCUTS.find((s) => s.id === "sidebarSessionNav");
    expect(row).toBeDefined();
    expect(row!.labelKey).toBe("shortcuts.sidebarSessionNav");
    expect(row!.group).toBe("navigation");
    expect(row!.mac.toLowerCase()).toMatch(/j/);
    expect(row!.mac.toLowerCase()).toMatch(/k/);
    expect(row!.win.toLowerCase()).toMatch(/j/);
    expect(
      (GLOBAL_MOD_SHORTCUT_IDS as readonly string[]).includes("sidebarSessionNav"),
    ).toBe(false);
  });

  it("lists close side tab as display-only ⌘W / Ctrl+W", () => {
    const row = SHORTCUTS.find((s) => s.id === "closeSideTab");
    expect(row).toBeDefined();
    expect(row!.labelKey).toBe("shortcuts.closeSideTab");
    expect(row!.group).toBe("navigation");
    expect(row!.mac).toMatch(/⌘.*W|W.*⌘/i);
    expect(row!.win.toLowerCase()).toMatch(/ctrl/);
    expect(
      (GLOBAL_MOD_SHORTCUT_IDS as readonly string[]).includes("closeSideTab"),
    ).toBe(false);
  });

  it("lists steer as Ctrl+Enter (Grok Build CLI mid-turn chord)", () => {
    const row = SHORTCUTS.find((s) => s.id === "steer");
    expect(row).toBeDefined();
    expect(row!.labelKey).toBe("shortcuts.steer");
    expect(row!.mac).toMatch(/⌃|Ctrl/i);
    expect(row!.win.toLowerCase()).toMatch(/ctrl/);
    expect(
      (GLOBAL_MOD_SHORTCUT_IDS as readonly string[]).includes("steer"),
    ).toBe(false);
  });

  it("lists quit as display-only Ctrl+Q (press twice)", () => {
    const row = SHORTCUTS.find((s) => s.id === "quit");
    expect(row).toBeDefined();
    expect(row!.labelKey).toBe("shortcuts.quit");
    expect(row!.group).toBe("workbench");
    expect(row!.mac).toBe("⌃ Q");
    expect(row!.win.toLowerCase()).toMatch(/ctrl/);
    expect((GLOBAL_MOD_SHORTCUT_IDS as readonly string[]).includes("quit")).toBe(
      false,
    );
  });

  it("lists default send as plain Enter", () => {
    const row = SHORTCUTS.find((s) => s.id === "send");
    expect(row).toBeDefined();
    expect(row!.mac).toMatch(/↵|Return/);
    expect(row!.win.toLowerCase()).toBe("enter");
  });

  it("sendShortcutDisplay reflects mod-enter pref", () => {
    expect(sendShortcutDisplay("enter").win.toLowerCase()).toBe("enter");
    expect(sendShortcutDisplay("mod-enter").win.toLowerCase()).toMatch(/ctrl/);
    expect(sendShortcutDisplay("mod-enter").mac).toMatch(/⌘/);
  });

  it("picks platform-specific keys", () => {
    const mac = shortcutsForPlatform("mac");
    const win = shortcutsForPlatform("win");
    const searchMac = mac.find((s) => s.id === "search");
    const searchWin = win.find((s) => s.id === "search");
    expect(searchMac?.keys).toContain("⌘");
    expect(searchWin?.keys.toLowerCase()).toContain("ctrl");
  });

  it("groups cover every shortcut exactly once", () => {
    const grouped = shortcutsByGroup();
    const flat = grouped.flatMap((g) => g.rows.map((r) => r.id));
    expect(flat.sort()).toEqual([...SHORTCUTS.map((s) => s.id)].sort());
  });
});

describe("matchGlobalShortcut", () => {
  const noRemaps = {};

  it("matches catalog mod chords", () => {
    const cases: Array<{
      id: GlobalModShortcutId;
      key: string;
      shift?: boolean;
      alt?: boolean;
    }> = [
      { id: "findInChat", key: "f" },
      { id: "search", key: "k" },
      { id: "help", key: "/" },
      { id: "settings", key: "," },
      { id: "newChat", key: "n" },
      { id: "doctor", key: "d", shift: true },
      { id: "copyLastReply", key: "c", shift: true },
      { id: "liveVoice", key: "v", shift: true },
      { id: "toggleSidebar", key: "b" },
      { id: "sideFiles", key: "p" },
      { id: "sideBrowser", key: "t" },
      { id: "sideTerminal", key: "`" },
    ];
    for (const c of cases) {
      expect(
        matchGlobalShortcut(
          chord({
            key: c.key,
            shift: c.shift ?? false,
            alt: c.alt ?? false,
          }),
          noRemaps,
        ),
      ).toBe(c.id);
    }
  });

  it("honors user remaps for palette / settings / new chat / sidebar", () => {
    const remaps = {
      search: "mod+p",
      settings: "mod+shift+,",
      newChat: "mod+shift+n",
      toggleSidebar: "mod+\\",
    };
    expect(
      matchGlobalShortcut(chord({ key: "p" }), remaps),
    ).toBe("search");
    expect(
      matchGlobalShortcut(chord({ key: "k" }), remaps),
    ).toBeNull();
    expect(
      matchGlobalShortcut(
        chord({ key: ",", shift: true }),
        remaps,
      ),
    ).toBe("settings");
    expect(
      matchGlobalShortcut(
        chord({ key: "n", shift: true }),
        remaps,
      ),
    ).toBe("newChat");
    expect(
      matchGlobalShortcut(chord({ key: "\\" }), remaps),
    ).toBe("toggleSidebar");
  });

  it("allows find/search/help/doctor/copy/live/sidebar/side-pane while typing", () => {
    expect(
      matchGlobalShortcut(chord({ key: "f", typing: true }), noRemaps),
    ).toBe("findInChat");
    expect(
      matchGlobalShortcut(chord({ key: "k", typing: true }), noRemaps),
    ).toBe("search");
    expect(
      matchGlobalShortcut(chord({ key: "/", typing: true }), noRemaps),
    ).toBe("help");
    expect(
      matchGlobalShortcut(
        chord({ key: "d", shift: true, typing: true }),
        noRemaps,
      ),
    ).toBe("doctor");
    expect(
      matchGlobalShortcut(
        chord({ key: "c", shift: true, typing: true }),
        noRemaps,
      ),
    ).toBe("copyLastReply");
    expect(
      matchGlobalShortcut(
        chord({ key: "v", shift: true, typing: true }),
        noRemaps,
      ),
    ).toBe("liveVoice");
    expect(
      matchGlobalShortcut(chord({ key: "b", typing: true }), noRemaps),
    ).toBe("toggleSidebar");
    expect(
      matchGlobalShortcut(chord({ key: "p", typing: true }), noRemaps),
    ).toBe("sideFiles");
    expect(
      matchGlobalShortcut(chord({ key: "t", typing: true }), noRemaps),
    ).toBe("sideBrowser");
    expect(
      matchGlobalShortcut(chord({ key: "`", typing: true }), noRemaps),
    ).toBe("sideTerminal");
  });

  it("skips newChat and settings while typing", () => {
    expect(
      matchGlobalShortcut(chord({ key: "n", typing: true }), noRemaps),
    ).toBeNull();
    expect(
      matchGlobalShortcut(chord({ key: ",", typing: true }), noRemaps),
    ).toBeNull();
  });

  it("does not match without mod", () => {
    expect(
      matchGlobalShortcut(chord({ key: "k", mod: false }), noRemaps),
    ).toBeNull();
    expect(
      matchGlobalShortcut(
        chord({ key: "d", mod: false, shift: true }),
        noRemaps,
      ),
    ).toBeNull();
  });

  it("does not match plain keys or unrelated chords", () => {
    expect(matchGlobalShortcut(chord({ key: "a" }), noRemaps)).toBeNull();
    expect(
      matchGlobalShortcut(chord({ key: "f", shift: true }), noRemaps),
    ).toBeNull();
    expect(matchGlobalShortcut(chord({ key: "c" }), noRemaps)).toBeNull();
    expect(matchGlobalShortcut(chord({ key: "v" }), noRemaps)).toBeNull();
    expect(matchGlobalShortcut(chord({ key: "d" }), noRemaps)).toBeNull();
    expect(
      matchGlobalShortcut(chord({ key: "escape" }), noRemaps),
    ).toBeNull();
    expect(
      matchGlobalShortcut(chord({ key: " ", mod: false }), noRemaps),
    ).toBeNull();
  });

  it("does not match with alt held", () => {
    expect(
      matchGlobalShortcut(chord({ key: "k", alt: true }), noRemaps),
    ).toBeNull();
  });

  it("does not claim send / stop / dictation / sidebar j/k (special-cased elsewhere)", () => {
    const special = new Set([
      "send",
      "steer",
      "stop",
      "dictation",
      "sidebarSessionNav",
      "quit",
    ]);
    for (const id of SHORTCUT_IDS) {
      if (special.has(id)) {
        expect(
          (GLOBAL_MOD_SHORTCUT_IDS as readonly string[]).includes(id),
        ).toBe(false);
      }
    }
  });

  it("does not match liveVoice when the hotkey preference is off", () => {
    expect(
      matchGlobalShortcut(
        chord({ key: "v", shift: true }),
        noRemaps,
        { voiceHotkeyEnabled: false },
      ),
    ).toBeNull();
    expect(
      matchGlobalShortcut(
        chord({ key: "v", shift: true, typing: true }),
        noRemaps,
        { voiceHotkeyEnabled: false },
      ),
    ).toBeNull();
    // Other chords still work.
    expect(
      matchGlobalShortcut(
        chord({ key: "k" }),
        noRemaps,
        { voiceHotkeyEnabled: false },
      ),
    ).toBe("search");
  });

  it("matches liveVoice when the hotkey preference is on", () => {
    expect(
      matchGlobalShortcut(
        chord({ key: "v", shift: true }),
        noRemaps,
        { voiceHotkeyEnabled: true },
      ),
    ).toBe("liveVoice");
  });
});

describe("liveVoice hotkey display Off", () => {
  it("shows Off for liveVoice when hotkey disabled", () => {
    const mac = shortcutsForPlatform("mac", "enter", {}, false);
    const win = shortcutsForPlatform("win", "enter", {}, false);
    expect(mac.find((s) => s.id === "liveVoice")?.keys).toBe("Off");
    expect(win.find((s) => s.id === "liveVoice")?.keys).toBe("Off");
  });

  it("keeps liveVoice chord when hotkey enabled", () => {
    const mac = shortcutsForPlatform("mac", "enter", {}, true);
    expect(mac.find((s) => s.id === "liveVoice")?.keys).toMatch(/⇧|Shift/i);
  });
});

describe("filterShortcutRows", () => {
  it("returns all rows for empty query", () => {
    expect(filterShortcutRows("", SHORTCUTS, tStub)).toEqual(SHORTCUTS);
    expect(filterShortcutRows("   \t  ", SHORTCUTS, tStub)).toEqual(SHORTCUTS);
  });

  it("matches id and label case-insensitively", () => {
    const hits = filterShortcutRows("findinchat", SHORTCUTS, tStub);
    expect(hits.some((r) => r.id === "findInChat")).toBe(true);
    const doctor = filterShortcutRows("DOCTOR", SHORTCUTS, tStub);
    expect(doctor.some((r) => r.id === "doctor")).toBe(true);
  });

  it("matches scope tokens", () => {
    const chat = filterShortcutRows("chat-focus", SHORTCUTS, tStub);
    expect(chat.some((r) => r.id === "findInChat")).toBe(true);
    expect(chat.every((r) => r.scope === "chat-focus")).toBe(true);
    const globalHits = filterShortcutRows("global", SHORTCUTS, tStub);
    expect(globalHits.some((r) => r.id === "search")).toBe(true);
  });

  it("matches key chord text", () => {
    const byCmdK = filterShortcutRows("⌘ k", SHORTCUTS, tStub);
    expect(byCmdK.some((r) => r.id === "search")).toBe(true);
    const byCmd = filterShortcutRows("cmd", SHORTCUTS, tStub);
    expect(byCmd.length).toBeGreaterThan(0);
    const byCtrlF = filterShortcutRows("ctrl f", SHORTCUTS, tStub);
    expect(byCtrlF.some((r) => r.id === "findInChat")).toBe(true);
    const byEnter = filterShortcutRows("enter", SHORTCUTS, tStub);
    expect(byEnter.some((r) => r.id === "send")).toBe(true);
    const byShift = filterShortcutRows("shift", SHORTCUTS, tStub);
    expect(byShift.some((r) => r.id === "copyLastReply")).toBe(true);
  });

  it("returns empty array when nothing matches", () => {
    expect(filterShortcutRows("no-such-shortcut-xyz", SHORTCUTS, tStub)).toEqual(
      [],
    );
  });

  it("handles empty row list", () => {
    expect(filterShortcutRows("search", [], tStub)).toEqual([]);
  });
});

describe("filterShortcutGroups", () => {
  it("drops groups with no matching rows and keeps order", () => {
    const groups = shortcutsByGroup();
    const filtered = filterShortcutGroups("doctor", groups, tStub);
    expect(filtered.map((g) => g.group)).toEqual(["diagnostics"]);
    expect(filtered[0]!.rows.map((r) => r.id)).toEqual(["doctor"]);
  });

  it("returns all groups for empty query", () => {
    const groups = shortcutsByGroup();
    expect(filterShortcutGroups("", groups, tStub)).toEqual(groups);
  });
});

describe("shortcutsByScope", () => {
  it("covers every catalog row exactly once in scope order", () => {
    const grouped = shortcutsByScope();
    expect(grouped.map((g) => g.scope)).toEqual([...SHORTCUT_SCOPE_ORDER]);
    const flat = grouped.flatMap((g) => g.rows.map((r) => r.id));
    expect(flat.sort()).toEqual([...SHORTCUTS.map((s) => s.id)].sort());
    for (const g of grouped) {
      expect(g.rows.every((r) => r.scope === g.scope)).toBe(true);
      expect(g.rows.length).toBeGreaterThan(0);
    }
  });

  it("groups a filtered subset without inventing scopes", () => {
    const chatOnly = SHORTCUTS.filter((s) => s.scope === "chat-focus");
    const grouped = shortcutsByScope(chatOnly);
    expect(grouped.map((g) => g.scope)).toEqual(["chat-focus"]);
    expect(grouped[0]!.rows.map((r) => r.id).sort()).toEqual(
      chatOnly.map((r) => r.id).sort(),
    );
  });

  it("returns empty for empty input", () => {
    expect(shortcutsByScope([])).toEqual([]);
  });
});

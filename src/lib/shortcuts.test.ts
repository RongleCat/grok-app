import { describe, expect, it } from "vitest";
import {
  SHORTCUTS,
  filterShortcutGroups,
  filterShortcutRows,
  shortcutsByGroup,
  shortcutsForPlatform,
} from "./shortcuts";

/** Minimal t() for filter tests — returns the key suffix as a stand-in label. */
function tStub(key: string): string {
  // Real labels are looked up via i18n; tests use predictable English-ish strings.
  const labels: Record<string, string> = {
    "shortcuts.search": "Search chats / projects",
    "shortcuts.findInChat": "Find in conversation",
    "shortcuts.newChat": "New chat",
    "shortcuts.send": "Send message",
    "shortcuts.stop": "Stop generation",
    "shortcuts.copyLastReply": "Copy last reply",
    "shortcuts.settings": "Open settings",
    "shortcuts.help": "Show shortcuts",
    "shortcuts.doctor": "Open doctor",
    "shortcuts.liveVoice": "Live voice",
    "shortcuts.voice": "Voice dictation",
  };
  return labels[key] ?? key;
}

describe("shortcuts catalog", () => {
  it("has stable unique ids", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
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

describe("filterShortcutRows", () => {
  it("returns all rows for empty or whitespace query", () => {
    expect(filterShortcutRows("", SHORTCUTS, tStub)).toEqual(SHORTCUTS);
    expect(filterShortcutRows("   \t  ", SHORTCUTS, tStub)).toEqual(SHORTCUTS);
  });

  it("matches id case-insensitively", () => {
    const hits = filterShortcutRows("findinchat", SHORTCUTS, tStub);
    expect(hits.map((r) => r.id)).toEqual(["findInChat"]);
  });

  it("matches localized label case-insensitively", () => {
    const hits = filterShortcutRows("settings", SHORTCUTS, tStub);
    expect(hits.some((r) => r.id === "settings")).toBe(true);
    const doctor = filterShortcutRows("DOCTOR", SHORTCUTS, tStub);
    expect(doctor.map((r) => r.id)).toEqual(["doctor"]);
  });

  it("matches mac/win key strings and expanded tokens (cmd, shift, enter)", () => {
    const byCmdK = filterShortcutRows("⌘ k", SHORTCUTS, tStub);
    expect(byCmdK.some((r) => r.id === "search")).toBe(true);

    const byCmd = filterShortcutRows("cmd", SHORTCUTS, tStub);
    expect(byCmd.length).toBeGreaterThan(0);
    expect(byCmd.every((r) => r.mac.includes("⌘") || /cmd|ctrl/i.test(r.win))).toBe(
      true,
    );

    const byCtrlF = filterShortcutRows("ctrl f", SHORTCUTS, tStub);
    expect(byCtrlF.some((r) => r.id === "findInChat")).toBe(true);

    const byEnter = filterShortcutRows("enter", SHORTCUTS, tStub);
    expect(byEnter.some((r) => r.id === "send")).toBe(true);

    const byShift = filterShortcutRows("shift", SHORTCUTS, tStub);
    expect(byShift.some((r) => r.id === "copyLastReply")).toBe(true);
    expect(byShift.some((r) => r.id === "doctor")).toBe(true);
  });

  it("returns empty array when nothing matches", () => {
    expect(filterShortcutRows("no-such-shortcut-xyz", SHORTCUTS, tStub)).toEqual(
      [],
    );
  });

  it("preserves input order of matches", () => {
    const hits = filterShortcutRows("ctrl", SHORTCUTS, tStub);
    const ids = hits.map((r) => r.id);
    const expected = SHORTCUTS.filter((r) =>
      filterShortcutRows("ctrl", [r], tStub).length,
    ).map((r) => r.id);
    expect(ids).toEqual(expected);
  });

  it("handles empty row list", () => {
    expect(filterShortcutRows("search", [], tStub)).toEqual([]);
    expect(filterShortcutRows("", [], tStub)).toEqual([]);
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

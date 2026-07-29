import { describe, expect, it } from "vitest";
import {
  SHORTCUTS,
  shortcutsByGroup,
  shortcutsForPlatform,
} from "./shortcuts";

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
});

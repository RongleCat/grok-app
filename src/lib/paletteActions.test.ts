import { describe, expect, it } from "vitest";
import {
  defaultPaletteActions,
  filterPaletteActions,
  type PaletteActionDef,
} from "./paletteActions";

const identityT = (key: string) => key;

describe("defaultPaletteActions", () => {
  it("includes stable ids for create, navigate, doctor, shortcuts, and settings", () => {
    const ids = defaultPaletteActions().map((a) => a.id);
    expect(ids).toEqual([
      "new-chat",
      "add-project",
      "open-automations",
      "open-tasks",
      "open-agent-dashboard",
      "doctor",
      "shortcuts-help",
      "product-tutorial",
      "settings-general",
      "settings-appearance",
      "settings-account",
      "settings-extensions",
      "settings-runtime",
      "settings-remote",
      "settings-shortcuts",
      "settings-about",
    ]);
  });

  it("uses MessageKey labelKeys and non-empty keywords", () => {
    for (const a of defaultPaletteActions()) {
      expect(a.labelKey.length).toBeGreaterThan(0);
      expect(a.keywords.length).toBeGreaterThan(0);
      expect(a.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("has unique ids", () => {
    const ids = defaultPaletteActions().map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("filterPaletteActions", () => {
  const catalog = defaultPaletteActions();

  it("empty query returns all actions", () => {
    const hits = filterPaletteActions("", catalog);
    expect(hits).toHaveLength(catalog.length);
    expect(hits.map((h) => h.id)).toEqual(catalog.map((a) => a.id));
  });

  it("whitespace-only query returns all actions", () => {
    expect(filterPaletteActions("   ", catalog)).toHaveLength(catalog.length);
  });

  it("matches by id fragment", () => {
    const hits = filterPaletteActions("settings-app", catalog);
    expect(hits.map((h) => h.id)).toContain("settings-appearance");
  });

  it("matches by keyword", () => {
    const doctor = filterPaletteActions("diagnostics", catalog);
    expect(doctor.map((h) => h.id)).toEqual(["doctor"]);

    const theme = filterPaletteActions("wallpaper", catalog);
    expect(theme.map((h) => h.id)).toEqual(["settings-appearance"]);

    const auto = filterPaletteActions("cron", catalog);
    expect(auto.map((h) => h.id)).toEqual(["open-automations"]);
  });

  it("matches translated label when t is provided", () => {
    const t = (key: string) => {
      if (key === "doctor.title") return "系统诊断";
      if (key === "settings.nav.general") return "通用";
      return key;
    };
    expect(filterPaletteActions("诊断", catalog, t).map((h) => h.id)).toEqual([
      "doctor",
    ]);
    expect(filterPaletteActions("通用", catalog, t).map((h) => h.id)).toEqual([
      "settings-general",
    ]);
  });

  it("matches without t only via id/keywords/labelKey", () => {
    const hits = filterPaletteActions("settings.nav.about", catalog);
    expect(hits.map((h) => h.id)).toEqual(["settings-about"]);
  });

  it("is case-insensitive", () => {
    expect(filterPaletteActions("DOCTOR", catalog).map((h) => h.id)).toEqual([
      "doctor",
    ]);
    expect(filterPaletteActions("New Chat", catalog).map((h) => h.id)).toContain(
      "new-chat",
    );
  });

  it("respects limit", () => {
    expect(filterPaletteActions("", catalog, undefined, { limit: 3 })).toHaveLength(
      3,
    );
    const manySettings = filterPaletteActions("settings", catalog, identityT, {
      limit: 2,
    });
    expect(manySettings).toHaveLength(2);
  });

  it("returns empty for nonsense query", () => {
    expect(filterPaletteActions("zzzz-not-a-real-action", catalog)).toEqual([]);
  });

  it("works on a custom actions list", () => {
    const custom: PaletteActionDef[] = [
      {
        id: "alpha",
        labelKey: "search.newChat",
        keywords: ["foo"],
      },
      {
        id: "beta",
        labelKey: "search.chats",
        keywords: ["bar"],
      },
    ];
    expect(filterPaletteActions("foo", custom).map((a) => a.id)).toEqual([
      "alpha",
    ]);
    expect(filterPaletteActions("", custom)).toHaveLength(2);
  });
});

import { describe, expect, it } from "vitest";
import {
  loadActivePresetId,
  presetMatchesCurrentLook,
  resolveActivePresetId,
  saveActivePresetId,
} from "./skinActivePreset";
import type { SkinPresetListItem } from "./api/skin";

function mem() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  };
}

const preset: SkinPresetListItem = {
  id: "p1",
  sourceId: "",
  name: "Harbor",
  description: "",
  author: "",
  createdAt: 1,
  updatedAt: 1,
  skin: "ocean",
  scrim: 42,
  hasWallpaper: false,
  bytes: 10,
};

describe("active preset id", () => {
  it("round-trips and clears", () => {
    const s = mem();
    expect(loadActivePresetId(s)).toBeNull();
    saveActivePresetId("abc", s);
    expect(loadActivePresetId(s)).toBe("abc");
    saveActivePresetId(null, s);
    expect(loadActivePresetId(s)).toBeNull();
  });
});

describe("resolveActivePresetId", () => {
  const look = {
    skin: "ocean" as const,
    wallpaperRecord: null,
    wallpaperScrim: 42,
  };

  it("highlights stored id only while the look still matches", () => {
    expect(resolveActivePresetId("p1", [preset], look)).toBe("p1");
    expect(
      resolveActivePresetId("p1", [preset], { ...look, skin: "ember" }),
    ).toBeNull();
    expect(resolveActivePresetId("missing", [preset], look)).toBeNull();
    expect(resolveActivePresetId(null, [preset], look)).toBeNull();
  });

  it("treats wallpaper presence as part of the match", () => {
    expect(
      presetMatchesCurrentLook(
        { ...preset, hasWallpaper: true },
        look,
      ),
    ).toBe(false);
    expect(
      presetMatchesCurrentLook(
        { ...preset, hasWallpaper: true },
        {
          ...look,
          wallpaperRecord: {
            kind: "image",
            mime: "image/jpeg",
            name: "a.jpg",
            createdAt: 1,
            blob: new Blob(["x"]),
          },
        },
      ),
    ).toBe(true);
  });
});

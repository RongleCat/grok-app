import { describe, expect, it } from "vitest";
import {
  DEFAULT_SKIN,
  DEFAULT_WALLPAPER_SCRIM,
  type ThemeSkinId,
} from "./themeSkin";
import {
  buildExportManifest,
  exportFileName,
  isEmptyDefaultLook,
  keepWallpaperAllowed,
  parseSkinPackError,
  validateSkinManifest,
} from "./skinPack";

const base = {
  schemaVersion: 1,
  name: "Harbor dusk",
  skin: "ocean",
  scrim: 42,
};

describe("validateSkinManifest", () => {
  it("accepts a known skin and treats null wallpaper as will_clear_wallpaper", () => {
    const r = validateSkinManifest({ ...base, wallpaper: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skin).toBe("ocean");
    expect(r.warnings).toContain("will_clear_wallpaper");
    expect(r.warnings).not.toContain("unknown_skin");
  });

  it("unknown skin is a warning and falls back to default", () => {
    const r = validateSkinManifest({ ...base, skin: "nebula-9000", wallpaper: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skin).toBe(DEFAULT_SKIN);
    expect(r.requestedSkin).toBe("nebula-9000");
    expect(r.warnings).toContain("unknown_skin");
    expect(r.warnings).toContain("will_clear_wallpaper");
  });

  it("ignores themePreference and does not copy it into export manifests", () => {
    const r = validateSkinManifest({
      ...base,
      themePreference: "dark",
      wallpaper: null,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.themePreference).toBeUndefined();

    const exported = buildExportManifest({
      name: "x",
      skin: "ocean",
      scrim: 10,
    });
    expect(exported).not.toHaveProperty("themePreference");
    expect(JSON.stringify(exported)).not.toContain("themePreference");
  });

  it("rejects tokens / style / css as unsupported_schema", () => {
    expect(validateSkinManifest({ ...base, tokens: {} }).ok).toBe(false);
    expect(validateSkinManifest({ ...base, tokens: {} })).toEqual({
      ok: false,
      code: "unsupported_schema",
    });
    expect(validateSkinManifest({ ...base, style: "x" })).toMatchObject({
      ok: false,
      code: "unsupported_schema",
    });
    expect(validateSkinManifest({ ...base, css: ".a{}" })).toMatchObject({
      ok: false,
      code: "unsupported_schema",
    });
  });

  it("rejects schemaVersion other than 1", () => {
    expect(validateSkinManifest({ ...base, schemaVersion: 2 })).toMatchObject({
      ok: false,
      code: "unsupported_schema",
    });
    expect(validateSkinManifest({ ...base, schemaVersion: 0 })).toMatchObject({
      ok: false,
      code: "unsupported_schema",
    });
    expect(validateSkinManifest({ ...base, schemaVersion: undefined })).toMatchObject({
      ok: false,
      code: "unsupported_schema",
    });
  });

  it("rejects wallpaper mime/ext mismatch and svg/html", () => {
    const wall = {
      file: "assets/wallpaper.mp4",
      kind: "image",
      mime: "image/jpeg",
      name: "x.mp4",
      sha256: "a".repeat(64),
    };
    expect(validateSkinManifest({ ...base, wallpaper: wall })).toMatchObject({
      ok: false,
      code: "invalid_pack",
    });
    expect(
      validateSkinManifest({
        ...base,
        wallpaper: {
          file: "assets/wallpaper.jpg",
          kind: "image",
          mime: "image/svg+xml",
          name: "x.svg",
          sha256: "a".repeat(64),
        },
      }),
    ).toMatchObject({ ok: false, code: "invalid_pack" });
  });
});

describe("isEmptyDefaultLook", () => {
  it("is true only for default skin, no wallpaper, default scrim", () => {
    expect(
      isEmptyDefaultLook({
        skin: "default",
        wallpaperRecord: null,
        wallpaperScrim: DEFAULT_WALLPAPER_SCRIM,
      }),
    ).toBe(true);
    expect(
      isEmptyDefaultLook({
        skin: "ocean" as ThemeSkinId,
        wallpaperRecord: null,
        wallpaperScrim: DEFAULT_WALLPAPER_SCRIM,
      }),
    ).toBe(false);
    expect(
      isEmptyDefaultLook({
        skin: "default",
        wallpaperRecord: null,
        wallpaperScrim: 40,
      }),
    ).toBe(false);
    expect(
      isEmptyDefaultLook({
        skin: "default",
        wallpaperRecord: {
          kind: "image",
          mime: "image/jpeg",
          name: "a.jpg",
          createdAt: 1,
          blob: new Blob(["x"]),
        },
        wallpaperScrim: DEFAULT_WALLPAPER_SCRIM,
      }),
    ).toBe(false);
  });
});

describe("keepWallpaperAllowed / errors / export name", () => {
  it("keepWallpaper only for local-file + wallpaper==null", () => {
    expect(keepWallpaperAllowed("file", null)).toBe(true);
    expect(
      keepWallpaperAllowed("file", {
        path: "/tmp/a.jpg",
        kind: "image",
        mime: "image/jpeg",
        name: "a.jpg",
        bytes: 10,
      }),
    ).toBe(false);
    expect(keepWallpaperAllowed("catalog", null)).toBe(false);
    expect(keepWallpaperAllowed("preset", null)).toBe(false);
    expect(keepWallpaperAllowed("deeplink", null)).toBe(false);
  });

  it("parses stable error prefixes", () => {
    expect(parseSkinPackError("hash_mismatch: wallpaper").code).toBe(
      "hash_mismatch",
    );
    expect(parseSkinPackError("disk_budget: 4 GiB").code).toBe("disk_budget");
    expect(parseSkinPackError("too_large").code).toBe("too_large");
  });

  it("sanitizes export file names", () => {
    expect(exportFileName("Harbor dusk")).toBe("Harbor-dusk.grokskin");
    expect(exportFileName("***")).toBe("skin.grokskin");
  });
});

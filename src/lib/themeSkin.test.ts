import { describe, expect, it } from "vitest";
import {
  applySkinToDocument,
  applyWallpaperFlag,
  applyWallpaperScrimToDocument,
  clearWallpaper,
  DEFAULT_SKIN,
  DEFAULT_WALLPAPER_SCRIM,
  getThemeSkinMeta,
  isThemeSkinId,
  loadSkin,
  loadWallpaperMeta,
  loadWallpaperRecord,
  loadWallpaperScrim,
  memoryWallpaperBlobStorage,
  parseThemeSkin,
  parseWallpaperScrim,
  prepareWallpaperFromFile,
  saveSkin,
  saveWallpaper,
  saveWallpaperAdjust,
  saveWallpaperFocus,
  saveWallpaperScrim,
  SKIN_STORAGE_KEY,
  skinPreferredTheme,
  THEME_SKINS,
  WALLPAPER_MAX_VIDEO_BYTES,
  WALLPAPER_SCRIM_STORAGE_KEY,
  WALLPAPER_STORAGE_KEY,
  type SkinStorage,
  type WallpaperRecord,
} from "./themeSkin";

function memoryStorage(initial: Record<string, string> = {}): SkinStorage & {
  data: Record<string, string>;
  removeItem(key: string): void;
} {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return key in data ? data[key]! : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

/**
 * Duck-typed File. The video / gif / not_image branches only read `.type`,
 * `.name`, `.size` and pass the object through as the blob (no Blob methods
 * invoked), so a plain object suffices and lets us fake arbitrary sizes
 * without allocating megabytes.
 */
function fakeFile(type: string, name: string, size: number): File {
  return { type, name, size } as unknown as File;
}

describe("theme skins", () => {
  it("defaults to default and rejects unknown ids", () => {
    expect(DEFAULT_SKIN).toBe("default");
    expect(parseThemeSkin(null)).toBe("default");
    expect(parseThemeSkin("nope")).toBe("default");
    expect(isThemeSkinId("gothic")).toBe(true);
    expect(isThemeSkinId("custom-x")).toBe(false);
  });

  it("ships stable preset ids inspired by Dream Skin packs", () => {
    const ids = THEME_SKINS.map((s) => s.id);
    expect(ids).toContain("default");
    expect(ids).toContain("rose");
    expect(ids).toContain("gothic");
    expect(ids).toContain("mist");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("persists and reloads after simulated relaunch", () => {
    const storage = memoryStorage();
    expect(loadSkin(storage)).toBe("default");
    saveSkin(storage, "ocean");
    expect(storage.data[SKIN_STORAGE_KEY]).toBe("ocean");
    expect(loadSkin(storage)).toBe("ocean");
  });

  it("no built-in skin forces dark/light (user shell stays put)", () => {
    for (const pack of THEME_SKINS) {
      expect(pack.appearance, pack.id).toBe("auto");
      expect(skinPreferredTheme(pack.id)).toBeNull();
    }
    expect(getThemeSkinMeta("gothic").appearance).toBe("auto");
  });

  it("applySkinToDocument sets or clears data-skin", () => {
    const attrs = new Map<string, string>();
    const el = {
      setAttribute(name: string, value: string) {
        attrs.set(name, value);
      },
      removeAttribute(name: string) {
        attrs.delete(name);
      },
    };
    applySkinToDocument("ember", el);
    expect(attrs.get("data-skin")).toBe("ember");
    applySkinToDocument("default", el);
    expect(attrs.has("data-skin")).toBe(false);
  });
});

describe("wallpaper storage", () => {
  it("loadWallpaperMeta returns null when empty", () => {
    const meta = memoryStorage();
    expect(loadWallpaperMeta(meta)).toBeNull();
  });

  it("round-trips a record through save / load / clear", async () => {
    const meta = memoryStorage();
    const blobs = memoryWallpaperBlobStorage();
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], {
      type: "image/jpeg",
    });
    const record: WallpaperRecord = {
      kind: "image",
      mime: "image/jpeg",
      name: "p.jpg",
      createdAt: 1234567890,
      blob,
    };
    await saveWallpaper(record, { blobs, meta });

    // Sync meta mirror is populated immediately (used for boot).
    const synced = loadWallpaperMeta(meta);
    expect(synced?.kind).toBe("image");
    expect(synced?.mime).toBe("image/jpeg");
    expect(synced?.name).toBe("p.jpg");

    const loaded = await loadWallpaperRecord({ blobs, meta });
    expect(loaded?.kind).toBe("image");
    expect(loaded?.mime).toBe("image/jpeg");
    expect(loaded?.name).toBe("p.jpg");
    expect(loaded?.createdAt).toBe(1234567890);
    expect(loaded?.blob).toBe(blob);

    await clearWallpaper({ blobs, meta });
    expect(loadWallpaperMeta(meta)).toBeNull();
    expect(await loadWallpaperRecord({ blobs, meta })).toBeNull();
  });

  it("treats a missing blob as no wallpaper and drops stale meta", async () => {
    const meta = memoryStorage();
    const blobs = memoryWallpaperBlobStorage();
    // Meta present but blob absent (e.g. IDB cleared out-of-band) → null.
    meta.setItem(
      WALLPAPER_STORAGE_KEY,
      JSON.stringify({
        kind: "video",
        mime: "video/mp4",
        name: "x.mp4",
        createdAt: 1,
      }),
    );
    expect(await loadWallpaperRecord({ blobs, meta })).toBeNull();
    // Stale meta must not linger (would re-flag wallpaper on next boot).
    expect(loadWallpaperMeta(meta)).toBeNull();
    expect(meta.data[WALLPAPER_STORAGE_KEY]).toBeUndefined();
  });

  it("clears an orphan blob when meta is already gone (no residual quota)", async () => {
    const meta = memoryStorage();
    const blobs = memoryWallpaperBlobStorage();
    await blobs.set(new Blob([new Uint8Array([9, 9])], { type: "image/jpeg" }));
    expect(blobs._blob).not.toBeNull();
    expect(await loadWallpaperRecord({ blobs, meta })).toBeNull();
    expect(blobs._blob).toBeNull();
    expect(await blobs.get()).toBeNull();
  });

  it("clearWallpaper frees both meta and blob storage", async () => {
    const meta = memoryStorage();
    const blobs = memoryWallpaperBlobStorage();
    const blob = new Blob([new Uint8Array([7, 7, 7])], { type: "image/jpeg" });
    await saveWallpaper(
      {
        kind: "image",
        mime: "image/jpeg",
        name: "gone.jpg",
        createdAt: 42,
        blob,
      },
      { blobs, meta },
    );
    expect(blobs._blob).not.toBeNull();
    await clearWallpaper({ blobs, meta });
    expect(loadWallpaperMeta(meta)).toBeNull();
    expect(meta.data[WALLPAPER_STORAGE_KEY]).toBeUndefined();
    expect(blobs._blob).toBeNull();
    expect(await blobs.get()).toBeNull();
  });

  it("applyWallpaperFlag toggles the data-wallpaper attribute", () => {
    const attrs = new Map<string, string>();
    const el = {
      setAttribute(name: string, value: string) {
        attrs.set(name, value);
      },
      removeAttribute(name: string) {
        attrs.delete(name);
      },
    };
    applyWallpaperFlag(true, el);
    expect(attrs.get("data-wallpaper")).toBe("1");
    applyWallpaperFlag(false, el);
    expect(attrs.has("data-wallpaper")).toBe(false);
  });

  it("saveWallpaperFocus updates meta only (no blob rewrite)", async () => {
    const meta = memoryStorage();
    const blobs = memoryWallpaperBlobStorage();
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    await saveWallpaper(
      {
        kind: "image",
        mime: "image/jpeg",
        name: "f.jpg",
        createdAt: 9,
        blob,
      },
      { blobs, meta },
    );
    const beforeBlob = blobs._blob;
    const saved = saveWallpaperFocus(
      { cx: 0.2, cy: 0.8, zoom: 2 },
      { meta },
    );
    expect(saved?.focus).toEqual({ cx: 0.2, cy: 0.8, zoom: 2 });
    expect(loadWallpaperMeta(meta)?.focus).toEqual({
      cx: 0.2,
      cy: 0.8,
      zoom: 2,
    });
    // Blob pointer unchanged — focus edits must not touch IDB.
    expect(blobs._blob).toBe(beforeBlob);

    // Default focus is omitted from meta.
    saveWallpaperFocus({ cx: 0.5, cy: 0.5, zoom: 1 }, { meta });
    expect(loadWallpaperMeta(meta)?.focus).toBeUndefined();
  });

  it("saveWallpaperAdjust stores video clip without rewriting blob", async () => {
    const meta = memoryStorage();
    const blobs = memoryWallpaperBlobStorage();
    const blob = new Blob([new Uint8Array([9, 9, 9])], { type: "video/mp4" });
    await saveWallpaper(
      {
        kind: "video",
        mime: "video/mp4",
        name: "v.mp4",
        createdAt: 1,
        blob,
      },
      { blobs, meta },
    );
    const beforeBlob = blobs._blob;
    const saved = saveWallpaperAdjust(
      {
        focus: { cx: 0.5, cy: 0.5, zoom: 1 },
        clip: { start: 1.2, end: 5.8 },
        duration: 12,
      },
      { meta },
    );
    expect(saved?.clip).toEqual({ start: 1.2, end: 5.8 });
    expect(loadWallpaperMeta(meta)?.clip).toEqual({ start: 1.2, end: 5.8 });
    expect(blobs._blob).toBe(beforeBlob);

    // Full-span clip is dropped.
    saveWallpaperAdjust(
      { clip: { start: 0, end: 12 }, duration: 12 },
      { meta },
    );
    expect(loadWallpaperMeta(meta)?.clip).toBeUndefined();
  });
});

describe("wallpaper scrim", () => {
  it("defaults to full strength and clamps out-of-range values", () => {
    expect(DEFAULT_WALLPAPER_SCRIM).toBe(100);
    expect(parseWallpaperScrim(null)).toBe(100);
    expect(parseWallpaperScrim("nope")).toBe(100);
    expect(parseWallpaperScrim(-20)).toBe(0);
    expect(parseWallpaperScrim(140)).toBe(100);
    expect(parseWallpaperScrim("35.6")).toBe(36);
  });

  it("persists and reloads scrim strength", () => {
    const storage = memoryStorage();
    expect(loadWallpaperScrim(storage)).toBe(DEFAULT_WALLPAPER_SCRIM);
    saveWallpaperScrim(storage, 42);
    expect(storage.data[WALLPAPER_SCRIM_STORAGE_KEY]).toBe("42");
    expect(loadWallpaperScrim(storage)).toBe(42);
  });

  it("applyWallpaperScrimToDocument sets opacity + derived mix tokens", () => {
    const props = new Map<string, string>();
    const attrs = new Map<string, string>();
    const el = {
      setAttribute(name: string, value: string) {
        attrs.set(name, value);
      },
      removeAttribute(name: string) {
        attrs.delete(name);
      },
      style: {
        setProperty(name: string, value: string) {
          props.set(name, value);
        },
        removeProperty(name: string) {
          props.delete(name);
        },
      },
    };
    applyWallpaperScrimToDocument(25, el);
    expect(attrs.has("data-wallpaper-clear")).toBe(false);
    expect(props.get("--wallpaper-scrim-opacity")).toBe("0.250");
    expect(props.get("--wallpaper-mix-main")).toBe("18%"); // 70 * 0.25
    expect(props.get("--wallpaper-mix-sidebar")).toBe("15%"); // 58 * 0.25
    expect(props.get("--wallpaper-mix-settings")).toBe("20%"); // 78 * 0.25
    expect(props.get("--wallpaper-light-scrim-opacity")).toBe("0.113");
    expect(props.get("--wallpaper-light-mix-sidebar")).toBe("18%");
    expect(props.get("--wallpaper-light-mix-main")).toBe("6%");
    expect(props.get("--wallpaper-light-mix-aside")).toBe("8%");
    expect(props.get("--wallpaper-light-mix-settings")).toBe("18%");
    expect(props.get("--wallpaper-sidebar-blur")).toBe("5.5px");
    expect(props.get("--wallpaper-settings-blur")).toBe("3.5px");
    expect(props.get("--wallpaper-sidebar-shadow-alpha")).toBe("0.420");
    expect(props.get("--wallpaper-light-foreground-shadow-alpha")).toBe(
      "0.550",
    );

    applyWallpaperScrimToDocument(0, el);
    expect(attrs.get("data-wallpaper-clear")).toBe("1");
    expect(props.get("--wallpaper-scrim-opacity")).toBe("0.000");
    expect(props.get("--wallpaper-mix-main")).toBe("0%");
    expect(props.get("--wallpaper-mix-sidebar")).toBe("0%");
    expect(props.get("--wallpaper-mix-settings")).toBe("0%");
    expect(props.get("--wallpaper-light-scrim-opacity")).toBe("0.000");
    expect(props.get("--wallpaper-light-mix-sidebar")).toBe("0%");
    expect(props.get("--wallpaper-light-mix-main")).toBe("0%");
    expect(props.get("--wallpaper-light-mix-aside")).toBe("0%");
    expect(props.get("--wallpaper-light-mix-settings")).toBe("0%");
    expect(props.get("--wallpaper-sidebar-blur")).toBe("0.0px");
    expect(props.get("--wallpaper-settings-blur")).toBe("0.0px");
    expect(props.get("--wallpaper-sidebar-shadow-alpha")).toBe("0.560");
    expect(props.get("--wallpaper-light-foreground-shadow-alpha")).toBe(
      "0.660",
    );

    applyWallpaperScrimToDocument(100, el);
    expect(attrs.has("data-wallpaper-clear")).toBe(false);
    expect(props.get("--wallpaper-scrim-opacity")).toBe("1.000");
    expect(props.get("--wallpaper-mix-main")).toBe("70%");
    expect(props.get("--wallpaper-mix-sidebar")).toBe("58%");
    expect(props.get("--wallpaper-mix-settings")).toBe("78%");
    expect(props.get("--wallpaper-light-scrim-opacity")).toBe("0.450");
    expect(props.get("--wallpaper-light-mix-sidebar")).toBe("72%");
    expect(props.get("--wallpaper-light-mix-main")).toBe("24%");
    expect(props.get("--wallpaper-light-mix-aside")).toBe("32%");
    expect(props.get("--wallpaper-light-mix-settings")).toBe("72%");
    expect(props.get("--wallpaper-sidebar-blur")).toBe("22.0px");
    expect(props.get("--wallpaper-settings-blur")).toBe("14.0px");
    expect(props.get("--wallpaper-sidebar-shadow-alpha")).toBe("0.000");
    expect(props.get("--wallpaper-light-foreground-shadow-alpha")).toBe(
      "0.220",
    );
  });
});

describe("prepareWallpaperFromFile", () => {
  it("accepts a small mp4 as-is", async () => {
    const file = fakeFile("video/mp4", "clip.mp4", 1024);
    const rec = await prepareWallpaperFromFile(file);
    expect(rec.kind).toBe("video");
    expect(rec.mime).toBe("video/mp4");
    expect(rec.name).toBe("clip.mp4");
    expect(rec.blob).toBe(file);
  });

  it("rejects unsupported video mimetypes", async () => {
    const file = fakeFile("video/quicktime", "clip.mov", 1024);
    await expect(prepareWallpaperFromFile(file)).rejects.toMatchObject({
      code: "unsupported_video",
    });
  });

  it("rejects oversized video", async () => {
    const file = fakeFile(
      "video/mp4",
      "big.mp4",
      WALLPAPER_MAX_VIDEO_BYTES + 1,
    );
    await expect(prepareWallpaperFromFile(file)).rejects.toMatchObject({
      code: "video_too_large",
    });
  });

  it("preserves an animated gif as-is (no recompress)", async () => {
    const file = fakeFile("image/gif", "anim.gif", 2048);
    const rec = await prepareWallpaperFromFile(file);
    expect(rec.kind).toBe("image");
    expect(rec.mime).toBe("image/gif");
    expect(rec.blob).toBe(file);
  });

  it("rejects non-image / non-video files", async () => {
    const file = fakeFile("text/plain", "notes.txt", 8);
    await expect(prepareWallpaperFromFile(file)).rejects.toMatchObject({
      code: "not_image",
    });
  });
});

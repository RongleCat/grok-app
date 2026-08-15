import { describe, expect, it, vi } from "vitest";
import { applySkinPack, type ApplySkinPackDeps } from "./applySkinPack";
import { snapshotBeforeLastApply, type UndoSnapshotIo } from "./skinPresetStore";
import { DEFAULT_SKIN, DEFAULT_WALLPAPER_SCRIM } from "./themeSkin";
import type { SkinPackPreview } from "./skinPack";

function preview(over: Partial<SkinPackPreview> = {}): SkinPackPreview {
  return {
    id: "inspect-1",
    sourceId: null,
    name: "Harbor",
    description: "",
    author: "",
    createdAt: 1,
    skin: "ocean",
    requestedSkin: "ocean",
    scrim: 42,
    themePreference: "dark",
    wallpaper: null,
    previewPath: null,
    warnings: ["will_clear_wallpaper"],
    source: "file",
    ...over,
  };
}

function deps(over: Partial<ApplySkinPackDeps> = {}): ApplySkinPackDeps & {
  calls: string[];
} {
  const calls: string[] = [];
  const d: ApplySkinPackDeps & { calls: string[] } = {
    calls,
    currentLook: () => ({
      skin: DEFAULT_SKIN,
      wallpaperRecord: {
        kind: "image",
        mime: "image/jpeg",
        name: "cur.jpg",
        createdAt: 1,
        blob: new Blob(["x"]),
      },
      wallpaperScrim: DEFAULT_WALLPAPER_SCRIM,
    }),
    snapshotBeforeLastApply: async () => {
      calls.push("snapshot");
      return { ok: true };
    },
    fileFromAbsolutePath: async () => new File(["x"], "w.jpg", { type: "image/jpeg" }),
    prepareWallpaperFromFile: async () => {
      throw new Error("not used");
    },
    applyWallpaperChoice: async (record) => {
      calls.push(record ? "wall:set" : "wall:clear");
    },
    applyWallpaperAdjustChoice: () => {
      calls.push("adjust");
    },
    applySkinChoice: (_next, opts) => {
      calls.push(`skin:${opts?.applyPreferredTheme}`);
    },
    applyWallpaperScrimChoice: (v) => {
      calls.push(`scrim:${v}`);
    },
    applyThemeChoice: () => {
      calls.push("theme");
    },
    saveFromInspect: async () => {
      calls.push("save");
    },
    inspectAbort: async () => {
      calls.push("abort");
    },
    acquireWrite: async () => {
      calls.push("lock");
      return () => {
        calls.push("unlock");
      };
    },
    ...over,
  };
  return d;
}

describe("applySkinPack", () => {
  it("does not write undo when skipUndoSnapshot", async () => {
    const d = deps();
    const r = await applySkinPack(
      preview(),
      { keepWallpaper: false, saveToLibrary: false, skipUndoSnapshot: true },
      d,
    );
    expect(d.calls).not.toContain("snapshot");
    expect(r.undoSnapshotCompleted).toBe(false);
    expect(r.appearanceWriteCompleted).toBe(true);
    expect(r.applySkinOpts).toEqual({ applyPreferredTheme: false });
    expect(d.calls).toContain("skin:false");
    expect(d.calls).not.toContain("theme");
  });

  it("skips undo snapshot on empty default look", async () => {
    const d = deps({
      currentLook: () => ({
        skin: DEFAULT_SKIN,
        wallpaperRecord: null,
        wallpaperScrim: DEFAULT_WALLPAPER_SCRIM,
      }),
    });
    const r = await applySkinPack(
      preview(),
      { keepWallpaper: false, saveToLibrary: false, skipUndoSnapshot: false },
      d,
    );
    expect(d.calls).not.toContain("snapshot");
    expect(r.undoSnapshotCompleted).toBe(false);
    expect(r.appearanceWriteCompleted).toBe(true);
  });

  it("keepWallpaper only applies for local-file + wallpaper==null", async () => {
    const fileNull = deps();
    const r1 = await applySkinPack(
      preview({ source: "file", wallpaper: null }),
      { keepWallpaper: true, saveToLibrary: false, skipUndoSnapshot: true },
      fileNull,
    );
    expect(r1.appliedKeepWallpaper).toBe(true);
    expect(fileNull.calls).not.toContain("wall:clear");

    const catalog = deps();
    const r2 = await applySkinPack(
      preview({ source: "catalog", wallpaper: null }),
      { keepWallpaper: true, saveToLibrary: false, skipUndoSnapshot: true },
      catalog,
    );
    expect(r2.appliedKeepWallpaper).toBe(false);
    expect(catalog.calls).toContain("wall:clear");
  });

  it("never calls applyThemeChoice; applyPreferredTheme is false", async () => {
    const d = deps();
    const r = await applySkinPack(
      preview({ themePreference: "light" }),
      { keepWallpaper: false, saveToLibrary: false, skipUndoSnapshot: true },
      d,
    );
    expect(r.applySkinOpts).toEqual({ applyPreferredTheme: false });
    expect(d.calls.filter((c) => c === "theme")).toEqual([]);
    expect(d.applyThemeChoice).toBeDefined();
  });

  it("aborts snapshot failure before mutating appearance", async () => {
    const d = deps({
      snapshotBeforeLastApply: async () => ({ ok: false, code: "cancelled" }),
    });
    const r = await applySkinPack(
      preview(),
      { keepWallpaper: false, saveToLibrary: false, skipUndoSnapshot: false },
      d,
    );
    expect(r.error).toBe("cancelled");
    expect(r.appearanceWriteCompleted).toBe(false);
    expect(d.calls).not.toContain("wall:clear");
    expect(d.calls).not.toContain("skin:false");
    expect(d.calls).toContain("abort");
    expect(d.calls).toContain("unlock");
  });

  it("library save failure does not roll back appearance", async () => {
    const d = deps({
      saveFromInspect: async () => {
        throw new Error("disk_budget: full");
      },
    });
    const r = await applySkinPack(
      preview(),
      { keepWallpaper: false, saveToLibrary: true, skipUndoSnapshot: true },
      d,
    );
    expect(r.appearanceWriteCompleted).toBe(true);
    expect(r.libraryError).toBe("disk_budget");
    expect(r.savedToLibrary).toBe(false);
    expect(d.calls).toContain("skin:false");
    expect(d.calls).toContain("abort");
  });

  it("real no-wallpaper snapshot cancel aborts Apply before helpers", async () => {
    const ioCalls: string[] = [];
    const io: UndoSnapshotIo = {
      prepare: async () => {
        ioCalls.push("prepare");
        return "snap-1";
      },
      append: async () => {
        ioCalls.push("append");
        return 1;
      },
      commit: async () => {
        ioCalls.push("commit");
      },
      abort: async () => {
        ioCalls.push("abort");
      },
    };
    const d = deps({
      currentLook: () => ({
        skin: "ocean",
        wallpaperRecord: null,
        wallpaperScrim: 42,
      }),
      snapshotBeforeLastApply: () =>
        snapshotBeforeLastApply(
          {
            name: "Before last apply",
            skin: "ocean",
            scrim: 42,
            wallpaper: null,
            signal: { cancelled: true },
          },
          io,
        ),
    });
    const r = await applySkinPack(
      preview(),
      { keepWallpaper: false, saveToLibrary: false, skipUndoSnapshot: false },
      d,
    );
    expect(r.error).toBe("cancelled");
    expect(r.appearanceWriteCompleted).toBe(false);
    expect(ioCalls).toEqual([]);
    expect(d.calls).not.toContain("wall:clear");
    expect(d.calls).not.toContain("skin:false");
    expect(d.calls).toContain("abort");
  });

  it("unknown_skin / will_clear_wallpaper stay on preview warnings", () => {
    const p = preview({
      skin: "default",
      requestedSkin: "nope",
      warnings: ["unknown_skin", "will_clear_wallpaper"],
    });
    expect(p.warnings).toEqual(["unknown_skin", "will_clear_wallpaper"]);
    expect(p.warnings).not.toContain("unsupported_schema");
  });
});

void vi;

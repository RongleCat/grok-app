import { describe, expect, it } from "vitest";
import {
  currentLookManifest,
  onSkinPreviewCancel,
  snapshotBeforeLastApply,
  type UndoSnapshotIo,
} from "./skinPresetStore";
import type { WallpaperRecord } from "./themeSkin";
function fakeIo(over: Partial<UndoSnapshotIo> & { calls: string[] }): UndoSnapshotIo & {
  calls: string[];
} {
  const { calls, ...rest } = over;
  return {
    prepare: async () => {
      calls.push("prepare");
      return "snap-1";
    },
    append: async () => {
      calls.push("append");
      return 1;
    },
    commit: async () => {
      calls.push("commit");
    },
    abort: async () => {
      calls.push("abort");
    },
    ...rest,
    calls,
  };
}

const oceanNoWallpaper = {
  name: "Before last apply",
  skin: "ocean" as const,
  scrim: 42,
  wallpaper: null,
};

describe("snapshotBeforeLastApply cancel", () => {
  it("no-wallpaper look: cancel before start never prepares or commits", async () => {
    const io = fakeIo({ calls: [] });
    const r = await snapshotBeforeLastApply(
      { ...oceanNoWallpaper, signal: { cancelled: true } },
      io,
    );
    expect(r).toEqual({ ok: false, code: "cancelled" });
    expect(io.calls).toEqual([]);
  });

  it("no-wallpaper look: cancel after prepare aborts and does not commit", async () => {
    const signal = { cancelled: false };
    const io = fakeIo({
      calls: [],
      prepare: async () => {
        signal.cancelled = true;
        return "snap-1";
      },
    });
    const r = await snapshotBeforeLastApply({ ...oceanNoWallpaper, signal }, io);
    expect(r).toEqual({ ok: false, code: "cancelled" });
    expect(io.calls).toContain("abort");
    expect(io.calls).not.toContain("commit");
  });

  it("no-wallpaper look: cancel after prepare via flag before commit", async () => {
    const signal = { cancelled: false };
    const io = fakeIo({
      calls: [],
      prepare: async () => {
        io.calls.push("prepare");
        return "snap-1";
      },
    });
    const pending = snapshotBeforeLastApply({ ...oceanNoWallpaper, signal }, io);
    signal.cancelled = true;
    const r = await pending;
    expect(r).toEqual({ ok: false, code: "cancelled" });
    expect(io.calls).not.toContain("commit");
  });

  it("commits when not cancelled (no wallpaper)", async () => {
    const io = fakeIo({ calls: [] });
    const r = await snapshotBeforeLastApply(
      { ...oceanNoWallpaper, signal: { cancelled: false } },
      io,
    );
    expect(r).toEqual({ ok: true });
    expect(io.calls).toEqual(["prepare", "commit"]);
  });
});

describe("currentLookManifest", () => {
  const video: WallpaperRecord = {
    kind: "video",
    mime: "video/mp4",
    name: "loop.mp4",
    createdAt: 1,
    width: 1920,
    height: 1080,
    focus: { cx: 0.4, cy: 0.35, zoom: 2 },
    clip: { start: 2, end: 8 },
    blob: new Blob(["x"], { type: "video/mp4" }),
  };

  it("keeps focus/clip and stamps viewAspect for video so export can bake", () => {
    const man = currentLookManifest({
      name: "Harbor dusk",
      skin: "ocean",
      scrim: 42,
      wallpaper: video,
      viewAspect: 1.6,
    });
    expect(man.wallpaper).toMatchObject({
      kind: "video",
      file: "assets/wallpaper.mp4",
      focus: { cx: 0.4, cy: 0.35, zoom: 2 },
      clip: { start: 2, end: 8 },
      viewAspect: 1.6,
      width: 1920,
      height: 1080,
    });
  });

  it("stamps viewAspect on still images so export can bake the crop", () => {
    const man = currentLookManifest({
      name: "Harbor dusk",
      skin: "ocean",
      scrim: 42,
      wallpaper: {
        kind: "image",
        mime: "image/png",
        name: "bg.png",
        createdAt: 1,
        focus: { cx: 0.4, cy: 0.35, zoom: 2 },
        blob: new Blob(["x"], { type: "image/png" }),
      },
      viewAspect: 1.6,
    });
    expect(man.wallpaper).toMatchObject({
      kind: "image",
      viewAspect: 1.6,
      focus: { cx: 0.4, cy: 0.35, zoom: 2 },
    });
  });

  it("writes default focus when the current look omitted it", () => {
    const man = currentLookManifest({
      name: "Harbor dusk",
      skin: "ocean",
      scrim: 42,
      wallpaper: {
        kind: "image",
        mime: "image/png",
        name: "bg.png",
        createdAt: 1,
        blob: new Blob(["x"], { type: "image/png" }),
      },
      viewAspect: 1.6,
    });
    expect(man.wallpaper?.focus).toEqual({ cx: 0.5, cy: 0.5, zoom: 1 });
    expect(man.wallpaper?.viewAspect).toBe(1.6);
  });
});

describe("onSkinPreviewCancel", () => {
  it("while applying only signals; does not dismiss (prevents silent apply)", () => {
    const signal = { cancelled: false };
    expect(onSkinPreviewCancel(true, signal)).toEqual({ dismiss: false });
    expect(signal.cancelled).toBe(true);
  });

  it("when idle dismisses the preview", () => {
    const signal = { cancelled: false };
    expect(onSkinPreviewCancel(false, signal)).toEqual({ dismiss: true });
    expect(signal.cancelled).toBe(true);
  });
});



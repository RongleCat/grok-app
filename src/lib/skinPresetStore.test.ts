import { describe, expect, it } from "vitest";
import {
  onSkinPreviewCancel,
  snapshotBeforeLastApply,
  type UndoSnapshotIo,
} from "./skinPresetStore";
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



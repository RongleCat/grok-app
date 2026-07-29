import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_NOTIFY_SOUND,
  NOTIFY_SOUND_STORAGE_KEY,
  loadNotifySoundPref,
  parseNotifySoundPref,
  playNotifySound,
  saveNotifySoundPref,
  type NotifySoundStorage,
} from "./notifySound";

function memoryStorage(
  initial: Record<string, string> = {},
): NotifySoundStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return key in data ? data[key]! : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
  };
}

describe("notifySound pref", () => {
  it("defaults to false (off)", () => {
    expect(DEFAULT_NOTIFY_SOUND).toBe(false);
    expect(parseNotifySoundPref(null)).toBe(false);
    expect(parseNotifySoundPref("")).toBe(false);
    expect(parseNotifySoundPref("maybe")).toBe(false);
    expect(loadNotifySoundPref(memoryStorage())).toBe(false);
  });

  it("parses true/false variants", () => {
    expect(parseNotifySoundPref("1")).toBe(true);
    expect(parseNotifySoundPref("true")).toBe(true);
    expect(parseNotifySoundPref(true)).toBe(true);
    expect(parseNotifySoundPref("0")).toBe(false);
    expect(parseNotifySoundPref("false")).toBe(false);
    expect(parseNotifySoundPref(false)).toBe(false);
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveNotifySoundPref(true, s);
    expect(s.data[NOTIFY_SOUND_STORAGE_KEY]).toBe("1");
    expect(loadNotifySoundPref(s)).toBe(true);
    saveNotifySoundPref(false, s);
    expect(s.data[NOTIFY_SOUND_STORAGE_KEY]).toBe("0");
    expect(loadNotifySoundPref(s)).toBe(false);
  });

  it("load returns default when storage throws", () => {
    const broken: NotifySoundStorage = {
      getItem() {
        throw new Error("private");
      },
      setItem() {
        throw new Error("private");
      },
    };
    expect(loadNotifySoundPref(broken)).toBe(false);
    expect(() => saveNotifySoundPref(true, broken)).not.toThrow();
  });
});

describe("playNotifySound", () => {
  const g = globalThis as {
    AudioContext?: unknown;
    webkitAudioContext?: unknown;
  };

  afterEach(() => {
    vi.restoreAllMocks();
    delete g.AudioContext;
    delete g.webkitAudioContext;
  });

  it("returns false when AudioContext is missing", () => {
    delete g.AudioContext;
    delete g.webkitAudioContext;
    expect(playNotifySound()).toBe(false);
  });

  it("plays a short oscillator and returns true", () => {
    const start = vi.fn();
    const stop = vi.fn();
    const connect = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    const setValueAtTime = vi.fn();
    const exponentialRampToValueAtTime = vi.fn();
    const gainNode = {
      gain: { setValueAtTime, exponentialRampToValueAtTime },
      connect,
    };
    const osc = {
      type: "sine" as OscillatorType,
      frequency: { value: 0 },
      connect,
      start,
      stop,
      onended: null as (() => void) | null,
    };
    const createOscillator = vi.fn(() => osc);
    const createGain = vi.fn(() => gainNode);
    class FakeAudioContext {
      currentTime = 0;
      createOscillator = createOscillator;
      createGain = createGain;
      destination = {};
      close = close;
    }
    g.AudioContext = FakeAudioContext;

    expect(playNotifySound()).toBe(true);
    expect(createOscillator).toHaveBeenCalledOnce();
    expect(createGain).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
    expect(osc.frequency.value).toBe(880);
  });

  it("returns false when AudioContext constructor throws", () => {
    g.AudioContext = class {
      constructor() {
        throw new Error("blocked");
      }
    };
    expect(playNotifySound()).toBe(false);
  });
});

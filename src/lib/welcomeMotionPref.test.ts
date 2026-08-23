import { describe, expect, it } from "vitest";
import {
  DEFAULT_WELCOME_MOTION,
  loadWelcomeMotionPref,
  parseWelcomeMotionPref,
  saveWelcomeMotionPref,
  WELCOME_MOTION_STORAGE_KEY,
} from "./welcomeMotionPref";

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
  };
}

describe("welcomeMotionPref", () => {
  it("defaults on", () => {
    expect(DEFAULT_WELCOME_MOTION).toBe(true);
    expect(parseWelcomeMotionPref(null)).toBe(true);
    expect(parseWelcomeMotionPref("invalid")).toBe(true);
  });

  it("parses boolean storage values", () => {
    expect(parseWelcomeMotionPref("1")).toBe(true);
    expect(parseWelcomeMotionPref("true")).toBe(true);
    expect(parseWelcomeMotionPref(true)).toBe(true);
    expect(parseWelcomeMotionPref("0")).toBe(false);
    expect(parseWelcomeMotionPref("false")).toBe(false);
    expect(parseWelcomeMotionPref(false)).toBe(false);
  });

  it("round-trips load and save", () => {
    const storage = memoryStorage();
    expect(loadWelcomeMotionPref(storage)).toBe(true);
    saveWelcomeMotionPref(false, storage);
    expect(storage.getItem(WELCOME_MOTION_STORAGE_KEY)).toBe("0");
    expect(loadWelcomeMotionPref(storage)).toBe(false);
    saveWelcomeMotionPref(true, storage);
    expect(storage.getItem(WELCOME_MOTION_STORAGE_KEY)).toBe("1");
    expect(loadWelcomeMotionPref(storage)).toBe(true);
  });
});

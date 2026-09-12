import { describe, expect, it } from "vitest";
import {
  ASK_USER_TIMEOUT_MAX_SEC,
  ASK_USER_TIMEOUT_PRESETS,
  ASK_USER_TIMEOUT_STORAGE_KEY,
  DEFAULT_ASK_USER_TIMEOUT_SEC,
  askUserTimeoutRemainingSec,
  loadAskUserTimeoutSec,
  parseAskUserTimeoutSec,
  saveAskUserTimeoutSec,
  type AskUserTimeoutStorage,
} from "./askUserTimeout";

function memoryStorage(
  initial: Record<string, string> = {},
): AskUserTimeoutStorage & { data: Record<string, string> } {
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

describe("parseAskUserTimeoutSec", () => {
  it("defaults to off (0)", () => {
    expect(DEFAULT_ASK_USER_TIMEOUT_SEC).toBe(0);
    expect(parseAskUserTimeoutSec(null)).toBe(0);
    expect(parseAskUserTimeoutSec(undefined)).toBe(0);
    expect(parseAskUserTimeoutSec("")).toBe(0);
    expect(parseAskUserTimeoutSec("nope")).toBe(0);
    expect(parseAskUserTimeoutSec(-1)).toBe(0);
    expect(parseAskUserTimeoutSec(true)).toBe(0);
  });

  it("accepts presets and free numbers", () => {
    for (const p of ASK_USER_TIMEOUT_PRESETS) {
      expect(parseAskUserTimeoutSec(p)).toBe(p);
      expect(parseAskUserTimeoutSec(String(p))).toBe(p);
    }
    expect(parseAskUserTimeoutSec(45)).toBe(45);
    expect(parseAskUserTimeoutSec(" 90 ")).toBe(90);
    expect(parseAskUserTimeoutSec(30.4)).toBe(30);
    expect(parseAskUserTimeoutSec(30.6)).toBe(31);
  });

  it("clamps to max", () => {
    expect(parseAskUserTimeoutSec(ASK_USER_TIMEOUT_MAX_SEC + 1)).toBe(
      ASK_USER_TIMEOUT_MAX_SEC,
    );
  });
});

describe("load / save", () => {
  it("persists and reloads after simulated relaunch", () => {
    const storage = memoryStorage();
    expect(loadAskUserTimeoutSec(storage)).toBe(0);
    saveAskUserTimeoutSec(60, storage);
    expect(storage.data[ASK_USER_TIMEOUT_STORAGE_KEY]).toBe("60");
    expect(loadAskUserTimeoutSec(storage)).toBe(60);
    saveAskUserTimeoutSec(0, storage);
    expect(loadAskUserTimeoutSec(storage)).toBe(0);
  });

  it("loads free number from storage", () => {
    const storage = memoryStorage({
      [ASK_USER_TIMEOUT_STORAGE_KEY]: "45",
    });
    expect(loadAskUserTimeoutSec(storage)).toBe(45);
  });
});

describe("askUserTimeoutRemainingSec", () => {
  it("returns 0 when timeout is off or invalid", () => {
    expect(askUserTimeoutRemainingSec(1000, 0, 1000)).toBe(0);
    expect(askUserTimeoutRemainingSec(1000, -5, 1000)).toBe(0);
    expect(askUserTimeoutRemainingSec(NaN, 30, 1000)).toBe(0);
    expect(askUserTimeoutRemainingSec(1000, 30, NaN)).toBe(0);
  });

  it("returns full timeout at start (ceil)", () => {
    const start = 1_000_000;
    expect(askUserTimeoutRemainingSec(start, 30, start)).toBe(30);
    expect(askUserTimeoutRemainingSec(start, 30, start + 1)).toBe(30);
  });

  it("counts down and floors at 0", () => {
    const start = 1_000_000;
    expect(askUserTimeoutRemainingSec(start, 30, start + 1000)).toBe(29);
    expect(askUserTimeoutRemainingSec(start, 30, start + 29_000)).toBe(1);
    expect(askUserTimeoutRemainingSec(start, 30, start + 30_000)).toBe(0);
    expect(askUserTimeoutRemainingSec(start, 30, start + 60_000)).toBe(0);
  });
});

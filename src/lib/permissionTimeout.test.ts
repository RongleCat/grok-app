import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERMISSION_TIMEOUT_SEC,
  PERMISSION_TIMEOUT_MAX_SEC,
  PERMISSION_TIMEOUT_PRESETS,
  PERMISSION_TIMEOUT_STORAGE_KEY,
  loadPermissionTimeoutSec,
  parsePermissionTimeoutSec,
  permissionTimeoutRemainingSec,
  savePermissionTimeoutSec,
  type PermissionTimeoutStorage,
} from "./permissionTimeout";

function memoryStorage(
  initial: Record<string, string> = {},
): PermissionTimeoutStorage & { data: Record<string, string> } {
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

describe("parsePermissionTimeoutSec", () => {
  it("defaults to off (0)", () => {
    expect(DEFAULT_PERMISSION_TIMEOUT_SEC).toBe(0);
    expect(parsePermissionTimeoutSec(null)).toBe(0);
    expect(parsePermissionTimeoutSec(undefined)).toBe(0);
    expect(parsePermissionTimeoutSec("")).toBe(0);
    expect(parsePermissionTimeoutSec("nope")).toBe(0);
    expect(parsePermissionTimeoutSec(-1)).toBe(0);
    expect(parsePermissionTimeoutSec(true)).toBe(0);
  });

  it("accepts presets and free numbers", () => {
    for (const p of PERMISSION_TIMEOUT_PRESETS) {
      expect(parsePermissionTimeoutSec(p)).toBe(p);
      expect(parsePermissionTimeoutSec(String(p))).toBe(p);
    }
    expect(parsePermissionTimeoutSec(45)).toBe(45);
    expect(parsePermissionTimeoutSec(" 90 ")).toBe(90);
    expect(parsePermissionTimeoutSec(30.4)).toBe(30);
    expect(parsePermissionTimeoutSec(30.6)).toBe(31);
  });

  it("clamps to max", () => {
    expect(parsePermissionTimeoutSec(PERMISSION_TIMEOUT_MAX_SEC + 1)).toBe(
      PERMISSION_TIMEOUT_MAX_SEC,
    );
  });
});

describe("load / save", () => {
  it("persists and reloads after simulated relaunch", () => {
    const storage = memoryStorage();
    expect(loadPermissionTimeoutSec(storage)).toBe(0);
    savePermissionTimeoutSec(60, storage);
    expect(storage.data[PERMISSION_TIMEOUT_STORAGE_KEY]).toBe("60");
    expect(loadPermissionTimeoutSec(storage)).toBe(60);
    savePermissionTimeoutSec(0, storage);
    expect(loadPermissionTimeoutSec(storage)).toBe(0);
  });

  it("loads free number from storage", () => {
    const storage = memoryStorage({
      [PERMISSION_TIMEOUT_STORAGE_KEY]: "45",
    });
    expect(loadPermissionTimeoutSec(storage)).toBe(45);
  });
});

describe("permissionTimeoutRemainingSec", () => {
  it("returns 0 when timeout is off or invalid", () => {
    expect(permissionTimeoutRemainingSec(1000, 0, 1000)).toBe(0);
    expect(permissionTimeoutRemainingSec(1000, -5, 1000)).toBe(0);
    expect(permissionTimeoutRemainingSec(NaN, 30, 1000)).toBe(0);
    expect(permissionTimeoutRemainingSec(1000, 30, NaN)).toBe(0);
  });

  it("returns full timeout at start (ceil)", () => {
    const start = 1_000_000;
    expect(permissionTimeoutRemainingSec(start, 30, start)).toBe(30);
    expect(permissionTimeoutRemainingSec(start, 30, start + 1)).toBe(30);
  });

  it("counts down and floors at 0", () => {
    const start = 1_000_000;
    expect(permissionTimeoutRemainingSec(start, 30, start + 1000)).toBe(29);
    expect(permissionTimeoutRemainingSec(start, 30, start + 29_000)).toBe(1);
    expect(permissionTimeoutRemainingSec(start, 30, start + 30_000)).toBe(0);
    expect(permissionTimeoutRemainingSec(start, 30, start + 60_000)).toBe(0);
  });

  it("reports true remaining time from a clock that started earlier", () => {
    // Resuming a request's clock (see lib/gateClock) must show what is left,
    // not the full timeout the bar used to restart with on every remount.
    const start = 1_000_000;
    expect(permissionTimeoutRemainingSec(start, 30, start + 20_000)).toBe(10);
  });
});

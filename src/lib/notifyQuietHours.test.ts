import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFY_QUIET_HOURS,
  NOTIFY_QUIET_HOURS_STORAGE_KEY,
  isInQuietHours,
  loadNotifyQuietHoursPref,
  normalizeHHmm,
  parseNotifyQuietHoursPref,
  parseTimeToMinutes,
  saveNotifyQuietHoursPref,
  type NotifyQuietHoursPref,
  type NotifyQuietHoursStorage,
} from "./notifyQuietHours";

function memoryStorage(
  initial: Record<string, string> = {},
): NotifyQuietHoursStorage & { data: Record<string, string> } {
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

function at(h: number, m: number): Date {
  // Fixed calendar day so only clock matters.
  return new Date(2026, 0, 15, h, m, 0, 0);
}

describe("parseTimeToMinutes / normalizeHHmm", () => {
  it("parses HH:mm variants", () => {
    expect(parseTimeToMinutes("00:00")).toBe(0);
    expect(parseTimeToMinutes("9:05")).toBe(9 * 60 + 5);
    expect(parseTimeToMinutes("22:00")).toBe(22 * 60);
    expect(parseTimeToMinutes("23:59")).toBe(23 * 60 + 59);
    // HTML <input type="time"> may include seconds.
    expect(parseTimeToMinutes("22:00:00")).toBe(22 * 60);
    expect(normalizeHHmm("9:05:30")).toBe("09:05");
  });

  it("rejects invalid times", () => {
    expect(parseTimeToMinutes("")).toBeNull();
    expect(parseTimeToMinutes("24:00")).toBeNull();
    expect(parseTimeToMinutes("12:60")).toBeNull();
    expect(parseTimeToMinutes("noon")).toBeNull();
    expect(parseTimeToMinutes("22:0")).toBeNull();
  });

  it("normalizes to zero-padded HH:mm", () => {
    expect(normalizeHHmm("9:05")).toBe("09:05");
    expect(normalizeHHmm("22:00")).toBe("22:00");
    expect(normalizeHHmm("bad")).toBeNull();
  });
});

describe("isInQuietHours", () => {
  const overnight: NotifyQuietHoursPref = {
    enabled: true,
    start: "22:00",
    end: "08:00",
  };

  it("returns false when disabled", () => {
    expect(
      isInQuietHours(at(23, 0), { ...overnight, enabled: false }),
    ).toBe(false);
    expect(isInQuietHours(at(23, 0), null)).toBe(false);
    expect(isInQuietHours(at(23, 0), undefined)).toBe(false);
  });

  it("handles overnight range (22:00–08:00)", () => {
    expect(isInQuietHours(at(22, 0), overnight)).toBe(true);
    expect(isInQuietHours(at(23, 30), overnight)).toBe(true);
    expect(isInQuietHours(at(0, 0), overnight)).toBe(true);
    expect(isInQuietHours(at(7, 59), overnight)).toBe(true);
    // End is exclusive — quiet ends at 08:00.
    expect(isInQuietHours(at(8, 0), overnight)).toBe(false);
    expect(isInQuietHours(at(12, 0), overnight)).toBe(false);
    expect(isInQuietHours(at(21, 59), overnight)).toBe(false);
  });

  it("handles same-day range (09:00–17:00)", () => {
    const day: NotifyQuietHoursPref = {
      enabled: true,
      start: "09:00",
      end: "17:00",
    };
    expect(isInQuietHours(at(9, 0), day)).toBe(true);
    expect(isInQuietHours(at(12, 0), day)).toBe(true);
    expect(isInQuietHours(at(16, 59), day)).toBe(true);
    expect(isInQuietHours(at(17, 0), day)).toBe(false);
    expect(isInQuietHours(at(8, 59), day)).toBe(false);
    expect(isInQuietHours(at(22, 0), day)).toBe(false);
  });

  it("treats start === end as zero-width (never quiet)", () => {
    const same: NotifyQuietHoursPref = {
      enabled: true,
      start: "12:00",
      end: "12:00",
    };
    expect(isInQuietHours(at(12, 0), same)).toBe(false);
    expect(isInQuietHours(at(0, 0), same)).toBe(false);
  });

  it("returns false for invalid times", () => {
    expect(
      isInQuietHours(at(23, 0), {
        enabled: true,
        start: "bad",
        end: "08:00",
      }),
    ).toBe(false);
  });
});

describe("parse / load / save notify quiet hours", () => {
  it("defaults when empty or invalid", () => {
    expect(DEFAULT_NOTIFY_QUIET_HOURS).toEqual({
      enabled: false,
      start: "22:00",
      end: "08:00",
    });
    expect(parseNotifyQuietHoursPref(null)).toEqual(DEFAULT_NOTIFY_QUIET_HOURS);
    expect(parseNotifyQuietHoursPref("")).toEqual(DEFAULT_NOTIFY_QUIET_HOURS);
    expect(parseNotifyQuietHoursPref("not-json")).toEqual(
      DEFAULT_NOTIFY_QUIET_HOURS,
    );
    expect(loadNotifyQuietHoursPref(memoryStorage())).toEqual(
      DEFAULT_NOTIFY_QUIET_HOURS,
    );
  });

  it("parses partial / normalized objects", () => {
    expect(
      parseNotifyQuietHoursPref({
        enabled: true,
        start: "9:30",
        end: "18:00",
      }),
    ).toEqual({ enabled: true, start: "09:30", end: "18:00" });
    expect(
      parseNotifyQuietHoursPref(
        JSON.stringify({ enabled: true, start: "22:00", end: "08:00" }),
      ),
    ).toEqual({ enabled: true, start: "22:00", end: "08:00" });
    // Missing fields fall back to defaults.
    expect(parseNotifyQuietHoursPref({ enabled: true })).toEqual({
      enabled: true,
      start: "22:00",
      end: "08:00",
    });
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    const pref: NotifyQuietHoursPref = {
      enabled: true,
      start: "23:00",
      end: "07:30",
    };
    saveNotifyQuietHoursPref(pref, s);
    expect(s.data[NOTIFY_QUIET_HOURS_STORAGE_KEY]).toBe(
      JSON.stringify({ enabled: true, start: "23:00", end: "07:30" }),
    );
    expect(loadNotifyQuietHoursPref(s)).toEqual(pref);
  });

  it("normalizes on save", () => {
    const s = memoryStorage();
    saveNotifyQuietHoursPref(
      { enabled: true, start: "9:05", end: "18:00" },
      s,
    );
    expect(loadNotifyQuietHoursPref(s)).toEqual({
      enabled: true,
      start: "09:05",
      end: "18:00",
    });
  });
});

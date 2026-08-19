import { describe, expect, it } from "vitest";
import { formatListTimestamp } from "./formatDateTime";

const ISO = "2026-04-15T09:05:00Z";

describe("formatListTimestamp", () => {
  it("follows the locale it is given", () => {
    // Deliberately no exact-string assertions: the output also depends on the
    // runner's time zone. What must hold is that the locale reaches Intl.
    const ja = formatListTimestamp(ISO, "ja");
    const de = formatListTimestamp(ISO, "de");
    const en = formatListTimestamp(ISO, "en");

    expect(ja).toContain("年");
    expect(ja).toContain("月");
    expect(de).not.toBe(en);
    expect(new Set([ja, de, en]).size).toBe(3);
  });

  it("maps a catalog id to its full BCP-47 tag", () => {
    // `zh` and `zh-TW` share a language but not a calendar rendering, so the
    // helper must not collapse them onto the macrolanguage.
    expect(formatListTimestamp(ISO, "zh")).not.toBe(
      formatListTimestamp(ISO, "zh-TW"),
    );
  });

  it("falls back to English for an unset or unknown locale", () => {
    const en = formatListTimestamp(ISO, "en");
    expect(formatListTimestamp(ISO, null)).toBe(en);
    expect(formatListTimestamp(ISO, undefined)).toBe(en);
    expect(formatListTimestamp(ISO, "kl")).toBe(en);
  });

  it("returns unparseable input untouched", () => {
    expect(formatListTimestamp("not a date", "ja")).toBe("not a date");
    expect(formatListTimestamp("", "ja")).toBe("");
  });
});

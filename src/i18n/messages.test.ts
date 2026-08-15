import { describe, expect, it } from "vitest";
import {
  createT,
  messages,
  htmlLangForLocale,
  migrateLegacyLocaleDefault,
  parseLocalePreference,
  readSystemLangTag,
  resolveLocale,
  resolveLocaleFromSystem,
  resolveLocalePreference,
  t,
  type MessageKey,
} from "./index";

describe("i18n catalog", () => {
  it("en and zh share the same keys", () => {
    const enKeys = Object.keys(messages.en).sort();
    const zhKeys = Object.keys(messages.zh).sort();
    expect(zhKeys).toEqual(enKeys);
  });

  it("zh-TW shares the same keys as en", () => {
    const enKeys = Object.keys(messages.en).sort();
    const twKeys = Object.keys(messages["zh-TW"]).sort();
    expect(twKeys).toEqual(enKeys);
  });

  it("interpolates variables", () => {
    expect(t("en", "project.trustFirst", { name: "Demo" })).toContain("Demo");
    expect(t("zh", "project.trustFirst", { name: "演示" })).toContain("演示");
  });

  it("createT binds locale (English is the product default)", () => {
    const tr = createT("en");
    expect(tr("sidebar.settings")).toBe("Settings");
    const zh = createT("zh");
    expect(zh("sidebar.settings")).toBe("设置");
  });

  it("every value is a non-empty string", () => {
    for (const loc of ["en", "zh", "zh-TW"] as const) {
      for (const [k, v] of Object.entries(messages[loc])) {
        expect(v.trim().length, `${loc}.${k}`).toBeGreaterThan(0);
      }
    }
  });

  it("type surface accepts known keys only", () => {
    const key: MessageKey = "composer.send";
    expect(t("en", key)).toBeTruthy();
  });
});

describe("resolveLocale", () => {
  it("keeps canonical ids unchanged", () => {
    expect(resolveLocale("zh-TW")).toBe("zh-TW");
    expect(resolveLocale("zh")).toBe("zh");
    expect(resolveLocale("en")).toBe("en");
  });

  it("accepts case/alias variants of Traditional Chinese", () => {
    expect(resolveLocale("zh-tw")).toBe("zh-TW");
    expect(resolveLocale("zh_TW")).toBe("zh-TW");
    expect(resolveLocale("zh-Hant")).toBe("zh-TW");
    expect(resolveLocale(" ZH-HANT ")).toBe("zh-TW");
  });

  it("accepts case/alias variants of Simplified Chinese and English", () => {
    expect(resolveLocale("ZH")).toBe("zh");
    expect(resolveLocale("zh-CN")).toBe("zh");
    expect(resolveLocale("EN-US")).toBe("en");
  });

  it("falls back to the product default for unknown or empty ids", () => {
    expect(resolveLocale("fr")).toBe("en");
    expect(resolveLocale("")).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
    expect(resolveLocale(null)).toBe("en");
  });
});

describe("resolveLocaleFromSystem", () => {
  it("maps English tags to en", () => {
    expect(resolveLocaleFromSystem("en")).toBe("en");
    expect(resolveLocaleFromSystem("en-US")).toBe("en");
    expect(resolveLocaleFromSystem("en_GB")).toBe("en");
    expect(resolveLocaleFromSystem("en-AU")).toBe("en");
  });

  it("maps Simplified Chinese tags to zh", () => {
    expect(resolveLocaleFromSystem("zh")).toBe("zh");
    expect(resolveLocaleFromSystem("zh-CN")).toBe("zh");
    expect(resolveLocaleFromSystem("zh_CN")).toBe("zh");
    expect(resolveLocaleFromSystem("zh-Hans")).toBe("zh");
    expect(resolveLocaleFromSystem("zh-Hans-CN")).toBe("zh");
    expect(resolveLocaleFromSystem("zh-SG")).toBe("zh");
    expect(resolveLocaleFromSystem("zh_CN.UTF-8")).toBe("zh");
  });

  it("maps Traditional Chinese tags to zh-TW", () => {
    expect(resolveLocaleFromSystem("zh-TW")).toBe("zh-TW");
    expect(resolveLocaleFromSystem("zh_TW")).toBe("zh-TW");
    expect(resolveLocaleFromSystem("zh-Hant")).toBe("zh-TW");
    expect(resolveLocaleFromSystem("zh-Hant-TW")).toBe("zh-TW");
    expect(resolveLocaleFromSystem("zh-HK")).toBe("zh-TW");
    expect(resolveLocaleFromSystem("zh-MO")).toBe("zh-TW");
    expect(resolveLocaleFromSystem("zh_TW.UTF-8")).toBe("zh-TW");
  });

  it("falls back to en for unknown or empty tags", () => {
    expect(resolveLocaleFromSystem("fr")).toBe("en");
    expect(resolveLocaleFromSystem("ja-JP")).toBe("en");
    expect(resolveLocaleFromSystem("")).toBe("en");
    expect(resolveLocaleFromSystem("   ")).toBe("en");
    expect(resolveLocaleFromSystem(undefined)).toBe("en");
    expect(resolveLocaleFromSystem(null)).toBe("en");
  });
});

describe("parseLocalePreference / resolveLocalePreference", () => {
  it("keeps system and canonical locales", () => {
    expect(parseLocalePreference("system")).toBe("system");
    expect(parseLocalePreference("System")).toBe("system");
    expect(parseLocalePreference("en")).toBe("en");
    expect(parseLocalePreference("zh")).toBe("zh");
    expect(parseLocalePreference("zh-TW")).toBe("zh-TW");
  });

  it("normalizes aliases and invalid values", () => {
    expect(parseLocalePreference("zh-cn")).toBe("zh");
    expect(parseLocalePreference("zh-hant")).toBe("zh-TW");
    expect(parseLocalePreference("fr")).toBe("en");
  });

  it("treats a missing preference as follow-system", () => {
    expect(parseLocalePreference("")).toBe("system");
    expect(parseLocalePreference(undefined)).toBe("system");
    expect(parseLocalePreference(null)).toBe("system");
  });

  it("resolves system preference via an explicit lang tag", () => {
    expect(resolveLocalePreference("system", "zh-CN")).toBe("zh");
    expect(resolveLocalePreference("system", "zh-TW")).toBe("zh-TW");
    expect(resolveLocalePreference("system", "en-US")).toBe("en");
    expect(resolveLocalePreference("system", "de")).toBe("en");
  });

  it("returns explicit preferences unchanged", () => {
    expect(resolveLocalePreference("zh", "en-US")).toBe("zh");
    expect(resolveLocalePreference("en", "zh-CN")).toBe("en");
    expect(resolveLocalePreference("zh-TW", "en")).toBe("zh-TW");
  });

  it("lifts the factory English default to follow-system once", () => {
    expect(migrateLegacyLocaleDefault("en")).toBe("system");
    expect(migrateLegacyLocaleDefault("EN")).toBe("system");
    expect(migrateLegacyLocaleDefault("  en  ")).toBe("system");
    expect(migrateLegacyLocaleDefault("zh")).toBeNull();
    expect(migrateLegacyLocaleDefault("zh-TW")).toBeNull();
    expect(migrateLegacyLocaleDefault("system")).toBeNull();
  });

  it("maps catalog locales to html lang tags", () => {
    expect(htmlLangForLocale("zh")).toBe("zh-CN");
    expect(htmlLangForLocale("zh-TW")).toBe("zh-TW");
    expect(htmlLangForLocale("en")).toBe("en");
  });

  it("prefers Host boot OS lang over navigator when present", () => {
    const g = globalThis as { window?: { __GROK_BOOT_OS_LANG__?: string } };
    const prev = g.window;
    g.window = { __GROK_BOOT_OS_LANG__: "zh-CN" };
    expect(readSystemLangTag()).toBe("zh-CN");
    g.window = prev;
  });
});

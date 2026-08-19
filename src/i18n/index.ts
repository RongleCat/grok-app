/**
 * App i18n helpers. All user-visible copy must go through `t()`.
 * See docs/llm-wiki/i18n.md for agent maintenance rules.
 */

import {
  LOCALES,
  isLocale,
  messages,
  type Locale,
  type MessageKey,
} from "./messages";

export type { Locale, MessageKey };
export { LOCALES, isLocale, messages };

/** User preference: explicit catalog locale or follow OS / browser language. */
export type LocalePreference = "system" | Locale;

/** Factory / missing-settings preference — follow the OS language. */
export const DEFAULT_LOCALE_PREFERENCE: LocalePreference = "system";

export type Vars = Record<string, string | number | undefined | null>;

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = vars[key];
    return v == null ? "" : String(v);
  });
}

/** Translate a key for the given locale. Missing keys fall back to English then the key. */
export function t(locale: Locale, key: MessageKey, vars?: Vars): string {
  const table = messages[locale] ?? messages.en;
  const raw = table[key] ?? messages.en[key] ?? String(key);
  return interpolate(raw, vars);
}

export function createT(locale: Locale) {
  return (key: MessageKey, vars?: Vars) => t(locale, key, vars);
}

/**
 * Extra spellings accepted for a catalog id beyond the canonical one and the
 * bare primary subtag (which {@link normalizeLocale} handles generically).
 *
 * Only list forms a user or an OS can realistically produce. Regional variants
 * that should collapse into a catalog live here; anything else falls through to
 * the primary-subtag match.
 */
const LOCALE_ALIASES: Readonly<Record<string, Locale>> = {
  "en-us": "en",
  "en-gb": "en",
  "en-au": "en",
  "en-ca": "en",
  "de-de": "de",
  "de-at": "de",
  "de-ch": "de",
  "es-es": "es",
  "es-mx": "es",
  "es-419": "es",
  "es-ar": "es",
  "fr-fr": "fr",
  "fr-ca": "fr",
  "fr-be": "fr",
  "fr-ch": "fr",
  "it-it": "it",
  "it-ch": "it",
  "id-id": "id",
  // Indonesian's retired ISO-639 code, still emitted by some Java/POSIX stacks.
  in: "id",
  "ja-jp": "ja",
  "ko-kr": "ko",
  "pt-br": "pt-BR",
  // European Portuguese has no catalog of its own — pt-BR is closer than English.
  "pt-pt": "pt-BR",
  pt: "pt-BR",
  "ru-ru": "ru",
  "uk-ua": "uk",
  "zh-cn": "zh",
  "zh-hans": "zh",
  "zh-sg": "zh",
  "zh-tw": "zh-TW",
  "zh-hant": "zh-TW",
  "zh-hk": "zh-TW",
  "zh-mo": "zh-TW",
};

/** Catalog ids keyed by their lowercase form, for case-insensitive lookup. */
const LOCALE_BY_LOWER: Readonly<Record<string, Locale>> = Object.fromEntries(
  LOCALES.map((l: Locale) => [l.toLowerCase(), l]),
);

/**
 * Best-effort normalization of a raw locale id to a canonical {@link Locale}.
 * Accepts common case/alias variants (e.g. "zh-tw", "zh_Hant", "pt_BR",
 * "EN-US") so a hand-edited settings value still resolves. Returns `null`
 * when the id is not a recognizable variant, leaving the fallback to the caller.
 * Mirrors the case-insensitive parsing on the Rust side (see tray_i18n.rs
 * `Locale::parse`).
 */
function normalizeLocale(raw: string): Locale | null {
  const v = raw.trim().toLowerCase().replace(/_/g, "-");
  if (!v) return null;
  return LOCALE_BY_LOWER[v] ?? LOCALE_ALIASES[v] ?? null;
}

/**
 * Map a BCP-47 / OS language tag (e.g. `navigator.language`) to a catalog
 * {@link Locale}. Pure — no `navigator` access. Unknown or empty tags → `en`.
 *
 * Rules:
 * - Chinese + Traditional script/region (`Hant`, `TW`, `HK`, `MO`) → `zh-TW`
 * - Other Chinese (`zh`, `zh-CN`, `zh-Hans`, `zh-SG`, …) → `zh`
 * - Any Portuguese (`pt`, `pt-PT`, `pt-BR`) → `pt-BR`
 * - Otherwise the primary subtag when it names a shipped catalog
 * - Everything else → product default `en`
 */
export function resolveLocaleFromSystem(
  langTag: string | null | undefined,
): Locale {
  if (langTag == null) return "en";
  const v = String(langTag).trim().toLowerCase().replace(/_/g, "-");
  if (!v) return "en";

  // Strip encoding suffix from POSIX tags: "zh_CN.UTF-8" → already "_"→"-",
  // still may have ".utf-8".
  const bare = v.split(".")[0] ?? v;
  const parts = bare.split("-");
  const primary = parts[0] ?? bare;

  if (primary === "zh") {
    // Script subtag or region for Traditional Chinese.
    if (
      parts.includes("hant") ||
      parts.includes("tw") ||
      parts.includes("hk") ||
      parts.includes("mo")
    ) {
      return "zh-TW";
    }
    return "zh";
  }

  // Exact tag (with region/script) wins over the bare primary subtag so
  // `pt-PT` and `zh-Hans-CN` land where their alias says.
  const exact = normalizeLocale(bare);
  if (exact) return exact;

  return normalizeLocale(primary) ?? "en";
}

export function isLocalePreference(v: unknown): v is LocalePreference {
  return v === "system" || (typeof v === "string" && isLocale(v));
}

/**
 * Parse a durable settings value into a {@link LocalePreference}.
 * Accepts `system`, canonical locales, and common aliases.
 * Missing / empty → follow system. Unrecognized ids → `en`.
 */
export function parseLocalePreference(
  raw: string | null | undefined,
): LocalePreference {
  if (raw == null) return DEFAULT_LOCALE_PREFERENCE;
  const trimmed = String(raw).trim();
  if (!trimmed) return DEFAULT_LOCALE_PREFERENCE;
  if (trimmed.toLowerCase() === "system") return "system";
  if (isLocale(trimmed)) return trimmed;
  return normalizeLocale(trimmed) ?? "en";
}

/**
 * One-shot lift of the old factory default (`en`) to follow-system.
 * Explicit catalog ids and `system` stay. Callers still set the migrated flag.
 */
export function migrateLegacyLocaleDefault(
  stored: string | null | undefined,
): LocalePreference | null {
  const trimmed = stored == null ? "" : String(stored).trim();
  if (!trimmed || trimmed.toLowerCase() === "en") return "system";
  return null;
}

/**
 * BCP-47 tag for a catalog locale — used for `<html lang>` and every `Intl.*`
 * constructor. Catalog ids are already valid BCP-47 except where a catalog
 * covers a wider language than its id implies.
 *
 * Never pass a raw catalog id to `Intl` directly: `zh` must resolve to `zh-CN`,
 * not the generic macrolanguage. A catalog whose language carries thin CLDR
 * data borrows a neighbouring tag here rather than reaching a formatter raw.
 */
const INTL_TAGS: Readonly<Record<Locale, string>> = {
  en: "en",
  de: "de-DE",
  es: "es-ES",
  fr: "fr-FR",
  id: "id-ID",
  it: "it-IT",
  ja: "ja-JP",
  ko: "ko-KR",
  "pt-BR": "pt-BR",
  ru: "ru-RU",
  uk: "uk-UA",
  zh: "zh-CN",
  "zh-TW": "zh-TW",
};

/**
 * Native name of each shipped locale, for the Settings language picker.
 *
 * Endonyms stay untranslated: a language picker must be readable to someone who
 * cannot yet read the current UI language. Keyed by {@link Locale}, so a new
 * catalog without a name — or a name for a locale we do not ship — is a type
 * error rather than a dropdown that offers an unsupported language.
 */
export const LOCALE_ENDONYMS: Readonly<Record<Locale, string>> = {
  en: "English",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
  id: "Bahasa Indonesia",
  it: "Italiano",
  ja: "日本語",
  ko: "한국어",
  "pt-BR": "Português (Brasil)",
  ru: "Русский",
  uk: "Українська",
  zh: "简体中文",
  "zh-TW": "繁體中文",
};

/** `<html lang>` for a resolved catalog locale. */
export function htmlLangForLocale(locale: Locale): string {
  if (locale === "zh") return "zh-CN";
  if (locale === "zh-TW") return "zh-TW";
  // Every other catalog id is already the honest document language. Where
  // `intlLocale` borrows another tag for thin CLDR data this must not follow —
  // a screen reader has to be told the language actually on screen.
  return locale;
}

/**
 * BCP-47 tag to hand to `Intl.DateTimeFormat` / `NumberFormat` /
 * `RelativeTimeFormat` for a catalog locale. Accepts a raw string so callers
 * holding an unvalidated settings value can use it directly.
 */
export function intlLocale(locale: string | null | undefined): string {
  if (!locale) return INTL_TAGS.en;
  const canonical = isLocale(locale) ? locale : normalizeLocale(locale);
  return canonical ? INTL_TAGS[canonical] : INTL_TAGS.en;
}

/**
 * True for CJK locales, whose typography sets a unit or weekday directly
 * against its number with no separating space (`火15:23`, `1時間30分`).
 * Everything else keeps the space (`Tue 15:23`, `1h 30m`).
 */
export function isTightScript(locale: string | null | undefined): boolean {
  if (!locale) return false;
  const primary = String(locale).trim().toLowerCase().split(/[-_]/)[0];
  // Korean is deliberately absent: its orthography spaces words, so a Korean
  // stat reads `화 15:23` / `9시간 36분`, not the Chinese/Japanese tight form.
  return primary === "zh" || primary === "ja";
}

type BootWindow = {
  __GROK_BOOT_OS_LANG__?: string;
  navigator?: { language?: string; languages?: readonly string[] };
};

/** Host-injected OS tag, else `navigator.languages[0]` / `navigator.language`. */
export function readSystemLangTag(): string | null {
  const w =
    typeof globalThis === "object"
      ? ((globalThis as { window?: BootWindow }).window ??
        (globalThis as BootWindow))
      : undefined;
  const boot = w?.__GROK_BOOT_OS_LANG__;
  if (typeof boot === "string" && boot.trim()) return boot.trim();
  const nav =
    w?.navigator ??
    (typeof navigator !== "undefined" ? navigator : undefined);
  if (nav) {
    const list = nav.languages;
    if (Array.isArray(list) && typeof list[0] === "string" && list[0].trim()) {
      return list[0];
    }
    if (typeof nav.language === "string" && nav.language.trim()) {
      return nav.language;
    }
  }
  return null;
}

/**
 * Resolve a user preference to a concrete catalog locale.
 * When preference is `system`, maps `systemLangTag` (or `navigator.language`
 * when available) via {@link resolveLocaleFromSystem}.
 */
export function resolveLocalePreference(
  preference: LocalePreference,
  systemLangTag?: string | null,
): Locale {
  if (preference !== "system") return preference;
  const tag =
    systemLangTag !== undefined ? systemLangTag : readSystemLangTag();
  return resolveLocaleFromSystem(tag);
}

/**
 * Resolve a stored settings locale string to a concrete catalog locale.
 * `"system"` follows OS / browser language; explicit ids stay as-is.
 */
export function resolveLocale(raw: string | undefined | null): Locale {
  if (!raw) return resolveLocalePreference(DEFAULT_LOCALE_PREFERENCE);
  if (raw.trim().toLowerCase() === "system") {
    return resolveLocalePreference("system");
  }
  if (isLocale(raw)) return raw;
  return normalizeLocale(raw) ?? "en";
}

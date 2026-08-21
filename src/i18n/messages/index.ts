/** Canonical UI message catalog. Keys must stay stable; add all locales together. */

import { en, type MessageKey } from "./en";

/**
 * Every shipped catalog id, in language-picker order (English first, then the
 * rest alphabetically by endonym as presented in Settings).
 *
 * Adding an entry here is the single source of truth: `Locale`, `isLocale`, and
 * the parity tests all derive from it. Keep the native locale parsing in
 * `src-tauri/src/tray_i18n.rs` in sync — see docs/llm-wiki/i18n.md.
 */
export const LOCALES = [
  "en",
  "de",
  "es",
  "fil",
  "fr",
  "id",
  "it",
  "ja",
  "ko",
  "pt-BR",
  "ru",
  "ta",
  "uk",
  "zh",
  "zh-TW",
] as const;

export type Locale = (typeof LOCALES)[number];

export type { MessageKey };

export { en };

type Catalog = Record<MessageKey, string>;

const catalogs: Partial<Record<Locale, Catalog>> = {
  en: en as Catalog,
};

/**
 * Live catalog table. English is always present; other locales are filled by
 * {@link loadLocaleCatalog}. Lookups must use `messages[locale] ?? messages.en`.
 */
export const messages = catalogs as Record<Locale, Catalog>;

const loaders: Record<Exclude<Locale, "en">, () => Promise<Catalog>> = {
  de: () => import("./de").then((m) => m.de),
  es: () => import("./es").then((m) => m.es),
  fil: () => import("./fil").then((m) => m.fil),
  fr: () => import("./fr").then((m) => m.fr),
  id: () => import("./id").then((m) => m.id),
  it: () => import("./it").then((m) => m.it),
  ja: () => import("./ja").then((m) => m.ja),
  ko: () => import("./ko").then((m) => m.ko),
  "pt-BR": () => import("./pt-BR").then((m) => m.ptBR),
  ru: () => import("./ru").then((m) => m.ru),
  ta: () => import("./ta").then((m) => m.ta),
  uk: () => import("./uk").then((m) => m.uk),
  zh: () => import("./zh").then((m) => m.zh),
  "zh-TW": () => import("./zh-TW").then((m) => m.zhTW),
};

const inflight = new Map<Locale, Promise<void>>();

export function isLocaleCatalogReady(locale: Locale): boolean {
  return locale === "en" || catalogs[locale] != null;
}

/** Load one catalog (no-op for English or a cache hit). */
export function loadLocaleCatalog(locale: Locale): Promise<void> {
  if (locale === "en") return Promise.resolve();
  if (isLocaleCatalogReady(locale)) return Promise.resolve();
  const existing = inflight.get(locale);
  if (existing) return existing;
  const pending = loaders[locale]().then((table) => {
    catalogs[locale] = table;
    inflight.delete(locale);
  });
  inflight.set(locale, pending);
  return pending;
}

/** Tests / tooling: fill every shipped catalog. */
export async function loadAllLocaleCatalogs(): Promise<void> {
  await Promise.all(LOCALES.map((locale) => loadLocaleCatalog(locale)));
}

export function isLocale(v: string): v is Locale {
  return (LOCALES as readonly string[]).includes(v);
}

/** Canonical UI message catalog. Keys must stay stable; add all locales together. */

import { de } from "./de";
import { en, type MessageKey } from "./en";
import { es } from "./es";
import { fil } from "./fil";
import { fr } from "./fr";
import { id } from "./id";
import { it } from "./it";
import { ja } from "./ja";
import { ko } from "./ko";
import { la } from "./la";
import { ptBR } from "./pt-BR";
import { ru } from "./ru";
import { sa } from "./sa";
import { ta } from "./ta";
import { uk } from "./uk";
import { zh } from "./zh";
import { zhTW } from "./zh-TW";

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
  "la",
  "pt-BR",
  "ru",
  "sa",
  "ta",
  "uk",
  "zh",
  "zh-TW",
] as const;

export type Locale = (typeof LOCALES)[number];

export type { MessageKey };

export { en };

export const messages: Record<Locale, Record<MessageKey, string>> = {
  en: en as Record<MessageKey, string>,
  de,
  es,
  fil,
  fr,
  id,
  it,
  ja,
  ko,
  la,
  "pt-BR": ptBR,
  ru,
  sa,
  ta,
  uk,
  zh,
  "zh-TW": zhTW,
};

export function isLocale(v: string): v is Locale {
  return (LOCALES as readonly string[]).includes(v);
}

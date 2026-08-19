import { intlLocale } from "@/i18n";

/**
 * Absolute timestamp for history / audit lists.
 *
 * Takes the app locale rather than reading the WebView's: passing `undefined`
 * to `toLocaleString` formats in whatever language the WebView reports, which
 * is the OS language on some launch paths and `en-US` on others — never the
 * language the user picked in Settings.
 */
export function formatListTimestamp(
  iso: string,
  locale: string | null | undefined,
): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso || "";
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(t));
  } catch {
    return iso;
  }
}

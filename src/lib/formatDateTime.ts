/**
 * Absolute timestamps for history and audit lists.
 *
 * Plan history, trace history and the mirror audit log each carried a
 * byte-identical copy of this helper, and all three passed `undefined` as the
 * locale — so the rows followed the WebView language instead of the language
 * the user picked in Settings. One implementation, one locale source.
 */

import { intlLocale } from "@/i18n";

/**
 * Day, short month, year and clock in the UI language
 * (`15 Apr 2026, 09:05` / `15. Apr. 2026, 09:05` / `2026年4月15日 09:05`).
 * Returns the raw string when it is not a parsable instant.
 */
export function formatListTimestamp(
  iso: string,
  // Required on purpose — see formatQuotaResetTime.
  locale: string | null,
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
      // 24-hour everywhere, like formatMessageTime and the tray templates.
      hour12: false,
    }).format(new Date(t));
  } catch {
    return iso;
  }
}

/**
 * Vitest loads this before specs. English is always in the catalog; other
 * locales are on-demand in the app. Tests that call createT("zh") need the
 * table filled or they silently get English.
 */
import { loadAllLocaleCatalogs } from "@/i18n";
import { ensureLocalStorage } from "@/test/ensureLocalStorage";

ensureLocalStorage();
await loadAllLocaleCatalogs();

/**
 * Routing table for error-banner primary actions (ErrorDeckActionId →
 * settings navigation target). Pure data so the host dispatcher stays a
 * lookup + grouped verbs instead of a 16-case switch.
 *
 * Actions that are NOT settings navigation (reconnect, doctor, mcp modal,
 * project verbs, turn control) stay in the host callback — they are real
 * side effects, not routes.
 */
import type { ErrorDeckActionId } from "@/lib/errorDeck";
import type { SettingsSectionId } from "@/lib/settingsCatalog";

export type SettingsRoute = {
  section: SettingsSectionId;
  /** Optional anchor/tab inside the section. */
  tab?: string | null;
};

/**
 * Settings-navigation routes for banner action ids. Ids missing from this
 * map are handled by the host's verb cases (reconnect / doctor / mcp /
 * project verbs / turn control / dismiss).
 */
export const ERROR_BANNER_SETTINGS_ROUTE: Partial<
  Record<ErrorDeckActionId, SettingsRoute>
> = {
  open_runtime: { section: "runtime" },
  upgrade_cli: { section: "runtime" },
  open_network: { section: "runtime", tab: "network" },
  open_account: { section: "account" },
  // Providers live under account / extensions path — account is the
  // login+key surface; extensions holds MCP. Prefer account for keys.
  open_providers: { section: "account" },
  open_permissions: { section: "general", tab: "permissions" },
  open_extensions: { section: "extensions" },
};

/** True when the action id only clears the banner (no side effect). */
export function isErrorBannerDismissOnly(id: ErrorDeckActionId): boolean {
  return id === "dismiss" || id === "keep_waiting";
}

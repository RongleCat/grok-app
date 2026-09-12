import type { SettingsEntry } from "../types";
import { ABOUT_ENTRIES } from "./about";
import { ACCOUNT_ENTRIES } from "./account";
import { APPEARANCE_ENTRIES } from "./appearance";
import { APPEARANCE_INTERFACE_ENTRIES } from "./appearanceInterface";
import { ARCHIVED_ENTRIES } from "./archived";
import { EXTENSIONS_ENTRIES } from "./extensions";
import { GENERAL_ENTRIES } from "./general";
import { GENERAL_APP_ENTRIES } from "./generalApp";
import { REMOTE_IM_ENTRIES } from "./remoteIm";
import { RUNTIME_ENTRIES } from "./runtime";
import { RUNTIME_TOOLS_ENTRIES } from "./runtimeTools";
import { SHORTCUTS_ENTRIES } from "./shortcuts";
import { PET_ENTRIES } from "./pet";

/** Full registry of searchable settings (UI rows / cards). */
export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  ...GENERAL_ENTRIES,
  ...GENERAL_APP_ENTRIES,
  ...APPEARANCE_ENTRIES,
  ...APPEARANCE_INTERFACE_ENTRIES,
  ...ACCOUNT_ENTRIES,
  ...ARCHIVED_ENTRIES,
  ...PET_ENTRIES,
  ...EXTENSIONS_ENTRIES,
  ...RUNTIME_ENTRIES,
  ...RUNTIME_TOOLS_ENTRIES,
  ...REMOTE_IM_ENTRIES,
  ...SHORTCUTS_ENTRIES,
  ...ABOUT_ENTRIES,
];

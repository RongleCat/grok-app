/** Merged ta message catalog by domain. */
import { taCore } from "./core";
import { taSidebar } from "./sidebar";
import { taProject } from "./project";
import { taSession } from "./session";
import { taChat } from "./chat";
import { taErrors } from "./errors";
import { taComposer } from "./composer";
import { taWorkspace } from "./workspace";
import { taTasks } from "./tasks";
import { taSlash } from "./slash";
import { taAccount } from "./account";
import { taProviders } from "./providers";
import { taDoctor } from "./doctor";
import { taExtensions } from "./extensions";
import { taAutomations } from "./automations";
import { taFeatures } from "./features";
import { taKanban } from "./kanban";
import { taSettings } from "./settings";
import { taSettingsUi } from "./settings-ui";
import { taSettingsAgent } from "./settings-agent";
import { taSettingsMemory } from "./settings-memory";
import { taSettingsCode } from "./settings-code";
import { taSettingsRemoteIm } from "./settings-remoteIm";
import { taSettingsPet } from "./settings-pet";

import type { MessageKey } from "../en";

export const ta: Record<MessageKey, string> = {
  ...taCore,
  ...taSidebar,
  ...taProject,
  ...taSession,
  ...taChat,
  ...taErrors,
  ...taComposer,
  ...taWorkspace,
  ...taTasks,
  ...taSlash,
  ...taAccount,
  ...taProviders,
  ...taDoctor,
  ...taExtensions,
  ...taAutomations,
  ...taFeatures,
  ...taKanban,
  ...taSettings,
  ...taSettingsUi,
  ...taSettingsAgent,
  ...taSettingsMemory,
  ...taSettingsCode,
  ...taSettingsRemoteIm,
  ...taSettingsPet,
};

/** Merged ko message catalog by domain. */
import { koCore } from "./core";
import { koSidebar } from "./sidebar";
import { koProject } from "./project";
import { koSession } from "./session";
import { koChat } from "./chat";
import { koErrors } from "./errors";
import { koComposer } from "./composer";
import { koWorkspace } from "./workspace";
import { koTasks } from "./tasks";
import { koSlash } from "./slash";
import { koAccount } from "./account";
import { koProviders } from "./providers";
import { koDoctor } from "./doctor";
import { koExtensions } from "./extensions";
import { koAutomations } from "./automations";
import { koFeatures } from "./features";
import { koKanban } from "./kanban";
import { koSettings } from "./settings";
import { koSettingsUi } from "./settings-ui";
import { koSettingsAgent } from "./settings-agent";
import { koSettingsMemory } from "./settings-memory";
import { koSettingsCode } from "./settings-code";
import { koSettingsRemoteIm } from "./settings-remoteIm";
import { koSettingsPet } from "./settings-pet";

import type { MessageKey } from "../en";

export const ko: Record<MessageKey, string> = {
  ...koCore,
  ...koSidebar,
  ...koProject,
  ...koSession,
  ...koChat,
  ...koErrors,
  ...koComposer,
  ...koWorkspace,
  ...koTasks,
  ...koSlash,
  ...koAccount,
  ...koProviders,
  ...koDoctor,
  ...koExtensions,
  ...koAutomations,
  ...koFeatures,
  ...koKanban,
  ...koSettings,
  ...koSettingsUi,
  ...koSettingsAgent,
  ...koSettingsMemory,
  ...koSettingsCode,
  ...koSettingsRemoteIm,
  ...koSettingsPet,
};

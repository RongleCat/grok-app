/** Merged ru message catalog by domain. */
import { ruCore } from "./core";
import { ruSidebar } from "./sidebar";
import { ruProject } from "./project";
import { ruSession } from "./session";
import { ruChat } from "./chat";
import { ruErrors } from "./errors";
import { ruComposer } from "./composer";
import { ruWorkspace } from "./workspace";
import { ruTasks } from "./tasks";
import { ruSlash } from "./slash";
import { ruAccount } from "./account";
import { ruProviders } from "./providers";
import { ruDoctor } from "./doctor";
import { ruExtensions } from "./extensions";
import { ruAutomations } from "./automations";
import { ruFeatures } from "./features";
import { ruKanban } from "./kanban";
import { ruSettings } from "./settings";
import { ruSettingsUi } from "./settings-ui";
import { ruSettingsAgent } from "./settings-agent";
import { ruSettingsMemory } from "./settings-memory";
import { ruSettingsCode } from "./settings-code";
import { ruSettingsRemoteIm } from "./settings-remoteIm";
import { ruSettingsPet } from "./settings-pet";

import type { MessageKey } from "../en";

export const ru: Record<MessageKey, string> = {
  ...ruCore,
  ...ruSidebar,
  ...ruProject,
  ...ruSession,
  ...ruChat,
  ...ruErrors,
  ...ruComposer,
  ...ruWorkspace,
  ...ruTasks,
  ...ruSlash,
  ...ruAccount,
  ...ruProviders,
  ...ruDoctor,
  ...ruExtensions,
  ...ruAutomations,
  ...ruFeatures,
  ...ruKanban,
  ...ruSettings,
  ...ruSettingsUi,
  ...ruSettingsAgent,
  ...ruSettingsMemory,
  ...ruSettingsCode,
  ...ruSettingsRemoteIm,
  ...ruSettingsPet,
};

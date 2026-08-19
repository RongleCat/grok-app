/** Merged id message catalog by domain. */
import { idCore } from "./core";
import { idSidebar } from "./sidebar";
import { idProject } from "./project";
import { idSession } from "./session";
import { idChat } from "./chat";
import { idErrors } from "./errors";
import { idComposer } from "./composer";
import { idWorkspace } from "./workspace";
import { idTasks } from "./tasks";
import { idSlash } from "./slash";
import { idAccount } from "./account";
import { idProviders } from "./providers";
import { idDoctor } from "./doctor";
import { idExtensions } from "./extensions";
import { idAutomations } from "./automations";
import { idFeatures } from "./features";
import { idKanban } from "./kanban";
import { idSettings } from "./settings";
import { idSettingsUi } from "./settings-ui";
import { idSettingsAgent } from "./settings-agent";
import { idSettingsMemory } from "./settings-memory";
import { idSettingsCode } from "./settings-code";
import { idSettingsRemoteIm } from "./settings-remoteIm";
import { idSettingsPet } from "./settings-pet";

import type { MessageKey } from "../en";

export const id: Record<MessageKey, string> = {
  ...idCore,
  ...idSidebar,
  ...idProject,
  ...idSession,
  ...idChat,
  ...idErrors,
  ...idComposer,
  ...idWorkspace,
  ...idTasks,
  ...idSlash,
  ...idAccount,
  ...idProviders,
  ...idDoctor,
  ...idExtensions,
  ...idAutomations,
  ...idFeatures,
  ...idKanban,
  ...idSettings,
  ...idSettingsUi,
  ...idSettingsAgent,
  ...idSettingsMemory,
  ...idSettingsCode,
  ...idSettingsRemoteIm,
  ...idSettingsPet,
};

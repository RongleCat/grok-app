/** Merged de message catalog by domain. */
import { deCore } from "./core";
import { deSidebar } from "./sidebar";
import { deProject } from "./project";
import { deSession } from "./session";
import { deChat } from "./chat";
import { deErrors } from "./errors";
import { deComposer } from "./composer";
import { deWorkspace } from "./workspace";
import { deTasks } from "./tasks";
import { deSlash } from "./slash";
import { deAccount } from "./account";
import { deProviders } from "./providers";
import { deDoctor } from "./doctor";
import { deExtensions } from "./extensions";
import { deAutomations } from "./automations";
import { deFeatures } from "./features";
import { deKanban } from "./kanban";
import { deSettings } from "./settings";
import { deSettingsUi } from "./settings-ui";
import { deSettingsAgent } from "./settings-agent";
import { deSettingsMemory } from "./settings-memory";
import { deSettingsCode } from "./settings-code";
import { deSettingsRemoteIm } from "./settings-remoteIm";
import { deSettingsPet } from "./settings-pet";

import type { MessageKey } from "../en";

export const de: Record<MessageKey, string> = {
  ...deCore,
  ...deSidebar,
  ...deProject,
  ...deSession,
  ...deChat,
  ...deErrors,
  ...deComposer,
  ...deWorkspace,
  ...deTasks,
  ...deSlash,
  ...deAccount,
  ...deProviders,
  ...deDoctor,
  ...deExtensions,
  ...deAutomations,
  ...deFeatures,
  ...deKanban,
  ...deSettings,
  ...deSettingsUi,
  ...deSettingsAgent,
  ...deSettingsMemory,
  ...deSettingsCode,
  ...deSettingsRemoteIm,
  ...deSettingsPet,
};

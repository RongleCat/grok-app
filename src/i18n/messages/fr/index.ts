/** Merged fr message catalog by domain. */
import { frCore } from "./core";
import { frSidebar } from "./sidebar";
import { frProject } from "./project";
import { frSession } from "./session";
import { frChat } from "./chat";
import { frErrors } from "./errors";
import { frComposer } from "./composer";
import { frWorkspace } from "./workspace";
import { frTasks } from "./tasks";
import { frSlash } from "./slash";
import { frAccount } from "./account";
import { frProviders } from "./providers";
import { frDoctor } from "./doctor";
import { frExtensions } from "./extensions";
import { frAutomations } from "./automations";
import { frFeatures } from "./features";
import { frKanban } from "./kanban";
import { frSettings } from "./settings";
import { frSettingsUi } from "./settings-ui";
import { frSettingsAgent } from "./settings-agent";
import { frSettingsMemory } from "./settings-memory";
import { frSettingsCode } from "./settings-code";
import { frSettingsRemoteIm } from "./settings-remoteIm";
import { frSettingsPet } from "./settings-pet";

import type { MessageKey } from "../en";

export const fr: Record<MessageKey, string> = {
  ...frCore,
  ...frSidebar,
  ...frProject,
  ...frSession,
  ...frChat,
  ...frErrors,
  ...frComposer,
  ...frWorkspace,
  ...frTasks,
  ...frSlash,
  ...frAccount,
  ...frProviders,
  ...frDoctor,
  ...frExtensions,
  ...frAutomations,
  ...frFeatures,
  ...frKanban,
  ...frSettings,
  ...frSettingsUi,
  ...frSettingsAgent,
  ...frSettingsMemory,
  ...frSettingsCode,
  ...frSettingsRemoteIm,
  ...frSettingsPet,
};

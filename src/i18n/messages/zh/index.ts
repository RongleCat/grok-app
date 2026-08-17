/** Merged zh message catalog by domain. */
import { zhCore } from "./core";
import { zhSidebar } from "./sidebar";
import { zhProject } from "./project";
import { zhSession } from "./session";
import { zhChat } from "./chat";
import { zhErrors } from "./errors";
import { zhComposer } from "./composer";
import { zhWorkspace } from "./workspace";
import { zhTasks } from "./tasks";
import { zhSlash } from "./slash";
import { zhAccount } from "./account";
import { zhProviders } from "./providers";
import { zhDoctor } from "./doctor";
import { zhExtensions } from "./extensions";
import { zhAutomations } from "./automations";
import { zhFeatures } from "./features";
import { zhKanban } from "./kanban";
import { zhSettings } from "./settings";
import { zhSettingsUi } from "./settings-ui";
import { zhSettingsAgent } from "./settings-agent";
import { zhSettingsMemory } from "./settings-memory";
import { zhSettingsCode } from "./settings-code";
import { zhSettingsRemoteIm } from "./settings-remoteIm";

import type { MessageKey } from "../en";

export const zh: Record<MessageKey, string> = {
  ...zhCore,
  ...zhSidebar,
  ...zhProject,
  ...zhSession,
  ...zhChat,
  ...zhErrors,
  ...zhComposer,
  ...zhWorkspace,
  ...zhTasks,
  ...zhSlash,
  ...zhAccount,
  ...zhProviders,
  ...zhDoctor,
  ...zhExtensions,
  ...zhAutomations,
  ...zhFeatures,
  ...zhKanban,
  ...zhSettings,
  ...zhSettingsUi,
  ...zhSettingsAgent,
  ...zhSettingsMemory,
  ...zhSettingsCode,
  ...zhSettingsRemoteIm,
};

export { zhCore } from "./core";
export { zhSidebar } from "./sidebar";
export { zhProject } from "./project";
export { zhSession } from "./session";
export { zhChat } from "./chat";
export { zhErrors } from "./errors";
export { zhComposer } from "./composer";
export { zhWorkspace } from "./workspace";
export { zhTasks } from "./tasks";
export { zhSlash } from "./slash";
export { zhAccount } from "./account";
export { zhProviders } from "./providers";
export { zhDoctor } from "./doctor";
export { zhExtensions } from "./extensions";
export { zhAutomations } from "./automations";
export { zhFeatures } from "./features";
export { zhKanban } from "./kanban";
export { zhSettings } from "./settings";
export { zhSettingsUi } from "./settings-ui";
export { zhSettingsAgent } from "./settings-agent";
export { zhSettingsMemory } from "./settings-memory";
export { zhSettingsCode } from "./settings-code";
export { zhSettingsRemoteIm } from "./settings-remoteIm";

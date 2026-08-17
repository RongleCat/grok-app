/** Merged en message catalog by domain. */
import { enCore } from "./core";
import { enSidebar } from "./sidebar";
import { enProject } from "./project";
import { enSession } from "./session";
import { enChat } from "./chat";
import { enErrors } from "./errors";
import { enComposer } from "./composer";
import { enWorkspace } from "./workspace";
import { enTasks } from "./tasks";
import { enSlash } from "./slash";
import { enAccount } from "./account";
import { enProviders } from "./providers";
import { enDoctor } from "./doctor";
import { enExtensions } from "./extensions";
import { enAutomations } from "./automations";
import { enFeatures } from "./features";
import { enKanban } from "./kanban";
import { enSettings } from "./settings";
import { enSettingsUi } from "./settings-ui";
import { enSettingsAgent } from "./settings-agent";
import { enSettingsMemory } from "./settings-memory";
import { enSettingsCode } from "./settings-code";
import { enSettingsRemoteIm } from "./settings-remoteIm";

export const en = {
  ...enCore,
  ...enSidebar,
  ...enProject,
  ...enSession,
  ...enChat,
  ...enErrors,
  ...enComposer,
  ...enWorkspace,
  ...enTasks,
  ...enSlash,
  ...enAccount,
  ...enProviders,
  ...enDoctor,
  ...enExtensions,
  ...enAutomations,
  ...enFeatures,
  ...enKanban,
  ...enSettings,
  ...enSettingsUi,
  ...enSettingsAgent,
  ...enSettingsMemory,
  ...enSettingsCode,
  ...enSettingsRemoteIm,
} as const;

export type MessageKey = keyof typeof en;

export { enCore } from "./core";
export { enSidebar } from "./sidebar";
export { enProject } from "./project";
export { enSession } from "./session";
export { enChat } from "./chat";
export { enErrors } from "./errors";
export { enComposer } from "./composer";
export { enWorkspace } from "./workspace";
export { enTasks } from "./tasks";
export { enSlash } from "./slash";
export { enAccount } from "./account";
export { enProviders } from "./providers";
export { enDoctor } from "./doctor";
export { enExtensions } from "./extensions";
export { enAutomations } from "./automations";
export { enFeatures } from "./features";
export { enKanban } from "./kanban";
export { enSettings } from "./settings";
export { enSettingsUi } from "./settings-ui";
export { enSettingsAgent } from "./settings-agent";
export { enSettingsMemory } from "./settings-memory";
export { enSettingsCode } from "./settings-code";
export { enSettingsRemoteIm } from "./settings-remoteIm";

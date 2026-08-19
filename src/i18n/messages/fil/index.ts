/** Merged fil message catalog by domain. */
import { filCore } from "./core";
import { filSidebar } from "./sidebar";
import { filProject } from "./project";
import { filSession } from "./session";
import { filChat } from "./chat";
import { filErrors } from "./errors";
import { filComposer } from "./composer";
import { filWorkspace } from "./workspace";
import { filTasks } from "./tasks";
import { filSlash } from "./slash";
import { filAccount } from "./account";
import { filProviders } from "./providers";
import { filDoctor } from "./doctor";
import { filExtensions } from "./extensions";
import { filAutomations } from "./automations";
import { filFeatures } from "./features";
import { filKanban } from "./kanban";
import { filSettings } from "./settings";
import { filSettingsUi } from "./settings-ui";
import { filSettingsAgent } from "./settings-agent";
import { filSettingsMemory } from "./settings-memory";
import { filSettingsCode } from "./settings-code";
import { filSettingsRemoteIm } from "./settings-remoteIm";
import { filSettingsPet } from "./settings-pet";

import type { MessageKey } from "../en";

export const fil: Record<MessageKey, string> = {
  ...filCore,
  ...filSidebar,
  ...filProject,
  ...filSession,
  ...filChat,
  ...filErrors,
  ...filComposer,
  ...filWorkspace,
  ...filTasks,
  ...filSlash,
  ...filAccount,
  ...filProviders,
  ...filDoctor,
  ...filExtensions,
  ...filAutomations,
  ...filFeatures,
  ...filKanban,
  ...filSettings,
  ...filSettingsUi,
  ...filSettingsAgent,
  ...filSettingsMemory,
  ...filSettingsCode,
  ...filSettingsRemoteIm,
  ...filSettingsPet,
};

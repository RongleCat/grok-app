/** Merged uk message catalog by domain. */
import { ukCore } from "./core";
import { ukSidebar } from "./sidebar";
import { ukProject } from "./project";
import { ukSession } from "./session";
import { ukChat } from "./chat";
import { ukErrors } from "./errors";
import { ukComposer } from "./composer";
import { ukWorkspace } from "./workspace";
import { ukTasks } from "./tasks";
import { ukSlash } from "./slash";
import { ukAccount } from "./account";
import { ukProviders } from "./providers";
import { ukDoctor } from "./doctor";
import { ukExtensions } from "./extensions";
import { ukAutomations } from "./automations";
import { ukFeatures } from "./features";
import { ukKanban } from "./kanban";
import { ukSettings } from "./settings";
import { ukSettingsUi } from "./settings-ui";
import { ukSettingsAgent } from "./settings-agent";
import { ukSettingsMemory } from "./settings-memory";
import { ukSettingsCode } from "./settings-code";
import { ukSettingsRemoteIm } from "./settings-remoteIm";
import { ukSettingsPet } from "./settings-pet";

import type { MessageKey } from "../en";

export const uk: Record<MessageKey, string> = {
  ...ukCore,
  ...ukSidebar,
  ...ukProject,
  ...ukSession,
  ...ukChat,
  ...ukErrors,
  ...ukComposer,
  ...ukWorkspace,
  ...ukTasks,
  ...ukSlash,
  ...ukAccount,
  ...ukProviders,
  ...ukDoctor,
  ...ukExtensions,
  ...ukAutomations,
  ...ukFeatures,
  ...ukKanban,
  ...ukSettings,
  ...ukSettingsUi,
  ...ukSettingsAgent,
  ...ukSettingsMemory,
  ...ukSettingsCode,
  ...ukSettingsRemoteIm,
  ...ukSettingsPet,
};

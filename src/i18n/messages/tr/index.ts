/** Merged tr message catalog by domain. */
import { trAccount } from "./account";
import { trAutomations } from "./automations";
import { trChat } from "./chat";
import { trComposer } from "./composer";
import { trCore } from "./core";
import { trDoctor } from "./doctor";
import { trErrors } from "./errors";
import { trExtensions } from "./extensions";
import { trFeatures } from "./features";
import { trKanban } from "./kanban";
import { trProject } from "./project";
import { trProviders } from "./providers";
import { trSession } from "./session";
import { trSettingsAgent } from "./settings-agent";
import { trSettingsCode } from "./settings-code";
import { trSettingsMemory } from "./settings-memory";
import { trSettingsPet } from "./settings-pet";
import { trSettingsRemoteIm } from "./settings-remoteIm";
import { trSettingsUi } from "./settings-ui";
import { trSettings } from "./settings";
import { trSidebar } from "./sidebar";
import { trSlash } from "./slash";
import { trTasks } from "./tasks";
import { trWorkspace } from "./workspace";

import type { MessageKey } from "../en";

export const tr: Record<MessageKey, string> = {
  ...trAccount,
  ...trAutomations,
  ...trChat,
  ...trComposer,
  ...trCore,
  ...trDoctor,
  ...trErrors,
  ...trExtensions,
  ...trFeatures,
  ...trKanban,
  ...trProject,
  ...trProviders,
  ...trSession,
  ...trSettingsAgent,
  ...trSettingsCode,
  ...trSettingsMemory,
  ...trSettingsPet,
  ...trSettingsRemoteIm,
  ...trSettingsUi,
  ...trSettings,
  ...trSidebar,
  ...trSlash,
  ...trTasks,
  ...trWorkspace,
};

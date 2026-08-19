/** Merged ja message catalog by domain. */
import { jaCore } from "./core";
import { jaSidebar } from "./sidebar";
import { jaProject } from "./project";
import { jaSession } from "./session";
import { jaChat } from "./chat";
import { jaErrors } from "./errors";
import { jaComposer } from "./composer";
import { jaWorkspace } from "./workspace";
import { jaTasks } from "./tasks";
import { jaSlash } from "./slash";
import { jaAccount } from "./account";
import { jaProviders } from "./providers";
import { jaDoctor } from "./doctor";
import { jaExtensions } from "./extensions";
import { jaAutomations } from "./automations";
import { jaFeatures } from "./features";
import { jaKanban } from "./kanban";
import { jaSettings } from "./settings";
import { jaSettingsUi } from "./settings-ui";
import { jaSettingsAgent } from "./settings-agent";
import { jaSettingsMemory } from "./settings-memory";
import { jaSettingsCode } from "./settings-code";
import { jaSettingsRemoteIm } from "./settings-remoteIm";
import { jaSettingsPet } from "./settings-pet";

import type { MessageKey } from "../en";

export const ja: Record<MessageKey, string> = {
  ...jaCore,
  ...jaSidebar,
  ...jaProject,
  ...jaSession,
  ...jaChat,
  ...jaErrors,
  ...jaComposer,
  ...jaWorkspace,
  ...jaTasks,
  ...jaSlash,
  ...jaAccount,
  ...jaProviders,
  ...jaDoctor,
  ...jaExtensions,
  ...jaAutomations,
  ...jaFeatures,
  ...jaKanban,
  ...jaSettings,
  ...jaSettingsUi,
  ...jaSettingsAgent,
  ...jaSettingsMemory,
  ...jaSettingsCode,
  ...jaSettingsRemoteIm,
  ...jaSettingsPet,
};

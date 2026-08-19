/** Merged es message catalog by domain. */
import { esCore } from "./core";
import { esSidebar } from "./sidebar";
import { esProject } from "./project";
import { esSession } from "./session";
import { esChat } from "./chat";
import { esErrors } from "./errors";
import { esComposer } from "./composer";
import { esWorkspace } from "./workspace";
import { esTasks } from "./tasks";
import { esSlash } from "./slash";
import { esAccount } from "./account";
import { esProviders } from "./providers";
import { esDoctor } from "./doctor";
import { esExtensions } from "./extensions";
import { esAutomations } from "./automations";
import { esFeatures } from "./features";
import { esKanban } from "./kanban";
import { esSettings } from "./settings";
import { esSettingsUi } from "./settings-ui";
import { esSettingsAgent } from "./settings-agent";
import { esSettingsMemory } from "./settings-memory";
import { esSettingsCode } from "./settings-code";
import { esSettingsRemoteIm } from "./settings-remoteIm";
import { esSettingsPet } from "./settings-pet";

import type { MessageKey } from "../en";

export const es: Record<MessageKey, string> = {
  ...esCore,
  ...esSidebar,
  ...esProject,
  ...esSession,
  ...esChat,
  ...esErrors,
  ...esComposer,
  ...esWorkspace,
  ...esTasks,
  ...esSlash,
  ...esAccount,
  ...esProviders,
  ...esDoctor,
  ...esExtensions,
  ...esAutomations,
  ...esFeatures,
  ...esKanban,
  ...esSettings,
  ...esSettingsUi,
  ...esSettingsAgent,
  ...esSettingsMemory,
  ...esSettingsCode,
  ...esSettingsRemoteIm,
  ...esSettingsPet,
};

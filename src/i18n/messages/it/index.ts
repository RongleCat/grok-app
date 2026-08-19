/** Merged it message catalog by domain. */
import { itCore } from "./core";
import { itSidebar } from "./sidebar";
import { itProject } from "./project";
import { itSession } from "./session";
import { itChat } from "./chat";
import { itErrors } from "./errors";
import { itComposer } from "./composer";
import { itWorkspace } from "./workspace";
import { itTasks } from "./tasks";
import { itSlash } from "./slash";
import { itAccount } from "./account";
import { itProviders } from "./providers";
import { itDoctor } from "./doctor";
import { itExtensions } from "./extensions";
import { itAutomations } from "./automations";
import { itFeatures } from "./features";
import { itKanban } from "./kanban";
import { itSettings } from "./settings";
import { itSettingsUi } from "./settings-ui";
import { itSettingsAgent } from "./settings-agent";
import { itSettingsMemory } from "./settings-memory";
import { itSettingsCode } from "./settings-code";
import { itSettingsRemoteIm } from "./settings-remoteIm";
import { itSettingsPet } from "./settings-pet";

import type { MessageKey } from "../en";

export const it: Record<MessageKey, string> = {
  ...itCore,
  ...itSidebar,
  ...itProject,
  ...itSession,
  ...itChat,
  ...itErrors,
  ...itComposer,
  ...itWorkspace,
  ...itTasks,
  ...itSlash,
  ...itAccount,
  ...itProviders,
  ...itDoctor,
  ...itExtensions,
  ...itAutomations,
  ...itFeatures,
  ...itKanban,
  ...itSettings,
  ...itSettingsUi,
  ...itSettingsAgent,
  ...itSettingsMemory,
  ...itSettingsCode,
  ...itSettingsRemoteIm,
  ...itSettingsPet,
};

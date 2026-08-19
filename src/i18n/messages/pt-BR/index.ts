/** Merged pt-BR message catalog by domain. */
import { ptBRCore } from "./core";
import { ptBRSidebar } from "./sidebar";
import { ptBRProject } from "./project";
import { ptBRSession } from "./session";
import { ptBRChat } from "./chat";
import { ptBRErrors } from "./errors";
import { ptBRComposer } from "./composer";
import { ptBRWorkspace } from "./workspace";
import { ptBRTasks } from "./tasks";
import { ptBRSlash } from "./slash";
import { ptBRAccount } from "./account";
import { ptBRProviders } from "./providers";
import { ptBRDoctor } from "./doctor";
import { ptBRExtensions } from "./extensions";
import { ptBRAutomations } from "./automations";
import { ptBRFeatures } from "./features";
import { ptBRKanban } from "./kanban";
import { ptBRSettings } from "./settings";
import { ptBRSettingsUi } from "./settings-ui";
import { ptBRSettingsAgent } from "./settings-agent";
import { ptBRSettingsMemory } from "./settings-memory";
import { ptBRSettingsCode } from "./settings-code";
import { ptBRSettingsRemoteIm } from "./settings-remoteIm";
import { ptBRSettingsPet } from "./settings-pet";

import type { MessageKey } from "../en";

export const ptBR: Record<MessageKey, string> = {
  ...ptBRCore,
  ...ptBRSidebar,
  ...ptBRProject,
  ...ptBRSession,
  ...ptBRChat,
  ...ptBRErrors,
  ...ptBRComposer,
  ...ptBRWorkspace,
  ...ptBRTasks,
  ...ptBRSlash,
  ...ptBRAccount,
  ...ptBRProviders,
  ...ptBRDoctor,
  ...ptBRExtensions,
  ...ptBRAutomations,
  ...ptBRFeatures,
  ...ptBRKanban,
  ...ptBRSettings,
  ...ptBRSettingsUi,
  ...ptBRSettingsAgent,
  ...ptBRSettingsMemory,
  ...ptBRSettingsCode,
  ...ptBRSettingsRemoteIm,
  ...ptBRSettingsPet,
};

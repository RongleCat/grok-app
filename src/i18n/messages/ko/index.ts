/** Korean messages. English-backed catalog with translated overrides. */
import { en, type MessageKey } from "../en";

import { koCore } from "./core";
import { koNav } from "./nav";

export const ko = {
  ...en,
  ...koCore,
  ...koNav,
} as Record<MessageKey, string>;

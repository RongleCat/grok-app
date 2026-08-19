/** Latin messages. English-backed catalog with translated overrides. */
import { en, type MessageKey } from "../en";

import { laCore } from "./core";
import { laNav } from "./nav";

export const la = {
  ...en,
  ...laCore,
  ...laNav,
} as Record<MessageKey, string>;

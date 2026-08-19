/** Indonesian messages. English-backed catalog with translated overrides. */
import { en, type MessageKey } from "../en";

import { idCore } from "./core";
import { idNav } from "./nav";

export const id = {
  ...en,
  ...idCore,
  ...idNav,
} as Record<MessageKey, string>;

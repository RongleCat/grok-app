/** Filipino messages. English-backed catalog with translated overrides. */
import { en, type MessageKey } from "../en";

import { filCore } from "./core";
import { filNav } from "./nav";

export const fil = {
  ...en,
  ...filCore,
  ...filNav,
} as Record<MessageKey, string>;

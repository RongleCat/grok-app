/** Tamil messages. English-backed catalog with translated overrides. */
import { en, type MessageKey } from "../en";

import { taCore } from "./core";
import { taNav } from "./nav";

export const ta = {
  ...en,
  ...taCore,
  ...taNav,
} as Record<MessageKey, string>;

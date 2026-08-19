/** German messages. English-backed catalog with translated overrides. */
import { en, type MessageKey } from "../en";

import { deCore } from "./core";
import { deNav } from "./nav";

export const de = {
  ...en,
  ...deCore,
  ...deNav,
} as Record<MessageKey, string>;

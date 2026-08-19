/** Sanskrit messages. English-backed catalog with translated overrides. */
import { en, type MessageKey } from "../en";

import { saCore } from "./core";
import { saNav } from "./nav";

export const sa = {
  ...en,
  ...saCore,
  ...saNav,
} as Record<MessageKey, string>;

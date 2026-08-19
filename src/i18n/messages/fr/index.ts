/** French messages. English-backed catalog with translated overrides. */
import { en, type MessageKey } from "../en";

import { frCore } from "./core";
import { frNav } from "./nav";

export const fr = {
  ...en,
  ...frCore,
  ...frNav,
} as Record<MessageKey, string>;

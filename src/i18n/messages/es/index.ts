/** Spanish messages. English-backed catalog with translated overrides. */
import { en, type MessageKey } from "../en";

import { esCore } from "./core";
import { esNav } from "./nav";

export const es = {
  ...en,
  ...esCore,
  ...esNav,
} as Record<MessageKey, string>;

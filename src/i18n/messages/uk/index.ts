/** Ukrainian messages. English-backed catalog with translated overrides. */
import { en, type MessageKey } from "../en";

import { ukCore } from "./core";
import { ukNav } from "./nav";

export const uk = {
  ...en,
  ...ukCore,
  ...ukNav,
} as Record<MessageKey, string>;

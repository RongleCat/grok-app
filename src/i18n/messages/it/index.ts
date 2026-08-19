/** Italian messages. English-backed catalog with translated overrides. */
import { en, type MessageKey } from "../en";

import { itCore } from "./core";
import { itNav } from "./nav";

export const it = {
  ...en,
  ...itCore,
  ...itNav,
} as Record<MessageKey, string>;

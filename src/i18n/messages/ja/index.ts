/** Japanese messages.
 *
 * English-backed catalog: every key resolves, and the overrides below carry the
 * translated product surface. See docs/llm-wiki/i18n.md.
 */
import { en, type MessageKey } from "../en";

import { jaCore } from "./core";
import { jaNav } from "./nav";

export const ja = {
  ...en,
  ...jaCore,
  ...jaNav,
} as Record<MessageKey, string>;

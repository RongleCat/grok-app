/** Brazilian Portuguese messages. English-backed catalog with translated overrides. */
import { en, type MessageKey } from "../en";

import { ptBRCore } from "./core";
import { ptBRNav } from "./nav";

export const ptBR = {
  ...en,
  ...ptBRCore,
  ...ptBRNav,
} as Record<MessageKey, string>;

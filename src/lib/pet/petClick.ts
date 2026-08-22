/** Pet mark click: single click emotes; only double-click opens the workbench. */

export const PET_DBLCLICK_MS = 280;

export type PetMarkClickIntent = "arm-emote" | "open-double";

export function petMarkClickIntent(input: {
  pendingSingle: boolean;
}): PetMarkClickIntent {
  if (input.pendingSingle) return "open-double";
  return "arm-emote";
}

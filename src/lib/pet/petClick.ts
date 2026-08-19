/** Pet mark click: open, double-click hide, peek-hide within 3s of opening. */

export const PET_DBLCLICK_MS = 280;
export const PET_PEEK_HIDE_MS = 3_000;

export type PetMarkClickIntent = "arm-open" | "hide-double" | "hide-peek";

export function petMarkClickIntent(input: {
  pendingSingle: boolean;
  openedAt: number | null;
  now: number;
  peekMs?: number;
}): PetMarkClickIntent {
  if (input.pendingSingle) return "hide-double";
  const peek = input.peekMs ?? PET_PEEK_HIDE_MS;
  if (input.openedAt != null && input.now - input.openedAt < peek) {
    return "hide-peek";
  }
  return "arm-open";
}

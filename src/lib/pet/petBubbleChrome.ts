/** Chip shape / fill presets and dismiss / progress-bar prefs. */

export const PET_BUBBLE_SHAPES = [
  "round",
  "pill",
  "card",
  "ticket",
  "cloud",
  "slash",
] as const;
export type PetBubbleShape = (typeof PET_BUBBLE_SHAPES)[number];

export const PET_BUBBLE_STYLES = [
  "ink",
  "glass",
  "solid",
  "paper",
  "outline",
  "accent",
] as const;
export type PetBubbleStyle = (typeof PET_BUBBLE_STYLES)[number];

export const PET_BUBBLE_DISMISS_DEFAULT = 15;
export const PET_BUBBLE_DISMISS_MIN = 3;
export const PET_BUBBLE_DISMISS_MAX = 120;

export function isPetBubbleShape(
  v: string | null | undefined,
): v is PetBubbleShape {
  return !!v && (PET_BUBBLE_SHAPES as readonly string[]).includes(v);
}

export function isPetBubbleStyle(
  v: string | null | undefined,
): v is PetBubbleStyle {
  return !!v && (PET_BUBBLE_STYLES as readonly string[]).includes(v);
}

export function normalizePetBubbleShape(
  v: string | null | undefined,
): PetBubbleShape {
  return isPetBubbleShape(v) ? v : "round";
}

export function normalizePetBubbleStyle(
  v: string | null | undefined,
): PetBubbleStyle {
  return isPetBubbleStyle(v) ? v : "ink";
}

export function normalizePetBubbleDismissSec(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return PET_BUBBLE_DISMISS_DEFAULT;
  return Math.min(
    PET_BUBBLE_DISMISS_MAX,
    Math.max(PET_BUBBLE_DISMISS_MIN, Math.round(n)),
  );
}

/** Progress bar is opt-in — spinner / check on the left is the default. */
export function petProgressBarEnabled(
  prefs: { progressBarEnabled?: boolean } | null | undefined,
): boolean {
  return prefs?.progressBarEnabled === true;
}

export function petBubbleDismissMs(
  prefs: { bubbleDismissSec?: number } | null | undefined,
): number {
  return normalizePetBubbleDismissSec(prefs?.bubbleDismissSec) * 1000;
}

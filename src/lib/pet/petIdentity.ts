/** Parametric pet shapes + dual-tone colors (Grok Bot living mark). */

export const PET_SHAPES = [
  "blob",
  "pebble",
  "squircle",
  "tablet",
  "wedge",
  "hex",
  "cloud",
  "teardrop",
] as const;

export type PetShape = (typeof PET_SHAPES)[number];

export const PET_COLORS = [
  "black",
  "white",
  "brown",
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "violet",
  "magenta",
  "gray",
] as const;

export type PetColor = (typeof PET_COLORS)[number];

export const PET_COLOR_SWATCH: Record<
  PetColor,
  { label: string; value: string }
> = {
  black: { label: "Black", value: "#000000" },
  white: { label: "White", value: "#F4F4F4" },
  brown: { label: "Brown", value: "#936439" },
  red: { label: "Red", value: "#FF263C" },
  orange: { label: "Orange", value: "#FF6700" },
  yellow: { label: "Yellow", value: "#FF9800" },
  green: { label: "Green", value: "#00C972" },
  cyan: { label: "Cyan", value: "#00BCA6" },
  blue: { label: "Blue", value: "#1084FE" },
  violet: { label: "Violet", value: "#9159FE" },
  magenta: { label: "Magenta", value: "#FF309B" },
  gray: { label: "Gray", value: "#777777" },
};

/** Light / dark body fills (CSS light-dark). */
export const PET_INK: Record<PetColor, { light: string; dark: string }> = {
  black: { light: "#000000", dark: "#FFFFFF" },
  // Stay pale in both themes — do not invert like `black` (that already
  // becomes white in dark mode).
  white: { light: "#F4F4F4", dark: "#F4F4F4" },
  brown: { light: "#A27952", dark: "#855C36" },
  red: { light: "#FF3E51", dark: "#E02135" },
  orange: { light: "#FF781C", dark: "#FF6700" },
  yellow: { light: "#FFAF38", dark: "#FF9800" },
  green: { light: "#00C972", dark: "#009957" },
  cyan: { light: "#1CC3B0", dark: "#00A592" },
  blue: { light: "#2A92FE", dark: "#0E74E0" },
  violet: { light: "#A97EFE", dark: "#804EE0" },
  magenta: { light: "#FF5EB1", dark: "#E02A88" },
  gray: { light: "#959595", dark: "#777777" },
};

export const PET_SIZES = [96, 128, 160] as const;
export type PetSizePx = (typeof PET_SIZES)[number];

export const PET_EYE_COLORS = [
  "auto",
  "white",
  "cream",
  "gold",
  "orange",
  "red",
  "green",
  "cyan",
  "blue",
  "violet",
  "black",
] as const;

export type PetEyeColor = (typeof PET_EYE_COLORS)[number];

/** SVG fill for each eye swatch. `auto` follows the page `--bg` (current look). */
export const PET_EYE_INK: Record<PetEyeColor, string> = {
  auto: "var(--bg, #161616)",
  white: "#F4F4F4",
  cream: "#F3E6C8",
  gold: "#F0C14A",
  orange: "#FF8A3D",
  red: "#FF4D5A",
  green: "#3DDC97",
  cyan: "#3DDED0",
  blue: "#5AA8FF",
  violet: "#B48CFF",
  black: "#161616",
};

export function isPetShape(v: string | null | undefined): v is PetShape {
  return !!v && (PET_SHAPES as readonly string[]).includes(v);
}

export function isPetColor(v: string | null | undefined): v is PetColor {
  return !!v && (PET_COLORS as readonly string[]).includes(v);
}

export function isPetEyeColor(v: string | null | undefined): v is PetEyeColor {
  return !!v && (PET_EYE_COLORS as readonly string[]).includes(v);
}

export function normalizePetEyeColor(v: string | null | undefined): PetEyeColor {
  return isPetEyeColor(v) ? v : "auto";
}

export function petEyeFill(
  color: string | null | undefined,
  body?: string | null,
): string {
  const eye = normalizePetEyeColor(color);
  if (eye === "auto" && body === "white") {
    // Auto eyes follow page `--bg`, which is light on a light theme — invisible
    // on a white body. Punch dark holes instead.
    return "#161616";
  }
  return PET_EYE_INK[eye];
}

export function normalizePetSize(n: unknown): PetSizePx {
  const x = typeof n === "number" ? n : Number(n);
  if (x <= 112) return 96;
  if (x >= 144) return 160;
  return 128;
}

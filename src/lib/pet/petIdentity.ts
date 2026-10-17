/** Parametric pet shapes + dual-tone colors (Grok Bot living mark). */

export const PET_SHAPES = [
  "blob",
  "pebble",
  "bean",
  "egg",
  "squircle",
  "tablet",
  "capsule",
  "cylinder",
  "hex",
  "gem",
  "crystal",
  "wedge",
  "shield",
  "dome",
  "arch",
  "cloud",
  "teardrop",
  "leaf",
] as const;

export type PetShape = (typeof PET_SHAPES)[number];

/** Bloub customiser: 8 measured rest silhouettes. */
export const PET_PICKER_SHAPES = [
  "blob",
  "pebble",
  "squircle",
  "capsule",
  "wedge",
  "hex",
  "cloud",
  "teardrop",
] as const;

export type PetPickerShape = (typeof PET_PICKER_SHAPES)[number];

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
  black: { label: "Black", value: "#111111" },
  white: { label: "White", value: "#F4F4F5" },
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
  black: { light: "#111111", dark: "#111111" },
  white: { light: "#F4F4F5", dark: "#F4F4F5" },
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

/** Legacy presets (Small / Medium / Large) — still valid slider stops. */
export const PET_SIZES = [96, 128, 160] as const;
export const PET_SIZE_MIN = 96;
export const PET_SIZE_MAX = 200;
export const PET_SIZE_STEP = 8;
export const PET_SIZE_DEFAULT = 128;
export type PetSizePx = number;

export function isPetShape(v: string | null | undefined): v is PetShape {
  return !!v && (PET_SHAPES as readonly string[]).includes(v);
}

export function isPetColor(v: string | null | undefined): v is PetColor {
  return !!v && (PET_COLORS as readonly string[]).includes(v);
}

export type PetEyeColor = PetColor | "auto";

export function isPetEyeColor(v: string | null | undefined): v is PetEyeColor {
  return v === "auto" || isPetColor(v);
}

export function normalizePetEyeColor(v: string | null | undefined): PetEyeColor {
  return isPetEyeColor(v) ? v : "auto";
}

/** Body fill is the picker swatch — no light-dark flip (black stayed white in dark UI). */
export function resolvePetBodyInk(color: PetColor): string {
  return PET_COLOR_SWATCH[color]?.value ?? PET_COLOR_SWATCH.green.value;
}

function hexLuma(hex: string): number {
  const raw = hex.replace("#", "");
  if (raw.length !== 6) return 0.5;
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Explicit black/white must paint as picked. Auto only picks a readable contrast. */
export function resolvePetEyeInk(body: PetColor, eye: PetEyeColor = "auto"): string {
  if (eye !== "auto") return resolvePetBodyInk(eye);
  return hexLuma(resolvePetBodyInk(body)) < 0.45 ? "#F4F4F5" : "#161616";
}

/** Clamp to [PET_SIZE_MIN, PET_SIZE_MAX] on PET_SIZE_STEP stops (mirrors Rust). */
export function normalizePetSize(n: unknown): PetSizePx {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return PET_SIZE_DEFAULT;
  const stepped = Math.round(x / PET_SIZE_STEP) * PET_SIZE_STEP;
  return Math.min(PET_SIZE_MAX, Math.max(PET_SIZE_MIN, stepped));
}

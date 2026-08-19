/** Strip trailing `.0` from one-decimal compact forms (`1.0K` → `1K`). */
export function trimTrailingDotZero(s: string): string {
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/**
 * Myriad (10^4) grouping units for the CJK locales that count in 万 rather than
 * thousands. Latin/Cyrillic/Indic locales all use K/M/B and are absent here.
 */
export interface MyriadUnits {
  /** 10^2 */
  hundred: string;
  /** 10^3 */
  thousand: string;
  /** 10^4 */
  myriad: string;
  /** 10^8 */
  hundredMillion: string;
}

export const ZH_HANS_UNITS: MyriadUnits = {
  hundred: "百",
  thousand: "千",
  myriad: "万",
  hundredMillion: "亿",
};

export const ZH_HANT_UNITS: MyriadUnits = {
  hundred: "百",
  thousand: "千",
  myriad: "萬",
  hundredMillion: "億",
};

const ZH_HANS = ZH_HANS_UNITS;
const ZH_HANT = ZH_HANT_UNITS;

/** True for Traditional Chinese ids (`zh-TW`, `zh-Hant`, `zh-HK`, `zh-MO`). */
export function isTraditionalChinese(locale: string): boolean {
  const parts = locale.trim().toLowerCase().replace(/_/g, "-").split("-");
  return (
    parts[0] === "zh" &&
    (parts.includes("hant") ||
      parts.includes("tw") ||
      parts.includes("hk") ||
      parts.includes("mo"))
  );
}

// Japanese shares 百/千/万 with Simplified Chinese but writes 10^8 as 億.
const JA: MyriadUnits = {
  hundred: "百",
  thousand: "千",
  myriad: "万",
  hundredMillion: "億",
};

const KO: MyriadUnits = {
  hundred: "백",
  thousand: "천",
  myriad: "만",
  hundredMillion: "억",
};

/**
 * Myriad units for a locale, or `null` when the locale counts in K/M/B.
 * Accepts raw ids (`zh_CN`, `ZH-Hant`, `ja-JP`) as well as catalog ids.
 */
export function myriadUnitsFor(locale: string): MyriadUnits | null {
  const v = locale.trim().toLowerCase().replace(/_/g, "-");
  if (!v) return null;
  const primary = v.split("-")[0] ?? v;
  if (primary === "ja") return JA;
  if (primary === "ko") return KO;
  if (primary !== "zh") return null;
  const parts = v.split("-");
  const traditional =
    parts.includes("hant") ||
    parts.includes("tw") ||
    parts.includes("hk") ||
    parts.includes("mo");
  return traditional ? ZH_HANT : ZH_HANS;
}

/** True when the locale groups counts by 万 (zh / zh-TW / ja / ko). */
export function usesMyriadCountUnits(locale: string): boolean {
  return myriadUnitsFor(locale) != null;
}

/**
 * Compact count using myriad grouping.
 * Bands: ≥1e8 億, ≥1e4 万, ≥1e3 千, ≥100 百, else integer / 1 decimal.
 */
export function formatMyriadCount(n: number, units: MyriadUnits): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const whole = Math.round(abs);

  if (whole >= 100_000_000) {
    return `${sign}${trimTrailingDotZero((whole / 100_000_000).toFixed(1))}${units.hundredMillion}`;
  }
  if (whole >= 10_000) {
    return `${sign}${trimTrailingDotZero((whole / 10_000).toFixed(1))}${units.myriad}`;
  }
  if (whole >= 1_000) {
    return `${sign}${trimTrailingDotZero((whole / 1_000).toFixed(1))}${units.thousand}`;
  }
  if (whole >= 100) {
    return `${sign}${trimTrailingDotZero((whole / 100).toFixed(1))}${units.hundred}`;
  }
  if (Number.isInteger(abs) || Math.abs(abs - whole) < 1e-9) {
    return `${sign}${whole}`;
  }
  return `${sign}${abs.toFixed(1)}`;
}

/**
 * English compact count: K / M / B (not 百/千/万).
 * Bands: ≥1e9 B, ≥1e6 M, ≥1e3 K, else integer.
 */
export function formatEnglishCompactCount(n: number): string {
  const sign = n < 0 ? "-" : "";
  const whole = Math.round(Math.abs(n));
  if (whole >= 1_000_000_000) {
    return `${sign}${trimTrailingDotZero((whole / 1_000_000_000).toFixed(1))}B`;
  }
  if (whole >= 1_000_000) {
    return `${sign}${trimTrailingDotZero((whole / 1_000_000).toFixed(1))}M`;
  }
  if (whole >= 1_000) {
    return `${sign}${trimTrailingDotZero((whole / 1_000).toFixed(1))}K`;
  }
  return `${sign}${whole}`;
}

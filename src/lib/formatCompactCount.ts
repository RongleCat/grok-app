/** Strip trailing `.0` from one-decimal compact forms (`1.0K` → `1K`). */
export function trimTrailingDotZero(s: string): string {
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/** True for zh / zh-CN / zh-TW / zh-Hant… — CJK myriad units (百/千/万/亿). */
export function usesChineseCountUnits(locale: string): boolean {
  const v = locale.trim().toLowerCase().replace(/_/g, "-");
  return v === "zh" || v.startsWith("zh-");
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

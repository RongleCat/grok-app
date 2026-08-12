/**
 * Honest, crude USD cost estimates from token counts.
 *
 * Rates are a **static illustration table**, not live billing or invoices.
 * Unknown models → `null` total (UI shows tokens only).
 * Never invent high precision: format with coarse decimals + `~` for estimates.
 */

/** USD per 1M tokens for a model family. */
export type ModelRateUsdPer1M = {
  input: number;
  output: number;
};

/**
 * Crude public-style rates (USD / 1M tokens). Not a bill.
 * Keys are lowercase model id prefixes / exact ids after normalization.
 * Prefer more specific keys first via exact match, then longest-prefix.
 */
export const MODEL_RATES_USD_PER_1M: Readonly<
  Record<string, ModelRateUsdPer1M>
> = {
  "grok-4.6": { input: 2, output: 6 },
  "grok-4.5": { input: 3, output: 15 },
  "grok-4": { input: 3, output: 15 },
  "grok-3-mini": { input: 0.3, output: 0.5 },
  "grok-3": { input: 3, output: 15 },
  "grok-2-vision": { input: 2, output: 10 },
  "grok-2": { input: 2, output: 10 },
  "grok-code": { input: 3, output: 15 },
};

export type CostTokenInput = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  /** When only a single total is known (no I/O split). */
  totalTokens?: number | null;
};

export type CostEstimateResult = {
  /** null when no rate match or no usable tokens. */
  totalUsd: number | null;
  inputUsd: number | null;
  outputUsd: number | null;
  /** Matched rate key, or null when unknown model. */
  modelKey: string | null;
  rates: ModelRateUsdPer1M | null;
  /**
   * Always `"estimate"` when a dollar figure is present — never invoice-grade.
   * `"none"` when we only have tokens / no rates.
   */
  precision: "estimate" | "none";
  /** How total was derived when a figure exists. */
  basis: "input_output" | "total_blended" | "input_only" | "output_only" | "none";
};

function finiteNonNeg(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Normalize model ids for rate lookup:
 * - trim, lower-case
 * - strip common `provider/` prefixes
 * - drop trailing `:suffix` / `@rev` variants
 */
export function normalizeModelIdForRates(
  model?: string | null,
): string | null {
  if (model == null) return null;
  let s = String(model).trim().toLowerCase();
  if (!s) return null;
  const slash = s.lastIndexOf("/");
  if (slash >= 0) s = s.slice(slash + 1);
  const colon = s.indexOf(":");
  if (colon >= 0) s = s.slice(0, colon);
  const at = s.indexOf("@");
  if (at >= 0) s = s.slice(0, at);
  s = s.trim();
  return s || null;
}

/** Longest matching key in the crude table (exact first). */
export function resolveModelRates(
  model?: string | null,
): { key: string; rates: ModelRateUsdPer1M } | null {
  const id = normalizeModelIdForRates(model);
  if (!id) return null;
  const exact = MODEL_RATES_USD_PER_1M[id];
  if (exact) return { key: id, rates: exact };
  let best: { key: string; rates: ModelRateUsdPer1M } | null = null;
  for (const [key, rates] of Object.entries(MODEL_RATES_USD_PER_1M)) {
    if (id === key || id.startsWith(`${key}-`) || id.startsWith(key)) {
      if (!best || key.length > best.key.length) {
        best = { key, rates };
      }
    }
  }
  return best;
}

function usdFromTokens(tokens: number, per1m: number): number {
  return (tokens / 1_000_000) * per1m;
}

function parseTokenArg(
  tokens: number | CostTokenInput,
): {
  input: number | null;
  output: number | null;
  total: number | null;
} {
  if (typeof tokens === "number") {
    const total = finiteNonNeg(tokens);
    return { input: null, output: null, total };
  }
  const input = finiteNonNeg(tokens.inputTokens);
  const output = finiteNonNeg(tokens.outputTokens);
  let total = finiteNonNeg(tokens.totalTokens);
  if (total == null && input != null && output != null) {
    total = input + output;
  }
  return { input, output, total };
}

/**
 * Pure cost estimate.
 *
 * @param tokens total count, or `{ inputTokens, outputTokens, totalTokens }`
 * @param model optional model id (matched against the crude rates table)
 * @returns structured estimate; `totalUsd` is null when rates or tokens missing
 */
export function estimateCostUsd(
  tokens: number | CostTokenInput,
  model?: string | null,
): CostEstimateResult {
  const empty: CostEstimateResult = {
    totalUsd: null,
    inputUsd: null,
    outputUsd: null,
    modelKey: null,
    rates: null,
    precision: "none",
    basis: "none",
  };

  const matched = resolveModelRates(model);
  if (!matched) return empty;

  const { input, output, total } = parseTokenArg(tokens);
  if (input == null && output == null && total == null) {
    return {
      ...empty,
      modelKey: matched.key,
      rates: matched.rates,
    };
  }

  const { rates } = matched;
  let inputUsd: number | null = null;
  let outputUsd: number | null = null;
  let totalUsd: number | null = null;
  let basis: CostEstimateResult["basis"] = "none";

  if (input != null && output != null) {
    inputUsd = usdFromTokens(input, rates.input);
    outputUsd = usdFromTokens(output, rates.output);
    totalUsd = inputUsd + outputUsd;
    basis = "input_output";
  } else if (input != null && output == null) {
    inputUsd = usdFromTokens(input, rates.input);
    totalUsd = inputUsd;
    basis = "input_only";
  } else if (output != null && input == null) {
    outputUsd = usdFromTokens(output, rates.output);
    totalUsd = outputUsd;
    basis = "output_only";
  } else if (total != null) {
    // No I/O split — blend input/output rates (honest crude mid).
    const blended = (rates.input + rates.output) / 2;
    totalUsd = usdFromTokens(total, blended);
    basis = "total_blended";
  }

  return {
    totalUsd,
    inputUsd,
    outputUsd,
    modelKey: matched.key,
    rates,
    precision: totalUsd != null ? "estimate" : "none",
    basis,
  };
}

/**
 * Coarse USD display. Always prefixes `~` when `estimated` (default true).
 * Does not invent many decimals: 4 under $0.01, 3 under $1, else 2.
 */
export function formatCostUsd(
  usd: number | null | undefined,
  estimated: boolean = true,
): string {
  if (usd == null || !Number.isFinite(usd) || usd < 0) return "—";
  let body: string;
  if (usd === 0) {
    body = "0";
  } else if (usd < 0.01) {
    body = usd.toFixed(4);
  } else if (usd < 1) {
    body = usd.toFixed(3);
  } else {
    body = usd.toFixed(2);
  }
  // Trim trailing zeros after decimal (keep at least one digit after point if any).
  if (body.includes(".")) {
    body = body.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
  }
  return estimated ? `~$${body}` : `$${body}`;
}

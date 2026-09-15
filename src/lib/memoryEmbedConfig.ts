/**
 * Pure helpers for Memory embedding settings (Grok Build 0.2.117 config.toml).
 * Host enforces path-scope + write gate; this validates UI drafts + patches.
 *
 * Allowlist (nested under `[memory.*]`):
 * - embedding.model / dimensions / provider
 * - search.max_results / min_score / vector_weight / text_weight
 * - search.mmr.enabled / lambda
 * - search.temporal_decay.enabled / half_life_days
 * - dream.* / watcher.enabled / initial_injection.*
 *
 * Missing keys stay null — never invent CLI defaults as “configured”.
 * App host search is always keyword; CLI hybrid needs embedding.model set.
 */

export type MemoryEmbedTri = boolean | null;

export type MemoryEmbedValues = {
  embeddingModel: string | null;
  embeddingDimensions: number | null;
  embeddingProvider: string | null;
  embeddingBaseUrl: string | null;
  /** Draft key; empty means keep existing. */
  embeddingApiKey: string | null;
  clearEmbeddingApiKey: boolean;
  hasEmbeddingApiKey: boolean;
  searchMaxResults: number | null;
  searchMinScore: number | null;
  searchVectorWeight: number | null;
  searchTextWeight: number | null;
  mmrEnabled: MemoryEmbedTri;
  mmrLambda: number | null;
  temporalDecayEnabled: MemoryEmbedTri;
  temporalDecayHalfLifeDays: number | null;
  dreamEnabled: MemoryEmbedTri;
  dreamMinHours: number | null;
  dreamMinSessions: number | null;
  dreamCheckIntervalSecs: number | null;
  watcherEnabled: MemoryEmbedTri;
  initialInjectionEnabled: MemoryEmbedTri;
  initialInjectionMinScore: number | null;
};

export type MemoryEmbedPatch = {
  embeddingModel?: string | null;
  clearEmbeddingModel?: boolean | null;
  embeddingDimensions?: number | null;
  embeddingProvider?: string | null;
  embeddingBaseUrl?: string | null;
  clearEmbeddingBaseUrl?: boolean | null;
  embeddingApiKey?: string | null;
  clearEmbeddingApiKey?: boolean | null;
  searchMaxResults?: number | null;
  searchMinScore?: number | null;
  searchVectorWeight?: number | null;
  searchTextWeight?: number | null;
  mmrEnabled?: boolean | null;
  mmrLambda?: number | null;
  temporalDecayEnabled?: boolean | null;
  temporalDecayHalfLifeDays?: number | null;
  dreamEnabled?: boolean | null;
  dreamMinHours?: number | null;
  dreamMinSessions?: number | null;
  dreamCheckIntervalSecs?: number | null;
  watcherEnabled?: boolean | null;
  initialInjectionEnabled?: boolean | null;
  initialInjectionMinScore?: number | null;
};

export type MemoryEmbedSnapshotLike = {
  embeddingModel?: string | null;
  embeddingDimensions?: number | null;
  embeddingProvider?: string | null;
  embeddingBaseUrl?: string | null;
  hasEmbeddingApiKey?: boolean | null;
  searchMaxResults?: number | null;
  searchMinScore?: number | null;
  searchVectorWeight?: number | null;
  searchTextWeight?: number | null;
  mmrEnabled?: boolean | null;
  mmrLambda?: number | null;
  temporalDecayEnabled?: boolean | null;
  temporalDecayHalfLifeDays?: number | null;
  dreamEnabled?: boolean | null;
  dreamMinHours?: number | null;
  dreamMinSessions?: number | null;
  dreamCheckIntervalSecs?: number | null;
  watcherEnabled?: boolean | null;
  initialInjectionEnabled?: boolean | null;
  initialInjectionMinScore?: number | null;
  embeddingConfigured?: boolean;
  appSearchMode?: string;
  cliSearchMode?: string;
  writable?: boolean;
  mode?: string;
  fileExists?: boolean;
  path?: string;
};

function tri(v: boolean | null | undefined): MemoryEmbedTri {
  if (v === true) return true;
  if (v === false) return false;
  return null;
}

function optStr(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t ? t : null;
}

function optNum(v: number | null | undefined): number | null {
  if (v == null || typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

/** Map host snapshot → UI draft (null = unset / missing). */
export function valuesFromMemoryEmbedSnapshot(
  snap: MemoryEmbedSnapshotLike | null | undefined,
): MemoryEmbedValues {
  return {
    embeddingModel: optStr(snap?.embeddingModel),
    embeddingDimensions: optNum(snap?.embeddingDimensions),
    embeddingProvider: optStr(snap?.embeddingProvider),
    embeddingBaseUrl: optStr(snap?.embeddingBaseUrl),
    embeddingApiKey: null,
    clearEmbeddingApiKey: false,
    hasEmbeddingApiKey: snap?.hasEmbeddingApiKey === true,
    searchMaxResults: optNum(snap?.searchMaxResults),
    searchMinScore: optNum(snap?.searchMinScore),
    searchVectorWeight: optNum(snap?.searchVectorWeight),
    searchTextWeight: optNum(snap?.searchTextWeight),
    mmrEnabled: tri(snap?.mmrEnabled),
    mmrLambda: optNum(snap?.mmrLambda),
    temporalDecayEnabled: tri(snap?.temporalDecayEnabled),
    temporalDecayHalfLifeDays: optNum(snap?.temporalDecayHalfLifeDays),
    dreamEnabled: tri(snap?.dreamEnabled),
    dreamMinHours: optNum(snap?.dreamMinHours),
    dreamMinSessions: optNum(snap?.dreamMinSessions),
    dreamCheckIntervalSecs: optNum(snap?.dreamCheckIntervalSecs),
    watcherEnabled: tri(snap?.watcherEnabled),
    initialInjectionEnabled: tri(snap?.initialInjectionEnabled),
    initialInjectionMinScore: optNum(snap?.initialInjectionMinScore),
  };
}

function numChanged(
  draft: number | null,
  baseline: number | null,
): draft is number {
  if (draft == null) return false;
  if (baseline == null) return true;
  return draft !== baseline;
}

function triChanged(
  draft: MemoryEmbedTri,
  baseline: MemoryEmbedTri,
): draft is boolean {
  return draft !== baseline && draft !== null;
}

/** Build a host patch from draft vs baseline (only changed concrete fields). */
export function buildMemoryEmbedPatch(
  draft: MemoryEmbedValues,
  baseline: MemoryEmbedValues,
): MemoryEmbedPatch {
  const patch: MemoryEmbedPatch = {};

  const dModel = draft.embeddingModel?.trim() || null;
  const bModel = baseline.embeddingModel?.trim() || null;
  if (dModel !== bModel) {
    if (dModel == null && bModel != null) {
      patch.clearEmbeddingModel = true;
    } else if (dModel != null) {
      patch.embeddingModel = dModel;
    }
  }

  if (numChanged(draft.embeddingDimensions, baseline.embeddingDimensions)) {
    patch.embeddingDimensions = draft.embeddingDimensions;
  }
  if (
    (draft.embeddingProvider?.trim() || null) !==
    (baseline.embeddingProvider?.trim() || null)
  ) {
    const p = draft.embeddingProvider?.trim();
    if (p) patch.embeddingProvider = p;
  }
  const dUrl = draft.embeddingBaseUrl?.trim() || null;
  const bUrl = baseline.embeddingBaseUrl?.trim() || null;
  if (dUrl !== bUrl) {
    if (dUrl == null && bUrl != null) patch.clearEmbeddingBaseUrl = true;
    else if (dUrl != null) patch.embeddingBaseUrl = dUrl;
  }
  if (draft.clearEmbeddingApiKey && baseline.hasEmbeddingApiKey) {
    patch.clearEmbeddingApiKey = true;
  } else {
    const dKey = draft.embeddingApiKey?.trim() || null;
    if (dKey) patch.embeddingApiKey = dKey;
  }
  if (numChanged(draft.searchMaxResults, baseline.searchMaxResults)) {
    patch.searchMaxResults = draft.searchMaxResults;
  }
  if (numChanged(draft.searchMinScore, baseline.searchMinScore)) {
    patch.searchMinScore = draft.searchMinScore;
  }
  if (numChanged(draft.searchVectorWeight, baseline.searchVectorWeight)) {
    patch.searchVectorWeight = draft.searchVectorWeight;
  }
  if (numChanged(draft.searchTextWeight, baseline.searchTextWeight)) {
    patch.searchTextWeight = draft.searchTextWeight;
  }
  if (triChanged(draft.mmrEnabled, baseline.mmrEnabled)) {
    patch.mmrEnabled = draft.mmrEnabled;
  }
  if (numChanged(draft.mmrLambda, baseline.mmrLambda)) {
    patch.mmrLambda = draft.mmrLambda;
  }
  if (
    triChanged(draft.temporalDecayEnabled, baseline.temporalDecayEnabled)
  ) {
    patch.temporalDecayEnabled = draft.temporalDecayEnabled;
  }
  if (
    numChanged(
      draft.temporalDecayHalfLifeDays,
      baseline.temporalDecayHalfLifeDays,
    )
  ) {
    patch.temporalDecayHalfLifeDays = draft.temporalDecayHalfLifeDays;
  }
  if (triChanged(draft.dreamEnabled, baseline.dreamEnabled)) {
    patch.dreamEnabled = draft.dreamEnabled;
  }
  if (numChanged(draft.dreamMinHours, baseline.dreamMinHours)) {
    patch.dreamMinHours = draft.dreamMinHours;
  }
  if (numChanged(draft.dreamMinSessions, baseline.dreamMinSessions)) {
    patch.dreamMinSessions = draft.dreamMinSessions;
  }
  if (
    numChanged(draft.dreamCheckIntervalSecs, baseline.dreamCheckIntervalSecs)
  ) {
    patch.dreamCheckIntervalSecs = draft.dreamCheckIntervalSecs;
  }
  if (triChanged(draft.watcherEnabled, baseline.watcherEnabled)) {
    patch.watcherEnabled = draft.watcherEnabled;
  }
  if (
    triChanged(
      draft.initialInjectionEnabled,
      baseline.initialInjectionEnabled,
    )
  ) {
    patch.initialInjectionEnabled = draft.initialInjectionEnabled;
  }
  if (
    numChanged(
      draft.initialInjectionMinScore,
      baseline.initialInjectionMinScore,
    )
  ) {
    patch.initialInjectionMinScore = draft.initialInjectionMinScore;
  }

  return patch;
}

export function hasMemoryEmbedChanges(patch: MemoryEmbedPatch): boolean {
  return Object.values(patch).some((v) => v !== undefined && v !== null);
}

/**
 * Toggle a tri-state bool for UI:
 * - null → true
 * - true → false
 * - false → true
 */
export function toggleMemoryEmbedTri(current: MemoryEmbedTri): boolean {
  if (current === null) return true;
  return !current;
}

export function memoryEmbedKeyPresence(
  value: MemoryEmbedTri,
): "set_on" | "set_off" | "unset" {
  if (value === true) return "set_on";
  if (value === false) return "set_off";
  return "unset";
}

export function memoryEmbedToggleChecked(value: MemoryEmbedTri): boolean {
  return value === true;
}

/** Whether writes are allowed for this snapshot (independent mode only). */
export function isMemoryEmbedWritable(
  snap: MemoryEmbedSnapshotLike | null | undefined,
): boolean {
  return !!snap?.writable;
}

/**
 * Derived embedding availability (honest): only true when model is non-empty.
 * Never invents “on” from dimensions-only or CLI defaults.
 */
export function isEmbeddingConfigured(
  snap: MemoryEmbedSnapshotLike | null | undefined,
): boolean {
  if (snap?.embeddingConfigured === true) return true;
  const m = snap?.embeddingModel?.trim();
  return !!m;
}

/**
 * App host browser search is always keyword. CLI agent tool is hybrid only
 * when embedding.model is set.
 */
export function describeSearchModes(
  snap: MemoryEmbedSnapshotLike | null | undefined,
): { app: "keyword"; cli: "hybrid" | "keyword" } {
  const app =
    snap?.appSearchMode === "keyword" || !snap?.appSearchMode
      ? "keyword"
      : "keyword";
  const cliConfigured = isEmbeddingConfigured(snap);
  const cliFromSnap =
    snap?.cliSearchMode === "hybrid" || snap?.cliSearchMode === "keyword"
      ? snap.cliSearchMode
      : cliConfigured
        ? "hybrid"
        : "keyword";
  return { app, cli: cliFromSnap };
}

/** Validate numeric draft fields before save (null = skip). */
export function validateMemoryEmbedDraft(
  draft: MemoryEmbedValues,
): string | null {
  const url = draft.embeddingBaseUrl?.trim();
  if (url && !/^https?:\/\//i.test(url)) {
    return "embedding.base_url must start with http:// or https://";
  }
  if (
    draft.embeddingDimensions != null &&
    (draft.embeddingDimensions < 1 || draft.embeddingDimensions > 16384)
  ) {
    return "embedding.dimensions must be 1–16384";
  }
  if (
    draft.searchMaxResults != null &&
    (draft.searchMaxResults < 1 || draft.searchMaxResults > 100)
  ) {
    return "search.max_results must be 1–100";
  }
  if (draft.mmrLambda != null && (draft.mmrLambda < 0 || draft.mmrLambda > 1)) {
    return "mmr.lambda must be 0–1";
  }
  for (const [label, v] of [
    ["search.min_score", draft.searchMinScore],
    ["search.vector_weight", draft.searchVectorWeight],
    ["search.text_weight", draft.searchTextWeight],
    ["temporal_decay.half_life_days", draft.temporalDecayHalfLifeDays],
    ["dream.min_hours", draft.dreamMinHours],
    ["initial_injection.min_score", draft.initialInjectionMinScore],
  ] as const) {
    if (v != null && (v < 0 || !Number.isFinite(v))) {
      return `${label} must be a finite number ≥ 0`;
    }
  }
  if (
    draft.dreamMinSessions != null &&
    (draft.dreamMinSessions < 0 || !Number.isFinite(draft.dreamMinSessions))
  ) {
    return "dream.min_sessions must be ≥ 0";
  }
  return null;
}

/** Parse optional number input (empty → null). */
export function parseOptionalNumber(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return n;
}

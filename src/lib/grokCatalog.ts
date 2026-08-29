/**
 * Catalogs aligned with Grok Build CLI (`grok models`, reasoning effort, permission).
 * Live selectable models come from `models_list_available` (CLI cache + custom providers).
 * Update docs/llm-wiki/catalog.md when defaults change.
 */

export interface EffortOption {
  /** Effort id passed to `--reasoning-effort` (e.g. low / medium / high). */
  id: string;
  /** CLI value when distinct from id; usually equals id. */
  value?: string;
  /** Display label from catalog when present. */
  label?: string;
  description?: string;
  isDefault?: boolean;
}

export interface ModelOption {
  id: string;
  /** Display name (language-neutral product name) */
  label: string;
  /** True if CLI lists as default */
  isDefault?: boolean;
  /** Catalog source; official list is one group in the composer model menu. */
  source?: string;
  /** Per-model reasoning efforts from CLI cache; empty/undefined → static fallback. */
  reasoningEfforts?: EffortOption[];
  /** Model context window in tokens (live-merged from `initialize`). */
  contextWindow?: number | null;
}

export interface SessionModeOption {
  id: "agent" | "plan" | "ask";
}

/**
 * Permission policies (composer + settings), aligned with Grok Build modes:
 * | Build / CLI `--permission-mode` | App id            |
 * | default                         | ask               |
 * | acceptEdits                     | accept_edits      |
 * | (session grant UX → default)    | allow_for_session |
 * | auto                            | auto              |
 * | dontAsk                         | dont_ask          |
 * | bypassPermissions               | always_approve    |
 * | plan                            | (product mode `plan`, not a policy) |
 *
 * Pure map helpers: `src/lib/permissionModeMap.ts`.
 */
export type PermissionPolicyId =
  | "ask"
  | "accept_edits"
  | "allow_for_session"
  | "auto"
  | "dont_ask"
  | "always_approve";

/** Where composer model / permission choices are remembered. */
export type ComposerPrefsScope = "global" | "project" | "session";

export const COMPOSER_PREFS_SCOPES: ComposerPrefsScope[] = [
  "global",
  "project",
  "session",
];

/**
 * Static 3-tier fallback (low / medium / high) when a model has no
 * `reasoning_efforts` in cache. Default **high** matches Grok Build 1.0
 * and the official API default. Prefer live catalog via
 * `pickDefaultEffort(model)` whenever available.
 */
export const GROK_BUILD_EFFORTS: EffortOption[] = [
  { id: "low" },
  { id: "medium" },
  { id: "high", isDefault: true },
];

/**
 * Official Grok 4.6 efforts (CLI `models_cache` 2026-08-12).
 * Product default on 4.6 is **xhigh**. Live cache may mark both high and
 * xhigh as `default: true` — callers must go through `pickDefaultEffort`
 * / `normalizeEffortDefaults`.
 */
export const GROK_4_6_EFFORTS: EffortOption[] = [
  { id: "low" },
  { id: "medium" },
  { id: "high" },
  { id: "xhigh", isDefault: true },
];

/**
 * Fallback catalog when Host has not returned live models yet.
 * Official OAuth exposes grok-4.6 (default) and grok-4.5 (2026-08 probe).
 * `grok-build` is NOT listed — CLI rejects it as unknown model id.
 */
export const GROK_BUILD_MODELS: ModelOption[] = [
  {
    id: "grok-4.6",
    label: "Grok 4.6",
    isDefault: true,
    source: "official",
    reasoningEfforts: GROK_4_6_EFFORTS,
    contextWindow: 500000,
  },
  {
    id: "grok-4.5",
    label: "Grok 4.5",
    source: "official",
    reasoningEfforts: GROK_BUILD_EFFORTS,
    contextWindow: 500000,
  },
];

export const DEFAULT_MODEL_ID =
  GROK_BUILD_MODELS.find((m) => m.isDefault)?.id ?? "grok-4.6";

/**
 * Fallback context window (tokens) for custom providers that have not set one.
 * Official models prefer the live `contextWindow` from `initialize` / cache.
 */
export const DEFAULT_CUSTOM_CONTEXT_WINDOW = 200000;

/**
 * Cold-start default reasoning depth when no live catalog is loaded yet.
 * Aligned with Grok Build 1.0 official default (**high**). Users can lower
 * effort for faster turns via the composer chip. Prefer
 * `pickDefaultEffort(model)` when the model lists a default.
 */
export const DEFAULT_EFFORT = "high";

/**
 * Canonical composer effort ladder (low → high intensity).
 * All channels present a prefix of this ladder; 3-tier models omit `xhigh` (极高).
 * Selection maps to the model’s real spawn / `reasoning_effort` value.
 */
export type EffortUiSlotId = "low" | "medium" | "high" | "xhigh";

export const EFFORT_UI_LADDER: readonly EffortUiSlotId[] = [
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type EffortUiOption = {
  /** Stable UI slot (display order + i18n). */
  uiId: EffortUiSlotId;
  /** Value passed to agent `--reasoning-effort` / upstream. */
  spawnId: string;
};

/**
 * Discrete Faster↔Smarter stops for the composer Effort popover.
 * Labels use catalog spawn ids (`xhigh`, `max`) — not Claude's Extra name.
 * Purple (`accent: "ultra"`) marks the strongest stop in this catalog.
 */
export type EffortPickerStopId = "low" | "medium" | "high" | "xhigh" | "max";

export type EffortPickerStop = {
  id: EffortPickerStopId;
  spawnId: string;
  /** Strongest stop in this catalog (purple thumb). */
  accent?: "ultra";
};

/** Product session modes (desktop shell). */
export const SESSION_MODES: SessionModeOption[] = [
  { id: "agent" },
  { id: "plan" },
  { id: "ask" },
];

/**
 * Permission policies (composer + settings).
 * `always_approve` = YOLO / unrestricted (CLI `--always-approve` + `bypassPermissions`).
 * `auto` = CLI auto mode (fewer prompts with safety checks).
 * Product **plan** is a session mode, not a row here — see `permissionModeMap`.
 */
export const PERMISSION_POLICIES: {
  id: PermissionPolicyId;
  dangerous?: boolean;
}[] = [
  { id: "ask" },
  { id: "accept_edits" },
  { id: "allow_for_session" },
  { id: "auto" },
  { id: "dont_ask" },
  { id: "always_approve", dangerous: true },
];

export function isValidModelId(
  id: string,
  catalog: ModelOption[] = GROK_BUILD_MODELS,
): boolean {
  return catalog.some((m) => m.id === id);
}

/**
 * Collapse multiple `isDefault` flags. CLI grok-4.6 cache marks both
 * `xhigh` and `high` as default; product default on 4.6 is **xhigh**.
 */
export function normalizeEffortDefaults(
  efforts: EffortOption[],
): EffortOption[] {
  const flagged = efforts.filter((e) => e.isDefault);
  if (flagged.length <= 1) return efforts;
  const preferXhigh = flagged.some(
    (e) => e.id.trim().toLowerCase() === "xhigh",
  );
  if (preferXhigh) {
    return efforts.map((e) => ({
      ...e,
      isDefault: e.id.trim().toLowerCase() === "xhigh",
    }));
  }
  const preferHigh = flagged.some(
    (e) => e.id.trim().toLowerCase() === "high",
  );
  if (!preferHigh) return efforts;
  return efforts.map((e) => ({
    ...e,
    isDefault: e.id.trim().toLowerCase() === "high",
  }));
}

function fallbackEffortsForModelId(modelId?: string | null): EffortOption[] {
  const id = modelId?.trim().toLowerCase() ?? "";
  if (id === "grok-4.6") return GROK_4_6_EFFORTS;
  return GROK_BUILD_EFFORTS;
}

/**
 * Efforts list for a model: live catalog when non-empty, else static fallback.
 * grok-4.6 falls back to 4-tier (incl. xhigh); other official models stay 3-tier.
 */
export function effortsForModel(
  model?: ModelOption | null,
  catalogEfforts?: EffortOption[] | null,
): EffortOption[] {
  const fromArg =
    catalogEfforts && catalogEfforts.length > 0 ? catalogEfforts : null;
  const fromModel =
    model?.reasoningEfforts && model.reasoningEfforts.length > 0
      ? model.reasoningEfforts
      : null;
  const raw = fromArg ?? fromModel ?? fallbackEffortsForModelId(model?.id);
  return normalizeEffortDefaults(raw);
}

/**
 * Validate an effort id against the selected model's efforts when known;
 * otherwise against the static GROK_BUILD_EFFORTS fallback.
 */
export function isValidEffort(
  id: string,
  modelOrEfforts?: ModelOption | EffortOption[] | null,
): boolean {
  if (!id) return false;
  if (Array.isArray(modelOrEfforts)) {
    return effortsForModel(null, modelOrEfforts).some((e) => e.id === id);
  }
  return effortsForModel(modelOrEfforts).some((e) => e.id === id);
}

/**
 * Composer effort catalog for the active route.
 * Custom channels use their configured efforts; official uses the
 * selected model's live/fallback list (grok-4.6 includes xhigh).
 */
export function effortCatalogForRoute(opts: {
  model?: ModelOption | null;
  channelEfforts?: EffortOption[] | null;
}): EffortOption[] {
  if (opts.channelEfforts && opts.channelEfforts.length > 0) {
    return effortsForModel(null, opts.channelEfforts);
  }
  return effortsForModel(opts.model);
}

/** Default effort for a model (catalog default flag, else first, else DEFAULT_EFFORT). */
export function pickDefaultEffort(
  model?: ModelOption | null,
  catalogEfforts?: EffortOption[] | null,
): string {
  const list = effortsForModel(model, catalogEfforts);
  return (
    list.find((e) => e.isDefault)?.id ?? list[0]?.id ?? DEFAULT_EFFORT
  );
}

/**
 * Whether a string is safe to pass as CLI `--reasoning-effort <id>`.
 * Catalog may expose low/medium/high, custom `max`, or channel-specific tiers.
 * Host spawn must not hard-allowlist only Grok 3-tier ids.
 */
export function isSpawnableReasoningEffort(id: string): boolean {
  const t = id.trim();
  if (!t || t.length > 64) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(t);
}

/** Classify an effort catalog for cross-channel / UI-ladder mapping. */
export function effortCatalogKind(
  efforts?: EffortOption[] | null,
): "grok3" | "tier4" | "deepseek4" | "other" {
  const list = efforts?.length ? efforts : [];
  const ids = new Set(list.map((e) => e.id.trim().toLowerCase()));
  const hasMedium = ids.has("medium");
  const hasXhigh = ids.has("xhigh");
  const hasMax = ids.has("max");
  const hasDsTop = hasXhigh || hasMax;
  // DeepSeek 4-tier remap (high→中, xhigh→高, max→极高) only when both
  // xhigh and max exist. `low/high/max` must not take this path — otherwise
  // `high` occupies 中 and falls back onto 高, so both rows look selected.
  if (!hasMedium && hasXhigh && hasMax) return "deepseek4";
  // 4-tier with medium: official grok-4.6 (low/medium/high/xhigh) or a
  // custom channel that adds max. 极高 maps to max, else xhigh.
  if (hasDsTop && hasMedium) return "tier4";
  // Grok 3-tier: low/medium/high (no xhigh/max) — grok-4.5 and older.
  if (hasMedium) return "grok3";
  return "other";
}

/**
 * Map catalog spawn ids onto the canonical UI ladder (低/中/高/极高).
 *
 * Grok 3-tier: low→低, medium→中, high→高 (no 极高).
 * Official grok-4.6 / custom 4-tier: low→低, medium→中, high→高, xhigh|max→极高.
 * DeepSeek 4-tier: low→低, high→中, xhigh→高, max→极高.
 * Incomplete no-medium catalogs (e.g. low/high/max): by id, omit empty slots.
 */
function spawnMapForCatalog(
  catalog: EffortOption[],
): Partial<Record<EffortUiSlotId, string>> {
  const byLower = new Map(
    catalog.map((e) => [e.id.trim().toLowerCase(), e.id] as const),
  );
  const kind = effortCatalogKind(catalog);
  if (kind === "grok3") {
    return {
      low: byLower.get("low"),
      medium: byLower.get("medium"),
      high: byLower.get("high"),
    };
  }
  if (kind === "tier4") {
    return {
      low: byLower.get("low"),
      medium: byLower.get("medium"),
      high: byLower.get("high"),
      // Official grok-4.6 极高 is `xhigh`. Prefer it when both xhigh and
      // max appear (CLI cache has dual defaults) — `max` is ignored (#598).
      xhigh: byLower.get("xhigh") ?? byLower.get("max"),
    };
  }
  if (kind === "deepseek4") {
    return {
      low: byLower.get("low"),
      medium: byLower.get("high"),
      high: byLower.get("xhigh"),
      xhigh: byLower.get("max"),
    };
  }
  // Generic: place known ids on the ladder; keep catalog order for the rest.
  const map: Partial<Record<EffortUiSlotId, string>> = {};
  for (const slot of EFFORT_UI_LADDER) {
    const id = byLower.get(slot);
    if (id) map[slot] = id;
  }
  if (byLower.has("max") && !map.xhigh) map.xhigh = byLower.get("max");
  return map;
}

/**
 * Ordered UI options for the composer effort menu.
 * 3-tier catalogs omit 极高; values are the real spawn ids.
 */
export function effortUiOptionsForCatalog(
  catalogEfforts?: EffortOption[] | null,
): EffortUiOption[] {
  const list = effortsForModel(null, catalogEfforts);
  const map = spawnMapForCatalog(list);
  const used = new Set<string>();
  const out: EffortUiOption[] = [];
  for (const uiId of EFFORT_UI_LADDER) {
    const spawnId = map[uiId];
    if (!spawnId) continue;
    const key = spawnId.trim().toLowerCase();
    if (used.has(key)) continue;
    used.add(key);
    out.push({ uiId, spawnId });
  }
  return out;
}

/** Discrete Faster↔Smarter stops for the composer Effort popover. */
export function effortPickerStops(
  catalogEfforts?: EffortOption[] | null,
): EffortPickerStop[] {
  const list = effortsForModel(null, catalogEfforts);
  const byLower = new Map(
    list.map((e) => [e.id.trim().toLowerCase(), e.id] as const),
  );
  const stops: EffortPickerStop[] = [];
  const take = (
    key: string,
    id: EffortPickerStopId,
    accent?: EffortPickerStop["accent"],
  ) => {
    const spawn = byLower.get(key);
    if (spawn) stops.push({ id, spawnId: spawn, accent });
  };
  take("low", "low");
  take("medium", "medium");
  take("high", "high");
  take("xhigh", "xhigh");
  const maxSpawn = byLower.get("max");
  if (maxSpawn && !stops.some((s) => s.spawnId === maxSpawn)) {
    stops.push({ id: "max", spawnId: maxSpawn });
  }
  const last = stops[stops.length - 1];
  if (last) last.accent = "ultra";
  return stops;
}

/** True when this UI row is the selected effort (at most one row). */
export function effortUiOptionIsActive(
  option: EffortUiOption,
  spawnId: string,
  catalogEfforts?: EffortOption[] | null,
): boolean {
  const slot = spawnIdToEffortUiSlot(spawnId, catalogEfforts);
  if (slot) return option.uiId === slot;
  return option.spawnId.trim().toLowerCase() === spawnId.trim().toLowerCase();
}

/** Resolve which UI slot a spawn id occupies for this catalog. */
export function spawnIdToEffortUiSlot(
  spawnId: string,
  catalogEfforts?: EffortOption[] | null,
): EffortUiSlotId | null {
  const cur = spawnId.trim().toLowerCase();
  if (!cur) return null;
  const opts = effortUiOptionsForCatalog(catalogEfforts);
  const exact = opts.find((o) => o.spawnId.toLowerCase() === cur);
  if (exact) return exact.uiId;

  // Infer from raw id when catalog context is missing/partial.
  if (cur === "low" || cur === "medium" || cur === "high" || cur === "xhigh") {
    return cur;
  }
  if (cur === "max") return "xhigh";
  return null;
}

/**
 * Map a spawn effort into another catalog via the shared UI ladder.
 * Missing middle slots prefer the next higher remaining tier
 * (e.g. 中 → 高 on low/high/max). Missing top slots clamp down
 * (e.g. 极高 → 高 on 3-tier).
 */
export function mapEffortToTargetCatalog(
  current: string,
  targetEfforts?: EffortOption[] | null,
  sourceEfforts?: EffortOption[] | null,
): string {
  const targetList = effortsForModel(null, targetEfforts);
  if (targetList.length === 0) return DEFAULT_EFFORT;

  const sourceList = sourceEfforts?.length
    ? effortsForModel(null, sourceEfforts)
    : null;
  const slot =
    spawnIdToEffortUiSlot(current, sourceList) ??
    spawnIdToEffortUiSlot(current, targetList) ??
    "medium";

  const targetOpts = effortUiOptionsForCatalog(targetList);
  const exact = targetOpts.find((o) => o.uiId === slot);
  if (exact) return exact.spawnId;

  // Missing middle (no 中 on low/high/max) → next higher slot (高).
  // Missing top (极高 on 3-tier) → clamp down to 高.
  const idx = EFFORT_UI_LADDER.indexOf(slot);
  for (let i = idx + 1; i < EFFORT_UI_LADDER.length; i++) {
    const hit = targetOpts.find((o) => o.uiId === EFFORT_UI_LADDER[i]);
    if (hit) return hit.spawnId;
  }
  for (let i = idx - 1; i >= 0; i--) {
    const hit = targetOpts.find((o) => o.uiId === EFFORT_UI_LADDER[i]);
    if (hit) return hit.spawnId;
  }
  return pickDefaultEffort(null, targetList);
}

/**
 * Strip a shared CLI suffix so "High Effort" / "Medium Effort" collapse to
 * "High" / "Medium" (identical trailing " Effort" is noise in compact UI).
 */
export function stripCommonEffortSuffix(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return trimmed;
  const stripped = trimmed.replace(/\s+Effort$/i, "").trim();
  return stripped || trimmed;
}

/**
 * Display label for an effort.
 * - Standard Grok ids (`high` / `medium` / `low`): prefer i18n.
 * - DeepSeek-style ids (`xhigh` / `max` / `none`): prefer i18n when provided.
 * - Other catalog labels: strip a shared " Effort" suffix, then raw id / label.
 */
/** Known effort ids that have dedicated i18n keys (`effort.<id>`). */
const I18N_EFFORT_IDS = new Set([
  "high",
  "medium",
  "low",
  "xhigh",
  "max",
  "none",
]);

export function effortDisplayLabel(
  effort: EffortOption | string,
  i18nLabels?: {
    high?: string;
    medium?: string;
    low?: string;
    xhigh?: string;
    max?: string;
    none?: string;
  },
): string {
  const id = (typeof effort === "string" ? effort : effort.id)
    .trim()
    .toLowerCase();
  // Prefer locale labels for known ids even when the catalog stored an
  // English `name`/`label` (e.g. channel efforts saved as "xhigh"/"max").
  if (id === "high" && i18nLabels?.high) return i18nLabels.high;
  if (id === "medium" && i18nLabels?.medium) return i18nLabels.medium;
  if (id === "low" && i18nLabels?.low) return i18nLabels.low;
  if (id === "xhigh" && i18nLabels?.xhigh) return i18nLabels.xhigh;
  // DeepSeek `max` is the top UI slot (极高); prefer xhigh label when max text omitted.
  if (id === "max") {
    if (i18nLabels?.max) return i18nLabels.max;
    if (i18nLabels?.xhigh) return i18nLabels.xhigh;
  }
  if (id === "none" && i18nLabels?.none) return i18nLabels.none;

  if (typeof effort !== "string") {
    const raw = effort.label?.trim();
    // Skip label when it is just the raw id (would re-show English "xhigh").
    if (raw && raw.toLowerCase() !== id && !I18N_EFFORT_IDS.has(raw.toLowerCase())) {
      return stripCommonEffortSuffix(raw);
    }
    if (raw && !I18N_EFFORT_IDS.has(id)) {
      return stripCommonEffortSuffix(raw);
    }
    return effort.id;
  }
  return effort;
}

/**
 * Map provider-channel effort entries into EffortOption for composer menus.
 */
export function effortOptionsFromProvider(
  efforts:
    | Array<{ id: string; name?: string; label?: string; isDefault?: boolean }>
    | null
    | undefined,
): EffortOption[] | null {
  if (!efforts?.length) return null;
  const out: EffortOption[] = [];
  const seen = new Set<string>();
  for (const e of efforts) {
    const id = e.id?.trim() ?? "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = (e.name ?? e.label)?.trim();
    out.push({
      id,
      label: label || undefined,
      isDefault: !!e.isDefault,
    });
  }
  return out.length ? out : null;
}

export function isValidPolicy(id: string): id is PermissionPolicyId {
  return PERMISSION_POLICIES.some((p) => p.id === id);
}

export function isValidPrefsScope(id: string): id is ComposerPrefsScope {
  return COMPOSER_PREFS_SCOPES.includes(id as ComposerPrefsScope);
}

export function pickDefaultModelId(catalog: ModelOption[]): string {
  return (
    catalog.find((m) => m.isDefault)?.id ??
    catalog[0]?.id ??
    DEFAULT_MODEL_ID
  );
}

/** Find a model in catalog by id. */
export function findModel(
  id: string,
  catalog: ModelOption[] = GROK_BUILD_MODELS,
): ModelOption | undefined {
  return catalog.find((m) => m.id === id);
}

/**
 * Resolve the effective context window (tokens) for the composer context.
 *
 * Precedence:
 * 1. Agent-reported CLI denominator (`auto_compact_started.context_window` /
 *    occupancy usage) when positive — matches `/session-info`.
 * 2. Custom provider route: channel `contextWindow`, else
 *    {@link DEFAULT_CUSTOM_CONTEXT_WINDOW} (200k). **Custom only.**
 * 3. Official route: live model `contextWindow` from `models_cache` /
 *    `initialize` merge. Never invent 200k when live says 500k (or any
 *    other catalog value). `null` when unknown (chip hides the % row).
 */
export function resolveContextWindow(opts: {
  activeCustomProvider?: { contextWindow?: number | null } | null;
  modelId: string;
  models?: ModelOption[];
  /**
   * Agent-reported context window (tokens). When set and positive, wins
   * over catalog so Grok Build 1.0 occupancy (500k) is never replaced by a
   * stale catalog or the custom-channel 200k default.
   */
  agentContextWindow?: number | null;
}): number | null {
  const {
    activeCustomProvider,
    modelId,
    models = GROK_BUILD_MODELS,
    agentContextWindow,
  } = opts;
  if (
    agentContextWindow != null &&
    Number.isFinite(agentContextWindow) &&
    agentContextWindow > 0
  ) {
    return Math.floor(agentContextWindow);
  }
  if (activeCustomProvider) {
    const custom = activeCustomProvider.contextWindow;
    if (custom != null && Number.isFinite(custom) && custom > 0) {
      return Math.floor(custom);
    }
    return DEFAULT_CUSTOM_CONTEXT_WINDOW;
  }
  const m = findModel(modelId, models);
  const catalog = m?.contextWindow;
  if (catalog != null && Number.isFinite(catalog) && catalog > 0) {
    return Math.floor(catalog);
  }
  // Official / unknown: never fall back to DEFAULT_CUSTOM_CONTEXT_WINDOW.
  return null;
}

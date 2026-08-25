/**
 * Pure product helpers that unify codebase indexing + project search honesty.
 *
 * ## Product rules
 * - App project search is **keyword only** (rg/walk). Never invent embeddings
 *   or code-graph hits when the host does not provide a real graph field.
 * - `[features].codebase_indexing` is code-**graph** indexing for CLI
 *   search/code-nav — not memory embeddings.
 * - Modes stay soft-fail honest: unset ≠ set on; CLI old is a soft-fail chip.
 * - Host graph rebuild API is not available in this App — rebuild plans return
 *   `unavailable` with CLI-only honesty (never invent a rebuild button path).
 */

import {
  CODEBASE_INDEXING_CLI_DEFAULT,
  CODEBASE_INDEXING_MIN_CLI,
  type CodebaseIndexingKind,
} from "./codebaseIndexing";
import {
  resolveCodebaseSearchKind,
  type CodebaseSearchHitLike,
} from "./codebaseSearch";

/** Whether the App host exposes a code-graph search API. Flip only when real. */
export const HOST_CODE_GRAPH_SEARCH_AVAILABLE = false;

/** Whether the App host exposes a code-graph rebuild API. Flip only when real. */
export const HOST_CODE_GRAPH_REBUILD_AVAILABLE = false;

/**
 * Unified code-graph product mode for chips / empty / status copy.
 *
 * - `keyword_only` — indexing set off; App search is keyword only
 * - `graph_enabled_unknown` — indexing set on/custom; CLI may build a graph,
 *   but App search does not query it (status unknown to App)
 * - `graph_unavailable` — indexing effective on but App has no graph search
 *   path (host API absent); never surface graph hits
 * - `cli_old` — CLI known older than codebase_indexing surface
 * - `unset_default_on` — key missing; CLI default is on (honest “unset”)
 */
export type CodeGraphMode =
  | "keyword_only"
  | "graph_enabled_unknown"
  | "graph_unavailable"
  | "cli_old"
  | "unset_default_on";

export type ResolveCodeGraphModeOpts = {
  /**
   * Bool form of `[features].codebase_indexing`.
   * - `true` / `false` — set bool
   * - `null` / `undefined` — unset **or** custom (use `indexingKind`)
   */
  indexingEnabled?: boolean | null;
  /** Kind of the key on disk. Defaults from `indexingEnabled` when omitted. */
  indexingKind?: CodebaseIndexingKind | string | null;
  /** True when CLI is known older than {@link CODEBASE_INDEXING_MIN_CLI}. */
  cliOld?: boolean;
  /**
   * Host/App search kind string (`keyword` | `graph` | …).
   * Never upgrades App hits to graph unless host graph search is available
   * **and** the kind is truly graph (see {@link HOST_CODE_GRAPH_SEARCH_AVAILABLE}).
   */
  searchKind?: string | null;
  /**
   * Whether host exposes graph search. Defaults to
   * {@link HOST_CODE_GRAPH_SEARCH_AVAILABLE} (false today).
   */
  hostGraphSearchAvailable?: boolean;
};

function normalizeIndexingKind(
  kind: string | null | undefined,
  enabled: boolean | null | undefined,
): CodebaseIndexingKind {
  const k = (kind ?? "").trim().toLowerCase();
  if (k === "custom") return "custom";
  if (k === "bool") return "bool";
  if (k === "unset") return "unset";
  if (enabled === true || enabled === false) return "bool";
  return "unset";
}

/**
 * Resolve unified code-graph product mode.
 *
 * Priority: `cli_old` → `unset_default_on` → off (`keyword_only`) →
 * on (`graph_unavailable` when App cannot search graph, else
 * `graph_enabled_unknown`).
 */
export function resolveCodeGraphMode(
  opts: ResolveCodeGraphModeOpts = {},
): CodeGraphMode {
  if (opts.cliOld === true) return "cli_old";

  const kind = normalizeIndexingKind(opts.indexingKind, opts.indexingEnabled);
  if (kind === "unset") return "unset_default_on";

  if (kind === "bool" && opts.indexingEnabled === false) {
    return "keyword_only";
  }

  // Indexing on (bool true or custom globs). App still never invents graph hits.
  const hostGraph =
    opts.hostGraphSearchAvailable === true ||
    (opts.hostGraphSearchAvailable === undefined &&
      HOST_CODE_GRAPH_SEARCH_AVAILABLE);
  const sk = (opts.searchKind ?? "").trim().toLowerCase().replace(/-/g, "_");
  const hostClaimsGraph = sk === "graph" || sk === "code_graph" || sk === "codegraph";

  // Host truly has graph search + reports graph → still unknown readiness
  // (no health probe). App annotateHits remains keyword unless hit.source set.
  if (hostGraph && hostClaimsGraph) {
    return "graph_enabled_unknown";
  }

  // Indexing on but App has no graph search path (today's reality).
  if (!hostGraph) {
    return "graph_unavailable";
  }

  // Host graph API exists but search kind is not graph → unknown graph status.
  return "graph_enabled_unknown";
}

/** Status / mode chip ids for UI badges. */
export type CodeGraphStatusChipId =
  | "app_keyword"
  | "cli_graph"
  | "cli_graph_default_on"
  | "graph_unavailable"
  | "keyword_only"
  | "cli_old"
  | "no_embeddings";

/**
 * Build ordered honesty chips for the code-graph product surface.
 * Always includes App keyword + no-embeddings; mode-specific chips follow.
 */
export function buildCodeGraphStatusChips(
  mode: CodeGraphMode,
): CodeGraphStatusChipId[] {
  const chips: CodeGraphStatusChipId[] = ["app_keyword"];

  switch (mode) {
    case "cli_old":
      chips.push("cli_old");
      break;
    case "unset_default_on":
      chips.push("cli_graph_default_on");
      break;
    case "keyword_only":
      chips.push("keyword_only");
      break;
    case "graph_enabled_unknown":
      chips.push("cli_graph");
      break;
    case "graph_unavailable":
      chips.push("cli_graph", "graph_unavailable");
      break;
    default:
      break;
  }

  chips.push("no_embeddings");
  return chips;
}

/** i18n label key for a status chip (MessageKey in messages.ts). */
export function codeGraphStatusChipLabelKey(
  chip: CodeGraphStatusChipId,
):
  | "settings.codeGraph.chip.appKeyword"
  | "settings.codeGraph.chip.cliGraph"
  | "settings.codeGraph.chip.cliGraphDefaultOn"
  | "settings.codeGraph.chip.graphUnavailable"
  | "settings.codeGraph.chip.keywordOnly"
  | "settings.codeGraph.chip.cliOld"
  | "settings.codeGraph.chip.noEmbeddings" {
  switch (chip) {
    case "cli_graph":
      return "settings.codeGraph.chip.cliGraph";
    case "cli_graph_default_on":
      return "settings.codeGraph.chip.cliGraphDefaultOn";
    case "graph_unavailable":
      return "settings.codeGraph.chip.graphUnavailable";
    case "keyword_only":
      return "settings.codeGraph.chip.keywordOnly";
    case "cli_old":
      return "settings.codeGraph.chip.cliOld";
    case "no_embeddings":
      return "settings.codeGraph.chip.noEmbeddings";
    case "app_keyword":
    default:
      return "settings.codeGraph.chip.appKeyword";
  }
}

/** Hit source honesty — never `graph` unless host truly provides it. */
export type CodeGraphHitSource = "keyword" | "unknown";

export type AnnotatedCodeGraphHit<T extends object = CodebaseSearchHitLike> =
  T & {
    source: CodeGraphHitSource;
  };

/**
 * Annotate search hits with honest `source`.
 *
 * - Always `keyword` when host has no graph field / no graph search API.
 * - `unknown` only when mode is graph-ish and host did not label the hit
 *   (never invent `graph`).
 * - If a hit already carries `source: 'keyword' | 'unknown'`, keep it when valid.
 * - Never output `source: 'graph'` from this helper.
 */
export function annotateSearchHits<T extends object>(
  hits: T[] | null | undefined,
  mode: CodeGraphMode,
): AnnotatedCodeGraphHit<T>[] {
  const list = hits ?? [];
  // App path: resolveCodebaseSearchKind always keyword; host graph field absent.
  void resolveCodebaseSearchKind(null);

  return list.map((hit) => {
    const existing = (hit as { source?: string | null }).source;
    const existingNorm = (existing ?? "").trim().toLowerCase();
    // Never promote to graph. Accept only honest labels.
    if (existingNorm === "keyword") {
      return { ...hit, source: "keyword" as const };
    }
    if (existingNorm === "unknown") {
      return { ...hit, source: "unknown" as const };
    }
    // Reject invented "graph" / "embedding" / other — force keyword.
    if (
      existingNorm === "graph" ||
      existingNorm === "code_graph" ||
      existingNorm === "embedding" ||
      existingNorm === "semantic"
    ) {
      return { ...hit, source: "keyword" as const };
    }

    // Mode-aware default when host omitted source.
    if (
      mode === "graph_enabled_unknown" ||
      mode === "graph_unavailable" ||
      mode === "unset_default_on"
    ) {
      // Indexing may be on, but App hits are still keyword scans.
      return { ...hit, source: "keyword" as const };
    }
    return { ...hit, source: "keyword" as const };
  });
}

/** Empty-state kinds for unified code-graph product copy. */
export type CodeGraphEmptyKind =
  | "cli_old"
  | "unset_default_on"
  | "keyword_only"
  | "graph_unavailable"
  | "graph_enabled_unknown"
  | "search_keyword_idle"
  | "search_no_matches";

export type CodeGraphEmptyPresentation = {
  kind: CodeGraphEmptyKind;
  titleKey:
    | "settings.codeGraph.empty.cliOld"
    | "settings.codeGraph.empty.unsetDefaultOn"
    | "settings.codeGraph.empty.keywordOnly"
    | "settings.codeGraph.empty.graphUnavailable"
    | "settings.codeGraph.empty.graphEnabledUnknown"
    | "settings.codeGraph.empty.searchKeywordIdle"
    | "settings.codeGraph.empty.searchNoMatches";
  hintKey?:
    | "settings.codeGraph.empty.cliOldHint"
    | "settings.codeGraph.empty.unsetDefaultOnHint"
    | "settings.codeGraph.empty.keywordOnlyHint"
    | "settings.codeGraph.empty.graphUnavailableHint"
    | "settings.codeGraph.empty.graphEnabledUnknownHint"
    | "settings.codeGraph.empty.searchKeywordIdleHint"
    | "settings.codeGraph.empty.searchNoMatchesHint";
};

export type ResolveCodeGraphEmptyStateInput = {
  mode: CodeGraphMode;
  /** When true, prefer search-panel empty (idle / no matches). */
  forSearchPanel?: boolean;
  query?: string | null;
  hitCount?: number;
  searching?: boolean;
};

/**
 * Resolve honesty empty-state for indexing status or search panel.
 * Never claims graph/semantic zero-hits when only keyword search ran.
 */
export function resolveCodeGraphEmptyState(
  input: ResolveCodeGraphEmptyStateInput,
): CodeGraphEmptyPresentation {
  const { mode } = input;

  if (input.forSearchPanel) {
    const q = (input.query ?? "").trim();
    const hits = input.hitCount ?? 0;
    if (!q) {
      return {
        kind: "search_keyword_idle",
        titleKey: "settings.codeGraph.empty.searchKeywordIdle",
        hintKey: "settings.codeGraph.empty.searchKeywordIdleHint",
      };
    }
    if (!input.searching && hits === 0) {
      return {
        kind: "search_no_matches",
        titleKey: "settings.codeGraph.empty.searchNoMatches",
        hintKey: "settings.codeGraph.empty.searchNoMatchesHint",
      };
    }
    // Searching with zero hits yet — still keyword idle honesty, not graph.
    if (input.searching && hits === 0) {
      return {
        kind: "search_keyword_idle",
        titleKey: "settings.codeGraph.empty.searchKeywordIdle",
        hintKey: "settings.codeGraph.empty.searchKeywordIdleHint",
      };
    }
  }

  switch (mode) {
    case "cli_old":
      return {
        kind: "cli_old",
        titleKey: "settings.codeGraph.empty.cliOld",
        hintKey: "settings.codeGraph.empty.cliOldHint",
      };
    case "unset_default_on":
      return {
        kind: "unset_default_on",
        titleKey: "settings.codeGraph.empty.unsetDefaultOn",
        hintKey: "settings.codeGraph.empty.unsetDefaultOnHint",
      };
    case "keyword_only":
      return {
        kind: "keyword_only",
        titleKey: "settings.codeGraph.empty.keywordOnly",
        hintKey: "settings.codeGraph.empty.keywordOnlyHint",
      };
    case "graph_unavailable":
      return {
        kind: "graph_unavailable",
        titleKey: "settings.codeGraph.empty.graphUnavailable",
        hintKey: "settings.codeGraph.empty.graphUnavailableHint",
      };
    case "graph_enabled_unknown":
    default:
      return {
        kind: "graph_enabled_unknown",
        titleKey: "settings.codeGraph.empty.graphEnabledUnknown",
        hintKey: "settings.codeGraph.empty.graphEnabledUnknownHint",
      };
  }
}

/** Soft rebuild plan — only when host rebuild exists. */
export type CodeGraphRebuildPlan =
  | {
      status: "available";
      /** Host command / invoke name when real rebuild lands. */
      hostCommand: string;
      noteKey: "settings.codeGraph.rebuild.availableNote";
    }
  | {
      status: "unavailable";
      /** Honesty: rebuild via CLI if needed; App has no host rebuild. */
      noteKey: "settings.codeGraph.rebuild.unavailableNote";
      cliHintKey: "settings.codeGraph.rebuild.cliHint";
    };

export type PlanCodeGraphRebuildOpts = {
  /**
   * Whether host exposes rebuild. Defaults to
   * {@link HOST_CODE_GRAPH_REBUILD_AVAILABLE} (false today).
   */
  hostRebuildAvailable?: boolean;
  /** Optional host command id when available. */
  hostCommand?: string | null;
  mode?: CodeGraphMode;
};

/**
 * Plan a code-graph rebuild.
 *
 * Soft-only: when no host rebuild API exists, return `unavailable` with
 * CLI-only honesty — never invent an App rebuild button path.
 */
export function planCodeGraphRebuild(
  opts: PlanCodeGraphRebuildOpts = {},
): CodeGraphRebuildPlan {
  const host =
    opts.hostRebuildAvailable === true ||
    (opts.hostRebuildAvailable === undefined &&
      HOST_CODE_GRAPH_REBUILD_AVAILABLE);
  const cmd = (opts.hostCommand ?? "").trim();

  if (host && cmd) {
    return {
      status: "available",
      hostCommand: cmd,
      noteKey: "settings.codeGraph.rebuild.availableNote",
    };
  }

  void opts.mode;
  return {
    status: "unavailable",
    noteKey: "settings.codeGraph.rebuild.unavailableNote",
    cliHintKey: "settings.codeGraph.rebuild.cliHint",
  };
}

/** i18n status line key for a resolved mode (indexing panel). */
export function codeGraphModeStatusKey(
  mode: CodeGraphMode,
):
  | "settings.codeGraph.mode.keywordOnly"
  | "settings.codeGraph.mode.graphEnabledUnknown"
  | "settings.codeGraph.mode.graphUnavailable"
  | "settings.codeGraph.mode.cliOld"
  | "settings.codeGraph.mode.unsetDefaultOn" {
  switch (mode) {
    case "keyword_only":
      return "settings.codeGraph.mode.keywordOnly";
    case "graph_unavailable":
      return "settings.codeGraph.mode.graphUnavailable";
    case "cli_old":
      return "settings.codeGraph.mode.cliOld";
    case "unset_default_on":
      return "settings.codeGraph.mode.unsetDefaultOn";
    case "graph_enabled_unknown":
    default:
      return "settings.codeGraph.mode.graphEnabledUnknown";
  }
}

/** Soft note under indexing panel: App search remains keyword. */
export function codeGraphAppSearchRemainsKeywordKey(): "settings.codeGraph.appSearchRemainsKeyword" {
  return "settings.codeGraph.appSearchRemainsKeyword";
}

/** Deep-link target for indexing settings from search panel. */
export const CODE_GRAPH_INDEXING_ANCHOR = "settings-anchor-codebaseIndexing";

/** Deep-link target for search settings from indexing panel. */
export const CODE_GRAPH_SEARCH_ANCHOR = "settings-anchor-codebaseSearch";

/** Re-export CLI defaults for UI chips that mention min version. */
export { CODEBASE_INDEXING_CLI_DEFAULT, CODEBASE_INDEXING_MIN_CLI };

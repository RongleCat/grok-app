/**
 * Memory operations center — pure mode / clear / summary honesty helpers.
 *
 * Unifies App browser keyword search, CLI hybrid availability, and clear-scope
 * planning. Never invents embeddings or a running dream/watcher process —
 * presence chips only reflect config keys when known (set_on / set_off / unset).
 *
 * Host clear: `grok memory clear` via `memoryClear` (workspace | global | all).
 * Product UI scopes match those three. Session-scoped clear stays soft-unavailable
 * (no host CLI path). Soft-fails never invent CLI args or open confirm.
 */

import { memoryClearArgs, type MemoryClearScope } from "./agentMemory";
import {
  CLI_MEMORY_HYBRID_SEARCH_AVAILABLE,
  resolveMemorySearchKind,
} from "./memoryHybridSearch";
import { memoryEmbedKeyPresence, type MemoryEmbedTri } from "./memoryEmbedConfig";
import { redact } from "./redact";

/** Honesty chips for the ops-center strip. */
export type MemoryOpsModeChip =
  | "app_keyword"
  | "cli_hybrid"
  | "hybrid_unavailable"
  | "memory_off";

export type ResolveMemoryOpsModeInput = {
  /** Cross-session / experimental memory setting. */
  memoryEnabled: boolean;
  /**
   * Whether `[memory.embedding].model` is set.
   * null / undefined = unknown (probe pending) → do not claim hybrid.
   */
  embedModelSet?: boolean | null;
  /**
   * Host hybrid browser path unavailable.
   * Defaults from {@link CLI_MEMORY_HYBRID_SEARCH_AVAILABLE} when embed is set.
   */
  hybridUnavailable?: boolean;
  /**
   * App browser is keyword-only (product default true).
   * Set false only if a real host hybrid browser path exists.
   */
  browserKeyword?: boolean;
};

/**
 * Resolve ordered mode chips for the Memory ops center strip.
 *
 * - memory off → `memory_off` only
 * - on → always `app_keyword` when browser is keyword path
 * - embed set → `cli_hybrid` + optional `hybrid_unavailable` (never invent vectors)
 */
export function resolveMemoryOpsMode(
  input: ResolveMemoryOpsModeInput,
): MemoryOpsModeChip[] {
  if (!input.memoryEnabled) {
    return ["memory_off"];
  }

  const chips: MemoryOpsModeChip[] = [];
  const browserKeyword = input.browserKeyword !== false;
  if (browserKeyword) {
    chips.push("app_keyword");
  }

  if (input.embedModelSet === true) {
    chips.push("cli_hybrid");
    const hybridUnavail =
      input.hybridUnavailable === true ||
      (input.hybridUnavailable === undefined &&
        !CLI_MEMORY_HYBRID_SEARCH_AVAILABLE);
    // Surface hybrid_unavailable so we never claim browser hybrid while the
    // agent tool may still hybrid mid-session.
    if (hybridUnavail) {
      chips.push("hybrid_unavailable");
    }
  }

  return chips.length > 0 ? chips : ["app_keyword"];
}

/** i18n label key for a mode chip. */
export function memoryOpsModeChipLabelKey(
  chip: MemoryOpsModeChip,
):
  | "settings.memoryOps.mode.appKeyword"
  | "settings.memoryOps.mode.cliHybrid"
  | "settings.memoryOps.mode.hybridUnavailable"
  | "settings.memoryOps.mode.memoryOff" {
  switch (chip) {
    case "cli_hybrid":
      return "settings.memoryOps.mode.cliHybrid";
    case "hybrid_unavailable":
      return "settings.memoryOps.mode.hybridUnavailable";
    case "memory_off":
      return "settings.memoryOps.mode.memoryOff";
    case "app_keyword":
    default:
      return "settings.memoryOps.mode.appKeyword";
  }
}

export type MemoryOpsEmptyKind =
  | "memory_off"
  | "no_project"
  | "empty_catalog"
  | "hybrid_unavailable";

export type MemoryOpsEmptyState = {
  kind: MemoryOpsEmptyKind;
  titleKey:
    | "settings.memoryOps.empty.memoryOff"
    | "settings.memoryOps.empty.noProject"
    | "settings.memoryOps.empty.catalog"
    | "settings.memoryOps.empty.hybridUnavailable";
  hintKey?:
    | "settings.memoryOps.empty.memoryOffHint"
    | "settings.memoryOps.empty.noProjectHint"
    | "settings.memoryOps.empty.catalogHint"
    | "settings.memoryOps.hybridUnavailableHint";
  showEmbedLink: boolean;
  showClearActions: boolean;
};

export type ResolveMemoryOpsEmptyStateInput = {
  memoryEnabled: boolean;
  hasProject?: boolean;
  /** Host list size when known; omit when not probed. */
  entryCount?: number | null;
  embedModelSet?: boolean | null;
  hybridUnavailable?: boolean;
};

/**
 * High-level empty / honesty presentation for the ops center chrome.
 * Returns null when the center should show normal browser content.
 */
export function resolveMemoryOpsEmptyState(
  input: ResolveMemoryOpsEmptyStateInput,
): MemoryOpsEmptyState | null {
  if (!input.memoryEnabled) {
    return {
      kind: "memory_off",
      titleKey: "settings.memoryOps.empty.memoryOff",
      hintKey: "settings.memoryOps.empty.memoryOffHint",
      showEmbedLink: false,
      showClearActions: false,
    };
  }

  if (input.hasProject === false) {
    return {
      kind: "no_project",
      titleKey: "settings.memoryOps.empty.noProject",
      hintKey: "settings.memoryOps.empty.noProjectHint",
      showEmbedLink: false,
      showClearActions: false,
    };
  }

  if (input.entryCount === 0) {
    const hybridUnavail =
      input.embedModelSet === true &&
      (input.hybridUnavailable === true ||
        (input.hybridUnavailable === undefined &&
          !CLI_MEMORY_HYBRID_SEARCH_AVAILABLE));
    if (hybridUnavail) {
      return {
        kind: "hybrid_unavailable",
        titleKey: "settings.memoryOps.empty.hybridUnavailable",
        hintKey: "settings.memoryOps.hybridUnavailableHint",
        showEmbedLink: true,
        showClearActions: false,
      };
    }
    return {
      kind: "empty_catalog",
      titleKey: "settings.memoryOps.empty.catalog",
      hintKey: "settings.memoryOps.empty.catalogHint",
      showEmbedLink: input.embedModelSet === false,
      showClearActions: false,
    };
  }

  // With files present, UI uses mode chips + hybrid hint — not a blocking empty.
  return null;
}

/**
 * Product clear scopes for the ops center (plan-only).
 * Host-wired product surface: workspace | global | all.
 * `session` remains soft-unavailable (no host session-only clear).
 */
export type MemoryOpsClearScope = "workspace" | "global" | "all" | "session";

/** Host-supported clear scopes (CLI `grok memory clear`). */
export type MemoryOpsHostClearScope = MemoryClearScope;

/** Host scopes wired today (matches `memoryClear` / agent_memory). */
export const MEMORY_OPS_HOST_CLEAR_SCOPES: readonly MemoryOpsHostClearScope[] =
  ["workspace", "global", "all"] as const;

/** Product UI clear buttons (GlassModal → host). Session is not listed. */
export const MEMORY_OPS_PRODUCT_CLEAR_SCOPES: readonly Exclude<
  MemoryOpsClearScope,
  "session"
>[] = ["workspace", "global", "all"] as const;

export type ClearMemoryScopeUnavailableReason =
  | "session_not_supported"
  | "memory_off"
  | "no_cwd"
  | "host_missing";

export type ClearMemoryScopePlan = {
  scope: MemoryOpsClearScope;
  /** Host scope to pass to `memoryClear`, or null when unavailable. */
  hostScope: MemoryOpsHostClearScope | null;
  available: boolean;
  confirmNeeded: boolean;
  unavailableReason: ClearMemoryScopeUnavailableReason | null;
  /** CLI args preview (no binary path); empty when unavailable. */
  cliArgs: string[];
  logMeta: {
    scope: MemoryOpsClearScope;
    available: boolean;
    hostScope: MemoryOpsHostClearScope | null;
    reason: ClearMemoryScopeUnavailableReason | null;
  };
};

export type PlanClearMemoryScopeOpts = {
  memoryEnabled?: boolean;
  hasCwd?: boolean;
  /**
   * Host scopes actually implemented. Defaults to
   * {@link MEMORY_OPS_HOST_CLEAR_SCOPES}.
   */
  hostScopes?: readonly MemoryOpsHostClearScope[];
};

function hostSupports(
  hostScope: MemoryOpsHostClearScope,
  hostScopes: readonly MemoryOpsHostClearScope[],
): boolean {
  return hostScopes.includes(hostScope);
}

/**
 * Plan a clear action for a product scope. Does not run the host.
 *
 * - workspace → host `--workspace` when cwd present
 * - global → host `--global` (no cwd required)
 * - all → host `--all`
 * - session → soft-unavailable (no host session-only clear)
 *
 * Soft-fails (available=false, no confirm) when memory is off, cwd missing,
 * session-only, or host scope is not wired — never invents CLI args.
 */
export function planClearMemoryScope(
  scope: MemoryOpsClearScope,
  opts: PlanClearMemoryScopeOpts = {},
): ClearMemoryScopePlan {
  const hostScopes = opts.hostScopes ?? MEMORY_OPS_HOST_CLEAR_SCOPES;
  const memoryEnabled = opts.memoryEnabled !== false;
  const hasCwd = opts.hasCwd !== false;

  const base = (
    partial: Omit<
      ClearMemoryScopePlan,
      "scope" | "logMeta"
    > & { scope?: MemoryOpsClearScope },
  ): ClearMemoryScopePlan => {
    const s = partial.scope ?? scope;
    return {
      scope: s,
      hostScope: partial.hostScope,
      available: partial.available,
      confirmNeeded: partial.confirmNeeded,
      unavailableReason: partial.unavailableReason,
      cliArgs: partial.cliArgs,
      logMeta: {
        scope: s,
        available: partial.available,
        hostScope: partial.hostScope,
        reason: partial.unavailableReason,
      },
    };
  };

  if (!memoryEnabled) {
    return base({
      hostScope: null,
      available: false,
      confirmNeeded: false,
      unavailableReason: "memory_off",
      cliArgs: [],
    });
  }

  if (scope === "session") {
    return base({
      hostScope: null,
      available: false,
      confirmNeeded: false,
      unavailableReason: "session_not_supported",
      cliArgs: [],
    });
  }

  if (scope === "workspace") {
    if (!hasCwd) {
      return base({
        hostScope: null,
        available: false,
        confirmNeeded: false,
        unavailableReason: "no_cwd",
        cliArgs: [],
      });
    }
    if (!hostSupports("workspace", hostScopes)) {
      return base({
        hostScope: null,
        available: false,
        confirmNeeded: false,
        unavailableReason: "host_missing",
        cliArgs: [],
      });
    }
    return base({
      hostScope: "workspace",
      available: true,
      confirmNeeded: true,
      unavailableReason: null,
      cliArgs: memoryClearArgs("workspace"),
    });
  }

  if (scope === "global") {
    if (!hostSupports("global", hostScopes)) {
      return base({
        hostScope: null,
        available: false,
        confirmNeeded: false,
        unavailableReason: "host_missing",
        cliArgs: [],
      });
    }
    return base({
      hostScope: "global",
      available: true,
      confirmNeeded: true,
      unavailableReason: null,
      cliArgs: memoryClearArgs("global"),
    });
  }

  // all
  if (!hostSupports("all", hostScopes)) {
    return base({
      hostScope: null,
      available: false,
      confirmNeeded: false,
      unavailableReason: "host_missing",
      cliArgs: [],
    });
  }
  return base({
    hostScope: "all",
    available: true,
    confirmNeeded: true,
    unavailableReason: null,
    cliArgs: memoryClearArgs("all"),
  });
}

/** i18n key for clear-scope unavailable reason. */
export function clearMemoryScopeUnavailableKey(
  reason: ClearMemoryScopeUnavailableReason,
):
  | "settings.memoryOps.clear.unavailable.session"
  | "settings.memoryOps.clear.unavailable.memoryOff"
  | "settings.memoryOps.clear.unavailable.noCwd"
  | "settings.memoryOps.clear.unavailable.host" {
  switch (reason) {
    case "session_not_supported":
      return "settings.memoryOps.clear.unavailable.session";
    case "memory_off":
      return "settings.memoryOps.clear.unavailable.memoryOff";
    case "no_cwd":
      return "settings.memoryOps.clear.unavailable.noCwd";
    case "host_missing":
    default:
      return "settings.memoryOps.clear.unavailable.host";
  }
}

/** Config presence only — never invents a running process status. */
export type MemoryOpsPresenceId = "dream" | "watcher";

export type MemoryOpsPresenceChip = {
  id: MemoryOpsPresenceId;
  presence: "set_on" | "set_off" | "unset";
};

/**
 * Dream / watcher presence chips from embed config keys only.
 * Missing keys → unset. Does not claim “running” / “idle”.
 */
export function resolveMemoryOpsPresenceChips(input: {
  dreamEnabled?: boolean | null;
  watcherEnabled?: boolean | null;
}): MemoryOpsPresenceChip[] {
  return [
    {
      id: "dream",
      presence: memoryEmbedKeyPresence(
        (input.dreamEnabled ?? null) as MemoryEmbedTri,
      ),
    },
    {
      id: "watcher",
      presence: memoryEmbedKeyPresence(
        (input.watcherEnabled ?? null) as MemoryEmbedTri,
      ),
    },
  ];
}

export type MemoryOpsSummary = {
  memoryEnabled: boolean;
  embedConfigured: boolean;
  /** Presence only — model id redacted if it looks sensitive. */
  embedModel: string | null;
  dreamPresence: "set_on" | "set_off" | "unset";
  watcherPresence: "set_on" | "set_off" | "unset";
  modeChips: MemoryOpsModeChip[];
  searchKind: "keyword" | "hybrid_unavailable" | "hybrid";
  entryCount: number | null;
  /** Redacted free-text lines for diagnostics (no secrets). */
  lines: string[];
};

export type BuildMemoryOpsSummaryInput = {
  memoryEnabled: boolean;
  embedModel?: string | null;
  dreamEnabled?: boolean | null;
  watcherEnabled?: boolean | null;
  entryCount?: number | null;
  memoryRoot?: string | null;
  cwd?: string | null;
  hybridUnavailable?: boolean;
  browserKeyword?: boolean;
  cliHybridAvailable?: boolean;
};

/**
 * Build a redacted ops-center summary for UI status / soft diagnostics.
 * Never invents embeddings or running dream/watcher status.
 */
export function buildMemoryOpsSummary(
  input: BuildMemoryOpsSummaryInput,
): MemoryOpsSummary {
  const embedRaw = (input.embedModel ?? "").trim();
  const embedConfigured = !!embedRaw;
  const embedModel = embedRaw ? redact(embedRaw) : null;

  const hybridUnavailable =
    input.hybridUnavailable ??
    (embedConfigured &&
      !(input.cliHybridAvailable === true || CLI_MEMORY_HYBRID_SEARCH_AVAILABLE));

  const modeChips = resolveMemoryOpsMode({
    memoryEnabled: input.memoryEnabled,
    embedModelSet: input.memoryEnabled ? embedConfigured : false,
    hybridUnavailable: hybridUnavailable || undefined,
    browserKeyword: input.browserKeyword,
  });

  const searchKind = input.memoryEnabled
    ? resolveMemorySearchKind({
        embeddingConfigured: embedConfigured,
        cliHybridAvailable: input.cliHybridAvailable,
      })
    : "keyword";

  const dreamPresence = memoryEmbedKeyPresence(
    (input.dreamEnabled ?? null) as MemoryEmbedTri,
  );
  const watcherPresence = memoryEmbedKeyPresence(
    (input.watcherEnabled ?? null) as MemoryEmbedTri,
  );

  const entryCount =
    input.entryCount == null || !Number.isFinite(input.entryCount)
      ? null
      : Math.max(0, Math.floor(Number(input.entryCount)));

  const lines: string[] = [];
  lines.push(`memoryEnabled=${input.memoryEnabled ? "1" : "0"}`);
  lines.push(`embedConfigured=${embedConfigured ? "1" : "0"}`);
  if (embedModel) lines.push(`embedModel=${embedModel}`);
  lines.push(`dream=${dreamPresence}`);
  lines.push(`watcher=${watcherPresence}`);
  lines.push(`searchKind=${searchKind}`);
  lines.push(`mode=${modeChips.join(",")}`);
  if (entryCount != null) lines.push(`entryCount=${entryCount}`);
  if (input.memoryRoot?.trim()) {
    lines.push(`memoryRoot=${redact(input.memoryRoot.trim())}`);
  }
  if (input.cwd?.trim()) {
    lines.push(`cwd=${redact(input.cwd.trim())}`);
  }

  return {
    memoryEnabled: !!input.memoryEnabled,
    embedConfigured,
    embedModel,
    dreamPresence,
    watcherPresence,
    modeChips,
    searchKind,
    entryCount,
    lines,
  };
}

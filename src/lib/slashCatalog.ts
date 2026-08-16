/**
 * Slash palette catalog: built-in commands + invocable skills.
 * UI titles/descriptions use i18n keys (`titleKey` / `descriptionKey`)
 * or display strings for dynamic skills.
 */

export type SlashKind = "mode" | "skill" | "action" | "prompt";

export type SlashItem = {
  id: string;
  kind: SlashKind;
  name: string;
  titleKey?: string;
  descriptionKey?: string;
  displayTitle?: string;
  displayDescription?: string;
  source?: string;
  action?: string;
  mode?: "goal" | "plan";
};

export type SkillInfo = {
  name: string;
  description: string;
  source?: string;
  /** Explicit false = agent-only / not slash-invocable. Missing ⇒ invocable. */
  userInvocable?: boolean;
  /** App Extensions toggle. Explicit false hides from picker. Missing ⇒ on. */
  enabled?: boolean;
};

/**
 * Skills shown in composer `+` / `/` pickers.
 * Keeps only enabled + user-invocable skills with a non-empty name.
 * Name collision (case-insensitive): project source wins over global/user.
 */
export function filterPickerSkills(skills: SkillInfo[]): SkillInfo[] {
  const byKey = new Map<string, SkillInfo>();
  for (const s of skills) {
    if (s.enabled === false) continue;
    if (s.userInvocable === false) continue;
    const name = (s.name ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const next: SkillInfo = {
      name,
      description: (s.description ?? "").trim(),
      source: s.source,
      userInvocable: true,
      enabled: true,
    };
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, next);
      continue;
    }
    // Prefer project when both present (host also merges this way).
    const prevProject = isProjectSource(prev.source);
    const nextProject = isProjectSource(next.source);
    if (nextProject && !prevProject) {
      byKey.set(key, next);
    }
  }
  return Array.from(byKey.values());
}

function isProjectSource(source: string | null | undefined): boolean {
  const s = (source ?? "").trim().toLowerCase();
  return s === "project" || s === "workspace" || s === "local";
}

/** Built-in slash commands (modes, prompts, host actions). */
export function builtinSlashItems(): SlashItem[] {
  return [
    {
      id: "goal",
      kind: "mode",
      name: "goal",
      titleKey: "slash.goal",
      descriptionKey: "slash.goalDesc",
      mode: "goal",
    },
    {
      id: "goal-clear",
      kind: "action",
      name: "goal-clear",
      titleKey: "slash.goalClear",
      descriptionKey: "slash.goalClearDesc",
      action: "goal-clear",
    },
    {
      id: "plan",
      kind: "mode",
      name: "plan",
      titleKey: "slash.plan",
      descriptionKey: "slash.planDesc",
      mode: "plan",
    },
    {
      id: "compact",
      kind: "action",
      name: "compact",
      titleKey: "slash.compact",
      descriptionKey: "slash.compactDesc",
      action: "compact",
    },
    {
      id: "status",
      kind: "action",
      name: "status",
      titleKey: "slash.status",
      descriptionKey: "slash.statusDesc",
      action: "status",
    },
    {
      id: "usage",
      kind: "action",
      name: "usage",
      titleKey: "slash.usage",
      descriptionKey: "slash.usageDesc",
      action: "usage",
    },
    {
      id: "cost",
      kind: "action",
      name: "cost",
      titleKey: "slash.cost",
      descriptionKey: "slash.costDesc",
      action: "usage",
    },
    {
      id: "mcp",
      kind: "action",
      name: "mcp",
      titleKey: "slash.mcp",
      descriptionKey: "slash.mcpDesc",
      action: "mcp",
    },
    {
      id: "doctor",
      kind: "action",
      name: "doctor",
      titleKey: "slash.doctor",
      descriptionKey: "slash.doctorDesc",
      action: "doctor",
    },
    {
      id: "tutorial",
      kind: "action",
      name: "tutorial",
      titleKey: "slash.tutorial",
      descriptionKey: "slash.tutorialDesc",
      action: "tutorial",
    },
    {
      id: "newChat",
      kind: "action",
      name: "new",
      titleKey: "slash.newChat",
      descriptionKey: "slash.newChatDesc",
      action: "newChat",
    },
    {
      id: "automations",
      kind: "action",
      name: "automations",
      titleKey: "slash.automations",
      descriptionKey: "slash.automationsDesc",
      action: "automations",
    },
    {
      id: "workflow",
      kind: "action",
      name: "workflow",
      titleKey: "slash.workflow",
      descriptionKey: "slash.workflowDesc",
      action: "workflow",
    },
    {
      id: "workflows",
      kind: "action",
      name: "workflows",
      titleKey: "slash.workflows",
      descriptionKey: "slash.workflowsDesc",
      action: "workflows",
    },
    {
      id: "live-voice",
      kind: "action",
      name: "live-voice",
      titleKey: "voice.startLive",
      descriptionKey: "voice.startLiveDesc",
      action: "live-voice",
    },
    {
      id: "settings",
      kind: "action",
      name: "settings",
      titleKey: "slash.settings",
      descriptionKey: "slash.settingsDesc",
      action: "settings",
    },
    {
      id: "export",
      kind: "action",
      name: "export",
      titleKey: "slash.export",
      descriptionKey: "slash.exportDesc",
      action: "export",
    },
    {
      id: "copy",
      kind: "action",
      name: "copy",
      titleKey: "slash.copy",
      descriptionKey: "slash.copyDesc",
      action: "copy",
    },
    {
      id: "find",
      kind: "action",
      name: "find",
      titleKey: "slash.find",
      descriptionKey: "slash.findDesc",
      action: "find",
    },
    {
      id: "history",
      kind: "action",
      name: "history",
      titleKey: "slash.history",
      descriptionKey: "slash.historyDesc",
      action: "history",
    },
    {
      id: "extensions",
      kind: "action",
      name: "extensions",
      titleKey: "slash.extensions",
      descriptionKey: "slash.extensionsDesc",
      action: "extensions",
    },
    {
      id: "yolo",
      kind: "action",
      name: "yolo",
      titleKey: "slash.yolo",
      descriptionKey: "slash.yoloDesc",
      action: "yolo",
    },
  ];
}

/** Map skill metadata to slash items (enabled + invocable only). */
export function skillsToSlashItems(skills: SkillInfo[]): SlashItem[] {
  // Dedupe by name — duplicate ids (`skill:foo`) break React keys and leave
  // ghost rows that ignore filter updates (always visible, not keyboard-navable).
  return filterPickerSkills(skills).map((s) => ({
    id: `skill:${s.name}`,
    kind: "skill" as const,
    name: s.name,
    displayTitle: s.name,
    displayDescription: s.description,
    source: s.source,
  }));
}

/** Optional resolved UI strings (i18n titles / descriptions) for search. */
export type SlashSearchText = {
  title?: string;
  description?: string;
};

/** Kind chip filter (includes `all`). */
export type SlashKindFilter = "all" | SlashKind;

/** Ordered kind chips for the slash / + palette. */
export const SLASH_KIND_FILTERS: readonly SlashKindFilter[] = [
  "all",
  "mode",
  "action",
  "prompt",
  "skill",
] as const;

/** Per-kind counts plus total under `all`. */
export type SlashKindCounts = Record<SlashKindFilter, number>;

/** Combined free-text + kind-chip filter. */
export type SlashItemFilter = {
  query?: string;
  kind?: SlashKindFilter;
};

/** Count items per slash kind (and total under `all`). */
export function countSlashByKind(
  items: readonly SlashItem[],
): SlashKindCounts {
  const counts: SlashKindCounts = {
    all: items.length,
    mode: 0,
    skill: 0,
    action: 0,
    prompt: 0,
  };
  for (const item of items) {
    const k = item.kind;
    if (k === "mode" || k === "skill" || k === "action" || k === "prompt") {
      counts[k] += 1;
    }
  }
  return counts;
}

/** True when query and/or a non-all kind chip is active. */
export function hasActiveSlashFilters(filter: SlashItemFilter = {}): boolean {
  const q = (filter.query ?? "").trim();
  const kind = filter.kind ?? "all";
  return Boolean(q) || kind !== "all";
}

/** i18n key for a kind chip / badge label. */
export function slashKindLabelKey(kind: SlashKindFilter): string {
  switch (kind) {
    case "all":
      return "slash.kind.all";
    case "mode":
      return "slash.kind.mode";
    case "action":
      return "slash.kind.action";
    case "prompt":
      return "slash.kind.prompt";
    case "skill":
      return "slash.kind.skill";
    default:
      return "slash.kind.all";
  }
}

/**
 * Filter items by kind chip only.
 * `all` (default) returns the same array reference when possible.
 */
export function filterSlashItemsByKind(
  items: readonly SlashItem[],
  kind: SlashKindFilter = "all",
): SlashItem[] {
  if (kind === "all") return items as SlashItem[];
  return items.filter((item) => item.kind === kind);
}

/**
 * Filter items by query (case-insensitive substring) and optional kind chip.
 *
 * Prefer name/title hits; descriptions only when query is longer (4+ chars
 * for ASCII, 2+ for CJK) so short tokens don't light up half the catalog.
 * Empty query returns kind-filtered items (or all when kind is `all`).
 *
 * Second arg accepts a plain query string (backward compatible) or
 * `{ query, kind }`.
 */
export function filterSlashItems(
  items: SlashItem[],
  queryOrFilter: string | SlashItemFilter = "",
  resolveSearchText?: (item: SlashItem) => SlashSearchText | null | undefined,
): SlashItem[] {
  const opts: SlashItemFilter =
    typeof queryOrFilter === "string"
      ? { query: queryOrFilter }
      : (queryOrFilter ?? {});
  const kind = opts.kind ?? "all";
  const byKind = filterSlashItemsByKind(items, kind);
  const q = (opts.query ?? "").trim().toLowerCase();
  if (!q) return byKind;
  return byKind.filter((item) => {
    const resolved = resolveSearchText?.(item);
    // Name / title only for short queries (strict).
    const nameFields = [
      item.name,
      item.displayTitle,
      // strip "skill:" prefix from id for matching
      item.id?.replace(/^skill:/, ""),
      resolved?.title,
    ];
    if (nameFields.some((f) => f && f.toLowerCase().includes(q))) return true;
    // Description: ASCII needs 4+ chars (avoid "the"/"and" style noise);
    // CJK tokens are already dense at 2 characters.
    const asciiOnly = /^[\x00-\x7f]+$/.test(q);
    if (q.length < (asciiOnly ? 4 : 2)) return false;
    const descFields = [item.displayDescription, resolved?.description];
    return descFields.some((f) => f && f.toLowerCase().includes(q));
  });
}

/** Full catalog split into built-in commands and skill items. */
export function buildSlashCatalog(skills: SkillInfo[]): {
  commands: SlashItem[];
  skills: SlashItem[];
} {
  return {
    commands: builtinSlashItems(),
    skills: skillsToSlashItems(skills),
  };
}

/** Flat list for keyboard nav: filtered commands then skills. */
export function flattenFilteredCatalog(
  catalog: { commands: SlashItem[]; skills: SlashItem[] },
  queryOrFilter: string | SlashItemFilter = "",
  resolveSearchText?: (item: SlashItem) => SlashSearchText | null | undefined,
): { commands: SlashItem[]; skills: SlashItem[]; flat: SlashItem[] } {
  const commands = filterSlashItems(
    catalog.commands,
    queryOrFilter,
    resolveSearchText,
  );
  const skills = filterSlashItems(
    catalog.skills,
    queryOrFilter,
    resolveSearchText,
  );
  return { commands, skills, flat: [...commands, ...skills] };
}

// ── Empty honesty ────────────────────────────────────────────────────────────

/**
 * Contextual empty surfaces for the slash / + palette list.
 * `null` from the resolver means there are visible rows — no empty UI.
 */
export type SlashMenuEmptyKind =
  | "loading"
  | "empty_catalog"
  | "no_matches"
  | "filtered"
  | "no_query";

export type SlashMenuEmptyPresentation = {
  kind: SlashMenuEmptyKind;
  /** Primary title i18n key under slash.*. */
  titleKey: string;
  /** Optional hint i18n key. */
  hintKey: string | null;
  /** Offer clear-filters CTA (query and/or kind chip). */
  showClearFilters: boolean;
};

export type SlashMenuEmptyInput = {
  loading?: boolean;
  /** Pre-filter catalog size (commands + skills, before query/kind). */
  catalogCount: number;
  /** Visible slash items after filter (not including upload / json-schema). */
  filteredCount: number;
  query?: string;
  kind?: SlashKindFilter;
};

/**
 * Resolve empty-state presentation for the slash palette list.
 * Returns `null` when filtered rows exist (list should render).
 *
 * Priority: loading (empty only) → empty catalog → kind-filtered empty →
 * query no-match → defensive no-query empty.
 *
 * Honest: never invents catalog rows; no-match vs empty-catalog vs kind-filter
 * are distinct so the UI can show the right copy + clear-filters CTA.
 */
export function resolveSlashMenuEmptyState(
  input: SlashMenuEmptyInput,
): SlashMenuEmptyPresentation | null {
  const catalogCount = Math.max(0, Number(input.catalogCount) || 0);
  const filteredCount = Math.max(0, Number(input.filteredCount) || 0);
  const loading = Boolean(input.loading);
  const q = (input.query ?? "").trim();
  const kind = input.kind ?? "all";
  const filtersActive = hasActiveSlashFilters({ query: q, kind });

  if (filteredCount > 0) return null;

  if (loading && catalogCount === 0) {
    return {
      kind: "loading",
      titleKey: "slash.loading",
      hintKey: null,
      showClearFilters: false,
    };
  }

  if (catalogCount === 0) {
    return {
      kind: "empty_catalog",
      titleKey: "slash.emptyCatalog",
      hintKey: "slash.emptyCatalogHint",
      showClearFilters: false,
    };
  }

  // Kind chip (alone or with query) → filtered empty.
  if (kind !== "all") {
    return {
      kind: "filtered",
      titleKey: "slash.filteredEmpty",
      hintKey: q
        ? "slash.filteredEmptyHintQuery"
        : "slash.filteredEmptyHint",
      showClearFilters: true,
    };
  }

  if (q) {
    return {
      kind: "no_matches",
      titleKey: "slash.noMatches",
      hintKey: "slash.noMatchesHint",
      showClearFilters: filtersActive,
    };
  }

  // Catalog has items but none visible without query/kind (should not happen).
  // Surface as no-query empty so UI stays honest rather than blank.
  return {
    kind: "no_query",
    titleKey: "slash.noQueryEmpty",
    hintKey: "slash.noQueryEmptyHint",
    showClearFilters: false,
  };
}

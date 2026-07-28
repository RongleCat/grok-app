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
 */
export function filterPickerSkills(skills: SkillInfo[]): SkillInfo[] {
  const seen = new Set<string>();
  const out: SkillInfo[] = [];
  for (const s of skills) {
    if (s.enabled === false) continue;
    if (s.userInvocable === false) continue;
    const name = (s.name ?? "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      description: (s.description ?? "").trim(),
      source: s.source,
      userInvocable: true,
      enabled: true,
    });
  }
  return out;
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

/**
 * Filter items by query (case-insensitive substring).
 * Prefer name/title hits; descriptions only when query is longer (4+ chars)
 * so short tokens don't light up half the catalog via English blurbs.
 * Empty query returns all items.
 */
export function filterSlashItems(
  items: SlashItem[],
  query: string,
  resolveSearchText?: (item: SlashItem) => SlashSearchText | null | undefined,
): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
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
  query: string,
  resolveSearchText?: (item: SlashItem) => SlashSearchText | null | undefined,
): { commands: SlashItem[]; skills: SlashItem[]; flat: SlashItem[] } {
  const commands = filterSlashItems(catalog.commands, query, resolveSearchText);
  const skills = filterSlashItems(catalog.skills, query, resolveSearchText);
  return { commands, skills, flat: [...commands, ...skills] };
}

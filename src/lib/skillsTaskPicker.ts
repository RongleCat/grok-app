/**
 * Pure helpers for the composer task-level skills picker.
 *
 * Catalog rows come only from host `skills_list` (via App state) — never invent
 * skill names. Ranking: prompt match (when draft/prompt provided) → recency →
 * alpha. Storage / chips use stable tokens `[[skill:name]]` (see draftDoc).
 */

import { SKILL_NAME_RE } from "@/lib/draftDoc";
import {
  rankSkillsForPrompt,
  type SkillMatchHit,
} from "@/lib/skillPromptMatch";

/** Catalog row for the task picker (host skills only). */
export type SkillsPickerSkill = {
  name: string;
  description?: string;
  source?: string;
  /** Explicit false = agent-only / not slash-invocable. Missing ⇒ invocable. */
  userInvocable?: boolean;
  /** App Extensions toggle. Explicit false hides from picker. Missing ⇒ on. */
  enabled?: boolean;
  /** Prompt-match score (only when ranked against draft/prompt). */
  matchScore?: number;
  /** Tokens from the prompt that hit this skill. */
  matchedTokens?: string[];
};

/**
 * Strip skill chips / slash skill refs so ranking uses natural-language text.
 */
export function stripSkillTokensForMatch(text: string): string {
  return (text ?? "")
    .replace(/\[\[skill:[^\]]+\]\]/gi, " ")
    .replace(/(^|\s)\/[a-zA-Z0-9_.:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** localStorage key for the recent skill-id ring. */
export const SKILLS_RECENT_STORAGE_KEY = "grok.skillsTaskPicker.recent";
/** Max recent skill ids kept (newest first). */
export const SKILLS_RECENT_MAX = 12;

/** Fired on `window` after recent skill ids change (detail = string[]). */
export const SKILLS_RECENT_CHANGE_EVENT = "grok-skills-task-picker-recent-change";

/** Contextual empty surfaces for the skills task picker. */
export type SkillsPickerEmptyKind = "empty" | "filter" | "host_only";

export type SkillsPickerEmptyPresentation = {
  kind: SkillsPickerEmptyKind;
  /** Primary title i18n key. */
  titleKey: string;
  /** Optional hint i18n key. */
  hintKey: string | null;
  /** Offer clear-filter CTA (query active). */
  showClearFilter: boolean;
};

/** Minimal storage surface so unit tests need no jsdom. */
export interface SkillsRecentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): SkillsRecentStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

const FULL_SKILL_NAME_RE = new RegExp(`^${SKILL_NAME_RE.source}$`);

/**
 * Normalize a skill name / ref for tokens and recent ids.
 * Trims, strips a leading `/` or `[[skill:`…`]]` wrapper, validates charset
 * (letters, digits, `_` `.` `:` `-`). Returns null when empty/invalid.
 * Does not invent names — invalid input is rejected.
 */
export function normalizeSkillRef(
  name: string | null | undefined,
): string | null {
  let s = (name ?? "").trim();
  if (!s) return null;

  // Unwrap token form `[[skill:foo]]` or slash form `/foo`.
  const token = /^\[\[skill:([^\]]+)\]\]$/i.exec(s);
  if (token) s = token[1]!.trim();
  else if (s.startsWith("/")) s = s.slice(1).trim();

  // Drop surrounding whitespace again after unwrap.
  s = s.trim();
  if (!s) return null;
  if (!FULL_SKILL_NAME_RE.test(s)) return null;
  return s;
}

/**
 * Skills shown in the task picker: enabled + user-invocable, non-empty name.
 * Dedupes by name (first wins). Never invents rows.
 */
export function filterPickerEligibleSkills(
  skills: readonly SkillsPickerSkill[],
): SkillsPickerSkill[] {
  const seen = new Set<string>();
  const out: SkillsPickerSkill[] = [];
  for (const s of skills) {
    if (s.enabled === false) continue;
    if (s.userInvocable === false) continue;
    const name = normalizeSkillRef(s.name);
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

/**
 * Filter catalog by free-text query (case-insensitive substring on name +
 * description). Empty/whitespace query → all skills (same array when possible).
 * Never invents rows.
 */
export function filterSkillsCatalog(
  skills: readonly SkillsPickerSkill[],
  query: string,
): SkillsPickerSkill[] {
  const eligible = filterPickerEligibleSkills(skills);
  const q = query.trim().toLowerCase();
  if (!q) return eligible;
  return eligible.filter((s) => {
    if (s.name.toLowerCase().includes(q)) return true;
    const desc = (s.description ?? "").toLowerCase();
    return desc.includes(q);
  });
}

/**
 * Rank skills for the next prompt:
 * 1. When `prompt` (composer draft) has tokens — prompt-match score (high first)
 * 2. Else / for non-matches: recent ids first (order preserved)
 * 3. Remaining catalog skills alphabetically by name
 *
 * Optional `query` is an extra filter box (name/desc substring) applied first.
 * Never invents skill names — inventory only.
 */
export function rankSkillsForTask(input: {
  skills: readonly SkillsPickerSkill[];
  recentIds?: readonly string[];
  /** Manual filter box (name/desc substring). */
  query?: string;
  /**
   * Live composer draft / user prompt for continuous match.
   * Skill tokens are stripped before ranking.
   */
  prompt?: string;
  /** Max prompt-matched rows to surface first (default 40). */
  promptLimit?: number;
}): SkillsPickerSkill[] {
  const filtered = filterSkillsCatalog(
    input.skills,
    input.query ?? "",
  );
  if (filtered.length === 0) return [];

  const byName = new Map(filtered.map((s) => [s.name, s]));
  const out: SkillsPickerSkill[] = [];
  const used = new Set<string>();

  const promptText = stripSkillTokensForMatch(input.prompt ?? "");
  // Live find-skills mode: rank by prompt purpose (not A–Z catalog dump).
  // Avoid thrash on 1–3 chars; require real prompt body.
  const promptActive = promptText.length >= 4;
  if (promptActive) {
    // Large catalogs: rank invocable first for speed (still host inventory only).
    const rankSource =
      filtered.length > 400
        ? filtered.filter(
            (s) => s.userInvocable !== false && s.enabled !== false,
          )
        : filtered;
    const pool = rankSource.length > 0 ? rankSource : filtered;
    const hits: SkillMatchHit[] = rankSkillsForPrompt({
      skills: pool.map((s) => ({
        name: s.name,
        description: s.description,
        source: s.source,
        enabled: s.enabled,
        userInvocable: s.userInvocable,
      })),
      prompt: promptText,
      limit: input.promptLimit ?? 40,
      minScore: 6,
    });
    for (const h of hits) {
      const base = byName.get(h.name);
      if (!base || used.has(h.name)) continue;
      out.push({
        ...base,
        matchScore: h.score,
        matchedTokens: h.matchedTokens,
      });
      used.add(h.name);
    }
    // Always return match list when user has a prompt — empty means "no fit",
    // never fall back to full alphabetical catalog (that hides purpose ranking).
    return out;
  }

  for (const raw of input.recentIds ?? []) {
    const id = normalizeSkillRef(raw);
    if (!id || used.has(id)) continue;
    const hit = byName.get(id);
    if (!hit) continue;
    out.push(hit);
    used.add(id);
  }

  const rest = filtered
    .filter((s) => !used.has(s.name))
    .slice()
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  out.push(...rest);
  return out;
}

/**
 * Format a skill as the stable storage / bubble token.
 * Returns empty string when the name is invalid.
 */
export function formatSkillToken(name: string | null | undefined): string {
  const n = normalizeSkillRef(name);
  if (!n) return "";
  return `[[skill:${n}]]`;
}

/**
 * Plan inserting a skill chip into a stored draft string.
 * Appends `[[skill:name]]` (with a leading space when needed) + trailing space.
 * Invalid names leave the draft unchanged.
 */
export function planInsertSkill(
  draft: string,
  skillName: string | null | undefined,
): string {
  const token = formatSkillToken(skillName);
  if (!token) return draft ?? "";
  const d = draft ?? "";
  const needsSpace = d.length > 0 && !/\s$/.test(d);
  return `${d}${needsSpace ? " " : ""}${token} `;
}

/**
 * Resolve empty-state presentation for the skills task picker.
 * Returns `null` when filtered rows exist (list should render).
 *
 * Priority: host_only (load error / host unavailable + empty catalog) →
 * empty (no installed/enabled skills) → filter (query hides all).
 */
export function resolveSkillsPickerEmptyState(input: {
  /** Eligible catalog size before query filter. */
  catalogCount: number;
  /** Visible rows after query. */
  filteredCount: number;
  query?: string;
  /** Host `skills_list` error or non-desktop surface. */
  hostError?: string | null;
  /** True while first load has not finished. */
  loading?: boolean;
}): SkillsPickerEmptyPresentation | null {
  const catalogCount = Math.max(0, Number(input.catalogCount) || 0);
  const filteredCount = Math.max(0, Number(input.filteredCount) || 0);
  const q = (input.query ?? "").trim();
  const hostError = (input.hostError ?? "").trim();
  const loading = Boolean(input.loading);

  if (filteredCount > 0) return null;
  // Loading with empty catalog: host will paint its own busy row.
  if (loading && catalogCount === 0 && !hostError) return null;

  if (hostError && catalogCount === 0) {
    return {
      kind: "host_only",
      titleKey: "skillsPicker.hostOnly",
      hintKey: "skillsPicker.hostOnlyHint",
      showClearFilter: false,
    };
  }

  if (catalogCount === 0) {
    return {
      kind: "empty",
      titleKey: "skillsPicker.empty",
      hintKey: "skillsPicker.emptyHint",
      showClearFilter: false,
    };
  }

  if (q) {
    return {
      kind: "filter",
      titleKey: "skillsPicker.filterEmpty",
      hintKey: "skillsPicker.filterEmptyHint",
      showClearFilter: true,
    };
  }

  // Catalog non-empty but nothing visible without query (should not happen).
  return {
    kind: "empty",
    titleKey: "skillsPicker.empty",
    hintKey: "skillsPicker.emptyHint",
    showClearFilter: false,
  };
}

/**
 * Parse stored JSON into a clean, newest-first list of skill ids (capped).
 * Tolerates corrupt / partial data; invalid names dropped.
 */
export function parseRecentSkillIds(
  raw: unknown,
  max = SKILLS_RECENT_MAX,
): string[] {
  let list: unknown[] = [];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      return [];
    }
  } else if (Array.isArray(raw)) {
    list = raw;
  } else {
    return [];
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const id =
      typeof item === "string"
        ? normalizeSkillRef(item)
        : item && typeof item === "object" && "id" in item
          ? normalizeSkillRef(String((item as { id: unknown }).id))
          : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

/** Pure ring-buffer push: newest first, max length, dedupe by id. */
export function pushRecentSkillId(
  existing: readonly string[],
  skillName: string | null | undefined,
  max = SKILLS_RECENT_MAX,
): string[] {
  const id = normalizeSkillRef(skillName);
  if (!id) return parseRecentSkillIds(existing, max);
  const cleaned = parseRecentSkillIds(existing, max).filter((x) => x !== id);
  return parseRecentSkillIds([id, ...cleaned], max);
}

export function loadRecentSkillIds(
  storage: SkillsRecentStorage = defaultStorage(),
  max = SKILLS_RECENT_MAX,
): string[] {
  try {
    return parseRecentSkillIds(
      storage.getItem(SKILLS_RECENT_STORAGE_KEY),
      max,
    );
  } catch {
    return [];
  }
}

export function saveRecentSkillIds(
  ids: readonly string[],
  storage: SkillsRecentStorage = defaultStorage(),
  max = SKILLS_RECENT_MAX,
): void {
  const clean = parseRecentSkillIds(ids, max);
  try {
    storage.setItem(SKILLS_RECENT_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    /* private mode / quota */
  }
}

/**
 * Record a picked skill: load → push → save → notify.
 * Returns the updated list. Skips invalid names.
 */
export function recordRecentSkill(
  skillName: string | null | undefined,
  storage: SkillsRecentStorage = defaultStorage(),
  max = SKILLS_RECENT_MAX,
): string[] {
  const next = pushRecentSkillId(
    loadRecentSkillIds(storage, max),
    skillName,
    max,
  );
  saveRecentSkillIds(next, storage, max);
  notifyRecentSkillsChange(next);
  return next;
}

function notifyRecentSkillsChange(next: readonly string[]): void {
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(SKILLS_RECENT_CHANGE_EVENT, { detail: next }),
      );
    } catch {
      /* ignore */
    }
  }
}

/**
 * Recent skill chips for the picker header: recent ids that still exist in
 * the eligible catalog, limited to `limit` (default 6).
 */
export function recentSkillChips(input: {
  skills: readonly SkillsPickerSkill[];
  recentIds: readonly string[];
  limit?: number;
}): SkillsPickerSkill[] {
  const limit = Math.max(0, input.limit ?? 6);
  if (limit === 0) return [];
  const eligible = filterPickerEligibleSkills(input.skills);
  const byName = new Map(eligible.map((s) => [s.name, s]));
  const out: SkillsPickerSkill[] = [];
  const used = new Set<string>();
  for (const raw of input.recentIds) {
    const id = normalizeSkillRef(raw);
    if (!id || used.has(id)) continue;
    const hit = byName.get(id);
    if (!hit) continue;
    out.push(hit);
    used.add(id);
    if (out.length >= limit) break;
  }
  return out;
}

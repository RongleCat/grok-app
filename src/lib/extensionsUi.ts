/**
 * Pure helpers for Settings → Extensions (Skills / MCP management).
 */

export type SkillLike = {
  name: string;
  description?: string;
  source: string;
  path?: string | null;
  userInvocable?: boolean;
  enabled?: boolean;
};

export type McpLike = {
  name: string;
  transport?: string | null;
  target?: string | null;
  vendor?: string | null;
  compatibilityStatus?: string | null;
  enabled?: boolean;
};

/** Missing / undefined → enabled (default-on / opt-out). */
export function isExtensionEnabled(enabled: boolean | null | undefined): boolean {
  return enabled !== false;
}

/**
 * Apply enable overlay map onto a list of named items.
 * Overlay wins; missing overlay keys stay default-on.
 */
export function mergeEnableSet(
  names: string[],
  overlay: Record<string, boolean> | null | undefined,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const raw of names) {
    const name = (raw ?? "").trim();
    if (!name) continue;
    out[name] = overlay && name in overlay ? Boolean(overlay[name]) : true;
  }
  return out;
}

/** Filter items by enable map (default-on when key missing). */
export function filterEnabledByName<T extends { name: string }>(
  items: T[],
  enableMap: Record<string, boolean> | null | undefined,
): T[] {
  return items.filter((item) => {
    const name = (item.name ?? "").trim();
    if (!name) return false;
    if (!enableMap || !(name in enableMap)) return true;
    return enableMap[name] !== false;
  });
}

/** Count how many of the given names are currently disabled. */
export function countDisabled(
  names: string[],
  enableMap: Record<string, boolean> | null | undefined,
): number {
  return names.filter((n) => {
    const name = (n ?? "").trim();
    if (!name) return false;
    return enableMap && name in enableMap && enableMap[name] === false;
  }).length;
}

/** True when inspect/skills host error indicates CLI binary missing. */
export function isCliMissingError(error: string | null | undefined): boolean {
  if (!error) return false;
  const e = error.toLowerCase();
  return (
    e.includes("cli not found") ||
    e.includes("grok build cli not found") ||
    (e.includes("not found") && e.includes("cli"))
  );
}

/** Normalize skill source for badges / meta (never empty). */
export function normalizeSkillSource(source: string | null | undefined): string {
  const s = (source ?? "").trim();
  return s || "unknown";
}

/** Badge tone for skill source. */
export function skillSourceTone(
  source: string | null | undefined,
): "user" | "project" | "plugin" | "muted" {
  const s = normalizeSkillSource(source).toLowerCase();
  if (s === "user" || s === "global") return "user";
  if (s === "project" || s === "workspace" || s === "local") return "project";
  if (s === "plugin" || s === "builtin" || s === "built-in") return "plugin";
  return "muted";
}

/** Compact meta line under a skill name (source · invocable). */
export function skillMetaLine(skill: SkillLike): string {
  const parts: string[] = [normalizeSkillSource(skill.source)];
  if (skill.userInvocable) parts.push("user-invocable");
  return parts.join(" · ");
}

/** Compact meta line under an MCP server name. */
export function mcpMetaLine(server: McpLike): string {
  return [server.transport, server.compatibilityStatus, server.vendor]
    .map((x) => (x ?? "").trim())
    .filter(Boolean)
    .join(" · ");
}

/** Sort skills alphabetically by name (stable copy). */
export function sortSkillsByName<T extends { name: string }>(skills: T[]): T[] {
  return [...skills].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/** Sort MCP servers alphabetically by name (stable copy). */
export function sortMcpByName<T extends { name: string }>(servers: T[]): T[] {
  return [...servers].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/** Shorten a long absolute path for secondary UI (keeps basename + parent). */
export function shortPathLabel(
  path: string | null | undefined,
  max = 56,
): string {
  const p = (path ?? "").trim();
  if (!p) return "";
  if (p.length <= max) return p;
  const sep = p.includes("\\") && !p.includes("/") ? "\\" : "/";
  const parts = p.split(/[/\\]/).filter(Boolean);
  if (parts.length <= 2) return `…${sep}${parts.join(sep)}`;
  const tail = parts.slice(-2).join(sep);
  const candidate = `…${sep}${tail}`;
  return candidate.length <= max ? candidate : `…${sep}${parts[parts.length - 1]}`;
}

/**
 * Merge skills + MCP host errors into one actionable banner message.
 * Prefer CLI-missing wording when either side reports it.
 */
export function mergeInspectErrors(
  skillsError: string | null | undefined,
  mcpError: string | null | undefined,
): string | null {
  const a = (skillsError ?? "").trim();
  const b = (mcpError ?? "").trim();
  if (!a && !b) return null;
  if (isCliMissingError(a) || isCliMissingError(b)) {
    return a && isCliMissingError(a) ? a : b || a;
  }
  if (a && b && a === b) return a;
  if (a && b) return `${a} · ${b}`;
  return a || b || null;
}

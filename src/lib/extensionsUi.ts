/**
 * Pure helpers for Settings → Extensions (Skills / MCP / Plugins).
 */

export type SkillLike = {
  name: string;
  description?: string;
  source: string;
  path?: string | null;
  userInvocable?: boolean;
};

export type McpLike = {
  name: string;
  transport?: string | null;
  target?: string | null;
  vendor?: string | null;
  compatibilityStatus?: string | null;
};

export type PluginProvidesLike = {
  skills?: number;
  agents?: number;
  hooks?: boolean;
  mcpServers?: number;
};

export type PluginLike = {
  name: string;
  version?: string | null;
  source?: string | null;
  marketplace?: string | null;
  path?: string | null;
  status?: string | null;
  enabled?: boolean;
  repoKey?: string | null;
  scope?: string | null;
  provides?: PluginProvidesLike | null;
};

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
  pluginsError?: string | null | undefined,
): string | null {
  const parts = [skillsError, mcpError, pluginsError]
    .map((x) => (x ?? "").trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const cli = parts.find((p) => isCliMissingError(p));
  if (cli) return cli;
  const unique = [...new Set(parts)];
  return unique.join(" · ");
}

/** Sort plugins alphabetically by name (stable copy). */
export function sortPluginsByName<T extends { name: string }>(plugins: T[]): T[] {
  return [...plugins].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/**
 * Load-state label for badges. Separate from CLI install `status`
 * (Grok Build keeps those as distinct concepts).
 */
export function pluginLoadLabel(enabled?: boolean): "enabled" | "disabled" {
  return enabled === false ? "disabled" : "enabled";
}

/** Badge tone for enable/disable load state. */
export function pluginStatusTone(
  _status: string | null | undefined,
  enabled?: boolean,
): "enabled" | "disabled" | "muted" {
  return pluginLoadLabel(enabled);
}

/** Compact meta: scope · version · marketplace/source — mirrors Grok Build list row. */
export function pluginMetaLine(plugin: PluginLike): string {
  const parts: string[] = [];
  const scope = (plugin.scope ?? "").trim();
  if (scope) parts.push(scope);
  const ver = (plugin.version ?? "").trim();
  if (ver) parts.push(`v${ver.replace(/^v/i, "")}`);
  const market = (plugin.marketplace ?? "").trim();
  if (market) parts.push(market);
  const source = (plugin.source ?? "").trim();
  if (source && !market) {
    if (source.startsWith("http://") || source.startsWith("https://")) {
      try {
        const u = new URL(source);
        const segs = u.pathname.split("/").filter(Boolean);
        const label =
          segs.length >= 2
            ? `${segs[segs.length - 2]}/${segs[segs.length - 1].replace(/\.git$/, "")}`
            : u.hostname;
        parts.push(label);
      } catch {
        parts.push(source);
      }
    } else if (!source.includes("/Users/") && !source.includes("\\Users\\")) {
      parts.push(source);
    } else {
      parts.push("local");
    }
  }
  return parts.join(" · ");
}

/**
 * Grok Build TUI-style provides summary:
 * "6 skills · hooks · 1 MCP" (omit zero counts).
 */
export function pluginProvidesLine(plugin: PluginLike): string {
  const p = plugin.provides;
  if (!p) return "";
  const parts: string[] = [];
  const skills = Number(p.skills ?? 0);
  const agents = Number(p.agents ?? 0);
  const mcp = Number(p.mcpServers ?? 0);
  if (skills > 0) parts.push(`${skills} skill${skills === 1 ? "" : "s"}`);
  if (agents > 0) parts.push(`${agents} agent${agents === 1 ? "" : "s"}`);
  if (p.hooks) parts.push("hooks");
  if (mcp > 0) parts.push(`${mcp} MCP`);
  return parts.join(" · ");
}

/** Stable list key for a plugin row (name alone is not unique across repos). */
export function pluginRowKey(plugin: PluginLike): string {
  const key = (plugin.repoKey ?? "").trim();
  if (key) return `${key}:${plugin.name}`;
  const path = (plugin.path ?? "").trim();
  if (path) return `${path}:${plugin.name}`;
  return plugin.name;
}

export type PluginFilter = "all" | "enabled" | "disabled";

/** Filter like Grok Build Plugins tab `f` (all / enabled / disabled). */
export function filterPluginsByLoadState<T extends { enabled?: boolean }>(
  plugins: T[],
  filter: PluginFilter,
): T[] {
  if (filter === "enabled") return plugins.filter((p) => p.enabled !== false);
  if (filter === "disabled") return plugins.filter((p) => p.enabled === false);
  return plugins;
}

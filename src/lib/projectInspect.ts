/**
 * Pure helpers for project inspect summary (Settings → Runtime).
 * Parses `grok inspect --json` shape into a secret-safe display DTO.
 *
 * Depth helpers: section chips, filter, per-section copy JSON / path reveal.
 * Never surfaces skill descriptions, MCP env/headers, or other secret-bearing blobs.
 */

import { redact } from "./redact";

export type ProjectInspectRule = {
  path: string;
  scope?: string;
  fileType?: string;
  sizeBytes?: number;
};

export type ProjectInspectPlugin = {
  name: string;
  scope?: string;
  enabled?: boolean;
  path?: string;
  provides?: {
    skills: number;
    agents: number;
    hooks: boolean;
    mcpServers: number;
  };
};

export type ProjectInspectMcp = {
  name: string;
  transport?: string;
  target?: string;
  /** Config / plugin source type when present (never env). */
  source?: string;
};

export type ProjectInspectAgent = {
  name: string;
  source?: string;
};

export type ProjectInspectHook = {
  /** Hook event name (e.g. stop, PreToolUse, "(plugin)"). */
  event?: string;
  hookType?: string;
  /** File path or command target (path-safe; no env). */
  target?: string;
  /** Source type label (plugin / user / project / …). */
  source?: string;
  matcher?: string;
};

export type ProjectInspectConfigLayer = {
  role?: string;
  path?: string;
};

export type ProjectInspectSkills = {
  total: number;
  userInvocable: number;
  bySource: Record<string, number>;
  /** Up to N invocable skill names for a quick glance. */
  sample: string[];
  /** All skill names (secret-safe; no descriptions). Sorted. */
  names: string[];
};

export type ProjectInspectPermissions = {
  loaded: number;
  sourcesCount: number;
  managedSettingsActive: boolean;
  /** From `grok inspect` when present (host soft-passes through). */
  managedSettingsExists?: boolean | null;
  managedSettingsPath?: string | null;
};

/** Sanitized summary returned by `project_inspect` and built client-side for tests. */
export type ProjectInspectSummary = {
  projectPath: string | null;
  projectRoot: string | null;
  projectTrusted: boolean | null;
  cwd: string | null;
  grokVersion: string | null;
  channel: string | null;
  hasProjectGrokDir: boolean;
  projectGrokPath: string | null;
  rules: ProjectInspectRule[];
  plugins: ProjectInspectPlugin[];
  skills: ProjectInspectSkills;
  mcp: ProjectInspectMcp[];
  agents: ProjectInspectAgent[];
  /** Sanitized hook rows (event / type / target / source). */
  hooks: ProjectInspectHook[];
  hooksCount: number;
  configLayers: ProjectInspectConfigLayer[];
  /** Model ids / default hints (from cache or inspect when present). */
  modelsHints: string[];
  permissions: ProjectInspectPermissions;
  error?: string | null;
};

export type SummarizeInspectOptions = {
  projectPath?: string | null;
  hasProjectGrokDir?: boolean;
  projectGrokPath?: string | null;
  modelsHints?: string[];
  /** Max skill names in `skills.sample` (default 12). */
  skillSampleLimit?: number;
  error?: string | null;
};

// ---------------------------------------------------------------------------
// Section chips / filter (Settings → Runtime → Project inspect depth)
// ---------------------------------------------------------------------------

/**
 * Section ids for inventory chips. `"all"` shows every non-empty section;
 * other ids filter the body to a single inventory bucket.
 */
export type InspectSectionId =
  | "all"
  | "plugins"
  | "skills"
  | "mcp"
  | "hooks"
  | "agents"
  | "rules"
  | "config"
  | "models"
  | "permissions";

/** Ordered chip list (all first, then inventory buckets). */
export const INSPECT_SECTION_IDS: readonly InspectSectionId[] = [
  "all",
  "plugins",
  "skills",
  "mcp",
  "hooks",
  "agents",
  "rules",
  "config",
  "models",
  "permissions",
] as const;

/** Inventory sections that can be filtered (excludes `"all"`). */
export const INSPECT_INVENTORY_SECTIONS: readonly Exclude<
  InspectSectionId,
  "all"
>[] = [
  "plugins",
  "skills",
  "mcp",
  "hooks",
  "agents",
  "rules",
  "config",
  "models",
  "permissions",
] as const;

const SENSITIVE_KEY_RE =
  /^(api[_-]?key|token|secret|password|passwd|authorization|auth|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|bearer)$/i;

/** Keys that often hold secrets even when nested (env maps, headers). */
const SENSITIVE_CONTAINER_KEYS = new Set([
  "env",
  "environment",
  "headers",
  "authorization",
  "secrets",
  "credentials",
]);

export function isSensitiveKey(key: string): boolean {
  const k = (key ?? "").trim();
  if (!k) return false;
  if (SENSITIVE_KEY_RE.test(k)) return true;
  // Common patterns: OPENAI_API_KEY, x-api-key, mcp.apiKey
  if (/api[_-]?key/i.test(k)) return true;
  if (/(^|[_-])(token|secret|password)($|[_-])/i.test(k)) return true;
  return false;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function sourceType(source: unknown): string {
  if (typeof source === "string" && source.trim()) return source.trim();
  const obj = asRecord(source);
  if (obj) {
    const t = str(obj.type);
    if (t) return t;
  }
  return "unknown";
}

function normalizeSkillSource(source: unknown): string {
  return sourceType(source).toLowerCase();
}

/**
 * Drop secrets from an arbitrary JSON-like value.
 * Sensitive keys become `"[REDACTED]"`; env/header maps are fully redacted.
 */
export function redactSensitiveValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    return redact(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item));
  }
  const obj = asRecord(value);
  if (!obj) return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(obj)) {
    if (isSensitiveKey(key) || SENSITIVE_CONTAINER_KEYS.has(key.toLowerCase())) {
      out[key] = "[REDACTED]";
      continue;
    }
    out[key] = redactSensitiveValue(child);
  }
  return out;
}

export function emptyProjectInspectSummary(
  opts?: SummarizeInspectOptions,
): ProjectInspectSummary {
  return {
    projectPath: opts?.projectPath?.trim() || null,
    projectRoot: null,
    projectTrusted: null,
    cwd: null,
    grokVersion: null,
    channel: null,
    hasProjectGrokDir: Boolean(opts?.hasProjectGrokDir),
    projectGrokPath: opts?.projectGrokPath?.trim() || null,
    rules: [],
    plugins: [],
    skills: {
      total: 0,
      userInvocable: 0,
      bySource: {},
      sample: [],
      names: [],
    },
    mcp: [],
    agents: [],
    hooks: [],
    hooksCount: 0,
    configLayers: [],
    modelsHints: opts?.modelsHints?.filter(Boolean) ?? [],
    permissions: {
      loaded: 0,
      sourcesCount: 0,
      managedSettingsActive: false,
    },
    error: opts?.error ?? null,
  };
}

/** Normalize older host payloads that may omit names, hooks, or list fields. */
export function normalizeProjectInspectSummary(
  raw: ProjectInspectSummary,
): ProjectInspectSummary {
  const skills = raw.skills ?? {
    total: 0,
    userInvocable: 0,
    bySource: {},
    sample: [],
    names: [],
  };
  const names =
    Array.isArray(skills.names) && skills.names.length > 0
      ? skills.names
      : Array.isArray(skills.sample)
        ? [...skills.sample]
        : [];
  const hooks = Array.isArray(raw.hooks) ? raw.hooks : [];
  const hooksCount =
    typeof raw.hooksCount === "number" && raw.hooksCount > 0
      ? raw.hooksCount
      : hooks.length;
  return {
    ...raw,
    skills: {
      total: skills.total ?? names.length,
      userInvocable: skills.userInvocable ?? 0,
      bySource: skills.bySource ?? {},
      sample: skills.sample ?? [],
      names,
    },
    hooks,
    hooksCount,
    plugins: raw.plugins ?? [],
    mcp: raw.mcp ?? [],
    agents: raw.agents ?? [],
    rules: raw.rules ?? [],
    configLayers: raw.configLayers ?? [],
    modelsHints: raw.modelsHints ?? [],
    permissions: raw.permissions ?? {
      loaded: 0,
      sourcesCount: 0,
      managedSettingsActive: false,
    },
  };
}

/**
 * Build a secret-safe summary from raw `grok inspect --json` output.
 * Only copies known safe fields — never passes through unknown blobs wholesale.
 */
export function summarizeInspectJson(
  raw: unknown,
  opts?: SummarizeInspectOptions,
): ProjectInspectSummary {
  const base = emptyProjectInspectSummary(opts);
  const root = asRecord(raw);
  if (!root) {
    return {
      ...base,
      error: opts?.error ?? (raw == null ? null : "Invalid inspect payload"),
    };
  }

  const projectRoot = str(root.projectRoot);
  const projectPath = opts?.projectPath?.trim() || projectRoot || null;

  // Rules / project instructions (paths only — no file bodies).
  const rules: ProjectInspectRule[] = [];
  const instr =
    (Array.isArray(root.projectInstructions) && root.projectInstructions) ||
    (Array.isArray(root.rules) && root.rules) ||
    [];
  for (const item of instr) {
    const o = asRecord(item);
    if (!o) continue;
    const path = str(o.path);
    if (!path) continue;
    rules.push({
      path,
      scope: str(o.scope) ?? undefined,
      fileType: str(o.fileType) ?? str(o.file_type) ?? undefined,
      sizeBytes: num(o.sizeBytes) ?? num(o.size_bytes) ?? undefined,
    });
  }

  // Plugins
  const plugins: ProjectInspectPlugin[] = [];
  const pluginArr = Array.isArray(root.plugins) ? root.plugins : [];
  for (const item of pluginArr) {
    const o = asRecord(item);
    if (!o) continue;
    const name = str(o.name);
    if (!name) continue;
    const providesObj = asRecord(o.provides);
    let provides: ProjectInspectPlugin["provides"];
    if (providesObj) {
      provides = {
        skills: num(providesObj.skills) ?? 0,
        agents: num(providesObj.agents) ?? 0,
        hooks: Boolean(providesObj.hooks),
        mcpServers:
          num(providesObj.mcpServers) ?? num(providesObj.mcp_servers) ?? 0,
      };
    }
    plugins.push({
      name,
      scope: str(o.scope) ?? undefined,
      enabled: bool(o.enabled) ?? undefined,
      path: str(o.path) ?? undefined,
      provides,
    });
  }

  // Skills — counts + all names + short sample of invocable (no descriptions).
  const skillArr = Array.isArray(root.skills) ? root.skills : [];
  const bySource: Record<string, number> = {};
  let userInvocable = 0;
  const invocableNames: string[] = [];
  const allNames: string[] = [];
  for (const item of skillArr) {
    const o = asRecord(item);
    if (!o) continue;
    const name = str(o.name);
    if (!name) continue;
    allNames.push(name);
    const src = normalizeSkillSource(o.source);
    bySource[src] = (bySource[src] ?? 0) + 1;
    const inv =
      bool(o.userInvocable) ?? bool(o.user_invocable) ?? false;
    if (inv) {
      userInvocable += 1;
      invocableNames.push(name);
    }
  }
  const sampleLimit = opts?.skillSampleLimit ?? 12;
  invocableNames.sort((a, b) => a.localeCompare(b));
  allNames.sort((a, b) => a.localeCompare(b));

  // MCP — name/transport/target/source type only (no env / headers).
  const mcp: ProjectInspectMcp[] = [];
  const mcpArr =
    (Array.isArray(root.mcpServers) && root.mcpServers) ||
    (Array.isArray(root.mcp) && root.mcp) ||
    [];
  for (const item of mcpArr) {
    const o = asRecord(item);
    if (!o) continue;
    const name = str(o.name);
    if (!name) continue;
    const sourceLabel = o.source != null ? sourceType(o.source) : null;
    mcp.push({
      name,
      transport: str(o.transport) ?? undefined,
      target: str(o.target) ?? undefined,
      source: sourceLabel && sourceLabel !== "unknown" ? sourceLabel : undefined,
    });
  }

  // Agents
  const agents: ProjectInspectAgent[] = [];
  const agentArr = Array.isArray(root.agents) ? root.agents : [];
  for (const item of agentArr) {
    const o = asRecord(item);
    if (!o) continue;
    const name = str(o.name);
    if (!name) continue;
    agents.push({ name, source: sourceType(o.source) });
  }

  // Hooks — event / type / target / source type only (no command env).
  const hooks: ProjectInspectHook[] = [];
  const hookArr = Array.isArray(root.hooks) ? root.hooks : [];
  for (const item of hookArr) {
    // Bare numbers / strings in legacy fixtures → count only, no row.
    const o = asRecord(item);
    if (!o) {
      if (typeof item === "string" && item.trim()) {
        hooks.push({ event: item.trim() });
      }
      continue;
    }
    const event = str(o.event) ?? str(o.name) ?? undefined;
    const hookType =
      str(o.hookType) ?? str(o.hook_type) ?? str(o.type) ?? undefined;
    const target = str(o.target) ?? str(o.path) ?? undefined;
    const source =
      o.source != null ? sourceType(o.source) : str(o.plugin) ?? undefined;
    const matcher = str(o.matcher) ?? undefined;
    if (!event && !hookType && !target) continue;
    hooks.push({
      event,
      hookType,
      target,
      source: source && source !== "unknown" ? source : source,
      matcher,
    });
  }

  // Config layers (paths only)
  const configLayers: ProjectInspectConfigLayer[] = [];
  const cs = asRecord(root.configSources);
  const layers = cs && Array.isArray(cs.layers) ? cs.layers : [];
  for (const item of layers) {
    const o = asRecord(item);
    if (!o) continue;
    configLayers.push({
      role: str(o.role) ?? undefined,
      path: str(o.path) ?? undefined,
    });
  }

  // Permissions summary (counts / flags only)
  const perm = asRecord(root.permissions);
  const sources = perm && Array.isArray(perm.sources) ? perm.sources : [];
  const permissions: ProjectInspectPermissions = {
    loaded: num(perm?.loaded) ?? 0,
    sourcesCount: sources.length,
    managedSettingsActive: Boolean(perm?.managedSettingsActive),
    managedSettingsExists:
      typeof perm?.managedSettingsExists === "boolean"
        ? perm.managedSettingsExists
        : perm?.managedSettingsExists == null
          ? null
          : null,
    managedSettingsPath: str(perm?.managedSettingsPath),
  };

  // Models hints: explicit array on inspect if ever present, plus opts.
  const modelsHints: string[] = [];
  const seen = new Set<string>();
  const pushHint = (h: string | null | undefined) => {
    const s = (h ?? "").trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    modelsHints.push(s);
  };
  for (const h of opts?.modelsHints ?? []) pushHint(h);
  if (Array.isArray(root.models)) {
    for (const m of root.models) {
      if (typeof m === "string") pushHint(m);
      else {
        const o = asRecord(m);
        pushHint(str(o?.id) ?? str(o?.name) ?? str(o?.model));
      }
    }
  }
  const channel = str(root.channel);
  if (channel && channel !== "unknown") {
    pushHint(`channel:${channel}`);
  }
  const defaultModel =
    str(root.defaultModel) ??
    str(root.default_model) ??
    str(asRecord(root.models)?.default);
  if (defaultModel) pushHint(defaultModel);

  const hooksCount = hooks.length > 0 ? hooks.length : hookArr.length;

  return {
    projectPath,
    projectRoot,
    projectTrusted: bool(root.projectTrusted),
    cwd: str(root.cwd),
    grokVersion: str(root.grokVersion) ?? str(root.grok_version),
    channel,
    hasProjectGrokDir: Boolean(opts?.hasProjectGrokDir),
    projectGrokPath: opts?.projectGrokPath?.trim() || null,
    rules,
    plugins,
    skills: {
      total: skillArr.length,
      userInvocable,
      bySource,
      sample: invocableNames.slice(0, sampleLimit),
      names: allNames,
    },
    mcp,
    agents,
    hooks,
    hooksCount,
    configLayers,
    modelsHints,
    permissions,
    error: opts?.error ?? null,
  };
}

/** Pretty JSON for clipboard — already a summary DTO, plus string scrub. */
export function formatInspectJsonForCopy(summary: ProjectInspectSummary): string {
  const safe = redactSensitiveValue(summary);
  return redact(JSON.stringify(safe, null, 2));
}

/** Human-readable counts line for the panel header. */
export function inspectCountsLine(summary: ProjectInspectSummary): {
  plugins: number;
  skills: number;
  mcp: number;
  rules: number;
  agents: number;
  hooks: number;
} {
  return {
    plugins: summary.plugins.length,
    skills: summary.skills.total,
    mcp: summary.mcp.length,
    rules: summary.rules.length,
    agents: summary.agents.length,
    hooks: summary.hooksCount || summary.hooks.length,
  };
}

// ── Section depth helpers ───────────────────────────────────────────────────

/** Count of items in one inventory section (0 when empty / n/a). */
export function inspectSectionCount(
  summary: ProjectInspectSummary,
  id: InspectSectionId,
): number {
  switch (id) {
    case "all": {
      const c = inspectCountsLine(summary);
      return (
        c.plugins +
        c.skills +
        c.mcp +
        c.hooks +
        c.agents +
        c.rules +
        summary.configLayers.length +
        summary.modelsHints.length +
        (summary.permissions.loaded > 0 ||
        summary.permissions.sourcesCount > 0 ||
        summary.permissions.managedSettingsActive
          ? 1
          : 0)
      );
    }
    case "plugins":
      return summary.plugins.length;
    case "skills":
      return summary.skills.total;
    case "mcp":
      return summary.mcp.length;
    case "hooks":
      return summary.hooksCount || summary.hooks.length;
    case "agents":
      return summary.agents.length;
    case "rules":
      return summary.rules.length;
    case "config":
      return summary.configLayers.length;
    case "models":
      return summary.modelsHints.length;
    case "permissions":
      return summary.permissions.loaded > 0 ||
        summary.permissions.sourcesCount > 0 ||
        summary.permissions.managedSettingsActive
        ? 1
        : 0;
    default:
      return 0;
  }
}

/** Per-section counts including `all` (sum of inventory items). */
export function inspectSectionCounts(
  summary: ProjectInspectSummary,
): Record<InspectSectionId, number> {
  const out = {} as Record<InspectSectionId, number>;
  for (const id of INSPECT_SECTION_IDS) {
    out[id] = inspectSectionCount(summary, id);
  }
  return out;
}

/** Whether a section has any content worth showing. */
export function inspectSectionHasContent(
  summary: ProjectInspectSummary,
  id: InspectSectionId,
): boolean {
  if (id === "all") return inspectSectionCount(summary, "all") > 0;
  return inspectSectionCount(summary, id) > 0;
}

/**
 * Sections to render given the active chip.
 * `"all"` → every non-empty inventory section; otherwise a single id when non-empty.
 */
export function filterInspectSections(
  summary: ProjectInspectSummary,
  active: InspectSectionId = "all",
): Exclude<InspectSectionId, "all">[] {
  if (active === "all") {
    return INSPECT_INVENTORY_SECTIONS.filter((id) =>
      inspectSectionHasContent(summary, id),
    );
  }
  return inspectSectionHasContent(summary, active) ? [active] : [];
}

/**
 * Slice of the summary DTO for one section (secret-safe object for copy).
 * Returns `null` when the section has no payload.
 */
export function inspectSectionSlice(
  summary: ProjectInspectSummary,
  section: InspectSectionId,
): unknown {
  switch (section) {
    case "all":
      return summary;
    case "plugins":
      return summary.plugins;
    case "skills":
      return summary.skills;
    case "mcp":
      return summary.mcp;
    case "hooks":
      return {
        count: summary.hooksCount || summary.hooks.length,
        hooks: summary.hooks,
      };
    case "agents":
      return summary.agents;
    case "rules":
      return summary.rules;
    case "config":
      return summary.configLayers;
    case "models":
      return summary.modelsHints;
    case "permissions":
      return summary.permissions;
    default:
      return null;
  }
}

/** Pretty JSON for one section (or full summary for `"all"`). */
export function formatInspectSectionJson(
  summary: ProjectInspectSummary,
  section: InspectSectionId = "all",
): string {
  const slice = inspectSectionSlice(summary, section);
  const safe = redactSensitiveValue(slice);
  return redact(JSON.stringify(safe, null, 2));
}

/**
 * Reveal-able filesystem paths for a section (rules, config, plugin/hook targets,
 * project `.grok`). Never invents paths.
 */
export function inspectSectionPaths(
  summary: ProjectInspectSummary,
  section: InspectSectionId,
): string[] {
  const paths: string[] = [];
  const push = (p: string | null | undefined) => {
    const t = (p ?? "").trim();
    if (!t || paths.includes(t)) return;
    // Skip non-path targets (http URLs, bare commands).
    if (/^https?:\/\//i.test(t)) return;
    if (!t.includes("/") && !t.includes("\\")) return;
    paths.push(t);
  };

  switch (section) {
    case "all":
      push(summary.projectGrokPath);
      push(summary.projectRoot);
      push(summary.projectPath);
      for (const r of summary.rules) push(r.path);
      for (const p of summary.plugins) push(p.path);
      for (const h of summary.hooks) push(h.target);
      for (const c of summary.configLayers) push(c.path);
      break;
    case "plugins":
      for (const p of summary.plugins) push(p.path);
      break;
    case "skills":
      // Skills DTO has names only (paths live in Extensions / skill roots).
      push(summary.projectGrokPath);
      break;
    case "mcp":
      for (const m of summary.mcp) push(m.target);
      break;
    case "hooks":
      for (const h of summary.hooks) push(h.target);
      break;
    case "agents":
      break;
    case "rules":
      for (const r of summary.rules) push(r.path);
      break;
    case "config":
      for (const c of summary.configLayers) push(c.path);
      break;
    case "models":
    case "permissions":
      break;
    default:
      break;
  }
  return paths;
}

/**
 * Optional external docs URL for a section when the summary carries one.
 * Current inspect DTO has no homepage fields — always `null` (kept for UI hook).
 */
export function inspectSectionDocsUrl(
  _summary: ProjectInspectSummary,
  _section: InspectSectionId,
): string | null {
  return null;
}

/**
 * Collapse long lists in the UI: when `total > limit`, only show first `limit`
 * unless `expanded` is true. Pure helper for list windows.
 */
export function sliceInspectList<T>(
  items: readonly T[],
  opts: { limit?: number; expanded?: boolean } = {},
): { visible: T[]; hidden: number; total: number } {
  const total = items.length;
  const limit = opts.limit ?? 8;
  if (opts.expanded || total <= limit) {
    return { visible: items as T[], hidden: 0, total };
  }
  return {
    visible: items.slice(0, limit) as T[],
    hidden: total - limit,
    total,
  };
}

/**
 * Pure helpers for project inspect summary (Settings → Runtime).
 * Parses `grok inspect --json` shape into a secret-safe display DTO.
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
};

export type ProjectInspectAgent = {
  name: string;
  source?: string;
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
};

export type ProjectInspectPermissions = {
  loaded: number;
  sourcesCount: number;
  managedSettingsActive: boolean;
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
    skills: { total: 0, userInvocable: 0, bySource: {}, sample: [] },
    mcp: [],
    agents: [],
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

  // Skills — counts + short sample of invocable names (no long descriptions).
  const skillArr = Array.isArray(root.skills) ? root.skills : [];
  const bySource: Record<string, number> = {};
  let userInvocable = 0;
  const invocableNames: string[] = [];
  for (const item of skillArr) {
    const o = asRecord(item);
    if (!o) continue;
    const name = str(o.name);
    if (!name) continue;
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

  // MCP — name/transport/target only (no env / headers).
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
    mcp.push({
      name,
      transport: str(o.transport) ?? undefined,
      target: str(o.target) ?? undefined,
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

  const hooksCount = Array.isArray(root.hooks) ? root.hooks.length : 0;

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
    },
    mcp,
    agents,
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
} {
  return {
    plugins: summary.plugins.length,
    skills: summary.skills.total,
    mcp: summary.mcp.length,
    rules: summary.rules.length,
    agents: summary.agents.length,
  };
}

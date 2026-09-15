/**
 * Pure helpers for Settings → Extensions plugins tab:
 * - Recommended ChatCut (#codex) matching
 * - ensure openai/plugins marketplace (idempotent soft-fail)
 * - default installable filter preference
 */

/** Stable recommended row id (not a CLI plugin name). */
export const CHATCUT_RECOMMENDED_ID = "chatcut-codex";

/** Install source for ChatCut Codex package (subdir pin). Never auto-install. */
export const CHATCUT_CODEX_INSTALL_SOURCE =
  "https://github.com/ChatCut-Inc/agent-plugin#codex";

/** Stable recommended row id for the X API plugin. */
export const X_API_RECOMMENDED_ID = "x-api";

/** Public git install source. Never auto-install. */
export const X_API_INSTALL_SOURCE = "https://github.com/RongleCat/x-api";

/** Names treated as x-api when matching installed plugins. */
export const X_API_INSTALLED_NAMES = ["x-api"] as const;

/** Built-in marketplace source URL (ensure-add, never delete others). */
export const OPENAI_PLUGINS_MARKETPLACE_URL =
  "https://github.com/openai/plugins";

/** Names treated as ChatCut when matching installed plugins. */
export const CHATCUT_INSTALLED_NAMES = ["codex", "chatcut"] as const;

export type PluginLikeForMatch = {
  name?: string | null;
  path?: string | null;
  source?: string | null;
  marketplace?: string | null;
};

export type MarketplaceSourceLikeForMatch = {
  name?: string | null;
  url?: string | null;
  path?: string | null;
  kind?: string | null;
};

/**
 * Normalize marketplace URLs / shorthands for comparison.
 * Lowercase, strip trailing .git / slash, drop scheme+host noise where possible.
 */
export function normalizeMarketplaceLocator(raw: string | null | undefined): string {
  let s = (raw ?? "").trim().toLowerCase();
  if (!s) return "";
  // git@github.com:org/repo.git → github.com/org/repo
  if (s.startsWith("git@")) {
    s = s.replace(/^git@/, "").replace(":", "/");
  }
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^www\./, "");
  s = s.replace(/\.git$/, "");
  s = s.replace(/\/+$/, "");
  // owner/repo shorthand for openai/plugins
  if (s === "openai/plugins") return "github.com/openai/plugins";
  return s;
}

/** True when a source is the openai/plugins marketplace (url/path/name variants). */
export function isOpenaiPluginsSource(
  source: MarketplaceSourceLikeForMatch | null | undefined,
): boolean {
  if (!source) return false;
  const candidates = [source.url, source.path, source.name];
  for (const c of candidates) {
    const n = normalizeMarketplaceLocator(c);
    if (!n) continue;
    if (n.includes("github.com/openai/plugins")) return true;
    if (n === "openai/plugins" || n.endsWith("/openai/plugins")) return true;
    // name-only chips like "openai plugins" / "openai-plugins"
    const nameOnly = n.replace(/[\s_]+/g, "-");
    if (nameOnly === "openai-plugins" || nameOnly === "openai/plugins") {
      return true;
    }
  }
  return false;
}

export function findOpenaiPluginsSource<T extends MarketplaceSourceLikeForMatch>(
  sources: readonly T[] | null | undefined,
): T | null {
  if (!sources?.length) return null;
  return sources.find((s) => isOpenaiPluginsSource(s)) ?? null;
}

/** True when installed list already has ChatCut (name or source path). */
export function isChatCutInstalled(
  plugins: readonly PluginLikeForMatch[] | null | undefined,
): boolean {
  if (!plugins?.length) return false;
  for (const p of plugins) {
    const name = (p.name ?? "").trim().toLowerCase();
    if (
      (CHATCUT_INSTALLED_NAMES as readonly string[]).includes(name)
    ) {
      return true;
    }
    const blob = [p.path, p.source, p.marketplace]
      .map((x) => (x ?? "").toLowerCase())
      .join(" ");
    if (blob.includes("chatcut-inc/agent-plugin")) return true;
    if (blob.includes("chatcut-inc") && blob.includes("agent-plugin")) {
      return true;
    }
  }
  return false;
}

/** Return the first installed ChatCut-like plugin row, if any. */
export function findChatCutInstalledPlugin<T extends PluginLikeForMatch>(
  plugins: readonly T[] | null | undefined,
): T | null {
  if (!plugins?.length) return null;
  for (const p of plugins) {
    if (isChatCutInstalled([p])) return p;
  }
  return null;
}

/** True when installed list already has x-api (name or git source). */
export function isXApiInstalled(
  plugins: readonly PluginLikeForMatch[] | null | undefined,
): boolean {
  if (!plugins?.length) return false;
  for (const p of plugins) {
    const name = (p.name ?? "").trim().toLowerCase();
    if ((X_API_INSTALLED_NAMES as readonly string[]).includes(name)) {
      return true;
    }
    const blob = [p.path, p.source, p.marketplace]
      .map((x) => (x ?? "").toLowerCase())
      .join(" ");
    if (blob.includes("ronglecat/x-api")) return true;
  }
  return false;
}

export function findXApiInstalledPlugin<T extends PluginLikeForMatch>(
  plugins: readonly T[] | null | undefined,
): T | null {
  if (!plugins?.length) return null;
  for (const p of plugins) {
    if (isXApiInstalled([p])) return p;
  }
  return null;
}

/**
 * UI display name: map installed `codex` / chatcut package to "ChatCut"
 * so recommended + installed never look like two different products.
 */
export function pluginDisplayName(
  plugin: PluginLikeForMatch | null | undefined,
  chatcutLabel = "ChatCut",
): string {
  const name = (plugin?.name ?? "").trim();
  if (!name) return chatcutLabel;
  if (isChatCutInstalled([plugin!])) return chatcutLabel;
  return name;
}

/**
 * Default filter for installable catalog chips.
 * Prefers openai/plugins actual source name when present; else __all__.
 */
export function pickDefaultInstallableFilter(
  sources: readonly MarketplaceSourceLikeForMatch[] | null | undefined,
): string {
  const found = findOpenaiPluginsSource(sources ?? []);
  if (found?.name?.trim()) return found.name.trim();
  return "__all__";
}

export type EnsureOpenaiPluginsResult = {
  alreadyPresent: boolean;
  added: boolean;
  /** Configured source name when known. */
  sourceName: string | null;
  error: string | null;
};

export type EnsureOpenaiPluginsDeps = {
  list: () => Promise<{ sources?: MarketplaceSourceLikeForMatch[] | null } | MarketplaceSourceLikeForMatch[] | null | undefined>;
  add: (url: string) => Promise<unknown>;
  /** Optional refresh of one source after add; failures are ignored. */
  update?: (name: string | null) => Promise<unknown>;
};

function sourcesFromListResult(
  res:
    | { sources?: MarketplaceSourceLikeForMatch[] | null }
    | MarketplaceSourceLikeForMatch[]
    | null
    | undefined,
): MarketplaceSourceLikeForMatch[] {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  return Array.isArray(res.sources) ? res.sources : [];
}

/**
 * Ensure openai/plugins is configured. Idempotent; never removes other sources.
 * Soft-fails: returns error string instead of throwing.
 */
export async function ensureOpenaiPluginsMarketplace(
  deps: EnsureOpenaiPluginsDeps,
): Promise<EnsureOpenaiPluginsResult> {
  try {
    const listed = sourcesFromListResult(await deps.list());
    const existing = findOpenaiPluginsSource(listed);
    if (existing) {
      const name = (existing.name ?? "").trim() || null;
      if (deps.update && name) {
        try {
          await deps.update(name);
        } catch {
          /* optional update — do not block */
        }
      }
      return {
        alreadyPresent: true,
        added: false,
        sourceName: name,
        error: null,
      };
    }

    try {
      await deps.add(OPENAI_PLUGINS_MARKETPLACE_URL);
    } catch (e) {
      return {
        alreadyPresent: false,
        added: false,
        sourceName: null,
        error: String(e),
      };
    }

    // Re-list to learn actual name
    let after: MarketplaceSourceLikeForMatch[] = [];
    try {
      after = sourcesFromListResult(await deps.list());
    } catch {
      after = [];
    }
    const added = findOpenaiPluginsSource(after);
    const name = (added?.name ?? "").trim() || "openai/plugins";
    if (deps.update) {
      try {
        await deps.update(name);
      } catch {
        /* optional */
      }
    }
    return {
      alreadyPresent: false,
      added: true,
      sourceName: name,
      error: null,
    };
  } catch (e) {
    return {
      alreadyPresent: false,
      added: false,
      sourceName: null,
      error: String(e),
    };
  }
}

/**
 * Map legacy settings tab id `market` → `plugins` (deep-link / search compat).
 */
export function resolveExtensionsTabId(
  tab: string | null | undefined,
): "plugins" | "skills" | "mcp" | "agents" | "hooks" | "rules" | "commands" {
  const t = (tab ?? "").trim().toLowerCase();
  if (t === "market" || t === "apps" || !t) return "plugins";
  if (
    t === "skills" ||
    t === "mcp" ||
    t === "agents" ||
    t === "hooks" ||
    t === "rules" ||
    t === "commands"
  ) {
    return t;
  }
  if (t === "plugins") return "plugins";
  return "plugins";
}

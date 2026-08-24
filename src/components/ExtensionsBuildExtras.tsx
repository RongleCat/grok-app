/**
 * Settings → Extensions: Hooks list + Plugin marketplace browser + Agents list.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import { createT, type Locale, type MessageKey } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import { Select } from "@/components/Select";
import {
  IconExternalLink,
  IconFolder,
  IconHooks,
  IconPlus,
  IconPuzzle,
  IconRefresh,
  IconRobot,
  IconTrash,
} from "@/components/icons";
import { isCliMissingError, shortPathLabel } from "@/lib/extensionsUi";
import {
  agentMetaLine,
  agentScopeTone,
  isValidAgentFileStemName,
  sanitizeAgentFileStemName,
  sortAgentDefs,
  type AgentDefLike,
} from "@/lib/agentsDiscovery";
import {
  formatHookMtime,
  formatHookSize,
  hookMetaLine,
  hookRowKey,
  hookTypeLabel,
  sortHooksByScopeName,
  type HookLike,
} from "@/lib/hooksUi";
import {
  loadMarketplaceCatalog,
  invalidateMarketplaceCatalogCache,
  removeAvailablePluginFromCache,
} from "@/lib/marketplaceCatalogCache";
import {
  availablePluginDetailModel,
  availablePluginMetaLine,
  availablePluginRowKey,
  enrichAvailableFromComponents,
  filterAvailableByMarketplace,
  filterAvailablePlugins,
  filterPluginsByQuery,
  isXaiOfficialMarketplace,
  marketplaceQualifiedInstallSource,
  marketplaceRemoveTarget,
  marketplaceSourceLabel,
  normalizeMarketplaceAddSource,
  sortAvailablePluginsByName,
  sortMarketplaceSourcesByName,
  type AvailablePluginDetailModel,
  type AvailablePluginLike,
  type MarketplaceSourceLike,
  type PluginComponentBadgeKind,
} from "@/lib/pluginMarketplace";
import {
  buildInstalledPluginNameSet,
  isCatalogPluginInstalled,
} from "@/lib/pluginCatalogUi";
import {
  findOpenaiPluginsSource,
  pickDefaultInstallableFilter,
} from "@/lib/pluginRecommended";
import {
  ensureDefaultMarketplaces,
  filterCatalogToDefaultSources,
  isClaudeMarketplaceSource,
  isDefaultAllowedMarketplaceSource,
} from "@/lib/marketplaceDefaults";
import {
  buildPluginMarketErrorView,
  clearPluginMarketRowError,
  formatPluginMarketRowErrorMessage,
  planPluginMarketEmptyRetry,
  planPluginMarketRetry,
  pluginMarketErrorHintKey,
  pluginMarketErrorTitleKey,
  pluginMarketLoadIsSoftFail,
  resolvePluginCatalogEmptyState,
  setPluginMarketRowError,
  type PluginMarketRowError,
} from "@/lib/pluginMarketPro";

/** Actions the parent tab trail can host (Agents). */
export type ExtAgentsTabActions = {
  refresh: () => void;
  openNew: () => void;
  busy: boolean;
  loading: boolean;
};

export type ExtensionsBuildExtrasProps = {
  locale: Locale;
  projectPath?: string | null;
  cliFound?: boolean;
  /** Which block(s) to render — settings page tabs use market | agents. */
  mode?: "hooks" | "market" | "agents" | "all";
  /**
   * When true (plugins tab installable section), hide page-level market H2
   * and rely on parent section chrome.
   */
  embedded?: boolean;
  /** Sources management only (modal) — hide available catalog list. */
  sourcesOnly?: boolean;
  /** Soft-fail ensure openai/plugins error bubble (optional parent display). */
  onEnsureOpenaiError?: (message: string | null) => void;
  /** After plugin install — parent can refresh plugins list. */
  onPluginsChanged?: () => void;
  /** Navigate to Settings → Runtime when CLI is missing / too old. */
  onOpenRuntime?: () => void;
  /** Tab-level search query (Agents / market filter). */
  query?: string;
  /**
   * When true, hide the in-page Agents toolbar (actions live in the tab trail).
   */
  hidePageToolbar?: boolean;
  /** Register / clear Agents actions for the parent tab trail. */
  onTabActionsChange?: (actions: ExtAgentsTabActions | null) => void;
  /**
   * Installed plugin names (and optional marketplace/source/path) so catalog
   * rows can offer Reinstall and match “already installed” state — including
   * CLI hash-suffixed ids (e.g. game-studio-8978c99b ↔ game-studio).
   */
  installedPlugins?: Array<{
    name: string;
    marketplace?: string | null;
    path?: string | null;
    source?: string | null;
    repoKey?: string | null;
  }>;
};

const BADGE_LABEL_KEY: Record<PluginComponentBadgeKind, MessageKey> = {
  skills: "ext.market.badge.skills",
  hooks: "ext.market.badge.hooks",
  agents: "ext.market.badge.agents",
  mcp: "ext.market.badge.mcp",
};

const PAGE_SIZE = 40;

function asSource(raw: Record<string, unknown>): MarketplaceSourceLike | null {
  const name = String(raw.name ?? "").trim();
  if (!name) return null;
  return {
    name,
    kind: String(raw.kind ?? raw.type ?? "git").trim() || "git",
    url: (raw.url as string | null | undefined) ?? null,
    path: (raw.path as string | null | undefined) ?? null,
    branch: (raw.branch as string | null | undefined) ?? null,
  };
}

function asAvailable(raw: Record<string, unknown>): AvailablePluginLike | null {
  const name = String(raw.name ?? "").trim();
  if (!name) return null;
  const status = String(raw.status ?? "available").trim() || "available";
  const skillCountRaw =
    typeof raw.skillCount === "number"
      ? raw.skillCount
      : typeof raw.skill_count === "number"
        ? raw.skill_count
        : null;
  const enriched = enrichAvailableFromComponents(raw, {
    skillCount: skillCountRaw,
    hasHooks: !!(raw.hasHooks ?? raw.has_hooks),
    hasAgents: !!(raw.hasAgents ?? raw.has_agents),
    hasMcp: !!(raw.hasMcp ?? raw.has_mcp),
  });
  return {
    name,
    status,
    marketplace:
      (raw.marketplace as string | null | undefined) ??
      (raw.market as string | null | undefined) ??
      null,
    description: (raw.description as string | null | undefined) ?? null,
    version: (raw.version as string | null | undefined) ?? null,
    skillCount: enriched.skillCount,
    hasHooks: enriched.hasHooks,
    hasAgents: enriched.hasAgents,
    hasMcp: enriched.hasMcp,
  };
}

export function ExtensionsBuildExtras({
  locale,
  projectPath = null,
  cliFound = true,
  mode = "all",
  embedded = false,
  sourcesOnly = false,
  onEnsureOpenaiError,
  onPluginsChanged,
  onOpenRuntime,
  query = "",
  hidePageToolbar = false,
  onTabActionsChange,
  installedPlugins = [],
}: ExtensionsBuildExtrasProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const cliMissing = !cliFound;
  const showHooks = mode === "all" || mode === "hooks";
  const showMarket = mode === "all" || mode === "market";
  const showAgents = mode === "all" || mode === "agents";
  const q = query.trim().toLowerCase();

  const [hooks, setHooks] = useState<HookLike[]>([]);
  const [hooksError, setHooksError] = useState<string | null>(null);
  const [hooksLoading, setHooksLoading] = useState(true);
  const [hooksBusy, setHooksBusy] = useState<string | null>(null);

  const [agents, setAgents] = useState<AgentDefLike[]>([]);
  const [agentsUserDir, setAgentsUserDir] = useState("");
  const [agentsProjectDir, setAgentsProjectDir] = useState<string | null>(null);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsBusy, setAgentsBusy] = useState<string | null>(null);
  const [agentsHint, setAgentsHint] = useState<string | null>(null);
  const [newAgentOpen, setNewAgentOpen] = useState(false);
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentScope, setNewAgentScope] = useState<"user" | "project">(
    "user",
  );
  const [newAgentError, setNewAgentError] = useState<string | null>(null);
  const [overwriteTarget, setOverwriteTarget] = useState<{
    name: string;
    scope: "user" | "project";
  } | null>(null);

  const [sources, setSources] = useState<MarketplaceSourceLike[]>([]);
  const [available, setAvailable] = useState<AvailablePluginLike[]>([]);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketBusy, setMarketBusy] = useState<string | null>(null);
  const [addSource, setAddSource] = useState("");
  const [availQuery, setAvailQuery] = useState("");
  /** Default prefers openai/plugins when present (D8-A); set after load. */
  const [marketFilter, setMarketFilter] = useState<string>("__all__");
  const [ensureOpenaiError, setEnsureOpenaiError] = useState<string | null>(
    null,
  );
  const [pageLimit, setPageLimit] = useState(PAGE_SIZE);
  const [fromCache, setFromCache] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [removeSource, setRemoveSource] = useState<MarketplaceSourceLike | null>(
    null,
  );
  /** Catalog row opened in the detail drawer (rich panel, not install stub). */
  const [detailPlugin, setDetailPlugin] = useState<AvailablePluginLike | null>(
    null,
  );
  /** Confirm step after Install / Reinstall from detail or row. */
  const [installTarget, setInstallTarget] =
    useState<AvailablePluginLike | null>(null);
  /** Per-plugin last install/update error (row + detail Retry). */
  const [installErrors, setInstallErrors] = useState<
    Record<string, PluginMarketRowError>
  >({});

  const installedNameSet = useMemo(
    () => buildInstalledPluginNameSet(installedPlugins),
    [installedPlugins],
  );

  const isPluginInstalled = useCallback(
    (p: AvailablePluginLike) => {
      const detail = availablePluginDetailModel(p);
      if (detail.isInstalled) return true;
      return isCatalogPluginInstalled(p.name, installedNameSet);
    },
    [installedNameSet],
  );

  const badgeLabel = useCallback(
    (kind: PluginComponentBadgeKind, count?: number | null) => {
      const base = tr(BADGE_LABEL_KEY[kind]);
      if (kind === "skills" && typeof count === "number" && count > 0) {
        return tr("ext.market.badge.skillsCount", { n: String(count) });
      }
      return base;
    },
    [tr],
  );

  const detailModel: AvailablePluginDetailModel | null = useMemo(
    () => (detailPlugin ? availablePluginDetailModel(detailPlugin) : null),
    [detailPlugin],
  );

  const loadHooks = useCallback(async () => {
    if (!api.isTauri()) {
      setHooks([]);
      setHooksLoading(false);
      return;
    }
    setHooksLoading(true);
    setHooksError(null);
    try {
      const res = await api.hooksList(projectPath);
      const list = sortHooksByScopeName(
        (res.hooks ?? []).map(
          (h): HookLike => ({
            name: h.name,
            path: h.path,
            scope: h.scope,
            kind: h.kind,
            ext: h.ext,
            size: h.size ?? 0,
            mtimeMs: h.mtimeMs ?? 0,
          }),
        ),
      );
      setHooks(list);
    } catch (e) {
      setHooks([]);
      setHooksError(String(e));
    } finally {
      setHooksLoading(false);
    }
  }, [projectPath]);

  const loadAgents = useCallback(async () => {
    if (!api.isTauri()) {
      setAgents([]);
      setAgentsLoading(false);
      return;
    }
    setAgentsLoading(true);
    setAgentsError(null);
    try {
      const res = await api.agentsList(projectPath);
      const list = sortAgentDefs(
        (res.agents ?? []).map(
          (a): AgentDefLike => ({
            name: a.name,
            path: a.path,
            scope: (a.scope as AgentDefLike["scope"]) || "user",
            description: a.description ?? null,
          }),
        ),
      );
      setAgents(list);
      setAgentsUserDir(res.userAgentsDir || "");
      setAgentsProjectDir(res.projectAgentsDir ?? null);
    } catch (e) {
      setAgents([]);
      setAgentsError(String(e));
    } finally {
      setAgentsLoading(false);
    }
  }, [projectPath]);

  const revealAgentPath = useCallback(
    async (path: string | null | undefined) => {
      const p = (path ?? "").trim();
      if (!p || !api.isTauri()) return;
      try {
        await api.pathReveal(p);
      } catch (e) {
        setAgentsError(String(e));
      }
    },
    [],
  );

  const openAgentFile = useCallback(async (path: string | null | undefined) => {
    const p = (path ?? "").trim();
    if (!p || !api.isTauri()) return;
    try {
      await api.openInEditor({ path: p });
    } catch (e) {
      // Fallback: reveal in folder when no editor is configured.
      try {
        await api.pathReveal(p);
      } catch (e2) {
        setAgentsError(String(e2 || e));
      }
    }
  }, []);

  const runScaffold = useCallback(
    async (opts: {
      name: string;
      scope: "user" | "project";
      force?: boolean;
    }) => {
      if (!api.isTauri()) return;
      let stem: string;
      try {
        stem = sanitizeAgentFileStemName(opts.name);
      } catch {
        setNewAgentError(tr("ext.agents.nameInvalid"));
        return;
      }
      if (opts.scope === "project" && !projectPath?.trim()) {
        setNewAgentError(tr("ext.agents.needProject"));
        return;
      }
      setAgentsBusy("scaffold");
      setNewAgentError(null);
      setAgentsHint(null);
      try {
        const res = await api.agentsScaffold({
          name: stem,
          scope: opts.scope,
          projectPath,
          force: opts.force ?? false,
        });
        setNewAgentOpen(false);
        setOverwriteTarget(null);
        setNewAgentName("");
        await loadAgents();
        setAgentsHint(
          res.overwritten
            ? tr("ext.agents.overwritten", { name: res.name })
            : tr("ext.agents.created", { name: res.name }),
        );
        if (res.path) {
          void openAgentFile(res.path);
        }
      } catch (e) {
        const msg = String(e || "");
        if (/already exists/i.test(msg) && !opts.force) {
          setOverwriteTarget({ name: stem, scope: opts.scope });
          setNewAgentError(null);
        } else if (/required|invalid|letters|reserved|long|path/i.test(msg)) {
          setNewAgentError(tr("ext.agents.nameInvalid"));
        } else {
          setNewAgentError(msg || tr("ext.agents.createError"));
        }
      } finally {
        setAgentsBusy(null);
      }
    },
    [loadAgents, openAgentFile, projectPath, tr],
  );

  const submitNewAgent = useCallback(() => {
    void runScaffold({
      name: newAgentName,
      scope: newAgentScope,
      force: false,
    });
  }, [newAgentName, newAgentScope, runScaffold]);

  const loadMarket = useCallback(async (force = false) => {
    // Soft-fail: no CLI / non-desktop — never hard-crash the marketplace tab.
    if (!api.isTauri() || cliMissing) {
      setSources([]);
      setAvailable([]);
      setMarketLoading(false);
      setMarketError(null);
      setFromCache(false);
      return;
    }
    setMarketLoading(true);
    setMarketError(null);
    try {
      // Default sources: xAI + openai; remove Claude sources (soft-fail).
      const ensure = await ensureDefaultMarketplaces({
        list: async () => {
          const r = await api.marketplaceList();
          return (r.sources ?? [])
            .map((row) => asSource(row as Record<string, unknown>))
            .filter((x): x is MarketplaceSourceLike => !!x)
            .map((s) => ({
              name: s.name,
              url: s.url,
              path: s.path,
              kind: s.kind,
            }));
        },
        add: async (url) => {
          await api.marketplaceAdd(url);
        },
        remove: async (nameOrUrl) => {
          await api.marketplaceRemove(nameOrUrl);
        },
        removeClaude: true,
      });
      const ensureErr =
        ensure.errors.length > 0 ? ensure.errors.join("; ") : null;
      setEnsureOpenaiError(ensureErr);
      onEnsureOpenaiError?.(ensureErr);
      if (ensure.added.length || ensure.removed.length || force) {
        invalidateMarketplaceCatalogCache();
      }

      const result = await loadMarketplaceCatalog(async () => {
        const [srcRes, availRes] = await Promise.all([
          api.marketplaceList(),
          api.marketplaceAvailable(),
        ]);
        const err =
          srcRes.error?.trim() || availRes.error?.trim() || null;
        const src = sortMarketplaceSourcesByName(
          (srcRes.sources ?? [])
            .map((r) => asSource(r as Record<string, unknown>))
            .filter((x): x is MarketplaceSourceLike => !!x)
            // Keep only default-allowed sources in the UI list.
            .filter(
              (s) =>
                isDefaultAllowedMarketplaceSource(s) ||
                !isClaudeMarketplaceSource(s),
            )
            .filter((s) => !isClaudeMarketplaceSource(s)),
        );
        let avail = sortAvailablePluginsByName(
          filterAvailablePlugins(
            (availRes.plugins ?? [])
              .map((r) => asAvailable(r as Record<string, unknown>))
              .filter((x): x is AvailablePluginLike => !!x),
          ),
        );
        avail = filterCatalogToDefaultSources(avail, src);
        return { sources: src, available: avail, error: err };
      }, { force: force || ensure.added.length > 0 || ensure.removed.length > 0 });

      setSources(result.sources.filter((s) => !isClaudeMarketplaceSource(s)));
      setAvailable(
        filterCatalogToDefaultSources(result.available, result.sources),
      );
      setFromCache(result.fromCache);
      // Soft-fail capability gaps are presented via empty-state, not only a banner.
      if (result.error) setMarketError(result.error);

      // Prefer openai/plugins when present; keep user chip if still valid.
      setMarketFilter((prev) => {
        if (prev && prev !== "__all__" && result.sources.some((s) => s.name === prev)) {
          return prev;
        }
        return pickDefaultInstallableFilter(result.sources);
      });
    } catch (e) {
      setSources([]);
      setAvailable([]);
      setMarketError(String(e));
    } finally {
      setMarketLoading(false);
    }
  }, [cliMissing, onEnsureOpenaiError]);

  useEffect(() => {
    if (showHooks) void loadHooks();
  }, [loadHooks, showHooks]);

  useEffect(() => {
    if (showMarket) void loadMarket(false);
  }, [loadMarket, showMarket]);

  useEffect(() => {
    if (showAgents) void loadAgents();
  }, [loadAgents, showAgents]);

  const marketChips = useMemo(() => {
    const chips: { id: string; label: string }[] = [];
    const openai = findOpenaiPluginsSource(sources);
    if (openai?.name) {
      chips.push({
        id: openai.name,
        label: openai.name,
      });
    }
    chips.push({ id: "__all__", label: tr("ext.market.filterAll") });
    const seen = new Set(chips.map((c) => c.id));
    for (const s of sources) {
      if (!s.name || seen.has(s.name)) continue;
      seen.add(s.name);
      chips.push({ id: s.name, label: s.name });
    }
    // Prefer xAI chip label when it is the official catalog
    return chips.map((c) =>
      isXaiOfficialMarketplace(c.id)
        ? { ...c, label: tr("ext.market.filterOfficial") }
        : c,
    );
  }, [sources, tr]);

  const filteredByMarket = useMemo(
    () => filterAvailableByMarketplace(available, marketFilter),
    [available, marketFilter],
  );

  const filteredAvailable = useMemo(() => {
    return filterPluginsByQuery(filteredByMarket, availQuery);
  }, [filteredByMarket, availQuery]);

  const visibleAvailable = useMemo(
    () => filteredAvailable.slice(0, pageLimit),
    [filteredAvailable, pageLimit],
  );

  const hasMore = filteredAvailable.length > visibleAvailable.length;

  /** Honest catalog empty / soft-fail presentation (null when rows visible). */
  const catalogEmpty = useMemo(
    () =>
      resolvePluginCatalogEmptyState({
        loading: marketLoading,
        cliFound,
        error: marketError,
        sourceCount: sources.length,
        availableCount: available.length,
        visibleCount: visibleAvailable.length,
        marketFilter,
        query: availQuery,
      }),
    [
      marketLoading,
      cliFound,
      marketError,
      sources.length,
      available.length,
      visibleAvailable.length,
      marketFilter,
      availQuery,
    ],
  );

  /** Classified load error for optional banner (suppress when empty-state owns it). */
  const marketLoadView = useMemo(() => {
    if (!marketError?.trim()) return null;
    return buildPluginMarketErrorView(marketError, "list");
  }, [marketError]);

  /**
   * Show a top banner only when:
   * - empty-state does not already own the same soft/hard story, or
   * - we have visible rows but a soft residual error (e.g. partial cache).
   */
  const showMarketErrorBanner = useMemo(() => {
    if (!marketLoadView) return false;
    if (catalogEmpty) {
      // Empty-state already explains cli/offline/error — skip duplicate hard banner
      // unless the empty kind is filter/query (load succeeded).
      if (
        catalogEmpty.kind === "empty_filter" ||
        catalogEmpty.kind === "empty_query" ||
        catalogEmpty.kind === "empty_catalog" ||
        catalogEmpty.kind === "no_sources" ||
        catalogEmpty.kind === "loading"
      ) {
        // Residual load error with an otherwise empty-but-ok catalog shape.
        return !catalogEmpty.softFail && !!marketError;
      }
      return false;
    }
    return true;
  }, [marketLoadView, catalogEmpty, marketError]);

  useEffect(() => {
    setPageLimit(PAGE_SIZE);
  }, [marketFilter, availQuery]);

  const openHooksDir = async (
    scope: "user" | "project",
    create: boolean,
  ) => {
    if (scope === "project" && !projectPath?.trim()) return;
    setHooksBusy(scope === "user" ? "open-user" : "open-project");
    try {
      await api.hooksOpenDir({
        scope,
        projectPath,
        create,
      });
      await loadHooks();
    } catch (e) {
      setHooksError(String(e));
    } finally {
      setHooksBusy(null);
    }
  };

  const revealHook = async (path: string) => {
    setHooksBusy(`reveal:${path}`);
    try {
      await api.hooksReveal(path);
    } catch (e) {
      setHooksError(String(e));
    } finally {
      setHooksBusy(null);
    }
  };

  const addMarketplace = async () => {
    let source: string;
    try {
      source = normalizeMarketplaceAddSource(addSource);
    } catch {
      setMarketError(tr("ext.market.addEmpty"));
      return;
    }
    setMarketBusy("add");
    setMarketError(null);
    try {
      const res = await api.marketplaceAdd(source);
      if (res && typeof res === "object" && "ok" in res && res.ok === false) {
        setMarketError(res.error?.trim() || tr("ext.market.error"));
        return;
      }
      setAddSource("");
      invalidateMarketplaceCatalogCache();
      await loadMarket(true);
    } catch (e) {
      setMarketError(String(e));
    } finally {
      setMarketBusy(null);
    }
  };

  const confirmRemoveSource = async () => {
    if (!removeSource) return;
    const target = marketplaceRemoveTarget(removeSource) || removeSource.name;
    setMarketBusy(`rm:${removeSource.name}`);
    setMarketError(null);
    try {
      const res = await api.marketplaceRemove(target);
      if (res && typeof res === "object" && "ok" in res && res.ok === false) {
        setMarketError(res.error?.trim() || tr("ext.market.error"));
        return;
      }
      setRemoveSource(null);
      invalidateMarketplaceCatalogCache();
      await loadMarket(true);
    } catch (e) {
      setMarketError(String(e));
    } finally {
      setMarketBusy(null);
    }
  };

  const refreshSources = async (name?: string | null) => {
    setMarketBusy(name ? `up:${name}` : "up:all");
    setMarketError(null);
    try {
      const res = await api.marketplaceUpdate(name ?? null);
      if (res && typeof res === "object" && "ok" in res && res.ok === false) {
        setMarketError(res.error?.trim() || tr("ext.market.error"));
        return;
      }
      invalidateMarketplaceCatalogCache();
      await loadMarket(true);
    } catch (e) {
      setMarketError(String(e));
    } finally {
      setMarketBusy(null);
    }
  };

  const runInstall = async (
    target: AvailablePluginLike,
    opts?: { closeConfirm?: boolean },
  ) => {
    const rowKey = availablePluginRowKey(target);
    const source = marketplaceQualifiedInstallSource(
      target.name,
      target.marketplace,
    );
    setMarketBusy(`inst:${rowKey}`);
    // Install failures stick to the row — do not escalate soft CLI gaps to a hard global banner.
    setMarketError(null);
    try {
      const res = await api.pluginInstall(source);
      if (res && typeof res === "object" && "ok" in res && res.ok === false) {
        const err =
          (res as { error?: string; message?: string; reason?: string })
            .error?.trim() ||
          (res as { message?: string }).message?.trim() ||
          (res as { reason?: string }).reason?.trim() ||
          tr("ext.market.error");
        setInstallErrors((prev) =>
          setPluginMarketRowError(prev, rowKey, err, "install"),
        );
        if (opts?.closeConfirm !== false) setInstallTarget(null);
        return;
      }
      setInstallErrors((prev) => clearPluginMarketRowError(prev, rowKey));
      removeAvailablePluginFromCache(target.name, target.marketplace);
      setAvailable((prev) =>
        prev.filter(
          (p) =>
            !(
              p.name === target.name &&
              (p.marketplace ?? "") === (target.marketplace ?? "")
            ),
        ),
      );
      setInstallTarget(null);
      setDetailPlugin(null);
      onPluginsChanged?.();
    } catch (e) {
      setInstallErrors((prev) =>
        setPluginMarketRowError(prev, rowKey, e, "install"),
      );
      if (opts?.closeConfirm !== false) setInstallTarget(null);
    } finally {
      setMarketBusy(null);
    }
  };

  const clearCatalogFilters = () => {
    setAvailQuery("");
    setMarketFilter("__all__");
  };

  const runEmptyRetry = (action: ReturnType<typeof planPluginMarketEmptyRetry>["action"]) => {
    if (action === "retry_load" || action === "refresh_catalog") {
      void loadMarket(true);
      return;
    }
    if (action === "clear_filter") {
      clearCatalogFilters();
      return;
    }
    if (action === "open_runtime" || action === "update_cli") {
      onOpenRuntime?.();
    }
  };

  const rowErrorLabel = (row: PluginMarketRowError): string => {
    const title = tr(pluginMarketErrorTitleKey(row.kind) as MessageKey);
    return formatPluginMarketRowErrorMessage(row, {
      title,
      includeDetail: row.kind === "other" || row.kind === "host_error",
    });
  };

  const rowRetryLabel = (row: PluginMarketRowError): string => {
    const plan = planPluginMarketRetry(row.kind, "install");
    if (plan.action === "open_runtime") return tr("ext.error.openRuntime");
    if (plan.action === "update_cli") return tr("ext.market.openRuntimeCli");
    if (plan.action === "retry_install" && row.kind === "already_installed") {
      return tr("ext.market.reinstall");
    }
    return tr("ext.market.retry");
  };

  const runRowRetry = (target: AvailablePluginLike, row: PluginMarketRowError) => {
    const plan = planPluginMarketRetry(row.kind, "install");
    if (plan.action === "open_runtime" || plan.action === "update_cli") {
      onOpenRuntime?.();
      return;
    }
    if (plan.canRetry) {
      void retryInstall(target);
    }
  };

  const confirmInstall = async () => {
    if (!installTarget) return;
    await runInstall(installTarget);
  };

  const retryInstall = async (target: AvailablePluginLike) => {
    await runInstall(target, { closeConfirm: true });
  };

  const openDetail = (p: AvailablePluginLike) => {
    setDetailPlugin(p);
  };

  const requestInstall = (p: AvailablePluginLike) => {
    setInstallTarget(p);
  };

  const scopeLabel = (scope: string) => {
    if (scope === "project") return tr("ext.hooks.scope.project");
    if (scope === "bundled" || scope === "builtin") {
      return tr("ext.agents.scope.bundled");
    }
    return tr("ext.hooks.scope.user");
  };

  const agentNamePreview = useMemo(() => {
    try {
      return sanitizeAgentFileStemName(newAgentName);
    } catch {
      return "";
    }
  }, [newAgentName]);

  const canSubmitNewAgent =
    isValidAgentFileStemName(newAgentName) &&
    (newAgentScope !== "project" || !!projectPath?.trim()) &&
    agentsBusy !== "scaffold";

  const openNewAgentDialog = useCallback(() => {
    setNewAgentError(null);
    setAgentsHint(null);
    setNewAgentName("");
    setNewAgentScope(projectPath?.trim() ? "project" : "user");
    setNewAgentOpen(true);
  }, [projectPath]);

  useEffect(() => {
    if (!showAgents || !onTabActionsChange) return;
    onTabActionsChange({
      refresh: () => {
        void loadAgents();
      },
      openNew: openNewAgentDialog,
      busy: !!agentsBusy,
      loading: agentsLoading,
    });
    return () => onTabActionsChange(null);
  }, [
    showAgents,
    onTabActionsChange,
    loadAgents,
    openNewAgentDialog,
    agentsBusy,
    agentsLoading,
  ]);

  const filteredAgents = useMemo(() => {
    if (!q) return agents;
    return agents.filter((a) => {
      const hay = [a.name, a.description ?? "", a.scope, a.path ?? ""]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [agents, q]);

  const agentsByScope = useMemo(() => {
    const groups: {
      key: "project" | "user" | "bundled";
      label: string;
      items: AgentDefLike[];
    }[] = [
      {
        key: "project",
        label: tr("ext.agents.group.project"),
        items: [],
      },
      {
        key: "user",
        label: tr("ext.agents.group.user"),
        items: [],
      },
      {
        key: "bundled",
        label: tr("ext.agents.group.bundled"),
        items: [],
      },
    ];
    for (const a of filteredAgents) {
      const g =
        a.scope === "project"
          ? groups[0]
          : a.scope === "bundled"
            ? groups[2]
            : groups[1];
      g.items.push(a);
    }
    return groups.filter((g) => g.items.length > 0);
  }, [filteredAgents, tr]);

  const renderAgentRow = (a: AgentDefLike) => {
    const tone = agentScopeTone(a.scope);
    const editable = a.path && a.scope !== "bundled";
    return (
      <li
        key={`${a.scope}:${a.name}:${a.path}`}
        className="ext-ref-row ext-ref-row--dense"
      >
        <div className="ext-ref-row__main">
          <div className="ext-ref-row__icon" aria-hidden>
            <IconRobot size={14} />
          </div>
          <div className="ext-ref-row__body">
            <div className="ext-ref-row__title">{a.name}</div>
            <div className="ext-ref-row__desc">
              {a.description?.trim() ||
                agentMetaLine({ scope: a.scope, description: null }) ||
                "—"}
            </div>
            <div className="ext-ref-row__meta">
              <span className={`ext-ref-badge ext-badge--${tone}`}>
                {scopeLabel(a.scope)}
              </span>
              {a.path ? (
                <span className="ext-ref-block__meta" title={a.path}>
                  {shortPathLabel(a.path, 36)}
                </span>
              ) : null}
            </div>
          </div>
          <div className="ext-ref-row__end">
            {editable ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={!!agentsBusy}
                onClick={() => void openAgentFile(a.path)}
              >
                <IconExternalLink size={13} />
                <span>{tr("ext.agents.open")}</span>
              </button>
            ) : null}
            {a.path ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={!!agentsBusy}
                title={a.path}
                onClick={() => void revealAgentPath(a.path)}
              >
                <IconFolder size={13} />
                <span>{tr("ext.agents.reveal")}</span>
              </button>
            ) : null}
          </div>
        </div>
      </li>
    );
  };

  return (
    <>
      {/* ── Agents ── */}
      {showAgents ? (
        <>
          <div
            className="ext-ref-stack"
            id="settings-anchor-ext-agents"
            data-testid="ext-agents-panel"
          >
            {!hidePageToolbar ? (
              <div className="ext-ref-block__head ext-ref-toolbar">
                <span className="ext-ref-block__actions">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={!!agentsBusy}
                    onClick={() => void loadAgents()}
                  >
                    <IconRefresh size={14} />
                    <span>
                      {agentsBusy === "scaffold"
                        ? tr("ext.agents.creating")
                        : tr("ext.refresh")}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn btn--solid btn--sm"
                    disabled={!!agentsBusy}
                    onClick={openNewAgentDialog}
                  >
                    <IconPlus size={14} />
                    <span>{tr("ext.agents.new")}</span>
                  </button>
                </span>
              </div>
            ) : null}

            <section className="ext-ref-block">
              <div className="ext-ref-section-label">
                {tr("ext.agents.locationsTitle")}
              </div>
              <div className="ext-ref-dir-bar">
                <div className="ext-ref-dir-group">
                  <span className="ext-ref-dir-group__label">
                    {tr("ext.agents.group.user")}
                  </span>
                  <div className="ext-ref-dir-group__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={!!agentsBusy || !agentsUserDir}
                      title={agentsUserDir || undefined}
                      onClick={() => void revealAgentPath(agentsUserDir)}
                    >
                      <IconFolder size={13} />
                      <span>{tr("ext.agents.openUser")}</span>
                    </button>
                  </div>
                </div>
                <div className="ext-ref-dir-group">
                  <span className="ext-ref-dir-group__label">
                    {tr("ext.agents.group.project")}
                  </span>
                  <div className="ext-ref-dir-group__actions">
                    {projectPath?.trim() && agentsProjectDir ? (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={!!agentsBusy}
                        title={agentsProjectDir}
                        onClick={() => void revealAgentPath(agentsProjectDir)}
                      >
                        <IconFolder size={13} />
                        <span>{tr("ext.agents.openProject")}</span>
                      </button>
                    ) : (
                      <span className="ext-ref-block__meta">
                        {tr("ext.agents.needProjectHint")}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {agentsError ? (
              <div className="ext-alert ext-alert--error" role="alert">
                <div className="ext-alert__title">{tr("ext.agents.error")}</div>
                <p className="ext-alert__body">{agentsError}</p>
              </div>
            ) : null}
            {agentsHint ? (
              <p className="ext-ref-block__lead" role="status">
                {agentsHint}
              </p>
            ) : null}

            {agentsLoading ? (
              <p className="ext-ref-empty">{tr("ext.agents.loading")}</p>
            ) : agents.length === 0 ? (
              <p className="ext-ref-empty">{tr("ext.agents.empty")}</p>
            ) : filteredAgents.length === 0 ? (
              <p className="ext-ref-empty">{tr("ext.plugins.filterEmpty")}</p>
            ) : (
              agentsByScope.map((group) => (
                <section key={group.key} className="ext-ref-block">
                  <div className="ext-ref-section-label">
                    {group.label}
                    <span className="ext-ref-cat-group__count">
                      {group.items.length}
                    </span>
                  </div>
                  <ul className="ext-ref-list">
                    {group.items.map(renderAgentRow)}
                  </ul>
                </section>
              ))
            )}
          </div>

          <GlassModal
            open={newAgentOpen}
            onClose={() => {
              if (agentsBusy !== "scaffold") setNewAgentOpen(false);
            }}
            title={tr("ext.agents.newTitle")}
            size="md"
            closeLabel={tr("common.close")}
            wrapBody
            footer={
              <>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={agentsBusy === "scaffold"}
                  onClick={() => setNewAgentOpen(false)}
                >
                  {tr("common.cancel")}
                </button>
                <button
                  type="button"
                  className="btn btn--solid"
                  disabled={!canSubmitNewAgent}
                  onClick={() => submitNewAgent()}
                >
                  {agentsBusy === "scaffold"
                    ? tr("ext.agents.creating")
                    : tr("ext.agents.create")}
                </button>
              </>
            }
          >
            <form
              className="app-dialog__form"
              onSubmit={(e) => {
                e.preventDefault();
                if (canSubmitNewAgent) submitNewAgent();
              }}
            >
              <p className="ext-field-hint">{tr("ext.agents.newHint")}</p>
              <label className="field">
                <span>{tr("ext.agents.name")}</span>
                <input
                  className="app-dialog__input"
                  value={newAgentName}
                  onChange={(e) => {
                    setNewAgentName(e.target.value);
                    setNewAgentError(null);
                  }}
                  placeholder={tr("ext.agents.namePlaceholder")}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={agentsBusy === "scaffold"}
                  autoFocus
                />
                {agentNamePreview && agentNamePreview !== newAgentName.trim() ? (
                  <span className="ext-field-hint">
                    {tr("ext.agents.namePreview", { name: agentNamePreview })}
                  </span>
                ) : null}
              </label>
              <label className="field">
                <span>{tr("ext.agents.scope")}</span>
                <Select
                  value={newAgentScope}
                  aria-label={tr("ext.agents.scope")}
                  disabled={agentsBusy === "scaffold"}
                  onChange={(v) => {
                    setNewAgentScope(v === "project" ? "project" : "user");
                    setNewAgentError(null);
                  }}
                  options={[
                    {
                      value: "user",
                      label: tr("ext.agents.scope.user"),
                    },
                    {
                      value: "project",
                      label: tr("ext.agents.scope.project"),
                      disabled: !projectPath?.trim(),
                    },
                  ]}
                />
                {!projectPath?.trim() ? (
                  <span className="ext-field-hint">
                    {tr("ext.agents.needProjectHint")}
                  </span>
                ) : null}
              </label>
              {newAgentError ? (
                <div className="ext-alert ext-alert--error" role="alert">
                  <p className="ext-alert__body">{newAgentError}</p>
                </div>
              ) : null}
            </form>
          </GlassModal>

          <GlassModal
            open={!!overwriteTarget}
            onClose={() => {
              if (agentsBusy !== "scaffold") setOverwriteTarget(null);
            }}
            title={tr("ext.agents.overwriteTitle")}
            size="sm"
            closeLabel={tr("common.close")}
            footer={
              <>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={agentsBusy === "scaffold"}
                  onClick={() => setOverwriteTarget(null)}
                >
                  {tr("common.cancel")}
                </button>
                <button
                  type="button"
                  className="btn btn--solid"
                  disabled={agentsBusy === "scaffold"}
                  onClick={() => {
                    if (!overwriteTarget) return;
                    void runScaffold({
                      name: overwriteTarget.name,
                      scope: overwriteTarget.scope,
                      force: true,
                    });
                  }}
                >
                  {agentsBusy === "scaffold"
                    ? tr("ext.agents.creating")
                    : tr("ext.agents.overwrite")}
                </button>
              </>
            }
          >
            <p className="app-dialog__msg">
              {tr("ext.agents.overwriteBody", {
                name: overwriteTarget?.name ?? "",
              })}
            </p>
          </GlassModal>
        </>
      ) : null}

      {/* ── Hooks ── */}
      {showHooks ? (
        <>
          <h2 className="settings-page__h2" id="settings-anchor-ext-hooks">
            <IconHooks size={15} />
            {tr("ext.hooks.title")}
            {!hooksLoading ? (
              <span className="ext-count">{hooks.length}</span>
            ) : null}
          </h2>
          <div className={embedded ? "ext-card" : "settings-card ext-card"}>
            <p className="ext-section-note ext-section-note--top">
              {tr("ext.hooks.desc")}
            </p>
            <div className="ext-folder-actions">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={!!hooksBusy || cliMissing}
                onClick={() => void openHooksDir("user", false)}
              >
                <IconFolder size={13} />
                <span>
                  {hooksBusy === "open-user"
                    ? tr("ext.plugins.working")
                    : tr("ext.hooks.openUser")}
                </span>
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={!!hooksBusy || cliMissing}
                onClick={() => void openHooksDir("user", true)}
              >
                <IconPlus size={13} />
                <span>{tr("ext.hooks.createUser")}</span>
              </button>
              {projectPath?.trim() ? (
                <>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={!!hooksBusy || cliMissing}
                    onClick={() => void openHooksDir("project", false)}
                  >
                    <IconFolder size={13} />
                    <span>
                      {hooksBusy === "open-project"
                        ? tr("ext.plugins.working")
                        : tr("ext.hooks.openProject")}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={!!hooksBusy || cliMissing}
                    onClick={() => void openHooksDir("project", true)}
                  >
                    <IconPlus size={13} />
                    <span>{tr("ext.hooks.createProject")}</span>
                  </button>
                </>
              ) : (
                <span className="ext-field-hint">{tr("ext.hooks.emptyProject")}</span>
              )}
            </div>
            {hooksError ? (
              <div className="ext-alert ext-alert--error" role="alert">
                <div className="ext-alert__title">{tr("ext.hooks.error")}</div>
                <p className="ext-alert__body">
                  {isCliMissingError(hooksError)
                    ? tr("ext.error.cliBody")
                    : hooksError}
                </p>
              </div>
            ) : null}
            {hooksLoading ? (
              <p className="ext-empty">{tr("ext.hooks.loading")}</p>
            ) : hooks.length === 0 ? (
              <p className="ext-empty">{tr("ext.hooks.empty")}</p>
            ) : (
              <ul className="ext-list">
                {hooks.map((h) => (
                  <li key={hookRowKey(h)} className="ext-item">
                    <div className="ext-item__head">
                      <strong className="ext-item__name">{h.name}</strong>
                      <span className="ext-badge ext-badge--muted">
                        {scopeLabel(h.scope)}
                      </span>
                      <span className="ext-badge ext-badge--muted">
                        {hookTypeLabel(h)}
                      </span>
                    </div>
                    <div className="ext-item__meta">
                      <span>{hookMetaLine(h)}</span>
                      <span>
                        {formatHookSize(h.size)} · {formatHookMtime(h.mtimeMs)}
                      </span>
                      {h.path ? (
                        <button
                          type="button"
                          className="ext-path-btn"
                          title={h.path}
                          onClick={() => void revealHook(h.path)}
                        >
                          <IconExternalLink size={13} />
                          <span>{tr("ext.hooks.reveal")}</span>
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}

      {/* ── Marketplace / installable catalog ── */}
      {showMarket ? (
        <div
          className={
            "ext-ref-catalog" + (embedded ? " ext-ref-catalog--embedded" : "")
          }
          id={
            embedded
              ? "settings-anchor-ext-plugins-catalog"
              : "settings-anchor-ext-market"
          }
        >
          {!embedded ? (
            <h2 className="settings-page__h2" id="settings-anchor-ext-market">
              <IconPuzzle size={15} />
              {tr("ext.market.title")}
              {!marketLoading ? (
                <span className="ext-count">{filteredByMarket.length}</span>
              ) : null}
              <button
                type="button"
                className="btn btn--ghost ext-bulk-btn"
                disabled={marketLoading || !!marketBusy || cliMissing}
                onClick={() => void loadMarket(true)}
                title={fromCache ? tr("ext.market.cachedHint") : undefined}
              >
                <IconRefresh size={14} />
                <span>
                  {marketBusy === "up:all" || marketLoading
                    ? tr("ext.market.updating")
                    : tr("ext.market.refreshCatalog")}
                </span>
              </button>
            </h2>
          ) : null}
          <div className="settings-card ext-card">
            {embedded ? (
              <div className="ext-ref-block__actions" style={{ justifyContent: "flex-end", marginBottom: 4 }}>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={marketLoading || !!marketBusy || cliMissing}
                  onClick={() => void loadMarket(true)}
                  title={fromCache ? tr("ext.market.cachedHint") : undefined}
                >
                  <IconRefresh size={13} />
                  <span>
                    {marketBusy === "up:all" || marketLoading
                      ? tr("ext.market.updating")
                      : tr("ext.market.refreshCatalog")}
                  </span>
                </button>
              </div>
            ) : null}
            {ensureOpenaiError ? (
              <div className="ext-alert ext-alert--warn" role="status">
                <div className="ext-alert__title">
                  {tr("ext.plugins.ensureOpenaiFailed")}
                </div>
                <p className="ext-alert__body">
                  {tr("ext.plugins.ensureOpenaiFailedHint")}
                </p>
                <p className="ext-alert__detail">{ensureOpenaiError}</p>
              </div>
            ) : null}
            {showMarketErrorBanner && marketLoadView ? (
              <div
                className={
                  "ext-alert" +
                  (marketLoadView.softFail ||
                  pluginMarketLoadIsSoftFail(marketError)
                    ? " ext-alert--warn"
                    : " ext-alert--error")
                }
                role={marketLoadView.softFail ? "status" : "alert"}
              >
                <div className="ext-alert__title">
                  {tr(pluginMarketErrorTitleKey(marketLoadView.kind) as MessageKey)}
                </div>
                <p className="ext-alert__body">
                  {tr(pluginMarketErrorHintKey(marketLoadView.kind) as MessageKey)}
                </p>
                {marketLoadView.detail ? (
                  <p className="ext-alert__detail">{marketLoadView.detail}</p>
                ) : null}
                {marketLoadView.softFail && onOpenRuntime ? (
                  <button
                    type="button"
                    className="btn btn--solid ext-alert__cta"
                    onClick={onOpenRuntime}
                  >
                    {tr("ext.error.openRuntime")}
                  </button>
                ) : !marketLoadView.softFail ? (
                  <button
                    type="button"
                    className="btn btn--ghost ext-alert__cta"
                    disabled={marketLoading || !!marketBusy}
                    onClick={() => void loadMarket(true)}
                  >
                    {tr("ext.market.retry")}
                  </button>
                ) : null}
              </div>
            ) : null}

            {!sourcesOnly ? (
            <>
            <div className="ext-market-browse">
              <div
                className="ext-plugin-filters"
                role="tablist"
                aria-label={tr("ext.market.filterLabel")}
              >
                {marketChips.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    role="tab"
                    aria-selected={marketFilter === chip.id}
                    className={
                      "ext-plugin-filter" +
                      (marketFilter === chip.id ? " is-active" : "")
                    }
                    onClick={() => setMarketFilter(chip.id)}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
              <input
                type="search"
                className="settings-input ext-market-browse__search"
                value={availQuery}
                placeholder={tr("ext.market.searchPlaceholder")}
                disabled={marketLoading || cliMissing}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setAvailQuery(e.target.value)}
              />
            </div>

            {catalogEmpty ? (
              <div className="ext-empty-cta">
                <p className="ext-empty-cta__text">
                  {tr(catalogEmpty.titleKey as MessageKey)}
                </p>
                {catalogEmpty.hintKey ? (
                  <p className="ext-field-hint">
                    {tr(catalogEmpty.hintKey as MessageKey)}
                  </p>
                ) : null}
                {(() => {
                  const plan = planPluginMarketEmptyRetry(catalogEmpty);
                  if (plan.action === "none") return null;
                  const label =
                    plan.action === "open_runtime" || plan.action === "update_cli"
                      ? tr("ext.error.openRuntime")
                      : plan.action === "clear_filter"
                        ? tr("ext.market.clearFilters")
                        : plan.action === "refresh_catalog"
                          ? tr("ext.market.refreshCatalog")
                          : tr("ext.market.retry");
                  const disabled =
                    plan.action === "open_runtime" || plan.action === "update_cli"
                      ? !onOpenRuntime
                      : marketLoading || !!marketBusy;
                  return (
                    <button
                      type="button"
                      className="btn btn--solid btn--sm"
                      disabled={disabled}
                      onClick={() => runEmptyRetry(plan.action)}
                    >
                      {label}
                    </button>
                  );
                })()}
              </div>
            ) : (
              <ul className="ext-list ext-market-browse__list">
                {visibleAvailable.map((p) => {
                  const rowKey = availablePluginRowKey(p);
                  const busy =
                    marketBusy === `inst:${rowKey}` ||
                    marketBusy === `inst:${p.name}`;
                  const rowError = installErrors[rowKey] ?? null;
                  const installed = isPluginInstalled(p);
                  const badges = availablePluginDetailModel(p).badges;
                  return (
                    <li
                      key={rowKey}
                      className={
                        "ext-item ext-item--clickable" +
                        (detailPlugin &&
                        availablePluginRowKey(detailPlugin) === rowKey
                          ? " is-selected"
                          : "")
                      }
                    >
                      <button
                        type="button"
                        className="ext-item__hit"
                        onClick={() => openDetail(p)}
                        aria-label={tr("ext.market.viewDetailsAria", {
                          name: p.name,
                        })}
                      >
                        <div className="ext-item__head">
                          <span className="ext-item__name">{p.name}</span>
                          {p.marketplace ? (
                            <span className="ext-badge ext-badge--plugin">
                              {p.marketplace}
                            </span>
                          ) : null}
                          {installed ? (
                            <span className="ext-badge ext-badge--muted">
                              {tr("ext.market.installedBadge")}
                            </span>
                          ) : null}
                        </div>
                        {p.description ? (
                          <div className="ext-item__desc">{p.description}</div>
                        ) : null}
                        <div className="ext-item__meta">
                          {availablePluginMetaLine(p)}
                        </div>
                        {badges.length > 0 ? (
                          <div
                            className="ext-component-badges"
                            aria-hidden="true"
                          >
                            {badges.map((b) => (
                              <span
                                key={b.kind}
                                className={
                                  "ext-badge ext-badge--component ext-badge--component-" +
                                  b.kind
                                }
                              >
                                {badgeLabel(b.kind, b.count)}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </button>
                      {rowError ? (
                        <div
                          className={
                            "ext-item__row-error" +
                            (rowError.softFail ? " ext-item__row-error--soft" : "")
                          }
                          role={rowError.softFail ? "status" : "alert"}
                        >
                          <span
                            className={
                              "ext-badge " +
                              (rowError.softFail
                                ? "ext-badge--muted"
                                : "ext-badge--fail")
                            }
                          >
                            {tr(
                              pluginMarketErrorTitleKey(
                                rowError.kind,
                              ) as MessageKey,
                            )}
                          </span>
                          <p className="ext-item__row-error-text">
                            {rowErrorLabel(rowError)}
                          </p>
                          <p className="ext-field-hint">
                            {tr(
                              pluginMarketErrorHintKey(
                                rowError.kind,
                              ) as MessageKey,
                            )}
                          </p>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            disabled={
                              !!marketBusy ||
                              (cliMissing &&
                                planPluginMarketRetry(rowError.kind, "install")
                                  .action === "retry_install")
                            }
                            onClick={() => runRowRetry(p, rowError)}
                          >
                            {busy
                              ? tr("ext.market.installing")
                              : rowRetryLabel(rowError)}
                          </button>
                        </div>
                      ) : null}
                      <div className="ext-item__actions">
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={!!marketBusy}
                          onClick={() => openDetail(p)}
                        >
                          {tr("ext.market.viewDetails")}
                        </button>
                        <button
                          type="button"
                          className="btn btn--solid btn--sm"
                          disabled={!!marketBusy || cliMissing}
                          onClick={() => requestInstall(p)}
                        >
                          {busy
                            ? tr("ext.market.installing")
                            : installed
                              ? tr("ext.market.reinstall")
                              : tr("ext.market.install")}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {hasMore ? (
              <div className="ext-folder-actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setPageLimit((n) => n + PAGE_SIZE)}
                >
                  {tr("ext.market.showMore", {
                    n: filteredAvailable.length - visibleAvailable.length,
                  })}
                </button>
              </div>
            ) : null}
            </>
            ) : null}

            {/* Sources + add URL: non-embedded page, or sources-only modal. */}
            {!embedded || sourcesOnly ? (
            <details
              className="ext-market-sources"
              open={sourcesOnly ? true : sourcesOpen}
              onToggle={(e) =>
                setSourcesOpen((e.target as HTMLDetailsElement).open)
              }
            >
              <summary className="ext-market-sources__summary">
                {tr("ext.market.sourcesTitle")}
                {!marketLoading ? (
                  <span className="ext-count">{sources.length}</span>
                ) : null}
              </summary>
              <div className="ext-plugin-install">
                <label
                  className="ext-plugin-install__label"
                  htmlFor="ext-market-source"
                >
                  {tr("ext.market.addLabel")}
                </label>
                <div className="ext-plugin-install__row">
                  <input
                    id="ext-market-source"
                    type="text"
                    className="settings-input ext-plugin-install__input"
                    value={addSource}
                    placeholder={tr("ext.market.addPlaceholder")}
                    disabled={!!marketBusy || cliMissing}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => setAddSource(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addMarketplace();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn--solid"
                    disabled={!!marketBusy || cliMissing || !addSource.trim()}
                    onClick={() => void addMarketplace()}
                  >
                    {marketBusy === "add"
                      ? tr("ext.market.adding")
                      : tr("ext.market.add")}
                  </button>
                </div>
              </div>
              <div className="ext-folder-actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={marketLoading || !!marketBusy || cliMissing}
                  onClick={() => void refreshSources(null)}
                >
                  <IconRefresh size={13} />
                  <span>
                    {marketBusy === "up:all"
                      ? tr("ext.market.updating")
                      : tr("ext.market.updateAll")}
                  </span>
                </button>
              </div>
              {marketLoading ? (
                <p className="ext-field-hint">{tr("ext.market.loading")}</p>
              ) : sources.length === 0 ? (
                <p className="ext-field-hint">{tr("ext.market.empty")}</p>
              ) : (
                <ul className="ext-list">
                  {sources.map((s) => (
                    <li key={s.name} className="ext-item">
                      <div className="ext-item__head">
                        <span className="ext-item__name">{s.name}</span>
                        <span className="ext-badge ext-badge--muted">
                          {s.kind}
                        </span>
                      </div>
                      <div className="ext-item__meta">
                        {marketplaceSourceLabel(s)}
                      </div>
                      <div className="ext-item__actions">
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={!!marketBusy || cliMissing}
                          onClick={() => void refreshSources(s.name)}
                        >
                          <IconRefresh size={13} />
                          <span>
                            {marketBusy === `up:${s.name}`
                              ? tr("ext.market.updating")
                              : tr("ext.market.update")}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm ext-item__danger"
                          disabled={!!marketBusy || cliMissing}
                          onClick={() => setRemoveSource(s)}
                        >
                          <IconTrash size={13} />
                          <span>{tr("ext.market.remove")}</span>
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </details>
            ) : null}
          </div>

          <GlassModal
            open={!!removeSource}
            onClose={() => {
              if (!marketBusy) setRemoveSource(null);
            }}
            title={tr("ext.market.removeTitle")}
            size="sm"
            closeLabel={tr("common.close")}
            footer={
              <>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={!!marketBusy}
                  onClick={() => setRemoveSource(null)}
                >
                  {tr("common.cancel")}
                </button>
                <button
                  type="button"
                  className="btn btn--danger"
                  disabled={!!marketBusy}
                  onClick={() => void confirmRemoveSource()}
                >
                  {tr("ext.market.remove")}
                </button>
              </>
            }
          >
            <p className="app-dialog__msg">
              {tr("ext.market.removeConfirm", {
                name: removeSource?.name ?? "",
              })}
            </p>
          </GlassModal>

          <GlassModal
            open={!!detailPlugin && !!detailModel}
            onClose={() => {
              if (!marketBusy?.startsWith("inst:")) setDetailPlugin(null);
            }}
            title={detailModel?.name ?? tr("ext.market.detailTitle")}
            size="md"
            closeLabel={tr("common.close")}
            wrapBody
            footer={
              detailPlugin && detailModel ? (
                <>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={!!marketBusy?.startsWith("inst:")}
                    onClick={() => setDetailPlugin(null)}
                  >
                    {tr("common.close")}
                  </button>
                  <button
                    type="button"
                    className="btn btn--solid"
                    disabled={!!marketBusy || cliMissing}
                    onClick={() => requestInstall(detailPlugin)}
                  >
                    {marketBusy ===
                      `inst:${availablePluginRowKey(detailPlugin)}` ||
                    marketBusy === `inst:${detailPlugin.name}`
                      ? tr("ext.market.installing")
                      : isPluginInstalled(detailPlugin)
                        ? tr("ext.market.reinstall")
                        : tr("ext.market.install")}
                  </button>
                </>
              ) : null
            }
          >
            {detailModel ? (
              <div className="ext-market-detail">
                {detailModel.description ? (
                  <p className="ext-market-detail__desc">
                    {detailModel.description}
                  </p>
                ) : (
                  <p className="ext-market-detail__desc ext-market-detail__desc--muted">
                    {tr("ext.market.noDescription")}
                  </p>
                )}
                <dl className="ext-market-detail__meta">
                  <div className="ext-market-detail__row">
                    <dt>{tr("ext.market.field.marketplace")}</dt>
                    <dd>
                      {detailModel.marketplace?.trim() ||
                        tr("ext.market.field.unknown")}
                    </dd>
                  </div>
                  <div className="ext-market-detail__row">
                    <dt>{tr("ext.market.field.version")}</dt>
                    <dd>
                      {detailModel.versionLabel
                        ? `v${detailModel.versionLabel}`
                        : tr("ext.market.field.unknown")}
                    </dd>
                  </div>
                  <div className="ext-market-detail__row">
                    <dt>{tr("ext.market.field.source")}</dt>
                    <dd>
                      <code className="ext-market-detail__code">
                        {detailModel.installSource}
                      </code>
                    </dd>
                  </div>
                </dl>
                {detailModel.badges.length > 0 ? (
                  <div
                    className="ext-component-badges ext-component-badges--detail"
                    aria-label={tr("ext.market.componentsLabel")}
                  >
                    {detailModel.badges.map((b) => (
                      <span
                        key={b.kind}
                        className={
                          "ext-badge ext-badge--component ext-badge--component-" +
                          b.kind
                        }
                      >
                        {badgeLabel(b.kind, b.count)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="ext-field-hint">
                    {tr("ext.market.noComponents")}
                  </p>
                )}
                {detailPlugin &&
                installErrors[availablePluginRowKey(detailPlugin)] ? (
                  <div
                    className={
                      "ext-item__row-error ext-item__row-error--detail" +
                      (installErrors[availablePluginRowKey(detailPlugin)]
                        .softFail
                        ? " ext-item__row-error--soft"
                        : "")
                    }
                    role={
                      installErrors[availablePluginRowKey(detailPlugin)]
                        .softFail
                        ? "status"
                        : "alert"
                    }
                  >
                    <span
                      className={
                        "ext-badge " +
                        (installErrors[availablePluginRowKey(detailPlugin)]
                          .softFail
                          ? "ext-badge--muted"
                          : "ext-badge--fail")
                      }
                    >
                      {tr(
                        pluginMarketErrorTitleKey(
                          installErrors[availablePluginRowKey(detailPlugin)]
                            .kind,
                        ) as MessageKey,
                      )}
                    </span>
                    <p className="ext-item__row-error-text">
                      {rowErrorLabel(
                        installErrors[availablePluginRowKey(detailPlugin)],
                      )}
                    </p>
                    <p className="ext-field-hint">
                      {tr(
                        pluginMarketErrorHintKey(
                          installErrors[availablePluginRowKey(detailPlugin)]
                            .kind,
                        ) as MessageKey,
                      )}
                    </p>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={!!marketBusy}
                      onClick={() =>
                        runRowRetry(
                          detailPlugin,
                          installErrors[availablePluginRowKey(detailPlugin)],
                        )
                      }
                    >
                      {marketBusy ===
                        `inst:${availablePluginRowKey(detailPlugin)}` ||
                      marketBusy === `inst:${detailPlugin.name}`
                        ? tr("ext.market.installing")
                        : rowRetryLabel(
                            installErrors[availablePluginRowKey(detailPlugin)],
                          )}
                    </button>
                  </div>
                ) : null}
                <p className="ext-market-detail__trust">
                  {tr("ext.market.installTrustNote")}
                </p>
              </div>
            ) : null}
          </GlassModal>

          <GlassModal
            open={!!installTarget}
            onClose={() => {
              if (!marketBusy) setInstallTarget(null);
            }}
            title={
              installTarget && isPluginInstalled(installTarget)
                ? tr("ext.market.reinstallTitle")
                : tr("ext.market.installTitle")
            }
            size="sm"
            closeLabel={tr("common.close")}
            footer={
              <>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={!!marketBusy}
                  onClick={() => setInstallTarget(null)}
                >
                  {tr("common.cancel")}
                </button>
                <button
                  type="button"
                  className="btn btn--solid"
                  disabled={!!marketBusy}
                  onClick={() => void confirmInstall()}
                >
                  {marketBusy?.startsWith("inst:")
                    ? tr("ext.market.installing")
                    : installTarget && isPluginInstalled(installTarget)
                      ? tr("ext.market.reinstall")
                      : tr("ext.market.install")}
                </button>
              </>
            }
          >
            <p className="app-dialog__msg">
              {installTarget && isPluginInstalled(installTarget)
                ? tr("ext.market.reinstallConfirm", {
                    name: installTarget?.name ?? "",
                  })
                : tr("ext.market.installConfirm", {
                    name: installTarget?.name ?? "",
                  })}
            </p>
          </GlassModal>
        </div>
      ) : null}
    </>
  );
}

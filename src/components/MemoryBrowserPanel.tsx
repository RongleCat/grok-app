/**
 * Settings → Agent: Memory ops center + on-disk Grok Build memory browser.
 * Mode chips (keyword / CLI hybrid / hybrid unavailable / memory off), dream
 * & watcher config presence (never invents running status), clear scopes with
 * GlassModal confirm. Host list + content search under GROK_HOME/memory.
 * App search is always keyword — never invents embeddings.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import type { MemoryFileEntry, MemorySearchHit } from "@/lib/api";
import { createT, type Locale, type MessageKey } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import {
  IconExternalLink,
  IconFolder,
  IconRefresh,
  IconTrash,
} from "@/components/icons";
import {
  MEMORY_BROWSER_KIND_FILTERS,
  countMemoryEntriesByKind,
  hasActiveMemoryBrowserFilters,
  normalizeMemoryBrowserKind,
  type MemoryBrowserKindFilter,
} from "@/lib/memoryBrowserFilter";
import {
  MEMORY_SEARCH_DEBOUNCE_MS,
  buildMemoryBrowserDisplayRows,
  memoryBrowserMatchBadge,
  memoryBrowserMatchSummary,
  resolveMemoryBrowserEmptyState,
  shouldRunMemoryContentSearch,
  type MemoryBrowserRow,
} from "@/lib/memoryBrowserSearch";
import { isEmbeddingConfigured } from "@/lib/memoryEmbedConfig";
import {
  CLI_MEMORY_HYBRID_SEARCH_AVAILABLE,
  effectiveMemorySearchKind,
  memorySearchKindStatusKey,
  type MemorySearchKind,
} from "@/lib/memoryHybridSearch";
import {
  MEMORY_OPS_PRODUCT_CLEAR_SCOPES,
  clearMemoryScopeUnavailableKey,
  memoryOpsModeChipLabelKey,
  planClearMemoryScope,
  resolveMemoryOpsMode,
  resolveMemoryOpsPresenceChips,
  type MemoryOpsClearScope,
} from "@/lib/memoryOpsCenter";

function formatSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMtime(ms: number, locale: Locale): string {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleString(
      locale === "zh" ? "zh-CN" : locale === "zh-TW" ? "zh-TW" : "en",
      { dateStyle: "medium", timeStyle: "short" },
    );
  } catch {
    return "";
  }
}

function kindLabelKey(kind: string): MessageKey {
  switch (normalizeMemoryBrowserKind(kind)) {
    case "global":
      return "settings.memoryBrowser.kind.global";
    case "workspace":
      return "settings.memoryBrowser.kind.workspace";
    case "session":
      return "settings.memoryBrowser.kind.session";
    case "index":
      return "settings.memoryBrowser.kind.index";
    default:
      return "settings.memoryBrowser.kind.other";
  }
}

function kindFilterLabelKey(filter: MemoryBrowserKindFilter): MessageKey {
  if (filter === "all") return "settings.memoryBrowser.kind.all";
  return kindLabelKey(filter);
}

function presenceLabelKey(
  presence: "set_on" | "set_off" | "unset",
): MessageKey {
  if (presence === "set_on") return "settings.memoryEmbed.presence.on";
  if (presence === "set_off") return "settings.memoryEmbed.presence.off";
  return "settings.memoryEmbed.presence.unset";
}

function clearScopeLabelKey(scope: MemoryOpsClearScope): MessageKey {
  switch (scope) {
    case "session":
      return "settings.memoryOps.clear.session";
    case "global":
      return "settings.memoryOps.clear.global";
    case "all":
      return "settings.memoryOps.clear.all";
    case "workspace":
    default:
      return "settings.memoryOps.clear.workspace";
  }
}

function clearConfirmTitleKey(scope: MemoryOpsClearScope): MessageKey {
  switch (scope) {
    case "session":
      return "settings.memoryOps.clear.confirmTitle.session";
    case "global":
      return "settings.memoryOps.clear.confirmTitle.global";
    case "all":
      return "settings.memoryOps.clear.confirmTitle.all";
    case "workspace":
    default:
      return "settings.memoryOps.clear.confirmTitle.workspace";
  }
}

function clearConfirmMsgKey(scope: MemoryOpsClearScope): MessageKey {
  switch (scope) {
    case "session":
      return "settings.memoryOps.clear.confirmMsg.session";
    case "global":
      return "settings.memoryOps.clear.confirmMsg.global";
    case "all":
      return "settings.memoryOps.clear.confirmMsg.all";
    case "workspace":
    default:
      return "settings.memoryOps.clear.confirmMsg.workspace";
  }
}

function clearDoneKey(scope: MemoryOpsClearScope): MessageKey {
  switch (scope) {
    case "all":
      return "settings.memoryOps.clear.done.all";
    case "global":
      return "settings.memoryOps.clear.done.global";
    case "session":
      return "settings.memoryOps.clear.done.session";
    case "workspace":
    default:
      return "settings.memoryOps.clear.done.workspace";
  }
}

/** Host-wired product scopes only (workspace / global / all). */
const CLEAR_SCOPES: readonly MemoryOpsClearScope[] =
  MEMORY_OPS_PRODUCT_CLEAR_SCOPES;

export function MemoryBrowserPanel({
  locale,
  projectPath = null,
  experimentalMemory,
  onClearAll: _onClearAll,
  onMemoryCleared,
  clearAllBusy = false,
  onToast,
}: {
  locale: Locale;
  projectPath?: string | null;
  experimentalMemory: boolean;
  /**
   * @deprecated Panel owns GlassModal for all host scopes (workspace/global/all).
   * Kept optional for call-site compatibility; ignored.
   */
  onClearAll?: () => void;
  /** Fired after a successful clear (any available scope). */
  onMemoryCleared?: () => void;
  clearAllBusy?: boolean;
  onToast?: (msg: string, ms?: number) => void;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const t = useCallback((k: MessageKey, vars?: Record<string, string | number>) => tr(k, vars), [tr]);

  const [entries, setEntries] = useState<MemoryFileEntry[]>([]);
  const [memoryRoot, setMemoryRoot] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<MemoryBrowserKindFilter>("all");
  const [debouncedFilter, setDebouncedFilter] = useState("");
  const [searchHits, setSearchHits] = useState<MemorySearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [deleteTarget, setDeleteTarget] = useState<MemoryFileEntry | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [actionBusyPath, setActionBusyPath] = useState<string | null>(null);
  const [embedConfigured, setEmbedConfigured] = useState<boolean | null>(null);
  const [dreamEnabled, setDreamEnabled] = useState<boolean | null>(null);
  const [watcherEnabled, setWatcherEnabled] = useState<boolean | null>(null);
  /** Host-reported search kind from last content search (soft-fail missing). */
  const [hostSearchKind, setHostSearchKind] = useState<string | null>(null);
  const [clearScope, setClearScope] = useState<MemoryOpsClearScope | null>(null);
  const [clearBusy, setClearBusy] = useState(false);

  const cwd = (projectPath || "").trim() || null;

  const searchKind: MemorySearchKind = useMemo(
    () =>
      effectiveMemorySearchKind({
        hostSearchKind,
        embeddingConfigured: embedConfigured,
        cliHybridAvailable: CLI_MEMORY_HYBRID_SEARCH_AVAILABLE,
      }),
    [hostSearchKind, embedConfigured],
  );

  const modeChips = useMemo(
    () =>
      resolveMemoryOpsMode({
        memoryEnabled: experimentalMemory,
        embedModelSet: embedConfigured,
        hybridUnavailable:
          embedConfigured === true
            ? !CLI_MEMORY_HYBRID_SEARCH_AVAILABLE
            : undefined,
        browserKeyword: true,
      }),
    [experimentalMemory, embedConfigured],
  );

  const presenceChips = useMemo(
    () =>
      resolveMemoryOpsPresenceChips({
        dreamEnabled,
        watcherEnabled,
      }),
    [dreamEnabled, watcherEnabled],
  );

  const clearPlans = useMemo(() => {
    const opts = {
      memoryEnabled: experimentalMemory,
      hasCwd: !!cwd,
    };
    return Object.fromEntries(
      CLEAR_SCOPES.map((scope) => [scope, planClearMemoryScope(scope, opts)]),
    ) as Record<MemoryOpsClearScope, ReturnType<typeof planClearMemoryScope>>;
  }, [experimentalMemory, cwd]);

  const load = useCallback(async () => {
    if (!experimentalMemory) {
      setEntries([]);
      setError(null);
      setLoading(false);
      setSearchHits([]);
      setSearchTruncated(false);
      return;
    }
    if (!api.isTauri()) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.memoryList({ cwd });
      setEntries(res.entries ?? []);
      setMemoryRoot(res.memoryRoot || "");
    } catch (e) {
      setEntries([]);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [cwd, experimentalMemory]);

  useEffect(() => {
    void load();
  }, [load]);

  // Soft-probe embedding + dream/watcher presence (never invents vectors or running status).
  useEffect(() => {
    if (!experimentalMemory || !api.isTauri()) {
      setEmbedConfigured(null);
      setDreamEnabled(null);
      setWatcherEnabled(null);
      setHostSearchKind(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const snap = await api.memoryEmbedConfigGet();
        if (cancelled) return;
        setEmbedConfigured(isEmbeddingConfigured(snap));
        setDreamEnabled(
          snap.dreamEnabled === true
            ? true
            : snap.dreamEnabled === false
              ? false
              : null,
        );
        setWatcherEnabled(
          snap.watcherEnabled === true
            ? true
            : snap.watcherEnabled === false
              ? false
              : null,
        );
      } catch {
        if (cancelled) return;
        setEmbedConfigured(null);
        setDreamEnabled(null);
        setWatcherEnabled(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [experimentalMemory]);

  const kindCounts = useMemo(() => countMemoryEntriesByKind(entries), [entries]);
  const activeFilters = hasActiveMemoryBrowserFilters({
    query,
    kind: kindFilter,
  });

  const clearFilters = () => {
    setQuery("");
    setKindFilter("all");
    setDebouncedFilter("");
  };

  const scrollToEmbedSettings = useCallback(() => {
    const el = document.getElementById("settings-anchor-memoryEmbed");
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Debounce free-text before host content search.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedFilter(query);
    }, MEMORY_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [query]);

  // Host content search (path-scoped, capped, redacted snippets).
  useEffect(() => {
    if (!experimentalMemory || !api.isTauri()) {
      setSearchHits([]);
      setSearchTruncated(false);
      setSearching(false);
      return;
    }
    if (!shouldRunMemoryContentSearch(debouncedFilter)) {
      setSearchHits([]);
      setSearchTruncated(false);
      setSearching(false);
      setHostSearchKind(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    void (async () => {
      try {
        const res = await api.memorySearch({
          query: debouncedFilter.trim(),
          cwd,
          limit: 50,
        });
        if (cancelled) return;
        setSearchHits(res.hits ?? []);
        setSearchTruncated(!!res.truncated);
        setHostSearchKind(res.searchKind ?? null);
      } catch (e) {
        if (cancelled) return;
        // Keep list filter usable; surface error without wiping entries.
        setSearchHits([]);
        setSearchTruncated(false);
        setHostSearchKind(null);
        setError(String(e));
      } finally {
        if (!cancelled) setSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, debouncedFilter, experimentalMemory]);

  // Merge content hits + re-apply kind chip (kind was lost after content-search merge).
  const rows: MemoryBrowserRow[] = useMemo(
    () => buildMemoryBrowserDisplayRows(entries, searchHits, query, kindFilter),
    [entries, searchHits, query, kindFilter],
  );

  const emptyState = useMemo(
    () =>
      resolveMemoryBrowserEmptyState({
        experimentalMemory,
        loading,
        searching,
        entryCount: entries.length,
        rowCount: rows.length,
        query,
        kind: kindFilter,
        embedConfigured,
      }),
    [
      experimentalMemory,
      loading,
      searching,
      entries.length,
      rows.length,
      query,
      kindFilter,
      embedConfigured,
    ],
  );

  const matchSummary = useMemo(
    () => memoryBrowserMatchSummary(rows, query, kindFilter),
    [rows, query, kindFilter],
  );

  const toggleExpand = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const runDelete = async () => {
    if (!deleteTarget || deleteBusy) return;
    const deletedPath = deleteTarget.path;
    setDeleteBusy(true);
    try {
      await api.memoryDeleteFile(deletedPath);
      setDeleteTarget(null);
      setSearchHits((prev) => prev.filter((h) => h.path !== deletedPath));
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleteBusy(false);
    }
  };

  const requestClearScope = (scope: MemoryOpsClearScope) => {
    const plan = clearPlans[scope];
    if (!plan.available) {
      // Soft-fail toast — never open confirm without a host-wired plan.
      if (plan.unavailableReason) {
        onToast?.(t(clearMemoryScopeUnavailableKey(plan.unavailableReason)), 3200);
      }
      return;
    }
    // Panel-owned GlassModal for workspace / global / all (no window.confirm).
    setClearScope(scope);
  };

  const runClearScope = async () => {
    if (!clearScope || clearBusy) return;
    const plan = planClearMemoryScope(clearScope, {
      memoryEnabled: experimentalMemory,
      hasCwd: !!cwd,
    });
    if (!plan.available || !plan.hostScope) {
      if (plan.unavailableReason) {
        onToast?.(t(clearMemoryScopeUnavailableKey(plan.unavailableReason)), 3200);
      }
      setClearScope(null);
      return;
    }
    setClearBusy(true);
    try {
      await api.memoryClear({ cwd, scope: plan.hostScope });
      setClearScope(null);
      setSearchHits([]);
      await load();
      onMemoryCleared?.();
      onToast?.(t(clearDoneKey(clearScope)), 3500);
    } catch (e) {
      onToast?.(String(e), 4500);
      setError(String(e));
    } finally {
      setClearBusy(false);
    }
  };

  const openFile = async (path: string) => {
    if (!api.isTauri() || actionBusyPath) return;
    setActionBusyPath(path);
    try {
      await api.pathOpen(path);
    } catch (e) {
      setError(String(e));
    } finally {
      setActionBusyPath(null);
    }
  };

  const revealFile = async (path: string) => {
    if (!api.isTauri() || actionBusyPath) return;
    setActionBusyPath(path);
    try {
      await api.pathReveal(path);
    } catch (e) {
      setError(String(e));
    } finally {
      setActionBusyPath(null);
    }
  };

  const queryActive = shouldRunMemoryContentSearch(query);
  const showTruncated = queryActive && searchTruncated && rows.length > 0;
  // Inline "searching…" only when rows already show (empty state covers zero-row case).
  const showSearchingInline =
    queryActive && searching && rows.length > 0 && !emptyState;

  const anyClearBusy = clearBusy || clearAllBusy;

  return (
    <div
      className={"settings-row settings-row--stack" + " settings-memory-browser"}
      id="settings-anchor-memoryBrowser"
    >
      <div className="settings-row__text">
        <div className="settings-row__label">{t("settings.memoryOps")}</div>
        <div className="settings-row__desc">{t("settings.memoryOpsDesc")}</div>
      </div>

      <div
        className="settings-memory-ops"
        role="region"
        aria-label={t("settings.memoryOps")}
      >
        <div
          className="settings-memory-ops__modes"
          role="status"
          aria-label={t("settings.memoryOps.modeLabel")}
        >
          {modeChips.map((chip) => (
            <span
              key={chip}
              className={
                chip === "cli_hybrid"
                  ? "ext-badge"
                  : chip === "hybrid_unavailable" || chip === "memory_off"
                    ? "ext-badge ext-badge--muted"
                    : "ext-badge ext-badge--muted"
              }
            >
              {t(memoryOpsModeChipLabelKey(chip))}
            </span>
          ))}
          {experimentalMemory && embedConfigured === false ? (
            <span className="ext-field-hint settings-memory-ops__hint">
              {t("settings.memoryBrowser.embedUnsetHint")}
            </span>
          ) : experimentalMemory && searchKind === "hybrid_unavailable" ? (
            <span className="ext-field-hint settings-memory-ops__hint">
              {t("settings.memoryOps.hybridUnavailableHint")}
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={scrollToEmbedSettings}
          >
            {t("settings.memoryOps.openEmbed")}
          </button>
        </div>

        {experimentalMemory ? (
          <div
            className="settings-memory-ops__presence"
            role="status"
            aria-label={t("settings.memoryOps.presenceLabel")}
          >
            {presenceChips.map((chip) => (
              <span key={chip.id} className="settings-memory-ops__presence-item">
                <span className="ext-field-hint">
                  {chip.id === "dream"
                    ? t("settings.memoryOps.dream")
                    : t("settings.memoryOps.watcher")}
                </span>
                <span
                  className={
                    chip.presence === "set_on"
                      ? "ext-badge"
                      : "ext-badge ext-badge--muted"
                  }
                >
                  {t(presenceLabelKey(chip.presence))}
                </span>
              </span>
            ))}
            <span className="ext-field-hint settings-memory-ops__presence-note">
              {t("settings.memoryOps.presenceNote")}
            </span>
          </div>
        ) : null}

        {experimentalMemory ? (
          <div
            className="settings-memory-ops__clear"
            role="group"
            aria-label={t("settings.memoryOps.clearLabel")}
          >
            {CLEAR_SCOPES.map((scope) => {
              const plan = clearPlans[scope];
              const disabled = anyClearBusy || loading || !plan.available;
              return (
                <button
                  key={scope}
                  type="button"
                  className="btn btn--ghost btn--sm btn--danger"
                  disabled={disabled}
                  title={
                    !plan.available && plan.unavailableReason
                      ? t(clearMemoryScopeUnavailableKey(plan.unavailableReason))
                      : undefined
                  }
                  onClick={() => requestClearScope(scope)}
                >
                  <IconTrash size={13} />
                  <span>
                    {anyClearBusy && clearScope === scope
                      ? t("settings.memoryOps.clear.busy")
                      : t(clearScopeLabelKey(scope))}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {!experimentalMemory ? (
        <div className="settings-memory-browser__filter-empty">
          <p className="ext-field-hint settings-memory-browser__empty">
            {t("settings.memoryBrowser.off")}
          </p>
        </div>
      ) : (
        <>
          <div
            className="settings-memory-browser__chips"
            role="tablist"
            aria-label={t("settings.memoryBrowser.kindFilterLabel")}
          >
            {MEMORY_BROWSER_KIND_FILTERS.map((id) => {
              const n = kindCounts[id];
              // Hide zero-count kind chips except "all" and the active selection.
              if (id !== "all" && n === 0 && kindFilter !== id) return null;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={kindFilter === id}
                  className={
                    "settings-memory-browser__chip" +
                    (kindFilter === id ? " is-active" : "")
                  }
                  onClick={() => setKindFilter(id)}
                >
                  <span>{t(kindFilterLabelKey(id))}</span>
                  <span className="settings-memory-browser__chip-count">{n}</span>
                </button>
              );
            })}
          </div>

          <div className="settings-memory-browser__toolbar">
            <input
              type="search"
              className="settings-input settings-memory-browser__search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("settings.memoryBrowser.searchPlaceholder")}
              aria-label={t("settings.memoryBrowser.searchPlaceholder")}
              autoComplete="off"
              spellCheck={false}
            />
            <div className="settings-memory-browser__actions">
              {activeFilters ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={clearFilters}
                >
                  <span>{t("settings.memoryBrowser.clearFilters")}</span>
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={loading || deleteBusy || anyClearBusy}
                onClick={() => void load()}
              >
                <IconRefresh size={13} />
                <span>{t("settings.memoryBrowser.refresh")}</span>
              </button>
            </div>
          </div>

          {memoryRoot ? (
            <p className="ext-toolbar__hint" title={memoryRoot}>
              {t("settings.memoryBrowser.root", { path: memoryRoot })}
            </p>
          ) : null}

          {!cwd ? (
            <p className="ext-field-hint">{t("settings.memoryBrowser.noProject")}</p>
          ) : null}

          {matchSummary ? (
            <p className="ext-field-hint settings-memory-browser__match-summary" role="status">
              {matchSummary.queryActive && matchSummary.contentHits > 0
                ? t("settings.memoryBrowser.matchSummaryContent", {
                    count: matchSummary.total,
                    content: matchSummary.contentHits,
                  })
                : t("settings.memoryBrowser.matchSummary", {
                    count: matchSummary.total,
                  })}
              {matchSummary.queryActive
                ? ` · ${t(memorySearchKindStatusKey(searchKind))}`
                : ""}
            </p>
          ) : queryActive && !searching && !emptyState ? (
            <p className="ext-field-hint settings-memory-browser__match-summary" role="status">
              {t(memorySearchKindStatusKey(searchKind))}
            </p>
          ) : null}

          {showSearchingInline ? (
            <p className="ext-field-hint" aria-live="polite">
              {t("settings.memoryBrowser.searching")}
            </p>
          ) : null}

          {showTruncated ? (
            <p className="ext-field-hint" role="status">
              {t("settings.memoryBrowser.searchTruncated")}
            </p>
          ) : null}

          {error ? (
            <div className="ext-alert ext-alert--error" role="alert">
              <div className="ext-alert__title">{t("settings.memoryBrowser.error")}</div>
              <p className="ext-alert__body">{error}</p>
            </div>
          ) : null}

          {emptyState ? (
            <div className="settings-memory-browser__filter-empty">
              <p className="ext-field-hint settings-memory-browser__empty">
                {t(emptyState.titleKey)}
              </p>
              {emptyState.hintKey ? (
                <p className="ext-field-hint">{t(emptyState.hintKey)}</p>
              ) : null}
              {emptyState.showClearFilters ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm settings-memory-browser__clear-filters"
                  onClick={clearFilters}
                >
                  {t("settings.memoryBrowser.clearFilters")}
                </button>
              ) : null}
              {emptyState.showEmbedLink ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm settings-memory-browser__clear-filters"
                  onClick={scrollToEmbedSettings}
                >
                  {t("settings.memoryBrowser.openEmbedSettings")}
                </button>
              ) : null}
            </div>
          ) : (
            <ul className="ext-list settings-memory-browser__list">
              {rows.map((e) => {
                const open = expanded.has(e.path);
                const canPreview = !!e.preview;
                const busy = actionBusyPath === e.path;
                const matchBadge = memoryBrowserMatchBadge(e, query);
                return (
                  <li key={e.path} className="ext-item">
                    <div className="ext-item__head">
                      <span className="ext-item__name" title={e.path}>
                        {e.relativePath || e.name}
                      </span>
                      <span className="ext-badge ext-badge--muted">
                        {t(kindLabelKey(e.kind))}
                      </span>
                      {matchBadge === "content" ? (
                        <span className="ext-badge ext-badge--muted">
                          {t("settings.memoryBrowser.contentHit")}
                        </span>
                      ) : matchBadge === "name" ? (
                        <span className="ext-badge ext-badge--muted">
                          {t("settings.memoryBrowser.nameHit")}
                        </span>
                      ) : null}
                    </div>
                    <div className="ext-item__meta">
                      {formatSize(e.size)}
                      {e.mtimeMs ? ` · ${formatMtime(e.mtimeMs, locale)}` : ""}
                      {e.workspaceSlug ? ` · ${e.workspaceSlug}` : ""}
                    </div>
                    {e.snippet ? (
                      <p className="settings-memory-browser__snippet" title={e.snippet}>
                        {e.snippet}
                      </p>
                    ) : null}
                    <div className="ext-item__actions">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy}
                        onClick={() => void openFile(e.path)}
                      >
                        <IconExternalLink size={13} />
                        <span>{t("settings.memoryBrowser.open")}</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy}
                        onClick={() => void revealFile(e.path)}
                      >
                        <IconFolder size={13} />
                        <span>{t("settings.memoryBrowser.reveal")}</span>
                      </button>
                      {canPreview ? (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => toggleExpand(e.path)}
                        >
                          {open
                            ? t("settings.memoryBrowser.collapse")
                            : t("settings.memoryBrowser.expand")}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm btn--danger"
                        disabled={deleteBusy}
                        onClick={() =>
                          setDeleteTarget({
                            path: e.path,
                            name: e.name,
                            relativePath: e.relativePath,
                            size: e.size,
                            mtimeMs: e.mtimeMs,
                            preview: e.preview,
                            kind: e.kind,
                            workspaceSlug: e.workspaceSlug,
                            matched: e.matched,
                          })
                        }
                      >
                        <IconTrash size={13} />
                        <span>{t("settings.memoryBrowser.delete")}</span>
                      </button>
                    </div>
                    {open && canPreview ? (
                      <pre className="settings-memory-browser__preview">{e.preview}</pre>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <GlassModal
        open={!!deleteTarget}
        onClose={() => {
          if (!deleteBusy) setDeleteTarget(null);
        }}
        title={t("settings.memoryBrowser.deleteConfirmTitle")}
        size="sm"
        closeLabel={t("common.close")}
        closeOnOverlay={!deleteBusy}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={deleteBusy}
              onClick={() => setDeleteTarget(null)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={deleteBusy || !deleteTarget}
              onClick={() => void runDelete()}
            >
              {deleteBusy
                ? t("settings.memoryBrowser.deleting")
                : t("settings.memoryBrowser.delete")}
            </button>
          </>
        }
      >
        <p className="settings-row__desc is-flush">
          {t("settings.memoryBrowser.deleteConfirmMsg", {
            name: deleteTarget?.relativePath || deleteTarget?.name || "",
          })}
        </p>
      </GlassModal>

      <GlassModal
        open={!!clearScope}
        onClose={() => {
          if (!clearBusy) setClearScope(null);
        }}
        title={
          clearScope
            ? t(clearConfirmTitleKey(clearScope))
            : t("settings.memoryOps.clear.confirmTitle.workspace")
        }
        size="sm"
        closeLabel={t("common.close")}
        closeOnOverlay={!clearBusy}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={clearBusy}
              onClick={() => setClearScope(null)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={clearBusy || !clearScope}
              onClick={() => void runClearScope()}
            >
              {clearBusy
                ? t("settings.memoryOps.clear.busy")
                : clearScope
                  ? t(clearScopeLabelKey(clearScope))
                  : t("settings.memoryOps.clear.workspace")}
            </button>
          </>
        }
      >
        <p className="settings-row__desc is-flush">
          {clearScope
            ? t(clearConfirmMsgKey(clearScope))
            : t("settings.memoryOps.clear.confirmMsg.workspace")}
        </p>
      </GlassModal>
    </div>
  );
}

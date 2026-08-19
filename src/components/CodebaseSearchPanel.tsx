/**
 * Settings → Agent: project codebase file/name + content search.
 * Host path-scopes under trusted project (`rg` or walk). Keyword only —
 * never invents embeddings or CLI code-graph results.
 *
 * Mode chips unify with codebase indexing honesty (`codeGraphProduct`).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import { createT, intlLocale, type Locale, type MessageKey } from "@/i18n";
import {
  IconExternalLink,
  IconFolder,
  IconRefresh,
} from "@/components/icons";
import {
  CODEBASE_SEARCH_DEBOUNCE_MS,
  CODEBASE_SEARCH_MODES,
  codebaseSearchMatchBadge,
  codebaseSearchMatchSummary,
  clampCodebaseSearchLimit,
  formatCodebaseSearchSize,
  normalizeCodebaseSearchEngine,
  normalizeCodebaseSearchHits,
  normalizeCodebaseSearchMode,
  resolveCodebaseSearchEmptyState,
  resolveCodebaseSearchKind,
  shouldRunCodebaseSearch,
  type CodebaseSearchHitLike,
  type CodebaseSearchMode,
} from "@/lib/codebaseSearch";
import {
  CODE_GRAPH_INDEXING_ANCHOR,
  annotateSearchHits,
  buildCodeGraphStatusChips,
  codeGraphStatusChipLabelKey,
  resolveCodeGraphMode,
  type AnnotatedCodeGraphHit,
  type CodeGraphMode,
} from "@/lib/codeGraphProduct";
import {
  cliSupportsCodebaseIndexing,
  codebaseIndexingKind,
  valuesFromCodebaseIndexingSnapshot,
} from "@/lib/codebaseIndexing";

function formatMtime(ms: number, locale: Locale): string {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleString(
      intlLocale(locale),
      { dateStyle: "medium", timeStyle: "short" },
    );
  } catch {
    return "";
  }
}

function modeLabelKey(mode: CodebaseSearchMode): MessageKey {
  switch (mode) {
    case "name":
      return "settings.codebaseSearch.mode.name";
    case "content":
      return "settings.codebaseSearch.mode.content";
    default:
      return "settings.codebaseSearch.mode.all";
  }
}

export function CodebaseSearchPanel({
  locale,
  projectPath = null,
  onOpenInResources,
}: {
  locale: Locale;
  /** Active workbench project path (search root). */
  projectPath?: string | null;
  /**
   * Open a hit in the Resources pane (relative or absolute path).
   * When omitted, only host open / reveal are available.
   */
  onOpenInResources?: (opts: {
    path: string;
    relativePath: string;
    line?: number | null;
  }) => void;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const t = useCallback(
    (k: MessageKey, vars?: Record<string, string | number>) => tr(k, vars),
    [tr],
  );

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [mode, setMode] = useState<CodebaseSearchMode>("all");
  const [hits, setHits] = useState<AnnotatedCodeGraphHit<CodebaseSearchHitLike>[]>(
    [],
  );
  const [searching, setSearching] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [engine, setEngine] = useState<"rg" | "walk" | "none">("none");
  const [softFail, setSoftFail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hostError, setHostError] = useState(false);
  const [actionBusyPath, setActionBusyPath] = useState<string | null>(null);
  const [resolvedRoot, setResolvedRoot] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  /** Soft-probe indexing for honest mode chips (never invents graph hits). */
  const [graphMode, setGraphMode] = useState<CodeGraphMode>("unset_default_on");

  const cwd = (projectPath || "").trim() || null;
  const isTauri = api.isTauri();

  // Soft-probe codebase indexing so chips match Settings → indexing honesty.
  useEffect(() => {
    if (!isTauri) {
      setGraphMode("unset_default_on");
      return;
    }
    let cancelled = false;
    void (async () => {
      let indexingEnabled: boolean | null = null;
      let indexingKind: string = "unset";
      let cliOld = false;
      try {
        const snap = await api.codebaseIndexingGet();
        if (cancelled) return;
        const vals = valuesFromCodebaseIndexingSnapshot({
          enabled: snap.enabled,
          customRaw: snap.customRaw,
          kind: snap.kind,
        });
        indexingEnabled = vals.enabled;
        indexingKind = codebaseIndexingKind({
          enabled: snap.enabled,
          customRaw: snap.customRaw,
          kind: snap.kind,
        });
      } catch {
        // Soft-fail: leave unset default
      }
      try {
        const probe = await api.probeCli();
        const ver =
          (probe as { version?: string | null } | null)?.version ?? null;
        if (cliSupportsCodebaseIndexing(ver) === false) cliOld = true;
      } catch {
        // Soft-fail unknown CLI
      }
      if (cancelled) return;
      setGraphMode(
        resolveCodeGraphMode({
          indexingEnabled,
          indexingKind,
          cliOld,
          searchKind: "keyword",
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [isTauri]);

  const statusChips = useMemo(
    () => buildCodeGraphStatusChips(graphMode),
    [graphMode],
  );

  const scrollToIndexingSettings = useCallback(() => {
    const el = document.getElementById(CODE_GRAPH_INDEXING_ANCHOR);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, CODEBASE_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [query]);

  useEffect(() => {
    if (!isTauri) {
      setHits([]);
      setSoftFail(null);
      setHostError(false);
      setError(null);
      setSearching(false);
      setTruncated(false);
      setEngine("none");
      return;
    }
    if (!cwd) {
      setHits([]);
      setSoftFail("no_project");
      setHostError(false);
      setError(null);
      setSearching(false);
      setTruncated(false);
      setEngine("none");
      setResolvedRoot("");
      return;
    }
    if (!shouldRunCodebaseSearch(debouncedQuery)) {
      setHits([]);
      setSoftFail(null);
      setHostError(false);
      setError(null);
      setSearching(false);
      setTruncated(false);
      setEngine("none");
      return;
    }

    let cancelled = false;
    setSearching(true);
    setError(null);
    setHostError(false);
    void (async () => {
      try {
        const res = await api.projectCodebaseSearch({
          projectPath: cwd,
          query: debouncedQuery.trim(),
          mode: normalizeCodebaseSearchMode(mode),
          limit: clampCodebaseSearchLimit(50),
        });
        if (cancelled) return;
        // Honesty: never surface non-keyword search kind; annotate never invents graph.
        void resolveCodebaseSearchKind(res.searchKind);
        const normalized = normalizeCodebaseSearchHits(res);
        setHits(annotateSearchHits(normalized, graphMode));
        setTruncated(!!res.truncated);
        setEngine(normalizeCodebaseSearchEngine(res.engine));
        setSoftFail(res.softFail ?? null);
        setResolvedRoot(res.projectPath || cwd);
      } catch (e) {
        if (cancelled) return;
        setHits([]);
        setTruncated(false);
        setEngine("none");
        setSoftFail(null);
        setHostError(true);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, debouncedQuery, graphMode, isTauri, mode, refreshToken]);

  const emptyState = useMemo(
    () =>
      resolveCodebaseSearchEmptyState({
        isTauri,
        projectPath: cwd,
        query: debouncedQuery,
        searching,
        hitCount: hits.length,
        softFail,
        hostError,
      }),
    [
      isTauri,
      cwd,
      debouncedQuery,
      searching,
      hits.length,
      softFail,
      hostError,
    ],
  );

  const matchSummary = useMemo(
    () => codebaseSearchMatchSummary(hits, debouncedQuery),
    [hits, debouncedQuery],
  );

  const openFile = async (path: string) => {
    if (!isTauri || actionBusyPath) return;
    setActionBusyPath(path);
    try {
      await api.pathOpen(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusyPath(null);
    }
  };

  const revealFile = async (path: string) => {
    if (!isTauri || actionBusyPath) return;
    setActionBusyPath(path);
    try {
      await api.pathReveal(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusyPath(null);
    }
  };

  const openInResources = (hit: CodebaseSearchHitLike) => {
    onOpenInResources?.({
      path: hit.path,
      relativePath: hit.relativePath,
      line: hit.line,
    });
  };

  const queryActive = shouldRunCodebaseSearch(debouncedQuery);
  const showTruncated = queryActive && truncated && hits.length > 0;
  const showSearchingInline =
    queryActive && searching && hits.length > 0 && !emptyState;

  return (
    <div
      className="settings-row settings-row--stack settings-codebase-search"
      id="settings-anchor-codebaseSearch"
    >
      <div className="settings-row__text">
        <div className="settings-row__label">
          {t("settings.codebaseSearch")}
        </div>
        <div className="settings-row__desc">
          {t("settings.codebaseSearchDesc")}
        </div>
        {resolvedRoot || cwd ? (
          <div
            className="settings-row__hint"
            title={resolvedRoot || cwd || undefined}
          >
            {t("settings.codebaseSearch.path", {
              path: resolvedRoot || cwd || "",
            })}
          </div>
        ) : null}
      </div>

      <div
        className="settings-codebase-search__badges settings-code-graph__chips"
        role="status"
        aria-label={t("settings.codeGraph.modeLabel")}
      >
        {statusChips.map((chip) => (
          <span
            key={chip}
            className={
              chip === "cli_graph" || chip === "cli_graph_default_on"
                ? "ext-badge"
                : "ext-badge ext-badge--muted"
            }
          >
            {t(codeGraphStatusChipLabelKey(chip))}
          </span>
        ))}
        {engine !== "none" && queryActive ? (
          <span className="ext-badge ext-badge--muted">
            {engine === "rg"
              ? t("settings.codebaseSearch.engine.rg")
              : t("settings.codebaseSearch.engine.walk")}
          </span>
        ) : null}
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={scrollToIndexingSettings}
        >
          {t("settings.codeGraph.openIndexingSettings")}
        </button>
      </div>
      <p className="ext-field-hint settings-codebase-search__no-embed">
        {t("settings.codebaseSearch.noEmbeddings")}
      </p>

      <div
        className="settings-codebase-search__chips"
        role="tablist"
        aria-label={t("settings.codebaseSearch.modeLabel")}
      >
        {CODEBASE_SEARCH_MODES.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            className={
              "settings-codebase-search__chip" +
              (mode === id ? " is-active" : "")
            }
            onClick={() => setMode(id)}
          >
            {t(modeLabelKey(id))}
          </button>
        ))}
      </div>

      <div className="settings-codebase-search__toolbar">
        <input
          type="search"
          className="settings-input settings-codebase-search__search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("settings.codebaseSearch.searchPlaceholder")}
          aria-label={t("settings.codebaseSearch.searchPlaceholder")}
          autoComplete="off"
          spellCheck={false}
          disabled={!isTauri || !cwd}
        />
        <div className="settings-codebase-search__actions">
          {query.trim() ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setQuery("")}
            >
              {t("settings.codebaseSearch.clear")}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={searching || !isTauri || !cwd}
            onClick={() => {
              setDebouncedQuery(query.trim());
              setRefreshToken((n) => n + 1);
            }}
          >
            <IconRefresh size={13} />
            <span>{t("settings.codebaseSearch.refresh")}</span>
          </button>
        </div>
      </div>

      {matchSummary ? (
        <p
          className="ext-field-hint settings-codebase-search__match-summary"
          role="status"
        >
          {matchSummary.contentHits > 0
            ? t("settings.codebaseSearch.matchSummaryContent", {
                count: matchSummary.total,
                content: matchSummary.contentHits,
              })
            : t("settings.codebaseSearch.matchSummary", {
                count: matchSummary.total,
              })}
        </p>
      ) : null}

      {showSearchingInline ? (
        <p className="ext-field-hint" aria-live="polite">
          {t("settings.codebaseSearch.searching")}
        </p>
      ) : null}

      {showTruncated ? (
        <p className="ext-field-hint" role="status">
          {t("settings.codebaseSearch.truncated")}
        </p>
      ) : null}

      {error ? (
        <div className="ext-alert ext-alert--error" role="alert">
          <div className="ext-alert__title">
            {t("settings.codebaseSearch.error")}
          </div>
          <p className="ext-alert__body">{error}</p>
        </div>
      ) : null}

      {emptyState ? (
        <div className="settings-codebase-search__empty">
          <p className="ext-field-hint settings-codebase-search__empty-title">
            {t(emptyState.titleKey)}
          </p>
          {emptyState.hintKey ? (
            <p className="ext-field-hint">{t(emptyState.hintKey)}</p>
          ) : null}
        </div>
      ) : (
        <ul className="ext-list settings-codebase-search__list">
          {hits.map((h) => {
            const busy = actionBusyPath === h.path;
            const badge = codebaseSearchMatchBadge(h, debouncedQuery);
            return (
              <li key={h.path || h.relativePath} className="ext-item">
                <div className="ext-item__head">
                  <span
                    className="ext-item__name"
                    title={h.path || h.relativePath}
                  >
                    {h.relativePath || h.name}
                    {h.line ? `:${h.line}` : ""}
                  </span>
                  {badge === "content" ? (
                    <span className="ext-badge ext-badge--muted">
                      {t("settings.codebaseSearch.contentHit")}
                    </span>
                  ) : badge === "name" ? (
                    <span className="ext-badge ext-badge--muted">
                      {t("settings.codebaseSearch.nameHit")}
                    </span>
                  ) : null}
                </div>
                <div className="ext-item__meta">
                  {formatCodebaseSearchSize(h.size)}
                  {h.mtimeMs ? ` · ${formatMtime(h.mtimeMs, locale)}` : ""}
                </div>
                {h.snippet ? (
                  <p
                    className="settings-codebase-search__snippet"
                    title={h.snippet}
                  >
                    {h.snippet}
                  </p>
                ) : null}
                <div className="ext-item__actions">
                  {onOpenInResources ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={busy}
                      onClick={() => openInResources(h)}
                    >
                      <span>{t("settings.codebaseSearch.openResources")}</span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={busy || !h.path}
                    onClick={() => void openFile(h.path)}
                  >
                    <IconExternalLink size={13} />
                    <span>{t("settings.codebaseSearch.open")}</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={busy || !h.path}
                    onClick={() => void revealFile(h.path)}
                  >
                    <IconFolder size={13} />
                    <span>{t("settings.codebaseSearch.reveal")}</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

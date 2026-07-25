/**
 * Settings → Extensions: Hooks list + Plugin marketplace sources / available install.
 * Host wraps `grok` CLI; no second package store under ~/.grok-app.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import { createT, type Locale } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import {
  IconExternalLink,
  IconFolder,
  IconHooks,
  IconPlus,
  IconPuzzle,
  IconRefresh,
  IconTrash,
} from "@/components/icons";
import { isCliMissingError } from "@/lib/extensionsUi";
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
  availablePluginMetaLine,
  filterAvailablePlugins,
  filterPluginsByQuery,
  marketplaceQualifiedInstallSource,
  marketplaceRemoveTarget,
  marketplaceSourceLabel,
  normalizeMarketplaceAddSource,
  sortAvailablePluginsByName,
  sortMarketplaceSourcesByName,
  takePluginsPage,
  type AvailablePluginLike,
  type MarketplaceSourceLike,
} from "@/lib/pluginMarketplace";

export type ExtensionsBuildExtrasProps = {
  locale: Locale;
  projectPath?: string | null;
  cliFound?: boolean;
  /** After plugin install — parent can refresh plugins list. */
  onPluginsChanged?: () => void;
};

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
  return {
    name,
    status,
    marketplace:
      (raw.marketplace as string | null | undefined) ??
      (raw.market as string | null | undefined) ??
      null,
    description: (raw.description as string | null | undefined) ?? null,
    version: (raw.version as string | null | undefined) ?? null,
    skillCount:
      typeof raw.skillCount === "number"
        ? raw.skillCount
        : typeof raw.skill_count === "number"
          ? raw.skill_count
          : null,
    hasHooks: !!(raw.hasHooks ?? raw.has_hooks),
    hasAgents: !!(raw.hasAgents ?? raw.has_agents),
    hasMcp: !!(raw.hasMcp ?? raw.has_mcp),
  };
}

export function ExtensionsBuildExtras({
  locale,
  projectPath = null,
  cliFound = true,
  onPluginsChanged,
}: ExtensionsBuildExtrasProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const cliMissing = !cliFound;

  const [hooks, setHooks] = useState<HookLike[]>([]);
  const [hooksUserDir, setHooksUserDir] = useState("");
  const [hooksProjectDir, setHooksProjectDir] = useState<string | null>(null);
  const [hooksDocs, setHooksDocs] = useState<string | null>(null);
  const [hooksError, setHooksError] = useState<string | null>(null);
  const [hooksLoading, setHooksLoading] = useState(true);
  const [hooksBusy, setHooksBusy] = useState<string | null>(null);

  const [sources, setSources] = useState<MarketplaceSourceLike[]>([]);
  const [available, setAvailable] = useState<AvailablePluginLike[]>([]);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketBusy, setMarketBusy] = useState<string | null>(null);
  const [addSource, setAddSource] = useState("");
  const [availQuery, setAvailQuery] = useState("");
  const [removeSource, setRemoveSource] = useState<MarketplaceSourceLike | null>(
    null,
  );
  const [installTarget, setInstallTarget] =
    useState<AvailablePluginLike | null>(null);

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
      setHooksUserDir(res.userDir || "");
      setHooksProjectDir(res.projectDir ?? null);
      setHooksDocs(res.docsPath ?? null);
    } catch (e) {
      setHooks([]);
      setHooksError(String(e));
    } finally {
      setHooksLoading(false);
    }
  }, [projectPath]);

  const loadMarket = useCallback(async () => {
    if (!api.isTauri()) {
      setSources([]);
      setAvailable([]);
      setMarketLoading(false);
      return;
    }
    setMarketLoading(true);
    setMarketError(null);
    try {
      const [srcRes, availRes] = await Promise.all([
        api.marketplaceList(),
        api.marketplaceAvailable(),
      ]);
      if (srcRes.error?.trim()) {
        setMarketError(srcRes.error);
      }
      if (availRes.error?.trim() && !srcRes.error?.trim()) {
        setMarketError(availRes.error);
      }
      const src = sortMarketplaceSourcesByName(
        (srcRes.sources ?? [])
          .map((r) => asSource(r as Record<string, unknown>))
          .filter((x): x is MarketplaceSourceLike => !!x),
      );
      const avail = sortAvailablePluginsByName(
        filterAvailablePlugins(
          (availRes.plugins ?? [])
            .map((r) => asAvailable(r as Record<string, unknown>))
            .filter((x): x is AvailablePluginLike => !!x),
        ),
      );
      setSources(src);
      setAvailable(avail);
    } catch (e) {
      setSources([]);
      setAvailable([]);
      setMarketError(String(e));
    } finally {
      setMarketLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHooks();
  }, [loadHooks]);

  useEffect(() => {
    void loadMarket();
  }, [loadMarket]);

  const filteredAvailable = useMemo(() => {
    const list = filterPluginsByQuery(available, availQuery);
    return takePluginsPage(list, 60);
  }, [available, availQuery]);

  const openHooksDir = async (
    scope: "user" | "project",
    create: boolean,
  ) => {
    if (scope === "project" && !projectPath?.trim()) return;
    setHooksBusy(`${scope}:${create ? "create" : "open"}`);
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
      if (!res.ok) {
        setMarketError(res.error?.trim() || tr("ext.market.error"));
        return;
      }
      setAddSource("");
      await loadMarket();
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
      if (!res.ok) {
        setMarketError(res.error?.trim() || tr("ext.market.error"));
        return;
      }
      setRemoveSource(null);
      await loadMarket();
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
      if (!res.ok) {
        setMarketError(res.error?.trim() || tr("ext.market.error"));
        return;
      }
      await loadMarket();
    } catch (e) {
      setMarketError(String(e));
    } finally {
      setMarketBusy(null);
    }
  };

  const confirmInstall = async () => {
    if (!installTarget) return;
    const source = marketplaceQualifiedInstallSource(
      installTarget.name,
      installTarget.marketplace,
    );
    setMarketBusy(`inst:${installTarget.name}`);
    setMarketError(null);
    try {
      const res = await api.pluginInstall(source);
      if (res && typeof res === "object" && "ok" in res && res.ok === false) {
        setMarketError(
          (res as { error?: string }).error?.trim() || tr("ext.market.error"),
        );
        return;
      }
      setInstallTarget(null);
      await loadMarket();
      onPluginsChanged?.();
    } catch (e) {
      setMarketError(String(e));
    } finally {
      setMarketBusy(null);
    }
  };

  const scopeLabel = (scope: string) => {
    if (scope === "project") return tr("ext.hooks.scope.project");
    return tr("ext.hooks.scope.user");
  };

  return (
    <>
      {/* ── Hooks ── */}
      <h2 className="settings-page__h2">
        <IconHooks size={15} />
        {tr("ext.hooks.title")}
        {!hooksLoading ? (
          <span className="ext-count">{hooks.length}</span>
        ) : null}
        <button
          type="button"
          className="btn btn--ghost ext-bulk-btn"
          disabled={hooksLoading || !!hooksBusy}
          onClick={() => void loadHooks()}
        >
          <IconRefresh size={13} />
          <span>{tr("ext.market.update")}</span>
        </button>
      </h2>
      <div className="settings-card ext-card">
        <p className="ext-section-note">{tr("ext.hooks.desc")}</p>
        {!projectPath?.trim() ? (
          <p className="ext-field-hint">{tr("ext.hooks.emptyProject")}</p>
        ) : null}
        <div className="ext-toolbar">
          <div className="ext-toolbar__actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={!!hooksBusy || cliMissing}
              onClick={() => void openHooksDir("user", false)}
            >
              <IconFolder size={13} />
              <span>{tr("ext.hooks.openUser")}</span>
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
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={!!hooksBusy || cliMissing || !projectPath?.trim()}
              title={
                !projectPath?.trim() ? tr("ext.hooks.needProject") : undefined
              }
              onClick={() => void openHooksDir("project", false)}
            >
              <IconFolder size={13} />
              <span>{tr("ext.hooks.openProject")}</span>
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={!!hooksBusy || cliMissing || !projectPath?.trim()}
              title={
                !projectPath?.trim() ? tr("ext.hooks.needProject") : undefined
              }
              onClick={() => void openHooksDir("project", true)}
            >
              <IconPlus size={13} />
              <span>{tr("ext.hooks.createProject")}</span>
            </button>
          </div>
          {hooksUserDir ? (
            <p className="ext-toolbar__hint" title={hooksUserDir}>
              {hooksUserDir}
              {hooksProjectDir ? ` · ${hooksProjectDir}` : ""}
            </p>
          ) : null}
        </div>
        {hooksError ? (
          <div
            className={
              "ext-alert" +
              (isCliMissingError(hooksError)
                ? " ext-alert--error"
                : " ext-alert--warn")
            }
            role="alert"
          >
            <div className="ext-alert__title">{tr("ext.hooks.error")}</div>
            <p className="ext-alert__body">{hooksError}</p>
          </div>
        ) : null}
        {hooksLoading ? (
          <p className="ext-field-hint">{tr("ext.hooks.loading")}</p>
        ) : hooks.length === 0 ? (
          <p className="ext-field-hint">{tr("ext.hooks.empty")}</p>
        ) : (
          <ul className="ext-list">
            {hooks.map((h) => (
              <li key={hookRowKey(h)} className="ext-item">
                <div className="ext-item__head">
                  <span className="ext-item__name">{h.name}</span>
                  <span
                    className={
                      "ext-badge" +
                      (h.scope === "project"
                        ? " ext-badge--project"
                        : " ext-badge--user")
                    }
                  >
                    {scopeLabel(h.scope)}
                  </span>
                  <span className="ext-badge ext-badge--muted">
                    {hookTypeLabel(h)}
                  </span>
                </div>
                <div className="ext-item__meta">
                  {hookMetaLine(h, {
                    locale,
                    scopeLabel,
                  })}
                  {" · "}
                  {formatHookSize(h.size)}
                  {h.mtimeMs
                    ? ` · ${formatHookMtime(h.mtimeMs, locale)}`
                    : ""}
                </div>
                <div className="ext-item__actions">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={!!hooksBusy}
                    onClick={() => void revealHook(h.path)}
                  >
                    <IconExternalLink size={13} />
                    <span>{tr("ext.hooks.reveal")}</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {hooksDocs ? (
          <p className="ext-section-note">
            {tr("ext.hooks.docs")}: <code>{hooksDocs}</code>
          </p>
        ) : null}
      </div>

      {/* ── Marketplace sources + available ── */}
      <h2 className="settings-page__h2">
        <IconPuzzle size={15} />
        {tr("ext.market.title")}
        {!marketLoading ? (
          <span className="ext-count">{sources.length}</span>
        ) : null}
        <button
          type="button"
          className="btn btn--ghost ext-bulk-btn"
          disabled={marketLoading || !!marketBusy || cliMissing}
          onClick={() => void refreshSources(null)}
        >
          {marketBusy === "up:all"
            ? tr("ext.market.updating")
            : tr("ext.market.updateAll")}
        </button>
      </h2>
      <div className="settings-card ext-card">
        <p className="ext-section-note">{tr("ext.market.desc")}</p>
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
        {marketError ? (
          <div className="ext-alert ext-alert--error" role="alert">
            <div className="ext-alert__title">{tr("ext.market.error")}</div>
            <p className="ext-alert__body">{marketError}</p>
          </div>
        ) : null}
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
                  <span className="ext-badge ext-badge--muted">{s.kind}</span>
                </div>
                <div className="ext-item__meta">{marketplaceSourceLabel(s)}</div>
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

        <h3 className="settings-page__h3 ext-market-avail-h">
          {tr("ext.market.availableTitle")}
          {!marketLoading ? (
            <span className="ext-count">{available.length}</span>
          ) : null}
        </h3>
        <div className="ext-plugin-install">
          <input
            type="search"
            className="settings-input"
            value={availQuery}
            placeholder={tr("ext.market.searchPlaceholder")}
            disabled={marketLoading}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setAvailQuery(e.target.value)}
          />
        </div>
        {marketLoading ? (
          <p className="ext-field-hint">{tr("ext.market.availableLoading")}</p>
        ) : filteredAvailable.length === 0 ? (
          <p className="ext-field-hint">{tr("ext.market.availableEmpty")}</p>
        ) : (
          <ul className="ext-list">
            {filteredAvailable.map((p) => (
              <li key={`${p.marketplace ?? ""}:${p.name}`} className="ext-item">
                <div className="ext-item__head">
                  <span className="ext-item__name">{p.name}</span>
                  {p.marketplace ? (
                    <span className="ext-badge ext-badge--plugin">
                      {p.marketplace}
                    </span>
                  ) : null}
                </div>
                {p.description ? (
                  <div className="ext-item__desc">{p.description}</div>
                ) : null}
                <div className="ext-item__meta">
                  {availablePluginMetaLine(p)}
                </div>
                <div className="ext-item__actions">
                  <button
                    type="button"
                    className="btn btn--solid btn--sm"
                    disabled={!!marketBusy || cliMissing}
                    onClick={() => setInstallTarget(p)}
                  >
                    {marketBusy === `inst:${p.name}`
                      ? tr("ext.market.installing")
                      : tr("ext.market.install")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="ext-section-note">{tr("ext.market.note")}</p>
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
        open={!!installTarget}
        onClose={() => {
          if (!marketBusy) setInstallTarget(null);
        }}
        title={tr("ext.market.installTitle")}
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
                : tr("ext.market.install")}
            </button>
          </>
        }
      >
        <p className="app-dialog__msg">
          {tr("ext.market.installConfirm", {
            name: installTarget?.name ?? "",
          })}
        </p>
      </GlassModal>
    </>
  );
}

/**
 * Settings → Agent: browse on-disk Grok Build workspace memory files.
 * When experimental memory is off, shows an honest empty state.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import type { MemoryFileEntry } from "@/lib/api";
import { createT, type Locale, type MessageKey } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import { IconRefresh, IconTrash } from "@/components/icons";

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
  switch (kind) {
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

export function MemoryBrowserPanel({
  locale,
  projectPath = null,
  experimentalMemory,
  onClearAll,
  clearAllBusy = false,
}: {
  locale: Locale;
  projectPath?: string | null;
  experimentalMemory: boolean;
  /** Opens the existing clear-workspace confirm flow. */
  onClearAll?: () => void;
  clearAllBusy?: boolean;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const t = useCallback((k: MessageKey, vars?: Record<string, string | number>) => tr(k, vars), [tr]);

  const [entries, setEntries] = useState<MemoryFileEntry[]>([]);
  const [memoryRoot, setMemoryRoot] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [deleteTarget, setDeleteTarget] = useState<MemoryFileEntry | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const cwd = (projectPath || "").trim() || null;

  const load = useCallback(async () => {
    if (!experimentalMemory) {
      setEntries([]);
      setError(null);
      setLoading(false);
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

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => {
      const hay = `${e.name} ${e.relativePath} ${e.kind} ${e.preview}`.toLowerCase();
      return hay.includes(q);
    });
  }, [entries, filter]);

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
    setDeleteBusy(true);
    try {
      await api.memoryDeleteFile(deleteTarget.path);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div
      className={"settings-row settings-row--stack" + " settings-memory-browser"}
      id="settings-anchor-memoryBrowser"
    >
      <div className="settings-row__text">
        <div className="settings-row__label">{t("settings.memoryBrowser")}</div>
        <div className="settings-row__desc">{t("settings.memoryBrowserDesc")}</div>
      </div>

      {!experimentalMemory ? (
        <p className="ext-field-hint settings-memory-browser__empty">
          {t("settings.memoryBrowser.off")}
        </p>
      ) : (
        <>
          <div className="settings-memory-browser__toolbar">
            <input
              type="search"
              className="settings-input settings-memory-browser__search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("settings.memoryBrowser.searchPlaceholder")}
              aria-label={t("settings.memoryBrowser.searchPlaceholder")}
            />
            <div className="settings-memory-browser__actions">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={loading || deleteBusy}
                onClick={() => void load()}
              >
                <IconRefresh size={13} />
                <span>{t("settings.memoryBrowser.refresh")}</span>
              </button>
              {onClearAll && cwd ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm btn--danger"
                  disabled={clearAllBusy || loading}
                  onClick={onClearAll}
                >
                  <IconTrash size={13} />
                  <span>
                    {clearAllBusy
                      ? t("settings.clearWorkspaceMemoryBusy")
                      : t("settings.clearWorkspaceMemory")}
                  </span>
                </button>
              ) : null}
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

          {error ? (
            <div className="ext-alert ext-alert--error" role="alert">
              <div className="ext-alert__title">{t("settings.memoryBrowser.error")}</div>
              <p className="ext-alert__body">{error}</p>
            </div>
          ) : null}

          {loading ? (
            <p className="ext-field-hint">{t("settings.memoryBrowser.loading")}</p>
          ) : filtered.length === 0 ? (
            <p className="ext-field-hint">{t("settings.memoryBrowser.empty")}</p>
          ) : (
            <ul className="ext-list settings-memory-browser__list">
              {filtered.map((e) => {
                const open = expanded.has(e.path);
                const canPreview = !!e.preview;
                return (
                  <li key={e.path} className="ext-item">
                    <div className="ext-item__head">
                      <span className="ext-item__name" title={e.path}>
                        {e.relativePath || e.name}
                      </span>
                      <span className="ext-badge ext-badge--muted">{t(kindLabelKey(e.kind))}</span>
                    </div>
                    <div className="ext-item__meta">
                      {formatSize(e.size)}
                      {e.mtimeMs ? ` · ${formatMtime(e.mtimeMs, locale)}` : ""}
                      {e.workspaceSlug ? ` · ${e.workspaceSlug}` : ""}
                    </div>
                    <div className="ext-item__actions">
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
                        onClick={() => setDeleteTarget(e)}
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
        <p className="settings-row__desc" style={{ margin: 0 }}>
          {t("settings.memoryBrowser.deleteConfirmMsg", {
            name: deleteTarget?.relativePath || deleteTarget?.name || "",
          })}
        </p>
      </GlassModal>
    </div>
  );
}

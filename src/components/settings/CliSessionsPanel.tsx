/**
 * List / import / open / delete Grok Build CLI sessions from active GROK_HOME.
 * Settings page shows a compact row; the full list opens in a GlassModal so
 * long catalogs do not stretch the settings scroll surface.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconCopy, IconSearch, IconTrash } from "@/components/icons";
import { GlassModal } from "@/components/GlassModal";
import {
  countUnlinkedCliSessions,
  countBulkImportableCliSessions,
  filterCliSessions,
} from "@/lib/cliSessionsFilter";
import * as api from "@/lib/api";
import type { MessageKey } from "@/i18n";

export function CliSessionsPanel({
  t,
  sessionDataMode,
  onImported,
  onOpenSession,
}: {
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  sessionDataMode: string;
  onImported?: () => void;
  onOpenSession?: (appSessionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<api.CliSessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  /** Host CLI search results when query is non-empty; null = show local list/filter. */
  const [searchHits, setSearchHits] = useState<api.CliSessionSearchHit[] | null>(
    null,
  );
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<
    | null
    | { kind: "one"; row: api.CliSessionSummary }
    | { kind: "unlinked"; count: number }
  >(null);
  const searchSeq = useRef(0);
  /** Bumps after list refresh so active CLI search re-enriches linked state. */
  const [listEpoch, setListEpoch] = useState(0);
  const [agentHome, setAgentHome] = useState<string | null>(null);
  const isIndependent = sessionDataMode !== "shared";

  const refresh = useCallback(async () => {
    if (!api.isTauri()) return;
    setLoading(true);
    setError(null);
    try {
      const list = await api.cliSessionsList();
      setRows(list);
      setListEpoch((n) => n + 1);
    } catch (e) {
      setError(String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load only while the browser is open — keeps the settings page short.
  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh, sessionDataMode]);

  useEffect(() => {
    if (!open || !isIndependent || !api.isTauri()) {
      setAgentHome(null);
      return;
    }
    void api
      .providersList()
      .then((list) => {
        const home = (list?.agentHome || "").trim();
        setAgentHome(home || null);
      })
      .catch(() => setAgentHome(null));
  }, [open, isIndependent]);

  // When the search box is non-empty, call host `cli_sessions_search`
  // (`grok sessions search` + local first-prompt fallback). Debounced.
  useEffect(() => {
    if (!open) return;
    const q = filterQuery.trim();
    if (!q) {
      setSearchHits(null);
      setSearching(false);
      setSearchNote(null);
      return;
    }
    if (!api.isTauri()) {
      setSearchHits(null);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const hits = await api.cliSessionsSearch(q, 40);
          if (searchSeq.current !== seq) return;
          setSearchHits(hits);
          const viaCli = hits.some((h) => h.source === "cli");
          setSearchNote(
            viaCli
              ? t("settings.cliSessionsSearchViaCli")
              : t("settings.cliSessionsSearchViaLocal"),
          );
        } catch {
          if (searchSeq.current !== seq) return;
          // Host failed — fall back to client-side title/id/cwd/firstPrompt filter.
          setSearchHits(null);
          setSearchNote(t("settings.cliSessionsSearchFallback"));
        } finally {
          if (searchSeq.current === seq) setSearching(false);
        }
      })();
    }, 280);
    return () => {
      window.clearTimeout(timer);
    };
  }, [filterQuery, sessionDataMode, listEpoch, t, open]);

  const filtered = useMemo(() => {
    const q = filterQuery.trim();
    if (!q) return rows;
    if (searchHits) return searchHits;
    // Host still loading or failed → local filter (incl. firstPrompt when present).
    return filterCliSessions(rows, q);
  }, [rows, filterQuery, searchHits]);
  /** Bulk import / delete unlinked always targets the full list (not the filter). */
  const pending = countUnlinkedCliSessions(rows);
  const importable = countBulkImportableCliSessions(rows);
  const sourceHome =
    rows.find((r) => r.sourceHome)?.sourceHome ??
    (isIndependent ? agentHome || "" : "~/.grok");

  const copyAgentId = async (agentSessionId: string) => {
    try {
      await navigator.clipboard.writeText(agentSessionId);
      setCopiedId(agentSessionId);
      window.setTimeout(() => {
        setCopiedId((cur) => (cur === agentSessionId ? null : cur));
      }, 1500);
    } catch (e) {
      setError(String(e));
    }
  };

  const openAppSession = (appSessionId: string) => {
    onOpenSession?.(appSessionId);
  };

  /** Import if needed, then open the app session (skip re-import when linked). */
  const resumeOrImportOpen = async (row: api.CliSessionSummary) => {
    setBusyId(row.agentSessionId);
    setError(null);
    setStatus(null);
    try {
      if (row.alreadyLinked && row.appSessionId) {
        setStatus(t("settings.cliSessionsOpened", { title: row.title }));
        openAppSession(row.appSessionId);
        return;
      }
      const meta = await api.cliSessionImport(row.agentSessionId, {
        dir: row.dir,
      });
      setStatus(
        t("settings.cliSessionsImportedOpen", { title: row.title }),
      );
      await refresh();
      onImported?.();
      if (meta?.id) openAppSession(meta.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const importAll = async () => {
    setBusyId("__all__");
    setError(null);
    setStatus(null);
    try {
      const imported = await api.cliSessionsImportAll(50);
      setStatus(
        t("settings.cliSessionsImportedN", { n: String(imported.length) }),
      );
      await refresh();
      onImported?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const runDeleteOne = async (row: api.CliSessionSummary) => {
    setBusyId(row.agentSessionId);
    setError(null);
    setStatus(null);
    try {
      await api.cliSessionDelete(row.agentSessionId, { dir: row.dir });
      setDeleteConfirm(null);
      setStatus(t("settings.cliSessionsDeleted", { title: row.title }));
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const runDeleteUnlinked = async () => {
    const targets = rows.filter((r) => !r.alreadyLinked);
    if (targets.length === 0) {
      setDeleteConfirm(null);
      return;
    }
    setBusyId("__delete_unlinked__");
    setError(null);
    setStatus(null);
    let deleted = 0;
    const errors: string[] = [];
    try {
      for (const row of targets) {
        try {
          await api.cliSessionDelete(row.agentSessionId, { dir: row.dir });
          deleted += 1;
        } catch (e) {
          errors.push(`${row.agentSessionId}: ${String(e)}`);
        }
      }
      setDeleteConfirm(null);
      setStatus(
        t("settings.cliSessionsDeletedN", { n: String(deleted) }),
      );
      if (errors.length > 0) {
        setError(errors.slice(0, 3).join("; "));
      }
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const deleteBusy =
    busyId === "__delete_unlinked__" ||
    (deleteConfirm?.kind === "one" &&
      busyId === deleteConfirm.row.agentSessionId);

  const closeBrowser = () => {
    if (deleteBusy || busyId) return;
    setOpen(false);
  };

  return (
    <>
      <div
        className="settings-row"
        id="settings-anchor-cliSessions"
      >
        <div className="settings-row__text">
          <div className="settings-row__label">{t("settings.cliSessions")}</div>
          <div className="settings-row__desc">{t("settings.cliSessionsDesc")}</div>
        </div>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setOpen(true)}
        >
          {t("settings.cliSessionsManage")}
        </button>
      </div>

      <GlassModal
        open={open}
        onClose={closeBrowser}
        title={t("settings.cliSessions")}
        size="lg"
        className="settings-cli-sessions-modal"
        wrapBody
        closeLabel={t("common.close")}
        closeOnOverlay={!deleteBusy && !busyId}
      >
        <div className="settings-cli-sessions settings-cli-sessions--modal">
          {isIndependent ? (
            <div className="settings-cli-sessions__note" role="note">
              {t("settings.cliSessionsIndependentNote")}
            </div>
          ) : null}
          {sourceHome ? (
            <div className="settings-cli-sessions__path" title={sourceHome}>
              {t("settings.cliSessionsSource", { path: sourceHome })}
            </div>
          ) : null}
          <div className="settings-cli-sessions__actions">
            <button
              type="button"
              className="btn btn--ghost"
              disabled={loading || !!busyId}
              onClick={() => void refresh()}
            >
              {t("resources.refresh")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={loading || !!busyId || importable === 0}
              onClick={() => void importAll()}
            >
              {busyId === "__all__"
                ? t("settings.cliSessionsImporting")
                : t("settings.cliSessionsImportAll", { n: String(importable) })}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--danger"
              disabled={loading || !!busyId || pending === 0}
              onClick={() =>
                setDeleteConfirm({ kind: "unlinked", count: pending })
              }
            >
              {busyId === "__delete_unlinked__"
                ? t("settings.cliSessionsDeleting")
                : t("settings.cliSessionsDeleteUnlinked", {
                    n: String(pending),
                  })}
            </button>
          </div>
          <div className="settings-cli-sessions__filter">
            <IconSearch size={14} />
            <input
              type="search"
              value={filterQuery}
              onChange={(e) => {
                setFilterQuery(e.target.value);
                // Clear stale host error when the user edits the query.
                if (error) setError(null);
              }}
              placeholder={t("settings.cliSessionsFilterPlaceholder")}
              aria-label={t("settings.cliSessionsFilterPlaceholder")}
            />
          </div>
          {searchNote && filterQuery.trim() ? (
            <div className="settings-cli-sessions__search-note" role="status">
              {searching
                ? t("settings.cliSessionsSearching")
                : searchNote}
            </div>
          ) : searching && filterQuery.trim() ? (
            <div className="settings-cli-sessions__search-note" role="status">
              {t("settings.cliSessionsSearching")}
            </div>
          ) : null}
          {error ? (
            <div className="settings-cli-sessions__err" role="alert">
              {error}
            </div>
          ) : null}
          {status ? (
            <div className="settings-cli-sessions__ok" role="status">
              {status}
            </div>
          ) : null}
          {loading && rows.length === 0 && !filterQuery.trim() ? (
            <div className="settings-cli-sessions__empty">
              {t("settings.cliSessionsLoading")}
            </div>
          ) : rows.length === 0 && !filterQuery.trim() ? (
            <div className="settings-cli-sessions__empty">
              {t("settings.cliSessionsEmpty")}
            </div>
          ) : searching && filtered.length === 0 ? (
            <div className="settings-cli-sessions__empty">
              {t("settings.cliSessionsSearching")}
            </div>
          ) : filtered.length === 0 ? (
            <div className="settings-cli-sessions__empty">
              {filterQuery.trim()
                ? t("settings.cliSessionsSearchEmpty")
                : t("settings.cliSessionsFilterEmpty")}
            </div>
          ) : (
            <ul className="settings-cli-sessions__list">
              {filtered.slice(0, 40).map((r) => {
                const busy = busyId === r.agentSessionId;
                const shortId =
                  r.agentSessionId.length > 14
                    ? `${r.agentSessionId.slice(0, 8)}…${r.agentSessionId.slice(-4)}`
                    : r.agentSessionId;
                const firstPrompt =
                  "firstPrompt" in r
                    ? (r as { firstPrompt?: string | null }).firstPrompt
                    : undefined;
                const remoteOnly = !r.dir;
                return (
                  <li
                    key={r.agentSessionId}
                    className={
                      "settings-cli-sessions__item" +
                      (r.alreadyLinked
                        ? " settings-cli-sessions__item--linked"
                        : "")
                    }
                  >
                    <div className="settings-cli-sessions__meta">
                      <div className="settings-cli-sessions__title-row">
                        <div className="settings-cli-sessions__title">
                          {r.title}
                        </div>
                        {r.alreadyLinked ? (
                          <span className="settings-cli-sessions__badge">
                            {t("settings.cliSessionsLinked")}
                          </span>
                        ) : null}
                      </div>
                      {firstPrompt ? (
                        <div
                          className="settings-cli-sessions__prompt"
                          title={firstPrompt}
                        >
                          {firstPrompt}
                        </div>
                      ) : null}
                      <div className="settings-cli-sessions__sub">
                        {r.cwd ? `${r.cwd} · ` : ""}
                        {r.numMessages
                          ? t("settings.cliSessionsMsgs", {
                              n: String(r.numMessages),
                            })
                          : null}
                      </div>
                      <div className="settings-cli-sessions__id-row">
                        <span
                          className="settings-cli-sessions__id"
                          title={r.agentSessionId}
                        >
                          {t("settings.cliSessionsAgentId", { id: shortId })}
                        </span>
                        <button
                          type="button"
                          className="settings-cli-sessions__copy"
                          title={t("settings.cliSessionsCopyId")}
                          aria-label={t("settings.cliSessionsCopyId")}
                          onClick={() => void copyAgentId(r.agentSessionId)}
                        >
                          <IconCopy size={12} />
                          <span>
                            {copiedId === r.agentSessionId
                              ? t("settings.cliSessionsCopied")
                              : t("settings.cliSessionsCopyId")}
                          </span>
                        </button>
                      </div>
                    </div>
                    <div className="settings-cli-sessions__row-actions">
                      {r.alreadyLinked ? (
                        <button
                          type="button"
                          className="btn btn--solid"
                          disabled={!!busyId || !r.appSessionId}
                          onClick={() => void resumeOrImportOpen(r)}
                        >
                          {busy
                            ? t("settings.cliSessionsImporting")
                            : t("settings.cliSessionsOpen")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--solid"
                          disabled={!!busyId}
                          onClick={() => void resumeOrImportOpen(r)}
                        >
                          {busy
                            ? t("settings.cliSessionsImporting")
                            : t("settings.cliSessionsImportOpen")}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm btn--danger"
                        disabled={!!busyId || remoteOnly}
                        title={
                          remoteOnly
                            ? t("settings.cliSessionsDeleteRemoteOnly")
                            : t("settings.cliSessionsDeleteConfirmMsg", {
                                title: r.title,
                              })
                        }
                        aria-label={t("settings.cliSessionsDelete")}
                        onClick={() =>
                          setDeleteConfirm({ kind: "one", row: r })
                        }
                      >
                        <IconTrash size={13} />
                        <span>
                          {busy
                            ? t("settings.cliSessionsDeleting")
                            : t("settings.cliSessionsDelete")}
                        </span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </GlassModal>

      <GlassModal
        open={!!deleteConfirm}
        onClose={() => {
          if (!deleteBusy) setDeleteConfirm(null);
        }}
        title={
          deleteConfirm?.kind === "unlinked"
            ? t("settings.cliSessionsDeleteUnlinkedConfirmTitle")
            : t("settings.cliSessionsDeleteConfirmTitle")
        }
        size="sm"
        closeLabel={t("common.close")}
        closeOnOverlay={!deleteBusy}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={deleteBusy}
              onClick={() => setDeleteConfirm(null)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={deleteBusy || !deleteConfirm}
              onClick={() => {
                if (!deleteConfirm) return;
                if (deleteConfirm.kind === "unlinked") {
                  void runDeleteUnlinked();
                } else {
                  void runDeleteOne(deleteConfirm.row);
                }
              }}
            >
              {deleteBusy
                ? t("settings.cliSessionsDeleting")
                : t("settings.cliSessionsDelete")}
            </button>
          </>
        }
      >
        <p className="settings-row__desc is-flush">
          {deleteConfirm?.kind === "unlinked"
            ? t("settings.cliSessionsDeleteUnlinkedConfirmMsg", {
                n: String(deleteConfirm.count),
              })
            : t("settings.cliSessionsDeleteConfirmMsg", {
                title: deleteConfirm?.row.title ?? "",
              })}
        </p>
      </GlassModal>
    </>
  );
}

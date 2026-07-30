/**
 * Settings → Extensions → Hooks: list and open hook folders + recent activity.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import { createT, type Locale } from "@/i18n";
import {
  IconExternalLink,
  IconFolder,
  IconHooks,
  IconPlus,
  IconRefresh,
} from "@/components/icons";
import { isCliMissingError } from "@/lib/extensionsUi";
import {
  formatHookActivityTime,
  listHookActivities,
  subscribeHookActivities,
  type HookActivityOutcome,
  type HookActivityRecord,
} from "@/lib/hooksDebug";
import {
  formatHookMtime,
  formatHookSize,
  hookMetaLine,
  hookRowKey,
  hookTypeLabel,
  sortHooksByScopeName,
  type HookLike,
} from "@/lib/hooksUi";

function outcomeBadgeClass(outcome: HookActivityOutcome): string {
  if (outcome === "ok") return "ext-badge ext-badge--ok";
  if (outcome === "fail") return "ext-badge ext-badge--fail";
  return "ext-badge ext-badge--muted";
}

function outcomeLabel(
  outcome: HookActivityOutcome,
  tr: ReturnType<typeof createT>,
): string {
  if (outcome === "ok") return tr("ext.hooks.activity.ok");
  if (outcome === "fail") return tr("ext.hooks.activity.fail");
  if (outcome === "skip") return tr("ext.hooks.activity.skip");
  return tr("ext.hooks.activity.info");
}

export function ExtensionsHooksPanel({
  locale,
  projectPath = null,
  cliFound = true,
}: {
  locale: Locale;
  projectPath?: string | null;
  cliFound?: boolean;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [hooks, setHooks] = useState<HookLike[]>([]);
  const [userDir, setUserDir] = useState("");
  const [projectDir, setProjectDir] = useState<string | null>(null);
  const [docsPath, setDocsPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [activity, setActivity] = useState<HookActivityRecord[]>(() => [
    ...listHookActivities(),
  ]);
  const cliMissing = !cliFound;

  useEffect(() => {
    setActivity([...listHookActivities()]);
    return subscribeHookActivities((recs) => setActivity([...recs]));
  }, []);

  const load = useCallback(async () => {
    if (!api.isTauri()) {
      setHooks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.hooksList(projectPath);
      setHooks(
        sortHooksByScopeName(
          (res.hooks ?? []).map((h) => ({
            name: h.name,
            path: h.path,
            scope: h.scope,
            kind: h.kind,
            ext: h.ext,
            size: h.size ?? 0,
            mtimeMs: h.mtimeMs ?? 0,
          })),
        ),
      );
      setUserDir(res.userDir || "");
      setProjectDir(res.projectDir ?? null);
      setDocsPath(res.docsPath ?? null);
    } catch (e) {
      setHooks([]);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDir = async (scope: "user" | "project", create: boolean) => {
    if (scope === "project" && !projectPath?.trim()) return;
    setBusy(`${scope}:${create ? "c" : "o"}`);
    try {
      await api.hooksOpenDir({ scope, projectPath, create });
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const scopeLabel = (scope: string) =>
    scope === "project" ? tr("ext.hooks.scope.project") : tr("ext.hooks.scope.user");

  return (
    <>
      <h2 className="settings-page__h2">
        <IconHooks size={15} />
        {tr("ext.hooks.title")}
        {!loading ? <span className="ext-count">{hooks.length}</span> : null}
        <button
          type="button"
          className="btn btn--ghost ext-bulk-btn"
          disabled={loading || !!busy}
          onClick={() => void load()}
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
            <button type="button" className="btn btn--ghost btn--sm" disabled={!!busy || cliMissing} onClick={() => void openDir("user", false)}>
              <IconFolder size={13} /><span>{tr("ext.hooks.openUser")}</span>
            </button>
            <button type="button" className="btn btn--ghost btn--sm" disabled={!!busy || cliMissing} onClick={() => void openDir("user", true)}>
              <IconPlus size={13} /><span>{tr("ext.hooks.createUser")}</span>
            </button>
            <button type="button" className="btn btn--ghost btn--sm" disabled={!!busy || cliMissing || !projectPath?.trim()} onClick={() => void openDir("project", false)}>
              <IconFolder size={13} /><span>{tr("ext.hooks.openProject")}</span>
            </button>
            <button type="button" className="btn btn--ghost btn--sm" disabled={!!busy || cliMissing || !projectPath?.trim()} onClick={() => void openDir("project", true)}>
              <IconPlus size={13} /><span>{tr("ext.hooks.createProject")}</span>
            </button>
          </div>
          {userDir ? (
            <p className="ext-toolbar__hint" title={userDir}>
              {userDir}{projectDir ? ` · ${projectDir}` : ""}
            </p>
          ) : null}
        </div>
        {error ? (
          <div className={"ext-alert" + (isCliMissingError(error) ? " ext-alert--error" : " ext-alert--warn")} role="alert">
            <div className="ext-alert__title">{tr("ext.hooks.error")}</div>
            <p className="ext-alert__body">{error}</p>
          </div>
        ) : null}
        {loading ? (
          <p className="ext-field-hint">{tr("ext.hooks.loading")}</p>
        ) : hooks.length === 0 ? (
          <p className="ext-field-hint">{tr("ext.hooks.empty")}</p>
        ) : (
          <ul className="ext-list">
            {hooks.map((h) => (
              <li key={hookRowKey(h)} className="ext-item">
                <div className="ext-item__head">
                  <span className="ext-item__name">{h.name}</span>
                  <span className={"ext-badge" + (h.scope === "project" ? " ext-badge--project" : " ext-badge--user")}>
                    {scopeLabel(h.scope)}
                  </span>
                  <span className="ext-badge ext-badge--muted">{hookTypeLabel(h)}</span>
                </div>
                <div className="ext-item__meta">
                  {hookMetaLine(h, { locale, scopeLabel })}
                  {" · "}
                  {formatHookSize(h.size)}
                  {h.mtimeMs ? ` · ${formatHookMtime(h.mtimeMs, locale)}` : ""}
                </div>
                <div className="ext-item__actions">
                  <button type="button" className="btn btn--ghost btn--sm" disabled={!!busy} onClick={() => void api.hooksReveal(h.path).catch((e) => setError(String(e)))}>
                    <IconExternalLink size={13} /><span>{tr("ext.hooks.reveal")}</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {docsPath ? (
          <p className="ext-section-note">{tr("ext.hooks.docs")}: <code>{docsPath}</code></p>
        ) : null}
      </div>

      <div className="settings-card ext-card ext-hooks-activity">
        <h3 className="settings-page__h2 ext-hooks-activity__title">
          {tr("ext.hooks.activity.title")}
        </h3>
        <p className="ext-section-note">{tr("ext.hooks.activity.desc")}</p>
        {activity.length === 0 ? (
          <p className="ext-field-hint">{tr("ext.hooks.activity.empty")}</p>
        ) : (
          <ul className="ext-list ext-hooks-activity__list">
            {activity.map((row) => (
              <li key={row.id} className="ext-item ext-hooks-activity__item">
                <div className="ext-item__head">
                  <span className="ext-item__name">{row.type}</span>
                  <span className={outcomeBadgeClass(row.outcome)}>
                    {outcomeLabel(row.outcome, tr)}
                  </span>
                  <span className="ext-badge ext-badge--muted">
                    {formatHookActivityTime(row.atMs, locale)}
                  </span>
                </div>
                {row.detail ? (
                  <div className="ext-item__meta ext-hooks-activity__detail" title={row.detail}>
                    {row.detail}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

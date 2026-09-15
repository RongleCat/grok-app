/**
 * Settings → Extensions → Commands: typed slash commands as CLI markdown files.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import { createT, type Locale } from "@/i18n";
import { IconPlus, IconRefresh } from "@/components/icons";

export function CustomizeCommandsPanel({
  locale,
  projectPath,
}: {
  locale: Locale;
  projectPath?: string | null;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [rows, setRows] = useState<api.CustomCommandEntry[]>([]);
  const [userWritable, setUserWritable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState<"user" | "project">("user");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!api.isTauri()) {
      setError(tr("ext.commands.needTauri"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.customizeCommandsList(projectPath);
      setRows(res.commands ?? []);
      setUserWritable(!!res.userWritable);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [projectPath, tr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async () => {
    if (!api.isTauri() || saving) return;
    setSaving(true);
    setError(null);
    setHint(null);
    try {
      const created = await api.customizeCommandCreate({
        name,
        body,
        scope,
        projectPath,
      });
      setName("");
      setBody("");
      setHint(tr("ext.commands.created", { name: created.name }));
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="customize-commands" id="settings-anchor-ext-commands">
      <p className="settings-page__lead">{tr("ext.commands.lead")}</p>
      {!userWritable ? (
        <p className="ext-alert__body">{tr("ext.commands.sharedHint")}</p>
      ) : null}
      <div className="prm__toolbar">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <IconRefresh size={14} />
          <span>{tr("ext.refresh")}</span>
        </button>
      </div>
      {error ? (
        <div className="prm__error" role="alert">
          {error}
        </div>
      ) : null}
      {hint ? (
        <div className="prm__banner" role="status">
          {hint}
        </div>
      ) : null}
      {loading ? <p>{tr("ext.commands.loading")}</p> : null}
      {!loading && rows.length === 0 ? (
        <p className="prm__empty">{tr("ext.commands.empty")}</p>
      ) : (
        <ul className="prm__list">
          {rows.map((row) => (
            <li key={`${row.scope}:${row.absolutePath}`} className="prm__row">
              <div className="prm__row-main">
                <strong>/{row.name}</strong>
                <span className="prm__summary-chip">{row.scope}</span>
              </div>
              <div className="prm__path">{row.absolutePath}</div>
            </li>
          ))}
        </ul>
      )}
      <div className="settings-config-edit__fields" style={{ marginTop: 12 }}>
        <label className="settings-row__label" htmlFor="customize-cmd-name">
          {tr("ext.commands.name")}
        </label>
        <input
          id="customize-cmd-name"
          className="settings-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={tr("ext.commands.namePh")}
          spellCheck={false}
          autoComplete="off"
        />
        <label className="settings-row__label" htmlFor="customize-cmd-body">
          {tr("ext.commands.body")}
        </label>
        <textarea
          id="customize-cmd-body"
          className="settings-input"
          rows={8}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={tr("ext.commands.bodyPh")}
          spellCheck={false}
        />
        <div className="prm__toolbar">
          <button
            type="button"
            className={"btn btn--ghost btn--sm" + (scope === "user" ? " is-on" : "")}
            disabled={!userWritable}
            onClick={() => setScope("user")}
          >
            {tr("ext.commands.scopeUser")}
          </button>
          <button
            type="button"
            className={
              "btn btn--ghost btn--sm" + (scope === "project" ? " is-on" : "")
            }
            disabled={!projectPath}
            onClick={() => setScope("project")}
          >
            {tr("ext.commands.scopeProject")}
          </button>
          <button
            type="button"
            className="btn btn--solid btn--sm"
            disabled={saving || !name.trim() || !body.trim()}
            onClick={() => void create()}
          >
            <IconPlus size={14} />
            <span>
              {saving ? tr("ext.commands.creating") : tr("ext.commands.create")}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

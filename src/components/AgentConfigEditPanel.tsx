/**
 * Settings → Agent: safe allowlisted section edit for agent-home config.toml.
 * Independent GROK_HOME only — shared mode shows a clear warning and disables write.
 * Never freeform rewrite of secrets; host path-scopes to agent-home.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import type { AgentConfigEditSnapshot } from "@/lib/api";
import { Select } from "@/components/Select";
import { UiCheck } from "@/components/settings/shared";
import { createT, type Locale, type MessageKey } from "@/i18n";
import {
  buildConfigEditPatch,
  hasConfigEditChanges,
  UI_PERMISSION_MODES,
  valuesFromSnapshot,
  type ConfigEditValues,
  type UiPermissionMode,
} from "@/lib/configTomlEdit";
import { IconRefresh } from "@/components/icons";

export function AgentConfigEditPanel({
  locale,
  onSaved,
  onError,
}: {
  locale: Locale;
  onSaved?: () => void;
  onError?: (message: string) => void;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const t = useCallback(
    (k: MessageKey, vars?: Record<string, string | number>) => tr(k, vars),
    [tr],
  );

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snap, setSnap] = useState<AgentConfigEditSnapshot | null>(null);
  const [baseline, setBaseline] = useState<ConfigEditValues>(
    valuesFromSnapshot({}),
  );
  const [draft, setDraft] = useState<ConfigEditValues>(valuesFromSnapshot({}));

  const applySnap = useCallback((s: AgentConfigEditSnapshot) => {
    setSnap(s);
    const vals = valuesFromSnapshot({
      permissionMode: s.permissionMode,
      yolo: s.yolo,
      subagentsEnabled: s.subagentsEnabled,
      memoryEnabled: s.memoryEnabled,
      workflowsEnabled: s.workflowsEnabled,
      autoWakeEnabled: s.autoWakeEnabled,
      twoPassCompactionEnabled: s.twoPassCompactionEnabled,
      lspToolsEnabled: s.lspToolsEnabled,
      codebaseIndexing: s.codebaseIndexing,
      remoteFetch: s.remoteFetch,
    });
    setBaseline(vals);
    setDraft(vals);
  }, []);

  const load = useCallback(async () => {
    if (!api.isTauri()) {
      setSnap(null);
      setError(t("settings.configTomlEdit.needTauri"));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.agentConfigEditGet();
      applySnap(res);
    } catch (e) {
      setSnap(null);
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      onError?.(msg);
    } finally {
      setLoading(false);
    }
  }, [applySnap, onError, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useMemo(
    () => buildConfigEditPatch(draft, baseline),
    [draft, baseline],
  );
  const dirty = hasConfigEditChanges(patch);
  const writable = !!snap?.writable;
  const disabled = !writable || busy || loading;

  const modeLabel = (m: UiPermissionMode | ""): string => {
    if (!m) return t("settings.configTomlEdit.permissionMode.unset");
    const key = `settings.configTomlEdit.permissionMode.${m}` as MessageKey;
    return t(key);
  };

  const save = async () => {
    if (!dirty || !writable || !api.isTauri()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.agentConfigEditSet({
        permissionMode: patch.permissionMode ?? null,
        yolo: patch.yolo ?? null,
        subagentsEnabled: patch.subagentsEnabled ?? null,
        memoryEnabled: patch.memoryEnabled ?? null,
        workflowsEnabled: patch.workflowsEnabled ?? null,
        autoWakeEnabled: patch.autoWakeEnabled ?? null,
        twoPassCompactionEnabled: patch.twoPassCompactionEnabled ?? null,
        lspToolsEnabled: patch.lspToolsEnabled ?? null,
        codebaseIndexing: patch.codebaseIndexing ?? null,
        remoteFetch: patch.remoteFetch ?? null,
      });
      applySnap(res);
      onSaved?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      onError?.(msg);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const reset = () => setDraft(baseline);

  return (
    <div
      className="settings-row settings-row--stack settings-config-edit"
      id="settings-anchor-configTomlEdit"
    >
      <div className="settings-row__text">
        <div className="settings-row__label">
          {t("settings.configTomlEdit")}
        </div>
        <div className="settings-row__desc">
          {t("settings.configTomlEditDesc")}
        </div>
        {snap?.path ? (
          <div className="settings-row__hint" title={snap.path}>
            {t("settings.configTomlEdit.path", { path: snap.path })}
          </div>
        ) : null}
      </div>

      {loading && !snap ? (
        <p className="ext-field-hint">{t("settings.configTomlEdit.loading")}</p>
      ) : null}

      {error ? (
        <div className="ext-alert ext-alert--error" role="alert">
          <div className="ext-alert__title">
            {t("settings.configTomlEdit.error")}
          </div>
          <p className="ext-alert__body">{error}</p>
        </div>
      ) : null}

      {snap && !writable ? (
        <div className="ext-alert ext-alert--warn" role="status">
          <p className="ext-alert__body" style={{ margin: 0 }}>
            {t("settings.configTomlEdit.sharedWarning")}
          </p>
        </div>
      ) : null}

      {snap ? (
        <>
          <div className="settings-config-edit__badges">
            <span className="ext-badge ext-badge--muted">
              {snap.mode === "shared"
                ? t("settings.configTomlEdit.mode.shared")
                : t("settings.configTomlEdit.mode.independent")}
            </span>
            {!snap.fileExists ? (
              <span className="ext-badge">
                {t("settings.configTomlEdit.missing")}
              </span>
            ) : null}
            {writable ? (
              <span className="ext-badge">
                {t("settings.configTomlEdit.writable")}
              </span>
            ) : (
              <span className="ext-badge">
                {t("settings.configTomlEdit.readOnly")}
              </span>
            )}
          </div>

          <div className="settings-config-edit__fields">
            <div className="settings-row settings-row--stack">
              <div className="settings-row__text">
                <div className="settings-row__label">
                  {t("settings.configTomlEdit.uiPermission")}
                </div>
                <div className="settings-row__desc">
                  {t("settings.configTomlEdit.uiPermissionDesc")}
                </div>
              </div>
              <Select
                value={draft.permissionMode || ""}
                disabled={disabled}
                onChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    permissionMode: (v || "") as UiPermissionMode | "",
                  }))
                }
                options={[
                  {
                    value: "",
                    label: t("settings.configTomlEdit.permissionMode.unset"),
                  },
                  ...UI_PERMISSION_MODES.map((m) => ({
                    value: m,
                    label: modeLabel(m),
                  })),
                ]}
              />
            </div>

            <div className="settings-row">
              <div className="settings-row__text">
                <div className="settings-row__label">
                  {t("settings.configTomlEdit.uiYolo")}
                </div>
                <div className="settings-row__desc">
                  {t("settings.configTomlEdit.uiYoloDesc")}
                </div>
              </div>
              <UiCheck
                checked={draft.yolo}
                disabled={disabled}
                onChange={(next) => setDraft((d) => ({ ...d, yolo: next }))}
                ariaLabel={t("settings.configTomlEdit.uiYolo")}
              />
            </div>

            <div className="settings-row">
              <div className="settings-row__text">
                <div className="settings-row__label">
                  {t("settings.configTomlEdit.subagents")}
                </div>
                <div className="settings-row__desc">
                  {t("settings.configTomlEdit.subagentsDesc")}
                </div>
              </div>
              <UiCheck
                checked={draft.subagentsEnabled}
                disabled={disabled}
                onChange={(next) =>
                  setDraft((d) => ({
                    ...d,
                    subagentsEnabled: next,
                  }))
                }
                ariaLabel={t("settings.configTomlEdit.subagents")}
              />
            </div>

            <div className="settings-row">
              <div className="settings-row__text">
                <div className="settings-row__label">
                  {t("settings.configTomlEdit.memory")}
                </div>
                <div className="settings-row__desc">
                  {t("settings.configTomlEdit.memoryDesc")}
                </div>
              </div>
              <UiCheck
                checked={draft.memoryEnabled}
                disabled={disabled}
                onChange={(next) =>
                  setDraft((d) => ({
                    ...d,
                    memoryEnabled: next,
                  }))
                }
                ariaLabel={t("settings.configTomlEdit.memory")}
              />
            </div>

            <div className="settings-row">
              <div className="settings-row__text">
                <div className="settings-row__label">
                  {t("settings.configTomlEdit.workflows")}
                </div>
                <div className="settings-row__desc">
                  {t("settings.configTomlEdit.workflowsDesc")}
                </div>
              </div>
              <UiCheck
                checked={draft.workflowsEnabled}
                disabled={disabled}
                onChange={(next) =>
                  setDraft((d) => ({
                    ...d,
                    workflowsEnabled: next,
                  }))
                }
                ariaLabel={t("settings.configTomlEdit.workflows")}
              />
            </div>

            <div className="settings-row">
              <div className="settings-row__text">
                <div className="settings-row__label">
                  {t("settings.configTomlEdit.autoWake")}
                </div>
                <div className="settings-row__desc">
                  {t("settings.configTomlEdit.autoWakeDesc")}
                </div>
              </div>
              <UiCheck
                checked={draft.autoWakeEnabled}
                disabled={disabled}
                onChange={(next) =>
                  setDraft((d) => ({
                    ...d,
                    autoWakeEnabled: next,
                  }))
                }
                ariaLabel={t("settings.configTomlEdit.autoWake")}
              />
            </div>

            <div className="settings-row">
              <div className="settings-row__text">
                <div className="settings-row__label">
                  {t("settings.configTomlEdit.twoPass")}
                </div>
                <div className="settings-row__desc">
                  {t("settings.configTomlEdit.twoPassDesc")}
                </div>
              </div>
              <UiCheck
                checked={draft.twoPassCompactionEnabled}
                disabled={disabled}
                onChange={(next) =>
                  setDraft((d) => ({
                    ...d,
                    twoPassCompactionEnabled: next,
                  }))
                }
                ariaLabel={t("settings.configTomlEdit.twoPass")}
              />
            </div>

            <div className="settings-row">
              <div className="settings-row__text">
                <div className="settings-row__label">
                  {t("settings.configTomlEdit.lspTools")}
                </div>
                <div className="settings-row__desc">
                  {t("settings.configTomlEdit.lspToolsDesc")}
                </div>
              </div>
              <UiCheck
                checked={draft.lspToolsEnabled}
                disabled={disabled}
                onChange={(next) =>
                  setDraft((d) => ({
                    ...d,
                    lspToolsEnabled: next,
                  }))
                }
                ariaLabel={t("settings.configTomlEdit.lspTools")}
              />
            </div>

            <div className="settings-row">
              <div className="settings-row__text">
                <div className="settings-row__label">
                  {t("settings.configTomlEdit.codebaseIndexing")}
                </div>
                <div className="settings-row__desc">
                  {t("settings.configTomlEdit.codebaseIndexingDesc")}
                </div>
              </div>
              <UiCheck
                checked={draft.codebaseIndexing}
                disabled={disabled}
                onChange={(next) =>
                  setDraft((d) => ({
                    ...d,
                    codebaseIndexing: next,
                  }))
                }
                ariaLabel={t("settings.configTomlEdit.codebaseIndexing")}
              />
            </div>

            <div className="settings-row">
              <div className="settings-row__text">
                <div className="settings-row__label">
                  {t("settings.configTomlEdit.remoteFetch")}
                </div>
                <div className="settings-row__desc">
                  {t("settings.configTomlEdit.remoteFetchDesc")}
                </div>
              </div>
              <UiCheck
                checked={draft.remoteFetch}
                disabled={disabled}
                onChange={(next) =>
                  setDraft((d) => ({
                    ...d,
                    remoteFetch: next,
                  }))
                }
                ariaLabel={t("settings.configTomlEdit.remoteFetch")}
              />
            </div>
          </div>

          {snap.redactedPreview?.trim() ? (
            <div className="settings-config-edit__preview">
              <div className="settings-row__label">
                {t("settings.configTomlEdit.preview")}
              </div>
              <p className="ext-field-hint" style={{ marginTop: 4 }}>
                {t("settings.configTomlEdit.redactNote")}
              </p>
              <pre className="settings-config-edit__pre" tabIndex={0}>
                {snap.redactedPreview}
              </pre>
            </div>
          ) : null}

          <div
            className="settings-row__actions"
          >
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={busy || loading}
              onClick={() => void load()}
            >
              <IconRefresh size={14} />
              <span>{t("settings.configTomlEdit.refresh")}</span>
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={!dirty || busy}
              onClick={reset}
            >
              {t("settings.configTomlEdit.reset")}
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={!dirty || disabled}
              onClick={() => void save()}
            >
              {busy
                ? t("settings.configTomlEdit.saving")
                : t("settings.configTomlEdit.save")}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

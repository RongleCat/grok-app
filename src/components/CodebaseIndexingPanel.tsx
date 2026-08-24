/**
 * Settings → Agent: Codebase indexing (`[features].codebase_indexing`).
 * Independent agent-home: allowlisted bool read/write. Shared mode: read-only.
 * Code graph only — never invents embeddings / vector search status.
 *
 * Status line uses `resolveCodeGraphMode` so search + indexing stay honest.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import type { CodebaseIndexingSnapshot } from "@/lib/api";
import { createT, type Locale, type MessageKey } from "@/i18n";
import {
  CODEBASE_INDEXING_CLI_DEFAULT,
  CODEBASE_INDEXING_CONFIG_PATH,
  CODEBASE_INDEXING_MIN_CLI,
  buildCodebaseIndexingPatch,
  cliSupportsCodebaseIndexing,
  codebaseIndexingKind,
  codebaseIndexingPresence,
  codebaseIndexingToggleChecked,
  describeCodebaseIndexingStatus,
  hasCodebaseIndexingChanges,
  isCodebaseIndexingToggleable,
  valuesFromCodebaseIndexingSnapshot,
  type CodebaseIndexingValues,
} from "@/lib/codebaseIndexing";
import {
  CODE_GRAPH_SEARCH_ANCHOR,
  buildCodeGraphStatusChips,
  codeGraphAppSearchRemainsKeywordKey,
  codeGraphModeStatusKey,
  codeGraphStatusChipLabelKey,
  planCodeGraphRebuild,
  resolveCodeGraphMode,
} from "@/lib/codeGraphProduct";
import { IconRefresh } from "@/components/icons";
import { UiCheck } from "@/components/settings/shared";

function PresenceBadge({
  values,
  t,
}: {
  values: CodebaseIndexingValues;
  t: (k: MessageKey, vars?: Record<string, string | number>) => string;
}) {
  const p = codebaseIndexingPresence(values);
  if (p === "unset") {
    return (
      <span className="ext-badge ext-badge--muted">
        {t("settings.codebaseIndexing.presence.unset")}
      </span>
    );
  }
  if (p === "set_on") {
    return (
      <span className="ext-badge">
        {t("settings.codebaseIndexing.presence.on")}
      </span>
    );
  }
  if (p === "custom") {
    return (
      <span className="ext-badge">
        {t("settings.codebaseIndexing.presence.custom")}
      </span>
    );
  }
  return (
    <span className="ext-badge ext-badge--muted">
      {t("settings.codebaseIndexing.presence.off")}
    </span>
  );
}

export function CodebaseIndexingPanel({
  locale,
  onSaved,
  onError,
  cliVersion,
}: {
  locale: Locale;
  onSaved?: () => void;
  onError?: (message: string) => void;
  /** Optional probed CLI version for soft-fail capability badge. */
  cliVersion?: string | null;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const t = useCallback(
    (k: MessageKey, vars?: Record<string, string | number>) => tr(k, vars),
    [tr],
  );

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snap, setSnap] = useState<CodebaseIndexingSnapshot | null>(null);
  const [baseline, setBaseline] = useState<CodebaseIndexingValues>(
    valuesFromCodebaseIndexingSnapshot({}),
  );
  const [draft, setDraft] = useState<CodebaseIndexingValues>(
    valuesFromCodebaseIndexingSnapshot({}),
  );
  const [probedCli, setProbedCli] = useState<string | null>(
    cliVersion ?? null,
  );

  const applySnap = useCallback((s: CodebaseIndexingSnapshot) => {
    setSnap(s);
    const vals = valuesFromCodebaseIndexingSnapshot({
      enabled: s.enabled,
      customRaw: s.customRaw,
      kind: s.kind,
      cliDefault: s.cliDefault,
    });
    setBaseline(vals);
    setDraft(vals);
  }, []);

  const load = useCallback(async () => {
    if (!api.isTauri()) {
      setSnap(null);
      setError(t("settings.codebaseIndexing.needTauri"));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.codebaseIndexingGet();
      applySnap(res);
      // Soft probe CLI version when not provided (never invents capability).
      if (cliVersion == null) {
        try {
          const probe = await api.probeCli();
          const ver =
            (probe as { version?: string | null } | null)?.version ?? null;
          setProbedCli(ver);
        } catch {
          setProbedCli(null);
        }
      } else {
        setProbedCli(cliVersion);
      }
    } catch (e) {
      setSnap(null);
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      onError?.(msg);
    } finally {
      setLoading(false);
    }
  }, [applySnap, cliVersion, onError, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useMemo(
    () => buildCodebaseIndexingPatch(draft, baseline),
    [draft, baseline],
  );
  const dirty = hasCodebaseIndexingChanges(patch);
  const writable = !!snap?.writable;
  const toggleable = isCodebaseIndexingToggleable(draft);
  const disabled = !writable || busy || loading || !toggleable;

  const status = useMemo(
    () =>
      describeCodebaseIndexingStatus(draft, {
        cliVersion: probedCli,
        cliDefault: snap?.cliDefault ?? CODEBASE_INDEXING_CLI_DEFAULT,
      }),
    [draft, probedCli, snap?.cliDefault],
  );

  const cliSupport = status.cliSupport;
  // When probe failed, also check prop.
  const supportFromProp = cliSupportsCodebaseIndexing(cliVersion ?? probedCli);

  const graphMode = useMemo(() => {
    const kind = codebaseIndexingKind({
      enabled: draft.enabled,
      customRaw: draft.customRaw,
      kind:
        draft.customRaw != null
          ? "custom"
          : draft.enabled === true || draft.enabled === false
            ? "bool"
            : "unset",
    });
    const cliOld =
      cliSupport === false || supportFromProp === false;
    return resolveCodeGraphMode({
      indexingEnabled: draft.enabled,
      indexingKind: kind,
      cliOld,
      searchKind: "keyword",
    });
  }, [draft, cliSupport, supportFromProp]);

  const graphChips = useMemo(
    () => buildCodeGraphStatusChips(graphMode),
    [graphMode],
  );

  const rebuildPlan = useMemo(() => planCodeGraphRebuild({ mode: graphMode }), [
    graphMode,
  ]);

  const scrollToSearchSettings = useCallback(() => {
    const el = document.getElementById(CODE_GRAPH_SEARCH_ANCHOR);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const onToggle = (next: boolean) => {
    if (!toggleable) return;
    setDraft((d) => ({
      ...d,
      enabled: next,
      customRaw: null,
    }));
  };

  const save = async () => {
    if (!dirty || !writable || !api.isTauri()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.codebaseIndexingSet({
        enabled: patch.enabled ?? null,
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
      className="settings-row settings-row--stack settings-codebase-indexing"
      id="settings-anchor-codebaseIndexing"
    >
      <div className="settings-row__text">
        <div className="settings-row__label">
          {t("settings.codebaseIndexing")}
        </div>
        <div className="settings-row__desc">
          {t("settings.codebaseIndexingDesc")}
        </div>
        {snap?.path ? (
          <div className="settings-row__hint" title={snap.path}>
            {t("settings.codebaseIndexing.path", { path: snap.path })}
          </div>
        ) : null}
      </div>

      {loading && !snap ? (
        <p className="ext-field-hint">
          {t("settings.codebaseIndexing.loading")}
        </p>
      ) : null}

      {error ? (
        <div className="ext-alert ext-alert--error" role="alert">
          <div className="ext-alert__title">
            {t("settings.codebaseIndexing.error")}
          </div>
          <p className="ext-alert__body">{error}</p>
        </div>
      ) : null}

      {snap && !writable ? (
        <div className="ext-alert ext-alert--warn" role="status">
          <p className="ext-alert__body" style={{ margin: 0 }}>
            {t("settings.codebaseIndexing.sharedWarning")}
          </p>
        </div>
      ) : null}

      {snap ? (
        <>
          <div className="settings-config-edit__badges">
            <span className="ext-badge ext-badge--muted">
              {snap.mode === "shared"
                ? t("settings.codebaseIndexing.mode.shared")
                : t("settings.codebaseIndexing.mode.independent")}
            </span>
            {!snap.fileExists ? (
              <span className="ext-badge">
                {t("settings.codebaseIndexing.missing")}
              </span>
            ) : null}
            {writable ? (
              <span className="ext-badge">
                {t("settings.codebaseIndexing.writable")}
              </span>
            ) : (
              <span className="ext-badge">
                {t("settings.codebaseIndexing.readOnly")}
              </span>
            )}
            {status.effective ? (
              <span className="ext-badge">
                {t("settings.codebaseIndexing.status.effectiveOn")}
              </span>
            ) : (
              <span className="ext-badge ext-badge--muted">
                {t("settings.codebaseIndexing.status.effectiveOff")}
              </span>
            )}
            {(cliSupport === false || supportFromProp === false) && (
              <span className="ext-badge ext-badge--muted">
                {t("settings.codebaseIndexing.cliOld", {
                  min: CODEBASE_INDEXING_MIN_CLI,
                })}
              </span>
            )}
            {(cliSupport === null || supportFromProp === null) &&
              probedCli == null &&
              cliVersion == null && (
                <span className="ext-badge ext-badge--muted">
                  {t("settings.codebaseIndexing.cliUnknown")}
                </span>
              )}
          </div>

          <div
            className="settings-code-graph__status"
            role="status"
            aria-label={t("settings.codeGraph.modeLabel")}
            style={{ marginTop: 8 }}
          >
            <div className="settings-config-edit__badges settings-code-graph__chips">
              {graphChips.map((chip) => (
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
            </div>
            <p className="ext-field-hint" style={{ marginTop: 6 }}>
              {t(codeGraphModeStatusKey(graphMode), {
                min: CODEBASE_INDEXING_MIN_CLI,
              })}
            </p>
            <p className="ext-field-hint">
              {t(codeGraphAppSearchRemainsKeywordKey())}
            </p>
            {rebuildPlan.status === "unavailable" ? (
              <p className="ext-field-hint">
                {t(rebuildPlan.noteKey)} {t(rebuildPlan.cliHintKey)}
              </p>
            ) : null}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={scrollToSearchSettings}
              style={{ marginTop: 4 }}
            >
              {t("settings.codeGraph.openSearchSettings")}
            </button>
          </div>

          <div
            className="ext-alert"
            role="note"
            style={{ marginTop: 8, marginBottom: 4 }}
          >
            <p className="ext-alert__body" style={{ margin: 0 }}>
              {t("settings.codebaseIndexing.noEmbeddings")}
            </p>
          </div>

          <div className="settings-config-edit__fields">
            <div className="settings-row" id="settings-anchor-codebaseIndexing-enable">
              <div className="settings-row__text">
                <div className="settings-row__label">
                  {t("settings.codebaseIndexing.enable")}{" "}
                  <PresenceBadge values={draft} t={t} />
                </div>
                <div className="settings-row__desc">
                  {t("settings.codebaseIndexing.enableDesc")}
                </div>
                <div
                  className="settings-row__hint"
                  title={CODEBASE_INDEXING_CONFIG_PATH}
                >
                  {CODEBASE_INDEXING_CONFIG_PATH}
                </div>
                {codebaseIndexingPresence(draft) === "unset" ? (
                  <div className="settings-row__hint">
                    {t("settings.codebaseIndexing.unsetDefaultHint")}
                  </div>
                ) : null}
                {codebaseIndexingPresence(draft) === "custom" &&
                draft.customRaw ? (
                  <div className="settings-row__hint" title={draft.customRaw}>
                    {t("settings.codebaseIndexing.customHint", {
                      raw: draft.customRaw,
                    })}
                  </div>
                ) : null}
              </div>
              <UiCheck
                checked={codebaseIndexingToggleChecked(draft)}
                disabled={disabled}
                onChange={onToggle}
                ariaLabel={t("settings.codebaseIndexing.enable")}
              />
            </div>
          </div>

          {snap.redactedPreview?.trim() ? (
            <div className="settings-config-edit__preview">
              <div className="settings-row__label">
                {t("settings.codebaseIndexing.preview")}
              </div>
              <pre className="settings-config-edit__pre" tabIndex={0}>
                {snap.redactedPreview}
              </pre>
            </div>
          ) : (
            <p className="ext-field-hint">
              {t("settings.codebaseIndexing.previewEmpty")}
            </p>
          )}

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
              <span>{t("settings.codebaseIndexing.refresh")}</span>
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={!dirty || busy || loading}
              onClick={reset}
            >
              {t("settings.codebaseIndexing.reset")}
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={
                !dirty || !writable || busy || loading || !toggleable
              }
              onClick={() => void save()}
            >
              {busy
                ? t("settings.codebaseIndexing.saving")
                : t("settings.codebaseIndexing.save")}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

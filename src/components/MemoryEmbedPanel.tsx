/**
 * Settings → Agent: Memory embedding (Grok Build 0.2.117 `[memory.*]` keys).
 * Independent agent-home: allowlisted read/write. Shared mode: read-only probe.
 * Never invents embeddings client-side — App browser search stays keyword-only.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import type { MemoryEmbedConfigSnapshot } from "@/lib/api";
import { createT, type Locale, type MessageKey } from "@/i18n";
import {
  buildMemoryEmbedPatch,
  describeSearchModes,
  hasMemoryEmbedChanges,
  isEmbeddingConfigured,
  memoryEmbedKeyPresence,
  memoryEmbedToggleChecked,
  parseOptionalNumber,
  validateMemoryEmbedDraft,
  valuesFromMemoryEmbedSnapshot,
  type MemoryEmbedTri,
  type MemoryEmbedValues,
} from "@/lib/memoryEmbedConfig";
import { IconRefresh } from "@/components/icons";
import { UiCheck } from "@/components/settings/shared";

function PresenceBadge({
  value,
  t,
}: {
  value: MemoryEmbedTri;
  t: (k: MessageKey, vars?: Record<string, string | number>) => string;
}) {
  const p = memoryEmbedKeyPresence(value);
  if (p === "unset") {
    return (
      <span className="ext-badge ext-badge--muted">
        {t("settings.memoryEmbed.presence.unset")}
      </span>
    );
  }
  if (p === "set_on") {
    return (
      <span className="ext-badge">{t("settings.memoryEmbed.presence.on")}</span>
    );
  }
  return (
    <span className="ext-badge ext-badge--muted">
      {t("settings.memoryEmbed.presence.off")}
    </span>
  );
}

function ScalarPresence({
  set,
  t,
}: {
  set: boolean;
  t: (k: MessageKey, vars?: Record<string, string | number>) => string;
}) {
  return set ? (
    <span className="ext-badge">{t("settings.memoryEmbed.presence.set")}</span>
  ) : (
    <span className="ext-badge ext-badge--muted">
      {t("settings.memoryEmbed.presence.unset")}
    </span>
  );
}

function BoolRow({
  id,
  labelKey,
  descKey,
  configKey,
  value,
  disabled,
  onToggle,
  t,
}: {
  id: string;
  labelKey: MessageKey;
  descKey: MessageKey;
  configKey: string;
  value: MemoryEmbedTri;
  disabled: boolean;
  onToggle: (next: boolean) => void;
  t: (k: MessageKey, vars?: Record<string, string | number>) => string;
}) {
  return (
    <div className="settings-row" id={id}>
      <div className="settings-row__text">
        <div className="settings-row__label">
          {t(labelKey)} <PresenceBadge value={value} t={t} />
        </div>
        <div className="settings-row__desc">{t(descKey)}</div>
        <div className="settings-row__hint" title={configKey}>
          {configKey}
        </div>
      </div>
      <UiCheck
        checked={memoryEmbedToggleChecked(value)}
        disabled={disabled}
        onChange={onToggle}
        ariaLabel={t(labelKey)}
      />
    </div>
  );
}

function NumberField({
  id,
  labelKey,
  descKey,
  configKey,
  value,
  disabled,
  step,
  placeholder,
  onChange,
  t,
}: {
  id: string;
  labelKey: MessageKey;
  descKey: MessageKey;
  configKey: string;
  value: number | null;
  disabled: boolean;
  step?: string;
  placeholder?: string;
  onChange: (v: number | null) => void;
  t: (k: MessageKey, vars?: Record<string, string | number>) => string;
}) {
  return (
    <div className="settings-row settings-row--stack" id={id}>
      <div className="settings-row__text">
        <div className="settings-row__label">
          {t(labelKey)}{" "}
          <ScalarPresence set={value != null} t={t} />
        </div>
        <div className="settings-row__desc">{t(descKey)}</div>
        <div className="settings-row__hint" title={configKey}>
          {configKey}
        </div>
      </div>
      <input
        type="number"
        className="settings-input"
        disabled={disabled}
        value={value ?? ""}
        step={step ?? "any"}
        placeholder={placeholder ?? t("settings.memoryEmbed.unsetPlaceholder")}
        onChange={(e) => onChange(parseOptionalNumber(e.target.value))}
        aria-label={t(labelKey)}
      />
    </div>
  );
}

export function MemoryEmbedPanel({
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
  const [snap, setSnap] = useState<MemoryEmbedConfigSnapshot | null>(null);
  const [baseline, setBaseline] = useState<MemoryEmbedValues>(
    valuesFromMemoryEmbedSnapshot({}),
  );
  const [draft, setDraft] = useState<MemoryEmbedValues>(
    valuesFromMemoryEmbedSnapshot({}),
  );

  const applySnap = useCallback((s: MemoryEmbedConfigSnapshot) => {
    setSnap(s);
    const vals = valuesFromMemoryEmbedSnapshot(s);
    setBaseline(vals);
    setDraft(vals);
  }, []);

  const load = useCallback(async () => {
    if (!api.isTauri()) {
      setSnap(null);
      setError(t("settings.memoryEmbed.needTauri"));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.memoryEmbedConfigGet();
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
    () => buildMemoryEmbedPatch(draft, baseline),
    [draft, baseline],
  );
  const dirty = hasMemoryEmbedChanges(patch);
  const writable = !!snap?.writable;
  const disabled = !writable || busy || loading;
  const modes = describeSearchModes(snap ?? undefined);
  const configured = isEmbeddingConfigured(snap ?? undefined);

  const setTri = (key: keyof MemoryEmbedValues, next: boolean) => {
    setDraft((d) => ({
      ...d,
      [key]: next,
    }));
  };

  const save = async () => {
    if (!dirty || !writable || !api.isTauri()) return;
    const validation = validateMemoryEmbedDraft(draft);
    if (validation) {
      setError(validation);
      onError?.(validation);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.memoryEmbedConfigSet({
        embeddingModel: patch.embeddingModel ?? null,
        clearEmbeddingModel: patch.clearEmbeddingModel ?? null,
        embeddingDimensions: patch.embeddingDimensions ?? null,
        embeddingProvider: patch.embeddingProvider ?? null,
        searchMaxResults: patch.searchMaxResults ?? null,
        searchMinScore: patch.searchMinScore ?? null,
        searchVectorWeight: patch.searchVectorWeight ?? null,
        searchTextWeight: patch.searchTextWeight ?? null,
        mmrEnabled: patch.mmrEnabled ?? null,
        mmrLambda: patch.mmrLambda ?? null,
        temporalDecayEnabled: patch.temporalDecayEnabled ?? null,
        temporalDecayHalfLifeDays: patch.temporalDecayHalfLifeDays ?? null,
        dreamEnabled: patch.dreamEnabled ?? null,
        dreamMinHours: patch.dreamMinHours ?? null,
        dreamMinSessions: patch.dreamMinSessions ?? null,
        dreamCheckIntervalSecs: patch.dreamCheckIntervalSecs ?? null,
        watcherEnabled: patch.watcherEnabled ?? null,
        initialInjectionEnabled: patch.initialInjectionEnabled ?? null,
        initialInjectionMinScore: patch.initialInjectionMinScore ?? null,
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
      className="settings-row settings-row--stack settings-memory-embed"
      id="settings-anchor-memoryEmbed"
    >
      <div className="settings-row__text">
        <div className="settings-row__label">{t("settings.memoryEmbed")}</div>
        <div className="settings-row__desc">{t("settings.memoryEmbedDesc")}</div>
        {snap?.path ? (
          <div className="settings-row__hint" title={snap.path}>
            {t("settings.memoryEmbed.path", { path: snap.path })}
          </div>
        ) : null}
      </div>

      {loading && !snap ? (
        <p className="ext-field-hint">{t("settings.memoryEmbed.loading")}</p>
      ) : null}

      {error ? (
        <div className="ext-alert ext-alert--error" role="alert">
          <div className="ext-alert__title">{t("settings.memoryEmbed.error")}</div>
          <p className="ext-alert__body">{error}</p>
        </div>
      ) : null}

      {snap && !writable ? (
        <div className="ext-alert ext-alert--warn" role="status">
          <p className="ext-alert__body" style={{ margin: 0 }}>
            {t("settings.memoryEmbed.sharedWarning")}
          </p>
        </div>
      ) : null}

      {snap ? (
        <>
          <div className="settings-config-edit__badges">
            <span className="ext-badge ext-badge--muted">
              {snap.mode === "shared"
                ? t("settings.memoryEmbed.mode.shared")
                : t("settings.memoryEmbed.mode.independent")}
            </span>
            {!snap.fileExists ? (
              <span className="ext-badge">
                {t("settings.memoryEmbed.missing")}
              </span>
            ) : null}
            {writable ? (
              <span className="ext-badge">
                {t("settings.memoryEmbed.writable")}
              </span>
            ) : (
              <span className="ext-badge">
                {t("settings.memoryEmbed.readOnly")}
              </span>
            )}
            {configured ? (
              <span className="ext-badge">
                {t("settings.memoryEmbed.status.configured")}
              </span>
            ) : (
              <span className="ext-badge ext-badge--muted">
                {t("settings.memoryEmbed.status.unset")}
              </span>
            )}
          </div>

          <div className="ext-alert" role="status" style={{ marginTop: 8 }}>
            <p className="ext-alert__body" style={{ margin: 0 }}>
              {t("settings.memoryEmbed.searchModes", {
                app: t("settings.memoryEmbed.searchMode.keyword"),
                cli:
                  modes.cli === "hybrid"
                    ? t("settings.memoryEmbed.searchMode.hybrid")
                    : t("settings.memoryEmbed.searchMode.keyword"),
              })}
            </p>
            {!configured ? (
              <p className="ext-alert__body" style={{ margin: "6px 0 0" }}>
                {t("settings.memoryEmbed.embeddingEmpty")}
              </p>
            ) : null}
          </div>

          <div className="settings-config-edit__fields" style={{ marginTop: 8 }}>
            <div
              className="settings-row settings-row--stack"
              id="settings-anchor-memoryEmbed-model"
            >
              <div className="settings-row__text">
                <div className="settings-row__label">
                  {t("settings.memoryEmbed.model")}{" "}
                  <ScalarPresence set={!!draft.embeddingModel} t={t} />
                </div>
                <div className="settings-row__desc">
                  {t("settings.memoryEmbed.modelDesc")}
                </div>
                <div className="settings-row__hint" title="[memory.embedding] model">
                  [memory.embedding] model
                </div>
              </div>
              <input
                type="text"
                className="settings-input"
                disabled={disabled}
                value={draft.embeddingModel ?? ""}
                placeholder={t("settings.memoryEmbed.modelPlaceholder")}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    embeddingModel: e.target.value.trim()
                      ? e.target.value
                      : null,
                  }))
                }
                autoComplete="off"
                spellCheck={false}
                aria-label={t("settings.memoryEmbed.model")}
              />
            </div>

            <NumberField
              id="settings-anchor-memoryEmbed-dimensions"
              labelKey="settings.memoryEmbed.dimensions"
              descKey="settings.memoryEmbed.dimensionsDesc"
              configKey="[memory.embedding] dimensions"
              value={draft.embeddingDimensions}
              disabled={disabled}
              step="1"
              onChange={(v) =>
                setDraft((d) => ({ ...d, embeddingDimensions: v }))
              }
              t={t}
            />

            <NumberField
              id="settings-anchor-memoryEmbed-maxResults"
              labelKey="settings.memoryEmbed.maxResults"
              descKey="settings.memoryEmbed.maxResultsDesc"
              configKey="[memory.search] max_results"
              value={draft.searchMaxResults}
              disabled={disabled}
              step="1"
              onChange={(v) =>
                setDraft((d) => ({ ...d, searchMaxResults: v }))
              }
              t={t}
            />

            <NumberField
              id="settings-anchor-memoryEmbed-minScore"
              labelKey="settings.memoryEmbed.minScore"
              descKey="settings.memoryEmbed.minScoreDesc"
              configKey="[memory.search] min_score"
              value={draft.searchMinScore}
              disabled={disabled}
              step="0.01"
              onChange={(v) => setDraft((d) => ({ ...d, searchMinScore: v }))}
              t={t}
            />

            <BoolRow
              id="settings-anchor-memoryEmbed-mmr"
              labelKey="settings.memoryEmbed.mmr"
              descKey="settings.memoryEmbed.mmrDesc"
              configKey="[memory.search.mmr] enabled"
              value={draft.mmrEnabled}
              disabled={disabled}
              onToggle={(next) => setTri("mmrEnabled", next)}
              t={t}
            />

            <NumberField
              id="settings-anchor-memoryEmbed-mmrLambda"
              labelKey="settings.memoryEmbed.mmrLambda"
              descKey="settings.memoryEmbed.mmrLambdaDesc"
              configKey="[memory.search.mmr] lambda"
              value={draft.mmrLambda}
              disabled={disabled}
              step="0.05"
              onChange={(v) => setDraft((d) => ({ ...d, mmrLambda: v }))}
              t={t}
            />

            <BoolRow
              id="settings-anchor-memoryEmbed-temporalDecay"
              labelKey="settings.memoryEmbed.temporalDecay"
              descKey="settings.memoryEmbed.temporalDecayDesc"
              configKey="[memory.search.temporal_decay] enabled"
              value={draft.temporalDecayEnabled}
              disabled={disabled}
              onToggle={(next) => setTri("temporalDecayEnabled", next)}
              t={t}
            />

            <NumberField
              id="settings-anchor-memoryEmbed-halfLife"
              labelKey="settings.memoryEmbed.halfLife"
              descKey="settings.memoryEmbed.halfLifeDesc"
              configKey="[memory.search.temporal_decay] half_life_days"
              value={draft.temporalDecayHalfLifeDays}
              disabled={disabled}
              step="0.5"
              onChange={(v) =>
                setDraft((d) => ({ ...d, temporalDecayHalfLifeDays: v }))
              }
              t={t}
            />

            <BoolRow
              id="settings-anchor-memoryEmbed-dream"
              labelKey="settings.memoryEmbed.dream"
              descKey="settings.memoryEmbed.dreamDesc"
              configKey="[memory.dream] enabled"
              value={draft.dreamEnabled}
              disabled={disabled}
              onToggle={(next) => setTri("dreamEnabled", next)}
              t={t}
            />

            <NumberField
              id="settings-anchor-memoryEmbed-dreamMinHours"
              labelKey="settings.memoryEmbed.dreamMinHours"
              descKey="settings.memoryEmbed.dreamMinHoursDesc"
              configKey="[memory.dream] min_hours"
              value={draft.dreamMinHours}
              disabled={disabled}
              step="0.5"
              onChange={(v) => setDraft((d) => ({ ...d, dreamMinHours: v }))}
              t={t}
            />

            <NumberField
              id="settings-anchor-memoryEmbed-dreamMinSessions"
              labelKey="settings.memoryEmbed.dreamMinSessions"
              descKey="settings.memoryEmbed.dreamMinSessionsDesc"
              configKey="[memory.dream] min_sessions"
              value={draft.dreamMinSessions}
              disabled={disabled}
              step="1"
              onChange={(v) =>
                setDraft((d) => ({ ...d, dreamMinSessions: v }))
              }
              t={t}
            />

            <BoolRow
              id="settings-anchor-memoryEmbed-watcher"
              labelKey="settings.memoryEmbed.watcher"
              descKey="settings.memoryEmbed.watcherDesc"
              configKey="[memory.watcher] enabled"
              value={draft.watcherEnabled}
              disabled={disabled}
              onToggle={(next) => setTri("watcherEnabled", next)}
              t={t}
            />

            <BoolRow
              id="settings-anchor-memoryEmbed-injection"
              labelKey="settings.memoryEmbed.injection"
              descKey="settings.memoryEmbed.injectionDesc"
              configKey="[memory.initial_injection] enabled"
              value={draft.initialInjectionEnabled}
              disabled={disabled}
              onToggle={(next) => setTri("initialInjectionEnabled", next)}
              t={t}
            />
          </div>

          {snap.redactedPreview?.trim() ? (
            <div className="settings-config-edit__preview">
              <div className="settings-row__label">
                {t("settings.memoryEmbed.preview")}
              </div>
              <p className="ext-field-hint" style={{ marginTop: 4 }}>
                {t("settings.memoryEmbed.redactNote")}
              </p>
              <pre className="settings-config-edit__pre" tabIndex={0}>
                {snap.redactedPreview}
              </pre>
            </div>
          ) : (
            <p className="ext-field-hint">
              {t("settings.memoryEmbed.previewEmpty")}
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
              <span>{t("settings.memoryEmbed.refresh")}</span>
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={!dirty || busy || loading}
              onClick={reset}
            >
              {t("settings.memoryEmbed.reset")}
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={!dirty || !writable || busy || loading}
              onClick={() => void save()}
            >
              {busy
                ? t("settings.memoryEmbed.saving")
                : t("settings.memoryEmbed.save")}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
